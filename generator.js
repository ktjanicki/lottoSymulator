// Rdzeń generatora: losuje zadaną liczbę razy i zwraca zestawy, które padły
// najczęściej. Bez DOM i bez komunikacji z wątkiem strony, jak simulation.js;
// `random` jest wstrzykiwany — testy podają generator z ziarnem.
//
// Losowanie to tutaj jedna liczba losowa: numer zestawu. Każdy zestaw pada
// w prawdziwym losowaniu z tym samym prawdopodobieństwem, więc równomierny
// wybór numeru daje ten sam rozkład co wyciąganie kul (drawNumbers), a jest
// sześć razy szybszy: kule trzeba by sortować, żeby policzyć numer zestawu
// (pomiar: 4,4 mln losowań/s zamiast kilkunastu; miliard losowań trwałby
// 4 minuty zamiast jednej).

import { PROGRESS_EVERY, gameRules } from './simulation.js';

// Liczby losowań do wyboru na stronie — jedyne miejsce, z którego bierze je
// strona (przyciski) i testy.
export const GENERATOR_DRAWS = [10_000_000, 50_000_000, 100_000_000, 300_000_000, 500_000_000, 1_000_000_000];

// Tyle najczęstszych zestawów zwraca generator i pokazuje strona (wiersze
// wyniku w index.js, wysokość karty w style.css).
export const GENERATOR_SETS = 6;

// Licznik zestawu — najwęższy, który mieści średnią liczbę trafień
// (losowania przez liczbę zestawów gry). Jeden bajt, gdy zestawów dużo
// (Eurojackpot: 139 838 160 zestawów to 140 MB; dwa bajty to 280 MB, których
// telefon nie da); dwa, gdy mało (Mini Lotto: 850 668 zestawów to 1,7 MB,
// a miliard losowań to średnio 1175 trafień — bajt by nie wystarczył).
// Licznik staje na maxHits — zestawy, które by go przebiły, remisowałyby na
// nim. Przy średniej do maxMeanHits żaden tam nie dochodzi (dla bajtu ponad
// 15 odchyleń standardowych, dla dwóch bajtów — setki). Bajt dostaje
// najgęściej Lotto przy miliardzie losowań: średnio 71,5 trafienia na zestaw.
const COUNTERS = [
  { Counter: Uint8Array, maxHits: 255, maxMeanHits: 100 },
  { Counter: Uint16Array, maxHits: 65_535, maxMeanHits: 25_000 },
];

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

// Losuje `draws` razy z pul o zasadach `pools` i zwraca `sets`: najwyżej
// GENERATOR_SETS zestawów, które padły najczęściej, od najczęstszego — każdy
// z `numbers` (pula po puli, rosnąco) i `hits` (ile razy padł). Przy remisie
// wyżej stoi zestaw, który pierwszy doszedł do swojej liczby trafień;
// kolejność według numeru zestawu faworyzowałaby zestawy z małych liczb.
// onProgress dostaje liczbę losowań co progressEvery (nie po ostatnim).
export const mostFrequentDraws = (
  pools,
  draws,
  random = Math.random,
  { onProgress, progressEvery = PROGRESS_EVERY } = {}
) => {
  if (!Number.isInteger(draws) || draws < 1) {
    throw new RangeError(`Liczba losowań ma być dodatnią liczbą całkowitą, jest: ${draws}.`);
  }
  const total = combinationsCount(pools);
  // Liczniki stojące na maxHits remisują: wygrałby zestaw, który doszedł tam
  // pierwszy, a nie najczęstszy — wynik wyglądałby poprawnie.
  const counter = COUNTERS.find(({ maxMeanHits }) => draws / total <= maxMeanHits);
  if (!counter) {
    const { maxMeanHits } = COUNTERS.at(-1);
    throw new RangeError(
      `Za dużo losowań na ${total} zestawów: ${draws} (najwyżej ${maxMeanHits} na zestaw). ` +
        'Większa liczba losowań wymaga szerszego licznika w generator.js (COUNTERS).'
    );
  }
  const { Counter, maxHits } = counter;
  const counts = new Counter(total);

  // Czołówka liczona w trakcie losowań: zestaw wchodzi do niej, gdy jego
  // licznik przebije najsłabszy z czołówki (`weakest`), na miejsce tego
  // najsłabszego. Najsłabszy nigdy nie maleje, więc poza czołówką nie ma
  // zestawu z większą liczbą trafień. Warunek w pętli spełnia się rzadko —
  // przeglądanie wszystkich liczników po losowaniach nie znałoby kolejności
  // dochodzenia do remisu.
  // Tablice i zwykłe pętle, bez obiektów i funkcji strzałkowych: to środek
  // pętli losowań.
  const size = Math.min(GENERATOR_SETS, total);
  const topIndex = new Float64Array(size).fill(-1);
  const topHits = new Counter(size);
  const topReachedAt = new Float64Array(size);
  let weakest = 0;
  let untilProgress = progressEvery;
  for (let draw = 1; draw <= draws; draw++) {
    const index = Math.floor(random() * total);
    const count = counts[index] + 1;
    // Bez tego warunku trafienie ponad maxHits przekręca licznik przez zero.
    if (count <= maxHits) {
      counts[index] = count;
      if (count > weakest) {
        // Miejsce zestawu w czołówce albo — gdy go tam nie ma — miejsce
        // najsłabszego (przy remisie tego, który doszedł najpóźniej).
        let slot = 0;
        for (let i = 0; i < size; i++) {
          if (topIndex[i] === index) {
            slot = i;
            break;
          }
          if (topHits[i] < topHits[slot] || (topHits[i] === topHits[slot] && topReachedAt[i] > topReachedAt[slot])) {
            slot = i;
          }
        }
        topIndex[slot] = index;
        topHits[slot] = count;
        topReachedAt[slot] = draw;
        weakest = maxHits;
        for (let i = 0; i < size; i++) if (topHits[i] < weakest) weakest = topHits[i];
      }
    }
    if (--untilProgress === 0 && draw !== draws) {
      untilProgress = progressEvery;
      onProgress?.({ drawsNumber: draw });
    }
  }

  return {
    sets: Array.from(topIndex, (index, i) => ({ index, hits: topHits[i], reachedAt: topReachedAt[i] }))
      .filter(({ hits }) => hits > 0)
      .sort((a, b) => b.hits - a.hits || a.reachedAt - b.reachedAt)
      .map(({ index, hits }) => ({ numbers: combinationAt(pools, index), hits })),
    drawsNumber: draws,
  };
};

// Wejście i wyjście workera strony: gra z GAMES i liczba losowań; wynik
// i postęp z czasem trwania w milisekundach (formatowanie należy do strony).
export const generator = (game, draws, random = Math.random, { onProgress, progressEvery } = {}) => {
  const start = performance.now();
  const result = mostFrequentDraws(gameRules(game).pools, draws, random, {
    onProgress: onProgress && ((progress) => onProgress({ ...progress, durationMs: performance.now() - start })),
    progressEvery,
  });
  return { ...result, durationMs: performance.now() - start };
};
