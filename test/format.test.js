// Formatowanie liczb w podsumowaniu (format.js). Awarie: spacja w złym miejscu
// albo na początku liczby („ 819 580”); kropka dziesiętna zamiast przecinka;
// data bez zer wiodących albo z miesiącem liczonym od zera; „22 losowań”.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatNumber, formatSeconds, formatDateTime, drawsNoun } = require('../format.js');

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

// Data budowana z części lokalnych: wynik nie zależy od strefy czasowej
// maszyny, na której idzie test.
test('data historii z zerami wiodącymi i miesiącem liczonym od jedynki', () => {
  assert.equal(formatDateTime(new Date(2026, 8, 5, 7, 3)), '05.09.2026, 07:03');
  assert.equal(formatDateTime(new Date(2026, 11, 31, 23, 59)), '31.12.2026, 23:59');
  assert.equal(formatDateTime(new Date(2027, 0, 1, 0, 0)), '01.01.2027, 00:00');
});

test('odmiana „losowanie” po liczbie, także dla nastek i dużych liczb', () => {
  const cases = [
    [1, 'losowanie'],
    [2, 'losowania'],
    [4, 'losowania'],
    [5, 'losowań'],
    [11, 'losowań'],
    [12, 'losowań'],
    [14, 'losowań'],
    [21, 'losowań'],
    [22, 'losowania'],
    [104, 'losowania'],
    [112, 'losowań'],
    [1000000, 'losowań'],
    [18452313, 'losowań'],
    [18452322, 'losowania'],
  ];
  for (const [count, expected] of cases) assert.equal(drawsNoun(count), expected, `${count}`);
});
