// Historia wygranych symulatora i zestawów generatora oraz zgoda na ich
// zapis — w localStorage przeglądarki.
// Bez DOM: `storage` jest wstrzykiwany (strona podaje localStorage, testy
// własny magazyn), żeby testy mogły sprawdzić każdą gałąź wprost.

import { splitTicket } from './simulation.js';

// Zmiana klucza gubi historię i zgodę zapisane u odwiedzających.
export const HISTORY_KEY = 'lottoSymulator.history';
// Zestawy generatora pod własnym kluczem, nie jako wpisy HISTORY_KEY z polem
// więcej: karta ze stroną sprzed 1.16.0 przepisuje historię do czterech pól
// wygranej i zamieniłaby zestaw generatora w wygraną symulatora.
export const GENERATED_KEY = 'lottoSymulator.generated';
export const CONSENT_KEY = 'lottoSymulator.consent';
// Limit na grę (osobno w każdej z dwóch list): 500 wygranych to ok. 50 KB,
// 500 generowań (po sześć zestawów) — ok. 150 KB. Bez limitu historia rośnie do ~5 MB
// limitu przeglądarki i od tej chwili każdy zapis cicho się nie udaje.
// Wspólny limit dla gier pozwoliłby jednej wypchnąć z historii drugą.
export const HISTORY_LIMIT = 500;
export const HISTORY_PAGE = 15;
// Gra wpisów sprzed 1.15.0 — wtedy strona znała tylko Lotto i nie zapisywała
// gry. Inna wartość przepisałaby starą historię Lotto na inną grę albo ją
// odrzuciła.
export const LEGACY_GAME = 'lotto';

// localStorage potrafi rzucić przy samym odczycie (zablokowane dane witryny,
// tryb prywatny) i przy zapisie (pełny magazyn). Wyjątek z tego miejsca
// zatrzymałby obsługę wyniku symulacji — strona zostałaby w stanie „w toku”.
const safely = (action, fallback) => {
  try {
    return action();
  } catch {
    return fallback;
  }
};

// Wpis z grą (stary wpis — z LEGACY_GAME) albo null, gdy nie pasuje do
// żadnej gry. splitTicket rzuca przy nieznanej grze i kuponie niezgodnym
// z grą. Liczby muszą być już liczbami: wpis z napisami to nie nasz zapis.
const toEntry = (entry) => {
  const game = entry?.game ?? LEGACY_GAME;
  const valid = safely(
    () =>
      splitTicket(game, entry.numbers) &&
      entry.numbers.every(Number.isInteger) &&
      Number.isInteger(entry.drawsNumber) &&
      entry.drawsNumber > 0 &&
      Number.isFinite(entry.date),
    false
  );
  return valid ? { game, numbers: entry.numbers, drawsNumber: entry.drawsNumber, date: entry.date } : null;
};

// Najwyżej tyle zestawów we wpisie generatora. Z zapasem ponad
// GENERATOR_SETS (generator.js): wpis ma się czytać także wtedy, gdy strona
// zacznie pokazywać inną liczbę zestawów; bez górnej granicy obcy wpis
// z tysiącami zestawów wyrenderowałby tysiące kul.
const GENERATED_SETS_LIMIT = 20;

// Wpis generatora: jedno generowanie, czyli `sets` — zestawy od najczęstszego,
// każdy z liczbami jak kupon gry (splitTicket) i `hits`, ile razy padł
// w `drawsNumber` losowaniach. Gra obowiązkowa: generator powstał po
// Eurojackpocie, starych wpisów bez gry nie ma.
const toGenerated = (entry) => {
  const valid = safely(
    () =>
      Array.isArray(entry.sets) &&
      entry.sets.length > 0 &&
      entry.sets.length <= GENERATED_SETS_LIMIT &&
      Number.isInteger(entry.drawsNumber) &&
      entry.drawsNumber > 0 &&
      Number.isFinite(entry.date) &&
      entry.sets.every(
        ({ numbers, hits }) =>
          splitTicket(entry.game, numbers) &&
          numbers.every(Number.isInteger) &&
          Number.isInteger(hits) &&
          hits > 0 &&
          hits <= entry.drawsNumber
      ),
    false
  );
  return valid
    ? {
        game: entry.game,
        sets: entry.sets.map(({ numbers, hits }) => ({ numbers, hits })),
        drawsNumber: entry.drawsNumber,
        date: entry.date,
      }
    : null;
};

// Wpisy wszystkich gier spod klucza `key`, od najnowszego. Uszkodzony JSON
// albo obce wpisy (ręczna edycja, dane nieznanej gry) odpadają — lista ich
// nie wyrenderuje.
const readEntries = (storage, key, toValid) =>
  safely(() => {
    const entries = JSON.parse(storage.getItem(key) ?? '[]');
    return Array.isArray(entries) ? entries.map(toValid).filter(Boolean) : [];
  }, []);

// Wygrane symulatora, każda z polem `game`.
export const readHistory = (storage) => readEntries(storage, HISTORY_KEY, toEntry);

// Zestawy generatora.
export const readGenerated = (storage) => readEntries(storage, GENERATED_KEY, toGenerated);

// Bez zgody baner wraca po co piątej ukończonej symulacji w wizycie. Rzadziej —
// odwiedzający zapomina, że historię da się włączyć; częściej — baner zasłania
// wynik prawie za każdym razem i odmowa przestaje być wyborem.
export const CONSENT_REMINDER_EVERY = 5;
export const consentReminderDue = (completedRuns) => completedRuns > 0 && completedRuns % CONSENT_REMINDER_EVERY === 0;

export const hasConsent = (storage) => safely(() => storage.getItem(CONSENT_KEY) === 'accepted', false);

// Zwraca false, gdy magazyn odmówił — zgoda obowiązuje wtedy tylko do
// końca wizyty (strona pamięta ją sama).
export const giveConsent = (storage) =>
  safely(() => {
    storage.setItem(CONSENT_KEY, 'accepted');
    return true;
  }, false);

// Najnowsze HISTORY_LIMIT wpisów każdej gry, kolejność bez zmian.
const trimPerGame = (history) => {
  const kept = {};
  return history.filter(({ game }) => (kept[game] = (kept[game] ?? 0) + 1) <= HISTORY_LIMIT);
};

// Dopisuje wpis na początek listy spod `key`, tnie do HISTORY_LIMIT na grę.
// Bez zgody niczego nie zapisuje. Zwraca listę po zmianie (bez zmiany, gdy
// zapis się nie udał). `normalize` układa liczby wpisu pula po puli, każdą
// rosnąco (rzuca, gdy nie pasują do gry).
const record = (storage, key, toValid, normalize, entry) => {
  const entries = readEntries(storage, key, toValid);
  if (!hasConsent(storage)) return entries;
  const valid = safely(() => toValid(normalize(entry)), null);
  if (!valid) throw new RangeError(`Wpis historii nie pasuje do kuponu gry: ${JSON.stringify(entry)}.`);
  const updated = trimPerGame([valid, ...entries]);
  return safely(() => {
    storage.setItem(key, JSON.stringify(updated));
    return updated;
  }, entries);
};

// Wygrana symulatora. Gra jest obowiązkowa (splitTicket odrzuca brak gry):
// LEGACY_GAME dotyczy tylko odczytu starych wpisów — domyślna gra przy
// zapisie wpisałaby wygraną Eurojackpota jako Lotto.
export const recordWin = (storage, { game, numbers, drawsNumber, date }) =>
  record(storage, HISTORY_KEY, toEntry, (entry) => ({ ...entry, numbers: splitTicket(game, numbers).flat() }), {
    game,
    numbers,
    drawsNumber,
    date,
  });

// Generowanie (wszystkie jego zestawy to jeden wpis) — osobna lista, osobny limit.
export const recordGenerated = (storage, { game, sets, drawsNumber, date }) =>
  record(
    storage,
    GENERATED_KEY,
    toGenerated,
    (entry) => ({
      ...entry,
      sets: sets.map(({ numbers, hits }) => ({ numbers: splitTicket(game, numbers).flat(), hits })),
    }),
    { game, sets, drawsNumber, date }
  );
