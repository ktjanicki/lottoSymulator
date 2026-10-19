// Google Analytics w trybie zgody (analytics.js). Awarie, przed którymi chroni:
// - kolejka poleceń jako tablice zamiast obiektów `arguments` — gtag.js je
//   pomija i GA niczego nie wysyła, choć skrypt się wczytuje;
// - `config` przed odmową domyślną — pierwszy pomiar ustawia ciasteczka
//   _ga bez zgody;
// - zapisana zgoda, która nie włącza ciasteczek, albo zgoda reklamowa
//   włączona razem ze statystykami;
// - brak tagu w HTML-u wywracający index.js, a z nim symulację.
// Czy strona woła moduł przy wejściu i po zgodzie, i czy CSP wpuszcza skrypt,
// sprawdza e2e/page.spec.mjs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GTAG_SCRIPT, grantAnalytics, startAnalytics } = require('../analytics.js');

const SRC = 'https://www.googletagmanager.com/gtag/js?id=G-TEST123';

// Minimalne okno: tylko querySelector, który znajduje (albo nie) tag gtag.js.
const fakeWindow = (src = SRC) => ({
  document: { querySelector: (selector) => (selector === GTAG_SCRIPT && src ? { src } : null) },
});

const isArguments = (value) => Object.prototype.toString.call(value) === '[object Arguments]';
const commands = (win) => win.dataLayer.map((command) => [...command]);

test('bez zgody: odmowa domyślna przed config, identyfikator z adresu tagu, polecenia jako arguments', () => {
  const win = fakeWindow();
  startAnalytics(win, false);

  assert.ok(win.dataLayer.every(isArguments), 'Polecenia w dataLayer muszą być obiektami arguments, nie tablicami.');
  const [consent, js, config] = commands(win);
  assert.deepEqual(consent, [
    'consent',
    'default',
    { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' },
  ]);
  assert.equal(js[0], 'js');
  assert.ok(js[1] instanceof Date);
  assert.deepEqual(config, ['config', 'G-TEST123']);
  assert.equal(win.dataLayer.length, 3);
});

test('zapisana zgoda włącza ciasteczka statystyk już w domyślnej, reklamowe zostają odrzucone', () => {
  const win = fakeWindow();
  startAnalytics(win, true);
  assert.deepEqual(commands(win)[0][2], {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'granted',
  });
});

test('zgoda w trakcie wizyty dopisuje aktualizację tylko dla statystyk', () => {
  const win = fakeWindow();
  startAnalytics(win, false);
  grantAnalytics(win);
  assert.deepEqual(commands(win).at(-1), ['consent', 'update', { analytics_storage: 'granted' }]);
});

test('bez tagu w HTML-u analityka się nie uruchamia, a wywołania nie rzucają', () => {
  const win = fakeWindow(null);
  startAnalytics(win, true);
  grantAnalytics(win);
  assert.equal(win.dataLayer, undefined);
});
