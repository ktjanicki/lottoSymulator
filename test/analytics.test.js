// Google Analytics po zgodzie (analytics.js). Awarie, przed którymi chroni:
// - kolejka poleceń jako tablice zamiast obiektów `arguments` — gtag.js je
//   pomija i GA niczego nie wysyła, choć skrypt się wczytuje;
// - drugi skrypt i drugi `config` przy kolejnej zgodzie (np. z innej karty) —
//   ta sama wizyta liczona dwa razy.
// Czy strona woła moduł tylko za zgodą i czy CSP wpuszcza skrypt, sprawdza
// e2e/page.spec.mjs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GA_MEASUREMENT_ID, GTAG_URL, startAnalytics } = require('../analytics.js');

// Minimalne okno: document.createElement i <head>, do którego trafiają skrypty.
const fakeWindow = () => {
  const head = [];
  return {
    head,
    document: { createElement: (tag) => ({ tag }), head: { append: (element) => head.push(element) } },
  };
};

const isArguments = (value) => Object.prototype.toString.call(value) === '[object Arguments]';

test('start dokłada asynchroniczny gtag.js z identyfikatorem i kolejkę js + config jako obiekty arguments', () => {
  const win = fakeWindow();
  startAnalytics(win);

  assert.deepEqual(win.head, [{ tag: 'script', async: true, src: GTAG_URL }]);
  assert.match(GTAG_URL, new RegExp(`[?&]id=${GA_MEASUREMENT_ID}$`));
  assert.equal(win.dataLayer.length, 2);
  assert.ok(win.dataLayer.every(isArguments), 'Polecenia w dataLayer muszą być obiektami arguments, nie tablicami.');
  assert.equal(win.dataLayer[0][0], 'js');
  assert.ok(win.dataLayer[0][1] instanceof Date);
  assert.deepEqual([...win.dataLayer[1]], ['config', GA_MEASUREMENT_ID]);
});

test('kolejna zgoda w tej samej wizycie nie dokłada drugiego skryptu ani drugiego config', () => {
  const win = fakeWindow();
  startAnalytics(win);
  startAnalytics(win);
  assert.equal(win.head.length, 1);
  assert.equal(win.dataLayer.length, 2);
});
