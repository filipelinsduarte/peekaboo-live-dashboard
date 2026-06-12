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
 *     ranked chips per run. Each run row is clickable and opens the full
 *     AI-answer modal.
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
 *   - Escape key + scroll lock added (the live SPA convention); v4 only had
 *     backdrop click and the close button.
 *   - Note: v4 applies NO brand highlighting inside the response text (bold
 *     names come from the model's own **markdown**). highlightMentions() is
 *     still implemented and exposed as pure logic for tests / future use.
 *
 * Pure logic (escapeHtml, normalizeSpaces, highlightMentions, formatAnswer,
 * responseTextFor) is exposed as window.PBPromptDetailLogic so it can be
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
    t = t.replace(/ /g, ' ');
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

  window.PBPromptDetailLogic = {
    escapeHtml: escapeHtml,
    normalizeSpaces: normalizeSpaces,
    highlightMentions: highlightMentions,
    formatAnswer: formatAnswer,
    responseTextFor: responseTextFor,
  };

  // ══════════════════════════════════════════════════════════════════════════
  // View
  // ══════════════════════════════════════════════════════════════════════════

  window.PBPromptDetail = async function (root, ctx) {
    var promptId = ctx.param;

    var detail = null;
    try {
      // full=true so every run arrives with fullResponse in one request
      detail = await PB.api.promptDetail(ctx.brandId, promptId, ctx.range, true);
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
    injectModalCSS();
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
    root.appendChild(buildHistoryCard(detail.history || [], detail));

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
  function buildHistoryCard(history, detail) {
    var body;
    if (!history.length) {
      body = el('div', { class: 'text-sm text-muted py-8 text-center' }, 'No run history for this prompt yet.');
    } else {
      var list = el('div', { class: 'space-y-2' });
      history.forEach(function (run) {
        list.appendChild(buildRunRow(run, detail));
      });
      body = list;
    }
    return PB.card(
      PB.cardTitle('Run history', fmt.int(history.length) + ' runs · newest first · click a run to read the full response'),
      body
    );
  }

  function buildRunRow(run, detail) {
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

    function activate() {
      openRunModal(run, detail);
    }

    return el('div', {
      class: 'rounded-lg border border-gray-200 p-3 pb-run-click',
      style: { background: mentioned ? 'var(--brand-soft, #fafafa)' : '#ffffff' },
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
    }, children);
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

  // v4 aimBrandIcon letter fallback (line 5898): deterministic palette hash.
  // brandMentions entries have no domain field, so we never guess one; the
  // letter avatar is the v4 fallback path for exactly this case.
  var LETTER_PALETTE = ['#b352b3', '#10b981', '#2563eb', '#8b5cf6', '#64748b', '#06b6d4', '#f59e0b', '#f472b6', '#38bdf8', '#94a3b8'];
  function brandLetterIcon(name, sz) {
    var n = String(name || '?');
    var letter = n.charAt(0).toUpperCase();
    var h = 0;
    for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) & 0xffff;
    var bg = LETTER_PALETTE[h % LETTER_PALETTE.length];
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
      brandLetterIcon(name, 18),
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
  // same way views/todos.js injectTodosCSS() does. .pb-run-click (the
  // clickable run rows in the history card) shares the token block because it
  // lives outside the modal scope.
  function injectModalCSS() {
    if (document.getElementById('pb-prompt-modal-css')) return;
    if (!document.head) return;
    var s = document.createElement('style');
    s.id = 'pb-prompt-modal-css';
    s.textContent = '\n' +
      '/* === tokens (v4 :root) === */\n' +
      '.pb-rm-scope, .pb-run-click {\n' +
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
      '/* clickable run rows in the history card */\n' +
      '.pb-run-click { cursor: pointer; transition: border-color .12s, box-shadow .12s; }\n' +
      '.pb-run-click:hover { border-color: var(--accent-30); box-shadow: var(--shadow); }\n' +
      '.pb-run-click:focus-visible { outline: 2px solid var(--accent-30); outline-offset: 1px; }\n' +
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
