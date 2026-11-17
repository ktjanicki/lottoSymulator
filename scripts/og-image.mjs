// Generuje og-image.png — obrazek podglądu linku (og:image, 1200×630) — zrzutem
// strony z przeglądarki. Uruchamiany ręcznie po zmianie wyglądu strony:
//
//   node scripts/og-image.mjs
//
// Strona jest podawana wprost z plików repozytorium (działa bez buildu), przez
// przechwycenie żądań w Playwrighcie — bez serwera i bez sieci. Motyw ciemny
// (decyzja z wydania 1.11.0): og:image nie ma wariantu jasnego i ciemnego,
// więc podgląd wygląda tak samo na każdym tle komunikatora.

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORIGIN = 'http://og-image.invalid';
const TICKET = [7, 13, 21, 28, 35, 42];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, colorScheme: 'dark' });
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const file = join(ROOT, path === '/' ? 'index.html' : path);
    if (!file.startsWith(ROOT) || !statSync(file, { throwIfNoEntry: false })?.isFile())
      return route.fulfill({ status: 404 });
    return route.fulfill({ path: file });
  });
  // Bez banera zgody na zrzucie.
  await page.addInitScript(() => localStorage.setItem('lottoSymulator.consent', 'accepted'));
  await page.goto(`${ORIGIN}/`);
  for (const number of TICKET) await page.locator(`.numbersList [data-number="${number}"]`).click();
  // Plansza jest wyższa niż 630 px: pomniejszenie mieści nagłówek
  // (z przełącznikami) i wszystkie 49 kul — og:image:alt w index.html mówi
  // o 49 liczbach. Po zmianie wysokości nagłówka sprawdź, czy dolny rząd
  // nie jest ucięty. Kliknięcia przewijają stronę, pasek przewijania
  // zjadałby brzeg.
  await page.addStyleTag({ content: 'html { zoom: 0.72; scrollbar-width: none; }' });
  // Kursor po ostatnim kliknięciu stoi po pomniejszeniu nad przyciskiem startu.
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    document.activeElement?.blur();
    window.scrollTo(0, 0);
    // Przycisk startu włącza się po szóstej liczbie z przejściem koloru —
    // bez czekania zrzut łapie go w pół drogi, przygaszonego. Tylko przejścia:
    // animacja nieskończona (wskaźnik postępu) nigdy się nie kończy.
    const transitions = document.getAnimations().filter((animation) => animation instanceof CSSTransition);
    return Promise.all([document.fonts.ready, ...transitions.map((transition) => transition.finished)]);
  });
  await page.screenshot({ path: join(ROOT, 'og-image.png') });
  console.log(`og-image.png: ${statSync(join(ROOT, 'og-image.png')).size} B`);
} finally {
  await browser.close();
}
