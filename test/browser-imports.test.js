// Strona ma działać także podana wprost, bez buildu Parcela (serwer statyczny
// przy pracy nad kodem; zapas na wypadek powrotu produkcji do publikacji
// surowych plików). Import, który rozwiązuje tylko bundler (np. `import fs from
// 'fs'`), przechodzi `npm run build` i CI, a bez buildu unieważnia w przeglądarce
// cały moduł: strona się wyświetla, ale nic na niej nie działa. Tak padła
// produkcja w 1.1.0, gdy podawała surowe pliki.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Specyfikatory, które przeglądarka musi pobrać: importy statyczne i dynamiczne
// oraz new URL(…, import.meta.url) (worker, plik VERSION).
const SPECIFIERS = [
  /\bimport\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bnew\s+URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
];

// Pliki wczytywane przez index.html: <script src> i <link href> ze ścieżką względną.
const pageAssets = (html) =>
  [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((ref) => !/^[a-z]+:|^\/\//i.test(ref));

// Zwraca błędy dla modułu `file` o treści `source`; exists(ścieżka) mówi, czy plik jest w repozytorium.
const checkModule = (file, source, exists) => {
  const errors = [];
  for (const pattern of SPECIFIERS) {
    for (const [, spec] of source.matchAll(pattern)) {
      // Adres w new URL(…, import.meta.url) jest względny także bez „./”.
      if (!/^\.{0,2}\//.test(spec) && pattern !== SPECIFIERS[2]) {
        errors.push(`${file}: import „${spec}” rozwiązuje tylko bundler — przeglądarka odrzuci cały moduł. Użyj ścieżki względnej („./…”).`);
        continue;
      }
      const target = path.join(path.dirname(file), spec);
      if (!exists(target)) errors.push(`${file}: „${spec}” wskazuje nieistniejący plik ${target}.`);
    }
  }
  return errors;
};

const checkPage = (read, exists) => {
  const errors = [];
  for (const asset of pageAssets(read('index.html'))) {
    if (!exists(asset)) {
      errors.push(`index.html wczytuje „${asset}”, którego nie ma w repozytorium.`);
      continue;
    }
    if (asset.endsWith('.js')) errors.push(...checkModule(asset, read(asset), exists));
  }
  return errors;
};

test('strona podana wprost ładuje wszystkie moduły — inaczej produkcja wyświetla martwą stronę', () => {
  const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
  const exists = (file) => fs.existsSync(path.join(ROOT, file));
  assert.deepEqual(checkPage(read, exists), []);
});

test('kontrola odrzuca import pakietu, brakujący plik i brakujący zasób strony', () => {
  const files = {
    'index.html': '<link rel="stylesheet" href="style.css"><script src="index.js" type="module"></script>',
    'index.js': "import fs from 'fs';\nimport './missing.js';\nnew Worker(new URL('worker.js', import.meta.url));",
    'worker.js': '',
  };
  const errors = checkPage((file) => files[file], (file) => file in files);
  assert.equal(errors.length, 3, errors.join('\n'));
  assert.match(errors.join('\n'), /style\.css/);
  assert.match(errors.join('\n'), /„fs”/);
  assert.match(errors.join('\n'), /missing\.js/);
});
