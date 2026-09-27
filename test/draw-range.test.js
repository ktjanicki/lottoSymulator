// Zakres losowania 1–49 w symulatorze. Liczba z Math.random() liczona jest
// ręcznie, więc pomyłka o jeden w mnożniku po cichu wycina skrajną liczbę:
// kupon z nią nigdy nie wygra, a symulacja kręci się bez końca.
// Math.random jest podstawiony sekwencją; po jej wyczerpaniu test przerywa
// symulację wyjątkiem, zamiast zawiesić się w pętli.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { simulation } = require('../simulation.js');

// Wartość Math.random(), która przy poprawnym wzorze daje liczbę n (1–49);
// dla n = 49 to górny kraniec przedziału [0, 1).
const randomFor = (n) => (n === 49 ? 1 - Number.EPSILON : (n - 1) / 49 + 1e-9);

const withRandom = (numbers, fn) => {
  const values = numbers.map(randomFor);
  const original = Math.random;
  Math.random = () => {
    if (!values.length) throw new Error('Sekwencja wyczerpana — skrajna liczba nie wypadła, symulacja nie kończy się wygraną.');
    return values.shift();
  };
  try {
    return fn();
  } finally {
    Math.random = original;
  }
};

test('symulator losuje 49 — inaczej kupon z 49 nigdy nie wygrywa', () => {
  const result = withRandom([49, 1, 2, 3, 4, 5], () => simulation(['1', '2', '3', '4', '5', '49']));
  assert.equal(result.drawsNumber, 1, 'Kupon 1–5 + 49 ma wygrać w pierwszym losowaniu.');
});
