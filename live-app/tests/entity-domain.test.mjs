/*
 * entity-domain.test.mjs — unit tests for the entity-name -> domain
 * resolution chain in assets/app.js (window.PBEntityLogic).
 *
 * Hard rule under test: a domain is NEVER constructed or guessed from an
 * entity name. The only outputs are API-tracked urls, domains that actually
 * appear in the citation data, curated verified domains, or null.
 *
 * Run with:  node live-app/tests/entity-domain.test.mjs
 * (zero dependencies; exits non-zero on failure)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'assets', 'app.js'), 'utf8');

const sandbox = {
  window: { addEventListener() {} },
  document: { createElement() { return {}; }, addEventListener() {} },
  location: { hash: '' },
  console,
  setTimeout() {},
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const E = sandbox.window.PBEntityLogic;
assert.ok(E, 'PBEntityLogic should be exposed on window');

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

// ---- chain priority: tracked beats everything -------------------------------
test('tracked url beats the known map', () => {
  const tracked = { semrush: 'https://www.tracked-example.co.uk/path' };
  assert.equal(E.entityDomain('Semrush', [], tracked), 'tracked-example.co.uk');
});

test('tracked url beats cited domains', () => {
  const tracked = { carwow: 'https://www.carwow.de' };
  assert.equal(E.entityDomain('Carwow', ['carwow.co.uk'], tracked), 'carwow.de');
});

test('tracked lookup is exact name match, case-insensitive', () => {
  const tracked = { 'kwik fit': 'https://www.kwik-fit.com' };
  assert.equal(E.entityDomain('Kwik Fit', [], tracked), 'kwik-fit.com');
  assert.equal(E.entityDomain('Kwik', [], tracked), null);
});

// ---- cited-domain SLD matching ----------------------------------------------
test('cited match: "Kwik Fit" resolves to kwik-fit.com via SLD normalization', () => {
  assert.equal(E.entityDomain('Kwik Fit', ['example.com', 'kwik-fit.com']), 'kwik-fit.com');
});

test('cited match handles co.uk two-part TLD', () => {
  assert.equal(E.entityDomain('Carwow', ['carwow.co.uk']), 'carwow.co.uk');
  assert.equal(E.domainSLD('carwow.co.uk'), 'carwow');
});

test('cited match handles com.br two-part TLD', () => {
  assert.equal(E.entityDomain('Mercado Livre', ['mercadolivre.com.br']), 'mercadolivre.com.br');
});

test('cited match strips protocol and www from the cited domain', () => {
  assert.equal(E.entityDomain('Carwow', ['https://www.carwow.co.uk/used-cars']), 'carwow.co.uk');
});

test('cited match beats the known map (real citation data preferred)', () => {
  assert.equal(E.entityDomain('Halfords', ['halfords.ie']), 'halfords.ie');
});

// ---- NO prefix/contains matching ---------------------------------------------
test('no prefix match: "KN" must not match knfilters.com or anything else', () => {
  assert.equal(E.entityDomain('KN', ['knfilters.com', 'kn-online.de']), null);
  assert.equal(E.entityDomain('K&N', ['knfilters.com']), null);
});

test('no contains match: "Fit" must not match kwik-fit.com', () => {
  assert.equal(E.entityDomain('Fit', ['kwik-fit.com']), null);
});

test('exact equality only: "Kwik" alone does not match kwik-fit.com', () => {
  assert.equal(E.entityDomain('Kwik', ['kwik-fit.com']), null);
});

// ---- normalization safety -----------------------------------------------------
test('umlaut is preserved: "Lemförder" must NOT match lemfrder.com', () => {
  assert.equal(E.entityDomain('Lemförder', ['lemfrder.com']), null);
  assert.notEqual(E.normalizeEntityName('Lemförder'), 'lemfrder');
});

test('umlaut name still matches a domain that keeps the letters', () => {
  // febi.com SLD "febi" vs "Febi" — sanity check the plain path
  assert.equal(E.entityDomain('Febi', ['febi.com']), 'febi.com');
});

test('spaces, dots, hyphens and ampersands are stripped for matching', () => {
  assert.equal(E.normalizeEntityName('Kwik Fit'), 'kwikfit');
  assert.equal(E.normalizeEntityName('kwik-fit'), 'kwikfit');
  assert.equal(E.normalizeEntityName('M&S Co.'), 'msco');
});

// ---- known map -----------------------------------------------------------------
test('known map: well-known brands resolve to verified domains', () => {
  assert.equal(E.entityDomain('Bosch', []), 'bosch.com');
  assert.equal(E.entityDomain('Mastercard', []), 'mastercard.com');
  assert.equal(E.entityDomain('PayPal', []), 'paypal.com');
  assert.equal(E.entityDomain('Amazon UK', []), 'amazon.co.uk');
  assert.equal(E.entityDomain('Halfords', []), 'halfords.com');
  assert.equal(E.entityDomain('Kwik Fit', []), 'kwik-fit.com');
});

test('known map lookup is case-insensitive and trimmed', () => {
  assert.equal(E.knownDomain('  bosch  '), 'bosch.com');
  assert.equal(E.knownDomain('SEMRUSH'), 'semrush.com');
});

test('known map strips a trailing " AI" / ".ai" (v4 behavior)', () => {
  assert.equal(E.knownDomain('Otterly AI'), 'otterly.ai');
  assert.equal(E.knownDomain('Otterly.AI'), 'otterly.ai');
  assert.equal(E.knownDomain('Scrunch AI'), 'scrunch.ai');
  assert.equal(E.knownDomain('Profound'), 'tryprofound.com');
});

// ---- unknown -> null, never a constructed domain --------------------------------
test('unknown entity returns null, NEVER a constructed domain', () => {
  assert.equal(E.entityDomain('Zzyzx Widgets Ltd', []), null);
  assert.equal(E.entityDomain('Some Random Garage', ['kwik-fit.com', 'halfords.com']), null);
  assert.equal(E.entityDomain('Amazonuk Things', []), null);
});

test('empty / null input returns null', () => {
  assert.equal(E.entityDomain('', []), null);
  assert.equal(E.entityDomain(null, []), null);
  assert.equal(E.entityDomain(undefined, []), null);
  assert.equal(E.entityDomain('   ', []), null);
});

test('no cited list and no known hit returns null', () => {
  assert.equal(E.entityDomain('Lemförder', []), null);
  assert.equal(E.entityDomain('Lemförder', null), null);
});

// ---- helpers ---------------------------------------------------------------------
test('cleanHost strips protocol, www, path, query and hash', () => {
  assert.equal(E.cleanHost('https://www.Example.co.uk/a/b?c=1#d'), 'example.co.uk');
  assert.equal(E.cleanHost('kwik-fit.com'), 'kwik-fit.com');
  assert.equal(E.cleanHost(''), '');
});

test('domainSLD plain .com and bare label', () => {
  assert.equal(E.domainSLD('kwik-fit.com'), 'kwik-fit');
  assert.equal(E.domainSLD('blog.kwik-fit.com'), 'kwik-fit');
  assert.equal(E.domainSLD('localhost'), 'localhost');
});

console.log('\n' + passed + ' tests passed');
