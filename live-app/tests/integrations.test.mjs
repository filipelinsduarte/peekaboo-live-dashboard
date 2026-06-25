/*
 * Unit tests for the pure logic in views/integrations.js.
 * Run with:  node live-app/tests/integrations.test.mjs
 * (no dependencies, exits non-zero on failure)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'views', 'integrations.js'), 'utf8');

// minimal PB stub so the IIFE runs without a DOM
const PB = {
  el() { return { appendChild() {}, addEventListener() {}, setAttribute() {}, removeAttribute() {}, querySelector() { return null; }, style: {}, innerHTML: '' }; },
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

const internals = PB._integrationsInternals;
let failures = 0;
function check(name, cond) {
  if (cond) { console.log('ok   ' + name); }
  else { console.error('FAIL ' + name); failures += 1; }
}

const KEY = 'pk_example0-0000-4000-8000-000000000000_0000000000000000000000000000000000000000000000000000000000example';

// ---- maskKey ----------------------------------------------------------------
check('maskKey shows first 11 + last 6', internals.maskKey(KEY) === 'pk_example0…xample');
check('maskKey rejects non-pk keys', internals.maskKey('sk_abcdefghijklmnop') === '');
check('maskKey rejects short keys', internals.maskKey('pk_short') === '');
check('maskKey tolerates null', internals.maskKey(null) === '');
check('maskKey never leaks the middle', internals.maskKey(KEY).indexOf('example0-0000') === -1);

// ---- mcpJsonSnippet -----------------------------------------------------------
const json = internals.mcpJsonSnippet(KEY);
check('mcp json is valid JSON', (() => { try { JSON.parse(json); return true; } catch (e) { return false; } })());
const parsed = JSON.parse(json);
check('mcp json has peekaboo server', !!parsed.mcpServers && !!parsed.mcpServers.peekaboo);
check('mcp json uses npx mcp-remote', parsed.mcpServers.peekaboo.command === 'npx' && parsed.mcpServers.peekaboo.args[0] === 'mcp-remote@latest');
check('mcp json points at /api/mcp', parsed.mcpServers.peekaboo.args[1] === 'https://www.aipeekaboo.com/api/mcp');
check('mcp json carries the bearer key', parsed.mcpServers.peekaboo.args[3] === 'Authorization: Bearer ' + KEY);
check('mcp json falls back to placeholder', internals.mcpJsonSnippet('').indexOf('Bearer pk_YOUR_KEY') !== -1);

// ---- mcpClaudeCodeSnippet -----------------------------------------------------
const cc = internals.mcpClaudeCodeSnippet(KEY);
check('claude code cmd starts with claude mcp add', cc.indexOf('claude mcp add peekaboo -- npx mcp-remote@latest') === 0);
check('claude code cmd carries the key', cc.indexOf('Bearer ' + KEY) !== -1);

// ---- quickstartSnippet --------------------------------------------------------
const qs = internals.quickstartSnippet(KEY);
check('quickstart uses X-API-Key header', qs.indexOf('curl -H "X-API-Key: ' + KEY + '"') !== -1);
check('quickstart hits /api/v1/brands', qs.indexOf('https://www.aipeekaboo.com/api/v1/brands') !== -1);
check('quickstart includes time_range example', qs.indexOf('visibility?time_range=30d') !== -1);
check('quickstart falls back to placeholder', internals.quickstartSnippet('').indexOf('pk_your_key') !== -1);

// ---- usagePct -----------------------------------------------------------------
check('usagePct 100/2000 = 5', internals.usagePct(100, 2000) === 5);
check('usagePct 0/2000 = 0', internals.usagePct(0, 2000) === 0);
check('usagePct 2000/2000 = 100', internals.usagePct(2000, 2000) === 100);
check('usagePct clamps over limit', internals.usagePct(5000, 2000) === 100);
check('usagePct clamps negatives', internals.usagePct(-10, 2000) === 0);
check('usagePct zero limit = 0', internals.usagePct(100, 0) === 0);
check('usagePct tolerates garbage', internals.usagePct('x', 'y') === 0);

// ---- escapeHtml ----------------------------------------------------------------
check('escapeHtml escapes angle brackets', internals.escapeHtml('<b>&"') === '&lt;b&gt;&amp;&quot;');

if (failures > 0) { process.exit(1); }
console.log('\nAll integrations tests passed.');
