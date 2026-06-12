# Frontend Translation Notes — PoC → Production Stack

Maps the vanilla JS proof of concept in this repo onto the production stack:
Next.js 14 (App Router) / React 18 / TypeScript / Tailwind / Radix UI / Lucide / Zustand / React Hook Form + Zod / Framer Motion / Recharts / Next.js API Routes / Prisma + PlanetScale.

PoC sources referenced throughout:

| PoC file | Role |
|---|---|
| `live-app/assets/app.js` | SPA framework: hash router, `PB.state`, brand selector, header, toasts, `PB.entityDomain` resolver |
| `live-app/assets/api.js` | `window.PBApi`, thin client over the local proxy |
| `live-app/proxy_server.py` | Static server + `/api/*` proxy that injects `X-API-Key`, 300s GET cache (local) |
| `live-app/api/proxy.js` | Vercel serverless version of the same proxy; serves the live deployments |
| `live-app/views/todos.js` | Recommendation engine (`normalizeSnapshot` + `aimGenerateTodos`) + Action Plan UI |
| `RECOMMENDATIONS_SPEC.md` | Full engineering spec for the engine. Read it first; this doc only covers the translation |

---

## 1. Routing

The PoC uses a hand-rolled hash router: `PB.registerView(name, fn)` stores render functions in a `views` map, `route()` parses `location.hash` (`#/dashboard`, `#/prompts/:id`), and calls `fn(root, ctx)`.

Translation:

| PoC | Production |
|---|---|
| `PB.registerView('dashboard', fn)` + `#/dashboard` | `app/dashboard/page.tsx` |
| `#/prompts` | `app/prompts/page.tsx` |
| `#/prompts/:id` (`ctx.param`) | `app/prompts/[promptId]/page.tsx` |
| `#/todos` | `app/todos/page.tsx` |
| `#/competitors`, `#/sources`, `#/categories` | one route folder each |
| `PB.navigate('#/prompts/' + promptId)` | `useRouter().push(`/prompts/${promptId}`)` from `next/navigation` |
| `window.addEventListener('hashchange', route)` | App Router handles it; no equivalent needed |
| `enhanceSidebar()` active-nav class toggling | `usePathname()` + conditional classes in a shared `<Sidebar>` layout component (`app/(dashboard)/layout.tsx`) |
| `route()` re-running the view on model/range change | React re-render from store subscription (section 3); no imperative re-route |

`ctx` (`{ brandId, brandName, model, range, param }`) is assembled in `route()` and passed to every view. In production:

- `brandId`, `model`, `range` → Zustand global store (section 3). They are cross-page filters, not page identity, so the store is the better home than search params. If shareable URLs matter, mirror them into search params (`?model=sonar&range=30d`) with `useSearchParams` + `router.replace`, but treat the store as the source of truth.
- `param` (prompt id) → route segment param (`params.promptId` in the page props).
- The "no brand selected" guard in `route()` → a check in the dashboard layout that renders a brand picker empty state.

Note on `#/prompts/:id`: the prompt detail page is fully built in the PoC (v4 layout: header card with topic/intent badges and stats row, Top Brands + Top Citations favicon clusters, date-grouped collapsible Response History, full-response modal with Mentions/Citations sidebar). It fetches `promptDetail` with `include_full_response=true` plus `/competitors` for the favicon map. Its pure logic (`groupRunsByDate`, `dateAggregates`, `topEntities`, `formatAnswer`, ...) is exported as `window.PBPromptDetailLogic` and covered by `tests/prompt-detail.logic.test.mjs` (49 tests); port it the same way as the todos engine.

The `boot()` sequence (fetch brands → restore `localStorage['pb.brandId']` → pick first analyzed brand) becomes: server component in the layout fetches the brand list, and the Zustand `persist` rehydration supplies the saved brand id, falling back to `brands.find(b => b.lastAnalysisAt) ?? brands[0]`.

---

## 2. API layer

### The proxy

`proxy_server.py` forwards `/api/*` → `https://www.aipeekaboo.com/api/v1/*`, injects `X-API-Key`, and caches GETs in memory for 300s. A working serverless version already exists and is deployed: `live-app/api/proxy.js` (Vercel function, key from `PEEKABOO_API_KEY`, edge cache `s-maxage=300, stale-while-revalidate=600`, rewired via `vercel.json`). The Next.js equivalent is a catch-all route handler with the exact same shape:

```ts
// app/api/peekaboo/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';

const API_BASE = 'https://www.aipeekaboo.com/api/v1';

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const url = `${API_BASE}/${params.path.join('/')}${req.nextUrl.search}`;
  const upstream = await fetch(url, {
    headers: { 'X-API-Key': process.env.PEEKABOO_API_KEY! },
    next: { revalidate: 300 }, // replaces the proxy's 300s in-memory cache
  });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}
```

- `PEEKABOO_API_KEY` lives in `.env.local` (and the deploy platform's env). No `NEXT_PUBLIC_` prefix, ever. The key never reaches the browser, same guarantee the PoC proxy gives.
- Server components can skip the proxy route and call the upstream API directly with the same header; the proxy route exists for client-side refetches only.
- The PoC's rate-limit cushion (Pro tier 40/min, 2000/day) is carried by `next: { revalidate: 300 }` or, better, Prisma-backed caching once the recommendations endpoint exists (section 4).

### The client

`api.js` exposes `PBApi` with one method per endpoint and a shared envelope handler (`{ success, data, pagination, error }`, throws `ApiError(code, message, status)`). Port it 1:1 to a typed module:

```ts
// lib/peekaboo.ts
export class PeekabooApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> { ... }

export const peekaboo = {
  brands:      ()                       => get<Brand[]>('/brands'),
  brand:       (id: string)             => get<BrandDetail>(`/brands/${id}`),
  snapshot:    (id: string)             => get<Snapshot>(`/brands/${id}/snapshot`),
  visibility:  (id: string, range: TimeRange) => get(`/brands/${id}/visibility`, { time_range: range }),
  competitors: (id: string)             => get(`/brands/${id}/competitors`),
  sources:     (id: string)             => get(`/brands/${id}/sources`),
  categories:  (id: string, range: TimeRange, intent?: string) => get(`/brands/${id}/categories`, { time_range: range, search_intent: intent }),
  prompts:     (id: string, opts?: PromptQuery) => get<PromptsEnvelope>(`/brands/${id}/prompts`, opts), // keep full envelope: has pagination
  promptDetail:(id: string, pid: string, range: TimeRange, full?: boolean) => get(`/brands/${id}/prompts/${pid}`, { time_range: range, include_full_response: full ? 'true' : undefined }),
  looker:      (params: LookerQuery)    => get('/looker/summary', params),
};
```

Base URL switches by context: server-side it hits the upstream directly with the key; client-side it hits `/api/peekaboo`. The `prompts` method intentionally returns the whole envelope (pagination), matching the PoC.

Note the PoC's lazy brand-detail enrichment in `app.js` (queue, concurrency 2, session budget 40, 24h localStorage cache under `pb.brandDetails.v1`): in production this whole subsystem disappears. Fetch brand details on demand in a server component or cached route handler; `revalidate` replaces the TTL cache, and the rate-limit budgeting belongs server-side.

---

## 3. Global state

`PB.state = { brandId, brandName, model, range, brands, pillStats }` with `localStorage['pb.brandId']` persistence becomes one Zustand store:

```ts
// stores/dashboard.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ModelTag = 'all' | 'gpt-4o-mini' | 'gemini-2.5-flash' | 'sonar' | 'google-aio' | 'google-ai-mode';
export type TimeRange = '7d' | '30d' | '90d';

interface DashboardState {
  brandId: string | null;
  brandName: string;
  model: ModelTag;
  range: TimeRange;
  setBrand: (id: string, name: string) => void;
  setModel: (m: ModelTag) => void;
  setRange: (r: TimeRange) => void;
}

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set) => ({
      brandId: null, brandName: '', model: 'all', range: '7d',
      setBrand: (brandId, brandName) => set({ brandId, brandName }),
      setModel: (model) => set({ model }),
      setRange: (range) => set({ range }),
    }),
    { name: 'pb-dashboard', partialize: (s) => ({ brandId: s.brandId, model: s.model, range: s.range }) },
  ),
);
```

- `selectBrand()` in `app.js` (set state + localStorage + re-render header/sidebar/view) collapses to `setBrand()`; React re-renders subscribers automatically.
- `state.pillStats` (visibility/sentiment/position shown in the brand pill, pushed by views via `PB.setPillStats`) can stay in the same store or be derived in the header from the same snapshot query; prefer derivation, the push pattern was a workaround for not having shared data fetching.
- `MODELS` and `RANGES` constant arrays in `app.js` → `lib/constants.ts`, including the `modelLogo()` tag→logo map.

### Todo triage state

The PoC keeps three module-level `Set`s (`_aimTodosAdded`, `_aimTodosCompleted`, `_aimTodosArchived`) persisted as JSON arrays under per-brand keys `pb_td_added_<brandId>` / `pb_td_completed_<brandId>` / `pb_td_archived_<brandId>`, plus notes at `pb_td_notes_<brandId>_<todoId>`.

Interim client-only version (matches PoC behavior exactly):

```ts
// stores/todos.ts
interface TodoTriageState {
  byBrand: Record<string, { added: string[]; completed: string[]; archived: string[]; notes: Record<string, string> }>;
  toggleAdded: (brandId: string, todoId: string) => void;
  complete: (brandId: string, todoId: string) => void;   // also removes from archived
  archive: (brandId: string, todoId: string) => void;    // also removes from completed
  setNote: (brandId: string, todoId: string, note: string) => void;
  purgeStaleIds: (brandId: string, liveIds: string[]) => void; // PoC does this every render
}
// wrap in persist({ name: 'pb-todos' })
```

Keep the two invariants from `aimMarkTodoComplete` / `aimArchiveTodo`: completing removes from archived, archiving removes from completed, added is independent. And keep the stale-ID purge: on every fresh generation, drop saved ids that no longer exist.

Target state: this store becomes a thin cache over the Prisma-backed endpoints in section 10, so triage survives across devices and browsers. The localStorage version is the migration source (one-time import on first login is feasible since the keys are deterministic).

---

## 4. The recommendation engine (most important)

Source: `live-app/views/todos.js`. The pure logic is exported as `window.PBTodosLogic` and covered by `live-app/tests/todos.logic.test.mjs` (66 tests, zero deps):

- `normalizeSnapshot(snap, promptRows, brandName, brandUrl)` → normalized shape (spec section 2)
- `aimGenerateTodos(snapNorm)` → `Recommendation[]` (19 rule blocks, spec sections 3 and 4). No DOM, no network, deterministic, sub-second.
- Supporting pure functions, all on the same export and all tested: `perModelStats` (looker rows → per-provider visibility/sentiment/position, activates the model-gap / brand-sentiment / Google-AI rules), `aggregateSourceUrls` (prompt-detail samples → URL-level citation list for the examples panels), `weeklyCacheState` + `mergeNewTodos` (weekly cache cycle and the Generate button, spec section 10), `youtubeStats`, `socialSourceStats`, `brandCitedInSources`, `cleanDomain`, `modelIdToProv`, `splitMentions`, `expandTodo`.

### Option A (recommended): server-side endpoint

```
GET /api/brands/[id]/recommendations?time_range=30d
→ { data: Recommendation[] }
```

```ts
// app/api/brands/[id]/recommendations/route.ts
import { normalizeSnapshot, generateRecommendations } from '@/lib/recommendations/engine';
import { peekaboo } from '@/lib/peekaboo';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const range = (req.nextUrl.searchParams.get('time_range') ?? '30d') as TimeRange;
  const [snapshot, prompts, looker] = await Promise.all([
    peekaboo.snapshot(params.id).catch(() => null),     // keep the PoC's individual guards:
    peekaboo.prompts(params.id, { time_range: range, limit: 100 }).catch(() => null), // a failed call degrades to the fallback todo
    peekaboo.looker({ brand_id: params.id, /* start/end from range */ }).catch(() => null), // per-model stats; failure just leaves those rules dormant
  ]);
  const normalized = normalizeSnapshot(snapshot, prompts?.data ?? null, /* brandName, brandUrl from brand record */);
  normalized.latest_by_provider = perModelStats(looker?.data ?? [], brandName);
  // plus: aggregate URL-level citations server-side (the PoC samples 12 prompt-detail calls;
  // the backend has all runs) and inject as normalized.top_source_urls
  return NextResponse.json({ data: generateRecommendations(normalized) });
}
```

- Port `normalizeSnapshot` + `aimGenerateTodos` (rename `generateRecommendations`) into `lib/recommendations/engine.ts` as a plain TS module, no React imports. Port the helpers verbatim: `cleanDomain`, `modelIdToProv`, `splitMentions`, `perModelStats`, `aggregateSourceUrls`, `weeklyCacheState`, `mergeNewTodos`, `_aimExpandTodo` (parent/suggestion expansion with the singleton-fold rule). Do not change rule semantics; translate the 66 node tests into Vitest and keep them green before touching anything.
- Type the output against the `Recommendation` schema in spec section 3. While porting, fix limitation 6 from the spec: make `effort` an enum `'low' | 'medium' | 'high'` and format the "Low effort" label in the UI (the PoC carries display strings like `"Med effort"` and substring-matches filters against them).
- Cache the generated array in PlanetScale via Prisma keyed `(brandId, timeRange)`, invalidated when a new analysis lands (or simply with a TTL): the output only changes when an analysis runs. This replaces the PoC's weekly localStorage cache (`weeklyCacheState`, 7-day window, version field, `sourceUrls` baked in; spec section 10); the server should also return `generatedAt` so the client can render the "Updated ... refreshes weekly" caption.
- All 19 rules fire in the PoC: per-model visibility/sentiment/position comes from `/looker/summary` via `perModelStats` and URL-level citation examples from sampling 12 prompt-detail calls. Server-side, both inputs get cheaper and complete: compute per-model stats from the internal data instead of shipping up to 5,000 looker rows to the browser, and aggregate URL citations across all runs instead of a 12-prompt sample. The one still-missing input is the competitor-by-model heatmap (`aim_real_hm_data`), which only affects rule 1's per-model signal expansion; feeding it in upgrades the engine with zero rule changes.
- Client side then only does: `fetch('/api/brands/${brandId}/recommendations?time_range=${range}')` and renders.

### Option B: keep client-side

Port the same `lib/recommendations/engine.ts` module, but call it from a `useRecommendations(brandId, range)` hook that runs the same data fetches the PoC does (snapshot + prompts + looker, plus the 12-prompt detail sampling on regeneration) through `/api/peekaboo/*`. Ships faster, identical UI code; downsides: logic visible in the bundle, no shared caching, the looker and sampling traffic stays in the browser, and you still need a persistence endpoint for triage state anyway. If you start with B, the move to A later is only relocating one import.

### Persisting triage state in PlanetScale

See section 10 for the schema. The deterministic rule IDs (`td-comp-gap`, `td-brand-sentiment-s0`, ...) make DB persistence safe across regenerations; replicate the PoC's stale-ID purge as a cleanup in the GET handler (or lazily: ignore rows whose id is not in the current generation).

---

## 5. UI components — direct mapping

The Action Plan UI in `todos.js` is scoped under `.pb-todos-scope` plus three body-attached elements (`#aim-td-floating-bar`, `#aim-inline-pop`, `.aim-td-toast`). Mapping per pattern:

| PoC pattern (todos.js) | Production component |
|---|---|
| `.ct-custom-select` filter dropdowns (Priority / Type / Page / Effort) | `@radix-ui/react-select` (shadcn `<Select>`) |
| `.aim-tab-bar` / `.aim-tab` pill tabs (Suggested / To-do / Archive with counts) | `@radix-ui/react-tabs`; counts as plain spans in `TabsTrigger`, hidden when 0 |
| `#aim-inline-pop` priority popover (body-attached, positioned at the clicked badge) | `@radix-ui/react-popover`; anchor on the priority badge, Radix handles the body portal + positioning the PoC does manually with `position: fixed` |
| `#aim-td-floating-bar` bulk action bar ("{n} selected" + Clear / To-do / Archive / Complete) | Fixed bottom-center `div` rendered in a portal, wrapped in Framer Motion `AnimatePresence` (section 8) |
| "Why we're recommending this" toggle | `@radix-ui/react-collapsible` |
| Internal notes textarea + Save button | `react-hook-form` + `zod` (`z.string().max(2000)`), `onBlur`/Save submits to the notes endpoint |
| Detail panel (replaces the list, "Back to Action Plan") | Conditional render driven by `selectedTodoId` state (matches PoC behavior); `@radix-ui/react-dialog` only if product wants an overlay instead |
| Effort dot bar (3 ascending bars: 1 green / 2 amber / 3 red) | Custom component, ~15 lines, no Radix needed |
| Priority / page / type badges (shared `.aim-intent-badge` base + variants) | `cva()` from class-variance-authority, one `badgeVariants` with `variant: priority-high \| priority-medium \| page-on \| page-off \| type-*`; same pattern shadcn/ui already uses |
| Row checkbox + header select-all (`aimSelectAllTodos`) | `@radix-ui/react-checkbox`; select-all computes the visible-rows set for the active tab, same as the PoC |
| `aimShowToast` dark bottom-center toast | `sonner` (already shipped in the product: its CSS is in the captured `index.html`); `toast('3 actions: Added to To-do')` |
| Signal rows with chevron expand (`sigs_expand`) | `@radix-ui/react-collapsible` per signal row |
| Sortable table headers with ↑/↓ (`aimSortTodos`) | Plain `<button>` in `<th>` toggling sort state; no library needed (or TanStack Table if the product already uses it elsewhere) |
| `aimGetUrlPageType` page-type badges on example URLs | Port the URL-regex classifier as-is into the engine module; render with the same `cva` badge |

From `app.js` (outside the todos view, for completeness): the model/range header dropdowns → Radix Select / Popover with the existing product calendar (the PoC re-implements react-day-picker by hand; production already has the real one), Manage Brands sheet → Radix Dialog with the product's sheet styles, brand switcher → Radix DropdownMenu, toggle switches → `@radix-ui/react-switch`.

---

## 6. Charts

The recommendation engine renders no charts. If a summary visual is added (donut of todo types, bar of priorities), use Recharts `PieChart` / `BarChart`, consistent with the existing Competitors and Sources views. Feed it from the already-generated array (`groupBy(todos, 'recType')`); no extra fetching.

---

## 7. Icons

Every icon in the PoC is Lucide. `app.js` uses `<i data-lucide="...">` + `lucide.createIcons()`; `todos.js` inlines the SVG paths directly (copied from Lucide) to avoid the createIcons timing dependency. Both translate to direct imports:

```ts
import {
  CheckSquare2,   // sidebar nav item for the Action Plan
  Archive,        // archive action (row + bulk bar + detail panel)
  Check,          // complete action, dropdown selected-item check
  Plus,           // "To-do" add action / Add New Brand
  ChevronLeft,    // "Back to Action Plan"
  ChevronDown,    // dropdown triggers, signal/why collapsible chevrons
  ChevronRight,   // calendar nav (if ported)
  TriangleAlert,  // priority indicator (high)
  Layers,         // "All Models" entry in the model dropdown (SVG_LAYERS in app.js)
  Calendar,       // range trigger (SVG_CALENDAR)
  Search, Settings, Trash2, X, Clock, MapPin, MessageSquare, Users, Sparkles, ArrowUpDown, ArrowLeft, ArrowRight,
} from 'lucide-react';
```

The non-Lucide icons stay as-is: model logos are PNG files (`/logos/openai.png` etc., see `modelLogo()` in `app.js`), AI engine and source favicons come from `https://www.google.com/s2/favicons?sz=64&domain={d}` with an `onError` hide handler (wrap in a tiny `<Favicon domain={d} />` component), and the Reddit/YouTube type badges use favicons rather than Lucide glyphs.

### Entity favicons: port `PB.entityDomain` as a shared utility

Favicons for brand/competitor entity names (mention rows, signal rows, Top Brands clusters) go through one shared resolver in `app.js`: `PB.entityDomain(name, citedDomains, trackedMap)`, also exported as `window.PBEntityLogic` and covered by `tests/entity-domain.test.mjs` (22 tests). It is a 4-step chain, strictly in priority order:

1. `trackedMap`: API-provided urls (own brand + tracked competitors from `GET /competitors`), keyed by trimmed lowercased name
2. `citedDomains`: domains present in the citation data on hand; conservative match only (normalized name must exactly equal the domain's second-level label)
3. `KNOWN_BRAND_DOMAINS`: curated map of verified domains for well-known brands
4. `null`: caller renders a deterministic letter avatar

It never constructs or guesses a domain from a name (hard rule; the old `guessDomain()` helper was deleted for exactly this reason). It is consumed by the prompts list, the prompt detail page, todos signals/competitor rows, the competitors view, and the dashboard competitors binder. Port it once into `lib/entity-domain.ts` (pure, no DOM), translate the 22 tests, and have every entity icon call it; do not let views grow their own name-to-domain logic.

---

## 8. Animations

| PoC | Production |
|---|---|
| Floating bulk bar show/hide (`aimUpdateTodosFloatingBar` toggles display) | `AnimatePresence` + `motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}` keyed on `selectedIds.size > 0` |
| Detail panel swap (list → panel, instant in the PoC) | `motion.div` with `opacity` + small `x` slide, or plain CSS transition; keep it subtle |
| Tab switching | No animation; Radix Tabs handles state, content swaps instantly like the PoC |
| Dropdown open/close (`pb-dd-leaving` class, 130ms) | Radix data-state + the product's existing tailwindcss-animate utilities (`data-[state=open]:animate-in fade-in-0 zoom-in-95 slide-in-from-top-2`), no Framer needed |
| Toasts | sonner's built-in motion |

Rule of thumb: Framer Motion only for the body-attached chrome (floating bar); everything Radix-owned uses the compiled tailwindcss-animate classes the product already has.

---

## 9. Data fetching pattern

Server components prefetch, client components own interactivity. The todos page:

```tsx
// app/todos/page.tsx  (server component)
import { peekaboo } from '@/lib/peekaboo';
import { generateRecommendations, normalizeSnapshot } from '@/lib/recommendations/engine';
import { TodosClient } from './todos-client';

export default async function TodosPage({ searchParams }: { searchParams: { brand?: string; range?: string } }) {
  const brandId = searchParams.brand;            // or read on the client from the store; see note below
  if (!brandId) return <BrandEmptyState />;
  const range = (searchParams.range ?? '30d') as TimeRange;

  const [snapshot, prompts] = await Promise.all([
    peekaboo.snapshot(brandId).catch(() => null),
    peekaboo.prompts(brandId, { time_range: range, limit: 100 }).catch(() => null),
  ]);
  const initialTodos = generateRecommendations(normalizeSnapshot(snapshot, prompts?.data ?? null));

  return <TodosClient initialTodos={initialTodos} brandId={brandId} range={range} />;
}
```

```tsx
// app/todos/todos-client.tsx  ('use client')
export function TodosClient({ initialTodos, brandId, range }: Props) {
  const { brandId: storeBrand, range: storeRange, model } = useDashboardStore();
  const { data: todos = initialTodos } = useQuery({
    queryKey: ['recommendations', storeBrand, storeRange],
    queryFn: () => fetch(`/api/brands/${storeBrand}/recommendations?time_range=${storeRange}`).then(r => r.json()).then(r => r.data),
    initialData: storeBrand === brandId && storeRange === range ? initialTodos : undefined,
  });
  // tabs, filters (including the global `model` filter against aiTargets), table, detail panel, bulk bar
}
```

- Brand/range change does not navigate; the store update changes the `queryKey` and TanStack Query refetches. This replaces the PoC's `route()` full re-render on every header change.
- If the team doesn't want TanStack Query, React 19 `use()` + a keyed fetch works, but Query gives the skeleton state (`isPending` replaces `PB.skeleton`) and error state (`isError` replaces `errorState()` + `PB.toast`) for free.
- Mirror `brandId`/`range` into search params if server prefetch should hit on direct loads; otherwise the server component renders the shell and the client fetches after store rehydration. Either is fine; pick one and be consistent across views.
- The PoC's per-call `.catch(() => null)` guards and the `td-no-data` fallback todo are behavior, not incidental: a failed endpoint must degrade to the fallback row, never an empty/broken table. A failed looker call just leaves the three per-model rules dormant for that load; failed prompt-detail samples leave the examples panels on the domain-level fallback.
- The snippet above shows the two core fetches for brevity; the full PoC input set is snapshot + prompts + looker, plus the 12-prompt detail sampling on regeneration (spec section 2). With Option A all of that lives in the recommendations route, and this page just fetches the generated array.

---

## 10. Prisma schema additions

Minimal additions to persist triage state (replaces `pb_td_added_*` / `pb_td_completed_*` / `pb_td_archived_*` / `pb_td_notes_*` localStorage keys):

```prisma
model TodoItem {
  id        String     // generated, deterministic rule id, e.g. "td-comp-gap" or "td-brand-sentiment-s0"
  brandId   String
  userId    String     // or workspaceId if triage should be shared across a team
  status    TodoStatus @default(SUGGESTED)
  notes     String?    @db.Text
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  @@id([id, brandId, userId])
  @@index([brandId, userId])
}

enum TodoStatus {
  SUGGESTED
  TODO
  ARCHIVED
  COMPLETED
}
```

Notes:

- Composite PK (`id, brandId, userId`) rather than a synthetic id: the rule id is only unique per brand, and PlanetScale has no FK constraints anyway (use `relationMode = "prisma"` conventions, index the lookup path).
- The four-state enum encodes the PoC's set membership: not in any set = `SUGGESTED`, added = `TODO`, archived = `ARCHIVED`, completed = `COMPLETED`. The PoC invariants (complete clears archive and vice versa) become a single status write instead of two set mutations, which removes the invariant bug class entirely. "Added" history is lost when completing, which matches what the Archive tab actually shows (completed OR archived).
- Endpoints: `GET /api/brands/[id]/todo-state` (rows for current user) and `PATCH /api/brands/[id]/todo-state` (`{ ids: string[], status }` for bulk, `{ id, notes }` for notes). Upsert on write; rows are only created once a user touches a todo, so SUGGESTED rows mostly never exist in the DB.
- Optional second table if you implement the Option A cache: `RecommendationCache { brandId, timeRange, payload Json, generatedAt }` keyed `@@id([brandId, timeRange])`, invalidated on new analysis.
- Priority overrides (in-memory only in the PoC, lost on reload) can ride along here later as a nullable `priorityOverride` enum column; not required for parity.

---

## Porting checklist

1. `lib/recommendations/engine.ts`: port `normalizeSnapshot`, `aimGenerateTodos`, `perModelStats`, `aggregateSourceUrls`, `weeklyCacheState`, `mergeNewTodos`, helpers; translate `tests/todos.logic.test.mjs` (66 tests) to Vitest; green before any UI work. Fix the effort enum while porting (the only sanctioned semantic change).
2. `lib/entity-domain.ts`: port `PB.entityDomain` / `PBEntityLogic` (section 7) + the 22 tests in `tests/entity-domain.test.mjs`; one shared `<EntityIcon>` consumes it everywhere.
3. `app/api/peekaboo/[...path]/route.ts` + `PEEKABOO_API_KEY` env (the deployed `live-app/api/proxy.js` is the working reference); `lib/peekaboo.ts` typed client.
4. `stores/dashboard.ts` (persisted brand/model/range) + header components (brand switcher, model select, range picker) on Radix.
5. `app/api/brands/[id]/recommendations/route.ts` (snapshot + prompts + looker + server-side URL aggregation) + Prisma `TodoItem` + todo-state endpoints; return `generatedAt` for the weekly caption.
6. `app/todos/page.tsx` + client tree: Tabs, filter Selects, Generate New Recommendations dropdown, table, detail panel, bulk bar, notes form. cva badges, Lucide imports, sonner toasts.
7. Verify in the browser against the PoC side by side (`python3 live-app/proxy_server.py`, localhost:7898, `#/todos`) with the same brand: row counts, rule ids, and signal text should match exactly for identical inputs.
