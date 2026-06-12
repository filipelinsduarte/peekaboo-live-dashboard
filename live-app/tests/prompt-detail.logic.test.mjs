/*
 * prompt-detail.logic.test.mjs — unit tests for the pure logic in
 * views/prompt-detail.js (escapeHtml, normalizeSpaces, highlightMentions,
 * formatAnswer, responseTextFor fallback chain).
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

// ── summary ──────────────────────────────────────────────────────────────────
console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
