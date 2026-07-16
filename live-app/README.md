# Peekaboo Live App

A real dashboard that renders **live data from the Peekaboo REST API** for any brand in the account. This is the working proof-of-concept — see the root `README.md` for onboarding and `../RECOMMENDATIONS_SPEC.md` for the engineering handoff spec.

## Run it

```bash
cd live-app
cp config.example.json config.json   # then add your API key
python3 proxy_server.py
```

Open: **http://localhost:7898**

A second instance with its own key and port can run side by side: `python3 proxy_server.py config2.json` (the optional argv is the config filename).

## Deploy it (Vercel)

```bash
cd live-app
vercel deploy --prod
```

- **`api/proxy.js`** is the serverless replacement for `proxy_server.py`: forwards `/api/*` to the Peekaboo API with `X-API-Key` from the `PEEKABOO_API_KEY` env var, edge-caches successful GETs (`s-maxage=300, stale-while-revalidate=600`).
- **`vercel.json`** rewrites `/api/:path*` to the function and all non-asset paths to `index.html` (SPA fallback).
- **`.vercelignore`** excludes `config*.json`, `tests/`, `capture/`, and the build tooling from the upload.
- Two live projects: **https://peekaboo-live-dashboard.vercel.app** (121-brand key, linked via `.vercel/`) and **https://peekaboo-autodoc.vercel.app** (single-brand key with its own quota, link stored in `.vercel-autodoc/`; swap it into `.vercel/` to deploy that project).

## How it works

- **`proxy_server.py`**: stdlib-only Python server (no pip). Serves the SPA and proxies `/api/*` → `https://www.aipeekaboo.com/api/v1/*`, injecting `X-API-Key` server-side (key never reaches the browser; also solves CORS). Successful GETs cached in memory for 5 minutes (Pro tier: 40 req/min, 2000 req/day). Optional argv selects the config file.
- **`config.json`**: API key, base URL, port, cache TTL. **Gitignored, never commit this file.** (`config2.json` for a second instance, same rule.)
- **`index.html`** — SPA shell: real compiled product CSS (`_next/static/css/*`), Inter font, real sidebar + header markup. Regenerate after a re-capture with `python3 build_shell.py`.
- **`assets/api.js`**: `PBApi`, thin fetch wrapper. All methods unwrap `.data` from the API envelope except `prompts()` and `looker()` which return the full envelope. `promptDetail(id, pid, range, full)` passes `include_full_response=true` when `full` is set.
- **`assets/app.js`**: `PB` framework: hash router, brand selector, model + date filters, sidebar, DOM builder, formatters, toast, skeletons. Views register via `PB.registerView(name, async fn(root, ctx))`. Also home of the shared entity-domain resolver: `PB.entityDomain(name, citedDomains, trackedMap)` (exported as `window.PBEntityLogic` for tests) resolves a brand/entity name to a real favicon domain through a 4-step chain (tracked API urls → cited-domain SLD exact match → curated known-brands map → null, caller falls back to a letter avatar). Domains are never constructed or guessed. Used by the prompts list, prompt detail, todos, competitors view, and the dashboard competitors binder.
- **`assets/styles.css`** — small custom layer on top of Tailwind/shadcn.
- **`binders/`**: dashboard card binders: inject the exact captured card HTML then swap the baked demo data for live data.
- **`views/`** — one JS file per page.

## Pages

| Route | View file | Key endpoints |
|---|---|---|
| `#/dashboard` | `views/dashboard.js` + `binders/` | `/snapshot`, `/visibility`, `/looker/summary` |
| `#/prompts` | `views/prompts.js` | `/prompts`, `/competitors` (favicon map), `/prompts/:id` (lazy row enrichment) |
| `#/prompts/:id` | `views/prompt-detail.js` | `/prompts/:id?include_full_response=true`, `/competitors` |
| `#/competitors` | `views/competitors.js` | `/competitors`, `/looker/summary` |
| `#/sources` | `views/sources.js` | `/sources`, plus `/prompts` + `/prompts/:id` for the URLs tab |
| `#/categories` | `views/categories.js` | `/categories` |
| `#/search-console` | `views/search-console.js` | `/search-console` |
| `#/todos` | `views/todos.js` | `/snapshot`, `/prompts`, `/looker/summary`, `/prompts/:id` (12-prompt URL sampling on regeneration) |
| `#/ask-ai` | `views/ask-ai.js` | none (static shell; the public API has no chat endpoint) |
| `#/integrations` | `views/integrations.js` | — |

`#/prompts/:id` was substantially redesigned from the original v4 port (July 2026) into a denser, more capable layout: a prompt-switcher dropdown (with per-prompt visibility score + sort), a header card (Mentions/Visibility/Sentiment/Avg Position stats + Top Brands/Citations/Content Type), a 4-mode chart card (Visibility/Heatmap/Citations/Mentions), a paginated Response History list with an All/Mentioned/Not-mentioned toggle, Sources + Mentioned Brands leaderboard cards, and a CSV export. Full architecture writeup, including a real state-cascade gotcha worth understanding before editing: **[`PROMPT_DETAIL_HANDOVER.md`](./PROMPT_DETAIL_HANDOVER.md)**. Pure logic is exported as `window.PBPromptDetailLogic` (tested).

## Filters (top bar)

- **Brand selector** — all brands in the account; persists in localStorage
- **Model filter** — All / ChatGPT / Gemini / Perplexity / Google AI Overview / Google AI Mode
- **Date range** — 7 / 30 / 90 days (API max is 90)

## Tests

All plain Node, zero deps, non-zero exit on failure. Current counts (all green):

```bash
node tests/todos.logic.test.mjs          # 66 tests: Action Plan engine (rules, cache, merge, looker stats, URL aggregation)
node tests/prompt-detail.logic.test.mjs  # 87 tests: prompt detail grouping, aggregates, chart series, CSV export, modal formatting
node tests/sources.test.mjs              # 25 tests: sources view logic
node tests/competitors.view.test.mjs     # 25 tests: competitors view logic
node tests/integrations.test.mjs         # 25 tests: integrations view logic
node tests/entity-domain.test.mjs        # 22 tests: PB.entityDomain resolver chain
node tests/search-console.test.mjs       # 18 tests: search console logic
node tests/topbar.logic.test.mjs         # 13 tests: topbar/brand selector logic
node views/prompts.logic.test.mjs        # 11 tests: prompts filter/sort/enrichment logic
```

`tests/header_dropdowns_verify.py` is a Playwright browser verification (run the local server first), not part of the unit suite.

## Config reference

```json
{
  "api_key": "pk_...",
  "api_base": "https://www.aipeekaboo.com/api/v1",
  "port": 7898,
  "cache_ttl_seconds": 300
}
```

## Known limits

- Read-only — no write operations
- Sources donut shows top domains by citations (API has no source-type taxonomy; type is derived from domain name)
- Favicon 404s from Google's favicon service are expected and harmless; entity favicons that don't resolve through `PB.entityDomain` fall back to letter avatars
- The competitor-by-model heatmap is still empty from the live APIs, so rule 1's per-model signal expansion never renders (all 19 Action Plan rules otherwise fire; per-model stats come from `/looker/summary`). See `../RECOMMENDATIONS_SPEC.md` §9.
- Ask AI is a visual shell only (no chat endpoint in the public API)
