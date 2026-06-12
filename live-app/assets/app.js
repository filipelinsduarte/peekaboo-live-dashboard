/*
 * app.js — core SPA framework for the live (API-driven) Peekaboo dashboard.
 * This build renders into the REAL captured product shell (real sidebar +
 * header + compiled CSS). Exposes window.PB (same contract the views use):
 *   PB.registerView(name, renderFn)   renderFn(root, ctx)
 *   PB.state  PB.api  PB.el  PB.fmt  PB.favicon  PB.modelLogo  PB.modelLabel
 *   PB.models  PB.toast  PB.skeleton  PB.navigate  PB.card  PB.cardTitle  PB.boot
 *   PB.entityDomain(name, citedDomains, trackedMap) -> domain | null
 *
 * Routing (hash): #/dashboard #/prompts #/competitors #/sources #/categories
 *                 #/prompts/:id
 */
(function () {
  'use strict';

  var views = {};
  var LS_BRAND = 'pb.brandId';
  var MODELS = [
    { tag: 'all', label: 'All Models' },
    { tag: 'gpt-4o-mini', label: 'ChatGPT' },
    { tag: 'gemini-2.5-flash', label: 'Gemini' },
    { tag: 'sonar', label: 'Perplexity' },
    { tag: 'google-aio', label: 'Google AI Overview' },
    { tag: 'google-ai-mode', label: 'Google AI Mode' },
  ];
  var RANGES = [
    { v: '7d', label: 'Last 7 days' },
    { v: '30d', label: 'Last 30 days' },
    { v: '90d', label: 'Last 90 days' },
  ];

  var state = { brandId: null, brandName: '', model: 'all', range: '7d', brands: [], pillStats: null };

  // ==========================================================================
  // Top bar pure logic (no DOM). Exposed as window.PBTopbarLogic for tests:
  //   node live-app/tests/topbar.logic.test.mjs
  // ==========================================================================
  var DAY_MS = 86400000;
  var TopbarLogic = {
    // A brand without the detail payload is considered Active if it was
    // analyzed inside this window (the real flag is detail.analysisEnabled).
    ACTIVE_WINDOW_DAYS: 14,

    // 'Active' | 'Paused'. override (true/false) wins, then the real
    // analysisEnabled flag from the brand detail, then the recency heuristic.
    brandStatus: function (brand, detail, override, nowMs) {
      if (override === true) return 'Active';
      if (override === false) return 'Paused';
      if (detail && typeof detail.analysisEnabled === 'boolean') {
        return detail.analysisEnabled ? 'Active' : 'Paused';
      }
      if (!brand || !brand.lastAnalysisAt) return 'Paused';
      var t = new Date(brand.lastAnalysisAt).getTime();
      if (isNaN(t)) return 'Paused';
      var now = (nowMs === undefined) ? Date.now() : nowMs;
      return (now - t) <= TopbarLogic.ACTIVE_WINDOW_DAYS * DAY_MS ? 'Active' : 'Paused';
    },

    // Dropdown row time, product format: '14m ago' '3h ago' '2d ago' 'Nov 11'.
    menuTime: function (iso, nowMs) {
      if (!iso) return 'Never';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return 'Never';
      var now = (nowMs === undefined) ? Date.now() : nowMs;
      var sec = Math.max(0, (now - d.getTime()) / 1000);
      if (sec < 3600) return Math.max(1, Math.floor(sec / 60)) + 'm ago';
      if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
      if (sec < 7 * 86400) return Math.floor(sec / 86400) + 'd ago';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },

    // Manage Brands "Last Run" column, date-fns formatDistanceToNow style.
    manageTime: function (iso, nowMs) {
      if (!iso) return 'Never';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return 'Never';
      var now = (nowMs === undefined) ? Date.now() : nowMs;
      var sec = Math.max(0, (now - d.getTime()) / 1000);
      if (sec < 45) return 'less than a minute ago';
      var min = Math.round(sec / 60);
      if (min < 2) return '1 minute ago';
      if (min < 45) return min + ' minutes ago';
      if (min < 90) return 'about 1 hour ago';
      var hours = Math.round(min / 60);
      if (hours < 24) return 'about ' + hours + ' hours ago';
      var days = Math.round(min / 1440);
      if (days < 2) return '1 day ago';
      if (days < 30) return days + ' days ago';
      var months = Math.round(days / 30);
      if (months < 2) return 'about 1 month ago';
      if (months < 12) return months + ' months ago';
      var years = Math.floor(months / 12);
      return years < 2 ? 'about 1 year ago' : 'about ' + years + ' years ago';
    },

    // Search + status + activity filters, mirrors the product dropdown.
    // statusOf: function(brand) -> 'Active' | 'Paused'
    // status: all | active | processing | failed | idle
    // activity: all | recent (24h) | old (7d+) | never
    filterBrands: function (brands, q, status, activity, statusOf, nowMs) {
      var now = (nowMs === undefined) ? Date.now() : nowMs;
      var f = (q || '').trim().toLowerCase();
      return (brands || []).filter(function (b) {
        if (f) {
          var hay = ((b.name || '') + ' ' + (b.url || '') + ' ' + (b.industry || '')).toLowerCase();
          if (hay.indexOf(f) === -1) return false;
        }
        if (status && status !== 'all') {
          var s = statusOf ? statusOf(b) : 'Paused';
          if (status === 'active' && s !== 'Active') return false;
          if (status === 'idle' && s !== 'Paused') return false;
          // the local mirror has no processing/failed states
          if (status === 'processing' || status === 'failed') return false;
        }
        if (activity && activity !== 'all') {
          var t = b.lastAnalysisAt ? new Date(b.lastAnalysisAt).getTime() : NaN;
          if (activity === 'never') { if (!isNaN(t)) return false; }
          else if (isNaN(t)) { return false; }
          else if (activity === 'recent') { if ((now - t) > DAY_MS) return false; }
          else if (activity === 'old') { if ((now - t) <= 7 * DAY_MS) return false; }
        }
        return true;
      });
    },

    // mode: 'recent' (analyzed first, newest first) | 'az' | 'za'
    sortBrands: function (brands, mode) {
      var copy = (brands || []).slice();
      if (mode === 'az' || mode === 'za') {
        copy.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
        if (mode === 'za') copy.reverse();
        return copy;
      }
      copy.sort(function (a, b) {
        var aa = a.lastAnalysisAt ? 1 : 0, bb = b.lastAnalysisAt ? 1 : 0;
        if (aa !== bb) return bb - aa;
        var byDate = (b.lastAnalysisAt || '').localeCompare(a.lastAnalysisAt || '');
        if (byDate !== 0) return byDate;
        return (a.name || '').localeCompare(b.name || '');
      });
      return copy;
    },

    countActive: function (brands, statusOf) {
      var n = 0;
      (brands || []).forEach(function (b) { if (statusOf(b) === 'Active') n += 1; });
      return n;
    },
  };
  if (typeof window !== 'undefined') window.PBTopbarLogic = TopbarLogic;

  // ==========================================================================
  // Entity name -> domain resolution (pure, no DOM). Exposed as
  // window.PBEntityLogic for tests (node live-app/tests/entity-domain.test.mjs)
  // and as PB.entityDomain for the views.
  //
  // Resolution chain (in priority order):
  //   1. trackedMap   — API-provided urls (own brand + tracked competitors),
  //                     keyed by trimmed lowercased entity name. Views build
  //                     this from PB.state.brands / GET /competitors.
  //   2. citedDomains — domains that actually appear in the API citation data
  //                     on hand (sources[].domain etc). Conservative match:
  //                     the normalized name must EXACTLY equal the normalized
  //                     second-level label of the domain ("Kwik Fit" ->
  //                     "kwikfit" matches kwik-fit.com; no prefix/contains).
  //   3. KNOWN_BRAND_DOMAINS — curated map of real, verified domains for
  //                     well-known brands (ported from the v4 dashboard's
  //                     _entityDomain known map, extended with globally
  //                     unambiguous consumer brands).
  //   4. null         — caller falls back to a letter avatar. We NEVER
  //                     construct or guess a domain from a name (hard rule).
  // ==========================================================================

  // Curated known-brand map. Every entry is a real domain that was verified;
  // never add a constructed/guessed value here.
  var KNOWN_BRAND_DOMAINS = {
    // AI visibility / monitoring tools
    'ai peekaboo': 'aipeekaboo.com',
    'profound': 'tryprofound.com',
    'otterly': 'otterly.ai',
    'scrunch': 'scrunch.ai',
    'peec': 'peec.ai',
    'brandwise': 'brandwise.ai',
    'evertune': 'evertune.ai',
    'rankshift': 'rankshift.ai',
    'athenahq': 'athenahq.com',
    'llm pulse': 'llmpulse.com',
    'rankability': 'rankability.com',
    'geneo': 'geneo.ai',
    'siftly': 'siftly.com',
    'ziptie': 'ziptie.dev',
    'ziptie.dev': 'ziptie.dev',
    'se visible': 'sevisible.com',
    'alarm pulse': 'alarm-pulse.ai',
    'xfunnel': 'xfunnel.ai',
    'am i cited': 'amicited.com',
    'amicited': 'amicited.com',
    'am i on ai?': 'amicited.com',
    'indexly': 'indexly.ai',
    'ayzeo': 'ayzeo.com',
    'rank prompt': 'rankprompt.com',
    'rankprompt': 'rankprompt.com',
    'finseo': 'finseo.ai',
    'allmond': 'allmond.app',
    'allmond.app': 'allmond.app',
    'writesonic': 'writesonic.com',
    'sprout social': 'sproutsocial.com',
    'gumloop': 'gumloop.com',
    'answersocrates': 'answersocrates.com',
    'promptwatch': 'promptwatch.com',
    'visiblie': 'visiblie.com',
    'rankscale': 'rankscale.ai',
    // SEO / keyword research
    'ahrefs': 'ahrefs.com',
    'ahrefs brand radar': 'ahrefs.com',
    'ahrefs webmaster tools': 'ahrefs.com',
    'semrush': 'semrush.com',
    'semrush ai toolkit': 'semrush.com',
    'se ranking': 'seranking.com',
    'se ranking ai toolkit': 'seranking.com',
    'moz': 'moz.com',
    'moz pro': 'moz.com',
    'spyfu': 'spyfu.com',
    'mangools': 'mangools.com',
    'similarweb': 'similarweb.com',
    'majestic': 'majestic.com',
    'clearscope': 'clearscope.io',
    'conductor': 'conductor.com',
    'brightedge': 'brightedge.com',
    'searchmetrics': 'searchmetrics.com',
    'seoclarity': 'seoclarity.net',
    'surfer': 'surferseo.com',
    'surfer seo': 'surferseo.com',
    'marketmuse': 'marketmuse.com',
    'frase': 'frase.io',
    'nightwatch': 'nightwatch.io',
    'keyword.com': 'keyword.com',
    'keyword': 'keyword.com',
    'keyword insights': 'keywordinsights.ai',
    'seo.ai': 'seo.ai',
    // Brand monitoring / social listening
    'brand24': 'brand24.com',
    'brandwatch': 'brandwatch.com',
    'talkwalker': 'talkwalker.com',
    'mention': 'mention.com',
    'awario': 'awario.com',
    'meltwater': 'meltwater.com',
    'sprinklr': 'sprinklr.com',
    'hootsuite': 'hootsuite.com',
    'buzzsumo': 'buzzsumo.com',
    'cision': 'cision.com',
    'keyhole': 'keyhole.co',
    'emplifi': 'emplifi.io',
    'amplitude': 'amplitude.com',
    // Analytics / SaaS
    'google analytics': 'analytics.google.com',
    'hubspot': 'hubspot.com',
    'hotjar': 'hotjar.com',
    'mixpanel': 'mixpanel.com',
    'heap': 'heap.io',
    'salesforce': 'salesforce.com',
    'mailchimp': 'mailchimp.com',
    'slack': 'slack.com',
    'zoom': 'zoom.us',
    'notion': 'notion.so',
    'canva': 'canva.com',
    'figma': 'figma.com',
    'adobe': 'adobe.com',
    'shopify': 'shopify.com',
    'stripe': 'stripe.com',
    'klarna': 'klarna.com',
    // Payments / finance
    'paypal': 'paypal.com',
    'visa': 'visa.com',
    'mastercard': 'mastercard.com',
    'american express': 'americanexpress.com',
    'amex': 'americanexpress.com',
    'revolut': 'revolut.com',
    'wise': 'wise.com',
    // Big tech / consumer electronics
    'google': 'google.com',
    'apple': 'apple.com',
    'microsoft': 'microsoft.com',
    'amazon': 'amazon.com',
    'amazon uk': 'amazon.co.uk',
    'ebay': 'ebay.com',
    'ebay uk': 'ebay.co.uk',
    'aliexpress': 'aliexpress.com',
    'samsung': 'samsung.com',
    'sony': 'sony.com',
    'lg': 'lg.com',
    'philips': 'philips.com',
    'siemens': 'siemens.com',
    'panasonic': 'panasonic.com',
    'dell': 'dell.com',
    'lenovo': 'lenovo.com',
    'asus': 'asus.com',
    'intel': 'intel.com',
    'amd': 'amd.com',
    'nvidia': 'nvidia.com',
    'garmin': 'garmin.com',
    'gopro': 'gopro.com',
    // Retail
    'walmart': 'walmart.com',
    'target': 'target.com',
    'costco': 'costco.com',
    'ikea': 'ikea.com',
    'tesco': 'tesco.com',
    'argos': 'argos.co.uk',
    'halfords': 'halfords.com',
    'screwfix': 'screwfix.com',
    'wickes': 'wickes.co.uk',
    'b&q': 'diy.com',
    // Automotive / parts / tyres
    'bosch': 'bosch.com',
    'brembo': 'brembo.com',
    'denso': 'denso.com',
    'valeo': 'valeo.com',
    'mahle': 'mahle.com',
    'acdelco': 'acdelco.com',
    'liqui moly': 'liqui-moly.com',
    'michelin': 'michelin.com',
    'goodyear': 'goodyear.com',
    'pirelli': 'pirelli.com',
    'bridgestone': 'bridgestone.com',
    'dunlop': 'dunlop.eu',
    'castrol': 'castrol.com',
    'shell': 'shell.com',
    'bp': 'bp.com',
    'kwik fit': 'kwik-fit.com',
    'kwik-fit': 'kwik-fit.com',
    'euro car parts': 'eurocarparts.com',
    'gsf car parts': 'gsfcarparts.com',
    'carwow': 'carwow.co.uk',
    'ats euromaster': 'atseuromaster.co.uk',
    'toyota': 'toyota.com',
    'honda': 'honda.com',
    'ford': 'ford.com',
    'bmw': 'bmw.com',
    'mercedes-benz': 'mercedes-benz.com',
    'audi': 'audi.com',
    'volkswagen': 'volkswagen.com',
    'tesla': 'tesla.com',
    'nissan': 'nissan.com',
    'hyundai': 'hyundai.com',
    'kia': 'kia.com',
    // Apparel / sport
    'nike': 'nike.com',
    'adidas': 'adidas.com',
    'puma': 'puma.com',
    'decathlon': 'decathlon.com',
    // Media / community / travel
    'reddit': 'reddit.com',
    'youtube': 'youtube.com',
    'facebook': 'facebook.com',
    'instagram': 'instagram.com',
    'linkedin': 'linkedin.com',
    'tiktok': 'tiktok.com',
    'x': 'x.com',
    'twitter': 'x.com',
    'wikipedia': 'wikipedia.org',
    'trustpilot': 'trustpilot.com',
    'tripadvisor': 'tripadvisor.com',
    'which?': 'which.co.uk',
    'auto express': 'autoexpress.co.uk',
    'netflix': 'netflix.com',
    'spotify': 'spotify.com',
    'airbnb': 'airbnb.com',
    'uber': 'uber.com',
    'booking.com': 'booking.com',
    'expedia': 'expedia.com',
  };

  var EntityLogic = (function () {
    // Lowercase + trim + strip a trailing ".ai" / " AI" suffix (v4 behavior).
    // Used for the curated-map lookup only.
    function knownKey(name) {
      var n = String(name === null || name === undefined ? '' : name).trim().toLowerCase();
      n = n.replace(/\.ai\s*$/, '');
      n = n.replace(/\s+ai\s*$/, '');
      return n.trim();
    }

    // Aggressive normalization for cited-domain matching: lowercase, then
    // remove ASCII separators/punctuation ONLY. Non-ASCII letters (umlauts,
    // accents) are kept so "Lemförder" ("lemförder") can never collapse to
    // "lemfrder" and falsely match lemfrder.com.
    function normalizeEntityName(name) {
      var n = String(name === null || name === undefined ? '' : name).toLowerCase();
      return n.replace(/[^a-z0-9\u00C0-\uFFFF]+/g, '');
    }

    // "https://www.Kwik-Fit.com/tyres?x=1" -> "kwik-fit.com"
    function cleanHost(urlOrDomain) {
      var d = String(urlOrDomain || '').trim().toLowerCase();
      d = d.replace(/^https?:\/\//, '').replace(/[\/#?].*$/, '');
      d = d.replace(/^www\./, '');
      return d;
    }

    // Second-level label of a domain, handling co.uk / com.br style two-part
    // public suffixes: carwow.co.uk -> "carwow", kwik-fit.com -> "kwik-fit".
    var SECOND_LEVEL_SUFFIXES = { co: 1, com: 1, org: 1, net: 1, gov: 1, edu: 1, ac: 1, mil: 1 };
    function domainSLD(urlOrDomain) {
      var host = cleanHost(urlOrDomain);
      if (!host) return '';
      var labels = host.split('.');
      if (labels.length < 2) return labels[0] || '';
      var last = labels[labels.length - 1];
      var secondLast = labels[labels.length - 2];
      if (labels.length >= 3 && last.length === 2 && SECOND_LEVEL_SUFFIXES[secondLast]) {
        return labels[labels.length - 3];
      }
      return secondLast;
    }

    // Exact normalized-equality match of the entity name against the SLD of
    // each cited domain. No prefix/contains matching, ever.
    function matchCitedDomain(name, citedDomains) {
      var norm = normalizeEntityName(name);
      if (!norm || !citedDomains || !citedDomains.length) return null;
      for (var i = 0; i < citedDomains.length; i++) {
        var host = cleanHost(citedDomains[i]);
        if (!host) continue;
        if (normalizeEntityName(domainSLD(host)) === norm) return host;
      }
      return null;
    }

    // Curated-map lookup (exact key, then ".ai"/" AI"-stripped key).
    // Returns a verified domain or null. NEVER constructs a domain.
    function knownDomain(name) {
      var n = String(name === null || name === undefined ? '' : name).trim().toLowerCase();
      if (!n) return null;
      if (Object.prototype.hasOwnProperty.call(KNOWN_BRAND_DOMAINS, n)) {
        return KNOWN_BRAND_DOMAINS[n];
      }
      var k = knownKey(name);
      if (k && Object.prototype.hasOwnProperty.call(KNOWN_BRAND_DOMAINS, k)) {
        return KNOWN_BRAND_DOMAINS[k];
      }
      return null;
    }

    // Full chain. trackedMap (optional): { lowercased name -> url } from the
    // API (own brand + tracked competitors). Returns a domain string or null.
    function entityDomain(name, citedDomains, trackedMap) {
      if (name === null || name === undefined) return null;
      var key = String(name).trim().toLowerCase();
      if (!key) return null;
      if (trackedMap && Object.prototype.hasOwnProperty.call(trackedMap, key) && trackedMap[key]) {
        return cleanHost(trackedMap[key]) || null;
      }
      var cited = matchCitedDomain(name, citedDomains);
      if (cited) return cited;
      return knownDomain(name);
    }

    return {
      KNOWN_BRAND_DOMAINS: KNOWN_BRAND_DOMAINS,
      normalizeEntityName: normalizeEntityName,
      cleanHost: cleanHost,
      domainSLD: domainSLD,
      matchCitedDomain: matchCitedDomain,
      knownDomain: knownDomain,
      entityDomain: entityDomain,
    };
  })();
  if (typeof window !== 'undefined') window.PBEntityLogic = EntityLogic;

  // ---- DOM builder ----------------------------------------------------------
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'dataset' && typeof v === 'object') Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        else node.setAttribute(k, v);
      });
    }
    appendChildren(node, children);
    return node;
  }
  function appendChildren(node, children) {
    if (children === null || children === undefined || children === false) return;
    if (Array.isArray(children)) { children.forEach(function (c) { appendChildren(node, c); }); return; }
    if (children instanceof Node) { node.appendChild(children); return; }
    node.appendChild(document.createTextNode(String(children)));
  }
  // lucide icon placeholder; window.lucide.createIcons() swaps it for an svg
  // and keeps the class attribute (w-3 h-3 etc come from the compiled CSS).
  function lucideIcon(name, cls) {
    return el('i', { 'data-lucide': name, class: cls || '' });
  }
  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try { window.lucide.createIcons(); } catch (e) { /* icon lib hiccup is non-fatal */ }
    }
  }

  // ---- formatting -----------------------------------------------------------
  var fmt = {
    int: function (n) { return (n === null || n === undefined) ? '—' : Number(n).toLocaleString('en-US'); },
    pct: function (n, d) { return (n === null || n === undefined) ? '—' : Number(n).toFixed(d === undefined ? 0 : d) + '%'; },
    score: function (n) { return (n === null || n === undefined) ? '—' : Math.round(n) + '%'; },
    num1: function (n) { return (n === null || n === undefined) ? '—' : Number(n).toFixed(1); },
    date: function (s) { if (!s) return '—'; var d = new Date(s); return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); },
    rel: function (s) { if (!s) return '—'; var d = new Date(s), diff = (new Date() - d) / 1000; if (diff < 3600) return Math.max(1, Math.round(diff / 60)) + 'm ago'; if (diff < 86400) return Math.round(diff / 3600) + 'h ago'; return Math.round(diff / 86400) + 'd ago'; },
    trafficK: function (n) { if (n === null || n === undefined) return '—'; if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(n); },
  };

  function modelLabel(tag) { var m = MODELS.find(function (x) { return x.tag === tag; }); return m ? m.label : tag; }
  function modelLogo(tag) {
    var map = {
      'gpt-4o-mini': '/logos/openai.png',
      'gemini-2.5-flash': '/logos/gem-logo.png',
      'sonar': '/logos/perplexity.png',
      'google-aio': '/logos/google-logo.png',
      'google-ai-mode': '/logos/google-logo.png',
    };
    return map[tag] || '/logos/google-logo.png';
  }
  function favicon(domain) {
    if (!domain) return '';
    var clean = String(domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return 'https://www.google.com/s2/favicons?sz=64&domain=' + encodeURIComponent(clean);
  }

  // ---- toast ----------------------------------------------------------------
  function ensureToast() {
    var host = document.getElementById('toast');
    if (!host) { host = el('div', { id: 'toast' }); document.body.appendChild(host); }
    return host;
  }
  function toast(msg, isError) {
    var host = ensureToast();
    var t = el('div', { class: 'pb-toast' + (isError ? ' pb-toast-err' : ''), text: msg });
    host.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; }, 3200);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3700);
  }

  // ---- shadcn card (matches the product's card chrome) ----------------------
  function card(titleNode, bodyNode, opts) {
    opts = opts || {};
    var head = el('div', { class: 'flex flex-col space-y-1.5 p-6 px-4 pt-3 pb-1' }, [
      el('div', { class: 'flex items-center justify-between' }, [titleNode, opts.right || null]),
    ]);
    return el('div', { class: 'rounded-lg border bg-card text-card-foreground shadow-sm' }, [
      head, el('div', { class: 'p-6 px-4 pb-3 pt-1' }, [bodyNode]),
    ]);
  }
  function cardTitle(text, sub) {
    return el('div', {}, [
      el('div', { class: 'font-semibold tracking-tight text-base leading-tight', text: text }),
      sub ? el('div', { class: 'text-[11px] text-muted-foreground mt-0.5', text: sub }) : null,
    ]);
  }

  // ---- skeleton / error -----------------------------------------------------
  function skeleton(root) {
    root.innerHTML = '';
    var g = el('div', { class: 'space-y-4' });
    for (var i = 0; i < 3; i++) {
      g.appendChild(el('div', { class: 'rounded-lg border bg-card shadow-sm', style: { height: '170px' } }, [
        el('div', { class: 'p-4' }, [
          el('div', { class: 'pb-skel', style: { width: '160px', height: '14px', marginBottom: '12px' } }),
          el('div', { class: 'pb-skel', style: { width: '100%', height: '110px' } }),
        ]),
      ]));
    }
    root.appendChild(g);
  }
  function errorState(root, err) {
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'rounded-lg border bg-card shadow-sm p-8' }, [
      el('div', { class: 'text-base font-semibold mb-1', text: 'Could not load data' }),
      el('div', { class: 'text-sm text-muted-foreground mb-3', text: (err && err.message) || 'Unknown error' }),
      el('button', { class: 'inline-flex items-center rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50', onclick: function () { route(); } }, 'Retry'),
    ]));
  }

  // ---- sidebar (enhance the real embedded shell) ----------------------------
  // The product marks the active nav item with real Tailwind classes
  // (text-gray-900 bg-gray-100 font-medium + before:* 3x16px purple bar).
  // These class lists are copied verbatim from the captured live markup.
  var NAV_ACTIVE_CLASSES = ['text-gray-900', 'bg-gray-100', 'font-medium',
    'before:absolute', 'before:left-0', 'before:top-1/2', 'before:-translate-y-1/2',
    'before:h-4', 'before:w-[3px]', 'before:rounded-full', 'before:bg-brand'];
  var NAV_INACTIVE_CLASSES = ['text-gray-500', 'dark:text-gray-400',
    'hover:text-gray-900', 'dark:hover:text-white',
    'hover:bg-gray-50', 'dark:hover:bg-gray-800/50'];
  var ICON_ACTIVE_CLASSES = ['text-gray-700', 'dark:text-gray-200'];
  var ICON_INACTIVE_CLASSES = ['text-gray-400', 'group-hover:text-gray-600', 'dark:group-hover:text-gray-300'];

  // The logo anchor also points at #/dashboard but must NEVER get the
  // active-nav treatment (no gray background, no purple bar on the logo).
  function isLogoLink(a) {
    if (!a) return false;
    if ((a.getAttribute('aria-label') || '') === 'PeekABoo home') return true;
    return !!a.querySelector('img[alt="Peekaboo Logo"]');
  }

  function setNavActive(a, on) {
    NAV_ACTIVE_CLASSES.forEach(function (c) { a.classList.toggle(c, on); });
    NAV_INACTIVE_CLASSES.forEach(function (c) { a.classList.toggle(c, !on); });
    a.classList.toggle('pb-active', on); // fallback hook for live-overrides.css
    var icon = a.querySelector('svg');
    if (icon) {
      ICON_ACTIVE_CLASSES.forEach(function (c) { icon.classList.toggle(c, on); });
      ICON_INACTIVE_CLASSES.forEach(function (c) { icon.classList.toggle(c, !on); });
    }
  }

  function enhanceSidebar() {
    // active state — the logo link is skipped and always stripped of any
    // active decoration so the wordmark sits clean on the white sidebar
    var current = '#/' + currentRoute();
    document.querySelectorAll('a[href^="#/"]').forEach(function (a) {
      if (isLogoLink(a)) {
        a.classList.remove('pb-active');
        NAV_ACTIVE_CLASSES.forEach(function (c) { a.classList.remove(c); });
        return;
      }
      setNavActive(a, a.getAttribute('href') === current);
    });
  }

  // ---- header (build into the real <header>) --------------------------------
  // Inline lucide SVGs (exact paths from the live capture) so the dropdowns
  // never depend on lucide.createIcons() timing.
  var SVG_LAYERS = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"></path><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"></path><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"></path></svg>';
  var SVG_CHEVRON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>';
  var SVG_CHECK = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>';
  var SVG_CALENDAR = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"></path><path d="M16 2v4"></path><rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M3 10h18"></path></svg>';

  // icon node for a model row / trigger: layers glyph for "all", favicon otherwise
  function modelIconNode(tag) {
    if (tag === 'all') {
      return el('span', { class: 'pb-dd-icon text-muted-foreground', html: SVG_LAYERS });
    }
    return el('img', { class: 'pb-dd-fav', src: modelLogo(tag), alt: '', width: '16', height: '16' });
  }

  function rangeLabel() {
    var r = RANGES.find(function (x) { return x.v === state.range; });
    return r ? r.label : RANGES[0].label;
  }

  // ---- Calendar date-picker dropdown ----------------------------------------
  // Builds a panel matching the live aipeekaboo.com date-picker:
  //   - 3 preset pills (Last 7 / 30 / 90 days)
  //   - Two-month react-day-picker (rdp-*) calendar for custom ranges
  //   - Footer with range text + Cancel / Apply buttons
  // The rdp-* CSS lives in b4998bd64e5f1f65.css which is already in index.html.

  var SVG_CHEVRON_LEFT = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"></path></svg>';
  var SVG_CHEVRON_RIGHT = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg>';

  var MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var DAY_ABBRS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  function buildDatePickerDropdown() {
    // ---- state local to this picker instance ----
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    // Convert current state.range preset to a start/end pair for display
    function presetDates(v) {
      var end = new Date(today);
      var start = new Date(today);
      if (v === '7d') { start.setDate(start.getDate() - 6); }
      else if (v === '30d') { start.setDate(start.getDate() - 29); }
      else if (v === '90d') { start.setDate(start.getDate() - 89); }
      return { start: start, end: end };
    }

    var pd = presetDates(state.range);
    var pickerState = {
      preset: state.range,
      rangeStart: pd.start,
      rangeEnd: pd.end,
      // calendar shows two months; leftMonth = the earlier one
      leftYear: today.getFullYear(),
      leftMonth: today.getMonth() - 1 < 0 ? 11 : today.getMonth() - 1,
      leftMonthYear: today.getMonth() - 1 < 0 ? today.getFullYear() - 1 : today.getFullYear(),
      hoverDay: null,
      selecting: false, // mid-selection: first click done, waiting for second
      selStart: null,
    };
    // Normalise so leftMonth is always the month before today's month
    pickerState.leftMonth = today.getMonth() - 1 < 0 ? 11 : today.getMonth() - 1;
    pickerState.leftMonthYear = today.getMonth() - 1 < 0 ? today.getFullYear() - 1 : today.getFullYear();

    var rightMonth = today.getMonth();
    var rightMonthYear = today.getFullYear();

    function formatDate(d) {
      return MONTH_NAMES[d.getMonth()].slice(0,3) + ' ' + String(d.getDate()).padStart(2,'0') + ', ' + d.getFullYear();
    }

    function isSameDay(a, b) {
      return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }

    function daysBetween(a, b) {
      return (b - a) / 86400000;
    }

    // ---- outer trigger (same style as model dropdown) ----
    var triggerBtn = el('button', {
      type: 'button',
      class: 'pb-dd-trigger',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
    }, [
      el('span', { class: 'pb-dd-icon text-muted-foreground', html: SVG_CALENDAR }),
      el('span', { class: 'pb-dd-label', id: 'pb-range-label', text: rangeLabel() }),
      el('span', { class: 'pb-dd-chevron', html: SVG_CHEVRON }),
    ]);

    // ---- panel ----
    var panel = el('div', {
      role: 'dialog',
      class: 'pb-dd-panel pb-calendar-panel w-auto p-0 overflow-hidden rounded-2xl shadow-[0_8px_32px_-4px_rgba(0,0,0,0.12),0_2px_8px_-2px_rgba(0,0,0,0.06)]',
      style: { display: 'none', position: 'absolute', zIndex: '200', right: '0', top: 'calc(100% + 6px)',
               border: '1px solid rgba(0,0,0,0.06)', background: '#ffffff', minWidth: '580px' },
    });

    // We'll rebuild panel contents whenever state changes
    function renderPanel() {
      panel.innerHTML = '';

      // ---- preset pills row ----
      var pillsRow = el('div', { class: 'flex gap-1 p-3', style: { paddingBottom: '8px' } });
      RANGES.forEach(function (r) {
        var active = pickerState.preset === r.v;
        var pill = el('button', {
          type: 'button',
          class: 'px-3 h-7 text-xs rounded-full transition-colors focus-visible:outline-none' +
            (active ? ' font-medium' : ' text-muted-foreground hover:bg-muted hover:text-foreground'),
          style: active ? { background: 'color-mix(in srgb, var(--theme-primary) 12%, transparent)',
                            color: 'var(--theme-primary)' } : {},
          text: r.label,
        });
        pill.addEventListener('click', function () {
          pickerState.preset = r.v;
          var dates = presetDates(r.v);
          pickerState.rangeStart = dates.start;
          pickerState.rangeEnd = dates.end;
          pickerState.selecting = false;
          pickerState.selStart = null;
          renderPanel();
        });
        pillsRow.appendChild(pill);
      });
      panel.appendChild(pillsRow);

      // ---- rdp calendar ----
      var rdpRoot = el('div', {
        class: 'rdp-root p-3 [&_.rdp-month_caption]:text-base [&_.rdp-month_caption]:font-semibold [&_.rdp-months]:gap-6',
        'data-mode': 'range',
        'data-multiple-months': 'true',
      });
      rdpRoot.style.cssText = [
        '--rdp-accent-color: var(--theme-primary)',
        '--rdp-accent-background-color: color-mix(in srgb, var(--theme-primary) 10%, transparent)',
        '--rdp-day_button-border-radius: 9999px',
        '--rdp-day_button-border: 0',
        '--rdp-day-height: 2.5rem',
        '--rdp-day-width: 2.5rem',
        '--rdp-day_button-hover-background-color: rgba(0,0,0,0.04)',
        '--rdp-today-color: var(--theme-primary)',
        '--rdp-range_start-background: var(--theme-primary)',
        '--rdp-range_end-background: var(--theme-primary)',
        '--rdp-range_middle-background-color: color-mix(in srgb, var(--theme-primary) 10%, transparent)',
        '--rdp-range_middle-color: inherit',
        '--rdp-outside-opacity: 0.4',
      ].join(';');

      var monthsDiv = el('div', { class: 'rdp-months' });

      // nav prev/next
      var nav = el('nav', { class: 'rdp-nav', 'aria-label': '' });
      var prevBtn = el('button', { type: 'button', class: 'rdp-button_previous', 'aria-label': 'Go to the Previous Month', html: SVG_CHEVRON_LEFT });
      var nextBtn = el('button', { type: 'button', class: 'rdp-button_next', 'aria-label': 'Go to the Next Month', html: SVG_CHEVRON_RIGHT });
      prevBtn.addEventListener('click', function () {
        pickerState.leftMonth--;
        if (pickerState.leftMonth < 0) { pickerState.leftMonth = 11; pickerState.leftMonthYear--; }
        rightMonth = pickerState.leftMonth + 1;
        rightMonthYear = pickerState.leftMonthYear;
        if (rightMonth > 11) { rightMonth = 0; rightMonthYear++; }
        renderPanel();
      });
      nextBtn.addEventListener('click', function () {
        pickerState.leftMonth++;
        if (pickerState.leftMonth > 11) { pickerState.leftMonth = 0; pickerState.leftMonthYear++; }
        rightMonth = pickerState.leftMonth + 1;
        rightMonthYear = pickerState.leftMonthYear;
        if (rightMonth > 11) { rightMonth = 0; rightMonthYear++; }
        renderPanel();
      });
      nav.appendChild(prevBtn);
      nav.appendChild(nextBtn);
      monthsDiv.appendChild(nav);

      // two month grids
      [
        { year: pickerState.leftMonthYear, month: pickerState.leftMonth },
        { year: rightMonthYear, month: rightMonth },
      ].forEach(function (m) {
        monthsDiv.appendChild(buildMonthGrid(m.year, m.month));
      });

      rdpRoot.appendChild(monthsDiv);
      panel.appendChild(rdpRoot);

      // ---- footer ----
      var rs = pickerState.rangeStart;
      var re = pickerState.rangeEnd;
      var rangeText = (rs && re) ? (formatDate(rs) + ' – ' + formatDate(re)) : 'Select a date range';
      var applyEnabled = rs && re && !isSameDay(rs, re);
      var footer = el('div', {
        class: 'flex items-center justify-between gap-3 px-3 border-t',
        style: { paddingTop: '10px', paddingBottom: '10px', borderColor: 'rgba(var(--border-rgb, 0,0,0), 0.1)' },
      });
      var rangeSpan = el('span', { class: 'text-xs text-muted-foreground truncate', text: rangeText });
      var btnsDiv = el('div', { class: 'flex items-center gap-1.5 flex-shrink-0' });
      var cancelBtn = el('button', {
        type: 'button',
        class: 'inline-flex items-center justify-center whitespace-nowrap font-medium rounded-md px-3 h-7 text-xs hover:bg-accent hover:text-accent-foreground transition-colors',
        text: 'Cancel',
      });
      var applyBtn = el('button', {
        type: 'button',
        class: 'inline-flex items-center justify-center whitespace-nowrap font-medium rounded-md px-3 h-7 text-xs text-white transition-colors',
        style: { background: 'var(--theme-primary)', opacity: applyEnabled ? '1' : '0.4', cursor: applyEnabled ? 'pointer' : 'default' },
        text: 'Apply',
      });
      if (!applyEnabled) { applyBtn.setAttribute('disabled', ''); }
      cancelBtn.addEventListener('click', function () { closePanel(); });
      applyBtn.addEventListener('click', function () {
        if (!applyEnabled) return;
        // Find closest preset match or stay as custom
        var matched = null;
        RANGES.forEach(function (r) {
          var dates = presetDates(r.v);
          if (isSameDay(dates.start, pickerState.rangeStart) && isSameDay(dates.end, pickerState.rangeEnd)) {
            matched = r.v;
          }
        });
        state.range = matched || pickerState.preset || '7d';
        var labelEl = triggerBtn.querySelector('#pb-range-label');
        if (labelEl) { labelEl.textContent = rangeLabel(); }
        closePanel();
        route();
        renderHeader();
      });
      btnsDiv.appendChild(cancelBtn);
      btnsDiv.appendChild(applyBtn);
      footer.appendChild(rangeSpan);
      footer.appendChild(btnsDiv);
      panel.appendChild(footer);
    }

    function buildMonthGrid(year, month) {
      var monthDiv = el('div', { class: 'rdp-month' });
      var caption = el('div', { class: 'rdp-month_caption' });
      caption.appendChild(el('span', { class: 'rdp-caption_label', role: 'status', 'aria-live': 'polite',
                                        text: MONTH_NAMES[month] + ' ' + year }));
      monthDiv.appendChild(caption);

      var table = el('table', { role: 'grid', 'aria-multiselectable': 'true',
                                 'aria-label': MONTH_NAMES[month] + ' ' + year, class: 'rdp-month_grid' });
      var thead = document.createElement('thead');
      thead.setAttribute('aria-hidden', 'true');
      var headRow = el('tr', { class: 'rdp-weekdays' });
      var fullDayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      DAY_ABBRS.forEach(function (d, i) {
        headRow.appendChild(el('th', { class: 'rdp-weekday', scope: 'col', 'aria-label': fullDayNames[i], text: d }));
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      var tbody = el('tbody', { class: 'rdp-weeks' });

      // Build day grid
      var firstDay = new Date(year, month, 1);
      var startDow = firstDay.getDay(); // 0=Sun
      var daysInMonth = new Date(year, month + 1, 0).getDate();
      var prevMonthDays = new Date(year, month, 0).getDate();

      var cells = [];
      // leading cells from previous month
      for (var i = 0; i < startDow; i++) {
        cells.push({ day: prevMonthDays - startDow + 1 + i, month: month - 1, year: year, outside: true });
      }
      // current month
      for (var d = 1; d <= daysInMonth; d++) {
        cells.push({ day: d, month: month, year: year, outside: false });
      }
      // trailing cells
      var remainder = cells.length % 7;
      if (remainder > 0) {
        for (var t = 1; t <= 7 - remainder; t++) {
          cells.push({ day: t, month: month + 1, year: year, outside: true });
        }
      }

      for (var row = 0; row < cells.length / 7; row++) {
        var tr = el('tr', { class: 'rdp-week' });
        for (var col = 0; col < 7; col++) {
          var cell = cells[row * 7 + col];
          var cellDate = new Date(cell.year, cell.month, cell.day);
          cellDate.setHours(0, 0, 0, 0);
          var isTodayDay = isSameDay(cellDate, today);
          var isStart = pickerState.rangeStart && isSameDay(cellDate, pickerState.rangeStart);
          var isEnd = pickerState.rangeEnd && isSameDay(cellDate, pickerState.rangeEnd);
          var isMiddle = false;
          if (pickerState.rangeStart && pickerState.rangeEnd && !isStart && !isEnd) {
            isMiddle = cellDate > pickerState.rangeStart && cellDate < pickerState.rangeEnd;
          }
          var tdClass = 'rdp-day';
          if (cell.outside) { tdClass += ' rdp-outside'; }
          if (isTodayDay) { tdClass += ' rdp-today'; }
          if (isStart) { tdClass += ' rdp-range_start rdp-selected'; }
          if (isEnd) { tdClass += ' rdp-range_end rdp-selected'; }
          if (isMiddle) { tdClass += ' rdp-range_middle'; }
          var td = el('td', { class: tdClass, role: 'gridcell',
                               'data-day': cell.year + '-' + String(cell.month+1).padStart(2,'0') + '-' + String(cell.day).padStart(2,'0') });
          var btnClass = 'rdp-day_button';
          var dayBtn = el('button', { type: 'button', class: btnClass,
                                       tabindex: cell.outside ? '-1' : '0',
                                       'aria-label': fullDayNames[cellDate.getDay()] + ', ' + MONTH_NAMES[cell.month] + ' ' + cell.day });
          dayBtn.textContent = cell.day;
          (function(d) {
            dayBtn.addEventListener('click', function () {
              if (!pickerState.selecting) {
                pickerState.selecting = true;
                pickerState.selStart = new Date(d);
                pickerState.rangeStart = new Date(d);
                pickerState.rangeEnd = null;
                pickerState.preset = null;
              } else {
                pickerState.selecting = false;
                var clickedDate = new Date(d);
                if (clickedDate < pickerState.selStart) {
                  pickerState.rangeStart = clickedDate;
                  pickerState.rangeEnd = new Date(pickerState.selStart);
                } else {
                  pickerState.rangeStart = new Date(pickerState.selStart);
                  pickerState.rangeEnd = clickedDate;
                }
                pickerState.selStart = null;
              }
              renderPanel();
            });
          })(cellDate);
          td.appendChild(dayBtn);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      monthDiv.appendChild(table);
      return monthDiv;
    }

    // ---- open/close logic ----
    var isOpen = false;

    function openPanel() {
      isOpen = true;
      triggerBtn.setAttribute('aria-expanded', 'true');
      triggerBtn.classList.add('pb-dd-open');
      renderPanel();
      panel.style.display = '';
    }

    function closePanel() {
      isOpen = false;
      triggerBtn.setAttribute('aria-expanded', 'false');
      triggerBtn.classList.remove('pb-dd-open');
      panel.style.display = 'none';
    }

    triggerBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isOpen) { closePanel(); } else { openPanel(); }
    });

    document.addEventListener('click', function (e) {
      if (isOpen && !wrapper.contains(e.target)) { closePanel(); }
    });

    document.addEventListener('keydown', function (e) {
      if (isOpen && e.key === 'Escape') { closePanel(); }
    });

    var wrapper = el('div', { class: 'pb-dd-wrap', style: { position: 'relative' } }, [triggerBtn, panel]);
    return wrapper;
  }

  function renderHeader() {
    var header = document.querySelector('header');
    if (!header) return;
    header.innerHTML = '';
    var modelsDD = buildDropdown({
      ariaLabel: 'Model filter: ' + modelLabel(state.model),
      triggerIcon: modelIconNode(state.model),
      label: modelLabel(state.model),
      items: MODELS.map(function (m) {
        return { label: m.label, value: m.tag, active: m.tag === state.model, icon: modelIconNode(m.tag) };
      }),
      dividerAfterFirst: true,
      onPick: function (val) { state.model = val; route(); renderHeader(); },
    });
    var rangeDD = buildDatePickerDropdown();
    var inner = el('div', { class: 'max-w-7xl mx-auto px-3 sm:px-6 lg:px-8' }, [
      el('div', { class: 'flex items-center justify-between gap-2 h-14 md:gap-4 md:h-16' }, [
        el('div', { class: 'flex items-center gap-2 sm:gap-4 min-w-0 flex-1 md:flex-none md:w-auto' }, [buildBrandPill()]),
        el('div', { class: 'flex items-center gap-2 flex-shrink-0 md:gap-3' }, [modelsDD, rangeDD]),
      ]),
    ]);
    header.appendChild(inner);
    if (window.lucide) window.lucide.createIcons();
  }

  // ==========================================================================
  // Brand detail enrichment (location / promptCount / analysisEnabled).
  // The /brands list is thin; details arrive lazily via GET /brands/:id with
  // a small concurrency + session budget so the upstream rate limit is safe.
  // Cached in localStorage so reopening the dropdown is instant.
  // ==========================================================================
  var LS_DETAILS = 'pb.brandDetails.v1';
  var brandDetails = {};
  var DETAIL_TTL_MS = 24 * 3600 * 1000;
  var DETAIL_CONCURRENCY = 2;
  var DETAIL_SESSION_BUDGET = 40;
  var detailQueue = [];
  var detailPending = {};
  var detailActive = 0;
  var detailFetched = 0;
  var detailListeners = {};   // name -> fn, repaint hooks for open popovers

  function loadDetailCache() {
    try {
      var raw = localStorage.getItem(LS_DETAILS);
      if (raw) brandDetails = JSON.parse(raw) || {};
    } catch (e) { brandDetails = {}; }
  }
  function saveDetailCache() {
    try { localStorage.setItem(LS_DETAILS, JSON.stringify(brandDetails)); } catch (e) { /* quota */ }
  }
  function detailFor(id) { return brandDetails[id] || null; }
  function detailIsFresh(d) { return !!d && (Date.now() - (d.fetchedAt || 0)) < DETAIL_TTL_MS; }
  function notifyDetailListeners() {
    Object.keys(detailListeners).forEach(function (k) {
      try { detailListeners[k](); } catch (e) { /* one bad painter must not stop the rest */ }
    });
  }
  function requestDetails(ids) {
    (ids || []).forEach(function (id) {
      if (!id || detailPending[id] || detailIsFresh(brandDetails[id])) return;
      detailPending[id] = true;
      detailQueue.push(id);
    });
    pumpDetails();
  }
  function pumpDetails() {
    while (detailActive < DETAIL_CONCURRENCY && detailQueue.length && detailFetched < DETAIL_SESSION_BUDGET) {
      (function (id) {
        detailActive += 1;
        detailFetched += 1;
        window.PBApi.brand(id).then(function (d) {
          brandDetails[id] = {
            location: d.location || null,
            promptCount: (d.promptCount === undefined ? null : d.promptCount),
            competitorCount: (d.competitorCount === undefined ? null : d.competitorCount),
            analysisEnabled: (typeof d.analysisEnabled === 'boolean' ? d.analysisEnabled : null),
            fetchedAt: Date.now(),
          };
          saveDetailCache();
        }).catch(function () { /* leave uncached, heuristic status still works */ })
          .then(function () {
            detailActive -= 1;
            delete detailPending[id];
            notifyDetailListeners();
            pumpDetails();
          });
      })(detailQueue.shift());
    }
  }

  // local-only Manage Brands state (the mirror never writes to the real API)
  var localToggles = {};   // id -> true (active) / false (paused)
  var localDeleted = {};   // id -> true

  function statusOf(b) {
    var ov;
    if (Object.prototype.hasOwnProperty.call(localToggles, b.id)) ov = localToggles[b.id];
    return TopbarLogic.brandStatus(b, detailFor(b.id), ov);
  }
  function liveBrands() {
    return state.brands.filter(function (b) { return !localDeleted[b.id]; });
  }

  // ==========================================================================
  // Brand switcher trigger + dropdown (replica of app/brandmenu-open.html).
  // The open/close animations reuse the product's own compiled
  // tailwindcss-animate utilities by toggling data-state on the menu node.
  // ==========================================================================
  var BRAND_TRIGGER_CLS = 'justify-center whitespace-nowrap text-sm font-medium ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 py-2 flex items-center gap-2 px-2 sm:px-3 h-9 w-fit max-w-full bg-white border border-gray-200 rounded-md hover:shadow-lg hover:border-gray-300 transition-all duration-200 group relative flex-shrink-0';
  var BRAND_MENU_CLS = 'z-50 text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 w-fit min-w-[200px] p-0 border border-gray-200 shadow-xl bg-white rounded-xl overflow-hidden';
  var BRAND_ROW_CLS = 'relative select-none text-sm outline-none flex items-center gap-2 px-2 py-2 rounded cursor-pointer transition-all duration-150 w-fit min-w-full';
  var MENU_FOOTER_ITEM_CLS = 'relative select-none text-sm outline-none flex items-center gap-2 px-2 py-2 rounded transition-all duration-150 w-fit min-w-full hover:bg-white cursor-pointer';

  function brandFaviconImg(b, size) {
    return el('img', {
      alt: b.name || '', width: size, height: size, loading: 'lazy',
      class: 'rounded object-contain bg-white border border-gray-200/60 shadow-sm',
      src: favicon(b.url),
      style: { width: size + 'px', height: size + 'px' },
      onerror: function () { this.style.visibility = 'hidden'; },
    });
  }
  function brandStatusBadge(status) {
    var cls = status === 'Active'
      ? 'bg-green-50 text-green-700 border-green-200'
      : 'bg-gray-50 text-gray-600 border-gray-200';
    return el('div', { class: 'inline-flex items-center rounded-full border font-semibold transition-colors text-[10px] px-1.5 py-0.5 ' + cls, text: status });
  }

  function buildBrandPill() {
    var current = state.brands.find(function (b) { return b.id === state.brandId; }) || { name: state.brandName || 'Select brand', url: '' };
    var currentStatus = current.id ? statusOf(current) : 'Paused';

    var stats = state.pillStats;
    var statBits = stats ? el('div', { class: 'hidden xl:flex items-center gap-3 text-xs flex-shrink-0 border-l border-gray-200 pl-3' }, [
      statPair('Visibility', fmt.score(stats.visibility)),
      statPair('Sentiment', stats.sentiment != null ? fmt.pct(stats.sentiment) : '—'),
      statPair('Avg Position', stats.position != null ? fmt.num1(stats.position) : '—'),
    ]) : null;

    // chevron wrapper span rotates as a unit after lucide swaps the <i>
    var chevWrap = el('span', { class: 'flex-shrink-0 transition-all duration-200 flex items-center' }, [
      lucideIcon('chevron-down', 'w-4 h-4 text-gray-400 group-hover:text-gray-600'),
    ]);

    var btn = el('button', {
      type: 'button',
      class: BRAND_TRIGGER_CLS,
      'aria-label': 'Current brand: ' + (current.name || ''),
      'aria-haspopup': 'true',
      'aria-expanded': 'false',
    }, [
      el('div', { class: 'relative flex-shrink-0' }, [
        el('div', { class: 'w-6 h-6 bg-gradient-to-br from-brand/20 to-brand-secondary/20 rounded-md flex items-center justify-center' }, [
          current.url ? brandFaviconImg(current, 24) : null,
        ]),
        el('div', { class: 'absolute -bottom-0.5 -right-0.5 flex items-center justify-center w-2.5 h-2.5 bg-white rounded-full shadow-sm' }, [
          el('div', { class: 'w-2 h-2 rounded-full ' + (currentStatus === 'Active' ? 'bg-green-500' : 'bg-gray-400'), 'aria-label': 'Status: ' + currentStatus }),
        ]),
      ]),
      el('div', { class: 'flex items-center gap-1.5 min-w-0' }, [
        el('span', { class: 'font-semibold text-gray-900 text-sm truncate max-w-[140px] sm:max-w-[120px] md:max-w-none md:whitespace-nowrap', title: current.name, text: current.name || 'Select brand' }),
      ]),
      statBits,
      chevWrap,
    ]);

    var container = el('div', { class: 'relative flex items-center' }, [btn]);
    var menu = null;

    function closeMenu() {
      if (!menu) return;
      var m = menu; menu = null;
      delete detailListeners.brandMenu;
      m.setAttribute('data-state', 'closed');
      btn.setAttribute('aria-expanded', 'false');
      chevWrap.classList.remove('rotate-180');
      document.removeEventListener('click', onOutside);
      document.removeEventListener('keydown', onKey);
      setTimeout(function () { if (m.parentNode) m.parentNode.removeChild(m); }, 140);
    }
    function onOutside(e) { if (menu && !container.contains(e.target)) closeMenu(); }
    function onKey(e) { if (e.key === 'Escape') closeMenu(); }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu) { closeMenu(); return; }
      menu = buildBrandMenu(closeMenu);
      container.appendChild(menu);
      btn.setAttribute('aria-expanded', 'true');
      chevWrap.classList.add('rotate-180');
      refreshIcons();
      var search = menu.querySelector('input[type="text"]');
      setTimeout(function () {
        if (search) search.focus();
        document.addEventListener('click', onOutside);
        document.addEventListener('keydown', onKey);
      }, 0);
    });

    setTimeout(refreshIcons, 0);
    return container;
  }

  function buildBrandMenu(closeMenu) {
    var controls = { q: '', sort: 'recent', status: 'all', activity: 'all' };
    var brands = liveBrands();
    var total = brands.length;
    var active = TopbarLogic.countActive(brands, statusOf);

    var menu = el('div', {
      class: BRAND_MENU_CLS,
      role: 'menu',
      'data-state': 'open',
      'data-side': 'bottom',
      'data-align': 'start',
      style: {
        position: 'absolute', left: '0', top: 'calc(100% + 6px)',
        transformOrigin: 'top left', display: 'flex', flexDirection: 'column',
      },
    });

    // ---- gradient header: title + plan badge + counts + search/sort/filters
    var searchInput = el('input', {
      type: 'text', placeholder: 'Search...',
      class: 'w-full pl-6 pr-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500',
    });
    searchInput.addEventListener('input', function () { controls.q = searchInput.value; paintList(); });
    searchInput.addEventListener('click', function (e) { e.stopPropagation(); });

    var sortLabel = el('span', { class: 'text-[10px] font-bold', text: 'A' });
    var sortBtn = el('button', {
      type: 'button',
      class: 'px-2 py-1 rounded text-xs font-medium hover:bg-gray-200 transition-colors border text-gray-500 bg-white border-gray-200',
      title: 'Sort alphabetically: Click to sort A-Z',
    }, [
      el('div', { class: 'flex items-center gap-0.5' }, [sortLabel, lucideIcon('arrow-up-down', 'w-2.5 h-2.5')]),
    ]);
    sortBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      controls.sort = controls.sort === 'recent' ? 'az' : (controls.sort === 'az' ? 'za' : 'recent');
      var sorting = controls.sort !== 'recent';
      sortBtn.className = 'px-2 py-1 rounded text-xs font-medium hover:bg-gray-200 transition-colors border ' +
        (sorting ? 'text-gray-900 bg-gray-100 border-gray-300' : 'text-gray-500 bg-white border-gray-200');
      sortLabel.textContent = controls.sort === 'za' ? 'Z' : 'A';
      sortBtn.title = controls.sort === 'az' ? 'Sorted A-Z: Click to sort Z-A'
        : (controls.sort === 'za' ? 'Sorted Z-A: Click to reset' : 'Sort alphabetically: Click to sort A-Z');
      paintList();
    });

    var statusSel = el('select', {
      class: 'px-2 py-1 text-xs border border-gray-200 rounded bg-white hover:border-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500',
    }, [
      el('option', { value: 'all', text: 'All Status' }),
      el('option', { value: 'active', text: '✅ Active' }),
      el('option', { value: 'processing', text: '🔄 Processing' }),
      el('option', { value: 'failed', text: '❌ Failed' }),
      el('option', { value: 'idle', text: '⏸️ Idle' }),
    ]);
    var activitySel = el('select', {
      class: 'px-2 py-1 text-xs border border-gray-200 rounded bg-white hover:border-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500',
    }, [
      el('option', { value: 'all', text: 'All Activity' }),
      el('option', { value: 'recent', text: '🕐 Recent (24h)' }),
      el('option', { value: 'old', text: '📅 Older (7d+)' }),
      el('option', { value: 'never', text: '❓ Never run' }),
    ]);
    statusSel.addEventListener('change', function () { controls.status = statusSel.value; paintList(); });
    activitySel.addEventListener('change', function () { controls.activity = activitySel.value; paintList(); });
    statusSel.addEventListener('click', function (e) { e.stopPropagation(); });
    activitySel.addEventListener('click', function (e) { e.stopPropagation(); });

    var headerBox = el('div', { class: 'bg-gradient-to-r from-gray-50 to-gray-100 px-3 py-2 border-b border-gray-200' }, [
      el('div', { class: 'flex items-center justify-between' }, [
        el('div', { class: 'flex items-center gap-2' }, [
          el('h3', { class: 'font-semibold text-xs text-gray-900', text: 'Switch Brand' }),
          el('div', { class: 'flex items-center gap-1' }, [
            el('div', { class: 'inline-flex items-center rounded-full border font-semibold transition-colors text-[10px] px-1 py-0 flex-shrink-0 bg-orange-50 text-orange-600 border-orange-200', text: 'Custom Plan' }),
          ]),
        ]),
        el('div', { class: 'flex items-center gap-2' }, [
          el('span', { class: 'text-xs text-gray-500', title: active + ' active brands out of ' + total, text: active + '/' + total + ' active' }),
        ]),
      ]),
      el('div', { class: 'mt-2 space-y-2' }, [
        el('div', { class: 'flex items-center gap-1' }, [
          el('div', { class: 'relative flex-1' }, [
            lucideIcon('search', 'absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400'),
            searchInput,
          ]),
          sortBtn,
        ]),
        el('div', { class: 'flex items-center gap-1 text-xs' }, [statusSel, activitySel]),
      ]),
    ]);

    // ---- scrollable brand list
    var listWrap = el('div', { class: 'max-h-60 overflow-y-auto p-1' });
    var list = el('div', { class: 'space-y-0.5' });
    listWrap.appendChild(list);

    function brandRow(b) {
      var isCurrent = b.id === state.brandId;
      var st = statusOf(b);
      var d = detailFor(b.id);
      var meta = el('div', { class: 'flex items-center gap-1.5 text-xs text-gray-500' });
      if (d && d.location) {
        meta.appendChild(el('div', { class: 'flex items-center gap-0.5 whitespace-nowrap', title: d.location }, [
          lucideIcon('map-pin', 'w-3 h-3'), el('span', { text: d.location }),
        ]));
      }
      if (d && d.promptCount !== null && d.promptCount !== undefined) {
        meta.appendChild(el('div', { class: 'flex items-center gap-0.5 whitespace-nowrap', title: d.promptCount + ' prompts' }, [
          lucideIcon('message-square', 'w-3 h-3'), el('span', { text: d.promptCount + ' prompts' }),
        ]));
      }
      meta.appendChild(el('div', { class: 'flex items-center gap-0.5 whitespace-nowrap', title: b.lastAnalysisAt ? ('Last: ' + new Date(b.lastAnalysisAt).toLocaleString()) : 'Never analyzed' }, [
        lucideIcon('clock', 'w-3 h-3'), el('span', { text: TopbarLogic.menuTime(b.lastAnalysisAt) }),
      ]));

      return el('div', {
        role: 'option',
        'aria-selected': isCurrent ? 'true' : 'false',
        class: BRAND_ROW_CLS + (isCurrent ? ' bg-blue-50 border-l-2 border-blue-500' : ' hover:bg-gray-50'),
        onclick: function () { selectBrand(b.id); closeMenu(); },
      }, [
        el('div', { class: 'flex-shrink-0' }, [
          el('div', { class: 'w-6 h-6 rounded flex items-center justify-center ' + (isCurrent ? 'bg-blue-100' : 'bg-gray-100') }, [
            brandFaviconImg(b, 24),
          ]),
        ]),
        el('div', { class: 'flex flex-col gap-0.5' }, [
          el('div', { class: 'flex items-center gap-1.5' }, [
            el('span', { class: 'font-medium text-sm whitespace-nowrap ' + (isCurrent ? 'text-gray-900' : 'text-gray-700'), title: b.name, text: b.name }),
            isCurrent ? el('span', { class: 'text-xs text-blue-600 font-medium', text: '✓' }) : null,
            brandStatusBadge(st),
            meta,
          ]),
        ]),
      ]);
    }

    function paintList() {
      var filtered = TopbarLogic.filterBrands(liveBrands(), controls.q, controls.status, controls.activity, statusOf);
      var sorted = TopbarLogic.sortBrands(filtered, controls.sort);
      list.innerHTML = '';
      if (!sorted.length) {
        list.appendChild(el('div', { class: 'px-3 py-4 text-sm text-muted-foreground', text: 'No brands match.' }));
      } else {
        sorted.forEach(function (b) { list.appendChild(brandRow(b)); });
      }
      refreshIcons();
      // lazily fetch details for the brands the user can actually see
      requestDetails(sorted.slice(0, 12).map(function (b) { return b.id; }));
    }

    detailListeners.brandMenu = paintList;
    paintList();

    // ---- footer: Add New Brand / Manage Brands
    var footer = el('div', { class: 'border-t border-gray-200 p-1 bg-gray-50' }, [
      el('div', {
        role: 'menuitem', class: MENU_FOOTER_ITEM_CLS,
        onclick: function () { closeMenu(); openAddBrandWizard(); },
      }, [
        el('div', { class: 'w-6 h-6 rounded flex items-center justify-center bg-gradient-to-br from-brand/30 to-brand-secondary/30' }, [
          lucideIcon('plus', 'w-3 h-3 text-gray-700'),
        ]),
        el('span', { class: 'text-xs font-medium whitespace-nowrap text-gray-700', text: 'Add New Brand' }),
      ]),
      el('div', {
        role: 'menuitem', class: MENU_FOOTER_ITEM_CLS,
        onclick: function () { closeMenu(); openManageBrands(); },
      }, [
        el('div', { class: 'w-6 h-6 rounded flex items-center justify-center bg-gray-100' }, [
          lucideIcon('settings', 'w-3 h-3 text-gray-700'),
        ]),
        el('span', { class: 'text-xs font-medium whitespace-nowrap text-gray-700', text: 'Manage Brands' }),
      ]),
    ]);

    menu.appendChild(headerBox);
    menu.appendChild(listWrap);
    menu.appendChild(footer);
    return menu;
  }

  function statPair(label, value) {
    return el('span', { class: 'whitespace-nowrap' }, [
      el('span', { class: 'text-gray-500', text: label + ' ' }),
      el('span', { class: 'font-semibold text-gray-900', text: value }),
    ]);
  }

  /**
   * Header filter dropdown, faithful to the live Radix popover:
   * - trigger: h-9 rounded-md 1px border-input bg-white, icon + label + chevron (opacity 50)
   * - panel: 220px, p-1 (4px), rounded-md, border, shadow-md, right-aligned below trigger
   * - open animation: fade-in + zoom-in-95 + slide-in-from-top-2 over 150ms
   * - rows: px-2 py-1.5 text-sm rounded-md, 16px check slot, hover bg-accent;
   *   active row bg-accent/50 + font-medium + check
   *
   * opts: { ariaLabel, triggerIcon (Node|null), label, items, dividerAfterFirst, onPick }
   * items: [{ label, value, active, icon (Node|null) }]
   */
  function buildDropdown(opts) {
    var btn = el('button', { class: 'pb-dd-trigger', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': opts.ariaLabel || opts.label }, [
      el('span', { class: 'pb-dd-trigger-main' }, [
        opts.triggerIcon || null,
        el('span', { class: 'pb-dd-trigger-label', text: opts.label }),
      ]),
      el('span', { class: 'pb-dd-chevron', html: SVG_CHEVRON }),
    ]);
    var container = el('div', { class: 'relative' }, [btn]);
    var open = false, pop = null, closing = false;

    function destroy() { if (pop) { pop.remove(); pop = null; } open = false; closing = false; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', outside); document.removeEventListener('keydown', onKey); }
    function close() {
      if (!pop || closing) return;
      closing = true;
      pop.classList.add('pb-dd-leaving');
      setTimeout(destroy, 130);
    }
    function outside(e) { if (pop && !container.contains(e.target)) close(); }
    function onKey(e) { if (e.key === 'Escape') close(); }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (open) { close(); return; }
      open = true;
      btn.setAttribute('aria-expanded', 'true');
      pop = el('div', { class: 'pb-dd-panel', role: 'dialog' });
      opts.items.forEach(function (it, idx) {
        var row = el('button', {
          class: 'pb-dd-item' + (it.active ? ' pb-dd-item-active' : ''),
          type: 'button',
          onclick: function (ev) { ev.stopPropagation(); destroy(); opts.onPick(it.value); },
        }, [
          el('span', { class: 'pb-dd-check', html: it.active ? SVG_CHECK : '' }),
          it.icon || null,
          el('span', { class: 'truncate', text: it.label }),
        ]);
        pop.appendChild(row);
        if (opts.dividerAfterFirst && idx === 0) pop.appendChild(el('div', { class: 'pb-dd-sep' }));
      });
      container.appendChild(pop);
      setTimeout(function () { document.addEventListener('click', outside); document.addEventListener('keydown', onKey); }, 0);
    });
    return container;
  }

  // ==========================================================================
  // Manage Brands sheet (replica of app/manage-brands.html)
  // Right-side drawer, 900px, search + sortable table + switches + delete.
  // All changes are local-only: the mirror never writes to aipeekaboo.com.
  // ==========================================================================
  var SHEET_OVERLAY_CLS = 'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0';
  var SHEET_PANEL_CLS = 'fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500 inset-y-0 right-0 h-full border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right flex flex-col overflow-hidden';
  var TH_CLS = 'h-12 px-4 text-left align-middle font-medium text-muted-foreground';
  var TD_CLS = 'p-4 align-middle';
  var manageOpen = false;

  function openManageBrands() {
    if (manageOpen) return;
    manageOpen = true;
    var sort = { key: 'recent', dir: 1 };
    var q = '';

    var overlay = el('div', { class: SHEET_OVERLAY_CLS, 'data-state': 'open' });
    var panel = el('div', {
      role: 'dialog', 'data-state': 'open',
      class: SHEET_PANEL_CLS,
      style: { width: '900px', maxWidth: '90vw' },
    });

    function close() {
      if (!manageOpen) return;
      manageOpen = false;
      delete detailListeners.manage;
      panel.setAttribute('data-state', 'closed');
      overlay.setAttribute('data-state', 'closed');
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      setTimeout(function () {
        if (panel.parentNode) panel.parentNode.removeChild(panel);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        renderHeader(); // status dot / counts may have changed locally
      }, 290);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    overlay.addEventListener('click', close);

    var subtitle = el('p', { class: 'text-sm text-muted-foreground' });
    function paintSubtitle() {
      var brands = liveBrands();
      var active = TopbarLogic.countActive(brands, statusOf);
      var paused = brands.length - active;
      var deleted = Object.keys(localDeleted).length;
      subtitle.textContent = active + '/' + brands.length + ' active brands • ' + paused + ' paused • ' + deleted + ' deleted • Custom Plan plan';
    }

    var searchInput = el('input', {
      type: 'search',
      placeholder: 'Search brands by name, URL, or industry...',
      class: 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm pl-10',
    });
    searchInput.addEventListener('input', function () { q = searchInput.value; paintBody(); });

    var tbody = el('tbody', { class: '[&_tr:last-child]:border-0' });

    function sortableTh(label, key) {
      var th = el('th', { class: TH_CLS + ' cursor-pointer hover:bg-muted/50' });
      var inner = el('div', { class: 'flex items-center gap-1' });
      appendChildren(inner, [label, lucideIcon('arrow-up-down', 'w-3 h-3')]);
      th.appendChild(inner);
      th.addEventListener('click', function () {
        if (sort.key === key) sort.dir = -sort.dir;
        else { sort.key = key; sort.dir = 1; }
        paintBody();
      });
      return th;
    }

    function sortedRows() {
      var brands = TopbarLogic.filterBrands(liveBrands(), q, 'all', 'all', statusOf);
      var rows = brands.slice();
      if (sort.key === 'name') {
        rows.sort(function (a, b) { return sort.dir * (a.name || '').localeCompare(b.name || ''); });
      } else if (sort.key === 'status') {
        rows.sort(function (a, b) {
          var sa = statusOf(a) === 'Active' ? 0 : 1, sb = statusOf(b) === 'Active' ? 0 : 1;
          if (sa !== sb) return sort.dir * (sa - sb);
          return (a.name || '').localeCompare(b.name || '');
        });
      } else if (sort.key === 'lastRun') {
        rows.sort(function (a, b) { return sort.dir * (b.lastAnalysisAt || '').localeCompare(a.lastAnalysisAt || ''); });
      } else {
        rows = TopbarLogic.sortBrands(rows, 'recent');
      }
      return rows;
    }

    function brandTr(b) {
      var st = statusOf(b);
      var d = detailFor(b.id);
      var checked = st === 'Active';

      var thumb = el('span', {
        'data-state': checked ? 'checked' : 'unchecked',
        class: 'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
      });
      var toggle = el('button', {
        type: 'button', role: 'switch', 'aria-checked': checked ? 'true' : 'false',
        'data-state': checked ? 'checked' : 'unchecked', value: 'on',
        class: 'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-input',
        onclick: function () {
          localToggles[b.id] = !(statusOf(b) === 'Active');
          toast('Local mirror only: brand status changes are not synced to aipeekaboo.com');
          paintBody(); paintSubtitle();
        },
      }, [thumb]);

      var del = el('button', {
        type: 'button', title: 'Delete brand',
        class: 'inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 h-9 rounded-md px-3 text-red-600 hover:text-red-700 hover:bg-red-50',
        onclick: function () {
          localDeleted[b.id] = true;
          toast('Local mirror only: "' + b.name + '" hidden locally, nothing deleted on aipeekaboo.com');
          paintBody(); paintSubtitle();
        },
      }, [lucideIcon('trash-2', 'h-4 w-4')]);

      var statusBox = el('div', {
        class: 'inline-flex px-3 py-1.5 rounded-md border-2 ' + (checked ? 'border-green-500 bg-green-50' : 'border-gray-300 bg-gray-50'),
      }, [
        el('div', { class: 'inline-flex items-center rounded-full text-xs font-semibold bg-transparent border-0 p-0 ' + (checked ? 'text-green-700' : 'text-gray-600'), text: st }),
      ]);

      return el('tr', { class: 'border-b transition-colors hover:bg-muted/50' }, [
        el('td', { class: TD_CLS + ' w-[60px]' }, [brandFaviconImg(b, 40)]),
        el('td', { class: TD_CLS }, [
          el('div', { class: 'flex flex-col gap-1' }, [
            el('div', { class: 'font-medium flex items-center gap-2', text: b.name }),
            el('div', { class: 'text-xs text-muted-foreground truncate max-w-[200px]', text: b.url || '' }),
          ]),
        ]),
        el('td', { class: TD_CLS }, [statusBox]),
        el('td', { class: TD_CLS }, [
          el('span', { class: 'text-muted-foreground text-xs', title: b.lastAnalysisAt ? new Date(b.lastAnalysisAt).toLocaleString() : 'Never', text: TopbarLogic.manageTime(b.lastAnalysisAt) }),
        ]),
        el('td', { class: TD_CLS + ' text-center' }, [
          el('div', { class: 'flex items-center justify-center gap-1' }, [
            el('span', { class: 'font-medium', text: (d && d.promptCount != null) ? String(d.promptCount) : '–' }),
          ]),
        ]),
        el('td', { class: TD_CLS + ' text-center' }, [
          el('div', { class: 'flex items-center justify-center gap-1' }, [
            el('span', { class: 'font-medium', text: (d && d.competitorCount != null) ? String(d.competitorCount) : '–' }),
          ]),
        ]),
        el('td', { class: TD_CLS + ' text-center' }, [toggle]),
        el('td', { class: TD_CLS + ' text-center' }, [del]),
      ]);
    }

    function paintBody() {
      var rows = sortedRows();
      tbody.innerHTML = '';
      if (!rows.length) {
        tbody.appendChild(el('tr', {}, [
          el('td', { class: TD_CLS + ' text-sm text-muted-foreground', colspan: '8', text: 'No brands match.' }),
        ]));
      } else {
        rows.forEach(function (b) { tbody.appendChild(brandTr(b)); });
      }
      refreshIcons();
      requestDetails(rows.slice(0, 15).map(function (b) { return b.id; }));
    }

    var table = el('table', { class: 'w-full caption-bottom text-sm' }, [
      el('thead', { class: '[&_tr]:border-b' }, [
        el('tr', { class: 'border-b transition-colors hover:bg-muted/50' }, [
          el('th', { class: TH_CLS + ' w-[60px]' }),
          sortableTh('Brand Name', 'name'),
          sortableTh('Status', 'status'),
          sortableTh('Last Run', 'lastRun'),
          el('th', { class: TH_CLS + ' text-center', title: 'Prompts' }, [
            el('div', { class: 'flex items-center justify-center gap-1' }, [lucideIcon('message-square', 'w-4 h-4')]),
          ]),
          el('th', { class: TH_CLS + ' text-center', title: 'Competitors' }, [
            el('div', { class: 'flex items-center justify-center gap-1' }, [lucideIcon('users', 'w-4 h-4')]),
          ]),
          el('th', { class: TH_CLS + ' text-center', text: 'Toggle' }),
          el('th', { class: TH_CLS + ' text-center', text: 'Delete' }),
        ]),
      ]),
      tbody,
    ]);

    appendChildren(panel, [
      el('div', { class: 'flex flex-col space-y-2 text-center sm:text-left' }, [
        el('h2', { class: 'text-lg font-semibold text-foreground flex items-center gap-2' }, [
          lucideIcon('settings', 'w-5 h-5'), 'Manage Brands',
        ]),
        subtitle,
      ]),
      el('div', { class: 'relative mt-4' }, [
        lucideIcon('search', 'absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground'),
        searchInput,
      ]),
      el('div', { class: 'flex-1 overflow-y-auto mt-4 border rounded-lg' }, [
        el('div', { class: 'relative w-full overflow-auto' }, [table]),
      ]),
      el('button', {
        type: 'button', class: 'absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none',
        onclick: close,
      }, [lucideIcon('x', 'h-4 w-4'), el('span', { class: 'sr-only', text: 'Close' })]),
    ]);

    paintSubtitle();
    paintBody();
    detailListeners.manage = function () { paintBody(); };

    document.body.appendChild(overlay);
    document.body.appendChild(panel);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    refreshIcons();
    setTimeout(function () { searchInput.focus(); }, 50);
  }

  // ==========================================================================
  // Create New Brand wizard (replica of app/addbrand-step1..5.html)
  // 5 steps, gradient header, progress bars, Cancel / Back / Next / Create.
  // The final Create is local-only: the mirror never writes to the real API.
  // ==========================================================================
  var WIZARD_DIALOG_CLS = 'relative w-full sm:rounded-lg max-h-[90vh] p-0 border-0 shadow-2xl bg-white rounded-2xl overflow-hidden flex flex-col data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-200';
  var WZ_INPUT_BASE = 'flex h-10 w-full rounded-md border px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm bg-white transition-all duration-200 ';
  var WZ_TEXTAREA_BASE = 'flex min-h-[80px] w-full rounded-md border px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm bg-white transition-all duration-200 ';
  var WZ_VALID_CLS = 'border-green-400 focus:border-green-500 focus:ring-green-200';
  var WZ_LABEL_CLS = 'text-sm font-medium leading-none text-black flex items-center gap-1';
  var WZ_BTN_GHOST = 'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium disabled:pointer-events-none disabled:opacity-50 border h-10 px-4 py-2 border-black/20 text-black hover:bg-black/5 transition-all duration-200 bg-transparent w-full sm:w-auto order-2 sm:order-1';
  var WZ_BTN_PRIMARY = 'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium disabled:pointer-events-none disabled:opacity-50 h-10 px-4 py-2 bg-black hover:bg-black/80 text-white transition-all duration-200 hover:scale-105 w-full sm:w-auto order-1 sm:order-3';
  var wizardOpenFlag = false;

  function wizardIndustries() {
    var seen = {};
    var out = [];
    state.brands.forEach(function (b) {
      var ind = (b.industry || '').trim();
      if (ind && !seen[ind]) { seen[ind] = true; out.push(ind); }
    });
    out.sort();
    if (!out.length) out = ['SaaS', 'E-commerce', 'Healthcare', 'Finance', 'Education', 'Travel', 'Other'];
    return out;
  }

  function openAddBrandWizard() {
    if (wizardOpenFlag) return;
    wizardOpenFlag = true;

    var wz = { step: 1, name: '', description: '', url: '', industry: '', compMethod: 'auto', competitors: [], promptMethod: 'ai', prompts: [] };

    var overlay = el('div', { class: SHEET_OVERLAY_CLS, 'data-state': 'open' });
    var wrap = el('div', { class: 'fixed inset-0 z-50 flex items-center justify-center p-4' });
    var dialog = el('div', {
      role: 'dialog', 'data-state': 'open',
      class: WIZARD_DIALOG_CLS,
      style: { maxWidth: '900px' },
    });
    wrap.appendChild(dialog);

    function close() {
      if (!wizardOpenFlag) return;
      wizardOpenFlag = false;
      dialog.setAttribute('data-state', 'closed');
      overlay.setAttribute('data-state', 'closed');
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      setTimeout(function () {
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 190);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });

    var content = el('div', { class: 'px-8 pt-1 pb-8 flex-1 overflow-y-auto overscroll-contain min-h-0' });

    function step1Valid() {
      return wz.name.trim().length > 0 && wz.description.trim().length > 0 && /^https?:\/\/.+\..+/.test(wz.url.trim());
    }
    function stepValid() {
      if (wz.step === 1) return step1Valid();
      if (wz.step === 2) return wz.industry.trim().length > 0;
      return true;
    }

    function methodCard(active, iconName, title, sub, onclick) {
      return el('button', {
        type: 'button',
        class: 'flex-1 text-left border rounded-lg p-4 transition-all duration-200 ' + (active ? 'border-green-500 bg-green-50' : 'border-input bg-white hover:border-gray-300'),
        onclick: onclick,
      }, [
        el('div', { class: 'flex items-center gap-2 mb-1' }, [
          lucideIcon(iconName, 'w-4 h-4 ' + (active ? 'text-green-600' : 'text-muted-foreground')),
          el('span', { class: 'text-sm font-medium text-black', text: title }),
        ]),
        el('div', { class: 'text-xs text-muted-foreground', text: sub }),
      ]);
    }

    function fieldRow(labelText, inputNode) {
      return el('div', { class: 'grid gap-2' }, [
        el('label', { class: WZ_LABEL_CLS }, [labelText, el('span', { class: 'text-red-500', text: '*' })]),
        el('div', { class: 'relative' }, [inputNode]),
      ]);
    }

    function textInput(opts) {
      var valid = opts.validate(opts.get());
      var node = el(opts.tag || 'input', {
        class: (opts.tag === 'textarea' ? WZ_TEXTAREA_BASE : WZ_INPUT_BASE) + (valid ? WZ_VALID_CLS : 'border-input'),
        placeholder: opts.placeholder,
        type: opts.tag === 'textarea' ? null : (opts.type || 'text'),
        rows: opts.tag === 'textarea' ? '3' : null,
      });
      node.value = opts.get();
      node.addEventListener('input', function () {
        opts.set(node.value);
        var ok = opts.validate(node.value);
        node.className = (opts.tag === 'textarea' ? WZ_TEXTAREA_BASE : WZ_INPUT_BASE) + (ok ? WZ_VALID_CLS : 'border-input');
        syncNextState();
      });
      return node;
    }

    var nextBtn = null;
    function syncNextState() {
      if (!nextBtn) return;
      if (stepValid()) nextBtn.removeAttribute('disabled');
      else nextBtn.setAttribute('disabled', '');
    }

    function stepBody() {
      var head, sub, body;
      if (wz.step === 1) {
        head = 'Tell us about your brand';
        sub = "We'll use this to analyze your brand's visibility in AI responses";
        body = el('div', { class: 'grid gap-6' }, [
          fieldRow('Brand Name', textInput({
            placeholder: 'e.g., Acme Inc.',
            get: function () { return wz.name; }, set: function (v) { wz.name = v; },
            validate: function (v) { return v.trim().length > 0; },
          })),
          fieldRow('Short Description', textInput({
            tag: 'textarea',
            placeholder: 'e.g., The fastest, safest rocket skates on the market.',
            get: function () { return wz.description; }, set: function (v) { wz.description = v; },
            validate: function (v) { return v.trim().length > 0; },
          })),
          fieldRow('Website URL', textInput({
            type: 'url',
            placeholder: 'e.g., https://www.acme.com',
            get: function () { return wz.url; }, set: function (v) { wz.url = v; },
            validate: function (v) { return /^https?:\/\/.+\..+/.test(v.trim()); },
          })),
        ]);
      } else if (wz.step === 2) {
        head = 'Select your industry';
        sub = 'This helps us identify relevant competitors in your space';
        var sel = el('select', { class: WZ_INPUT_BASE + (wz.industry ? WZ_VALID_CLS : 'border-input') }, [
          el('option', { value: '', text: 'Select an industry...' }),
        ]);
        wizardIndustries().forEach(function (ind) {
          var o = el('option', { value: ind, text: ind });
          if (ind === wz.industry) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', function () {
          wz.industry = sel.value;
          sel.className = WZ_INPUT_BASE + (wz.industry ? WZ_VALID_CLS : 'border-input');
          syncNextState();
        });
        body = el('div', { class: 'grid gap-6' }, [fieldRow('Industry', sel)]);
      } else if (wz.step === 3) {
        head = 'Add competitors';
        sub = 'We can automatically suggest competitors or you can add them manually';
        var manualBox = el('div', { class: 'grid gap-2 mt-4' + (wz.compMethod === 'manual' ? '' : ' hidden') });
        var chipHost = el('div', { class: 'flex items-center gap-2 flex-wrap mt-2' });
        var paintChips = function () {
          chipHost.innerHTML = '';
          wz.competitors.forEach(function (c, i) {
            chipHost.appendChild(el('span', { class: 'inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700' }, [
              c,
              el('button', {
                type: 'button', class: 'text-gray-400 hover:text-gray-700',
                onclick: function () { wz.competitors.splice(i, 1); paintChips(); },
              }, [lucideIcon('x', 'w-3 h-3')]),
            ]));
          });
          refreshIcons();
        };
        var compInput = el('input', { class: WZ_INPUT_BASE + 'border-input', placeholder: 'e.g., competitor.com or Competitor Inc.' });
        var addBtn = el('button', {
          type: 'button', class: 'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium border h-10 px-4 border-black/20 text-black hover:bg-black/5 bg-transparent',
          onclick: function () {
            var v = compInput.value.trim();
            if (!v) return;
            wz.competitors.push(v);
            compInput.value = '';
            paintChips();
          },
        }, 'Add');
        appendChildren(manualBox, [
          el('label', { class: WZ_LABEL_CLS, text: 'Add Competitors' }),
          el('div', { class: 'flex items-center gap-2' }, [
            el('div', { class: 'relative', style: { flex: '1 1 auto', minWidth: '0' } }, [compInput]),
            addBtn,
          ]),
          chipHost,
        ]);
        paintChips();
        var cards = el('div', { class: 'flex flex-col sm:flex-row gap-3' });
        var paintCards = function () {
          cards.innerHTML = '';
          cards.appendChild(methodCard(wz.compMethod === 'auto', 'sparkles', 'Auto-suggest competitors', 'We analyze your market and propose the most relevant competitors', function () {
            wz.compMethod = 'auto'; paintCards();
            manualBox.classList.add('hidden');
          }));
          cards.appendChild(methodCard(wz.compMethod === 'manual', 'users', 'Add manually', 'Type in the competitors you already track', function () {
            wz.compMethod = 'manual'; paintCards();
            manualBox.classList.remove('hidden');
          }));
          refreshIcons();
        };
        paintCards();
        body = el('div', { class: 'grid gap-2' }, [
          el('label', { class: WZ_LABEL_CLS, text: 'Competitor Analysis Method' }),
          cards,
          manualBox,
        ]);
      } else if (wz.step === 4) {
        head = 'Create prompts';
        sub = 'Generate prompts to test how AI models respond about your brand';
        var promptBox = el('div', { class: 'grid gap-2 mt-4' + (wz.promptMethod === 'manual' ? '' : ' hidden') });
        var ta = el('textarea', { class: WZ_TEXTAREA_BASE + 'border-input', rows: '5', placeholder: 'One prompt per line, e.g.\nbest rocket skates 2026\nAcme alternatives' });
        ta.value = wz.prompts.join('\n');
        ta.addEventListener('input', function () {
          wz.prompts = ta.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        });
        appendChildren(promptBox, [el('label', { class: WZ_LABEL_CLS, text: 'Your Prompts' }), ta]);
        var pcards = el('div', { class: 'flex flex-col sm:flex-row gap-3' });
        var paintPCards = function () {
          pcards.innerHTML = '';
          pcards.appendChild(methodCard(wz.promptMethod === 'ai', 'sparkles', 'AI-generated prompts', 'We generate commercial and comparison prompts for your category', function () {
            wz.promptMethod = 'ai'; paintPCards();
            promptBox.classList.add('hidden');
          }));
          pcards.appendChild(methodCard(wz.promptMethod === 'manual', 'pencil', 'Write my own', 'Paste the exact prompts you want monitored', function () {
            wz.promptMethod = 'manual'; paintPCards();
            promptBox.classList.remove('hidden');
          }));
          refreshIcons();
        };
        paintPCards();
        body = el('div', { class: 'grid gap-2' }, [
          el('label', { class: WZ_LABEL_CLS, text: 'Prompt Generation Method' }),
          pcards,
          promptBox,
        ]);
      } else {
        head = 'Review & create';
        sub = 'Review your settings and create your brand';
        var reviewRow = function (label, valueNode) {
          return el('div', { class: 'flex items-start justify-between gap-4 py-3 border-b border-gray-100' }, [
            el('span', { class: 'text-sm text-muted-foreground whitespace-nowrap', text: label }),
            el('div', { class: 'text-sm font-medium text-black text-right', style: { minWidth: '0' } }, [valueNode]),
          ]);
        };
        body = el('div', { class: 'border rounded-lg px-4 py-1' }, [
          reviewRow('Brand Name', wz.name || '–'),
          reviewRow('Description', el('span', { class: 'block max-w-[420px] truncate', title: wz.description, text: wz.description || '–' })),
          reviewRow('Website', el('span', { class: 'inline-flex items-center gap-2' }, [
            wz.url ? el('img', { class: 'w-4 h-4 rounded', src: favicon(wz.url), onerror: function () { this.style.visibility = 'hidden'; } }) : null,
            wz.url || '–',
          ])),
          reviewRow('Industry', wz.industry || '–'),
          reviewRow('Competitors', wz.compMethod === 'auto' ? 'Auto-suggested' : (wz.competitors.length ? wz.competitors.join(', ') : 'None added')),
          reviewRow('Prompts', wz.promptMethod === 'ai' ? 'AI-generated' : (wz.prompts.length + ' custom prompts')),
        ]);
      }
      return { head: head, sub: sub, body: body };
    }

    function renderStep() {
      content.innerHTML = '';

      // progress bars (filled = bg-peekaboo-gradient, exactly like the capture)
      var prog = el('div', { class: 'flex items-center gap-2 mb-6 mt-4' });
      for (var i = 1; i <= 5; i++) {
        prog.appendChild(el('div', {
          class: 'h-1.5 rounded-full border border-black/40 ' + (i <= wz.step ? 'bg-peekaboo-gradient' : 'bg-black/10'),
          style: { flexBasis: '0', flexGrow: '1' },
        }));
      }

      // nav row: Cancel/Back | Step X of 5 | Next/Create Brand
      var leftBtn = el('button', { type: 'button', class: WZ_BTN_GHOST }, [
        lucideIcon(wz.step === 1 ? 'x' : 'arrow-left', 'w-4 h-4 mr-2'),
        wz.step === 1 ? 'Cancel' : 'Back',
      ]);
      leftBtn.addEventListener('click', function () {
        if (wz.step === 1) { close(); return; }
        wz.step -= 1; renderStep();
      });
      var isLast = wz.step === 5;
      nextBtn = el('button', { type: 'button', class: WZ_BTN_PRIMARY }, [
        isLast ? 'Create Brand' : 'Next',
        isLast ? null : lucideIcon('arrow-right', 'w-4 h-4 ml-2'),
      ]);
      nextBtn.addEventListener('click', function () {
        if (!stepValid()) return;
        if (isLast) {
          toast('Local mirror: brand creation is disabled, nothing was sent to aipeekaboo.com');
          close();
          return;
        }
        wz.step += 1; renderStep();
      });
      var nav = el('div', { class: 'flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 sm:gap-4 mb-6' }, [
        leftBtn,
        el('div', { class: 'flex items-center justify-center order-3 sm:order-2' }, [
          el('span', { class: 'text-sm font-medium text-black/70', text: 'Step ' + wz.step + ' of 5' }),
        ]),
        nextBtn,
      ]);

      var s = stepBody();
      appendChildren(content, [
        prog,
        nav,
        el('div', { class: 'mb-6' }, [
          el('h3', { class: 'text-xl text-black font-semibold', text: s.head }),
          el('p', { class: 'text-black/70 mt-1', text: s.sub }),
        ]),
        el('div', { class: 'transition-all duration-300 opacity-100' }, [s.body]),
      ]);
      syncNextState();
      refreshIcons();
    }

    appendChildren(dialog, [
      el('div', { class: 'bg-peekaboo-gradient px-8 py-6' }, [
        el('div', { class: 'flex items-center gap-3' }, [
          lucideIcon('sparkles', 'w-8 h-8 text-black'),
          el('div', {}, [
            el('h2', { class: 'text-xl font-bold text-black', text: 'Create New Brand' }),
            el('p', { class: 'text-black/60 text-sm mt-1 font-normal', text: 'Add another brand you can switch to at any time' }),
          ]),
        ]),
      ]),
      el('div', { class: 'flex flex-col flex-1 min-h-0' }, [content]),
      el('button', {
        type: 'button', class: 'absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none',
        onclick: close,
      }, [lucideIcon('x', 'h-4 w-4 text-black'), el('span', { class: 'sr-only', text: 'Close' })]),
    ]);

    renderStep();
    document.body.appendChild(overlay);
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    refreshIcons();
  }

  // let views push the brand pill stats (visibility/sentiment/position)
  function setPillStats(stats) { state.pillStats = stats; renderHeader(); }

  // ---- brand state ----------------------------------------------------------
  function selectBrand(id) {
    var b = state.brands.find(function (x) { return x.id === id; });
    if (!b) return;
    state.brandId = id; state.brandName = b.name; state.pillStats = null;
    try { localStorage.setItem(LS_BRAND, id); } catch (e) {}
    renderHeader(); enhanceSidebar(); route();
  }

  // ---- routing --------------------------------------------------------------
  // Accepts both '#/dashboard' and '#dashboard' (and bare '#').
  function hashParts() {
    var h = location.hash || '';
    h = h.replace(/^#\/?/, '');           // strip '#' or '#/'
    return h.split('/');
  }
  function currentRoute() { return hashParts()[0] || 'dashboard'; }
  function routeParam() { return hashParts()[1] || null; }
  function navigate(hash) { location.hash = hash; }

  function route() {
    var name = currentRoute();
    var fn = views[name];
    var root = document.getElementById('view');
    if (!root) return;
    enhanceSidebar();
    if (!fn) { root.innerHTML = '<div class="rounded-lg border bg-card shadow-sm p-4">Unknown view: ' + name + '</div>'; return; }
    if (!state.brandId) { root.innerHTML = '<div class="rounded-lg border bg-card shadow-sm p-4">Pick a brand to begin.</div>'; return; }
    var ctx = { brandId: state.brandId, brandName: state.brandName, model: state.model, range: state.range, param: routeParam() };
    skeleton(root);
    Promise.resolve().then(function () { return fn(root, ctx); }).catch(function (err) {
      console.error('[view ' + name + ']', err);
      errorState(root, err);
      if (err && err.code) toast(err.code + ': ' + err.message, true);
    });
  }

  // ---- public API -----------------------------------------------------------
  var PB = {
    state: state, api: window.PBApi, el: el, fmt: fmt,
    favicon: favicon, modelLogo: modelLogo, modelLabel: modelLabel, models: MODELS,
    entityDomain: EntityLogic.entityDomain,
    toast: toast, skeleton: skeleton, navigate: navigate,
    registerView: function (name, fn) { views[name] = fn; },
    card: card, cardTitle: cardTitle, setPillStats: setPillStats,
    openManageBrands: openManageBrands, openAddBrandWizard: openAddBrandWizard,
    boot: boot,
  };

  async function boot() {
    PB.api = window.PBApi;
    ensureToast();
    loadDetailCache();
    renderHeader();
    enhanceSidebar();
    var root = document.getElementById('view');
    if (root) skeleton(root);
    try {
      var brands = TopbarLogic.sortBrands(await window.PBApi.brands(), 'recent');
      state.brands = brands;
      var saved = null; try { saved = localStorage.getItem(LS_BRAND); } catch (e) {}
      var initial = brands.find(function (b) { return b.id === saved; }) || brands.find(function (b) { return b.lastAnalysisAt; }) || brands[0];
      if (initial) { state.brandId = initial.id; state.brandName = initial.name; }
      renderHeader();
      if (!location.hash) location.hash = '#/dashboard';
      route();
    } catch (err) {
      if (root) errorState(root, err);
      toast((err && err.message) || 'Failed to load brands', true);
    }
  }

  window.addEventListener('hashchange', route);
  window.PB = PB;
})();
