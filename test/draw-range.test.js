// Zachowanie symulatorów: zakres losowania 1–49 w obu, flaga „full” w konsoli.
// Oba symulatory liczą liczbę z Math.random() ręcznie, więc pomyłka o jeden
// w mnożniku po cichu wycina skrajną liczbę:
// kupon z nią nigdy nie wygra, a symulacja kręci się bez końca.
// Math.random jest podstawiony sekwencją; po jej wyczerpaniu test przerywa
// symulację wyjątkiem, zamiast zawiesić się w pętli.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// Wartość Math.random(), która przy poprawnym wzorze daje liczbę n (1–49);
// dla n = 49 to górny kraniec przedziału [0, 1).
const randomFor = (n) => (n === 49 ? 1 - Number.EPSILON : (n - 1) / 49 + 1e-9);

const fakeMath = (numbers) => {
  const values = numbers.map(randomFor);
  const math = Object.create(Math);
  math.random = () => {
    if (!values.length) throw new Error('Sekwencja wyczerpana — skrajna liczba nie wypadła, symulacja nie kończy się wygraną.');
    return values.shift();
  };
  return math;
};

const DRAW_WITH_EDGES = [49, 1, 2, 3, 4, 5];

// Uruchamia symulator konsolowy tak jak `node lottoSymulatorConsole.js <args>`;
// kupon w pliku to 12, 33, 17, 41, 27, 6, więc drugie losowanie wygrywa.
const runConsole = (args) => {
  const lines = [];
  const context = {
    Math: fakeMath([...DRAW_WITH_EDGES, 12, 33, 17, 41, 27, 6]),
    console: { log: (line) => lines.push(line) },
    process: { argv: ['node', 'lottoSymulatorConsole.js', ...args] },
    Date,
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'lottoSymulatorConsole.js'), 'utf8'), context);
  return lines;
};

// Linia pełnego logowania: „<nr losowania> - <trójki>, <czwórki>, <piątki>, <wygrana> - <liczby>”.
const DRAW_LOG = /^\d[\d ]* - \d+, \d+, \d+, (true|false) - /;

test('konsola z flagą „full” wypisuje każde losowanie — inaczej opis w nagłówku pliku kłamie', () => {
  const draws = runConsole(['full']).filter((line) => DRAW_LOG.test(line));
  assert.equal(draws.length, 2, `Oczekiwano dwóch linii losowań, są:\n${draws.join('\n')}`);
});

test('konsola bez flagi wypisuje tylko podsumowanie — inaczej miliony linii zalewają terminal', () => {
  const lines = runConsole([]);
  assert.deepEqual(lines.filter((line) => DRAW_LOG.test(line)), []);
  assert.ok(lines.some((line) => line.includes('Trafiłeś szóstkę w 2 losowaniu')), `Brak podsumowania:\n${lines.join('\n')}`);
});

test('konsola losuje 49 — inaczej kupon z 49 nigdy nie wygrywa', () => {
  const lines = runConsole(['full']);
  assert.ok(
    lines.some((line) => line.endsWith('- 49, 1, 2, 3, 4, 5')),
    `Pierwsze losowanie miało dać 49, 1, 2, 3, 4, 5; konsola wypisała:\n${lines.join('\n')}`
  );
});

test('worker przeglądarki losuje 49 — inaczej kupon z 49 nigdy nie wygrywa', () => {
  let result;
  const context = { Math: fakeMath(DRAW_WITH_EDGES), Date, postMessage: (data) => (result = data) };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'simulationWorker.js'), 'utf8'), context);
  context.onmessage({ data: ['1', '2', '3', '4', '5', '49'] });
  assert.equal(result.drawsNumber, 1, 'Kupon 1–5 + 49 ma wygrać w pierwszym losowaniu.');
});
