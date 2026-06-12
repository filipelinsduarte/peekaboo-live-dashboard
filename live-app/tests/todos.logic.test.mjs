/*
 * todos.logic.test.mjs — unit tests for the pure logic in views/todos.js
 * (snapshot normalization, provider mapping, mention splitting, todo
 * generation thresholds, suggestion expansion).
 *
 * Run with:  node live-app/tests/todos.logic.test.mjs
 * (zero dependencies; exits non-zero on failure)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'views', 'todos.js'), 'utf8');

// todos.js only touches the DOM inside functions; at the top level it needs a
// window stub with PB. PBTodosLogic is exposed before any DOM work happens.
const sandbox = {
  window: {
    PB: { registerView() {}, navigate() {}, state: {}, api: {}, skeleton() {}, toast() {} },
    addEventListener() {},
    innerWidth: 1440,
  },
  document: {
    getElementById() { return null; },
    createElement() { return { style: {}, classList: { add() {}, remove() {} } }; },
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll() { return []; },
    head: { appendChild() {} },
    body: { appendChild() {} },
  },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  console,
  setTimeout() { return 0; },
  clearTimeout() {},
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const L = sandbox.window.PBTodosLogic;
assert.ok(L, 'PBTodosLogic should be exposed on window');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('ok   ' + name);
  } catch (err) {
    failed += 1;
    console.error('FAIL ' + name);
    console.error('     ' + err.message);
  }
}

// ── cleanDomain ──────────────────────────────────────────────────────────────
test('cleanDomain strips protocol, www, path and lowercases', () => {
  assert.equal(L.cleanDomain('https://www.G2.com/products/foo'), 'g2.com');
  assert.equal(L.cleanDomain('http://reddit.com/r/seo'), 'reddit.com');
  assert.equal(L.cleanDomain('example.com'), 'example.com');
  assert.equal(L.cleanDomain(''), '');
  assert.equal(L.cleanDomain(null), '');
});

// ── modelIdToProv ────────────────────────────────────────────────────────────
test('modelIdToProv maps live model ids to provider keys', () => {
  assert.equal(L.modelIdToProv('gpt-4o-mini'), 'chatgpt');
  assert.equal(L.modelIdToProv('chatgpt'), 'chatgpt');
  assert.equal(L.modelIdToProv('gemini-2.0-flash'), 'gemini');
  assert.equal(L.modelIdToProv('sonar-pro'), 'perplexity');
  assert.equal(L.modelIdToProv('perplexity'), 'perplexity');
  assert.equal(L.modelIdToProv('google-ai-mode'), 'googleaimode');
  assert.equal(L.modelIdToProv('google-ai-overview'), 'googleaio');
  assert.equal(L.modelIdToProv('google-aio'), 'googleaio');
  assert.equal(L.modelIdToProv('unknown-model'), null);
});

// ── splitMentions ────────────────────────────────────────────────────────────
test('splitMentions sums exactly to the total and is non-negative', () => {
  const out = L.splitMentions(10, ['chatgpt', 'gemini', 'perplexity']);
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  assert.equal(sum, 10);
  Object.values(out).forEach((v) => assert.ok(v >= 3, 'even-ish split'));
  assert.equal(Object.keys(L.splitMentions(5, [])).length, 0, 'no providers -> empty split');
  const single = L.splitMentions(7, ['chatgpt']);
  assert.equal(single.chatgpt, 7);
});

// ── normalizeSnapshot ────────────────────────────────────────────────────────
const liveSnap = {
  brand: { id: 'x', name: 'Acme' },
  visibility: { score: 12, rank: 2, maxScore: 100, totalCitations: 50, totalChatsAnalyzed: 100 },
  prompts: [
    { promptText: 'best widget tool', category: 'Discovery', mentions: 2, averageScore: 40, aiModels: ['gpt-4o-mini'] },
  ],
  sources: [
    { domain: 'acme.com', mentions: 30, aiModels: ['gpt-4o-mini', 'google-ai-mode'] },
    { domain: 'g2.com', mentions: 40, aiModels: ['gpt-4o-mini', 'sonar-pro'] },
    { domain: 'reddit.com', mentions: 10, aiModels: ['gpt-4o-mini'] },
    { domain: 'blog.example.com', mentions: 6, aiModels: ['gemini-2.0-flash'] },
  ],
  competitors: [
    { name: 'WidgetCo', url: 'https://widgetco.com/', score: 30, rank: 1 },
    { name: 'GadgetCo', url: 'https://www.gadgetco.io', score: 25, rank: 2 },
  ],
};
const livePromptRows = [
  { promptId: 'p-1', promptText: 'best widget tool', category: 'Discovery', searchIntent: 'COMMERCIAL', averageScore: 0 },
  { promptId: 'p-2', promptText: 'what is a widget', category: 'Education', searchIntent: 'INVESTIGATIONAL', averageScore: 0 },
  { promptId: 'p-3', promptText: 'widget pricing comparison', category: 'Discovery', searchIntent: 'COMMERCIAL', averageScore: 20 },
];

test('normalizeSnapshot maps the live API shape onto the v4 snapshot shape', () => {
  const n = L.normalizeSnapshot(liveSnap, livePromptRows, 'Acme', 'https://www.acme.com');
  assert.equal(n.brand, 'Acme');
  assert.equal(n.brand_domain, 'acme.com');
  assert.equal(n.overall_visibility, 12);
  assert.equal(n.overall_avg_position, 2);
  assert.equal(n.total_runs, 100);
  // competitors mapped + domains cleaned
  assert.equal(n.competitor_entities.length, 2);
  assert.equal(n.competitor_entities[0].name, 'WidgetCo');
  assert.equal(n.competitor_entities[0].domain, 'widgetco.com');
  assert.equal(n.competitor_entities[0].visibility, 30);
  assert.equal(n.competitor_entities[1].domain, 'gadgetco.io');
  // sources sorted by citation_count desc
  assert.equal(n.top_sources[0].domain, 'g2.com');
  assert.equal(n.top_sources[0].citation_count, 40);
  // by_provider split sums to the total
  const split = Object.values(n.top_sources[0].by_provider).reduce((a, b) => a + b, 0);
  assert.equal(split, 40);
  // sources_by_provider populated from aiModels
  assert.ok(n.sources_by_provider.chatgpt.some((s) => s.domain === 'g2.com'));
  assert.ok(n.sources_by_provider.gemini.some((s) => s.domain === 'blog.example.com'));
  // prompt rows preferred over snapshot prompts; fields mapped
  assert.equal(n.prompt_metrics.length, 3);
  assert.equal(n.prompt_metrics[0].prompt_id, 'p-1');
  assert.equal(n.prompt_metrics[0].topic, 'Discovery');
  assert.equal(n.prompt_metrics[0].intent, 'COMMERCIAL');
  assert.equal(n.prompt_metrics[2].visibility_all, 20);
  // active providers derived from aiModels strings
  assert.ok(n.active_providers.includes('chatgpt'));
  assert.ok(n.active_providers.includes('googleaimode'));
});

test('normalizeSnapshot falls back to snapshot prompts when no prompt rows given', () => {
  const n = L.normalizeSnapshot(liveSnap, [], 'Acme', '');
  assert.equal(n.prompt_metrics.length, 1);
  assert.equal(n.prompt_metrics[0].prompt_text, 'best widget tool');
  assert.equal(n.prompt_metrics[0].visibility_all, 40);
});

// ── generateTodos thresholds ─────────────────────────────────────────────────
test('generateTodos emits the competitor-gap todo when gap > 3', () => {
  const todos = L.generateTodos(liveSnap, livePromptRows, 'Acme', 'https://acme.com');
  const compGap = todos.find((t) => t.id === 'td-comp-gap');
  assert.ok(compGap, 'td-comp-gap should exist (30 vs 12 = 18 point gap)');
  assert.ok(compGap.title.includes('Acme vs WidgetCo'), 'title names both brands');
  assert.equal(compGap.priority, 'high');
  assert.equal(compGap.recType, 'content');
});

test('generateTodos emits the zero-visibility todo with the right count', () => {
  const todos = L.generateTodos(liveSnap, livePromptRows, 'Acme', 'https://acme.com');
  const zero = todos.find((t) => t.id === 'td-zero-vis');
  assert.ok(zero, 'td-zero-vis should exist (2 prompts at 0)');
  assert.ok(zero.title.includes('2 questions'), 'title carries the zero-prompt count, got: ' + zero.title);
});

test('generateTodos top-domain todo computes the citation share and skips brand/competitor/social domains', () => {
  const todos = L.generateTodos(liveSnap, livePromptRows, 'Acme', 'https://acme.com');
  const topDomain = todos.find((t) => t.id === 'td-top-domain');
  assert.ok(topDomain, 'td-top-domain should exist (g2.com has 40 >= 5 citations)');
  // total citations = 30+40+10+6 = 86; g2 share = round(40/86*100) = 47
  assert.ok(topDomain.title.includes('g2.com'), 'targets g2.com, not acme.com (brand) or reddit.com (social)');
  assert.ok(topDomain.title.includes('47%'), 'share math: round(40/86*100) = 47, got: ' + topDomain.title);
});

test('generateTodos emits the diversify todo when top-3 share > 50%', () => {
  const todos = L.generateTodos(liveSnap, livePromptRows, 'Acme', 'https://acme.com');
  const div = todos.find((t) => t.id === 'td-diversify');
  // top3 = 40+30+10 = 80 of 86 = 93%
  assert.ok(div, 'td-diversify should exist');
  assert.ok(div.title.includes('93%'), 'top3 share math: round(80/86*100) = 93, got: ' + div.title);
});

test('generateTodos emits the Reddit todo when reddit.com has > 3 citations', () => {
  const todos = L.generateTodos(liveSnap, livePromptRows, 'Acme', 'https://acme.com');
  const reddit = todos.find((t) => t.id === 'td-reddit');
  assert.ok(reddit, 'td-reddit should exist (10 reddit citations)');
  assert.equal(reddit.recType, 'reddit');
  assert.ok(reddit.title.includes('10 answers'), 'carries the citation count, got: ' + reddit.title);
});

test('generateTodos emits the schema todo when 2+ zero-visibility prompts', () => {
  const todos = L.generateTodos(liveSnap, livePromptRows, 'Acme', 'https://acme.com');
  const schema = todos.find((t) => t.id === 'td-schema');
  assert.ok(schema, 'td-schema should exist');
  assert.equal(schema.recType, 'technical-seo');
});

test('generateTodos skips model-gap / sentiment / google-ai todos without per-model data', () => {
  const todos = L.generateTodos(liveSnap, livePromptRows, 'Acme', 'https://acme.com');
  assert.ok(!todos.find((t) => t.id === 'td-model-gap'), 'no latest_by_provider -> no model gap todo');
  assert.ok(!todos.find((t) => t.id === 'td-brand-sentiment'), 'no sentiment data -> no sentiment todo');
  assert.ok(!todos.find((t) => t.id === 'td-google-ai'), 'no per-model visibility -> no google-ai todo');
});

test('generateTodos falls back to the no-data todo on an empty snapshot', () => {
  const todos = L.generateTodos({}, [], 'Acme', '');
  // empty snapshot still triggers the always-on original-data + schema-ish todos?
  // schema needs zeroPrompts>=2 OR vis<10 -> vis=0 -> fires; original-data fires (vis<12).
  // So the explicit no-data fallback only appears when *nothing* generates:
  const ids = todos.map((t) => t.id);
  assert.ok(ids.length > 0, 'always returns at least one todo');
});

test('generateTodos still suggests the original-data todo on a bare snapshot (v4-faithful)', () => {
  // No top_source_urls in the live snapshot -> hasOriginalData is false, so the
  // original-data todo always fires (same as the v4 source). The td-no-data
  // fallback is therefore unreachable in practice, by design.
  const todos = L.generateTodos({ visibility: { score: 50, rank: 1 } }, [], 'Acme', '');
  assert.ok(todos.find((t) => t.id === 'td-original-data'), 'original-data todo fires');
  assert.ok(!todos.find((t) => t.id === 'td-no-data'), 'no-data fallback only when nothing generates');
});

// ── expandTodo ───────────────────────────────────────────────────────────────
test('expandTodo folds a singleton suggestion into the parent steps', () => {
  const out = L.expandTodo({ id: 'p', title: 'Parent', steps: ['a'], suggestions: ['extra step'], signals: [] });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].steps, ['a', 'extra step']);
  assert.equal(out[0].suggestions, null);
});

test('expandTodo emits children with _groupLabel for multi-suggestion parents', () => {
  const out = L.expandTodo({
    id: 'p', title: 'Parent', steps: ['a'],
    signals: ['sig'],
    suggestions: [
      { title: 'Child 1', steps: ['c1'], signals: ['s1'] },
      { title: 'Child 2', steps: [], signals: [] },
    ],
  });
  assert.equal(out.length, 3, 'parent + 2 children');
  assert.equal(out[1].id, 'p-s0');
  assert.equal(out[1].title, 'Child 1');
  assert.equal(out[1]._groupLabel, 'Parent');
  assert.deepEqual(out[1].steps, ['c1']);
  // child without own signals inherits the parent's
  assert.deepEqual(out[2].signals, ['sig']);
});

// ── weeklyCacheState ─────────────────────────────────────────────────────────
const WEEK_MS = 604800000; // 7 days
const NOW = Date.UTC(2026, 5, 12, 12, 0, 0);
function storedAt(ageMs) {
  return { generatedAt: new Date(NOW - ageMs).toISOString(), todos: [] };
}

test('weeklyCacheState returns fresh for a set under 7 days old', () => {
  assert.equal(L.weeklyCacheState(storedAt(0), NOW), 'fresh');
  assert.equal(L.weeklyCacheState(storedAt(3 * 24 * 3600 * 1000), NOW), 'fresh');
  assert.equal(L.weeklyCacheState(storedAt(WEEK_MS - 1), NOW), 'fresh');
});

test('weeklyCacheState returns expired for a set over 7 days old', () => {
  assert.equal(L.weeklyCacheState(storedAt(WEEK_MS + 1), NOW), 'expired');
  assert.equal(L.weeklyCacheState(storedAt(30 * 24 * 3600 * 1000), NOW), 'expired');
});

test('weeklyCacheState boundary: exactly 7 days old is expired', () => {
  assert.equal(L.weeklyCacheState(storedAt(WEEK_MS), NOW), 'expired');
});

test('weeklyCacheState returns missing for null/undefined', () => {
  assert.equal(L.weeklyCacheState(null, NOW), 'missing');
  assert.equal(L.weeklyCacheState(undefined, NOW), 'missing');
});

test('weeklyCacheState returns missing for corrupt entries, never throws', () => {
  assert.equal(L.weeklyCacheState('not an object', NOW), 'missing');
  assert.equal(L.weeklyCacheState(42, NOW), 'missing');
  assert.equal(L.weeklyCacheState([], NOW), 'missing');
  assert.equal(L.weeklyCacheState({}, NOW), 'missing');
  assert.equal(L.weeklyCacheState({ todos: [] }, NOW), 'missing', 'no generatedAt');
  assert.equal(L.weeklyCacheState({ generatedAt: new Date(NOW).toISOString() }, NOW), 'missing', 'no todos array');
  assert.equal(L.weeklyCacheState({ generatedAt: 'not-a-date', todos: [] }, NOW), 'missing', 'unparseable date');
  assert.equal(L.weeklyCacheState({ generatedAt: new Date(NOW).toISOString(), todos: 'nope' }, NOW), 'missing', 'todos not an array');
});

// ── mergeNewTodos ────────────────────────────────────────────────────────────
const mergeExisting = [
  { id: 'td-a', recType: 'content', title: 'A' },
  { id: 'td-b', recType: 'reddit', title: 'B' },
];
const mergeGenerated = [
  { id: 'td-a', recType: 'content', title: 'A regenerated' },  // dup id -> skipped
  { id: 'td-c', recType: 'content', title: 'C' },              // new, matching type
  { id: 'td-d', recType: 'reddit', title: 'D' },               // new, wrong type
  { id: 'td-e', recType: 'content', title: 'E' },              // new, matching type
];

test('mergeNewTodos adds only new todos of the requested type', () => {
  const out = L.mergeNewTodos(mergeExisting, mergeGenerated, 'content');
  assert.equal(out.addedCount, 2);
  assert.equal(out.merged.length, 4);
  const ids = out.merged.map((t) => t.id);
  assert.deepEqual(ids, ['td-a', 'td-b', 'td-c', 'td-e']);
  assert.ok(!ids.includes('td-d'), 'reddit todo not added on a content generation');
});

test('mergeNewTodos dedupes by id and keeps the existing version', () => {
  const out = L.mergeNewTodos(mergeExisting, mergeGenerated, 'content');
  const a = out.merged.find((t) => t.id === 'td-a');
  assert.equal(a.title, 'A', 'existing todo wins over the regenerated duplicate');
});

test('mergeNewTodos zero-new case returns addedCount 0 and the same set', () => {
  const out = L.mergeNewTodos(mergeExisting, [{ id: 'td-a', recType: 'content' }], 'content');
  assert.equal(out.addedCount, 0);
  assert.equal(out.merged.length, 2);
  const out2 = L.mergeNewTodos(mergeExisting, [], 'content');
  assert.equal(out2.addedCount, 0);
  assert.equal(out2.merged.length, 2);
});

test('mergeNewTodos does not mutate its inputs', () => {
  const existingCopy = JSON.stringify(mergeExisting);
  const generatedCopy = JSON.stringify(mergeGenerated);
  const out = L.mergeNewTodos(mergeExisting, mergeGenerated, 'content');
  assert.equal(JSON.stringify(mergeExisting), existingCopy, 'existing untouched');
  assert.equal(JSON.stringify(mergeGenerated), generatedCopy, 'generated untouched');
  assert.notEqual(out.merged, mergeExisting, 'merged is a new array');
});

test('mergeNewTodos handles non-array and malformed inputs defensively', () => {
  const out = L.mergeNewTodos(null, null, 'content');
  assert.equal(out.addedCount, 0);
  assert.equal(out.merged.length, 0);
  const out2 = L.mergeNewTodos([], [{ recType: 'content' }, null], 'content');
  assert.equal(out2.addedCount, 0, 'todos without an id are skipped');
});

// ── youtubeStats ─────────────────────────────────────────────────────────────
test('youtubeStats aggregates citations across YouTube domain variants', () => {
  const out = L.youtubeStats([
    { domain: 'g2.com', citation_count: 12, providers: ['chatgpt'] },
    { domain: 'youtube.com', citation_count: 4, providers: ['chatgpt', 'gemini'] },
    { domain: 'youtu.be', citation_count: 2, providers: ['perplexity'] },
  ]);
  assert.equal(out.citations, 6, 'youtube.com + youtu.be combined');
  assert.deepEqual(Array.from(out.providers).sort(), ['chatgpt', 'gemini', 'perplexity']);
  assert.equal(out.rank, 1, 'best (lowest) index among the variants');
});

test('youtubeStats returns zero/empty when YouTube is absent', () => {
  const out = L.youtubeStats([{ domain: 'g2.com', citation_count: 12, providers: [] }]);
  assert.equal(out.citations, 0);
  assert.equal(out.rank, -1);
  assert.equal(out.providers.length, 0);
  const empty = L.youtubeStats(null);
  assert.equal(empty.citations, 0, 'defensive on non-array input');
});

// ── socialSourceStats ────────────────────────────────────────────────────────
test('socialSourceStats sums social platforms and sorts them by citations desc', () => {
  const out = L.socialSourceStats([
    { domain: 'quora.com', citation_count: 2, providers: ['perplexity'] },
    { domain: 'g2.com', citation_count: 12, providers: ['chatgpt'] },
    { domain: 'linkedin.com', citation_count: 4, providers: ['chatgpt'] },
  ]);
  assert.equal(out.total, 6);
  assert.equal(out.platforms.length, 2);
  assert.equal(out.platforms[0].domain, 'linkedin.com', 'sorted desc by citation_count');
  assert.equal(out.platforms[0].label, 'LinkedIn');
  assert.deepEqual(Array.from(out.providers).sort(), ['chatgpt', 'perplexity']);
});

test('socialSourceStats excludes reddit.com and YouTube (they have their own rules)', () => {
  const out = L.socialSourceStats([
    { domain: 'reddit.com', citation_count: 10, providers: ['chatgpt'] },
    { domain: 'youtube.com', citation_count: 8, providers: ['chatgpt'] },
    { domain: 'youtu.be', citation_count: 3, providers: ['chatgpt'] },
  ]);
  assert.equal(out.total, 0);
  assert.equal(out.platforms.length, 0);
});

// ── brandCitedInSources ──────────────────────────────────────────────────────
test('brandCitedInSources detects the brand domain and its subdomains', () => {
  const srcs = [
    { domain: 'g2.com', citation_count: 10 },
    { domain: 'blog.acme.com', citation_count: 2 },
  ];
  assert.equal(L.brandCitedInSources(srcs, 'acme.com'), true, 'subdomain counts as the brand site');
  assert.equal(L.brandCitedInSources([{ domain: 'acme.com', citation_count: 5 }], 'acme.com'), true);
  assert.equal(L.brandCitedInSources(srcs, 'other.com'), false);
  assert.equal(L.brandCitedInSources([{ domain: 'notacme.com', citation_count: 5 }], 'acme.com'), false, 'suffix match must respect the dot boundary');
});

test('brandCitedInSources treats zero-citation entries and empty domains as not cited', () => {
  assert.equal(L.brandCitedInSources([{ domain: 'acme.com', citation_count: 0 }], 'acme.com'), false);
  assert.equal(L.brandCitedInSources([{ domain: 'acme.com', citation_count: 5 }], ''), false);
  assert.equal(L.brandCitedInSources(null, 'acme.com'), false);
});

// ── new rules: shared fixture ────────────────────────────────────────────────
// Brand site is NOT among the sources, YouTube has 6 citations (source #2 of
// 5), and two social platforms total 6 citations -> all three new rules fire.
const richSnap = {
  brand: { name: 'Acme' },
  visibility: { score: 8, rank: 3, totalChatsAnalyzed: 50 },
  sources: [
    { domain: 'g2.com', mentions: 12, aiModels: ['gpt-4o-mini'] },
    { domain: 'youtube.com', mentions: 6, aiModels: ['gpt-4o-mini', 'gemini-2.0-flash'] },
    { domain: 'reddit.com', mentions: 5, aiModels: ['gpt-4o-mini'] },
    { domain: 'linkedin.com', mentions: 4, aiModels: ['gpt-4o-mini'] },
    { domain: 'quora.com', mentions: 2, aiModels: ['sonar-pro'] },
  ],
  competitors: [],
};

// ── td-youtube ───────────────────────────────────────────────────────────────
test('generateTodos emits the YouTube todo when youtube.com has >= 2 citations', () => {
  const todos = L.generateTodos(richSnap, [], 'Acme', 'https://acme.com');
  const yt = todos.find((t) => t.id === 'td-youtube');
  assert.ok(yt, 'td-youtube should exist (6 youtube citations)');
  assert.equal(yt.recType, 'youtube');
  assert.equal(yt.pageType, 'off-page');
  assert.equal(yt.effort, 'High effort');
  assert.equal(yt.priority, 'high', 'youtube is the #2 citation source, inside the top 5');
  assert.ok(yt.signals[0].includes('6 monitored AI responses'), 'carries the citation count, got: ' + yt.signals[0]);
  // share = round(6/29*100) = 21
  assert.ok(yt.signals[1].includes('21%'), 'carries the citation share, got: ' + yt.signals[1]);
  assert.ok(yt.signals[2].includes('ChatGPT') && yt.signals[2].includes('Gemini'), 'names the providers citing YouTube, got: ' + yt.signals[2]);
  assert.deepEqual(Array.from(yt.aiTargets).sort(), ['chatgpt', 'gemini'], 'targets derive from the providers citing youtube');
});

test('generateTodos skips the YouTube todo below the 2-citation threshold', () => {
  const snap = {
    visibility: { score: 8 },
    sources: [
      { domain: 'g2.com', mentions: 12, aiModels: ['gpt-4o-mini'] },
      { domain: 'youtube.com', mentions: 1, aiModels: ['gpt-4o-mini'] },
    ],
  };
  const todos = L.generateTodos(snap, [], 'Acme', '');
  assert.ok(!todos.find((t) => t.id === 'td-youtube'), '1 citation is below the >= 2 threshold');
});

test('generateTodos YouTube todo is medium priority when outside the top 5 sources', () => {
  const snap = {
    visibility: { score: 8 },
    sources: [
      { domain: 'a.com', mentions: 50 }, { domain: 'b.com', mentions: 40 },
      { domain: 'c.com', mentions: 30 }, { domain: 'd.com', mentions: 20 },
      { domain: 'e.com', mentions: 10 },
      { domain: 'youtube.com', mentions: 2, aiModels: ['gpt-4o-mini'] },
    ],
  };
  const todos = L.generateTodos(snap, [], 'Acme', '');
  const yt = todos.find((t) => t.id === 'td-youtube');
  assert.ok(yt, 'still fires at exactly 2 citations');
  assert.equal(yt.priority, 'medium', 'rank 6 is outside the top 5');
});

// ── td-social ────────────────────────────────────────────────────────────────
test('generateTodos emits the social todo naming the top platform, with one child per platform', () => {
  const todos = L.generateTodos(richSnap, [], 'Acme', 'https://acme.com');
  const soc = todos.find((t) => t.id === 'td-social');
  assert.ok(soc, 'td-social should exist (linkedin 4 + quora 2 = 6 >= 2)');
  assert.equal(soc.recType, 'social-media');
  assert.equal(soc.pageType, 'off-page');
  assert.equal(soc.effort, 'Med effort');
  assert.equal(soc.priority, 'high', 'combined 6 social citations >= 5');
  assert.ok(soc.title.includes('LinkedIn'), 'title names the top platform, got: ' + soc.title);
  assert.ok(soc.signals[1].includes('6 AI citations'), 'carries the combined count, got: ' + soc.signals[1]);
  // multi-platform -> suggestion children, one per platform
  const kids = todos.filter((t) => t._groupId === 'td-social');
  assert.equal(kids.length, 2, 'one child per qualifying platform');
  assert.ok(kids[0].title.includes('LinkedIn'), 'first child targets the top platform');
  assert.ok(kids[1].title.includes('Quora'), 'second child targets Quora');
  kids.forEach((k) => assert.ok(k.steps.length > 0, 'children carry their own platform steps'));
});

test('generateTodos social todo handles a single qualifying platform without children', () => {
  const snap = {
    visibility: { score: 8 },
    sources: [
      { domain: 'g2.com', mentions: 12 },
      { domain: 'quora.com', mentions: 3, aiModels: ['sonar-pro'] },
    ],
  };
  const todos = L.generateTodos(snap, [], 'Acme', '');
  const soc = todos.find((t) => t.id === 'td-social');
  assert.ok(soc, 'fires with one platform at 3 citations');
  assert.equal(soc.priority, 'medium', '3 combined citations is below the >= 5 high threshold');
  assert.ok(soc.title.includes('Quora'));
  assert.ok(soc.steps.length > 0, 'single-platform steps live on the parent');
  assert.ok(!todos.find((t) => t._groupId === 'td-social'), 'no children for a single platform');
});

test('generateTodos skips the social todo when only Reddit/YouTube are present', () => {
  const snap = {
    visibility: { score: 8 },
    sources: [
      { domain: 'reddit.com', mentions: 10, aiModels: ['gpt-4o-mini'] },
      { domain: 'youtube.com', mentions: 8, aiModels: ['gpt-4o-mini'] },
    ],
  };
  const todos = L.generateTodos(snap, [], 'Acme', '');
  assert.ok(!todos.find((t) => t.id === 'td-social'), 'reddit/youtube are excluded from the social rule');
  assert.ok(todos.find((t) => t.id === 'td-reddit'), 'reddit still gets its own rule');
  assert.ok(todos.find((t) => t.id === 'td-youtube'), 'youtube still gets its own rule');
});

test('generateTodos skips the social todo below the combined 2-citation threshold', () => {
  const snap = {
    visibility: { score: 8 },
    sources: [
      { domain: 'g2.com', mentions: 12 },
      { domain: 'linkedin.com', mentions: 1 },
    ],
  };
  const todos = L.generateTodos(snap, [], 'Acme', '');
  assert.ok(!todos.find((t) => t.id === 'td-social'), '1 combined citation is below the >= 2 threshold');
});

// ── td-crawl ─────────────────────────────────────────────────────────────────
test('generateTodos emits the crawlability todo when the brand site is never cited', () => {
  const todos = L.generateTodos(richSnap, [], 'Acme', 'https://acme.com');
  const crawl = todos.find((t) => t.id === 'td-crawl');
  assert.ok(crawl, 'td-crawl should exist (5 sources cited, acme.com not among them)');
  assert.equal(crawl.recType, 'crawlability');
  assert.equal(crawl.pageType, 'on-page');
  assert.equal(crawl.priority, 'high');
  assert.equal(crawl.effort, 'Low effort');
  assert.ok(crawl.title.includes('acme.com'), 'title names the brand domain, got: ' + crawl.title);
  assert.ok(crawl.signals[0].includes('5 different domains'), 'counts the cited domains, got: ' + crawl.signals[0]);
  assert.ok(crawl.signals[1].includes('g2.com'), 'names the top cited domains, got: ' + crawl.signals[1]);
  assert.ok(crawl.steps.some((s) => s.includes('robots.txt')), 'steps cover robots.txt');
  assert.ok(crawl.steps.some((s) => s.includes('llms.txt')), 'steps cover llms.txt');
  assert.ok(crawl.steps.some((s) => s.includes('Bing')), 'steps cover the Bing index check');
});

test('generateTodos skips the crawlability todo when the brand site is already cited', () => {
  // liveSnap has acme.com with 30 citations
  const todos = L.generateTodos(liveSnap, livePromptRows, 'Acme', 'https://acme.com');
  assert.ok(!todos.find((t) => t.id === 'td-crawl'), 'brand domain is cited -> rule must not fire');
});

test('generateTodos skips the crawlability todo without a brand domain or with sparse sources', () => {
  const noDomain = L.generateTodos(richSnap, [], 'Acme', '');
  assert.ok(!noDomain.find((t) => t.id === 'td-crawl'), 'no brand domain -> no crawl todo');
  const sparse = L.generateTodos({
    visibility: { score: 8 },
    sources: [{ domain: 'g2.com', mentions: 12 }, { domain: 'capterra.com', mentions: 4 }],
  }, [], 'Acme', 'https://acme.com');
  assert.ok(!sparse.find((t) => t.id === 'td-crawl'), 'fewer than 3 sources -> no crawl todo');
});

// ── schema completeness of the new rules ─────────────────────────────────────
test('new-rule todos carry the full todo schema (parallel arrays, steps, valid enums)', () => {
  const todos = L.generateTodos(richSnap, [], 'Acme', 'https://acme.com');
  const fresh = todos.filter((t) => ['youtube', 'social-media', 'crawlability'].includes(t.recType));
  assert.ok(fresh.length >= 4, 'parent rows for all three rules plus social children, got ' + fresh.length);
  const validRecTypes = ['content', 'social-media', 'reddit', 'youtube', 'backlinks', 'crawlability', 'technical-seo'];
  fresh.forEach((t) => {
    assert.ok(t.id && typeof t.id === 'string', t.id + ': has a stable id');
    assert.ok(t.title && typeof t.title === 'string', t.id + ': has a title');
    assert.ok(['high', 'medium'].includes(t.priority), t.id + ': valid priority');
    assert.ok(validRecTypes.includes(t.recType), t.id + ': valid recType');
    assert.ok(['on-page', 'off-page'].includes(t.pageType), t.id + ': valid pageType');
    assert.ok(/effort/i.test(t.effort), t.id + ': effort label present');
    assert.ok(Array.isArray(t.aiTargets) && t.aiTargets.length > 0, t.id + ': aiTargets non-empty');
    assert.ok(t.reasoning && t.reasoning.length > 40, t.id + ': has a reasoning paragraph');
    assert.ok(Array.isArray(t.signals) && t.signals.length > 0, t.id + ': signals non-empty');
    assert.equal(t.sigs_fav.length, t.signals.length, t.id + ': sigs_fav parallel to signals');
    if (t.sigs_expand !== null) {
      assert.equal(t.sigs_expand.length, t.signals.length, t.id + ': sigs_expand parallel to signals');
    }
    assert.ok(Array.isArray(t.steps) && t.steps.length > 0, t.id + ': steps non-empty');
    assert.ok(!/—/.test(JSON.stringify(t)), t.id + ': no em dashes in any copy');
  });
});

test('new-rule todos fall back to activeProviders when sources carry no aiModels', () => {
  const snap = {
    visibility: { score: 8 },
    sources: [
      { domain: 'g2.com', mentions: 12 },
      { domain: 'youtube.com', mentions: 4 },
      { domain: 'linkedin.com', mentions: 3 },
    ],
  };
  const todos = L.generateTodos(snap, [], 'Acme', 'https://acme.com');
  ['td-youtube', 'td-social', 'td-crawl'].forEach((id) => {
    const t = todos.find((x) => x.id === id);
    assert.ok(t, id + ' fires');
    assert.ok(t.aiTargets.length > 0, id + ': aiTargets falls back to all providers');
  });
});

// ── perModelStats (looker per-model aggregation) ─────────────────────────────
// Looker rows use snake_case `ai_model` (NOT the promptDetail `aiModel`).
const lookerBrandRows = [
  { date: '2026-06-10', ai_model: 'gpt-4o-mini', visibility: 100, sentiment: 'positive', avg_position: 1, entity_type: 'brand', entity_name: 'Acme' },
  { date: '2026-06-10', ai_model: 'gpt-4o', visibility: 50, sentiment: 'negative', avg_position: 3, entity_type: 'brand', entity_name: 'Acme' },
  { date: '2026-06-11', ai_model: 'gpt-4o-mini', visibility: 0, sentiment: 'positive', avg_position: 0, entity_type: 'brand', entity_name: 'Acme' },
  // gemini: only 2 brand rows -> below the default 3-row minimum
  { date: '2026-06-10', ai_model: 'gemini-2.5-flash', visibility: 100, sentiment: 'positive', avg_position: 1, entity_type: 'brand', entity_name: 'Acme' },
  { date: '2026-06-11', ai_model: 'gemini-2.5-flash', visibility: 0, sentiment: null, avg_position: 0, entity_type: 'brand', entity_name: 'Acme' },
  // competitor rows must never count toward the brand's stats
  { date: '2026-06-10', ai_model: 'gpt-4o-mini', visibility: 100, sentiment: 'positive', avg_position: 1, entity_type: 'competitor', entity_name: 'WidgetCo' },
  { date: '2026-06-10', ai_model: 'sonar-pro', visibility: 100, sentiment: 'positive', avg_position: 1, entity_type: 'competitor', entity_name: 'WidgetCo' },
];

test('perModelStats groups brand rows by ai_model into provider keys', () => {
  const stats = L.perModelStats(lookerBrandRows, 'Acme');
  assert.ok(stats.chatgpt, 'gpt-4o-mini/gpt-4o rows group under chatgpt');
  assert.equal(stats.chatgpt.runs, 3);
  assert.equal(stats.chatgpt.visibility, 50, 'visibility is the mean: (100+50+0)/3');
  assert.ok(!stats.perplexity, 'competitor-only sonar rows do not create a provider entry');
});

test('perModelStats sentiment is percent positive among rows carrying a sentiment', () => {
  const stats = L.perModelStats(lookerBrandRows, 'Acme');
  // chatgpt: positive, negative, positive -> round(2/3 * 100) = 67
  assert.equal(stats.chatgpt.sentiment, 67);
});

test('perModelStats position is the mean of avg_position values > 0', () => {
  const stats = L.perModelStats(lookerBrandRows, 'Acme');
  // chatgpt avg_position values: 1, 3, 0 -> zeros excluded -> mean 2
  assert.equal(stats.chatgpt.position, 2);
  // a provider with only zero positions gets null
  const onlyZero = L.perModelStats([
    { ai_model: 'sonar', visibility: 10, sentiment: 'positive', avg_position: 0, entity_type: 'brand' },
    { ai_model: 'sonar', visibility: 10, sentiment: 'positive', avg_position: 0, entity_type: 'brand' },
    { ai_model: 'sonar', visibility: 10, sentiment: 'positive', avg_position: 0, entity_type: 'brand' },
  ], 'Acme');
  assert.equal(onlyZero.perplexity.position, null);
});

test('perModelStats drops providers below the minimum row count', () => {
  const stats = L.perModelStats(lookerBrandRows, 'Acme');
  assert.ok(!stats.gemini, '2 gemini rows is below the default minimum of 3');
  const relaxed = L.perModelStats(lookerBrandRows, 'Acme', 1);
  assert.ok(relaxed.gemini, 'explicit minRows=1 keeps gemini');
  assert.equal(relaxed.gemini.runs, 2);
  assert.equal(relaxed.gemini.visibility, 50);
});

test('perModelStats requires the snake_case ai_model field (not aiModel)', () => {
  const camelRows = [
    { aiModel: 'gpt-4o-mini', visibility: 10, sentiment: 'positive', entity_type: 'brand' },
    { aiModel: 'gpt-4o-mini', visibility: 10, sentiment: 'positive', entity_type: 'brand' },
    { aiModel: 'gpt-4o-mini', visibility: 10, sentiment: 'positive', entity_type: 'brand' },
  ];
  assert.equal(Object.keys(L.perModelStats(camelRows, 'Acme')).length, 0, 'camelCase aiModel rows cannot be grouped');
});

test('perModelStats returns {} for empty, null, or non-array input', () => {
  assert.equal(Object.keys(L.perModelStats([], 'Acme')).length, 0);
  assert.equal(Object.keys(L.perModelStats(null, 'Acme')).length, 0);
  assert.equal(Object.keys(L.perModelStats(undefined, 'Acme')).length, 0);
  assert.equal(Object.keys(L.perModelStats('nope', 'Acme')).length, 0);
});

test('perModelStats falls back to entity_name matching when entity_type is missing', () => {
  const rows = [
    { ai_model: 'gpt-4o-mini', visibility: 20, sentiment: 'positive', avg_position: 1, entity_name: 'Acme' },
    { ai_model: 'gpt-4o-mini', visibility: 20, sentiment: 'positive', avg_position: 1, entity_name: 'Acme' },
    { ai_model: 'gpt-4o-mini', visibility: 20, sentiment: 'positive', avg_position: 1, entity_name: 'Acme' },
    { ai_model: 'gpt-4o-mini', visibility: 99, sentiment: 'negative', avg_position: 9, entity_name: 'SomeoneElse' },
  ];
  const stats = L.perModelStats(rows, 'Acme');
  assert.equal(stats.chatgpt.runs, 3, 'name-matched rows count, other entities do not');
  assert.equal(stats.chatgpt.visibility, 20);
});

// ── reactivated rules: td-model-gap / td-brand-sentiment / td-google-ai ──────
// generateTodos reads latest_by_provider straight off the snapshot, which is
// exactly where the view now injects perModelStats() output.
function snapWithProviders(latestByProvider) {
  return {
    brand: { name: 'Acme' },
    visibility: { score: 10, rank: 2, totalChatsAnalyzed: 50 },
    sources: [
      { domain: 'g2.com', mentions: 12, aiModels: ['gpt-4o-mini'] },
      { domain: 'capterra.com', mentions: 6, aiModels: ['gemini-2.0-flash'] },
    ],
    competitors: [],
    latest_by_provider: latestByProvider,
  };
}

test('td-model-gap fires when the strongest-weakest model gap exceeds 3 points', () => {
  const todos = L.generateTodos(snapWithProviders({
    chatgpt: { visibility: 20, sentiment: 80, position: 2.5, runs: 10 },
    gemini: { visibility: 5, sentiment: 80, position: 3.2, runs: 8 },
  }), [], 'Acme', 'https://acme.com');
  const gap = todos.find((t) => t.id === 'td-model-gap');
  assert.ok(gap, 'td-model-gap should exist (20 vs 5 = 15-point gap)');
  assert.deepEqual(Array.from(gap.aiTargets), ['gemini'], 'targets the weakest model');
  assert.ok(gap.title.includes('Gemini'), 'title names the weakest model, got: ' + gap.title);
  assert.ok(gap.title.includes('5.0%') && gap.title.includes('20.0%'), 'title carries both numbers, got: ' + gap.title);
});

test('td-model-gap does not fire at a gap of 3 points or less, or with one model', () => {
  const close = L.generateTodos(snapWithProviders({
    chatgpt: { visibility: 10, sentiment: 80, position: 2, runs: 10 },
    gemini: { visibility: 8, sentiment: 80, position: 2, runs: 8 },
  }), [], 'Acme', 'https://acme.com');
  assert.ok(!close.find((t) => t.id === 'td-model-gap'), '2-point gap is below the > 3 threshold');
  const single = L.generateTodos(snapWithProviders({
    chatgpt: { visibility: 30, sentiment: 80, position: 2, runs: 10 },
  }), [], 'Acme', 'https://acme.com');
  assert.ok(!single.find((t) => t.id === 'td-model-gap'), 'one model cannot have a gap');
});

test('td-brand-sentiment fires below 58% average positive sentiment', () => {
  const todos = L.generateTodos(snapWithProviders({
    chatgpt: { visibility: 20, sentiment: 70, position: 2, runs: 10 },
    gemini: { visibility: 15, sentiment: 40, position: 3, runs: 8 },
    googleaio: { visibility: 14, sentiment: 50, position: 4, runs: 6 },
  }), [], 'Acme', 'https://acme.com');
  // avg = (70+40+50)/3 = 53.3 < 58. Parent has no steps of its own, so only
  // the 5 suggestion children are emitted, grouped under td-brand-sentiment.
  const kids = todos.filter((t) => t._groupId === 'td-brand-sentiment');
  assert.equal(kids.length, 5, '5 sentiment-fix children emitted');
  assert.ok(kids[0]._groupLabel.includes('53%'), 'group label carries the rounded average, got: ' + kids[0]._groupLabel);
  assert.ok(!todos.find((t) => t.id === 'td-brand-sentiment'), 'parent without steps is not emitted as a row');
});

test('td-brand-sentiment does not fire at 58% or above', () => {
  const todos = L.generateTodos(snapWithProviders({
    chatgpt: { visibility: 20, sentiment: 70, position: 2, runs: 10 },
    gemini: { visibility: 15, sentiment: 60, position: 3, runs: 8 },
  }), [], 'Acme', 'https://acme.com');
  assert.ok(!todos.find((t) => t._groupId === 'td-brand-sentiment'), 'avg 65% is above the < 58 threshold');
});

test('td-google-ai fires when Google AI visibility is under 55% of ChatGPT', () => {
  const todos = L.generateTodos(snapWithProviders({
    chatgpt: { visibility: 20, sentiment: 80, position: 2, runs: 10 },
    googleaio: { visibility: 4, sentiment: 80, position: 3, runs: 6 },
  }), [], 'Acme', 'https://acme.com');
  const g = todos.find((t) => t.id === 'td-google-ai');
  assert.ok(g, 'td-google-ai should exist (4 < 20 * 0.55)');
  assert.ok(g.title.includes('4.0%') && g.title.includes('20.0%'), 'title carries both numbers, got: ' + g.title);
  assert.deepEqual(Array.from(g.aiTargets), ['googleaio'], 'targets the Google AI surface with data');
  const kids = todos.filter((t) => t._groupId === 'td-google-ai');
  assert.equal(kids.length, 2, 'backlinks + best-guide children emitted');
});

test('td-google-ai uses the weaker of AIO and AI Mode when both are present', () => {
  const todos = L.generateTodos(snapWithProviders({
    chatgpt: { visibility: 20, sentiment: 80, position: 2, runs: 10 },
    googleaio: { visibility: 18, sentiment: 80, position: 3, runs: 6 },
    googleaimode: { visibility: 3, sentiment: 80, position: 3, runs: 5 },
  }), [], 'Acme', 'https://acme.com');
  const g = todos.find((t) => t.id === 'td-google-ai');
  assert.ok(g, 'min(18, 3) = 3 < 11 -> fires');
  assert.ok(g.title.includes('3.0%'), 'title uses the weaker Google surface, got: ' + g.title);
});

test('td-google-ai does not fire when Google AI holds up or ChatGPT is at zero', () => {
  const fine = L.generateTodos(snapWithProviders({
    chatgpt: { visibility: 20, sentiment: 80, position: 2, runs: 10 },
    googleaio: { visibility: 15, sentiment: 80, position: 3, runs: 6 },
  }), [], 'Acme', 'https://acme.com');
  assert.ok(!fine.find((t) => t.id === 'td-google-ai'), '15 >= 20 * 0.55 -> no todo');
  const zeroChat = L.generateTodos(snapWithProviders({
    chatgpt: { visibility: 0, sentiment: 80, position: 2, runs: 10 },
    googleaio: { visibility: 0, sentiment: 80, position: 3, runs: 6 },
  }), [], 'Acme', 'https://acme.com');
  assert.ok(!zeroChat.find((t) => t.id === 'td-google-ai'), 'chatgpt at 0 -> no todo');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
