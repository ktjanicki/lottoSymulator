// Rdzeń symulacji (simulation.js). Awarie, przed którymi chroni:
// - pomyłka o jeden w mnożniku losowania po cichu wycina skrajną liczbę
//   (tak było w 1.0.2) — kupon z nią nigdy nie wygra, symulacja nie kończy się;
// - losowanie nierównomierne albo z powtórkami — wyniki „ile losowań do wygranej”
//   przestają odpowiadać prawdziwej grze, a nic się nie wysypuje;
// - trafienia przypisane do złego stopnia wygranej (np. 3+2 liczone jako 4+0)
//   albo stopnie w złej kolejności w wyniku;
// - kupon odrzucany albo przepuszczany wbrew zasadom gry.
// Generator z ziarnem albo skrypt wartości random — wynik testu nie zależy od losu.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  GAMES,
  createPool,
  drawNumbers,
  gameRules,
  simulateUntilWin,
  simulation,
  PROGRESS_EVERY,
} = require('../simulation.js');

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

// Przy random = 0 tasowanie zamienia każdą pozycję samą ze sobą: pula stoi,
// a każde losowanie to 1…size w każdej puli. W symulacji — skończony skrypt
// zer: gdy rdzeń przestanie rozpoznawać wygraną, test pada zamiast wisieć
// (synchronicznej pętli nie przerwie limit czasu testu).
const zero = () => 0;
const zeros = () => scripted(new Array(100).fill(0));
const TOP = 1 - Number.EPSILON;

const POOLS = Object.entries(GAMES).flatMap(([game, { pools }]) => pools.map((pool, p) => ({ game, p, ...pool })));

// Liczniki stopni po `draws` losowaniach — z prawdziwej pętli symulacji,
// przerwanej wyjątkiem z pierwszego zgłoszenia postępu.
const tiersAfter = (game, ticket, random, draws) => {
  const stop = new Error('stop');
  let tiers;
  try {
    const { drawsNumber } = simulateUntilWin(game, ticket, random, {
      progressEvery: draws,
      onProgress: (progress) => {
        tiers = progress.tiers;
        throw stop;
      },
    });
    assert.fail(`${game}: główna wygrana w ${drawsNumber}. losowaniu, przed ${draws}. — zmień ziarno albo kupon.`);
  } catch (error) {
    if (error !== stop) throw error;
  }
  return tiers;
};

for (const { game, p, max, size } of POOLS) {
  test(`${game}, pula ${p + 1}: skrajne wartości random dają 1 i ${max} — inaczej skrajna liczba nigdy nie wypada`, () => {
    const pool = createPool(max);
    drawNumbers(pool, size, zero);
    assert.deepEqual(
      [...pool.subarray(0, size)],
      Array.from({ length: size }, (_, i) => i + 1)
    );
    const top = createPool(max);
    drawNumbers(top, size, () => TOP);
    assert.equal(top[0], max);
  });

  test(`${game}, pula ${p + 1}: losowanie daje ${size} ${size >= 2 && size <= 4 ? 'różne liczby' : 'różnych liczb'} 1–${max}, każdą równie często — inaczej symulacja nie odpowiada grze`, () => {
    const random = seeded(2026 + p);
    const pool = createPool(max);
    const counts = new Array(max + 1).fill(0);
    const DRAWS = 100_000;
    for (let d = 0; d < DRAWS; d++) {
      drawNumbers(pool, size, random);
      const drawn = pool.subarray(0, size);
      assert.equal(new Set(drawn).size, size, `Powtórka w losowaniu ${d}: ${[...drawn]}`);
      for (const n of drawn) counts[n]++;
    }
    assert.equal(counts[0], 0, 'Wylosowano 0.');
    const expected = (DRAWS * size) / max;
    for (let n = 1; n <= max; n++) {
      assert.ok(
        Math.abs(counts[n] / expected - 1) < 0.05,
        `Liczba ${n}: ${counts[n]} razy, oczekiwano ok. ${Math.round(expected)}.`
      );
    }
  });
}

const choose = (n, k) => (k < 0 || k > n ? 0 : k === 0 ? 1 : (choose(n - 1, k - 1) * n) / k);

// Prawdopodobieństwo stopnia: w każdej puli `m` trafionych z `size` i reszta
// spośród max − size nieskreślonych (rozkład hipergeometryczny).
const tierProbability = (pools, tier) =>
  tier.reduce((prob, m, p) => {
    const { max, size } = pools[p];
    return (prob * choose(size, m) * choose(max - size, size - m)) / choose(max, size);
  }, 1);

const TICKETS = {
  lotto: ['12', '33', '17', '41', '27', '6'],
  eurojackpot: ['4', '9', '23', '31', '47', '3', '11'],
};

for (const [game, { pools, tiers }] of Object.entries(GAMES)) {
  test(`${game}: każdy stopień wypada z teoretyczną częstością — inaczej liczenie trafień jest złe`, () => {
    const DRAWS = 2_000_000;
    const counts = tiersAfter(game, TICKETS[game], seeded(2026), DRAWS);
    tiers.forEach((tier, index) => {
      const expected = DRAWS * tierProbability(pools, tier);
      // 5 odchyleń standardowych (Poisson) plus 1 na stopnie, które
      // w 2 mln losowań wypadają średnio raz albo rzadziej.
      assert.ok(
        Math.abs(counts[index] - expected) < 5 * Math.sqrt(expected) + 1,
        `Stopień ${tier.join('+')}: ${counts[index]} razy, oczekiwano ok. ${expected.toFixed(1)}.`
      );
    });
  });

  // Częstość nie odróżni stopni o prawie równym prawdopodobieństwie
  // (w Eurojackpot 4+0 i 3+2), dlatego każdy stopień osobno: kupon trafiający
  // dokładnie ten stopień w losowaniu 1…size z każdej puli.
  test(`${game}: trafienie stopnia trafia do jego licznika i tylko do niego`, () => {
    tiers.forEach((tier, index) => {
      const ticket = tier.flatMap((matched, p) =>
        Array.from({ length: pools[p].size }, (_, i) => String(i < matched ? i + 1 : pools[p].max - i))
      );
      const counts = tiersAfter(game, ticket, zeros(), 1);
      assert.deepEqual(
        counts,
        tiers.map((_, i) => (i === index ? 1 : 0)),
        `Kupon ${ticket} (stopień ${tier.join('+')}) dał liczniki ${counts}.`
      );
    });
  });
}

test('Lotto: symulacja kończy się na szóstce i liczy piątki po drodze', () => {
  // Losowanie 1: 1–6 (piątka dla kuponu 1–5 + 49). Losowanie 2: 1–5, potem 49.
  const values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 43 / 44 + 1e-9];
  const result = simulateUntilWin('lotto', ['1', '2', '3', '4', '5', '49'], scripted(values));
  assert.deepEqual(result, { drawsNumber: 2, tiers: [0, 0, 1] });
});

test('Eurojackpot: wygrana dopiero na 5+2 — 5+1 nie kończy symulacji', () => {
  // Losowanie 1: 1–5 + 1, 2 (5+1 dla kuponu 1–5 + 1, 12). Losowanie 2: 1–5,
  // potem 1 i 12 (druga kula: 11. z pozostałych 11 w puli 2–12).
  const values = [...new Array(13).fill(0), 10 / 11 + 1e-9];
  const result = simulateUntilWin('eurojackpot', ['1', '2', '3', '4', '5', '1', '12'], scripted(values));
  assert.deepEqual(result, { drawsNumber: 2, tiers: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
});

test('Eurojackpot: ta sama liczba w obu pulach to poprawny kupon — pule są osobne', () => {
  assert.equal(simulateUntilWin('eurojackpot', ['1', '2', '3', '4', '5', '1', '2'], zeros()).drawsNumber, 1);
});

test('zły kupon zgłasza błąd zamiast kręcić się bez końca', () => {
  const bad = {
    lotto: [
      ['1', '2', '3', '4', '5'],
      ['1', '1', '2', '3', '4', '5'],
      ['0', '1', '2', '3', '4', '5'],
      ['1', '2', '3', '4', '5', '50'],
      ['1', '2', '3', '4', '5', 'x'],
      ['1', '2', '3', '4', '5', '6', '7'],
    ],
    eurojackpot: [
      ['1', '2', '3', '4', '5', '1'],
      ['1', '2', '3', '4', '5', '1', '2', '3'],
      ['1', '2', '3', '4', '5', '1', '13'],
      ['1', '2', '3', '4', '5', '2', '2'],
      ['1', '2', '3', '4', '51', '1', '2'],
      ['1', '1', '3', '4', '5', '1', '2'],
      ['1', '2', '3', '4', '5', '0', '2'],
    ],
  };
  for (const [game, tickets] of Object.entries(bad)) {
    for (const ticket of tickets) {
      assert.throws(() => simulateUntilWin(game, ticket, zeros()), RangeError, `${game}: kupon ${ticket} przeszedł.`);
    }
  }
});

test('nieznana gra to błąd, także nazwa z prototypu obiektu — inaczej symulacja bez pul', () => {
  for (const game of ['keno', 'toString', 'constructor', undefined]) {
    assert.throws(() => gameRules(game), RangeError, `Gra ${game} przeszła.`);
    assert.throws(() => simulateUntilWin(game, ['1'], zeros()), RangeError);
  }
});

test('wynik dla strony: każda pula posortowana liczbowo, pule rozdzielone „ + ”, czas', () => {
  const lotto = simulation(
    'lotto',
    ['49', '5', '4', '3', '2', '1'],
    scripted([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 43 / 44 + 1e-9])
  );
  assert.equal(lotto.ticketNumbers, '1, 2, 3, 4, 5, 49');
  assert.ok(Number.isFinite(lotto.durationMs) && lotto.durationMs >= 0, `durationMs: ${lotto.durationMs}`);
  const euro = simulation('eurojackpot', ['5', '4', '3', '2', '1', '2', '1'], zeros());
  assert.equal(euro.ticketNumbers, '1, 2, 3, 4, 5 + 1, 2');
});

// `losing` losowań 1–6 (dla kuponu 1–5 + 49 to piątki), potem losowanie 1–5 + 49.
// Pula po losowaniach z random = 0 zostaje nieruszona, więc skrypt jest dokładny.
// Po wygranym losowaniu skrypt rzuca jak `scripted` — gdy rdzeń jej nie
// rozpozna, test pada zamiast kręcić się na NaN bez końca.
const losingThenWin = (losing) => {
  let calls = 0;
  const winning = [0, 0, 0, 0, 0, 43 / 44 + 1e-9];
  return () => {
    if (calls < losing * 6) return (calls++, 0);
    if (calls - losing * 6 >= winning.length) throw new Error('Skrypt wyczerpany — symulacja nie rozpoznała wygranej.');
    return winning[calls++ - losing * 6];
  };
};
const TICKET = ['1', '2', '3', '4', '5', '49'];

test('postęp co progressEvery losowań, bez zgłoszenia w losowaniu z wygraną — inaczej licznik na stronie kłamie albo stoi', () => {
  const every2 = [];
  const result = simulateUntilWin('lotto', TICKET, losingThenWin(5), {
    onProgress: (p) => every2.push(p),
    progressEvery: 2,
  });
  assert.equal(result.drawsNumber, 6);
  assert.deepEqual(every2, [
    { drawsNumber: 2, tiers: [0, 0, 2] },
    { drawsNumber: 4, tiers: [0, 0, 4] },
  ]);
  const every3 = [];
  simulateUntilWin('lotto', TICKET, losingThenWin(5), {
    onProgress: (p) => every3.push(p.drawsNumber),
    progressEvery: 3,
  });
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
    messages = runWorker({ mode: 'simulator', game: 'lotto', numbers: TICKET });
  } finally {
    Math.random = originalRandom;
  }
  assert.deepEqual(
    messages.map((m) => [m.type, m.drawsNumber]),
    [
      ['progress', PROGRESS_EVERY],
      ['result', PROGRESS_EVERY + 2],
    ]
  );
  assert.ok(Number.isFinite(messages[0].durationMs), 'Postęp bez czasu trwania.');
  assert.deepEqual(messages[1].tiers, [0, 0, PROGRESS_EVERY + 1]);
});

test('worker liczy grę z wiadomości, nie Lotto na sztywno', () => {
  const originalRandom = Math.random;
  Math.random = zeros();
  let messages;
  try {
    messages = runWorker({ mode: 'simulator', game: 'eurojackpot', numbers: ['1', '2', '3', '4', '5', '1', '2'] });
  } finally {
    Math.random = originalRandom;
  }
  assert.deepEqual(
    messages.map((m) => [m.type, m.ticketNumbers, m.tiers.length]),
    [['result', '1, 2, 3, 4, 5 + 1, 2', GAMES.eurojackpot.tiers.length]]
  );
});

test('wyjątek w workerze wraca do strony jako {type: error} — inaczej strona czeka na wynik z kręcącym się spinnerem', () => {
  for (const [data, message] of [
    [{ mode: 'simulator', game: 'lotto', numbers: ['1', '2', '3', '4', '5'] }, /6 różnych liczb/],
    [{ mode: 'simulator', game: 'keno', numbers: TICKET }, /Nieznana gra/],
    [{ mode: 'generator', game: 'keno', draws: 10 }, /Nieznana gra/],
    [{ mode: 'generator', game: 'lotto', draws: 0 }, /Liczba losowań/],
    // Wiadomość bez trybu (strona sprzed 1.16.0) i tryb z prototypu obiektu.
    [{ game: 'lotto', numbers: TICKET }, /Nieznany tryb/],
    [{ mode: 'toString', game: 'lotto', numbers: TICKET }, /Nieznany tryb/],
  ]) {
    const messages = runWorker(data);
    assert.equal(
      messages.length,
      1,
      `Worker wysłał ${messages.length} wiadomości zamiast jednej: ${JSON.stringify(messages)}.`
    );
    assert.equal(messages[0].type, 'error');
    assert.match(messages[0].message, message);
  }
});
