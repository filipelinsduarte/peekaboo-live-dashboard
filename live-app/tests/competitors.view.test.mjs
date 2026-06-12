/*
 * Unit tests for the pure logic in views/competitors.js.
 * Run with:  node live-app/tests/competitors.view.test.mjs
 * (no dependencies, exits non-zero on failure)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'views', 'competitors.js'), 'utf8');

// minimal PB stub so the IIFE runs without a DOM
const PB = {
  el() { return { appendChild() {}, addEventListener() {}, setAttribute() {}, removeAttribute() {}, style: {} }; },
  fmt: {},
  registerView() {},
  state: { brands: [] },
  api: {},
  models: [],
  toast() {},
};
const windowStub = { PB };
const documentStub = {
  querySelector() { return null; },
  createElement() { return { rel: '', href: '' }; },
  head: { appendChild() {} },
};
// eslint-disable-next-line no-new-func
new Function('window', 'PB', 'document', src)(windowStub, PB, documentStub);

const internals = PB._competitorsInternals;
let failures = 0;
function check(name, cond) {
  if (cond) { console.log('ok   ' + name); }
  else { console.error('FAIL ' + name); failures += 1; }
}

// ---- heatBg: must match the captured reference samples ----------------------
check('heatBg(0) is reference red', internals.heatBg(0) === 'rgba(220, 38, 38, 0.88)');
check('heatBg(4) matches capture', internals.heatBg(4) === 'rgba(221, 49, 36, 0.88)');
check('heatBg(7) matches capture', internals.heatBg(7) === 'rgba(222, 58, 34, 0.88)');
check('heatBg(13) matches capture', internals.heatBg(13) === 'rgba(224, 75, 30, 0.88)');
check('heatBg(22) matches capture', internals.heatBg(22) === 'rgba(226, 100, 25, 0.88)');
check('heatBg(50) is yellow midpoint', internals.heatBg(50) === 'rgba(234, 179, 8, 0.88)');
check('heatBg(100) is green endpoint', internals.heatBg(100) === 'rgba(22, 163, 74, 0.88)');
check('heatBg clamps below 0', internals.heatBg(-5) === internals.heatBg(0));
check('heatBg clamps above 100', internals.heatBg(140) === internals.heatBg(100));
check('heatBg tolerates garbage', internals.heatBg('nope') === internals.heatBg(0));

// ---- aggregateLooker / cellAvg ----------------------------------------------
const rows = [
  { entity_name: 'A', ai_model: 'sonar', visibility: 100, prompt: 'p1' },
  { entity_name: 'A', ai_model: 'sonar', visibility: 0, prompt: 'p2' },
  { entity_name: 'A', ai_model: 'gpt-4o-mini', visibility: 50, prompt: 'p1' },
  { entity_name: 'B', ai_model: 'sonar', visibility: 100, prompt: 'p1' },
  { entity_name: 'B', ai_model: 'sonar', visibility: 100, prompt: 'p2' },
];
const agg = internals.aggregateLooker(rows);
check('cellAvg averages per model', internals.cellAvg(agg.byEntityModel, 'A', 'sonar') === 50);
check('cellAvg single row', internals.cellAvg(agg.byEntityModel, 'A', 'gpt-4o-mini') === 50);
check('cellAvg missing model is null', internals.cellAvg(agg.byEntityModel, 'A', 'google-aio') === null);
check('cellAvg missing entity is null', internals.cellAvg(agg.byEntityModel, 'Z', 'sonar') === null);
check('byEntity overall avg', agg.byEntity.A.sum / agg.byEntity.A.n === 50);
check('byEntity B avg 100', agg.byEntity.B.sum / agg.byEntity.B.n === 100);

// ---- promptMatrix --------------------------------------------------------------
const matrix = internals.promptMatrix(rows, 5);
check('matrix has 2 prompts', matrix.length === 2);
check('matrix keeps first-seen prompt order', matrix[0].prompt === 'p1' && matrix[1].prompt === 'p2');
// p1: A mentioned twice (sonar 100 + gpt 50 -> 2 mentions), B once
check('p1 ranks A first by mention count', matrix[0].brands[0].name === 'A');
check('p1 ranks B second', matrix[0].brands[1].name === 'B');
// p2: A visibility 0 (no mention), B mentioned
check('p2 excludes zero-visibility entities', matrix[1].brands.length === 1 && matrix[1].brands[0].name === 'B');
const empty = internals.promptMatrix([], 5);
check('empty looker gives empty matrix', Array.isArray(empty) && empty.length === 0);

// ---- domainOf ------------------------------------------------------------------
check('domainOf strips protocol+path', internals.domainOf('https://www.apptio.com/foo') === 'www.apptio.com');
check('domainOf passes bare domain', internals.domainOf('lantum.com') === 'lantum.com');
check('domainOf empty input', internals.domainOf('') === '');

if (failures) { console.error(failures + ' test(s) failed'); process.exit(1); }
console.log('All tests passed');
