# Symulator LOTTO

Aplikacja napisana hobbystycznie w podróży. Losuje sześć liczb z 49 tak długo,
aż padnie „szóstka” z kuponu wybranego przez użytkownika, i pokazuje, ile
losowań to zajęło.

## Uruchomienie

Projekt używa Parcela 2. Instalacja zależności i serwer deweloperski:

```sh
npm install
npm start
```

Build produkcyjny trafia do `dist/`:

```sh
npm run build
```

Produkcja podaje wynik buildu Parcela. Strona ma jednak działać także podana
wprost, bez buildu (np. zwykły serwer statyczny przy pracy nad kodem): moduły
przeglądarki importują wyłącznie ścieżki względne, czego pilnuje `npm test`.

## Wdrożenie

Produkcję pod [lottosymulator.grossnet.pl](https://lottosymulator.grossnet.pl)
serwer buduje i podaje z gałęzi `production`, którą odpytuje co 5 minut
(konfiguracja w repozytorium `grossnet-vps-iac`). Gałąź `production` przesuwa
wyłącznie CI: po zielonych `npm test` i `npm run build` na pushu do `master`
job `publish` przesuwa ją na ten commit. Czerwony commit na `master` nie trafia
więc na stronę. Nie pushuj na `production` ręcznie. Wersję na produkcji widać
w stopce.

## Wersjonowanie

Numer wydania stoi w pliku `VERSION`, opis zmian w `CHANGELOG.md`.
`package.json`, `package-lock.json`, `CHANGELOG.md` i tagi `v*` muszą się z nim
zgadzać — pilnuje tego `npm test`.

## Testy

```sh
npm test
```

CI (GitHub Actions) uruchamia testy i build produkcyjny przy każdym pushu
i pull requeście, na dwóch wersjach Node: z `.node-version` i na tej, którą
serwer buduje produkcję.

## Licencja

Kod: [Apache License 2.0](LICENSE), © 2020–2026 Krzysztof Janicki.
Czcionka Inter w `fonts/` jest na licencji SIL Open Font License 1.1
(`fonts/LICENSE-inter.txt`).
