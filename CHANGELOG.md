# Changelog

Sekcje wydania: Dodane, Zmienione, Poprawione, Usunięte, Znane ograniczenia.

## [1.0.4] — 2026-09-26

### Dodane

- CI na GitHub Actions: `npm ci` i `npm test` przy pushu do `master`,
  tagach `v*` i pull requestach.
- Plik `.node-version` z przypiętą wersją Node.js (26.8.2).

## [1.0.3] — 2026-09-26

### Zmienione

- Symulator konsolowy: `lottoSymulatorConsole.txt` → `lottoSymulatorConsole.js`.

### Poprawione

- Symulator konsolowy wypisuje każde losowanie z flagą `full`, zgodnie
  z opisem (wcześniej działała tylko nieopisana `-dev`).
- Literówka w komunikacie o wygranej („WYGRAŁEŚ”).

### Usunięte

- Flaga `-dev` symulatora konsolowego.

## [1.0.2] — 2026-09-26

### Poprawione

- Symulator konsolowy losuje liczby z zakresu 1–49 (wcześniej 1–48).

### Usunięte

- Google Analytics (Universal Analytics) z `index.html`.

## [1.0.1] — 2026-09-26

### Zmienione

- `parcel-bundler` 1.12.5 zastąpiony przez `parcel` 2.16.4, przypięty co do
  numeru, w `devDependencies`.
- Uruchamianie: `npm start` (serwer deweloperski) i `npm run build`
  (paczka w `dist/`) zamiast globalnego `parcel index.html`.

### Usunięte

- Nieużywana zależność `build-image`.
- Pole `main` z `package.json`.

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
