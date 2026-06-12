# Peekaboo Dashboard — Local Test Environment

A pixel-faithful static mirror of the live aipeekaboo.com dashboard (captured 2026-06-11, logged in as team+10@aipeekaboo.com, brand: Flexzo). Use it to iterate on UI/UX freely without touching the live repo.

## Run it

```bash
cd ~/Desktop/peekaboo-dashboard-local/app
python3 -m http.server 7897
```

Open: http://localhost:7897 (lands on the Dashboard)

## What works

- All 11 pages with real rendered data: Dashboard, Ask AI, Prompts, Competitors, Sources, Search Console, Gap Analysis, Content Briefs, Share Links, Integrations, Settings
- Sidebar navigation between all pages
- Settings tabs (Brand Details, Manage Competitors, Manage Prompts, Analysis Schedule, White Label)
- Integrations tabs (MCP, REST API, Usage, Looker Studio, API Docs)
- Toggles: Dashboard "Brand mentioned" + all 5 Share Links hide-toggles (each state is a real captured snapshot)
- All charts (rendered SVG), tables, donut, chat rows: exact copies of live

## Brand switcher + filter flows (added 2026-06-11)

- Brand pill (top left) opens the real Switch Brand menu (search, status/activity filters, brand list)
- "Add New Brand" opens the captured Create New Brand wizard (Step 1 of 5); Cancel returns
- "Manage Brands" opens the captured manage modal (20 brands, pause/delete table)
- Clicking the Peekaboo brand switches the whole local app to the captured Peekaboo-brand data (dashboard, Search Console with GSC data, Prompts); clicking Flexzo switches back
- "All Models" dropdown opens with model list; clicking ChatGPT shows the ChatGPT-filtered dashboard
- Date range button opens the captured date picker
- Any prompts table row opens the captured prompt detail page (full per-model chat history)
- Recent Chats rows (Peekaboo dashboard) open the captured chat detail modal

## Second pass (2026-06-11, four parallel agents)

- **Brand switcher is now a true in-page dropdown**: opens/closes below the pill without changing the URL (outside click, Escape, or re-click closes). Search filters the brand list. Works from any page, including Peekaboo-brand views, so you can switch back anywhere.
- **Add New Brand: full 5-step wizard** captured and clickable (Tell us about your brand → Select industry → Add competitors → Create prompts → Review & create). Create Brand simulates success back to the dashboard.
- **Manage Brands modal**: pause toggles flip, delete removes rows (client-side, resets on reload).
- **Prompts page**: Active/Inactive tabs, "+ Add prompts" menu + Add Prompts modal (AI Suggested/Manual, Single/Bulk, intent badges), Add Topic modal (color picker), Add Intent modal. Search input and topic dropdown filter the table rows live.
- **Competitors page**: Manage Competitors modal (8 competitors, Edit/Remove rows — Remove works), Add Competitor modal (Manual tab: name + domain), heatmap pagination (page 2). Settings → Manage Competitors rows also deletable.
- **Account avatar** in sidebar footer fixed to 32px circle (Clerk CSS isn't loaded locally; local-fixes.js constrains it).

JS modules in app/: `enhance.js` (tabs/switches/sidebar), `brand-switcher.js` (in-page dropdown), `wizard.js` (add-brand flow), `prompts-extra.js`, `competitors-extra.js`, `local-fixes.js` (avatar + manage-brands). `capture/inject_scripts.py` keeps all script tags present across pages.

## Third pass (2026-06-11, four parallel agents)

- **Date picker is now an in-page overlay** (topbar.js): opens under the date button, closes on Escape/outside/re-click with NO URL change (fixes the slug-trap bug). Month arrows navigate across months; "Last 7 / 30 / 90 days" presets update the label and swap the dashboard/prompts/competitors data.
- **Model filter is an in-page overlay**: selecting ChatGPT/Gemini/Perplexity swaps the data on dashboard, prompts, AND competitors; All Models returns. Label updates with the selection.
- **Claude beta banner removed** from the dashboard (and all dashboard variants).
- **Dashboard card pagination** (dashboard-extra.js): Competitors (1-8/9-16/17-19 of 19) and Top Domains (1-6/7-12/13-15 of 15) chevrons page the rows in place, no reload, correct disabled states. Works for both Flexzo and Peekaboo brands.
- **Ask AI**: clean initial empty state with suggested chips; clicking a chip or typing + Send appends a user bubble and replays a captured answer. (Note: the live Ask AI backend currently can't resolve the active brand — a real bug on the live app; the mirror gives proper Flexzo answers instead.)
- **Prompts → Add Prompts → AI Suggested** toggle now works (intent checkboxes, language, generate). Manual toggle returns.
- **Add Competitor**: all 3 source tabs (Brands in AI Answers, AI Suggestions, Manual) switch. (Brands-in-AI-Answers showed a persistent loading spinner on the live site itself — captured as-is.)
- **Search Console** (search-console.js): date-range pills (7d/28d/3m/6m/12m) swap metrics + chart; Queries/Pages/Search-to-AI-Gaps tabs switch; Change Property opens the picker and closes cleanly; Disconnect is a safe no-op.

JS modules: enhance.js, brand-switcher.js, wizard.js, prompts-extra.js, competitors-extra.js, local-fixes.js, topbar.js, dashboard-extra.js, ask-ai.js, search-console.js. Verified: 0 console errors across 9 pages, all flows pass.

## What is static (by design)

- Picking an arbitrary custom day-range in the calendar (presets work; arbitrary ranges keep the label only)
- Ask AI replays captured answers (no live backend)
- "Brands in AI Answers" tab spinner (mirrors the live site's own behavior)

## Structure

```
app/            ← the local site (serve this folder)
  *.html        ← one file per page + per captured state (tab/toggle variants)
  enhance.js    ← local interactivity: tab + toggle wiring between snapshots
  _next/        ← mirrored CSS, fonts, JS-free assets
  logos/        ← AI model logos
capture/        ← Playwright scripts + raw capture (pages/, verify/)
  login_headless.py  ← re-login if you need a fresh capture (creds in memory)
  capture_all.py     ← re-run the full capture
  mirror.py          ← rebuild app/ from capture
  verify.py          ← pixel-diff local vs live screenshots
```

## Editing workflow

Edit the HTML/CSS in `app/` directly (it is the live app's real markup: Tailwind + shadcn classes). Verify in the browser at :7897. Pixel-diff against the originals in `capture/pages/` with `capture/verify.py`.

To re-capture from live (e.g. after the real app ships changes): run `login_headless.py`, then `capture_all.py`, then `mirror.py`. Note custom edits in `app/` will be overwritten — mirror.py regenerates everything.
