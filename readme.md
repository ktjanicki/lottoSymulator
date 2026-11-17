# Lotto Symulator

Aplikacja napisana hobbystycznie w podróży. Losuje tak długo, aż padnie
główna wygrana z kuponu wybranego przez użytkownika, i pokazuje, ile losowań
to zajęło. Trzy gry, przełączane w nagłówku:

- Lotto — sześć liczb z 49, do „szóstki”;
- Mini Lotto — pięć liczb z 42, do „piątki”
  (adres `lottosymulator.pl/#minilotto`);
- Eurojackpot — pięć liczb z 50 i dwie z 12, do „5 + 2”
  (adres `lottosymulator.pl/#eurojackpot`).

Zasady gier (pule liczb, stopnie wygranych) stoją w jednym miejscu: `GAMES`
w `simulation.js`.

Drugi tryb, przełączany w nagłówku po prawej, to generator
(`lottosymulator.pl/#generator`, dla pozostałych gier `#generator-minilotto`
i `#generator-eurojackpot`):
przeprowadza wybraną liczbę losowań (10–1000 mln, `GENERATOR_DRAWS`
w `generator.js`), liczy, ile razy padł każdy zestaw, i pokazuje sześć
najczęstszych. Każdy z nich można przenieść na kupon symulatora. Generator trzyma w pamięci
licznik na każdy zestaw gry: 14 MB dla Lotto, 1,7 MB dla Mini Lotto (licznik
dwubajtowy — zestawów jest mało, a każdy pada przy miliardzie losowań średnio
1175 razy), 140 MB dla Eurojackpota.

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
`dist/index.html` (`scripts/build.mjs`): wszystko z własnego źródła poza
Google Analytics, skrypty inline tylko ze skrótem policzonym z buildu (Parcel
wstawia importmapę). Przywraca też znaczniki `<head>` i `</head>`, które
usuwa minifikacja — bez nich Search Console nie znajduje znacznika weryfikacji.
Nie wołaj samego `parcel build` do produkcji — strona wyjdzie bez polityki.
`npm start` (serwer deweloperski) działa bez CSP.

Build zamienia też ścieżkę `og:image` na pełny adres z domeny `og:url`
(podgląd linku w komunikatorach), a z tego samego adresu liczy
`<link rel="canonical">`, dane strukturalne (JSON-LD `WebSite` z nazwą
z `og:title`), `robots.txt` i `sitemap.xml` (wyszukiwarki). Do manifestu
aplikacji (`manifest.json`) dopisuje nazwę z `og:title` i podaje go pod tą
nazwą — Parcel zapisuje `.webmanifest`, którego typu nginx na serwerze nie zna.
Obrazek `og-image.png` to zrzut strony — po zmianie wyglądu odśwież go:
`node scripts/og-image.mjs`. Ikony PNG (`icon-*.png`, `apple-touch-icon.png`) liczy
z `favicon.svg` `node scripts/icons.mjs` — po zmianie ikony uruchom go.

Produkcja podaje wynik buildu Parcela. Strona ma jednak działać także podana
wprost, bez buildu (np. zwykły serwer statyczny przy pracy nad kodem): moduły
przeglądarki importują wyłącznie ścieżki względne, czego pilnuje `npm test`.

## Statystyki i zgoda

Baner pyta o zgodę raz, na dwie rzeczy: zapis historii losowań w przeglądarce
(localStorage) i ciasteczka Google Analytics. GA działa w trybie zgody
(Consent Mode v2, `analytics.js`): tag z `index.html` wczytuje się zawsze, bez
zgody wysyła tylko pingi bez ciasteczek. Testy przechwytują domeny Google, więc
ani e2e, ani `check:prod` nie liczą się w statystykach.

Własność witryny w Google Search Console potwierdza znacznik
`google-site-verification` w `index.html` — nie usuwaj go.

## Wdrożenie

Produkcję pod [lottosymulator.pl](https://lottosymulator.pl)
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
npm run check:prod  # scenariusze @prod na lottosymulator.pl
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
numer z `VERSION` i że symulacja każdej gry przechodzi do wyniku (Eurojackpot
trwa zwykle kilkadziesiąt sekund, czasem kilka minut), a generator każdej
gry — do zestawu (Mini Lotto także przy 300 mln losowań, ponad 255 trafień
na zestaw). Tylko czyta stronę —
zapisuje wyłącznie w przeglądarce testu.

## Licencja

Kod: [Apache License 2.0](LICENSE), © 2020–2026 Krzysztof Janicki.
Czcionka Inter w `fonts/` jest na licencji SIL Open Font License 1.1
(`fonts/LICENSE-inter.txt`).
