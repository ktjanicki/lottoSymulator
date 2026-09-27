// Formatowanie liczb w podsumowaniu (format.js). Awarie: spacja w złym miejscu
// albo na początku liczby („ 819 580”); kropka dziesiętna zamiast przecinka.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatNumber, formatSeconds } = require('../format.js');

test('liczby grupowane po trzy cyfry od prawej, bez spacji na brzegach', () => {
  const cases = [
    [0, '0'],
    [7, '7'],
    [999, '999'],
    [1000, '1 000'],
    [819580, '819 580'],
    [1819580, '1 819 580'],
    [123456789, '123 456 789'],
  ];
  for (const [input, expected] of cases) assert.equal(formatNumber(input), expected);
});

test('czas w sekundach z przecinkiem dziesiętnym, niezależnie od języka przeglądarki', () => {
  const cases = [
    [0, '0,0'],
    [49, '0,0'],
    [50, '0,1'],
    [2345, '2,3'],
    [61000, '61,0'],
  ];
  for (const [input, expected] of cases) assert.equal(formatSeconds(input), expected);
});
