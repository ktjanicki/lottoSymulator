// Rdzeń symulacji (simulation.js). Awarie, przed którymi chroni:
// - pomyłka o jeden w mnożniku losowania po cichu wycina skrajną liczbę
//   (tak było w 1.0.2) — kupon z nią nigdy nie wygra, symulacja nie kończy się;
// - losowanie nierównomierne albo z powtórkami — wyniki „ile losowań do szóstki”
//   przestają odpowiadać prawdziwej grze, a nic się nie wysypuje;
// - źle policzone trójki/czwórki/piątki w podsumowaniu.
// Generator z ziarnem albo skrypt wartości random — wynik testu nie zależy od losu.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPool, drawSix, simulateUntilWin, simulation, MAX_NUMBER } = require('../simulation.js');

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
