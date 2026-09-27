// Zakres losowania 1–49 w symulatorze. Liczba z Math.random() liczona jest
// ręcznie, więc pomyłka o jeden w mnożniku po cichu wycina skrajną liczbę:
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

test('worker przeglądarki losuje 49 — inaczej kupon z 49 nigdy nie wygrywa', () => {
  let result;
  const context = { Math: fakeMath(DRAW_WITH_EDGES), Date, postMessage: (data) => (result = data) };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'simulationWorker.js'), 'utf8'), context);
  context.onmessage({ data: ['1', '2', '3', '4', '5', '49'] });
  assert.equal(result.drawsNumber, 1, 'Kupon 1–5 + 49 ma wygrać w pierwszym losowaniu.');
});
