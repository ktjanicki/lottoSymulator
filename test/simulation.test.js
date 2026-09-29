// Rdzeń symulacji (simulation.js). Awarie, przed którymi chroni:
// - pomyłka o jeden w mnożniku losowania po cichu wycina skrajną liczbę
//   (tak było w 1.0.2) — kupon z nią nigdy nie wygra, symulacja nie kończy się;
// - losowanie nierównomierne albo z powtórkami — wyniki „ile losowań do szóstki”
//   przestają odpowiadać prawdziwej grze, a nic się nie wysypuje;
// - źle policzone trójki/czwórki/piątki w podsumowaniu.
// Generator z ziarnem albo skrypt wartości random — wynik testu nie zależy od losu.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPool, drawSix, simulateUntilWin, simulation, MAX_NUMBER, PROGRESS_EVERY } = require('../simulation.js');

// mulberry32: mały generator z ziarnem, wystarczający do testu rozkładu.
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Podaje kolejne wartości; po wyczerpaniu przerywa symulację wyjątkiem
// zamiast pozwolić jej kręcić się bez końca.
const scripted = (values) => () => {
  if (!values.length) throw new Error('Skrypt wartości random wyczerpany — symulacja nie zakończyła się wygraną.');
  return values.shift();
};

const TOP = 1 - Number.EPSILON;

test('skrajne wartości random dają 1 i 49 — inaczej skrajna liczba nigdy nie wypada', () => {
  assert.deepEqual([...drawSix(createPool(), () => 0)], [1, 2, 3, 4, 5, 6]);
  assert.equal(drawSix(createPool(), () => TOP)[0], MAX_NUMBER);
});

test('losowanie daje 6 różnych liczb 1–49, każdą równie często — inaczej symulacja nie odpowiada grze', () => {
  const random = seeded(2026);
  const pool = createPool();
  const counts = new Array(MAX_NUMBER + 1).fill(0);
  const DRAWS = 100_000;
  for (let d = 0; d < DRAWS; d++) {
    const drawn = drawSix(pool, random);
    assert.equal(new Set(drawn).size, 6, `Powtórka w losowaniu ${d}: ${[...drawn]}`);
    for (const n of drawn) counts[n]++;
  }
  assert.equal(counts[0], 0, 'Wylosowano 0.');
  const expected = (DRAWS * 6) / MAX_NUMBER;
  for (let n = 1; n <= MAX_NUMBER; n++) {
    assert.ok(Math.abs(counts[n] / expected - 1) < 0.05, `Liczba ${n}: ${counts[n]} razy, oczekiwano ok. ${Math.round(expected)}.`);
  }
});

test('trójki wypadają z teoretyczną częstością 1,765% — inaczej liczenie trafień jest złe', () => {
  const random = seeded(49);
  const pool = createPool();
  const ticket = new Uint8Array(MAX_NUMBER + 1);
  for (const n of [12, 33, 17, 41, 27, 6]) ticket[n] = 1;
  const DRAWS = 1_000_000;
  let threes = 0;
  for (let d = 0; d < DRAWS; d++) {
    const drawn = drawSix(pool, random);
    let matched = 0;
    for (const n of drawn) matched += ticket[n];
    if (matched === 3) threes++;
  }
  // C(6,3)·C(43,3) / C(49,6) = 246 820 / 13 983 816
  assert.ok(Math.abs(threes / DRAWS - 246820 / 13983816) < 0.0005, `Trójki: ${((threes / DRAWS) * 100).toFixed(3)}%.`);
});

test('symulacja kończy się na szóstce i liczy piątki po drodze', () => {
  // Losowanie 1: 1–6 (piątka dla kuponu 1–5 + 49). Losowanie 2: 1–5, potem 49.
  const values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 43 / 44 + 1e-9];
  const result = simulateUntilWin(['1', '2', '3', '4', '5', '49'], scripted(values));
  assert.deepEqual(result, { drawsNumber: 2, threes: 0, fours: 0, fives: 1 });
});

test('zły kupon zgłasza błąd zamiast kręcić się bez końca', () => {
  for (const ticket of [['1', '2', '3', '4', '5'], ['1', '1', '2', '3', '4', '5'], ['0', '1', '2', '3', '4', '5'], ['1', '2', '3', '4', '5', '50'], ['1', '2', '3', '4', '5', 'x']]) {
    assert.throws(() => simulateUntilWin(ticket, () => 0), RangeError, `Kupon ${ticket} przeszedł.`);
  }
});

test('wynik dla strony: kupon posortowany liczbowo, czas, bez licznika operacji', () => {
  const result = simulation(['49', '5', '4', '3', '2', '1'], scripted([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 43 / 44 + 1e-9]));
  assert.equal(result.ticketNumbers, '1, 2, 3, 4, 5, 49');
  assert.ok(Number.isFinite(result.durationMs) && result.durationMs >= 0, `durationMs: ${result.durationMs}`);
  assert.equal('operations' in result, false);
});

// `losing` losowań 1–6 (dla kuponu 1–5 + 49 to piątki), potem losowanie 1–5 + 49.
// Pula po losowaniach z random = 0 zostaje nieruszona, więc skrypt jest dokładny.
const losingThenWin = (losing) => {
  let calls = 0;
  const winning = [0, 0, 0, 0, 0, 43 / 44 + 1e-9];
  return () => (calls < losing * 6 ? (calls++, 0) : winning[calls++ - losing * 6]);
};
const TICKET = ['1', '2', '3', '4', '5', '49'];

test('postęp co progressEvery losowań, bez zgłoszenia w losowaniu z wygraną — inaczej licznik na stronie kłamie albo stoi', () => {
  const every2 = [];
  const result = simulateUntilWin(TICKET, losingThenWin(5), { onProgress: (p) => every2.push(p), progressEvery: 2 });
  assert.equal(result.drawsNumber, 6);
  assert.deepEqual(every2, [
    { drawsNumber: 2, threes: 0, fours: 0, fives: 2 },
    { drawsNumber: 4, threes: 0, fours: 0, fives: 4 },
  ]);
  const every3 = [];
  simulateUntilWin(TICKET, losingThenWin(5), { onProgress: (p) => every3.push(p.drawsNumber), progressEvery: 3 });
  assert.deepEqual(every3, [3], 'Losowanie 6 to wygrana — zgłasza ją wynik, nie postęp.');
});

// Worker ustawia globalne onmessage raz, przy wczytaniu modułu — kolejny
// require zwraca moduł z pamięci podręcznej i niczego nie ustawia, więc
// uchwyt zapamiętujemy przy pierwszym wywołaniu.
let workerHandler;
const runWorker = (data) => {
  const messages = [];
  globalThis.postMessage = (message) => messages.push(message);
  try {
    if (!workerHandler) {
      globalThis.onmessage = null;
      require('../simulationWorker.js');
      workerHandler = globalThis.onmessage;
    }
    workerHandler({ data });
  } finally {
    delete globalThis.postMessage;
    delete globalThis.onmessage;
  }
  return messages;
};

test('worker wysyła postęp i wynik oznaczone polem type — inaczej strona pomyli postęp z wynikiem', () => {
  const originalRandom = Math.random;
  Math.random = losingThenWin(PROGRESS_EVERY + 1);
  let messages;
  try {
    messages = runWorker(TICKET);
  } finally {
    Math.random = originalRandom;
  }
  assert.deepEqual(messages.map((m) => [m.type, m.drawsNumber]), [
    ['progress', PROGRESS_EVERY],
    ['result', PROGRESS_EVERY + 2],
  ]);
  assert.ok(Number.isFinite(messages[0].durationMs), 'Postęp bez czasu trwania.');
});

test('wyjątek w workerze wraca do strony jako {type: error} — inaczej strona czeka na wynik z kręcącym się spinnerem', () => {
  const messages = runWorker(['1', '2', '3', '4', '5']);
  assert.equal(messages.length, 1, `Worker wysłał ${messages.length} wiadomości zamiast jednej: ${JSON.stringify(messages)}.`);
  assert.equal(messages[0].type, 'error');
  assert.match(messages[0].message, /6 różnych liczb/);
});
