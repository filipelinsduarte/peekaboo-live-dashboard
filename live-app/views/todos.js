/*
 * todos.js — "To-do's" (AI Visibility Action Plan) view.
 *
 * Pixel-exact port of the todos section of ~/Desktop/ai-monitoring-dashboard-v4.html
 * (#view-ai-todos + aimGenerateTodos / aimRenderTodosTable / aimOpenTodoDetail and
 * friends) for the live SPA.
 *
 * Adaptations from the source file:
 *   - Data comes from PB.api.snapshot() + PB.api.prompts() instead of
 *     window._AIM_SNAPSHOT. normalizeSnapshot() maps the live API payloads onto
 *     the snapshot shape the v4 generator expects.
 *   - All CSS the view needs is injected once, scoped under .pb-todos-scope
 *     (plus the body-attached chrome: floating bar, inline popover, toast).
 *   - All state lives inside this closure. Only the handler functions that the
 *     ported inline onclick="" attributes reference are exposed on window.
 *   - localStorage keys are namespaced per brand: pb_td_added_<brandId> etc.
 *
 * Pure logic (snapshot normalization + todo generation) is exposed as
 * window.PBTodosLogic so it can be unit-tested with node
 * (tests/todos.logic.test.mjs), same pattern as PBTopbarLogic.
 */
(function () {
  'use strict';
  if (!window.PB) return;
  var PB = window.PB;

  // ── CSS injection ──────────────────────────────────────────────────────────
  // Extracted verbatim from ai-monitoring-dashboard-v4.html, scoped under
  // .pb-todos-scope. Body-attached chrome (#aim-td-floating-bar,
  // #aim-inline-pop, .aim-td-toast) gets the design tokens directly because it
  // lives outside the scope element.
  function injectTodosCSS() {
    if (document.getElementById('pb-todos-css')) return;
    var s = document.createElement('style');
    s.id = 'pb-todos-css';
    s.textContent = `
/* === tokens (v4 :root) === */
.pb-todos-scope, #aim-td-floating-bar, #aim-inline-pop, .aim-td-toast {
  --bg:              #ffffff;
  --surface:         #ffffff;
  --surface-alt:     #fafafa;
  --surface-hover:   #f4f4f5;
  --border:          #EEEEEF;
  --border-light:    rgba(0,0,0,0.05);
  --text:            #1c1917;
  --text-muted:      #545D6C;
  --text-faint:      #9CA3AF;
  --accent:          #b352b3;
  --accent-hover:    #a043a0;
  --accent-light:    rgba(179,82,179,0.08);
  --accent-30:       rgba(179,82,179,0.3);
  --brand-pink:      #f8c8ff;
  --brand-yellow:    #ffcc45;
  --success:         #10b981;
  --success-light:   #dcfce7;
  --danger:          #ef4444;
  --danger-light:    #fee2e2;
  --warning:         #f59e0b;
  --radius:          10px;
  --radius-lg:       14px;
  --radius-pill:     9999px;
  --shadow:          0 1px 2px rgba(0,0,0,0.05);
  --shadow-md:       0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1);
  --shadow-lg:       0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.05);
  --font:            'Inter', ui-sans-serif, system-ui, sans-serif;
}
.pb-todos-scope {
  font-family: var(--font);
  font-size: 14px;
  line-height: 1.5;
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
/* the shell pads #view by default; the v4 layout pads via .page-content instead */
#view.pb-todos-scope { padding: 0; }
.pb-todos-scope *, .pb-todos-scope *::before, .pb-todos-scope *::after { box-sizing: border-box; }
.pb-todos-scope a { color: var(--accent); text-decoration: none; }
.pb-todos-scope a:hover { text-decoration: underline; }

/* ── Page / cards ── */
.pb-todos-scope .page-content { padding: 24px 28px; }
.pb-todos-scope .card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  margin-bottom: 16px;
}
.pb-todos-scope .card-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light);
}
.pb-todos-scope .card-title { font-size: 13px; font-weight: 600; }
.pb-todos-scope .card-desc { font-size: 11px; color: var(--text-muted); margin-top: 1px; }
.pb-todos-scope .card-body { padding: 16px; }

/* ── Custom selects ── */
.pb-todos-scope .ct-custom-select { position: relative; min-width: 120px; }
.pb-todos-scope .ct-custom-trigger {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 0 12px; height: 36px;
  font-family: var(--font); font-size: 13px; font-weight: 400; color: var(--text);
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  cursor: pointer; outline: none;
  transition: background .12s, border-color .12s; text-align: left;
}
.pb-todos-scope .ct-custom-trigger:hover { background: #f5f5f5; }
.pb-todos-scope .ct-custom-select.open .ct-custom-trigger { background: #f5f5f5; border-color: #d4d4d4; }
.pb-todos-scope .ct-trigger-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pb-todos-scope .ct-custom-dropdown {
  display: none; position: fixed;
  min-width: 160px; max-height: 240px; overflow-y: auto;
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  box-shadow: rgba(0,0,0,.1) 0px 4px 6px -1px, rgba(0,0,0,.1) 0px 2px 4px -2px;
  z-index: 1200; padding: 4px;
}
.pb-todos-scope .ct-custom-select.open .ct-custom-dropdown { display: block; }
.pb-todos-scope .ct-custom-option {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; font-size: 13px; color: var(--text);
  border-radius: 6px; cursor: pointer; transition: background .1s;
  min-height: 32px;
}
.pb-todos-scope .ct-custom-option:hover { background: #f5f5f5; }
.pb-todos-scope .ct-custom-option.selected { font-weight: 500; background: rgba(245,245,245,0.6); color: var(--text); }
.pb-todos-scope .ct-custom-option.selected::after { content: ''; }

/* ── Tab bar ── */
.pb-todos-scope .aim-tab-bar {
  display: flex; align-items: center;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  padding: 3px; gap: 2px;
  width: fit-content; margin-bottom: 14px;
}
.pb-todos-scope .aim-tab {
  padding: 5px 14px;
  font-size: 12px; font-weight: 500;
  color: var(--text-muted);
  border-radius: var(--radius-pill); cursor: pointer;
  border: none; background: none;
  font-family: var(--font); transition: all .12s;
}
.pb-todos-scope .aim-tab.active {
  background: var(--surface); color: var(--text);
  box-shadow: 0 1px 2px rgba(0,0,0,0.06); font-weight: 600;
}
.pb-todos-scope .aim-tab:hover:not(.active) { color: var(--text); }

/* ── Full-width table ── */
.pb-todos-scope .aim-table-wrap { overflow-x: auto; }
.pb-todos-scope .aim-full-table { width: 100%; font-size: 12px; border-collapse: collapse; }
.pb-todos-scope .aim-full-table th {
  font-size: 10px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .06em;
  color: var(--text-faint); padding: 8px 18px;
  border-bottom: 1px solid var(--border);
  text-align: center; background: var(--surface-alt);
  white-space: nowrap; cursor: pointer; user-select: none;
}
.pb-todos-scope .aim-full-table th:hover { color: var(--text-muted); }
.pb-todos-scope .aim-full-table td {
  padding: 10px 18px;
  border-bottom: 1px solid var(--border-light);
  vertical-align: middle; text-align: center;
}
.pb-todos-scope .aim-full-table th.col-left, .pb-todos-scope .aim-full-table td.col-left { text-align: left; }
.pb-todos-scope .aim-full-table tr:last-child td { border-bottom: none; }
.pb-todos-scope .aim-full-table tr:hover td { background: var(--surface-alt); }

/* ── Badges ── */
.pb-todos-scope .aim-intent-badge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; font-weight: 600;
  padding: 2px 7px; border-radius: 4px;
  background: #fff; border: 1px solid #e5e7eb; color: #374151;
}
.pb-todos-scope .aim-intent-badge::before { content: '\\25CF'; font-size: 7px; line-height: 1; }
.pb-todos-scope .aim-intent-badge.informational::before  { color: #2563eb; }
.pb-todos-scope .aim-intent-badge.commercial::before     { color: #b352b3; }
.pb-todos-scope .aim-intent-badge.transactional::before  { color: #059669; }
.pb-todos-scope .aim-intent-badge.navigational::before   { color: #d97706; }
.pb-todos-scope .aim-intent-badge.priority-high::before   { color: #dc2626; }
.pb-todos-scope .aim-intent-badge.priority-medium::before { color: #d97706; }

/* ── Source page-type badge (examples list) ── */
.pb-todos-scope .aim-source-type-badge {
  display: inline-flex; align-items: center;
  font-size: 10px; font-weight: 600;
  padding: 2px 7px; border-radius: 4px;
  text-transform: uppercase; letter-spacing: .04em;
}
.pb-todos-scope .aim-source-type-badge.ugc        { background: #ecfeff; color: #0e7490; }
.pb-todos-scope .aim-source-type-badge.reference  { background: rgba(248,200,255,.3); color: #b352b3; }
.pb-todos-scope .aim-source-type-badge.competitor { background: #fee2e2; color: #b91c1c; }
.pb-todos-scope .aim-source-type-badge.corporate  { background: #fff7ed; color: #c2410c; }
.pb-todos-scope .aim-source-type-badge.editorial  { background: #eff6ff; color: #1d4ed8; }
.pb-todos-scope .aim-source-type-badge.institutional { background: #f0fdf4; color: #15803d; }
.pb-todos-scope .aim-source-type-badge.other      { background: var(--surface-alt); color: var(--text-muted); }
.pb-todos-scope .aim-source-type-badge.article    { background: var(--surface-alt); color: var(--text-muted); }
.pb-todos-scope .aim-source-type-badge.listicle   { background: #ecfdf5; color: #065f46; }
.pb-todos-scope .aim-source-type-badge.guide      { background: #f0f9ff; color: #0369a1; }
.pb-todos-scope .aim-source-type-badge.review     { background: #fef9c3; color: #92400e; }
.pb-todos-scope .aim-source-type-badge.blog-post  { background: rgba(248,200,255,.3); color: #b352b3; }
.pb-todos-scope .aim-source-type-badge.category-page { background: #fce7f3; color: #9d174d; }
.pb-todos-scope .aim-source-type-badge.product-page  { background: #f0fdf4; color: #15803d; }
.pb-todos-scope .aim-source-type-badge.forum-thread { background: #ecfeff; color: #0e7490; }
.pb-todos-scope .aim-source-type-badge.news-article { background: #eff6ff; color: #1d4ed8; }
.pb-todos-scope .aim-source-type-badge.home-page  { background: var(--surface-alt); color: var(--text-muted); }

/* ── Detail back button ── */
.pb-todos-scope .aim-pd-back {
  display: flex; align-items: center; gap: 6px; padding: 6px 0 14px;
  font-size: 13px; font-weight: 500; color: var(--text-muted);
  cursor: pointer; background: none; border: none;
  font-family: var(--font); transition: color .12s;
}
.pb-todos-scope .aim-pd-back:hover { color: var(--accent); }
.pb-todos-scope .aim-pd-back:hover svg { transform: translateX(-2px); }
.pb-todos-scope .aim-pd-back svg { transition: transform .12s; }

/* ── Floating bar (body-attached) ── */
@keyframes pbTdSlideUp {
  from { transform: translateX(-50%) translateY(20px); opacity: 0; }
  to   { transform: translateX(-50%) translateY(0); opacity: 1; }
}
#aim-td-floating-bar {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: var(--radius-lg);
  box-shadow: 0 4px 24px rgba(0,0,0,.1), 0 1px 4px rgba(0,0,0,.05);
  padding: 8px; display: flex; align-items: center; gap: 4px;
  z-index: 200; animation: pbTdSlideUp .2s ease;
  font-family: var(--font);
}
#aim-td-floating-bar .aim-floating-bar-count {
  padding: 4px 12px; font-size: 12px; font-weight: 700; color: var(--text);
  border-right: 1px solid #e5e7eb; margin-right: 4px;
}
#aim-td-floating-bar .aim-floating-bar-count span { font-weight: 400; color: var(--text-muted); }
#aim-td-floating-bar .aim-floating-action {
  height: 30px; padding: 0 12px;
  border-radius: var(--radius); font-size: 12px; font-weight: 600;
  cursor: pointer; border: 1px solid #e5e7eb;
  font-family: var(--font); transition: all .12s;
}
#aim-td-floating-bar .aim-floating-action.default { background: #f4f4f5; color: var(--text-muted); }
#aim-td-floating-bar .aim-floating-action.default:hover { background: #e5e7eb; color: var(--text); }
#aim-td-floating-bar .aim-floating-action.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
#aim-td-floating-bar .aim-floating-action.primary:hover { opacity: .88; }

/* ── To-do's (AI Visibility Actions) ── */
.pb-todos-scope .aim-td-empty { padding: 40px; text-align: center; color: var(--text-faint); font-size: 13px; }
/* page-type badge — uses aim-intent-badge base + modifier dot color */
.pb-todos-scope .aim-intent-badge.on-page  { white-space: nowrap; }
.pb-todos-scope .aim-intent-badge.off-page { white-space: nowrap; }
.pb-todos-scope .aim-intent-badge.on-page::before  { color: #2563eb; }
.pb-todos-scope .aim-intent-badge.off-page::before { color: #059669; }
/* rectype badge — uses aim-intent-badge base + modifier dot color */
.pb-todos-scope .aim-intent-badge.type-content::before       { color: #2563eb; }
.pb-todos-scope .aim-intent-badge.type-social-media::before  { color: #7c3aed; }
.pb-todos-scope .aim-intent-badge.type-reddit::before        { color: #c2410c; }
.pb-todos-scope .aim-intent-badge.type-youtube::before       { color: #b91c1c; }
.pb-todos-scope .aim-intent-badge.type-backlinks::before     { color: #15803d; }
.pb-todos-scope .aim-intent-badge.type-crawlability::before  { color: #b45309; }
.pb-todos-scope .aim-intent-badge.type-technical-seo::before { color: #6b7280; }
/* all type- badges use inline icons instead of ::before dot */
.pb-todos-scope .aim-intent-badge.type-content::before,
.pb-todos-scope .aim-intent-badge.type-social-media::before,
.pb-todos-scope .aim-intent-badge.type-backlinks::before,
.pb-todos-scope .aim-intent-badge.type-crawlability::before,
.pb-todos-scope .aim-intent-badge.type-technical-seo::before,
.pb-todos-scope .aim-intent-badge.type-reddit::before,
.pb-todos-scope .aim-intent-badge.type-youtube::before { content: none; }
/* AI engine avatars in table */
.pb-todos-scope .aim-td-engines { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; }
.pb-todos-scope .aim-td-engine-ico { width: 15px; height: 15px; border-radius: 3px; object-fit: contain; border: 1px solid var(--border-light); }
/* signal item — plain text, no box */
.pb-todos-scope .aim-td-sig-item { font-size: 12.5px; color: var(--text); line-height: 1.6; display: flex; align-items: flex-start; gap: 6px; }
.pb-todos-scope .aim-td-sig-item-text { flex: 1; min-width: 0; }
.pb-todos-scope .aim-td-sig-expand-btn { background: none; border: none; cursor: pointer; padding: 0 4px 0 0; font-size: 10px; color: var(--text-faint); flex-shrink: 0; display: inline-flex; align-items: center; font-family: var(--font); transition: color .12s; }
.pb-todos-scope .aim-td-sig-expand-btn:hover { color: var(--text-muted); }
.pb-todos-scope .aim-td-sig-expand-btn .aim-chev { display: inline-block; transition: transform .18s; font-size: 9px; line-height: 1; }
/* action buttons in detail */
.pb-todos-scope .aim-td-action-btn { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 600; padding: 6px 14px; border-radius: 7px; border: 1px solid var(--border); background: var(--surface); color: var(--text-muted); cursor: pointer; font-family: var(--font); transition: background .12s, color .12s; }
.pb-todos-scope .aim-td-action-btn:hover { background: #f9fafb; color: #111827; }
.pb-todos-scope .aim-td-action-btn.done { background: #f0fdf4; border-color: #bbf7d0; color: #15803d; }
.pb-todos-scope .aim-td-action-btn.added { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }
.pb-todos-scope .aim-td-action-btn.archived { background: #fff7ed; border-color: #fed7aa; color: #c2410c; }
/* inline reassign popover (body-attached) */
#aim-inline-pop { position: fixed; background: #fff; border: 1px solid #e4e4e7; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.1); padding: 4px; z-index: 9000; min-width: 130px; display: none; font-family: var(--font); }
#aim-inline-pop button { display: block; width: 100%; text-align: left; padding: 6px 10px; font-size: 12px; font-weight: 500; color: var(--text); background: none; border: none; border-radius: 5px; cursor: pointer; font-family: var(--font); white-space: nowrap; }
#aim-inline-pop button:hover { background: #f4f4f5; }
#aim-inline-pop button.active { background: #eff6ff; color: #1d4ed8; font-weight: 600; }
#aim-inline-pop .aim-pop-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--text-faint); padding: 4px 10px 2px; }
/* todo toast notification (body-attached) */
.aim-td-toast { position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%) translateY(8px); background: #1a1a1a; color: #fff; font-size: 12px; font-weight: 500; padding: 8px 16px 8px 12px; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.18); display: flex; align-items: center; gap: 7px; z-index: 9999; opacity: 0; transition: opacity .18s, transform .18s; pointer-events: none; font-family: var(--font); white-space: nowrap; }
.aim-td-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.aim-td-toast svg { flex-shrink: 0; }
/* completed row */
.pb-todos-scope tr.aim-td-row-done td { opacity: .45; }
.pb-todos-scope tr.aim-td-row-done td:first-child { opacity: 1; }
/* todo filter triggers — match toggle height */
.pb-todos-scope #aim-td-list .ct-custom-trigger { height: 28px; font-size: 11.5px; padding: 0 9px; }
/* styled tooltip wrapper */
.pb-todos-scope .aim-td-tip { position: relative; display: inline-flex; }
.pb-todos-scope .aim-td-tip::after { content: attr(data-tip); position: absolute; bottom: calc(100% + 5px); left: 50%; transform: translateX(-50%); background: #fff; border: 1px solid #e4e4e7; border-radius: 6px; padding: 4px 9px; font-size: 11px; font-weight: 400; color: #374151; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,.1); z-index: 300; pointer-events: none; opacity: 0; transition: opacity .12s; }
.pb-todos-scope .aim-td-tip:hover::after { opacity: 1; }
/* step num */
.pb-todos-scope .aim-td-sn1 { background: #eef2ff; color: #4338ca; }
.pb-todos-scope .aim-td-sn2 { background: #eff6ff; color: #1d4ed8; }
.pb-todos-scope .aim-td-sn3 { background: #f5f3ff; color: #6d28d9; }
.pb-todos-scope .aim-td-sn4 { background: #ecfdf5; color: #065f46; }
.pb-todos-scope .aim-td-sn0 { background: #eef2ff; color: #4338ca; }
.pb-todos-scope .aim-td-sn-step { background: #374151; color: #fff; }
.pb-todos-scope .aim-td-step-num { width: 20px; height: 20px; border-radius: 50%; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
`;
    document.head.appendChild(s);
  }

  // ── Constants (from source file) ──────────────────────────────────────────
  var AIM_PROVIDER_KEYS = { chatgpt: 'chatgpt', gemini: 'gemini', perplexity: 'perplexity', 'google-aio': 'googleaio', 'google-aim': 'googleaimode' };

  var _aimTdPriColors = {
    'high':   { bg: '#fee2e2', color: '#b91c1c', label: 'High' },
    'medium': { bg: '#fef9c3', color: '#854d0e', label: 'Medium' }
  };
  var _aimTdTypeLabels = {
    'content':       'Content',
    'social-media':  'Social Media',
    'reddit':        'Reddit',
    'youtube':       'YouTube',
    'backlinks':     'Backlinks',
    'crawlability':  'Crawlability',
    'technical-seo': 'Technical SEO'
  };
  var _aimTypeTooltips = {
    'content':       'Create or optimize pages and blog posts',
    'social-media':  'Build presence on social platforms',
    'reddit':        'Engage in relevant Reddit communities',
    'youtube':       'Create video content for YouTube',
    'backlinks':     'Earn links from external websites',
    'crawlability':  'Help AI engines find and index your content',
    'technical-seo': 'Fix technical issues affecting AI discoverability'
  };
  var _aimTypeIconMap = {
    'content':       '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    'social-media':  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
    'backlinks':     '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    'crawlability':  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    'technical-seo': '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    'reddit':        '<img src="https://www.google.com/s2/favicons?domain=reddit.com&sz=32" style="width:11px;height:11px;border-radius:2px;flex-shrink:0;" onerror="this.style.display=\'none\'">',
    'youtube':       '<img src="https://www.google.com/s2/favicons?domain=youtube.com&sz=32" style="width:11px;height:11px;border-radius:2px;flex-shrink:0;" onerror="this.style.display=\'none\'">'
  };
  function aimTypeIcon(recType) {
    return _aimTypeIconMap[recType] || '';
  }
  var _aimProvLabels = { chatgpt: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity', googleaio: 'Google AIO', googleaimode: 'Google AI Mode' };
  var _aimProvDomains = { chatgpt: 'openai.com', gemini: 'gemini.google.com', perplexity: 'perplexity.ai', googleaio: 'google.com', googleaimode: 'google.com' };

  // ── State (closure-level; reset each time the view loads) ─────────────────
  var _aimTodosView = 'suggested'; // 'suggested' | 'todo' | 'archive'
  var _aimTodosPriFilter = 'all';
  var _aimTodosTypeFilter = 'all';
  var _aimTodosPageFilter = 'all';
  var _aimTodosEffortFilter = 'all';
  var _aimTodosSortField = 'priority';
  var _aimTodosSortDir = 'desc';
  var _aimTodosData = null;
  var _aimTodosCompleted = new Set();
  var _aimTodosAdded = new Set();
  var _aimTodosArchived = new Set();
  var _aimCheckedTodos = new Set();
  // per-brand localStorage keys (set in the view init)
  var _lsAdded = 'pb_td_added_default';
  var _lsCompleted = 'pb_td_completed_default';
  var _lsArchived = 'pb_td_archived_default';
  var _lsNotesPrefix = 'pb_td_notes_default_';
  // context from PB.state at render time
  var _aimFilterModelKey = null;   // provider key from the topbar model filter, or null
  var _periodRange = '30d';
  var _snapNorm = null;            // normalized snapshot (source-file shape)
  var _aimExtUrlCache = null;

  function _loadSet(key) {
    try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch (e) { return new Set(); }
  }
  function _saveSet(key, set) {
    try { localStorage.setItem(key, JSON.stringify([...set])); } catch (e) { /* quota / private mode */ }
  }

  // ── Small helpers (ported verbatim) ───────────────────────────────────────
  function aimEscHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function openCustomSelect(id) {
    var wrap = document.getElementById(id);
    if (!wrap) return;
    var isOpen = wrap.classList.contains('open');
    document.querySelectorAll('.ct-custom-select.open').forEach(function (el) { el.classList.remove('open'); });
    if (!isOpen) {
      wrap.classList.add('open');
      var trigger = wrap.querySelector('.ct-custom-trigger');
      var dd = wrap.querySelector('.ct-custom-dropdown');
      if (trigger && dd) {
        var r = trigger.getBoundingClientRect();
        dd.style.top = (r.bottom + 4) + 'px';
        dd.style.left = r.left + 'px';
        dd.style.minWidth = Math.max(160, r.width) + 'px';
      }
    }
  }

  function aimGetUrlPageType(url, domain) {
    var raw = (url || '').toLowerCase();
    var path = raw.replace(/^https?:\/\/[^\/]+/, '') || '/';
    var host = (domain || raw.replace(/^https?:\/\/([^\/]+).*/, '$1')).toLowerCase().replace(/^www\./, '');

    if (['reddit.com', 'quora.com', 'stackoverflow.com', 'news.ycombinator.com'].some(function (d) { return host.includes(d); })) return 'Forum Thread';
    if (path === '/' || path === '' || /^\/index\.(html?|php)$/.test(path)) return 'Home Page';
    if (/\/review|\/reviews|\/comparison|\/compare|versus|\/vs[-\/]|alternatives|\/vs\b/i.test(path)) return 'Review';
    if (/\/products?\/|\/pricing\/?$|\/solutions?\/|\/features\/?$/i.test(path)) return 'Product Page';
    if (/\/categor(?:y|ies)\/|\/software\/|\/tools\/|\/apps?\//i.test(path)) return 'Category Page';
    if (/best[-_\s]|\/top-\d|\/top\d|\d+-best|\d+-top|\/ranking|\/list-of/i.test(path)) return 'Listicle';
    if (/how[-_\s]to|\/guide\/|\/guides\/|\/tutorial|\/learn\/|\/training\/|\/tips[-\/]/i.test(path)) return 'Guide';
    if (/\/blog\/|\/insights?\/|\/resources?\/|\/posts?\/|\/articles?\/|^blog\./i.test(path + host.replace(/[^.]+\.[^.]+$/, ''))) return 'Blog Post';
    if (/\/20\d{2}\/\d{2}\//.test(path)) return 'News Article';
    var newsHosts = ['techcrunch.com', 'searchengineland.com', 'martech.org', 'digiday.com', 'theverge.com', 'wired.com', 'venturebeat.com', 'forbes.com', 'businessinsider.com'];
    if (newsHosts.some(function (h) { return host.includes(h); })) return 'News Article';
    return 'Article';
  }

  var _aimToastTimer = null;
  function aimShowToast(msg) {
    var el = document.getElementById('aim-td-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'aim-td-toast';
      el.className = 'aim-td-toast';
      document.body.appendChild(el);
    }
    el.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>' + msg;
    el.classList.add('show');
    clearTimeout(_aimToastTimer);
    _aimToastTimer = setTimeout(function () { el.classList.remove('show'); }, 2400);
  }

  // ── Inline popover (priority reassign) ─────────────────────────────────────
  var _aimInlinePopCb = null;
  var _aimInlinePopClose = null;
  function aimInlinePopSelect(val) {
    var pop = document.getElementById('aim-inline-pop');
    if (pop) pop.style.display = 'none';
    if (_aimInlinePopClose) { document.removeEventListener('click', _aimInlinePopClose, true); _aimInlinePopClose = null; }
    if (_aimInlinePopCb) { var cb = _aimInlinePopCb; _aimInlinePopCb = null; cb(val); }
  }
  function aimShowInlinePop(el, options, currentVal, cb) {
    _aimInlinePopCb = cb;
    var pop = document.getElementById('aim-inline-pop');
    if (!pop) return;
    if (_aimInlinePopClose) { pop.style.display = 'none'; document.removeEventListener('click', _aimInlinePopClose, true); _aimInlinePopClose = null; }
    var rect = el.getBoundingClientRect();
    pop.innerHTML = '<div class="aim-pop-label">' + (options.label || '') + '</div>' +
      options.items.map(function (o) {
        var sv = String(o.value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return '<button class="' + (o.value === currentVal ? 'active' : '') + '" onclick="aimInlinePopSelect(\'' + sv + '\')">' + o.label + '</button>';
      }).join('');
    pop.style.display = 'block';
    pop.style.top = (rect.bottom + 4) + 'px';
    pop.style.left = rect.left + 'px';
    var pw = pop.offsetWidth || 140;
    if (rect.left + pw > window.innerWidth - 8) pop.style.left = (window.innerWidth - pw - 8) + 'px';
    var close = function (e) {
      if (!pop.contains(e.target) && e.target !== el && !el.contains(e.target)) {
        pop.style.display = 'none';
        _aimInlinePopCb = null;
        document.removeEventListener('click', close, true);
        _aimInlinePopClose = null;
      }
    };
    _aimInlinePopClose = close;
    setTimeout(function () { document.addEventListener('click', close, true); }, 0);
  }

  function aimTdSetPriority(id, val) {
    if (!_aimTodosData) return;
    var t = _aimTodosData.find(function (x) { return x.id === id; });
    if (t) { t.priority = val; aimRenderTodosTable(); }
  }
  function aimTdPriPop(el, id) {
    var t = _aimTodosData ? _aimTodosData.find(function (x) { return x.id === id; }) : null;
    aimShowInlinePop(el, { label: 'Priority', items: [{ value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }] }, t ? t.priority : null, function (v) { aimTdSetPriority(id, v); });
  }

  function aimTdToggleExpand(btn) {
    var panel = btn.parentElement ? btn.parentElement.nextElementSibling : null;
    if (!panel) return;
    var open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : '';
    var chev = btn.querySelector('.aim-chev');
    if (chev) chev.style.transform = open ? '' : 'rotate(90deg)';
  }

  // ── Filters / sorting / tabs (ported verbatim) ─────────────────────────────
  function aimSetTodoPriFilter(v, label) {
    _aimTodosPriFilter = v;
    var sa = document.getElementById('aim-td-select-all'); if (sa) sa.checked = false;
    var lbl = document.getElementById('aim-td-pri-label'); if (lbl && label) lbl.textContent = label;
    var sel = document.getElementById('aim-td-pri-sel');
    if (sel) { sel.querySelectorAll('.ct-custom-option').forEach(function (o) { o.classList.toggle('selected', o.getAttribute('onclick').indexOf("'" + v + "'") > -1); }); sel.classList.remove('open'); }
    aimRenderTodosTable();
  }
  function aimSetTodoTypeFilter(v, label) {
    _aimTodosTypeFilter = v;
    var sa = document.getElementById('aim-td-select-all'); if (sa) sa.checked = false;
    var lbl = document.getElementById('aim-td-type-label'); if (lbl && label) lbl.textContent = label;
    var sel = document.getElementById('aim-td-type-sel');
    if (sel) { sel.querySelectorAll('.ct-custom-option').forEach(function (o) { o.classList.toggle('selected', o.getAttribute('onclick').indexOf("'" + v + "'") > -1); }); sel.classList.remove('open'); }
    aimRenderTodosTable();
  }
  function aimSetTodoPageFilter(v, label) {
    _aimTodosPageFilter = v;
    var sa = document.getElementById('aim-td-select-all'); if (sa) sa.checked = false;
    var lbl = document.getElementById('aim-td-page-label'); if (lbl && label) lbl.textContent = label;
    var sel = document.getElementById('aim-td-page-sel');
    if (sel) { sel.querySelectorAll('.ct-custom-option').forEach(function (o) { o.classList.toggle('selected', o.getAttribute('onclick').indexOf("'" + v + "'") > -1); }); sel.classList.remove('open'); }
    aimRenderTodosTable();
  }
  function aimSetTodoEffortFilter(v, label) {
    _aimTodosEffortFilter = v;
    var sa = document.getElementById('aim-td-select-all'); if (sa) sa.checked = false;
    var lbl = document.getElementById('aim-td-eff-label'); if (lbl && label) lbl.textContent = label;
    var sel = document.getElementById('aim-td-eff-sel');
    if (sel) { sel.querySelectorAll('.ct-custom-option').forEach(function (o) { o.classList.toggle('selected', o.getAttribute('onclick').indexOf("'" + v + "'") > -1); }); sel.classList.remove('open'); }
    aimRenderTodosTable();
  }
  function aimSortTodos(field) {
    if (_aimTodosSortField === field) _aimTodosSortDir = _aimTodosSortDir === 'asc' ? 'desc' : 'asc';
    else { _aimTodosSortField = field; _aimTodosSortDir = 'desc'; }
    ['aim-tds-rec', 'aim-tds-pri', 'aim-tds-page', 'aim-tds-type', 'aim-tds-eff'].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.textContent = '';
    });
    var idMap = { rec: 'aim-tds-rec', priority: 'aim-tds-pri', pageType: 'aim-tds-page', recType: 'aim-tds-type', effort: 'aim-tds-eff' };
    var el = document.getElementById(idMap[field]);
    if (el) el.textContent = _aimTodosSortDir === 'asc' ? ' ↑' : ' ↓';
    aimRenderTodosTable();
  }
  function aimSetTodosView(v) {
    _aimTodosView = v;
    var bar = document.querySelector('#aim-td-list .aim-tab-bar');
    if (bar) bar.querySelectorAll('.aim-tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.view === v);
    });
    var sa = document.getElementById('aim-td-select-all'); if (sa) sa.checked = false;
    _aimCheckedTodos.clear();
    aimCloseTodoDetail();
    aimRenderTodosTable();
    aimUpdateTodosFloatingBar();
  }
  function aimUpdateTodoTabCounts() {
    var all = _aimTodosData || [];
    var sugCnt = all.filter(function (t) { return !_aimTodosAdded.has(t.id) && !_aimTodosCompleted.has(t.id) && !_aimTodosArchived.has(t.id); }).length;
    var todoCnt = all.filter(function (t) { return _aimTodosAdded.has(t.id) && !_aimTodosCompleted.has(t.id) && !_aimTodosArchived.has(t.id); }).length;
    var archCnt = all.filter(function (t) { return _aimTodosCompleted.has(t.id) || _aimTodosArchived.has(t.id); }).length;
    var s = document.getElementById('aim-td-cnt-suggested'); if (s) s.textContent = sugCnt > 0 ? '(' + sugCnt + ')' : '';
    var td = document.getElementById('aim-td-cnt-todo'); if (td) td.textContent = todoCnt > 0 ? '(' + todoCnt + ')' : '';
    var ar = document.getElementById('aim-td-cnt-archive'); if (ar) ar.textContent = archCnt > 0 ? '(' + archCnt + ')' : '';
  }
  function aimMarkTodoComplete(id, btn) {
    if (_aimTodosCompleted.has(id)) {
      _aimTodosCompleted.delete(id);
    } else {
      _aimTodosCompleted.add(id);
      _aimTodosArchived.delete(id);
      _saveSet(_lsArchived, _aimTodosArchived);
    }
    _saveSet(_lsCompleted, _aimTodosCompleted);
    aimShowToast(_aimTodosCompleted.has(id) ? 'Marked as complete' : 'Unmarked as complete');
    aimUpdateTodoTabCounts();
    aimRenderTodosTable();
    aimOpenTodoDetail(id);
  }
  function aimToggleTodoAdded(id) {
    if (_aimTodosAdded.has(id)) {
      _aimTodosAdded.delete(id);
    } else {
      _aimTodosAdded.add(id);
    }
    _saveSet(_lsAdded, _aimTodosAdded);
    aimShowToast(_aimTodosAdded.has(id) ? 'Added to To-do' : 'Removed from To-do');
    aimUpdateTodoTabCounts();
    aimRenderTodosTable();
    aimOpenTodoDetail(id);
  }
  function aimArchiveTodo(id) {
    if (_aimTodosArchived.has(id)) {
      _aimTodosArchived.delete(id);
    } else {
      _aimTodosArchived.add(id);
      _aimTodosCompleted.delete(id);
      _saveSet(_lsCompleted, _aimTodosCompleted);
    }
    _saveSet(_lsArchived, _aimTodosArchived);
    aimShowToast(_aimTodosArchived.has(id) ? 'Added to Archive' : 'Removed from Archive');
    aimUpdateTodoTabCounts();
    aimRenderTodosTable();
    aimOpenTodoDetail(id);
  }

  function aimTdToggleCheck(id, checked) {
    if (checked) _aimCheckedTodos.add(id);
    else _aimCheckedTodos.delete(id);
    aimUpdateTodosFloatingBar();
  }

  function aimUpdateTodosFloatingBar() {
    var bar = document.getElementById('aim-td-floating-bar');
    if (!bar) return;
    var count = _aimCheckedTodos.size;
    bar.style.display = count > 0 ? 'flex' : 'none';
    var countEl = document.getElementById('aim-td-fb-count');
    if (countEl) countEl.innerHTML = count + ' <span>selected</span>';
    var actEl = document.getElementById('aim-td-fb-actions');
    if (!actEl) return;
    actEl.innerHTML =
      '<button class="aim-floating-action default" onclick="aimTdBulkClear()">Clear</button>' +
      '<button class="aim-floating-action default" onclick="aimTdBulkAction(\'todo\')">To-do</button>' +
      '<button class="aim-floating-action default" onclick="aimTdBulkAction(\'archive\')">Archive</button>' +
      '<button class="aim-floating-action primary" onclick="aimTdBulkAction(\'complete\')">Complete</button>';
  }

  function aimTdBulkClear() {
    _aimCheckedTodos.clear();
    aimRenderTodosTable();
    aimUpdateTodosFloatingBar();
  }

  function aimTdBulkAction(action) {
    _aimCheckedTodos.forEach(function (id) {
      if (action === 'todo') {
        _aimTodosAdded.add(id);
      } else if (action === 'archive') {
        _aimTodosArchived.add(id); _aimTodosCompleted.delete(id);
      } else if (action === 'complete') {
        _aimTodosCompleted.add(id); _aimTodosArchived.delete(id);
      }
    });
    if (action === 'todo') _saveSet(_lsAdded, _aimTodosAdded);
    if (action === 'archive') { _saveSet(_lsArchived, _aimTodosArchived); _saveSet(_lsCompleted, _aimTodosCompleted); }
    if (action === 'complete') { _saveSet(_lsCompleted, _aimTodosCompleted); _saveSet(_lsArchived, _aimTodosArchived); }
    var label = action === 'todo' ? 'Added to To-do' : action === 'archive' ? 'Added to Archive' : 'Marked as complete';
    aimShowToast(_aimCheckedTodos.size + ' actions: ' + label);
    _aimCheckedTodos.clear();
    aimUpdateTodoTabCounts();
    aimRenderTodosTable();
    aimUpdateTodosFloatingBar();
  }

  function aimEffortBar(effort) {
    var e = (effort || '').toLowerCase();
    var lvl = e.indexOf('high') > -1 ? 3 : e.indexOf('med') > -1 ? 2 : 1;
    var col = lvl === 3 ? '#ef4444' : lvl === 2 ? '#f59e0b' : '#22c55e';
    var dim = '#e5e7eb';
    var bars = [
      '<span style="width:4px;height:6px;background:' + (lvl >= 1 ? col : dim) + ';border-radius:1px;display:inline-block;"></span>',
      '<span style="width:4px;height:10px;background:' + (lvl >= 2 ? col : dim) + ';border-radius:1px;display:inline-block;"></span>',
      '<span style="width:4px;height:14px;background:' + (lvl >= 3 ? col : dim) + ';border-radius:1px;display:inline-block;"></span>'
    ].join('');
    return '<div style="display:inline-flex;align-items:flex-end;gap:2px;height:14px;cursor:default;">' + bars + '</div>';
  }

  function aimSelectAllTodos(checked) {
    _aimCheckedTodos.clear();
    if (checked && _aimTodosData) {
      var list = _aimTodosData;
      if (_aimTodosView === 'suggested') list = list.filter(function (t) { return !_aimTodosAdded.has(t.id) && !_aimTodosCompleted.has(t.id) && !_aimTodosArchived.has(t.id); });
      else if (_aimTodosView === 'todo') list = list.filter(function (t) { return _aimTodosAdded.has(t.id) && !_aimTodosCompleted.has(t.id) && !_aimTodosArchived.has(t.id); });
      else if (_aimTodosView === 'archive') list = list.filter(function (t) { return _aimTodosCompleted.has(t.id) || _aimTodosArchived.has(t.id); });
      list.forEach(function (t) { _aimCheckedTodos.add(t.id); });
    }
    document.querySelectorAll('#aim-td-tbody .aim-td-row-check').forEach(function (cb) { cb.checked = checked; });
    aimUpdateTodosFloatingBar();
  }

  // ── Table render (ported verbatim; model filter reads PB.state) ───────────
  function aimRenderTodosTable() {
    var tbody = document.getElementById('aim-td-tbody');
    if (!tbody || !_aimTodosData) return;

    var list = _aimTodosData;

    // view filter
    if (_aimTodosView === 'suggested') {
      list = list.filter(function (t) { return !_aimTodosAdded.has(t.id) && !_aimTodosCompleted.has(t.id) && !_aimTodosArchived.has(t.id); });
    } else if (_aimTodosView === 'todo') {
      list = list.filter(function (t) { return _aimTodosAdded.has(t.id) && !_aimTodosCompleted.has(t.id) && !_aimTodosArchived.has(t.id); });
    } else if (_aimTodosView === 'archive') {
      list = list.filter(function (t) { return _aimTodosCompleted.has(t.id) || _aimTodosArchived.has(t.id); });
    }

    if (_aimTodosPriFilter !== 'all') list = list.filter(function (t) { return t.priority === _aimTodosPriFilter; });
    if (_aimTodosTypeFilter !== 'all') list = list.filter(function (t) { return t.recType === _aimTodosTypeFilter; });
    if (_aimTodosPageFilter !== 'all') list = list.filter(function (t) { return t.pageType === _aimTodosPageFilter; });
    if (_aimTodosEffortFilter !== 'all') list = list.filter(function (t) { return (t.effort || '').toLowerCase().indexOf(_aimTodosEffortFilter) > -1; });

    if (_aimFilterModelKey) {
      list = list.filter(function (t) { return !t.aiTargets || !t.aiTargets.length || t.aiTargets.indexOf(_aimFilterModelKey) > -1; });
    }

    // sort
    list = list.slice().sort(function (a, b) {
      var f = _aimTodosSortField;
      var av, bv;
      if (f === 'priority') { av = a.priority === 'high' ? 1 : 0; bv = b.priority === 'high' ? 1 : 0; }
      else if (f === 'effort') { var eRank = function (e) { return (e || '').toLowerCase().indexOf('high') > -1 ? 2 : (e || '').toLowerCase().indexOf('med') > -1 ? 1 : 0; }; av = eRank(a.effort); bv = eRank(b.effort); }
      else { av = (a[f] || ''); bv = (b[f] || ''); }
      if (typeof av === 'string') return _aimTodosSortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return _aimTodosSortDir === 'asc' ? av - bv : bv - av;
    });

    if (list.length === 0) {
      var emptyMsg = _aimTodosView === 'todo' ? 'No to-dos yet. Add actions from the Suggested tab.' :
                     _aimTodosView === 'archive' ? 'No archived actions yet.' :
                     'No actions match this filter.';
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-faint);font-size:13px;">' + emptyMsg + '</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function (a) {
      var isDone = _aimTodosCompleted.has(a.id);
      var priClass = a.priority === 'high' ? 'priority-high' : 'priority-medium';
      var priLabel = a.priority === 'high' ? 'High' : 'Medium';
      var pageLabel = a.pageType === 'on-page' ? 'On-page' : 'Off-page';
      var pageClass = a.pageType === 'on-page' ? 'on-page' : 'off-page';
      var typeLabel = _aimTdTypeLabels[a.recType] || a.recType;
      var typeTip = _aimTypeTooltips[a.recType] || '';
      var typeIconHtml = aimTypeIcon(a.recType);
      var effortLabel = (a.effort || '').toLowerCase().indexOf('high') > -1 ? 'High effort' : (a.effort || '').toLowerCase().indexOf('med') > -1 ? 'Medium effort' : 'Low effort';
      var engineHtml = (a.aiTargets || []).map(function (k) {
        var d = _aimProvDomains[k] || 'google.com';
        return '<img class="aim-td-engine-ico" src="https://www.google.com/s2/favicons?domain=' + aimEscHtml(d) + '&sz=32" title="' + aimEscHtml(_aimProvLabels[k] || k) + '" onerror="this.style.display=\'none\'">';
      }).join('');

      return '<tr onclick="aimOpenTodoDetail(\'' + aimEscHtml(a.id) + '\')" style="cursor:pointer;" class="' + (isDone ? 'aim-td-row-done' : '') + '">' +
        '<td onclick="event.stopPropagation()">' +
          '<input type="checkbox" class="aim-td-row-check" ' + (_aimCheckedTodos.has(a.id) ? 'checked' : '') + ' onchange="aimTdToggleCheck(\'' + aimEscHtml(a.id) + '\',this.checked)" style="width:13px;height:13px;cursor:pointer;accent-color:var(--accent);">' +
        '</td>' +
        '<td class="col-left">' +
          '<div style="font-size:12.5px;font-weight:600;color:var(--text);line-height:1.4;' + (isDone ? 'text-decoration:line-through;opacity:.6;' : '') + '">' + aimEscHtml(a.title) + '</div>' +
        '</td>' +
        '<td onclick="event.stopPropagation()"><span class="aim-intent-badge ' + priClass + '" style="cursor:pointer;" onclick="aimTdPriPop(this,\'' + aimEscHtml(a.id) + '\')"> ' + priLabel + '</span></td>' +
        '<td><span class="aim-intent-badge ' + pageClass + '">' + pageLabel + '</span></td>' +
        '<td><span class="aim-td-tip" data-tip="' + aimEscHtml(typeTip) + '"><span class="aim-intent-badge type-' + aimEscHtml(a.recType || '') + '">' + typeIconHtml + aimEscHtml(typeLabel) + '</span></span></td>' +
        '<td><div class="aim-td-engines">' + engineHtml + '</div></td>' +
        '<td style="text-align:center;"><span class="aim-td-tip" data-tip="' + aimEscHtml(effortLabel) + '">' + aimEffortBar(a.effort) + '</span></td>' +
      '</tr>';
    }).join('');
  }

  // ── Signal chips / step rows (ported verbatim) ─────────────────────────────
  function aimSigItemFavDomain(text) {
    if (!text) return null;
    if (/^chatgpt\b/i.test(text) || /^openai\b/i.test(text)) return 'chat.openai.com';
    if (/^gemini\b/i.test(text)) return 'gemini.google.com';
    if (/^perplexity\b/i.test(text)) return 'perplexity.ai';
    if (/^google ai\b/i.test(text) || /^googleai/i.test(text) || /^google aio/i.test(text)) return 'google.com';
    if (/^claude\b/i.test(text) || /^anthropic\b/i.test(text)) return 'claude.ai';
    if (/^bing\b/i.test(text) || /^copilot\b/i.test(text) || /^microsoft\b/i.test(text)) return 'bing.com';
    var domMatch = text.match(/^((?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})\b/);
    if (domMatch) return domMatch[1];
    return null;
  }

  // The v4 source enriches expanded prompt rows with top-brand favicons from
  // the prompt response history; that data is not in the live snapshot, so
  // this returns null and the chip renders without the favicon strip.
  function _aimGetPromptData() { return null; }
  function _aimBrandNameToDomain() { return null; }

  function aimRenderSigChip(text, favDomain, expand) {
    var hasExpand = expand && expand.items && expand.items.length;
    var resolvedFav = favDomain || aimSigItemFavDomain(text);

    var favHtml = resolvedFav
      ? '<img src="https://www.google.com/s2/favicons?domain=' + aimEscHtml(resolvedFav) + '&sz=32" style="width:14px;height:14px;border-radius:2px;flex-shrink:0;" onerror="this.style.display=\'none\'">'
      : '';

    if (!hasExpand) {
      return '<div style="display:flex;align-items:center;gap:7px;padding-left:20px;">' +
        favHtml +
        '<span style="font-size:13px;color:#374151;font-weight:600;line-height:1.6;">' + aimEscHtml(text) + '</span>' +
      '</div>';
    }

    var headHtml = expand.heading
      ? '<div style="font-size:10.5px;font-weight:700;color:var(--text-muted);margin-bottom:7px;">' + aimEscHtml(expand.heading) + '</div>'
      : '';

    var _sigFallbackIcon = '<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:#d1d5db;margin-left:5px;"></span>';

    var tableRows = expand.items.filter(Boolean).map(function (item) {
      var isObj = item && typeof item === 'object';
      var itemText = isObj ? (item.text || '') : item;
      var itemFav = aimSigItemFavDomain(itemText);
      var itemPromptId = isObj ? item.promptId : null;

      var favCell = itemFav
        ? '<td style="width:22px;padding:5px 7px 5px 0;vertical-align:middle;"><img src="https://www.google.com/s2/favicons?domain=' + aimEscHtml(itemFav) + '&sz=32" style="width:15px;height:15px;border-radius:3px;display:block;" onerror="this.style.display=\'none\'"></td>'
        : '<td style="width:22px;padding:5px 7px 5px 0;vertical-align:middle;">' + _sigFallbackIcon + '</td>';

      var brandFavsHtml = '';
      if (itemPromptId) {
        var pd = _aimGetPromptData(itemPromptId, isObj ? item.apId : null);
        if (pd && pd.topBrands && pd.topBrands.length) {
          var tipNames = pd.topBrands.slice(0, 3).join(', ');
          brandFavsHtml = '<span style="display:inline-flex;align-items:center;gap:3px;margin-right:5px;vertical-align:middle;" title="' + aimEscHtml(tipNames) + '">' +
            pd.topBrands.slice(0, 3).map(function (b) {
              var d = _aimBrandNameToDomain(b); if (!d) return '';
              return '<img src="https://www.google.com/s2/favicons?domain=' + aimEscHtml(d) + '&sz=32" style="width:14px;height:14px;border-radius:2px;" onerror="this.style.display=\'none\'">';
            }).join('') +
          '</span>';
        }
      }

      var textHtml = itemPromptId
        ? brandFavsHtml + '<a href="#" onclick="event.preventDefault();aimGoToPrompt(\'' + aimEscHtml(String(itemPromptId)) + '\')" style="font-size:13px;color:var(--accent);text-underline-offset:2px;line-height:1.5;" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + aimEscHtml(itemText) + '</a>'
        : '<span style="font-size:13px;color:var(--text-muted);line-height:1.5;">' + aimEscHtml(itemText) + '</span>';

      return '<tr>' + favCell + '<td style="padding:5px 0;vertical-align:middle;">' + textHtml + '</td></tr>';
    }).join('');

    var panelHtml = '<div style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border-light);">' +
      headHtml +
      '<table style="width:100%;border-collapse:collapse;"><tbody>' + tableRows + '</tbody></table>' +
    '</div>';

    return '<div>' +
      '<div style="display:flex;align-items:center;gap:7px;">' +
        '<button onclick="aimTdToggleExpand(this)" style="background:none;border:none;cursor:pointer;padding:0;width:14px;height:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--text-muted);">' +
          '<span class="aim-chev" style="display:inline-block;transition:transform .18s ease;font-size:8px;line-height:1;">&#9654;</span>' +
        '</button>' +
        favHtml +
        '<span style="font-size:13px;color:#374151;font-weight:600;line-height:1.6;flex:1;">' + aimEscHtml(text) + '</span>' +
      '</div>' +
      panelHtml +
    '</div>';
  }

  function aimRenderStepRow(text, idx, expandItems) {
    var snClass = 'aim-td-sn-step';
    var hasExpand = expandItems && expandItems.length > 0;

    var expandBtn = hasExpand
      ? '<button onclick="aimTdToggleExpand(this)" style="background:none;border:none;cursor:pointer;padding:0;font-size:11px;font-weight:500;color:var(--text-faint);font-family:var(--font);flex-shrink:0;white-space:nowrap;display:inline-flex;align-items:center;gap:2px;margin-left:6px;" onmouseover="this.style.color=\'var(--text-muted)\'" onmouseout="this.style.color=\'var(--text-faint)\'">' +
          'See how <span class="aim-chev" style="display:inline-block;transition:transform .2s;font-size:9px;line-height:1;">&#9660;</span>' +
        '</button>'
      : '';

    var panelHtml = '';
    if (hasExpand) {
      var bullets = expandItems.filter(Boolean).map(function (item) {
        return '<li style="font-size:11px;color:var(--text-muted);line-height:1.6;padding:1.5px 0;">' + aimEscHtml(item) + '</li>';
      }).join('');
      panelHtml = '<div style="display:none;margin-top:7px;padding:8px 10px;background:var(--surface-alt);border:1px solid var(--border-light);border-radius:6px;"><ul style="margin:0;padding-left:16px;list-style:disc;">' + bullets + '</ul></div>';
    }

    return '<div style="display:flex;align-items:flex-start;gap:8px;font-size:12.5px;color:var(--text-muted);line-height:1.6;">' +
      '<span class="aim-td-step-num ' + snClass + '">' + (idx + 1) + '</span>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="display:flex;align-items:flex-start;gap:4px;">' +
          expandBtn +
          '<span style="flex:1;">' + aimEscHtml(text) + '</span>' +
        '</div>' +
        panelHtml +
      '</div>' +
    '</div>';
  }

  function aimRenderBrandBadges(brands) {
    if (!brands || !brands.length) return '';
    return brands.filter(function (b) { return b && b.domain; }).map(function (b) {
      return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:500;padding:3px 8px 3px 5px;border-radius:20px;background:#f3f4f6;border:1px solid var(--border);color:var(--text-muted);">' +
        '<img src="https://www.google.com/s2/favicons?domain=' + aimEscHtml(b.domain) + '&sz=32" style="width:14px;height:14px;border-radius:3px;flex-shrink:0;" onerror="this.style.display=\'none\'">' +
        aimEscHtml(b.label || b.domain) +
      '</span>';
    }).join('');
  }

  // ── Cited URL corpus ────────────────────────────────────────────────────────
  // The v4 source builds URL-level entries from top_source_urls +
  // prompt_response_history. The live snapshot only exposes domain-level
  // sources, so each domain becomes one entry (same as the source file's
  // synthetic "domain:" entries when source_objects are absent).
  function _aimGetAllUrls() {
    if (_aimExtUrlCache) return _aimExtUrlCache;
    var snap = _snapNorm || {};
    _aimExtUrlCache = (snap.top_sources || []).map(function (s) {
      return {
        url:            s.domain,
        domain:         s.domain,
        label:          s.domain,
        citation_count: s.citation_count || 0,
        by_provider:    s.by_provider || {}
      };
    });
    return _aimExtUrlCache;
  }

  // ── Examples per strategy (ported; competitor/brand exclusions come from
  //    the normalized snapshot instead of window.AIM_INJECTED_DATA) ──────────
  function aimTdGetExamples(action) {
    var snap = _snapNorm || {};
    var allUrls = _aimGetAllUrls();
    if (!allUrls.length) return [];

    var id       = action.id || '';
    var strategy = action.examplesStrategy || '';
    var contextName = (action.examplesContextName || '').toLowerCase();

    function addUniq(results, arr, max) {
      arr.forEach(function (u) {
        if (results.length < max && !results.some(function (r) { return r.url === u.url; })) results.push(u);
      });
    }
    function nonReddit(u) { return u.domain !== 'reddit.com' && u.domain !== 'www.reddit.com'; }
    function buildExclusionSet() {
      var excl = new Set(['reddit.com', 'www.reddit.com']);
      (snap.competitor_entities || []).forEach(function (c) { if (c.domain) { excl.add(c.domain); excl.add('www.' + c.domain); } });
      if (snap.brand_domain) { excl.add(snap.brand_domain); excl.add('www.' + snap.brand_domain); }
      return excl;
    }

    // ── Reddit todo: actual Reddit threads being cited ───────────────
    if (id === 'td-reddit') {
      return allUrls.filter(function (u) {
        return u.domain === 'reddit.com' || u.domain === 'www.reddit.com';
      }).slice(0, 5);
    }

    // ── Top domain todo: URLs from that exact domain ─────────────────
    if (id === 'td-top-domain' && action.exampleDomains && action.exampleDomains[0]) {
      var targetDomain = action.exampleDomains[0];
      var domainUrls = allUrls.filter(function (u) {
        return u.domain === targetDomain || u.domain === 'www.' + targetDomain;
      });
      if (domainUrls.length >= 1) return domainUrls.slice(0, 5);
    }

    // ── Alternatives / vs pages (comp-gap + sentiment-opp) ──────────
    if (strategy === 'alternatives-vs') {
      var normCtx = contextName.replace(/[^a-z0-9]/g, '');
      var ctxSlug = contextName.replace(/\s+/g, '-');
      var altRe = /alternatives?|versus|\bvs[-\/\b]|comparison|compare/i;
      var p1 = allUrls.filter(function (u) {
        if (!nonReddit(u)) return false;
        var raw = (u.url || '').toLowerCase();
        return altRe.test(raw) && (raw.indexOf(normCtx) > -1 || raw.indexOf(ctxSlug) > -1);
      });
      var p2 = allUrls.filter(function (u) {
        if (!nonReddit(u)) return false;
        var raw = (u.url || '').toLowerCase();
        return altRe.test(raw);
      });
      var p3 = allUrls.filter(function (u) {
        if (!nonReddit(u)) return false;
        var txt = ((u.url || '') + ' ' + (u.label || '')).toLowerCase().replace(/[^a-z0-9\/ .-]/g, '');
        if (txt.indexOf(normCtx) === -1) return false;
        var pt = aimGetUrlPageType(u.url, u.domain);
        return ['Review', 'Listicle', 'Category Page'].indexOf(pt) > -1;
      });
      var p4 = allUrls.filter(function (u) {
        if (!nonReddit(u)) return false;
        var pt = aimGetUrlPageType(u.url, u.domain);
        return ['Review', 'Listicle', 'Category Page', 'Guide'].indexOf(pt) > -1;
      });
      var results = [];
      addUniq(results, p1, 5);
      addUniq(results, p2, 5);
      addUniq(results, p3, 5);
      addUniq(results, p4, 5);
      addUniq(results, allUrls.filter(nonReddit), 5);
      return results.slice(0, 5);
    }

    // ── Model-specific (model gap todo) ─────────────────────────────
    if (strategy === 'model-specific' && action.examplesModelKey) {
      var mk = action.examplesModelKey;
      var modelUrls = allUrls.filter(function (u) {
        var cnt = ((u.by_provider || {})[mk] || 0);
        return cnt > 0 && nonReddit(u);
      }).sort(function (a, b) {
        return ((b.by_provider || {})[mk] || 0) - ((a.by_provider || {})[mk] || 0);
      });
      if (modelUrls.length >= 2) return modelUrls.slice(0, 5);
      var preferredM = action.exampleDomains || [];
      var resultsM = [];
      addUniq(resultsM, allUrls.filter(function (u) { return nonReddit(u) && preferredM.indexOf(u.domain) > -1; }), 3);
      addUniq(resultsM, allUrls.filter(nonReddit), 5);
      return resultsM.slice(0, 5);
    }

    // ── Next-tier strict (diversify todo) ───────────────────────────
    if (strategy === 'next-tier-strict' && action.exampleDomains && action.exampleDomains.length) {
      var tierDomains = action.exampleDomains;
      var tierUrls = allUrls.filter(function (u) {
        return tierDomains.some(function (d) { return u.domain === d || u.domain === 'www.' + d; });
      });
      if (tierUrls.length >= 2) return tierUrls.slice(0, 5);
    }

    // ── Topic editorial (topic cluster todo) ─────────────────────────
    if (strategy === 'topic-editorial') {
      var topicKws = (action.examplesTopicKeywords || []).map(function (k) {
        return k.toLowerCase().replace(/[^a-z0-9]/g, '');
      });
      var editTypes = ['Guide', 'Blog Post', 'Article', 'Listicle', 'News Article'];
      var p1t = allUrls.filter(function (u) {
        if (!nonReddit(u)) return false;
        var txt = ((u.url || '') + ' ' + (u.label || '')).toLowerCase().replace(/[^a-z0-9 .\/]/g, '');
        return topicKws.some(function (kw) { return kw && txt.indexOf(kw) > -1; });
      });
      var p2t = allUrls.filter(function (u) {
        if (!nonReddit(u)) return false;
        return editTypes.indexOf(aimGetUrlPageType(u.url, u.domain)) > -1;
      });
      var resultsT = [];
      addUniq(resultsT, p1t, 3);
      addUniq(resultsT, p2t, 5);
      addUniq(resultsT, allUrls.filter(nonReddit), 5);
      return resultsT.slice(0, 5);
    }

    // ── Schema examples (structured data / FAQ / HowTo todo) ────────
    if (strategy === 'schema-examples') {
      var schemaExcl = buildExclusionSet();
      function notExcluded(u) { return !schemaExcl.has(u.domain) && !schemaExcl.has('www.' + u.domain); }
      var faqRe = /\/faq\b|\/faq\/|[?&]|\/q[-_]?a\/|\/ask\/|how[-_]?to|\/guide\b|\/guide\/|\/tutorial\b|\/tutorial\//i;
      var questionWordRe = /\b(what|how|which|why|where|when|is|are|can|does|do|should)[-\s]/i;
      var sp1 = allUrls.filter(function (u) {
        return notExcluded(u) && faqRe.test(u.url || '');
      });
      var sp2 = allUrls.filter(function (u) {
        if (!notExcluded(u)) return false;
        var txt = ((u.url || '') + ' ' + (u.label || '')).toLowerCase();
        return questionWordRe.test(txt);
      });
      var sp3 = allUrls.filter(function (u) {
        if (!notExcluded(u)) return false;
        var pt = aimGetUrlPageType(u.url, u.domain);
        return pt === 'Guide' || pt === 'Blog Post';
      });
      var sp4 = allUrls.filter(notExcluded);
      var schemaResults = [];
      addUniq(schemaResults, sp1, 5);
      addUniq(schemaResults, sp2, 5);
      addUniq(schemaResults, sp3, 5);
      addUniq(schemaResults, sp4, 5);
      return schemaResults.slice(0, 5);
    }

    // ── Research examples (original data / benchmark report todo) ────
    if (strategy === 'research-examples') {
      var resExcl = buildExclusionSet();
      function notResExcl(u) { return !resExcl.has(u.domain) && !resExcl.has('www.' + u.domain); }
      var resPathRe = /\/(?:report|study|research|survey|data|benchmark|state[-_]of|index)\b/i;
      var resLabelRe = /\b(report|study|research|survey|data|benchmark|state of)\b/i;
      var resHighAuthRe = /^https?:\/\/(?:arxiv\.org|papers\.ssrn\.com|scholar\.google\.com|semanticscholar\.org)/i;
      var rp1 = allUrls.filter(function (u) {
        return notResExcl(u) && (resHighAuthRe.test(u.url || '') || resPathRe.test(u.url || ''));
      });
      var rp2 = allUrls.filter(function (u) {
        return notResExcl(u) && resLabelRe.test(u.label || '');
      });
      var rp3 = allUrls.filter(function (u) {
        if (!notResExcl(u)) return false;
        var pt = aimGetUrlPageType(u.url, u.domain);
        return pt === 'Guide' || pt === 'Article' || pt === 'News Article';
      });
      var rp4 = allUrls.filter(notResExcl);
      var resResults = [];
      addUniq(resResults, rp1, 5);
      addUniq(resResults, rp2, 5);
      addUniq(resResults, rp3, 5);
      addUniq(resResults, rp4, 5);
      return resResults.slice(0, 5);
    }

    // ── Editorial guide (zero-vis todo) ─────────────────────────────
    if (strategy === 'editorial-guide') {
      var excl = buildExclusionSet();
      var editTypes2 = ['Guide', 'Blog Post', 'Article', 'Listicle', 'News Article'];
      var editUrls = allUrls.filter(function (u) {
        return !excl.has(u.domain) && !excl.has('www.' + u.domain) &&
               editTypes2.indexOf(aimGetUrlPageType(u.url, u.domain)) > -1;
      });
      var fallback = allUrls.filter(function (u) {
        return !excl.has(u.domain) && !excl.has('www.' + u.domain) &&
               !editUrls.some(function (e) { return e.url === u.url; });
      });
      return editUrls.concat(fallback).slice(0, 5);
    }

    // ── Commercial review (commercial intent todo) ───────────────────
    if (strategy === 'commercial-review') {
      var commTypes = ['Review', 'Category Page', 'Listicle'];
      var reviewPlatforms = ['g2.com', 'capterra.com', 'trustradius.com', 'getapp.com', 'softwareadvice.com', 'trustpilot.com'];
      var platUrls = allUrls.filter(function (u) {
        return reviewPlatforms.some(function (rp) { return u.domain === rp || u.domain === 'www.' + rp; });
      });
      var commPages = allUrls.filter(function (u) {
        if (!nonReddit(u)) return false;
        return commTypes.indexOf(aimGetUrlPageType(u.url, u.domain)) > -1;
      });
      var resultsC = [];
      addUniq(resultsC, platUrls, 3);
      addUniq(resultsC, commPages, 5);
      addUniq(resultsC, allUrls.filter(nonReddit), 5);
      return resultsC.slice(0, 5);
    }

    // ── Default: exclude Reddit + competitor/brand domains ───────────
    var excludeDomains = buildExclusionSet();
    var editorial = allUrls.filter(function (u) {
      return !excludeDomains.has(u.domain) && !excludeDomains.has('www.' + u.domain);
    });
    var preferred2 = (action.exampleDomains || []).filter(function (d) { return !excludeDomains.has(d); });
    var results2 = [];
    addUniq(results2, editorial.filter(function (u) { return preferred2.indexOf(u.domain) > -1; }), 3);
    addUniq(results2, editorial, 5);
    return results2.slice(0, 5);
  }

  // ── Detail panel (ported verbatim) ─────────────────────────────────────────
  function aimOpenTodoDetail(id) {
    var action = _aimTodosData ? _aimTodosData.find(function (a) { return a.id === id; }) : null;
    if (!action) return;
    var listEl = document.getElementById('aim-td-list');
    var detailEl = document.getElementById('aim-td-detail');
    if (listEl) listEl.style.display = 'none';
    if (!detailEl) return;
    detailEl.style.display = 'block';

    var isDone = _aimTodosCompleted.has(id);
    var isAdded = _aimTodosAdded.has(id);

    var pri = _aimTdPriColors[action.priority] || _aimTdPriColors.medium;
    var pageLabel = action.pageType === 'on-page' ? 'On-page' : 'Off-page';
    var pageClass = action.pageType === 'on-page' ? 'on-page' : 'off-page';
    var typeLabel = _aimTdTypeLabels[action.recType] || action.recType;
    var detailTypeIconHtml = aimTypeIcon(action.recType);

    var engineBadges = (action.aiTargets || []).map(function (k) {
      var d = _aimProvDomains[k] || 'google.com';
      return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:500;color:var(--text-muted);">' +
        '<img src="https://www.google.com/s2/favicons?domain=' + aimEscHtml(d) + '&sz=32" style="width:13px;height:13px;border-radius:2px;" onerror="this.style.display=\'none\'">' +
        aimEscHtml(_aimProvLabels[k] || k) +
      '</span>';
    }).join('<span style="color:var(--border);margin:0 2px;">&middot;</span>');

    var signalChips = (action.signals || []).map(function (s, i) {
      var sfav = (action.sigs_fav || [])[i] || '';
      var sexp = (action.sigs_expand || [])[i] || null;
      return aimRenderSigChip(s, sfav, sexp);
    }).join('');

    var stepsHtml = (action.steps || action.suggestions || []).map(function (s, i) {
      return aimRenderStepRow(s, i, null);
    }).join('');

    var examples = aimTdGetExamples(action);
    var exHeading = action.examplesHeading || 'Content AI currently cites in your category';
    var exNote    = action.examplesNote    || 'These are the pages AI models pull from when answering queries like yours.';
    var exHtml = examples.length
      ? examples.map(function (u, i) {
          var label = u.label || u.url;
          var shortLabel = label.replace(/\.\s*Opens in new tab\.?/i, '').trim();
          shortLabel = shortLabel.length > 55 ? shortLabel.substring(0, 55) + '…' : shortLabel;
          var pageType = aimGetUrlPageType(u.url, u.domain);
          var ptClass = pageType.toLowerCase().replace(/[\s\/]+/g, '-');
          var href = /^https?:\/\//i.test(u.url) ? u.url : (u.url ? 'https://' + u.url : '#');
          return '<div style="display:flex;align-items:center;gap:9px;padding:8px 0;' + (i > 0 ? 'border-top:1px solid var(--border-light);' : '') + '">' +
            '<img src="https://www.google.com/s2/favicons?domain=' + aimEscHtml(u.domain) + '&sz=32" style="width:15px;height:15px;border-radius:3px;flex-shrink:0;" onerror="this.style.display=\'none\'">' +
            '<div style="flex:1;min-width:0;">' +
              '<a href="' + aimEscHtml(href) + '" target="_blank" rel="noopener noreferrer" ' +
                'style="font-size:12px;font-weight:500;color:#111827;line-height:1.35;text-decoration:none;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" ' +
                'onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'" ' +
                'title="' + aimEscHtml(u.url) + '">' + aimEscHtml(shortLabel) + '</a>' +
              '<div style="font-size:11px;color:var(--text-faint);margin-top:1px;">' + aimEscHtml(u.domain) + ' &middot; ' + (u.citation_count || 0) + ' citations</div>' +
            '</div>' +
            '<span class="aim-source-type-badge ' + aimEscHtml(ptClass) + '" style="flex-shrink:0;white-space:nowrap;font-size:10px;">' + aimEscHtml(pageType) + '</span>' +
          '</div>';
        }).join('')
      : '<div style="font-size:12px;color:var(--text-faint);padding:8px 0;">No URL data available in snapshot.</div>';

    var effortTip = (action.effort || '').toLowerCase().indexOf('high') > -1 ? 'High effort' : (action.effort || '').toLowerCase().indexOf('med') > -1 ? 'Medium effort' : 'Low effort';
    var isArchived = _aimTodosArchived.has(id);

    var actionBtns =
      '<div style="display:flex;gap:8px;flex-wrap:wrap;flex-shrink:0;">' +
        '<button class="aim-td-action-btn ' + (isAdded ? 'added' : '') + '" onclick="aimToggleTodoAdded(\'' + aimEscHtml(id) + '\')">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
          (isAdded ? ' To-do' : ' To-do') +
        '</button>' +
        '<button class="aim-td-action-btn ' + (isArchived ? 'archived' : '') + '" onclick="aimArchiveTodo(\'' + aimEscHtml(id) + '\')">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>' +
          (isArchived ? ' Archived' : ' Archive') +
        '</button>' +
        '<button class="aim-td-action-btn ' + (isDone ? 'done' : '') + '" onclick="aimMarkTodoComplete(\'' + aimEscHtml(id) + '\', this)">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>' +
          (isDone ? ' Complete' : ' Complete') +
        '</button>' +
      '</div>';

    detailEl.innerHTML =
      '<button class="aim-pd-back" onclick="aimCloseTodoDetail()">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>' +
        ' Back to Action Plan' +
      '</button>' +

      '<div class="card" style="margin-bottom:16px;">' +
        '<div class="card-body">' +
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-size:16px;font-weight:700;color:var(--text);line-height:1.35;margin-bottom:8px;' + (isDone ? 'text-decoration:line-through;opacity:.6;' : '') + '">' + aimEscHtml(action.title) + '</div>' +
              '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                '<button onclick="aimTdToggleWhy(this)" style="display:inline-flex;align-items:center;gap:0;background:#f9fafb;border:1px solid var(--border);border-radius:6px;padding:2px 9px 2px 0;font-size:11.5px;font-weight:600;color:#374151;cursor:pointer;font-family:var(--font);white-space:nowrap;transition:background .12s,color .12s;" onmouseover="this.style.background=\'transparent\';this.style.color=\'var(--text-muted)\'" onmouseout="this.style.background=\'#f9fafb\';this.style.color=\'#374151\'">' +
                  '<span style="width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">' +
                    '<span class="aim-why-chev" style="display:inline-block;font-size:8px;transition:transform .18s;line-height:1;">&#9654;</span>' +
                  '</span>' +
                  'Why we\'re recommending this' +
                '</button>' +
                '<span style="width:1px;height:14px;background:var(--border);display:inline-block;border-radius:1px;margin:0 2px;flex-shrink:0;"></span>' +
                '<span class="aim-intent-badge ' + (action.priority === 'high' ? 'priority-high' : 'priority-medium') + '">' + (action.priority === 'high' ? 'High' : 'Medium') + '</span>' +
                '<span class="aim-intent-badge ' + pageClass + '">' + pageLabel + '</span>' +
                '<span class="aim-intent-badge type-' + aimEscHtml(action.recType || '') + '">' + detailTypeIconHtml + aimEscHtml(typeLabel) + '</span>' +
                '<span style="width:1px;height:14px;background:var(--border);display:inline-block;border-radius:1px;margin:0 2px;flex-shrink:0;"></span>' +
                '<span class="aim-td-tip" data-tip="' + aimEscHtml(effortTip) + '" style="margin-right:2px;">' + aimEffortBar(action.effort) + '</span>' +
                (engineBadges ? '<span style="width:1px;height:14px;background:var(--border);display:inline-block;border-radius:1px;margin:0 2px;flex-shrink:0;"></span><span style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;">' + engineBadges + '</span>' : '') +
              '</div>' +
            '</div>' +
            actionBtns +
          '</div>' +
          '<div id="aim-td-why-panel" style="display:none;margin-top:12px;padding:14px 16px;background:var(--surface-alt);border:1px solid var(--border-light);border-radius:10px;">' +
            (action._groupLabel ? '<div style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-faint);margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--border-light);">Part of: ' + aimEscHtml(action._groupLabel) + '</div>' : '') +
            '<p style="font-size:13px;color:var(--text-muted);line-height:1.7;margin:0;">' + aimEscHtml(action.reasoning || action.why || '') + '</p>' +
          '</div>' +
          (signalChips
            ? '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border-light);">' +
                '<div style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-faint);margin-bottom:9px;">Signals</div>' +
                '<div style="display:flex;flex-direction:column;gap:11px;">' + signalChips + '</div>' +
              '</div>'
            : '') +
        '</div>' +
      '</div>' +

      '<div style="padding:20px 16px;">' +
        '<div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:10px;">Internal notes</div>' +
        '<div id="aim-td-noteswrap-' + aimEscHtml(id) + '" style="border:1px solid var(--border);border-radius:8px;background:#fff;transition:border-color .15s;overflow:hidden;">' +
          '<textarea id="aim-td-notes-' + aimEscHtml(id) + '" ' +
            'placeholder="Add your notes, status updates, or next steps here..." ' +
            'style="width:100%;font-size:13px;color:var(--text);font-family:var(--font);line-height:1.6;padding:10px 12px;border:none;outline:none;resize:none;background:transparent;box-sizing:border-box;min-height:88px;display:block;" ' +
            'onfocus="document.getElementById(\'aim-td-noteswrap-' + aimEscHtml(id) + '\').style.borderColor=\'var(--accent-30)\';document.getElementById(\'aim-td-savewrap-' + aimEscHtml(id) + '\').style.display=\'flex\';" ' +
            'onblur="(function(sid){setTimeout(function(){if(document.activeElement&&document.activeElement.getAttribute(\'data-save-id\')===sid)return;document.getElementById(\'aim-td-noteswrap-\'+sid).style.borderColor=\'var(--border)\';document.getElementById(\'aim-td-savewrap-\'+sid).style.display=\'none\';},150);})(\'' + aimEscHtml(id) + '\');">' +
          aimEscHtml((function () { try { return localStorage.getItem(_lsNotesPrefix + id) || ''; } catch (e) { return ''; } })()) +
          '</textarea>' +
          '<div id="aim-td-savewrap-' + aimEscHtml(id) + '" style="display:none;align-items:center;justify-content:flex-end;padding:7px 10px;border-top:1px solid var(--border-light);">' +
            '<button data-save-id="' + aimEscHtml(id) + '" onclick="aimTdSaveNotes(\'' + aimEscHtml(id) + '\')" style="padding:4px 14px;background:var(--accent);color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font);">Save</button>' +
          '</div>' +
        '</div>' +
        (stepsHtml || examples.length
          ? '<div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;align-items:start;margin-top:28px;">' +
              (stepsHtml
                ? '<div>' +
                    '<div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:12px;">Steps</div>' +
                    '<div style="display:flex;flex-direction:column;gap:10px;">' + stepsHtml + '</div>' +
                  '</div>'
                : '<div></div>') +
              (examples.length
                ? '<div>' +
                    '<div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:4px;">' + aimEscHtml(exHeading) + '</div>' +
                    '<div style="font-size:12px;color:var(--text-faint);margin-bottom:10px;">' + aimEscHtml(exNote) + '</div>' +
                    exHtml +
                  '</div>'
                : '<div></div>') +
            '</div>'
          : '') +
      '</div>';

    if (detailEl.parentElement) detailEl.parentElement.scrollTop = 0;
    try { window.scrollTo(0, 0); } catch (e) { /* noop */ }
  }

  function aimCloseTodoDetail() {
    var listEl = document.getElementById('aim-td-list');
    var detailEl = document.getElementById('aim-td-detail');
    if (listEl) listEl.style.display = '';
    if (detailEl) { detailEl.style.display = 'none'; detailEl.innerHTML = ''; }
  }

  function aimGoToPrompt(id) {
    if (!id) return;
    aimCloseTodoDetail();
    PB.navigate('#/prompts/' + id);
  }

  function aimTdToggleWhy(btn) {
    var panel = document.getElementById('aim-td-why-panel');
    if (!panel) return;
    var open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    var chev = btn.querySelector('.aim-why-chev');
    if (chev) chev.style.transform = open ? '' : 'rotate(90deg)';
  }

  function aimTdSaveNotes(id) {
    var ta = document.getElementById('aim-td-notes-' + id);
    if (!ta) return;
    try { localStorage.setItem(_lsNotesPrefix + id, ta.value); } catch (e) { /* quota */ }
    var btn = document.querySelector('[data-save-id="' + id + '"]');
    if (!btn) return;
    var orig = btn.textContent;
    btn.textContent = 'Saved';
    btn.style.background = '#16a34a';
    setTimeout(function () { btn.textContent = orig; btn.style.background = ''; }, 1600);
  }

  // ── Parent/suggestion expansion (ported verbatim) ──────────────────────────
  function _aimExpandTodo(parent) {
    var parentOut = {};
    for (var k in parent) { if (Object.prototype.hasOwnProperty.call(parent, k)) parentOut[k] = parent[k]; }
    parentOut.suggestions = null;
    var result = [];
    var sugs = parent.suggestions || [];

    // Normalize to objects — supports both plain strings and {title,steps,signals} objects
    var sugObjs = sugs.map(function (s) {
      return (typeof s === 'string') ? { title: s, steps: [], signals: [] } : s;
    });

    // Singleton: fold title into parent steps, emit only the parent
    if (sugObjs.length === 1) {
      parentOut.steps = (parentOut.steps || []).concat([sugObjs[0].title]);
      result.push(parentOut);
      return result;
    }

    // Only include the parent row if it has execution steps to show
    if (parent.steps && parent.steps.length > 0) {
      result.push(parentOut);
    }

    // Each suggestion becomes an independent child todo with its own steps/signals
    sugObjs.forEach(function (sug, i) {
      var child = {};
      for (var k2 in parent) { if (Object.prototype.hasOwnProperty.call(parent, k2)) child[k2] = parent[k2]; }
      child.id          = parent.id + '-s' + i;
      child.title       = sug.title;
      child._groupId    = parent.id;
      child._groupLabel = parent.title;
      child.suggestions = null;
      child.steps       = sug.steps && sug.steps.length ? sug.steps : [];
      child.signals     = sug.signals && sug.signals.length ? sug.signals : parent.signals;
      child.sigs_fav    = sug.sigs_fav || [null, null, null];
      child.sigs_expand = sug.sigs_expand || null;
      child.reasoning   = parent.reasoning;
      result.push(child);
    });
    return result;
  }

  // ── Data normalization ──────────────────────────────────────────────────────
  // Maps the live API payloads (PB.api.snapshot + PB.api.prompts) onto the
  // snapshot shape the v4 generator was written against.
  function cleanDomain(d) {
    return String(d || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
  }

  // Live model ids ('gpt-4o-mini', 'google-ai-mode', 'sonar', ...) -> provider key
  function modelIdToProv(m) {
    m = String(m || '').toLowerCase();
    if (AIM_PROVIDER_KEYS[m]) return AIM_PROVIDER_KEYS[m];
    if (/ai.?overview|aio\b/.test(m)) return 'googleaio';
    if (/ai.?mode/.test(m)) return 'googleaimode';
    if (/gemini|bard/.test(m)) return 'gemini';
    if (/perplexity|sonar/.test(m)) return 'perplexity';
    if (/gpt|openai|chatgpt|\bo1\b|\bo3\b/.test(m)) return 'chatgpt';
    return null;
  }

  // Deterministically split a citation total across the providers that cited
  // the domain (stable, non-negative, sums exactly to total).
  function splitMentions(total, provs) {
    var out = {};
    total = Number(total) || 0;
    if (!provs || !provs.length) return out;
    var base = Math.floor(total / provs.length);
    var rem = total - base * provs.length;
    provs.forEach(function (p, i) { out[p] = base + (i < rem ? 1 : 0); });
    return out;
  }

  function normalizeSnapshot(snap, promptRows, brandName, brandUrl) {
    snap = snap || {};
    var vis = snap.visibility || {};
    var brand = (snap.brand && snap.brand.name) || brandName || 'Your Brand';
    var brandDomain = cleanDomain(brandUrl || (snap.brand && snap.brand.url) || '');

    var competitors = (snap.competitors || snap.competitor_entities || [])
      .filter(function (c) { return c && c.name; })
      .map(function (c) {
        var v = c.score != null ? c.score : (c.visibility_score != null ? c.visibility_score : c.visibility);
        return {
          name: c.name,
          domain: cleanDomain(c.url || c.domain || ''),
          visibility: Number(v) || 0,
          sentiment: (c.sentiment != null ? Number(c.sentiment) : null),
          mention_count: (c.mentions != null ? Number(c.mentions) : (c.mention_count != null ? Number(c.mention_count) : null))
        };
      });

    var provSeen = {};
    var topSources = (snap.sources || snap.top_sources || [])
      .filter(function (s) { return s && s.domain; })
      .map(function (s) {
        var provs = [];
        (s.aiModels || []).forEach(function (m) {
          var k = modelIdToProv(m);
          if (k && provs.indexOf(k) === -1) { provs.push(k); provSeen[k] = true; }
        });
        var count = Number(s.mentions != null ? s.mentions : s.citation_count) || 0;
        return {
          domain: cleanDomain(s.domain),
          citation_count: count,
          by_provider: splitMentions(count, provs),
          providers: provs
        };
      })
      .sort(function (a, b) { return b.citation_count - a.citation_count; });

    var srcByProv = {};
    topSources.forEach(function (s) {
      s.providers.forEach(function (p) {
        if (!srcByProv[p]) srcByProv[p] = [];
        srcByProv[p].push({ domain: s.domain, citation_count: s.by_provider[p] || 0 });
      });
    });
    Object.keys(srcByProv).forEach(function (p) {
      srcByProv[p].sort(function (a, b) { return b.citation_count - a.citation_count; });
    });

    // Prefer the prompts endpoint rows (have promptId + searchIntent); the
    // snapshot's own prompts array is the fallback.
    var rows = (promptRows && promptRows.length) ? promptRows : (snap.prompts || []);
    var promptMetrics = rows
      .filter(function (p) { return p && (p.promptText || p.prompt_text); })
      .map(function (p) {
        (p.aiModels || []).forEach(function (m) { var k = modelIdToProv(m); if (k) provSeen[k] = true; });
        var v = p.averageScore != null ? p.averageScore : (p.visibility_all != null ? p.visibility_all : (p.visibility_score != null ? p.visibility_score : p.visibility));
        return {
          prompt_id: p.promptId || p.prompt_id || p.id || null,
          prompt_text: p.promptText || p.prompt_text || '',
          visibility_all: Number(v) || 0,
          topic: p.category || p.topic || null,
          intent: p.searchIntent || p.intent || null
        };
      });

    return {
      brand: brand,
      brand_domain: brandDomain,
      overall_visibility: Number(vis.score) || 0,
      overall_avg_position: (vis.rank != null ? Number(vis.rank) : null),
      total_runs: Number(vis.totalChatsAnalyzed) || 0,
      competitor_entities: competitors,
      prompt_metrics: promptMetrics,
      top_sources: topSources,
      sources_by_provider: srcByProv,
      latest_by_provider: snap.latest_by_provider || {},
      aim_real_hm_data: snap.aim_real_hm_data || {},
      top_source_urls: snap.top_source_urls || [],
      active_providers: Object.keys(provSeen)
    };
  }

  // ── Data generation (ported from v4 aimGenerateTodos; reads the normalized
  //    snapshot instead of window._AIM_SNAPSHOT) ──────────────────────────────
  function aimGenerateTodos(snap) {
    snap = snap || _snapNorm || {};
    var todos = [];

    var _periodLabel = _periodRange === '30d' ? 'last 30 days' : _periodRange === '90d' ? 'last 90 days' : 'last 7 days';

    var injDomainMap = {};
    (snap.competitor_entities || []).forEach(function (c) { if (c.name && c.domain) injDomainMap[c.name.toLowerCase()] = c.domain; });

    var overallVis = snap.overall_visibility || 0;
    var brand = snap.brand || 'Your Brand';
    var competitors = (snap.competitor_entities || []).slice().sort(function (a, b) { return b.visibility - a.visibility; });
    var prompts = snap.prompt_metrics || [];
    var topSources = snap.top_sources || [];
    var srcByProv = snap.sources_by_provider || {};
    var latByProv = snap.latest_by_provider || {};
    var hmSnap = snap.aim_real_hm_data || {};
    var totalCitations = topSources.reduce(function (s, d) { return s + (d.citation_count || 0); }, 0);
    var totalRuns = snap.total_runs || 0;
    var ourMentionApprox = totalRuns ? Math.round(overallVis * totalRuns / 100) : null;

    var allProviders = ['chatgpt', 'gemini', 'perplexity', 'googleaio', 'googleaimode'];
    var provLabels = { chatgpt: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity', googleaio: 'Google AIO', googleaimode: 'Google AI Mode' };
    var provDomains = { chatgpt: 'openai.com', gemini: 'gemini.google.com', perplexity: 'perplexity.ai', googleaio: 'google.com', googleaimode: 'google.com' };

    var zeroPrompts = prompts.filter(function (p) { return (p.visibility_all || 0) === 0; });
    var lowPrompts  = prompts.filter(function (p) { return (p.visibility_all || 0) > 0 && (p.visibility_all || 0) < 5; });

    // helpers
    function activeProviders() {
      var act = allProviders.filter(function (p) { return latByProv[p] && latByProv[p].visibility != null; });
      if (!act.length) act = allProviders.filter(function (p) { return (snap.active_providers || []).indexOf(p) > -1; });
      return act.length ? act : allProviders.slice();
    }
    function providersWhereCompVisible(compName) {
      var hm = hmSnap[compName] || {};
      return allProviders.filter(function (p) { return hm[p] && hm[p] > 0; });
    }
    function promptExpandItem(p, maxLen) {
      var txt = p.prompt_text.substring(0, maxLen) + (p.prompt_text.length > maxLen ? '...' : '');
      return { text: '”' + txt + '”' + (p.topic ? ' [' + p.topic + ']' : ''), promptId: p.prompt_id };
    }

    // ── 1. Top competitor gap ─────────────────────────────────────
    if (competitors.length > 0) {
      var top = competitors[0];
      var gap = Math.round(top.visibility - overallVis);
      var topDomain = injDomainMap[top.name.toLowerCase()] || '';
      var hmTopComp = hmSnap[top.name] || {};
      var hmTopItems = Object.keys(hmTopComp).filter(function (k) { return provLabels[k]; }).map(function (k) {
        return provLabels[k] + ': ' + hmTopComp[k].toFixed(1) + '%';
      });
      var targProvs = providersWhereCompVisible(top.name);
      if (!targProvs.length) targProvs = activeProviders();

      if (gap > 3) {
        _aimExpandTodo({
          id: 'td-comp-gap',
          priority: 'high',
          effort: 'High effort',
          pageType: 'on-page',
          recType: 'content',
          aiTargets: targProvs,
          title: 'Publish a “' + brand + ' vs ' + top.name + '” comparison page',
          signals: [
            top.name + ' appeared in ' + (top.mention_count || Math.round(top.visibility * totalRuns / 100)) + ' AI responses' + (ourMentionApprox ? ' vs ~' + ourMentionApprox + ' for ' + brand : ''),
            top.name + ' leads by ' + gap + ' visibility points across your monitored prompts',
            top.sentiment ? top.name + '\'s AI sentiment score: ' + top.sentiment + '% positive' : 'They rank #1 across all tracked AI models'
          ],
          sigs_fav: [topDomain, topDomain, topDomain],
          sigs_expand: [
            hmTopItems.length ? { heading: top.name + '\'s visibility by AI model:', items: hmTopItems } : null,
            zeroPrompts.length > 0 ? { heading: 'Prompts where you have zero visibility:', items: zeroPrompts.slice(0, 6).map(function (p) { return { text: '”' + p.prompt_text.substring(0, 80) + (p.prompt_text.length > 80 ? '...' : '') + '”', promptId: p.prompt_id }; }) } : null,
            null
          ],
          reasoning: top.name + ' shows up in ' + top.visibility.toFixed(1) + '% of the AI conversations you track. You show up in ' + overallVis.toFixed(1) + '%. That gap exists right now, on the specific prompts you are monitoring. Buyers asking AI for tool recommendations are getting ' + top.name + ' in the answer. A comparison page gives AI a citable, structured source that directly positions ' + brand + ' against the market leader.',
          steps: [
            'Title it: “' + brand + ' vs ' + top.name + ': Which is better for [use case]?” to match how buyers search',
            'Build a feature matrix covering pricing, integrations, support, and key use cases',
            'Add a direct “Who wins?” conclusion that AI can extract as a quotable answer',
            'Include real customer quotes and outcome metrics to strengthen credibility'
          ],
          suggestions: [
            'Get the comparison page featured on at least 2 of the domains currently citing ' + top.name
          ],
          exampleDomains: [topDomain].filter(Boolean),
          examplesContextName: top.name,
          examplesStrategy: 'alternatives-vs',
          examplesHeading: 'What AI currently cites about ' + top.name,
          examplesNote: 'These pages give ' + top.name + ' its AI visibility. Use them as content brief templates.',
          outcome: 'Expect a 3-8 point improvement in visibility over 60-90 days once citation-rich content is indexed and referenced by AI models.',
          platDomains: [topDomain].filter(Boolean),
          brands: competitors[1]
            ? [{ domain: topDomain, label: top.name }, { domain: injDomainMap[(competitors[1].name || '').toLowerCase()] || '', label: competitors[1].name || '' }]
            : [{ domain: topDomain, label: top.name }]
        }).forEach(function (t) { todos.push(t); });
      }
    }

    // ── 2. Zero-visibility prompts ────────────────────────────────
    if (zeroPrompts.length > 0) {
      var ex0 = zeroPrompts[0];
      _aimExpandTodo({
        id: 'td-zero-vis',
        priority: 'high',
        effort: 'High effort',
        pageType: 'on-page',
        recType: 'content',
        aiTargets: activeProviders(),
        title: 'Publish new pages targeting ' + zeroPrompts.length + ' queries where you have zero visibility',
        signals: [
          zeroPrompts.length + ' tracked prompts where ' + brand + ' has zero AI mentions',
          lowPrompts.length + ' additional prompts with under 5% visibility',
          ex0 ? 'Example gap: “' + ex0.prompt_text.substring(0, 65) + (ex0.prompt_text.length > 65 ? '...' : '') + '”' : 'These are high-intent queries you are missing entirely'
        ],
        sigs_fav: [null, null, topSources.length > 0 ? topSources[0].domain : null],
        sigs_expand: [
          { heading: 'All zero-visibility prompts (' + zeroPrompts.length + '):', items: zeroPrompts.slice(0, 8).map(function (p) { return promptExpandItem(p, 80); }) },
          lowPrompts.length > 0 ? { heading: 'Under 5% visibility prompts (' + lowPrompts.length + '):', items: lowPrompts.slice(0, 6).map(function (p) { return p.prompt_text.substring(0, 65) + ': ' + (p.visibility_all || 0).toFixed(1) + '%'; }) } : null,
          null
        ],
        reasoning: 'You are tracking ' + prompts.length + ' queries. ' + brand + ' gets zero mentions on ' + zeroPrompts.length + ' of them. Someone asks the AI a question in your category, the AI answers with competitors, and you are not there. No content means no chance of appearing. These are the most urgent gaps.',
        steps: [
          'Group the ' + zeroPrompts.length + ' zero-visibility prompts by topic and create one page per cluster',
          'Write pages where the prompt text appears in H1 or the opening paragraph',
          'Add FAQPage schema using the exact prompt phrasing as the question text',
          'Build internal links from your highest-traffic existing pages to each new page'
        ],
        suggestions: [],
        exampleDomains: topSources.slice(0, 3).map(function (s) { return s.domain; }),
        examplesStrategy: 'editorial-guide',
        examplesHeading: 'What AI cites when you\'re not in the answer',
        examplesNote: 'These pages are filling the gap right now. Model your content structure on them.',
        outcome: 'Converting 20% of zero-visibility prompts to 10%+ mention rates would meaningfully lift your overall AI visibility score.',
        platDomains: topSources.slice(0, 3).map(function (s) { return s.domain; }),
        brands: topSources.slice(0, 2).map(function (s) { return { domain: s.domain, label: s.domain }; })
      }).forEach(function (t) { todos.push(t); });
    }

    // ── 3. Top citation domain ────────────────────────────────────
    if (topSources.length > 0) {
      // Skip social/video/community platforms (have own todos) and competitor brand domains
      var _tdSkipDoms = new Set(['reddit.com', 'youtube.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'linkedin.com', 'medium.com']);
      Object.values(injDomainMap).forEach(function (d) { if (d) _tdSkipDoms.add(d.replace(/^www\./, '').toLowerCase()); });
      competitors.forEach(function (c) {
        if (c.domain) _tdSkipDoms.add(c.domain.replace(/^www\./, '').toLowerCase());
      });
      // Also skip the brand's own domain
      var _brandDomTd = snap.brand_domain || null;
      if (_brandDomTd) _tdSkipDoms.add(_brandDomTd.replace(/^www\./, '').toLowerCase());
      var tdSrc = topSources.find(function (s) { return !_tdSkipDoms.has(s.domain) && !_tdSkipDoms.has(s.domain.replace(/^www\./, '')); });
      var tdShare = (tdSrc && totalCitations > 0) ? Math.round((tdSrc.citation_count / totalCitations) * 100) : 0;
      // Source threshold was 50; live snapshot citation counts are much smaller.
      if (tdSrc && tdSrc.citation_count >= 5) {
        var tdSrcByProv = allProviders.filter(function (p) { return srcByProv[p]; }).map(function (p) {
          var entry = (srcByProv[p] || []).find(function (s) { return s.domain === tdSrc.domain; });
          return provLabels[p] + ': ' + (entry ? entry.citation_count + ' citations' : '0 citations');
        });
        var provsCitingDomain = allProviders.filter(function (p) {
          return (srcByProv[p] || []).find(function (s) { return s.domain === tdSrc.domain && s.citation_count > 0; });
        });
        _aimExpandTodo({
          id: 'td-top-domain',
          priority: 'high',
          effort: 'Med effort',
          pageType: 'off-page',
          recType: 'backlinks',
          aiTargets: provsCitingDomain.length ? provsCitingDomain : activeProviders(),
          title: 'Get listed on ' + tdSrc.domain + ': it drives ' + tdShare + '% of AI citations in your space',
          signals: [
            tdSrc.domain + ' accounts for ' + tdShare + '% of all AI citations in your space',
            'It appears in ' + tdSrc.citation_count + ' monitored AI responses across all models',
            topSources.length > 1 ? 'Second highest: ' + topSources[1].domain + ' at ' + topSources[1].citation_count + ' citations' : 'It is the single most influential domain in your category'
          ],
          sigs_fav: [tdSrc.domain, tdSrc.domain, topSources.length > 1 ? topSources[1].domain : null],
          sigs_expand: [
            tdSrcByProv.length ? { heading: tdSrc.domain + ' citation count by AI model:', items: tdSrcByProv } : null,
            { heading: 'Top 5 citation domains:', items: topSources.slice(0, 5).map(function (s, i) {
              var sh = totalCitations > 0 ? Math.round((s.citation_count / totalCitations) * 100) : 0;
              return '#' + (i + 1) + ' ' + s.domain + ': ' + s.citation_count + ' citations (' + sh + '% of total)';
            }) },
            null
          ],
          reasoning: 'AI models cited ' + tdSrc.domain + ' ' + tdSrc.citation_count + ' times across your tracked prompts. That domain is in ' + tdShare + '% of all citations in your category. When AI answers a question in your space, it pulls from that source. Getting listed there is the single highest-leverage move for immediate citation gains.',
          steps: [
            'Find the editorial contact or submission path for ' + tdSrc.domain,
            'Prepare a pitch with your key differentiators, proof points, and how ' + brand + ' compares to alternatives already listed',
            'Once listed, keep your profile updated with current features, pricing, and customer proof points'
          ],
          suggestions: [],
          exampleDomains: [tdSrc.domain],
          examplesHeading: 'Pages on ' + tdSrc.domain + ' that AI cites most',
          examplesNote: 'Getting ' + brand + ' onto one of these pages creates a direct citation pipeline.',
          outcome: 'A feature on ' + tdSrc.domain + ' could add 5-15 additional AI citations per month and raise your overall visibility by 2-5 points.',
          platDomains: topSources.slice(0, 5).map(function (s) { return s.domain; }),
          brands: topSources.slice(0, 2).map(function (s) { return { domain: s.domain, label: s.domain }; })
        }).forEach(function (t) { todos.push(t); });
      }
    }

    // ── 4. Weakest AI model ───────────────────────────────────────
    var provVis = allProviders.map(function (p) {
      return { key: p, label: provLabels[p], vis: latByProv[p] ? (latByProv[p].visibility || 0) : null };
    }).filter(function (p) { return p.vis !== null; });

    if (provVis.length > 1) {
      var pvSorted = provVis.slice().sort(function (a, b) { return a.vis - b.vis; });
      var weakest  = pvSorted[0];
      var strongest = pvSorted[pvSorted.length - 1];
      var modGap = +(strongest.vis - weakest.vis).toFixed(1);
      if (modGap > 3) {
        var weakSrcs = (srcByProv[weakest.key] || []).slice(0, 3).map(function (s) { return s.domain; }).filter(Boolean);
        var allModItems = pvSorted.slice().reverse().map(function (p) {
          return p.label + ': ' + p.vis.toFixed(1) + '%' + (p.key === weakest.key ? ' (lowest)' : p.key === strongest.key ? ' (highest)' : '');
        });
        _aimExpandTodo({
          id: 'td-model-gap',
          priority: 'high',
          effort: 'Med effort',
          pageType: 'on-page',
          recType: 'content',
          aiTargets: [weakest.key],
          title: 'Target ' + weakest.label + ' specifically: you get ' + weakest.vis.toFixed(1) + '% visibility there vs ' + strongest.vis.toFixed(1) + '% on ' + strongest.label,
          signals: [
            weakest.label + ': ' + weakest.vis.toFixed(1) + '% visibility (your lowest-performing AI model)',
            strongest.label + ' leads at ' + strongest.vis.toFixed(1) + '%, a ' + modGap + '-point model gap',
            'Each AI model favors different source types and content formats'
          ],
          sigs_fav: [weakSrcs[0] || null, weakSrcs[0] || null, null],
          sigs_expand: [
            { heading: 'Visibility by AI model:', items: allModItems },
            (srcByProv[weakest.key] || []).slice(0, 5).length ? { heading: weakest.label + '\'s top cited domains:', items: (srcByProv[weakest.key] || []).slice(0, 5).map(function (s) { return s.domain + ': ' + s.citation_count + ' citations'; }) } : null,
            null
          ],
          reasoning: brand + ' gets ' + weakest.vis.toFixed(1) + '% visibility on ' + weakest.label + '. That is your lowest-performing model. ' + weakest.label + ' has its own preferred sources and content formats. Right now it is not pulling from anything that includes you. The gap is big enough that a targeted push on ' + weakest.label + '-favored sources can move the needle significantly.',
          steps: [
            'Create content matching the format ' + weakest.label + ' favors: typically detailed, structured, and authoritative',
            'Ensure content is fully crawlable: no JS-gated text, clean canonical URLs, updated sitemap',
            'Prioritize outreach and listing on domains that ' + weakest.label + ' references most'
          ],
          suggestions: [],
          exampleDomains: weakSrcs,
          examplesStrategy: 'model-specific',
          examplesModelKey: weakest.key,
          examplesHeading: 'Sources ' + weakest.label + ' cites most in your category',
          examplesNote: 'Getting onto these domains is your fastest path to visibility on ' + weakest.label + '.',
          outcome: 'A targeted 60-day push on ' + weakest.label + '-favored sources should raise your visibility on that model by 3-10 points.',
          platDomains: weakSrcs,
          brands: provVis.filter(function (p) { return provDomains[p.key]; }).slice(0, 3).map(function (p) { return { domain: provDomains[p.key], label: p.label }; })
        }).forEach(function (t) { todos.push(t); });
      }
    }

    // ── 5. Citation concentration risk ───────────────────────────
    if (topSources.length >= 4) {
      var top3Count = topSources.slice(0, 3).reduce(function (s, d) { return s + (d.citation_count || 0); }, 0);
      var top3Share = totalCitations > 0 ? Math.round((top3Count / totalCitations) * 100) : 0;
      if (top3Share > 50) {
        _aimExpandTodo({
          id: 'td-diversify',
          priority: 'medium',
          effort: 'High effort',
          pageType: 'off-page',
          recType: 'backlinks',
          aiTargets: activeProviders(),
          title: 'Diversify your citation sources: ' + top3Share + '% of AI citations come from just 3 domains',
          signals: [
            topSources[0].domain + ', ' + topSources[1].domain + ', and ' + topSources[2].domain + ' account for ' + top3Share + '% of citations',
            'Over-concentration means a single domain change can drop your visibility sharply',
            'Domains ranked 4-10 in Sources view are largely untapped, buildable opportunities'
          ],
          sigs_fav: [
            topSources.length > 3 ? topSources[3].domain : null,
            topSources.length > 3 ? topSources[3].domain : null,
            topSources.length > 4 ? topSources[4].domain : null
          ],
          sigs_expand: [
            { heading: 'Citation share by top 6 domains:', items: topSources.slice(0, 6).map(function (s, i) {
              var sh = totalCitations > 0 ? ((s.citation_count / totalCitations) * 100).toFixed(1) : '0';
              return '#' + (i + 1) + ' ' + s.domain + ': ' + s.citation_count + ' citations (' + sh + '%)';
            }) },
            { heading: 'Concentration risk:', items: [
              'If ' + topSources[0].domain + ' removes you: up to ' + Math.round((topSources[0].citation_count / totalCitations) * 100) + '% citation drop',
              'If ' + topSources[1].domain + ' removes you: up to ' + Math.round((topSources[1].citation_count / totalCitations) * 100) + '% citation drop',
              'Target: no single domain should exceed 20% of your total citations'
            ] },
            topSources.length > 3 ? { heading: 'Next-tier opportunities (positions 4-8):', items: topSources.slice(3, 8).map(function (s, i) { return '#' + (i + 4) + ' ' + s.domain + ': ' + s.citation_count + ' citations'; }) } : null
          ],
          reasoning: 'Most of your AI citations come from a handful of domains. If any of those sources remove or update the content that mentions you, your visibility drops immediately. Spreading citations across more domains makes your AI presence resilient. A single change cannot take you out of AI answers.',
          steps: [
            'Prioritize 2-3 new domains per quarter for active outreach, guest content, or product listing',
            'For each new domain, prepare a differentiated pitch matching their specific content format',
            'Set a target: at least 8 distinct domains each contributing meaningfully to your citation profile'
          ],
          suggestions: [],
          exampleDomains: topSources.slice(3, 7).map(function (s) { return s.domain; }),
          examplesStrategy: 'next-tier-strict',
          examplesHeading: 'Next-tier domains to target for citations',
          examplesNote: 'These domains already generate AI citations in your space. Getting ' + brand + ' onto them expands your profile.',
          outcome: 'A distributed citation profile reduces volatility and compounds over time as each new domain adds a persistent source of AI references.',
          platDomains: topSources.slice(0, 6).map(function (s) { return s.domain; }),
          brands: topSources.slice(0, 3).map(function (s) { return { domain: s.domain, label: s.domain }; })
        }).forEach(function (t) { todos.push(t); });
      }
    }

    // ── 6. Weakest topic cluster ──────────────────────────────────
    var topicGroups = {};
    prompts.forEach(function (p) {
      var topic = p.topic || 'General';
      if (!topicGroups[topic]) topicGroups[topic] = { count: 0, totalVis: 0, prompts: [] };
      topicGroups[topic].count++;
      topicGroups[topic].totalVis += (p.visibility_all || 0);
      topicGroups[topic].prompts.push(p);
    });
    var topicList = Object.keys(topicGroups).map(function (t) {
      var g = topicGroups[t];
      return { topic: t, avgVis: g.count > 0 ? g.totalVis / g.count : 0, count: g.count, prompts: g.prompts };
    }).filter(function (t) { return t.count >= 2; }).sort(function (a, b) { return a.avgVis - b.avgVis; });

    if (topicList.length > 0) {
      var weakTopic = topicList[0];
      if (weakTopic.avgVis < overallVis * 0.7 || weakTopic.avgVis < 5) {
        var clusterPrompts = weakTopic.prompts.slice().sort(function (a, b) { return (a.visibility_all || 0) - (b.visibility_all || 0); });
        _aimExpandTodo({
          id: 'td-topic-cluster',
          priority: 'medium',
          effort: 'Med effort',
          pageType: 'on-page',
          recType: 'content',
          aiTargets: activeProviders(),
          title: 'Build a content cluster for “' + weakTopic.topic + '”: currently ' + weakTopic.avgVis.toFixed(1) + '% visibility across ' + weakTopic.count + ' prompts',
          signals: [
            '”' + weakTopic.topic + '” has ' + weakTopic.count + ' tracked prompts averaging ' + weakTopic.avgVis.toFixed(1) + '% visibility',
            'Your overall average is ' + overallVis.toFixed(1) + '%. This cluster is ' + Math.round(overallVis - weakTopic.avgVis) + ' points below that.',
            'A focused content cluster compounds: improving one prompt lifts related ones too'
          ],
          sigs_fav: [null, null, topSources.length > 0 ? topSources[0].domain : null],
          sigs_expand: [
            { heading: '”' + weakTopic.topic + '” prompts with visibility:', items: clusterPrompts.slice(0, 8).map(function (p) { return '”' + p.prompt_text.substring(0, 65) + (p.prompt_text.length > 65 ? '...' : '') + '”: ' + (p.visibility_all || 0).toFixed(1) + '%'; }) },
            { heading: 'Cluster stats:', items: [
              'Cluster average: ' + weakTopic.avgVis.toFixed(1) + '%',
              'Your overall average: ' + overallVis.toFixed(1) + '%',
              'Gap: ' + (overallVis - weakTopic.avgVis).toFixed(1) + ' points below average',
              'Prompts at zero visibility: ' + clusterPrompts.filter(function (p) { return (p.visibility_all || 0) === 0; }).length + ' of ' + weakTopic.count
            ] },
            null
          ],
          reasoning: 'You track ' + weakTopic.count + ' prompts in the ' + weakTopic.topic + ' cluster. Your average visibility there is ' + weakTopic.avgVis.toFixed(1) + '%. AI models are answering those questions without mentioning you because there is no content for them to pull from. A topic cluster approach, using one pillar page plus supporting articles, is the most efficient way to close this gap.',
          steps: [
            'Write a pillar page comprehensively covering “' + weakTopic.topic + '” from ' + brand + '\'s perspective: 2000+ words with structured headings and a FAQ section',
            'Write 3-5 supporting articles covering sub-topics, each linking back to the pillar page',
            'Include original data, a process framework, or a clear conclusion so AI has a citable, quotable answer',
            'Submit the pillar URL to Google Search Console immediately on publish'
          ],
          suggestions: [],
          exampleDomains: topSources.slice(0, 3).map(function (s) { return s.domain; }),
          examplesStrategy: 'topic-editorial',
          examplesTopicKeywords: [weakTopic.topic],
          examplesHeading: 'What\'s getting cited in the “' + weakTopic.topic + '” space right now',
          examplesNote: 'Use these pages as a benchmark for depth and format when writing your cluster content.',
          outcome: 'A well-executed topic cluster typically lifts AI visibility in that category by 10-20 points within 2-3 months of indexing.',
          platDomains: topSources.slice(0, 4).map(function (s) { return s.domain; }),
          brands: topSources.slice(0, 2).map(function (s) { return { domain: s.domain, label: s.domain }; })
        }).forEach(function (t) { todos.push(t); });
      }
    }

    // ── 7. Competitor sentiment opportunity ───────────────────────
    var lowSentComp = competitors.find(function (c) {
      return c.visibility > overallVis && c.sentiment && c.sentiment < 55;
    });
    if (lowSentComp) {
      var lscDomain = injDomainMap[lowSentComp.name.toLowerCase()] || '';
      var lscTargProvs = providersWhereCompVisible(lowSentComp.name);
      if (!lscTargProvs.length) lscTargProvs = activeProviders();
      _aimExpandTodo({
        id: 'td-sentiment-opp',
        priority: 'medium',
        effort: 'Med effort',
        pageType: 'on-page',
        recType: 'content',
        aiTargets: lscTargProvs,
        title: 'Publish a “' + lowSentComp.name + ' alternatives” page: they have ' + lowSentComp.visibility.toFixed(1) + '% visibility but only ' + lowSentComp.sentiment + '% positive sentiment',
        signals: [
          lowSentComp.name + ' has ' + lowSentComp.visibility.toFixed(1) + '% visibility but only ' + lowSentComp.sentiment + '% positive sentiment',
          'High visibility with mixed sentiment: AI mentions them but often with caveats',
          brand + ' can own the “better alternative” narrative in these conversations'
        ],
        sigs_fav: [lscDomain, lscDomain, null],
        sigs_expand: [null, null, null],
        reasoning: lowSentComp.name + ' is in ' + lowSentComp.visibility.toFixed(1) + '% of AI conversations, but its sentiment score is ' + lowSentComp.sentiment + '%. That means AI is mentioning them but often in a cautious or mixed way. When buyers read those answers, they are already looking for an alternative. You want to be the one named.',
        steps: [
          'Research the specific issues driving ' + lowSentComp.name + '\'s negative sentiment: check G2, Trustpilot, and Reddit for common complaints',
          'Frame content around user outcomes and pain points, not just feature comparisons',
          'Get the page listed on comparison platforms and review sites visible in Sources view'
        ],
        suggestions: [
          {
            title: 'Build a “' + brand + ' vs ' + lowSentComp.name + '” page with a feature matrix and pricing comparison',
            steps: [
              'Map ' + lowSentComp.name + '\'s pricing tiers and feature set from their public website and G2 profile',
              'Build a side-by-side comparison table with ' + brand + ' and ' + lowSentComp.name + ' as columns, using your strongest differentiation points as rows',
              'Add a clear “best for” recommendation at the top: “Best for [specific use case]: ' + brand + '”',
              'Add FAQPage schema with the question “' + brand + ' vs ' + lowSentComp.name + ': which is better?” and a structured answer'
            ],
            signals: [
              'Comparison pages are the most-cited content type when AI answers “X vs Y” or “X alternative” queries',
              lowSentComp.name + ' has a below-neutral AI sentiment score, making buyers actively search for alternatives',
              'A dedicated comparison page gives AI a structured, citable source for positioning ' + brand + ' as the alternative'
            ]
          },
          {
            title: 'Engage on Reddit threads where ' + lowSentComp.name + ' receives criticism and recommend ' + brand + ' authentically',
            steps: [
              'Search Reddit for “' + lowSentComp.name + ' problem”, “' + lowSentComp.name + ' alternative”, and “' + lowSentComp.name + ' cancelled” threads',
              'Read each thread carefully before engaging: respond only where ' + brand + ' is a genuine fit for the problem described',
              'Write a detailed, helpful response that leads with empathy for the problem, then explains why ' + brand + ' solves it',
              'Focus on threads with high upvote counts: AI citation weight correlates with thread engagement'
            ],
            signals: [
              'Reddit threads criticizing ' + lowSentComp.name + ' are already being cited by AI as evidence of problems with that brand',
              'Authentic, high-quality Reddit mentions of ' + brand + ' as an alternative create persistent AI citations',
              lowSentComp.name + '\'s below-neutral sentiment score means buyers are actively searching for alternatives in these threads'
            ]
          }
        ],
        exampleDomains: [lscDomain].filter(Boolean).concat(topSources.slice(0, 2).map(function (s) { return s.domain; })),
        examplesContextName: lowSentComp.name,
        examplesStrategy: 'alternatives-vs',
        examplesHeading: 'Content positioning against ' + lowSentComp.name,
        examplesNote: 'These pages already rank in AI results alongside ' + lowSentComp.name + '. Model your comparison content on them.',
        outcome: 'Comparison and alternative content typically generates AI citations within 4-8 weeks and can shift share of voice when a competitor has persistent sentiment issues.',
        platDomains: [lscDomain].filter(Boolean).concat(topSources.slice(0, 2).map(function (s) { return s.domain; })),
        brands: [{ domain: lscDomain, label: lowSentComp.name }].filter(function (b) { return b.domain; })
      }).forEach(function (t) { todos.push(t); });
    }

    // ── 8. Commercial intent prompts ─────────────────────────────
    var commercialPrompts = prompts.filter(function (p) { return (p.intent || '').toLowerCase().indexOf('commercial') > -1; });
    if (commercialPrompts.length > 0) {
      var commAvg = commercialPrompts.reduce(function (s, p) { return s + (p.visibility_all || 0); }, 0) / commercialPrompts.length;
      if (commAvg < overallVis * 0.85 || commAvg < 5) {
        var commZeroCount = commercialPrompts.filter(function (p) { return (p.visibility_all || 0) === 0; }).length;
        _aimExpandTodo({
          id: 'td-commercial',
          priority: 'medium',
          effort: 'Med effort',
          pageType: 'on-page',
          recType: 'content',
          aiTargets: activeProviders(),
          title: 'Improve visibility on buying-intent queries: ' + commercialPrompts.length + ' commercial prompts average just ' + commAvg.toFixed(1) + '%',
          signals: [
            commercialPrompts.length + ' commercial-intent prompts averaging ' + commAvg.toFixed(1) + '% visibility',
            'These are high-converting queries: buyers comparing options and close to a decision',
            commZeroCount + ' of these commercial prompts have zero ' + brand + ' mentions'
          ],
          sigs_fav: [(topSources.find(function (s) { return s.domain !== 'reddit.com' && s.domain !== 'www.reddit.com'; }) || {}).domain || null, null, null],
          sigs_expand: [
            { heading: 'Commercial-intent prompts by visibility:', items: commercialPrompts.slice().sort(function (a, b) { return (a.visibility_all || 0) - (b.visibility_all || 0); }).slice(0, 8).map(function (p) { return '”' + p.prompt_text.substring(0, 65) + (p.prompt_text.length > 65 ? '...' : '') + '”: ' + (p.visibility_all || 0).toFixed(1) + '%'; }) },
            null, null
          ],
          reasoning: brand + ' shows up in ' + commAvg.toFixed(1) + '% of commercial-intent queries. These are the prompts where someone is actively comparing tools and getting ready to buy. You are not in most of those answers. The people closest to a purchasing decision are not seeing your name.',
          steps: [
            'Ensure every commercial page has a clear, quotable conclusion AI can surface directly in an answer',
            'Submit new commercial pages to G2, Capterra, and category review platforms visible in Sources view'
          ],
          suggestions: [
            {
              title: 'Build a pricing and comparison page with a feature matrix vs top alternatives and clear ROI framing',
              steps: [
                'Structure the page with ' + brand + '\'s pricing at the top, followed by a transparent feature matrix comparing 3-4 top alternatives',
                'Add an ROI calculator or example savings scenario that quantifies the value of choosing ' + brand,
                'Include a "best for" section mapping each pricing tier to a specific buyer type',
                'Add FAQPage schema with the most common commercial-intent questions from your tracked prompt list'
              ],
              signals: [
                'Pricing pages with comparison tables are among the most-cited content by AI on commercial-intent queries',
                'AI uses ROI framing and cost data to help buyers justify a purchase decision in its answers',
                'A dedicated comparison page gives AI a direct, structured source to pull from when buyers ask which tool to buy'
              ]
            },
            {
              title: 'Create use-case landing pages for each major buyer persona from your commercial prompts',
              steps: [
                'Extract the 3-5 most common buyer types implied by your commercial-intent prompts (e.g., "agency", "enterprise team", "solo founder")',
                'Build a dedicated landing page for each persona with specific use cases, outcomes, and social proof relevant to them',
                'Use the persona type in the page URL and H1 (e.g., "' + brand + ' for agencies: X% faster workflow")',
                'Add Article or SoftwareApplication schema to each page with a targeted "best for [persona]" field'
              ],
              signals: [
                'Use-case pages give AI persona-specific answers to pull from on commercial-intent queries',
                'Buyers who identify with a specific persona convert at significantly higher rates from AI answers that name their use case',
                'A dedicated URL per persona is indexed and cited individually, multiplying commercial-intent coverage'
              ]
            },
            {
              title: 'Write a case study or ROI calculator page: these are heavily cited by AI on decision-stage queries',
              steps: [
                'Choose your strongest customer outcome (highest ROI or most dramatic before/after result) as the foundation',
                'Structure the case study with a "problem, solution, result" format and include a specific metric in the headline',
                'Alternatively, build an ROI calculator that takes 2-3 inputs (team size, current tool cost, time spent) and outputs a projected saving',
                'Publish at a dedicated URL and add Article schema so AI can extract the result data directly'
              ],
              signals: [
                'Case studies and ROI calculators are the most-cited content type by AI when a buyer is close to a decision',
                'AI uses specific metrics from case studies to justify a recommendation (e.g., "customers report X% time savings")',
                'A tool like an ROI calculator also attracts backlinks and repeat visits, increasing its citation weight over time'
              ]
            }
          ],
          exampleDomains: topSources.slice(0, 3).map(function (s) { return s.domain; }),
          examplesStrategy: 'commercial-review',
          examplesHeading: 'What AI cites for buying-intent queries in your category',
          examplesNote: 'Getting ' + brand + ' onto these pages means showing up when buyers are evaluating options.',
          outcome: 'Lifting commercial-intent visibility to match your overall average puts ' + brand + ' in front of buyers at their highest-intent moment.',
          platDomains: topSources.slice(0, 5).map(function (s) { return s.domain; }),
          brands: topSources.slice(0, 2).map(function (s) { return { domain: s.domain, label: s.domain }; })
        }).forEach(function (t) { todos.push(t); });
      }
    }

    // ── 9. Reddit presence ────────────────────────────────────────
    var redditSrc = topSources.find(function (s) { return s.domain === 'reddit.com'; });
    if (redditSrc && redditSrc.citation_count > 3) {
      var redditShare = totalCitations > 0 ? Math.round((redditSrc.citation_count / totalCitations) * 100) : 0;
      var redditProviders = ['chatgpt', 'gemini', 'perplexity'].filter(function (p) {
        return (srcByProv[p] || []).find(function (s) { return s.domain === 'reddit.com' && s.citation_count > 0; });
      });
      if (!redditProviders.length) redditProviders = ['chatgpt', 'gemini', 'perplexity'];
      var redditByProv = allProviders.filter(function (p) { return srcByProv[p]; }).map(function (p) {
        var entry = (srcByProv[p] || []).find(function (s) { return s.domain === 'reddit.com'; });
        return provLabels[p] + ': ' + (entry ? entry.citation_count + ' Reddit citations' : '0');
      });
      _aimExpandTodo({
        id: 'td-reddit',
        priority: 'medium',
        effort: 'Med effort',
        pageType: 'off-page',
        recType: 'reddit',
        aiTargets: redditProviders,
        title: 'Get mentioned in Reddit threads: reddit.com drives ' + redditSrc.citation_count + ' AI citations in your space (' + redditShare + '%)',
        signals: [
          'reddit.com appears in ' + redditSrc.citation_count + ' monitored AI responses in your space',
          'Reddit threads are heavily weighted by ChatGPT, Gemini, and Perplexity for product recommendations',
          brand + ' likely has little or no presence in the threads AI models are currently citing'
        ],
        sigs_fav: ['reddit.com', 'reddit.com', null],
        sigs_expand: [
          redditByProv.length ? { heading: 'Reddit citation count by AI model (' + _periodLabel + '):', items: redditByProv } : null,
          { heading: 'Reddit vs other top citation domains (' + _periodLabel + '):', items: topSources.slice(0, 5).map(function (s) { return s.domain + ': ' + s.citation_count + ' citations' + (s.domain === 'reddit.com' ? ' (Reddit)' : ''); }) },
          null
        ],
        reasoning: 'AI models cited Reddit ' + redditSrc.citation_count + ' times across your tracked prompts. Those Reddit threads are directly influencing what AI recommends in your category. Right now ' + brand + ' is not part of those conversations. Getting recommended in active threads means getting cited by AI for months or years as AI models continue indexing community discussions.',
        steps: [
          'Search those subreddits for “best X”, “X alternative”, “switched from X” threads where ' + brand + ' is absent',
          'Engage authentically in existing threads: provide a genuinely helpful, detailed answer where ' + brand + ' is the accurate solution',
          'Aim for comment depth over volume: a single well-upvoted response outperforms 10 shallow ones in AI citation weight'
        ],
        suggestions: [
          'Create original resources for the identified subreddits: benchmark data, free tools, or how-to guides. Data-heavy posts are cited by AI at higher rates.'
        ],
        exampleDomains: ['reddit.com'],
        examplesHeading: 'Reddit threads AI is already citing in your category',
        examplesNote: 'These are the exact threads shaping AI recommendations. Engage in them or model your own posts on them.',
        outcome: 'Reddit mentions in popular threads generate persistent AI citations for 12-24 months as AI models continue to index community discussions.',
        platDomains: ['reddit.com'].concat(topSources.slice(0, 2).map(function (s) { return s.domain; })),
        brands: [{ domain: 'reddit.com', label: 'Reddit' }]
      }).forEach(function (t) { todos.push(t); });
    }

    // ── 10. Brand sentiment below neutral ─────────────────────────
    var brandSentVals = activeProviders().map(function (p) {
      return latByProv[p] && latByProv[p].sentiment != null ? latByProv[p].sentiment : null;
    }).filter(function (s) { return s !== null; });
    var avgBrandSent = brandSentVals.length > 0 ? brandSentVals.reduce(function (a, b) { return a + b; }, 0) / brandSentVals.length : null;
    if (avgBrandSent !== null && avgBrandSent < 58) {
      var sentByModel = activeProviders().map(function (p) {
        return latByProv[p] && latByProv[p].sentiment != null ? provLabels[p] + ': ' + latByProv[p].sentiment + '% positive' : null;
      }).filter(Boolean);
      _aimExpandTodo({
        id: 'td-brand-sentiment',
        priority: 'high',
        effort: 'High effort',
        pageType: 'on-page',
        recType: 'content',
        aiTargets: activeProviders(),
        title: 'Fix how AI describes ' + brand + ': average sentiment is ' + Math.round(avgBrandSent) + '% positive across models',
        signals: [
          brand + '\'s average AI sentiment is ' + Math.round(avgBrandSent) + '%, below the neutral 60% threshold',
          'AI pulls sentiment signals from reviews, community posts, and comparison content it has indexed',
          'Mixed or cautious descriptions reduce conversion even when you\'re mentioned'
        ],
        sigs_fav: [(topSources.find(function (s) { return s.domain !== 'reddit.com' && s.domain !== 'www.reddit.com'; }) || {}).domain || null, null, null],
        sigs_expand: [
          sentByModel.length ? { heading: brand + '\'s sentiment by AI model:', items: sentByModel } : null,
          { heading: 'Sentiment score benchmarks:', items: [
            'Below 50%: AI describes ' + brand + ' with caveats or negatively',
            '50-65%: neutral: mentioned without a clear recommendation',
            '65-80%: positive: AI leans toward recommending ' + brand,
            'Above 80%: strong positive: AI actively endorses ' + brand
          ] },
          null
        ],
        reasoning: 'AI does not just mention ' + brand + ': it frames the mention with qualifiers drawn from indexed content. A ' + Math.round(avgBrandSent) + '% sentiment score means AI is either neutral or adding caveats. A buyer reading that response is less likely to act. The fix is to publish positive, quotable content AI will pull from: case studies with hard metrics, verified reviews, and press coverage that frames ' + brand + ' as the clear winner for specific use cases.',
        steps: [],
        suggestions: [
          {
            title: 'Run a G2 and Trustpilot review campaign: target 20+ new verified reviews in the next 30 days',
            steps: [
              'Export your current customer list and identify your 50 most active or successful users to contact first',
              'Send a personal email asking for an honest review, linking directly to your G2 and Trustpilot profile pages',
              'Follow up once after 5 days: a short, friendly reminder doubles response rates',
              'Respond publicly to all reviews within 48 hours, especially critical ones, to signal active management to AI'
            ],
            signals: [
              'G2 and Trustpilot are among the highest-authority review platforms AI models pull sentiment signals from',
              'Review volume and recency both influence how AI frames a brand\'s reputation in responses',
              '20+ new reviews in 30 days is enough to begin shifting the sentiment calculation AI uses'
            ]
          },
          {
            title: 'Create a case studies page with 3-5 customer stories, each with specific metrics and named customers',
            steps: [
              'Identify 3-5 customers who have achieved measurable results (time saved, revenue, cost reduction) with ' + brand,
              'Interview each customer and capture specific metrics, before/after comparisons, and a named quote',
              'Publish each story as a dedicated URL with Article schema so AI can parse and cite it directly',
              'Add a summary stats callout to each page (e.g., "Reduced onboarding time by 60% in 30 days")'
            ],
            signals: [
              'Case studies with named customers and hard metrics are among the most-cited content types by AI for positive sentiment signals',
              'A dedicated URL per case study is indexed and cited individually, compounding the citation value',
              'Structured proof points (metrics, quotes, named customers) are what AI extracts when framing a brand positively'
            ]
          },
          {
            title: 'Write blog posts addressing the top criticism angles found in Reddit and reviews',
            steps: [
              'Search Reddit, G2, Trustpilot, and Capterra for the 5 most common criticisms or objections about ' + brand,
              'Write a candid, direct blog post for each objection, addressing it head-on with evidence or context',
              'Frame each post as "[Objection]: Here is what actually happens and why" to match how critics phrase the issue',
              'Add FAQPage schema to each post using the criticism as the question and the response as the answer'
            ],
            signals: [
              'AI pulls criticism angles from Reddit threads and review platforms and uses them as sentiment qualifiers in responses',
              'Directly indexed content that addresses criticisms gives AI a counter-narrative to pull from',
              'Posts that match the exact phrasing of common objections are more likely to be cited alongside those objections'
            ]
          },
          {
            title: 'Pitch a founder story to a media outlet AI cites: narrative framing shapes how AI describes your brand',
            steps: [
              'Identify 3 media outlets in Sources view that already generate AI citations in your space',
              'Draft a founder story angle: the specific problem that led to ' + brand + ', told with concrete details and data',
              'Find the editor or writer who covers your category at each outlet using LinkedIn or their author page',
              'Send a concise pitch (under 200 words) with the story angle, one data point, and a clear offer to interview'
            ],
            signals: [
              'Media coverage creates high-authority citations that AI uses to frame how it describes a brand',
              'Founder and origin stories are a reliable angle for tech and industry publications',
              'A single article on an AI-cited domain can shift how AI frames ' + brand + ' across all tracked models'
            ]
          },
          {
            title: 'Build a "Why teams switch to ' + brand + '" page with before/after comparisons and direct user quotes',
            steps: [
              'Survey or interview 10 customers who switched from a competitor and ask them to describe the specific moment they decided to switch',
              'Structure the page around the 3-5 most common switching reasons, each with a named user quote and metric',
              'Include a simple comparison table showing the before state (with the prior tool) and the after state (with ' + brand + ')',
              'Optimize the page URL slug for "' + brand + ' vs [competitor]" and "[competitor] alternative" query patterns'
            ],
            signals: [
              '"Why switch" pages are among the most-cited content by AI when buyers ask for alternatives to a specific competitor',
              'User quotes create quotable, AI-extractable content that AI uses to describe a brand\'s strengths',
              'A dedicated switching page targets the highest-intent buyers who are actively evaluating alternatives'
            ]
          }
        ],
        exampleDomains: topSources.slice(0, 3).map(function (s) { return s.domain; }),
        examplesStrategy: 'editorial-guide',
        examplesHeading: 'Content types AI draws sentiment signals from',
        examplesNote: 'Case studies, detailed reviews, and positive comparison writeups are the formats AI uses to calibrate brand sentiment.',
        outcome: 'A 10-point lift in sentiment (from ' + Math.round(avgBrandSent) + '% to ' + Math.round(avgBrandSent + 10) + '%) typically takes 60-90 days with consistent review and content activity.',
        platDomains: topSources.slice(0, 3).map(function (s) { return s.domain; }),
        brands: topSources.slice(0, 2).map(function (s) { return { domain: s.domain, label: s.domain }; })
      }).forEach(function (t) { todos.push(t); });
    }

    // ── 11. Poor mention position ──────────────────────────────────
    var posVals = activeProviders().map(function (p) {
      return latByProv[p] && latByProv[p].position != null ? latByProv[p].position : null;
    }).filter(function (v) { return v !== null; });
    var avgMentionPos = posVals.length > 0 ? posVals.reduce(function (a, b) { return a + b; }, 0) / posVals.length : null;
    var snapAvgPos = snap.overall_avg_position || avgMentionPos;
    if (snapAvgPos && snapAvgPos > 5) {
      var posByModel = activeProviders().map(function (p) {
        return latByProv[p] && latByProv[p].position != null ? provLabels[p] + ': position ' + latByProv[p].position.toFixed(1) : null;
      }).filter(Boolean);
      _aimExpandTodo({
        id: 'td-position',
        priority: 'medium',
        effort: 'Med effort',
        pageType: 'on-page',
        recType: 'content',
        aiTargets: activeProviders(),
        title: 'Move up in AI responses: ' + brand + ' is named at position ' + snapAvgPos.toFixed(1) + ' on average. Competitors named first capture more attention.',
        signals: [
          brand + ' appears at position ' + snapAvgPos.toFixed(1) + ' on average. Brands named first get significantly higher click intent.',
          'Position is set by how listicle and comparison pages order tools. Content strategy can directly move this.',
          'A one-position improvement compounds across every AI response that mentions ' + brand
        ],
        sigs_fav: [(topSources.find(function (s) { return s.domain !== 'reddit.com' && s.domain !== 'www.reddit.com'; }) || {}).domain || null, null, null],
        sigs_expand: [
          posByModel.length ? { heading: brand + '\'s average mention position by model:', items: posByModel } : null,
          { heading: 'What drives an earlier mention position:', items: [
            'Being listed first in comparison and roundup articles AI cites',
            'High citation frequency across many domains (volume signals authority)',
            'Structured data that lets AI extract a direct, clean answer',
            'Authoritative content that definitively places ' + brand + ' as the top option for specific use cases'
          ] },
          null
        ],
        reasoning: 'When AI lists multiple tools, position matters. The first brand named captures more clicks and conversions. ' + brand + ' is being mentioned but at position ' + snapAvgPos.toFixed(1) + '. Moving up requires the indexable web to consistently list ' + brand + ' first or second in comparison and listicle content, not fourth or fifth. The most direct lever is getting featured at the top of the specific comparison pages AI currently cites in Sources view.',
        steps: [
          'Increase citation density: the more domains cite ' + brand + ', the more AI associates it with authority in the category',
          'Add a concise "best for" label on every product page so AI has a structured signal to determine ranking order'
        ],
        suggestions: [
          {
            title: 'Create original "best [category]" content on ' + brand + '\'s own domain with ' + brand + ' ranked first',
            steps: [
              'Research the top 5 "best [category] tools" articles in Sources view and note how tools are ranked and described',
              'Write your own "best [category] tools" post on ' + brand + '\'s blog, with ' + brand + ' ranked first with a clear "best overall" justification',
              'Structure the post with individual sections per tool so AI can extract a clean, structured answer',
              'Add FAQPage schema with the question "what is the best [category] tool?" and ' + brand + ' as the direct answer'
            ],
            signals: [
              'AI pulls from "best of" listicle content to determine the order tools are mentioned in recommendation responses',
              'First-party content where ' + brand + ' ranks itself first creates a citable data point AI weighs alongside third-party sources',
              'A dedicated "best [category]" URL is indexed as an authority signal that compounds with each citation'
            ]
          },
          {
            title: 'Publish a "why ' + brand + ' is the best option for [use case]" landing page for each major use case',
            steps: [
              'Identify the 3 most specific use cases mentioned across your tracked commercial prompts',
              'For each use case, write a page with a clear argument: include customer quotes, specific features, and outcomes',
              'Use the exact use case phrasing from your tracked prompts in the page title and H1 so AI can match query intent',
              'Submit each page to Google Search Console immediately after publishing for fast indexing'
            ],
            signals: [
              'Use-case-specific pages are more likely to appear at position 1-2 in AI answers than generic product pages',
              'AI uses exact-match content to determine which tool to name first for a specific use case query',
              'Multiple use-case pages increase the number of queries where ' + brand + ' appears at position 1'
            ]
          },
          {
            title: 'Get ' + brand + ' featured as the top pick on at least 3 of the comparison sites AI currently cites',
            steps: [
              'Identify the 3-5 comparison and roundup articles in Sources view that drive the most AI citations in your space',
              'Find the editor or author of each article and reach out with a specific pitch: what ' + brand + ' does better than the current top pick, with evidence',
              'Offer a unique data point, case study, or exclusive quote the author can use in their next update',
              'Follow up after 2 weeks if no response: article updates are high-value and worth a second contact'
            ],
            signals: [
              '"Editor\'s pick" and top placements in comparison articles are the strongest signal for a higher mention position in AI',
              'Third-party sources that rank ' + brand + ' first carry more weight with AI than first-party claims',
              'Appearing in the top slot on 3 high-authority comparison pages is enough to shift average mention position by 1-2 positions'
            ]
          }
        ],
        exampleDomains: topSources.slice(0, 4).map(function (s) { return s.domain; }),
        examplesStrategy: 'commercial-review',
        examplesHeading: 'Comparison and listicle pages that set the mention order in AI responses',
        examplesNote: 'Getting ' + brand + ' listed first on these pages directly shifts average mention position.',
        outcome: 'Moving from position ' + snapAvgPos.toFixed(1) + ' to position 3 or below can double the conversion impact of each AI mention.',
        platDomains: topSources.slice(0, 4).map(function (s) { return s.domain; }),
        brands: topSources.slice(0, 2).map(function (s) { return { domain: s.domain, label: s.domain }; })
      }).forEach(function (t) { todos.push(t); });
    }

    // ── 12. Second competitor gap ──────────────────────────────────
    if (competitors.length >= 2) {
      var sec = competitors[1];
      var secGap = Math.round(sec.visibility - overallVis);
      var secDomain = injDomainMap[(sec.name || '').toLowerCase()] || '';
      if (secGap > 5) {
        var secHm = hmSnap[sec.name] || {};
        var secHmItems = Object.keys(secHm).filter(function (k) { return provLabels[k]; }).map(function (k) {
          return provLabels[k] + ': ' + secHm[k].toFixed(1) + '%';
        });
        _aimExpandTodo({
          id: 'td-second-comp',
          priority: 'medium',
          effort: 'High effort',
          pageType: 'on-page',
          recType: 'content',
          aiTargets: providersWhereCompVisible(sec.name).length ? providersWhereCompVisible(sec.name) : activeProviders(),
          title: 'Close the gap with ' + sec.name + ': they have ' + sec.visibility.toFixed(1) + '% AI visibility vs your ' + overallVis.toFixed(1) + '%',
          signals: [
            sec.name + ' appears in ' + (sec.mention_count || Math.round(sec.visibility * totalRuns / 100)) + ' AI responses across your tracked prompts',
            sec.name + ' leads ' + brand + ' by ' + secGap + ' visibility points',
            sec.sentiment ? sec.name + '\'s sentiment is ' + sec.sentiment + '%: ' + (sec.sentiment > 65 ? 'a benchmark to match in your content positioning' : 'an opening for ' + brand + ' to own a more positive narrative') : 'Closing this gap puts ' + brand + ' among the top 2 most-cited tools in your space'
          ],
          sigs_fav: [secDomain, secDomain, null],
          sigs_expand: [
            secHmItems.length ? { heading: sec.name + '\'s visibility by AI model:', items: secHmItems } : null,
            { heading: 'Visibility ranking in your category:', items: [
              '#1 ' + competitors[0].name + ': ' + competitors[0].visibility.toFixed(1) + '%',
              '#2 ' + sec.name + ': ' + sec.visibility.toFixed(1) + '%',
              brand + ' (current): ' + overallVis.toFixed(1) + '%',
              'Gap to ' + sec.name + ': ' + secGap + ' points'
            ] },
            null
          ],
          reasoning: sec.name + ' sits at #2 in your category with ' + sec.visibility.toFixed(1) + '% AI visibility. You are ' + secGap + ' points behind them. Closing this gap is a more achievable near-term goal than overtaking the category leader, and it puts ' + brand + ' in second position, where AI consistently names you alongside ' + competitors[0].name + '. A targeted content and citation push focused on ' + sec.name + ' comparison content can close this in 60-90 days.',
          steps: [
            'Check ' + sec.name + '\'s G2 and Trustpilot reviews for common complaints and build content angles around those gaps'
          ],
          suggestions: [
            {
              title: 'Publish a "' + brand + ' vs ' + sec.name + '" comparison page with feature matrix and pricing',
              steps: [
                'Research ' + sec.name + '\'s public pricing, features, and differentiators from their website, G2, and Trustpilot',
                'Build a feature matrix table with ' + brand + ' and ' + sec.name + ' as columns, focusing on categories where ' + brand + ' wins clearly',
                'Include a direct "bottom line" recommendation at the top: "If you need X, choose ' + brand + '. If you need Y, ' + sec.name + ' may work better."',
                'Add FAQPage schema with the question "' + brand + ' vs ' + sec.name + ': which is better?" and a concise, honest answer'
              ],
              signals: [
                '"' + brand + ' vs ' + sec.name + '" pages are cited every time AI answers a comparison query between these two tools',
                sec.name + ' generates ' + sec.visibility.toFixed(1) + '% AI visibility, largely from comparison and roundup content',
                'A dedicated comparison page gives AI a ' + brand + '-owned, structured source to pull from instead of third-party comparisons'
              ]
            },
            {
              title: 'Find Reddit threads comparing ' + sec.name + ' with alternatives and engage with detailed, helpful responses',
              steps: [
                'Search Reddit for "' + sec.name + ' alternative", "vs ' + sec.name + '", and "' + sec.name + ' worth it" threads',
                'Read at least 10 threads before engaging: respond only where ' + brand + ' is a genuine fit for the problem described',
                'Write a substantive response (400+ words) that explains the specific difference and when ' + brand + ' is the right choice',
                'Aim for threads with 50+ upvotes or comments: these carry the most AI citation weight'
              ],
              signals: [
                'Reddit comparison threads are among the most-cited content by AI for "' + brand + ' vs ' + sec.name + '" and "' + sec.name + ' alternative" queries',
                'A detailed, well-upvoted Reddit response creates a citation that AI pulls from for months',
                sec.name + ' appears in ' + sec.visibility.toFixed(1) + '% of AI responses: Reddit threads discussing them are high-traffic entry points'
              ]
            },
            {
              title: 'Map every prompt where ' + sec.name + ' appears and ' + brand + ' does not: write content targeting each one',
              steps: [
                'Go to the Prompts view in this dashboard and identify every prompt where ' + sec.name + ' has a higher visibility score than ' + brand,
                'For each prompt where you score 0% and ' + sec.name + ' scores above 0%, write one targeted piece of content that directly answers that query',
                'Ensure each piece includes ' + brand + ' as the recommended solution with specific supporting evidence',
                'Prioritize prompts with the highest ' + sec.name + ' visibility scores first: these represent the largest visibility gap'
              ],
              signals: [
                'Every prompt where ' + sec.name + ' appears and ' + brand + ' does not is a direct buyer touchpoint ' + brand + ' is missing',
                'Content specifically written to answer a tracked prompt increases visibility on that prompt within 4-8 weeks',
                'Closing the prompt gap with ' + sec.name + ' is more achievable than matching their overall citation volume'
              ]
            },
            {
              title: 'Get ' + brand + ' featured on every comparison or roundup article that currently includes ' + sec.name,
              steps: [
                'Use Sources view to find the domains and articles generating the most citations for ' + sec.name,
                'For each article, find the author or editor contact and send a short pitch explaining ' + brand + '\'s unique value and why it belongs alongside ' + sec.name,
                'Include a specific differentiator and one customer metric in your outreach: editors want a concrete reason to update an article',
                'Target the 5 highest-citation articles first: getting onto those alone can close a significant share of the visibility gap'
              ],
              signals: [
                'Roundup and comparison articles that include ' + sec.name + ' are a primary driver of their AI visibility advantage',
                'Getting onto the same articles that include ' + sec.name + ' directly reduces their relative advantage over ' + brand,
                'A placement on a high-authority comparison article generates AI citations for 12-24 months'
              ]
            }
          ],
          exampleDomains: [secDomain].filter(Boolean),
          examplesContextName: sec.name,
          examplesStrategy: 'alternatives-vs',
          examplesHeading: 'Pages driving ' + sec.name + '\'s AI visibility',
          examplesNote: 'These are the sources giving ' + sec.name + ' its citations. Getting ' + brand + ' onto these pages directly closes the gap.',
          outcome: 'A focused 60-day push on ' + sec.name + ' comparison content can close the gap by half and move ' + brand + ' into the top 2 most-cited tools.',
          platDomains: [secDomain].filter(Boolean).concat(topSources.slice(0, 3).map(function (s) { return s.domain; })),
          brands: [{ domain: secDomain, label: sec.name }].filter(function (b) { return b.domain; })
        }).forEach(function (t) { todos.push(t); });
      }
    }

    // ── 13. Add structured data for AI parseability ────────────────
    if (zeroPrompts.length >= 2 || overallVis < 10) {
      var questionPrompts = prompts.filter(function (p) {
        return /^(what|how|which|who|where|when|why|can|should|is|are|does|do)\b/i.test((p.prompt_text || '').trim());
      });
      _aimExpandTodo({
        id: 'td-schema',
        priority: 'medium',
        effort: 'Low effort',
        pageType: 'on-page',
        recType: 'technical-seo',
        aiTargets: activeProviders(),
        title: 'Add FAQ and HowTo schema to your key pages: structured data is what AI parses first',
        signals: [
          questionPrompts.length + ' of your tracked prompts are phrased as direct questions, exactly what FAQPage schema is built to answer',
          'Structured data makes content machine-readable: AI extracts answers without interpreting prose',
          'Pages without schema compete against ones that have it, and consistently lose'
        ],
        sigs_fav: [(topSources.find(function (s) { return s.domain !== 'reddit.com' && s.domain !== 'www.reddit.com'; }) || {}).domain || null, null, null],
        sigs_expand: [
          questionPrompts.length > 0 ? { heading: 'Your question-format prompts (' + questionPrompts.length + '):', items: questionPrompts.slice(0, 8).map(function (p) { return '"' + p.prompt_text.substring(0, 70) + (p.prompt_text.length > 70 ? '...' : '') + '"'; }) } : null,
          { heading: 'Schema types that lift AI citation rates:', items: [
            'FAQPage schema: use exact tracked prompt phrasing as the question text',
            'HowTo schema: for process and tutorial content',
            'Article schema: for blog content with clear author attribution',
            'SoftwareApplication schema: for your product and pricing pages'
          ] },
          null
        ],
        reasoning: 'AI models parse structured data before reading prose. A page with FAQ schema that directly answers "what is the best X tool" gives AI a clean, extractable answer to cite. Without schema, even strong content loses to a competitor\'s structured page. ' + brand + ' has ' + zeroPrompts.length + ' prompts at zero visibility. Adding schema to existing key pages is the lowest-effort, fastest-impact change available: no new content needed, only markup.',
        steps: [
          'Identify the 5-10 pages on ' + brand + '\'s site that should be cited for your tracked prompt categories',
          'Add FAQPage schema to every page that answers a question, using the exact prompt phrasing as the schema question text',
          'Add HowTo schema to process-based or tutorial content',
          'Add SoftwareApplication schema to your homepage and product pages with current feature lists and pricing',
          'Validate all schema at Google\'s Rich Results Test before publishing',
          'Submit updated URLs immediately to Google Search Console after adding schema'
        ],
        suggestions: [],
        exampleDomains: topSources.slice(0, 3).map(function (s) { return s.domain; }),
        examplesStrategy: 'schema-examples',
        examplesHeading: 'Pages in your space AI cites because they answer questions directly',
        examplesNote: 'These pages get AI citations by structuring content as direct answers. Add FAQPage or HowTo schema to your pages using the same question-answer format.',
        outcome: 'Schema typically shows AI citation impact within 3-6 weeks with no new content production required. Only technical markup changes.',
        platDomains: topSources.slice(0, 3).map(function (s) { return s.domain; }),
        brands: topSources.slice(0, 2).map(function (s) { return { domain: s.domain, label: s.domain }; })
      }).forEach(function (t) { todos.push(t); });
    }

    // ── 14. Google AIO / AI Mode gap ──────────────────────────────
    var googleAioVis = latByProv['googleaio'] ? (latByProv['googleaio'].visibility || 0) : null;
    var googleAiModeVis = latByProv['googleaimode'] ? (latByProv['googleaimode'].visibility || 0) : null;
    var chatgptVis2 = latByProv['chatgpt'] ? (latByProv['chatgpt'].visibility || 0) : null;
    var googleLowVis = (googleAioVis !== null && googleAiModeVis !== null)
      ? Math.min(googleAioVis, googleAiModeVis)
      : (googleAioVis !== null ? googleAioVis : googleAiModeVis);
    if (googleLowVis !== null && chatgptVis2 !== null && googleLowVis < chatgptVis2 * 0.55 && chatgptVis2 > 0) {
      var googleSrcs = (srcByProv['googleaio'] || []).slice(0, 5);
      _aimExpandTodo({
        id: 'td-google-ai',
        priority: 'medium',
        effort: 'Med effort',
        pageType: 'on-page',
        recType: 'technical-seo',
        aiTargets: ['googleaio', 'googleaimode'].filter(function (k) { return latByProv[k]; }),
        title: 'Improve visibility on Google AI: only ' + (googleLowVis || 0).toFixed(1) + '% vs ' + (chatgptVis2 || 0).toFixed(1) + '% on ChatGPT',
        signals: [
          'Google AI Overview: ' + (googleAioVis !== null ? googleAioVis.toFixed(1) + '%' : 'n/a') + ' visibility',
          'Google AI Mode: ' + (googleAiModeVis !== null ? googleAiModeVis.toFixed(1) + '%' : 'n/a') + ' visibility',
          'Google AI pulls from the live web index. Organic ranking and schema matter more here than on ChatGPT or Perplexity.'
        ],
        sigs_fav: ['google.com', 'google.com', null],
        sigs_expand: [
          googleSrcs.length ? { heading: 'What Google AIO cites in your space:', items: googleSrcs.map(function (s) { return s.domain + ': ' + s.citation_count + ' citations'; }) } : null,
          { heading: 'Visibility by model:', items: activeProviders().map(function (p) {
            return provLabels[p] + ': ' + (latByProv[p] ? (latByProv[p].visibility || 0).toFixed(1) : '0') + '%';
          }) },
          null
        ],
        reasoning: 'Google AI Overviews and AI Mode favor pages that already rank organically for the query and have strong page experience signals. Unlike ChatGPT, which pulls from a broad training corpus, Google AI rewards traditional SEO fundamentals. ' + brand + ' is significantly underperforming on Google AI compared to other models. The fix combines organic SEO (getting pages ranked for target queries) with clean schema markup and citable content structure.',
        steps: [
          'Add FAQPage schema to pages where ' + brand + ' already ranks organically, directly answering the tracked prompt text',
          'Ensure ' + brand + '\'s site passes Core Web Vitals and has no crawl or mobile usability issues',
          'Submit all new and updated content immediately to Google Search Console for fast indexing'
        ],
        suggestions: [
          {
            title: 'Build backlinks from the domains Google AIO already cites in your space',
            steps: [
              'Open Sources view, filter by Google AIO, and list the top 10 domains it cites most in your space',
              'For each domain, identify a specific page where ' + brand + ' could earn a mention: tool roundup, resource list, or partner page',
              'Reach out to the editor or author with a concise pitch: what ' + brand + ' offers that fits their existing content and why their readers benefit',
              'Prioritize domains with 5 or more Google AIO citations: these have the strongest citation-to-visibility relationship'
            ],
            signals: [
              'Google AIO strongly prefers to cite pages that already have high organic authority and relevant backlinks',
              'Earning a link from a Google AIO-cited domain signals relevance to Google\'s AI indexing layer',
              'Backlinks from existing citation sources create a compounding effect: each new link reinforces the others'
            ]
          },
          {
            title: 'Publish a comprehensive "best [category]" guide on ' + brand + '\'s domain targeting your top prompt themes',
            steps: [
              'Research the top 5 "best [category]" queries across your tracked prompts and identify the common subtopics they share',
              'Write a comprehensive guide (1,500+ words) that directly answers each of those query variants in dedicated sections',
              'Structure the guide with ' + brand + ' recommended first, with specific "best for" justification for each use case',
              'Add FAQPage schema using exact prompt phrasing as question text, and submit the URL to Google Search Console immediately'
            ],
            signals: [
              'Google AI Overviews favor comprehensive, well-structured pages that already rank organically for the query',
              'A "best [category]" guide on ' + brand + '\'s own domain is a high-authority first-party citation source',
              'Google AI Mode rewards pages with strong topical authority: covering multiple query variants in one guide builds that authority'
            ]
          }
        ],
        exampleDomains: googleSrcs.slice(0, 4).map(function (s) { return s.domain; }),
        examplesStrategy: 'model-specific',
        examplesModelKey: 'googleaio',
        examplesHeading: 'What Google AIO currently cites in your category',
        examplesNote: 'These are the exact pages Google\'s AI pulls from. Matching their SEO authority and schema is the direct path to appearing here.',
        outcome: 'Google AI visibility typically responds faster to SEO improvements than other models. Expect movement within 3-5 weeks of publishing and indexing.',
        platDomains: googleSrcs.map(function (s) { return s.domain; }),
        brands: googleSrcs.slice(0, 2).map(function (s) { return { domain: s.domain, label: s.domain }; })
      }).forEach(function (t) { todos.push(t); });
    }

    // ── 15. Publish original research or data asset ────────────────
    var hasOriginalData = (snap.top_source_urls || []).some(function (u) {
      return /\bstudy\b|research|\bsurvey\b|\breport\b|\bstate[-\s]of\b|\bindex\b/i.test(u.url || '');
    });
    if (!hasOriginalData || overallVis < 12) {
      _aimExpandTodo({
        id: 'td-original-data',
        priority: 'medium',
        effort: 'High effort',
        pageType: 'on-page',
        recType: 'content',
        aiTargets: activeProviders(),
        title: 'Publish an original data study: research reports are the highest-cited content type across all AI models',
        signals: [
          'Original data and benchmark reports are cited as primary sources, not alongside 20 others',
          'AI cannot paraphrase proprietary data, so it must cite the source directly every time',
          topSources.length > 0 ? 'Most of ' + brand + '\'s current citations come from third-party sources. A first-party data asset changes that.' : 'A data asset creates a citation source you control completely'
        ],
        sigs_fav: [(topSources.find(function (s) { return s.domain !== 'reddit.com' && s.domain !== 'www.reddit.com'; }) || {}).domain || null, null, null],
        sigs_expand: [
          { heading: 'High-citation research formats:', items: [
            'Annual benchmark report with year-over-year comparisons',
            'Original survey of 100+ practitioners in your market',
            '"State of [category]" report published each year',
            'Proprietary scoring framework or methodology',
            'Dataset that other industry writers reference'
          ] },
          { heading: 'Why data assets outperform guides:', items: [
            'AI cannot paraphrase data: it must cite the source directly',
            'Data attracts backlinks naturally, compounding domain authority',
            'Annual editions keep the URL actively cited year after year',
            'Media outlets pick up data stories, adding high-authority citations'
          ] },
          null
        ],
        reasoning: 'AI models cite original data because they cannot restate it without attribution. A benchmark report from ' + brand + ' becomes a persistent citation every time AI answers a question that touches that data. It also attracts backlinks from other sites, improving overall domain authority. This is a one-time investment that compounds indefinitely. Each annual refresh keeps the citation alive and adds new data points for AI to reference.',
        steps: [
          'Identify a metric or trend ' + brand + ' is uniquely positioned to measure from its own platform or customer data',
          'Survey 100-300 practitioners in your market on a topic that directly maps to your tracked prompt categories',
          'Publish findings as a dedicated report page with clean data visualization and a downloadable version',
          'Title it "State of [Category] ' + new Date().getFullYear() + ': ' + brand + ' Report". This format is heavily cited across all AI models.',
          'Add DataSet or Article structured data schema to the report page',
          'Plan annual refreshes: consistent data series become the definitive source over time'
        ],
        suggestions: [
          'Pitch the data to 3-5 media outlets that already appear in your Sources view'
        ],
        exampleDomains: topSources.slice(0, 4).map(function (s) { return s.domain; }),
        examplesStrategy: 'research-examples',
        examplesHeading: 'Data and research pages AI cites as primary sources in your category',
        examplesNote: brand + '\'s research report should match the depth and authority of these pages. Original data on a dedicated URL earns the same direct citation treatment.',
        outcome: 'A well-distributed research piece typically generates 50-200 new domain citations within 90 days, creating a sustained uplift in AI visibility that compounds with each annual refresh.',
        platDomains: topSources.slice(0, 5).map(function (s) { return s.domain; }),
        brands: topSources.slice(0, 2).map(function (s) { return { domain: s.domain, label: s.domain }; })
      }).forEach(function (t) { todos.push(t); });
    }

    // ── 16. Tech media and press coverage ─────────────────────────
    var newsPatterns = ['techcrunch', 'searchengineland', 'venturebeat', 'forbes', 'businessinsider', 'zdnet', 'infoq', 'theregister', 'martech', 'digiday', 'wired', 'theverge', 'techradar', 'arstechnica', 'thenextweb', 'semafor', 'readwrite', 'adexchanger'];
    var newsDomainsCited = topSources.filter(function (s) {
      return newsPatterns.some(function (n) { return s.domain.indexOf(n) > -1; });
    });
    if (newsDomainsCited.length > 0 && overallVis < 20) {
      _aimExpandTodo({
        id: 'td-press',
        priority: 'medium',
        effort: 'High effort',
        pageType: 'off-page',
        recType: 'backlinks',
        aiTargets: activeProviders(),
        title: 'Get ' + brand + ' covered in tech media: ' + newsDomainsCited.slice(0, 2).map(function (s) { return s.domain; }).join(' and ') + ' already drive AI citations in your space',
        signals: [
          newsDomainsCited.length + ' tech media domain' + (newsDomainsCited.length > 1 ? 's are' : ' is') + ' already generating AI citations in your category',
          newsDomainsCited[0].domain + ' appears in ' + newsDomainsCited[0].citation_count + ' AI responses across your tracked prompts',
          'A single media mention creates a citation that AI references for 12-24 months across multiple models'
        ],
        sigs_fav: [newsDomainsCited[0] ? newsDomainsCited[0].domain : null, newsDomainsCited[1] ? newsDomainsCited[1].domain : null, null],
        sigs_expand: [
          { heading: 'Media domains generating citations in your space:', items: newsDomainsCited.slice(0, 6).map(function (s) { return s.domain + ': ' + s.citation_count + ' citations'; }) },
          { heading: 'Story angles that earn tech media coverage:', items: [
            'Funding announcements and product launches',
            'Original data and research findings (highest pickup rate)',
            'Founder perspective pieces and op-eds',
            'Case studies with named enterprise customers and metrics',
            'Trend commentary tied to an active news cycle'
          ] },
          null
        ],
        reasoning: 'Tech and industry media publications are among the highest-authority sources AI models trust. When ' + newsDomainsCited[0].domain + ' publishes a piece that mentions ' + brand + ', that citation persists in AI responses for months. ' + brand + ' does not need to be the subject of every article: a strong quote in a roundup or a mention in a "tools to watch" piece is enough to create a durable citation. The goal is to get the brand name into high-authority URLs that AI treats as definitive.',
        steps: [
          'Build a press kit page with logos, founder photos, key stats, and pre-written company boilerplate',
          'Identify 3 story angles: a data hook, a clear product differentiator, and a contrarian opinion on a trending topic',
          'Use HARO or Qwoted to respond to journalist queries in your space: these often turn into named citations within days'
        ],
        suggestions: [
          'Reach out to 5 journalists who cover your category on ' + newsDomainsCited[0].domain + ' with a sharp, data-led pitch'
        ],
        exampleDomains: newsDomainsCited.slice(0, 4).map(function (s) { return s.domain; }),
        examplesStrategy: 'editorial-guide',
        examplesHeading: 'Media articles AI currently cites in your space',
        examplesNote: 'Getting ' + brand + ' mentioned in articles on these domains creates the same high-authority citation pipeline.',
        outcome: 'Each media mention creates a citation AI references for 12-24 months, compounding into a persistent presence across responses for relevant queries.',
        platDomains: newsDomainsCited.map(function (s) { return s.domain; }),
        brands: newsDomainsCited.slice(0, 2).map(function (s) { return { domain: s.domain, label: s.domain }; })
      }).forEach(function (t) { todos.push(t); });
    }

    // ── Fallback ──────────────────────────────────────────────────
    if (todos.length === 0) {
      todos.push({
        id: 'td-no-data',
        priority: 'medium',
        effort: 'Low effort',
        pageType: 'on-page',
        recType: 'content',
        aiTargets: ['chatgpt', 'gemini', 'perplexity', 'googleaio', 'googleaimode'],
        title: 'Run an analysis to unlock personalized action recommendations',
        signals: ['Actions are built from citation data, prompt performance, and competitor gaps', 'This brand has no analysis data yet (visibility, competitors and sources)', 'Run an analysis in AI Peekaboo to get started'],
        sigs_fav: [null, null, null],
        sigs_expand: [null, null, null],
        reasoning: 'No analysis data is available for this brand yet. Run an analysis in AI Peekaboo to pull live visibility, competitor and citation data and unlock personalized recommendations.',
        suggestions: [
          'Run a new analysis for this brand in AI Peekaboo',
          'Make sure competitors and tracked prompts are configured',
          'Reload this dashboard'
        ],
        exampleDomains: [],
        examplesHeading: '',
        examplesNote: '',
        outcome: 'Once analysis data is available, you will get 6-9 data-driven action recommendations based on your specific gaps.',
        platDomains: [],
        brands: []
      });
    }

    return todos;
  }

  // ── Globals for the ported inline onclick="" handlers ──────────────────────
  // The HTML template and row/detail renderers are taken verbatim from the v4
  // file, which wires events through global function names. State stays inside
  // this closure; only these entry points are exposed.
  var _todosGlobalHandlers = {
    openCustomSelect: openCustomSelect,
    aimSetTodosView: aimSetTodosView,
    aimSetTodoPriFilter: aimSetTodoPriFilter,
    aimSetTodoTypeFilter: aimSetTodoTypeFilter,
    aimSetTodoPageFilter: aimSetTodoPageFilter,
    aimSetTodoEffortFilter: aimSetTodoEffortFilter,
    aimSortTodos: aimSortTodos,
    aimSelectAllTodos: aimSelectAllTodos,
    aimTdToggleCheck: aimTdToggleCheck,
    aimOpenTodoDetail: aimOpenTodoDetail,
    aimCloseTodoDetail: aimCloseTodoDetail,
    aimTdPriPop: aimTdPriPop,
    aimInlinePopSelect: aimInlinePopSelect,
    aimTdToggleExpand: aimTdToggleExpand,
    aimToggleTodoAdded: aimToggleTodoAdded,
    aimArchiveTodo: aimArchiveTodo,
    aimMarkTodoComplete: aimMarkTodoComplete,
    aimTdBulkClear: aimTdBulkClear,
    aimTdBulkAction: aimTdBulkAction,
    aimTdToggleWhy: aimTdToggleWhy,
    aimTdSaveNotes: aimTdSaveNotes,
    aimGoToPrompt: aimGoToPrompt
  };
  Object.keys(_todosGlobalHandlers).forEach(function (k) { window[k] = _todosGlobalHandlers[k]; });

  // ── HTML template (verbatim from #view-ai-todos in the v4 file) ────────────
  var TODOS_TEMPLATE = `
    <div id="aim-td-list">
      <div class="page-content">

        <div style="margin-bottom:14px;">
          <div style="font-size:20px;font-weight:700;color:var(--text);letter-spacing:-.4px;margin:0 0 4px;">Your AI Visibility Action Plan</div>
          <p style="font-size:12px;color:var(--text-muted);margin:0;">Data-driven actions built from your citation patterns, competitor gaps, and prompt performance.</p>
        </div>

        <div class="card" style="overflow:hidden;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border-light);gap:10px;flex-wrap:wrap;">
            <!-- LEFT: view toggle -->
            <div class="aim-tab-bar" style="margin-bottom:0;">
              <button class="aim-tab active" data-view="suggested" onclick="aimSetTodosView('suggested')">Suggested <span id="aim-td-cnt-suggested" style="font-size:11px;font-weight:600;color:var(--text-muted);"></span></button>
              <button class="aim-tab" data-view="todo" onclick="aimSetTodosView('todo')">To-do <span id="aim-td-cnt-todo" style="font-size:11px;font-weight:600;color:var(--text-muted);"></span></button>
              <button class="aim-tab" data-view="archive" onclick="aimSetTodosView('archive')">Archive <span id="aim-td-cnt-archive" style="font-size:11px;font-weight:600;color:var(--text-muted);"></span></button>
            </div>
            <!-- RIGHT: filters -->
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <div class="ct-custom-select" id="aim-td-pri-sel" style="min-width:115px;">
                <button class="ct-custom-trigger" onclick="openCustomSelect('aim-td-pri-sel')">
                  <span class="ct-trigger-label" id="aim-td-pri-label">All Priorities</span>
                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" style="flex-shrink:0;opacity:.5"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
                <div class="ct-custom-dropdown">
                  <div class="ct-custom-option selected" onclick="aimSetTodoPriFilter('all','All Priorities')">All Priorities</div>
                  <div class="ct-custom-option" onclick="aimSetTodoPriFilter('high','High Priority')">High Priority</div>
                  <div class="ct-custom-option" onclick="aimSetTodoPriFilter('medium','Medium Priority')">Medium Priority</div>
                </div>
              </div>
              <div class="ct-custom-select" id="aim-td-type-sel" style="min-width:108px;">
                <button class="ct-custom-trigger" onclick="openCustomSelect('aim-td-type-sel')">
                  <span class="ct-trigger-label" id="aim-td-type-label">All Types</span>
                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" style="flex-shrink:0;opacity:.5"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
                <div class="ct-custom-dropdown">
                  <div class="ct-custom-option selected" onclick="aimSetTodoTypeFilter('all','All Types')">All Types</div>
                  <div class="ct-custom-option" onclick="aimSetTodoTypeFilter('content','Content')">Content</div>
                  <div class="ct-custom-option" onclick="aimSetTodoTypeFilter('social-media','Social Media')">Social Media</div>
                  <div class="ct-custom-option" onclick="aimSetTodoTypeFilter('reddit','Reddit')">Reddit</div>
                  <div class="ct-custom-option" onclick="aimSetTodoTypeFilter('youtube','YouTube')">YouTube</div>
                  <div class="ct-custom-option" onclick="aimSetTodoTypeFilter('backlinks','Backlinks')">Backlinks</div>
                  <div class="ct-custom-option" onclick="aimSetTodoTypeFilter('crawlability','Crawlability')">Crawlability</div>
                  <div class="ct-custom-option" onclick="aimSetTodoTypeFilter('technical-seo','Technical SEO')">Technical SEO</div>
                </div>
              </div>
              <div class="ct-custom-select" id="aim-td-page-sel" style="min-width:108px;">
                <button class="ct-custom-trigger" onclick="openCustomSelect('aim-td-page-sel')">
                  <span class="ct-trigger-label" id="aim-td-page-label">All Pages</span>
                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" style="flex-shrink:0;opacity:.5"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
                <div class="ct-custom-dropdown">
                  <div class="ct-custom-option selected" onclick="aimSetTodoPageFilter('all','All Pages')">All Pages</div>
                  <div class="ct-custom-option" onclick="aimSetTodoPageFilter('on-page','On-page')">On-page</div>
                  <div class="ct-custom-option" onclick="aimSetTodoPageFilter('off-page','Off-page')">Off-page</div>
                </div>
              </div>
              <div class="ct-custom-select" id="aim-td-eff-sel" style="min-width:108px;">
                <button class="ct-custom-trigger" onclick="openCustomSelect('aim-td-eff-sel')">
                  <span class="ct-trigger-label" id="aim-td-eff-label">All Efforts</span>
                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" style="flex-shrink:0;opacity:.5"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
                <div class="ct-custom-dropdown">
                  <div class="ct-custom-option selected" onclick="aimSetTodoEffortFilter('all','All Efforts')">All Efforts</div>
                  <div class="ct-custom-option" onclick="aimSetTodoEffortFilter('low','Low Effort')">Low Effort</div>
                  <div class="ct-custom-option" onclick="aimSetTodoEffortFilter('med','Medium Effort')">Medium Effort</div>
                  <div class="ct-custom-option" onclick="aimSetTodoEffortFilter('high','High Effort')">High Effort</div>
                </div>
              </div>
            </div>
          </div>
          <div class="aim-table-wrap" style="max-height:calc(100vh - 320px);overflow-y:auto;">
            <table class="aim-full-table" style="min-width:920px;">
              <thead><tr>
                <th style="width:30px;"><input type="checkbox" id="aim-td-select-all" onchange="aimSelectAllTodos(this.checked)" style="width:13px;height:13px;cursor:pointer;accent-color:var(--accent);"></th>
                <th onclick="aimSortTodos('rec')" class="col-left" style="min-width:240px;cursor:pointer;">Recommendation <span id="aim-tds-rec" style="font-size:10px;color:var(--text-faint);"></span></th>
                <th onclick="aimSortTodos('priority')" style="width:90px;cursor:pointer;">Priority <span id="aim-tds-pri" style="font-size:10px;color:var(--text-faint);"> &darr;</span></th>
                <th onclick="aimSortTodos('pageType')" style="width:90px;cursor:pointer;">Page <span id="aim-tds-page" style="font-size:10px;color:var(--text-faint);"></span></th>
                <th onclick="aimSortTodos('recType')" style="width:130px;cursor:pointer;">Type <span id="aim-tds-type" style="font-size:10px;color:var(--text-faint);"></span></th>
                <th style="width:140px;">AI Engines</th>
                <th onclick="aimSortTodos('effort')" style="width:80px;cursor:pointer;">Effort <span id="aim-tds-eff" style="font-size:10px;color:var(--text-faint);"></span></th>
              </tr></thead>
              <tbody id="aim-td-tbody"></tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
    <div id="aim-td-detail" class="page-content" style="display:none;padding-top:20px;"></div>
  `;

  // ── Body-attached chrome (floating bar + inline popover) ──────────────────
  function ensureBodyChrome() {
    var fb = document.getElementById('aim-td-floating-bar');
    if (fb) fb.remove();
    fb = document.createElement('div');
    fb.id = 'aim-td-floating-bar';
    fb.className = 'aim-floating-bar';
    fb.style.display = 'none';
    fb.innerHTML = '<div class="aim-floating-bar-count" id="aim-td-fb-count">0 <span>selected</span></div>' +
      '<div style="display:flex;align-items:center;gap:4px;" id="aim-td-fb-actions"></div>';
    document.body.appendChild(fb);

    var pop = document.getElementById('aim-inline-pop');
    if (pop) pop.remove();
    pop = document.createElement('div');
    pop.id = 'aim-inline-pop';
    document.body.appendChild(pop);
  }

  var _todosDocHandlersBound = false;
  function bindDocHandlers() {
    if (_todosDocHandlersBound) return;
    _todosDocHandlersBound = true;
    // close open custom selects on outside click
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('.ct-custom-select')) return;
      document.querySelectorAll('.pb-todos-scope .ct-custom-select.open').forEach(function (el) { el.classList.remove('open'); });
    });
    // hide body-attached chrome (and drop the scope class) when navigating away
    window.addEventListener('hashchange', function () {
      var fb = document.getElementById('aim-td-floating-bar');
      if (fb) fb.style.display = 'none';
      var pop = document.getElementById('aim-inline-pop');
      if (pop) pop.style.display = 'none';
      var route = (location.hash || '').replace(/^#\/?/, '').split('/')[0];
      if (route !== 'todos') {
        var v = document.getElementById('view');
        if (v) v.classList.remove('pb-todos-scope');
        _todosDocHandlersBound = false;
      }
    });
  }

  // map the topbar model filter value to a provider key (or null for "all")
  function modelFilterToProvKey(m) {
    m = String(m || '').toLowerCase();
    if (!m || m === 'all') return null;
    return modelIdToProv(m);
  }

  // ── View registration ───────────────────────────────────────────────────────
  PB.registerView('todos', async function (root, ctx) {
    injectTodosCSS();
    ensureBodyChrome();
    bindDocHandlers();
    root.className = 'pb-todos-scope';

    // reset per-render state for this brand
    _aimTodosView = 'suggested';
    _aimTodosPriFilter = 'all';
    _aimTodosTypeFilter = 'all';
    _aimTodosPageFilter = 'all';
    _aimTodosEffortFilter = 'all';
    _aimTodosSortField = 'priority';
    _aimTodosSortDir = 'desc';
    _aimCheckedTodos = new Set();
    _aimTodosData = null;
    _snapNorm = null;
    _aimExtUrlCache = null;
    _periodRange = ctx.range || '30d';
    _aimFilterModelKey = modelFilterToProvKey(ctx.model);

    var brandId = ctx.brandId || 'default';
    _lsAdded = 'pb_td_added_' + brandId;
    _lsCompleted = 'pb_td_completed_' + brandId;
    _lsArchived = 'pb_td_archived_' + brandId;
    _lsNotesPrefix = 'pb_td_notes_' + brandId + '_';
    _aimTodosAdded = _loadSet(_lsAdded);
    _aimTodosCompleted = _loadSet(_lsCompleted);
    _aimTodosArchived = _loadSet(_lsArchived);

    PB.skeleton(root);

    // fetch data
    var snap = {};
    var promptRows = [];
    try {
      var results = await Promise.all([
        PB.api.snapshot(ctx.brandId).catch(function () { return null; }),
        PB.api.prompts(ctx.brandId, { time_range: ctx.range || '30d', limit: 100 }).catch(function () { return null; })
      ]);
      snap = results[0] || {};
      var envelope = results[1];
      if (envelope) {
        var arr = envelope.prompts || envelope.data || [];
        if (Array.isArray(arr)) promptRows = arr;
      }
    } catch (e) { /* generator falls back to the no-data todo */ }

    // brand url from the loaded brand list (snapshot's brand object has no url)
    var brandUrl = '';
    try {
      var b = (PB.state.brands || []).find(function (x) { return x.id === ctx.brandId; });
      if (b && b.url) brandUrl = b.url;
    } catch (e) { /* noop */ }

    _snapNorm = normalizeSnapshot(snap, promptRows, ctx.brandName, brandUrl);
    _aimTodosData = aimGenerateTodos(_snapNorm);

    // purge stale IDs from localStorage that no longer exist in the current list
    var validIds = new Set(_aimTodosData.map(function (t) { return t.id; }));
    [[_lsAdded, _aimTodosAdded], [_lsCompleted, _aimTodosCompleted], [_lsArchived, _aimTodosArchived]].forEach(function (pair) {
      var key = pair[0], set = pair[1];
      var before = set.size;
      set.forEach(function (id) { if (!validIds.has(id)) set.delete(id); });
      if (set.size !== before) _saveSet(key, set);
    });

    // paint
    root.innerHTML = TODOS_TEMPLATE;
    aimCloseTodoDetail();
    aimUpdateTodoTabCounts();
    aimRenderTodosTable();
    aimUpdateTodosFloatingBar();
  });

  // ── Pure logic export for node tests (tests/todos.logic.test.mjs) ──────────
  window.PBTodosLogic = {
    cleanDomain: cleanDomain,
    modelIdToProv: modelIdToProv,
    splitMentions: splitMentions,
    normalizeSnapshot: normalizeSnapshot,
    expandTodo: _aimExpandTodo,
    generateTodos: function (snap, promptRows, brandName, brandUrl) {
      return aimGenerateTodos(normalizeSnapshot(snap, promptRows, brandName, brandUrl));
    }
  };
})();
