// Rdzeń generatora: losuje zadaną liczbę razy i zwraca zestaw, który padł
// najczęściej. Bez DOM i bez komunikacji z wątkiem strony, jak simulation.js;
// `random` jest wstrzykiwany — testy podają generator z ziarnem.
//
// Losowanie to tutaj jedna liczba losowa: numer zestawu. Każdy zestaw pada
// w prawdziwym losowaniu z tym samym prawdopodobieństwem, więc równomierny
// wybór numeru daje ten sam rozkład co wyciąganie kul (drawNumbers), a jest
// sześć razy szybszy: kule trzeba by sortować, żeby policzyć numer zestawu
// (pomiar: 4,4 mln losowań/s zamiast 27 mln; miliard losowań trwałby
// 4 minuty zamiast 40 sekund).

import { PROGRESS_EVERY, gameRules } from './simulation.js';

// Liczby losowań do wyboru na stronie — jedyne miejsce, z którego bierze je
// strona (przyciski) i testy.
export const GENERATOR_DRAWS = [10_000_000, 50_000_000, 100_000_000, 300_000_000, 500_000_000, 1_000_000_000];

// Licznik zestawu ma jeden bajt (Eurojackpot: 139 838 160 zestawów to 140 MB;
// dwa bajty to 280 MB, których telefon nie da). Bajt mieści 255 trafień
// i na nich staje (MAX_HITS) — zestawy, które by go przebiły,
// remisowałyby na 255. Przy średniej do 100 na zestaw żaden tam nie dochodzi
// (to ponad 15 odchyleń standardowych). Najgęściej jest w Lotto przy
// miliardzie losowań: średnio 71,5 trafienia na zestaw.
const MAX_HITS = 255;
const MAX_MEAN_HITS = 100;

// Symbol Newtona C(n, k) dla małych liczb — dokładny w liczbach całkowitych
// (kolejne iloczyny dzielą się bez reszty).
const choose = (n, k) => {
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return result;
};

// Tablica do numerowania zestawów puli: ranks[i * max + c] = C(c, i + 1).
// Zestaw c0 < c1 < … (liczby od zera) ma numer C(c0, 1) + C(c1, 2) + … —
// kolejne numery 0 … C(max, size) − 1 bez dziur i bez powtórek, więc
// równomierny wybór numeru to równomierny wybór zestawu.
const rankTable = ({ max, size }) => {
  const ranks = new Uint32Array(size * max);
  for (let i = 0; i < size; i++) for (let c = 0; c < max; c++) ranks[i * max + c] = c > i ? choose(c, i + 1) : 0;
  return ranks;
};

// Zestaw puli o danym numerze, rosnąco. Od największej liczby: największe c,
// dla którego C(c, i + 1) mieści się w reszcie numeru.
const unrank = (pool, rank) => {
  const { max, size } = pool;
  const ranks = rankTable(pool);
  const numbers = new Array(size);
  let c = max - 1;
  for (let i = size - 1; i >= 0; i--) {
    while (ranks[i * max + c] > rank) c--;
    rank -= ranks[i * max + c];
    numbers[i] = c + 1;
    c--;
  }
  return numbers;
};

// Liczba zestawów gry o pulach `pools` ({max, size}, jak w GAMES).
export const combinationsCount = (pools) => pools.reduce((product, { max, size }) => product * choose(max, size), 1);

// Zestaw o numerze 0 … combinationsCount − 1, pula po puli, każda rosnąco.
// Numer to liczba o podstawach „zestawy puli” — ostatnia pula w najniższej
// cyfrze, więc rozkładamy od końca.
export const combinationAt = (pools, index) => {
  const numbers = new Array(pools.length);
  for (let p = pools.length - 1; p >= 0; p--) {
    const count = choose(pools[p].max, pools[p].size);
    numbers[p] = unrank(pools[p], index % count);
    index = Math.floor(index / count);
  }
  return numbers;
};

// Losuje `draws` razy z pul o zasadach `pools` i zwraca zestaw, który padł
// najczęściej: `numbers` pula po puli (rosnąco) i `hits` — ile razy padł.
// Przy remisie wygrywa zestaw, który pierwszy doszedł do tej liczby trafień.
// onProgress dostaje liczbę losowań co progressEvery (nie po ostatnim).
export const mostFrequentDraw = (
  pools,
  draws,
  random = Math.random,
  { onProgress, progressEvery = PROGRESS_EVERY } = {}
) => {
  if (!Number.isInteger(draws) || draws < 1) {
    throw new RangeError(`Liczba losowań ma być dodatnią liczbą całkowitą, jest: ${draws}.`);
  }
  const total = combinationsCount(pools);
  // Liczniki stojące na 255 remisują: wygrałby zestaw, który doszedł tam
  // pierwszy, a nie najczęstszy — wynik wyglądałby poprawnie.
  if (draws / total > MAX_MEAN_HITS) {
    throw new RangeError(
      `Za dużo losowań na ${total} zestawów: ${draws} (najwyżej ${MAX_MEAN_HITS} na zestaw). ` +
        'Większa liczba losowań wymaga szerszego licznika w generator.js.'
    );
  }
  const counts = new Uint8Array(total);

  let best = 0;
  let bestIndex = 0;
  let untilProgress = progressEvery;
  for (let draw = 1; draw <= draws; draw++) {
    const index = Math.floor(random() * total);
    const count = counts[index] + 1;
    // Bez tego warunku 256. trafienie przekręca bajt przez zero.
    if (count <= MAX_HITS) {
      counts[index] = count;
      if (count > best) {
        best = count;
        bestIndex = index;
      }
    }
    if (--untilProgress === 0 && draw !== draws) {
      untilProgress = progressEvery;
      onProgress?.({ drawsNumber: draw });
    }
  }

  return { numbers: combinationAt(pools, bestIndex), hits: best, drawsNumber: draws };
};

// Wejście i wyjście workera strony: gra z GAMES i liczba losowań; wynik
// i postęp z czasem trwania w milisekundach (formatowanie należy do strony).
export const generator = (game, draws, random = Math.random, { onProgress, progressEvery } = {}) => {
  const start = performance.now();
  const result = mostFrequentDraw(gameRules(game).pools, draws, random, {
    onProgress: onProgress && ((progress) => onProgress({ ...progress, durationMs: performance.now() - start })),
    progressEvery,
  });
  return { ...result, durationMs: performance.now() - start };
};
