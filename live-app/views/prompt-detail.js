/*
 * prompt-detail.js — Prompt DETAIL drill-down (live, matches /prompts/:id).
 *
 * Exposed as window.PBPromptDetail(root, ctx) and invoked from prompts.js when
 * the router sets ctx.param to a promptId (hash #/prompts/:id). Loaded before
 * boot so prompts.js can call it.
 *
 * Sections:
 *   - back link to #/prompts; header: prompt text + category/intent badges +
 *     summary metric cards (averageScore, totalRuns, trend).
 *   - "Competitors on this prompt" table (competitorSummary).
 *   - "Sources cited" table (sourceSummary).
 *   - "Run history" list (history[], newest first) with optional brandMentions
 *     ranked chips per run.
 */
(function () {
  'use strict';
  if (!window.PB) return;
  var el = PB.el, fmt = PB.fmt;

  window.PBPromptDetail = async function (root, ctx) {
    var promptId = ctx.param;

    var detail = null;
    try {
      detail = await PB.api.promptDetail(ctx.brandId, promptId, ctx.range, false);
    } catch (err) {
      PB.toast((err && err.message) || 'Could not load prompt', true);
      root.innerHTML = '';
      root.appendChild(backLink());
      root.appendChild(el('div', { class: 'pb-card pb-card-pad text-sm text-muted' },
        'Could not load this prompt. ' + ((err && err.message) || '')));
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    detail = detail || {};
    root.innerHTML = '';
    root.appendChild(backLink());

    // ---- header -------------------------------------------------------------
    root.appendChild(buildHeader(detail, ctx));

    // ---- two-column: competitors + sources ----------------------------------
    var row = el('div', { class: 'grid gap-4 lg:grid-cols-2' });
    row.appendChild(buildCompetitorsCard(detail.competitorSummary || []));
    row.appendChild(buildSourcesCard(detail.sourceSummary || []));
    root.appendChild(row);

    // ---- run history --------------------------------------------------------
    root.appendChild(buildHistoryCard(detail.history || []));

    if (window.lucide) window.lucide.createIcons();
  };

  // ---- back link ------------------------------------------------------------
  function backLink() {
    return el('a', {
      class: 'inline-flex items-center gap-1 text-sm text-muted hover:text-gray-900',
      href: '#/prompts',
      style: { marginBottom: '2px' },
    }, [
      el('i', { 'data-lucide': 'arrow-left', style: { width: '15px', height: '15px' } }),
      el('span', { text: 'Back to prompts' }),
    ]);
  }

  // ---- header card ----------------------------------------------------------
  function buildHeader(detail, ctx) {
    var summary = detail.summary || {};
    var badges = el('div', { class: 'flex items-center gap-2 flex-wrap mt-2' }, [
      detail.category ? el('span', { class: 'pb-badge', text: detail.category }) : null,
      detail.searchIntent ? el('span', { class: 'pb-badge pb-badge-brand', text: prettyIntent(detail.searchIntent) }) : null,
    ]);

    var metricDefs = [
      { label: 'Avg Score', value: fmt.score(summary.averageScore) },
      { label: 'Total Runs', value: fmt.int(summary.totalRuns) },
      { label: 'Trend', value: null, trend: summary.trend || 'stable' },
    ];
    var metricStrip = el('div', { class: 'grid grid-cols-3 gap-3 mt-3', style: { maxWidth: '480px' } });
    metricDefs.forEach(function (m) {
      var valueNode = m.trend
        ? trendBadge(m.trend)
        : el('div', { class: 'text-2xl font-semibold', text: m.value });
      metricStrip.appendChild(el('div', { class: 'pb-card', style: { padding: '0.7rem 0.9rem' } }, [
        el('div', { class: 'text-[11px] uppercase tracking-wide text-muted font-medium', text: m.label }),
        el('div', { class: 'mt-1', style: { minHeight: '32px', display: 'flex', alignItems: 'center' } }, [valueNode]),
      ]));
    });

    var body = el('div', {}, [
      el('div', { class: 'text-lg font-semibold leading-snug', text: detail.promptText || 'Untitled prompt' }),
      badges,
      metricStrip,
    ]);
    return PB.card(
      PB.cardTitle('Prompt', 'Performance over ' + ctx.range),
      body
    );
  }

  // ---- competitors card -----------------------------------------------------
  function buildCompetitorsCard(comps) {
    var body;
    if (!comps.length) {
      body = el('div', { class: 'text-sm text-muted py-8 text-center' }, 'No competitors mentioned on this prompt.');
    } else {
      var table = el('table', { class: 'pb-table' });
      table.appendChild(el('thead', {}, el('tr', {}, [
        el('th', { text: 'Entity' }),
        el('th', { text: 'Type' }),
        el('th', { text: 'Avg Score' }),
        el('th', { text: 'Mentions' }),
        el('th', { text: 'Avg Rank' }),
      ])));
      var tb = el('tbody');
      comps.forEach(function (c) {
        tb.appendChild(el('tr', {}, [
          el('td', {}, el('span', { class: 'font-medium', text: c.entityName || '—' })),
          el('td', {}, typeBadge(c.type)),
          el('td', {}, el('span', { class: 'font-medium', text: fmt.score(c.averageScore) })),
          el('td', { class: 'text-xs text-muted', text: fmt.int(c.mentionCount) }),
          el('td', { class: 'text-xs text-muted', text: (c.averageRank === null || c.averageRank === undefined) ? '—' : fmt.num1(c.averageRank) }),
        ]));
      });
      table.appendChild(tb);
      body = table;
    }
    return PB.card(
      PB.cardTitle('Competitors on this prompt', 'Entities the AI surfaced for this query'),
      body
    );
  }

  // ---- sources card ---------------------------------------------------------
  function buildSourcesCard(sources) {
    var body;
    if (!sources.length) {
      body = el('div', { class: 'text-sm text-muted py-8 text-center' }, 'No sources cited on this prompt.');
    } else {
      var table = el('table', { class: 'pb-table' });
      table.appendChild(el('thead', {}, el('tr', {}, [
        el('th', { text: 'Domain' }),
        el('th', { text: 'Mentions' }),
        el('th', { text: 'Models' }),
      ])));
      var tb = el('tbody');
      sources.forEach(function (s) {
        tb.appendChild(el('tr', {}, [
          el('td', {}, el('div', { class: 'flex items-center gap-2' }, [
            el('img', { class: 'pb-fav', src: PB.favicon(s.domain), onerror: "this.style.visibility='hidden'" }),
            el('span', { class: 'font-medium', text: s.domain || '—' }),
          ])),
          el('td', { class: 'font-medium', text: fmt.int(s.mentions) }),
          el('td', {}, el('div', { class: 'flex items-center gap-1' }, (s.aiModels || []).slice(0, 6).map(function (m) {
            return el('img', { class: 'pb-fav', style: { width: '14px', height: '14px', borderRadius: '50%' }, src: PB.modelLogo(m), title: PB.modelLabel(m) });
          }))),
        ]));
      });
      table.appendChild(tb);
      body = table;
    }
    return PB.card(
      PB.cardTitle('Sources cited', 'Domains referenced in the AI responses'),
      body
    );
  }

  // ---- run history card -----------------------------------------------------
  function buildHistoryCard(history) {
    var body;
    if (!history.length) {
      body = el('div', { class: 'text-sm text-muted py-8 text-center' }, 'No run history for this prompt yet.');
    } else {
      var list = el('div', { class: 'space-y-2' });
      history.forEach(function (run) {
        list.appendChild(buildRunRow(run));
      });
      body = list;
    }
    return PB.card(
      PB.cardTitle('Run history', fmt.int(history.length) + ' runs · newest first'),
      body
    );
  }

  function buildRunRow(run) {
    run = run || {};
    var mentioned = !!run.mentioned;

    var topLine = el('div', { class: 'flex items-center gap-2 flex-wrap' }, [
      el('img', { class: 'pb-fav', style: { width: '16px', height: '16px', borderRadius: '50%' }, src: PB.modelLogo(run.aiModel), title: PB.modelLabel(run.aiModel) }),
      el('span', { class: 'text-sm font-medium', text: PB.modelLabel(run.aiModel) }),
      el('span', { class: 'text-[11px] text-muted', text: fmt.date(run.date) }),
      el('span', { class: 'flex-1' }),
      el('span', { class: 'pb-badge', text: 'Score ' + fmt.score(run.score) }),
      (run.rank === null || run.rank === undefined) ? null : el('span', { class: 'pb-badge', text: 'Rank ' + run.rank }),
      mentioned
        ? el('span', { class: 'pb-badge pb-badge-green', text: 'Mentioned' })
        : el('span', { class: 'pb-badge', text: 'Not mentioned' }),
      run.sentiment ? sentimentBadge(run.sentiment) : null,
    ]);

    var children = [topLine];

    var snippet = run.responseSnippet || run.mentionSummary;
    if (snippet) {
      children.push(el('div', { class: 'text-[13px] text-gray-700 leading-snug mt-1.5', text: snippet }));
    }

    // optional ranked brand-mention chips
    var mentions = run.brandMentions || [];
    if (mentions.length) {
      var chips = el('div', { class: 'flex items-center gap-1.5 flex-wrap mt-2' });
      chips.appendChild(el('span', { class: 'text-[11px] text-muted', text: 'Also mentioned:' }));
      mentions.slice(0, 12).forEach(function (m) {
        var rankTxt = (m.rank === null || m.rank === undefined) ? '' : '#' + m.rank + ' ';
        chips.appendChild(el('span', {
          class: 'pb-badge',
          style: { display: 'inline-flex', alignItems: 'center', gap: '4px' },
          title: m.mentionSummary || '',
        }, [
          el('span', { class: 'text-muted', text: rankTxt }),
          el('span', { text: m.entityName || '—' }),
        ]));
      });
      children.push(chips);
    }

    return el('div', {
      class: 'rounded-lg border border-gray-200 p-3',
      style: { background: mentioned ? 'var(--brand-soft, #fafafa)' : '#ffffff' },
    }, children);
  }

  // ---- shared helpers -------------------------------------------------------
  function prettyIntent(i) {
    if (!i) return '';
    var s = String(i).toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function typeBadge(type) {
    var t = (type || 'untracked').toLowerCase();
    if (t === 'brand') return el('span', { class: 'pb-badge pb-badge-brand', text: 'Brand' });
    if (t === 'competitor') return el('span', { class: 'pb-badge pb-badge-red', text: 'Competitor' });
    return el('span', { class: 'pb-badge', text: 'Untracked' });
  }

  function sentimentBadge(sentiment) {
    var s = String(sentiment).toLowerCase();
    var cls = 'pb-badge';
    if (s === 'positive') cls += ' pb-badge-green';
    else if (s === 'negative') cls += ' pb-badge-red';
    return el('span', { class: cls, text: prettyIntent(s) });
  }

  function trendBadge(trend) {
    var t = trend || 'stable';
    if (t === 'up') {
      return el('span', { class: 'pb-badge pb-badge-green', style: { display: 'inline-flex', alignItems: 'center', gap: '3px' } }, [
        el('i', { 'data-lucide': 'trending-up', style: { width: '13px', height: '13px' } }),
        el('span', { text: 'up' }),
      ]);
    }
    if (t === 'down') {
      return el('span', { class: 'pb-badge pb-badge-red', style: { display: 'inline-flex', alignItems: 'center', gap: '3px' } }, [
        el('i', { 'data-lucide': 'trending-down', style: { width: '13px', height: '13px' } }),
        el('span', { text: 'down' }),
      ]);
    }
    return el('span', { class: 'pb-badge', style: { display: 'inline-flex', alignItems: 'center', gap: '3px' } }, [
      el('i', { 'data-lucide': 'minus', style: { width: '13px', height: '13px' } }),
      el('span', { text: 'stable' }),
    ]);
  }
})();
