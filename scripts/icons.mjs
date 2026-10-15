// Generuje ikony PNG z favicon.svg — jedynego źródła wyglądu ikony. Uruchamiany
// ręcznie po zmianie favicon.svg:
//
//   node scripts/icons.mjs
//
// - icon-192.png: dla przeglądarek i wyszukiwarek, które nie biorą SVG
//   (Google w wynikach chce ikony co najmniej 48 px).
// - apple-touch-icon.png: ikona na ekranie początkowym iOS. Bez niej Safari
//   kładzie tam zrzut strony. Tło nieprzezroczyste: iOS zamienia
//   przezroczystość na czerń, a rogi zaokrągla sam — kula na samym brzegu
//   zostałaby ucięta, więc ma margines.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const svg = readFileSync(join(ROOT, 'favicon.svg'), 'utf8');
const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

// Tło jak --bg ciemnego motywu (style.css).
const ICONS = [
  { file: 'icon-192.png', size: 192, ball: 192, background: 'transparent' },
  { file: 'apple-touch-icon.png', size: 180, ball: 140, background: '#0b0d1a' },
];

const browser = await chromium.launch();
try {
  for (const { file, size, ball, background } of ICONS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<body style="margin:0;display:grid;place-items:center;height:100vh;background:${background}">` +
        `<img src="${src}" width="${ball}" height="${ball}"></body>`
    );
    // Zepsuty SVG (np. „--” w komentarzu XML) daje zrzut pustego pola zamiast
    // błędu — decode() go odrzuca.
    await page
      .locator('img')
      .evaluate((image) => image.decode())
      .catch(() => {
        throw new Error('favicon.svg nie daje się wyświetlić — sprawdź, czy to poprawny XML.');
      });
    await page.screenshot({ path: join(ROOT, file), omitBackground: background === 'transparent' });
    await page.close();
    console.log(`${file}: ${statSync(join(ROOT, file)).size} B`);
  }
} finally {
  await browser.close();
}
