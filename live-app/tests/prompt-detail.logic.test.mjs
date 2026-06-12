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
