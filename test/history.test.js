// Historia wygranych w localStorage (history.js). Awarie, przed którymi chroni:
// - zapis przed akceptacją banera — dane lądują w przeglądarce bez zgody;
// - historia rosnąca bez końca, aż przeglądarka odmówi każdego zapisu;
// - uszkodzony albo obcy wpis w magazynie wysypuje stronę przy starcie;
// - baner zgody wracający po każdej symulacji albo nigdy po odmowie;
// - magazyn, który rzuca (zablokowane dane, pełny) — wyjątek w obsłudze wyniku
//   zostawiłby stronę w stanie „symulacja w toku”.
// - historia sprzed Eurojackpota (wpisy bez gry) znika albo trafia do złej gry;
// - wpis Eurojackpota odrzucony albo przyjęty wbrew zasadom gry;
// - wygrane jednej gry wypychają z historii drugą;
// - zestaw generatora zapisany jako wygrana symulatora (albo odwrotnie),
//   zapisany bez zgody albo z liczbą trafień, której strona nie pokaże.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  readGenerated,
  readHistory,
  recordGenerated,
  recordWin,
  hasConsent,
  giveConsent,
  GENERATED_KEY,
  HISTORY_KEY,
  CONSENT_KEY,
  HISTORY_LIMIT,
  CONSENT_REMINDER_EVERY,
  consentReminderDue,
  LEGACY_GAME,
} = require('../history.js');

// Minimalny odpowiednik localStorage: napisy pod kluczami.
const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    data,
  };
};

const throwingStorage = () => ({
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
});

const win = (drawsNumber, date = 1_790_000_000_000) => ({
  game: 'lotto',
  numbers: ['42', '7', '13', '21', '28', '35'],
  drawsNumber,
  date,
});

const euroWin = (drawsNumber, date = 1_790_000_000_000) => ({
  game: 'eurojackpot',
  numbers: ['47', '4', '31', '9', '23', '11', '3'],
  drawsNumber,
  date,
});

test('bez zgody wygrana nie trafia do magazynu', () => {
  const storage = memoryStorage();
  assert.deepEqual(recordWin(storage, win(100)), []);
  assert.equal(storage.data.has(HISTORY_KEY), false);
});

test('po zgodzie wygrana trafia na początek, z liczbami rosnąco jako liczby', () => {
  const storage = memoryStorage();
  assert.equal(giveConsent(storage), true);
  assert.equal(hasConsent(storage), true);
  recordWin(storage, win(100, 1));
  const history = recordWin(storage, win(200, 2));
  assert.deepEqual(history, readHistory(storage));
  assert.deepEqual(
    history.map((entry) => entry.drawsNumber),
    [200, 100]
  );
  assert.deepEqual(history[0].numbers, [7, 13, 21, 28, 35, 42]);
});

test(`historia trzyma ${HISTORY_LIMIT} najnowszych wpisów, najstarszy wypada`, () => {
  const storage = memoryStorage({ [CONSENT_KEY]: 'accepted' });
  let history;
  for (let i = 1; i <= HISTORY_LIMIT + 1; i++) history = recordWin(storage, win(i, i));
  assert.equal(history.length, HISTORY_LIMIT);
  assert.equal(history[0].drawsNumber, HISTORY_LIMIT + 1);
  assert.equal(history.at(-1).drawsNumber, 2);
});

test('uszkodzony JSON i obce wpisy nie wysypują odczytu, a kolejny zapis naprawia magazyn', () => {
  assert.deepEqual(readHistory(memoryStorage({ [HISTORY_KEY]: '{nie json' })), []);
  assert.deepEqual(readHistory(memoryStorage({ [HISTORY_KEY]: '{"a":1}' })), []);

  const good = { numbers: [1, 2, 3, 4, 5, 6], drawsNumber: 10, date: 5 };
  const foreign = [
    good,
    { numbers: [1, 2, 3], drawsNumber: 10, date: 5 },
    { numbers: [1, 2, 3, 4, 5, 50], drawsNumber: 1, date: 1 },
    { numbers: ['1', '2', '3', '4', '5', '6'], drawsNumber: 1, date: 1 },
    { game: 'keno', numbers: [1, 2, 3, 4, 5, 6], drawsNumber: 1, date: 1 },
    { game: 'toString', numbers: [1, 2, 3, 4, 5, 6], drawsNumber: 1, date: 1 },
    { game: 'eurojackpot', numbers: [1, 2, 3, 4, 5, 6], drawsNumber: 1, date: 1 },
    { game: 'eurojackpot', numbers: [1, 2, 3, 4, 5, 1, 13], drawsNumber: 1, date: 1 },
    { game: 'eurojackpot', numbers: [1, 2, 3, 4, 5, 2, 2], drawsNumber: 1, date: 1 },
    null,
    'x',
  ];
  assert.deepEqual(readHistory(memoryStorage({ [HISTORY_KEY]: JSON.stringify(foreign) })), [
    { game: 'lotto', ...good },
  ]);

  const storage = memoryStorage({ [HISTORY_KEY]: '{nie json', [CONSENT_KEY]: 'accepted' });
  assert.equal(recordWin(storage, win(7)).length, 1);
  assert.equal(readHistory(storage).length, 1);
});

test('rzucający magazyn: brak wyjątku, brak zgody, pusta historia', () => {
  const storage = throwingStorage();
  assert.deepEqual(readHistory(storage), []);
  assert.equal(hasConsent(storage), false);
  assert.equal(giveConsent(storage), false);
  assert.deepEqual(recordWin(storage, win(1)), []);
});

test('pełny magazyn: zapis się nie udaje, historia zostaje jak była', () => {
  const storage = memoryStorage({ [CONSENT_KEY]: 'accepted' });
  recordWin(storage, win(1, 1));
  storage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  const history = recordWin(storage, win(2, 2));
  assert.deepEqual(
    history.map((entry) => entry.drawsNumber),
    [1]
  );
});

test('wygrana z kuponem niepasującym do gry albo bez gry to błąd programu, nie cichy wpis', () => {
  const storage = memoryStorage({ [CONSENT_KEY]: 'accepted' });
  for (const bad of [
    { game: 'lotto', numbers: ['1', '2'] },
    { game: 'eurojackpot', numbers: ['1', '2', '3', '4', '5', '6'] },
    { game: 'eurojackpot', numbers: ['1', '2', '3', '4', '5', '1', '13'] },
    // Bez gry wygrana Eurojackpota nie może po cichu wejść jako Lotto
    // (LEGACY_GAME jest tylko dla odczytu), a kupon Lotto — bez gry w ogóle.
    { numbers: ['1', '2', '3', '4', '5', '6'] },
    { game: 'keno', numbers: ['1', '2', '3', '4', '5', '6'] },
  ]) {
    assert.throws(() => recordWin(storage, { ...bad, drawsNumber: 5, date: 1 }), RangeError, JSON.stringify(bad));
  }
  assert.equal(storage.data.has(HISTORY_KEY), false);
});

test(`historia sprzed Eurojackpota (wpisy bez gry) czyta się jako ${LEGACY_GAME} i zostaje po kolejnym zapisie`, () => {
  const old = [
    { numbers: [7, 13, 21, 28, 35, 42], drawsNumber: 300, date: 2 },
    { numbers: [1, 2, 3, 4, 5, 6], drawsNumber: 200, date: 1 },
  ];
  const storage = memoryStorage({ [HISTORY_KEY]: JSON.stringify(old), [CONSENT_KEY]: 'accepted' });
  assert.deepEqual(
    readHistory(storage),
    old.map((entry) => ({ game: 'lotto', ...entry }))
  );
  const history = recordWin(storage, euroWin(400, 3));
  assert.deepEqual(
    history.map(({ game, drawsNumber }) => [game, drawsNumber]),
    [
      ['eurojackpot', 400],
      ['lotto', 300],
      ['lotto', 200],
    ]
  );
  assert.deepEqual(readHistory(storage), history);
});

test('wygrana Eurojackpota trafia z grą i liczbami każdej puli rosnąco — pule się nie mieszają', () => {
  const storage = memoryStorage({ [CONSENT_KEY]: 'accepted' });
  const [entry] = recordWin(storage, euroWin(100));
  assert.deepEqual(entry, {
    game: 'eurojackpot',
    numbers: [4, 9, 23, 31, 47, 3, 11],
    drawsNumber: 100,
    date: 1_790_000_000_000,
  });
  assert.deepEqual(readHistory(storage), [entry]);
});

test(`limit ${HISTORY_LIMIT} wpisów liczy się osobno dla każdej gry — inaczej jedna gra wypycha drugą`, () => {
  const storage = memoryStorage({ [CONSENT_KEY]: 'accepted' });
  recordWin(storage, euroWin(1, 1));
  let history;
  for (let i = 1; i <= HISTORY_LIMIT + 1; i++) history = recordWin(storage, win(i, i + 1));
  const lotto = history.filter(({ game }) => game === 'lotto');
  assert.equal(lotto.length, HISTORY_LIMIT);
  assert.equal(lotto.at(-1).drawsNumber, 2, 'Najstarszy wpis Lotto miał wypaść.');
  assert.deepEqual(
    history.filter(({ game }) => game === 'eurojackpot').map(({ drawsNumber }) => drawsNumber),
    [1],
    'Wpis Eurojackpota wypadł przez wygrane Lotto.'
  );
  assert.equal(history.at(-1).game, 'eurojackpot', 'Kolejność wpisów (od najnowszego) się zmieniła.');
});

test(`bez zgody baner wraca dokładnie po co ${CONSENT_REMINDER_EVERY}. ukończonej symulacji — inaczej zasłania każdy wynik albo odmowa jest ostateczna`, () => {
  const due = Array.from({ length: 3 * CONSENT_REMINDER_EVERY + 1 }, (_, runs) => runs).filter(consentReminderDue);
  assert.deepEqual(
    due,
    [1, 2, 3].map((n) => n * CONSENT_REMINDER_EVERY)
  );
});

// Generowanie Eurojackpota: dwa zestawy, pierwszy padł `hits` razy.
const generated = (hits, date = 1_790_000_000_000) => ({
  game: 'eurojackpot',
  sets: [
    { numbers: [47, 4, 31, 9, 23, 11, 3], hits },
    { numbers: [1, 2, 3, 4, 5, 1, 2], hits: 1 },
  ],
  drawsNumber: 10_000_000,
  date,
});

test('bez zgody generowanie nie trafia do magazynu', () => {
  const storage = memoryStorage();
  assert.deepEqual(recordGenerated(storage, generated(5)), []);
  assert.equal(storage.data.size, 0);
});

test('generowanie trafia na własną listę jako jeden wpis ze wszystkimi zestawami — nie między wygrane symulatora', () => {
  const storage = memoryStorage({ [CONSENT_KEY]: 'accepted' });
  recordWin(storage, win(100));
  recordGenerated(storage, generated(5, 1));
  const list = recordGenerated(storage, generated(7, 2));
  const sets = (hits) => [
    { numbers: [4, 9, 23, 31, 47, 3, 11], hits },
    { numbers: [1, 2, 3, 4, 5, 1, 2], hits: 1 },
  ];
  assert.deepEqual(list, [
    { game: 'eurojackpot', sets: sets(7), drawsNumber: 10_000_000, date: 2 },
    { game: 'eurojackpot', sets: sets(5), drawsNumber: 10_000_000, date: 1 },
  ]);
  assert.deepEqual(readGenerated(storage), list);
  assert.deepEqual(
    readHistory(storage).map(({ game, drawsNumber }) => [game, drawsNumber]),
    [['lotto', 100]]
  );
  // Tak czyta wspólny klucz karta sprzed 1.16.0: nie może w nim być zestawów.
  assert.equal(JSON.parse(storage.getItem(HISTORY_KEY)).length, 1);
  assert.equal(JSON.parse(storage.getItem(GENERATED_KEY)).length, 2);
});

test('obce i uszkodzone wpisy generatora odpadają przy odczycie — strona pokazałaby „undefined razy” albo tysiące kul', () => {
  const set = { numbers: [1, 2, 3, 4, 5, 6], hits: 2 };
  const good = { game: 'lotto', sets: [set, { numbers: [7, 8, 9, 10, 11, 12], hits: 1 }], drawsNumber: 10, date: 5 };
  const foreign = [
    good,
    // Wygrana symulatora (bez zestawów) i wpis bez gry.
    { game: 'lotto', numbers: [1, 2, 3, 4, 5, 6], drawsNumber: 10, date: 5 },
    { sets: [set], drawsNumber: 10, date: 5 },
    { ...good, sets: [] },
    { ...good, sets: 'x' },
    { ...good, sets: Array.from({ length: 21 }, () => set) },
    { ...good, sets: [set, { ...set, hits: 0 }] },
    { ...good, sets: [{ ...set, hits: 11 }] },
    { ...good, sets: [{ ...set, hits: '2' }] },
    { ...good, sets: [{ ...set, numbers: [1, 2, 3, 4, 5, 50] }] },
    { ...good, sets: [null] },
    { ...good, game: 'toString' },
    null,
  ];
  assert.deepEqual(readGenerated(memoryStorage({ [GENERATED_KEY]: JSON.stringify(foreign) })), [good]);
  assert.deepEqual(readGenerated(memoryStorage({ [GENERATED_KEY]: '{nie json' })), []);
  assert.deepEqual(readGenerated(throwingStorage()), []);
});

test('generowanie z zestawem niepasującym do gry, bez trafień albo bez zestawów to błąd programu, nie cichy wpis', () => {
  const storage = memoryStorage({ [CONSENT_KEY]: 'accepted' });
  const [set] = generated(5).sets;
  for (const bad of [
    { game: 'lotto' },
    { game: undefined },
    { sets: [] },
    { sets: undefined },
    { sets: [{ ...set, hits: undefined }] },
    { sets: [set, { ...set, hits: 0 }] },
    { sets: [set, { numbers: [1, 2, 3], hits: 1 }] },
  ]) {
    assert.throws(() => recordGenerated(storage, { ...generated(5), ...bad }), RangeError, JSON.stringify(bad));
  }
  assert.equal(storage.data.has(GENERATED_KEY), false);
});

test(`limit ${HISTORY_LIMIT} generowań na grę nie zabiera miejsca wygranym symulatora`, () => {
  const storage = memoryStorage({ [CONSENT_KEY]: 'accepted' });
  recordWin(storage, euroWin(1));
  let list;
  for (let i = 1; i <= HISTORY_LIMIT + 1; i++) list = recordGenerated(storage, generated(5, i));
  assert.equal(list.length, HISTORY_LIMIT);
  assert.equal(list.at(-1).date, 2, 'Najstarsze generowanie miało wypaść.');
  assert.equal(readHistory(storage).length, 1);
});
