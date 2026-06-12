# Peekaboo Live Dashboard — Engineering Handoff

This repo is a proof-of-concept dashboard built on top of the Peekaboo REST API. It was built to:

1. Prove out the **AI Visibility Action Plan** feature (brand-specific recommendations driven by real API data)
2. Serve as a **reference implementation and design spec** for the engineering team to build this properly into the product

The working app lives in `live-app/`. The engineering spec lives in `RECOMMENDATIONS_SPEC.md`.

---

## What's in this repo

```
live-app/               ← The working SPA (run this locally to see it in action)
RECOMMENDATIONS_SPEC.md ← Engineering spec for the Action Plan / Recommendations feature
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

---

## What to look at first

| If you want to...                              | Read this                        |
|------------------------------------------------|----------------------------------|
| Understand the feature and implementation plan | `RECOMMENDATIONS_SPEC.md`        |
| See the recommendation logic                   | `live-app/views/todos.js`        |
| See the API client                             | `live-app/assets/api.js`         |
| See the SPA framework                          | `live-app/assets/app.js`         |
| Run the unit tests                             | `node live-app/tests/todos.logic.test.mjs` |

---

## The main feature: AI Visibility Action Plan

Navigate to **http://localhost:7898/#/todos** after starting the server.

- Switch between brands using the brand selector (top left) — recommendations fully regenerate per brand
- The feature is currently **client-side**: it calls two API endpoints (`/snapshot` + `/prompts`), normalises the data, and runs 16 rule-based generators in the browser
- `RECOMMENDATIONS_SPEC.md` documents the full output schema, all 16 rules with exact thresholds, and the recommended production implementation (a backend `GET /brands/:id/recommendations` endpoint)

---

## API endpoints used

The entire app uses two base endpoints (plus supporting ones per view):

| Endpoint | Used by |
|---|---|
| `GET /brands` | Brand selector (lists all brands) |
| `GET /brands/:id/snapshot` | Dashboard, Action Plan |
| `GET /brands/:id/prompts` | Prompts view, Action Plan |
| `GET /brands/:id/competitors` | Competitors view |
| `GET /brands/:id/sources` | Sources view |
| `GET /brands/:id/visibility` | Visibility chart |
| `GET /brands/:id/categories` | Categories view |
| `GET /looker/summary` | Time-series charts, heatmap |

Full response shapes are documented in `RECOMMENDATIONS_SPEC.md` §2.

---

## Running the tests

```bash
# Action Plan logic (16 tests)
node live-app/tests/todos.logic.test.mjs

# Topbar logic
node live-app/tests/topbar.logic.test.mjs

# Prompts logic
node live-app/views/prompts.logic.test.mjs
```

---

## Architecture overview

```
proxy_server.py     stdlib Python — serves static files + proxies /api/* with key injection
config.json         API key + base URL (gitignored — use config.example.json as template)
index.html          SPA shell (real product CSS from Next.js, enhanced by app.js)
assets/
  api.js            PBApi — thin fetch wrapper for all endpoints
  app.js            PB framework — router, brand selector, header, sidebar, DOM helpers
  styles.css        Custom layer on top of product Tailwind/shadcn CSS
binders/            Dashboard card binders (inject live data into captured card HTML)
views/              One JS file per page — each calls PB.registerView(name, fn)
tests/              Node-runnable unit tests for pure logic functions
```

---

## Notes for production implementation

- `live-app/config.json` is gitignored. Never commit it. Engineers should copy `config.example.json`.
- The recommendation logic in `views/todos.js` should move server-side in production. See `RECOMMENDATIONS_SPEC.md` §5 for the recommended approach.
- Three recommendation rules (model gap, brand sentiment, Google AI gap) don't fire in this PoC because the snapshot endpoint doesn't return per-provider heatmap data. The production backend has this data — wiring it in immediately extends the recommendation engine.
