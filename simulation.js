// Rdzeń symulacji: bez DOM i bez komunikacji z wątkiem strony, żeby testy
// mogły go wołać wprost. `random` jest wstrzykiwany — testy podają własny
// generator z ziarnem, strona używa Math.random.

export const MAX_NUMBER = 49;
export const TICKET_SIZE = 6;
// Co tyle losowań rdzeń zgłasza postęp: ok. 0,25 s przy 4 mln losowań/s.
// Częściej — wiadomości z workera zaczynają kosztować więcej niż losowanie;
// rzadziej — licznik na stronie stoi i wygląda na zawieszony.
export const PROGRESS_EVERY = 1_000_000;

// Pula 1–49 przestawiana w miejscu przez kolejne losowania. Nie trzeba jej
// przywracać: tasowanie Fishera-Yatesa daje równomierny wybór z dowolnego
// ułożenia puli, a alokacja nowej tablicy na każde losowanie kosztowała
// większość czasu symulacji.
export const createPool = () => Uint8Array.from({ length: MAX_NUMBER }, (_, i) => i + 1);

// Losuje TICKET_SIZE różnych liczb: częściowe tasowanie Fishera-Yatesa, dokładnie
// jedno wywołanie random na liczbę, bez odrzucania powtórek. Wynik to pierwsze
// TICKET_SIZE pozycji puli (widok, nie kopia — ważny do następnego losowania).
// Zmiana mnożnika (MAX_NUMBER - i) wycina skrajną liczbę albo wychodzi poza pulę.
export const drawSix = (pool, random = Math.random) => {
  for (let i = 0; i < TICKET_SIZE; i++) {
    const j = i + Math.floor(random() * (MAX_NUMBER - i));
    const picked = pool[j];
    pool[j] = pool[i];
    pool[i] = picked;
  }
  return pool.subarray(0, TICKET_SIZE);
};

const toTicket = (ticketNumbers) => {
  const numbers = ticketNumbers.map(Number);
  const valid =
    numbers.length === TICKET_SIZE &&
    new Set(numbers).size === TICKET_SIZE &&
    numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_NUMBER);
  // Zły kupon (np. 5 liczb albo powtórka) nigdy nie trafi szóstki — symulacja
  // kręciłaby się bez końca zamiast zgłosić błąd.
  if (!valid) {
    throw new RangeError(
      `Kupon ma mieć ${TICKET_SIZE} różnych liczb 1–${MAX_NUMBER}, jest: ${ticketNumbers.join(', ')}.`
    );
  }
  return numbers;
};

// Losuje do trafienia szóstki; zwraca numer losowania z wygraną i liczbę
// trafionych trójek, czwórek i piątek po drodze. onProgress dostaje te same
// liczniki co progressEvery losowań (nie w losowaniu z wygraną).
export const simulateUntilWin = (
  ticketNumbers,
  random = Math.random,
  { onProgress, progressEvery = PROGRESS_EVERY } = {}
) => {
  const onTicket = new Uint8Array(MAX_NUMBER + 1);
  for (const n of toTicket(ticketNumbers)) onTicket[n] = 1;

  const pool = createPool();
  const hits = [0, 0, 0, 0, 0, 0, 0];
  let draws = 0;
  let untilProgress = progressEvery;
  let matched;
  do {
    draws++;
    const drawn = drawSix(pool, random);
    matched = 0;
    for (let i = 0; i < TICKET_SIZE; i++) matched += onTicket[drawn[i]];
    hits[matched]++;
    if (--untilProgress === 0 && matched < TICKET_SIZE) {
      untilProgress = progressEvery;
      onProgress?.({ drawsNumber: draws, threes: hits[3], fours: hits[4], fives: hits[5] });
    }
  } while (matched < TICKET_SIZE);

  return { drawsNumber: draws, threes: hits[3], fours: hits[4], fives: hits[5] };
};

// Wejście i wyjście workera strony: kupon jako napisy z DOM, wynik i postęp
// z czasem trwania w milisekundach (formatowanie należy do strony, format.js).
export const simulation = (ticketNumbers, random = Math.random, { onProgress, progressEvery } = {}) => {
  const start = performance.now();
  const result = simulateUntilWin(ticketNumbers, random, {
    onProgress: onProgress && ((progress) => onProgress({ ...progress, durationMs: performance.now() - start })),
    progressEvery,
  });
  return {
    ticketNumbers: [...ticketNumbers].sort((a, b) => a - b).join(', '),
    ...result,
    durationMs: performance.now() - start,
  };
};
