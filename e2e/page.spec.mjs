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
import { GTAG_SCRIPT } from '../analytics.js';

const VERSION = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();
const TICKET = [3, 11, 19, 27, 35, 43];
const CONSENT_KEY = 'lottoSymulator.consent';
const HISTORY_KEY = 'lottoSymulator.history';

// Google Analytics nigdy nie dostaje żądania z testu: inaczej każde wejście
// w e2e i w check:prod liczyłoby się w statystykach strony jako wizyta. Zamiast gtag.js atrapa, która zapisuje, skąd ją wczytano; CSP
// i tak ocenia adres, więc zablokowany skrypt nie ustawi znacznika.
const GOOGLE = /^https:\/\/[^/]*(googletagmanager\.com|google-analytics\.com|analytics\.google\.com)\//;

test.beforeEach(async ({ context }) => {
  await context.route(GOOGLE, (route) =>
    /\/gtag\/js\b/.test(route.request().url())
      ? route.fulfill({ contentType: 'text/javascript', body: 'window.gtagLoaded = document.currentScript.src;' })
      : route.fulfill({ status: 204 })
  );
});

const gtagLoaded = (page) => page.evaluate(() => window.gtagLoaded ?? null);
// Identyfikator z tagu w index.html — jedynego miejsca, gdzie stoi.
const tagId = (page) =>
  page.evaluate((selector) => new URL(document.querySelector(selector).src).searchParams.get('id'), GTAG_SCRIPT);
// Kolejka gtag jako tablice (polecenia to obiekty arguments).
const gtagCommands = (page) => page.evaluate(() => (window.dataLayer ?? []).map((command) => [...command]));
const consentCommands = async (page) =>
  (await gtagCommands(page)).filter(([name]) => name === 'consent').map(([, kind, state]) => [kind, state]);

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
      const data = {
        type: 'result',
        ticketNumbers: ticket.join(', '),
        drawsNumber: ++draws,
        threes: 1,
        fours: 0,
        fives: 0,
        durationMs: 5,
      };
      setTimeout(() => this.listeners.message?.forEach((listener) => listener({ data })), 10);
    }
    terminate() {}
  };
};

// Atrapa workera, który nigdy nie kończy: jeden postęp i cisza. Przerwanie
// prawdziwej symulacji to wyścig — szóstka potrafi paść w ułamku sekundy
// (czas do niej jest losowy), zanim test zdąży kliknąć „Przerwij”, i test
// czekałby na przycisk, który zniknął.
const endlessWorker = () => {
  window.Worker = class {
    constructor() {
      this.listeners = {};
    }
    addEventListener(type, listener) {
      (this.listeners[type] ??= []).push(listener);
    }
    postMessage() {
      const data = { type: 'progress', drawsNumber: 1_000_000, threes: 0, fours: 0, fives: 0, durationMs: 300 };
      setTimeout(() => this.listeners.message?.forEach((listener) => listener({ data })), 10);
    }
    terminate() {
      window.workerTerminated = true;
    }
  };
};

test(
  'stopka podaje numer z pliku VERSION — inaczej produkcja stoi na innym wydaniu, niż myślimy',
  { tag: '@prod' },
  async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.appVersion')).toHaveText(VERSION);
  }
);

test(
  'kliknięcie nagłówka nie wraca na czystą stronę główną — zostaje adres z parametrami albo wybrane liczby',
  { tag: '@prod' },
  async ({ page }) => {
    await page.goto('/?utm_source=test#historia');
    await page.locator('.cookieDecline').click();
    await page.locator('.numbersList [data-number="7"]').click();
    await page.getByRole('link', { name: 'Lotto Symulator' }).click();
    await expect(page).toHaveURL(new URL('/', page.url()).href);
    await expect(page.locator('.numbersList [aria-pressed="true"]')).toHaveCount(0);
  }
);

// Typ MIME to za mało: plik z poprawnym typem i zepsutą treścią przeglądarka
// odrzuca bez słowa i karta jest bez ikony. Dlatego ikonę dekoduje przeglądarka.
test(
  'ikona, której przeglądarka nie wyświetli albo z innym rozmiarem niż w sizes — karta i ekran początkowy bez ikony',
  { tag: '@prod' },
  async ({ page, request }) => {
    await page.goto('/');
    const icons = await page.locator('link[rel="icon"], link[rel="apple-touch-icon"]').evaluateAll((links) =>
      Promise.all(
        links.map(
          (link) =>
            new Promise((resolve) => {
              const image = new Image();
              const result = (decoded) => () =>
                resolve({
                  href: link.href,
                  type: link.type,
                  sizes: link.getAttribute('sizes'),
                  decoded,
                  size: `${image.naturalWidth}x${image.naturalHeight}`,
                });
              image.onload = result(true);
              image.onerror = result(false);
              image.src = link.href;
            })
        )
      )
    );
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon, icon.href).toMatchObject({ decoded: true });
      if (icon.sizes) expect(icon.size, icon.href).toBe(icon.sizes);
      // Plik z testowanego serwera, jak og:image.
      const response = await request.get(new URL(icon.href).pathname);
      expect(response.status(), icon.href).toBe(200);
      if (icon.type) expect(response.headers()['content-type'], icon.href).toContain(icon.type);
    }
  }
);

test(
  'manifest bez nazwy z og:title, z ikoną, której przeglądarka nie wyświetli, albo bez ikon 192 i 512 — strony nie da się zainstalować',
  { tag: '@prod' },
  async ({ page, request }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').evaluate((link) => link.href);
    // Plik z testowanego serwera, jak og:image.
    const response = await request.get(new URL(href).pathname);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^application\/(manifest\+)?json/);
    const manifest = await response.json();
    const title = await page.locator('meta[property="og:title"]').getAttribute('content');
    expect(manifest.name).toBe(title);
    expect(new URL(manifest.start_url, href).href).toBe(new URL('/', page.url()).href);
    const icons = await page.evaluate(
      ({ icons, base }) =>
        Promise.all(
          icons.map(
            (icon) =>
              new Promise((resolve) => {
                const image = new Image();
                const result = (decoded) => () =>
                  resolve({ ...icon, decoded, size: `${image.naturalWidth}x${image.naturalHeight}` });
                image.onload = result(true);
                image.onerror = result(false);
                image.src = new URL(icon.src, base).href;
              })
          )
        ),
      { icons: manifest.icons, base: href }
    );
    for (const icon of icons) expect(icon, icon.src).toMatchObject({ decoded: true, size: icon.sizes });
    const plain = icons.filter((icon) => (icon.purpose ?? 'any').split(' ').includes('any')).map((icon) => icon.sizes);
    expect(plain).toEqual(expect.arrayContaining(['192x192', '512x512']));
  }
);

test(
  'podgląd linku: og:image to pełny adres z domeny og:url i odpowiada obrazkiem PNG',
  { tag: '@prod' },
  async ({ page, request }) => {
    await page.goto('/');
    const ogUrl = await page.locator('meta[property="og:url"]').getAttribute('content');
    const ogImage = new URL(await page.locator('meta[property="og:image"]').getAttribute('content'));
    expect(ogImage.origin).toBe(new URL(ogUrl).origin);
    // Plik pobieramy z testowanego serwera, nie z domeny og:url: lokalnie
    // sprawdzamy ten build, a nie to, co akurat stoi na produkcji.
    const response = await request.get(ogImage.pathname);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^image\/png/);
  }
);

test(
  'wyszukiwarki: canonical i dane strukturalne wskazują og:url, a robots.txt prowadzi do mapy strony z tym samym adresem',
  { tag: '@prod' },
  async ({ page, request }) => {
    await page.goto('/');
    const ogUrl = await page.locator('meta[property="og:url"]').getAttribute('content');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', ogUrl);
    // Pliki z testowanego serwera, jak og:image: lokalnie sprawdzamy ten build.
    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    const sitemapUrl = new URL(/^Sitemap: (\S+)$/m.exec(await robots.text())?.[1]);
    expect(sitemapUrl.origin).toBe(new URL(ogUrl).origin);
    const sitemap = await request.get(sitemapUrl.pathname);
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain(`<loc>${ogUrl}</loc>`);
    // Nazwa witryny w wynikach Google: blok musi być poprawnym JSON-em.
    const data = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
    expect(data).toMatchObject({ '@type': 'WebSite', name: 'Lotto Symulator', url: ogUrl });
  }
);

// Naruszenia CSP zgłoszone przez przeglądarkę od pierwszego bajtu strony
// (skrypt startowy działa przed importmapą i skryptami strony).
const recordViolations = () => {
  window.cspViolations = [];
  document.addEventListener('securitypolicyviolation', (event) =>
    window.cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`)
  );
};

test(
  'polityka CSP blokuje wstrzyknięty skrypt inline — inaczej jedna dziura w HTML-u wykonuje obcy kod',
  { tag: '@prod' },
  async ({ page }) => {
    await page.addInitScript(recordViolations);
    await page.goto('/');
    await page.evaluate(() => {
      const script = document.createElement('script');
      script.textContent = 'window.injected = true';
      document.body.append(script);
    });
    await expect.poll(() => page.evaluate(() => window.cspViolations.length)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.injected)).toBeUndefined();
  }
);

test(
  'pełna symulacja prawdziwym workerem kończy się wygraną i wpisem w historii, bez naruszeń CSP',
  { tag: '@prod' },
  async ({ page }) => {
    // Polityka za ciasna dla własnej strony (np. skrót importmapy, który nie
    // pasuje) blokuje worker albo numer wersji — naruszenie wychodzi tutaj.
    await page.addInitScript(recordViolations);
    await page.goto('/');
    // Już tutaj: zablokowana importmapa psuje worker, a bez tego sprawdzenia
    // test czekałby na wynik do końca limitu.
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    await page.locator('.cookieAccept').click();
    await pickTicket(page);
    // Bez sprawdzania paska postępu po starcie: szóstka potrafi paść, zanim
    // test zdąży na niego spojrzeć.
    await page.locator('.startButton').click();

    await expect(page.locator('.winResult')).toBeVisible({ timeout: 140_000 });
    // Liczba grupowana twardą spacją: „12 345 678”.
    await expect(page.locator('.resultCounterTotal')).toHaveText(/^\d{1,3}(\u00a0\d{3})*$/);
    await expect(page.locator('.resultTicketNumbers')).toHaveText(TICKET.join(', '));
    await expect(page.locator('.simulationProgress')).toBeHidden();
    await expect(page.locator('.startButton')).toBeEnabled();
    await expect(page.locator('.historyCount')).toHaveText('1');
    expect(JSON.parse(await stored(page, HISTORY_KEY))[0].numbers).toEqual(TICKET);
    await expect(page.locator('.appVersion')).toHaveText(VERSION);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  }
);

test(
  '„Przerwij” zabija worker, podaje liczbę losowań z ostatniego postępu i oddaje kupon',
  { tag: '@prod' },
  async ({ page }) => {
    await page.addInitScript(endlessWorker);
    await page.goto('/');
    await page.locator('.cookieDecline').click();
    await pickTicket(page);
    await page.locator('.startButton').click();
    await expect(page.locator('.progressCount')).toHaveText(/^1\u00a0000\u00a0000 losowań/);
    await page.locator('.abortButton').click();

    await expect(page.locator('.simulationAborted')).toHaveText(
      'Symulacja przerwana po ponad 1\u00a0000\u00a0000 losowaniach (0,3 s).'
    );
    expect(await page.evaluate(() => window.workerTerminated)).toBe(true);
    await expect(page.locator('.simulationProgress')).toBeHidden();
    await expect(page.locator('.winResult')).toBeHidden();
    await expect(page.locator('.startButton')).toBeFocused();
    await expect(page.locator('.selectedItems .ball').first()).toBeEnabled();
  }
);

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

test(
  'bez zgody gtag.js liczy wizytę z odmową ciasteczek — przy otwartym banerze i po odmowie',
  { tag: '@prod' },
  async ({ page }) => {
    await page.addInitScript(recordViolations);
    await page.goto('/');
    await expect(page.locator('.cookieBanner')).toBeVisible();
    const id = await tagId(page);
    expect(id).toMatch(/^G-[A-Z0-9]+$/);
    await expect.poll(() => gtagLoaded(page)).toContain(`id=${id}`);
    // Odmowa musi stać przed config — inaczej pierwszy pomiar ustawia _ga bez zgody.
    const commands = await gtagCommands(page);
    const consentAt = commands.findIndex(([name, kind]) => name === 'consent' && kind === 'default');
    const configAt = commands.findIndex(([name]) => name === 'config');
    expect(commands[configAt]).toEqual(['config', id]);
    expect(consentAt).toBeGreaterThanOrEqual(0);
    expect(consentAt).toBeLessThan(configAt);
    expect(commands[consentAt][2]).toMatchObject({ analytics_storage: 'denied', ad_storage: 'denied' });

    await page.locator('.cookieDecline').click();
    expect(await consentCommands(page)).toEqual([['default', commands[consentAt][2]]]);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  }
);

test('„Akceptuję” włącza ciasteczka statystyk, reklamowych nie', { tag: '@prod' }, async ({ page }) => {
  await page.goto('/');
  await page.locator('.cookieAccept').click();
  expect((await consentCommands(page)).at(-1)).toEqual(['update', { analytics_storage: 'granted' }]);
});

test(
  'zapisana zgoda włącza ciasteczka statystyk od pierwszego pomiaru, bez banera',
  { tag: '@prod' },
  async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, 'accepted'), CONSENT_KEY);
    await page.goto('/');
    await expect(page.locator('.cookieBanner')).toBeHidden();
    expect(await consentCommands(page)).toEqual([
      ['default', expect.objectContaining({ analytics_storage: 'granted', ad_storage: 'denied' })],
    ]);
  }
);

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

test('zgoda i wygrana z jednej karty od razu widoczne w drugiej, razem ze statystykami', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await first.addInitScript(fakeWorker);
  await first.goto('/');
  await second.goto('/');

  await first.locator('.cookieAccept').click();
  await expect(second.locator('.cookieBanner')).toBeHidden();
  expect((await consentCommands(second)).at(-1)).toEqual(['update', { analytics_storage: 'granted' }]);

  await first.bringToFront();
  await pickTicket(first);
  await first.locator('.startButton').click();
  await expect(first.locator('.historyCount')).toHaveText('1');
  await expect(second.locator('.historyCount')).toHaveText('1');
});
