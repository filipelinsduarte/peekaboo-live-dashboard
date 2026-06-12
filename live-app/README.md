# Peekaboo Live Dashboard (API-driven)

A real dashboard that renders **live data from the Peekaboo REST API** for any of the ~120 brands in the account. This is separate from the static capture mirror in `../app/` (which is a pixel copy with Flexzo's data baked in). This one fetches everything live.

## Run it

```bash
cd ~/Desktop/peekaboo-dashboard-local/live-app
python3 proxy_server.py
```

Open: **http://localhost:7898**

Pick any brand from the selector (top-left). Brands with recent analysis are listed first; brands without data show a "no data" badge and graceful empty states.

## Design

The app uses the **exact same design as the captured static mirror** (`../app`, port 7897): the real compiled product CSS (`_next/static/css/*`), the real fonts (Inter), and the real sidebar + header markup. `build_shell.py` generates `index.html` from the captured `dashboard.html` — keeping the real shell and swapping only the main content region for `<main>`'s `#view`, into which the SPA renders live data using the product's shadcn card chrome. If you ever re-capture the static mirror, re-run `python3 build_shell.py` to refresh the shell.

## How it works

- **`proxy_server.py`** — a stdlib-only Python server that (1) serves the SPA and (2) proxies `/api/*` to `https://www.aipeekaboo.com/api/v1/*`, injecting the `X-API-Key` header server-side so the key never reaches the browser (also solves CORS, which the REST API doesn't send). Successful GETs are cached in memory for 5 minutes to stay well under the rate limit (Pro tier: 40/min, 2000/day).
- **`config.json`** — holds the API key, base URL, port, cache TTL. (Treat as a secret.)
- **`index.html`** — the shell: loads Tailwind (Play CDN, themed with Peekaboo tokens), Chart.js, Lucide icons, the core framework, and the view modules.
- **`assets/api.js`** — `PBApi`, a thin typed-ish client over the documented endpoints.
- **`assets/app.js`** — the `PB` framework: sidebar, top bar (brand selector + model filter + date range), hash router, DOM builder, formatting helpers, toast, skeletons. View modules register via `PB.registerView(name, render)`.
- **`assets/styles.css`** — small custom layer (cards, tables, bars, dropdowns) on top of Tailwind.
- **`views/*.js`** — one module per page.

## Pages and their data sources

| Page | Route | Endpoints |
|---|---|---|
| Dashboard | `#/dashboard` | `/snapshot` (visibility, traffic, prompts, sources, competitors, AI suggestions), `/visibility` (trend + market share), `/looker/summary` (time-series Visibility chart) |
| Prompts | `#/prompts` | `/prompts` (paginated, with category + intent filters) |
| Prompt detail | `#/prompts/:id` | `/prompts/:id` (per-run history, competitor + source summaries) |
| Competitors | `#/competitors` | `/competitors` (rankings), `/looker/summary` (brand × model heatmap) |
| Sources | `#/sources` | `/sources` (domains, citations, citing models) |
| Categories | `#/categories` | `/categories` (rollups by category + search-intent distribution) |

## Filters

- **Brand selector** — switch between all brands; selection persists in localStorage.
- **Model filter** — All Models / ChatGPT / Gemini / Perplexity / Google AI Overview / Google AI Mode. Applied to the time-series chart and heatmap (the API filters time-series rows by `ai_model`).
- **Date range** — 7 / 30 / 90 days (the API's max is 90). Drives `/visibility` `time_range` and the `/looker/summary` window.

## Notes / limits

- Read-only — the dashboard never writes. (The API does support writes with a read+write key, but that's out of scope here.)
- The live Visibility "source types" donut on aipeekaboo.com is by source *type* (Corporate/Social/etc.); the API doesn't expose type, so this build shows top *domains* by citations instead.
- Some domains have no favicon — those 404s from Google's favicon service are expected and harmless (every favicon/logo has an `onerror` fallback).
- Rebuilding the cache: just restart the server, or wait 5 minutes.
