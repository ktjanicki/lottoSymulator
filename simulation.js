// Rdzeń symulacji: bez DOM i bez komunikacji z wątkiem strony, żeby testy
// mogły go wołać wprost. `random` jest wstrzykiwany — testy podają własny
// generator z ziarnem, strona używa Math.random.

// Zasady gier — jedyne miejsce, z którego biorą je rdzeń, historia i strona.
// pools: kolejne pule kul 1–max, z każdej losowanie i kupon mają `size` liczb;
// na kuponie (i we wpisie historii) liczby idą płasko, pula po puli.
// tiers: niższe stopnie wygranych jako liczby trafień w kolejnych pulach,
// w kolejności, w jakiej pokazuje je strona (Lotto rosnąco, jak od początku;
// Eurojackpot w kolejności oficjalnych stopni II–XII). Główna wygrana to
// trafienie wszystkich liczb — nie ma jej na liście, kończy symulację.
// Stopień spoza listy rdzeń liczy, ale go nie zwraca; literówka w stopniu
// (np. [6, 0]) wywraca wejście modułu — patrz sprawdzenie niżej.
export const GAMES = {
  lotto: { pools: [{ max: 49, size: 6 }], tiers: [[3], [4], [5]] },
  eurojackpot: {
    pools: [
      { max: 50, size: 5 },
      { max: 12, size: 2 },
    ],
    tiers: [
      [5, 1],
      [5, 0],
      [4, 2],
      [4, 1],
      [4, 0],
      [3, 2],
      [2, 2],
      [3, 1],
      [3, 0],
      [1, 2],
      [2, 1],
    ],
  },
};

// Co tyle losowań rdzeń zgłasza postęp: ok. 0,25 s przy 4 mln losowań/s.
// Częściej — wiadomości z workera zaczynają kosztować więcej niż losowanie;
// rzadziej — licznik na stronie stoi i wygląda na zawieszony.
export const PROGRESS_EVERY = 1_000_000;

// Zasady gry o danym identyfikatorze. Object.hasOwn, nie `in`: identyfikator
// przychodzi z adresu strony i z wiadomości do workera, a „toString” czy
// „constructor” przeszłyby przez `in` jako gra bez pul.
export const gameRules = (game) => {
  if (!Object.hasOwn(GAMES, game)) {
    throw new RangeError(`Nieznana gra: ${game}. Znane gry: ${Object.keys(GAMES).join(', ')}.`);
  }
  return GAMES[game];
};

// Indeks licznika dla trafień w kolejnych pulach: liczba w systemie
// o podstawach size + 1. Wszystkie trafienia to największy indeks.
const tierKey = (pools, matches) => matches.reduce((key, matched, p) => key * (pools[p].size + 1) + matched, 0);

for (const [game, { pools, tiers }] of Object.entries(GAMES)) {
  for (const tier of tiers) {
    const fits =
      tier.length === pools.length && tier.every((m, p) => Number.isInteger(m) && m >= 0 && m <= pools[p].size);
    const jackpot = tier.every((m, p) => m === pools[p].size);
    // Stopień spoza puli dostałby cudzy licznik (indeksy się nakładają),
    // a główna wygrana na liście — zawsze zero, bo kończy symulację.
    if (!fits || jackpot) throw new RangeError(`GAMES.${game}.tiers: stopień [${tier}] nie pasuje do pul gry.`);
  }
}

// Pula 1–max przestawiana w miejscu przez kolejne losowania. Nie trzeba jej
// przywracać: tasowanie Fishera-Yatesa daje równomierny wybór z dowolnego
// ułożenia puli, a alokacja nowej tablicy na każde losowanie kosztowała
// większość czasu symulacji.
export const createPool = (max) => Uint8Array.from({ length: max }, (_, i) => i + 1);

// Losuje `size` różnych liczb: częściowe tasowanie Fishera-Yatesa, dokładnie
// jedno wywołanie random na liczbę, bez odrzucania powtórek. Wynik to pierwsze
// `size` pozycji puli — bez zwracanego widoku, bo i ten alokowałby obiekt
// w każdym losowaniu. Zmiana mnożnika (pool.length - i) wycina skrajną liczbę
// albo wychodzi poza pulę.
export const drawNumbers = (pool, size, random = Math.random) => {
  for (let i = 0; i < size; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    const picked = pool[j];
    pool[j] = pool[i];
    pool[i] = picked;
  }
};

// „6 różnych liczb”, ale „2 różne liczby”.
const differentNumbers = (size) => (size >= 2 && size <= 4 ? 'różne liczby' : 'różnych liczb');

// Kupon jako liczby pula po puli. Zły kupon (np. 5 liczb Lotto albo
// powtórka) nigdy nie trafi głównej wygranej — symulacja kręciłaby się bez
// końca zamiast zgłosić błąd.
const toTicket = (pools, ticketNumbers) => {
  const numbers = ticketNumbers.map(Number);
  let offset = 0;
  const parts = pools.map(({ size }) => numbers.slice(offset, (offset += size)));
  const valid =
    numbers.length === offset &&
    parts.every(
      (part, p) =>
        new Set(part).size === part.length && part.every((n) => Number.isInteger(n) && n >= 1 && n <= pools[p].max)
    );
  if (!valid) {
    const expected = pools.map(({ max, size }) => `${size} ${differentNumbers(size)} 1–${max}`).join(' i ');
    throw new RangeError(`Kupon ma mieć ${expected}, jest: ${ticketNumbers.join(', ')}.`);
  }
  return parts;
};

// Losuje do głównej wygranej; zwraca numer losowania z wygraną i liczniki
// niższych stopni gry (`tiers`, w kolejności GAMES[game].tiers) po drodze.
// onProgress dostaje to samo co progressEvery losowań (nie w losowaniu z wygraną).
export const simulateUntilWin = (
  game,
  ticketNumbers,
  random = Math.random,
  { onProgress, progressEvery = PROGRESS_EVERY } = {}
) => {
  const { pools: rules, tiers } = gameRules(game);
  const parts = toTicket(rules, ticketNumbers);
  const pools = rules.map(({ max }) => createPool(max));
  const sizes = rules.map(({ size }) => size);
  const onTicket = rules.map(({ max }, p) => {
    const marks = new Uint8Array(max + 1);
    for (const n of parts[p]) marks[n] = 1;
    return marks;
  });
  const winKey = tierKey(rules, sizes);
  const tierKeys = tiers.map((tier) => tierKey(rules, tier));
  // Float64Array: Uint32Array przepełniłby się po 4 mld losowań bez słowa.
  const hits = new Float64Array(winKey + 1);
  const counts = () => tierKeys.map((key) => hits[key]);

  let draws = 0;
  let untilProgress = progressEvery;
  let key;
  do {
    draws++;
    key = 0;
    for (let p = 0; p < pools.length; p++) {
      const pool = pools[p];
      const size = sizes[p];
      const marks = onTicket[p];
      drawNumbers(pool, size, random);
      let matched = 0;
      for (let i = 0; i < size; i++) matched += marks[pool[i]];
      key = key * (size + 1) + matched;
    }
    hits[key]++;
    if (--untilProgress === 0 && key !== winKey) {
      untilProgress = progressEvery;
      onProgress?.({ drawsNumber: draws, tiers: counts() });
    }
  } while (key !== winKey);

  return { drawsNumber: draws, tiers: counts() };
};

// Wejście i wyjście workera strony: kupon jako napisy z DOM, wynik i postęp
// z czasem trwania w milisekundach (formatowanie należy do strony, format.js).
// ticketNumbers: każda pula rosnąco, pule rozdzielone „ + ” („1, 2, 3, 4, 5 + 6, 7”).
export const simulation = (game, ticketNumbers, random = Math.random, { onProgress, progressEvery } = {}) => {
  const start = performance.now();
  const result = simulateUntilWin(game, ticketNumbers, random, {
    onProgress: onProgress && ((progress) => onProgress({ ...progress, durationMs: performance.now() - start })),
    progressEvery,
  });
  const parts = toTicket(gameRules(game).pools, ticketNumbers);
  return {
    ticketNumbers: parts.map((part) => part.sort((a, b) => a - b).join(', ')).join(' + '),
    ...result,
    durationMs: performance.now() - start,
  };
};
