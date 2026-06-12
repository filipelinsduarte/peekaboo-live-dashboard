# Peekaboo Live App

A real dashboard that renders **live data from the Peekaboo REST API** for any brand in the account. This is the working proof-of-concept — see the root `README.md` for onboarding and `../RECOMMENDATIONS_SPEC.md` for the engineering handoff spec.

## Run it

```bash
cd live-app
cp config.example.json config.json   # then add your API key
python3 proxy_server.py
```

Open: **http://localhost:7898**

## How it works

- **`proxy_server.py`** — stdlib-only Python server (no pip). Serves the SPA and proxies `/api/*` → `https://www.aipeekaboo.com/api/v1/*`, injecting `X-API-Key` server-side (key never reaches the browser; also solves CORS). Successful GETs cached in memory for 5 minutes (Pro tier: 40 req/min, 2000 req/day).
- **`config.json`** — API key, base URL, port, cache TTL. **Gitignored — never commit this file.**
- **`index.html`** — SPA shell: real compiled product CSS (`_next/static/css/*`), Inter font, real sidebar + header markup. Regenerate after a re-capture with `python3 build_shell.py`.
- **`assets/api.js`** — `PBApi`, thin fetch wrapper. All methods unwrap `.data` from the API envelope except `prompts()` which returns the full envelope (has pagination).
- **`assets/app.js`** — `PB` framework: hash router, brand selector, model + date filters, sidebar, DOM builder, formatters, toast, skeletons. Views register via `PB.registerView(name, async fn(root, ctx))`.
- **`assets/styles.css`** — small custom layer on top of Tailwind/shadcn.
- **`binders/`** — dashboard card binders: inject the exact captured card HTML then swap Flexzo's baked data for live data.
- **`views/`** — one JS file per page.

## Pages

| Route | View file | Key endpoints |
|---|---|---|
| `#/dashboard` | `views/dashboard.js` + `binders/` | `/snapshot`, `/visibility`, `/looker/summary` |
| `#/prompts` | `views/prompts.js` | `/prompts` |
| `#/prompts/:id` | `views/prompt-detail.js` | `/prompts/:id` |
| `#/competitors` | `views/competitors.js` | `/competitors`, `/looker/summary` |
| `#/sources` | `views/sources.js` | `/sources` |
| `#/categories` | `views/categories.js` | `/categories` |
| `#/search-console` | `views/search-console.js` | `/search-console/*` |
| `#/todos` | `views/todos.js` | `/snapshot`, `/prompts` |
| `#/ask-ai` | `views/ask-ai.js` | `/ask` |
| `#/integrations` | `views/integrations.js` | — |

## Filters (top bar)

- **Brand selector** — all brands in the account; persists in localStorage
- **Model filter** — All / ChatGPT / Gemini / Perplexity / Google AI Overview / Google AI Mode
- **Date range** — 7 / 30 / 90 days (API max is 90)

## Tests

```bash
node tests/todos.logic.test.mjs       # 16 tests — Action Plan logic
node tests/topbar.logic.test.mjs      # Topbar/brand selector logic
node views/prompts.logic.test.mjs     # Prompts filter/sort logic
```

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
- Favicon 404s from Google's favicon service are expected and harmless
- Three Action Plan rules don't fire in this PoC (model gap, brand sentiment, Google AI gap) — snapshot endpoint doesn't return per-provider heatmap data; production backend does
