// Strona wykonana w przeglądarce, na wyniku buildu. Awarie, przed którymi chroni,
// a których testy node --test nie widzą, bo nie wykonują strony:
// - moduł albo worker, który przeglądarka odrzuca (tak padło wydanie 1.1.0:
//   strona odpowiadała 200 i nic na niej nie działało);
// - symulacja, która nie dochodzi do wyniku, i przerwanie, które go nie zatrzymuje;
// - baner zgody, który zapisuje bez zgody albo nie wraca po odmowie;
// - stopka z numerem innym niż wydanie.
// Scenariusze @prod idą też na produkcji (npm run check:prod): tylko czytają
// stronę, a wszystko, co zapisują, zostaje w przeglądarce testu.

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const VERSION = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();
const TICKET = [3, 11, 19, 27, 35, 43];
const CONSENT_KEY = 'lottoSymulator.consent';
const HISTORY_KEY = 'lottoSymulator.history';

const pickTicket = async (page) => {
  for (const number of TICKET) await page.locator(`.numbersList [data-number="${number}"]`).click();
};

const stored = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

// Atrapa workera: od razu zwraca wygraną z kolejnym numerem losowania.
// Tylko tam, gdzie liczy się logika strony po wyniku, a nie sama symulacja —
// pięć prawdziwych symulacji trwałoby minuty.
const fakeWorker = () => {
  let draws = 100;
  window.Worker = class {
    constructor() {
      this.listeners = {};
    }
    addEventListener(type, listener) {
      (this.listeners[type] ??= []).push(listener);
    }
    postMessage(ticket) {
      const data = { type: 'result', ticketNumbers: ticket.join(', '), drawsNumber: ++draws, threes: 1, fours: 0, fives: 0, durationMs: 5 };
      setTimeout(() => this.listeners.message?.forEach((listener) => listener({ data })), 10);
    }
    terminate() {}
  };
};

test('stopka podaje numer z pliku VERSION — inaczej produkcja stoi na innym wydaniu, niż myślimy', { tag: '@prod' }, async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.appVersion')).toHaveText(VERSION);
});

test('pełna symulacja prawdziwym workerem kończy się wygraną i wpisem w historii', { tag: '@prod' }, async ({ page }) => {
  await page.goto('/');
  await page.locator('.cookieAccept').click();
  await pickTicket(page);
  await page.locator('.startButton').click();
  await expect(page.locator('.simulationProgress')).toBeVisible();

  await expect(page.locator('.winResult')).toBeVisible({ timeout: 140_000 });
  // Liczba grupowana twardą spacją: „12 345 678”.
  await expect(page.locator('.resultCounterTotal')).toHaveText(/^\d{1,3}( \d{3})*$/);
  await expect(page.locator('.resultTicketNumbers')).toHaveText(TICKET.join(', '));
  await expect(page.locator('.simulationProgress')).toBeHidden();
  await expect(page.locator('.startButton')).toBeEnabled();
  await expect(page.locator('.historyCount')).toHaveText('1');
  expect(JSON.parse(await stored(page, HISTORY_KEY))[0].numbers).toEqual(TICKET);
});

test('„Przerwij” zatrzymuje symulację i oddaje kupon', { tag: '@prod' }, async ({ page }) => {
  await page.goto('/');
  await page.locator('.cookieDecline').click();
  await pickTicket(page);
  await page.locator('.startButton').click();
  await page.locator('.abortButton').click();

  await expect(page.locator('.simulationAborted')).toHaveText(/^Symulacja przerwana/);
  await expect(page.locator('.simulationProgress')).toBeHidden();
  await expect(page.locator('.winResult')).toBeHidden();
  await expect(page.locator('.startButton')).toBeFocused();
  await expect(page.locator('.selectedItems .ball').first()).toBeEnabled();
});

test('niewczytany plik workera kończy symulację komunikatem, zamiast kręcić spinnerem bez końca', async ({ page }) => {
  await page.route(/simulationWorker\.[^/]*\.js$/, (route) => route.fulfill({ status: 404 }));
  await page.goto('/');
  await page.locator('.cookieDecline').click();
  await pickTicket(page);
  await page.locator('.startButton').click();

  await expect(page.locator('.simulationAborted')).toHaveText(/nie powiodła się/);
  await expect(page.locator('.simulationProgress')).toBeHidden();
  await expect(page.locator('.startButton')).toBeEnabled();
});

test('odmowa niczego nie zapisuje, a baner wraca przy następnym wejściu', { tag: '@prod' }, async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.cookieBanner')).toBeVisible();
  await page.locator('.cookieDecline').click();
  await expect(page.locator('.cookieBanner')).toBeHidden();
  expect(await stored(page, CONSENT_KEY)).toBeNull();

  await page.reload();
  await expect(page.locator('.cookieBanner')).toBeVisible();
});

test('bez zgody baner wraca po 5. ukończonej symulacji, a zgoda wtedy zapisuje tę wygraną', async ({ page }) => {
  await page.addInitScript(fakeWorker);
  await page.goto('/');
  await page.locator('.cookieDecline').click();
  await pickTicket(page);

  for (let run = 1; run <= 4; run++) {
    await page.locator('.startButton').click();
    await expect(page.locator('.resultCounterTotal')).toHaveText(String(100 + run));
    await expect(page.locator('.cookieBanner'), `baner po ${run}. symulacji`).toBeHidden();
  }
  await page.locator('.startButton').click();
  await expect(page.locator('.cookieBanner')).toBeVisible();

  await page.locator('.cookieAccept').click();
  expect(JSON.parse(await stored(page, HISTORY_KEY)).map((entry) => entry.drawsNumber)).toEqual([105]);
  await expect(page.locator('.startButton')).toBeFocused();
});

test('zgoda i wygrana z jednej karty od razu widoczne w drugiej', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await first.addInitScript(fakeWorker);
  await first.goto('/');
  await second.goto('/');

  await first.locator('.cookieAccept').click();
  await expect(second.locator('.cookieBanner')).toBeHidden();

  await first.bringToFront();
  await pickTicket(first);
  await first.locator('.startButton').click();
  await expect(first.locator('.historyCount')).toHaveText('1');
  await expect(second.locator('.historyCount')).toHaveText('1');
});
