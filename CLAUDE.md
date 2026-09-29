# Symulator LOTTO — zasady pracy

Statyczna strona (HTML, CSS, JavaScript, moduły ES, Web Worker) budowana
Parcelem 2. Node i npm tylko do buildu, testów i narzędzi. Produkcja:
lottosymulator.grossnet.pl, budowana i podawana przez serwer z repozytorium
`grossnet-vps-iac` (`~/dev/grossnet-vps-iac`).

## Język i nazewnictwo

- Komunikujemy się po polsku.
- Komentarze w kodzie, dokumentacja, komunikaty asercji, nazwy i docstringi
  testów (także tytuły scenariuszy Playwrighta) — po polsku.
- Zmienne, funkcje, pliki, klucze w JSON-ie i YAML-u — po angielsku.
- Teksty na stronie — po polsku, bez form nacechowanych rodzajem
  („Szóstka!”, nie „Wygrałeś!”).
- Commity — po angielsku, zwięźle i technicznie (patrz niżej).

## Czego nie robić bez pytania

- **Nie pushuj.** Commit tak, push i tag zdalny — wyłącznie na wyraźne polecenie.
  Push na `master` to wdrożenie (patrz „Wdrożenie”). Zgoda na push dotyczy
  jednego wydania, nie kolejnych.
- **Nie pushuj na `production`** — przesuwa ją wyłącznie CI.
- Nie wdrażaj niczego z `grossnet-vps-iac` (`make web` itd.) — to maszyna
  z pocztą i DNS; wdrożenie uruchamia człowiek. Tamto repozytorium ma własne
  zasady (`claude.md` w jego katalogu), w tym zakaz pushowania bez polecenia.
- Nie zmieniaj zakresu po cichu: gdy po drodze wyjdzie coś spoza zadania
  (rozjazd, zepsuty test, dług), zatrzymaj się i zapytaj, co z tym zrobić.

## Metoda pracy

Każda zmiana przechodzi te kroki, w tej kolejności:

1. **Ustalenia** — rozpoznanie w kodzie, potem pytania o decyzje, które należą
   do człowieka (treść strony, nowe zależności, zmiany w `grossnet-vps-iac`).
   Decyzje z konwencją w repozytorium (istniejący wzorzec, reguła numeru)
   proponuj, nie pytaj.
2. **Plan** — w `plan/<wersja>.md` (katalog w `.gitignore`): decyzje w tabeli
   (z kolumną „kto”: człowiek / propozycja / konwencja), etapy jako lista do
   odhaczenia, sekcja „czego to NIE obejmuje”. Odhaczaj na bieżąco, także push
   i sprawdzenie produkcji.
3. **Kod** — etapami, które da się osobno zacommitować.
4. **Testy** — warstwy niżej, zanim cokolwiek wyjdzie na produkcję.
5. **Dokumentacja** — w tym samym commicie co zmiana, której dotyczy.
6. **Commit** — jeden etap = jeden commit; wydanie ma własny commit.

## Źródła prawdy

- **Jedno miejsce na każdą wartość.** Kopia prędzej czy później skłamie:
  - numer wydania — `VERSION` (`package.json`, `package-lock.json`,
    `CHANGELOG.md` i tagi `v*` muszą się zgadzać; pilnuje `test/version.test.js`);
  - adres strony — `og:url` w `index.html` (build liczy z niego `og:image`);
  - gra — `MAX_NUMBER` i `TICKET_SIZE` w `simulation.js`;
  - Node budujący produkcję — obraz w `grossnet-vps-iac`
    (`10_versions.yml` → `images.node`); `.github/workflows/ci.yml` przepisuje
    ten numer do macierzy i trzeba go zmieniać razem z obrazem.
- Wartości liczone wyliczaj w buildzie, zamiast wpisywać ręcznie (np. skrót
  importmapy w CSP). Dwie drogi, które muszą się zgadzać, niech liczą wartość
  TĄ SAMĄ funkcją: serwer, e2e i test stopki budują przez `scripts/build.mjs`.
- Wersje zależności przypięte co do numeru (`--save-exact`); suma integralności
  w `package-lock.json` ma się zgadzać z `npm view <pakiet>@<wersja> dist.integrity`.
  Pliki spoza npm (czcionki) — suma policzona z pobranego archiwum
  (`fonts/README.md`, `fonts/SHA256SUMS`).

## Architektura — czego nie psuć

- **Strona działa także bez buildu** (moduły importują tylko ścieżki względne;
  pilnuje `test/browser-imports.test.js`). Import rozwiązywany tylko przez
  bundler unieważnia w przeglądarce cały moduł — tak padło wydanie 1.1.0.
- **Produkcja to wynik `npm run build`** (`scripts/build.mjs`: Parcel, potem
  pełny adres `og:image` i CSP w `<meta>`). Sam `parcel build` daje stronę bez
  polityki. Serwer instaluje zależności `npm ci --ignore-scripts` — zależność,
  która bez skryptu instalacyjnego nie działa, nie przejdzie na produkcji.
- **CSP** siedzi w `<meta>`, nie w nagłówku, bo skrót importmapy Parcela
  zmienia się z każdym buildem. Nowy skrypt inline albo zasób z obcej domeny
  wymaga zmiany polityki w `scripts/build.mjs`, inaczej przeglądarka go zablokuje.
- **Rdzeń bez DOM**: `simulation.js`, `format.js`, `history.js` nie dotykają
  strony — zależności (`random`, `storage`) są wstrzykiwane, żeby testy
  wołały je wprost. DOM tylko w `index.js`; `render()` i `renderHistory()` to
  jedyne miejsca, które ustawiają stan kontrolek.
- **Worker** liczy synchronicznie — przerwanie to `terminate()`, nie wiadomość.
  Protokół: `{type: 'progress' | 'result' | 'error'}`.
- **localStorage** tylko za zgodą (klucze w `history.js`; zmiana klucza gubi
  dane odwiedzających). Odmowy nie zapisujemy.

## Testy — cztery warstwy

| Warstwa | Co                                                                                                | Polecenie                                                   | Kiedy                                                     |
| ------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| 1       | rdzeń, formatowanie, historia, dyscyplina repozytorium (wersje, importy, czcionki, CSP, og:image) | `npm test` (`node --test`)                                  | każdy commit, CI na Node z `.node-version` i Node serwera |
| 2       | zbudowana strona (build jak na produkcji)                                                         | `npm test` (`test/footer-version.test.js`), `npm run build` | każdy commit, CI                                          |
| 3       | strona wykonana w Chromium i Firefoksie, na wyniku buildu                                         | `npm run test:e2e` (Playwright, `e2e/`)                     | każdy commit, CI                                          |
| 4       | produkcja z zewnątrz: numer z `VERSION`, pełna symulacja, CSP, og:image                           | `npm run check:prod` (scenariusze `@prod`)                  | po każdym wdrożeniu                                       |

Do tego `npm run lint` (ESLint + Prettier) — każdy commit, CI.

Zasady:

- Asercja na **zachowanie**, nie na treść pliku, który sami napisaliśmy.
- Test ma sprawdzać także gałąź, której produkcja dziś nie uruchamia
  (np. 404 pliku workera, odmowa zgody) — inaczej nie sprawdza niczego.
- Nowy test sprawdź na czerwono: zepsuj na chwilę kod, który ma pilnować,
  zobacz, że pada, przywróć (i sprawdź, że diff jest pusty).
- Tytuł/docstring testu mówi, **jaka awaria** się za nim kryje, nie co robi kod.
- **Czas do szóstki jest losowy** (rozkład geometryczny: zwykle kilka sekund,
  czasem kilkanaście razy dłużej, czasem ułamek sekundy). Test z prawdziwym
  workerem nie może zakładać, że zdąży coś kliknąć przed wygraną ani że
  zobaczy pasek postępu — tam, gdzie liczy się logika strony, używaj atrapy
  workera (`e2e/page.spec.mjs`).
- Scenariusz lokalny nie ma prawa zależeć od produkcji ani jej dotykać
  (np. og:image pobieramy z testowanego serwera, nie z domeny z `og:url`).
  `check:prod` tylko czyta stronę; zapisuje wyłącznie w przeglądarce testu.
- Czerwony test sprzed zmiany: najpierw ustal, czy jest twój. Nie łataj
  asercji, żeby przeszła.

## Wdrożenie

- Push na `master` → CI (`test` na dwóch wersjach Node, `e2e`, `lint`) →
  job `publish` przesuwa gałąź `production` (tylko fast-forward) → serwer
  odpytuje `production` co 5 minut i buduje. Czerwony commit nie wychodzi.
- Po pushu sprawdź: wynik CI dla `master` i tagu (API GitHuba, repozytorium
  jest publiczne), gałąź `production`, numer na produkcji (plik
  `VERSION.<suma>.` wskazany w `index.html`), potem `npm run check:prod`.
- `grossnet-vps-iac` jest prywatne — jego CI sprawdza człowiek. `make web`
  i inne playbooki uruchamia człowiek; z `!` w tej sesji Ansible odmawia
  (nieblokujące stdout) — trzeba zwykłego terminala albo przekierowania
  do pliku.

## Dokumentacja

- `README.md` — zakres, uruchomienie, build, wdrożenie, testy, licencja.
- `CLAUDE.md` — zasady pracy w tym repozytorium; zmiana architektury, testów
  albo wdrożenia, która unieważnia jego zdanie, poprawia je w tym samym commicie.
- `CHANGELOG.md` — co się zmieniło, bez uzasadnień, bez tłumaczeń; stała lista
  sekcji: Dodane, Zmienione, Poprawione, Usunięte, Znane ograniczenia (pilnuje
  `test/version.test.js`). Świadomie zostawione braki idą do „Znanych ograniczeń”.
- Uzasadnienia — w komentarzach przy kodzie (co się stanie, gdy to zmienisz),
  nie w osobnym dzienniku.
- Stan strony po stronie serwera (gałąź publikacji, obraz Node, rejestr długu)
  opisuje `grossnet-vps-iac` (`docs/17-strony-www.md`, `docs/33-dlug-techniczny.md`)
  — zmiana tutaj, która zmienia tamto zdanie, wymaga zmiany tam (za zgodą).
- Zdanie w dokumentacji, które przestało być prawdą po zmianie, poprawiasz
  w tym samym commicie.

## Wersjonowanie

- Jedno źródło: plik `VERSION`.
- Pytanie rozstrzygające: _co musi zrobić człowiek, żeby przejść na to wydanie?_
  - major — ręczna praca poza automatem (np. zmiana w `grossnet-vps-iac`
    i `make web`, bez której wydanie nie działa; migracja danych w localStorage);
  - minor — nowa zdolność wychodząca samym pushem;
  - patch — poprawka, przypięcie wersji, dokumentacja, test, narzędzia.
- Nie ma wydań przedpremierowych: wydanie jest na produkcji i przeszło
  `check:prod` albo nie istnieje.
- Numer podany przez człowieka, który łamie tę regułę — zwróć uwagę i zapytaj.

## Styl kodu

- Formatowanie: Prettier (`.prettierrc.json`), przed commitem `npm run lint`
  (albo `npm run format`). ESLint tylko na błędy logiczne; globalne zmienne
  zależą od miejsca wykonania (`eslint.config.mjs`) — kod w `evaluate`
  i `addInitScript` wykonuje się w przeglądarce.
- Komentarz mówi **dlaczego** i **co się stanie, gdy to zmienisz** — objaw
  awarii, zwłaszcza cichej. Nie opisuje, co robi następna linia.
- Błąd na wejściu modułu/buildu z komunikatem mówiącym, co poprawić i gdzie.
- Nie polegaj na locale ani na strefie czasowej: liczby, czas i daty
  formatuje `format.js` ręcznie (twarda spacja w liczbach, przecinek dziesiętny).
- Dostępność: kontrolki to `<button>`, fokus nie może spaść na `<body>` po
  zniknięciu elementu, animacje respektują `prefers-reduced-motion`.
- Dopasuj się do otoczenia: gęstość komentarzy, nazewnictwo i idiomy jak
  w sąsiednim kodzie.

## Commity

- Po angielsku, tryb rozkazujący, prefiks obszaru: `feat(ui):`, `fix(ui):`,
  `feat(security):`, `test(e2e):`, `ci:`, `build:`, `style:`, `docs:`,
  `release: X.Y.Z — <opis po polsku>`.
- Pierwsza linia ≤ 72 znaki; w treści punkty: co i dlaczego, bez historii
  dochodzenia do rozwiązania.
- Jeden etap = jeden commit; wydanie ma własny commit (`VERSION`,
  `package.json`, `package-lock.json`, `CHANGELOG.md`); tag adnotowany `vX.Y.Z`
  na commicie wydania.
- Mechaniczne przeformatowanie — osobny commit, dopisany do `.git-blame-ignore-revs`.
- Nie podpisuj commitów jako Claude (bez `Co-Authored-By`).

## Raportowanie

- Wynik mówi, co zostało wdrożone i czym to sprawdzono (`npm test`,
  `test:e2e`, `lint`, CI, `check:prod`), a co zostało człowiekowi (push,
  `make web`, CI prywatnego repozytorium).
- Własne błędy wyłapane po drodze wymień wprost, razem z poprawką.
- Czego nie sprawdziłeś — powiedz, że nie sprawdziłeś.
