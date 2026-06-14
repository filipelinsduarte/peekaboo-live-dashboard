/* binder: visibility
 *
 * Binds LIVE data into the Visibility card of the captured dashboard.
 * - Finds the Visibility card via PBdash.cardByTitle(root, 'Visibility').
 * - Keeps the header (title/subtitle/download icon).
 * - Rebuilds the legend (same markup/classes as the captured Recharts legend):
 *   one entry per plotted series, brand first as "<Brand> (You)".
 * - Replaces the chart area (the .h-56.sm:h-64 box holding the Recharts SVG)
 *   with a <canvas> and renders a Chart.js v4 multi-line chart from data.looker.
 *
 * Never throws: every DOM lookup is guarded; the whole body is wrapped in
 * try/catch with console.error so one failure can't blank the page.
 */
window.PBbind = window.PBbind || {};
window.PBbind.visibility = function (root, ctx, data) {
  'use strict';
  try {
    if (!root || !window.PBdash || typeof window.PBdash.cardByTitle !== 'function') return;

    var card = window.PBdash.cardByTitle(root, 'Visibility');
    if (!card) { console.error('[bind visibility] card not found'); return; }

    var BRAND_PURPLE = '#b352b3';
    // distinct competitor colors (the brand line keeps the brand purple)
    var COMP_COLORS = [
      'rgb(236, 72, 153)',   // pink
      'rgb(100, 116, 139)',  // slate
      'rgb(16, 185, 129)',   // emerald
      'rgb(6, 182, 212)',    // cyan
      'rgb(245, 158, 11)',   // amber
      'rgb(37, 99, 235)',    // blue
      'rgb(168, 85, 247)',   // violet
      'rgb(20, 184, 166)',   // teal
    ];

    // ---- locate the chart area (the box holding the Recharts SVG) ----
    var chartBox = null;
    var svg = card.querySelector('svg.recharts-surface') ||
              card.querySelector('.recharts-responsive-container') ||
              card.querySelector('svg');
    if (svg) {
      // walk up to the fixed-height wrapper (.h-56 / .sm:h-64)
      var node = svg;
      for (var up = 0; up < 6 && node && node !== card; up++) {
        if (node.className && /\bh-56\b|\bh-64\b/.test('' + node.className)) { chartBox = node; break; }
        node = node.parentElement;
      }
      if (!chartBox) {
        var rc = card.querySelector('.recharts-responsive-container');
        chartBox = (rc && rc.parentElement) || svg.parentElement;
      }
    }
    if (!chartBox) {
      chartBox = card.querySelector('.h-56') || card.querySelector('[class*="h-56"]');
    }
    if (!chartBox) { console.error('[bind visibility] chart area not found'); return; }

    // ---- build the series from data.looker ----
    var rows = (data && data.looker && data.looker.data) ? data.looker.data : [];

    // optional per-model filter
    if (ctx && ctx.model && ctx.model !== 'all') {
      rows = rows.filter(function (r) { return r && r.ai_model === ctx.model; });
    }

    var brandName = (data && data.snap && data.snap.brand && data.snap.brand.name) ||
                    (ctx && ctx.brandName) || '';

    // group: entity_name -> date -> { sum, n }
    var byEntity = {};
    var dateSet = {};
    var entityOrder = [];
    rows.forEach(function (r) {
      if (!r) return;
      var name = r.entity_name || r.brand;
      var date = r.date;
      if (!name || !date) return;
      if (!byEntity[name]) { byEntity[name] = {}; entityOrder.push(name); }
      if (!byEntity[name][date]) byEntity[name][date] = { sum: 0, n: 0 };
      byEntity[name][date].sum += (Number(r.visibility) || 0);
      byEntity[name][date].n += 1;
      dateSet[date] = true;
    });

    var dates = Object.keys(dateSet).sort();

    function avgFor(name) {
      var d = byEntity[name], sum = 0, n = 0;
      for (var k in d) { if (d.hasOwnProperty(k)) { sum += d[k].sum; n += d[k].n; } }
      return n ? sum / n : 0;
    }

    // identify the brand series among the grouped entities (case-insensitive)
    var brandKey = null;
    entityOrder.forEach(function (n) {
      if (brandName && ('' + n).toLowerCase() === ('' + brandName).toLowerCase()) brandKey = n;
    });

    // competitors that actually have time-series data, ranked by avg visibility.
    // The real card plots/legends the brand + its top competitors as a compact
    // set of ~5 brand icons, so cap competitors to 4 (brand + 4 = 5 icons).
    var competitors = entityOrder.filter(function (n) { return n !== brandKey; });
    competitors.sort(function (a, b) { return avgFor(b) - avgFor(a); });
    competitors = competitors.slice(0, 4);

    // ---- favicon-domain resolver (legend shows brand icons, like the real
    //      card) — API url first, then the shared cited/known chain; never the
    //      entity name as a domain. Returns '' when unresolved (img hidden). ----
    var PBh = window.PB || {};
    var snapV = (data && data.snap) || {};
    var urlByNameV = {};
    if (brandName && snapV.brand && snapV.brand.url) urlByNameV[brandName.toLowerCase()] = snapV.brand.url;
    var snapCompsV = (snapV && Array.isArray(snapV.competitors)) ? snapV.competitors : [];
    for (var sci = 0; sci < snapCompsV.length; sci++) {
      var scv = snapCompsV[sci] || {};
      if (scv.name && scv.url) urlByNameV[String(scv.name).toLowerCase()] = scv.url;
    }
    var citedDomainsV = [];
    var citedSeenV = {};
    var snapSourcesV = (snapV && Array.isArray(snapV.sources)) ? snapV.sources : [];
    for (var ssi = 0; ssi < snapSourcesV.length; ssi++) {
      var dv = snapSourcesV[ssi] && snapSourcesV[ssi].domain;
      if (!dv) continue;
      var dvl = String(dv).trim().toLowerCase();
      if (dvl && !citedSeenV[dvl]) { citedSeenV[dvl] = true; citedDomainsV.push(dvl); }
    }
    function favDomainFor(name) {
      var key = String(name || '').toLowerCase();
      var d = urlByNameV[key] || '';
      if (!d && PBh.entityDomain) d = PBh.entityDomain(name, citedDomainsV) || '';
      return d;
    }

    // ---- empty-state guard (no dates / no plottable series) ----
    if (!dates.length || (!brandKey && !competitors.length)) {
      renderLegend([
        brandName ? { name: brandName, color: BRAND_PURPLE, isBrand: true, favDomain: favDomainFor(brandName) } : null,
      ].filter(Boolean));
      chartBox.innerHTML = '';
      var msg = document.createElement('div');
      msg.className = 'flex items-center justify-center h-full text-[12px] text-muted-foreground';
      msg.textContent = 'No time-series data for this range.';
      chartBox.appendChild(msg);
      return;
    }

    // ordered legend/series list: brand (purple) then competitors
    var series = [];
    if (brandKey) {
      series.push({ name: brandKey, color: BRAND_PURPLE, isBrand: true, favDomain: favDomainFor(brandKey) });
    } else if (brandName) {
      // brand has no time-series rows but is still the subject: list it cleanly
      series.push({ name: brandName, color: BRAND_PURPLE, isBrand: true, favDomain: favDomainFor(brandName) });
    }
    competitors.forEach(function (n, i) {
      series.push({ name: n, color: COMP_COLORS[i % COMP_COLORS.length], isBrand: false, favDomain: favDomainFor(n) });
    });

    function seriesData(name) {
      return dates.map(function (d) {
        var cell = byEntity[name] && byEntity[name][d];
        return cell && cell.n ? +(cell.sum / cell.n).toFixed(1) : null;
      });
    }

    // ---- rebuild the legend (matching captured markup/classes) ----
    renderLegend(series);

    // only plot series that have at least one real datapoint
    var plotted = series.filter(function (s) { return byEntity[s.name]; });

    // ---- render the Chart.js line chart ----
    if (typeof Chart === 'undefined') { console.error('[bind visibility] Chart.js not loaded'); return; }

    var labels = dates.map(function (iso) {
      var d = new Date(iso + 'T00:00:00');
      if (isNaN(d.getTime())) return iso;
      // "Jun 4" style: month short + day (no leading zero)
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });

    var datasets = plotted.map(function (s) {
      return {
        label: s.name,
        data: seriesData(s.name),
        borderColor: s.color,
        backgroundColor: s.color,
        borderWidth: s.isBrand ? 2.5 : 1.5,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 3,
        spanGaps: true,
        order: s.isBrand ? 0 : 1,
      };
    });

    chartBox.innerHTML = '';
    var canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    chartBox.appendChild(canvas);

    var cgx = canvas.getContext('2d');
    if (!cgx) { console.error('[bind visibility] no 2d context'); return; }

    try { if (canvas._pbChart) canvas._pbChart.destroy(); } catch (e) {}

    canvas._pbChart = new Chart(cgx, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (c) {
                var v = c.parsed.y;
                return c.dataset.label + ': ' + (v == null ? '-' : v + '%');
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: 'rgb(107,114,128)', font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
            border: { display: false },
          },
          y: {
            beginAtZero: true,
            grid: { color: '#f3f4f6' },
            ticks: {
              color: 'rgb(107,114,128)',
              font: { size: 11 },
              callback: function (v) { return v + '%'; },
            },
            border: { display: false },
          },
        },
      },
    });

    // ---- legend renderer (shared) ----
    function renderLegend(list) {
      try {
        var legend = card.querySelector('.flex.flex-wrap.gap-x-3') ||
                     card.querySelector('[class*="flex-wrap"][class*="gap-x-3"]');
        if (!legend) return;
        legend.innerHTML = '';
        // sparse legends (just the brand) shouldn't clip a long brand name with an
        // ellipsis: only apply truncate/max-width when several entries share the row.
        var allowTruncate = list.length > 2;
        list.forEach(function (s) {
          var item = document.createElement('div');
          item.className = 'flex items-center gap-1.5';

          // brand-icon legend (matches the real card): 16px favicon, not a
          // colored line swatch. Hide the img when no domain resolves (never
          // a guessed name-as-domain favicon request).
          var icon = document.createElement('img');
          icon.setAttribute('width', '16');
          icon.setAttribute('height', '16');
          icon.setAttribute('alt', '');
          icon.setAttribute('aria-hidden', 'true');
          icon.setAttribute('loading', 'lazy');
          icon.className = 'rounded object-contain bg-white border border-gray-200/60 flex-shrink-0';
          icon.style.width = '16px';
          icon.style.height = '16px';
          var favSrc = (s.favDomain && window.PB && PB.favicon) ? PB.favicon(s.favDomain) : '';
          if (favSrc) {
            icon.setAttribute('src', favSrc);
          } else {
            icon.style.visibility = 'hidden';
          }

          var label = document.createElement('span');
          var base = s.isBrand ? 'text-[11px] font-medium' : 'text-[11px] text-muted-foreground';
          label.className = allowTruncate ? (base + ' truncate max-w-[100px]') : base;
          label.textContent = s.isBrand ? (s.name + ' (You)') : s.name;

          item.appendChild(icon);
          item.appendChild(label);
          legend.appendChild(item);
        });
      } catch (e) {
        console.error('[bind visibility] legend', e);
      }
    }
  } catch (err) {
    console.error('[bind visibility]', err);
  }
};
