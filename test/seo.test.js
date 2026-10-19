// Adres kanoniczny, robots.txt i sitemap.xml liczone w buildzie z og:url
// (scripts/build.mjs). Awarie, przed którymi chroni:
// - adres inny niż og:url (np. stara domena po przeprowadzce) — wyszukiwarka
//   dostaje sprzeczne sygnały i potrafi wybrać do wyników zły adres;
// - drugi canonical dopisany w źródle — przy dwóch różnych Google ignoruje oba;
// - robots.txt wskazujący mapę pod złym adresem albo blokujący stronę;
// - dane strukturalne, które nie są poprawnym JSON-em albo „</script>”
//   w nazwie zamyka blok i wylewa resztę na stronę;
// - zbudowana strona bez znaczników <head> i </head> (minifikacja) — Search
//   Console nie znajduje znacznika weryfikacji i odmawia potwierdzenia własności.
// Czy serwer rzeczywiście podaje oba pliki, sprawdza e2e/page.spec.mjs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { addCanonical, addStructuredData, restoreHead, robotsTxt, sitemapXml } = require('../scripts/build.mjs');

// Zapis po minifikacji Parcela: wartości bez cudzysłowów.
const BUILT =
  '<html lang=pl><meta property=og:url content=https://lottosymulator.pl/><meta property=og:title content="Lotto Symulator">';

test('canonical dostaje adres z og:url i stoi zaraz za nim, a sąsiednie znaczniki zostają', () => {
  assert.equal(
    addCanonical(BUILT),
    '<html lang=pl><meta property=og:url content=https://lottosymulator.pl/><link rel=canonical href="https://lottosymulator.pl/"><meta property=og:title content="Lotto Symulator">'
  );
});

test('canonical w źródle albo brak og:url to błąd buildu, a nie strona z dwoma adresami albo bez adresu', () => {
  assert.throws(
    () => addCanonical(`${BUILT}<link rel=canonical href=https://example.com/>`),
    /ma już <link rel=canonical>/
  );
  assert.throws(() => addCanonical('<html lang=pl>'), /nie ma og:url/);
});

test('mapa strony i robots.txt wskazują adres z og:url, a robots.txt niczego nie blokuje', () => {
  assert.match(sitemapXml(BUILT), /<loc>https:\/\/lottosymulator\.pl\/<\/loc>/);
  const robots = robotsTxt(BUILT);
  assert.match(robots, /^Sitemap: https:\/\/lottosymulator\.pl\/sitemap\.xml$/m);
  assert.match(robots, /^Disallow:$/m, 'Disallow z wartością blokuje indeksowanie.');
  assert.doesNotMatch(robots, /^Disallow: *\S/m);
});

const structuredData = (html) => JSON.parse(/<script type=application\/ld\+json>(.*?)<\/script>/.exec(html)[1]);

test('dane strukturalne WebSite biorą nazwę z og:title i adres z og:url', () => {
  assert.deepEqual(structuredData(addStructuredData(BUILT)), {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Lotto Symulator',
    url: 'https://lottosymulator.pl/',
  });
});

test('„</script>” w nazwie nie zamyka bloku danych, a brak og:title to błąd buildu', () => {
  const html = addStructuredData(BUILT.replace('"Lotto Symulator"', '"a</script><b>"'));
  assert.equal(structuredData(html).name, 'a</script><b>');
  assert.throws(
    () => addStructuredData('<meta property=og:url content=https://lottosymulator.pl/>'),
    /nie ma og:title/
  );
});

test('sekcja <head> wraca między <html> a <body>, z całą treścią nagłówka w środku', () => {
  const built = '<!DOCTYPE html><html lang=pl><meta charset=UTF-8><meta name=x content=y><body><p>a</body>';
  assert.equal(
    restoreHead(built),
    '<!DOCTYPE html><html lang=pl><head><meta charset=UTF-8><meta name=x content=y></head><body><p>a</body>'
  );
  // Minifikator, który kiedyś zostawi <head>, nie dostanie drugiego.
  const withHead = '<html><head><meta charset=UTF-8></head><body>';
  assert.equal(restoreHead(withHead), withHead);
});

test('HTML bez <body> to błąd buildu, a nie nagłówek obejmujący całą stronę', () => {
  assert.throws(() => restoreHead('<html lang=pl><meta charset=UTF-8><p>a'), /nie ma <html> albo <body>/);
});
