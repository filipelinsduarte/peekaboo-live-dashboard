/*
 * prompts.logic.test.mjs — unit tests for the pure aggregation math in
 * views/prompts.js (visibility tiers, majority sentiment, average position,
 * top-3 mentioned brands / cited domains, sort comparator).
 *
 * Run with:  node live-app/views/prompts.logic.test.mjs
 * (zero dependencies; exits non-zero on failure)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'prompts.js'), 'utf8');

// Load the view file with a bare window stub: it should expose
// window.PBPromptsLogic and then return early (no PB framework present).
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const L = sandbox.window.PBPromptsLogic;
assert.ok(L, 'PBPromptsLogic should be exposed even without PB');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('ok   ' + name);
  } catch (err) {
    console.error('FAIL ' + name);
    console.error(err && err.message);
    process.exitCode = 1;
  }
}

// ---- visClass: product thresholds >=60 high, >=35 mid, else low ----
test('visClass thresholds', () => {
  assert.equal(L.visClass(72), 'high');
  assert.equal(L.visClass(60), 'high');
  assert.equal(L.visClass(59.9), 'mid');
  assert.equal(L.visClass(35), 'mid');
  assert.equal(L.visClass(34.9), 'low');
  assert.equal(L.visClass(0), 'low');
  assert.equal(L.visClass(null), 'low');
});

// ---- guessDomain: product's Z() ----
test('guessDomain strips non-alphanumerics and appends .com', () => {
  assert.equal(L.guessDomain('Allocate Software'), 'allocatesoftware.com');
  assert.equal(L.guessDomain('NHS & UK Co.'), 'nhsukco.com');
  assert.equal(L.guessDomain(''), '.com');
});

// ---- sentimentFromCounts: majority wins, positive on tie, null when empty ----
test('sentimentFromCounts', () => {
  assert.equal(L.sentimentFromCounts({ positive: 3, neutral: 1, negative: 0 }), 'positive');
  assert.equal(L.sentimentFromCounts({ positive: 0, neutral: 1, negative: 4 }), 'negative');
  assert.equal(L.sentimentFromCounts({ positive: 2, neutral: 2, negative: 0 }), 'positive'); // stable tie
  assert.equal(L.sentimentFromCounts({ positive: 0, neutral: 0, negative: 0 }), null);
  assert.equal(L.sentimentFromCounts(null), null);
});

// ---- summarizeDetail: full aggregation over a realistic detail payload ----
test('summarizeDetail aggregates history + sourceSummary', () => {
  const detail = {
    history: [
      { rank: 1, sentiment: 'positive', brandMentions: [{ entityName: 'Edelman' }, { entityName: 'Flexzo' }] },
      { rank: 2, sentiment: 'positive', brandMentions: [{ entityName: 'Edelman' }] },
      { rank: null, sentiment: 'neutral', brandMentions: [{ entityName: 'Sherlock' }, { entityName: 'Edelman' }] },
      { rank: 3, sentiment: null, brandMentions: [{ entityName: 'Weber' }] },
    ],
    sourceSummary: [
      { domain: 'a.com', mentions: 5 },
      { domain: 'b.com', mentions: 9 },
      { domain: 'c.com', mentions: 1 },
      { domain: 'd.com', mentions: 7 },
    ],
  };
  const s = L.summarizeDetail(detail);
  assert.equal(s.position, 2);                       // (1+2+3)/3, null rank skipped
  assert.equal(s.sentiment, 'positive');             // 2 pos vs 1 neu
  assert.deepEqual(s.topBrands[0], 'Edelman');       // 3 mentions, top of stack
  assert.equal(s.topBrands.length, 3);               // top 3 of 4
  assert.equal(s.totalBrands, 4);
  assert.deepEqual(s.topDomains, ['b.com', 'd.com', 'a.com']); // by mentions desc
  assert.equal(s.totalDomains, 4);
});

test('summarizeDetail handles empty / missing payloads', () => {
  const empty = L.summarizeDetail(null);
  assert.equal(empty.position, null);
  assert.equal(empty.sentiment, null);
  assert.equal(empty.topBrands.length, 0); // (length check: vm-context arrays fail strict deepEqual)
  assert.equal(empty.totalDomains, 0);

  const noRuns = L.summarizeDetail({ history: [], sourceSummary: [] });
  assert.equal(noRuns.position, null);
  assert.equal(noRuns.sentiment, null);
});

// ---- compareRows: default sort = visibility descending ----
test('compareRows visibility descending by default', () => {
  const mk = (vis) => ({ text: '', visibility: vis, topic: '', intent: '', enrich: {} });
  const rows = [mk(10), mk(72), mk(35)];
  rows.sort((a, b) => L.compareRows(a, b, 'visibility', 1));
  assert.deepEqual(rows.map((r) => r.visibility), [72, 35, 10]);
  rows.sort((a, b) => L.compareRows(a, b, 'visibility', -1));
  assert.deepEqual(rows.map((r) => r.visibility), [10, 35, 72]);
});

test('compareRows position ascending (lower rank is better), nulls last', () => {
  const mk = (pos) => ({ text: '', visibility: 0, topic: '', intent: '', enrich: { position: pos } });
  const rows = [mk(null), mk(2.7), mk(1.0)];
  rows.sort((a, b) => L.compareRows(a, b, 'position', 1));
  assert.deepEqual(rows.map((r) => r.enrich.position), [1.0, 2.7, null]);
});

// ---- availableSlots: "Available slots: N" in the AI Suggested dialog ----
test('availableSlots = limit - used, floored at 0', () => {
  assert.equal(L.availableSlots(40, 100), 60);  // capture state: 40/100 -> 60
  assert.equal(L.availableSlots(30, 100), 70);  // live state: 30/100 -> 70
  assert.equal(L.availableSlots(0, 100), 100);
  assert.equal(L.availableSlots(120, 100), 0);  // over limit never goes negative
  assert.equal(L.availableSlots(null, 100), 100);
  assert.equal(L.availableSlots('12', '100'), 88); // string inputs coerced
});

// ---- clampPromptCount: number-of-prompts input clamped to [1, max] ----
test('clampPromptCount clamps and rounds into [1, max]', () => {
  assert.equal(L.clampPromptCount(10, 50), 10);
  assert.equal(L.clampPromptCount(0, 50), 1);
  assert.equal(L.clampPromptCount(-5, 50), 1);
  assert.equal(L.clampPromptCount(99, 50), 50);
  assert.equal(L.clampPromptCount(7.6, 50), 8);   // rounds, not truncates
  assert.equal(L.clampPromptCount('abc', 50), 1); // non-numeric -> minimum
  assert.equal(L.clampPromptCount(10, 0), 1);     // degenerate max -> 1
});

// ---- toggleIntent: AI Suggested intent-card selection ----
test('toggleIntent adds/removes and returns the new count', () => {
  const sel = { Informational: true, Commercial: true }; // dialog default (2 selected)
  assert.equal(L.toggleIntent(sel, 'Branded'), 3);
  assert.equal(sel.Branded, true);
  assert.equal(L.toggleIntent(sel, 'Branded'), 2);
  assert.equal(sel.Branded, undefined);
  assert.equal(L.toggleIntent(sel, 'Informational'), 1);
  assert.equal(L.toggleIntent(sel, 'Commercial'), 0); // can deselect all
});

console.log(passed + ' tests passed' + (process.exitCode ? ' (with failures)' : ''));
