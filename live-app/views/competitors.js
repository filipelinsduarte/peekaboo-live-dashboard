/*
 * competitors.js — Competitors view (live), pixel-matched to the captured
 * reference at app/competitors.html (the real aipeekaboo.com /competitors).
 *
 * Sections (top to bottom, exactly like the reference):
 *   1. Tracking bar: competitor favicon chips, "+N" overflow,
 *      "Manage Competitors" and "Add Competitor" buttons
 *   2. .aim-scope > .aim-two-col:
 *        - "Top Brands by AI Mentions" card (ranked bar list, 10 per page)
 *        - "Brand × Model Heatmap" card (5 model columns, sortable, 8 per page)
 *   3. "Prompt × Brand Ranking Matrix" card (top 5 brands per tracked prompt)
 *   4. "Website Traffic" card (monthly visits bars, 8 per page)
 *
 * Styling comes from the REAL compiled product CSS (.aim-* classes in
 * /_next/static/css/fb9cebaaf381bc0d.css), already loaded by index.html.
 *
 * Data sources (live API, unchanged):
 *   - PB.api.competitors(brandId) -> { brand, competitors[], summary }
 *   - PB.api.looker({...})        -> daily rows (entity_name x ai_model x prompt)
 *
 * Pure aggregation/color helpers are exposed on PB._competitorsInternals so
 * they can be unit-tested in node (see live-app/tests/competitors.view.test.mjs).
 */
(function () {
  'use strict';
  if (!window.PB) return;
  var el = PB.el;

  // The captured shell only PRELOADS the route-level stylesheet that defines
  // every .aim-* class (the real Next app attaches it on route navigation).
  // Attach it as a real stylesheet once, or the whole view renders unstyled.
  var AIM_CSS_HREF = '/_next/static/css/fb9cebaaf381bc0d.css';
  function ensureAimCss() {
    try {
      var attached = document.querySelector('link[rel="stylesheet"][href="' + AIM_CSS_HREF + '"]');
      if (attached) return;
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = AIM_CSS_HREF;
      document.head.appendChild(link);
    } catch (e) { console.error('[competitors] ensureAimCss', e); }
  }
  ensureAimCss();

  // ---- heatmap model columns (exact order + labels from the reference) ------
  var HEAT_COLS = [
    { tag: 'gpt-4o-mini',      label: 'GPT', fav: 'openai.com' },
    { tag: 'gemini-2.5-flash', label: 'Gem', fav: 'gemini.google.com' },
    { tag: 'google-aio',       label: 'AIO', fav: 'google.com' },
    { tag: 'google-ai-mode',   label: 'AIM', fav: 'google.com' },
    { tag: 'sonar',            label: 'PPX', fav: 'perplexity.ai' },
  ];

  var SLATE = 'rgb(148, 163, 184)';        // competitor bar fill (reference)
  var ACCENT = 'var(--theme-primary, #b352b3)'; // "You" bar fill

  // ---- pure helpers (testable) ----------------------------------------------
  function domainOf(url) {
    if (!url) return '';
    return String(url).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }
  function fav32(urlOrDomain) {
    var d = domainOf(urlOrDomain);
    if (!d) return '';
    return 'https://www.google.com/s2/favicons?domain=' + d + '&sz=32';
  }

  // Heat pill background: red (#dc2626) -> yellow (#eab308) -> green (#16a34a),
  // alpha 0.88. Matches the reference samples exactly (0% = rgba(220,38,38,.88)).
  function heatBg(value) {
    var v = Number(value);
    if (!isFinite(v)) v = 0;
    var t = Math.min(1, Math.max(0, v / 100));
    var red = [220, 38, 38], yellow = [234, 179, 8], green = [22, 163, 74];
    var a, b, u;
    if (t <= 0.5) { a = red; b = yellow; u = t * 2; }
    else { a = yellow; b = green; u = (t - 0.5) * 2; }
    var r = Math.round(a[0] + (b[0] - a[0]) * u);
    var g = Math.round(a[1] + (b[1] - a[1]) * u);
    var bl = Math.round(a[2] + (b[2] - a[2]) * u);
    return 'rgba(' + r + ', ' + g + ', ' + bl + ', 0.88)';
  }

  // Group looker rows: entity -> model -> { sum, n } and entity -> { sum, n }
  function aggregateLooker(rows) {
    var byEntityModel = {};
    var byEntity = {};
    (rows || []).forEach(function (r) {
      var name = r.entity_name || r.brand;
      var model = r.ai_model;
      if (!name) return;
      var vis = Number(r.visibility) || 0;
      byEntity[name] = byEntity[name] || { sum: 0, n: 0 };
      byEntity[name].sum += vis;
      byEntity[name].n += 1;
      if (!model) return;
      byEntityModel[name] = byEntityModel[name] || {};
      byEntityModel[name][model] = byEntityModel[name][model] || { sum: 0, n: 0 };
      byEntityModel[name][model].sum += vis;
      byEntityModel[name][model].n += 1;
    });
    return { byEntityModel: byEntityModel, byEntity: byEntity };
  }
  function cellAvg(byEntityModel, name, model) {
    var c = byEntityModel[name] && byEntityModel[name][model];
    if (!c || !c.n) return null;
    return c.sum / c.n;
  }

  // Group looker rows per prompt: prompt -> [{ name, mentions, vis }] (ranked).
  function promptMatrix(rows, topN) {
    var order = [];
    var byPrompt = {};
    (rows || []).forEach(function (r) {
      var p = r.prompt;
      var name = r.entity_name || r.brand;
      if (!p || !name) return;
      if (!byPrompt[p]) { byPrompt[p] = {}; order.push(p); }
      var e = byPrompt[p][name] = byPrompt[p][name] || { name: name, mentions: 0, vis: 0 };
      var vis = Number(r.visibility) || 0;
      if (vis > 0) e.mentions += 1;
      e.vis += vis;
    });
    return order.map(function (p) {
      var ranked = Object.keys(byPrompt[p]).map(function (k) { return byPrompt[p][k]; })
        .filter(function (e) { return e.mentions > 0; })
        .sort(function (a, b) { return (b.mentions - a.mentions) || (b.vis - a.vis); })
        .slice(0, topN || 5);
      return { prompt: p, brands: ranked };
    });
  }

  // expose pure helpers for unit tests
  PB._competitorsInternals = {
    heatBg: heatBg, aggregateLooker: aggregateLooker, cellAvg: cellAvg,
    promptMatrix: promptMatrix, domainOf: domainOf,
  };

  // ---- small shared builders -------------------------------------------------
  function rangeDays(r) { return r === '90d' ? 90 : r === '30d' ? 30 : 7; }
  function isoDaysAgo(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }
  function isoToday() { return new Date().toISOString().slice(0, 10); }

  function brandUrl(ctx) {
    var brands = (PB.state && PB.state.brands) ? PB.state.brands : [];
    var b = brands.find(function (x) { return x.id === ctx.brandId; });
    return b ? b.url : '';
  }

  function favImg(urlOrDomain, size, alt) {
    return el('img', {
      alt: alt || '',
      width: size, height: size,
      src: fav32(urlOrDomain),
      style: { width: size + 'px', height: size + 'px', borderRadius: '3px', flexShrink: '0' },
      onerror: "this.style.visibility='hidden'",
    });
  }

  var PAGER_PREV = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M9 3L5 7l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  var PAGER_NEXT = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

  // Pager (header right side): prev arrow, "1–10 of 100", next arrow.
  function buildPager(total, pageSize, onPage) {
    var page = 0;
    var prev = el('button', { class: 'aim-pager-btn', 'aria-label': 'Previous page', html: PAGER_PREV });
    var next = el('button', { class: 'aim-pager-btn', 'aria-label': 'Next page', html: PAGER_NEXT });
    var range = el('span', { class: 'aim-pager-range', style: { minWidth: '55px', whiteSpace: 'nowrap' } });
    function paint() {
      var from = total === 0 ? 0 : page * pageSize + 1;
      var to = Math.min(total, (page + 1) * pageSize);
      range.textContent = from + '–' + to + ' of ' + total;
      if (page <= 0) prev.setAttribute('disabled', ''); else prev.removeAttribute('disabled');
      if (to >= total) next.setAttribute('disabled', ''); else next.removeAttribute('disabled');
    }
    prev.addEventListener('click', function () { if (page > 0) { page -= 1; paint(); onPage(page); } });
    next.addEventListener('click', function () { if ((page + 1) * pageSize < total) { page += 1; paint(); onPage(page); } });
    paint();
    var node = el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--aim-text-faint)' } }, [prev, range, next]);
    return { node: node, getPage: function () { return page; } };
  }

  // .aim-card with header (title + desc + optional right controls).
  function aimCard(title, desc, rightNode, bodyNode, cardStyle) {
    var head = el('div', { class: 'aim-card-header' }, [
      el('div', {}, [
        el('div', { class: 'aim-card-title', text: title }),
        el('div', { class: 'aim-card-desc', text: desc }),
      ]),
      rightNode || null,
    ]);
    return el('div', { class: 'aim-card', style: cardStyle || null }, [head, bodyNode]);
  }

  function emptyState(msg) {
    return el('div', { class: 'aim-empty-state', text: msg });
  }

  // ---- view ------------------------------------------------------------------
  PB.registerView('competitors', async function (root, ctx) {
    var compPromise = PB.api.competitors(ctx.brandId).catch(function () { return null; });
    var lookerPromise = PB.api.looker({
      start_date: isoDaysAgo(rangeDays(ctx.range)),
      end_date: isoToday(),
      brand_id: ctx.brandId,
      include_competitors: 'true',
      limit: 5000,
    }).catch(function () { return null; });

    var comp = await compPromise;
    var looker = await lookerPromise;

    var untrackedResult = (window.PBUntracked)
      ? await window.PBUntracked.fetch(ctx.brandId, ctx.range || '7d').catch(function () { return { rows: [], entityStats: {} }; })
      : { rows: [], entityStats: {} };
    var untrackedRows = untrackedResult.rows || [];
    var entityStats = untrackedResult.entityStats || {};

    comp = comp || {};
    var brand = comp.brand || { name: ctx.brandName, score: 0, trend: 'stable' };
    var competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
    var lookerRows = (looker && Array.isArray(looker.data)) ? looker.data : [];
    var allRows = lookerRows.concat(untrackedRows);
    var agg = aggregateLooker(allRows);

    var brandEnt = { name: brand.name || ctx.brandName, url: brandUrl(ctx), score: brand.score || 0, isYou: true };

    // Collect unique untracked entity names
    var trackedAndBrandNames = {};
    trackedAndBrandNames[(brand.name || ctx.brandName || '').toLowerCase()] = true;
    competitors.forEach(function (c) {
      if (c && c.name) trackedAndBrandNames[c.name.toLowerCase()] = true;
    });
    var untrackedEntities = [];
    var seenUntracked = {};
    untrackedRows.forEach(function (r) {
      var key = (r.entity_name || '').toLowerCase();
      if (!key || trackedAndBrandNames[key] || seenUntracked[key]) return;
      seenUntracked[key] = true;
      untrackedEntities.push({ name: r.entity_name, url: '', isYou: false, isUntracked: true });
    });

    root.innerHTML = '';
    var wrap = el('div', { class: 'space-y-6', style: { paddingTop: '0.75rem' } });

    // 1. Tracking bar
    try { wrap.appendChild(buildTrackingBar(competitors)); }
    catch (e) { console.error('[competitors] tracking bar', e); }

    // 2-4. aim-scope content
    var scope = el('div', { class: 'aim-scope' });
    try {
      var twoCol = el('div', { class: 'aim-two-col', style: { alignItems: 'stretch', marginBottom: '18px' } });
      twoCol.appendChild(buildTopBrandsCard(brandEnt, competitors, agg, untrackedEntities, entityStats));
      twoCol.appendChild(buildHeatmapCard(brandEnt, competitors, agg, ctx, untrackedEntities, entityStats));
      scope.appendChild(twoCol);
    } catch (e) { console.error('[competitors] two-col', e); }
    try { scope.appendChild(buildPromptMatrixCard(brandEnt, competitors, allRows, untrackedEntities)); }
    catch (e) { console.error('[competitors] prompt matrix', e); }
    try {
      scope.appendChild(el('div', { style: { marginTop: '18px' } }, [buildTrafficCard(brandEnt, competitors)]));
    } catch (e) { console.error('[competitors] traffic', e); }

    wrap.appendChild(scope);
    root.appendChild(wrap);
    if (window.lucide) window.lucide.createIcons();
  });

  // ---- 1. Tracking bar ---------------------------------------------------------
  var USERS_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-users h-[11px] w-[11px]" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>';
  var PLUS_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus h-[11px] w-[11px]" aria-hidden="true"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>';

  function competitorChip(c) {
    return el('button', {
      type: 'button',
      class: 'inline-flex items-center gap-[5px] rounded-[20px] border border-[#EEEEEF] bg-[#fafafa] py-[3px] pl-[5px] pr-2 text-[11px] text-[#1c1917] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1',
      'aria-label': 'Manage ' + c.name,
    }, [
      el('div', { class: 'relative', style: { width: '14px', height: '14px' } }, [
        el('img', {
          alt: c.name, width: 14, height: 14, loading: 'eager',
          class: 'rounded object-contain bg-white border border-gray-200/60 shadow-sm opacity-100',
          src: 'https://www.google.com/s2/favicons?sz=64&domain=' + domainOf(c.url),
          style: { width: '14px', height: '14px', position: 'relative', top: '0px', left: '0px' },
          onerror: "this.style.visibility='hidden'",
        }),
      ]),
      el('span', { class: 'truncate', text: c.name }),
    ]);
  }

  function buildTrackingBar(competitors) {
    var MAX_CHIPS = 7;
    var chipWrap = el('div', { class: 'flex min-w-0 flex-1 flex-wrap items-center gap-[6px]' });
    function paintChips(showAll) {
      chipWrap.innerHTML = '';
      var visible = showAll ? competitors : competitors.slice(0, MAX_CHIPS);
      visible.forEach(function (c) { chipWrap.appendChild(competitorChip(c)); });
      var hidden = competitors.length - visible.length;
      if (hidden > 0) {
        var more = el('button', {
          type: 'button',
          class: 'inline-flex items-center rounded-[20px] border border-[#EEEEEF] bg-[#fafafa] px-[10px] py-[3px] text-[11px] font-semibold text-[#545D6C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1',
          'aria-label': 'Show ' + hidden + ' more competitor' + (hidden === 1 ? '' : 's'),
          text: '+' + hidden,
          onclick: function () { paintChips(true); },
        });
        chipWrap.appendChild(more);
      }
      if (!competitors.length) {
        chipWrap.appendChild(el('span', { class: 'text-[11px] text-[#9CA3AF]', text: 'No competitors tracked yet' }));
      }
    }
    paintChips(false);

    var manageBtn = el('button', {
      type: 'button',
      class: 'inline-flex items-center gap-1 rounded-[7px] border border-[#EEEEEF] bg-white px-[10px] py-[5px] text-[11px] font-medium text-[#1c1917] transition-colors hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1',
      onclick: function () { PB.toast('Manage Competitors is read-only in the local mirror'); },
    });
    manageBtn.innerHTML = USERS_SVG + 'Manage Competitors';

    var addBtn = el('button', {
      type: 'button',
      class: 'inline-flex items-center gap-1 rounded-[7px] bg-brand px-3 py-[5px] text-[11px] font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50',
      onclick: function () { PB.toast('Add Competitor is read-only in the local mirror'); },
    });
    addBtn.innerHTML = PLUS_SVG + 'Add Competitor';

    return el('div', {
      class: 'flex min-h-[52px] flex-wrap items-center gap-[14px] rounded-lg border border-[#EEEEEF] bg-white px-[14px] py-[10px]',
      'aria-label': 'Tracked competitors',
    }, [
      el('div', { class: 'flex min-w-0 flex-1 flex-wrap items-center gap-2 overflow-hidden' }, [
        el('span', { class: 'shrink-0 whitespace-nowrap text-[12px] font-semibold text-[#545D6C]', text: 'Tracking' }),
        chipWrap,
      ]),
      el('div', { class: 'flex shrink-0 items-center gap-2' }, [manageBtn, addBtn]),
    ]);
  }

  // ---- 2a. Top Brands by AI Mentions -------------------------------------------
  function buildTopBrandsCard(brandEnt, competitors, agg, untrackedEntities, entityStats) {
    var PAGE = 10;
    // ranked list: brand + tracked competitors, by visibility score desc
    var rows = [{ name: brandEnt.name, url: brandEnt.url, score: brandEnt.score, isYou: true }];
    competitors.forEach(function (c) {
      rows.push({ name: c.name, url: c.url, score: Number(c.score) || 0, isYou: false });
    });
    // add untracked entities — use pre-computed entityStats for correct visibility %
    (untrackedEntities || []).forEach(function (u) {
      var score = 0;
      if (entityStats && entityStats[u.name] != null) {
        score = entityStats[u.name].vis;
      } else if (agg.byEntity[u.name] && agg.byEntity[u.name].n) {
        score = agg.byEntity[u.name].sum / agg.byEntity[u.name].n;
      }
      rows.push({ name: u.name, url: u.url, score: score, isYou: false, isUntracked: true });
    });
    // prefer looker-derived mention % when the API score is missing
    rows.forEach(function (r) {
      if ((!r.score || r.score === 0) && agg.byEntity[r.name] && agg.byEntity[r.name].n) {
        r.score = agg.byEntity[r.name].sum / agg.byEntity[r.name].n;
      }
    });
    rows.sort(function (a, b) { return b.score - a.score; });
    var max = rows.reduce(function (m, r) { return Math.max(m, r.score); }, 0) || 1;

    var body = el('div', { style: { overflow: 'auto', flex: '1 1 0%', padding: '4px 2px', display: 'flex', flexDirection: 'column' } });
    function paint(page) {
      body.innerHTML = '';
      var slice = rows.slice(page * PAGE, page * PAGE + PAGE);
      if (!slice.length) { body.appendChild(emptyState('No brand mentions in this range yet.')); return; }
      slice.forEach(function (r, i) {
        var rank = page * PAGE + i + 1;
        var favNode = (r.isUntracked && !r.url)
          ? el('span', { style: { width: '16px', height: '16px', borderRadius: '3px', background: 'rgba(148,163,184,0.2)', color: 'rgb(100,116,139)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: '700', flexShrink: '0' }, text: (r.name || '?').charAt(0).toUpperCase() })
          : favImg(r.url, 16, '');
        var info = el('div', { class: 'aim-comp-bar-info' }, [
          favNode,
          el('span', { class: 'aim-comp-bar-name', title: r.name, text: r.name }),
          r.isYou ? el('span', { class: 'aim-you-badge', style: { flexShrink: '0', fontSize: '8px', padding: '1px 4px' }, text: 'You' }) : null,
          r.isUntracked
            ? el('span', { style: { flexShrink: '0', fontSize: '8px', padding: '1px 5px', borderRadius: '4px',
                background: 'rgba(148,163,184,0.18)', color: 'rgb(100,116,139)', fontWeight: '600' }, text: 'untracked' })
            : null,
        ]);
        body.appendChild(el('div', { class: 'aim-comp-bar-row', style: { flex: '1 1 0%' } }, [
          el('span', { class: 'aim-comp-bar-rank', text: String(rank) }),
          info,
          el('div', { class: 'aim-comp-bar-track' }, [
            el('div', { class: 'aim-comp-bar-fill', style: { width: (Math.max(0, r.score) / max * 100).toFixed(1) + '%', background: r.isYou ? ACCENT : SLATE } }),
          ]),
          el('span', { class: 'aim-comp-bar-pct', text: Math.round(r.score) + '%' }),
        ]));
      });
    }
    var pager = buildPager(rows.length, PAGE, paint);
    paint(0);

    return aimCard(
      'Top Brands by AI Mentions',
      'Ranked by % of AI responses where each brand appears',
      pager.node,
      body,
      { flex: '1 1 0%', display: 'flex', flexDirection: 'column', minWidth: '0px' }
    );
  }

  // ---- 2b. Brand × Model Heatmap -------------------------------------------------
  function buildHeatmapCard(brandEnt, competitors, agg, ctx, untrackedEntities, entityStats) {
    var PAGE = 8;
    var entities = [{ name: brandEnt.name, url: brandEnt.url, isYou: true }];
    var seen = {}; seen[brandEnt.name] = true;
    competitors.forEach(function (c) {
      if (!c || !c.name || seen[c.name]) return;
      seen[c.name] = true;
      entities.push({ name: c.name, url: c.url, isYou: false });
    });
    (untrackedEntities || []).forEach(function (u) {
      if (!u || !u.name || seen[u.name]) return;
      seen[u.name] = true;
      entities.push({ name: u.name, url: u.url, isYou: false, isUntracked: true });
    });

    var sortCol = null, sortDir = -1; // -1 desc, 1 asc

    var bodyWrap = el('div', { style: { padding: '0px', flex: '1 1 0%', overflow: 'auto' } });
    var pager = buildPager(entities.length, PAGE, function (p) { paint(p); });

    function orderedEntities() {
      if (!sortCol) return entities;
      var copy = entities.slice();
      copy.sort(function (a, b) {
        var av = cellAvg(agg.byEntityModel, a.name, sortCol); if (av == null) av = -1;
        var bv = cellAvg(agg.byEntityModel, b.name, sortCol); if (bv == null) bv = -1;
        if (sortDir === -1) return bv - av; // descending
        return av - bv;                     // ascending
      });
      return copy;
    }

    function paint(page) {
      bodyWrap.innerHTML = '';
      if (!entities.length) { bodyWrap.appendChild(emptyState('No competitors tracked yet.')); return; }

      var table = el('table', { class: 'aim-hm-table', style: { height: '100%' } });
      var headRow = el('tr', {}, [el('th')]);
      HEAT_COLS.forEach(function (m) {
        var active = sortCol === m.tag;
        var th = el('th', {
          'aria-sort': active ? (sortDir === -1 ? 'descending' : 'ascending') : 'none',
          style: { cursor: 'pointer', userSelect: 'none' },
          onclick: function () {
            if (sortCol === m.tag) { sortDir = -sortDir; } else { sortCol = m.tag; sortDir = -1; }
            paint(pager.getPage());
          },
        }, [
          el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: '4px', padding: '0px 2px' } }, [
            el('img', { alt: '', src: 'https://www.google.com/s2/favicons?domain=' + m.fav + '&sz=32', style: { width: '16px', height: '16px', borderRadius: '3px' }, onerror: "this.style.visibility='hidden'" }),
            el('span', { style: { fontSize: '10px', fontWeight: '600', color: 'var(--aim-text-muted)' }, text: m.label }),
            active ? el('span', { style: { fontSize: '8px', color: 'var(--aim-text-faint)' }, text: sortDir === -1 ? '▼' : '▲' }) : null,
          ]),
        ]);
        headRow.appendChild(th);
      });
      table.appendChild(el('thead', {}, headRow));

      var tb = el('tbody');
      var ordered = orderedEntities();
      ordered.slice(page * PAGE, page * PAGE + PAGE).forEach(function (ent) {
        var hmFavNode = (ent.isUntracked && !ent.url)
          ? el('span', { style: { width: '14px', height: '14px', borderRadius: '3px', background: 'rgba(148,163,184,0.2)', color: 'rgb(100,116,139)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: '700', flexShrink: '0' }, text: (ent.name || '?').charAt(0).toUpperCase() })
          : el('img', { alt: '', src: fav32(ent.url), style: { width: '14px', height: '14px', borderRadius: '3px', flexShrink: '0' }, onerror: "this.style.visibility='hidden'" });
        var brandCell = el('td', {
          class: 'aim-hm-brand-cell',
          style: ent.isYou ? { background: 'linear-gradient(90deg, rgba(248, 200, 255, 0.09), transparent)' } : null,
        }, [
          el('div', { class: 'aim-hm-brand-inner' }, [
            hmFavNode,
            el('span', {
              class: 'aim-hm-brand-name', title: ent.name, text: ent.name,
              style: ent.isYou ? { fontWeight: '600', color: 'var(--aim-text)' } : null,
            }),
            ent.isYou ? el('span', { class: 'aim-you-badge', style: { flexShrink: '0', fontSize: '8px', padding: '1px 4px' }, text: 'You' }) : null,
            ent.isUntracked
              ? el('span', { style: { flexShrink: '0', fontSize: '7px', padding: '1px 4px', borderRadius: '4px',
                  background: 'rgba(148,163,184,0.18)', color: 'rgb(100,116,139)', fontWeight: '600', marginLeft: '2px' }, text: 'untracked' })
              : null,
          ]),
        ]);
        var tr = el('tr', { class: 'aim-hm-tr', style: { height: '43px' } }, [brandCell]);
        HEAT_COLS.forEach(function (m) {
          var v;
          if (ent.isUntracked && entityStats && entityStats[ent.name]) {
            var es = entityStats[ent.name];
            v = (es.byModel[m.tag] != null) ? es.byModel[m.tag] : 0;
          } else {
            v = cellAvg(agg.byEntityModel, ent.name, m.tag);
          }
          var rounded = v == null ? 0 : Math.round(v);
          tr.appendChild(el('td', { class: 'aim-hm-cell' }, [
            el('span', { style: { position: 'relative', display: 'inline-block' } }, [
              el('div', { class: 'aim-hm-pill', style: { background: heatBg(rounded), color: 'rgb(255, 255, 255)' }, text: rounded + '%' }),
            ]),
          ]));
        });
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      bodyWrap.appendChild(table);
    }
    paint(0);

    return aimCard(
      'Brand × Model Heatmap',
      'Visibility % per AI model',
      pager.node,
      bodyWrap,
      { flex: '1 1 0%', display: 'flex', flexDirection: 'column', minWidth: '0px' }
    );
  }

  // ---- 3. Prompt × Brand Ranking Matrix -----------------------------------------
  function buildPromptMatrixCard(brandEnt, competitors, lookerRows, untrackedEntities) {
    var COLS = 5;
    var matrix = promptMatrix(lookerRows, COLS);

    // entity name -> url (for favicons); unknown entities get a letter tile
    var urlByName = {};
    urlByName[brandEnt.name] = brandEnt.url;
    competitors.forEach(function (c) { if (c && c.name) urlByName[c.name] = c.url; });
    (untrackedEntities || []).forEach(function (u) {
      if (u && u.name) urlByName[u.name] = u.url || u.name;
    });

    var bodyWrap = el('div', { style: { padding: '0px' } });
    if (!matrix.length) {
      bodyWrap.appendChild(emptyState('No prompt data in this range yet.'));
    } else {
      var table = el('table', { class: 'aim-pm-table' });
      var headRow = el('tr', {}, [el('th', { text: 'Prompt' })]);
      for (var i = 1; i <= COLS; i++) headRow.appendChild(el('th', { text: '#' + i }));
      table.appendChild(el('thead', {}, headRow));

      var tb = el('tbody');
      matrix.forEach(function (row) {
        var tr = el('tr', {}, [el('td', { title: row.prompt, text: row.prompt })]);
        for (var c = 0; c < COLS; c++) {
          var ent = row.brands[c];
          var cell = el('td');
          if (ent) {
            var isMain = ent.name === brandEnt.name;
            var holder = el('span', { style: { position: 'relative', display: 'inline-block' } });
            var url = urlByName[ent.name];
            var node;
            if (url) {
              node = el('img', {
                class: 'aim-pm-fav' + (isMain ? ' is-main' : ''),
                alt: ent.name, loading: 'lazy', src: fav32(url),
                onerror: "this.style.visibility='hidden'",
              });
            } else {
              var initials = ent.name.split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
              node = el('span', { class: 'aim-pm-fav-letter' + (isMain ? ' is-main' : ''), text: initials });
            }
            attachTooltip(holder, node, ent.name);
            holder.appendChild(node);
            cell.appendChild(holder);
          }
          tr.appendChild(cell);
        }
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      bodyWrap.appendChild(el('div', { class: 'aim-pm-wrap' }, [table]));
    }

    return aimCard(
      'Prompt × Brand Ranking Matrix',
      'Top ' + COLS + ' brands per tracked prompt ranked by mention frequency (hover a favicon to see brand name)',
      null,
      bodyWrap,
      { overflow: 'hidden' }
    );
  }

  // hover tooltip exactly like the reference markup
  function attachTooltip(holder, node, label) {
    var tip = null;
    node.addEventListener('mouseenter', function () {
      if (tip) return;
      tip = el('span', {
        text: label,
        style: {
          position: 'absolute', bottom: 'calc(100% + 7px)', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--aim-surface, #fff)', color: 'var(--aim-text, #1c1917)',
          fontSize: '12px', fontWeight: '500', borderRadius: 'var(--aim-radius, 10px)',
          border: '1px solid var(--aim-border, #eeeeef)', boxShadow: 'rgba(0, 0, 0, 0.1) 0px 4px 12px',
          padding: '5px 9px', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: '9999',
        },
      });
      holder.appendChild(tip);
    });
    node.addEventListener('mouseleave', function () {
      if (tip) { tip.remove(); tip = null; }
    });
  }

  // ---- 4. Website Traffic ---------------------------------------------------------
  function buildTrafficCard(brandEnt, competitors) {
    var PAGE = 8;
    var rows = [];
    competitors.forEach(function (c) {
      if (c && c.monthlyVisits != null) {
        rows.push({
          name: c.name, url: c.url, visits: Number(c.monthlyVisits) || 0,
          change: c.monthlyVisitsChange || c.trafficChange || null, isYou: false,
        });
      }
    });
    // include the brand itself when the API exposes its traffic
    if (brandEnt.monthlyVisits != null) {
      rows.push({ name: brandEnt.name, url: brandEnt.url, visits: Number(brandEnt.monthlyVisits) || 0, change: null, isYou: true });
    }
    rows.sort(function (a, b) { return b.visits - a.visits; });
    var max = rows.reduce(function (m, r) { return Math.max(m, r.visits); }, 0) || 1;

    var body = el('div', { style: { padding: '4px' } });
    function paint(page) {
      body.innerHTML = '';
      var slice = rows.slice(page * PAGE, page * PAGE + PAGE);
      if (!slice.length) { body.appendChild(emptyState('No traffic data for this competitor set yet.')); return; }
      slice.forEach(function (r, i) {
        var change = r.change || 'N/A';
        var changeColor = String(change).indexOf('-') === 0 ? 'rgb(220, 38, 38)' : 'rgb(22, 163, 74)';
        body.appendChild(el('div', { class: 'aim-comp-bar-row' }, [
          el('span', { class: 'aim-comp-bar-rank', text: String(page * PAGE + i + 1) }),
          el('div', { class: 'aim-comp-bar-info' }, [
            favImg(r.url, 16, ''),
            el('span', { class: 'aim-comp-bar-name', title: r.name, text: r.name }),
            r.isYou ? el('span', { class: 'aim-you-badge', style: { flexShrink: '0', fontSize: '8px', padding: '1px 4px' }, text: 'You' }) : null,
          ]),
          el('div', { class: 'aim-comp-bar-track' }, [
            el('div', { class: 'aim-comp-bar-fill', style: { width: (r.visits / max * 100).toFixed(4) + '%', background: r.isYou ? ACCENT : SLATE } }),
          ]),
          el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: '84px', flexShrink: '0' } }, [
            el('span', { style: { fontSize: '12px', fontWeight: '700', color: 'var(--aim-text)', lineHeight: '1.1' }, text: r.visits.toLocaleString('en-US') }),
            el('span', { style: { fontSize: '10px', fontWeight: '600', color: changeColor, lineHeight: '1.1' }, text: change }),
          ]),
        ]));
      });
    }
    var pager = buildPager(rows.length, PAGE, paint);
    paint(0);

    return aimCard(
      'Website Traffic',
      'Monthly visits per brand from SimilarWeb (your brand vs tracked competitors)',
      pager.node,
      body
    );
  }
})();
