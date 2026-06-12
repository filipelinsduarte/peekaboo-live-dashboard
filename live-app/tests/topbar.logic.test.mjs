/*
 * topbar.logic.test.mjs — unit tests for the pure brand-switcher logic in
 * assets/app.js (status derivation, dropdown/manage time formats, search +
 * status + activity filters, sort modes, active count).
 *
 * Run with:  node live-app/tests/topbar.logic.test.mjs
 * (zero dependencies; exits non-zero on failure)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'assets', 'app.js'), 'utf8');

// app.js only touches the DOM inside functions; at the top level it needs a
// window stub with addEventListener. PBTopbarLogic is exposed before any DOM
// work happens, so the file evaluates cleanly in a bare sandbox.
const sandbox = {
  window: { addEventListener() {} },
  document: { createElement() { return {}; }, addEventListener() {} },
  location: { hash: '' },
  console,
  setTimeout() {},
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const L = sandbox.window.PBTopbarLogic;
assert.ok(L, 'PBTopbarLogic should be exposed on window');

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

const NOW = Date.parse('2026-06-12T12:00:00Z');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

// ---- brandStatus -----------------------------------------------------------
test('brandStatus: local override wins over everything', () => {
  const b = { lastAnalysisAt: iso(1 * DAY) };
  assert.equal(L.brandStatus(b, { analysisEnabled: false }, true, NOW), 'Active');
  assert.equal(L.brandStatus(b, { analysisEnabled: true }, false, NOW), 'Paused');
});
test('brandStatus: detail analysisEnabled is the source of truth', () => {
  const old = { lastAnalysisAt: iso(200 * DAY) };
  assert.equal(L.brandStatus(old, { analysisEnabled: true }, undefined, NOW), 'Active');
  const fresh = { lastAnalysisAt: iso(1 * HOUR) };
  assert.equal(L.brandStatus(fresh, { analysisEnabled: false }, undefined, NOW), 'Paused');
});
test('brandStatus: recency heuristic without detail (14d window)', () => {
  assert.equal(L.brandStatus({ lastAnalysisAt: iso(13 * DAY) }, null, undefined, NOW), 'Active');
  assert.equal(L.brandStatus({ lastAnalysisAt: iso(15 * DAY) }, null, undefined, NOW), 'Paused');
  assert.equal(L.brandStatus({ lastAnalysisAt: null }, null, undefined, NOW), 'Paused');
  assert.equal(L.brandStatus({ lastAnalysisAt: 'not-a-date' }, null, undefined, NOW), 'Paused');
});

// ---- menuTime (dropdown rows: 14m ago / 3h ago / 2d ago / Nov 11) ----------
test('menuTime buckets', () => {
  assert.equal(L.menuTime(iso(14 * 60 * 1000), NOW), '14m ago');
  assert.equal(L.menuTime(iso(30 * 1000), NOW), '1m ago');       // floor, min 1
  assert.equal(L.menuTime(iso(3 * HOUR + 20 * 60 * 1000), NOW), '3h ago');
  assert.equal(L.menuTime(iso(2 * DAY + 16 * HOUR), NOW), '2d ago'); // floor like the product
  assert.equal(L.menuTime(null, NOW), 'Never');
  assert.equal(L.menuTime('garbage', NOW), 'Never');
});
test('menuTime: 7d+ falls back to short date (Mon D)', () => {
  const out = L.menuTime('2025-11-11T12:00:00Z', NOW);
  assert.match(out, /^Nov 1[01]$/); // tz-safe: Nov 10 or Nov 11
});

// ---- manageTime (drawer Last Run column, date-fns style) --------------------
test('manageTime buckets', () => {
  assert.equal(L.manageTime(iso(10 * 1000), NOW), 'less than a minute ago');
  assert.equal(L.manageTime(iso(5 * 60 * 1000), NOW), '5 minutes ago');
  assert.equal(L.manageTime(iso(70 * 60 * 1000), NOW), 'about 1 hour ago');
  assert.equal(L.manageTime(iso(5 * HOUR), NOW), 'about 5 hours ago');
  assert.equal(L.manageTime(iso(3 * DAY), NOW), '3 days ago');
  assert.equal(L.manageTime(iso(33 * DAY), NOW), 'about 1 month ago');
  assert.equal(L.manageTime(iso(95 * DAY), NOW), '3 months ago');
  assert.equal(L.manageTime(null, NOW), 'Never');
});

// ---- filterBrands -----------------------------------------------------------
const BRANDS = [
  { id: 'a', name: 'Flexzo', url: 'https://flexzo.ai', industry: 'Healthcare Staffing', lastAnalysisAt: iso(2 * HOUR) },
  { id: 'b', name: 'Kueski', url: 'https://kueski.com', industry: 'Fintech', lastAnalysisAt: iso(10 * DAY) },
  { id: 'c', name: 'MYER', url: 'https://myer.com.au', industry: 'Retail', lastAnalysisAt: iso(60 * DAY) },
  { id: 'd', name: 'Newbie', url: 'https://newbie.io', industry: 'SaaS', lastAnalysisAt: null },
];
const statusOf = (b) => L.brandStatus(b, null, undefined, NOW);

test('filterBrands: search matches name, url and industry', () => {
  assert.deepEqual(L.filterBrands(BRANDS, 'flex', 'all', 'all', statusOf, NOW).map(b => b.id), ['a']);
  assert.deepEqual(L.filterBrands(BRANDS, 'kueski.com', 'all', 'all', statusOf, NOW).map(b => b.id), ['b']);
  assert.deepEqual(L.filterBrands(BRANDS, 'retail', 'all', 'all', statusOf, NOW).map(b => b.id), ['c']);
  assert.equal(L.filterBrands(BRANDS, 'zzz', 'all', 'all', statusOf, NOW).length, 0);
});
test('filterBrands: status filter (active / idle map to Active / Paused)', () => {
  assert.deepEqual(L.filterBrands(BRANDS, '', 'active', 'all', statusOf, NOW).map(b => b.id), ['a', 'b']);
  assert.deepEqual(L.filterBrands(BRANDS, '', 'idle', 'all', statusOf, NOW).map(b => b.id), ['c', 'd']);
  assert.equal(L.filterBrands(BRANDS, '', 'processing', 'all', statusOf, NOW).length, 0);
  assert.equal(L.filterBrands(BRANDS, '', 'failed', 'all', statusOf, NOW).length, 0);
});
test('filterBrands: activity filter (recent 24h / old 7d+ / never)', () => {
  assert.deepEqual(L.filterBrands(BRANDS, '', 'all', 'recent', statusOf, NOW).map(b => b.id), ['a']);
  assert.deepEqual(L.filterBrands(BRANDS, '', 'all', 'old', statusOf, NOW).map(b => b.id), ['b', 'c']);
  assert.deepEqual(L.filterBrands(BRANDS, '', 'all', 'never', statusOf, NOW).map(b => b.id), ['d']);
});

// ---- sortBrands --------------------------------------------------------------
test('sortBrands: az / za alphabetical', () => {
  assert.deepEqual(L.sortBrands(BRANDS, 'az').map(b => b.name), ['Flexzo', 'Kueski', 'MYER', 'Newbie']);
  assert.deepEqual(L.sortBrands(BRANDS, 'za').map(b => b.name), ['Newbie', 'MYER', 'Kueski', 'Flexzo']);
});
test('sortBrands: recent puts analyzed-newest first, never-run last', () => {
  const shuffled = [BRANDS[3], BRANDS[2], BRANDS[0], BRANDS[1]];
  assert.deepEqual(L.sortBrands(shuffled, 'recent').map(b => b.id), ['a', 'b', 'c', 'd']);
});
test('sortBrands: does not mutate the input array', () => {
  const input = BRANDS.slice();
  L.sortBrands(input, 'za');
  assert.deepEqual(input.map(b => b.id), BRANDS.map(b => b.id));
});

// ---- countActive --------------------------------------------------------------
test('countActive counts via the provided status function', () => {
  assert.equal(L.countActive(BRANDS, statusOf), 2);
  assert.equal(L.countActive([], statusOf), 0);
});

console.log('\n' + passed + ' tests passed' + (process.exitCode ? ' (with failures)' : ''));
