# Peekaboo Live Dashboard — Engineering Handoff

This repo is a proof-of-concept dashboard built on top of the Peekaboo REST API. It was built to:

1. Prove out the **AI Visibility Action Plan** feature (brand-specific recommendations driven by real API data)
2. Serve as a **reference implementation and design spec** for the engineering team to build this properly into the product

The working app lives in `live-app/`. The engineering spec lives in `RECOMMENDATIONS_SPEC.md`.

---

## What's in this repo

```
live-app/               ← The working SPA (run locally or deploy to Vercel)
live-app/README.md      ← Technical reference: file-by-file, routes, filters, config
RECOMMENDATIONS_SPEC.md ← Engineering spec for the Action Plan / Recommendations feature
FRONTEND_NOTES.md       ← PoC-to-production translation (Next.js/TypeScript/Radix/Zustand/Prisma)
```

---

## Running the app locally

**Prerequisites:** Python 3 (stdlib only — no pip installs needed), a Peekaboo API key.

```bash
git clone https://github.com/filipelinsduarte/peekaboo-live-dashboard.git
cd peekaboo-live-dashboard/live-app

# Set up config
cp config.example.json config.json
# Edit config.json and replace "pk_YOUR_API_KEY_HERE" with a real Peekaboo API key

# Start the server
python3 proxy_server.py

# Open in browser
open http://localhost:7898
```

The server proxies all `/api/*` requests to `https://www.aipeekaboo.com/api/v1` with the API key injected server-side (key never reaches the browser). Successful GET responses are cached in memory for 5 minutes.

**Multiple local instances:** `proxy_server.py` takes an optional config filename, so a second instance with its own API key and port can run side by side from the same directory:

```bash
python3 proxy_server.py config2.json
```

---

## Deploying to Vercel

The production equivalent of `proxy_server.py` is the serverless function `live-app/api/proxy.js`. `live-app/vercel.json` rewrites `/api/*` to it and routes everything else to the SPA shell. The API key lives in the `PEEKABOO_API_KEY` env var on the Vercel project (never in the bundle), and successful GETs get edge caching (`s-maxage=300, stale-while-revalidate=600`), matching the local proxy's 5-minute TTL. `.vercelignore` keeps config files, tests, and capture tooling out of the upload.

Two live deployments exist, each its own Vercel project with its own API key (separate rate-limit quota):

| URL | Project | Key scope |
|---|---|---|
| https://peekaboo-live-dashboard.vercel.app | `peekaboo-live-dashboard` | 121-brand account key |
| https://peekaboo-autodoc.vercel.app | `peekaboo-autodoc` | single-brand (Autodoc) key |

Deploy from `live-app/`:

```bash
cd live-app
vercel deploy --prod
```

The Vercel CLI reads the project link from `live-app/.vercel/project.json` (currently linked to `peekaboo-live-dashboard`). The autodoc project's link is kept in `.vercel-autodoc/`; swap it into `.vercel/` to deploy that instance instead.

---

## What to look at first

| If you want to...                              | Read this                        |
|------------------------------------------------|----------------------------------|
| Understand the feature and implementation plan | `RECOMMENDATIONS_SPEC.md`        |
| Map the PoC onto the production stack          | `FRONTEND_NOTES.md`              |
| See the recommendation logic                   | `live-app/views/todos.js`        |
| See the API client                             | `live-app/assets/api.js`         |
| See the SPA framework + entity-domain resolver | `live-app/assets/app.js`         |
| Run the unit tests                             | `node live-app/tests/todos.logic.test.mjs` (all suites below) |

---

## The main feature: AI Visibility Action Plan

Navigate to **http://localhost:7898/#/todos** after starting the server.

- Switch between brands using the brand selector (top left): each brand gets its own recommendation set, generated from its own data
- The feature is currently **client-side**: it fetches `/snapshot`, `/prompts`, and `/looker/summary` (per-model stats), samples the first 12 `/prompts/:id` detail calls for URL-level citation examples, normalises the data, and runs 19 rule-based generators in the browser
- Generation runs on a **weekly cache cycle** per brand (localStorage, version 3), with a "Generate New Recommendations" button for type-scoped on-demand regeneration
- `RECOMMENDATIONS_SPEC.md` documents the full output schema, all 19 rules with exact thresholds, the weekly cache and merge behavior, and the recommended production implementation (a backend `GET /brands/:id/recommendations` endpoint)

---

## API endpoints used

| Endpoint | Used by |
|---|---|
| `GET /brands` | Brand selector (lists all brands) |
| `GET /brands/:id` | Lazy brand-detail enrichment (header pill, Manage Brands) |
| `GET /brands/:id/snapshot` | Dashboard, Action Plan |
| `GET /brands/:id/prompts` | Prompts view, Action Plan, Sources URLs tab |
| `GET /brands/:id/prompts/:pid` | Prompt detail page (`include_full_response=true`), Prompts row enrichment, Action Plan URL sampling, Sources URLs tab |
| `GET /brands/:id/competitors` | Competitors view, Prompt detail, Prompts view (tracked-domain map for favicons) |
| `GET /brands/:id/sources` | Sources view |
| `GET /brands/:id/visibility` | Visibility chart |
| `GET /brands/:id/categories` | Categories view |
| `GET /brands/:id/search-console` | Search Console view |
| `GET /looker/summary` | Time-series charts, heatmap, Competitors view, Action Plan per-model stats |

Full response shapes are documented in `RECOMMENDATIONS_SPEC.md` §2.

---

## Running the tests

All suites are plain Node scripts, zero dependencies, non-zero exit on failure. Current counts (all green):

```bash
node live-app/tests/todos.logic.test.mjs         # 66 tests: Action Plan engine
node live-app/tests/prompt-detail.logic.test.mjs # 49 tests: prompt detail page logic
node live-app/tests/sources.test.mjs             # 25 tests: sources view logic
node live-app/tests/competitors.view.test.mjs    # 25 tests: competitors view logic
node live-app/tests/integrations.test.mjs        # 25 tests: integrations view logic
node live-app/tests/entity-domain.test.mjs       # 22 tests: entity name → domain resolver
node live-app/tests/search-console.test.mjs      # 18 tests: search console logic
node live-app/tests/topbar.logic.test.mjs        # 13 tests: topbar/brand selector logic
node live-app/views/prompts.logic.test.mjs       # 11 tests: prompts filter/sort logic
```

`live-app/tests/header_dropdowns_verify.py` is a Playwright browser check (needs the local server running), not a unit test.

---

## Architecture overview

```
proxy_server.py     stdlib Python: serves static files + proxies /api/* with key injection (local)
api/proxy.js        Vercel serverless function: same proxy, key from PEEKABOO_API_KEY env (production)
vercel.json         Vercel rewrites: /api/* → api/proxy.js, everything else → index.html
config.json         API key + base URL (gitignored — use config.example.json as template)
index.html          SPA shell (real product CSS from Next.js, enhanced by app.js)
assets/
  api.js            PBApi — thin fetch wrapper for all endpoints
  app.js            PB framework: router, brand selector, header, sidebar, DOM helpers,
                    shared entity-domain favicon resolver (PB.entityDomain / PBEntityLogic)
  styles.css        Custom layer on top of product Tailwind/shadcn CSS
binders/            Dashboard card binders (inject live data into captured card HTML)
views/              One JS file per page — each calls PB.registerView(name, fn)
tests/              Node-runnable unit tests for pure logic functions
```

---

## Notes for production implementation

- `live-app/config.json` and `config2.json` are gitignored (and `.vercelignore`d). Never commit them. Engineers should copy `config.example.json`.
- The recommendation logic in `views/todos.js` should move server-side in production. See `RECOMMENDATIONS_SPEC.md` §5 for the recommended approach.
- All 19 recommendation rules fire in this PoC. Per-model visibility/sentiment/position is computed client-side from `/looker/summary` rows; production should compute it server-side. The one remaining data gap is the competitor-by-model heatmap, which only affects rule 1's per-model signal expansion (see spec §9, limitation 4).
- Entity-name-to-domain resolution for favicons is centralised in `PB.entityDomain(name, citedDomains, trackedMap)` in `assets/app.js` (a 4-step chain that never guesses URLs). Port it as a shared utility; see `FRONTEND_NOTES.md` §7.
