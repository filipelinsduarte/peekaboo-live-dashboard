/* binder: recentchats
 *
 * Repopulates the "Recent Chats" card with LIVE recent AI runs while preserving
 * the EXACT captured row markup. Called as PBbind.recentChats(root, ctx, data).
 *
 * Rows are rendered synchronously from data.looker.data (model logo + name, date,
 * prompt). The looker rows carry NO response text, so the per-row SNIPPET line is
 * resolved ASYNCHRONOUSLY from the Prompts API:
 *
 *   1. dedupe the prompt texts shown (the ~10 most recent looker rows),
 *   2. resolve promptText -> promptId via PB.api.prompts(brandId, {limit}),
 *   3. fetch PB.api.promptDetail(brandId, promptId, range, true) ONCE per unique
 *      prompt (include_full_response=true; cached in a module-level map; the
 *      local proxy also caches GETs 5 min),
 *   4. match a history entry by aiModel (and date when possible) and use the
 *      real AI response text (history.fullResponse, the same text the real
 *      dashboard shows) as the snippet, falling back to responseSnippet /
 *      mentionSummary when fullResponse is absent.
 *
 * Honesty rule: never fabricate snippet text. If no real snippet resolves for a
 * row, that row's snippet <p> is removed rather than filled with invented text.
 * Never throws: the whole body is guarded with try/catch + console.error.
 */
(function () {
  'use strict';

  var PAGE_SIZE = 10;

  // promptId -> Promise<detail> cache (survives re-binds within a session).
  var detailCache = {};
  // brandId -> Promise<{ textToId: {normText: promptId} }> cache.
  var promptMapCache = {};

  // Format a YYYY-MM-DD (or date-ish) string to the capture's M/D/YYYY style,
  // e.g. "2026-06-11" -> "6/11/2026". Falls back to the raw string.
  function fmtDate(s) {
    if (!s) return '';
    try {
      // Parse YYYY-MM-DD as a local date to avoid TZ off-by-one.
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
      var d;
      if (m) {
        d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      } else {
        d = new Date(s);
      }
      if (isNaN(d.getTime())) return String(s);
      return d.toLocaleDateString('en-US', { day: 'numeric', month: 'numeric', year: 'numeric' });
    } catch (e) {
      return String(s);
    }
  }

  function setText(node, txt) {
    if (node) node.textContent = txt == null ? '' : String(txt);
  }

  function normPrompt(s) {
    return String(s == null ? '' : s).trim().toLowerCase();
  }

  window.PBbind = window.PBbind || {};
  window.PBbind.recentChats = function (root, ctx, data) {
    try {
      if (!root) return;
      var PB = window.PB || {};
      var dash = window.PBdash || {};
      ctx = ctx || {};

      // 1. locate the card + its rows grid
      var card = (dash.cardByTitle && dash.cardByTitle(root, 'Recent Chats')) || null;
      if (!card) { console.error('[bind recentChats] card not found'); return; }

      var grid = card.querySelector('.grid.gap-2.lg\\:grid-cols-2');
      if (!grid) {
        grid = card.querySelector('[class*="lg:grid-cols-2"]') || card.querySelector('.grid');
      }
      if (!grid) { console.error('[bind recentChats] rows grid not found'); return; }

      // clone the first row as a template (includes the snippet <p>)
      var tplRow = grid.firstElementChild;
      if (!tplRow) { console.error('[bind recentChats] no template row'); return; }
      var template = tplRow.cloneNode(true);

      // 2. build the chat list from live looker rows (most recent first)
      var rows = (data && data.looker && data.looker.data && data.looker.data.length)
        ? data.looker.data.slice()
        : [];

      var chats = [];
      var totalCount = 0;

      if (rows.length) {
        rows.sort(function (a, b) {
          var da = a && a.date ? a.date : '';
          var db = b && b.date ? b.date : '';
          return da < db ? 1 : da > db ? -1 : 0;
        });
        totalCount = rows.length;
        for (var i = 0; i < rows.length && chats.length < PAGE_SIZE; i++) {
          var r = rows[i];
          if (!r) continue;
          chats.push({
            model: r.ai_model || '',
            date: r.date || '',
            prompt: r.prompt || ''
          });
        }
      } else if (data && data.snap && data.snap.prompts && data.snap.prompts.length) {
        // fallback: snapshot prompts (no date, model = first of aiModels)
        var prompts = data.snap.prompts;
        totalCount = prompts.length;
        for (var j = 0; j < prompts.length && chats.length < PAGE_SIZE; j++) {
          var p = prompts[j];
          if (!p) continue;
          var models = p.aiModels || [];
          chats.push({
            model: (models && models.length) ? models[0] : '',
            date: '',
            prompt: p.promptText || ''
          });
        }
      }

      // clear the grid
      grid.innerHTML = '';

      // 3. empty-state
      if (!chats.length) {
        var empty = document.createElement('p');
        empty.className = 'text-xs text-muted-foreground';
        empty.textContent = 'No recent chats.';
        grid.appendChild(empty);
        updateHeader(card, 0, 0);
        return;
      }

      // build rows from the template (snippet removed for now — filled async)
      var rowNodes = [];
      for (var k = 0; k < chats.length; k++) {
        var c = chats[k];
        var node = template.cloneNode(true);

        var label = (PB.modelLabel ? PB.modelLabel(c.model) : c.model) || c.model || 'AI';
        var logo = (PB.modelLogo ? PB.modelLogo(c.model) : '/logos/google-logo.png');
        var dateStr = fmtDate(c.date);

        node.setAttribute('aria-label', 'View details for: ' + (c.prompt || ''));

        var img = node.querySelector('img');
        if (img) {
          img.setAttribute('src', logo);
          img.setAttribute('alt', label);
        }

        var modelSpan = node.querySelector('.text-\\[11px\\].font-medium.text-muted-foreground');
        if (!modelSpan) modelSpan = node.querySelector('.text-\\[11px\\].font-medium');
        setText(modelSpan, label);

        var dateSpan = node.querySelector('.text-\\[10px\\].text-muted-foreground');
        if (!dateSpan) dateSpan = node.querySelector('.text-\\[10px\\]');
        setText(dateSpan, dateStr);

        var promptP = node.querySelector('p.text-xs.font-medium');
        if (!promptP) promptP = node.querySelector('p.truncate');
        setText(promptP, c.prompt || '');

        // Remove the snippet <p> for now; async fill restores it if resolved.
        var snippetP = node.querySelector('p.line-clamp-1');
        if (!snippetP) snippetP = node.querySelector('p.text-\\[11px\\].text-muted-foreground');
        if (snippetP && snippetP.parentNode) snippetP.parentNode.removeChild(snippetP);

        // remember where to inject the snippet (the inner flex-1 column)
        var col = node.querySelector('.flex-1.min-w-0') || node.querySelector('[class*="flex-1"]');
        rowNodes.push({ node: node, col: col, chat: c });

        grid.appendChild(node);
      }

      // 4. header count "(N)" + pagination "1-10 of N"
      updateHeader(card, chats.length, totalCount);

      // 5. async: resolve + inject real snippets (never throws)
      try {
        fillSnippets(PB, ctx, rowNodes);
      } catch (e) {
        console.error('[bind recentChats fillSnippets:start]', e);
      }
    } catch (e) {
      console.error('[bind recentChats]', e);
    }
  };

  // --------------------------------------------------------------------------
  // Async snippet resolution. Renders rows are already in the DOM; this fills
  // the gray snippet line in as the data arrives.
  function fillSnippets(PB, ctx, rowNodes) {
    var api = PB && PB.api;
    var brandId = ctx && ctx.brandId;
    var range = (ctx && ctx.range) || '30d';
    if (!api || !brandId || !api.prompts || !api.promptDetail) return;

    // unique prompt texts among the shown rows
    var uniqueTexts = {};
    rowNodes.forEach(function (rn) {
      var t = normPrompt(rn.chat && rn.chat.prompt);
      if (t) uniqueTexts[t] = true;
    });
    if (!Object.keys(uniqueTexts).length) return;

    resolvePromptMap(api, brandId).then(function (textToId) {
      // collect the unique promptIds we actually need
      var needed = {};
      Object.keys(uniqueTexts).forEach(function (t) {
        var pid = textToId[t];
        if (pid) needed[pid] = true;
      });
      var pids = Object.keys(needed);
      if (!pids.length) return;

      // fetch details (cached per promptId), then inject snippets.
      pids.forEach(function (pid) {
        getDetail(api, brandId, pid, range).then(function (detail) {
          injectForPrompt(PB, textToId, rowNodes, detail);
        }).catch(function (err) {
          console.error('[bind recentChats promptDetail]', err);
        });
      });
    }).catch(function (err) {
      console.error('[bind recentChats prompts]', err);
    });
  }

  // Build (and cache) a normalized promptText -> promptId map for the brand.
  function resolvePromptMap(api, brandId) {
    if (promptMapCache[brandId]) return promptMapCache[brandId];
    var p = api.prompts(brandId, { limit: 50 }).then(function (env) {
      var list = (env && env.data) || [];
      var textToId = {};
      list.forEach(function (it) {
        if (it && it.promptText && it.promptId) {
          var key = normPrompt(it.promptText);
          if (!(key in textToId)) textToId[key] = it.promptId;
        }
      });
      return textToId;
    });
    promptMapCache[brandId] = p;
    return p;
  }

  // Fetch (and cache) a prompt's detail WITH full response text. The real
  // dashboard's snippet line is the AI's actual response (history.fullResponse),
  // which is only returned when include_full_response=true.
  function getDetail(api, brandId, promptId, range) {
    if (detailCache[promptId]) return detailCache[promptId];
    var p = api.promptDetail(brandId, promptId, range, true);
    detailCache[promptId] = p;
    return p;
  }

  // Collapse newlines/tabs/runs of whitespace + &nbsp; into single spaces so the
  // single-line (line-clamp-1) snippet reads cleanly. Trim to a sane length.
  function cleanSnippet(s) {
    if (!s) return '';
    var t = String(s).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length > 240) t = t.slice(0, 240);
    return t;
  }

  // Inject snippets into every row whose prompt maps to this detail's promptId.
  function injectForPrompt(PB, textToId, rowNodes, detail) {
    try {
      if (!detail) return;
      var detailId = detail.promptId;
      var history = (detail && detail.history) || [];
      if (!history.length) return;

      rowNodes.forEach(function (rn) {
        if (!rn || !rn.col) return;
        // already filled?
        if (rn.col.querySelector('p.line-clamp-1')) return;
        var t = normPrompt(rn.chat && rn.chat.prompt);
        var pid = textToId[t];
        if (!pid || (detailId && pid !== detailId)) return;

        var snippet = pickSnippet(history, rn.chat.model, rn.chat.date);
        if (!snippet) return; // honesty: omit rather than fabricate

        var p = document.createElement('p');
        p.className = 'text-[11px] text-muted-foreground mt-0.5 line-clamp-1';
        p.textContent = snippet;
        rn.col.appendChild(p);
      });
    } catch (e) {
      console.error('[bind recentChats injectForPrompt]', e);
    }
  }

  // Choose the best-matching history entry's snippet text.
  // Snippet text per entry = the AI's actual response (fullResponse), falling
  // back to the brand-mention summary fields. Entry priority: exact aiModel +
  // date, then aiModel, then date, then any.
  function pickSnippet(history, model, date) {
    var byModelDate = null, byModel = null, byDate = null, any = null;
    for (var i = 0; i < history.length; i++) {
      var h = history[i];
      if (!h) continue;
      var text = cleanSnippet(h.fullResponse || h.responseSnippet || h.mentionSummary);
      if (!text) continue;
      if (!any) any = text;
      var mMatch = model && h.aiModel === model;
      var dMatch = date && h.date === date;
      if (mMatch && dMatch && !byModelDate) byModelDate = text;
      if (mMatch && !byModel) byModel = text;
      if (dMatch && !byDate) byDate = text;
    }
    return byModelDate || byModel || byDate || any || '';
  }

  // Update the "(N)" count chip and the "1-N of TOTAL" pagination label.
  function updateHeader(card, shown, total) {
    try {
      if (!card) return;

      var spans = card.querySelectorAll('span');
      for (var i = 0; i < spans.length; i++) {
        var t = (spans[i].textContent || '').trim();
        if (/^\(\d[\d,]*\)$/.test(t)) {
          spans[i].textContent = '(' + total + ')';
          break;
        }
      }

      for (var j = 0; j < spans.length; j++) {
        var pt = (spans[j].textContent || '').trim();
        if (/^\d+\s*[-–]\s*\d+\s+of\s+\d[\d,]*$/.test(pt)) {
          var from = total > 0 ? 1 : 0;
          spans[j].textContent = from + '-' + shown + ' of ' + total;
          break;
        }
      }
    } catch (e) {
      console.error('[bind recentChats:header]', e);
    }
  }
})();
