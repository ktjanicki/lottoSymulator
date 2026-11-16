// Strona wykonana w przeglądarce, na wyniku buildu. Awarie, przed którymi chroni,
// a których testy node --test nie widzą, bo nie wykonują strony:
// - moduł albo worker, który przeglądarka odrzuca (tak padło wydanie 1.1.0:
//   strona odpowiadała 200 i nic na niej nie działało);
// - symulacja, która nie dochodzi do wyniku, i przerwanie, które go nie zatrzymuje;
// - baner zgody, który zapisuje bez zgody albo nie wraca po odmowie;
// - stopka z numerem innym niż wydanie;
// - przełącznik gry, adres i Wstecz pokazujące różne gry, kupon albo wynik
//   jednej gry w drugiej;
// - generator, który nie dochodzi do zestawu, liczy inną liczbę losowań niż
//   wybrana, przenosi do symulatora nie ten zestaw, miesza swoją historię
//   z wygranymi symulatora albo zostawia stronę
//   w stanie „w toku”, gdy worker odmówi (brak pamięci na liczniki);
// - na telefonie przycisk startu generatora pod sześcioma wierszami zestawów.
// Scenariusze @prod idą też na produkcji (npm run check:prod): tylko czytają
// stronę, a wszystko, co zapisują, zostaje w przeglądarce testu.

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { GTAG_SCRIPT } from '../analytics.js';

const VERSION = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();
const TICKET = [3, 11, 19, 27, 35, 43];
// Eurojackpot: pięć liczb z 50, potem dwie z 12 (kolejność jak w GAMES).
const EURO_TICKET = [
  [4, 9, 23, 31, 47],
  [3, 11],
];
const CONSENT_KEY = 'lottoSymulator.consent';
const HISTORY_KEY = 'lottoSymulator.history';
const GENERATED_KEY = 'lottoSymulator.generated';
// Zestawy, które zwraca atrapa workera w trybie generatora, od najczęstszego
// (każdy pula po puli) — tyle, ile GENERATOR_SETS w generator.js.
const GENERATED = {
  lotto: [
    [[2, 8, 15, 23, 38, 49]],
    [[1, 2, 3, 4, 5, 6]],
    [[7, 14, 21, 28, 35, 42]],
    [[10, 20, 30, 40, 41, 44]],
    [[5, 9, 13, 17, 25, 33]],
    [[44, 45, 46, 47, 48, 49]],
  ],
  eurojackpot: [
    [
      [5, 12, 26, 33, 50],
      [1, 12],
    ],
    [
      [1, 2, 3, 4, 5],
      [1, 2],
    ],
    [
      [7, 14, 21, 28, 35],
      [3, 9],
    ],
    [
      [10, 20, 30, 40, 50],
      [5, 10],
    ],
    [
      [9, 13, 17, 25, 33],
      [2, 11],
    ],
    [
      [46, 47, 48, 49, 50],
      [11, 12],
    ],
  ],
};

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

const ball = (page, pool, number) => page.locator(`.numbersList[data-pool="${pool}"] [data-number="${number}"]`);

const pickEuroTicket = async (page) => {
  for (const [pool, numbers] of EURO_TICKET.entries()) {
    for (const number of numbers) await ball(page, pool, number).click();
  }
};

const gameButton = (page, name) => page.locator('.gameSwitch').getByRole('button', { name, exact: true });
const modeButton = (page, name) => page.locator('.modeSwitch').getByRole('button', { name, exact: true });
const drawsButton = (page, name) => page.locator('.drawsChoice').getByRole('button', { name, exact: true });

// Kafelki stopni: tyle, ile stopni gry, każdy z liczbą grupowaną twardą spacją.
// Rozjazd protokołu strony i workera pokazuje tu „undefined” albo „NaN”.
const expectTierCounts = async (page, count) => {
  const values = page.locator('.stats .statValue');
  await expect(values).toHaveCount(count);
  for (const value of await values.all()) await expect(value).toHaveText(/^\d{1,3}(\u00a0\d{3})*$/);
};

const stored = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

// Atrapa workera: od razu zwraca wygraną z kolejnym numerem losowania,
// a w trybie generatora — zestawy z `generated` i liczbę losowań z wiadomości
// (najczęstszy zestaw pada w kolejnych generowaniach 9, 10, 11… razy,
// następne zestawy o jeden raz mniej każdy).
// Tylko tam, gdzie liczy się logika strony po wyniku, a nie sama symulacja —
// pięć prawdziwych symulacji trwałoby minuty.
const fakeWorker = (generated) => {
  let draws = 100;
  let hits = 8;
  window.Worker = class {
    constructor() {
      this.listeners = {};
    }
    addEventListener(type, listener) {
      (this.listeners[type] ??= []).push(listener);
    }
    postMessage({ mode, game, numbers, draws: generatorDraws }) {
      // Liczba stopni jak w GAMES (simulation.js): Lotto 3, Eurojackpot 11.
      const tiers = new Array(game === 'eurojackpot' ? 11 : 3).fill(0);
      tiers[0] = 1;
      const data =
        mode === 'generator'
          ? {
              type: 'result',
              sets: generated[game].map((set, index) => ({ numbers: set, hits: hits + 1 - index })),
              drawsNumber: generatorDraws,
              durationMs: 5,
            }
          : {
              type: 'result',
              ticketNumbers: numbers.join(', '),
              drawsNumber: ++draws,
              tiers,
              durationMs: 5,
            };
      if (mode === 'generator') hits++;
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
      const data = { type: 'progress', drawsNumber: 1_000_000, tiers: [0, 0, 0], durationMs: 300 };
      setTimeout(() => this.listeners.message?.forEach((listener) => listener({ data })), 10);
    }
    terminate() {
      window.workerTerminated = true;
    }
  };
};

// Atrapa workera, który odmawia: {type: 'error'} zamiast wyniku — tak kończy
// się generator, gdy przeglądarka nie da pamięci na liczniki zestawów.
const refusingWorker = () => {
  window.Worker = class {
    constructor() {
      this.listeners = {};
    }
    addEventListener(type, listener) {
      (this.listeners[type] ??= []).push(listener);
    }
    postMessage() {
      const data = { type: 'error', message: 'Array buffer allocation failed' };
      setTimeout(() => this.listeners.message?.forEach((listener) => listener({ data })), 10);
    }
    terminate() {}
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
  'Search Console: znacznik weryfikacji z index.html stoi w tekście między <head> a </head> — inaczej Google odmawia potwierdzenia własności',
  { tag: '@prod' },
  async ({ request }) => {
    const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const expected = /<meta\s+name="google-site-verification"\s+content="([^"]+)"/.exec(source)?.[1];
    expect(expected, 'index.html nie ma znacznika google-site-verification.').toBeTruthy();
    // Surowy HTML, nie DOM: weryfikator szuka znacznika tekstowo. Parser
    // przeglądarki umieszcza meta w nagłówku także bez <head> — tak przeszedł
    // test, a Search Console odmówił (1.14.1).
    const html = await (await request.get('/')).text();
    const head = /<head>([\s\S]*?)<\/head>/i.exec(html)?.[1];
    expect(head, 'Zbudowana strona nie ma sekcji <head>…</head>.').toBeDefined();
    expect(head).toMatch(new RegExp(`<meta name=["']?google-site-verification["']? content=["']?${expected}["']?>`));
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
    await expectTierCounts(page, 3);
    await expect(page.locator('.resultTicketNumbers')).toHaveText(TICKET.join(', '));
    await expect(page.locator('.simulationProgress')).toBeHidden();
    await expect(page.locator('.startButton')).toBeEnabled();
    await expect(page.locator('.historyCount')).toHaveText('1');
    expect(JSON.parse(await stored(page, HISTORY_KEY))[0]).toMatchObject({ game: 'lotto', numbers: TICKET });
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

test(
  'Eurojackpot z adresu, z przełącznika i po Wstecz — inaczej link do gry otwiera Lotto albo adres i strona pokazują różne gry',
  { tag: '@prod' },
  async ({ page }) => {
    await page.goto('/#eurojackpot');
    await page.locator('.cookieDecline').click();
    await expect(gameButton(page, 'Eurojackpot')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.numbersList[data-pool="0"] .ball')).toHaveCount(50);
    await expect(page.locator('.numbersList[data-pool="1"] .ball')).toHaveCount(12);
    await expect(page.locator('.selectedItems .slot')).toHaveCount(7);
    await expect(page.getByRole('heading', { name: 'Na czym polega Eurojackpot?' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Na czym polega Lotto?' })).toBeHidden();

    await gameButton(page, 'Lotto').click();
    // Lotto bez fragmentu: jeden adres strony głównej, jak canonical.
    await expect(page).toHaveURL(new URL('/', page.url()).href);
    await expect(gameButton(page, 'Lotto')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.numbersList[data-pool="0"] .ball')).toHaveCount(49);
    await expect(page.locator('.numbersList[data-pool="1"] .ball')).toHaveCount(0);
    await expect(page.locator('.euroBoard')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Na czym polega Lotto?' })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/#eurojackpot$/);
    await expect(gameButton(page, 'Eurojackpot')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.numbersList[data-pool="0"] .ball')).toHaveCount(50);

    // Fragment wpisany ręcznie w pasek adresu.
    await page.evaluate(() => (location.hash = 'lotto'));
    await expect(gameButton(page, 'Lotto')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.numbersList[data-pool="0"] .ball')).toHaveCount(49);
  }
);

// Jednorazowy odczyt, nie toHaveCSS: ta asercja ponawia, aż przejście koloru
// się skończy, i przepuściłaby usterkę, którą test ma łapać.
test('wejście wprost na #eurojackpot nie pokazuje pod banerem zgody Lotto jako wybranego', async ({ page }) => {
  await page.goto('/#eurojackpot');
  await expect(page.locator('.cookieBanner')).toBeVisible();
  await expect(gameButton(page, 'Eurojackpot')).toHaveAttribute('aria-pressed', 'true');
  const background = (name) => gameButton(page, name).evaluate((button) => getComputedStyle(button).backgroundColor);
  expect(await background('Lotto')).not.toBe(await background('Eurojackpot'));
  expect(await background('Lotto')).toBe('rgba(0, 0, 0, 0)');
});

test('nieznany fragment adresu (stary link, nazwa z prototypu obiektu) otwiera Lotto zamiast wywrócić stronę', async ({
  page,
}) => {
  for (const hash of [
    '#historia',
    '#toString',
    '#constructor',
    '#generator-keno',
    '#generator-toString',
    '#generatory',
  ]) {
    await page.goto('about:blank');
    await page.goto(`/${hash}`);
    await expect(gameButton(page, 'Lotto'), hash).toHaveAttribute('aria-pressed', 'true');
    await expect(modeButton(page, 'Symulator'), hash).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.numbersList[data-pool="0"] .ball'), hash).toHaveCount(49);
  }
});

test('każda gra ma swój kupon, a ta sama liczba w obu pulach to dwie kule — inaczej zdjęcie jednej zdejmuje drugą', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.cookieDecline').click();
  await pickTicket(page);

  await gameButton(page, 'Eurojackpot').click();
  await expect(page.locator('.selectedItems .ball')).toHaveCount(0);
  await expect(page.locator('.selectedCount')).toHaveText('0/5 + 0/2');
  await expect(page.locator('.startHint')).toHaveText('Wybierz jeszcze 5 liczb z 50 i 2 z 12.');

  await ball(page, 0, 3).click();
  await ball(page, 1, 3).click();
  await expect(page.locator('.selectedCount')).toHaveText('1/5 + 1/2');
  await page.getByRole('button', { name: 'Usuń liczbę 3 z 12' }).click();
  await expect(ball(page, 1, 3)).toHaveAttribute('aria-pressed', 'false');
  await expect(ball(page, 0, 3)).toHaveAttribute('aria-pressed', 'true');
  // Fokus na kuli tej samej puli, nie na 3 z 50 ani na <body>.
  await expect(ball(page, 1, 3)).toBeFocused();

  for (const number of [11, 19, 27, 35]) await ball(page, 0, number).click();
  await expect(page.locator('.startHint')).toHaveText('Wybierz jeszcze 2 liczby z 12.');
  // Pełna pula główna blokuje resztę swojej planszy, nie euroliczby.
  await expect(ball(page, 0, 50)).toBeDisabled();
  await ball(page, 1, 5).click();
  await expect(page.locator('.startHint')).toHaveText('Wybierz jeszcze 1 liczbę z 12.');
  await ball(page, 1, 7).click();
  await expect(page.locator('.startButton')).toBeEnabled();
  await expect(ball(page, 1, 12)).toBeDisabled();

  await gameButton(page, 'Lotto').click();
  await expect(page.locator('.selectedCount')).toHaveText('6/6');
  await expect(page.locator('.startButton')).toBeEnabled();
  await gameButton(page, 'Eurojackpot').click();
  await expect(page.locator('.selectedCount')).toHaveText('5/5 + 2/2');
});

test('wynik Eurojackpota osobno od Lotto, a wygrane obu gier na jednej liście z nazwą gry — inaczej wygrana znika po zmianie gry albo nie wiadomo, czyja jest', async ({
  page,
}) => {
  await page.addInitScript(fakeWorker);
  await page.goto('/');
  await page.locator('.cookieAccept').click();
  await pickTicket(page);
  await page.locator('.startButton').click();
  await expect(page.getByRole('heading', { name: 'Szóstka!' })).toBeVisible();
  await expect(page.locator('.historyCount')).toHaveText('1');

  await gameButton(page, 'Eurojackpot').click();
  // Wynik Lotto nie zostaje nad kuponem Eurojackpota; wygrana Lotto zostaje na liście.
  await expect(page.locator('.winResult')).toBeHidden();
  await expect(page.locator('.historyCount')).toHaveText('1');

  await pickEuroTicket(page);
  await page.locator('.startButton').click();
  await expect(page.getByRole('heading', { name: '5 + 2!' })).toBeVisible();
  await expect(page.locator('.winDraw')).toContainText('„5 + 2” w losowaniu nr');
  await expectTierCounts(page, 11);
  await expect(page.locator('.stats .statLabel').first()).toHaveText('× 5 + 1');
  await expect(page.locator('.stats .statLabel').last()).toHaveText('× 2 + 1');
  await expect(page.locator('.historyCount')).toHaveText('2');
  await page.locator('.historyToggle').click();
  // Od najnowszego: Eurojackpot (5 + 2 kule), pod nim Lotto (6 kul).
  await expect(page.locator('.historyGame')).toHaveText(['Eurojackpot', 'Lotto']);
  await expect(page.locator('.historyItem').first().locator('.ball')).toHaveCount(7);
  await expect(page.locator('.historyItem').first().locator('.ball.euro')).toHaveText(['3', '11']);
  await expect(page.locator('.historyItem').last().locator('.ball')).toHaveCount(6);
  await expect(page.locator('.historyItem').last().locator('.ball.euro')).toHaveCount(0);
  const entries = JSON.parse(await stored(page, HISTORY_KEY));
  expect(entries.map(({ game, numbers }) => [game, numbers])).toEqual([
    ['eurojackpot', EURO_TICKET.flat()],
    ['lotto', TICKET],
  ]);

  await gameButton(page, 'Lotto').click();
  await expect(page.locator('.historyCount')).toHaveText('2');
  await expect(page.locator('.historyGame')).toHaveText(['Eurojackpot', 'Lotto']);
});

test('historia symulatora łączy gry: wpis sprzed Eurojackpota (bez gry) to Lotto, a zmiana gry nie zwija pokazanych porcji', async ({
  page,
}) => {
  // 20 wpisów: dwie porcje „więcej” (po 15). Najstarszy bez gry — zapis sprzed 1.15.0.
  await page.addInitScript(
    ([consentKey, historyKey]) => {
      const euro = Array.from({ length: 19 }, (_, index) => ({
        game: 'eurojackpot',
        numbers: [1, 2, 3, 4, 5, 1, 2],
        drawsNumber: 1000 + index,
        date: 1_790_000_100_000 - index,
      }));
      const legacy = { numbers: [1, 2, 3, 4, 5, 6], drawsNumber: 1234, date: 1_790_000_000_000 };
      localStorage.setItem(consentKey, 'accepted');
      localStorage.setItem(historyKey, JSON.stringify([...euro, legacy]));
    },
    [CONSENT_KEY, HISTORY_KEY]
  );
  await page.goto('/');
  await expect(page.locator('.historyCount')).toHaveText('20');
  await page.locator('.historyToggle').click();
  await expect(page.locator('.historyItem')).toHaveCount(15);
  await page.locator('.historyMore').click();
  await expect(page.locator('.historyItem')).toHaveCount(20);
  await expect(page.locator('.historyMore')).toBeHidden();
  await expect(page.locator('.historyItem').last().locator('.historyGame')).toHaveText('Lotto');
  await expect(page.locator('.historyItem').last().locator('.ball')).toHaveCount(6);

  await gameButton(page, 'Eurojackpot').click();
  await expect(page.locator('.historyCount')).toHaveText('20');
  await expect(page.locator('.historyItem')).toHaveCount(20);
  await expect(page.locator('.historyItem').last().locator('.historyGame')).toHaveText('Lotto');

  // Zmiana trybu pokazuje listę generatora (pustą), a po powrocie — od pierwszej porcji.
  await modeButton(page, 'Generator').click();
  await expect(page.locator('.history')).toBeHidden();
  await modeButton(page, 'Symulator').click();
  await expect(page.locator('.historyItem')).toHaveCount(15);
});

test('w trakcie symulacji gry nie da się zmienić, także przez Wstecz — inaczej wynik trafia do złej gry', async ({
  page,
}) => {
  await page.addInitScript(endlessWorker);
  await page.goto('/');
  await page.locator('.cookieDecline').click();
  await gameButton(page, 'Eurojackpot').click();
  await pickEuroTicket(page);
  await page.locator('.startButton').click();
  await expect(page.locator('.progressCount')).toHaveText(/losowań/);
  await expect(gameButton(page, 'Lotto')).toBeDisabled();

  await page.goBack();
  await expect(page).toHaveURL(/#eurojackpot$/);
  await expect(gameButton(page, 'Eurojackpot')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.numbersList[data-pool="0"] .ball')).toHaveCount(50);
  await expect(page.locator('.simulationProgress')).toBeVisible();

  await page.locator('.abortButton').click();
  await expect(gameButton(page, 'Lotto')).toBeEnabled();
});

test(
  'pełna symulacja Eurojackpota prawdziwym workerem kończy się na 5 + 2 i wpisem w historii tej gry',
  { tag: '@prod' },
  async ({ page }) => {
    // „5 + 2” pada średnio raz na 140 mln losowań: kilkanaście sekund na
    // szybkim komputerze, kilka razy dłużej na wolnym, a czas ma rozkład
    // geometryczny. Przy minucie średnio limit 10 min przekracza mniej niż
    // 1 przebieg na 10 000; niższy daje losowo czerwone CI i check:prod.
    test.setTimeout(660_000);
    await page.addInitScript(recordViolations);
    await page.goto('/#eurojackpot');
    await page.locator('.cookieAccept').click();
    await pickEuroTicket(page);
    await page.locator('.startButton').click();

    await expect(page.locator('.winResult')).toBeVisible({ timeout: 600_000 });
    await expect(page.locator('.resultCounterTotal')).toHaveText(/^\d{1,3}(\u00a0\d{3})*$/);
    await expect(page.locator('.resultTicketNumbers')).toHaveText('4, 9, 23, 31, 47 + 3, 11');
    await expectTierCounts(page, 11);
    await expect(page.locator('.historyCount')).toHaveText('1');
    const entries = JSON.parse(await stored(page, HISTORY_KEY));
    expect(entries[0]).toMatchObject({ game: 'eurojackpot', numbers: EURO_TICKET.flat() });
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  }
);

// Wiersze wyniku generatora: kule każdego zestawu jako liczby i liczba trafień.
const setRows = (page) => page.locator('.generatedSets .generatedSet');
const setNumbers = async (page) =>
  Promise.all(
    (await setRows(page).all()).map(async (row) => (await row.locator('.ball').allTextContents()).map(Number))
  );

test(
  'generator z adresu, z przełącznika i po Wstecz — inaczej link do generatora otwiera symulator albo adres i strona pokazują różne tryby',
  { tag: '@prod' },
  async ({ page }) => {
    await page.goto('/#generator-eurojackpot');
    await page.locator('.cookieDecline').click();
    // Plansza jest ukryta: fokus po banerze idzie na przycisk startu, nie na <body>.
    await expect(page.locator('.startButton')).toBeFocused();
    await expect(modeButton(page, 'Generator')).toHaveAttribute('aria-pressed', 'true');
    await expect(gameButton(page, 'Eurojackpot')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.boards')).toBeHidden();
    await expect(page.locator('.selectedItems')).toBeHidden();
    await expect(page.locator('.drawsChoice button')).toHaveText([
      '10\u00a0mln',
      '50\u00a0mln',
      '100\u00a0mln',
      '300\u00a0mln',
      '500\u00a0mln',
      '1\u00a0000\u00a0mln',
    ]);
    await expect(drawsButton(page, '10\u00a0mln')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: 'Liczba losowań' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Twoje liczby' })).toBeHidden();
    // Przed wynikiem: sześć pustych wierszy, bez przycisków do kliknięcia.
    await expect(setRows(page)).toHaveCount(6);
    await expect(page.locator('.generatedSets .slot')).toHaveCount(6 * 7);
    await expect(page.locator('.toSimulatorButton:visible')).toHaveCount(0);
    await expect(page.locator('.startButton')).toHaveText('Generuj liczby');
    await expect(page.locator('.startButton')).toBeEnabled();
    await expect(page.getByRole('heading', { name: 'Jak działa generator?' })).toBeVisible();

    await modeButton(page, 'Symulator').click();
    await expect(page).toHaveURL(/#eurojackpot$/);
    await expect(modeButton(page, 'Symulator')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.numbersList[data-pool="0"] .ball')).toHaveCount(50);
    await expect(page.locator('.drawsChoice')).toBeHidden();
    await expect(page.locator('.generatedSets')).toBeHidden();
    await expect(page.locator('.selectedItems .slot')).toHaveCount(7);
    await expect(page.locator('.startButton')).toHaveText('Rozpocznij symulację');
    await expect(page.locator('.startButton')).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'Jak działa generator?' })).toBeHidden();

    await page.goBack();
    await expect(page).toHaveURL(/#generator-eurojackpot$/);
    await expect(modeButton(page, 'Generator')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.drawsChoice')).toBeVisible();

    // Generator Lotto to sam #generator; symulator Lotto — adres bez fragmentu.
    await gameButton(page, 'Lotto').click();
    await expect(page).toHaveURL(/#generator$/);
    await expect(page.locator('.generatedSets .slot')).toHaveCount(6 * 6);
    await modeButton(page, 'Symulator').click();
    await expect(page).toHaveURL(new URL('/', page.url()).href);

    // Fragment wpisany ręcznie w pasek adresu.
    await page.evaluate(() => (location.hash = 'generator'));
    await expect(modeButton(page, 'Generator')).toHaveAttribute('aria-pressed', 'true');
    await expect(gameButton(page, 'Lotto')).toHaveAttribute('aria-pressed', 'true');
  }
);

// Jednorazowy odczyt, jak przy #eurojackpot wyżej.
test('wejście wprost na #generator nie pokazuje pod banerem zgody symulatora jako wybranego', async ({ page }) => {
  await page.goto('/#generator');
  await expect(page.locator('.cookieBanner')).toBeVisible();
  await expect(modeButton(page, 'Generator')).toHaveAttribute('aria-pressed', 'true');
  const background = (name) => modeButton(page, name).evaluate((button) => getComputedStyle(button).backgroundColor);
  expect(await background('Symulator')).toBe('rgba(0, 0, 0, 0)');
  expect(await background('Generator')).not.toBe('rgba(0, 0, 0, 0)');
});

for (const [game, hash, pools] of [
  ['lotto', '#generator', [{ max: 49, size: 6 }]],
  [
    'eurojackpot',
    '#generator-eurojackpot',
    [
      { max: 50, size: 5 },
      { max: 12, size: 2 },
    ],
  ],
]) {
  test(
    `generator (${game}) prawdziwym workerem kończy się sześcioma zestawami od najczęstszego i wpisem w swojej historii, bez naruszeń CSP`,
    { tag: '@prod' },
    async ({ page }) => {
      await page.addInitScript(recordViolations);
      await page.goto(`/${hash}`);
      await page.locator('.cookieAccept').click();
      // 10 mln losowań (domyślne): ułamek sekundy na komputerze, kilka na
      // wolnej maszynie — bez sprawdzania paska postępu, jak w symulacji.
      await page.locator('.startButton').click();

      await expect(page.locator('.generatorResult')).toBeVisible({ timeout: 140_000 });
      // Zestawy z prawdziwego workera: liczby gry, każda pula rosnąco, bez
      // powtórek; sześć różnych zestawów.
      const sets = await setNumbers(page);
      expect(sets).toHaveLength(6);
      expect(new Set(sets.map(String)).size).toBe(6);
      for (const balls of sets) {
        expect(balls).toHaveLength(pools.reduce((sum, { size }) => sum + size, 0));
        let offset = 0;
        for (const { max, size } of pools) {
          const part = balls.slice(offset, (offset += size));
          expect(part, `pula 1–${max}`).toEqual([...new Set(part)].sort((a, b) => a - b));
          expect(Math.min(...part)).toBeGreaterThanOrEqual(1);
          expect(Math.max(...part)).toBeLessThanOrEqual(max);
        }
      }
      // Przy 10 mln losowań najczęstsze zestawy padają po kilka razy; „1 raz”
      // znaczyłoby, że liczniki nie liczą. Kolejność: od najczęstszego.
      const hits = (await page.locator('.setHits').allTextContents()).map((text) => {
        expect(text).toMatch(/^([2-9]|\d{2}) razy$/);
        return parseInt(text, 10);
      });
      expect(hits).toEqual([...hits].sort((a, b) => b - a));
      await expect(page.locator('.toSimulatorButton:visible')).toHaveCount(6);
      await expect(page.locator('.resultGeneratorDraws')).toHaveText('10\u00a0000\u00a0000');
      await expect(page.locator('.winResult')).toBeHidden();
      await expect(page.locator('.simulationProgress')).toBeHidden();
      await expect(page.locator('.startButton')).toBeEnabled();
      await expect(page.locator('.historyCount')).toHaveText('1');
      const [entry] = JSON.parse(await stored(page, GENERATED_KEY));
      expect(entry).toMatchObject({ game, drawsNumber: 10_000_000 });
      expect(entry.sets).toEqual(sets.map((numbers, index) => ({ numbers, hits: hits[index] })));
      expect(await stored(page, HISTORY_KEY)).toBeNull();
      expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    }
  );
}

test('generator liczy wybraną liczbę losowań, a jego historia stoi osobno od wygranych i łączy obie gry', async ({
  page,
}) => {
  await page.addInitScript(fakeWorker, GENERATED);
  await page.goto('/');
  await page.locator('.cookieAccept').click();
  await pickTicket(page);
  await page.locator('.startButton').click();
  await expect(page.locator('.historyCount')).toHaveText('1');

  await modeButton(page, 'Generator').click();
  // Wynik symulatora nie zostaje w generatorze, a wygrana nie jest generowaniem.
  await expect(page.locator('.winResult')).toBeHidden();
  await expect(page.locator('.history')).toBeHidden();

  await drawsButton(page, '500\u00a0mln').click();
  await expect(drawsButton(page, '500\u00a0mln')).toHaveAttribute('aria-pressed', 'true');
  await expect(drawsButton(page, '10\u00a0mln')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('.startButton').click();
  await expect(page.locator('.generatorResult')).toBeVisible();
  expect(await setNumbers(page)).toEqual(GENERATED.lotto.map((set) => set.flat()));
  await expect(page.locator('.setHits')).toHaveText(['9 razy', '8 razy', '7 razy', '6 razy', '5 razy', '4 razy']);
  await expect(page.locator('.generatedDraw')).toHaveText(/Przeprowadzono\s+500\u00a0000\u00a0000\s+losowań\./);
  await expect(page.locator('.historyCount')).toHaveText('1');
  await page.locator('.historyToggle').click();
  // Jedno generowanie to jeden wpis z sześcioma zestawami.
  await expect(page.locator('.historyItem')).toHaveCount(1);
  await expect(page.locator('.historyDraws')).toHaveText('500\u00a0000\u00a0000 losowań');
  await expect(page.locator('.runSets > li')).toHaveCount(6);
  await expect(page.locator('.runHits').first()).toHaveText('9 razy');

  // Liczba losowań zostaje po zmianie gry; wynik Lotto nie, jego wpis w historii tak.
  await gameButton(page, 'Eurojackpot').click();
  await expect(page.locator('.generatorResult')).toBeHidden();
  await expect(page.locator('.generatedSets .slot')).toHaveCount(6 * 7);
  await expect(page.locator('.historyCount')).toHaveText('1');
  await expect(drawsButton(page, '500\u00a0mln')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.startButton').click();
  await expect(setRows(page).first().locator('.ball.euro')).toHaveText(['1', '12']);
  await expect(page.locator('.historyCount')).toHaveText('2');
  await expect(page.locator('.historyGame')).toHaveText(['Eurojackpot', 'Lotto']);
  await expect(page.locator('.historyItem').first().locator('.runSets > li').first().locator('.ball')).toHaveCount(7);
  await expect(page.locator('.historyItem').last().locator('.runSets > li').first().locator('.ball')).toHaveCount(6);

  expect(JSON.parse(await stored(page, GENERATED_KEY))).toMatchObject([
    {
      game: 'eurojackpot',
      sets: GENERATED.eurojackpot.map((set, index) => ({ numbers: set.flat(), hits: 10 - index })),
      drawsNumber: 500_000_000,
    },
    {
      game: 'lotto',
      sets: GENERATED.lotto.map((set, index) => ({ numbers: set.flat(), hits: 9 - index })),
      drawsNumber: 500_000_000,
    },
  ]);
  // Pod kluczem wygranych — tylko wygrana: karta sprzed 1.16.0 czyta go po swojemu.
  expect(JSON.parse(await stored(page, HISTORY_KEY)).map(({ game }) => game)).toEqual(['lotto']);

  // Wygrana symulatora dalej stoi na swojej liście — także w Eurojackpocie.
  await modeButton(page, 'Symulator').click();
  await expect(page.locator('.historyCount')).toHaveText('1');
  await expect(page.locator('.historyDraws')).toHaveText('101 losowań');
  await gameButton(page, 'Lotto').click();
  await expect(page.locator('.historyCount')).toHaveText('1');
  await expect(page.locator('.historyDraws')).toHaveText('101 losowań');
});

test('„Do symulatora” wypełnia kupon tej samej gry zestawem z klikniętego wiersza — inaczej symulacja idzie na inne liczby', async ({
  page,
}) => {
  await page.addInitScript(fakeWorker, GENERATED);
  await page.goto('/#generator-eurojackpot');
  await page.locator('.cookieDecline').click();
  await page.locator('.startButton').click();
  // Trzeci zestaw, nie pierwszy: przycisk ma przenosić swój wiersz.
  const picked = GENERATED.eurojackpot[2];
  await page.getByRole('button', { name: 'Przenieś zestaw 3 do symulatora' }).click();

  await expect(page).toHaveURL(/#eurojackpot$/);
  await expect(modeButton(page, 'Symulator')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.selectedCount')).toHaveText('5/5 + 2/2');
  for (const [pool, numbers] of picked.entries()) {
    for (const number of numbers) await expect(ball(page, pool, number)).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.locator('.numbersList [aria-pressed="true"]')).toHaveCount(7);
  await expect(page.locator('.startButton')).toBeFocused();
  // Kule kuponu to przyciski: zestaw da się poprawić.
  await page.getByRole('button', { name: 'Usuń liczbę 9 z 12' }).click();
  await expect(page.locator('.selectedCount')).toHaveText('5/5 + 1/2');

  await ball(page, 1, 9).click();
  await page.locator('.startButton').click();
  await expect(page.locator('.resultTicketNumbers')).toHaveText('7, 14, 21, 28, 35, 3, 9');
  // Wstecz wraca do generatora, już bez zestawów.
  await page.goBack();
  await expect(modeButton(page, 'Generator')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.generatedSets .slot')).toHaveCount(6 * 7);
  await expect(page.locator('.toSimulatorButton:visible')).toHaveCount(0);
});

const box = async (locator) => {
  await expect(locator).toBeVisible();
  return locator.boundingBox();
};

test('na telefonie generator ma liczbę losowań i start nad zestawami, a symulator planszę nad kuponem — inaczej przycisk ląduje pod ekranem', async ({
  page,
}) => {
  await page.addInitScript(fakeWorker, GENERATED);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#generator');
  await page.locator('.cookieDecline').click();

  const sets = page.locator('.generatedSets');
  expect((await box(page.locator('.startButton'))).y).toBeLessThan((await box(sets)).y);
  expect((await box(page.locator('.drawsChoice'))).y).toBeLessThan((await box(sets)).y);
  await page.locator('.startButton').click();
  // Podsumowanie wyniku zostaje w panelu, pod przyciskiem i nad zestawami.
  const summary = await box(page.locator('.generatorResult'));
  expect(summary.y).toBeGreaterThan((await box(page.locator('.startButton'))).y);
  expect(summary.y).toBeLessThan((await box(sets)).y);

  await modeButton(page, 'Symulator').click();
  expect((await box(page.locator('.numbersList[data-pool="0"]'))).y).toBeLessThan(
    (await box(page.locator('.selectedItemsBlock'))).y
  );

  // Od 900 px panel zostaje po prawej, także w generatorze.
  await page.setViewportSize({ width: 1280, height: 800 });
  await modeButton(page, 'Generator').click();
  expect((await box(page.locator('.selectedItemsBlock'))).x).toBeGreaterThan((await box(sets)).x);
});

test('w trakcie generowania trybu, gry i liczby losowań nie da się zmienić, a „Przerwij” oddaje stronę', async ({
  page,
}) => {
  await page.addInitScript(endlessWorker);
  await page.goto('/');
  await page.locator('.cookieDecline').click();
  await modeButton(page, 'Generator').click();
  await drawsButton(page, '50\u00a0mln').click();
  await page.locator('.startButton').click();
  await expect(page.locator('.progressLabel')).toHaveText('Generowanie w toku');
  await expect(page.locator('.progressCount')).toHaveText('1 z 50\u00a0mln losowań · 0,3 s');
  await expect(modeButton(page, 'Symulator')).toBeDisabled();
  await expect(gameButton(page, 'Eurojackpot')).toBeDisabled();
  await expect(drawsButton(page, '10\u00a0mln')).toBeDisabled();

  await page.goBack();
  await expect(page).toHaveURL(/#generator$/);
  await expect(modeButton(page, 'Generator')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.simulationProgress')).toBeVisible();

  await page.locator('.abortButton').click();
  await expect(page.locator('.simulationAborted')).toHaveText(
    'Generowanie przerwane po ponad 1\u00a0000\u00a0000 losowaniach (0,3 s).'
  );
  expect(await page.evaluate(() => window.workerTerminated)).toBe(true);
  await expect(page.locator('.generatorResult')).toBeHidden();
  await expect(page.locator('.generatedSets .slot')).toHaveCount(6 * 6);
  await expect(page.locator('.startButton')).toBeFocused();
  await expect(modeButton(page, 'Symulator')).toBeEnabled();
});

test('worker, który odmawia (brak pamięci na liczniki), kończy generowanie komunikatem, zamiast kręcić spinnerem bez końca', async ({
  page,
}) => {
  await page.addInitScript(refusingWorker);
  await page.goto('/#generator-eurojackpot');
  await page.locator('.cookieDecline').click();
  await page.locator('.startButton').click();

  await expect(page.locator('.simulationAborted')).toHaveText(/^Generowanie nie powiodło się/);
  await expect(page.locator('.simulationProgress')).toBeHidden();
  await expect(page.locator('.startButton')).toBeEnabled();
  await expect(page.locator('.startButton')).toBeFocused();
});

test('bez zgody baner wraca po 5. generowaniu, a zgoda wtedy zapisuje to generowanie na liście generatora', async ({
  page,
}) => {
  await page.addInitScript(fakeWorker, GENERATED);
  await page.goto('/#generator');
  await page.locator('.cookieDecline').click();

  for (let run = 1; run <= 4; run++) {
    await page.locator('.startButton').click();
    await expect(page.locator('.setHits').first()).toHaveText(`${8 + run} razy`);
    await expect(page.locator('.cookieBanner'), `baner po ${run}. generowaniu`).toBeHidden();
  }
  await page.locator('.startButton').click();
  await expect(page.locator('.cookieBanner')).toBeVisible();

  await page.locator('.cookieAccept').click();
  expect(JSON.parse(await stored(page, GENERATED_KEY)).map((entry) => entry.sets[0].hits)).toEqual([13]);
  expect(await stored(page, HISTORY_KEY)).toBeNull();
  await expect(page.locator('.historyCount')).toHaveText('1');
});
