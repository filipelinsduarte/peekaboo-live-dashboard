/*
 * Unit tests for the pure logic in views/search-console.js.
 * Run with:  node --test live-app/tests/search-console.test.mjs
 * (zero dependencies, uses the built-in node test runner)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'views', 'search-console.js'), 'utf8');

// minimal browser stubs so the IIFE can run in node
const PB = {
  el() { return { appendChild() {}, setAttribute() {}, addEventListener() {}, style: {} }; },
  registerView() {},
  api: {},
  toast() {},
};
const windowStub = { PB };
const documentStub = {
  getElementById() { return null; },
  createElement() { return { style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }; },
  addEventListener() {},
  head: { appendChild() {} },
};

const fn = new Function('window', 'document', 'PB', src + '\nreturn window.PB._searchConsoleInternals;');
const internals = fn(windowStub, documentStub, PB);

test('internals are exposed', () => {
  assert.ok(internals, 'PB._searchConsoleInternals must be set');
});

// ---- classifyIntent ----------------------------------------------------------
test('classifyIntent: brand queries are Navigational', () => {
  assert.equal(internals.classifyIntent('peekaboo ai', 'AI Peekaboo'), 'Navigational');
  assert.equal(internals.classifyIntent('aipeekaboo login', 'AI Peekaboo'), 'Navigational');
  assert.equal(internals.classifyIntent('ai peekaboo pricing', 'AI Peekaboo'), 'Navigational');
});

test('classifyIntent: transactional keywords win over generic', () => {
  assert.equal(internals.classifyIntent('buy seo monitoring subscription', 'Acme'), 'Transactional');
  assert.equal(internals.classifyIntent('chatgpt rank tracker pricing', 'Acme'), 'Transactional');
});

test('classifyIntent: commercial comparison queries', () => {
  assert.equal(internals.classifyIntent('otterly ai alternatives', 'Acme'), 'Commercial');
  assert.equal(internals.classifyIntent('best ai visibility tools', 'Acme'), 'Commercial');
  assert.equal(internals.classifyIntent('semrush vs ahrefs', 'Acme'), 'Commercial');
});

test('classifyIntent: local and informational', () => {
  assert.equal(internals.classifyIntent('seo agency near me', 'Acme'), 'Local');
  assert.equal(internals.classifyIntent('what is generative engine optimization', 'Acme'), 'Informational');
  assert.equal(internals.classifyIntent('how to rank in chatgpt', 'Acme'), 'Informational');
});

test('classifyIntent: empty and unknown', () => {
  assert.equal(internals.classifyIntent('', 'Acme'), 'Unclassified');
  assert.equal(internals.classifyIntent('zebra cadence umbrella', 'Acme'), 'Unclassified');
});

// ---- computeTotals -------------------------------------------------------------
test('computeTotals sums clicks/impressions and derives ctr + weighted position', () => {
  const series = [
    { date: '2026-06-01', clicks: 10, impressions: 100, position: 5 },
    { date: '2026-06-02', clicks: 30, impressions: 300, position: 10 },
  ];
  const t = internals.computeTotals(series);
  assert.equal(t.clicks, 40);
  assert.equal(t.impressions, 400);
  assert.ok(Math.abs(t.ctr - 10) < 1e-9); // 40/400 = 10%
  // weighted position: (5*100 + 10*300) / 400 = 8.75
  assert.ok(Math.abs(t.position - 8.75) < 1e-9);
});

test('computeTotals handles empty series without dividing by zero', () => {
  const t = internals.computeTotals([]);
  assert.equal(t.clicks, 0);
  assert.equal(t.impressions, 0);
  assert.equal(t.ctr, 0);
  assert.equal(t.position, 0);
});

// ---- aggregateWeekly ------------------------------------------------------------
test('aggregateWeekly buckets 14 days into 2 weeks and preserves totals', () => {
  const series = [];
  for (let i = 0; i < 14; i++) {
    series.push({ date: '2026-06-' + String(i + 1).padStart(2, '0'), clicks: 2, impressions: 10, position: 4 });
  }
  const weekly = internals.aggregateWeekly(series);
  assert.equal(weekly.length, 2);
  assert.equal(weekly[0].clicks, 14);
  assert.equal(weekly[0].impressions, 70);
  assert.ok(Math.abs(weekly[0].ctr - 20) < 1e-9); // 14/70 = 20%
  assert.ok(Math.abs(weekly[0].position - 4) < 1e-9);
  const totalClicks = weekly.reduce((a, w) => a + w.clicks, 0);
  assert.equal(totalClicks, 28);
});

test('aggregateWeekly handles a partial trailing week', () => {
  const series = [];
  for (let i = 0; i < 9; i++) {
    series.push({ date: 'd' + i, clicks: 1, impressions: 5, position: 2 });
  }
  const weekly = internals.aggregateWeekly(series);
  assert.equal(weekly.length, 2);
  assert.equal(weekly[1].clicks, 2);
  assert.equal(weekly[1].impressions, 10);
});

// ---- intentCounts -----------------------------------------------------------------
test('intentCounts counts per intent plus all', () => {
  const queries = [
    { intent: 'Navigational' }, { intent: 'Navigational' },
    { intent: 'Commercial' }, { intent: 'Transactional' },
  ];
  const c = internals.intentCounts(queries);
  assert.equal(c.all, 4);
  assert.equal(c.Navigational, 2);
  assert.equal(c.Commercial, 1);
  assert.equal(c.Transactional, 1);
  assert.equal(c.Local, undefined);
});

// ---- sortRows ----------------------------------------------------------------------
test('sortRows: clicks/impressions/ctr descending, position ascending', () => {
  const rows = [
    { query: 'a', clicks: 1, impressions: 50, ctr: 2, position: 8 },
    { query: 'b', clicks: 9, impressions: 10, ctr: 90, position: 1 },
    { query: 'c', clicks: 5, impressions: 99, ctr: 5, position: 4 },
  ];
  assert.deepEqual(internals.sortRows(rows, 'clicks').map(r => r.query), ['b', 'c', 'a']);
  assert.deepEqual(internals.sortRows(rows, 'impressions').map(r => r.query), ['c', 'a', 'b']);
  assert.deepEqual(internals.sortRows(rows, 'ctr').map(r => r.query), ['b', 'c', 'a']);
  assert.deepEqual(internals.sortRows(rows, 'position').map(r => r.query), ['b', 'c', 'a']);
});

test('sortRows does not mutate the input', () => {
  const rows = [{ query: 'a', clicks: 1 }, { query: 'b', clicks: 2 }];
  internals.sortRows(rows, 'clicks');
  assert.deepEqual(rows.map(r => r.query), ['a', 'b']);
});

// ---- deriveGaps --------------------------------------------------------------------
test('deriveGaps excludes navigational and zero-impression queries, sorts by impressions', () => {
  const queries = [
    { query: 'brand', intent: 'Navigational', impressions: 500 },
    { query: 'best tool', intent: 'Commercial', impressions: 100 },
    { query: 'how to x', intent: 'Informational', impressions: 300 },
    { query: 'dead', intent: 'Commercial', impressions: 0 },
  ];
  const gaps = internals.deriveGaps(queries);
  assert.deepEqual(gaps.map(g => g.query), ['how to x', 'best tool']);
});

// ---- normalizeData -----------------------------------------------------------------
test('normalizeData returns null for empty payloads', () => {
  assert.equal(internals.normalizeData(null, 'Acme'), null);
  assert.equal(internals.normalizeData({}, 'Acme'), null);
  assert.equal(internals.normalizeData({ queries: [], pages: [], series: [] }, 'Acme'), null);
});

test('normalizeData maps queries, classifies missing intent, converts fractional ctr', () => {
  const raw = {
    property: 'acme.com',
    queries: [
      { query: 'acme login', clicks: 5, impressions: 10, ctr: 0.5, position: 1.2 },
      { query: 'best widgets', clicks: 1, impressions: 20, ctr: 5, position: 9 },
    ],
  };
  const d = internals.normalizeData(raw, 'Acme');
  assert.ok(d);
  assert.equal(d.property, 'acme.com');
  assert.equal(d.queries[0].intent, 'Navigational');
  assert.ok(Math.abs(d.queries[0].ctr - 50) < 1e-9); // 0.5 fraction -> 50%
  assert.equal(d.queries[1].intent, 'Commercial');
  assert.ok(Math.abs(d.queries[1].ctr - 5) < 1e-9);  // already a percent
});

test('normalizeData computes totals from the series when not provided', () => {
  const raw = {
    series: [
      { date: '2026-06-01', clicks: 2, impressions: 100, position: 10 },
      { date: '2026-06-02', clicks: 8, impressions: 100, position: 20 },
    ],
  };
  const d = internals.normalizeData(raw, 'Acme');
  assert.equal(d.totals.clicks, 10);
  assert.equal(d.totals.impressions, 200);
  assert.ok(Math.abs(d.totals.ctr - 5) < 1e-9);
  assert.ok(Math.abs(d.totals.position - 15) < 1e-9);
});

// ---- formatting -------------------------------------------------------------------
test('formatters match the captured reference formats', () => {
  assert.equal(internals.fmtInt(222003), '222,003');     // stat card
  assert.equal(internals.fmtCtrStat(0.1614), '0.16%');   // stat card CTR, 2 dp
  assert.equal(internals.fmtCtrCell(32.71), '32.7%');    // table CTR, 1 dp
  assert.equal(internals.fmtPos(28.55), '28.6');         // position, 1 dp
  assert.equal(internals.fmtPos(null), '0.0');
});
