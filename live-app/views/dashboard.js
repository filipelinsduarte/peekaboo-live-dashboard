/*
 * dashboard.js — Main Dashboard view, EXACT :7897 design with live data.
 *
 * Strategy: inject the captured dashboard content verbatim (the template is a
 * byte-for-byte copy of the <main> content of app/dashboard.html, the :7897
 * reference), so the markup, Tailwind classes, card chrome, typography and
 * badge colors are pixel-identical to the static mirror. Then hand each card
 * to a dedicated binder that swaps the baked Flexzo data for live API data
 * while preserving the exact DOM structure.
 *
 * Sections covered (all present in the captured template):
 *   - "Talk to your data with Claude" banner (kept, dismiss button wired)
 *   - Floating Snapshot / Over Time toggle pill
 *   - Visibility card: multi-line chart + legend  -> PBbind.visibility
 *   - Competitors card: rank/favicon/visibility   -> PBbind.competitors
 *   - Source Types donut + Top Domains rows       -> PBbind.sources
 *   - Recent Chats 2-col grid of prompt cards     -> PBbind.recentChats
 *   - Header brand-pill stats (Visibility / Sentiment / Avg Position)
 *
 * Binders live in binders/<name>.js and attach to window.PBbind.
 */
(function () {
  'use strict';
  if (!window.PB) return;

  var TEMPLATE_URL = '/templates/dashboard-content.html';
  var _templateCache = null;

  function rangeDays(r) { return r === '90d' ? 90 : r === '30d' ? 30 : 7; }
  function isoDaysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
  function isoToday() { return new Date().toISOString().slice(0, 10); }

  async function loadTemplate() {
    if (_templateCache) return _templateCache;
    var res = await fetch(TEMPLATE_URL);
    if (!res.ok) throw new Error('Failed to load dashboard template (' + res.status + ')');
    _templateCache = await res.text();
    return _templateCache;
  }

  // The reference design at :7897 INCLUDES the "Talk to your data with Claude"
  // banner; keep it, but make its dismiss (X) button actually work.
  function wireBannerDismiss(root) {
    try {
      var btn = root.querySelector('button[aria-label="Dismiss"]');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var banner = btn.closest('.rounded-2xl');
        if (banner) banner.remove();
      });
    } catch (e) { /* non-fatal */ }
  }

  // The Snapshot / Over Time floating pill is static in the capture; keep it
  // visually identical and just make the buttons toggle the active style.
  function wireTogglePill(root) {
    try {
      var pill = root.querySelector('.fixed.bottom-6');
      if (!pill) return;
      var buttons = pill.querySelectorAll('button');
      if (buttons.length !== 2) return;
      var ACTIVE = ['bg-brand', 'text-[var(--theme-on-primary)]', 'shadow-md', '!bg-brand'];
      var IDLE = ['text-muted-foreground', 'hover:text-foreground', 'hover:bg-muted/50', 'bg-transparent'];
      function activate(on, off) {
        ACTIVE.forEach(function (c) { on.classList.add(c); off.classList.remove(c); });
        IDLE.forEach(function (c) { off.classList.add(c); on.classList.remove(c); });
      }
      buttons[0].addEventListener('click', function () { activate(buttons[0], buttons[1]); });
      buttons[1].addEventListener('click', function () { activate(buttons[1], buttons[0]); });
    } catch (e) { /* non-fatal */ }
  }

  PB.registerView('dashboard', async function (root, ctx) {
    // 1. inject the exact captured content (pixel-identical to :7897)
    var tpl = await loadTemplate();
    root.innerHTML = tpl;
    wireBannerDismiss(root);
    wireTogglePill(root);

    // 2. fetch live data — all four calls in parallel (same endpoints as before)
    var results = await Promise.all([
      PB.api.snapshot(ctx.brandId).catch(function () { return null; }),
      PB.api.visibility(ctx.brandId, ctx.range).catch(function () { return null; }),
      PB.api.looker({
        start_date: isoDaysAgo(rangeDays(ctx.range)),
        end_date: isoToday(),
        brand_id: ctx.brandId,
        include_competitors: 'true',
        limit: 5000,
      }).catch(function () { return null; }),
      (window.PBUntracked
        ? window.PBUntracked.fetch(ctx.brandId, ctx.range || '7d')
        : Promise.resolve({ rows: [] })
      ).catch(function () { return { rows: [] }; }),
    ]);
    var snap = results[0];
    var vis = results[1];
    var looker = results[2];
    var untracked = results[3];
    var data = { snap: snap, vis: vis, looker: looker, untracked: untracked };

    // 3. push the brand-pill stats (Visibility / Sentiment / Avg Position).
    // Sentiment isn't a snapshot field — derive it from the brand's looker rows
    // (% positive among rows that carry a real sentiment value).
    var sentiment = null;
    try {
      if (looker && looker.data) {
        var pos = 0, tot = 0;
        looker.data.forEach(function (r) {
          if (r.entity_type !== 'brand') return;
          var s = (r.sentiment || '').toLowerCase();
          if (s === 'positive' || s === 'neutral' || s === 'negative') {
            tot += 1;
            if (s === 'positive') pos += 1;
          }
        });
        if (tot > 0) sentiment = Math.round((pos / tot) * 100);
      }
    } catch (e) { /* leave null */ }

    if (PB.setPillStats && snap && snap.visibility) {
      PB.setPillStats({
        visibility: snap.visibility.score,
        sentiment: sentiment,
        position: snap.visibility.rank,
      });
    }

    // 4. hand each card to its binder (guarded so one failure can't blank the page)
    var B = window.PBbind || {};
    safe(function () { if (B.visibility) B.visibility(root, ctx, data); }, 'visibility');
    safe(function () { if (B.competitors) B.competitors(root, ctx, data); }, 'competitors');
    safe(function () { if (B.sources) B.sources(root, ctx, data); }, 'sources');
    safe(function () { if (B.recentChats) B.recentChats(root, ctx, data); }, 'recentChats');

    if (window.lucide) window.lucide.createIcons();
  });

  function safe(fn, label) {
    try { fn(); } catch (e) { console.error('[bind ' + label + ']', e); }
  }

  // shared helpers for binders
  window.PBdash = {
    rangeDays: rangeDays, isoDaysAgo: isoDaysAgo, isoToday: isoToday,
    // find a shadcn card by its heading text
    cardByTitle: function (root, title) {
      var heads = root.querySelectorAll('.font-semibold.tracking-tight');
      for (var i = 0; i < heads.length; i++) {
        if ((heads[i].textContent || '').trim() === title) {
          return heads[i].closest('.rounded-lg.border') || heads[i].closest('[class*="rounded"]');
        }
      }
      return null;
    },

    // Client-side pager shared by the Competitors + Top Domains cards. The
    // real dashboard paginates these lists (e.g. "1-8 of 13") with chevron
    // prev/next buttons; we mirror that exactly.
    //   opts.container : element the data rows live in (header row stays put)
    //   opts.rows      : array of row DOM nodes (already capped to top-N)
    //   opts.pageSize  : rows per page (default 10)
    //   opts.counterEl : the "1-10 of 20" <span> (optional)
    //   opts.prevBtn   : previous-page <button> (optional)
    //   opts.nextBtn   : next-page <button> (optional)
    // Returns { rerender } so callers can force a redraw. Wires the buttons so
    // the top-right next chevron flips to the second view, per the spec.
    paginate: function (opts) {
      opts = opts || {};
      var rows = opts.rows || [];
      var container = opts.container;
      var pageSize = opts.pageSize > 0 ? opts.pageSize : 10;
      var counterEl = opts.counterEl || null;
      var prevBtn = opts.prevBtn || null;
      var nextBtn = opts.nextBtn || null;
      var total = rows.length;
      var pages = Math.max(1, Math.ceil(total / pageSize));
      var page = 0;
      var rendered = [];

      function setDisabled(btn, off) {
        if (!btn) return;
        if (off) { btn.setAttribute('disabled', ''); btn.disabled = true; }
        else { btn.removeAttribute('disabled'); btn.disabled = false; }
      }

      function render() {
        // detach the previously shown page's rows (leave header + anything else)
        for (var i = 0; i < rendered.length; i++) {
          if (rendered[i] && rendered[i].parentNode === container) {
            container.removeChild(rendered[i]);
          }
        }
        rendered = [];
        var start = page * pageSize;
        var end = Math.min(total, start + pageSize);
        for (var j = start; j < end; j++) {
          if (rows[j]) { container.appendChild(rows[j]); rendered.push(rows[j]); }
        }
        if (counterEl) {
          counterEl.textContent = total > 0
            ? ((start + 1) + '-' + end + ' of ' + total)
            : '0 of 0';
        }
        setDisabled(prevBtn, page <= 0);
        setDisabled(nextBtn, page >= pages - 1);
      }

      if (prevBtn) {
        prevBtn.addEventListener('click', function () {
          if (page > 0) { page--; render(); }
        });
      }
      if (nextBtn) {
        nextBtn.addEventListener('click', function () {
          if (page < pages - 1) { page++; render(); }
        });
      }
      render();
      return { rerender: render };
    },
  };
})();
