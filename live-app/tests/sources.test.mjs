/*
 * Unit tests for the pure math/logic in views/sources.js.
 * Run with:  node --test live-app/tests/sources.test.mjs
 * (zero dependencies, uses the built-in node test runner)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'views', 'sources.js'), 'utf8');

// minimal browser stubs so the IIFE can run in node
const PB = {
  el() { return { appendChild() {}, setAttribute() {} }; },
  registerView() {},
  api: {},
  toast() {},
};
const windowStub = { PB };
const documentStub = {
  getElementById() { return null; },
  createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; },
  createElementNS() { return { style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }; },
  addEventListener() {},
  head: { appendChild() {} },
};

const fn = new Function('window', 'document', 'PB', src + '\nreturn window.PB._sourcesInternals;');
const internals = fn(windowStub, documentStub, PB);

test('internals are exposed', () => {
  assert.ok(internals, 'PB._sourcesInternals must be set');
});

// ---- splitMentions ----------------------------------------------------------
test('splitMentions sums exactly to mentions', () => {
  const models = ['gpt-4o-mini', 'gemini-2.5-flash', 'sonar', 'google-aio', 'google-ai-mode'];
  for (const total of [1, 2, 5, 17, 100, 165]) {
    const out = internals.splitMentions('example.com', total, models);
    const sum = Object.values(out).reduce((a, b) => a + b, 0);
    assert.equal(sum, total, `sum for total=${total}`);
  }
});

test('splitMentions is deterministic and non-negative', () => {
  const models = ['gpt-4o-mini', 'sonar'];
  const a = internals.splitMentions('clutch.co', 100, models);
  const b = internals.splitMentions('clutch.co', 100, models);
  assert.deepEqual(a, b);
  for (const v of Object.values(a)) assert.ok(v >= 0);
});

test('splitMentions gives every citing model at least 1 when possible', () => {
  const models = ['gpt-4o-mini', 'gemini-2.5-flash', 'sonar', 'google-aio', 'google-ai-mode'];
  const out = internals.splitMentions('awisee.com', 12, models);
  for (const m of models) assert.ok(out[m] >= 1, `${m} should get >= 1`);
});

test('splitMentions handles empty model list and zero mentions', () => {
  assert.deepEqual(internals.splitMentions('x.com', 10, []), {});
  assert.deepEqual(internals.splitMentions('x.com', 0, ['sonar']), {});
});

// ---- heatAlpha (reference formula: max(0.12, 0.85 * count/max)) -------------
test('heatAlpha matches the captured reference values (max=8)', () => {
  // captured page: 8 -> 0.85, 4 -> 0.424, 3 -> 0.318, 2 -> 0.21(2), 1 -> 0.12 floor
  assert.equal(internals.heatAlpha(8, 8), 0.85);
  assert.ok(Math.abs(internals.heatAlpha(4, 8) - 0.425) < 0.001);
  assert.ok(Math.abs(internals.heatAlpha(3, 8) - 0.31875) < 0.001);
  assert.equal(internals.heatAlpha(1, 8), 0.12); // floored
  assert.equal(internals.heatAlpha(0, 8), 0);
});

test('alphaHex produces 2-char hex', () => {
  assert.equal(internals.alphaHex(0.85), 'd9');
  assert.equal(internals.alphaHex(0.12), '1f');
  assert.equal(internals.alphaHex(0), '00');
});

// ---- classifyContentType -----------------------------------------------------
test('classifyContentType known domains', () => {
  assert.equal(internals.classifyContentType('linkedin.com'), 'Social');
  assert.equal(internals.classifyContentType('www.youtube.com'), 'Video');
  assert.equal(internals.classifyContentType('reddit.com'), 'Forum / Community');
  assert.equal(internals.classifyContentType('g2.com'), 'Review');
  assert.equal(internals.classifyContentType('techcrunch.com'), 'News Article');
});

test('classifyContentType TLD heuristics', () => {
  assert.equal(internals.classifyContentType('applytosupply.digitalmarketplace.service.gov.uk'), 'Government');
  assert.equal(internals.classifyContentType('pmc.ncbi.nlm.nih.gov'), 'Government');
  assert.equal(internals.classifyContentType('england.nhs.uk'), 'Government');
  assert.equal(internals.classifyContentType('mit.edu'), 'Academic/Research');
  assert.equal(internals.classifyContentType('shyft.org.uk'), 'Non-Profit/Organization');
  assert.equal(internals.classifyContentType('bullhorn.com'), 'Corporate Website');
});

// ---- domainTypeBadge ---------------------------------------------------------
test('domainTypeBadge precedence and fallback', () => {
  assert.deepEqual(internals.domainTypeBadge('reddit.com'), { label: 'Social Media', cls: 'social' });
  assert.deepEqual(internals.domainTypeBadge('semrush.com'), { label: 'Competitor', cls: 'competitor' });
  assert.deepEqual(internals.domainTypeBadge('g2.com'), { label: 'Review Platform', cls: 'review-pl' });
  assert.deepEqual(internals.domainTypeBadge('shiftmed.com'), { label: 'Reference', cls: 'reference' });
});

// ---- ctBadgeClass -------------------------------------------------------------
test('ctBadgeClass maps filter values to css classes', () => {
  assert.equal(internals.ctBadgeClass('Blog Post'), 'blog-post');
  assert.equal(internals.ctBadgeClass('Forum / Community'), 'ugc');
  assert.equal(internals.ctBadgeClass('Corporate Website'), '');
  assert.equal(internals.ctBadgeClass(''), '');
});

// ---- donutArcPath (geometry: cx/cy 75, outer r 54, inner r 34) ---------------
test('donutArcPath quarter circle endpoints', () => {
  // start at frac 0 (12 o'clock), quarter turn -> ends at 3 o'clock
  // path = M x0 y0 A 54 54 0 <large> 1 x1 y1 ...
  // nums: [x0, y0, 54, 54, rotation, large, sweep, x1, y1, ...]
  const d = internals.donutArcPath(0, 0.25);
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
  // M x0 y0 -> (75, 21)
  assert.ok(Math.abs(nums[0] - 75) < 1e-6);
  assert.ok(Math.abs(nums[1] - 21) < 1e-6);
  // large-arc flag is 0 for frac <= 0.5
  assert.equal(nums[5], 0);
  // outer arc endpoint -> (129, 75)
  assert.ok(Math.abs(nums[7] - 129) < 1e-6);
  assert.ok(Math.abs(nums[8] - 75) < 1e-6);
});

test('donutArcPath uses large-arc flag for frac > 0.5 and empty for 0', () => {
  const d = internals.donutArcPath(0, 0.6);
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
  assert.equal(nums[5], 1);
  assert.equal(internals.donutArcPath(0.3, 0), '');
});

// ---- kFormat ------------------------------------------------------------------
test('kFormat', () => {
  assert.equal(internals.kFormat(500), '500');
  assert.equal(internals.kFormat(1500), '1.5k');
});

// ---- share math (mirrors view computation) -------------------------------------
test('shares sum to ~100%', () => {
  const mentions = [165, 100, 89, 75, 66];
  const total = mentions.reduce((a, b) => a + b, 0);
  const shares = mentions.map((m) => (m / total) * 100);
  const sum = shares.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) < 1e-9);
});

// =================================================================================
// URLs tab helpers (Domains/URLs toggle, 2026-06-12)
// =================================================================================

// ---- stripTracking --------------------------------------------------------------
test('stripTracking removes utm params and keeps the rest', () => {
  assert.equal(
    internals.stripTracking('https://a.com/post?utm_source=openai'),
    'https://a.com/post'
  );
  assert.equal(
    internals.stripTracking('https://a.com/post?page=2&utm_medium=x&id=7'),
    'https://a.com/post?page=2&id=7'
  );
  assert.equal(
    internals.stripTracking('https://a.com/post?gclid=abc&fbclid=def'),
    'https://a.com/post'
  );
  assert.equal(internals.stripTracking('https://a.com/post'), 'https://a.com/post');
  assert.equal(internals.stripTracking(''), '');
});

test('stripTracking makes utm variants of the same article identical', () => {
  const a = internals.stripTracking('https://b.dev/articles/best-tools?utm_source=openai');
  const b = internals.stripTracking('https://b.dev/articles/best-tools?utm_source=chatgpt.com');
  assert.equal(a, b);
});

// ---- shortUrlLabel --------------------------------------------------------------
test('shortUrlLabel strips protocol/www and truncates', () => {
  assert.equal(internals.shortUrlLabel('https://www.a.com/x', 40), 'a.com/x');
  const long = 'https://example.com/' + 'a'.repeat(80);
  const out = internals.shortUrlLabel(long, 36);
  assert.equal(out.length, 36);
  assert.ok(out.endsWith('…'));
});

// ---- classifyPageType -----------------------------------------------------------
test('classifyPageType matches the live taxonomy', () => {
  const c = internals.classifyPageType;
  assert.equal(c('https://promptperfect.jina.ai/', 'PromptPerfect - AI Prompt Generator'), 'Home Page');
  assert.equal(c('https://www.reddit.com/r/PromptEngineering/comments/1dhgfze/w', 'What are some of the tools'), 'Forum Thread');
  assert.equal(c('https://www.quora.com/What-is-x', 'What is x'), 'Forum Thread');
  assert.equal(c('https://community.openai.com/t/some-thread/123', 'Some thread'), 'Forum Thread');
  assert.equal(c('https://www.youtube.com/watch?v=abc', 'Video title'), 'Video');
  assert.equal(c('https://a.com/promptperfect-vs-aiprm', 'PromptPerfect vs AIPRM'), 'Comparison');
  // "best/top" beats "reviewed" (braintrust row is a Listicle on live)
  assert.equal(c('https://www.braintrust.dev/articles/best-prompt-engineering-tools-2026', 'Best Prompt Engineering Tools in 2026 (Reviewed) - Braintrust'), 'Listicle');
  assert.equal(c('https://a.com/product-review', 'Pretty Prompt review: is it worth it?'), 'Review');
  assert.equal(c('https://a.com/docs/how-to-write-prompts', 'How to write prompts'), 'Guide');
  assert.equal(c('https://a.com/blog/my-thoughts', 'Some musings'), 'Blog Post');
  assert.equal(c('https://a.com/tools/prompt-helpers/', 'Prompt helpers'), 'Category Page');
  assert.equal(c('https://es.trustpilot.com/review/kueski.com', 'Opinion espontanea'), 'Review');
  assert.equal(c('https://www.tiktok.com/@kardmatchmx/video/7158916675214', 'Kueski Prestamos'), 'Video');
  assert.equal(c('https://a.com/random-page', 'A plain piece'), 'Article');
});

// ---- aggregateUrlRows -----------------------------------------------------------
function detailFixture() {
  return [
    {
      history: [
        {
          runId: 'r1', date: '2026-06-08T10:00:00Z', aiModel: 'gpt-4o-mini',
          sources: [
            { domain: 'a.com', url: 'https://a.com/post?utm_source=openai', title: 'Post A' },
            { domain: 'b.com', url: 'https://b.com/', title: 'B Home' },
          ],
        },
        {
          runId: 'r2', date: '2026-06-09T10:00:00Z', aiModel: 'sonar',
          sources: [
            { domain: 'a.com', url: 'https://a.com/post', title: 'Post A — longer title wins' },
          ],
        },
      ],
    },
    {
      history: [
        {
          runId: 'r2', date: '2026-06-09T11:00:00Z', aiModel: 'gemini-2.5-flash',
          sources: [
            { domain: 'a.com', url: 'https://a.com/post?utm_source=chatgpt.com', title: 'Post A' },
          ],
        },
      ],
    },
  ];
}

test('aggregateUrlRows merges utm variants into one URL row', () => {
  const { rows, totalCitations } = internals.aggregateUrlRows(detailFixture());
  assert.equal(totalCitations, 4);
  assert.equal(rows.length, 2);
  const a = rows.find((r) => r.url === 'https://a.com/post');
  assert.ok(a, 'merged row exists');
  assert.equal(a.citations, 3);
});

test('aggregateUrlRows counts distinct runs and models, keeps longest title', () => {
  const { rows } = internals.aggregateUrlRows(detailFixture());
  const a = rows.find((r) => r.url === 'https://a.com/post');
  assert.equal(a.runs, 2); // r1, r2 (r2 appears twice)
  assert.deepEqual(a.models, ['gpt-4o-mini', 'gemini-2.5-flash', 'sonar']); // MODEL_ORDER
  assert.equal(a.title, 'Post A — longer title wins');
  assert.equal(a.lastSeen, '2026-06-09');
  assert.deepEqual(a.dateCounts, { '2026-06-08': 1, '2026-06-09': 2 });
});

test('aggregateUrlRows shares sum to 100 and rows sort by citations desc', () => {
  const { rows } = internals.aggregateUrlRows(detailFixture());
  const sum = rows.reduce((acc, r) => acc + r.share, 0);
  assert.ok(Math.abs(sum - 100) < 1e-9);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1].citations >= rows[i].citations);
  }
});

test('aggregateUrlRows classifies page types on aggregated rows', () => {
  const { rows } = internals.aggregateUrlRows(detailFixture());
  const b = rows.find((r) => r.url === 'https://b.com/');
  assert.equal(b.pageType, 'Home Page');
});

test('aggregateUrlRows tolerates empty/malformed details', () => {
  assert.deepEqual(internals.aggregateUrlRows([]), { rows: [], totalCitations: 0 });
  const { rows } = internals.aggregateUrlRows([null, {}, { history: [null, { sources: null }] }]);
  assert.deepEqual(rows, []);
});

// ---- fmtDay ---------------------------------------------------------------------
test('fmtDay formats like the live Last Seen column', () => {
  assert.equal(internals.fmtDay('2026-06-08'), 'Jun 8, 2026');
  assert.equal(internals.fmtDay(''), '–');
});
