// Zgodność numeru wydania. Jedynym źródłem jest plik VERSION; wszystko inne
// (package.json, package-lock.json, CHANGELOG.md, tagi v*) ma się z nim zgadzać.
// Każda kontrola to funkcja zwracająca listę błędów — ta sama funkcja sprawdza
// prawdziwe repozytorium i spreparowane złe dane, więc test gałęzi odrzucającej
// jest testem tego samego kodu, który pilnuje repozytorium.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// Stała lista sekcji z CLAUDE.md. Nowa nazwa (np. „Added”) rozbija czytelność
// changeloga — dopisz ją tutaj tylko po zmianie konwencji.
const CHANGELOG_SECTIONS = ['Dodane', 'Zmienione', 'Poprawione', 'Usunięte', 'Znane ograniczenia'];

// Bez sufiksów typu -rc.1: wydań przedpremierowych nie ma.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASE_HEADING = /^## \[([^\]]+)\] — (\d{4}-\d{2}-\d{2})$/;

const parseSemver = (text) => {
  const match = SEMVER.exec(text);
  return match ? match.slice(1).map(Number) : null;
};

const compareSemver = (a, b) => {
  const [x, y] = [parseSemver(a), parseSemver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

const parseChangelog = (text) => {
  const releases = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      const match = RELEASE_HEADING.exec(line);
      releases.push(match ? { version: match[1], date: match[2], sections: [] } : { invalid: line, sections: [] });
    } else if (line.startsWith('### ') && releases.length) {
      releases[releases.length - 1].sections.push(line.slice(4).trim());
    }
  }
  return releases;
};

const checkVersionFile = (raw) => {
  const errors = [];
  if (!raw.endsWith('\n') || raw.trim() + '\n' !== raw) {
    errors.push('VERSION ma zawierać jedną linię z numerem i znakiem nowej linii — bez spacji i pustych linii.');
  }
  if (!parseSemver(raw.trim())) {
    errors.push(`VERSION „${raw.trim()}” nie jest numerem X.Y.Z (bez sufiksów przedpremierowych).`);
  }
  return errors;
};

const checkNpmVersions = (version, pkg, lock) => {
  const errors = [];
  if (pkg.version !== version) {
    errors.push(`package.json ma wersję ${pkg.version}, VERSION — ${version}. Popraw pole "version" w package.json.`);
  }
  const lockVersions = [lock.version, lock.packages && lock.packages[''] && lock.packages[''].version];
  if (lockVersions.some((v) => v !== undefined && v !== version)) {
    errors.push(`package-lock.json ma wersję ${lockVersions.join(' / ')}, VERSION — ${version}. Uruchom „npm install”.`);
  }
  return errors;
};

const checkChangelog = (version, text) => {
  const errors = [];
  const releases = parseChangelog(text);
  if (!releases.length) return ['CHANGELOG.md nie ma żadnego wydania („## [X.Y.Z] — RRRR-MM-DD”).'];

  for (const release of releases) {
    if (release.invalid !== undefined) {
      errors.push(`Nagłówek „${release.invalid}” w CHANGELOG.md ma mieć postać „## [X.Y.Z] — RRRR-MM-DD”.`);
      continue;
    }
    if (!parseSemver(release.version)) errors.push(`Wydanie „${release.version}” w CHANGELOG.md nie jest numerem X.Y.Z.`);
    if (!release.sections.length) errors.push(`Wydanie ${release.version} w CHANGELOG.md nie ma żadnej sekcji.`);
    for (const section of release.sections) {
      if (!CHANGELOG_SECTIONS.includes(section)) {
        errors.push(`Sekcja „${section}” w wydaniu ${release.version} spoza listy: ${CHANGELOG_SECTIONS.join(', ')}.`);
      }
    }
  }
  if (errors.length) return errors;

  if (releases[0].version !== version) {
    errors.push(`Najnowsze wydanie w CHANGELOG.md to ${releases[0].version}, VERSION — ${version}. Dopisz sekcję wydania na górze.`);
  }
  for (let i = 1; i < releases.length; i++) {
    if (compareSemver(releases[i - 1].version, releases[i].version) <= 0) {
      errors.push(`CHANGELOG.md: ${releases[i - 1].version} stoi nad ${releases[i].version} — wydania mają iść od najnowszego, bez powtórzeń.`);
    }
  }
  return errors;
};

// versionAtTag: tag → zawartość VERSION w otagowanym commicie (albo null).
const checkTags = (version, changelogText, tags, versionAtTag) => {
  const errors = [];
  const released = new Set(parseChangelog(changelogText).map((r) => r.version));
  for (const tag of tags) {
    const tagVersion = tag.slice(1);
    if (!parseSemver(tagVersion)) {
      errors.push(`Tag ${tag} nie ma postaci vX.Y.Z.`);
      continue;
    }
    if (!released.has(tagVersion)) errors.push(`Tag ${tag} nie ma wydania w CHANGELOG.md.`);
    if (compareSemver(tagVersion, version) > 0) errors.push(`Tag ${tag} jest nowszy niż VERSION (${version}).`);
    const tagged = versionAtTag(tag);
    if (tagged !== tagVersion) {
      errors.push(`Tag ${tag} wskazuje commit, w którym VERSION to „${tagged}” — tag postawiono na złym commicie.`);
    }
  }
  return errors;
};

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const hasGit = fs.existsSync(path.join(ROOT, '.git'));

const repoVersion = () => read('VERSION').trim();

test('VERSION to czysty numer X.Y.Z — inaczej reszta kontroli porównuje z niczym', () => {
  assert.deepEqual(checkVersionFile(read('VERSION')), []);
});

test('package.json i package-lock.json niosą numer z VERSION — inaczej npm pokazuje inną wersję niż wydanie', () => {
  const errors = checkNpmVersions(repoVersion(), JSON.parse(read('package.json')), JSON.parse(read('package-lock.json')));
  assert.deepEqual(errors, []);
});

test('CHANGELOG.md zaczyna się od wydania z VERSION — inaczej wydanie wychodzi bez opisu zmian', () => {
  assert.deepEqual(checkChangelog(repoVersion(), read('CHANGELOG.md')), []);
});

test('każdy tag v* ma wydanie w CHANGELOG.md i stoi na commicie z tym numerem — inaczej tag kłamie o stanie kodu', { skip: !hasGit && 'brak .git' }, () => {
  const tags = git('tag', '--list', 'v*').split('\n').filter(Boolean);
  const versionAtTag = (tag) => {
    try {
      return git('show', `${tag}:VERSION`).trim();
    } catch {
      return null;
    }
  };
  assert.deepEqual(checkTags(repoVersion(), read('CHANGELOG.md'), tags, versionAtTag), []);
});

// Gałęzie odrzucające: repozytorium dziś ich nie uruchamia, więc bez tych
// przypadków zepsuta kontrola przechodziłaby zawsze na zielono.

test('kontrola VERSION odrzuca wydanie przedpremierowe, prefiks „v” i brak nowej linii', () => {
  assert.notDeepEqual(checkVersionFile('1.1.0-rc.1\n'), []);
  assert.notDeepEqual(checkVersionFile('v1.1.0\n'), []);
  assert.notDeepEqual(checkVersionFile('1.1.0'), []);
  assert.notDeepEqual(checkVersionFile('01.1.0\n'), []);
});

test('kontrola npm wyłapuje rozjazd w package.json i w package-lock.json', () => {
  const lock = { version: '1.0.0', packages: { '': { version: '1.0.0' } } };
  assert.notDeepEqual(checkNpmVersions('1.0.0', { version: '1.0.1' }, lock), []);
  assert.notDeepEqual(checkNpmVersions('1.0.0', { version: '1.0.0' }, { ...lock, packages: { '': { version: '0.9.0' } } }), []);
});

test('kontrola changeloga wyłapuje brak wydania, obcą sekcję, zły nagłówek i złą kolejność', () => {
  const ok = '## [1.1.0] — 2026-10-01\n\n### Dodane\n\n- x\n\n## [1.0.0] — 2026-09-26\n\n### Dodane\n\n- y\n';
  assert.deepEqual(checkChangelog('1.1.0', ok), []);
  assert.notDeepEqual(checkChangelog('1.2.0', ok), [], 'VERSION bez wpisu w changelogu');
  assert.notDeepEqual(checkChangelog('1.1.0', ok.replace('### Dodane', '### Added')), [], 'sekcja spoza listy');
  assert.notDeepEqual(checkChangelog('1.1.0', ok.replace('## [1.1.0] — 2026-10-01', '## 1.1.0')), [], 'nagłówek bez daty');
  assert.notDeepEqual(checkChangelog('1.1.0', '## [1.1.0] — 2026-10-01\n\n- x\n'), [], 'wydanie bez sekcji');
  const reversed = '## [1.0.0] — 2026-09-26\n\n### Dodane\n\n## [1.1.0] — 2026-10-01\n\n### Dodane\n';
  assert.notDeepEqual(checkChangelog('1.0.0', reversed), [], 'odwrócona kolejność');
});

test('kontrola tagów wyłapuje tag bez wydania, tag z przyszłości i tag na złym commicie', () => {
  const changelog = '## [1.0.0] — 2026-09-26\n\n### Dodane\n';
  const at = (map) => (tag) => map[tag] ?? null;
  assert.deepEqual(checkTags('1.0.0', changelog, ['v1.0.0'], at({ 'v1.0.0': '1.0.0' })), []);
  assert.notDeepEqual(checkTags('1.0.0', changelog, ['v0.9.0'], at({ 'v0.9.0': '0.9.0' })), [], 'brak wydania');
  assert.notDeepEqual(checkTags('1.0.0', changelog, ['v2.0.0'], at({ 'v2.0.0': '2.0.0' })), [], 'tag nowszy niż VERSION');
  assert.notDeepEqual(checkTags('1.0.0', changelog, ['v1.0.0'], at({})), [], 'tag przed commitem z VERSION');
  assert.notDeepEqual(checkTags('1.0.0', changelog, ['v1.0'], at({})), [], 'zła postać tagu');
});
