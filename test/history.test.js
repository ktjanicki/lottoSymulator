// Historia wygranych w localStorage (history.js). Awarie, przed którymi chroni:
// - zapis przed akceptacją banera — dane lądują w przeglądarce bez zgody;
// - historia rosnąca bez końca, aż przeglądarka odmówi każdego zapisu;
// - uszkodzony albo obcy wpis w magazynie wysypuje stronę przy starcie;
// - baner zgody wracający po każdej symulacji albo nigdy po odmowie;
// - magazyn, który rzuca (zablokowane dane, pełny) — wyjątek w obsłudze wyniku
//   zostawiłby stronę w stanie „symulacja w toku”.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  readHistory,
  recordWin,
  hasConsent,
  giveConsent,
  HISTORY_KEY,
  CONSENT_KEY,
  HISTORY_LIMIT,
  CONSENT_REMINDER_EVERY,
  consentReminderDue,
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

const win = (drawsNumber, date = 1_790_000_000_000) => ({ numbers: ['42', '7', '13', '21', '28', '35'], drawsNumber, date });

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
  const foreign = [good, { numbers: [1, 2, 3], drawsNumber: 10, date: 5 }, { numbers: [1, 2, 3, 4, 5, 50], drawsNumber: 1, date: 1 }, null, 'x'];
  assert.deepEqual(readHistory(memoryStorage({ [HISTORY_KEY]: JSON.stringify(foreign) })), [good]);

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

test('wygrana z kuponem niepasującym do gry to błąd programu, nie cichy wpis', () => {
  const storage = memoryStorage({ [CONSENT_KEY]: 'accepted' });
  assert.throws(() => recordWin(storage, { numbers: ['1', '2'], drawsNumber: 5, date: 1 }), RangeError);
  assert.equal(storage.data.has(HISTORY_KEY), false);
});

test(`bez zgody baner wraca dokładnie po co ${CONSENT_REMINDER_EVERY}. ukończonej symulacji — inaczej zasłania każdy wynik albo odmowa jest ostateczna`, () => {
  const due = Array.from({ length: 3 * CONSENT_REMINDER_EVERY + 1 }, (_, runs) => runs).filter(consentReminderDue);
  assert.deepEqual(due, [1, 2, 3].map((n) => n * CONSENT_REMINDER_EVERY));
});
