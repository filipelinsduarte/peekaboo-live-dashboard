/*
 * sources.js — Sources view (live), pixel-faithful clone of the captured
 * reference at app/sources.html (the "aim" Sources page on 7897) plus the
 * live aipeekaboo.com/sources Domains/URLs tab toggle.
 *
 * Layout (all markup/classes copied from the captured page):
 *   - .aim-scope wrapper + Domains/URLs segmented pill tab bar
 *     (.aim-tab-bar / .aim-tab, active tab = white raised chip)
 *
 *   DOMAINS tab (default):
 *   - grid [1fr 280px]:
 *       (a) "Source Usage by Domain" card — ranked horizontal bars
 *           (rank / favicon / name / track / count), favicon legend,
 *           pager over groups of 5 across the top 20 domains
 *       (b) "Content Type" card — custom SVG donut (outer r54 / inner r34,
 *           hover highlight), center total + "Citations", 8-item legend
 *   - "All Content Types" table card — content-type filter dropdown,
 *     Export CSV, search, pager, table (#/Source/Content Type/Domain Type/
 *     Used/% of Citations), numbered bottom pagination
 *   - "Domain Citations by AI Model" heatmap card — 20%/16%×n grid,
 *     per-model colored cells, alpha = max(0.12, 0.85 · count/maxVisible)
 *
 *   URLS tab:
 *   - grid [1fr 280px]:
 *       (a) "Source Usage by URL" card — paged legend (top 20 URLs, 5 per
 *           page, colored dots) + per-day citation trend (Chart.js line);
 *           "Not enough history to plot a trend" when < 2 distinct days
 *       (b) "Content Type" donut aggregated by page type
 *   - URL table card — "All Domains" filter dropdown, Export, search, pager,
 *     table (URL / Page Title | Page Type | AI Models | Citations | Runs |
 *     Share | Last Seen | View), numbered bottom pagination
 *
 * Data:
 *   Domains: PB.api.sources(brandId) ->
 *     { sources:[{domain, mentions, aiModels:[tag,...]}], summary:{...} }
 *   URLs: the public API has NO url-level sources endpoint; the only place
 *     full article URLs exist is GET /brands/:id/prompts/:promptId where
 *     each history[] entry carries sources:[{domain,url,title}]. The URLs
 *     tab therefore fetches every prompt detail once (pooled, 4 at a time),
 *     aggregates citations per cleaned URL, and caches the result per
 *     brand+range for the session.
 *
 * The live API has no per-model counts and no content-type taxonomy, so:
 *   - content type per domain is derived (known-domain map + TLD heuristics),
 *   - page type per URL is derived from the URL path + page title,
 *   - per-model counts on the heatmap are a deterministic split of `mentions`.
 *
 * Styles: injects the captured compiled stylesheet
 *   /_next/static/css/fb9cebaaf381bc0d.css (defines every .aim-* class).
 *
 * Tests: live-app/tests/sources.test.mjs (node --test) covers the pure math
 * (split, shares, heat alpha, classifiers, URL aggregation, donut geometry).
 */
(function () {
  'use strict';
  if (!window.PB) return;
  var el = PB.el;

  var AIM_CSS_HREF = '/_next/static/css/fb9cebaaf381bc0d.css';
  var AIM_CSS_ID = 'pb-aim-css';

  // ---- constants copied from the captured sources page bundle --------------
  var BAR_COLORS = ['var(--theme-primary)', '#10b981', '#2563eb', '#8b5cf6', '#64748b', '#06b6d4'];
  // trend lines need concrete colors (Chart.js can't resolve CSS vars)
  var LINE_COLORS = ['#b352b3', '#10b981', '#2563eb', '#8b5cf6', '#64748b', '#06b6d4'];

  var CT_COLORS = {
    'Blog Post': 'var(--theme-primary)',
    'Review': '#38bdf8',
    'Forum / Community': '#f59e0b',
    'News Article': '#10b981',
    'Community': '#6366f1',
    'Article / Post': '#0ea5e9',
    'Video': '#f472b6',
    'Social': '#8b5cf6',
    'Comparison': '#eab308',
    'How To Guide': '#0ea5e9',
    'Listicle / Roundup': '#059669',
    'Product Page': '#15803d',
    'Other': '#94a3b8',
  };

  // page-type palette for the URLs tab (matches the live donut/legend order)
  var PT_COLORS = {
    'Article': '#94a3b8',
    'Blog Post': 'var(--theme-primary)',
    'Listicle': '#22d3ee',
    'Home Page': '#64748b',
    'Forum Thread': '#f59e0b',
    'Guide': '#0ea5e9',
    'Review': '#38bdf8',
    'Category Page': '#6366f1',
    'Comparison': '#eab308',
    'Video': '#f472b6',
    'News': '#10b981',
    'Other': '#cbd5e1',
  };
  // dot colors used inside the outlined page-type pills (donut palette, but
  // theme-primary resolved so it renders inside border pills too)
  var PT_DOT_COLORS = {
    'Article': '#94a3b8',
    'Blog Post': '#b352b3',
    'Listicle': '#22d3ee',
    'Home Page': '#64748b',
    'Forum Thread': '#f59e0b',
    'Guide': '#0ea5e9',
    'Review': '#38bdf8',
    'Category Page': '#6366f1',
    'Comparison': '#eab308',
    'Video': '#f472b6',
    'News': '#10b981',
    'Other': '#cbd5e1',
  };

  var MODEL_ORDER = ['gpt-4o-mini', 'gemini-2.5-flash', 'sonar', 'google-aio', 'google-ai-mode'];
  var MODEL_LABELS = {
    'gpt-4o-mini': 'ChatGPT',
    'gemini-2.5-flash': 'Gemini',
    'sonar': 'Perplexity',
    'google-aio': 'AI Overview',
    'google-ai-mode': 'AI Mode',
  };
  var MODEL_COLORS = {
    'gpt-4o-mini': '#10a37f',
    'gemini-2.5-flash': '#4285f4',
    'sonar': '#8b5cf6',
    'google-aio': '#f59e0b',
    'google-ai-mode': '#06b6d4',
  };

  // known-domain -> content type (verbatim from the captured bundle)
  var DOMAIN_CT = {
    'reddit.com': 'Forum / Community', 'quora.com': 'Forum / Community',
    'stackoverflow.com': 'Forum / Community', 'news.ycombinator.com': 'Forum / Community',
    'discord.com': 'Forum / Community',
    'producthunt.com': 'Community', 'indiehackers.com': 'Community',
    'twitter.com': 'Social', 'x.com': 'Social', 'facebook.com': 'Social',
    'instagram.com': 'Social', 'tiktok.com': 'Social', 'linkedin.com': 'Social',
    'youtube.com': 'Video', 'vimeo.com': 'Video', 'dailymotion.com': 'Video', 'twitch.tv': 'Video',
    'g2.com': 'Review', 'capterra.com': 'Review', 'trustpilot.com': 'Review',
    'gartner.com': 'Review', 'getapp.com': 'Review', 'softwareadvice.com': 'Review',
    'peerspot.com': 'Review', 'pcmag.com': 'Review', 'cnet.com': 'Review',
    'techradar.com': 'Review', 'tomsguide.com': 'Review',
    'alternativeto.net': 'Comparison', 'slant.co': 'Comparison',
    'comparably.com': 'Comparison', 'versus.com': 'Comparison',
    'techcrunch.com': 'News Article', 'martech.org': 'News Article', 'digiday.com': 'News Article',
    'theverge.com': 'News Article', 'wired.com': 'News Article', 'venturebeat.com': 'News Article',
    'forbes.com': 'News Article', 'businessinsider.com': 'News Article',
    'fastcompany.com': 'News Article', 'inc.com': 'News Article', 'adweek.com': 'News Article',
    'wsj.com': 'News Article', 'bloomberg.com': 'News Article', 'thenextweb.com': 'News Article',
    'entrepreneur.com': 'News Article', 'theguardian.com': 'News Article', 'nytimes.com': 'News Article',
    'hubspot.com': 'Blog Post', 'moz.com': 'Blog Post', 'semrush.com': 'Blog Post',
    'ahrefs.com': 'Blog Post', 'sproutsocial.com': 'Blog Post', 'nightwatch.io': 'Blog Post',
    'otterly.ai': 'Blog Post', 'siftly.ai': 'Blog Post', 'rankability.com': 'Blog Post',
    'tryprofound.com': 'Blog Post', 'seranking.com': 'Blog Post', 'backlinko.com': 'Blog Post',
    'neilpatel.com': 'Blog Post', 'buffer.com': 'Blog Post', 'hootsuite.com': 'Blog Post',
    'klaviyo.com': 'Blog Post', 'searchengineland.com': 'Blog Post',
    'searchenginejournal.com': 'Blog Post', 'contentmarketinginstitute.com': 'Blog Post',
    'marketingland.com': 'Blog Post',
    'wikipedia.org': 'Article / Post', 'medium.com': 'Article / Post',
    'substack.com': 'Article / Post', 'dev.to': 'Article / Post',
    'hashnode.dev': 'Article / Post', 'developer.mozilla.org': 'Article / Post',
    'github.com': 'Article / Post',
  };

  // domain-type badge sets (verbatim from the captured bundle)
  var DT_SOCIAL = ['reddit.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'discord.com', 'quora.com', 'news.ycombinator.com', 'indiehackers.com', 'producthunt.com'];
  var DT_COMPETITOR = ['semrush.com', 'ahrefs.com', 'moz.com', 'brightedge.com', 'conductor.com', 'authoritas.com', 'serpstat.com', 'accuranker.com', 'wincher.com', 'searchmetrics.com', 'botify.com', 'nightwatch.io', 'seranking.com', 'visible.seranking.com', 'raven-tools.com', 'raventools.com', 'majestic.com', 'linkresearchtools.com', 'monitorbacklinks.com', 'otterly.ai', 'siftly.ai', 'rankability.com', 'tryprofound.com', 'trysight.ai', 'scrunch.ai', 'brandwise.ai', 'peec.ai', 'rankscale.ai', 'aimon.io', 'ziptie.dev', 'aimention.io', 'trackairesponses.com', 'llmrank.io', 'seomonitor.com', 'alpharank.io', 'visiblyai.com', 'zapier.com', 'make.com', 'n8n.io', 'ifttt.com', 'workato.com', 'tray.io', 'integrately.com', 'pabbly.com', 'jasper.ai', 'copy.ai', 'writesonic.com', 'surferseo.com', 'frase.io', 'clearscope.com', 'marketmuse.com', 'neuronwriter.com', 'you.com', 'phind.com', 'consensus.app', 'elicit.com'];
  var DT_REVIEW = ['g2.com', 'capterra.com', 'trustpilot.com', 'gartner.com', 'getapp.com', 'softwareadvice.com', 'peerspot.com', 'pcmag.com', 'cnet.com', 'techradar.com', 'tomsguide.com', 'softwarereviews.com'];
  var DT_EDITORIAL = ['techcrunch.com', 'martech.org', 'digiday.com', 'theverge.com', 'wired.com', 'venturebeat.com', 'forbes.com', 'businessinsider.com', 'fastcompany.com', 'inc.com', 'adweek.com', 'wsj.com', 'bloomberg.com', 'thenextweb.com', 'entrepreneur.com', 'theguardian.com', 'nytimes.com'];
  var DT_INDUSTRY_BLOG = ['searchengineland.com', 'searchenginejournal.com', 'contentmarketinginstitute.com', 'backlinko.com', 'neilpatel.com', 'marketingland.com', 'sprinklr.com'];
  var DT_CORPORATE = ['hubspot.com', 'salesforce.com', 'adobe.com', 'oracle.com', 'mailchimp.com', 'hootsuite.com', 'buffer.com', 'sproutsocial.com', 'zendesk.com', 'atlassian.com', 'notion.so', 'monday.com', 'klaviyo.com', 'intercom.com', 'drift.com', 'asana.com'];
  var DT_AI_SAAS = ['openai.com', 'anthropic.com', 'cohere.com', 'huggingface.co', 'mistral.ai', 'perplexity.ai', 'deepmind.google', 'deepmind.com'];
  var DT_VIDEO = ['youtube.com', 'vimeo.com', 'dailymotion.com', 'twitch.tv'];
  var DT_PUBLISHING = ['medium.com', 'substack.com', 'linkedin.com', 'ghost.org', 'beehiiv.com'];
  var DT_DEV = ['github.com', 'stackoverflow.com', 'dev.to', 'hashnode.dev', 'codepen.io', 'gitlab.com'];
  var DT_ECOM = ['amazon.com', 'etsy.com', 'ebay.com', 'shopify.com', 'woocommerce.com'];
  var DT_DOCS = ['developer.mozilla.org', 'docs.google.com', 'learn.microsoft.com', 'docs.github.com', 'readthedocs.io', 'gitbook.com'];

  var CT_OPTIONS = [
    { value: 'Blog Post', label: 'Blog Post', cssClass: 'blog-post' },
    { value: 'Review', label: 'Review', cssClass: 'review' },
    { value: 'Forum / Community', label: 'Forum / Community', cssClass: 'ugc' },
    { value: 'News Article', label: 'News Article', cssClass: 'news-article' },
    { value: 'Video', label: 'Video', cssClass: 'video' },
    { value: 'Comparison', label: 'Comparison', cssClass: 'comparison' },
    { value: 'How To Guide', label: 'How To Guide', cssClass: 'how-to-guide' },
    { value: 'Listicle / Roundup', label: 'Listicle / Roundup', cssClass: 'listicle-roundup' },
    { value: 'Product Page', label: 'Product Page', cssClass: 'product-page-ct' },
  ];

  var CT_INFO_TITLE = 'Blog Post: Editorial and long-form written content Review: Third-party product or service reviews and comparisons Forum / Community: User discussions and community threads News Article: Press coverage and editorial news publications Video: Video content from YouTube and similar platforms';

  // session cache for the (expensive) URL-level aggregation: key brand|range
  var URL_DATA_CACHE = {};

  // ---- pure helpers ---------------------------------------------------------
  function cleanDomain(domain) {
    return String(domain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  }

  function favUrl(domain) {
    return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(cleanDomain(domain)) + '&sz=32';
  }

  function hashCode(str) {
    var h = 0;
    var i;
    for (i = 0; i < str.length; i++) {
      h = ((h * 31) + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  // Strip tracking params (utm_*, gclid, fbclid, ref) from a cited URL so
  // the same article counts as one row. Keeps every other query param.
  function stripTracking(url) {
    var s = String(url || '').trim();
    var qIdx = s.indexOf('?');
    if (qIdx === -1) return s;
    var base = s.slice(0, qIdx);
    var hash = '';
    var query = s.slice(qIdx + 1);
    var hIdx = query.indexOf('#');
    if (hIdx !== -1) { hash = query.slice(hIdx); query = query.slice(0, hIdx); }
    var kept = query.split('&').filter(function (p) {
      if (!p) return false;
      if (/^utm_/i.test(p)) return false;
      if (/^(gclid|fbclid|ref|ref_src)=/i.test(p)) return false;
      return true;
    });
    return kept.length ? base + '?' + kept.join('&') + hash : base + hash;
  }

  // host + path of a URL, no protocol/www, trimmed to `max` chars (legend).
  function shortUrlLabel(url, max) {
    var limit = max || 36;
    var s = String(url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
    if (s.length > limit) s = s.slice(0, limit - 1) + '…';
    return s;
  }

  // Derive a content type for a bare domain (no URL paths in the live API).
  function classifyContentType(domain) {
    var d = cleanDomain(domain);
    if (DOMAIN_CT[d]) return DOMAIN_CT[d];
    if (/\.gov(\.[a-z]{2})?$/.test(d) || d.indexOf('.gov.') !== -1 || /(^|\.)nhs\.uk$/.test(d)) return 'Government';
    if (/\.edu(\.[a-z]{2})?$/.test(d) || /(^|\.)ac\.[a-z]{2}$/.test(d)) return 'Academic/Research';
    if (DT_INDUSTRY_BLOG.indexOf(d) !== -1) return 'Industry Blog';
    if (/\.org(\.[a-z]{2})?$/.test(d)) return 'Non-Profit/Organization';
    return 'Corporate Website';
  }

  // Derive a page type for a full URL + title (URLs tab). Mirrors the live
  // taxonomy: Home Page / Forum Thread / Video / Comparison / Review /
  // Listicle / Guide / Blog Post / Category Page / News / Article.
  function classifyPageType(url, title) {
    var u = String(url || '').toLowerCase();
    var t = String(title || '').toLowerCase();
    var m = u.match(/^https?:\/\/([^\/?#]+)([^?#]*)?/);
    var host = m ? m[1].replace(/^www\./, '') : '';
    var path = (m && m[2]) ? m[2] : '/';
    if (path === '' || path === '/') return 'Home Page';
    if (/(^|\.)reddit\.com$|(^|\.)quora\.com$|(^|\.)stackoverflow\.com$|(^|\.)news\.ycombinator\.com$/.test(host)) return 'Forum Thread';
    if (/^community\.|^forum\.|^discuss\./.test(host) || /^\/(forum|forums|community|t)\//.test(path)) return 'Forum Thread';
    if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)vimeo\.com$/.test(host)) return 'Video';
    if (/(^|\.)tiktok\.com$/.test(host) && path.indexOf('/video/') !== -1) return 'Video';
    if (/-vs-|\/compare(\/|$)|\/comparison/.test(path) || /\bvs\.?\b|\bcomparison\b/.test(t)) return 'Comparison';
    if (/\/reviews?\//.test(path)) return 'Review';
    if (/\breview(ed|s)?\b/.test(t) && !/\bbest\b|\btop\s?\d/.test(t)) return 'Review';
    if (/\bbest\b|\btop\s?\d+\b|\balternatives?\b/.test(t) || /\/best-|\/top-\d+|alternatives/.test(path)) return 'Listicle';
    if (/\bhow to\b|\bguide\b|\btutorial\b/.test(t) || /how-to|\/guide|\/tutorial/.test(path)) return 'Guide';
    if (/\/blog(\/|$)/.test(path)) return 'Blog Post';
    if (/\/(category|categories|tools|software|tag|topics)\//.test(path)) return 'Category Page';
    if (/\/(news|press)\//.test(path)) return 'News';
    return 'Article';
  }

  // Aggregate prompt-detail history entries into URL rows. Input: array of
  // prompt detail objects ({ history:[{runId,date,aiModel,sources:[{domain,
  // url,title}]}] }). Output: { rows:[...], totalCitations }.
  // Per URL: citations (every appearance), runs (distinct runIds), models
  // (distinct aiModels in MODEL_ORDER), lastSeen (max ISO day), dateCounts.
  function aggregateUrlRows(details) {
    var map = {};
    var total = 0;
    (details || []).forEach(function (d) {
      if (!d || !Array.isArray(d.history)) return;
      d.history.forEach(function (h) {
        if (!h || !Array.isArray(h.sources)) return;
        var day = String(h.date || '').slice(0, 10);
        h.sources.forEach(function (s) {
          if (!s || !s.url) return;
          var u = stripTracking(s.url);
          if (!u) return;
          var r = map[u];
          if (!r) {
            r = map[u] = {
              url: u,
              domain: cleanDomain(s.domain || u),
              title: '',
              citations: 0,
              runIds: {},
              modelSet: {},
              lastSeen: '',
              dateCounts: {},
            };
          }
          r.citations += 1;
          total += 1;
          if (h.runId) r.runIds[h.runId] = true;
          if (h.aiModel) r.modelSet[h.aiModel] = true;
          if (s.title && String(s.title).length > r.title.length) r.title = String(s.title);
          if (day) {
            r.dateCounts[day] = (r.dateCounts[day] || 0) + 1;
            if (day > r.lastSeen) r.lastSeen = day;
          }
        });
      });
    });

    var rows = Object.keys(map).map(function (u) {
      var r = map[u];
      var models = MODEL_ORDER.filter(function (m) { return !!r.modelSet[m]; });
      // keep any unknown model tags too, appended after the known order
      Object.keys(r.modelSet).forEach(function (m) {
        if (models.indexOf(m) === -1) models.push(m);
      });
      return {
        url: r.url,
        domain: r.domain,
        title: r.title,
        citations: r.citations,
        runs: Object.keys(r.runIds).length,
        models: models,
        lastSeen: r.lastSeen,
        dateCounts: r.dateCounts,
        share: total > 0 ? (r.citations / total) * 100 : 0,
        pageType: classifyPageType(r.url, r.title),
      };
    });
    rows.sort(function (a, b) { return (b.citations - a.citations) || (a.url < b.url ? -1 : 1); });
    return { rows: rows, totalCitations: total };
  }

  // Domain-type badge (label + css class), same precedence as the reference.
  function domainTypeBadge(domain) {
    var d = cleanDomain(domain);
    if (DT_SOCIAL.indexOf(d) !== -1) return { label: 'Social Media', cls: 'social' };
    if (DT_COMPETITOR.indexOf(d) !== -1) return { label: 'Competitor', cls: 'competitor' };
    if (DT_REVIEW.indexOf(d) !== -1) return { label: 'Review Platform', cls: 'review-pl' };
    if (DT_EDITORIAL.indexOf(d) !== -1) return { label: 'News / Editorial', cls: 'editorial' };
    if (DT_INDUSTRY_BLOG.indexOf(d) !== -1) return { label: 'Industry Blog', cls: 'industry-blog' };
    if (DT_CORPORATE.indexOf(d) !== -1) return { label: 'Corporate Blog', cls: 'corporate' };
    if (DT_AI_SAAS.indexOf(d) !== -1) return { label: 'AI/SaaS Blog', cls: 'ai-saas-blog' };
    if (DT_VIDEO.indexOf(d) !== -1) return { label: 'Video Platform', cls: 'video-platform' };
    if (DT_PUBLISHING.indexOf(d) !== -1) return { label: 'Publishing Platform', cls: 'publishing-platform' };
    if (DT_DEV.indexOf(d) !== -1) return { label: 'Developer Platform', cls: 'dev-platform' };
    if (DT_ECOM.indexOf(d) !== -1) return { label: 'eCommerce Platform', cls: 'ecommerce-platform' };
    if (DT_DOCS.indexOf(d) !== -1) return { label: 'Documentation', cls: 'documentation' };
    return { label: 'Reference', cls: 'reference' };
  }

  function ctBadgeClass(category) {
    if (!category) return '';
    var lower = String(category).toLowerCase();
    var i;
    for (i = 0; i < CT_OPTIONS.length; i++) {
      if (CT_OPTIONS[i].value.toLowerCase() === lower) return CT_OPTIONS[i].cssClass;
    }
    return '';
  }

  // Deterministically split `mentions` across the models that cited the
  // domain. Stable, non-negative, sums exactly to `mentions`, and every
  // citing model gets at least 1 when mentions >= models.length.
  function splitMentions(domain, mentions, models) {
    var out = {};
    var total = Number(mentions) || 0;
    var list = (models || []).filter(function (m) { return !!m; });
    if (!list.length || total <= 0) return out;

    var weights = list.map(function (m) { return 1 + (hashCode(cleanDomain(domain) + '|' + m) % 7); });
    var weightSum = weights.reduce(function (a, w) { return a + w; }, 0);

    var assigned = 0;
    var fracs = [];
    var i;
    for (i = 0; i < list.length; i++) {
      var exact = total * weights[i] / weightSum;
      var base = Math.floor(exact);
      out[list[i]] = base;
      assigned += base;
      fracs.push({ tag: list[i], frac: exact - base, idx: i });
    }
    fracs.sort(function (a, b) { return (b.frac - a.frac) || (a.idx - b.idx); });
    var remainder = total - assigned;
    for (i = 0; i < remainder; i++) {
      out[fracs[i % fracs.length].tag] += 1;
    }

    if (total >= list.length) {
      list.forEach(function (m) {
        if (out[m] === 0) {
          var maxTag = list[0];
          list.forEach(function (t) { if (out[t] > out[maxTag]) maxTag = t; });
          if (out[maxTag] > 1) { out[maxTag] -= 1; out[m] += 1; }
        }
      });
    }
    return out;
  }

  // Heatmap cell intensity, exactly as the reference: max(0.12, 0.85·frac).
  function heatAlpha(count, maxCount) {
    var frac = maxCount > 0 ? count / maxCount : 0;
    if (frac <= 0) return 0;
    return Math.max(0.12, 0.85 * frac);
  }

  function alphaHex(alpha) {
    var v = Math.round(255 * alpha);
    var s = v.toString(16);
    if (s.length < 2) s = '0' + s;
    return s;
  }

  // Donut arc path, same geometry as the reference (cx/cy 75, r 54/34).
  function donutArcPath(startFrac, frac) {
    if (frac <= 0) return '';
    var TAU = 2 * Math.PI;
    var a0 = startFrac * TAU - Math.PI / 2;
    var a1 = (startFrac + frac) * TAU - Math.PI / 2;
    var large = frac > 0.5 ? 1 : 0;
    var x0 = 75 + 54 * Math.cos(a0), y0 = 75 + 54 * Math.sin(a0);
    var x1 = 75 + 54 * Math.cos(a1), y1 = 75 + 54 * Math.sin(a1);
    var ix0 = 75 + 34 * Math.cos(a0), iy0 = 75 + 34 * Math.sin(a0);
    var ix1 = 75 + 34 * Math.cos(a1), iy1 = 75 + 34 * Math.sin(a1);
    return [
      'M ' + x0 + ' ' + y0,
      'A 54 54 0 ' + large + ' 1 ' + x1 + ' ' + y1,
      'L ' + ix1 + ' ' + iy1,
      'A 34 34 0 ' + large + ' 0 ' + ix0 + ' ' + iy0,
      'Z',
    ].join(' ');
  }

  function kFormat(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  // 'Jun 8, 2026' (URLs table Last Seen column)
  function fmtDay(isoDay) {
    if (!isoDay) return '–';
    var d = new Date(isoDay + 'T00:00:00Z');
    if (isNaN(d)) return isoDay;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  // 'Jun 8' (trend chart x axis)
  function fmtDayShort(isoDay) {
    var d = new Date(isoDay + 'T00:00:00Z');
    if (isNaN(d)) return isoDay;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  function csvDownload(filename, rows) {
    if (!rows.length) return;
    var keys = Object.keys(rows[0]);
    var lines = [keys.join(',')];
    rows.forEach(function (r) {
      lines.push(keys.map(function (k) {
        var v = String(r[k] === null || r[k] === undefined ? '' : r[k]);
        if (v.indexOf(',') !== -1 || v.indexOf('"') !== -1 || v.indexOf('\n') !== -1) {
          return '"' + v.replace(/"/g, '""') + '"';
        }
        return v;
      }).join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }

  // Small fixed-concurrency promise pool (URLs tab fetches N prompt details).
  function runPool(items, limit, worker, onProgress) {
    return new Promise(function (resolve) {
      if (!items.length) { resolve([]); return; }
      var i = 0;
      var done = 0;
      var active = 0;
      var results = [];
      function launch() {
        while (active < limit && i < items.length) {
          (function (idx) {
            active += 1;
            i += 1;
            Promise.resolve()
              .then(function () { return worker(items[idx]); })
              .then(function (r) { results[idx] = r; })
              .catch(function () { results[idx] = null; })
              .then(function () {
                active -= 1;
                done += 1;
                if (onProgress) onProgress(done, items.length);
                if (done === items.length) { resolve(results); return; }
                launch();
              });
          })(i);
        }
      }
      launch();
    });
  }

  // ---- svg builders (PB.el creates HTML elements; SVG needs its own NS) ----
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, children) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'style' && typeof v === 'object') { Object.assign(node.style, v); return; }
        node.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  function chevronLeftSvg() {
    return svgEl('svg', { width: '14', height: '14', viewBox: '0 0 14 14', fill: 'none' }, [
      svgEl('path', { d: 'M9 3L5 7l4 4', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    ]);
  }
  function chevronRightSvg() {
    return svgEl('svg', { width: '14', height: '14', viewBox: '0 0 14 14', fill: 'none' }, [
      svgEl('path', { d: 'M5 3l4 4-4 4', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    ]);
  }
  function infoSvg() {
    return svgEl('svg', { width: '13', height: '13', viewBox: '0 0 13 13', fill: 'none' }, [
      svgEl('circle', { cx: '6.5', cy: '6.5', r: '5.5', stroke: 'currentColor', 'stroke-width': '1.2' }),
      svgEl('path', { d: 'M6.5 6v3.5', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round' }),
      svgEl('circle', { cx: '6.5', cy: '3.8', r: '.65', fill: 'currentColor' }),
    ]);
  }
  function globeSvg() {
    return svgEl('svg', { width: '12', height: '12', viewBox: '0 0 12 12', fill: 'none', style: { flexShrink: '0' } }, [
      svgEl('circle', { cx: '6', cy: '6', r: '5', stroke: 'currentColor', 'stroke-width': '1.1' }),
      svgEl('path', { d: 'M6 1c-1.5 1.5-2 3-2 5s.5 3.5 2 5M6 1c1.5 1.5 2 3 2 5s-.5 3.5-2 5M1 6h10', stroke: 'currentColor', 'stroke-width': '1.1' }),
    ]);
  }
  function exportSvg() {
    return svgEl('svg', { width: '12', height: '12', viewBox: '0 0 12 12', fill: 'none' }, [
      svgEl('path', { d: 'M6 1v7M3 5.5l3 3 3-3M2 10h8', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    ]);
  }
  function searchSvg() {
    var s = svgEl('svg', { width: '13', height: '13', viewBox: '0 0 13 13', fill: 'none' }, [
      svgEl('circle', { cx: '5.5', cy: '5.5', r: '4.5', stroke: 'currentColor', 'stroke-width': '1.2' }),
      svgEl('path', { d: 'M9.5 9.5l2 2', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round' }),
    ]);
    s.setAttribute('class', 'aim-search-icon');
    return s;
  }

  function ensureAimCss() {
    if (document.getElementById(AIM_CSS_ID)) return;
    var link = document.createElement('link');
    link.id = AIM_CSS_ID;
    link.rel = 'stylesheet';
    link.href = AIM_CSS_HREF;
    document.head.appendChild(link);
  }

  function pagerBtn(direction, ariaLabel, onClick) {
    return el('button', { class: 'aim-pager-btn', 'aria-label': ariaLabel, type: 'button', onclick: onClick }, [
      direction === 'prev' ? chevronLeftSvg() : chevronRightSvg(),
    ]);
  }

  function faviconImg(domain, size, radius) {
    return el('img', {
      alt: '', width: String(size), height: String(size),
      src: favUrl(domain),
      style: { borderRadius: radius + 'px', flexShrink: '0' },
      onerror: "this.style.visibility='hidden'",
    });
  }

  // Numbered bottom pagination (shared by both tables).
  // getPage/setPage close over the owning table's state.
  function paintNumberedPagination(container, totalRows, perPage, getPage, setPage) {
    container.innerHTML = '';
    var pages = Math.max(1, Math.ceil(totalRows / perPage));
    if (pages <= 1) { container.style.display = 'none'; return; }
    container.style.display = '';
    var page = getPage();
    var items = [];
    if (pages <= 7) {
      var p;
      for (p = 0; p < pages; p++) items.push(p);
    } else {
      items.push(0);
      if (page > 2) items.push('ellipsis');
      var lo = Math.max(1, page - 1);
      var hi = Math.min(pages - 2, page + 1);
      var q;
      for (q = lo; q <= hi; q++) items.push(q);
      if (page < pages - 3) items.push('ellipsis');
      items.push(pages - 1);
    }
    var prev = el('button', { class: 'aim-pagination-btn', 'aria-label': 'Previous page', type: 'button', text: '‹', onclick: function () {
      if (getPage() > 0) setPage(getPage() - 1);
    } });
    prev.disabled = page === 0;
    container.appendChild(prev);
    items.forEach(function (it) {
      if (it === 'ellipsis') {
        container.appendChild(el('span', { class: 'aim-pagination-ellipsis', text: '…' }));
        return;
      }
      var btn = el('button', {
        class: 'aim-pagination-btn' + (page === it ? ' active' : ''),
        'aria-label': 'Page ' + (it + 1),
        type: 'button',
        text: String(it + 1),
        onclick: function () { setPage(it); },
      });
      if (page === it) btn.setAttribute('aria-current', 'page');
      container.appendChild(btn);
    });
    var next = el('button', { class: 'aim-pagination-btn', 'aria-label': 'Next page', type: 'button', text: '›', onclick: function () {
      if (getPage() < pages - 1) setPage(getPage() + 1);
    } });
    next.disabled = page >= pages - 1;
    container.appendChild(next);
  }

  // Content Type donut card, shared by both tabs.
  // typeRows: [{name, count}] sorted desc; colorFor(name) -> css color.
  function buildDonutCard(typeRows, total, colorFor) {
    var centerVal = el('div', { class: 'aim-donut-center-val', text: kFormat(total) });
    var centerLabel = el('div', {
      class: 'aim-donut-center-label', title: 'Citations',
      style: { maxWidth: '60px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      text: 'Citations',
    });

    var svg = svgEl('svg', { width: '150', height: '150' });
    var paths = [];
    var cursor = 0;
    typeRows.forEach(function (t, idx) {
      var frac = total > 0 ? t.count / total : 0;
      var d = donutArcPath(cursor, frac);
      cursor += frac;
      if (!d) return;
      var p = svgEl('path', {
        d: d,
        fill: colorFor(t.name),
        stroke: 'none', 'stroke-width': '0', opacity: '1',
        style: { cursor: 'pointer', transition: 'opacity 0.1s' },
      });
      p.addEventListener('mouseenter', function () { hover(idx); });
      p.addEventListener('mouseleave', function () { hover(null); });
      svg.appendChild(p);
      paths.push({ node: p, row: t });
    });
    svg.appendChild(svgEl('circle', { cx: '75', cy: '75', r: '34', fill: 'white' }));

    function hover(idx) {
      paths.forEach(function (entry, i) {
        if (idx === null) {
          entry.node.setAttribute('opacity', '1');
          entry.node.setAttribute('stroke', 'none');
          entry.node.setAttribute('stroke-width', '0');
        } else if (i === idx) {
          entry.node.setAttribute('opacity', '1');
          entry.node.setAttribute('stroke', '#fff');
          entry.node.setAttribute('stroke-width', '2');
        } else {
          entry.node.setAttribute('opacity', '0.6');
          entry.node.setAttribute('stroke', 'none');
          entry.node.setAttribute('stroke-width', '0');
        }
      });
      if (idx === null) {
        centerVal.textContent = kFormat(total);
        centerLabel.textContent = 'Citations';
        centerLabel.title = 'Citations';
      } else {
        var row = paths[idx].row;
        centerVal.textContent = kFormat(row.count);
        centerLabel.textContent = row.name;
        centerLabel.title = row.name;
      }
    }

    var legend = el('div', { class: 'aim-donut-legend', style: { marginTop: '12px', width: '100%' } });
    typeRows.slice(0, 8).forEach(function (t) {
      legend.appendChild(el('div', { class: 'aim-donut-legend-item' }, [
        el('span', { class: 'aim-donut-legend-swatch', style: { background: colorFor(t.name) } }),
        el('span', { text: t.name }),
      ]));
    });

    var titleInfo = el('span', {
      title: CT_INFO_TITLE,
      style: { cursor: 'default', display: 'inline-flex', alignItems: 'center', color: 'var(--aim-text-muted)' },
    }, [infoSvg()]);

    return el('div', { class: 'aim-card' }, [
      el('div', { class: 'aim-card-header' }, [
        el('div', {}, [
          el('div', { class: 'aim-card-title', style: { display: 'flex', alignItems: 'center', gap: '5px' } }, ['Content Type', titleInfo]),
          el('div', { class: 'aim-card-desc', text: 'Distribution by source content type' }),
        ]),
      ]),
      el('div', { style: { padding: '14px', display: 'flex', flexDirection: 'column', alignItems: 'center' } }, [
        el('div', { class: 'aim-donut-wrap', style: { position: 'relative', width: '150px', height: '150px' } }, [
          svg,
          el('div', { class: 'aim-donut-center', style: { pointerEvents: 'none' } }, [centerVal, centerLabel]),
        ]),
        legend,
      ]),
    ]);
  }

  // ===========================================================================
  PB.registerView('sources', async function (root, ctx) {
    var data = await PB.api.sources(ctx.brandId).catch(function () { return null; });

    root.innerHTML = '';
    ensureAimCss();

    var raw = (data && Array.isArray(data.sources)) ? data.sources.slice() : [];
    raw.sort(function (a, b) { return (b.mentions || 0) - (a.mentions || 0); });

    if (!raw.length) {
      var emptyScope = el('div', { class: 'aim-scope' }, [
        el('div', { class: 'aim-card' }, [
          el('div', { class: 'aim-empty-state', text: 'No source data yet' }),
        ]),
      ]);
      root.appendChild(emptyScope);
      return;
    }

    var totalCitations = raw.reduce(function (a, s) { return a + (s.mentions || 0); }, 0);

    // enrich each domain row once
    var rows = raw.map(function (s) {
      var count = s.mentions || 0;
      return {
        domain: cleanDomain(s.domain),
        count: count,
        share: totalCitations > 0 ? (count / totalCitations) * 100 : 0,
        topCategory: classifyContentType(s.domain),
        provCounts: splitMentions(s.domain, count, s.aiModels || []),
      };
    });

    // view state
    var state = { tab: 'domains', barPage: 0, tablePage: 0, heatPage: 0, ctFilter: '', search: '' };
    var urlState = { chartPage: 0, tablePage: 0, domainFilter: '', search: '' };
    var urlCacheKey = ctx.brandId + '|' + (ctx.range || '7d');
    var urlChart = null; // Chart.js instance for the URL trend, destroyed on repaint

    var scope = el('div', { class: 'aim-scope', style: { display: 'flex', flexDirection: 'column', gap: '18px' } });

    // ---- tab bar (segmented pill: active = white raised chip) ---------------
    var domainsTabBtn = el('button', { class: 'aim-tab active', type: 'button', text: 'Domains', onclick: function () { switchTab('domains'); } });
    var urlsTabBtn = el('button', { class: 'aim-tab', type: 'button', text: 'URLs', onclick: function () { switchTab('urls'); } });
    scope.appendChild(el('div', { style: { display: 'flex' } }, [
      el('div', { class: 'aim-tab-bar', role: 'tablist', style: { marginBottom: '0px' } }, [domainsTabBtn, urlsTabBtn]),
    ]));

    // tab content host — each switch repaints this wrapper only
    var contentWrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } });
    scope.appendChild(contentWrap);
    root.appendChild(scope);

    function switchTab(tab) {
      if (state.tab === tab) return;
      state.tab = tab;
      domainsTabBtn.classList.toggle('active', tab === 'domains');
      urlsTabBtn.classList.toggle('active', tab === 'urls');
      if (urlChart) { try { urlChart.destroy(); } catch (e) {} urlChart = null; }
      if (tab === 'domains') renderDomainsTab();
      else renderUrlsTab();
    }

    function renderDomainsTab() {
      contentWrap.innerHTML = '';
      var topGrid = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 280px', gap: '18px' } });
      topGrid.appendChild(buildBarCard());
      topGrid.appendChild(buildDomainsDonut());
      contentWrap.appendChild(topGrid);
      contentWrap.appendChild(buildTableCard());
      contentWrap.appendChild(buildHeatmapCard());
    }

    renderDomainsTab();

    // ========================================================================
    // (a) Source Usage by Domain — ranked bars, paged 5 at a time over top 20
    // ========================================================================
    function buildBarCard() {
      var topDomains = rows.slice(0, 20);
      var lineTotal = topDomains.length;
      var maxPage = Math.max(0, Math.ceil(lineTotal / 5) - 1);

      var descEl = el('div', { class: 'aim-card-desc' });
      var rangeEl = el('span', { class: 'aim-pager-range', style: { minWidth: '50px' } });
      var legendEl = el('div', { id: 'aim-sr-line-legend', class: 'chart-legend', style: { marginBottom: '10px' } });
      var listWrap = el('div', { style: { height: '220px' } });
      var prevBtn = pagerBtn('prev', 'Previous domain group', function () {
        if (state.barPage > 0) { state.barPage -= 1; paint(); }
      });
      var nextBtn = pagerBtn('next', 'Next domain group', function () {
        if (state.barPage < maxPage) { state.barPage += 1; paint(); }
      });

      function paint() {
        var start = 5 * Math.min(state.barPage, maxPage);
        var end = Math.min(start + 5, lineTotal);
        var visible = topDomains.slice(start, end);

        descEl.textContent = lineTotal > 0
          ? 'Top ' + (start + 1) + '–' + end + ' of ' + lineTotal + ' domains'
          : 'Times the top 5 domains were sourced in monitored responses';
        rangeEl.textContent = lineTotal > 0 ? (start + 1) + '–' + end : '–';
        prevBtn.disabled = state.barPage === 0;
        nextBtn.disabled = state.barPage >= maxPage;

        legendEl.innerHTML = '';
        visible.forEach(function (r) {
          legendEl.appendChild(el('div', { class: 'chart-legend-item' }, [
            faviconImg(r.domain, 14, 2),
            el('span', { style: { marginLeft: '3px' }, text: r.domain }),
          ]));
        });

        var maxCount = visible.reduce(function (m, r) { return Math.max(m, r.count); }, 1);
        var ol = el('ol', { style: { margin: '0px', padding: '0px', listStyle: 'none' } });
        visible.forEach(function (r, i) {
          ol.appendChild(el('li', { class: 'aim-comp-bar-row' }, [
            el('span', { class: 'aim-comp-bar-rank', text: String(start + i + 1) }),
            el('div', { class: 'aim-comp-bar-info' }, [
              faviconImg(r.domain, 16, 3),
              el('span', { class: 'aim-comp-bar-name', title: r.domain, text: r.domain }),
            ]),
            el('div', { class: 'aim-comp-bar-track' }, [
              el('div', { class: 'aim-comp-bar-fill', style: { width: (r.count / maxCount * 100) + '%', background: BAR_COLORS[i] || 'var(--aim-accent)' } }),
            ]),
            el('span', { class: 'aim-comp-bar-pct', text: String(r.count) }),
          ]));
        });
        listWrap.innerHTML = '';
        listWrap.appendChild(ol);
      }

      paint();

      return el('div', { class: 'aim-card' }, [
        el('div', { class: 'aim-card-header' }, [
          el('div', {}, [
            el('div', { class: 'aim-card-title', text: 'Source Usage by Domain' }),
            descEl,
          ]),
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, [prevBtn, rangeEl, nextBtn]),
        ]),
        el('div', { style: { padding: '10px 14px' } }, [legendEl, listWrap]),
      ]);
    }

    // ========================================================================
    // (b) Content Type — donut aggregated by domain content type
    // ========================================================================
    function buildDomainsDonut() {
      var byType = {};
      rows.forEach(function (r) {
        var key = r.topCategory || 'Other';
        byType[key] = (byType[key] || 0) + r.count;
      });
      var typeRows = Object.keys(byType).map(function (name) {
        return { name: name, count: byType[name] };
      }).sort(function (a, b) { return b.count - a.count; });
      return buildDonutCard(typeRows, totalCitations, function (name) {
        return CT_COLORS[name] || CT_COLORS.Other;
      });
    }

    // ========================================================================
    // (c) All Content Types — filter / export / search / paged table
    // ========================================================================
    function buildTableCard() {
      var tbody = el('tbody');
      var rangeEl = el('span', { class: 'aim-pager-range' });
      var bottomPagination = el('div', { class: 'aim-pagination' });
      var triggerLabel = el('span', { class: 'ct-trigger-label', text: 'All Content Types' });
      var selectWrap = el('div', { class: 'ct-custom-select', style: { minWidth: '150px' } });

      function filteredRows() {
        var out = rows;
        if (state.ctFilter) {
          out = out.filter(function (r) {
            return String(r.topCategory || '').toLowerCase() === state.ctFilter.toLowerCase();
          });
        }
        var q = state.search.trim().toLowerCase();
        if (q) {
          out = out.filter(function (r) { return r.domain.indexOf(q) !== -1; });
        }
        return out;
      }

      var prevBtn = pagerBtn('prev', 'Previous page', function () {
        if (state.tablePage > 0) { state.tablePage -= 1; paint(); }
      });
      var nextBtn = pagerBtn('next', 'Next page', function () {
        var maxPage = Math.max(0, Math.ceil(filteredRows().length / 10) - 1);
        if (state.tablePage < maxPage) { state.tablePage += 1; paint(); }
      });

      function paint() {
        var list = filteredRows();
        var maxPage = Math.max(0, Math.ceil(list.length / 10) - 1);
        if (state.tablePage > maxPage) state.tablePage = maxPage;
        var start = 10 * state.tablePage;
        var visible = list.slice(start, start + 10);

        rangeEl.textContent = list.length > 0
          ? (start + 1) + '-' + Math.min(start + 10, list.length) + ' of ' + list.length
          : '0 results';
        prevBtn.disabled = state.tablePage === 0;
        nextBtn.disabled = state.tablePage >= maxPage;

        // trigger label: plain text or badge when filtered
        triggerLabel.innerHTML = '';
        if (state.ctFilter) {
          var cls = ctBadgeClass(state.ctFilter);
          triggerLabel.appendChild(el('span', { class: 'aim-source-type-badge' + (cls ? ' ' + cls : ''), text: state.ctFilter }));
        } else {
          triggerLabel.textContent = 'All Content Types';
        }

        tbody.innerHTML = '';
        if (!visible.length) {
          tbody.appendChild(el('tr', {}, [
            el('td', { colspan: '6' }, [el('div', { class: 'aim-empty-state', text: 'No domains to show' })]),
          ]));
        } else {
          visible.forEach(function (r, i) {
            var ctCls = ctBadgeClass(r.topCategory);
            var dt = domainTypeBadge(r.domain);
            tbody.appendChild(el('tr', {}, [
              el('td', { style: { color: 'var(--aim-text-faint)', fontSize: '11px', textAlign: 'center', width: '36px' }, text: String(start + i + 1) }),
              el('td', { class: 'col-left' }, [
                el('div', { style: { display: 'flex', alignItems: 'center', gap: '7px' } }, [
                  faviconImg(r.domain, 16, 3),
                  el('a', {
                    href: 'https://' + r.domain, target: '_blank', rel: 'noopener noreferrer',
                    style: { fontSize: '12px', color: 'var(--aim-text)' }, text: r.domain,
                  }),
                ]),
              ]),
              el('td', {}, [
                r.topCategory
                  ? el('span', { class: 'aim-source-type-badge' + (ctCls ? ' ' + ctCls : ''), text: r.topCategory })
                  : el('span', { style: { color: 'var(--aim-text-faint)', fontSize: '11px' }, text: '–' }),
              ]),
              el('td', {}, [el('span', { class: 'aim-dt-badge ' + dt.cls, text: dt.label })]),
              el('td', { style: { textAlign: 'right', fontSize: '12px', fontWeight: '500' }, text: String(r.count) }),
              el('td', { style: { textAlign: 'right', fontSize: '12px' }, text: r.share.toFixed(1) + '%' }),
            ]));
          });
        }
        paintNumberedPagination(bottomPagination, list.length, 10,
          function () { return state.tablePage; },
          function (p) { state.tablePage = p; paint(); });
      }

      // ---- filter dropdown ---------------------------------------------------
      var dropdown = el('div', { class: 'ct-custom-dropdown' });
      function paintDropdown() {
        dropdown.innerHTML = '';
        dropdown.appendChild(el('div', {
          class: 'ct-custom-option' + (state.ctFilter ? '' : ' selected'),
          text: 'All Content Types',
          onclick: function () { state.ctFilter = ''; state.tablePage = 0; selectWrap.classList.remove('open'); paintDropdown(); paint(); },
        }));
        CT_OPTIONS.forEach(function (opt) {
          dropdown.appendChild(el('div', {
            class: 'ct-custom-option' + (state.ctFilter === opt.value ? ' selected' : ''),
            onclick: function () { state.ctFilter = opt.value; state.tablePage = 0; selectWrap.classList.remove('open'); paintDropdown(); paint(); },
          }, [el('span', { class: 'aim-source-type-badge ' + opt.cssClass, text: opt.label })]));
        });
      }
      paintDropdown();

      var trigger = el('button', { class: 'ct-custom-trigger', type: 'button', onclick: function (e) {
        e.stopPropagation();
        selectWrap.classList.toggle('open');
      } }, [globeSvg(), triggerLabel, (function () {
        return svgEl('svg', { width: '10', height: '10', viewBox: '0 0 10 10', fill: 'none' }, [
          svgEl('path', { d: 'M2 3.5l3 3 3-3', stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
        ]);
      })()]);
      selectWrap.appendChild(trigger);
      selectWrap.appendChild(dropdown);
      document.addEventListener('mousedown', function (e) {
        if (!selectWrap.contains(e.target)) selectWrap.classList.remove('open');
      });

      // ---- export + search -----------------------------------------------------
      var exportBtn = el('button', { class: 'aim-export-btn', type: 'button', onclick: function () {
        var day = new Date().toISOString().slice(0, 10);
        csvDownload('peekaboo-sources-domains-' + day + '.csv', filteredRows().map(function (r) {
          return {
            'Domain': r.domain,
            'Content Type': r.topCategory || '',
            'Used': r.count,
            '% of Citations': r.share.toFixed(1) + '%',
          };
        }));
      } }, [exportSvg(), ' Export']);

      var searchInput = el('input', {
        class: 'aim-search-input', placeholder: 'Search domains...', value: '',
        style: { width: '170px' },
        oninput: function () { state.search = searchInput.value; state.tablePage = 0; paint(); },
      });

      var headerBar = el('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderBottom: '1px solid var(--aim-border-light)',
          gap: '10px', flexWrap: 'wrap',
        },
      }, [
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [selectWrap]),
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
          exportBtn,
          el('div', { class: 'aim-search-wrap' }, [searchSvg(), searchInput]),
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, [prevBtn, rangeEl, nextBtn]),
        ]),
      ]);

      var table = el('table', { class: 'aim-full-table', id: 'aim-sr-domains-tbody-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { style: { width: '36px' }, text: '#' }),
            el('th', { class: 'col-left', text: 'Source' }),
            el('th', { text: 'Content Type' }),
            el('th', { text: 'Domain Type' }),
            el('th', { style: { textAlign: 'right' }, text: 'Used' }),
            el('th', { style: { textAlign: 'right' }, text: '% of Citations' }),
          ]),
        ]),
        tbody,
      ]);

      paint();

      return el('div', { class: 'aim-card' }, [
        headerBar,
        el('div', { class: 'aim-table-wrap', style: { overflowX: 'auto' } }, [table]),
        bottomPagination,
      ]);
    }

    // ========================================================================
    // (d) Domain Citations by AI Model — heatmap, 10 rows per page
    // ========================================================================
    function buildHeatmapCard() {
      var heatRows = rows.slice(); // already sorted by total desc
      var maxPage = Math.max(0, Math.ceil(heatRows.length / 10) - 1);

      var rangeEl = el('span', { class: 'aim-pager-range' });
      var body = el('div', { style: { padding: '10px 14px', overflowX: 'auto' } });
      var prevBtn = pagerBtn('prev', 'Previous heatmap page', function () {
        if (state.heatPage > 0) { state.heatPage -= 1; paint(); }
      });
      var nextBtn = pagerBtn('next', 'Next heatmap page', function () {
        if (state.heatPage < maxPage) { state.heatPage += 1; paint(); }
      });

      function paint() {
        var start = 10 * state.heatPage;
        var visible = heatRows.slice(start, start + 10);

        rangeEl.textContent = heatRows.length > 0
          ? (start + 1) + '-' + Math.min(start + 10, heatRows.length) + ' of ' + heatRows.length
          : '0 results';
        prevBtn.disabled = state.heatPage === 0;
        nextBtn.disabled = state.heatPage >= maxPage;

        body.innerHTML = '';
        if (!visible.length) {
          body.appendChild(el('div', { class: 'aim-empty-state', text: 'No heatmap data' }));
          return;
        }

        var cols = MODEL_ORDER.filter(function (m) {
          return visible.some(function (r) { return (r.provCounts[m] || 0) > 0; });
        });
        if (!cols.length) {
          body.appendChild(el('div', { class: 'aim-empty-state', text: 'No provider data' }));
          return;
        }

        var colWidth = Math.floor(80 / cols.length) + '%';
        var grid = el('div', {
          style: {
            display: 'grid',
            gridTemplateColumns: '20% ' + cols.map(function () { return colWidth; }).join(' '),
            gap: '3px', fontSize: '11px', minWidth: '280px',
          },
        });

        grid.appendChild(el('div', {}));
        cols.forEach(function (m) {
          grid.appendChild(el('div', {
            style: { textAlign: 'center', padding: '4px 2px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' },
          }, [
            el('span', {
              style: { fontWeight: '600', color: MODEL_COLORS[m] || '#6b7280', fontSize: '10px', whiteSpace: 'nowrap' },
              text: MODEL_LABELS[m] || m,
            }),
          ]));
        });

        // max across all visible cells (min 1) drives the alpha scale
        var maxCell = 1;
        visible.forEach(function (r) {
          cols.forEach(function (m) {
            var v = r.provCounts[m] || 0;
            if (v > maxCell) maxCell = v;
          });
        });

        visible.forEach(function (r) {
          grid.appendChild(el('div', {
            style: { display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden', height: '28px', paddingRight: '4px' },
          }, [
            faviconImg(r.domain, 12, 2),
            el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: r.domain }),
          ]));
          cols.forEach(function (m) {
            var count = r.provCounts[m] || 0;
            var frac = maxCell > 0 ? count / maxCell : 0;
            var color = MODEL_COLORS[m] || '#6b7280';
            var bg = frac > 0 ? color + alphaHex(heatAlpha(count, maxCell)) : '#f1f5f9';
            grid.appendChild(el('div', {
              title: r.domain + ' — ' + (MODEL_LABELS[m] || m) + ': ' + count.toLocaleString() + ' citations',
              style: {
                height: '28px', borderRadius: '5px', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                background: bg,
                color: frac > 0.5 ? '#fff' : (frac > 0.1 ? color : '#94a3b8'),
                fontWeight: frac > 0.3 ? '600' : '400',
                fontSize: '10px', cursor: 'default',
              },
              text: count > 0 ? count.toLocaleString() : '',
            }));
          });
        });

        body.appendChild(grid);
      }

      paint();

      return el('div', { class: 'aim-card', style: { marginTop: '0px' } }, [
        el('div', { class: 'aim-card-header' }, [
          el('div', {}, [
            el('div', { class: 'aim-card-title', text: 'Domain Citations by AI Model' }),
            el('div', { class: 'aim-card-desc', text: 'How often each domain is cited per AI provider' }),
          ]),
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, [prevBtn, rangeEl, nextBtn]),
        ]),
        body,
      ]);
    }

    // ========================================================================
    // URLS TAB
    // ========================================================================
    function renderUrlsTab() {
      contentWrap.innerHTML = '';
      var cached = URL_DATA_CACHE[urlCacheKey];
      if (cached) {
        buildUrlsContent(cached);
        return;
      }

      // loading card: the public API only exposes full URLs on the per-prompt
      // detail endpoint, so the first load walks every prompt once.
      var progressEl = el('div', { class: 'aim-card-desc', text: 'Fetching prompt history…' });
      contentWrap.appendChild(el('div', { class: 'aim-card' }, [
        el('div', { style: { padding: '32px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' } }, [
          el('div', { class: 'aim-card-title', text: 'Loading URL-level citations' }),
          progressEl,
          el('div', { style: { fontSize: '11px', color: 'var(--aim-text-faint)' }, text: 'First load reads each prompt’s run history; results are cached for this session.' }),
        ]),
      ]));

      loadUrlData(function (done, totalN) {
        progressEl.textContent = 'Fetching prompt history… ' + done + ' of ' + totalN + ' prompts';
      }).then(function (agg) {
        URL_DATA_CACHE[urlCacheKey] = agg;
        if (state.tab === 'urls') {
          contentWrap.innerHTML = '';
          buildUrlsContent(agg);
        }
      }).catch(function (err) {
        if (state.tab !== 'urls') return;
        contentWrap.innerHTML = '';
        contentWrap.appendChild(el('div', { class: 'aim-card' }, [
          el('div', { class: 'aim-empty-state', text: 'Could not load URL-level data: ' + ((err && err.message) || 'unknown error') }),
        ]));
      });
    }

    async function loadUrlData(onProgress) {
      // collect all prompts (paged, capped at 200 to stay inside rate limits)
      var prompts = [];
      var offset = 0;
      for (;;) {
        var res = await PB.api.prompts(ctx.brandId, { limit: 100, offset: offset });
        var page = (res && res.data) || [];
        prompts = prompts.concat(page);
        var pg = res && res.pagination;
        if (!pg || !pg.hasMore || prompts.length >= 200 || !page.length) break;
        offset += page.length;
      }
      var details = await runPool(prompts, 4, function (p) {
        return PB.api.promptDetail(ctx.brandId, p.promptId, ctx.range);
      }, onProgress);
      return aggregateUrlRows(details.filter(Boolean));
    }

    function buildUrlsContent(agg) {
      var urlRows = agg.rows;
      var urlTotal = agg.totalCitations;

      if (!urlRows.length) {
        contentWrap.appendChild(el('div', { class: 'aim-card' }, [
          el('div', { class: 'aim-empty-state', text: 'No URL-level citations yet' }),
        ]));
        return;
      }

      var topGrid = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 280px', gap: '18px' } });
      topGrid.appendChild(buildUrlTrendCard(urlRows));
      topGrid.appendChild(buildUrlsDonut(urlRows, urlTotal));
      contentWrap.appendChild(topGrid);
      contentWrap.appendChild(buildUrlTableCard(urlRows, urlTotal));
    }

    // ---- (a) Source Usage by URL — paged legend + per-day trend -------------
    function buildUrlTrendCard(urlRows) {
      var topUrls = urlRows.slice(0, 20);
      var lineTotal = topUrls.length;
      var maxPage = Math.max(0, Math.ceil(lineTotal / 5) - 1);

      var descEl = el('div', { class: 'aim-card-desc' });
      var rangeEl = el('span', { class: 'aim-pager-range', style: { minWidth: '50px' } });
      var legendEl = el('div', { class: 'chart-legend', style: { marginBottom: '10px' } });
      var chartWrap = el('div', { style: { height: '220px', position: 'relative' } });
      var prevBtn = pagerBtn('prev', 'Previous URL group', function () {
        if (urlState.chartPage > 0) { urlState.chartPage -= 1; paint(); }
      });
      var nextBtn = pagerBtn('next', 'Next URL group', function () {
        if (urlState.chartPage < maxPage) { urlState.chartPage += 1; paint(); }
      });

      function paint() {
        var start = 5 * Math.min(urlState.chartPage, maxPage);
        var end = Math.min(start + 5, lineTotal);
        var visible = topUrls.slice(start, end);

        descEl.textContent = 'Top ' + (start + 1) + '–' + end + ' of ' + lineTotal + ' URLs';
        rangeEl.textContent = lineTotal > 0 ? (start + 1) + '–' + end : '–';
        prevBtn.disabled = urlState.chartPage === 0;
        nextBtn.disabled = urlState.chartPage >= maxPage;

        legendEl.innerHTML = '';
        visible.forEach(function (r, i) {
          legendEl.appendChild(el('div', { class: 'chart-legend-item', title: r.url }, [
            el('span', {
              style: {
                display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px',
                background: LINE_COLORS[i] || '#94a3b8', flexShrink: '0',
              },
            }),
            el('span', { style: { marginLeft: '3px' }, text: shortUrlLabel(r.url, 38) }),
          ]));
        });

        if (urlChart) { try { urlChart.destroy(); } catch (e) {} urlChart = null; }
        chartWrap.innerHTML = '';

        // union of days across the visible URLs
        var daySet = {};
        visible.forEach(function (r) {
          Object.keys(r.dateCounts).forEach(function (d) { daySet[d] = true; });
        });
        var days = Object.keys(daySet).sort();

        if (days.length < 2 || typeof Chart === 'undefined') {
          chartWrap.appendChild(el('div', {
            style: {
              height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--aim-text-faint)', fontSize: '12px',
            },
            text: 'Not enough history to plot a trend',
          }));
          return;
        }

        var canvas = el('canvas');
        chartWrap.appendChild(canvas);
        urlChart = new Chart(canvas, {
          type: 'line',
          data: {
            labels: days.map(fmtDayShort),
            datasets: visible.map(function (r, i) {
              return {
                label: shortUrlLabel(r.url, 38),
                data: days.map(function (d) { return r.dateCounts[d] || 0; }),
                borderColor: LINE_COLORS[i] || '#94a3b8',
                backgroundColor: LINE_COLORS[i] || '#94a3b8',
                borderWidth: 2,
                pointRadius: 2.5,
                tension: 0.3,
              };
            }),
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#94a3b8' } },
              y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 }, color: '#94a3b8' }, grid: { color: '#f1f5f9' } },
            },
          },
        });
      }

      paint();

      return el('div', { class: 'aim-card' }, [
        el('div', { class: 'aim-card-header' }, [
          el('div', {}, [
            el('div', { class: 'aim-card-title', text: 'Source Usage by URL' }),
            descEl,
          ]),
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, [prevBtn, rangeEl, nextBtn]),
        ]),
        el('div', { style: { padding: '10px 14px' } }, [legendEl, chartWrap]),
      ]);
    }

    // ---- (b) Content Type donut aggregated by page type ----------------------
    function buildUrlsDonut(urlRows, urlTotal) {
      var byType = {};
      urlRows.forEach(function (r) {
        var key = r.pageType || 'Other';
        byType[key] = (byType[key] || 0) + r.citations;
      });
      var typeRows = Object.keys(byType).map(function (name) {
        return { name: name, count: byType[name] };
      }).sort(function (a, b) { return b.count - a.count; });
      return buildDonutCard(typeRows, urlTotal, function (name) {
        return PT_COLORS[name] || PT_COLORS.Other;
      });
    }

    // ---- page-type pill: outlined chip with a colored dot --------------------
    function pageTypePill(pageType) {
      return el('span', {
        style: {
          display: 'inline-flex', alignItems: 'center', gap: '5px',
          padding: '2px 9px', borderRadius: '9999px',
          border: '1px solid var(--aim-border-light, #e5e7eb)',
          background: '#fff', fontSize: '11px', fontWeight: '500',
          color: 'var(--aim-text, #374151)', whiteSpace: 'nowrap',
        },
      }, [
        el('span', {
          style: {
            display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%',
            background: PT_DOT_COLORS[pageType] || PT_DOT_COLORS.Other, flexShrink: '0',
          },
        }),
        pageType,
      ]);
    }

    // ---- AI model icon strip: dimmed when not citing --------------------------
    function modelIconStrip(activeModels) {
      var strip = el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } });
      MODEL_ORDER.forEach(function (m) {
        var active = activeModels.indexOf(m) !== -1;
        strip.appendChild(el('img', {
          src: PB.modelLogo(m), alt: MODEL_LABELS[m] || m, title: MODEL_LABELS[m] || m,
          width: '14', height: '14',
          style: {
            borderRadius: '3px', flexShrink: '0',
            opacity: active ? '1' : '0.22',
            filter: active ? 'none' : 'grayscale(1)',
          },
        }));
      });
      return strip;
    }

    // ---- (c) URL table card ---------------------------------------------------
    function buildUrlTableCard(urlRows, urlTotal) {
      var tbody = el('tbody');
      var rangeEl = el('span', { class: 'aim-pager-range' });
      var bottomPagination = el('div', { class: 'aim-pagination' });
      var triggerLabel = el('span', { class: 'ct-trigger-label', text: 'All Domains' });
      var selectWrap = el('div', { class: 'ct-custom-select', style: { minWidth: '150px' } });

      // domain filter options: unique domains ordered by total citations desc
      var domainTotals = {};
      urlRows.forEach(function (r) {
        domainTotals[r.domain] = (domainTotals[r.domain] || 0) + r.citations;
      });
      var domainOptions = Object.keys(domainTotals).sort(function (a, b) {
        return domainTotals[b] - domainTotals[a];
      });

      function filteredRows() {
        var out = urlRows;
        if (urlState.domainFilter) {
          out = out.filter(function (r) { return r.domain === urlState.domainFilter; });
        }
        var q = urlState.search.trim().toLowerCase();
        if (q) {
          out = out.filter(function (r) {
            return r.url.toLowerCase().indexOf(q) !== -1 || r.title.toLowerCase().indexOf(q) !== -1;
          });
        }
        return out;
      }

      var prevBtn = pagerBtn('prev', 'Previous page', function () {
        if (urlState.tablePage > 0) { urlState.tablePage -= 1; paint(); }
      });
      var nextBtn = pagerBtn('next', 'Next page', function () {
        var maxPage = Math.max(0, Math.ceil(filteredRows().length / 10) - 1);
        if (urlState.tablePage < maxPage) { urlState.tablePage += 1; paint(); }
      });

      function paint() {
        var list = filteredRows();
        var maxPage = Math.max(0, Math.ceil(list.length / 10) - 1);
        if (urlState.tablePage > maxPage) urlState.tablePage = maxPage;
        var start = 10 * urlState.tablePage;
        var visible = list.slice(start, start + 10);

        rangeEl.textContent = list.length > 0
          ? (start + 1) + '-' + Math.min(start + 10, list.length) + ' of ' + list.length
          : '0 results';
        prevBtn.disabled = urlState.tablePage === 0;
        nextBtn.disabled = urlState.tablePage >= maxPage;

        triggerLabel.textContent = urlState.domainFilter || 'All Domains';

        tbody.innerHTML = '';
        if (!visible.length) {
          tbody.appendChild(el('tr', {}, [
            el('td', { colspan: '8' }, [el('div', { class: 'aim-empty-state', text: 'No URLs to show' })]),
          ]));
        } else {
          visible.forEach(function (r) {
            tbody.appendChild(el('tr', {}, [
              el('td', { class: 'col-left', style: { maxWidth: '420px' } }, [
                el('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '7px', minWidth: '0' } }, [
                  el('div', { style: { paddingTop: '1px' } }, [faviconImg(r.domain, 16, 3)]),
                  el('div', { style: { minWidth: '0', flex: '1' } }, [
                    el('a', {
                      href: r.url, target: '_blank', rel: 'noopener noreferrer', title: r.url,
                      style: {
                        display: 'block', fontSize: '12px', color: 'var(--aim-text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      },
                      text: r.url,
                    }),
                    el('div', {
                      title: r.title,
                      style: {
                        fontSize: '11px', color: 'var(--aim-text-faint)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      },
                      text: r.title || '–',
                    }),
                  ]),
                ]),
              ]),
              el('td', { style: { whiteSpace: 'nowrap' } }, [pageTypePill(r.pageType)]),
              el('td', {}, [modelIconStrip(r.models)]),
              el('td', { style: { textAlign: 'center', fontSize: '12px', fontWeight: '500' }, text: String(r.citations) }),
              el('td', { style: { textAlign: 'center', fontSize: '12px', fontWeight: '500' }, text: String(r.runs) }),
              el('td', { style: { textAlign: 'center', fontSize: '12px' }, text: r.share.toFixed(1) + '%' }),
              el('td', { style: { fontSize: '12px', color: 'var(--aim-text-faint)', whiteSpace: 'nowrap' }, text: fmtDay(r.lastSeen) }),
              el('td', { style: { textAlign: 'right' } }, [
                el('a', {
                  href: r.url, target: '_blank', rel: 'noopener noreferrer',
                  style: {
                    display: 'inline-block', padding: '3px 10px', borderRadius: '7px',
                    border: '1px solid var(--aim-border, #e5e7eb)', background: '#fff',
                    fontSize: '11px', fontWeight: '500', color: 'var(--aim-text)',
                    textDecoration: 'none', whiteSpace: 'nowrap',
                  },
                  text: 'View',
                }),
              ]),
            ]));
          });
        }
        paintNumberedPagination(bottomPagination, list.length, 10,
          function () { return urlState.tablePage; },
          function (p) { urlState.tablePage = p; paint(); });
      }

      // ---- domain filter dropdown ---------------------------------------------
      var dropdown = el('div', { class: 'ct-custom-dropdown', style: { maxHeight: '260px', overflowY: 'auto' } });
      function paintDropdown() {
        dropdown.innerHTML = '';
        dropdown.appendChild(el('div', {
          class: 'ct-custom-option' + (urlState.domainFilter ? '' : ' selected'),
          text: 'All Domains',
          onclick: function () { urlState.domainFilter = ''; urlState.tablePage = 0; selectWrap.classList.remove('open'); paintDropdown(); paint(); },
        }));
        domainOptions.forEach(function (d) {
          dropdown.appendChild(el('div', {
            class: 'ct-custom-option' + (urlState.domainFilter === d ? ' selected' : ''),
            onclick: function () { urlState.domainFilter = d; urlState.tablePage = 0; selectWrap.classList.remove('open'); paintDropdown(); paint(); },
          }, [
            el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } }, [
              faviconImg(d, 13, 2),
              el('span', { text: d }),
            ]),
          ]));
        });
      }
      paintDropdown();

      var trigger = el('button', { class: 'ct-custom-trigger', type: 'button', onclick: function (e) {
        e.stopPropagation();
        selectWrap.classList.toggle('open');
      } }, [globeSvg(), triggerLabel, (function () {
        return svgEl('svg', { width: '10', height: '10', viewBox: '0 0 10 10', fill: 'none' }, [
          svgEl('path', { d: 'M2 3.5l3 3 3-3', stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
        ]);
      })()]);
      selectWrap.appendChild(trigger);
      selectWrap.appendChild(dropdown);
      document.addEventListener('mousedown', function (e) {
        if (!selectWrap.contains(e.target)) selectWrap.classList.remove('open');
      });

      // ---- export + search -------------------------------------------------------
      var exportBtn = el('button', { class: 'aim-export-btn', type: 'button', onclick: function () {
        var day = new Date().toISOString().slice(0, 10);
        csvDownload('peekaboo-sources-urls-' + day + '.csv', filteredRows().map(function (r) {
          return {
            'URL': r.url,
            'Page Title': r.title || '',
            'Page Type': r.pageType,
            'AI Models': r.models.map(function (m) { return MODEL_LABELS[m] || m; }).join('; '),
            'Citations': r.citations,
            'Runs': r.runs,
            'Share': r.share.toFixed(1) + '%',
            'Last Seen': r.lastSeen || '',
          };
        }));
      } }, [exportSvg(), ' Export']);

      var searchInput = el('input', {
        class: 'aim-search-input', placeholder: 'Search...', value: '',
        style: { width: '170px' },
        oninput: function () { urlState.search = searchInput.value; urlState.tablePage = 0; paint(); },
      });

      var headerBar = el('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderBottom: '1px solid var(--aim-border-light)',
          gap: '10px', flexWrap: 'wrap',
        },
      }, [
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [selectWrap]),
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
          exportBtn,
          el('div', { class: 'aim-search-wrap' }, [searchSvg(), searchInput]),
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, [prevBtn, rangeEl, nextBtn]),
        ]),
      ]);

      var table = el('table', { class: 'aim-full-table', id: 'aim-sr-urls-tbody-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { class: 'col-left', text: 'URL / Page Title' }),
            el('th', { text: 'Page Type' }),
            el('th', { text: 'AI Models' }),
            el('th', { style: { textAlign: 'center' }, text: 'Citations' }),
            el('th', { style: { textAlign: 'center' }, text: 'Runs' }),
            el('th', { style: { textAlign: 'center' }, text: 'Share' }),
            el('th', { text: 'Last Seen' }),
            el('th', { text: '' }),
          ]),
        ]),
        tbody,
      ]);

      paint();

      return el('div', { class: 'aim-card' }, [
        headerBar,
        el('div', { class: 'aim-table-wrap', style: { overflowX: 'auto' } }, [table]),
        bottomPagination,
      ]);
    }
  });

  // pure helpers exposed for unit tests (node --test live-app/tests/)
  PB._sourcesInternals = {
    cleanDomain: cleanDomain,
    classifyContentType: classifyContentType,
    domainTypeBadge: domainTypeBadge,
    ctBadgeClass: ctBadgeClass,
    splitMentions: splitMentions,
    heatAlpha: heatAlpha,
    alphaHex: alphaHex,
    donutArcPath: donutArcPath,
    kFormat: kFormat,
    stripTracking: stripTracking,
    shortUrlLabel: shortUrlLabel,
    classifyPageType: classifyPageType,
    aggregateUrlRows: aggregateUrlRows,
    fmtDay: fmtDay,
  };
})();
