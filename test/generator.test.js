// Rdzeń generatora (generator.js). Awarie, przed którymi chroni:
// - numeracja zestawów z dziurą albo powtórką — część zestawów nie pada nigdy
//   albo dwa razy częściej, a wynik dalej wygląda na poprawny;
// - numer zestawu rozłożony na złe liczby — strona pokazuje inny zestaw niż
//   ten, który padł najczęściej (albo liczbę spoza puli, np. 0 lub 50 w Lotto);
// - wynik, który pomija któryś z najczęstszych zestawów, podaje złą liczbę
//   trafień albo złą kolejność;
// - licznik przepełniony bez słowa przy zbyt wielu losowaniach (przekręcony
//   przez zero albo stojący na 255 u wielu zestawów naraz) — także w grze
//   z małą liczbą zestawów (Mini Lotto), gdzie bajt nie wystarcza;
// - postęp zgłaszany po ostatnim losowaniu albo wcale.
// Generator z ziarnem albo skrypt wartości random — wynik testu nie zależy od losu.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  GENERATOR_DRAWS,
  GENERATOR_SETS,
  combinationAt,
  combinationsCount,
  generator,
  mostFrequentDraws,
} = require('../generator.js');
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
  assert.equal(combinationsCount(GAMES.minilotto.pools), 850_668);
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
    ['minilotto', [[1, 2, 3, 4, 5]], [[38, 39, 40, 41, 42]]],
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

// Zestawy wyniku jako [numer zestawu, trafienia] — numer z combinationAt.
const ranked = (pools, sets) => {
  const total = combinationsCount(pools);
  const indexOf = new Map(Array.from({ length: total }, (_, index) => [String(combinationAt(pools, index)), index]));
  return sets.map(({ numbers, hits }) => [indexOf.get(String(numbers)), hits]);
};

test('wynik to zestawy od najczęstszego, każdy z liczbą trafień', () => {
  const result = mostFrequentDraws(SMALL, 7, drawing(30, [4, 17, 4, 29, 17, 17, 8]));
  assert.equal(result.drawsNumber, 7);
  assert.deepEqual(result.sets[0], { numbers: combinationAt(SMALL, 17), hits: 3 });
  assert.deepEqual(ranked(SMALL, result.sets), [
    [17, 3],
    [4, 2],
    [29, 1],
    [8, 1],
  ]);
});

test('przy remisie wyżej stoi zestaw, który pierwszy doszedł do swojej liczby trafień', () => {
  const result = mostFrequentDraws(SMALL, 5, drawing(30, [9, 21, 21, 9, 0]));
  assert.deepEqual(ranked(SMALL, result.sets), [
    [21, 2],
    [9, 2],
    [0, 1],
  ]);
});

test(`wynik ma najwyżej ${GENERATOR_SETS} zestawów, a zestaw spoza czołówki wchodzi do niej, gdy przebije najsłabszy`, () => {
  assert.equal(GENERATOR_SETS, 6);
  // Siedem zestawów po razie: siódmy (6) się nie mieści. Potem 6 pada jeszcze
  // dwa razy i wchodzi na szczyt, a z zestawów z jednym trafieniem wypada
  // ten, który doszedł ostatni (5).
  const result = mostFrequentDraws(SMALL, 9, drawing(30, [0, 1, 2, 3, 4, 5, 6, 6, 6]));
  assert.deepEqual(ranked(SMALL, result.sets), [
    [6, 3],
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 1],
  ]);
});

test('skrajne wartości random trafiają w pierwszy i ostatni zestaw, nie poza liczniki', () => {
  const { pools } = GAMES.lotto;
  assert.deepEqual(mostFrequentDraws(pools, 2, () => 0).sets, [{ numbers: [[1, 2, 3, 4, 5, 6]], hits: 2 }]);
  // Największa wartość, jaką zwraca Math.random.
  const result = mostFrequentDraws(pools, 2, () => 1 - Number.EPSILON / 2);
  assert.deepEqual(result, { sets: [{ numbers: [[44, 45, 46, 47, 48, 49]], hits: 2 }], drawsNumber: 2 });
});

test('czołówka zgadza się z naiwnym zliczaniem tych samych losowań — każda gra', () => {
  for (const game of Object.keys(GAMES)) {
    const { pools } = GAMES[game];
    const total = combinationsCount(pools);
    const draws = 300_000;
    // Odniesienie: mapa numer → [trafienia, losowanie, w którym do nich doszedł].
    const random = seeded(2026);
    const counts = new Map();
    for (let draw = 1; draw <= draws; draw++) {
      const index = Math.floor(random() * total);
      counts.set(index, [(counts.get(index)?.[0] ?? 0) + 1, draw]);
    }
    const expected = [...counts]
      .sort(([, [hitsA, drawA]], [, [hitsB, drawB]]) => hitsB - hitsA || drawA - drawB)
      .slice(0, GENERATOR_SETS)
      .map(([index, [hits]]) => ({ numbers: combinationAt(pools, index), hits }));
    assert.ok(expected[0].hits >= 2, 'Test bez powtórzonego zestawu niczego nie sprawdza.');
    assert.deepEqual(generator(game, draws, seeded(2026)).sets, expected, game);
  }
});

test('każda liczba losowań ze strony mieści się w liczniku każdej gry — inaczej generator odmawia po kliknięciu', () => {
  assert.deepEqual(GENERATOR_DRAWS, [10e6, 50e6, 100e6, 300e6, 500e6, 1000e6]);
  for (const { pools } of Object.values(GAMES)) {
    for (const draws of GENERATOR_DRAWS) {
      // Bez losowania: sama kontrola wejścia, przerwana pierwszym wywołaniem random.
      const stop = new Error('stop');
      assert.throws(
        () =>
          mostFrequentDraws(pools, draws, () => {
            throw stop;
          }),
        stop
      );
    }
  }
});

test('zbyt wiele losowań na zestaw to błąd, nie przepełniony po cichu licznik', () => {
  assert.throws(() => mostFrequentDraws(SMALL, 30 * 25_000 + 1, seeded(1)), /Za dużo losowań/);
  // Na granicy liczy: średnio 25 000 trafień na zestaw, najczęstszy daleko
  // od 65 535.
  const { sets } = mostFrequentDraws(SMALL, 30 * 25_000, seeded(1));
  assert.ok(sets[0].hits > 25_000 && sets[0].hits < 26_000, `Najczęstszy zestaw: ${sets[0].hits} trafień.`);
  assert.equal(sets.length, GENERATOR_SETS);
});

test('przy średnio ponad 100 trafieniach na zestaw licznik liczy dalej niż do 255 — inaczej czołówka Mini Lotto remisuje na 255', () => {
  // Średnio 100 trafień na zestaw: licznik bajtowy, staje na 255.
  assert.deepEqual(ranked(SMALL, mostFrequentDraws(SMALL, 30 * 100, () => 0).sets), [[0, 255]]);
  // Średnio ponad 100: szerszy licznik, wszystkie trafienia jednego zestawu.
  // Tak liczy Mini Lotto od 100 mln losowań (miliard: średnio 1175 na zestaw).
  assert.deepEqual(ranked(SMALL, mostFrequentDraws(SMALL, 30 * 100 + 1, () => 0).sets), [[0, 3001]]);
});

test('liczba losowań inna niż dodatnia całkowita to błąd z komunikatem', () => {
  for (const draws of [0, -5, 1.5, NaN, '10', undefined]) {
    assert.throws(() => mostFrequentDraws(SMALL, draws, seeded(1)), /Liczba losowań/, String(draws));
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
test('worker w trybie generatora wysyła postęp i wynik z zestawami — inaczej strona nie ma czego pokazać', () => {
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
  // random = 0 to milion trafień jednego zestawu: licznik staje na 255,
  // zamiast przekręcić się przez zero.
  assert.deepEqual(messages[1].sets, [
    {
      numbers: [
        [1, 2, 3, 4, 5],
        [1, 2],
      ],
      hits: 255,
    },
  ]);
});
