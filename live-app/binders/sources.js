/* binder: sources
 *
 * Binds LIVE data into the "Top Sources" area of the captured dashboard.
 * That area is a `grid ... lg:grid-cols-5` with two cards:
 *   (a) "Source Types" donut (Recharts SVG) with a center "Citations" label
 *       and a 5-item color legend: Corporate / Other / Articles / Social /
 *       Academic.
 *   (b) "Top Domains" card/table — columns DOMAIN / USED / CITES / TYPE,
 *       where TYPE is a small colored pill naming the derived source type.
 *
 * The Peekaboo API exposes data.snap.sources = [{ domain, mentions, aiModels }]
 * with NO source-type taxonomy. So we DERIVE a type per domain with a simple
 * classifier (precedence Social > Academic > Articles > Corporate, Other last
 * resort), then:
 *
 *  - DONUT: 5 segments = total mentions per derived TYPE, rendered with
 *    Chart.js (cutout ~68%) using the exact captured color map. Center label =
 *    live TOTAL citations (sum of mentions) + "Citations". Legend rebuilt to
 *    the 5 type categories using the captured legend item markup/classes.
 *
 *  - TOP DOMAINS table: rebuilt from the live sources — favicon + domain,
 *    USED (% of total citations), CITES (mentions), and the TYPE pill showing
 *    the derived type. No AI-model logos.
 *
 * Never throws: every DOM lookup/array access is guarded; the whole body is
 * wrapped in try/catch with console.error so one failure can't blank the page.
 */
window.PBbind = window.PBbind || {};
window.PBbind.sources = function (root, ctx, data) {
  'use strict';
  try {
    if (!root || !window.PBdash || typeof window.PBdash.cardByTitle !== 'function') return;

    var fav = (window.PB && PB.favicon) ? PB.favicon : function (d) {
      return 'https://www.google.com/s2/favicons?sz=64&domain=' + encodeURIComponent(d || '');
    };

    // ---- type taxonomy: exact captured colors + pill classes ----
    // donut segment fills sampled from the real recharts pie sectors.
    var TYPE_ORDER = ['Corporate', 'Other', 'Articles', 'Social', 'Academic'];
    var TYPE_COLOR = {
      Corporate: '#f472b6', // rgb(244,114,182) magenta/pink
      Other:     '#94a3b8', // rgb(148,163,184) gray
      Articles:  '#6366f1', // rgb(99,102,241) purple/indigo
      Social:    '#38bdf8', // rgb(56,189,248) blue
      Academic:  '#10b981', // rgb(16,185,129) green
    };
    // legend swatch colors (slightly different rgb in capture, kept faithful)
    var LEGEND_COLOR = {
      Corporate: 'rgb(244, 114, 182)',
      Other:     'rgb(148, 163, 184)',
      Articles:  'rgb(99, 102, 241)',
      Social:    'rgb(56, 189, 248)',
      Academic:  'rgb(16, 185, 129)',
    };
    // pill background (Tailwind class on the real page)
    var TYPE_PILL_BG = {
      Corporate: 'bg-pink-500',
      Other:     'bg-slate-400',
      Articles:  'bg-indigo-500',
      Social:    'bg-sky-400',
      Academic:  'bg-emerald-500',
    };

    // ---- classifier ----
    var SOCIAL_RE = /(^|\.)(reddit|youtube|youtu\.be|twitter|x\.com|linkedin|facebook|fb\.com|instagram|tiktok|quora|pinterest|threads\.net|medium)\./;
    var ARTICLE_HOSTS = [
      'forbes', 'techcrunch', 'businessinsider', 'theverge', 'nytimes', 'guardian',
      'bbc', 'cnbc', 'wired', 'mashable', 'hbr.org', 'inc.com', 'entrepreneur',
      'engadget', 'venturebeat', 'fastcompany', 'reuters', 'bloomberg', 'wsj',
    ];
    var ARTICLE_WORD_RE = /(news|blog|magazine|times|post|journal|review)/;

    function classify(domain) {
      var d = String(domain || '').toLowerCase();
      if (!d) return 'Other';
      // Social
      if (SOCIAL_RE.test('.' + d) ||
          /^(reddit|youtube|twitter|linkedin|facebook|instagram|tiktok|quora|pinterest|medium|threads)\./.test(d) ||
          d === 'x.com' || /\.x\.com$/.test(d) ||
          d.indexOf('reddit.') === 0 || d.indexOf('youtube.') === 0) {
        return 'Social';
      }
      // also catch bare social hosts
      var socialBare = ['reddit.com', 'youtube.com', 'youtu.be', 'twitter.com', 'x.com',
        'linkedin.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'quora.com',
        'pinterest.com', 'threads.net', 'medium.com'];
      for (var s = 0; s < socialBare.length; s++) {
        if (d === socialBare[s] || endsWith(d, '.' + socialBare[s])) return 'Social';
      }
      // Academic
      if (/\.edu$/.test(d) || /\.edu\./.test(d) ||
          /\.ac\./.test(d) || /\.ac\.uk$/.test(d) ||
          /\.gov$/.test(d) || /\.gov\./.test(d) ||
          d.indexOf('wikipedia.org') !== -1 ||
          d.indexOf('researchgate') !== -1 ||
          d.indexOf('ncbi.nlm') !== -1 ||
          d.indexOf('arxiv') !== -1 ||
          d.indexOf('scholar.') === 0 || d.indexOf('.scholar.') !== -1 ||
          d.indexOf('sciencedirect') !== -1 ||
          d.indexOf('springer') !== -1 ||
          d.indexOf('jstor') !== -1) {
        return 'Academic';
      }
      // Articles
      for (var a = 0; a < ARTICLE_HOSTS.length; a++) {
        if (d.indexOf(ARTICLE_HOSTS[a]) !== -1) return 'Articles';
      }
      if (ARTICLE_WORD_RE.test(d)) return 'Articles';
      // Other: very short / unknown shape (no dot, or single-label)
      if (d.indexOf('.') === -1) return 'Other';
      // Corporate: default for normal company-looking domains
      return 'Corporate';
    }

    function endsWith(str, suffix) {
      return str.length >= suffix.length && str.lastIndexOf(suffix) === (str.length - suffix.length);
    }

    // ---- live sources ----
    var sources = (data && data.snap && Array.isArray(data.snap.sources)) ? data.snap.sources.slice() : [];
    var total = 0;
    var i;
    for (i = 0; i < sources.length; i++) {
      total += (Number(sources[i] && sources[i].mentions) || 0);
    }

    // per-type mention totals (for donut)
    var typeTotals = { Corporate: 0, Other: 0, Articles: 0, Social: 0, Academic: 0 };
    for (i = 0; i < sources.length; i++) {
      var t = classify(sources[i] && sources[i].domain);
      typeTotals[t] = (typeTotals[t] || 0) + (Number(sources[i] && sources[i].mentions) || 0);
    }

    bindDonut();
    bindDomains();

    // ----------------------------------------------------------------------
    function bindDonut() {
      var card = window.PBdash.cardByTitle(root, 'Source Types');
      if (!card) { console.error('[bind sources] Source Types card not found'); return; }

      var donutBox = card.querySelector('.h-40.relative') || card.querySelector('[class*="h-40"]');
      var chartHost = card.querySelector('.recharts-responsive-container');
      if (!chartHost && donutBox) {
        chartHost = donutBox.querySelector('div:not(.absolute)');
      }

      // center label: big number + caption
      var centerNum = null, centerCap = null;
      if (donutBox) {
        var overlay = donutBox.querySelector('.absolute.inset-0') || donutBox.querySelector('[class*="inset-0"]');
        if (overlay) {
          var ps = overlay.querySelectorAll('p');
          if (ps.length >= 1) centerNum = ps[0];
          if (ps.length >= 2) centerCap = ps[1];
        }
      }
      if (centerNum) centerNum.textContent = total > 0 ? total.toLocaleString('en-US') : '0';
      if (centerCap) centerCap.textContent = 'Citations';

      // build slices in fixed type order; show all 5 (real card shows all 5)
      var slices = [];
      for (var ti = 0; ti < TYPE_ORDER.length; ti++) {
        var name = TYPE_ORDER[ti];
        slices.push({ label: name, value: typeTotals[name] || 0, color: TYPE_COLOR[name] });
      }
      var hasAny = total > 0;

      // rebuild legend with captured markup/classes
      var legend = card.querySelector('.grid.grid-cols-2');
      if (legend) {
        legend.innerHTML = '';
        TYPE_ORDER.forEach(function (name) {
          var item = document.createElement('div');
          item.className = 'flex items-center gap-1.5';
          var dot = document.createElement('div');
          dot.className = 'w-2 h-2 rounded-full flex-shrink-0';
          dot.style.backgroundColor = LEGEND_COLOR[name];
          var lbl = document.createElement('span');
          lbl.className = 'text-[11px]';
          lbl.textContent = name;
          item.appendChild(dot);
          item.appendChild(lbl);
          legend.appendChild(item);
        });
      }

      // render doughnut into chart host
      if (chartHost) {
        chartHost.innerHTML = '';
        if (!hasAny) {
          var emptyD = document.createElement('div');
          emptyD.className = 'flex items-center justify-center h-full text-[11px] text-muted-foreground';
          emptyD.textContent = 'No sources yet.';
          chartHost.appendChild(emptyD);
          return;
        }
        var canvas = document.createElement('canvas');
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        chartHost.appendChild(canvas);

        setTimeout(function () {
          try {
            if (!window.Chart) { console.error('[bind sources] Chart.js not loaded'); return; }
            var cgx = canvas.getContext('2d');
            if (!cgx) { console.error('[bind sources] no 2d context (donut)'); return; }
            try { if (canvas._pbChart) canvas._pbChart.destroy(); } catch (e) {}
            // only feed segments with value > 0 to avoid zero-width artifacts
            var drawn = slices.filter(function (x) { return x.value > 0; });
            canvas._pbChart = new Chart(cgx, {
              type: 'doughnut',
              data: {
                labels: drawn.map(function (x) { return x.label; }),
                datasets: [{
                  data: drawn.map(function (x) { return x.value; }),
                  backgroundColor: drawn.map(function (x) { return x.color; }),
                  borderColor: '#fff',
                  borderWidth: 2,
                }],
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '68%',
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: function (c) {
                        var v = Number(c.parsed) || 0;
                        var pct = total > 0 ? ((v / total) * 100).toFixed(1) + '%' : '0%';
                        return (c.label || '') + ': ' + v + ' (' + pct + ')';
                      },
                    },
                  },
                },
              },
            });
          } catch (err) {
            console.error('[bind sources donut]', err);
          }
        }, 0);
      }
    }

    // ----------------------------------------------------------------------
    function bindDomains() {
      var card = window.PBdash.cardByTitle(root, 'Top Domains');
      if (!card) { console.error('[bind sources] Top Domains card not found'); return; }

      var listBox = card.querySelector('.space-y-0');
      if (!listBox) { console.error('[bind sources] domains list box not found'); return; }

      var allRows = listBox.querySelectorAll('[class*="grid-cols-"]');
      var headerRow = null, templateRow = null;
      for (var r = 0; r < allRows.length; r++) {
        var cn = '' + allRows[r].className;
        if (/uppercase/.test(cn)) { if (!headerRow) headerRow = allRows[r]; }
        else if (!templateRow) { templateRow = allRows[r]; }
      }
      if (!templateRow) { console.error('[bind sources] template row not found'); return; }

      var templateHTML = templateRow.outerHTML;

      for (var k = 0; k < allRows.length; k++) {
        if (allRows[k] !== headerRow) {
          if (allRows[k].parentNode) allRows[k].parentNode.removeChild(allRows[k]);
        }
      }

      if (!sources.length) {
        var empty = document.createElement('div');
        empty.className = 'py-3 text-[11px] text-muted-foreground';
        empty.textContent = 'No sources yet.';
        listBox.appendChild(empty);
        var counter0 = findCounter(card);
        if (counter0) counter0.textContent = '0 of 0';
        return;
      }

      // The real card shows the TOP 20 domains by citations, paginated 10 per
      // page (1-10, then 11-20). Sort by citations desc and cap to 20.
      var TOP_N = 20;
      var PAGE_SIZE = 10;
      var ranked = sources.slice().sort(function (a, b) {
        return (Number(b && b.mentions) || 0) - (Number(a && a.mentions) || 0);
      });
      if (ranked.length > TOP_N) ranked = ranked.slice(0, TOP_N);

      var rowNodes = [];
      ranked.forEach(function (src) {
        var domain = cleanDomain(src && src.domain);
        var cites = Number(src && src.mentions) || 0;
        var usedPct = total > 0 ? ((cites / total) * 100).toFixed(1) + '%' : '0%';
        var type = classify(src && src.domain);

        var rowEl = htmlToNode(templateHTML);
        if (!rowEl) return;

        var cells = rowEl.children;
        // cell 0: favicon + domain name
        var domainCell = cells[0];
        if (domainCell) {
          var img = domainCell.querySelector('img');
          if (img) {
            img.setAttribute('src', fav(domain));
            img.setAttribute('alt', domain);
          }
          var nameSpan = domainCell.querySelector('span.truncate');
          if (nameSpan) { nameSpan.textContent = domain; nameSpan.title = domain; }
        }
        // cell 1: USED (% of citations)
        if (cells[1]) cells[1].textContent = usedPct;
        // cell 2: CITES (mentions count)
        if (cells[2]) cells[2].textContent = String(cites);
        // cell 3: TYPE pill
        var typeCell = cells[3];
        if (typeCell) {
          typeCell.innerHTML = '';
          typeCell.className = 'text-right';
          var pill = document.createElement('span');
          pill.className = 'inline-flex items-center text-[9px] px-1.5 py-0.5 rounded-full font-medium text-white ' +
                           (TYPE_PILL_BG[type] || 'bg-slate-400');
          pill.textContent = type;
          typeCell.appendChild(pill);
        }

        rowNodes.push(rowEl);
      });

      // paginate: 10 per page, chevron prev/next ("Previous/Next domains"),
      // "1-10 of N" counter — mirrors the competitors card.
      var counter = findCounter(card);
      var prevBtn = card.querySelector('button[aria-label="Previous domains"]');
      var nextBtn = card.querySelector('button[aria-label="Next domains"]');
      if (window.PBdash && window.PBdash.paginate) {
        window.PBdash.paginate({
          container: listBox,
          rows: rowNodes,
          pageSize: PAGE_SIZE,
          counterEl: counter,
          prevBtn: prevBtn,
          nextBtn: nextBtn,
        });
      } else {
        for (var f = 0; f < rowNodes.length && f < PAGE_SIZE; f++) {
          listBox.appendChild(rowNodes[f]);
        }
        if (counter) counter.textContent = '1-' + Math.min(PAGE_SIZE, rowNodes.length) + ' of ' + rowNodes.length;
      }
    }

    // ---- small helpers ----
    function cleanDomain(d) {
      if (!d) return '';
      return String(d).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    }
    function htmlToNode(html) {
      try {
        var tmp = document.createElement('div');
        tmp.innerHTML = (html || '').trim();
        return tmp.firstElementChild;
      } catch (e) { return null; }
    }
    function findCounter(card) {
      var spans = card.querySelectorAll('span');
      for (var i = 0; i < spans.length; i++) {
        if (/\bof\b/.test((spans[i].textContent || '')) && /\d/.test(spans[i].textContent)) return spans[i];
      }
      return null;
    }
  } catch (err) {
    console.error('[bind sources]', err);
  }
};
