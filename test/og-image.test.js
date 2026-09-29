// Pełny adres og:image w zbudowanym index.html (scripts/build.mjs). Awaria,
// przed którą chroni: ścieżka względna albo adres z inną domeną niż og:url —
// podgląd linku w komunikatorach i na Facebooku wychodzi bez obrazka, a nic
// na stronie tego nie pokazuje. Czy plik rzeczywiście jest podawany, sprawdza
// e2e/page.spec.mjs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { absolutizeOgImage } = require('../scripts/build.mjs');

// Zapis po minifikacji Parcela: wartości bez cudzysłowów.
const BUILT =
  '<html lang=pl><meta property=og:url content=https://lottosymulator.grossnet.pl/><meta property=og:image content=/og-image.png><meta property=og:image:width content=1200>';

test('og:image dostaje pełny adres z domeny og:url, a sąsiednie znaczniki zostają', () => {
  const html = absolutizeOgImage(BUILT);
  assert.match(html, /<meta property=og:image content="https:\/\/lottosymulator\.grossnet\.pl\/og-image\.png">/);
  assert.match(html, /<meta property=og:image:width content=1200>/);
});

test('og:image bez og:url to błąd buildu, a strona bez og:image przechodzi bez zmian', () => {
  assert.throws(() => absolutizeOgImage('<meta property=og:image content=/og-image.png>'), /bez og:url/);
  assert.equal(absolutizeOgImage('<html lang=pl>'), '<html lang=pl>');
});
