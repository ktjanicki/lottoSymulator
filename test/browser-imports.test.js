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

// Zwraca błędy dla modułu `file` i — rekurencyjnie — modułów, które wczytuje
// (worker importuje rdzeń symulacji; zły import tam zabija tylko worker, więc
// strona wygląda na sprawną, dopóki ktoś nie kliknie „Rozpocznij”).
// exists(ścieżka) mówi, czy plik jest w repozytorium.
const checkModule = (file, read, exists, seen = new Set()) => {
  if (seen.has(file)) return [];
  seen.add(file);
  const source = read(file);
  const errors = [];
  for (const pattern of SPECIFIERS) {
    for (const [, spec] of source.matchAll(pattern)) {
      // Adres w new URL(…, import.meta.url) jest względny także bez „./”.
      if (!/^\.{0,2}\//.test(spec) && pattern !== SPECIFIERS[2]) {
        errors.push(
          `${file}: import „${spec}” rozwiązuje tylko bundler — przeglądarka odrzuci cały moduł. Użyj ścieżki względnej („./…”).`
        );
        continue;
      }
      const target = path.join(path.dirname(file), spec);
      if (!exists(target)) errors.push(`${file}: „${spec}” wskazuje nieistniejący plik ${target}.`);
      else if (target.endsWith('.js')) errors.push(...checkModule(target, read, exists, seen));
    }
  }
  return errors;
};

// Arkusz stylów: każdy url(…) i @import ma wskazywać plik z repozytorium.
// Zewnętrzny adres (np. fonts.googleapis.com) blokuje renderowanie i wysyła
// IP odwiedzającego do obcej firmy — tak ładowały się czcionki do 1.2.0.
const checkStylesheet = (file, read, exists) => {
  const errors = [];
  // Bez komentarzy: słowo „@import” w objaśnieniu to nie odwołanie do pliku.
  const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
  const refs = [...css.matchAll(/@import\s+(?:url\()?\s*['"]?([^'")\s;]+)|url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map(
    (m) => m[1] || m[2]
  );
  for (const ref of new Set(refs)) {
    if (/^[a-z]+:|^\/\//i.test(ref)) {
      errors.push(`${file}: zasób zewnętrzny „${ref}” — skopiuj go do repozytorium.`);
      continue;
    }
    const target = path.join(path.dirname(file), ref);
    if (!exists(target)) errors.push(`${file}: „${ref}” wskazuje nieistniejący plik ${target}.`);
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
    if (asset.endsWith('.js')) errors.push(...checkModule(path.normalize(asset), read, exists));
    if (asset.endsWith('.css')) errors.push(...checkStylesheet(path.normalize(asset), read, exists));
  }
  return errors;
};

test('strona podana wprost ładuje wszystkie moduły i style z repozytorium — inaczej wyświetla martwą stronę albo sięga do obcych serwerów', () => {
  const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
  const exists = (file) => fs.existsSync(path.join(ROOT, file));
  assert.deepEqual(checkPage(read, exists), []);
});

test('kontrola odrzuca import pakietu (także w workerze), brakujący plik i brakujący zasób strony', () => {
  const files = {
    'index.html': '<link rel="stylesheet" href="style.css"><script src="index.js" type="module"></script>',
    'index.js': "import fs from 'fs';\nimport './missing.js';\nnew Worker(new URL('worker.js', import.meta.url));",
    'worker.js': "import './core.js';",
    'core.js': "import { shuffle } from 'lodash';",
  };
  const errors = checkPage(
    (file) => files[file],
    (file) => file in files
  );
  assert.equal(errors.length, 4, errors.join('\n'));
  assert.match(errors.join('\n'), /style\.css/);
  assert.match(errors.join('\n'), /„fs”/);
  assert.match(errors.join('\n'), /missing\.js/);
  assert.match(errors.join('\n'), /core\.js: import „lodash”/);
});

test('kontrola arkusza odrzuca zewnętrzny @import i brakującą czcionkę', () => {
  const files = {
    'index.html': '<link rel="stylesheet" href="style.css">',
    'style.css':
      "/* @import w komentarzu się nie liczy */\n@import url('https://fonts.googleapis.com/css2?family=Roboto');\n@font-face { src: url('fonts/a.woff2') format('woff2'); }\n@font-face { src: url(fonts/missing.woff2); }",
    'fonts/a.woff2': '',
  };
  const errors = checkPage(
    (file) => files[file],
    (file) => file in files
  );
  assert.equal(errors.length, 2, errors.join('\n'));
  assert.match(errors.join('\n'), /zasób zewnętrzny „https:\/\/fonts\.googleapis\.com/);
  assert.match(errors.join('\n'), /missing\.woff2/);
});
