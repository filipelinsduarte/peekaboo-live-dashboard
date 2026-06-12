/*
 * prompt-detail.js — Prompt DETAIL drill-down (live, matches /prompts/:id).
 *
 * Exposed as window.PBPromptDetail(root, ctx) and invoked from prompts.js when
 * the router sets ctx.param to a promptId (hash #/prompts/:id). Loaded before
 * boot so prompts.js can call it.
 *
 * Page layout: pixel-faithful port of the v4 prompt detail page
 * (~/Desktop/ai-monitoring-dashboard-v4.html, aimOpenPromptDetail lines
 * 7303-7494 + CSS at 944-961, 963-988, 1003-1010, 1083-1091):
 *   - back button ("Back to Prompts")
 *   - header card: prompt text, topic + intent badges, frequency/last-run
 *     caption, stats row (Visibility / Sentiment / Avg Position / Run days)
 *     plus Top Brands + Top Citations icon clusters.
 *   - "Response History" section: one collapsible section per run date
 *     (newest first, only the latest expanded) with a 7-column table:
 *     Model | Response Preview | Sentiment | Visibility | Avg Position |
 *     Mentions | Citations. Each data row opens the full-answer modal.
 *
 * Adaptations from v4 to the live API:
 *   - Data is detail.history[] from PB.api.promptDetail(.., full=true), not
 *     window._aimPromptResponseHistory. Dates and per-model rows are grouped
 *     from history[] (groupRunsByDate).
 *   - Model badges use PB.modelLogo/PB.modelLabel for the live model slugs.
 *   - brandMentions entries carry NO domain field, so mention icons resolve
 *     entity names through entityDomainMap (the brand's own url from
 *     PB.state.brands + tracked competitor urls from PB.api.competitors,
 *     same mechanism as the competitors view's urlByName); entities that do
 *     not resolve keep the deterministic letter avatar (the v4 aimBrandIcon
 *     fallback path). We never guess domain URLs. Citation icons use real
 *     domains via PB.favicon(sources[].domain).
 *   - "No data for this date" filler rows are shown for models that ran on
 *     other dates of this prompt (consistent model set across sections), not
 *     a hardcoded provider list.
 *   - frequency in the caption comes from the brand's analysisFrequency in
 *     PB.state.brands; omitted when unknown.
 *
 * Full-answer modal: pixel-faithful port of the v4 response modal
 * (~/Desktop/ai-monitoring-dashboard-v4.html, #aim-response-modal /
 * aimOpenResponseModal / aimFormatAnswer, lines 5191-5223, 7515-7606,
 * 1093-1202). Adaptations:
 *   - Data comes from the run entry in history[] (fullResponse, sources,
 *     brandMentions) instead of window._aimChatStore.
 *   - CSS injected once as <style id="pb-prompt-modal-css">, scoped under
 *     .pb-rm-scope so nothing leaks into other views (same pattern as
 *     todos.js / injectTodosCSS, including the v4 design-token block).
 *     Page CSS is a sibling <style id="pb-prompt-page-css"> scoped under
 *     .pb-pd-scope.
 *   - Escape key + scroll lock added (the live SPA convention); v4 only had
 *     backdrop click and the close button.
 *   - Note: v4 applies NO brand highlighting inside the response text (bold
 *     names come from the model's own **markdown**). highlightMentions() is
 *     still implemented and exposed as pure logic for tests / future use.
 *
 * Pure logic (escapeHtml, normalizeSpaces, highlightMentions, formatAnswer,
 * responseTextFor, groupRunsByDate, dateAggregates, topEntities, previewText,
 * letterAvatarColor) is exposed as window.PBPromptDetailLogic so it can be
 * unit-tested with node (tests/prompt-detail.logic.test.mjs), same pattern
 * as PBTodosLogic.
 */
(function () {
  'use strict';
  if (!window.PB) return;
  var el = PB.el, fmt = PB.fmt;

  // ══════════════════════════════════════════════════════════════════════════
  // Pure logic (no DOM) — exposed on window.PBPromptDetailLogic for tests.
  // ══════════════════════════════════════════════════════════════════════════

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Normalize whitespace artifacts in raw API text BEFORE escaping:
  // non-breaking-space characters (U+00A0), literal "&nbsp;" strings, and
  // Windows line endings. Mirrors the v4 aimFormatAnswer normalization.
  function normalizeSpaces(s) {
    if (s === null || s === undefined) return '';
    var t = String(s);
    t = t.replace(/\u00a0/g, ' ');
    t = t.replace(/&nbsp;/g, ' ');
    t = t.replace(/\r\n/g, '\n');
    t = t.replace(/\r/g, '\n');
    return t;
  }

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  var HL_OPEN = '<span class="pb-rm-hl">';
  var HL_CLOSE = '</span>';

  // Wraps exact entity-name matches in an already-HTML-escaped text.
  // Longest names are applied first and shorter names never re-wrap text that
  // is already inside a highlight span (no double-wrapping for overlapping
  // names like "AI Peekaboo" / "Peekaboo").
  function highlightMentions(escapedText, entityNames) {
    if (!escapedText) return '';
    if (!entityNames || !entityNames.length) return escapedText;

    var names = [];
    entityNames.forEach(function (n) {
      if (n === null || n === undefined) return;
      var v = String(n).trim();
      if (v) names.push(v);
    });
    if (!names.length) return escapedText;

    names.sort(function (a, b) { return b.length - a.length; });

    var splitter = new RegExp('(' + escapeRegex(HL_OPEN) + '[\\s\\S]*?' + escapeRegex(HL_CLOSE) + ')');
    var result = escapedText;

    names.forEach(function (name) {
      // The text is escaped, so match the escaped form of the name.
      var escName = escapeHtml(name);
      if (!escName) return;
      var pattern = new RegExp(escapeRegex(escName), 'g');
      var parts = result.split(splitter);
      var out = [];
      parts.forEach(function (part) {
        if (part.indexOf(HL_OPEN) === 0) {
          // already-highlighted segment: leave untouched
          out.push(part);
        } else {
          out.push(part.replace(pattern, HL_OPEN + '$&' + HL_CLOSE));
        }
      });
      result = out.join('');
    });
    return result;
  }

  // Faithful port of v4 aimFormatAnswer (lines 5846-5877): escape, normalize,
  // **bold** / *italic* markdown, paragraph split, numbered + bulleted list
  // detection, single \n to <br>. Output is safe HTML built from escaped text.
  function formatAnswer(text) {
    var NO_TEXT = '<em class="pb-rm-noanswer">No response text available.</em>';
    if (!text) return NO_TEXT;
    var t = normalizeSpaces(text);
    t = escapeHtml(t);
    t = t.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*([\s\S]+?)\*/g, '<em>$1</em>');

    var paras = t.split(/\n{2,}/);
    var rendered = [];
    paras.forEach(function (para) {
      var trimmed = para.trim();
      if (!trimmed) return;
      var lines = trimmed.split('\n');
      var numListLines = lines.filter(function (l) { return /^\s*\d+[\.\)]\s/.test(l); });
      var bulletLines = lines.filter(function (l) { return /^\s*[-•\*]\s/.test(l); });
      if (numListLines.length >= 2 && numListLines.length >= lines.length * 0.5) {
        var oItems = lines.map(function (l) {
          return '<li>' + l.replace(/^\s*\d+[\.\)]\s+/, '').trim() + '</li>';
        }).join('');
        rendered.push('<ol style="padding-left:18px;margin:6px 0">' + oItems + '</ol>');
        return;
      }
      if (bulletLines.length >= 2 && bulletLines.length >= lines.length * 0.5) {
        var uItems = lines.map(function (l) {
          return '<li>' + l.replace(/^\s*[-•\*]\s+/, '').trim() + '</li>';
        }).join('');
        rendered.push('<ul style="padding-left:18px;margin:6px 0">' + uItems + '</ul>');
        return;
      }
      rendered.push('<p style="margin:0 0 8px">' + trimmed.replace(/\n/g, '<br>') + '</p>');
    });
    var html = rendered.join('');
    return html || NO_TEXT;
  }

  // Fallback chain for the modal body. fullResponse is the verbatim answer
  // (present when the detail call uses include_full_response=true); when it is
  // missing we fall back to the snippet, then the mention summary, and flag
  // the result as partial so the UI shows an honest note.
  function responseTextFor(run) {
    run = run || {};
    if (run.fullResponse) {
      return { text: run.fullResponse, partial: false };
    }
    var alt = run.responseSnippet || run.mentionSummary || '';
    return { text: alt, partial: true };
  }

  // Group history runs by their "YYYY-MM-DD" date, newest date first.
  // Runs without a date are grouped under "" and sort last. Returns
  // [{ date, runs: [...] }] preserving the original run order within a date.
  function groupRunsByDate(history) {
    if (!history || !history.length) return [];
    var byDate = {};
    var order = [];
    history.forEach(function (run) {
      if (!run) return;
      var d = run.date ? String(run.date) : '';
      if (!Object.prototype.hasOwnProperty.call(byDate, d)) {
        byDate[d] = [];
        order.push(d);
      }
      byDate[d].push(run);
    });
    // "YYYY-MM-DD" sorts correctly as a string; "" sorts last in desc order.
    order.sort(function (a, b) {
      if (a === b) return 0;
      return a > b ? -1 : 1;
    });
    return order.map(function (d) {
      return { date: d, runs: byDate[d] };
    });
  }

  // Header aggregates for a set of runs (one date section, or the whole
  // history for the page header): mean visibility score (null scores count
  // as 0, like v4), dominant non-null sentiment (most frequent, fallback
  // "neutral"), and mean of rank values > 0 rounded to 1 decimal (null when
  // no usable ranks).
  function dateAggregates(runs) {
    runs = (runs || []).filter(function (r) { return !!r; });
    if (!runs.length) return { avgVis: 0, domSentiment: 'neutral', avgPos: null };

    var visSum = 0;
    runs.forEach(function (r) {
      var v = (r.score === null || r.score === undefined) ? 0 : Number(r.score);
      if (isNaN(v)) v = 0;
      visSum += v;
    });
    var avgVis = Math.round(visSum / runs.length);

    var sentCounts = {};
    runs.forEach(function (r) {
      if (!r.sentiment) return;
      var s = String(r.sentiment).toLowerCase();
      sentCounts[s] = (sentCounts[s] || 0) + 1;
    });
    var domSentiment = 'neutral';
    var best = 0;
    Object.keys(sentCounts).forEach(function (s) {
      if (sentCounts[s] > best) {
        best = sentCounts[s];
        domSentiment = s;
      }
    });

    var posVals = [];
    runs.forEach(function (r) {
      var p = Number(r.rank);
      if (r.rank !== null && r.rank !== undefined && !isNaN(p) && p > 0) posVals.push(p);
    });
    var avgPos = null;
    if (posVals.length) {
      var posSum = 0;
      posVals.forEach(function (p) { posSum += p; });
      avgPos = Number((posSum / posVals.length).toFixed(1));
    }

    return { avgVis: avgVis, domSentiment: domSentiment, avgPos: avgPos };
  }

  // Aggregate brand-mention names and citation domains across all runs.
  // Returns { topBrands: [{name, count}], topCites: [{domain, count}] },
  // each sorted by count desc (name/domain asc as tie-break), top 5.
  function topEntities(history) {
    var brandCounts = {};
    var domainCounts = {};
    (history || []).forEach(function (run) {
      if (!run) return;
      (run.brandMentions || []).forEach(function (m) {
        if (!m) return;
        var name = String(m.entityName || '').trim();
        if (!name) return;
        brandCounts[name] = (brandCounts[name] || 0) + 1;
      });
      (run.sources || []).forEach(function (s) {
        if (!s) return;
        var dom = String(s.domain || '').trim();
        if (!dom) return;
        domainCounts[dom] = (domainCounts[dom] || 0) + 1;
      });
    });
    function top5(counts, key) {
      return Object.keys(counts)
        .map(function (k) {
          var entry = {};
          entry[key] = k;
          entry.count = counts[k];
          return entry;
        })
        .sort(function (a, b) {
          if (b.count !== a.count) return b.count - a.count;
          return a[key] < b[key] ? -1 : (a[key] > b[key] ? 1 : 0);
        })
        .slice(0, 5);
    }
    return { topBrands: top5(brandCounts, 'name'), topCites: top5(domainCounts, 'domain') };
  }

  // Table preview cell text: first 120 chars of the run's text with the v4
  // fallback chain (fullResponse, then snippet, then mention summary) and a
  // truncated flag so the renderer can append an ellipsis.
  function previewText(run) {
    run = run || {};
    var src = run.fullResponse || run.responseSnippet || run.mentionSummary || '';
    src = normalizeSpaces(src);
    return { text: src.substring(0, 120), truncated: src.length > 120 };
  }

  // v4 aimBrandIcon letter-fallback palette hash (line 5898): deterministic
  // color for a brand name. Exposed as pure logic; brandLetterIcon uses it.
  var LETTER_PALETTE = ['#b352b3', '#10b981', '#2563eb', '#8b5cf6', '#64748b', '#06b6d4', '#f59e0b', '#f472b6', '#38bdf8', '#94a3b8'];
  function letterAvatarColor(name) {
    var n = String(name === null || name === undefined ? '?' : name);
    var h = 0;
    for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) & 0xffff;
    return LETTER_PALETTE[h % LETTER_PALETTE.length];
  }

  // Entity-name -> domain map for mention favicons, same mechanism as the
  // competitors view's urlByName (views/competitors.js, buildPromptMatrixCard):
  // the brand's own record (PB.state.brands entry: {name, url}) plus the
  // tracked competitors from GET /brands/:id/competitors ({name, url}).
  // Only API-provided URLs go in; we NEVER construct a domain from an entity
  // name (hard rule). Keys are trimmed + lowercased for the lookup.
  function entityDomainMap(brand, competitors) {
    var map = {};
    function add(name, url) {
      if (!name || !url) return;
      var key = String(name).trim().toLowerCase();
      if (!key) return;
      if (!Object.prototype.hasOwnProperty.call(map, key)) map[key] = String(url);
    }
    if (brand) add(brand.name, brand.url);
    (competitors || []).forEach(function (c) {
      if (c) add(c.name, c.url);
    });
    return map;
  }

  // Case-insensitive exact-name lookup against entityDomainMap's output.
  // Returns the stored url/domain string, or null when the entity is unknown
  // (callers fall back to the deterministic letter avatar).
  function resolveEntityDomain(name, map) {
    if (!name || !map) return null;
    var key = String(name).trim().toLowerCase();
    if (!key) return null;
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
  }

  window.PBPromptDetailLogic = {
    escapeHtml: escapeHtml,
    normalizeSpaces: normalizeSpaces,
    highlightMentions: highlightMentions,
    formatAnswer: formatAnswer,
    responseTextFor: responseTextFor,
    groupRunsByDate: groupRunsByDate,
    dateAggregates: dateAggregates,
    topEntities: topEntities,
    previewText: previewText,
    letterAvatarColor: letterAvatarColor,
    entityDomainMap: entityDomainMap,
    resolveEntityDomain: resolveEntityDomain,
  };

  // ══════════════════════════════════════════════════════════════════════════
  // View
  // ══════════════════════════════════════════════════════════════════════════

  // Tracked-competitor list cached per brand (one extra GET per brand, shared
  // across detail page views). entityDomains is the resolver map for the
  // current render; the run-row/modal builders read it via mentionIcon so the
  // modal (opened later from a row click) sees the same data.
  var competitorsCache = { brandId: null, list: null };
  var entityDomains = {};

  // The brand's own record ({name, url, ...}) from PB.state.brands.
  function brandRecord(brandId) {
    try {
      var brands = (PB.state && PB.state.brands) || [];
      for (var i = 0; i < brands.length; i++) {
        if (brands[i] && brands[i].id === brandId) return brands[i];
      }
    } catch (e) { /* degrade to letter avatars */ }
    return null;
  }

  window.PBPromptDetail = async function (root, ctx) {
    if (!root) return;
    var promptId = ctx && ctx.param;
    var brandId = ctx && ctx.brandId;

    // Kick off the competitors fetch alongside the detail call; any failure
    // degrades to letter avatars (null list -> empty map entries).
    var compPromise;
    if (competitorsCache.brandId === brandId && competitorsCache.list) {
      compPromise = Promise.resolve(competitorsCache.list);
    } else {
      compPromise = PB.api.competitors(brandId)
        .then(function (comp) {
          var list = (comp && Array.isArray(comp.competitors)) ? comp.competitors : [];
          competitorsCache = { brandId: brandId, list: list };
          return list;
        })
        .catch(function () { return null; });
    }

    var detail = null;
    try {
      // full=true so every run arrives with fullResponse in one request
      detail = await PB.api.promptDetail(ctx.brandId, promptId, ctx.range, true);
    } catch (err) {
      PB.toast((err && err.message) || 'Could not load prompt', true);
      injectModalCSS();
      injectPageCSS();
      root.innerHTML = '';
      var errWrap = el('div', { class: 'pb-pd-scope' }, [
        backButton(),
        el('div', { class: 'pb-pd-card', text: 'Could not load this prompt. ' + ((err && err.message) || '') }),
      ]);
      root.appendChild(errWrap);
      return;
    }

    detail = detail || {};
    injectModalCSS();
    injectPageCSS();

    var compList = await compPromise;
    entityDomains = entityDomainMap(brandRecord(brandId), compList || []);

    var history = detail.history || [];
    var groups = groupRunsByDate(history);
    var tops = topEntities(history);

    root.innerHTML = '';
    var wrap = el('div', { class: 'pb-pd-scope' });
    wrap.appendChild(backButton());
    wrap.appendChild(buildHeaderCard(detail, ctx, groups, tops));
    wrap.appendChild(buildSectionTitle(groups.length));

    if (!groups.length) {
      wrap.appendChild(el('div', {
        style: { color: 'var(--text-faint)', fontSize: '13px', padding: '20px 0' },
        text: 'No response history available yet.',
      }));
    } else {
      var allModels = modelOrder(history);
      groups.forEach(function (group, idx) {
        wrap.appendChild(buildDateSection(group, idx === 0, allModels, detail));
      });
    }

    root.appendChild(wrap);
  };

  // ---- back button (v4 .aim-pd-back) -----------------------------------------
  var SVG_BACK_ARROW = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3L5 7l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var SVG_CALENDAR = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="2" width="11" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M4.5 1v2M8.5 1v2M1 5.5h11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
  var SVG_CHEVRON_PATH = '<path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';

  function backButton() {
    var btn = el('a', { class: 'pb-pd-back', href: '#/prompts' });
    var arrow = el('span', { class: 'pb-pd-back-ico', html: SVG_BACK_ARROW });
    btn.appendChild(arrow);
    btn.appendChild(el('span', { text: 'Back to Prompts' }));
    return btn;
  }

  // ---- header card ----------------------------------------------------------
  function buildHeaderCard(detail, ctx, groups, tops) {
    var summary = detail.summary || {};
    var agg = dateAggregates(detail.history || []);

    // topic + intent badges
    var badgeRow = el('div', { class: 'pb-pd-badge-row' });
    if (detail.category) {
      badgeRow.appendChild(el('span', { class: 'pb-pd-topic-badge' }, [
        el('span', { class: 'pb-pd-topic-dot', style: { color: letterAvatarColor(detail.category) }, text: '●' }),
        el('span', { text: detail.category }),
      ]));
    }
    if (detail.searchIntent) {
      var intentCls = String(detail.searchIntent).toLowerCase();
      badgeRow.appendChild(el('span', {
        class: 'pb-pd-intent-badge ' + intentCls,
        text: prettyIntent(detail.searchIntent),
      }));
    }

    // caption: "{frequency} · Last run: {Month D, YYYY}"
    var freq = brandFrequency(ctx);
    var lastRunDate = groups.length ? groups[0].date : '';
    var captionParts = [];
    if (freq) captionParts.push(freq);
    captionParts.push('Last run: ' + (lastRunDate ? fmtDateLong(lastRunDate) : '–'));
    var caption = el('span', { class: 'pb-pd-caption', text: captionParts.join(' · ') });

    var promptBlock = el('div', { style: { marginBottom: '12px' } }, [
      el('div', { class: 'pb-pd-prompt-text', text: detail.promptText || 'Untitled prompt' }),
      badgeRow,
      caption,
    ]);

    // stats row
    var visValue = (summary.averageScore === null || summary.averageScore === undefined)
      ? '–' : Math.round(summary.averageScore) + '%';
    // v4 shows one decimal here ("#1.0"), via toFixed(1)
    var posValue = agg.avgPos !== null ? '#' + agg.avgPos.toFixed(1) : '–';

    var statCluster = el('div', { class: 'pb-pd-stat-cluster' }, [
      el('div', {}, [
        el('div', { class: 'pb-pd-stat-value accent', text: visValue }),
        el('div', { class: 'pb-pd-stat-label', text: 'Visibility' }),
      ]),
      el('div', {}, [
        el('div', { class: 'pb-pd-stat-value', style: { lineHeight: '1.4' } }, [
          sentBadge(agg.domSentiment),
        ]),
        el('div', { class: 'pb-pd-stat-label', text: 'Sentiment' }),
      ]),
      el('div', {}, [
        el('div', { class: 'pb-pd-stat-value muted', text: posValue }),
        el('div', { class: 'pb-pd-stat-label', text: 'Avg Position' }),
      ]),
      el('div', {}, [
        el('div', { class: 'pb-pd-stat-value muted', text: String(groups.length) }),
        el('div', { class: 'pb-pd-stat-label', text: 'Run days' }),
      ]),
    ]);

    // Top Brands cluster: real favicons for resolvable entities (own brand +
    // tracked competitors via entityDomains), letter avatars for the rest
    var brandIcons = el('div', { class: 'pb-pd-icon-row' });
    if (tops.topBrands.length) {
      tops.topBrands.slice(0, 4).forEach(function (b) {
        brandIcons.appendChild(mentionIcon(b.name, 22));
      });
      if (tops.topBrands.length > 4) {
        brandIcons.appendChild(el('span', { class: 'pb-pd-icon-more', text: '+' + (tops.topBrands.length - 4) }));
      }
    } else {
      brandIcons.appendChild(el('span', { class: 'pb-pd-icon-empty', text: '–' }));
    }
    var brandCluster = el('div', { class: 'pb-pd-side-cluster' }, [
      brandIcons,
      el('div', { class: 'pb-pd-side-label', text: 'Top Brands' }),
    ]);

    // Top Citations cluster: real favicons from sources[].domain
    var citeIcons = el('div', { class: 'pb-pd-icon-row' });
    if (tops.topCites.length) {
      tops.topCites.slice(0, 4).forEach(function (c) {
        citeIcons.appendChild(el('img', {
          class: 'pb-pd-cite-icon',
          src: PB.favicon(c.domain),
          title: c.domain,
          alt: '',
          onerror: "this.style.visibility='hidden'",
        }));
      });
      if (tops.topCites.length > 4) {
        citeIcons.appendChild(el('span', { class: 'pb-pd-icon-more', text: '+' + (tops.topCites.length - 4) }));
      }
    } else {
      citeIcons.appendChild(el('span', { class: 'pb-pd-icon-empty', text: '–' }));
    }
    var citeCluster = el('div', { class: 'pb-pd-side-cluster' }, [
      citeIcons,
      el('div', { class: 'pb-pd-side-label', text: 'Top Citations' }),
    ]);

    var statsRow = el('div', { class: 'pb-pd-stats' }, [statCluster, brandCluster, citeCluster]);

    return el('div', { class: 'pb-pd-card' }, [promptBlock, statsRow]);
  }

  // Brand analysisFrequency from PB.state.brands, prettified ("WEEKLY" ->
  // "Weekly"); empty string when unknown so the caption can omit it.
  function brandFrequency(ctx) {
    try {
      var brands = (PB.state && PB.state.brands) || [];
      var brand = null;
      for (var i = 0; i < brands.length; i++) {
        if (brands[i] && brands[i].id === (ctx && ctx.brandId)) {
          brand = brands[i];
          break;
        }
      }
      if (brand && brand.analysisFrequency) return prettyIntent(brand.analysisFrequency);
    } catch (e) { /* caption degrades gracefully */ }
    return '';
  }

  // ---- section title ----------------------------------------------------------
  function buildSectionTitle(dayCount) {
    var suffix = dayCount + ' day' + (dayCount === 1 ? '' : 's') + ' · click a row to read the full response';
    return el('div', { class: 'pb-pd-section-title' }, [
      'Response History ',
      el('span', { text: suffix }),
    ]);
  }

  // ---- model ordering ---------------------------------------------------------
  // Distinct model slugs across the whole history, ordered by the global
  // PB.models order where known, then by first appearance. Drives the
  // consistent row set (incl. "No data for this date" fillers) per section.
  function modelOrder(history) {
    var seen = [];
    (history || []).forEach(function (run) {
      if (!run || !run.aiModel) return;
      if (seen.indexOf(run.aiModel) === -1) seen.push(run.aiModel);
    });
    var known = (PB.models || []).map(function (m) { return m.tag; });
    seen.sort(function (a, b) {
      var ia = known.indexOf(a);
      var ib = known.indexOf(b);
      if (ia === -1 && ib === -1) return seen.indexOf(a) - seen.indexOf(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    return seen;
  }

  // ---- date section (collapsible) ----------------------------------------------
  function buildDateSection(group, isLatest, allModels, detail) {
    var agg = dateAggregates(group.runs);
    var modelsHere = [];
    group.runs.forEach(function (r) {
      if (r && r.aiModel && modelsHere.indexOf(r.aiModel) === -1) modelsHere.push(r.aiModel);
    });

    // ---- header bar ----
    var chevron = el('span', {
      class: 'pb-pd-chevron',
      html: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">' + SVG_CHEVRON_PATH + '</svg>',
      style: { transform: 'rotate(' + (isLatest ? '0' : '-90') + 'deg)' },
    });
    var chevBtn = el('button', { class: 'pb-pd-chev-btn', type: 'button', 'aria-label': 'Toggle date section' }, [chevron]);

    var left = el('div', { class: 'pb-pd-day-left' }, [
      el('span', { class: 'pb-pd-cal-ico', html: SVG_CALENDAR }),
      el('span', { class: 'pb-pd-day-date', text: group.date ? fmtDateLong(group.date) : 'Unknown date' }),
      isLatest ? el('span', { class: 'pb-pd-latest-badge', text: 'Latest' }) : null,
      el('span', { class: 'pb-pd-day-faint', text: modelsHere.length + ' models' }),
      el('span', { class: 'pb-pd-day-divider' }),
      el('span', {
        class: 'pb-pd-day-vis' + (agg.avgVis > 0 ? ' on' : ''),
        text: agg.avgVis + '% vis',
      }),
      sentBadge(agg.domSentiment, true),
      el('span', { class: 'pb-pd-day-pos', text: '#' + (agg.avgPos !== null ? agg.avgPos.toFixed(1) : '–') + ' pos' }),
    ]);

    var head = el('div', {
      class: 'pb-pd-day-head',
      style: { borderBottom: '1px solid ' + (isLatest ? 'var(--border)' : 'transparent') },
    }, [left, chevBtn]);

    // ---- body (table) ----
    var body = el('div', { class: 'pb-pd-day-body', style: { display: isLatest ? '' : 'none' } }, [
      buildDayTable(group, allModels, detail),
    ]);

    var section = el('div', { class: 'pb-pd-day-section' }, [head, body]);

    function toggle() {
      if (!body) return;
      var collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      if (chevron) chevron.style.transform = collapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
      if (head) head.style.borderBottom = '1px solid ' + (collapsed ? 'var(--border)' : 'transparent');
    }
    head.addEventListener('click', toggle);
    chevBtn.addEventListener('click', function (ev) {
      // the bar is also clickable; stop the bubble so it does not double-toggle
      ev.stopPropagation();
      toggle();
    });

    return section;
  }

  function buildDayTable(group, allModels, detail) {
    var table = el('table', { class: 'pb-pd-table' });
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', { text: 'Model' }),
      el('th', { text: 'Response Preview' }),
      el('th', { text: 'Sentiment' }),
      el('th', { text: 'Visibility' }),
      el('th', { text: 'Avg Position' }),
      el('th', { text: 'Mentions' }),
      el('th', { text: 'Citations' }),
    ])));

    var tbody = el('tbody');
    var runsByModel = {};
    var extraRuns = [];
    group.runs.forEach(function (r) {
      if (!r) return;
      var m = r.aiModel;
      if (!m) {
        extraRuns.push(r);
        return;
      }
      if (!runsByModel[m]) runsByModel[m] = [];
      runsByModel[m].push(r);
    });

    allModels.forEach(function (model) {
      var runs = runsByModel[model] || [];
      if (!runs.length) {
        // Filler row: this model ran on other dates of this prompt
        tbody.appendChild(el('tr', {}, [
          el('td', {}, [modelBadge(model)]),
          el('td', {
            colspan: '6',
            class: 'pb-pd-nodata',
            text: 'No data for this date',
          }),
        ]));
        return;
      }
      runs.forEach(function (run) {
        tbody.appendChild(buildRunRow(run, detail));
      });
    });
    extraRuns.forEach(function (run) {
      tbody.appendChild(buildRunRow(run, detail));
    });

    table.appendChild(tbody);
    return el('div', { class: 'pb-pd-table-wrap' }, [table]);
  }

  function modelBadge(modelSlug) {
    return el('span', { class: 'pb-pd-model-badge' }, [
      el('img', { src: PB.modelLogo(modelSlug), alt: '', onerror: "this.style.visibility='hidden'" }),
      el('span', { text: PB.modelLabel(modelSlug) || 'Unknown' }),
    ]);
  }

  function buildRunRow(run, detail) {
    run = run || {};

    // Response Preview (escaped via textContent; ellipsis when truncated)
    var prev = previewText(run);
    var previewNode = el('p', { class: 'pb-pd-preview', text: prev.text + (prev.truncated ? '…' : '') });

    // Visibility
    var visNode;
    if (run.score === null || run.score === undefined) {
      visNode = el('span', { class: 'pb-pd-dash', text: '–' });
    } else {
      visNode = el('span', {
        class: 'pb-pd-vis' + (Number(run.score) > 0 ? ' on' : ''),
        text: Math.round(run.score) + '%',
      });
    }

    // Avg Position
    var posNode;
    var rankNum = Number(run.rank);
    if (run.rank !== null && run.rank !== undefined && !isNaN(rankNum) && rankNum > 0) {
      var rankTxt = Number.isInteger(rankNum) ? String(rankNum) : rankNum.toFixed(1);
      posNode = el('span', { class: 'pb-pd-pos', text: '#' + rankTxt });
    } else {
      posNode = el('span', { class: 'pb-pd-dash', text: '–' });
    }

    // Mentions: top-3 icons, real favicon when the entity resolves in
    // entityDomains, letter avatar otherwise
    var mentions = run.brandMentions || [];
    var mentNode;
    if (mentions.length) {
      mentNode = el('div', { class: 'pb-pd-cell-icons' });
      mentions.slice(0, 3).forEach(function (m) {
        var name = (m && m.entityName) || '?';
        mentNode.appendChild(mentionIcon(name, 16));
      });
      if (mentions.length > 3) {
        mentNode.appendChild(el('span', { class: 'pb-pd-icon-more', text: '+' + (mentions.length - 3) }));
      }
    } else {
      mentNode = el('span', { class: 'pb-pd-dash', text: '–' });
    }

    // Citations: top-3 real favicons from sources[].domain
    var sources = (run.sources || []).filter(function (s) { return s && s.domain; });
    var citNode;
    if (sources.length) {
      citNode = el('div', { class: 'pb-pd-cell-icons' });
      sources.slice(0, 3).forEach(function (s) {
        citNode.appendChild(el('img', {
          class: 'pb-pd-cite-icon sm',
          src: PB.favicon(s.domain),
          title: s.domain,
          alt: '',
          onerror: "this.style.visibility='hidden'",
        }));
      });
      if (sources.length > 3) {
        citNode.appendChild(el('span', { class: 'pb-pd-icon-more', text: '+' + (sources.length - 3) }));
      }
    } else {
      citNode = el('span', { class: 'pb-pd-dash', text: '–' });
    }

    function activate() {
      openRunModal(run, detail);
    }

    return el('tr', {
      class: 'pb-pd-row',
      role: 'button',
      tabindex: '0',
      title: 'Read the full response',
      onclick: activate,
      onkeydown: function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          activate();
        }
      },
    }, [
      el('td', {}, [modelBadge(run.aiModel)]),
      el('td', { style: { maxWidth: '300px' } }, [previewNode]),
      el('td', {}, [sentBadge(run.sentiment || 'neutral')]),
      el('td', {}, [visNode]),
      el('td', {}, [posNode]),
      el('td', {}, [mentNode]),
      el('td', {}, [citNode]),
    ]);
  }

  // sentiment pill (v4 .aim-sent-badge); small=true is the 10px header-bar variant
  function sentBadge(sentiment, small) {
    var cls = rmSentClass(sentiment);
    return el('span', {
      class: 'pb-pd-sent ' + cls + (small ? ' sm' : ''),
      text: prettyIntent(sentiment || 'neutral'),
    });
  }

  // ── page CSS injection ──────────────────────────────────────────────────────
  // Page CSS extracted from ai-monitoring-dashboard-v4.html (.aim-pd-back
  // 1083-1091, .aim-full-table 944-961, badges 963-988, .aim-sent-badge
  // 1003-1010, plus the inline styles of aimOpenPromptDetail 7410-7494),
  // scoped under .pb-pd-scope. Tokens come from the shared block in
  // injectModalCSS (which also covers .pb-pd-scope).
  function injectPageCSS() {
    if (document.getElementById('pb-prompt-page-css')) return;
    if (!document.head) return;
    var s = document.createElement('style');
    s.id = 'pb-prompt-page-css';
    s.textContent = '\n' +
      '.pb-pd-scope { font-family: var(--font); color: var(--text); }\n' +
      '.pb-pd-scope *, .pb-pd-scope *::before, .pb-pd-scope *::after { box-sizing: border-box; }\n' +
      '/* back button (v4 .aim-pd-back) */\n' +
      '.pb-pd-scope .pb-pd-back {\n' +
      '  display: flex; align-items: center; gap: 6px; padding: 6px 0 14px;\n' +
      '  font-size: 13px; font-weight: 500; color: var(--text-muted);\n' +
      '  cursor: pointer; background: none; border: none;\n' +
      '  font-family: var(--font); transition: color .12s; text-decoration: none;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-back:hover { color: var(--accent); }\n' +
      '.pb-pd-scope .pb-pd-back:hover svg { transform: translateX(-2px); }\n' +
      '.pb-pd-scope .pb-pd-back svg { transition: transform .12s; }\n' +
      '.pb-pd-scope .pb-pd-back-ico { display: inline-flex; align-items: center; }\n' +
      '/* header card */\n' +
      '.pb-pd-scope .pb-pd-card {\n' +
      '  background: var(--surface); border: 1px solid var(--border);\n' +
      '  border-radius: var(--radius-lg); box-shadow: var(--shadow);\n' +
      '  padding: 16px; margin-bottom: 14px;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-prompt-text { font-size: 15px; font-weight: 600; line-height: 1.4; margin-bottom: 7px; color: var(--text); }\n' +
      '.pb-pd-scope .pb-pd-badge-row { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }\n' +
      '/* topic + intent badges (v4 .aim-topic-badge / .aim-intent-badge; the\n' +
      '   #fff/#e5e7eb/#374151 chrome is verbatim v4 and has no token) */\n' +
      '.pb-pd-scope .pb-pd-topic-badge, .pb-pd-scope .pb-pd-intent-badge {\n' +
      '  display: inline-flex; align-items: center; gap: 4px;\n' +
      '  font-size: 11px; font-weight: 600;\n' +
      '  padding: 2px 7px; border-radius: 4px;\n' +
      '  background: #fff; border: 1px solid #e5e7eb; color: #374151;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-topic-dot { font-size: 7px; line-height: 1; }\n' +
      '.pb-pd-scope .pb-pd-intent-badge::before { content: \'\\25CF\'; font-size: 7px; line-height: 1; }\n' +
      '.pb-pd-scope .pb-pd-intent-badge.informational::before { color: #2563eb; }\n' +
      '.pb-pd-scope .pb-pd-intent-badge.commercial::before    { color: var(--accent); }\n' +
      '.pb-pd-scope .pb-pd-intent-badge.transactional::before { color: #059669; }\n' +
      '.pb-pd-scope .pb-pd-intent-badge.navigational::before  { color: #d97706; }\n' +
      '.pb-pd-scope .pb-pd-caption { font-size: 11px; color: var(--text-faint); }\n' +
      '/* stats row */\n' +
      '.pb-pd-scope .pb-pd-stats { display: flex; align-items: flex-start; flex-wrap: wrap; row-gap: 10px; }\n' +
      '.pb-pd-scope .pb-pd-stat-cluster { display: flex; gap: 20px; flex-shrink: 0; }\n' +
      '.pb-pd-scope .pb-pd-stat-value { font-size: 20px; font-weight: 700; color: var(--text); }\n' +
      '.pb-pd-scope .pb-pd-stat-value.accent { color: var(--accent); }\n' +
      '.pb-pd-scope .pb-pd-stat-value.muted { color: var(--text-muted); }\n' +
      '.pb-pd-scope .pb-pd-stat-label { font-size: 11px; color: var(--text-muted); }\n' +
      '.pb-pd-scope .pb-pd-side-cluster { border-left: 1px solid var(--border); padding-left: 18px; margin-left: 18px; flex-shrink: 0; }\n' +
      '.pb-pd-scope .pb-pd-side-label { font-size: 11px; color: var(--text-muted); margin-top: 2px; }\n' +
      '.pb-pd-scope .pb-pd-icon-row { display: flex; align-items: center; gap: 4px; min-height: 26px; }\n' +
      '.pb-pd-scope .pb-pd-icon-more { font-size: 10px; font-weight: 600; color: var(--text-muted); margin-left: 2px; }\n' +
      '.pb-pd-scope .pb-pd-icon-empty { font-size: 13px; color: var(--text-faint); }\n' +
      '.pb-pd-scope .pb-pd-cite-icon { width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--border-light); flex-shrink: 0; }\n' +
      '.pb-pd-scope .pb-pd-cite-icon.sm { width: 16px; height: 16px; border-radius: 3px; border: none; }\n' +
      '/* sentiment pill (v4 .aim-sent-badge) */\n' +
      '.pb-pd-scope .pb-pd-sent {\n' +
      '  font-size: 11px; font-weight: 600;\n' +
      '  padding: 2px 8px; border-radius: 100px;\n' +
      '  border: 1px solid; display: inline-block;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-sent.positive { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }\n' +
      '.pb-pd-scope .pb-pd-sent.neutral  { background: var(--surface-alt); color: var(--text-muted); border-color: var(--border); }\n' +
      '.pb-pd-scope .pb-pd-sent.negative { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }\n' +
      '.pb-pd-scope .pb-pd-sent.sm { font-size: 10px; padding: 1px 7px; }\n' +
      '/* section title */\n' +
      '.pb-pd-scope .pb-pd-section-title { font-size: 14px; font-weight: 700; color: #111827; margin-bottom: 10px; }\n' +
      '.pb-pd-scope .pb-pd-section-title span { font-size: 11px; font-weight: 400; color: var(--text-faint); }\n' +
      '/* date sections */\n' +
      '.pb-pd-scope .pb-pd-day-section { border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 10px; overflow: hidden; background: var(--surface); }\n' +
      '.pb-pd-scope .pb-pd-day-head {\n' +
      '  display: flex; align-items: center; justify-content: space-between;\n' +
      '  padding: 10px 14px; background: var(--surface-alt); cursor: pointer;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-day-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }\n' +
      '.pb-pd-scope .pb-pd-cal-ico { display: inline-flex; align-items: center; color: var(--text); }\n' +
      '.pb-pd-scope .pb-pd-day-date { font-size: 12px; font-weight: 700; color: var(--text); }\n' +
      '.pb-pd-scope .pb-pd-latest-badge { font-size: 10px; font-weight: 600; background: var(--accent); color: #fff; padding: 1px 6px; border-radius: 4px; }\n' +
      '.pb-pd-scope .pb-pd-day-faint { font-size: 11px; color: var(--text-faint); }\n' +
      '.pb-pd-scope .pb-pd-day-divider { width: 1px; height: 12px; background: var(--border); display: inline-block; margin: 0 2px; }\n' +
      '.pb-pd-scope .pb-pd-day-vis { font-size: 11px; font-weight: 600; color: var(--text-faint); }\n' +
      '.pb-pd-scope .pb-pd-day-vis.on { color: var(--accent); }\n' +
      '.pb-pd-scope .pb-pd-day-pos { font-size: 11px; color: var(--text-muted); }\n' +
      '.pb-pd-scope .pb-pd-chev-btn {\n' +
      '  background: none; border: none; cursor: pointer; padding: 2px;\n' +
      '  display: flex; align-items: center; color: var(--text-muted); flex-shrink: 0;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-chevron { display: inline-flex; align-items: center; transition: transform .2s; }\n' +
      '/* table (v4 .aim-full-table) */\n' +
      '.pb-pd-scope .pb-pd-table-wrap { overflow-x: auto; }\n' +
      '.pb-pd-scope .pb-pd-table { width: 100%; font-size: 12px; border-collapse: collapse; }\n' +
      '.pb-pd-scope .pb-pd-table th {\n' +
      '  font-size: 10px; font-weight: 600;\n' +
      '  text-transform: uppercase; letter-spacing: .06em;\n' +
      '  color: var(--text-faint); padding: 8px 18px;\n' +
      '  border-bottom: 1px solid var(--border);\n' +
      '  text-align: center; background: var(--surface-alt);\n' +
      '  white-space: nowrap;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-table td {\n' +
      '  padding: 10px 18px;\n' +
      '  border-bottom: 1px solid var(--border-light);\n' +
      '  vertical-align: middle; text-align: center;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-table th:first-child, .pb-pd-scope .pb-pd-table td:first-child { text-align: left; }\n' +
      '.pb-pd-scope .pb-pd-table tr:last-child td { border-bottom: none; }\n' +
      '.pb-pd-scope .pb-pd-table tbody tr:hover td { background: var(--surface-alt); }\n' +
      '.pb-pd-scope .pb-pd-row { cursor: pointer; }\n' +
      '.pb-pd-scope .pb-pd-row:focus-visible { outline: 2px solid var(--accent-30); outline-offset: -2px; }\n' +
      '/* table cells */\n' +
      '.pb-pd-scope .pb-pd-model-badge {\n' +
      '  display: inline-flex; align-items: center; gap: 3px;\n' +
      '  padding: 2px 6px; border-radius: 4px;\n' +
      '  font-size: 10px; font-weight: 500;\n' +
      '  background: transparent; color: var(--text-muted);\n' +
      '  border: 1px solid var(--border); line-height: 1.5; white-space: nowrap;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-model-badge img { width: 11px; height: 11px; border-radius: 2px; flex-shrink: 0; object-fit: contain; }\n' +
      '.pb-pd-scope .pb-pd-preview {\n' +
      '  font-size: 11px; line-height: 1.5; color: var(--text-muted); margin: 0;\n' +
      '  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;\n' +
      '  text-align: left;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-vis { font-weight: 600; font-size: 12px; color: var(--text-faint); }\n' +
      '.pb-pd-scope .pb-pd-vis.on { color: var(--accent); }\n' +
      '.pb-pd-scope .pb-pd-pos { font-size: 12px; font-weight: 600; color: var(--text); }\n' +
      '.pb-pd-scope .pb-pd-dash { color: var(--text-faint); }\n' +
      '.pb-pd-scope .pb-pd-cell-icons { display: flex; align-items: center; gap: 4px; justify-content: center; }\n' +
      '.pb-pd-scope .pb-pd-nodata { font-size: 11px; color: var(--text-faint); padding: 10px 12px; }\n';
    document.head.appendChild(s);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Full-answer modal (v4 #aim-response-modal port)
  // ══════════════════════════════════════════════════════════════════════════

  // Single source of truth for the open modal so a thrown error can never
  // leave the scroll lock stuck: closeRunModal() always restores everything
  // it can find, and openRunModal() calls it from its catch block.
  var modalState = { overlay: null, keyHandler: null, prevOverflow: '' };

  function openRunModal(run, detail) {
    try {
      closeRunModal();
      injectModalCSS();
      var overlay = buildModalDom(run || {}, detail || {});
      modalState.overlay = overlay;
      modalState.prevOverflow = document.body.style.overflow || '';
      modalState.keyHandler = function (ev) {
        if (ev.key === 'Escape') closeRunModal();
      };
      document.addEventListener('keydown', modalState.keyHandler);
      document.body.style.overflow = 'hidden';
      document.body.appendChild(overlay);
    } catch (err) {
      closeRunModal();
      if (PB.toast) PB.toast('Could not open the response window', true);
      if (window.console && console.error) console.error('openRunModal failed', err);
    }
  }

  function closeRunModal() {
    if (modalState.keyHandler) {
      document.removeEventListener('keydown', modalState.keyHandler);
      modalState.keyHandler = null;
    }
    if (modalState.overlay && modalState.overlay.parentNode) {
      modalState.overlay.parentNode.removeChild(modalState.overlay);
    }
    modalState.overlay = null;
    document.body.style.overflow = modalState.prevOverflow || '';
    modalState.prevOverflow = '';
  }

  // v4 long date: "June 3, 2026" (aimFmtDate, line 5722)
  function fmtDateLong(iso) {
    if (!iso || String(iso).indexOf('-') === -1) return iso || '';
    try {
      var parts = String(iso).split('-');
      var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      if (isNaN(d)) return iso;
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return iso;
    }
  }

  function rmSentClass(sentiment) {
    var s = String(sentiment || 'neutral').toLowerCase();
    if (s === 'positive' || s === 'negative') return s;
    return 'neutral';
  }

  // Mention icon: real favicon when the entity name resolves (own brand or a
  // tracked competitor in entityDomains), deterministic letter avatar
  // otherwise. The img swaps itself for the letter avatar if the favicon
  // fails to load. Domains are never constructed from names.
  function mentionIcon(name, sz) {
    var label = String(name || '?');
    var domain = resolveEntityDomain(label, entityDomains);
    if (!domain) {
      var fallback = brandLetterIcon(label, sz);
      fallback.title = label;
      return fallback;
    }
    var r = Math.round(sz * 0.22);
    var img = el('img', {
      src: PB.favicon(domain),
      alt: '',
      title: label,
      style: {
        width: sz + 'px', height: sz + 'px', borderRadius: r + 'px',
        flexShrink: '0', display: 'block', objectFit: 'contain',
      },
      onerror: function () {
        var letter = brandLetterIcon(label, sz);
        letter.title = label;
        if (img && img.parentNode) img.parentNode.replaceChild(letter, img);
      },
    });
    return img;
  }

  // v4 aimBrandIcon letter fallback (line 5898): deterministic palette hash.
  // Used for every mention entity that does not resolve in entityDomains
  // (untracked entities); we never guess a domain from the name.
  function brandLetterIcon(name, sz) {
    var n = String(name || '?');
    var letter = n.charAt(0).toUpperCase();
    var bg = letterAvatarColor(n);
    var r = Math.round(sz * 0.22);
    var fs = Math.max(8, Math.round(sz * 0.46));
    return el('span', {
      style: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: sz + 'px', height: sz + 'px', borderRadius: r + 'px',
        background: bg, color: '#fff', fontSize: fs + 'px', fontWeight: '700', flexShrink: '0',
      },
      text: letter,
    });
  }

  var SVG_MENTIONS_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M9.5 1.5h-7a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1v-7a1 1 0 00-1-1z" stroke="#8b5cf6" stroke-width="1.2"/><path d="M4 4h4M4 6h3" stroke="#8b5cf6" stroke-width="1.2" stroke-linecap="round"/></svg>';
  var SVG_CITATIONS_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="#b352b3" stroke-width="1.2"/><path d="M1.5 6h9M6 1.5A6.5 6.5 0 006 10.5M6 1.5A6.5 6.5 0 016 10.5" stroke="#b352b3" stroke-width="1.2"/></svg>';
  var SVG_EXT_LINK = '<svg class="aim-rm-source-ext" width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M4 2H2a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V6M6 1h3v3M5 5L8.5 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

  function buildModalDom(run, detail) {
    var modelName = PB.modelLabel(run.aiModel);
    var modelIcon = PB.modelLogo(run.aiModel);
    var resp = responseTextFor(run);
    var answerHtml = formatAnswer(resp.text);

    // ---- header -------------------------------------------------------------
    var headerLeft = el('div', { class: 'aim-rm-header-left' }, [
      el('img', { class: 'aim-rm-model-icon', src: modelIcon, alt: '' }),
      el('div', {}, [
        el('div', { class: 'aim-rm-model-name', text: modelName }),
        el('div', { class: 'aim-rm-date', text: fmtDateLong(run.date) }),
      ]),
    ]);

    var headerRight = el('div', { class: 'aim-rm-header-right' }, [
      (run.score === null || run.score === undefined) ? null
        : el('span', { class: 'aim-rm-stat-badge', text: 'Score ' + fmt.score(run.score) }),
      (run.rank === null || run.rank === undefined) ? null
        : el('span', { class: 'aim-rm-stat-badge', text: 'Rank ' + run.rank }),
      run.sentiment
        ? el('span', { class: 'aim-rm-sentiment-badge ' + rmSentClass(run.sentiment), text: prettyIntent(run.sentiment) })
        : null,
      el('button', { class: 'aim-rm-close', type: 'button', html: '&#215;', 'aria-label': 'Close', onclick: closeRunModal }),
    ]);

    var header = el('div', { class: 'aim-rm-header' }, [headerLeft, headerRight]);

    // ---- chat column ----------------------------------------------------------
    var userBubble = el('div', { class: 'aim-rm-bubble-wrap user' }, [
      el('div', { class: 'aim-rm-bubble-meta', text: 'You' }),
      el('div', { class: 'aim-rm-bubble-user', text: detail.promptText || '' }),
    ]);

    var aiBubbleChildren = [
      el('div', { class: 'aim-rm-ai-label' }, [
        el('span', { class: 'aim-rm-ai-dot' }),
        modelName + ' Response',
      ]),
      el('div', { class: 'aim-rm-answer', html: answerHtml }),
    ];
    if (resp.partial && resp.text) {
      aiBubbleChildren.push(el('div', {
        class: 'aim-rm-partial-note',
        text: 'Partial response: the full text was not stored for this run.',
      }));
    }

    var aiBubble = el('div', { class: 'aim-rm-bubble-wrap ai' }, [
      el('div', { class: 'aim-rm-bubble-meta' }, [
        el('img', { src: modelIcon, alt: '' }),
        modelName,
      ]),
      el('div', { class: 'aim-rm-bubble-ai' }, aiBubbleChildren),
    ]);

    var chat = el('div', { class: 'aim-rm-chat' }, [userBubble, aiBubble]);

    // ---- sidebar --------------------------------------------------------------
    var mentions = run.brandMentions || [];
    var sources = run.sources || [];
    var sidebarSections = [];

    if (mentions.length) {
      var chipList = el('div', {});
      // own brand first (v4 lists the "You" chip before competitor chips)
      var ordered = [];
      mentions.forEach(function (m) {
        if (m && String(m.type || '').toLowerCase() === 'brand') ordered.push(m);
      });
      mentions.forEach(function (m) {
        if (!m || String(m.type || '').toLowerCase() !== 'brand') ordered.push(m);
      });
      ordered.forEach(function (m) {
        chipList.appendChild(buildMentionChip(m));
      });
      sidebarSections.push(el('div', { class: 'aim-rm-sidebar-section' }, [
        el('div', { class: 'aim-rm-sidebar-title' }, [
          el('span', { class: 'aim-rm-title-ico', html: SVG_MENTIONS_ICON }),
          'Mentions (' + mentions.length + ')',
        ]),
        chipList,
      ]));
    }

    if (sources.length) {
      var srcList = el('div', {});
      sources.forEach(function (s, i) {
        srcList.appendChild(buildSourceRow(s || {}, i));
      });
      sidebarSections.push(el('div', { class: 'aim-rm-sidebar-section' }, [
        el('div', { class: 'aim-rm-sidebar-title' }, [
          el('span', { class: 'aim-rm-title-ico', html: SVG_CITATIONS_ICON }),
          'Citations (' + sources.length + ')',
        ]),
        srcList,
      ]));
    }

    // ---- assemble -------------------------------------------------------------
    var bodyChildren = [chat];
    if (sidebarSections.length) {
      bodyChildren.push(el('div', { class: 'aim-rm-sidebar' }, sidebarSections));
    }
    var body = el('div', { class: 'aim-rm-body' }, bodyChildren);

    var panel = el('div', {
      class: 'aim-rm-panel',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': modelName + ' response',
    }, [header, body]);

    var overlay = el('div', { class: 'pb-rm-scope aim-rm-overlay' }, [panel]);
    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay) closeRunModal();
    });
    return overlay;
  }

  function buildMentionChip(m) {
    m = m || {};
    var name = m.entityName || '—';
    var isOwnBrand = String(m.type || '').toLowerCase() === 'brand';

    var titleParts = [];
    if (m.score !== null && m.score !== undefined) titleParts.push('Score ' + fmt.score(m.score));
    if (m.mentionSummary) titleParts.push(m.mentionSummary);

    var children = [
      mentionIcon(name, 18),
      el('span', { class: 'aim-rm-brand-chip-name' + (isOwnBrand ? ' you' : ''), text: name }),
    ];
    if (m.rank !== null && m.rank !== undefined) {
      children.push(el('span', { class: 'aim-rm-brand-rank', text: '#' + m.rank }));
    }
    if (isOwnBrand) {
      children.push(el('span', { class: 'aim-you-badge', text: 'You' }));
    } else if (m.sentiment) {
      children.push(el('span', { class: 'aim-rm-brand-sent ' + rmSentClass(m.sentiment), text: prettyIntent(m.sentiment) }));
    }

    return el('div', {
      class: 'aim-rm-brand-chip ' + (isOwnBrand ? 'own' : 'neutral'),
      title: titleParts.join(' · '),
    }, children);
  }

  function buildSourceRow(s, i) {
    var domain = s.domain || '';
    var label = s.title || domain || '—';
    var url = s.url || '';
    var hasUrl = /^https?:\/\//i.test(url);

    var inner = el('div', { class: 'aim-rm-source-inner' }, [
      el('span', { class: 'aim-rm-source-num', text: String(i + 1) }),
      domain ? el('img', { src: PB.favicon(domain), alt: '', onerror: "this.style.visibility='hidden'" }) : null,
      el('span', { class: 'aim-rm-source-domain', text: label }),
      hasUrl ? el('span', { class: 'aim-rm-source-ext-wrap', html: SVG_EXT_LINK }) : null,
    ]);

    // exact URLs only: when the API gives no URL we render a plain row
    // instead of guessing a link (never construct URLs)
    if (hasUrl) {
      return el('a', {
        class: 'aim-rm-source-row',
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: url,
      }, [inner]);
    }
    return el('div', { class: 'aim-rm-source-row static' }, [inner]);
  }

  // ── CSS injection ───────────────────────────────────────────────────────────
  // Modal CSS extracted verbatim from ai-monitoring-dashboard-v4.html
  // (lines 1093-1202 + .aim-you-badge at 565), scoped under .pb-rm-scope so it
  // cannot leak into other views. The token block mirrors the v4 :root the
  // same way views/todos.js injectTodosCSS() does. .pb-pd-scope (the page
  // wrapper) shares the token block because the page lives outside the
  // modal scope.
  function injectModalCSS() {
    if (document.getElementById('pb-prompt-modal-css')) return;
    if (!document.head) return;
    var s = document.createElement('style');
    s.id = 'pb-prompt-modal-css';
    s.textContent = '\n' +
      '/* === tokens (v4 :root) === */\n' +
      '.pb-rm-scope, .pb-pd-scope {\n' +
      '  --bg:              #ffffff;\n' +
      '  --surface:         #ffffff;\n' +
      '  --surface-alt:     #fafafa;\n' +
      '  --surface-hover:   #f4f4f5;\n' +
      '  --border:          #EEEEEF;\n' +
      '  --border-light:    rgba(0,0,0,0.05);\n' +
      '  --text:            #1c1917;\n' +
      '  --text-muted:      #545D6C;\n' +
      '  --text-faint:      #9CA3AF;\n' +
      '  --accent:          #b352b3;\n' +
      '  --accent-hover:    #a043a0;\n' +
      '  --accent-light:    rgba(179,82,179,0.08);\n' +
      '  --accent-30:       rgba(179,82,179,0.3);\n' +
      '  --radius:          10px;\n' +
      '  --radius-lg:       14px;\n' +
      '  --shadow:          0 1px 2px rgba(0,0,0,0.05);\n' +
      '  --font:            \'Inter\', ui-sans-serif, system-ui, sans-serif;\n' +
      '}\n' +
      '/* === v4 response modal (lines 1093-1202) === */\n' +
      '.pb-rm-scope { font-family: var(--font); -webkit-font-smoothing: antialiased; }\n' +
      '.pb-rm-scope *, .pb-rm-scope *::before, .pb-rm-scope *::after { box-sizing: border-box; }\n' +
      '.pb-rm-scope.aim-rm-overlay {\n' +
      '  position: fixed; inset: 0; z-index: 1000;\n' +
      '  background: rgba(0,0,0,.4);\n' +
      '  display: flex; align-items: center; justify-content: center;\n' +
      '  padding: 16px; backdrop-filter: blur(4px);\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-panel {\n' +
      '  width: 100%; max-width: 900px;\n' +
      '  max-height: calc(100vh - 32px);\n' +
      '  background: var(--surface); border-radius: 16px;\n' +
      '  box-shadow: 0 24px 64px rgba(0,0,0,.2);\n' +
      '  display: flex; flex-direction: column; overflow: hidden;\n' +
      '  border: 1px solid var(--border);\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-header {\n' +
      '  display: flex; align-items: center; justify-content: space-between;\n' +
      '  padding: 12px 16px; border-bottom: 1px solid var(--border-light); flex-shrink: 0;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-header-left { display: flex; align-items: center; gap: 10px; }\n' +
      '.pb-rm-scope .aim-rm-model-icon { width: 24px; height: 24px; border-radius: 6px; object-fit: contain; }\n' +
      '.pb-rm-scope .aim-rm-model-name { font-size: 11px; color: var(--text-muted); font-weight: 500; }\n' +
      '.pb-rm-scope .aim-rm-date { font-size: 13px; font-weight: 600; color: var(--text); }\n' +
      '.pb-rm-scope .aim-rm-header-right { display: flex; align-items: center; gap: 8px; }\n' +
      '.pb-rm-scope .aim-rm-sentiment-badge {\n' +
      '  font-size: 11px; font-weight: 600;\n' +
      '  padding: 3px 10px; border-radius: 100px; border: 1px solid;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-sentiment-badge.positive { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }\n' +
      '.pb-rm-scope .aim-rm-sentiment-badge.neutral  { background: var(--surface-alt); color: var(--text-muted); border-color: var(--border); }\n' +
      '.pb-rm-scope .aim-rm-sentiment-badge.negative { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }\n' +
      '.pb-rm-scope .aim-rm-stat-badge {\n' +
      '  font-size: 11px; font-weight: 600;\n' +
      '  padding: 3px 10px; border-radius: 100px;\n' +
      '  border: 1px solid var(--border); background: var(--surface-alt); color: var(--text-muted);\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-close {\n' +
      '  width: 28px; height: 28px; border-radius: var(--radius);\n' +
      '  background: none; border: none; cursor: pointer;\n' +
      '  font-size: 20px; color: var(--text-faint);\n' +
      '  display: flex; align-items: center; justify-content: center;\n' +
      '  line-height: 1; transition: all .12s; font-family: var(--font);\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-close:hover { background: var(--surface-alt); color: var(--text); }\n' +
      '.pb-rm-scope .aim-rm-body { display: flex; flex: 1; min-height: 0; overflow: hidden; }\n' +
      '.pb-rm-scope .aim-rm-chat { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }\n' +
      '.pb-rm-scope .aim-rm-bubble-wrap { display: flex; flex-direction: column; }\n' +
      '.pb-rm-scope .aim-rm-bubble-wrap.user { align-items: flex-end; }\n' +
      '.pb-rm-scope .aim-rm-bubble-wrap.ai   { align-items: flex-start; }\n' +
      '.pb-rm-scope .aim-rm-bubble-meta {\n' +
      '  font-size: 10px; color: var(--text-faint); margin-bottom: 4px;\n' +
      '  display: flex; align-items: center; gap: 5px;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-bubble-meta img { width: 14px; height: 14px; border-radius: 3px; object-fit: contain; }\n' +
      '.pb-rm-scope .aim-rm-bubble-user {\n' +
      '  background: var(--accent); color: #fff;\n' +
      '  border-radius: 14px; border-top-right-radius: 3px;\n' +
      '  padding: 12px 16px; max-width: 85%;\n' +
      '  font-size: 13px; font-weight: 500; line-height: 1.5;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-bubble-ai {\n' +
      '  background: var(--surface-alt);\n' +
      '  border: 1px solid var(--border-light);\n' +
      '  border-radius: 14px; border-top-left-radius: 3px;\n' +
      '  padding: 16px; max-width: 92%;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-ai-label {\n' +
      '  display: flex; align-items: center; gap: 5px; margin-bottom: 10px;\n' +
      '  font-size: 10px; font-weight: 700; text-transform: uppercase;\n' +
      '  letter-spacing: .05em; color: var(--text-faint);\n' +
      '}\n' +
      '/* v4 inlines this dot color (#6b7280, line 7527); kept as a class here */\n' +
      '.pb-rm-scope .aim-rm-ai-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #6b7280; margin-right: 4px; }\n' +
      '.pb-rm-scope .aim-rm-answer { font-size: 13px; color: var(--text); line-height: 1.65; white-space: pre-wrap; }\n' +
      '.pb-rm-scope .aim-rm-answer p { margin: 0 0 6px; white-space: normal; }\n' +
      '.pb-rm-scope .aim-rm-answer p:last-child { margin-bottom: 0; }\n' +
      '.pb-rm-scope .aim-rm-answer ol, .pb-rm-scope .aim-rm-answer ul { white-space: normal; }\n' +
      '.pb-rm-scope .pb-rm-noanswer { color: var(--text-faint); }\n' +
      '.pb-rm-scope .pb-rm-hl { background: var(--accent-light); border-radius: 3px; }\n' +
      '.pb-rm-scope .aim-rm-partial-note { margin-top: 10px; font-size: 11px; font-style: italic; color: var(--text-faint); }\n' +
      '.pb-rm-scope .aim-rm-sidebar {\n' +
      '  width: 220px; flex-shrink: 0;\n' +
      '  border-left: 1px solid var(--border-light); overflow-y: auto;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-sidebar-section { padding: 14px; border-bottom: 1px solid var(--border-light); }\n' +
      '.pb-rm-scope .aim-rm-sidebar-section:last-child { border-bottom: none; }\n' +
      '.pb-rm-scope .aim-rm-sidebar-title {\n' +
      '  font-size: 10px; font-weight: 700; text-transform: uppercase;\n' +
      '  letter-spacing: .06em; color: var(--text-faint); margin-bottom: 8px;\n' +
      '  display: flex; align-items: center; gap: 5px;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-title-ico { display: inline-flex; align-items: center; }\n' +
      '.pb-rm-scope .aim-rm-brand-chip {\n' +
      '  display: flex; align-items: center; gap: 7px;\n' +
      '  padding: 6px 8px; border-radius: var(--radius);\n' +
      '  border: 1px solid var(--border); margin-bottom: 5px;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-brand-chip.neutral { background: var(--surface); border-color: var(--border); }\n' +
      '.pb-rm-scope .aim-rm-brand-chip.own { background: var(--accent-light); border-color: var(--accent); }\n' +
      '.pb-rm-scope .aim-rm-brand-chip img { width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; }\n' +
      '.pb-rm-scope .aim-rm-brand-chip-name {\n' +
      '  font-size: 11px; font-weight: 500; color: var(--text);\n' +
      '  flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-brand-chip-name.you { color: var(--accent); font-weight: 600; }\n' +
      '.pb-rm-scope .aim-rm-brand-rank { font-size: 9px; font-weight: 700; color: var(--text-faint); flex-shrink: 0; }\n' +
      '.pb-rm-scope .aim-rm-brand-sent { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; flex-shrink: 0; }\n' +
      '.pb-rm-scope .aim-rm-brand-sent.positive { color: #15803d; }\n' +
      '.pb-rm-scope .aim-rm-brand-sent.neutral  { color: var(--text-muted); }\n' +
      '.pb-rm-scope .aim-rm-brand-sent.negative { color: #b91c1c; }\n' +
      '.pb-rm-scope .aim-you-badge {\n' +
      '  font-size: 9px; background: var(--accent); color: #ffffff;\n' +
      '  font-weight: 700; padding: 1px 6px; border-radius: 100px; flex-shrink: 0;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-source-row {\n' +
      '  display: flex; align-items: flex-start; gap: 7px;\n' +
      '  padding: 6px 8px; border-radius: var(--radius);\n' +
      '  border: 1px solid var(--border-light);\n' +
      '  background: var(--surface); margin-bottom: 5px;\n' +
      '  cursor: pointer; text-decoration: none;\n' +
      '  transition: border-color .1s;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-source-row:hover { border-color: var(--accent); }\n' +
      '.pb-rm-scope .aim-rm-source-row.static { cursor: default; }\n' +
      '.pb-rm-scope .aim-rm-source-row.static:hover { border-color: var(--border-light); }\n' +
      '.pb-rm-scope .aim-rm-source-inner { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; }\n' +
      '.pb-rm-scope .aim-rm-source-num { font-size: 10px; font-weight: 700; color: var(--text-faint); width: 14px; flex-shrink: 0; }\n' +
      '.pb-rm-scope .aim-rm-source-row img { width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; }\n' +
      '.pb-rm-scope .aim-rm-source-domain { font-size: 11px; font-weight: 500; color: var(--text); flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }\n' +
      '.pb-rm-scope .aim-rm-source-ext-wrap { display: inline-flex; align-items: center; flex-shrink: 0; }\n' +
      '.pb-rm-scope .aim-rm-source-ext { color: var(--text-faint); flex-shrink: 0; }\n';
    document.head.appendChild(s);
  }

  // ---- shared helpers -------------------------------------------------------
  function prettyIntent(i) {
    if (!i) return '';
    var s = String(i).toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
})();
