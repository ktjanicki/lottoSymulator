# Czcionki

Pliki `woff2` skopiowane z pakietów npm Fontsource, podzbiory `latin`
i `latin-ext`:

| Pakiet | Wersja | Suma archiwum (npm `dist.integrity`, sprawdzona po pobraniu) |
|---|---|---|
| `@fontsource/roboto` | 5.3.0 | `sha512-BapRJOWYP+LZ21zp+wBQjfpPYKRoxc4LspJ/RLuI+HSMBD5u/X4O+ESDrSvEqDSy0rAl7GwBJ+09mdc16cVQ1Q==` |
| `@fontsource/poiret-one` | 5.3.0 | `sha512-nCAUIB6f5805lUG7t0ES0W0YhJHcKa2EPlafb7/0AU1W/V4tQvmoSbwNNUnt6nVIagvyStxLG5nzqMptQ3FCgQ==` |

Licencja: SIL Open Font License 1.1 (`LICENSE-*.txt`). Sumy plików:
`SHA256SUMS` (sprawdza je `npm test`).

Dodanie grubości albo kroju: pobierz ten sam pakiet w tej samej wersji
(`npm pack`), porównaj sumę archiwum z `npm view <pakiet>@<wersja>
dist.integrity`, skopiuj pliki `latin` i `latin-ext`, przepisz regułę
`@font-face` z pliku CSS pakietu do `style.css` i odśwież `SHA256SUMS`.
