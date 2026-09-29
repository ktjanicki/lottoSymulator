// Polityka CSP wstawiana do zbudowanego index.html (scripts/build.mjs).
// Awarie, przed którymi chroni:
// - meta za importmapą — polityka jej nie obejmuje (przeglądarka stosuje meta
//   tylko do tego, co przeczyta później) i strona chodzi bez ochrony, a nikt
//   tego nie widzi;
// - skrót liczony także ze skryptu z src albo pominięty skrypt inline —
//   w drugim przypadku przeglądarka blokuje importmapę: worker i numer wersji
//   się nie wczytują;
// - druga polityka dopisana obok istniejącej — obie obowiązują naraz, więc
//   zaostrzenie w jednej po cichu psuje stronę mimo luźniejszej drugiej.
// Czy przeglądarka rzeczywiście uznaje skrót i blokuje obcy skrypt, sprawdza
// e2e/page.spec.mjs na zbudowanej stronie.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { injectCsp } = require('../scripts/build.mjs');

// Kształt HTML-a, który wypuszcza Parcel: bez <head>, importmapa przed <meta charset>.
const IMPORTMAP = '{"imports":{"a1":"/simulationWorker.2f0d0aac.js"}}';
const BUILT = `<!DOCTYPE html><html lang=pl><script type=importmap>${IMPORTMAP}</script><meta charset=UTF-8><title>x</title><body><script src=/bundle.981e0017.js type=module></script>`;

const cspOf = (html) => /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1];

test('polityka stoi przed importmapą i zawiera skrót jej treści, a skryptu z src nie', () => {
  const html = injectCsp(BUILT);
  const policy = cspOf(html);
  assert.ok(policy, 'Brak <meta> z polityką CSP.');
  assert.ok(
    html.indexOf('Content-Security-Policy') < html.indexOf('<script'),
    'Meta z polityką stoi za pierwszym skryptem.'
  );

  const expected = `'sha256-${createHash('sha256').update(IMPORTMAP).digest('base64')}'`;
  const scriptSrc = policy.split('; ').find((directive) => directive.startsWith('script-src'));
  assert.equal(scriptSrc, `script-src 'self' ${expected}`);
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/);
});

test('HTML bez <html> albo z polityką już w środku to błąd buildu, a nie strona bez ochrony', () => {
  assert.throws(() => injectCsp('<script>x</script>'), /nie ma znacznika <html>/);
  const withPolicy = BUILT.replace(
    '<meta charset',
    `<meta http-equiv="Content-Security-Policy" content="default-src *"><meta charset`
  );
  assert.throws(() => injectCsp(withPolicy), /ma już politykę CSP/);
});
