# Changelog

Sekcje wydania: Dodane, Zmienione, Poprawione, Usunięte, Znane ograniczenia.

## [1.0.0] — 2026-09-26

### Dodane

- Wybór sześciu liczb z 49 na planszy, usuwanie wybranej liczby kliknięciem.
- Symulacja losowań w Web Workerze aż do trafienia „szóstki”.
- Podsumowanie symulacji: numer losowania z „szóstką”, liczba trafionych
  trójek, czwórek i piątek, liczba operacji i czas trwania.
- Plik `VERSION` jako jedyne źródło numeru wydania.
- Test zgodności wersji (`npm test`): `VERSION`, `package.json`,
  `package-lock.json`, `CHANGELOG.md` i tagi `v*`.

### Znane ograniczenia

- Brak testów zachowania aplikacji; `npm test` sprawdza wyłącznie
  wersjonowanie.
