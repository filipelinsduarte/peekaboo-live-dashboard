# AI Visibility Action Plan (To-do's) — Engineering Handoff Spec

Status: working proof of concept, built client-side in the local dashboard mirror.
Goal of this document: everything an engineer needs to re-implement this feature in the production Peekaboo product (Next.js/React frontend + existing REST API).

Source of truth for all logic described here: `live-app/views/todos.js` (~2,900 lines, fully self-contained).

---

## 1. Feature Overview

The Action Plan generates a brand-specific, data-driven list of AI visibility recommendations ("to-dos") from the data Peekaboo already collects: visibility scores, competitor gaps, citation sources, and per-prompt performance.

Each recommendation is:

- **Concrete**: a specific action ("Publish a Flexzo vs CompetitorX comparison page"), not generic advice
- **Evidence-backed**: every todo carries the exact data signals that triggered it ("CompetitorX appeared in 45 AI responses vs ~12 for you")
- **Actionable**: numbered execution steps, effort estimate, target AI engines, and example URLs the AI models currently cite

The feature is fully dynamic per brand. On every brand switch (or time-range change) the view re-fetches the two API endpoints and re-runs the rule engine, so two brands never see the same plan unless their data is identical. Nothing is hardcoded per brand.

User workflow: recommendations land in **Suggested**, the user promotes them to **To-do**, and completes or archives them. That triage state persists per brand (currently in `localStorage`, see section 6).

---

## 2. Current Architecture (Proof of Concept)

### Where it lives

- `live-app/views/todos.js`: one IIFE containing CSS injection, data normalization, the rule engine, and all UI rendering. Registered as the `todos` view in the local SPA (`PB.registerView('todos', ...)`), reachable at `#/todos`.
- The local SPA proxies `/api/*` to the real aipeekaboo REST API with the key attached (`live-app/proxy_server.py`), so all data below is real production API data.

### Data consumed: exactly two endpoints

#### `GET /brands/:id/snapshot`

Called via `PB.api.snapshot(brandId)`. Fields actually read (everything else is ignored):

| Field | Used for |
|---|---|
| `visibility.score` | Overall visibility % (`overall_visibility`), threshold input for most rules |
| `visibility.rank` | Average mention position (`overall_avg_position`), drives the position rule |
| `visibility.totalChatsAnalyzed` | Total analysis runs (`total_runs`), used to approximate mention counts |
| `sources[].domain` | Citation source domains |
| `sources[].mentions` | Citation count per domain (`citation_count`) |
| `sources[].aiModels` | Which AI models cited the domain (mapped to provider keys) |
| `prompts[].promptText`, `.category`, `.averageScore`, `.aiModels` | Fallback prompt metrics if the prompts endpoint fails |
| `competitors[].name`, `.url` | Competitor entities (plus `.score`/`.sentiment`/`.mentions` when present) |
| `brand.name` | Brand display name (fallback to the brand list entry) |

Note: total citation volume is not read from the snapshot; it is computed as the sum of `sources[].mentions`.

#### `GET /brands/:id/prompts?time_range=30d&limit=100`

Called via `PB.api.prompts(brandId, { time_range, limit: 100 })`. Envelope: `{ data: [...], pagination: {...} }`. Item fields:

`promptId`, `promptText`, `category`, `searchIntent`, `averageScore`, `bestScore`, `worstScore`, `totalRuns`, `trend`

Fields actually used: `promptId`, `promptText`, `category`, `searchIntent`, `averageScore` (plus `aiModels` when present, to detect active providers). This endpoint is preferred over `snapshot.prompts` because it carries `promptId` (deep links into the Prompts view) and `searchIntent` (drives the commercial-intent rule).

Both calls run in `Promise.all` with individual `.catch(() => null)` guards; a failed call degrades to the no-data fallback todo rather than breaking the view.

### Normalization layer

`normalizeSnapshot(snap, promptRows, brandName, brandUrl)` maps the live API payloads onto the internal shape the generator expects:

```
{
  brand: string,
  brand_domain: string,            // cleaned (no protocol/www/path, lowercased)
  overall_visibility: number,      // visibility.score
  overall_avg_position: number|null, // visibility.rank
  total_runs: number,              // visibility.totalChatsAnalyzed
  competitor_entities: [{ name, domain, visibility, sentiment|null, mention_count|null }],
  prompt_metrics: [{ prompt_id, prompt_text, visibility_all, topic, intent }],
  top_sources: [{ domain, citation_count, by_provider: {provKey: n}, providers: [provKey] }],
  sources_by_provider: { provKey: [{ domain, citation_count }] },  // sorted desc
  latest_by_provider: {},          // per-model visibility/sentiment/position — EMPTY from live snapshot
  aim_real_hm_data: {},            // competitor-by-model heatmap — EMPTY from live snapshot
  top_source_urls: [],             // URL-level citations — EMPTY from live snapshot
  active_providers: [provKey]      // providers seen in sources[].aiModels / prompts[].aiModels
}
```

Helper functions worth porting as-is (all unit-tested):

- `cleanDomain(d)`: strips protocol, `www.`, path; lowercases
- `modelIdToProv(m)`: maps raw model id strings (`gpt-4o-mini`, `sonar`, `google-ai-mode`, ...) to one of 5 provider keys via regex (see section 9, limitation 4)
- `splitMentions(total, provs)`: deterministically splits a domain's citation total across the providers that cited it (non-negative integers summing exactly to the total). This is an approximation, the live snapshot only gives per-domain totals plus the model list.

### Where the recommendation logic runs

Entirely client-side, in `aimGenerateTodos(snapNorm)` (~1,100 lines), a pure rule-based function: normalized snapshot in, array of todo objects out. No LLM calls, no network. Sub-second execution. Deterministic for the same input. The function plus `normalizeSnapshot` are exported as `window.PBTodosLogic` for node-based unit testing.

---

## 3. Recommendation Output Schema

The shape of one generated todo. **This is the contract for a future `GET /brands/:id/recommendations` endpoint.**

```ts
{
  id: string,           // stable deterministic ID. Parent rules: "td-comp-gap", "td-zero-vis", ...
                        // Suggestion children: "<parentId>-s<index>", e.g. "td-brand-sentiment-s0"
  title: string,        // action title shown in the table, includes interpolated data
  priority: "high" | "medium",
  recType: "content" | "social-media" | "reddit" | "youtube" | "backlinks"
         | "crawlability" | "technical-seo",
  pageType: "on-page" | "off-page",
  effort: string,       // "Low effort" | "Med effort" | "High effort" (matched by substring)
  aiTargets: string[],  // provider keys: "chatgpt" | "gemini" | "perplexity"
                        //               | "googleaio" | "googleaimode"
  reasoning: string,    // "Why we're recommending this" paragraph, shown in detail panel
  signals: string[],    // supporting data points, e.g. "CompetitorX leads by 12 visibility points"
  sigs_fav: (string|null)[],   // favicon domain per signal (parallel array with signals)
  sigs_expand: ({heading: string, items: (string|{text,promptId})[]} | null)[],
                        // expandable detail per signal (parallel array); items with promptId
                        // render as deep links into the Prompts view
  steps: string[],      // numbered execution steps
  examplesHeading: string,     // heading for the examples panel
  examplesNote: string,        // sub-note for the examples panel
  top_source_urls: { url, domain, label, citation_count }[],
                        // example URLs; in the PoC these are derived at render time from
                        // snapshot sources (domain-level) via per-rule selection strategies
  _groupId: string | null,     // parent todo id (set on suggestion children only)
  _groupLabel: string | null   // parent todo title (shown as "Part of: ..." in the why panel)
}
```

Internal fields the generator also emits (used for example selection and rendering, safe to keep server-side or drop from the API response):

- `outcome: string`: expected-impact sentence
- `examplesStrategy`, `examplesContextName`, `examplesModelKey`, `examplesTopicKeywords`, `exampleDomains`, `platDomains`, `brands`: inputs to the example-URL selection strategies (section 6, detail panel)
- `suggestions`: consumed by the expansion pass below, always `null` on emitted todos

### Parent/suggestion expansion (`_aimExpandTodo`)

Rules can define `suggestions` (strings or `{title, steps, signals}` objects). Expansion rules:

1. **Singleton fold**: exactly 1 suggestion → its title is appended to the parent's `steps`; only the parent is emitted.
2. **Multi-suggestion**: the parent is emitted only if it has its own `steps`; each suggestion becomes an independent child todo with id `<parentId>-s<i>`, its own `steps`/`signals` (falling back to the parent's signals), and `_groupId`/`_groupLabel` pointing at the parent. The group label is shown in the why panel, never in the row title.

This means one rule can emit 1 to 6 rows. With rich data the engine produces roughly 15 to 30 rows total.

---

## 4. Recommendation Rules (16 rule blocks)

All rules read the normalized snapshot. `overallVis` = `visibility.score`. `zeroPrompts` = prompts with `averageScore === 0`. `lowPrompts` = prompts with `0 < averageScore < 5`. `totalCitations` = sum of all `sources[].mentions`. `activeProviders()` = providers with per-model visibility data, else providers seen in source/prompt model lists, else all 5.

| # | Rule ID | Trigger | Priority | Effort | Type / Page | Title pattern | Data fields | Children |
|---|---|---|---|---|---|---|---|---|
| 1 | `td-comp-gap` | Top competitor's visibility minus `overallVis` > 3 points | high | High | content / on-page | "Publish a '{brand} vs {comp}' comparison page" | `competitors[0]` (name, visibility, sentiment, mention_count), `total_runs`, zero-vis prompts, heatmap (if present) | 1 suggestion, folded into steps |
| 2 | `td-zero-vis` | `zeroPrompts.length > 0` | high | High | content / on-page | "Publish new pages targeting {n} queries where you have zero visibility" | `prompt_metrics` (text, score, promptId), `lowPrompts` count | none |
| 3 | `td-top-domain` | Top citation source (after skip list) has `citation_count >= 5`. Skip list: reddit/youtube/x/facebook/instagram/tiktok/linkedin/medium + all competitor domains + the brand's own domain | high | Med | backlinks / off-page | "Get listed on {domain}: it drives {share}% of AI citations in your space" | `top_sources`, `totalCitations`, per-provider splits | none |
| 4 | `td-model-gap` | 2+ models have per-model visibility in `latest_by_provider` AND (strongest − weakest) > 3 points | high | Med | content / on-page | "Target {weakestModel} specifically: you get {x}% visibility there vs {y}% on {strongestModel}" | `latest_by_provider[].visibility`, `sources_by_provider` | none. `aiTargets = [weakestModel]` |
| 5 | `td-diversify` | `top_sources.length >= 4` AND top-3 domains hold > 50% of `totalCitations` | medium | High | backlinks / off-page | "Diversify your citation sources: {share}% of AI citations come from just 3 domains" | `top_sources` (top 8), `totalCitations` | none |
| 6 | `td-topic-cluster` | Weakest topic (`category`) with >= 2 prompts has avg visibility < `overallVis * 0.7` OR < 5% | medium | Med | content / on-page | "Build a content cluster for '{topic}': currently {x}% visibility across {n} prompts" | `prompt_metrics` grouped by `topic`/`category` | none |
| 7 | `td-sentiment-opp` | A competitor with `visibility > overallVis` AND `sentiment < 55` exists | medium | Med | content / on-page | "Publish a '{comp} alternatives' page: they have {x}% visibility but only {s}% positive sentiment" | `competitors[]` (visibility, sentiment) | parent (3 steps) + 2 children (comparison page, Reddit engagement) |
| 8 | `td-commercial` | Commercial-intent prompts exist AND their avg visibility < `overallVis * 0.85` OR < 5% | medium | Med | content / on-page | "Improve visibility on buying-intent queries: {n} commercial prompts average just {x}%" | `prompt_metrics[].intent` (`searchIntent`), scores | parent (2 steps) + 3 children (pricing/comparison page, persona pages, case study / ROI calculator) |
| 9 | `td-reddit` | `reddit.com` in `top_sources` with `citation_count > 3` | medium | Med | reddit / off-page | "Get mentioned in Reddit threads: reddit.com drives {n} AI citations in your space ({share}%)" | `top_sources`, per-provider Reddit splits | 1 suggestion, folded. `aiTargets` limited to chatgpt/gemini/perplexity |
| 10 | `td-brand-sentiment` | Average brand sentiment across `latest_by_provider[].sentiment` < 58% | high | High | content / on-page | "Fix how AI describes {brand}: average sentiment is {x}% positive across models" | `latest_by_provider[].sentiment` | parent has NO steps so it is not emitted; 5 children (review campaign, case studies page, objection posts, founder story pitch, "why teams switch" page) |
| 11 | `td-position` | `overall_avg_position` (`visibility.rank`, falling back to avg per-model position) > 5 | medium | Med | content / on-page | "Move up in AI responses: {brand} is named at position {x} on average..." | `visibility.rank`, `latest_by_provider[].position` | parent (2 steps) + 3 children (own "best [category]" post, use-case pages, top-pick placements) |
| 12 | `td-second-comp` | `competitors[1]` exists AND its visibility minus `overallVis` > 5 points | medium | High | content / on-page | "Close the gap with {comp2}: they have {x}% AI visibility vs your {y}%" | `competitors[1]`, heatmap (if present) | parent (1 step) + 4 children (vs page, Reddit threads, prompt-gap content, roundup outreach) |
| 13 | `td-schema` | `zeroPrompts.length >= 2` OR `overallVis < 10` | medium | Low | technical-seo / on-page | "Add FAQ and HowTo schema to your key pages: structured data is what AI parses first" | question-format prompts (regex on `promptText`) | none |
| 14 | `td-google-ai` | Google AIO / AI Mode visibility (min of the two present) < `chatgptVis * 0.55` AND `chatgptVis > 0` (requires `latest_by_provider`) | medium | Med | technical-seo / on-page | "Improve visibility on Google AI: only {x}% vs {y}% on ChatGPT" | `latest_by_provider` for googleaio/googleaimode/chatgpt, `sources_by_provider.googleaio` | parent (3 steps) + 2 children (backlinks from AIO-cited domains, "best [category]" guide) |
| 15 | `td-original-data` | No research/study/report URL pattern in `top_source_urls` OR `overallVis < 12` | medium | High | content / on-page | "Publish an original data study: research reports are the highest-cited content type across all AI models" | `top_source_urls` (URL regex), `top_sources` | 1 suggestion, folded |
| 16 | `td-press` | At least 1 tech-media domain (techcrunch, forbes, theverge, wired, venturebeat, ... 18-entry pattern list) in `top_sources` AND `overallVis < 20` | medium | High | backlinks / off-page | "Get {brand} covered in tech media: {domains} already drive AI citations in your space" | `top_sources` filtered by news domain patterns | 1 suggestion, folded |

**Fallback (`td-no-data`)**: if zero rules fire (empty snapshot, brand never analyzed), a single medium-priority todo is emitted telling the user to run an analysis. The UI never renders an empty table.

Important: rules 4, 10, and 14 depend on `latest_by_provider` (per-model visibility/sentiment/position), and rule 1's per-model signal expansion depends on `aim_real_hm_data` (competitor-by-model heatmap). **The live snapshot endpoint does not return these today**, so those rules rarely or never fire in the PoC. The production backend has this data (it powers the dashboard's per-model views); wiring it in immediately upgrades the engine.

---

## 5. Recommended Production Implementation

### Option A — Backend endpoint (recommended)

```
GET /brands/:id/recommendations?time_range=30d
→ { data: Recommendation[] }   // schema from section 3
```

- **Input**: exactly the data the backend already has for the snapshot + prompts endpoints, plus per-model visibility/sentiment/position and the competitor heatmap (unlocking rules 4, 10, 14).
- **Implementation path**: port `normalizeSnapshot()` and `aimGenerateTodos()` from `todos.js` to the backend language. Both are pure functions with no DOM or network dependencies, and the existing unit tests (`tests/todos.logic.test.mjs`, 16 tests) define the expected behavior and translate directly into backend test cases.
- **Advantages**:
  - One maintainable home for the rule logic; new rules ship without a frontend deploy
  - Server-side caching per brand + time range (the output only changes when an analysis runs, so cache until next analysis)
  - Real URL-level citation data is available server-side, fixing the examples fallback (section 9)
  - Clean upgrade path to LLM-generated or ML-ranked recommendations later: the response contract stays identical
  - The white-label/guest API story: recommendations become a sellable API surface
- **Persistence**: move the triage state (added/completed/archived, priority overrides, notes) from `localStorage` to the DB, keyed `(brand_id, recommendation_id, user/workspace)`. The deterministic rule IDs make this stable across regenerations; add the same stale-ID purge the PoC does (drop saved states whose IDs no longer exist in the current output).

### Option B — Keep client-side (faster to ship)

- Port `todos.js` into a React route in the Next.js app: one component tree (Table, DetailPanel, Filters, FloatingBar) + a `useRecommendations(brandId, range)` hook wrapping the same two API calls + the pure logic module.
- Keep `normalizeSnapshot` + `aimGenerateTodos` as a plain TS module (no React) so the existing unit tests carry over.
- **Advantages**: no backend work, ships in days, logic already proven against production API data.
- **Disadvantages**: logic lives in the browser (visible, harder to version), no server caching, per-model data still missing unless extra endpoints are called, triage state stays in `localStorage` (per browser, not per account) unless a separate persistence endpoint is added anyway.

Either way: do not rewrite the rule semantics. Port them, keep the tests green, then iterate.

---

## 6. UI Specification

### Page layout

Header: "Your AI Visibility Action Plan" + subline "Data-driven actions built from your citation patterns, competitor gaps, and prompt performance." Below it one card containing the tab bar, filters, and table.

### Tabs (pill tab bar, left side of the card header)

- **Suggested (n)**: todos not added, not completed, not archived
- **To-do (n)**: added, not completed, not archived
- **Archive (n)**: completed OR archived
- Counts only render when > 0. Switching tabs clears checkbox selection and closes the detail panel.

### Filters (custom select dropdowns, right side of the card header)

- **Priority**: All / High / Medium
- **Type**: All / Content / Social Media / Reddit / YouTube / Backlinks / Crawlability / Technical SEO
- **Page**: All / On-page / Off-page
- **Effort**: All / Low / Medium / High (matched by substring against the `effort` string; see section 9, limitation 5)
- Additionally, the **global topbar model filter** applies: when a model is selected, only todos whose `aiTargets` include that provider (or have no targets) are shown.

### Table columns

| Column | Content | Sortable |
|---|---|---|
| (checkbox) | Row select, header checkbox selects all visible rows in the current tab | no |
| Recommendation | `title`, 12.5px semibold, left-aligned; struck through + dimmed when completed | yes (`rec`) |
| Priority | Dot badge (High red / Medium amber). **Clickable**: opens a body-attached inline popover to reassign high/medium without leaving the table | yes |
| Page | Dot badge On-page (blue) / Off-page (green) | yes |
| Type | Badge with per-type inline SVG icon (Reddit/YouTube use favicons); hover tooltip explains the type | yes |
| AI Engines | 15px favicon row, one per `aiTargets` provider (openai.com, gemini.google.com, perplexity.ai, google.com), title tooltip per icon | no |
| Effort | 3-bar ascending dot bar: 1 green / 2 amber / 3 red bars lit; tooltip "Low/Medium/High effort" | yes |

Default sort: priority desc. Clicking a sorted header toggles asc/desc (arrow indicator in the header). Row click opens the detail panel; checkbox and priority cells stop propagation.

### Bulk actions

Selecting any checkbox shows a floating bar (fixed, bottom-center, body-attached): "{n} selected" + buttons **Clear / To-do / Archive / Complete** (Complete is the primary/accent button). Actions apply to all selected ids, persist, show a toast ("{n} actions: Added to To-do"), then clear the selection.

State invariants (single-select and bulk): completing removes from archived; archiving removes from completed; added is independent.

### Detail panel (replaces the list, "Back to Action Plan" button on top)

1. **Header card**: title (struck through if completed); badge row: "Why we're recommending this" collapsible toggle, priority badge, page badge, type badge, effort bar, AI engine favicon+label list; action buttons top-right: **To-do / Archive / Complete** (toggle, with active color states).
2. **Why panel** (collapsed by default): `reasoning` paragraph; if the todo is a suggestion child, a "Part of: {parent title}" caption on top.
3. **Signals** section: each signal renders as favicon (`sigs_fav`, with regex-based fallback resolution from the signal text) + bold text; signals with `sigs_expand` get a chevron toggle revealing a heading + item table; items carrying a `promptId` render as links that navigate to `#/prompts/{promptId}`.
4. **Internal notes**: textarea persisted to `localStorage` per brand and todo (`pb_td_notes_<brandId>_<todoId>`), with a Save button that appears on focus and confirms with "Saved".
5. **Steps + Examples grid** (2 columns): numbered steps (dark circle numerals) on the left; on the right an examples list (heading `examplesHeading`, note `examplesNote`) of up to 5 cited URLs with favicon, label, domain, citation count, and an auto-classified page-type badge (Review / Listicle / Guide / Blog Post / Forum Thread / ... via URL-pattern heuristics in `aimGetUrlPageType`). Example selection runs one of 8 per-rule strategies (`alternatives-vs`, `model-specific`, `next-tier-strict`, `topic-editorial`, `schema-examples`, `research-examples`, `editorial-guide`, `commercial-review`) with progressive fallbacks, always excluding Reddit, competitor domains, and the brand's own domain where appropriate.

### State persistence (PoC)

`localStorage`, namespaced per brand, arrays of todo ids:

- `pb_td_added_<brandId>`
- `pb_td_completed_<brandId>`
- `pb_td_archived_<brandId>`
- `pb_td_notes_<brandId>_<todoId>` (string)

On every render the sets are purged of ids that no longer exist in the freshly generated list. Priority reassignments are in-memory only (not persisted) in the PoC.

### Misc behaviors

- Skeleton state while the two API calls load
- Toast notifications (bottom-center, dark) for every triage action
- Body-attached chrome (floating bar, popover, toast) hides on route change; the scope class is removed from the view container when navigating away

---

## 7. Design Tokens & CSS

All view CSS is injected once by `injectTodosCSS()` under the `.pb-todos-scope` class (plus the three body-attached chrome elements). In production these map onto the existing Peekaboo design system; values below are what the PoC uses:

```css
--bg / --surface:  #ffffff;
--surface-alt:     #fafafa;
--surface-hover:   #f4f4f5;
--border:          #EEEEEF;
--border-light:    rgba(0,0,0,0.05);
--text:            #1c1917;
--text-muted:      #545D6C;
--text-faint:      #9CA3AF;
--accent:          #b352b3;          /* Peekaboo purple */
--accent-hover:    #a043a0;
--accent-light:    rgba(179,82,179,0.08);
--accent-30:       rgba(179,82,179,0.3);
--brand-pink:      #f8c8ff;
--brand-yellow:    #ffcc45;
--success:         #10b981;  --success-light: #dcfce7;
--danger:          #ef4444;  --danger-light:  #fee2e2;
--warning:         #f59e0b;
--radius:          10px;
--radius-lg:       14px;
--radius-pill:     9999px;
--shadow:          0 1px 2px rgba(0,0,0,0.05);
--shadow-md:       0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1);
--shadow-lg:       0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.05);
--font:            'Inter', ui-sans-serif, system-ui, sans-serif;
```

Notable component styles: priority/page/type badges share one `.aim-intent-badge` base (white bg, 1px #e5e7eb border, colored dot or icon); priority colors high `#fee2e2`/`#b91c1c`, medium `#fef9c3`/`#854d0e`; the source page-type badges have ~16 colored variants; favicons come from `https://www.google.com/s2/favicons?domain={d}&sz=32` with `onerror` hide.

---

## 8. File Reference

| File | What it is |
|---|---|
| `live-app/views/todos.js` | Full implementation: CSS, normalization, rule engine, UI, view registration, `window.PBTodosLogic` export |
| `live-app/assets/api.js` | API client (`window.PBApi`): endpoint paths, envelope handling, error type |
| `live-app/tests/todos.logic.test.mjs` | 16 unit tests for the pure logic (normalization, provider mapping, rule thresholds, expansion). Run: `node live-app/tests/todos.logic.test.mjs` (zero deps, non-zero exit on failure) |
| `live-app/index.html` | SPA shell: sidebar nav item (`href="#/todos"`) and `<script src="/views/todos.js">` wiring |
| `live-app/proxy_server.py` | Local proxy that maps `/api/*` to the real REST API with the key attached |

---

## 9. Known Limitations of the PoC

1. **Logic is client-side.** Visible in the browser, re-runs on every view load, no caching. Moves server-side in production (Option A).
2. **`competitors[]` may be empty.** If a brand has no competitors configured, rules 1, 7, and 12 never fire and the plan loses its strongest recommendations. Production should surface "add competitors to unlock more recommendations" in that case.
3. **No URL-level citation data.** The snapshot only exposes domain-level sources, so the detail panel's example list falls back to one synthetic entry per domain (`url = domain`, `citation_count` = domain total). The backend has real cited URLs; using them restores per-URL examples, accurate page-type badges, and the URL-pattern strategies (`alternatives-vs`, `schema-examples`, etc.) at full strength.
4. **Per-model data is missing from the snapshot.** `latest_by_provider` (visibility/sentiment/position per model) and the competitor heatmap arrive empty, so rules 4 (model gap), 10 (brand sentiment), and 14 (Google AI gap) effectively never fire in the PoC, and `splitMentions` has to approximate per-provider citation counts. Production should feed the real per-model numbers.
5. **Provider keys come from string-matching model ids** (`modelIdToProv`: regexes for gpt/gemini/sonar/aio/ai-mode). Adding a new AI model to the platform requires updating this map, or, better, the backend should return a canonical provider key per model.
6. **Effort filter bug**: generated todos use the string `"Med effort"` but the Medium filter matches the substring `"medium"`, so the Medium effort filter currently returns nothing. Fix in production by making `effort` an enum (`low | medium | high`) and formatting the label in the UI.
7. **Priority reassignments and triage state are not account-level.** Priority overrides are lost on reload; added/completed/archived/notes live in `localStorage` per browser. Production needs DB persistence keyed by brand + recommendation id (the deterministic ids make this safe).
8. **Time range affects inputs only.** `time_range` is passed to the prompts call and used in a few signal labels, but the snapshot endpoint is range-less; a production recommendations endpoint should make the range explicit end to end.

---

## 10. Weekly Refresh Cycle & On-Demand Generation (added 2026-06-12)

Two behaviors layered on top of the rule engine. Both are PoC implementations with explicit production paths.

### Weekly refresh cycle

The plan no longer regenerates on every page load. Cadence is weekly, per brand:

- Storage: `localStorage` key `pb_td_weekly_<brandId>` holding `{ generatedAt: <ISO string>, todos: [...] }`.
- On view load the stored entry is classified by the pure function `weeklyCacheState(stored, nowMs)` (exposed on `window.PBTodosLogic`, unit-tested): `'fresh'` (< 7 days = 604,800,000 ms), `'expired'` (>= 7 days, boundary inclusive), or `'missing'` (absent, unparseable, or structurally corrupt; `JSON.parse` failures and bad shapes all fall back to `'missing'`, never throw).
- `fresh`: stored todos are used as-is. `expired` or `missing`: the two API endpoints are re-fetched, the rule engine re-runs, the cache is written with a new `generatedAt`, and (on `expired` only, not first-ever generation) the user sees the toast "Your action plan has been refreshed with this week's data".
- The snapshot + prompts fetch still runs on every load regardless of cache state, because the detail panel's example URLs read the normalized snapshot. Only the todo *generation* is on the weekly cycle.
- The existing stale-ID purge for the added/completed/archived sets runs against whichever todo set is active.
- A caption under the page subtitle ("Updated <Mon DD> · refreshes weekly") is driven by `generatedAt`.
- Brand switches are independent: each brand has its own key and its own 7-day window.

**Production:** the generation timestamp should live server-side, not in `localStorage` (it is per-browser and clearable). Either a weekly cron that regenerates and stamps each brand's recommendation set, or an on-demand check in the recommendations endpoint (regenerate when `now - generatedAt >= 7 days`, else serve the stored set). The endpoint should return `generatedAt` so the client can render the caption.

### On-demand "Generate New Recommendations" (type-scoped)

An accent CTA in the table filter row opens a dropdown with the six user-facing categories (Content, Social Media, Reddit, YouTube, Backlinks, Crawlability, mapping to `recType` keys `content`, `social-media`, `reddit`, `youtube`, `backlinks`, `crawlability`). Selecting one:

1. Re-fetches the snapshot + prompts endpoints.
2. Re-runs the deterministic rule engine, filters the output to the selected `recType`.
3. Merges via the pure function `mergeNewTodos(existing, generated, recType)` (exposed on `window.PBTodosLogic`, unit-tested): appends only todos whose `id` is not already present, returns `{merged, addedCount}`, mutates nothing. Because archived/completed todos remain in the existing set, their ids are never resurrected.
4. Writes the merged set back into the weekly cache **without changing `generatedAt`**, so on-demand generation does not reset the weekly window.
5. Toasts the result count, or a "no new recommendations right now" message when the engine produced nothing new for that type.

**Honest limitation:** the engine is deterministic, so re-running it against unchanged data yields the same ids and the merge adds nothing. New recommendations only appear when the underlying API data has changed since the weekly set was generated (new citations, prompt movement, competitor shifts). In practice the button is most useful mid-week after new analysis runs. Note also that the engine currently emits no todos with `recType` `social-media`, `youtube`, or `crawlability` (no rules target them yet), so those options will always toast zero until rules or an LLM generator exist for them.

**Production:** this is the natural seam for an LLM-backed generator. Route the selected category to a per-category generation prompt (with the same snapshot data as context), validate the response against the todo schema, and dedupe server-side against the stored set by id or semantic similarity. The deterministic engine can remain as the guaranteed-coverage baseline.
