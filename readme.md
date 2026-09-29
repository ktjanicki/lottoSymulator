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

Build to Parcel i wstawienie polityki Content-Security-Policy do
`dist/index.html` (`scripts/build.mjs`): wszystko z własnego źródła, skrypty
inline tylko ze skrótem policzonym z buildu (Parcel wstawia importmapę). Nie
wołaj samego `parcel build` do produkcji — strona wyjdzie bez polityki.
`npm start` (serwer deweloperski) działa bez CSP.

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
npm test            # dane, rdzeń symulacji, dyscyplina repozytorium, build
npm run test:e2e    # zbudowana strona w Chromium i Firefoksie (Playwright)
npm run check:prod  # scenariusze @prod na lottosymulator.grossnet.pl
npm run lint        # ESLint i sprawdzenie formatowania (Prettier)
npm run format      # formatowanie Prettierem
```

Przed pierwszym `test:e2e` pobierz przeglądarki: `npx playwright install
chromium firefox`.

CI (GitHub Actions) uruchamia `npm test` i build produkcyjny na dwóch wersjach
Node — z `.node-version` i tej, którą serwer buduje produkcję — oraz
`test:e2e` i `lint`, przy każdym pushu i pull requeście. `production` przesuwa
się dopiero, gdy wszystkie są zielone.

Jednorazowe przeformatowanie Prettierem jest w `.git-blame-ignore-revs`; żeby
`git blame` je pomijał lokalnie:
`git config blame.ignoreRevsFile .git-blame-ignore-revs`.

Po każdym wdrożeniu uruchom `npm run check:prod`: sprawdza, że produkcja podaje
numer z `VERSION` i że symulacja przechodzi do wyniku. Tylko czyta stronę —
zapisuje wyłącznie w przeglądarce testu.

## Licencja

Kod: [Apache License 2.0](LICENSE), © 2020–2026 Krzysztof Janicki.
Czcionka Inter w `fonts/` jest na licencji SIL Open Font License 1.1
(`fonts/LICENSE-inter.txt`).
