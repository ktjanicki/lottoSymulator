# Czcionki

Pliki `woff2` skopiowane z pakietu npm Fontsource, podzbiory `latin`
i `latin-ext`, oś `wght` (jeden plik zmienny na podzbiór zamiast pliku na
każdą grubość):

| Pakiet | Wersja | Suma archiwum (npm `dist.integrity`, sprawdzona po pobraniu) |
|---|---|---|
| `@fontsource-variable/inter` | 5.3.0 | `sha512-OupL48va4JNofb97w6NYeF9S7W/kHNKM0Er8Dem5nqi4jeOLrVJDoE8tZEpnMJmtkvNbB1EIPPwHcdkF6b1oUA==` |

Kursywy nie ma — strona jej nie używa; `font-style: italic` przeglądarka
podrobi pochyleniem.

Licencja: SIL Open Font License 1.1 (`LICENSE-inter.txt`). Sumy plików:
`SHA256SUMS` (sprawdza je `npm test`).

Dodanie kroju albo kursywy: pobierz ten sam pakiet w tej samej wersji
(`npm pack`), porównaj sumę archiwum z `npm view <pakiet>@<wersja>
dist.integrity`, skopiuj pliki `latin` i `latin-ext`, przepisz regułę
`@font-face` z pliku CSS pakietu (`wght.css`) do `style.css` i odśwież
`SHA256SUMS`.
