# Changelog

Sekcje wydania: Dodane, Zmienione, Poprawione, Usunięte, Znane ograniczenia.

## [1.4.0] — 2026-09-27

### Dodane

- Postęp w trakcie symulacji: liczba losowań i czas, odświeżane co milion
  losowań.
- Przycisk „Przerwij”: zatrzymuje symulację i podaje, po ilu losowaniach
  została przerwana.

## [1.3.0] — 2026-09-27

### Dodane

- Wybór liczb klawiaturą i czytnikiem ekranu: liczby są przyciskami, wynik
  symulacji ogłaszany jest jako komunikat stanu.
- Ponowne kliknięcie wybranej liczby zdejmuje ją z kuponu.
- Ikona strony (favicon).

### Zmienione

- Czcionki (Roboto, Poiret One) podawane z serwera strony zamiast Google Fonts.
- Przy szerokości ekranu 801–1024 px ramka ma 800 px i jest wyśrodkowana.

### Poprawione

- Czas symulacji z przecinkiem dziesiętnym („2,3 s”).
- Przewijanie strony w poziomie na wąskich ekranach.
- Opis strony i literówki w tekstach („przeglądarki”, „symulację”, „nr”).

## [1.2.0] — 2026-09-27

### Zmienione

- Symulacja szybsza (w Firefoksie ok. 2–3×): losowanie częściowym tasowaniem
  Fishera-Yatesa.
- Rdzeń symulacji w module `simulation.js`, formatowanie liczb w `format.js`;
  worker jest modułem ES.
- Podsumowanie symulacji podaje tylko czas trwania.

### Usunięte

- Licznik operacji w podsumowaniu symulacji.
- Symulator konsolowy (`lottoSymulatorConsole.js`).

## [1.1.2] — 2026-09-27

### Poprawione

- Dokumentacja: produkcja podaje build Parcela; wymóg działania strony
  bez buildu zostaje.

## [1.1.1] — 2026-09-26

### Poprawione

- Strona podana bez buildu (tak publikuje ją produkcja) znowu działa:
  w 1.1.0 nie działały wybór liczb ani symulacja, a stopka nie miała numeru.
- Numer w stopce pobierany z pliku `VERSION` w czasie działania strony.

## [1.1.0] — 2026-09-26

### Dodane

- Stopka z numerem wersji („wersja X.Y.Z”), wyrównana do prawej.
- Build produkcyjny (`npm run build`) w CI.

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
