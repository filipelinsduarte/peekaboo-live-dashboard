/*
 * prompt-detail.logic.test.mjs — unit tests for the pure logic in
 * views/prompt-detail.js (escapeHtml, normalizeSpaces, highlightMentions,
 * formatAnswer, responseTextFor fallback chain, plus the v4-page helpers:
 * groupRunsByDate, dateAggregates, topEntities, previewText,
 * letterAvatarColor).
 *
 * Run with:  node live-app/tests/prompt-detail.logic.test.mjs
 * (zero dependencies; exits non-zero on failure)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'views', 'prompt-detail.js'), 'utf8');

// prompt-detail.js only touches the DOM inside functions; at the top level it
// needs window.PB (and the bare PB identifier) with el/fmt present.
// PBPromptDetailLogic is exposed before any DOM work happens.
const pbStub = {
  el() { return { appendChild() {}, addEventListener() {}, style: {} }; },
  fmt: { score() { return ''; }, int() { return ''; }, date() { return ''; }, num1() { return ''; } },
  api: {},
  card() { return {}; },
  cardTitle() { return {}; },
  favicon() { return ''; },
  modelLogo() { return ''; },
  modelLabel() { return ''; },
  toast() {},
};
const sandbox = {
  window: { PB: pbStub },
  PB: pbStub,
  document: {
    getElementById() { return null; },
    createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; },
    addEventListener() {},
    removeEventListener() {},
    head: { appendChild() {} },
    body: { appendChild() {}, style: {} },
  },
  console,
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const L = sandbox.window.PBPromptDetailLogic;
assert.ok(L, 'PBPromptDetailLogic should be exposed on window');

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

// ── escapeHtml ───────────────────────────────────────────────────────────────
test('escapeHtml escapes all dangerous characters', () => {
  assert.equal(
    L.escapeHtml('<script>alert("x") & \'y\'</script>'),
    '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;'
  );
  assert.equal(L.escapeHtml(null), '');
  assert.equal(L.escapeHtml(undefined), '');
  assert.equal(L.escapeHtml(42), '42');
});

// ── normalizeSpaces (nbsp normalization) ─────────────────────────────────────
test('normalizeSpaces converts U+00A0 characters to regular spaces', () => {
  assert.equal(L.normalizeSpaces('a b c'), 'a b c');
});

test('normalizeSpaces converts literal &nbsp; strings to regular spaces', () => {
  assert.equal(L.normalizeSpaces('a&nbsp;b&nbsp;c'), 'a b c');
});

test('normalizeSpaces normalizes Windows and bare-CR line endings', () => {
  assert.equal(L.normalizeSpaces('a\r\nb\rc'), 'a\nb\nc');
});

test('normalizeSpaces handles empty and nullish input', () => {
  assert.equal(L.normalizeSpaces(''), '');
  assert.equal(L.normalizeSpaces(null), '');
  assert.equal(L.normalizeSpaces(undefined), '');
});

// ── highlightMentions ────────────────────────────────────────────────────────
test('highlightMentions wraps an exact entity match', () => {
  const escaped = L.escapeHtml('I recommend AI Peekaboo for monitoring.');
  const out = L.highlightMentions(escaped, ['AI Peekaboo']);
  assert.equal(out, 'I recommend <span class="pb-rm-hl">AI Peekaboo</span> for monitoring.');
});

test('highlightMentions matches escaped entity names (escapes HTML first)', () => {
  // entity name contains & which appears as &amp; in the escaped text
  const escaped = L.escapeHtml('Try Johnson & Johnson today.');
  assert.equal(escaped, 'Try Johnson &amp; Johnson today.');
  const out = L.highlightMentions(escaped, ['Johnson & Johnson']);
  assert.equal(out, 'Try <span class="pb-rm-hl">Johnson &amp; Johnson</span> today.');
});

test('highlightMentions never injects unescaped entity markup', () => {
  // a malicious entity name must not introduce raw HTML into the output
  const escaped = L.escapeHtml('hello <b>world</b>');
  const out = L.highlightMentions(escaped, ['<b>world</b>']);
  assert.ok(out.indexOf('<b>') === -1, 'raw <b> must not appear: ' + out);
  assert.ok(out.indexOf('<span class="pb-rm-hl">&lt;b&gt;world&lt;/b&gt;</span>') !== -1);
});

test('highlightMentions does not double-wrap overlapping names', () => {
  const escaped = L.escapeHtml('AI Peekaboo is better than plain Peekaboo clones.');
  const out = L.highlightMentions(escaped, ['Peekaboo', 'AI Peekaboo']);
  // longest name wins for the overlapping region; the standalone short name
  // is still wrapped, and nothing is nested
  const spanCount = out.split('<span class="pb-rm-hl">').length - 1;
  assert.equal(spanCount, 2, 'expected exactly 2 highlight spans, got: ' + out);
  assert.ok(out.indexOf('<span class="pb-rm-hl">AI Peekaboo</span>') !== -1);
  assert.ok(out.indexOf('<span class="pb-rm-hl">Peekaboo</span> clones') !== -1);
  assert.ok(out.indexOf('<span class="pb-rm-hl">AI <span') === -1, 'no nested spans');
});

test('highlightMentions with empty entity list returns input unchanged', () => {
  const escaped = L.escapeHtml('Nothing to highlight here.');
  assert.equal(L.highlightMentions(escaped, []), escaped);
  assert.equal(L.highlightMentions(escaped, null), escaped);
  assert.equal(L.highlightMentions(escaped, undefined), escaped);
});

test('highlightMentions skips blank or nullish entity names', () => {
  const escaped = L.escapeHtml('Some text.');
  assert.equal(L.highlightMentions(escaped, ['', '  ', null, undefined]), escaped);
});

test('highlightMentions on empty text returns empty string', () => {
  assert.equal(L.highlightMentions('', ['Brand']), '');
});

// ── formatAnswer ─────────────────────────────────────────────────────────────
test('formatAnswer escapes raw HTML in the response', () => {
  const out = L.formatAnswer('hi <img src=x onerror=alert(1)> there');
  assert.ok(out.indexOf('<img') === -1, 'raw img tag must be escaped: ' + out);
  assert.ok(out.indexOf('&lt;img') !== -1);
});

test('formatAnswer renders **bold** markdown as <strong>', () => {
  const out = L.formatAnswer('Use **AI Peekaboo** daily.');
  assert.ok(out.indexOf('<strong>AI Peekaboo</strong>') !== -1, out);
});

test('formatAnswer normalizes nbsp characters in the body', () => {
  const out = L.formatAnswer('a b and c&nbsp;d');
  assert.ok(out.indexOf('a b') !== -1, out);
  assert.ok(out.indexOf('c d') !== -1, out);
  assert.ok(out.indexOf(' ') === -1, 'no nbsp chars left');
  assert.ok(out.indexOf('&nbsp;') === -1, 'no literal &nbsp; left');
});

test('formatAnswer splits paragraphs and converts single newlines to <br>', () => {
  const out = L.formatAnswer('para one\nline two\n\npara two');
  assert.ok(out.indexOf('para one<br>line two') !== -1, out);
  const pCount = out.split('<p').length - 1;
  assert.equal(pCount, 2, 'expected 2 paragraphs: ' + out);
});

test('formatAnswer detects numbered lists', () => {
  const out = L.formatAnswer('1. First tool\n2. Second tool\n3. Third tool');
  assert.ok(out.indexOf('<ol') !== -1, out);
  assert.ok(out.indexOf('<li>First tool</li>') !== -1, out);
});

test('formatAnswer detects bulleted lists', () => {
  const out = L.formatAnswer('- alpha\n- beta\n- gamma');
  assert.ok(out.indexOf('<ul') !== -1, out);
  assert.ok(out.indexOf('<li>alpha</li>') !== -1, out);
});

test('formatAnswer returns a no-text placeholder for empty input', () => {
  assert.ok(L.formatAnswer('').indexOf('No response text available') !== -1);
  assert.ok(L.formatAnswer(null).indexOf('No response text available') !== -1);
});

// ── responseTextFor (fullResponse fallback chain) ────────────────────────────
test('responseTextFor prefers fullResponse and marks it complete', () => {
  const r = L.responseTextFor({
    fullResponse: 'the full answer',
    responseSnippet: 'snippet',
    mentionSummary: 'summary',
  });
  assert.equal(r.text, 'the full answer');
  assert.equal(r.partial, false);
});

test('responseTextFor falls back to responseSnippet as partial', () => {
  const r = L.responseTextFor({ responseSnippet: 'snippet only', mentionSummary: 'summary' });
  assert.equal(r.text, 'snippet only');
  assert.equal(r.partial, true);
});

test('responseTextFor falls back to mentionSummary as partial', () => {
  const r = L.responseTextFor({ mentionSummary: 'summary only' });
  assert.equal(r.text, 'summary only');
  assert.equal(r.partial, true);
});

test('responseTextFor handles a run with no text at all', () => {
  const r = L.responseTextFor({});
  assert.equal(r.text, '');
  assert.equal(r.partial, true);
});

test('responseTextFor handles a nullish run', () => {
  const r = L.responseTextFor(null);
  assert.equal(r.text, '');
  assert.equal(r.partial, true);
});

// Values created inside the vm context have different Array/Object prototypes
// than the host realm, so assert.deepStrictEqual rejects them. Compare by JSON.
function eqJson(actual, expected, msg) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), msg);
}

// ── filterHistoryByModel ─────────────────────────────────────────────────────
test('filterHistoryByModel keeps only runs matching the given aiModel', () => {
  const history = [{ aiModel: 'gemini-2.5-flash', score: 1 }, { aiModel: 'sonar', score: 2 }, { aiModel: 'gemini-2.5-flash', score: 3 }];
  const r = L.filterHistoryByModel(history, 'gemini-2.5-flash');
  eqJson(r.map(x => x.score), [1, 3]);
});

test('filterHistoryByModel returns everything for "all", falsy, or unset model', () => {
  const history = [{ aiModel: 'sonar' }, { aiModel: 'gpt-4o-mini' }];
  eqJson(L.filterHistoryByModel(history, 'all'), history);
  eqJson(L.filterHistoryByModel(history, null), history);
  eqJson(L.filterHistoryByModel(history, undefined), history);
  eqJson(L.filterHistoryByModel(history, ''), history);
});

test('filterHistoryByModel handles empty/nullish history and skips nullish runs', () => {
  eqJson(L.filterHistoryByModel([], 'sonar'), []);
  eqJson(L.filterHistoryByModel(null, 'sonar'), []);
  assert.equal(L.filterHistoryByModel([null, { aiModel: 'sonar' }, undefined], 'sonar').length, 1);
});

// ── withHistory ──────────────────────────────────────────────────────────────
test('withHistory swaps only .history, keeping every other field intact', () => {
  const detail = { promptText: 'hi', category: 'Pain Points', history: [{ id: 'orig' }] };
  const filtered = [{ id: 'new' }];
  const clone = L.withHistory(detail, filtered);
  eqJson(clone, { promptText: 'hi', category: 'Pain Points', history: filtered });
  eqJson(detail.history, [{ id: 'orig' }]); // original untouched
});

// ── groupRunsByDate ──────────────────────────────────────────────────────────
test('groupRunsByDate groups runs by date, newest first', () => {
  const history = [
    { runId: 'a', date: '2026-06-10', aiModel: 'sonar' },
    { runId: 'b', date: '2026-06-12', aiModel: 'sonar' },
    { runId: 'c', date: '2026-06-10', aiModel: 'gpt-4o-mini' },
    { runId: 'd', date: '2026-06-11', aiModel: 'sonar' },
  ];
  const groups = L.groupRunsByDate(history);
  assert.equal(groups.length, 3);
  eqJson(groups.map(g => g.date), ['2026-06-12', '2026-06-11', '2026-06-10']);
  eqJson(groups[2].runs.map(r => r.runId), ['a', 'c'], 'run order within a date is preserved');
});

test('groupRunsByDate keeps multiple runs of the same model on one date', () => {
  const groups = L.groupRunsByDate([
    { runId: 'x', date: '2026-06-12', aiModel: 'sonar' },
    { runId: 'y', date: '2026-06-12', aiModel: 'sonar' },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].runs.length, 2);
});

test('groupRunsByDate handles empty, nullish, and dateless input', () => {
  eqJson(L.groupRunsByDate([]), []);
  eqJson(L.groupRunsByDate(null), []);
  eqJson(L.groupRunsByDate(undefined), []);
  const groups = L.groupRunsByDate([
    { runId: 'a' },
    { runId: 'b', date: '2026-06-12' },
    null,
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].date, '2026-06-12', 'dated group first');
  assert.equal(groups[1].date, '', 'dateless runs grouped last');
  assert.equal(groups[1].runs[0].runId, 'a');
});

// ── paginateGroups ───────────────────────────────────────────────────────────
test('paginateGroups slices into pages of the given size, page 0 is the first 7', () => {
  const groups = Array.from({ length: 16 }, (_, i) => ({ date: 'day' + i }));
  const p0 = L.paginateGroups(groups, 7, 0);
  assert.equal(p0.pageGroups.length, 7);
  assert.equal(p0.pageGroups[0].date, 'day0');
  assert.equal(p0.hasPrev, false);
  assert.equal(p0.hasNext, true);
  assert.equal(p0.totalPages, 3); // 16 / 7 -> 3 pages (7 + 7 + 2)

  const p2 = L.paginateGroups(groups, 7, 2);
  assert.equal(p2.pageGroups.length, 2); // remainder page
  assert.equal(p2.pageGroups[0].date, 'day14');
  assert.equal(p2.hasNext, false);
  assert.equal(p2.hasPrev, true);
});

test('paginateGroups clamps out-of-range pages instead of returning empty', () => {
  const groups = Array.from({ length: 5 }, (_, i) => ({ date: 'day' + i }));
  assert.equal(L.paginateGroups(groups, 7, 99).page, 0); // only 1 page exists
  assert.equal(L.paginateGroups(groups, 7, -5).page, 0);
});

test('paginateGroups handles empty/nullish input and a non-positive page size', () => {
  eqJson(L.paginateGroups([], 7, 0), { page: 0, totalPages: 1, pageGroups: [], hasPrev: false, hasNext: false });
  eqJson(L.paginateGroups(null, 7, 0), { page: 0, totalPages: 1, pageGroups: [], hasPrev: false, hasNext: false });
  // falsy/invalid pageSize falls back to 7
  const groups = Array.from({ length: 8 }, (_, i) => ({ date: 'day' + i }));
  assert.equal(L.paginateGroups(groups, 0, 0).pageGroups.length, 7);
});

// ── dateAggregates ───────────────────────────────────────────────────────────
test('dateAggregates computes mean visibility, treating null score as 0', () => {
  const agg = L.dateAggregates([
    { score: 50, sentiment: 'positive', rank: 1 },
    { score: null, sentiment: 'positive', rank: 2 },
    { score: 100, sentiment: 'negative', rank: 0 },
  ]);
  assert.equal(agg.avgVis, 50, '(50 + 0 + 100) / 3 = 50');
});

test('dateAggregates picks the most frequent non-null sentiment', () => {
  const agg = L.dateAggregates([
    { score: 10, sentiment: 'positive' },
    { score: 10, sentiment: 'positive' },
    { score: 10, sentiment: 'negative' },
    { score: 10, sentiment: null },
  ]);
  assert.equal(agg.domSentiment, 'positive');
});

test('dateAggregates averages only ranks > 0 to one decimal', () => {
  const agg = L.dateAggregates([
    { score: 10, rank: 1 },
    { score: 10, rank: 2 },
    { score: 10, rank: 0 },
    { score: 10, rank: null },
  ]);
  assert.equal(agg.avgPos, 1.5);
  const agg2 = L.dateAggregates([{ score: 10, rank: 1 }, { score: 10, rank: 2 }, { score: 10, rank: 4 }]);
  assert.equal(agg2.avgPos, 2.3, 'mean 2.333... rounds to 2.3');
});

test('dateAggregates returns neutral defaults for empty or nullish runs', () => {
  eqJson(L.dateAggregates([]), { avgVis: 0, domSentiment: 'neutral', avgPos: null });
  eqJson(L.dateAggregates(null), { avgVis: 0, domSentiment: 'neutral', avgPos: null });
  const agg = L.dateAggregates([{ score: 10 }]);
  assert.equal(agg.domSentiment, 'neutral');
  assert.equal(agg.avgPos, null);
});

// ── topEntities ──────────────────────────────────────────────────────────────
test('topEntities counts brand mentions and citation domains across runs', () => {
  const history = [
    {
      brandMentions: [{ entityName: 'Kueski' }, { entityName: 'Nubank' }],
      sources: [{ domain: 'kueski.com' }, { domain: 'condusef.gob.mx' }],
    },
    {
      brandMentions: [{ entityName: 'Kueski' }],
      sources: [{ domain: 'kueski.com' }],
    },
  ];
  const tops = L.topEntities(history);
  eqJson(tops.topBrands[0], { name: 'Kueski', count: 2 });
  eqJson(tops.topBrands[1], { name: 'Nubank', count: 1 });
  eqJson(tops.topCites[0], { domain: 'kueski.com', count: 2 });
  eqJson(tops.topCites[1], { domain: 'condusef.gob.mx', count: 1 });
});

test('topEntities caps each list at 5 entries, sorted by count desc', () => {
  const mentions = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(n => ({ entityName: n }));
  // give 'G' the highest count so the cap must keep it
  const history = [
    { brandMentions: mentions, sources: [] },
    { brandMentions: [{ entityName: 'G' }], sources: [] },
  ];
  const tops = L.topEntities(history);
  assert.equal(tops.topBrands.length, 5);
  assert.equal(tops.topBrands[0].name, 'G');
  assert.equal(tops.topBrands[0].count, 2);
});

test('topEntities skips blank names/domains and handles empty input', () => {
  const tops = L.topEntities([
    { brandMentions: [{ entityName: '' }, { entityName: '  ' }, null], sources: [{ domain: '' }, null] },
  ]);
  eqJson(tops, { topBrands: [], topCites: [] });
  eqJson(L.topEntities(null), { topBrands: [], topCites: [] });
  eqJson(L.topEntities([]), { topBrands: [], topCites: [] });
});

// ── brandMentionTable (Mentioned Brands card) ───────────────────────────────
test('brandMentionTable returns every mentioned entity, uncapped, sorted by count desc', () => {
  const mentions = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(n => ({ entityName: n }));
  const history = [
    { brandMentions: mentions },
    { brandMentions: [{ entityName: 'G' }] },
  ];
  const rows = L.brandMentionTable(history);
  assert.equal(rows.length, 7); // no 5-item cap, unlike topEntities
  assert.equal(rows[0].name, 'G');
  assert.equal(rows[0].count, 2);
});

test('brandMentionTable skips blank names and handles empty/nullish input', () => {
  eqJson(L.brandMentionTable([{ brandMentions: [{ entityName: '' }, null] }]), []);
  eqJson(L.brandMentionTable(null), []);
  eqJson(L.brandMentionTable([]), []);
});

// ── sourceTable (Sources card) ──────────────────────────────────────────────
test('sourceTable groups by domain with citation share and per-URL breakdown', () => {
  const history = [
    {
      sources: [
        { domain: 'a.com', url: 'https://a.com/1', title: 'A One' },
        { domain: 'a.com', url: 'https://a.com/1', title: 'A One' },
        { domain: 'b.com', url: 'https://b.com/x', title: 'B X' },
      ],
    },
    { sources: [{ domain: 'a.com', url: 'https://a.com/2', title: 'A Two' }] },
  ];
  const rows = L.sourceTable(history);
  // a.com: 3 of 4 total citations = 75%; b.com: 1 of 4 = 25%
  eqJson(rows[0], {
    domain: 'a.com',
    count: 3,
    share: 75,
    urls: [
      { url: 'https://a.com/1', title: 'A One', count: 2 },
      { url: 'https://a.com/2', title: 'A Two', count: 1 },
    ],
  });
  eqJson(rows[1], { domain: 'b.com', count: 1, share: 25, urls: [{ url: 'https://b.com/x', title: 'B X', count: 1 }] });
});

test('sourceTable falls back to the URL as the title when title is missing, and to the domain when url is missing', () => {
  const history = [{ sources: [{ domain: 'c.com', url: 'https://c.com/p' }, { domain: 'd.com' }] }];
  const rows = L.sourceTable(history);
  const byDomain = Object.fromEntries(rows.map(r => [r.domain, r]));
  assert.equal(byDomain['c.com'].urls[0].title, 'https://c.com/p');
  assert.equal(byDomain['d.com'].urls[0].url, 'd.com');
  assert.equal(byDomain['d.com'].urls[0].title, 'd.com');
});

test('sourceTable skips blank domains and handles empty/nullish input', () => {
  eqJson(L.sourceTable([{ sources: [{ domain: '' }, null] }]), []);
  eqJson(L.sourceTable(null), []);
  eqJson(L.sourceTable([]), []);
});

// ── domainCitationSeries ─────────────────────────────────────────────────────
test('domainCitationSeries counts citations per domain per date, ascending dates', () => {
  const history = [
    { date: '2026-07-11', sources: [{ domain: 'a.com' }] },
    { date: '2026-07-09', sources: [{ domain: 'a.com' }, { domain: 'b.com' }, { domain: 'a.com' }] },
  ];
  const r = L.domainCitationSeries(history, ['a.com', 'b.com']);
  eqJson(r.dates, ['2026-07-09', '2026-07-11']);
  const byName = Object.fromEntries(r.series.map(s => [s.name, s]));
  eqJson(byName['a.com'].data, [2, 1]);
  eqJson(byName['b.com'].data, [1, 0]);
});

test('domainCitationSeries flags the brand\'s own domain isBrand, case-insensitively', () => {
  const history = [{ date: '2026-07-10', sources: [{ domain: 'flexzo.ai' }] }];
  const r = L.domainCitationSeries(history, ['Flexzo.ai', 'other.com'], 'flexzo.ai');
  const byName = Object.fromEntries(r.series.map(s => [s.name, s]));
  assert.equal(byName['Flexzo.ai'].isBrand, true);
  assert.equal(byName['other.com'].isBrand, false);
});

test('domainCitationSeries dedupes domains case-insensitively and handles empty/nullish input', () => {
  const r = L.domainCitationSeries([], ['a.com', 'A.com', '', null]);
  assert.equal(r.series.length, 1);
  eqJson(L.domainCitationSeries(null, []), { dates: [], series: [] });
  eqJson(L.domainCitationSeries([], null), { dates: [], series: [] });
});

// ── entityMentionSeries ──────────────────────────────────────────────────────
test('entityMentionSeries counts raw mention occurrences per entity per date', () => {
  const history = [
    { date: '2026-07-10', brandMentions: [{ entityName: 'Flexzo' }, { entityName: 'Nubank' }] },
    { date: '2026-07-10', brandMentions: [{ entityName: 'Flexzo' }] },
    { date: '2026-07-11', brandMentions: [{ entityName: 'Nubank' }] },
  ];
  const r = L.entityMentionSeries(history, 'Flexzo', ['Nubank']);
  eqJson(r.dates, ['2026-07-10', '2026-07-11']);
  const byName = Object.fromEntries(r.series.map(s => [s.name, s]));
  assert.equal(byName.Flexzo.isBrand, true);
  eqJson(byName.Flexzo.data, [2, 0]);
  eqJson(byName.Nubank.data, [1, 1]);
});

test('entityMentionSeries dedupes a name matching the brand and handles empty/nullish input', () => {
  const r = L.entityMentionSeries([{ date: '2026-07-10', brandMentions: [] }], 'Flexzo', ['flexzo', 'Nubank']);
  assert.equal(r.series.length, 2);
  eqJson(L.entityMentionSeries([], 'Flexzo', []), { dates: [], series: [{ name: 'Flexzo', isBrand: true, data: [] }] });
  eqJson(L.entityMentionSeries(null, '', []), { dates: [], series: [] });
});

// ── heatmapColor ─────────────────────────────────────────────────────────────
test('heatmapColor returns red at 0, yellow at 50, green at 100 (matches competitors.js heatBg)', () => {
  assert.equal(L.heatmapColor(0), 'rgba(220, 38, 38, 0.88)');
  assert.equal(L.heatmapColor(50), 'rgba(234, 179, 8, 0.88)');
  assert.equal(L.heatmapColor(100), 'rgba(22, 163, 74, 0.88)');
});

test('heatmapColor interpolates between endpoints and clamps out-of-range/non-numeric input', () => {
  assert.equal(L.heatmapColor(25), 'rgba(227, 109, 23, 0.88)');
  assert.equal(L.heatmapColor(-10), L.heatmapColor(0));
  assert.equal(L.heatmapColor(150), L.heatmapColor(100));
  assert.equal(L.heatmapColor(NaN), L.heatmapColor(0));
  assert.equal(L.heatmapColor(null), L.heatmapColor(0));
});

// ── csvEscape / historyToCsv ─────────────────────────────────────────────────
test('csvEscape only quotes values containing a comma, quote, or newline', () => {
  assert.equal(L.csvEscape('plain'), 'plain');
  assert.equal(L.csvEscape('has,comma'), '"has,comma"');
  assert.equal(L.csvEscape('has "quote"'), '"has ""quote"""');
  assert.equal(L.csvEscape('line1\nline2'), '"line1\nline2"');
  assert.equal(L.csvEscape(null), '');
  assert.equal(L.csvEscape(undefined), '');
  assert.equal(L.csvEscape(42), '42');
});

test('historyToCsv emits one row per run with the expected columns', () => {
  const history = [
    {
      date: '2026-07-15', aiModel: 'sonar', score: 67.4, sentiment: 'positive', rank: 2,
      brandMentions: [{ entityName: 'Flexzo' }, { entityName: 'Nubank' }],
      sources: [{ domain: 'a.com' }, { domain: 'a.com' }, { domain: 'b.com' }],
    },
  ];
  const csv = L.historyToCsv(history);
  const lines = csv.split('\r\n');
  eqJson(lines[0], 'Date,Model,Visibility Score,Sentiment,Avg Position,Mentioned Brands,Citation Count,Cited Domains');
  eqJson(lines[1], '2026-07-15,sonar,67,positive,2,Flexzo; Nubank,2,a.com; b.com');
});

test('historyToCsv leaves missing fields blank and quotes a prompt-text-like field with a comma', () => {
  const csv = L.historyToCsv([{ date: '2026-07-15', aiModel: 'sonar, custom' }]);
  const lines = csv.split('\r\n');
  eqJson(lines[1], '2026-07-15,"sonar, custom",,,,,0,');
});

test('historyToCsv handles empty and nullish history (header row only)', () => {
  eqJson(L.historyToCsv([]).split('\r\n').length, 1);
  eqJson(L.historyToCsv(null).split('\r\n').length, 1);
});

// ── entityVisibilitySeries ──────────────────────────────────────────────────
test('entityVisibilitySeries uses run.score for the brand and the rank formula for others', () => {
  const history = [
    {
      date: '2026-07-10',
      score: 67, // brand's own pre-computed score for this run
      brandMentions: [
        { entityName: 'Flexzo', rank: 2 },
        { entityName: 'Nubank', rank: 1 },
        { entityName: 'Kueski', rank: 3 },
      ],
    },
  ];
  const r = L.entityVisibilitySeries(history, 'Flexzo', ['Nubank', 'Kueski']);
  eqJson(r.dates, ['2026-07-10']);
  const byName = Object.fromEntries(r.series.map(s => [s.name, s]));
  // brand: straight from run.score, not recomputed from rank
  assert.equal(byName.Flexzo.isBrand, true);
  eqJson(byName.Flexzo.data, [67]);
  // Nubank ranked #1 of 3 mentioned -> ((3-1+1)/3)*100 = 100
  eqJson(byName.Nubank.data, [100]);
  // Kueski ranked #3 of 3 mentioned -> ((3-3+1)/3)*100 = 33.3
  eqJson(byName.Kueski.data, [33.3]);
});

test('entityVisibilitySeries scores an unmentioned competitor as 0', () => {
  const history = [{ date: '2026-07-10', score: 50, brandMentions: [{ entityName: 'Flexzo', rank: 1 }] }];
  const r = L.entityVisibilitySeries(history, 'Flexzo', ['Nubank']);
  const byName = Object.fromEntries(r.series.map(s => [s.name, s]));
  eqJson(byName.Nubank.data, [0]);
});

test('entityVisibilitySeries averages multiple runs on the same date and sorts dates ascending', () => {
  const history = [
    { date: '2026-07-11', score: 80, brandMentions: [{ entityName: 'Flexzo', rank: 1 }] },
    { date: '2026-07-09', score: 20, brandMentions: [{ entityName: 'Flexzo', rank: 1 }] },
    { date: '2026-07-09', score: 40, brandMentions: [{ entityName: 'Flexzo', rank: 1 }] },
  ];
  const r = L.entityVisibilitySeries(history, 'Flexzo', []);
  eqJson(r.dates, ['2026-07-09', '2026-07-11']);
  eqJson(r.series[0].data, [30, 80]); // (20+40)/2 = 30
});

test('entityVisibilitySeries dedupes a name that matches the brand and handles empty/nullish input', () => {
  const history = [{ date: '2026-07-10', score: 60, brandMentions: [] }];
  const r = L.entityVisibilitySeries(history, 'Flexzo', ['flexzo', 'Nubank']);
  assert.equal(r.series.length, 2); // 'flexzo' collapses into the brand entry, not a duplicate
  assert.equal(r.series[0].name, 'Flexzo');
  assert.equal(r.series[1].name, 'Nubank');

  eqJson(L.entityVisibilitySeries([], 'Flexzo', []), { dates: [], series: [{ name: 'Flexzo', isBrand: true, data: [] }] });
  eqJson(L.entityVisibilitySeries(null, '', []), { dates: [], series: [] });
});

// ── brandMentionCount ────────────────────────────────────────────────────────
test('brandMentionCount counts runs with score > 0, ignoring 0/null/missing scores', () => {
  const history = [{ score: 100 }, { score: 0 }, { score: null }, { score: 50 }, {}];
  assert.equal(L.brandMentionCount(history), 2);
});

test('brandMentionCount handles empty and nullish history', () => {
  assert.equal(L.brandMentionCount([]), 0);
  assert.equal(L.brandMentionCount(null), 0);
});

// ── filterHistoryByMentionState ─────────────────────────────────────────────
test('filterHistoryByMentionState "mentioned" keeps only runs with score > 0', () => {
  const history = [{ id: 'a', score: 100 }, { id: 'b', score: 0 }, { id: 'c', score: null }, { id: 'd', score: 50 }, { id: 'e' }];
  eqJson(L.filterHistoryByMentionState(history, 'mentioned').map(r => r.id), ['a', 'd']);
});

test('filterHistoryByMentionState "not-mentioned" keeps only runs with score 0/null/missing', () => {
  const history = [{ id: 'a', score: 100 }, { id: 'b', score: 0 }, { id: 'c', score: null }, { id: 'd', score: 50 }, { id: 'e' }];
  eqJson(L.filterHistoryByMentionState(history, 'not-mentioned').map(r => r.id), ['b', 'c', 'e']);
});

test('filterHistoryByMentionState "all" (or an unrecognized mode) returns the list unchanged', () => {
  const history = [{ id: 'a', score: 100 }, { id: 'b', score: 0 }];
  eqJson(L.filterHistoryByMentionState(history, 'all'), history);
  eqJson(L.filterHistoryByMentionState(history, 'bogus'), history);
  eqJson(L.filterHistoryByMentionState(history), history);
});

test('filterHistoryByMentionState handles empty and nullish history', () => {
  eqJson(L.filterHistoryByMentionState([], 'mentioned'), []);
  eqJson(L.filterHistoryByMentionState(null, 'mentioned'), []);
});

// ── classifyContentType / topContentType ────────────────────────────────────
test('classifyContentType detects blog, listicle, comparison, case study, news, review, careers', () => {
  assert.equal(L.classifyContentType({ url: 'https://x.com/blog/post', title: 'A post' }), 'Blog');
  assert.equal(L.classifyContentType({ url: 'https://x.com/top-10-tools', title: 'Top 10 Tools for X' }), 'Listicle');
  assert.equal(L.classifyContentType({ url: 'https://x.com/y', title: 'Acme vs Beta: which is better?' }), 'Comparison');
  assert.equal(L.classifyContentType({ url: 'https://x.com/use-cases/acme', title: 'Acme case study' }), 'Case Study');
  assert.equal(L.classifyContentType({ url: 'https://x.com/y', title: 'Acme raises $10m in funding' }), 'News');
  assert.equal(L.classifyContentType({ url: 'https://x.com/y', title: 'Acme review: is it worth it?' }), 'Review');
  assert.equal(L.classifyContentType({ url: 'https://x.com/careers', title: 'Careers at Acme' }), 'Careers Page');
});

test('classifyContentType falls back to Company Page and handles nullish input', () => {
  assert.equal(L.classifyContentType({ url: 'https://x.com/', title: 'Acme Home' }), 'Company Page');
  assert.equal(L.classifyContentType({}), 'Company Page');
  assert.equal(L.classifyContentType(null), 'Company Page');
});

test('classifyContentType checks Listicle before Blog when a URL matches both', () => {
  assert.equal(L.classifyContentType({ url: 'https://x.com/blog/top-10-alternatives', title: 'Top 10 Alternatives' }), 'Listicle');
});

test('topContentType returns the most-cited type across all runs, tie-broken alphabetically', () => {
  const history = [
    { sources: [{ url: 'a.com/blog/x', title: 'x' }, { url: 'a.com/', title: 'home' }] },
    { sources: [{ url: 'a.com/blog/y', title: 'y' }] },
  ];
  assert.equal(L.topContentType(history), 'Blog');
});

test('topContentType returns null for empty/missing sources', () => {
  assert.equal(L.topContentType([{ sources: [] }, { sources: null }]), null);
  assert.equal(L.topContentType([]), null);
  assert.equal(L.topContentType(null), null);
});

// ── previewText ──────────────────────────────────────────────────────────────
test('previewText prefers fullResponse and truncates at 120 chars', () => {
  const long = 'x'.repeat(200);
  const p = L.previewText({ fullResponse: long, responseSnippet: 'snip' });
  assert.equal(p.text.length, 120);
  assert.equal(p.truncated, true);
});

test('previewText falls back to snippet then mentionSummary', () => {
  const p1 = L.previewText({ responseSnippet: 'the snippet', mentionSummary: 'summary' });
  assert.equal(p1.text, 'the snippet');
  assert.equal(p1.truncated, false);
  const p2 = L.previewText({ mentionSummary: 'summary only' });
  assert.equal(p2.text, 'summary only');
});

test('previewText is not truncated at exactly 120 chars', () => {
  const p = L.previewText({ fullResponse: 'y'.repeat(120) });
  assert.equal(p.text.length, 120);
  assert.equal(p.truncated, false);
});

test('previewText handles empty and nullish runs', () => {
  eqJson(L.previewText({}), { text: '', truncated: false });
  eqJson(L.previewText(null), { text: '', truncated: false });
});

// ── letterAvatarColor ────────────────────────────────────────────────────────
test('letterAvatarColor is deterministic and stays in the v4 palette', () => {
  const palette = ['#b352b3', '#10b981', '#2563eb', '#8b5cf6', '#64748b', '#06b6d4', '#f59e0b', '#f472b6', '#38bdf8', '#94a3b8'];
  const c1 = L.letterAvatarColor('Kueski');
  const c2 = L.letterAvatarColor('Kueski');
  assert.equal(c1, c2, 'same name always hashes to the same color');
  assert.ok(palette.includes(c1), 'color must come from the palette: ' + c1);
  assert.ok(palette.includes(L.letterAvatarColor('Nubank')));
});

test('letterAvatarColor handles empty and nullish names', () => {
  const palette = ['#b352b3', '#10b981', '#2563eb', '#8b5cf6', '#64748b', '#06b6d4', '#f59e0b', '#f472b6', '#38bdf8', '#94a3b8'];
  assert.ok(palette.includes(L.letterAvatarColor('')));
  assert.ok(palette.includes(L.letterAvatarColor(null)));
  assert.ok(palette.includes(L.letterAvatarColor(undefined)));
});

// ── entityDomainMap / resolveEntityDomain ────────────────────────────────────
test('entityDomainMap builds the map from the brand plus competitors', () => {
  const map = L.entityDomainMap(
    { name: 'Autodoc', url: 'https://www.autodoc.co.uk' },
    [
      { name: 'Euro Car Parts', url: 'https://www.eurocarparts.com' },
      { name: 'GSF Car Parts', url: 'https://www.gsfcarparts.com' },
    ]
  );
  assert.equal(map['autodoc'], 'https://www.autodoc.co.uk');
  assert.equal(map['euro car parts'], 'https://www.eurocarparts.com');
  assert.equal(map['gsf car parts'], 'https://www.gsfcarparts.com');
  assert.equal(Object.keys(map).length, 3);
});

test('entityDomainMap never constructs domains: nameless or url-less entries are skipped', () => {
  const map = L.entityDomainMap(
    { name: 'Autodoc' }, // no url: must NOT invent autodoc.com
    [
      { name: 'Carwow' },          // no url
      { name: '', url: 'https://x.com' }, // no name
      { url: 'https://y.com' },    // no name
      null,
    ]
  );
  eqJson(map, {});
});

test('entityDomainMap keeps the first url when names collide and trims keys', () => {
  const map = L.entityDomainMap(
    { name: '  Autodoc  ', url: 'https://www.autodoc.co.uk' },
    [{ name: 'autodoc', url: 'https://other.example' }]
  );
  assert.equal(Object.keys(map).length, 1);
  assert.equal(map['autodoc'], 'https://www.autodoc.co.uk');
});

test('entityDomainMap handles nullish brand and competitors', () => {
  eqJson(L.entityDomainMap(null, null), {});
  eqJson(L.entityDomainMap(undefined, []), {});
});

test('resolveEntityDomain is a case-insensitive, trimmed, exact lookup', () => {
  const map = L.entityDomainMap(
    { name: 'Autodoc', url: 'https://www.autodoc.co.uk' },
    [{ name: 'Euro Car Parts', url: 'https://www.eurocarparts.com' }]
  );
  assert.equal(L.resolveEntityDomain('AUTODOC', map), 'https://www.autodoc.co.uk');
  assert.equal(L.resolveEntityDomain('  autodoc ', map), 'https://www.autodoc.co.uk');
  assert.equal(L.resolveEntityDomain('euro car parts', map), 'https://www.eurocarparts.com');
});

test('resolveEntityDomain returns null for unknown names (no fuzzy matching, no construction)', () => {
  const map = L.entityDomainMap(
    { name: 'Autodoc', url: 'https://www.autodoc.co.uk' },
    []
  );
  assert.equal(L.resolveEntityDomain('Carwow', map), null);
  assert.equal(L.resolveEntityDomain('Auto', map), null, 'prefixes must not match');
  assert.equal(L.resolveEntityDomain('Autodoc UK', map), null, 'supersets must not match');
});

test('resolveEntityDomain handles nullish and blank inputs', () => {
  const map = { autodoc: 'https://www.autodoc.co.uk' };
  assert.equal(L.resolveEntityDomain(null, map), null);
  assert.equal(L.resolveEntityDomain('', map), null);
  assert.equal(L.resolveEntityDomain('   ', map), null);
  assert.equal(L.resolveEntityDomain('Autodoc', null), null);
});

test('collectCitedDomains unions history sources and sourceSummary, deduped + lowercased', () => {
  const detail = {
    history: [
      { sources: [{ domain: 'Kwik-Fit.com' }, { domain: 'reddit.com' }] },
      { sources: [{ domain: 'kwik-fit.com' }, { domain: 'carwow.co.uk' }] },
      null,
      { sources: null },
    ],
    sourceSummary: [{ domain: 'halfords.com' }, { domain: 'reddit.com' }, null],
  };
  eqJson(L.collectCitedDomains(detail), ['kwik-fit.com', 'reddit.com', 'carwow.co.uk', 'halfords.com']);
});

test('collectCitedDomains handles empty/missing payloads', () => {
  eqJson(L.collectCitedDomains(null), []);
  eqJson(L.collectCitedDomains({}), []);
  eqJson(L.collectCitedDomains({ history: [], sourceSummary: [] }), []);
});

// ── summary ──────────────────────────────────────────────────────────────────
console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
