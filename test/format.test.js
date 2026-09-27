// Grupowanie cyfr w podsumowaniu (format.js). Awaria: spacja w złym miejscu
// albo na początku liczby, np. „ 819 580” przy liczbach podzielnych po trzy cyfry.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatNumber } = require('../format.js');

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
