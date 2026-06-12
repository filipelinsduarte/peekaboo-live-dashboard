/*
 * ask-ai.js -- Ask AI view (live), shell of the captured chat UI.
 *
 * Visual reference: app/ask-ai.html (captured from the live product).
 *
 * The live Peekaboo API (PBApi) does not expose a /chat endpoint, so this
 * view renders the empty-state shell only. The send button is present but
 * disabled, matching the captured page's initial state.
 *
 * No LLM API calls are made here. No em dashes anywhere.
 */
(function () {
  'use strict';
  if (!window.PB) return;
  var el = PB.el;

  // Suggested prompts shown as pill buttons, copied from the captured page.
  var SUGGESTIONS = [
    { text: 'Why is my score where it is?' },
    { text: 'Compare me vs competitors' },
    { text: 'Show me the actual AI mentions' },
  ];

  // Sparkles icon SVG (inline, matches the captured page header).
  var SVG_SPARKLES = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"></path><path d="M20 3v4"></path><path d="M22 5h-4"></path><path d="M4 17v2"></path><path d="M5 18H3"></path></svg>';

  PB.registerView('ask-ai', async function (root, ctx) {
    root.innerHTML = '';

    // Outer wrapper, full-height flex column, matches app/ask-ai.html layout.
    var wrap = el('div', {
      class: 'flex flex-col bg-white w-full flex-1',
      style: { minHeight: '0', height: 'calc(100vh - 8rem)' },
    });

    // ---- messages area (empty state) -----------------------------------------
    var messagesArea = el('div', {
      class: 'flex-1 overflow-y-auto px-5 py-5',
    });

    var emptyState = el('div', {
      class: 'space-y-3 max-w-[680px] mx-auto w-full flex flex-col items-center justify-center',
      style: { paddingTop: '3rem' },
    });

    var iconWrap = el('div', {
      class: 'flex items-center justify-center w-12 h-12 rounded-full bg-brand/10 text-brand mb-2',
      html: SVG_SPARKLES,
    });

    var heading = el('h2', {
      class: 'text-lg font-semibold text-gray-900',
      text: 'Ask about your AI visibility',
    });

    var subtext = el('p', {
      class: 'text-sm text-muted-foreground text-center max-w-sm',
      text: 'Send a message to start. Ask why your score is where it is, how you compare to competitors, or what the AI models are saying about you.',
    });

    emptyState.appendChild(iconWrap);
    emptyState.appendChild(heading);
    emptyState.appendChild(subtext);
    messagesArea.appendChild(emptyState);

    // ---- suggestion pills -------------------------------------------------------
    var pillsWrap = el('div', { class: 'border-t border-gray-100 bg-white px-4 pt-3' });
    var pillsInner = el('div', { class: 'max-w-[680px] mx-auto w-full' });
    var pillsRow = el('div', { class: 'flex flex-wrap gap-1.5 pb-2' });

    SUGGESTIONS.forEach(function (s) {
      var pill = el('button', {
        type: 'button',
        class: 'inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] text-gray-600 transition-all hover:bg-brand/5 hover:text-brand hover:ring-brand/30 ring-1 ring-gray-200',
        text: s.text,
      });
      pill.addEventListener('click', function () {
        var inputEl = wrap.querySelector('input[type="text"]');
        if (!inputEl) return;
        inputEl.value = s.text;
        inputEl.focus();
        var sendBtn = wrap.querySelector('button[type="submit"]');
        if (sendBtn) {
          sendBtn.disabled = false;
        }
      });
      pillsRow.appendChild(pill);
    });

    pillsInner.appendChild(pillsRow);
    pillsWrap.appendChild(pillsInner);

    // ---- input form (matches captured page chrome) ------------------------------
    var form = el('form', {
      class: 'sticky bottom-0 border-t bg-white p-3',
    });

    var formInner = el('div', {
      class: 'flex gap-2 max-w-[680px] mx-auto w-full',
    });

    var inputEl = el('input', {
      type: 'text',
      class: 'flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-[13px] placeholder:text-gray-400 focus:border-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:opacity-50 transition-colors',
      placeholder: 'Ask the agent...',
    });

    var sendBtn = el('button', {
      type: 'submit',
      class: 'rounded-xl bg-brand px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-brand/90 active:scale-95 disabled:opacity-40',
      text: 'Send',
    });
    sendBtn.disabled = true;

    // Enable / disable send as user types.
    inputEl.addEventListener('input', function () {
      sendBtn.disabled = inputEl.value.trim().length === 0;
    });

    // On submit: show a toast explaining the feature is not yet wired in this
    // local mirror. This mirrors how other write-actions work in the codebase.
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = inputEl.value.trim();
      if (!msg) return;
      PB.toast('Ask AI is not available in the local mirror');
    });

    formInner.appendChild(inputEl);
    formInner.appendChild(sendBtn);
    form.appendChild(formInner);

    // ---- assemble ---------------------------------------------------------------
    wrap.appendChild(messagesArea);
    wrap.appendChild(pillsWrap);
    wrap.appendChild(form);
    root.appendChild(wrap);

    // Focus the input so the view feels responsive on navigation.
    setTimeout(function () {
      if (inputEl) inputEl.focus();
    }, 50);
  });
})();
