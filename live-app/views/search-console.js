/*
 * search-console.js — Search Console view (live), pixel-faithful clone of the
 * captured references:
 *   app/search-console.html              (not-connected empty state)
 *   app/search-console-tab-queries.html  (connected, Queries tab)
 *   app/search-console-tab-pages.html    (connected, Pages tab)
 *
 * Layout (all markup/classes copied from the captured pages):
 *   NOT CONNECTED (default — the live Peekaboo API has no /search-console
 *   endpoint yet, verified 404 on /brands/{id}/search-console):
 *     centered "Optimize Your AI Visibility Through Search Intent" card with
 *     Google logo, 4-step How-This-Helps panel, What's-Included checklist,
 *     "Not Connected" badge + "Connect Google Search Console" button.
 *
 *   CONNECTED (renders whenever the API starts returning data):
 *     - page header: Google G + "Search Console" + NEW pill + domain chip +
 *       Change Property / Disconnect / Refresh buttons
 *     - "Performance Over Time" card: date-range pill group (Last 7 days /
 *       28 days / 3 months / 6 months / 12 months), Refresh + Export,
 *       4 toggleable stat cards (Clicks #4285F4 / Impressions #5E35B1 /
 *       CTR #00897B / Position #E8710A), Daily-Weekly select, line chart
 *       (Chart.js stands in for the product's recharts), Last-updated line
 *     - tabs card: Queries | Pages | Search-to-AI Gaps (NEW) — intent pill
 *       filter row (Queries), search box, sort select, export, table,
 *       "15 of N" + Show More footer, amber duplicate-cleanup callout
 *
 * Styles: injects the captured compiled stylesheet
 *   /_next/static/css/fb9cebaaf381bc0d.css (defines every .aim-sc-* class).
 *
 * Tests: live-app/tests/search-console.test.mjs (node --test) covers the pure
 * logic (intent classifier, totals math, weekly aggregation, intent counts,
 * sorting, gaps derivation, formatting).
 */
(function () {
  'use strict';
  if (!window.PB) return;
  var el = PB.el;

  var AIM_CSS_HREF = '/_next/static/css/fb9cebaaf381bc0d.css';
  var AIM_CSS_ID = 'pb-aim-css';

  var PERIODS = [
    { v: '7d', label: 'Last 7 days' },
    { v: '28d', label: 'Last 28 days' },
    { v: '3m', label: 'Last 3 months' },
    { v: '6m', label: 'Last 6 months' },
    { v: '12m', label: 'Last 12 months' },
  ];

  // Google Search Console metric colors (clicks/impressions verbatim from the
  // captured page; CTR/position are the GSC standard pair).
  var METRICS = [
    { key: 'clicks', label: 'Total Clicks', rgb: '66, 133, 244', hex: '#4285F4' },
    { key: 'impressions', label: 'Total Impressions', rgb: '94, 53, 177', hex: '#5E35B1' },
    { key: 'ctr', label: 'Avg CTR', rgb: '0, 137, 123', hex: '#00897B' },
    { key: 'position', label: 'Avg Position', rgb: '232, 113, 10', hex: '#E8710A' },
  ];

  var INTENT_ORDER = ['Transactional', 'Commercial', 'Local', 'Informational', 'Navigational', 'Unclassified'];

  var PAGE_SIZE = 15;

  // ---- pure helpers ---------------------------------------------------------

  // Classify a search query by intent (same buckets the product uses:
  // Transactional / Commercial / Local / Informational / Navigational).
  function classifyIntent(query, brandName) {
    var q = String(query || '').toLowerCase().trim();
    if (!q) return 'Unclassified';
    var qCompact = q.replace(/[^a-z0-9]/g, '');
    var brand = String(brandName || '').toLowerCase().trim();
    if (brand) {
      var brandCompact = brand.replace(/[^a-z0-9]/g, '');
      if (brandCompact && qCompact.indexOf(brandCompact) !== -1) return 'Navigational';
      var tokens = brand.split(/\s+/).filter(function (t) { return t.length >= 4; });
      var i;
      for (i = 0; i < tokens.length; i++) {
        if (q.indexOf(tokens[i]) !== -1) return 'Navigational';
      }
    }
    if (/\bnear me\b|\bnearby\b|\bdirections\b/.test(q)) return 'Local';
    if (/\b(buy|price|prices|pricing|cost|costs|discount|coupon|deal|deals|order|purchase|subscription|trial|demo|signup|sign up)\b/.test(q)) return 'Transactional';
    if (/\b(best|top|alternative|alternatives|vs|versus|review|reviews|compare|comparison|cheapest|tool|tools|software|platform|agency|agencies|service|services)\b/.test(q)) return 'Commercial';
    if (/\b(what is|what are|how to|how do|how does|why|guide|tutorial|example|examples|meaning|definition|checklist|tips)\b/.test(q) || /^(what|how|why|when|where|who)\b/.test(q)) return 'Informational';
    return 'Unclassified';
  }

  // Aggregate totals from a daily series. CTR is total clicks over total
  // impressions; position is impression-weighted.
  function computeTotals(series) {
    var clicks = 0, impressions = 0, posWeighted = 0;
    (series || []).forEach(function (d) {
      var c = Number(d.clicks) || 0;
      var im = Number(d.impressions) || 0;
      clicks += c;
      impressions += im;
      posWeighted += (Number(d.position) || 0) * im;
    });
    return {
      clicks: clicks,
      impressions: impressions,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      position: impressions > 0 ? posWeighted / impressions : 0,
    };
  }

  // Collapse a daily series into ISO weeks (7-day buckets from the first day).
  function aggregateWeekly(series) {
    var out = [];
    var bucket = null;
    (series || []).forEach(function (d, i) {
      if (i % 7 === 0) {
        bucket = { date: d.date, clicks: 0, impressions: 0, _posW: 0 };
        out.push(bucket);
      }
      bucket.clicks += Number(d.clicks) || 0;
      bucket.impressions += Number(d.impressions) || 0;
      bucket._posW += (Number(d.position) || 0) * (Number(d.impressions) || 0);
    });
    out.forEach(function (b) {
      b.ctr = b.impressions > 0 ? (b.clicks / b.impressions) * 100 : 0;
      b.position = b.impressions > 0 ? b._posW / b.impressions : 0;
      delete b._posW;
    });
    return out;
  }

  function intentCounts(queries) {
    var counts = { all: (queries || []).length };
    (queries || []).forEach(function (q) {
      var key = q.intent || 'Unclassified';
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }

  function sortRows(rows, key) {
    var list = (rows || []).slice();
    list.sort(function (a, b) {
      if (key === 'position') return (a.position || 0) - (b.position || 0); // lower = better
      return (b[key] || 0) - (a[key] || 0);
    });
    return list;
  }

  // Search-to-AI Gaps: queries with real search demand whose intent an AI
  // prompt could capture (everything except brand/navigational), ranked by
  // impressions. These are the searches not yet covered by AI prompts.
  function deriveGaps(queries) {
    return (queries || []).filter(function (q) {
      return q.intent !== 'Navigational' && (Number(q.impressions) || 0) > 0;
    }).sort(function (a, b) {
      return (b.impressions || 0) - (a.impressions || 0);
    });
  }

  function fmtInt(n) { return Number(n || 0).toLocaleString('en-US'); }
  function fmtCtrStat(n) { return (Number(n) || 0).toFixed(2) + '%'; }
  function fmtCtrCell(n) { return (Number(n) || 0).toFixed(1) + '%'; }
  function fmtPos(n) { return (Number(n) || 0).toFixed(1); }

  // Normalize whatever shape the API returns into one stable object.
  function normalizeData(raw, brandName) {
    if (!raw || typeof raw !== 'object') return null;
    var series = raw.series || raw.daily || raw.history || [];
    var queries = (raw.queries || raw.topQueries || []).map(function (q) {
      var text = q.query || q.keys || q.term || '';
      return {
        query: text,
        intent: q.intent || classifyIntent(text, brandName),
        clicks: Number(q.clicks) || 0,
        impressions: Number(q.impressions) || 0,
        ctr: q.ctr !== undefined ? Number(q.ctr) * (Number(q.ctr) <= 1 ? 100 : 1) : 0,
        position: Number(q.position) || 0,
      };
    });
    var pages = (raw.pages || raw.topPages || []).map(function (p) {
      return {
        url: p.url || p.page || p.keys || '',
        clicks: Number(p.clicks) || 0,
        impressions: Number(p.impressions) || 0,
        ctr: p.ctr !== undefined ? Number(p.ctr) * (Number(p.ctr) <= 1 ? 100 : 1) : 0,
        position: Number(p.position) || 0,
      };
    });
    if (!series.length && !queries.length && !pages.length) return null;
    var totals = raw.totals || computeTotals(series);
    return {
      property: raw.property || raw.siteUrl || raw.domain || '',
      lastUpdated: raw.lastUpdated || raw.updatedAt || null,
      totals: totals,
      series: series,
      queries: queries,
      pages: pages,
    };
  }

  // ---- svg helpers ----------------------------------------------------------
  var GOOGLE_G_PATHS =
    '<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"></path>' +
    '<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"></path>' +
    '<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"></path>' +
    '<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"></path>';

  function googleGSvg(size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0">' + GOOGLE_G_PATHS + '</svg>';
  }

  var REFRESH_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-refresh-cw h-[11px] w-[11px]"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path></svg>';
  var DOWNLOAD_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download h-4 w-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line></svg>';
  var SEARCH_ROW_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search h-[13px] w-[13px] text-[#9ca3af] flex-shrink-0"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>';
  var SEARCH_INPUT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search absolute left-3 top-1/2 -translate-y-1/2 h-[13px] w-[13px] text-[#9ca3af] pointer-events-none"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>';
  var PLUS_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus h-[11px] w-[11px]"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>';
  var EXTLINK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-external-link h-[11px] w-[11px] flex-shrink-0"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>';
  var ALERT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-alert h-[14px] w-[14px]" style="color: rgb(146, 64, 14);"><circle cx="12" cy="12" r="10"></circle><line x1="12" x2="12" y1="8" y2="12"></line><line x1="12" x2="12.01" y1="16" y2="16"></line></svg>';
  var CHECK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-check h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>';
  var TRENDING_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trending-up h-5 w-5"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline><polyline points="16 7 22 7 22 13"></polyline></svg>';
  var ALERT_SM_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-alert h-3 w-3 text-amber-600"><circle cx="12" cy="12" r="10"></circle><line x1="12" x2="12" y1="8" y2="12"></line><line x1="12" x2="12.01" y1="16" y2="16"></line></svg>';
  var EXTLINK_BTN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-external-link h-4 w-4 mr-2"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>';

  function ensureAimCss() {
    if (document.getElementById(AIM_CSS_ID)) return;
    var link = document.createElement('link');
    link.id = AIM_CSS_ID;
    link.rel = 'stylesheet';
    link.href = AIM_CSS_HREF;
    document.head.appendChild(link);
  }

  function favUrl(domain) {
    var clean = String(domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(clean) + '&sz=32';
  }

  function checkItem(text) {
    return '<div class="flex items-start gap-2">' + CHECK_SVG + '<span class="text-sm text-gray-600 dark:text-gray-400">' + text + '</span></div>';
  }

  function helpStep(num, html) {
    return '<div class="flex gap-3"><div class="flex-shrink-0 w-6 h-6 rounded-full bg-brand/20 flex items-center justify-center text-brand font-semibold text-xs">' + num + '</div><p class="text-gray-700 dark:text-gray-300">' + html + '</p></div>';
  }

  // ===========================================================================
  // NOT-CONNECTED empty state (markup copied from app/search-console.html)
  // ===========================================================================
  function renderNotConnected(root) {
    var html =
      '<div class="flex-1 py-8 px-4 bg-white dark:bg-gray-900">' +
        '<div class="min-h-screen flex items-center justify-center p-8 bg-white dark:bg-gray-900">' +
          '<div class="max-w-2xl w-full">' +
            '<div class="rounded-lg bg-card text-card-foreground border-2 shadow-xl">' +
              '<div class="flex flex-col p-6 text-center space-y-4 pb-6">' +
                '<div class="flex justify-center"><div class="relative">' +
                  '<div class="absolute inset-0 bg-gradient-to-br from-brand to-brand-dark rounded-full blur-xl opacity-30"></div>' +
                  '<div class="relative p-3 bg-white dark:bg-gray-800 rounded-full">' +
                    '<svg class="h-12 w-12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' + GOOGLE_G_PATHS + '</svg>' +
                  '</div>' +
                '</div></div>' +
                '<div>' +
                  '<div class="font-semibold tracking-tight text-2xl mb-2">Optimize Your AI Visibility Through Search Intent</div>' +
                  '<div class="text-muted-foreground text-base">Connect Google Search Console to discover which queries drive traffic—then optimize your AI presence for those exact search intents.</div>' +
                '</div>' +
              '</div>' +
              '<div class="p-6 pt-0 space-y-6">' +
                '<div class="bg-brand/5 rounded-lg p-5 border border-brand/20">' +
                  '<h3 class="font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">' + TRENDING_SVG + 'How This Helps Your AI Visibility</h3>' +
                  '<div class="space-y-3 text-sm">' +
                    helpStep(1, '<strong>See what real users search for</strong> when they find your site on Google') +
                    helpStep(2, '<strong>Auto-classify by search intent</strong> (Commercial, Transactional, Informational)') +
                    helpStep(3, '<strong>Create AI-optimized prompts</strong> that match those exact intents') +
                    helpStep(4, '<strong>Boost your brand\'s AI visibility</strong> for searches that already drive your traffic') +
                  '</div>' +
                '</div>' +
                '<div class="space-y-3">' +
                  '<h3 class="font-semibold text-sm text-gray-700 dark:text-gray-300">What\'s Included:</h3>' +
                  '<div class="space-y-2">' +
                    checkItem('Automatic search intent classification for all queries') +
                    checkItem('AI assistant to analyze your search performance') +
                    checkItem('Performance charts showing clicks, CTR, and rankings') +
                    checkItem('Daily sync of your top 100 queries') +
                  '</div>' +
                '</div>' +
                '<div class="flex flex-col items-center gap-3 pt-2">' +
                  '<div class="space-y-2">' +
                    '<div class="flex items-center gap-2">' +
                      '<div class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-foreground gap-1">' + ALERT_SM_SVG + 'Not Connected</div>' +
                    '</div>' +
                    '<button id="pb-sc-connect-btn" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-brand text-[var(--theme-on-primary)] hover:bg-brand/90 h-9 rounded-md px-3" type="button">' + EXTLINK_BTN_SVG + 'Connect Google Search Console</button>' +
                    '<p class="text-xs text-muted-foreground max-w-xs">Connect to see your organic search performance alongside AI visibility metrics</p>' +
                  '</div>' +
                  '<p class="text-xs text-center text-muted-foreground">Available on Standard plan and above</p>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    var wrap = el('div', { html: html });
    root.appendChild(wrap);
    var btn = document.getElementById('pb-sc-connect-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        PB.toast('Google Search Console OAuth is only available in the real product');
      });
    }
  }

  // ===========================================================================
  PB.registerView('search-console', async function (root, ctx) {
    ensureAimCss();

    // view state (kept across repaints within this render)
    var state = {
      period: '28d',
      granularity: 'daily',
      activeMetrics: { clicks: true, impressions: true, ctr: false, position: false },
      tab: 'queries',
      intentFilter: 'all',
      search: '',
      sortKey: 'clicks',
      showCount: PAGE_SIZE,
      pagesShowCount: PAGE_SIZE,
      gapsShowCount: PAGE_SIZE,
    };

    async function fetchData(period) {
      try {
        var r = await PB.api.raw('/brands/' + ctx.brandId + '/search-console', { time_range: period });
        return normalizeData(r && r.data, ctx.brandName);
      } catch (e) {
        return null;
      }
    }

    var data = await fetchData(state.period);

    root.innerHTML = '';
    if (!data) {
      renderNotConnected(root);
      return;
    }
    renderConnected(root, data);

    // ========================================================================
    // CONNECTED layout (markup copied from the captured tab pages)
    // ========================================================================
    function renderConnected(host, d) {
      host.innerHTML = '';
      var scope = el('div', { class: 'aim-scope px-4 sm:px-6 lg:px-8 py-6' });

      scope.appendChild(buildPageHeader(d));
      scope.appendChild(el('div', { class: 'mb-[10px]' }, [
        el('span', { class: 'text-[15px] font-semibold tracking-[-0.2px] text-[#1c1917]', text: 'Performance Over Time' }),
      ]));
      scope.appendChild(buildMetricsCard(d));
      scope.appendChild(buildTabsCard(d));
      host.appendChild(scope);
    }

    // ---- page header --------------------------------------------------------
    function buildPageHeader(d) {
      var property = d.property || ctx.brandName;
      var left = el('div', {}, [
        el('div', { class: 'flex items-center gap-2 mb-1' }, [
          el('span', { html: googleGSvg(18) }),
          el('span', { class: 'text-[18px] font-bold tracking-[-0.3px] text-[#1c1917]', text: 'Search Console' }),
          el('span', { class: 'aim-sc-new-pill', text: 'NEW' }),
        ]),
        el('div', { class: 'text-[12px] text-[#545D6C]', text: 'Analyze search traffic and convert high-value queries into AI-optimized prompts' }),
      ]);
      var right = el('div', { class: 'flex items-center gap-2 flex-shrink-0 flex-wrap' }, [
        el('span', { class: 'aim-sc-domain-chip' }, [
          el('img', { alt: '', src: favUrl(property), style: { width: '14px', height: '14px', borderRadius: '3px', flexShrink: '0' }, onerror: "this.style.visibility='hidden'" }),
          property,
        ]),
        el('button', { type: 'button', class: 'aim-export-btn', style: { fontSize: '11px' }, text: 'Change Property', onclick: function () { PB.toast('Property management is only available in the real product'); } }),
        el('button', { type: 'button', class: 'aim-export-btn', style: { fontSize: '11px', color: 'rgb(220, 38, 38)' }, text: 'Disconnect', onclick: function () { PB.toast('Disconnect is only available in the real product'); } }),
        el('button', { type: 'button', class: 'aim-export-btn', style: { fontSize: '11px', display: 'flex', alignItems: 'center', gap: '5px' }, html: REFRESH_SVG + 'Refresh', onclick: reload }),
      ]);
      return el('div', { class: 'flex flex-wrap items-start justify-between gap-3 mb-4' }, [left, right]);
    }

    async function reload() {
      var fresh = await fetchData(state.period);
      if (!fresh) { PB.toast('Search Console data is not available right now', true); return; }
      data = fresh;
      renderConnected(root, data);
    }

    // ---- metrics card (date pills + stat cards + chart) ----------------------
    function buildMetricsCard(d) {
      var card = el('div', { class: 'aim-card', id: 'gsc-metrics-card', style: { marginBottom: '16px', overflow: 'hidden' } });

      // header row: date range pills + refresh/export
      var pillGroup = el('div', { class: 'aim-sc-period-group' });
      PERIODS.forEach(function (p) {
        pillGroup.appendChild(el('button', {
          type: 'button',
          class: 'aim-sc-period-btn' + (state.period === p.v ? ' active' : ''),
          text: p.label,
          onclick: async function () {
            if (state.period === p.v) return;
            state.period = p.v;
            var fresh = await fetchData(p.v);
            if (fresh) data = fresh;
            renderConnected(root, data);
          },
        }));
      });
      card.appendChild(el('div', {
        class: 'card-header',
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(0, 0, 0, 0.05)', flexWrap: 'wrap', gap: '8px' },
      }, [
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, [
          el('span', { style: { fontSize: '11px', fontWeight: '500', color: 'rgb(84, 93, 108)' }, text: 'Date range:' }),
          pillGroup,
        ]),
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
          el('button', { type: 'button', class: 'aim-export-btn', style: { fontSize: '11px', display: 'flex', alignItems: 'center', gap: '5px' }, html: REFRESH_SVG + 'Refresh', onclick: reload }),
          el('button', {
            type: 'button', title: 'Export',
            class: 'inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 rounded-md px-3',
            html: DOWNLOAD_SVG,
            onclick: function () { exportCsv('peekaboo-gsc-series', d.series); },
          }),
        ]),
      ]));

      // stat cards + granularity select
      var statGrid = el('div', { class: 'aim-sc-stat-grid', role: 'group', 'aria-label': 'Chart metric selector' });
      var chartHolder = el('div', { class: 'chart-wrap', style: { position: 'relative', height: '220px' } });
      var chartInstance = null;

      function statValue(m) {
        if (m.key === 'clicks') return fmtInt(d.totals.clicks);
        if (m.key === 'impressions') return fmtInt(d.totals.impressions);
        if (m.key === 'ctr') return fmtCtrStat(d.totals.ctr);
        return fmtPos(d.totals.position);
      }

      function paintStats() {
        statGrid.innerHTML = '';
        METRICS.forEach(function (m) {
          var active = !!state.activeMetrics[m.key];
          var btn = el('button', {
            type: 'button',
            class: 'aim-sc-stat-card' + (active ? ' active' : ''),
            'aria-pressed': active ? 'true' : 'false',
          }, [
            el('div', { class: 'aim-sc-stat-label', text: m.label }),
            el('div', { class: 'aim-sc-stat-val', text: statValue(m) }),
          ]);
          if (active) {
            btn.style.borderTopColor = 'rgb(' + m.rgb + ')';
            btn.style.backgroundColor = 'rgba(' + m.rgb + ', 0.08)';
          }
          btn.addEventListener('click', function () {
            state.activeMetrics[m.key] = !state.activeMetrics[m.key];
            paintStats();
            paintChart();
          });
          statGrid.appendChild(btn);
        });
      }

      var granSelect = el('select', {
        'aria-label': 'Chart granularity',
        style: { fontSize: '13px', padding: '8px 14px 8px 10px', border: '1px solid rgb(238, 238, 239)', borderRadius: '6px', background: 'rgb(255, 255, 255)', color: 'rgb(28, 25, 23)', cursor: 'pointer', outline: 'none', fontWeight: '500', minWidth: '120px' },
        onchange: function () { state.granularity = granSelect.value; paintChart(); },
      }, [
        el('option', { value: 'daily', text: 'Daily' }),
        el('option', { value: 'weekly', text: 'Weekly' }),
      ]);
      granSelect.value = state.granularity;

      card.appendChild(el('div', { style: { display: 'flex', alignItems: 'stretch', borderBottom: '1px solid rgba(0, 0, 0, 0.05)' } }, [
        statGrid,
        el('div', { style: { flex: '1 1 0%', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0px 16px', borderLeft: '1px solid rgba(0, 0, 0, 0.05)' } }, [granSelect]),
      ]));

      function paintChart() {
        chartHolder.innerHTML = '';
        if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
        var series = state.granularity === 'weekly' ? aggregateWeekly(d.series) : (d.series || []);
        if (!series.length || !window.Chart) {
          chartHolder.appendChild(el('div', { class: 'aim-empty-state', text: 'No time-series data for this range' }));
          return;
        }
        var canvas = el('canvas');
        chartHolder.appendChild(canvas);
        var labels = series.map(function (p) {
          var dd = new Date(p.date);
          return isNaN(dd) ? String(p.date) : dd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });
        var datasets = METRICS.filter(function (m) { return state.activeMetrics[m.key]; }).map(function (m) {
          return {
            label: m.label,
            data: series.map(function (p) { return Number(p[m.key]) || 0; }),
            borderColor: m.hex,
            backgroundColor: m.hex,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.3,
          };
        });
        chartInstance = new window.Chart(canvas, {
          type: 'line',
          data: { labels: labels, datasets: datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'line', font: { size: 11 }, boxWidth: 14 } },
              tooltip: { backgroundColor: '#fff', titleColor: '#1c1917', bodyColor: '#545D6C', borderColor: '#EEEEEF', borderWidth: 1, cornerRadius: 8, titleFont: { size: 12 }, bodyFont: { size: 12 } },
            },
            scales: {
              x: { grid: { color: '#EEEEEF', borderDash: [3, 3] }, ticks: { font: { size: 11 }, color: '#9ca3af', maxTicksLimit: 18 } },
              y: { grid: { color: '#EEEEEF', borderDash: [3, 3] }, ticks: { font: { size: 11 }, color: '#9ca3af' }, beginAtZero: true },
            },
          },
        });
      }

      paintStats();

      var updatedText = d.lastUpdated
        ? 'Last updated: ' + new Date(d.lastUpdated).toLocaleString('en-US')
        : 'Last updated: ' + new Date().toLocaleString('en-US');
      card.appendChild(el('div', { style: { padding: '16px' } }, [
        chartHolder,
        el('div', { style: { marginTop: '6px', fontSize: '10px', color: 'rgb(156, 163, 175)' }, text: updatedText }),
      ]));

      // paint after attach so Chart.js can size the canvas
      setTimeout(paintChart, 0);
      return card;
    }

    // ---- tabs card (Queries / Pages / Gaps) ----------------------------------
    function buildTabsCard(d) {
      var card = el('div', { class: 'aim-card', style: { marginBottom: '0px', overflow: 'hidden' } });
      var body = el('div');

      var tabsBar = el('div', { class: 'aim-tab-bar' });
      var tabDefs = [
        { key: 'queries', label: 'Queries' },
        { key: 'pages', label: 'Pages' },
        { key: 'gaps', label: 'Search-to-AI Gaps', isNew: true },
      ];
      function paintTabs() {
        tabsBar.innerHTML = '';
        tabDefs.forEach(function (t) {
          var btn = el('button', { type: 'button', class: 'aim-tab' + (state.tab === t.key ? ' active' : '') }, [
            t.label,
            t.isNew ? el('span', { class: 'aim-sc-new-pill-sm', text: 'NEW' }) : null,
          ]);
          btn.addEventListener('click', function () {
            if (state.tab === t.key) return;
            state.tab = t.key;
            state.search = '';
            state.showCount = PAGE_SIZE;
            state.pagesShowCount = PAGE_SIZE;
            state.gapsShowCount = PAGE_SIZE;
            paintTabs();
            paintBody();
          });
          tabsBar.appendChild(btn);
        });
      }
      paintTabs();

      card.appendChild(el('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid rgba(0, 0, 0, 0.05)', flexWrap: 'wrap', gap: '8px' },
      }, [tabsBar]));
      card.appendChild(body);

      function paintBody() {
        body.innerHTML = '';
        if (state.tab === 'queries') paintQueriesTab(body, d);
        else if (state.tab === 'pages') paintPagesTab(body, d);
        else paintGapsTab(body, d);
      }
      paintBody();

      var wrap = el('div');
      wrap.appendChild(card);
      // amber duplicate-cleanup callout (queries reference page)
      wrap.appendChild(buildDuplicateCallout());
      return wrap;
    }

    function buildDuplicateCallout() {
      return el('div', { class: 'mt-6', style: { background: 'rgb(255, 251, 235)', border: '1px solid rgb(253, 230, 138)', borderRadius: '10px', padding: '14px 16px' } }, [
        el('div', { class: 'flex items-start justify-between gap-4 flex-wrap' }, [
          el('div', { class: 'flex-1 min-w-[240px]' }, [
            el('div', { class: 'flex items-center gap-2 mb-1' }, [
              el('span', { html: ALERT_SVG }),
              el('h3', { class: 'text-[13px] font-semibold', style: { color: 'rgb(120, 53, 15)' }, text: 'Seeing duplicate queries?' }),
            ]),
            el('p', { class: 'text-[12px]', style: { color: 'rgb(146, 64, 14)' }, text: "If you're seeing duplicates in the table above, clean them up here. This keeps only the most recent data for each query." }),
          ]),
          el('button', {
            type: 'button', class: 'aim-export-btn',
            style: { fontSize: '11px', borderColor: 'rgb(253, 230, 138)', color: 'rgb(120, 53, 15)', background: 'rgb(255, 255, 255)', opacity: '1', cursor: 'pointer' },
            html: REFRESH_SVG + 'Clean Up Duplicates',
            onclick: function () { PB.toast('Duplicate cleanup is only available in the real product'); },
          }),
        ]),
      ]);
    }

    // ---- shared table bits ----------------------------------------------------
    function toolbarRow(opts) {
      var input = el('input', {
        placeholder: opts.placeholder, type: 'text', value: state.search,
        style: { width: '100%', padding: '6px 12px 6px 32px', border: '1px solid rgb(238, 238, 239)', borderRadius: '6px', fontSize: '12px', background: 'rgb(255, 255, 255)', color: 'rgb(28, 25, 23)', outline: 'none' },
        oninput: function () { state.search = input.value; opts.onchange(); },
      });
      var rightBits = [];
      if (opts.sortSelect) rightBits.push(opts.sortSelect);
      rightBits.push(el('button', {
        type: 'button', title: 'Export',
        class: 'inline-flex items-center justify-center whitespace-nowrap font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 rounded-md px-3 text-xs',
        html: DOWNLOAD_SVG,
        onclick: opts.onExport,
      }));
      return el('div', {
        style: { padding: '8px 16px', borderBottom: '1px solid rgba(0, 0, 0, 0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' },
      }, [
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 0%', minWidth: '240px' } }, [
          el('div', { class: 'relative flex-1', style: { maxWidth: '320px' } }, [
            el('span', { html: SEARCH_INPUT_SVG }),
            input,
          ]),
          opts.countLabel,
        ]),
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, rightBits),
      ]);
    }

    function tableFooter(shown, total, onMore) {
      var remaining = total - shown;
      return el('div', {
        style: { padding: '10px 16px', borderTop: '1px solid rgba(0, 0, 0, 0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
      }, [
        el('span', { style: { fontSize: '11px', color: 'rgb(156, 163, 175)' }, text: Math.min(shown, total) + ' of ' + total }),
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
          remaining > 0 ? el('button', {
            type: 'button',
            style: { fontSize: '11px', color: 'var(--theme-primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '500' },
            text: 'Show More (' + Math.min(PAGE_SIZE, remaining) + ' more)',
            onclick: onMore,
          }) : null,
        ]),
      ]);
    }

    function convertBtn(query) {
      return el('button', {
        type: 'button', class: 'aim-sc-convert-btn', html: PLUS_SVG + 'Convert to Prompt',
        onclick: function () { PB.toast('Convert to Prompt: "' + query + '" (only available in the real product)'); },
      });
    }

    function exportCsv(prefix, rows) {
      if (!rows || !rows.length) { PB.toast('Nothing to export'); return; }
      var keys = Object.keys(rows[0]);
      var lines = [keys.join(',')];
      rows.forEach(function (r) {
        lines.push(keys.map(function (k) {
          var v = String(r[k] === null || r[k] === undefined ? '' : r[k]);
          if (v.indexOf(',') !== -1 || v.indexOf('"') !== -1 || v.indexOf('\n') !== -1) return '"' + v.replace(/"/g, '""') + '"';
          return v;
        }).join(','));
      });
      var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = prefix + '-' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
    }

    // ---- Queries tab ----------------------------------------------------------
    function paintQueriesTab(host, d) {
      host.innerHTML = '';
      var counts = intentCounts(d.queries);

      // intent pill row
      var pills = el('div', { class: 'aim-sc-intent-pills' });
      function pill(label, key, count) {
        return el('button', {
          type: 'button',
          class: 'aim-sc-intent-pill' + (state.intentFilter === key ? ' active' : ''),
          text: label + ' (' + count + ')',
          onclick: function () { state.intentFilter = key; state.showCount = PAGE_SIZE; paintQueriesTab(host, d); },
        });
      }
      pills.appendChild(pill('All', 'all', counts.all || 0));
      INTENT_ORDER.forEach(function (intent) {
        if (counts[intent]) pills.appendChild(pill(intent, intent, counts[intent]));
      });
      host.appendChild(pills);

      // filter + sort
      var filtered = d.queries.filter(function (q) {
        if (state.intentFilter !== 'all' && q.intent !== state.intentFilter) return false;
        var s = state.search.trim().toLowerCase();
        return !s || q.query.toLowerCase().indexOf(s) !== -1;
      });
      var sorted = sortRows(filtered, state.sortKey);
      var visible = sorted.slice(0, state.showCount);

      var sortSelect = el('select', {
        style: { fontSize: '11px', padding: '4px 8px', border: '1px solid rgb(238, 238, 239)', borderRadius: '6px', background: 'rgb(255, 255, 255)', color: 'rgb(84, 93, 108)', cursor: 'pointer', outline: 'none' },
        onchange: function () { state.sortKey = sortSelect.value; paintQueriesTab(host, d); },
      }, [
        el('option', { value: 'clicks', text: 'Sort by Clicks' }),
        el('option', { value: 'impressions', text: 'Sort by Impressions' }),
        el('option', { value: 'ctr', text: 'Sort by CTR' }),
        el('option', { value: 'position', text: 'Sort by Position' }),
      ]);
      sortSelect.value = state.sortKey;

      host.appendChild(toolbarRow({
        placeholder: 'Search queries...',
        countLabel: el('span', { class: 'text-[12px] text-[#545D6C]', text: 'Showing ' + visible.length + ' of ' + d.queries.length + ' queries' }),
        sortSelect: sortSelect,
        onchange: function () { state.showCount = PAGE_SIZE; paintQueriesTab(host, d); },
        onExport: function () { exportCsv('peekaboo-gsc-queries', sorted); },
      }));

      // table
      var tbody = el('tbody');
      if (!visible.length) {
        tbody.appendChild(el('tr', {}, [el('td', { colspan: '7' }, [el('div', { class: 'aim-empty-state', text: 'No queries match' })])]));
      }
      visible.forEach(function (q) {
        tbody.appendChild(el('tr', {}, [
          el('td', { class: 'col-left' }, [
            el('div', { class: 'flex items-center gap-2' }, [
              el('span', { html: SEARCH_ROW_SVG }),
              el('span', { class: 'font-medium text-[12px] text-[#1c1917]', text: q.query }),
            ]),
          ]),
          el('td', { style: { textAlign: 'left' } }, [
            el('span', { class: 'aim-sc-intent-tag ' + String(q.intent || 'unclassified').toLowerCase(), text: q.intent }),
          ]),
          el('td', { style: { textAlign: 'right', fontWeight: '600' }, text: fmtInt(q.clicks) }),
          el('td', { style: { textAlign: 'right', color: 'rgb(84, 93, 108)' }, text: fmtInt(q.impressions) }),
          el('td', { style: { textAlign: 'right', color: 'rgb(84, 93, 108)' }, text: fmtCtrCell(q.ctr) }),
          el('td', { style: { textAlign: 'right', color: 'rgb(84, 93, 108)' }, text: fmtPos(q.position) }),
          el('td', { style: { textAlign: 'right' } }, [convertBtn(q.query)]),
        ]));
      });
      host.appendChild(el('div', { id: 'gsc-queries-table', class: 'table-wrap', style: { overflowX: 'auto' } }, [
        el('table', { class: 'aim-full-table', style: { minWidth: '680px' } }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { class: 'col-left', text: 'Query' }),
            el('th', { text: 'Intent' }),
            el('th', { style: { textAlign: 'right' }, text: 'Clicks' }),
            el('th', { style: { textAlign: 'right' }, text: 'Impressions' }),
            el('th', { style: { textAlign: 'right' }, text: 'CTR' }),
            el('th', { style: { textAlign: 'right' }, text: 'Position' }),
            el('th', { style: { textAlign: 'right' }, text: 'Action' }),
          ])]),
          tbody,
        ]),
      ]));

      host.appendChild(tableFooter(visible.length, sorted.length, function () {
        state.showCount += PAGE_SIZE;
        paintQueriesTab(host, d);
      }));
    }

    // ---- Pages tab ------------------------------------------------------------
    function paintPagesTab(host, d) {
      host.innerHTML = '';
      var filtered = d.pages.filter(function (p) {
        var s = state.search.trim().toLowerCase();
        return !s || p.url.toLowerCase().indexOf(s) !== -1;
      });
      var sorted = sortRows(filtered, 'clicks');
      var visible = sorted.slice(0, state.pagesShowCount);

      host.appendChild(toolbarRow({
        placeholder: 'Search pages...',
        countLabel: el('span', { class: 'text-[12px] text-[#545D6C]', text: 'Showing ' + visible.length + ' of ' + d.pages.length + ' pages' }),
        sortSelect: null,
        onchange: function () { state.pagesShowCount = PAGE_SIZE; paintPagesTab(host, d); },
        onExport: function () { exportCsv('peekaboo-gsc-pages', sorted); },
      }));

      var tbody = el('tbody');
      if (!visible.length) {
        tbody.appendChild(el('tr', {}, [el('td', { colspan: '5' }, [el('div', { class: 'aim-empty-state', text: 'No pages match' })])]));
      }
      visible.forEach(function (p) {
        var ctrCell;
        if ((Number(p.ctr) || 0) >= 5) {
          ctrCell = el('td', { style: { textAlign: 'right' } }, [
            el('span', { style: { color: 'rgb(22, 163, 74)', fontWeight: '600' }, text: (Number(p.ctr) || 0).toFixed(2) + '%' }),
          ]);
        } else {
          ctrCell = el('td', { style: { textAlign: 'right', color: 'rgb(84, 93, 108)' }, text: (Number(p.ctr) || 0).toFixed(2) + '%' });
        }
        tbody.appendChild(el('tr', {}, [
          el('td', { class: 'col-left' }, [
            el('a', {
              href: p.url, target: '_blank', rel: 'noopener noreferrer',
              class: 'text-brand hover:underline flex items-center gap-1 max-w-md truncate text-[12px]',
            }, [
              el('span', { class: 'truncate', text: p.url }),
              el('span', { html: EXTLINK_SVG }),
            ]),
          ]),
          el('td', { style: { textAlign: 'right', fontWeight: '600' }, text: fmtInt(p.clicks) }),
          el('td', { style: { textAlign: 'right', color: 'rgb(84, 93, 108)' }, text: fmtInt(p.impressions) }),
          ctrCell,
          el('td', { style: { textAlign: 'right', color: 'rgb(84, 93, 108)' }, text: fmtPos(p.position) }),
        ]));
      });
      host.appendChild(el('div', { id: 'gsc-pages-table', class: 'table-wrap', style: { overflowX: 'auto' } }, [
        el('table', { class: 'aim-full-table', style: { minWidth: '580px' } }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { class: 'col-left', text: 'Page' }),
            el('th', { style: { textAlign: 'right' }, text: 'Clicks ↓' }),
            el('th', { style: { textAlign: 'right' }, text: 'Impressions' }),
            el('th', { style: { textAlign: 'right' }, text: 'CTR' }),
            el('th', { style: { textAlign: 'right' }, text: 'Position' }),
          ])]),
          tbody,
        ]),
      ]));

      host.appendChild(tableFooter(visible.length, sorted.length, function () {
        state.pagesShowCount += PAGE_SIZE;
        paintPagesTab(host, d);
      }));
    }

    // ---- Search-to-AI Gaps tab --------------------------------------------------
    function paintGapsTab(host, d) {
      host.innerHTML = '';
      var gaps = deriveGaps(d.queries).filter(function (g) {
        var s = state.search.trim().toLowerCase();
        return !s || g.query.toLowerCase().indexOf(s) !== -1;
      });
      var visible = gaps.slice(0, state.gapsShowCount);

      host.appendChild(el('div', { style: { padding: '10px 16px', borderBottom: '1px solid rgba(0, 0, 0, 0.05)' } }, [
        el('div', { class: 'text-[12px] text-[#545D6C]', text: 'Search demand that is not yet covered by your AI prompts. Convert these queries into prompts to capture the same intent in AI answers.' }),
      ]));

      host.appendChild(toolbarRow({
        placeholder: 'Search gaps...',
        countLabel: el('span', { class: 'text-[12px] text-[#545D6C]', text: 'Showing ' + visible.length + ' of ' + gaps.length + ' gaps' }),
        sortSelect: null,
        onchange: function () { state.gapsShowCount = PAGE_SIZE; paintGapsTab(host, d); },
        onExport: function () { exportCsv('peekaboo-gsc-gaps', gaps); },
      }));

      var tbody = el('tbody');
      if (!visible.length) {
        tbody.appendChild(el('tr', {}, [el('td', { colspan: '6' }, [el('div', { class: 'aim-empty-state', text: 'No search-to-AI gaps detected' })])]));
      }
      visible.forEach(function (q) {
        tbody.appendChild(el('tr', {}, [
          el('td', { class: 'col-left' }, [
            el('div', { class: 'flex items-center gap-2' }, [
              el('span', { html: SEARCH_ROW_SVG }),
              el('span', { class: 'font-medium text-[12px] text-[#1c1917]', text: q.query }),
            ]),
          ]),
          el('td', { style: { textAlign: 'left' } }, [
            el('span', { class: 'aim-sc-intent-tag ' + String(q.intent || 'unclassified').toLowerCase(), text: q.intent }),
          ]),
          el('td', { style: { textAlign: 'right', fontWeight: '600' }, text: fmtInt(q.clicks) }),
          el('td', { style: { textAlign: 'right', color: 'rgb(84, 93, 108)' }, text: fmtInt(q.impressions) }),
          el('td', { style: { textAlign: 'right', color: 'rgb(84, 93, 108)' }, text: fmtPos(q.position) }),
          el('td', { style: { textAlign: 'right' } }, [convertBtn(q.query)]),
        ]));
      });
      host.appendChild(el('div', { id: 'gsc-gaps-table', class: 'table-wrap', style: { overflowX: 'auto' } }, [
        el('table', { class: 'aim-full-table', style: { minWidth: '620px' } }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { class: 'col-left', text: 'Query' }),
            el('th', { text: 'Intent' }),
            el('th', { style: { textAlign: 'right' }, text: 'Clicks' }),
            el('th', { style: { textAlign: 'right' }, text: 'Impressions' }),
            el('th', { style: { textAlign: 'right' }, text: 'Position' }),
            el('th', { style: { textAlign: 'right' }, text: 'Action' }),
          ])]),
          tbody,
        ]),
      ]));

      host.appendChild(tableFooter(visible.length, gaps.length, function () {
        state.gapsShowCount += PAGE_SIZE;
        paintGapsTab(host, d);
      }));
    }
  });

  // pure helpers exposed for unit tests (node --test live-app/tests/)
  PB._searchConsoleInternals = {
    classifyIntent: classifyIntent,
    computeTotals: computeTotals,
    aggregateWeekly: aggregateWeekly,
    intentCounts: intentCounts,
    sortRows: sortRows,
    deriveGaps: deriveGaps,
    normalizeData: normalizeData,
    fmtInt: fmtInt,
    fmtCtrStat: fmtCtrStat,
    fmtCtrCell: fmtCtrCell,
    fmtPos: fmtPos,
  };
})();
