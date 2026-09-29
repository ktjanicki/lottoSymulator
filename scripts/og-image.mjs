// Generuje og-image.png — obrazek podglądu linku (og:image, 1200×630) — zrzutem
// strony z przeglądarki. Uruchamiany ręcznie po zmianie wyglądu strony:
//
//   node scripts/og-image.mjs
//
// Strona jest podawana wprost z plików repozytorium (działa bez buildu), przez
// przechwycenie żądań w Playwrighcie — bez serwera i bez sieci. Motyw jasny:
// og:image nie ma wariantu ciemnego, a podgląd w komunikatorze pokazuje się
// na tle, którego nie znamy.

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORIGIN = 'http://og-image.invalid';
const TICKET = [7, 13, 21, 28, 35, 42];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, colorScheme: 'light' });
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
  // Plansza jest wyższa niż 630 px: pomniejszenie mieści nagłówek i wszystkie
  // 49 kul. Kliknięcia przewijają stronę, pasek przewijania zjadałby brzeg.
  await page.addStyleTag({ content: 'html { zoom: 0.78; scrollbar-width: none; }' });
  // Kursor po ostatnim kliknięciu stoi po pomniejszeniu nad przyciskiem startu.
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    document.activeElement?.blur();
    window.scrollTo(0, 0);
    return document.fonts.ready;
  });
  await page.screenshot({ path: join(ROOT, 'og-image.png') });
  console.log(`og-image.png: ${statSync(join(ROOT, 'og-image.png')).size} B`);
} finally {
  await browser.close();
}
