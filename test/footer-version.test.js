// Stopka pokazuje numer z pliku VERSION, pobierany przez stronę w czasie
// działania; build Parcela kopiuje ten plik do dist/ pod nazwą z sumą.
// Awaria, przed którą chroni: numer wpisany na sztywno albo plik zgubiony
// w buildzie — stopka pokazuje wtedy starą wersję albo samo „wersja”.
// Build idzie na kopii źródeł z podmienionym VERSION (9.9.9): numer
// z repozytorium mógłby trafić do paczki także z literału.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
// Źródła aplikacji; nowy plik importowany przez stronę trzeba dopisać tutaj,
// inaczej build kopii przerwie się błędem „cannot resolve”.
const SOURCES = ['index.html', 'index.js', 'simulationWorker.js', 'style.css', 'package.json'];
const FAKE_VERSION = '9.9.9';

test('zbudowana strona pobiera numer z VERSION — inaczej stopka kłamie po kolejnym wydaniu', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lotto-footer-'));
  try {
    for (const file of SOURCES) fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
    fs.writeFileSync(path.join(dir, 'VERSION'), `${FAKE_VERSION}\n`);
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');

    execFileSync(path.join(ROOT, 'node_modules', '.bin', 'parcel'), ['build', 'index.html', '--no-cache'], {
      cwd: dir,
      stdio: 'pipe',
    });

    const dist = path.join(dir, 'dist');
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    assert.match(html, /<footer[^>]*>[\s\S]*class=["']?appVersion/, 'Brak stopki z elementem .appVersion w index.html.');

    const files = fs.readdirSync(dist);
    const versionFile = files.find((file) => fs.readFileSync(path.join(dist, file), 'utf8') === `${FAKE_VERSION}\n`);
    assert.ok(versionFile, `Build nie skopiował VERSION (${FAKE_VERSION}) do dist/ — stopka dostanie 404.`);

    const bundle = files
      .filter((file) => file.endsWith('.js'))
      .map((file) => fs.readFileSync(path.join(dist, file), 'utf8'))
      .join('\n');
    // Parcel wpisuje nazwę pliku do importmapy w index.html, a skrypt sięga po nią
    // przez import.meta.resolve — dlatego szukamy w obu miejscach.
    assert.ok((html + bundle).includes(versionFile), `Strona nie odwołuje się do ${versionFile}.`);
    const repoVersion = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
    assert.ok(!bundle.includes(repoVersion), `Paczka zawiera numer ${repoVersion} z repozytorium — jest wpisany na sztywno.`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
