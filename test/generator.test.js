// Rdzeń generatora (generator.js). Awarie, przed którymi chroni:
// - numeracja zestawów z dziurą albo powtórką — część zestawów nie pada nigdy
//   albo dwa razy częściej, a wynik dalej wygląda na poprawny;
// - numer zestawu rozłożony na złe liczby — strona pokazuje inny zestaw niż
//   ten, który padł najczęściej (albo liczbę spoza puli, np. 0 lub 50 w Lotto);
// - wynik, który nie jest najczęstszym zestawem albo podaje złą liczbę trafień;
// - licznik przepełniony bez słowa przy zbyt wielu losowaniach (przekręcony
//   przez zero albo stojący na 255 u wielu zestawów naraz);
// - postęp zgłaszany po ostatnim losowaniu albo wcale.
// Generator z ziarnem albo skrypt wartości random — wynik testu nie zależy od losu.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GENERATOR_DRAWS, combinationAt, combinationsCount, generator, mostFrequentDraw } = require('../generator.js');
const { GAMES, PROGRESS_EVERY, splitTicket } = require('../simulation.js');

// mulberry32, jak w test/simulation.test.js.
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Kolejne numery zestawów jako wartości random: (numer + 0,5) / liczba zestawów.
const drawing = (total, indexes) => {
  const values = indexes.map((index) => (index + 0.5) / total);
  return () => {
    if (!values.length) throw new Error('Skrypt wartości random wyczerpany — generator losuje więcej razy, niż miał.');
    return values.shift();
  };
};

// Mała gra na dwie pule: 2 z 5 i 1 z 3 — 30 zestawów, da się wyliczyć wszystkie.
const SMALL = [
  { max: 5, size: 2 },
  { max: 3, size: 1 },
];

test('liczba zestawów zgadza się z zasadami gier — inna rozjeżdża liczniki z numeracją', () => {
  assert.equal(combinationsCount(GAMES.lotto.pools), 13_983_816);
  assert.equal(combinationsCount(GAMES.eurojackpot.pools), 139_838_160);
  assert.equal(combinationsCount(SMALL), 30);
});

test('każdy numer daje inny poprawny zestaw i żadnego nie brakuje — inaczej część zestawów nie pada nigdy', () => {
  const seen = new Set();
  for (let index = 0; index < 30; index++) {
    const [main, extra] = combinationAt(SMALL, index);
    assert.equal(main.length, 2);
    assert.ok(main[0] >= 1 && main[0] < main[1] && main[1] <= 5, `Zestaw nr ${index}: ${main}.`);
    assert.ok(extra.length === 1 && extra[0] >= 1 && extra[0] <= 3, `Zestaw nr ${index}: + ${extra}.`);
    seen.add(`${main} + ${extra}`);
  }
  assert.equal(seen.size, 30);
});

test('skrajne numery to skrajne zestawy gry, a losowe numery to poprawne kupony — także z 1 i z największą liczbą', () => {
  for (const [game, first, last] of [
    ['lotto', [[1, 2, 3, 4, 5, 6]], [[44, 45, 46, 47, 48, 49]]],
    [
      'eurojackpot',
      [
        [1, 2, 3, 4, 5],
        [1, 2],
      ],
      [
        [46, 47, 48, 49, 50],
        [11, 12],
      ],
    ],
  ]) {
    const { pools } = GAMES[game];
    const total = combinationsCount(pools);
    assert.deepEqual(combinationAt(pools, 0), first);
    assert.deepEqual(combinationAt(pools, total - 1), last);
    const random = seeded(7);
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      const numbers = combinationAt(pools, Math.floor(random() * total));
      // splitTicket rzuca przy powtórce i liczbie spoza puli; zwraca pule rosnąco.
      assert.deepEqual(splitTicket(game, numbers.flat()), numbers);
      seen.add(numbers.join('+'));
    }
    assert.ok(seen.size > 1990, `${game}: różne numery dają te same zestawy (${seen.size} z 2000).`);
  }
});

test('wynik to zestaw, który padł najwięcej razy, z liczbą trafień', () => {
  const result = mostFrequentDraw(SMALL, 6, drawing(30, [4, 17, 4, 29, 17, 17]));
  assert.deepEqual(result, { numbers: combinationAt(SMALL, 17), hits: 3, drawsNumber: 6 });
});

test('przy remisie wygrywa zestaw, który pierwszy doszedł do najwyższej liczby trafień', () => {
  const result = mostFrequentDraw(SMALL, 5, drawing(30, [9, 21, 21, 9, 0]));
  assert.deepEqual(result.numbers, combinationAt(SMALL, 21));
  assert.equal(result.hits, 2);
});

test('skrajne wartości random trafiają w pierwszy i ostatni zestaw, nie poza liczniki', () => {
  const { pools } = GAMES.lotto;
  assert.deepEqual(mostFrequentDraw(pools, 2, () => 0).numbers, [[1, 2, 3, 4, 5, 6]]);
  // Największa wartość, jaką zwraca Math.random.
  const result = mostFrequentDraw(pools, 2, () => 1 - Number.EPSILON / 2);
  assert.deepEqual(result, { numbers: [[44, 45, 46, 47, 48, 49]], hits: 2, drawsNumber: 2 });
});

test('wynik zgadza się z naiwnym zliczaniem tych samych losowań — obie gry', () => {
  for (const game of Object.keys(GAMES)) {
    const { pools } = GAMES[game];
    const total = combinationsCount(pools);
    const draws = 200_000;
    // Odniesienie: mapa numer → trafienia, ta sama reguła remisu.
    const random = seeded(2026);
    const counts = new Map();
    let best = 0;
    let bestIndex = -1;
    for (let i = 0; i < draws; i++) {
      const index = Math.floor(random() * total);
      const count = (counts.get(index) ?? 0) + 1;
      counts.set(index, count);
      if (count > best) [best, bestIndex] = [count, index];
    }
    assert.ok(best >= 2, 'Test bez powtórzonego zestawu niczego nie sprawdza.');
    assert.deepEqual(generator(game, draws, seeded(2026)).numbers, combinationAt(pools, bestIndex), game);
    assert.equal(generator(game, draws, seeded(2026)).hits, best, game);
  }
});

test('każda liczba losowań ze strony mieści się w liczniku obu gier — inaczej generator odmawia po kliknięciu', () => {
  assert.deepEqual(GENERATOR_DRAWS, [10e6, 50e6, 100e6, 300e6, 500e6, 1000e6]);
  for (const { pools } of Object.values(GAMES)) {
    for (const draws of GENERATOR_DRAWS) {
      // Bez losowania: sama kontrola wejścia, przerwana pierwszym wywołaniem random.
      const stop = new Error('stop');
      assert.throws(
        () =>
          mostFrequentDraw(pools, draws, () => {
            throw stop;
          }),
        stop
      );
    }
  }
});

test('zbyt wiele losowań na zestaw to błąd, nie przepełniony po cichu licznik', () => {
  assert.throws(() => mostFrequentDraw(SMALL, 30 * 100 + 1, seeded(1)), /Za dużo losowań/);
  // Na granicy liczy: średnio 100 trafień na zestaw, najczęstszy daleko od 255.
  const { hits } = mostFrequentDraw(SMALL, 30 * 100, seeded(1));
  assert.ok(hits > 100 && hits < 255, `Najczęstszy zestaw: ${hits} trafień.`);
});

test('liczba losowań inna niż dodatnia całkowita to błąd z komunikatem', () => {
  for (const draws of [0, -5, 1.5, NaN, '10', undefined]) {
    assert.throws(() => mostFrequentDraw(SMALL, draws, seeded(1)), /Liczba losowań/, String(draws));
  }
  assert.throws(() => generator('keno', 10), /Nieznana gra/);
});

test('postęp co progressEvery losowań, bez zgłoszenia po ostatnim — koniec zgłasza wynik', () => {
  const progress = [];
  const result = generator('lotto', 9, seeded(3), { onProgress: (p) => progress.push(p), progressEvery: 3 });
  assert.deepEqual(
    progress.map((p) => p.drawsNumber),
    [3, 6]
  );
  assert.ok(
    progress.every((p) => Number.isFinite(p.durationMs)),
    'Postęp bez czasu trwania.'
  );
  assert.equal(result.drawsNumber, 9);
  assert.ok(Number.isFinite(result.durationMs));
});

// Worker ustawia globalne onmessage przy wczytaniu modułu (patrz test/simulation.test.js).
test('worker w trybie generatora wysyła postęp i wynik z zestawem — inaczej strona nie ma czego pokazać', () => {
  const messages = [];
  globalThis.postMessage = (message) => messages.push(message);
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    globalThis.onmessage = null;
    delete require.cache[require.resolve('../simulationWorker.js')];
    require('../simulationWorker.js');
    globalThis.onmessage({ data: { mode: 'generator', game: 'eurojackpot', draws: PROGRESS_EVERY + 1 } });
  } finally {
    Math.random = originalRandom;
    delete globalThis.postMessage;
    delete globalThis.onmessage;
  }
  assert.deepEqual(
    messages.map((m) => [m.type, m.drawsNumber]),
    [
      ['progress', PROGRESS_EVERY],
      ['result', PROGRESS_EVERY + 1],
    ]
  );
  assert.deepEqual(messages[1].numbers, [
    [1, 2, 3, 4, 5],
    [1, 2],
  ]);
  // random = 0 to milion trafień jednego zestawu: licznik staje na 255,
  // zamiast przekręcić się przez zero.
  assert.equal(messages[1].hits, 255);
});
