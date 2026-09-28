// Historia wygranych i zgoda na jej zapis — w localStorage przeglądarki.
// Bez DOM: `storage` jest wstrzykiwany (strona podaje localStorage, testy
// własny magazyn), żeby testy mogły sprawdzić każdą gałąź wprost.

import { MAX_NUMBER, TICKET_SIZE } from './simulation.js';

// Zmiana klucza gubi historię i zgodę zapisane u odwiedzających.
export const HISTORY_KEY = 'lottoSymulator.history';
export const CONSENT_KEY = 'lottoSymulator.consent';
// 500 wpisów to ok. 50 KB; bez limitu historia rośnie do ~5 MB limitu
// przeglądarki i od tej chwili każdy zapis cicho się nie udaje.
export const HISTORY_LIMIT = 500;
export const HISTORY_PAGE = 15;

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

const isEntry = (entry) =>
  Array.isArray(entry?.numbers) &&
  entry.numbers.length === TICKET_SIZE &&
  entry.numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_NUMBER) &&
  Number.isInteger(entry.drawsNumber) &&
  entry.drawsNumber > 0 &&
  Number.isFinite(entry.date);

// Wpisy od najnowszego. Uszkodzony JSON albo obce wpisy (ręczna edycja,
// dane starszej wersji) odpadają — lista ich nie wyrenderuje.
export const readHistory = (storage) =>
  safely(() => {
    const entries = JSON.parse(storage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(entries) ? entries.filter(isEntry) : [];
  }, []);

export const hasConsent = (storage) => safely(() => storage.getItem(CONSENT_KEY) === 'accepted', false);

// Zwraca false, gdy magazyn odmówił — zgoda obowiązuje wtedy tylko do
// końca wizyty (strona pamięta ją sama).
export const giveConsent = (storage) =>
  safely(() => {
    storage.setItem(CONSENT_KEY, 'accepted');
    return true;
  }, false);

// Dopisuje wygraną na początek, tnie do HISTORY_LIMIT. Bez zgody niczego nie
// zapisuje. Zwraca historię po zmianie (bez zmiany, gdy zapis się nie udał).
export const recordWin = (storage, { numbers, drawsNumber, date }) => {
  const history = readHistory(storage);
  if (!hasConsent(storage)) return history;
  const entry = { numbers: numbers.map(Number).sort((a, b) => a - b), drawsNumber, date };
  if (!isEntry(entry)) throw new RangeError(`Wpis historii nie pasuje do kuponu: ${JSON.stringify(entry)}.`);
  const updated = [entry, ...history].slice(0, HISTORY_LIMIT);
  return safely(() => {
    storage.setItem(HISTORY_KEY, JSON.stringify(updated));
    return updated;
  }, history);
};
