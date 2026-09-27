// Czcionki w fonts/ są kopiami plików z pakietów Fontsource (fonts/README.md).
// Awaria: plik podmieniony albo dopisany bez sprawdzenia pochodzenia — strona
// podaje wtedy czcionkę, której nikt nie porównał z opublikowanym pakietem.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FONTS = path.join(__dirname, '..', 'fonts');

test('każdy plik czcionki ma zgodną sumę w fonts/SHA256SUMS', () => {
  const sums = new Map(
    fs
      .readFileSync(path.join(FONTS, 'SHA256SUMS'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.split(/\s+/))
      .map(([sum, file]) => [file, sum])
  );
  const files = fs.readdirSync(FONTS).filter((file) => file.endsWith('.woff2'));
  assert.deepEqual([...sums.keys()].sort(), files.sort(), 'Lista w SHA256SUMS nie zgadza się z plikami w fonts/ — zobacz fonts/README.md.');
  for (const file of files) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(FONTS, file))).digest('hex');
    assert.equal(actual, sums.get(file), `${file}: suma inna niż w SHA256SUMS — plik zmieniony poza procedurą z fonts/README.md.`);
  }
});
