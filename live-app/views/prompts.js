/*
 * prompts.js — Prompts view (live), pixel-faithful port of the captured
 * reference at :7897/prompts.html (the real product's "aim" prompt manager).
 *
 * Routing: handles both #/prompts (list) and #/prompts/:id (delegates to
 * window.PBPromptDetail from prompt-detail.js).
 *
 * Reference structure (app/prompts.html, verified against the product's own
 * compiled component in _next/static/chunks/94679-*.js):
 *   - dismissable "Tip" banner (Connect Claude)
 *   - "Add prompts" dropdown (AI Suggested / Add Manual Prompts) opening the
 *     "Add Prompts" Radix-style dialog (AI Suggested + Manual tabs), plus
 *     Add Topic (name + 14-color picker) and Add Intent dialogs. All rebuilt
 *     verbatim from the captured states (app/prompts-state-addprompts-*.html,
 *     -addtopic-modal.html, -addintent-modal.html); submits show the
 *     read-only toast since the local mirror never writes to the API.
 *   - .aim-scope > .aim-card
 *       header row: Active/Inactive tab pill, search input, topic <select>,
 *                   intent <select>, "N / 100 prompts" chip with progress bar,
 *                   purple "Add prompts" menu button, Add Topic, Add Intent
 *       .aim-table-wrap > table.aim-full-table with columns:
 *         [checkbox] Prompt | Visibility | Sentiment | Position | Mentions |
 *         Citations | Topic | Intent | Actions
 *   - "Recommended Prompts" CTA card (lightbulb + purple button)
 *
 * Styling comes from the product's own compiled stylesheet
 * /_next/static/css/fb9cebaaf381bc0d.css (all .aim-* rules); this view
 * injects that <link> once. Everything else (tip banner, reco card) uses the
 * Tailwind classes already linked in index.html.
 *
 * Live data:
 *   - list cells (prompt text, visibility %, topic, intent) come straight from
 *     GET /brands/:id/prompts.
 *   - Sentiment / Position / Mentions / Citations need per-prompt run data, so
 *     they are lazily enriched from GET /brands/:id/prompts/:pid (3 at a time,
 *     skeleton favicon stacks while loading, en-dash on failure) using the
 *     exact same aggregation math as the product (majority sentiment, average
 *     rank, top-3 mentioned brands / cited domains).
 */
(function () {
  'use strict';

  // ---- pure helpers (exposed for tests as window.PBPromptsLogic) -----------

  // Product thresholds: >=60 green "high", >=35 amber "mid", else gray "low".
  function visClass(v) {
    var n = Number(v) || 0;
    if (n >= 60) return 'high';
    if (n >= 35) return 'mid';
    return 'low';
  }

  // NOTE: the product's Z() ("guess name + .com") used to live here. It is
  // gone on purpose: it produced provably wrong favicons (kn.com,
  // amazonuk.com). Mention icons now resolve through PB.entityDomain
  // (tracked urls -> cited domains -> curated known map) and fall back to a
  // letter avatar. Domains are NEVER constructed from names.

  function faviconUrl(domain) {
    return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=32';
  }

  // Majority sentiment from {positive,neutral,negative} counts (product's U()).
  function sentimentFromCounts(counts) {
    var c = counts || {};
    var entries = [
      ['positive', Number(c.positive) || 0],
      ['neutral', Number(c.neutral) || 0],
      ['negative', Number(c.negative) || 0],
    ];
    var total = entries[0][1] + entries[1][1] + entries[2][1];
    if (total <= 0) return null;
    entries.sort(function (a, b) { return b[1] - a[1]; });
    return entries[0][0];
  }

  // Aggregate a prompt-detail payload into the row fields the table needs.
  // detail = { history: [{ rank, sentiment, brandMentions: [{entityName}],
  //                        sources: [{ domain }] }],
  //            sourceSummary: [{ domain, mentions }] }
  // citedDomains = every unique domain the AI actually cited for this prompt
  // (history[].sources + sourceSummary); the mentions cell matches entity
  // names against it instead of guessing domains.
  function summarizeDetail(detail) {
    var out = {
      sentiment: null,
      position: null,
      topBrands: [],
      totalBrands: 0,
      topDomains: [],
      totalDomains: 0,
      citedDomains: [],
    };
    if (!detail) return out;

    var history = Array.isArray(detail.history) ? detail.history : [];
    var ranks = [];
    var sentCounts = { positive: 0, neutral: 0, negative: 0 };
    var brandCounts = {};
    var citedSeen = {};
    function addCited(domain) {
      if (!domain) return;
      var d = String(domain).trim().toLowerCase();
      if (!d || citedSeen[d]) return;
      citedSeen[d] = true;
      out.citedDomains.push(d);
    }

    history.forEach(function (run) {
      if (!run) return;
      if (run.rank !== null && run.rank !== undefined && isFinite(run.rank)) {
        ranks.push(Number(run.rank));
      }
      if (run.sentiment === 'positive') sentCounts.positive += 1;
      else if (run.sentiment === 'negative') sentCounts.negative += 1;
      else if (run.sentiment === 'neutral') sentCounts.neutral += 1;

      var mentions = Array.isArray(run.brandMentions) ? run.brandMentions : [];
      mentions.forEach(function (m) {
        var name = m && m.entityName;
        if (!name) return;
        brandCounts[name] = (brandCounts[name] || 0) + 1;
      });

      (Array.isArray(run.sources) ? run.sources : []).forEach(function (s) {
        if (s) addCited(s.domain);
      });
    });

    if (ranks.length) {
      var sum = 0;
      ranks.forEach(function (r) { sum += r; });
      out.position = sum / ranks.length;
    }
    out.sentiment = sentimentFromCounts(sentCounts);

    var brandNames = Object.keys(brandCounts);
    brandNames.sort(function (a, b) { return brandCounts[b] - brandCounts[a]; });
    out.topBrands = brandNames.slice(0, 3);
    out.totalBrands = brandNames.length;

    var sources = Array.isArray(detail.sourceSummary) ? detail.sourceSummary.slice() : [];
    sources = sources.filter(function (s) { return s && s.domain; });
    sources.sort(function (a, b) { return (Number(b.mentions) || 0) - (Number(a.mentions) || 0); });
    out.topDomains = sources.slice(0, 3).map(function (s) { return s.domain; });
    out.totalDomains = sources.length;
    sources.forEach(function (s) { addCited(s.domain); });
    return out;
  }

  // Sort comparator factory. dir: 1 = the default direction for that column
  // (numbers descending, text ascending), -1 = flipped. Matches the product.
  var SENT_ORDER = { positive: 3, neutral: 2, negative: 1 };
  function compareRows(a, b, key, dir) {
    function numDesc(x, y) {
      var nx = (x === null || x === undefined) ? -Infinity : Number(x);
      var ny = (y === null || y === undefined) ? -Infinity : Number(y);
      return (ny - nx) * dir;
    }
    switch (key) {
      case 'text': return String(a.text).localeCompare(String(b.text)) * dir;
      case 'visibility': return numDesc(a.visibility, b.visibility);
      case 'sentiment': return numDesc(SENT_ORDER[a.enrich.sentiment] || 0, SENT_ORDER[b.enrich.sentiment] || 0);
      case 'position': {
        // lower position is better: ascending on default dir
        var px = (a.enrich.position === null || a.enrich.position === undefined) ? Infinity : a.enrich.position;
        var py = (b.enrich.position === null || b.enrich.position === undefined) ? Infinity : b.enrich.position;
        return (px - py) * dir;
      }
      case 'mentions': return numDesc(a.enrich.totalBrands, b.enrich.totalBrands);
      case 'citations': return numDesc(a.enrich.totalDomains, b.enrich.totalDomains);
      case 'topic': return String(a.topic || '').localeCompare(String(b.topic || '')) * dir;
      case 'intent': return String(a.intent || '').localeCompare(String(b.intent || '')) * dir;
      default: return 0;
    }
  }

  // Remaining prompt slots for the AI Suggested dialog ("Available slots: N").
  function availableSlots(used, limit) {
    var u = Number(used) || 0;
    var l = Number(limit) || 0;
    return Math.max(0, l - u);
  }

  // Clamp the "Number of prompts" input to [1, max] (product slider is 1-50).
  function clampPromptCount(value, max) {
    var m = Number(max);
    if (!isFinite(m) || m < 1) m = 1;
    var n = Math.round(Number(value));
    if (!isFinite(n)) n = 1;
    return Math.min(Math.max(n, 1), m);
  }

  // Toggle an intent in the AI Suggested selection map; returns new count.
  function toggleIntent(selected, name) {
    if (selected[name]) delete selected[name];
    else selected[name] = true;
    return Object.keys(selected).length;
  }

  if (typeof window !== 'undefined') {
    window.PBPromptsLogic = {
      visClass: visClass,
      sentimentFromCounts: sentimentFromCounts,
      summarizeDetail: summarizeDetail,
      compareRows: compareRows,
      availableSlots: availableSlots,
      clampPromptCount: clampPromptCount,
      toggleIntent: toggleIntent,
    };
  }

  if (typeof window === 'undefined' || !window.PB) return;
  var el = PB.el;

  // ---- constants matching the product ---------------------------------------

  var AIM_CSS_ID = 'pb-aim-css';
  var AIM_CSS_HREF = '/_next/static/css/fb9cebaaf381bc0d.css';
  var PROMPT_LIMIT = 100; // plan limit shown in the "N / 100 prompts" chip
  var ENRICH_CONCURRENCY = 3;

  // Product topic-dot palette ($ map), default #6b7280.
  var TOPIC_COLORS = {
    'AI Tools': '#2563eb',
    'Productivity': '#7c3aed',
    'Marketing': 'var(--theme-primary)',
    'Sales': '#059669',
    'Analytics': '#d97706',
    'SEO': '#0891b2',
    'Content': '#dc2626',
    'Social Media': '#ea580c',
    'Branding': '#be185d',
    'Competitors': '#4b5563',
  };

  // Inline style for the topic/intent <select> (product's Q object).
  var SELECT_STYLE = 'height:28px;border-radius:var(--aim-radius);border:1px solid var(--aim-border);background:var(--aim-surface);color:var(--aim-text);font-size:12px;padding:0 6px;cursor:pointer;max-width:160px;';

  var FAINT_DASH_STYLE = 'color:var(--aim-text-faint);font-size:11px;';

  var SVG_EDIT = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
  var SVG_TRASH = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Inject the product's compiled .aim-* stylesheet once.
  function ensureAimCss() {
    if (document.getElementById(AIM_CSS_ID)) return;
    var link = document.createElement('link');
    link.id = AIM_CSS_ID;
    link.rel = 'stylesheet';
    link.href = AIM_CSS_HREF;
    document.head.appendChild(link);
  }

  function readOnlyToast() {
    PB.toast('This action is not available in the local mirror');
  }

  // ---- modal layer: Add Prompts / Add Topic / Add Intent dialogs ------------
  //
  // Markup, classes and inline styles are copied verbatim from the captured
  // reference states (app/prompts-state-addprompts-ai.html,
  // -addprompts-modal.html, -addtopic-modal.html, -addintent-modal.html).
  // The Radix/Tailwind animation classes (animate-in, zoom-in-95, fade-in-0,
  // data-[state=...] variants) all exist in the product's compiled stylesheet
  // already linked from index.html, so open/close animations match the real
  // dialogs. All submits show the read-only toast.

  var MODAL_CSS_ID = 'pb-prompts-modal-css';
  var MODAL_CSS = '' +
    // Smooth open/close for the "Add prompts" dropdown. The compiled aim css
    // toggles display:none/block; this override keeps the menu in the layout
    // and animates opacity/translate (pointer-events guards interaction).
    '.aim-scope .aim-add-menu{display:block;opacity:0;transform:translateY(-4px) scale(.98);pointer-events:none;transition:opacity .15s ease,transform .15s ease;}' +
    '.aim-scope .aim-add-menu.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;}' +
    // Footer buttons of the Add Intent dialog: the product uses these class
    // names but they are not part of the compiled .aim-* stylesheet.
    '.aim-scope .aim-ctp-dlg-cancel{padding:6px 14px;font-size:12px;font-weight:600;background:var(--aim-surface-alt);color:var(--aim-text-muted);border:1px solid var(--aim-border);border-radius:var(--aim-radius);cursor:pointer;font-family:var(--aim-font);}' +
    '.aim-scope .aim-ctp-dlg-confirm{padding:6px 14px;font-size:12px;font-weight:600;background:var(--aim-accent);color:#fff;border:1px solid transparent;border-radius:var(--aim-radius);cursor:pointer;font-family:var(--aim-font);transition:background .12s;}' +
    '.aim-scope .aim-ctp-dlg-confirm:disabled{background:var(--aim-surface-alt);color:var(--aim-text-faint);border:1px solid var(--aim-border);cursor:not-allowed;}';

  function ensureModalCss() {
    if (document.getElementById(MODAL_CSS_ID)) return;
    var style = document.createElement('style');
    style.id = MODAL_CSS_ID;
    style.textContent = MODAL_CSS;
    document.head.appendChild(style);
  }

  // Exact class strings from the captured Radix dialog / overlay.
  var DLG_OVERLAY_CLASS = 'fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0';
  var DLG_CLASS = 'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg aim-scope';
  var DLG_X_CLASS = 'absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none';
  var SVG_X = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x h-4 w-4"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';
  var SPARKLE_PATH = 'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z';
  var CHECK_SVG = '<svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.5 6L6.5 2" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

  // AI Suggested dialog data (verbatim from the capture).
  var AI_INTENTS = [
    ['Informational', 'Learning & understanding'],
    ['Navigational', 'Finding specific pages'],
    ['Commercial', 'Researching & comparing'],
    ['Investigational', 'Deep comparisons'],
    ['Transactional', 'Ready to buy/sign up'],
    ['Sentiment', 'Reviews & opinions'],
    ['Branded', 'Brand reputation'],
  ];
  var AI_LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Dutch', 'Polish', 'Russian', 'Japanese', 'Chinese', 'Korean'];
  var MANUAL_INTENTS = ['Informational', 'Commercial', 'Transactional', 'Navigational'];
  var DEFAULT_MANUAL_TOPICS = [
    { name: 'Brand Awareness', color: '#ef4444' },
    { name: 'Buying Intent', color: '#10b981' },
    { name: 'Comparison Shopping', color: '#8b5cf6' },
    { name: 'General', color: '#6b7280' },
    { name: 'Product Research', color: '#3b82f6' },
    { name: 'Technical Support', color: '#f59e0b' },
  ];
  // 14-color picker of the Add Topic dialog (order matches the capture).
  var TOPIC_PICKER_COLORS = ['var(--theme-primary)', '#2563eb', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#0891b2', '#d97706', '#65a30d', '#e11d48', '#0284c7', '#7c3aed', '#374151', '#9333ea'];

  // Open a Radix-style dialog: overlay + centered panel + close X, Escape and
  // overlay-click to close, body scroll locked, animated entry/exit via the
  // product's own data-[state] Tailwind classes.
  function openDialog(opts) {
    var overlay = el('div', { class: DLG_OVERLAY_CLASS, 'data-state': 'open', style: 'pointer-events:auto;' });
    var dialog = el('div', {
      role: 'dialog', 'aria-modal': 'true', tabindex: '-1',
      class: DLG_CLASS, 'data-state': 'open',
      style: opts.style,
    });
    var prevOverflow = document.body.style.overflow;
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      overlay.setAttribute('data-state', 'closed');
      dialog.setAttribute('data-state', 'closed');
      setTimeout(function () { overlay.remove(); dialog.remove(); }, 180);
    }
    function onKey(ev) {
      if (ev.key === 'Escape') close();
    }
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';

    try {
      if (typeof opts.build === 'function') opts.build(dialog, close);
    } catch (err) {
      // Never leave a broken half-open modal around.
      close();
      PB.toast('Could not open this dialog', true);
      return close;
    }

    var x = el('button', { type: 'button', class: DLG_X_CLASS, html: SVG_X + '<span class="sr-only">Close</span>' });
    x.addEventListener('click', close);
    dialog.appendChild(x);

    document.body.appendChild(overlay);
    document.body.appendChild(dialog);
    dialog.focus();
    return close;
  }

  // Small uppercase field label used inside the Add Topic dialog.
  function dlgFieldLabel(tag, attrs, text) {
    attrs = attrs || {};
    attrs.style = 'font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--aim-text-faint);font-family:var(--aim-font);';
    attrs.text = text;
    return el(tag, attrs);
  }

  // ---- Add Topic dialog ------------------------------------------------------
  function openAddTopicDialog() {
    openDialog({
      style: 'max-width:420px;width:95vw;padding:0;pointer-events:auto;',
      build: function (dialog, close) {
        dialog.appendChild(el('div', {
          class: 'flex flex-col space-y-1.5 text-center sm:text-left',
          style: 'padding:16px 20px 12px;border-bottom:1px solid var(--aim-border-light);',
        }, el('h2', {
          class: 'text-lg font-semibold leading-none tracking-tight',
          style: 'font-size:14px;font-weight:700;color:var(--aim-text);font-family:var(--aim-font);',
          text: 'Add Topic',
        })));

        var nameInput = el('input', {
          id: 'add-topic-name', class: 'aim-search-input',
          placeholder: 'e.g. Reputation Management',
          style: 'width:100%;padding-left:10px;padding-right:10px;font-size:13px;',
        });

        var selectedColor = TOPIC_PICKER_COLORS[0];
        var swatches = [];
        var radioGroup = el('div', { role: 'radiogroup', 'aria-label': 'Topic color', style: 'display:flex;flex-wrap:wrap;gap:6px;' });
        TOPIC_PICKER_COLORS.forEach(function (color) {
          var b = el('button', { type: 'button', role: 'radio', 'aria-label': 'Color ' + color });
          function paint() {
            var on = selectedColor === color;
            b.setAttribute('aria-checked', on ? 'true' : 'false');
            b.setAttribute('style',
              'width:22px;height:22px;border-radius:50%;background:' + color + ';' +
              'border:2px solid ' + (on ? 'var(--aim-text)' : 'transparent') + ';cursor:pointer;' +
              'outline:' + (on ? '2px solid var(--aim-text)' : 'none') + ';outline-offset:1px;padding:0;' +
              'transition:outline 0.1s, border-color 0.1s;box-sizing:border-box;');
          }
          b.addEventListener('click', function () {
            selectedColor = color;
            swatches.forEach(function (s) { s.paint(); });
          });
          swatches.push({ paint: paint });
          paint();
          radioGroup.appendChild(b);
        });

        dialog.appendChild(el('div', { style: 'padding:20px;display:flex;flex-direction:column;gap:16px;' }, [
          el('div', { style: 'display:flex;flex-direction:column;gap:6px;' }, [
            dlgFieldLabel('label', { for: 'add-topic-name' }, 'Topic name'),
            nameInput,
          ]),
          el('div', { style: 'display:flex;flex-direction:column;gap:8px;' }, [
            dlgFieldLabel('span', {}, 'Color'),
            radioGroup,
          ]),
        ]));

        var cancelBtn = el('button', {
          type: 'button',
          style: 'padding:6px 14px;font-size:12px;font-weight:600;background:var(--aim-surface-alt);color:var(--aim-text-muted);border:1px solid var(--aim-border);border-radius:var(--aim-radius);cursor:pointer;font-family:var(--aim-font);',
          text: 'Cancel',
        });
        cancelBtn.addEventListener('click', close);
        var addBtn = el('button', { type: 'button', text: 'Add Topic' });
        function paintAdd() {
          var has = nameInput.value.trim().length > 0;
          addBtn.disabled = !has;
          addBtn.setAttribute('style',
            'padding:6px 14px;font-size:12px;font-weight:600;border-radius:var(--aim-radius);font-family:var(--aim-font);transition:background 0.12s;' +
            (has
              ? 'background:var(--aim-accent);color:#fff;border:1px solid transparent;cursor:pointer;'
              : 'background:var(--aim-surface-alt);color:var(--aim-text-faint);border:1px solid var(--aim-border);cursor:not-allowed;'));
        }
        nameInput.addEventListener('input', paintAdd);
        addBtn.addEventListener('click', function () {
          if (!addBtn.disabled) readOnlyToast();
        });
        paintAdd();

        dialog.appendChild(el('div', {
          class: 'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
          style: 'padding:12px 20px;border-top:1px solid var(--aim-border-light);display:flex;justify-content:flex-end;gap:8px;',
        }, [cancelBtn, addBtn]));

        setTimeout(function () { nameInput.focus(); }, 0);
      },
    });
  }

  // ---- Add Intent dialog -----------------------------------------------------
  function openAddIntentDialog() {
    openDialog({
      style: 'max-width:420px;padding:0;overflow:hidden;pointer-events:auto;',
      build: function (dialog, close) {
        dialog.appendChild(el('div', {
          class: 'flex flex-col space-y-1.5 text-center sm:text-left',
          style: 'padding:16px 20px 0;',
        }, el('h2', {
          id: 'add-intent-title',
          class: 'text-lg font-semibold leading-none tracking-tight',
          style: 'font-size:14px;font-weight:700;color:var(--aim-text);font-family:var(--aim-font);',
          text: 'Add Intent',
        })));

        var input = el('input', {
          id: 'aim-new-intent-input', type: 'text',
          placeholder: 'e.g. Local Search',
          'aria-invalid': 'false', 'aria-describedby': 'aim-intent-helper',
          style: 'width:100%;padding:8px 10px;font-size:13px;border:1px solid var(--aim-border);border-radius:var(--aim-radius);background:var(--aim-surface);color:var(--aim-text);font-family:var(--aim-font);outline:none;box-sizing:border-box;transition:border-color 0.12s;',
        });
        input.addEventListener('focus', function () { input.style.borderColor = 'var(--aim-accent)'; });
        input.addEventListener('blur', function () { input.style.borderColor = 'var(--aim-border)'; });

        dialog.appendChild(el('div', { style: 'padding:14px 20px 0;' }, [
          el('label', {
            for: 'aim-new-intent-input',
            style: 'display:block;font-size:12px;font-weight:600;color:var(--aim-text-muted);margin-bottom:6px;font-family:var(--aim-font);',
            text: 'Intent name',
          }),
          input,
          el('p', {
            id: 'aim-intent-helper',
            style: 'margin-top:8px;font-size:11.5px;color:var(--aim-text-faint);line-height:1.6;font-family:var(--aim-font);',
            text: 'This intent will appear as an option when assigning search intent to prompts.',
          }),
        ]));

        var cancelBtn = el('button', { type: 'button', class: 'aim-ctp-dlg-cancel', text: 'Cancel' });
        cancelBtn.addEventListener('click', close);
        var confirmBtn = el('button', { type: 'button', class: 'aim-ctp-dlg-confirm', text: 'Add Intent' });
        confirmBtn.disabled = true;
        input.addEventListener('input', function () {
          confirmBtn.disabled = input.value.trim().length === 0;
        });
        confirmBtn.addEventListener('click', function () {
          if (!confirmBtn.disabled) readOnlyToast();
        });

        dialog.appendChild(el('div', {
          class: 'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
          style: 'padding:12px 20px 16px;display:flex;justify-content:flex-end;gap:8px;',
        }, [cancelBtn, confirmBtn]));

        setTimeout(function () { input.focus(); }, 0);
      },
    });
  }

  // ---- static markup blocks (copied verbatim from the reference capture) ----

  var TIP_BANNER_HTML = '' +
    '<div class="relative mb-4 flex items-center gap-3 rounded-xl border border-brand/25 bg-brand/[0.04] px-4 py-2.5 text-xs">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sparkles h-3.5 w-3.5 shrink-0 text-brand"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"></path><path d="M20 3v4"></path><path d="M22 5h-4"></path><path d="M4 17v2"></path><path d="M5 18H3"></path></svg>' +
      '<p class="flex-1 text-muted-foreground"><span class="font-semibold text-foreground">Tip:</span> Add tracking prompts from Claude in one sentence — no forms, no copy-paste. <a class="font-semibold text-brand hover:underline" href="#" data-pb-tip-link>Connect Claude →</a></p>' +
      '<button type="button" aria-label="Dismiss tip" class="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x h-3.5 w-3.5"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button>' +
    '</div>';

  var RECO_HTML = '' +
    '<div class="rounded-lg border bg-card text-card-foreground shadow-sm p-8 text-center">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-lightbulb mx-auto h-12 w-12 text-yellow-500 mb-4"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path></svg>' +
      '<h3 class="text-lg font-semibold mb-2">Recommended Prompts</h3>' +
      '<p class="text-muted-foreground mb-6 max-w-md mx-auto">Find prompts worth tracking — where competitors rank and you don&#39;t, or intents you have no coverage of yet.</p>' +
      '<button data-pb-reco-btn class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-brand text-[var(--theme-on-primary)] hover:bg-brand/90 h-11 rounded-md px-8 gap-2">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-lightbulb h-4 w-4"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path></svg>' +
        'Get recommendations' +
      '</button>' +
    '</div>';

  var SEARCH_ICON_SVG = '<svg class="aim-search-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" stroke-width="1.2"></circle><path d="M9.5 9.5l2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"></path></svg>';

  var ADD_BTN_STYLE = 'display:flex;align-items:center;gap:4px;padding:5px 12px;background:var(--aim-accent);color:#fff;border:none;border-radius:var(--aim-radius);font-size:11px;font-weight:600;cursor:pointer;font-family:var(--aim-font);';
  var ADD_BTN_HTML = '<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1v9M1 5.5h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>Add prompts<svg width="9" height="9" viewBox="0 0 10 10" fill="none" style="margin-left:1px;"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  var ADD_MENU_HTML = '' +
    '<button class="aim-add-menu-item" data-pb-add-ai><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"></path></svg>AI Suggested</button>' +
    '<button class="aim-add-menu-item" data-pb-add-manual><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>Add Manual Prompts</button>';

  var ADD_TOPIC_HTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>Add Topic';
  var ADD_INTENT_HTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>Add Intent';

  // ---- cell renderers --------------------------------------------------------

  function faintDash() {
    return el('span', { style: FAINT_DASH_STYLE, text: '–' });
  }

  // Skeleton favicon stack shown while a row is being enriched (product's et()).
  function skeletonStack(label) {
    return el('span', { class: 'aim-icon-stack', 'aria-label': label }, [
      el('span', { class: 'aim-icon-skel' }),
      el('span', { class: 'aim-icon-skel' }),
      el('span', { class: 'aim-icon-skel' }),
    ]);
  }

  // Favicon stack (product's ee()): items -> {src,title}, "+N" overflow chip.
  function iconStack(items, total, resolve) {
    if (!items || !items.length) return faintDash();
    var extra = Math.max(0, (total || items.length) - items.length);
    var kids = items.map(function (item) {
      var r = resolve(item);
      return el('img', {
        src: r.src, title: r.title, alt: r.title,
        width: '18', height: '18', loading: 'lazy',
        style: 'border-radius:50%;display:block;',
        onerror: "this.style.visibility='hidden'",
      });
    });
    if (extra > 0) {
      kids.push(el('span', {
        style: 'font-size:10px;font-weight:600;color:var(--aim-text-muted);margin-left:5px;',
        text: '+' + extra,
      }));
    }
    return el('span', { class: 'aim-icon-stack' }, kids);
  }

  // ---- mention icons ---------------------------------------------------------
  // Tracked entity map for the mentions cells: lowercased name -> API url
  // (the brand's own record from PB.state.brands + tracked competitors from
  // GET /competitors). Refreshed per view render; PB.entityDomain checks it
  // first, then the prompt's cited domains, then the curated known map.
  var trackedDomains = {};
  var trackedCache = { brandId: null, list: null };

  // Deterministic letter-avatar color (same palette hash as prompt-detail's
  // letterAvatarColor) for entities that do not resolve to a real domain.
  var LETTER_PALETTE = ['#b352b3', '#10b981', '#2563eb', '#8b5cf6', '#64748b', '#06b6d4', '#f59e0b', '#f472b6', '#38bdf8', '#94a3b8'];
  function letterAvatarColor(name) {
    var n = String(name === null || name === undefined ? '?' : name);
    var h = 0;
    for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) & 0xffff;
    return LETTER_PALETTE[h % LETTER_PALETTE.length];
  }
  function letterIcon(name) {
    var n = String(name || '?');
    return el('span', {
      title: n,
      style: 'display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:' + letterAvatarColor(n) + ';color:#fff;font-size:9px;font-weight:700;flex-shrink:0;',
      text: n.charAt(0).toUpperCase(),
    });
  }

  // One mention icon: real favicon when the chain resolves the entity name,
  // deterministic letter avatar otherwise (the img swaps itself for the
  // letter avatar when the favicon fails to load). Never a guessed domain.
  function mentionIconNode(name, citedDomains) {
    var label = String(name || '?');
    var domain = null;
    if (PB && typeof PB.entityDomain === 'function') {
      domain = PB.entityDomain(label, citedDomains || [], trackedDomains);
    }
    if (!domain) return letterIcon(label);
    var img = el('img', {
      src: faviconUrl(domain), title: label, alt: label,
      width: '18', height: '18', loading: 'lazy',
      style: 'border-radius:50%;display:block;',
      onerror: function () {
        var letter = letterIcon(label);
        if (img && img.parentNode) img.parentNode.replaceChild(letter, img);
      },
    });
    return img;
  }

  function sentimentNode(row) {
    var e = row.enrich;
    if (e.state === 'pending' || e.state === 'loading') return faintDash();
    if (!e.sentiment) return faintDash();
    var label = e.sentiment === 'positive' ? 'Positive' : e.sentiment === 'neutral' ? 'Neutral' : 'Negative';
    return el('span', { class: 'aim-sent-badge ' + e.sentiment, text: label });
  }

  function positionNode(row) {
    var e = row.enrich;
    if (e.position === null || e.position === undefined) return faintDash();
    return el('span', { class: 'aim-pos-val', text: '#' + Number(e.position).toFixed(1) });
  }

  function mentionsNode(row) {
    var e = row.enrich;
    if (e.state === 'pending' || e.state === 'loading') return skeletonStack('Loading mentions');
    if (!e.topBrands || !e.topBrands.length) return faintDash();
    var kids = e.topBrands.map(function (name) {
      return mentionIconNode(name, e.citedDomains);
    });
    var extra = Math.max(0, (e.totalBrands || e.topBrands.length) - e.topBrands.length);
    if (extra > 0) {
      kids.push(el('span', {
        style: 'font-size:10px;font-weight:600;color:var(--aim-text-muted);margin-left:5px;',
        text: '+' + extra,
      }));
    }
    return el('span', { class: 'aim-icon-stack' }, kids);
  }

  function citationsNode(row) {
    var e = row.enrich;
    if (e.state === 'pending' || e.state === 'loading') return skeletonStack('Loading citations');
    return iconStack(e.topDomains, e.totalDomains, function (domain) {
      return { src: faviconUrl(domain), title: domain };
    });
  }

  function topicNode(topic) {
    if (!topic) return faintDash();
    var color = TOPIC_COLORS[topic] || '#6b7280';
    return el('span', { class: 'aim-topic-badge' }, [
      el('span', { style: 'color:' + color + ';font-size:7px;line-height:1;', text: '●' }),
      topic,
    ]);
  }

  function intentNode(intent) {
    if (!intent) return faintDash();
    var lower = String(intent).toLowerCase();
    return el('span', { class: 'aim-intent-badge ' + lower, text: lower });
  }

  function actionButton(title, ariaLabel, svgHtml, hoverColorVar) {
    var btn = el('button', {
      title: title,
      'aria-label': ariaLabel,
      style: 'padding:3px 5px;background:transparent;border:1px solid var(--aim-border);border-radius:5px;cursor:pointer;color:var(--aim-text-muted);display:inline-flex;align-items:center;transition:color 0.12s, border-color 0.12s;',
      html: svgHtml,
    });
    btn.addEventListener('mouseenter', function () {
      btn.style.color = hoverColorVar;
      btn.style.borderColor = hoverColorVar;
    });
    btn.addEventListener('mouseleave', function () {
      btn.style.color = 'var(--aim-text-muted)';
      btn.style.borderColor = 'var(--aim-border)';
    });
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      readOnlyToast();
    });
    return btn;
  }

  // ---- view ------------------------------------------------------------------

  PB.registerView('prompts', async function (root, ctx) {
    // Detail route: #/prompts/:id
    if (ctx.param) {
      if (typeof window.PBPromptDetail === 'function') {
        return window.PBPromptDetail(root, ctx);
      }
      root.innerHTML = '';
      root.appendChild(el('div', { class: 'rounded-lg border bg-card shadow-sm p-4 text-sm text-muted-foreground' }, 'Prompt detail view is unavailable.'));
      return;
    }

    ensureAimCss();
    ensureModalCss();

    // ---- tracked entity map (brand url + competitor urls) for mention icons ----
    // Kicked off in parallel with the prompt pages; awaited before the enrich
    // workers start (mentions cells only render after enrichment).
    trackedDomains = {};
    try {
      var stateBrands = (PB.state && PB.state.brands) || [];
      for (var sb = 0; sb < stateBrands.length; sb++) {
        var bRec = stateBrands[sb];
        if (bRec && bRec.id === ctx.brandId && bRec.name && bRec.url) {
          trackedDomains[String(bRec.name).trim().toLowerCase()] = bRec.url;
          break;
        }
      }
    } catch (e) { /* degrade: brand falls through to the cited/known steps */ }
    var trackedPromise;
    if (trackedCache.brandId === ctx.brandId && trackedCache.list) {
      trackedPromise = Promise.resolve(trackedCache.list);
    } else {
      trackedPromise = PB.api.competitors(ctx.brandId)
        .then(function (comp) {
          var list = (comp && Array.isArray(comp.competitors)) ? comp.competitors : [];
          trackedCache = { brandId: ctx.brandId, list: list };
          return list;
        })
        .catch(function () { return null; });
    }

    // ---- fetch all prompt pages ----
    var rows = [];
    var offset = 0;
    var PAGE = 100;
    for (var page = 0; page < 5; page++) {
      var envelope;
      try {
        envelope = await PB.api.prompts(ctx.brandId, { time_range: ctx.range, offset: offset, limit: PAGE });
      } catch (err) {
        if (page === 0) PB.toast((err && err.message) || 'Could not load prompts', true);
        envelope = null;
      }
      if (!envelope || !Array.isArray(envelope.data)) break;
      envelope.data.forEach(function (p) {
        rows.push({
          id: p.promptId,
          text: p.promptText || '',
          visibility: Number(p.averageScore) || 0,
          topic: p.category || null,
          intent: p.searchIntent || null,
          totalRuns: p.totalRuns,
          enrich: {
            state: 'pending',
            sentiment: null, position: null,
            topBrands: [], totalBrands: 0,
            topDomains: [], totalDomains: 0,
            citedDomains: [],
          },
        });
      });
      if (!envelope.pagination || !envelope.pagination.hasMore) break;
      offset += PAGE;
    }

    // ---- view state ----
    var vs = {
      tab: 'Active',
      sortKey: 'visibility',
      sortDir: 1,
      searchText: '',
      topicFilter: 'all',
      intentFilter: 'all',
      selected: {},          // id -> true
      selectedCount: 0,
    };
    var cellRefs = {};       // promptId -> {sent, pos, men, cit} current <td>s

    var topics = [];
    var seenTopic = {};
    var intents = [];
    var seenIntent = {};
    rows.forEach(function (r) {
      if (r.topic && !seenTopic[r.topic]) { seenTopic[r.topic] = true; topics.push(r.topic); }
      if (r.intent && !seenIntent[r.intent]) { seenIntent[r.intent] = true; intents.push(String(r.intent)); }
    });
    topics.sort();
    intents.sort();

    // ---- "Add Prompts" dialog (AI Suggested / Manual tabs) ----
    // Faithful rebuild of the captured Radix dialog: 800px panel, pill tab
    // switcher in the header, AI panel (intent cards, language, count slider,
    // advanced context, footer) and Manual panel (Single/Bulk textarea,
    // intent badges, topic chips, Add Prompt button).

    function buildAiPanel(close) {
      var panel = el('div', { style: 'display:flex;flex-direction:column;gap:16px;' });

      // sub-tabs: By Intent | From URL
      var subIntentTab = el('button', { type: 'button', class: 'aim-tab active', text: 'By Intent' });
      var subUrlTab = el('button', { type: 'button', class: 'aim-tab', text: 'From URL' });
      subUrlTab.addEventListener('click', readOnlyToast); // URL generation needs the live backend
      panel.appendChild(el('div', { class: 'aim-tab-bar', style: 'width:fit-content;' }, [subIntentTab, subUrlTab]));

      // intent cards (default selection matches the product: 2 selected)
      var selected = { Informational: true, Commercial: true };
      var countBadge = el('span', {
        style: 'font-size:11px;font-weight:600;padding:1px 7px;border-radius:9999px;background:var(--aim-surface-alt);border:1px solid var(--aim-border);color:var(--aim-text-muted);',
      });
      var grid = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;' });
      function paintCards() {
        countBadge.textContent = Object.keys(selected).length + ' selected';
        grid.innerHTML = '';
        AI_INTENTS.forEach(function (pair) {
          var name = pair[0];
          var subtitle = pair[1];
          var on = !!selected[name];
          var card = el('button', {
            type: 'button',
            'aria-pressed': on ? 'true' : 'false',
            style: 'text-align:left;padding:10px 12px;border-radius:8px;border:1px solid ' + (on ? 'var(--aim-accent)' : 'var(--aim-border)') + ';background:' + (on ? 'color-mix(in srgb, var(--theme-primary) 6%, transparent)' : 'var(--aim-surface)') + ';cursor:pointer;font-family:var(--aim-font);transition:0.12s;display:flex;flex-direction:column;gap:2px;',
          }, [
            el('div', { style: 'display:flex;align-items:center;gap:6px;' }, [
              el('span', {
                style: 'width:13px;height:13px;border-radius:3px;border:1.5px solid ' + (on ? 'var(--aim-accent)' : '#d1d5db') + ';background:' + (on ? 'var(--aim-accent)' : 'transparent') + ';display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;',
                html: on ? CHECK_SVG : '',
              }),
              el('span', { style: 'font-size:13px;font-weight:600;color:' + (on ? 'var(--aim-accent)' : 'var(--aim-text)') + ';', text: name }),
            ]),
            el('span', { style: 'font-size:11px;color:var(--aim-text-faint);padding-left:19px;', text: subtitle }),
          ]);
          card.addEventListener('click', function () {
            toggleIntent(selected, name);
            paintCards();
          });
          grid.appendChild(card);
        });
      }
      paintCards();
      panel.appendChild(el('div', {}, [
        el('div', { style: 'display:flex;align-items:baseline;gap:8px;margin-bottom:8px;' }, [
          el('span', { style: 'font-size:12px;font-weight:600;color:var(--aim-text-muted);', text: 'Select search intents' }),
          countBadge,
        ]),
        el('p', { style: 'font-size:11px;color:var(--aim-text-faint);margin-bottom:8px;', text: 'Choose the types of search queries you want to generate. Each intent represents how users search in AI tools.' }),
        grid,
      ]));

      // language + number of prompts
      var slots = availableSlots(rows.length, PROMPT_LIMIT);
      var langSelect = el('select', {
        id: 'aim-language',
        style: 'width:100%;height:34px;padding:0 10px;font-size:13px;border:1px solid var(--aim-border);border-radius:8px;background:var(--aim-surface);color:var(--aim-text);font-family:var(--aim-font);cursor:pointer;',
      }, AI_LANGUAGES.map(function (lang) { return el('option', { value: lang, text: lang }); }));
      var defaultCount = clampPromptCount(10, Math.max(1, Math.min(50, slots || 50)));
      var numInput = el('input', {
        id: 'aim-count-num', type: 'number', min: '1', max: '50', step: '1', value: String(defaultCount),
        style: 'width:56px;height:34px;padding:0 10px;font-size:13px;border:1px solid var(--aim-border);border-radius:8px;background:var(--aim-surface);color:var(--aim-text);font-family:var(--aim-font);text-align:center;',
      });
      var rangeInput = el('input', {
        id: 'aim-count', type: 'range', min: '1', max: '50', step: '1', value: String(defaultCount),
        style: 'flex:1 1 0%;accent-color:var(--aim-accent);',
      });
      numInput.addEventListener('change', function () {
        var v = clampPromptCount(numInput.value, 50);
        numInput.value = String(v);
        rangeInput.value = String(v);
      });
      rangeInput.addEventListener('input', function () { numInput.value = rangeInput.value; });
      panel.appendChild(el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:16px;' }, [
        el('div', {}, [
          el('label', { for: 'aim-language', style: 'font-size:12px;font-weight:600;color:var(--aim-text-muted);display:block;margin-bottom:6px;', text: 'Language' }),
          langSelect,
        ]),
        el('div', {}, [
          el('label', { for: 'aim-count', style: 'font-size:12px;font-weight:600;color:var(--aim-text-muted);display:block;margin-bottom:6px;', text: 'Number of prompts' }),
          el('div', { style: 'display:flex;align-items:center;gap:8px;' }, [numInput, rangeInput]),
          el('div', { style: 'font-size:11px;color:var(--aim-text-faint);margin-top:4px;', text: 'Available slots: ' + slots }),
        ]),
      ]));

      // Advanced Business Context (collapsible)
      var advOpen = false;
      var advChevron = el('span', {
        style: 'display:inline-flex;transition:transform 0.15s;',
        html: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
      });
      var advBody = el('div', { style: 'display:none;padding:0 14px 12px;' },
        el('textarea', {
          rows: '3', placeholder: 'Add extra business context to steer the suggestions…',
          'aria-label': 'Advanced business context',
          style: 'width:100%;resize:vertical;padding:10px 12px;font-size:13px;border:1px solid var(--aim-border);border-radius:var(--aim-radius);background:var(--aim-surface);color:var(--aim-text);font-family:var(--aim-font);outline:none;line-height:1.5;box-sizing:border-box;',
        }));
      var advToggle = el('button', {
        type: 'button', 'aria-expanded': 'false',
        style: 'width:100%;display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:none;background:transparent;cursor:pointer;font-family:var(--aim-font);',
      }, [
        el('span', { style: 'font-size:12px;font-weight:600;color:var(--aim-text);', text: 'Advanced Business Context' }),
        advChevron,
      ]);
      advToggle.addEventListener('click', function () {
        advOpen = !advOpen;
        advToggle.setAttribute('aria-expanded', advOpen ? 'true' : 'false');
        advChevron.style.transform = advOpen ? 'rotate(180deg)' : '';
        advBody.style.display = advOpen ? 'block' : 'none';
      });
      panel.appendChild(el('div', { style: 'border:1px solid var(--aim-border);border-radius:8px;overflow:hidden;background:var(--aim-surface-alt);' }, [advToggle, advBody]));

      // avoid-similar checkbox
      var avoidCb = el('input', { type: 'checkbox', style: 'width:13px;height:13px;accent-color:var(--aim-accent);cursor:pointer;' });
      avoidCb.checked = true;
      panel.appendChild(el('label', {
        style: 'display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--aim-text-muted);cursor:pointer;user-select:none;',
      }, [avoidCb, 'Avoid generating prompts similar to existing ones']));

      // footer
      var cancelBtn = el('button', {
        type: 'button',
        style: 'display:inline-flex;align-items:center;padding:8px 18px;font-size:13px;font-weight:600;border-radius:9999px;border:1px solid var(--aim-border);background:var(--aim-surface);color:var(--aim-text-muted);cursor:pointer;font-family:var(--aim-font);',
        text: 'Cancel',
      });
      cancelBtn.addEventListener('click', close);
      var generateBtn = el('button', {
        type: 'button',
        style: 'display:inline-flex;align-items:center;gap:6px;padding:8px 18px;font-size:13px;font-weight:600;border-radius:9999px;border:none;background:var(--aim-accent);color:#fff;cursor:pointer;opacity:1;font-family:var(--aim-font);transition:opacity 0.12s;',
        html: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="' + SPARKLE_PATH + '"></path></svg>Generate suggestions',
      });
      generateBtn.addEventListener('click', readOnlyToast);
      panel.appendChild(el('div', {
        style: 'display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--aim-border-light);margin-top:4px;padding-top:12px;',
      }, [cancelBtn, generateBtn]));

      return panel;
    }

    function buildManualPanel() {
      var panel = el('div', { class: 'aim-scope', style: 'display:flex;flex-direction:column;gap:16px;' });
      var mode = 'single';

      var textarea = el('textarea', {
        class: 'aim-textarea', rows: '4',
        placeholder: 'Type a single prompt…', 'aria-label': 'Single prompt',
        style: 'width:100%;resize:vertical;padding:10px 12px;font-size:13px;border:1px solid var(--aim-border);border-radius:var(--aim-radius);background:var(--aim-surface);color:var(--aim-text);font-family:var(--aim-font);outline:none;line-height:1.5;box-sizing:border-box;',
      });

      // Single | Bulk sub-tabs
      var singleTab = el('button', { type: 'button', class: 'aim-tab active', 'aria-pressed': 'true', text: 'Single' });
      var bulkTab = el('button', { type: 'button', class: 'aim-tab', 'aria-pressed': 'false', text: 'Bulk' });
      function setMode(next) {
        mode = next;
        var single = mode === 'single';
        singleTab.className = 'aim-tab' + (single ? ' active' : '');
        singleTab.setAttribute('aria-pressed', single ? 'true' : 'false');
        bulkTab.className = 'aim-tab' + (single ? '' : ' active');
        bulkTab.setAttribute('aria-pressed', single ? 'false' : 'true');
        textarea.rows = single ? 4 : 8;
        textarea.placeholder = single ? 'Type a single prompt…' : 'Paste multiple prompts, one per line…';
        textarea.setAttribute('aria-label', single ? 'Single prompt' : 'Bulk prompts');
        paintSubmit();
      }
      singleTab.addEventListener('click', function () { setMode('single'); });
      bulkTab.addEventListener('click', function () { setMode('bulk'); });
      panel.appendChild(el('div', { class: 'aim-tab-bar', style: 'align-self:flex-start;' }, [singleTab, bulkTab]));
      panel.appendChild(el('div', {}, textarea));

      // Search Intent badges (single-select)
      var selIntent = 'Informational';
      var intentWrap = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' });
      function paintIntents() {
        intentWrap.innerHTML = '';
        MANUAL_INTENTS.forEach(function (name) {
          var on = selIntent === name;
          var b = el('button', {
            type: 'button',
            class: 'aim-intent-badge ' + name.toLowerCase(),
            'aria-pressed': on ? 'true' : 'false',
            style: 'cursor:pointer;border:' + (on ? '1.5px solid var(--aim-accent)' : '1px solid #e5e7eb') + ';background:' + (on ? 'var(--aim-accent-light)' : '#fff') + ';font-weight:' + (on ? '700' : '600') + ';padding:4px 10px;font-size:12px;',
            text: name,
          });
          b.addEventListener('click', function () { selIntent = name; paintIntents(); });
          intentWrap.appendChild(b);
        });
      }
      paintIntents();
      panel.appendChild(el('div', {}, [
        el('div', { style: 'font-size:11px;font-weight:600;color:var(--aim-text-faint);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;', text: 'Search Intent' }),
        intentWrap,
      ]));

      // Topic chips (single-select; live topics when present, capture defaults otherwise)
      var topicList = topics.length
        ? topics.map(function (t) { return { name: t, color: TOPIC_COLORS[t] || '#6b7280' }; })
        : DEFAULT_MANUAL_TOPICS.slice();
      var selTopic = null;
      topicList.forEach(function (t) { if (t.name === 'General') selTopic = t.name; });
      if (!selTopic && topicList.length) selTopic = topicList[0].name;
      var topicWrap = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' });
      function paintTopics() {
        topicWrap.innerHTML = '';
        topicList.forEach(function (t) {
          var on = selTopic === t.name;
          var b = el('button', {
            type: 'button',
            'aria-pressed': on ? 'true' : 'false',
            style: 'cursor:pointer;display:inline-flex;align-items:center;gap:5px;padding:4px 10px;font-size:12px;font-weight:' + (on ? '700' : '500') + ';border-radius:4px;border:' + (on ? '1.5px solid var(--aim-accent)' : '1px solid #e5e7eb') + ';background:' + (on ? 'var(--aim-accent-light)' : 'var(--aim-surface)') + ';color:var(--aim-text);font-family:var(--aim-font);',
          }, [
            el('span', { style: 'width:7px;height:7px;border-radius:50%;background:' + t.color + ';display:inline-block;flex-shrink:0;' }),
            t.name,
          ]);
          b.addEventListener('click', function () { selTopic = t.name; paintTopics(); });
          topicWrap.appendChild(b);
        });
      }
      paintTopics();
      panel.appendChild(el('div', {}, [
        el('div', { style: 'font-size:11px;font-weight:600;color:var(--aim-text-faint);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;', text: 'Topic' }),
        topicWrap,
      ]));

      // footer: Add Prompt (disabled until the textarea has content)
      var submitBtn = el('button', { type: 'button', class: 'aim-primary-btn' });
      function paintSubmit() {
        var has = textarea.value.trim().length > 0;
        submitBtn.disabled = !has;
        submitBtn.textContent = mode === 'bulk' ? 'Add Prompts' : 'Add Prompt';
        submitBtn.setAttribute('style',
          'padding:7px 18px;font-size:13px;font-weight:600;background:' + (has ? 'var(--aim-accent)' : 'var(--aim-text-faint)') + ';color:#fff;border:none;border-radius:var(--aim-radius);cursor:' + (has ? 'pointer' : 'not-allowed') + ';font-family:var(--aim-font);');
      }
      textarea.addEventListener('input', paintSubmit);
      submitBtn.addEventListener('click', function () {
        if (!submitBtn.disabled) readOnlyToast();
      });
      paintSubmit();
      panel.appendChild(el('div', {
        style: 'display:flex;justify-content:flex-end;gap:8px;padding-top:4px;border-top:1px solid var(--aim-border-light);',
      }, [submitBtn]));

      return panel;
    }

    function openAddPromptsDialog(initialTab) {
      openDialog({
        style: 'max-width:800px;width:95vw;max-height:90vh;overflow-y:auto;padding:0;pointer-events:auto;',
        build: function (dialog, close) {
          var tab = initialTab === 'manual' ? 'manual' : 'ai';
          var aiTabBtn = el('button', {
            type: 'button', class: 'aim-tab',
            html: '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="display:inline;margin-right:4px;vertical-align:middle;"><path d="' + SPARKLE_PATH + '"></path></svg>AI Suggested',
          });
          var manualTabBtn = el('button', { type: 'button', class: 'aim-tab', text: 'Manual' });
          dialog.appendChild(el('div', {
            class: 'flex flex-col space-y-1.5 text-center sm:text-left',
            style: 'padding:16px 52px 12px 20px;border-bottom:1px solid var(--aim-border-light);',
          }, el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;' }, [
            el('h2', {
              class: 'text-lg font-semibold leading-none tracking-tight',
              style: 'font-size:15px;font-weight:700;color:var(--aim-text);font-family:var(--aim-font);',
              text: 'Add Prompts',
            }),
            el('div', { class: 'aim-tab-bar' }, [aiTabBtn, manualTabBtn]),
          ])));
          var body = el('div', { style: 'padding:20px;' });
          dialog.appendChild(body);
          function paint() {
            aiTabBtn.className = 'aim-tab' + (tab === 'ai' ? ' active' : '');
            manualTabBtn.className = 'aim-tab' + (tab === 'manual' ? ' active' : '');
            body.innerHTML = '';
            body.appendChild(tab === 'ai' ? buildAiPanel(close) : buildManualPanel());
          }
          aiTabBtn.addEventListener('click', function () { tab = 'ai'; paint(); });
          manualTabBtn.addEventListener('click', function () { tab = 'manual'; paint(); });
          paint();
        },
      });
    }

    function visibleRows() {
      var q = vs.searchText.trim().toLowerCase();
      var list = rows.filter(function (r) {
        if (q && r.text.toLowerCase().indexOf(q) === -1) return false;
        if (vs.topicFilter !== 'all' && r.topic !== vs.topicFilter) return false;
        if (vs.intentFilter !== 'all' && String(r.intent) !== vs.intentFilter) return false;
        return true;
      });
      list.sort(function (a, b) { return compareRows(a, b, vs.sortKey, vs.sortDir); });
      return list;
    }

    // ---- scaffold ----
    root.innerHTML = '';
    var wrap = el('div', { class: 'flex-1 py-8 px-4 bg-white' });
    root.appendChild(wrap);

    // Tip banner (dismissable, exact reference markup)
    var tipWrap = el('div', { class: 'max-w-5xl mx-auto mb-4', html: TIP_BANNER_HTML });
    wrap.appendChild(tipWrap);
    (function wireTip() {
      var dismiss = tipWrap.querySelector('button[aria-label="Dismiss tip"]');
      if (dismiss) dismiss.addEventListener('click', function () { tipWrap.remove(); });
      var link = tipWrap.querySelector('[data-pb-tip-link]');
      if (link) link.addEventListener('click', function (ev) { ev.preventDefault(); readOnlyToast(); });
    })();

    // aim-scope card
    var scope = el('div', { class: 'aim-scope' });
    wrap.appendChild(scope);
    var card = el('div', { class: 'aim-card', style: 'overflow:hidden;' });
    scope.appendChild(card);

    // ---- card header row ----
    var headerRow = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--aim-border-light);gap:10px;flex-wrap:wrap;' });
    card.appendChild(headerRow);

    var headerLeft = el('div', { style: 'display:flex;align-items:center;gap:10px;' });
    var headerRight = el('div', { style: 'display:flex;align-items:center;gap:8px;' });
    headerRow.appendChild(headerLeft);
    headerRow.appendChild(headerRight);

    // tabs
    var tabBar = el('div', { class: 'aim-tab-bar', style: 'margin-bottom:0px;' });
    var tabButtons = {};
    ['Active', 'Inactive'].forEach(function (name) {
      var b = el('button', { class: 'aim-tab' + (vs.tab === name ? ' active' : ''), text: name });
      b.addEventListener('click', function () {
        vs.tab = name;
        Object.keys(tabButtons).forEach(function (k) {
          tabButtons[k].className = 'aim-tab' + (vs.tab === k ? ' active' : '');
        });
        paintTables();
      });
      tabButtons[name] = b;
      tabBar.appendChild(b);
    });
    headerLeft.appendChild(tabBar);

    // search
    var searchWrap = el('div', { class: 'aim-search-wrap', html: SEARCH_ICON_SVG });
    var searchInput = el('input', {
      class: 'aim-search-input',
      placeholder: 'Search prompts...',
      'aria-label': 'Search prompts',
      style: 'width:170px;',
    });
    searchInput.addEventListener('input', function () {
      vs.searchText = searchInput.value;
      paintTables();
    });
    searchWrap.appendChild(searchInput);
    headerLeft.appendChild(searchWrap);

    // topic filter
    if (topics.length > 0) {
      var topicSelect = el('select', { 'aria-label': 'Filter by topic', style: SELECT_STYLE });
      topicSelect.appendChild(el('option', { value: 'all', text: 'All topics' }));
      topics.forEach(function (t) { topicSelect.appendChild(el('option', { value: t, text: t })); });
      topicSelect.addEventListener('change', function () {
        vs.topicFilter = topicSelect.value;
        paintTables();
      });
      headerLeft.appendChild(topicSelect);
    }

    // intent filter
    if (intents.length > 0) {
      var intentSelect = el('select', { 'aria-label': 'Filter by intent', style: SELECT_STYLE });
      intentSelect.appendChild(el('option', { value: 'all', text: 'All intents' }));
      intents.forEach(function (i) {
        var pretty = i.charAt(0).toUpperCase() + i.slice(1).toLowerCase();
        intentSelect.appendChild(el('option', { value: i, text: pretty }));
      });
      intentSelect.addEventListener('change', function () {
        vs.intentFilter = intentSelect.value;
        paintTables();
      });
      headerLeft.appendChild(intentSelect);
    }

    // count chip
    var pct = Math.min(100, rows.length / PROMPT_LIMIT * 100);
    headerRight.appendChild(el('div', {
      style: 'display:flex;align-items:center;gap:6px;padding:5px 10px;background:var(--aim-surface-alt);border:1px solid var(--aim-border);border-radius:var(--aim-radius);font-size:11px;color:var(--aim-text-muted);',
    }, [
      el('span', { style: 'font-weight:700;color:var(--aim-text);', text: String(rows.length) }),
      el('span', { text: '/' }),
      el('span', { text: String(PROMPT_LIMIT) }),
      el('span', { text: 'prompts' }),
      el('div', { style: 'width:36px;height:3px;background:var(--aim-border);border-radius:2px;overflow:hidden;' }, [
        el('div', { style: 'width:' + pct + '%;height:100%;background:var(--aim-accent);border-radius:2px;' }),
      ]),
    ]));

    // Add prompts menu
    var addWrap = el('div', { class: 'aim-add-menu-wrap' });
    var addBtn = el('button', { style: ADD_BTN_STYLE, html: ADD_BTN_HTML });
    var addMenu = el('div', { class: 'aim-add-menu', html: ADD_MENU_HTML });
    addBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      addMenu.classList.toggle('open');
    });
    document.addEventListener('click', function (ev) {
      if (!addWrap.contains(ev.target)) addMenu.classList.remove('open');
    });
    var addAiItem = addMenu.querySelector('[data-pb-add-ai]');
    if (addAiItem) addAiItem.addEventListener('click', function () {
      addMenu.classList.remove('open');
      openAddPromptsDialog('ai');
    });
    var addManualItem = addMenu.querySelector('[data-pb-add-manual]');
    if (addManualItem) addManualItem.addEventListener('click', function () {
      addMenu.classList.remove('open');
      openAddPromptsDialog('manual');
    });
    addWrap.appendChild(addBtn);
    addWrap.appendChild(addMenu);
    headerRight.appendChild(addWrap);

    // Add Topic / Add Intent
    var addTopicBtn = el('button', { class: 'aim-st-btn-outlined', 'aria-label': 'Add topic', html: ADD_TOPIC_HTML });
    addTopicBtn.addEventListener('click', openAddTopicDialog);
    headerRight.appendChild(addTopicBtn);
    var addIntentBtn = el('button', {
      class: 'aim-st-btn-outlined', 'aria-label': 'Add intent',
      style: 'display:flex;align-items:center;gap:5px;font-size:11px;white-space:nowrap;padding:5px 10px;',
      html: ADD_INTENT_HTML,
    });
    addIntentBtn.addEventListener('click', openAddIntentDialog);
    headerRight.appendChild(addIntentBtn);

    // ---- table host (repainted on tab/filter/sort changes) ----
    var tableHost = el('div', {});
    card.appendChild(tableHost);

    // floating selection bar host (in scope, fixed-position bar)
    var floatHost = el('div', {});
    scope.appendChild(floatHost);

    function sortArrow(key) {
      if (vs.sortKey !== key) return null;
      return el('span', { style: 'margin-left:4px;font-size:9px;', text: vs.sortDir < 0 ? '↑' : '↓' });
    }

    function onSort(key) {
      if (vs.sortKey === key) vs.sortDir = -vs.sortDir;
      else { vs.sortKey = key; vs.sortDir = 1; }
      paintTables();
    }

    function setSelected(id, on) {
      if (on) {
        if (!vs.selected[id]) { vs.selected[id] = true; vs.selectedCount += 1; }
      } else if (vs.selected[id]) {
        delete vs.selected[id];
        vs.selectedCount -= 1;
      }
      paintFloatingBar();
    }

    function clearSelection() {
      vs.selected = {};
      vs.selectedCount = 0;
      paintTables();
    }

    function paintFloatingBar() {
      floatHost.innerHTML = '';
      if (vs.selectedCount === 0) return;
      var bar = el('div', { class: 'aim-floating-bar' }, [
        el('div', { class: 'aim-floating-bar-count' }, [
          String(vs.selectedCount) + ' ',
          el('span', { text: 'selected' }),
        ]),
        el('div', { style: 'display:flex;align-items:center;gap:4px;' }, [
          btn('Export Excel', 'default', readOnlyToast),
          btn('Clear', 'default', clearSelection),
          btn('Pause', 'primary', readOnlyToast),
          btn('Archive', 'default', readOnlyToast),
          btn('Delete', 'danger', readOnlyToast),
        ]),
      ]);
      floatHost.appendChild(bar);
      function btn(label, kind, fn) {
        var b = el('button', { class: 'aim-floating-action ' + kind, text: label });
        b.addEventListener('click', fn);
        return b;
      }
    }

    function buildActiveTable(list) {
      var tableWrap = el('div', { class: 'aim-table-wrap', style: 'max-height:calc(100vh - 260px);overflow-y:auto;overflow-x:auto;' });
      var table = el('table', { class: 'aim-full-table', style: 'min-width:900px;' });
      tableWrap.appendChild(table);

      // header
      var selectAll = el('input', {
        type: 'checkbox',
        'aria-label': 'Select all prompts',
        style: 'width:13px;height:13px;cursor:pointer;accent-color:var(--aim-accent);',
      });
      selectAll.checked = list.length > 0 && list.every(function (r) { return vs.selected[r.id]; });
      selectAll.indeterminate = !selectAll.checked && list.some(function (r) { return vs.selected[r.id]; });
      selectAll.addEventListener('change', function () {
        var on = selectAll.checked;
        vs.selected = {};
        vs.selectedCount = 0;
        if (on) {
          list.forEach(function (r) { vs.selected[r.id] = true; });
          vs.selectedCount = list.length;
        }
        paintTables();
      });

      function th(label, key, width, hideClass) {
        var attrs = { style: 'width:' + width + 'px;cursor:pointer;' };
        if (key === 'text') attrs.style = 'min-width:260px;cursor:pointer;';
        if (hideClass) attrs.class = hideClass;
        if (key === 'text') attrs.class = 'col-left';
        var node = el('th', attrs, [label + ' ', sortArrow(key)]);
        node.addEventListener('click', function () { onSort(key); });
        return node;
      }

      var thead = el('thead', {}, el('tr', {}, [
        el('th', { style: 'width:30px;cursor:default;' }, selectAll),
        th('Prompt', 'text', 260),
        th('Visibility', 'visibility', 90, 'aim-hide-820'),
        th('Sentiment', 'sentiment', 85, 'aim-hide-820'),
        th('Position', 'position', 80, 'aim-hide-820'),
        th('Mentions', 'mentions', 80, 'aim-hide-820'),
        th('Citations', 'citations', 80, 'aim-hide-640'),
        th('Topic', 'topic', 110, 'aim-hide-640'),
        th('Intent', 'intent', 100, 'aim-hide-640'),
        el('th', { style: 'width:72px;cursor:default;', text: 'Actions' }),
      ]));
      table.appendChild(thead);

      var tbody = el('tbody');
      table.appendChild(tbody);

      if (!list.length) {
        tbody.appendChild(el('tr', {}, el('td', { colspan: '10', class: 'aim-empty-state', text: 'No prompts to show' })));
        return tableWrap;
      }

      list.forEach(function (row) {
        var tr = el('tr', { style: 'cursor:pointer;' });
        tr.addEventListener('click', function () { PB.navigate('#/prompts/' + row.id); });

        // checkbox
        var cb = el('input', {
          type: 'checkbox',
          'aria-label': 'Select prompt: ' + row.text.slice(0, 40),
          style: 'cursor:pointer;accent-color:var(--aim-accent);width:13px;height:13px;',
        });
        cb.checked = !!vs.selected[row.id];
        cb.addEventListener('change', function () { setSelected(row.id, cb.checked); });
        var tdCb = el('td', {}, cb);
        tdCb.addEventListener('click', function (ev) { ev.stopPropagation(); });
        tr.appendChild(tdCb);

        // prompt text
        tr.appendChild(el('td', { class: 'col-left', style: 'min-width:260px;' },
          el('a', { class: 'block', href: '#/prompts/' + row.id }, [
            el('div', { class: 'aim-prompt-text', title: row.text, text: row.text }),
          ])
        ));

        // visibility
        tr.appendChild(el('td', { class: 'aim-hide-820' },
          el('span', { class: 'aim-vis-pct ' + visClass(row.visibility), text: Math.round(row.visibility) + '%' })
        ));

        // sentiment / position / mentions / citations (enriched async)
        var tdSent = el('td', { class: 'aim-hide-820' }, sentimentNode(row));
        var tdPos = el('td', { class: 'aim-hide-820' }, positionNode(row));
        var tdMen = el('td', { class: 'aim-hide-820' }, mentionsNode(row));
        var tdCit = el('td', { class: 'aim-hide-640' }, citationsNode(row));
        tr.appendChild(tdSent);
        tr.appendChild(tdPos);
        tr.appendChild(tdMen);
        tr.appendChild(tdCit);
        cellRefs[row.id] = { sent: tdSent, pos: tdPos, men: tdMen, cit: tdCit };

        // topic / intent
        tr.appendChild(el('td', { class: 'aim-hide-640' }, topicNode(row.topic)));
        tr.appendChild(el('td', { class: 'aim-hide-640' }, intentNode(row.intent)));

        // actions
        var tdAct = el('td', {}, el('span', { style: 'display:inline-flex;align-items:center;gap:4px;' }, [
          actionButton('Edit prompt', 'Edit prompt: ' + row.text.slice(0, 40), SVG_EDIT, 'var(--aim-accent)'),
          actionButton('Delete prompt', 'Delete prompt: ' + row.text.slice(0, 40), SVG_TRASH, 'var(--aim-danger)'),
        ]));
        tdAct.addEventListener('click', function (ev) { ev.stopPropagation(); });
        tr.appendChild(tdAct);

        tbody.appendChild(tr);
      });

      return tableWrap;
    }

    function buildInactiveTable() {
      // The live API only returns active prompts; the Inactive tab mirrors the
      // product's empty state exactly.
      var tableWrap = el('div', { class: 'aim-table-wrap', style: 'max-height:calc(100vh - 260px);overflow-y:auto;overflow-x:auto;' });
      var table = el('table', { class: 'aim-full-table', style: 'min-width:700px;' });
      table.appendChild(el('thead', {}, el('tr', {}, [
        el('th', { style: 'width:30px;cursor:default;' },
          el('input', { type: 'checkbox', 'aria-label': 'Select all inactive prompts', style: 'width:13px;height:13px;cursor:pointer;accent-color:var(--aim-accent);' })),
        el('th', { class: 'col-left', style: 'min-width:260px;', text: 'Prompt' }),
        el('th', { style: 'width:120px;cursor:pointer;', text: 'Topic ' }),
        el('th', { style: 'width:110px;cursor:pointer;', text: 'Intent ' }),
        el('th', { style: 'width:100px;', text: 'Actions' }),
      ])));
      var tbody = el('tbody');
      tbody.appendChild(el('tr', {}, el('td', { colspan: '5', class: 'aim-empty-state', text: 'No prompts to show' })));
      table.appendChild(tbody);
      tableWrap.appendChild(table);
      return tableWrap;
    }

    function paintTables() {
      cellRefs = {};
      tableHost.innerHTML = '';
      if (vs.tab === 'Active') tableHost.appendChild(buildActiveTable(visibleRows()));
      else tableHost.appendChild(buildInactiveTable());
      paintFloatingBar();
    }

    paintTables();

    // ---- Recommended Prompts CTA (exact reference markup) ----
    var recoWrap = el('div', { class: 'max-w-5xl mx-auto mt-8', html: RECO_HTML });
    wrap.appendChild(recoWrap);
    var recoBtn = recoWrap.querySelector('[data-pb-reco-btn]');
    if (recoBtn) recoBtn.addEventListener('click', readOnlyToast);

    // ---- async enrichment: sentiment / position / mentions / citations ----
    function fillRow(row) {
      var refs = cellRefs[row.id];
      if (!refs || !root.isConnected) return;
      refs.sent.innerHTML = '';
      refs.sent.appendChild(sentimentNode(row));
      refs.pos.innerHTML = '';
      refs.pos.appendChild(positionNode(row));
      refs.men.innerHTML = '';
      refs.men.appendChild(mentionsNode(row));
      refs.cit.innerHTML = '';
      refs.cit.appendChild(citationsNode(row));
    }

    var queue = rows.slice();
    async function enrichWorker() {
      while (queue.length) {
        if (!root.isConnected) return; // view navigated away, stop fetching
        var row = queue.shift();
        row.enrich.state = 'loading';
        try {
          var detail = await PB.api.promptDetail(ctx.brandId, row.id, ctx.range);
          var summary = summarizeDetail(detail);
          row.enrich.state = 'done';
          row.enrich.sentiment = summary.sentiment;
          row.enrich.position = summary.position;
          row.enrich.topBrands = summary.topBrands;
          row.enrich.totalBrands = summary.totalBrands;
          row.enrich.topDomains = summary.topDomains;
          row.enrich.totalDomains = summary.totalDomains;
          row.enrich.citedDomains = summary.citedDomains;
        } catch (err) {
          row.enrich.state = 'error';
        }
        fillRow(row);
      }
    }
    // finish the tracked-competitor fetch first so the mentions cells resolve
    // tracked entities by their API urls (any failure degrades gracefully)
    var compList = await trackedPromise;
    (compList || []).forEach(function (c) {
      if (c && c.name && c.url) {
        var key = String(c.name).trim().toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(trackedDomains, key)) {
          trackedDomains[key] = c.url;
        }
      }
    });
    for (var w = 0; w < ENRICH_CONCURRENCY; w++) enrichWorker();
  });
})();
