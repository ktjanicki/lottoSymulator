// Manifest aplikacji uzupełniany w buildzie (scripts/build.mjs). Awarie,
// przed którymi chroni:
// - nazwa aplikacji inna niż og:title albo jej kopia w manifest.json, która
//   po zmianie tytułu zostaje stara;
// - link do manifest.webmanifest, który nginx na serwerze podaje jako
//   application/octet-stream.
// Czy serwer rzeczywiście podaje manifest i ikony, sprawdza e2e/page.spec.mjs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { completeManifest, renameManifest } = require('../scripts/build.mjs');

// Zapis po minifikacji Parcela: wartości bez cudzysłowów.
const BUILT =
  '<html lang=pl><meta property=og:title content="Lotto Symulator"><link rel=manifest href=/manifest.webmanifest><link rel=icon href=/favicon.svg>';
const MANIFEST = '{"start_url":"./","icons":[{"src":"/icon-192.png","sizes":"192x192"}]}';

test('manifest dostaje nazwę z og:title, a reszta pól zostaje bez zmian', () => {
  assert.deepEqual(JSON.parse(completeManifest(BUILT, MANIFEST)), {
    name: 'Lotto Symulator',
    ...JSON.parse(MANIFEST),
  });
});

test('nazwa w źródłowym manifest.json albo brak og:title to błąd buildu', () => {
  assert.throws(() => completeManifest(BUILT, '{"name":"Stara nazwa"}'), /usuń ją ze źródła/);
  assert.throws(() => completeManifest(BUILT, '{"short_name":"Lotto"}'), /usuń ją ze źródła/);
  assert.throws(() => completeManifest('<html lang=pl>', MANIFEST), /nie ma og:title/);
});

test('link do manifestu prowadzi do manifest.json, a sąsiednie linki zostają', () => {
  assert.equal(
    renameManifest(BUILT),
    '<html lang=pl><meta property=og:title content="Lotto Symulator"><link rel=manifest href=/manifest.json><link rel=icon href=/favicon.svg>'
  );
  assert.equal(renameManifest('<html lang=pl>'), '<html lang=pl>');
});
