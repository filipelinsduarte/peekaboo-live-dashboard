# Prompt Detail Page — Engineering Handover

**File:** `live-app/views/prompt-detail.js` (~3,000 lines) + `live-app/tests/prompt-detail.logic.test.mjs` (~830 lines, 87 tests)
**Route:** `#/prompts/:id`
**Written:** iterative Claude Code sessions, July 2026, working directly from Filipe's design/product feedback (no ticket/spec — this doc is the spec, after the fact).

This page was substantially redesigned from its original "v4 port" layout (a straight capture of the static reference mock) into a custom, denser, more capable layout. If you're picking this up — human or AI agent — read this whole doc before touching the file. The architecture has one genuinely tricky part (state cascading through 5 rebuildable regions) that will bite you if you don't understand it first.

---

## 1. What this page is

The detail view for a single tracked prompt: how a brand is doing across AI models, for one specific prompt, over time. It's reached from `#/prompts` (the list view) by clicking a row, or from within this page itself via the prompt switcher (see §4).

Data source: `PB.api.promptDetail(brandId, promptId, range, includeFullResponse)` → `GET /brands/:id/prompts/:promptId`, plus `PB.api.competitors(brandId)` and `PB.api.prompts(brandId, {...})` (for the prompt-switcher dropdown), all fetched in parallel and awaited once.

---

## 2. Page layout (current, top to bottom)

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Back to Prompts                              [ Export to CSV ] │  .pb-pd-topbar-row
├─────────────────────────────┬───────────────────────────────────┤
│ HEADER CARD (44%)           │ VISIBILITY CHART CARD (56%)       │  .pb-pd-top-row
│ [prompt name ▾] (dropdown)  │ [title]      [mode ▾] [heatmap    │
│ badges: N runs · topic ·    │ [sub]                  pager]     │
│ intent                      │ legend (favicons)                 │
│ ────────────────────────    │ canvas OR heatmap table            │
│ Mentions Visibility          │ (mode: visibility/heatmap/         │
│   Sentiment  Avg Position    │  citations/mentions)               │
│ ── (pushed to bottom) ──     │                                   │
│ Top Brands│Top Cites│Top Type│                                   │
├─────────────────────────────┴───────────────────────────────────┤
│ Response History          [favicon] [All|Mentioned|Not ment.]    │  .pb-pd-section-title-row
│ Click a row to read the full response                            │
├───────────────────────────┬───────────────────────────────────┤
│ Day-section cards          │ SOURCES card                       │  .pb-pd-bottom-section
│ (collapsible, paginated    │  search + domain/share table,      │  history col 58% / side col 42%
│  7 days/page)               │  expand a row → cited URLs         │
│ ‹ 1-7 of 23 days ›          │ MENTIONED BRANDS card               │
│                             │  brand/mentions table               │
└───────────────────────────┴───────────────────────────────────┘
```

---

## 3. File map inside `prompt-detail.js`

The file is one big IIFE: `(function () { 'use strict'; if (!window.PB) return; ... })();`. Everything lives in that closure. Roughly top to bottom:

| Region | Lines (approx) | What's there |
|---|---|---|
| Pure text/markdown helpers | 76–204 | `escapeHtml`, `highlightMentions`, `formatAnswer` (markdown→HTML for the response modal) |
| **Pure data logic** (all exported on `window.PBPromptDetailLogic`, all unit-tested) | 205–800 | filters, grouping, pagination, per-entity/domain series, CSV export, content-type classification — see §6 |
| Module-level mutable state | ~850 | `competitorsCache`, `entityDomains`, `citedDomainList`, `lastChartMode` — see §7 |
| `window.PBPromptDetail(root, ctx)` — the entry point | ~862–990 | fetches data, owns the "Mentioned" toggle state, coordinates the rebuild cascade — **read §4 before touching this** |
| `backButton`, `buildExportButton`, `downloadCsv` | ~1000–1060 | topbar row |
| `attachFastTooltip`, `buildPromptSwitcher` | ~1061–1185 | prompt-switcher dropdown (custom, reuses the app's `pb-dd-*` classes) |
| `buildHeaderCard` | 1186–1330 | prompt name, badges, 4 top stats, 3 bottom clusters |
| `CHART_MODES`, `buildVisibilityChartCard`, `renderLineChart`, `renderHeatmapBody` | 1331–1642 | the 4-mode chart card |
| `buildMentionToggle`, `buildHistoryColumn` | 1643–1730 | segmented control + paginated day-sections |
| `buildSourcesCard`, `buildMentionedCard` | 1731–1894 | the two right-column cards |
| `modelOrder`, `buildDateSection`, `buildDayTable`, `buildRunRow` | 1895–2088 | the per-day collapsible table |
| `injectPageCSS` | 2103–2442 | **all page CSS lives here as one big injected `<style>` string** — see §8 |
| `openRunModal` + modal builders + `injectModalCSS` | 2443–2968 | full-response modal (click a table row) — mostly untouched this round |

---

## 4. The state-cascade architecture (READ THIS FIRST)

This is the one thing that will trip you up. **Five regions of the page** — header card stats, the chart card (all 4 modes), the day-section list, the Sources card, and the Mentioned Brands card — all have to agree with **two independent pieces of client-side filter state**:

1. `ctx.model` / `ctx.range` — the topbar's global filters. These are new `ctx` on every `route()` call; `window.PBPromptDetail` re-runs from scratch. `ctx.range` is applied server-side (passed into the API call); `ctx.model` has no server param for this endpoint, so it's applied client-side via `filterHistoryByModel` right after fetch.
2. `mentionMode` — the page-local "All / Mentioned / Not mentioned" toggle (§5). This does **not** survive a `route()` re-run (by design — it's a page-local browsing aid, not a real filter); it always starts on `'all'`.

Everything downstream is built from `history` (the model+range-filtered array) and re-derived through `mentionMode` on every toggle click. The pattern, inside `window.PBPromptDetail`:

```js
var mentionMode = 'all';
var pendingChartRender = null;   // chart's canvas can't be sized until it's in the live DOM

function rerenderMentionFiltered() {
  var filteredHistory = filterHistoryByMentionState(history, mentionMode);
  var filteredGroups  = mentionMode === 'all' ? groups : groupRunsByDate(filteredHistory);
  var filteredDetail  = mentionMode === 'all' ? detail : withHistory(detail, filteredHistory);
  var filteredTops    = mentionMode === 'all' ? tops   : topEntities(filteredHistory);

  var chartCard = buildVisibilityChartCard(filteredDetail, ctx, filteredTops);
  topRowSlot.innerHTML = '';
  topRowSlot.appendChild(buildHeaderCard(filteredDetail, ctx, filteredGroups, filteredTops, promptList));
  topRowSlot.appendChild(chartCard.el);
  pendingChartRender = chartCard.render;

  historyColSlot.innerHTML = '';
  historyColSlot.appendChild(buildHistoryColumn(filteredGroups, filteredHistory, filteredDetail, mentionToggle));

  sideColBody.innerHTML = '';
  sideColBody.appendChild(buildSourcesCard(filteredHistory));
  sideColBody.appendChild(buildMentionedCard(filteredHistory));
}

var mentionToggle = buildMentionToggle(toggleBrandName, mentionMode, function (mode) {
  mentionMode = mode;
  rerenderMentionFiltered();
  pendingChartRender();          // tree is ALREADY live here — safe to render immediately
});

rerenderMentionFiltered();       // first build — tree NOT live yet, don't render the chart
wrap.appendChild(topRowSlot);
wrap.appendChild(el('div', { class: 'pb-pd-bottom-section' }, [historyColSlot, sideCol]));
root.appendChild(wrap);
pendingChartRender();            // NOW the tree is live — safe to render
```

**Rules if you extend this:**
- If you add a 6th thing that needs to respond to `mentionMode`, it goes inside `rerenderMentionFiltered`, built from `filteredHistory`/`filteredDetail`/`filteredGroups`/`filteredTops` — never from the outer `history`/`detail`/`groups`/`tops`.
- Everything that should **NOT** respond to the toggle (the prompt switcher's dropdown list, `detail.category`/`detail.searchIntent`/`detail.promptText`, the back button, the export button) stays built from the outer, unfiltered variables.
- `withHistory(detail, history)` is a shallow clone that swaps only `.history` — never mutate `detail` directly, it's shared across rebuilds.
- The chart card's `{el, render}` two-phase return exists because Chart.js can't size a `<canvas>` until it has real layout (i.e., is attached to the live document). Every new chart-card build needs its `.render()` called *after* `.el` is actually in the DOM. `pendingChartRender` is how the toggle handler defers that correctly on both the first paint and later toggle-triggered rebuilds — don't call `chartCard.render()` inline where `chartCard.el` was just built but not yet attached.

---

## 5. The "Mentioned" toggle (`buildMentionToggle`)

A 3-way segmented control (`All` / `Mentioned` / `Not mentioned`), styled small and compact (`.pb-pd-mention-seg-btn`), with the brand's favicon to its left. Lives in the Response History section's title row, top-right (roughly above each day-section's own expand/collapse chevron).

- `filterHistoryByMentionState(history, mode)` — the pure filter, `run.score > 0` = mentioned. `'all'` or any unrecognized mode returns the list unchanged.
- It is built **once** per page render (not rebuilt on every toggle click) — its own click handler owns `mentionMode` and calls `rerenderMentionFiltered` (defined in the outer scope) and toggles its own `.active` class on the 3 buttons. It gets re-parented (moved, not cloned) into a fresh `titleRow` every time `buildHistoryColumn` rebuilds — that's fine, DOM nodes can only have one parent, `appendChild` just moves it.

---

## 6. Pure logic reference (`window.PBPromptDetailLogic`)

All of these are side-effect-free, unit-tested in `tests/prompt-detail.logic.test.mjs`, and safe to call from anywhere. This is also the contract an AI agent should extend first — add the pure function + its test, *then* wire it into the DOM-building code.

| Function | Purpose |
|---|---|
| `filterHistoryByModel(history, model)` | topbar model filter (client-side; API has no model param on this endpoint) |
| `filterHistoryByMentionState(history, mode)` | the page-local toggle filter |
| `withHistory(detail, history)` | shallow-clone `detail` with `.history` swapped |
| `groupRunsByDate(history)` | groups runs into `{date, runs}[]`, newest first |
| `paginateGroups(list, pageSize, page)` | **generic** array pager (despite the name — also used for heatmap row pagination, see §9) |
| `dateAggregates(runs)` | mean score, dominant sentiment, mean rank for one date-group or the whole history |
| `topEntities(history)` | top-5 mentioned brands + top-5 cited domains (capped) |
| `brandMentionTable(history)` | **uncapped** brand-mention leaderboard, feeds the Mentioned Brands card |
| `sourceTable(history)` | **uncapped** domain leaderboard with citation share + per-URL breakdown, feeds the Sources card |
| `entityVisibilitySeries(history, brandName, otherNames)` | multi-entity **score** series (brand's own `run.score`, others via the rank formula) — feeds Visibility mode and Heatmap mode |
| `domainCitationSeries(history, domains, brandDomain)` | multi-domain **citation count** series — feeds Citations mode |
| `entityMentionSeries(history, brandName, otherNames)` | multi-entity **mention count** series — feeds Mentions mode |
| `heatmapColor(val)` | 0–100 → `rgba(r,g,b,0.88)`, red→yellow→green — **exactly mirrors `views/competitors.js`'s `heatBg()`**, keep them in sync if either changes |
| `brandMentionCount(history)` | count of runs with `score > 0` |
| `classifyContentType(source)` / `topContentType(history)` | heuristic content-type bucket (Blog/Listicle/Comparison/Case Study/News/Review/Careers Page/Company Page) from a cited source's real title+URL — never fabricated, just pattern-matched on real text |
| `csvEscape(val)` / `historyToCsv(history)` | RFC 4180 CSV export |
| `previewText`, `letterAvatarColor`, `entityDomainMap`, `resolveEntityDomain`, `collectCitedDomains` | pre-existing, mostly unchanged this round |

Run the suite: `node tests/prompt-detail.logic.test.mjs` — 87 tests, plain Node, zero deps, non-zero exit on failure.

---

## 7. Module-level state (persists across `window.PBPromptDetail` calls, i.e. across `route()` re-renders)

```js
var competitorsCache = { brandId: null, list: null };  // pre-existing
var entityDomains = {};                                  // pre-existing, reset per render
var citedDomainList = [];                                // pre-existing, reset per render
var lastChartMode = 'visibility';                          // NEW this round
```

`lastChartMode` is the one to know about: the chart card's dropdown mode (visibility/heatmap/citations/mentions) is **not** part of `ctx`, so without this it would silently reset to `'visibility'` every time the topbar filters changed or the user switched prompts. `renderMode(mode)` inside `buildVisibilityChartCard` writes to it on every mode change; `buildVisibilityChartCard`'s `render()` and the `<select>`'s initial `.value` both read it. If you add more chart modes, no extra work needed — this persistence is generic.

---

## 8. CSS — how it's organized, and two real bugs found this round

All CSS is one big injected `<style id="pb-prompt-page-css">` built as a JS string in `injectPageCSS()` (~340 lines). It's `.pb-pd-scope`-prefixed almost everywhere. **Two gotchas discovered the hard way, worth knowing before you touch this block:**

1. **Cascade order matters inside the string, same as any stylesheet.** Two rules with equal specificity: whichever is declared *later in the string* wins, regardless of how "specific" it feels. We had a real bug where a `border-bottom: none` override was placed *before* the base rule it was meant to override, so the base rule (declared later) silently won and the override did nothing. If you add a modifier/override rule, put it *after* the base rule it modifies, not just "nearby."

2. **One tooltip element lives outside `.pb-pd-scope` on purpose.** `attachFastTooltip` appends its tooltip to `document.body` directly (so `position: fixed` positions relative to the viewport, not to some transformed ancestor). Its CSS rule (`.pb-pd-fast-tip`) is deliberately **not** `.pb-pd-scope`-prefixed — if you scope it, it'll never match and the rule becomes dead code. If you add another `document.body`-appended overlay, remember to unscope its CSS too.

Also worth knowing:
- Flexbox truncation (`text-overflow: ellipsis`) silently fails without `min-width: 0` on the shrinking flex item — bit us in the Sources card's expanded URL rows (the fix is `.pb-pd-src-url-title { flex: 1 1 auto; min-width: 0; ... }`).
- `table-layout: fixed` is scoped to specific table classes (`.pb-pd-src-table`, `.pb-pd-heatmap-table`), not the shared `.pb-pd-table` base — a global `table-layout: fixed` would have broken the day-section tables' column proportions.
- The heatmap intentionally caps at 3 rows/page (`HEATMAP_ROWS_PER_PAGE`) with its own pager next to the mode `<select>`, specifically so the chart card's height never changes between modes (a table's height is content-driven; a canvas isn't).

---

## 9. Things that look like duplication but aren't (and one that genuinely is a reuse)

- `entityVisibilitySeries` (score) vs `entityMentionSeries` (raw count) vs `domainCitationSeries` (raw count, but domains not entities) are three separate functions with very similar shapes. They're **not** unified into one parameterized function on purpose — the score formula (brand uses `run.score` directly, others use the rank formula) is genuinely different math from a raw occurrence count, and forcing them through one function would need enough branching to lose more clarity than it'd save. If you need a 5th series type, prefer copying the closest existing pattern over trying to generalize further.
- `paginateGroups` **is** reused for two different things (date-groups in Response History, entity-rows in the heatmap) — it's genuinely generic (operates on any array), the name is just a little stale. Don't be surprised to see it called with a `series` array.
- `mentionIcon`/`tooltipPointIcon` (entity-name → favicon, with a resolution chain + letter-avatar fallback) vs `domainLegendIcon`/`domainPointIcon` (raw domain → favicon, no resolution needed since it's already a real domain) exist as separate pairs because Citations mode's series names are domains, not entity names — using the entity resolver on a domain string would silently misresolve or fall back to a letter avatar for no reason.

---

## 10. Known limitations / explicitly deferred

- **Prompt-switcher dropdown has no model filter.** Filipe asked for one; I verified against the real API that `GET /brands/:id/prompts` returns only an overall `averageScore` per prompt (no per-model breakdown) and ignores a `model` query param — there's no real data to filter by at the list level. Score display + sort (highest/lowest) *were* built, since those use real data. If per-model prompt scores ever become available server-side, the sort bar in `buildPromptSwitcher` is the place to add a model filter alongside it.
- **CSV export uses model+range filters, not the Mentioned toggle.** Deliberate — Filipe's request was specifically "the selected time frame and the selected AI models," and the toggle is a page-local browsing aid, not a data-scoping filter. If that's ever wrong, `buildExportButton` would need `mentionMode`/`filteredHistory` threaded in instead of the outer `history`.
- **Heatmap pagination state (`heatmapPage`) does not persist** across mode switches or toggle changes, unlike `lastChartMode`. Low-stakes (worst case: back to page 1), not fixed because it wasn't asked for.
- Response modal (`openRunModal` and friends, ~2443–2968) is **mostly untouched** this round — don't assume it's been reviewed against the new layout.

---

## 11. For an AI agent picking this up

1. **Run the tests first, before any change:** `cd live-app && node tests/prompt-detail.logic.test.mjs` — should show `87 passed, 0 failed`. If it doesn't, something regressed before you even started.
2. **Read §4 before touching `window.PBPromptDetail`.** Almost every bug risk in this file is "I built X from `history` instead of `filteredHistory`" or "I called `.render()` before the element was attached."
3. **New data logic → pure function + test in the same change**, per this repo's standing convention (see the four `feedback_*` memory files referenced in the root CLAUDE.md if you have access to them; otherwise: write the transform as a side-effect-free function, export it on `PBPromptDetailLogic`, write a Node `assert`-based test in `tests/prompt-detail.logic.test.mjs` using the existing `eqJson`/`test` helpers at the top of that file). Only after the logic is tested, wire it into a `build*`/`render*` DOM function.
4. **No live browser access is assumed.** Every round of changes in this file's history was verified via `node -c views/prompt-detail.js` (syntax), the full test suite, and `curl | node -c` against the running local server (confirms the served file matches disk) — but actual visual/interaction verification in a real browser was **not** performed by the agent that wrote most of this. Budget time to actually open `http://localhost:7898/#/prompts/:id` (or `:7899` if a second config-based instance is running) and click through: prompt switcher, all 4 chart modes + heatmap pagination, the Mentioned toggle, Sources row expand, CSV export, history pager.
5. **CSS edits:** always re-run `node -c views/prompt-detail.js` after editing the `injectPageCSS()` string — it's easy to leave a stray JS-style `/* ... */` comment *outside* a quoted string (valid JS, but silently produces no CSS output) instead of `'/* ... */\n' +` *inside* the string chain like every other comment in that block. This happened multiple times during development; watch for it in diffs.
6. **Don't fabricate.** Two features were explicitly *not* built this round (the prompt-dropdown model filter, per-URL "citation share" if that's ever requested again) because the backing API data doesn't exist. If a future request implies data that isn't in the `/prompts/:id` or `/prompts` response shape, verify against the real API (`curl` the local proxy, e.g. `curl "http://localhost:7898/api/brands/:id/prompts/:promptId"`) before building UI around it.
