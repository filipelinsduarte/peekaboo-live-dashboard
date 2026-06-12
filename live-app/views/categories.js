/*
 * categories.js — Categories view (live).
 * Category-level rollups for a brand, respecting the top-bar date range.
 * Sections:
 *   - metric strip (totalCategories, totalPrompts, totalRuns, overallAverageScore)
 *   - Avg score per category bar chart (Chart.js, top 8)
 *   - Categories table: name, avg score bar, prompts, runs, trend, intent badges
 *
 * Data: PB.api.categories(brandId, time_range) ->
 *   { categories:[{ category, averageScore, promptCount, totalRuns, trend,
 *                   searchIntentDistribution:{INTENT:count,...} }],
 *     summary:{ totalCategories, totalPrompts, totalRuns, overallAverageScore } }
 *
 * The framework re-calls this view on range change, so we just read ctx.range.
 */
(function () {
  'use strict';
  if (!window.PB) return;
  var el = PB.el, fmt = PB.fmt;

  var INTENT_STYLE = {
    COMMERCIAL: { bg: '#fef3c7', fg: '#92400e' },
    TRANSACTIONAL: { bg: '#dcfce7', fg: '#15803d' },
    INFORMATIONAL: { bg: '#dbeafe', fg: '#1e40af' },
    NAVIGATIONAL: { bg: '#ede9fe', fg: '#6d28d9' },
  };

  function trendColor(t) {
    if (t === 'up') return '#15803d';
    if (t === 'down') return '#b91c1c';
    return '#6b7280';
  }

  PB.registerView('categories', async function (root, ctx) {
    var data = await PB.api.categories(ctx.brandId, ctx.range).catch(function () { return null; });

    root.innerHTML = '';

    var cats = (data && Array.isArray(data.categories)) ? data.categories.slice() : [];
    var summary = (data && data.summary) || {};

    cats.sort(function (a, b) { return (b.averageScore || 0) - (a.averageScore || 0); });

    // ---- empty state --------------------------------------------------------
    if (!cats.length) {
      root.appendChild(el('div', { class: 'pb-card pb-card-pad', style: { padding: '2rem' } }, [
        el('div', { class: 'text-base font-semibold mb-1', text: 'No categories yet' }),
        el('div', { class: 'text-sm text-muted' }, 'This brand has no categorized prompts for the selected range.'),
      ]));
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    // ---- metric strip -------------------------------------------------------
    var metrics = [
      { label: 'Categories', value: fmt.int(summary.totalCategories != null ? summary.totalCategories : cats.length) },
      { label: 'Prompts', value: fmt.int(summary.totalPrompts) },
      { label: 'Runs', value: fmt.int(summary.totalRuns) },
      { label: 'Avg Score', value: fmt.score(summary.overallAverageScore) },
    ];
    var strip = el('div', { class: 'grid grid-cols-2 md:grid-cols-4 gap-3' });
    metrics.forEach(function (m) {
      strip.appendChild(el('div', { class: 'pb-card', style: { padding: '0.85rem 1rem' } }, [
        el('div', { class: 'text-[11px] uppercase tracking-wide text-muted font-medium', text: m.label }),
        el('div', { class: 'text-2xl font-semibold mt-1', text: m.value }),
      ]));
    });
    root.appendChild(strip);

    // ---- avg score bar chart (top 8) ---------------------------------------
    root.appendChild(buildScoreChartCard(cats, ctx));

    // ---- categories table ---------------------------------------------------
    root.appendChild(buildCategoriesCard(cats));

    if (window.lucide) window.lucide.createIcons();
  });

  // ---- bar chart of avg score per category (top 8) --------------------------
  function buildScoreChartCard(cats, ctx) {
    var top = cats.slice(0, 8);
    var labels = top.map(function (c) { return c.category || '—'; });
    var dataArr = top.map(function (c) { return Math.round(c.averageScore || 0); });

    var canvasId = 'pb-cats-bar';
    var body = el('div', { class: 'relative', style: { height: '240px' } }, [
      el('canvas', { id: canvasId }),
    ]);
    var card = PB.card(PB.cardTitle('Average Score by Category', 'Top categories · ' + ctx.range), body);
    setTimeout(function () {
      var canvas = document.getElementById(canvasId);
      if (!canvas || !window.Chart) return;
      new Chart(canvas, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{ data: dataArr, backgroundColor: '#b352b3', borderRadius: 6, maxBarThickness: 48 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: function (c) { return c.parsed.y + '%'; } } },
          },
          scales: {
            y: { beginAtZero: true, max: 100, ticks: { callback: function (v) { return v + '%'; }, font: { size: 10 } }, grid: { color: '#f3f4f6' } },
            x: { ticks: { font: { size: 10 }, maxRotation: 30, minRotation: 0, autoSkip: false }, grid: { display: false } },
          },
        },
      });
    }, 0);
    return card;
  }

  // ---- categories table -----------------------------------------------------
  function buildCategoriesCard(cats) {
    var max = cats.reduce(function (m, c) { return Math.max(m, c.averageScore || 0); }, 1);

    var table = el('table', { class: 'pb-table' });
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', { text: 'Category' }),
      el('th', { text: 'Avg Score' }),
      el('th', { text: 'Prompts' }),
      el('th', { text: 'Runs' }),
      el('th', { text: 'Trend' }),
      el('th', { text: 'Search Intent' }),
    ])));
    var tb = el('tbody');
    cats.forEach(function (c) {
      tb.appendChild(el('tr', {}, [
        el('td', {}, el('span', { class: 'font-medium', text: c.category || '—' })),
        el('td', {}, el('div', { class: 'flex items-center gap-2' }, [
          el('div', { class: 'pb-bar' }, el('span', { style: { width: Math.round((c.averageScore || 0) / max * 100) + '%' } })),
          el('span', { class: 'text-xs font-medium', text: fmt.score(c.averageScore) }),
        ])),
        el('td', { class: 'text-muted', text: fmt.int(c.promptCount) }),
        el('td', { class: 'text-muted', text: fmt.int(c.totalRuns) }),
        el('td', {}, c.trend ? el('span', {
          class: 'text-xs font-medium', style: { color: trendColor(c.trend) }, text: c.trend,
        }) : '—'),
        el('td', {}, buildIntentBadges(c.searchIntentDistribution)),
      ]));
    });
    table.appendChild(tb);
    return PB.card(
      PB.cardTitle('Categories', 'Performance by prompt category · sorted by avg score'),
      table
    );
  }

  function buildIntentBadges(dist) {
    if (!dist || typeof dist !== 'object') return el('span', { class: 'text-muted text-xs', text: '—' });
    var keys = Object.keys(dist).filter(function (k) { return (dist[k] || 0) > 0; });
    keys.sort(function (a, b) { return (dist[b] || 0) - (dist[a] || 0); });
    if (!keys.length) return el('span', { class: 'text-muted text-xs', text: '—' });
    var wrap = el('div', { class: 'flex flex-wrap items-center gap-1' });
    keys.forEach(function (k) {
      var style = INTENT_STYLE[k] || { bg: '#f3f4f6', fg: '#374151' };
      wrap.appendChild(el('span', {
        class: 'pb-badge',
        style: { background: style.bg, color: style.fg },
        text: k + ' ' + (dist[k] || 0),
      }));
    });
    return wrap;
  }
})();
