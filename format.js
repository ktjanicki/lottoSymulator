// Grupuje cyfry po trzy twardą spacją (U+00A0): 1819580 → „1 819 580”.
// Zwykła spacja pozwala przeglądarce złamać liczbę w środku wiersza —
// „po ponad 3 000 / 000 losowaniach” czyta się jak dwie liczby.
export const formatNumber = (number) => {
  const reverseNumber = number.toString().split('').reverse();
  const result = [];
  let count = 1;

  reverseNumber.forEach((item, index) => {
    result.push(item);
    if (count === 3 && index !== reverseNumber.length - 1) result.push('\u00a0');
    count === 3 ? (count = 1) : count++;
  });

  return result.reverse().join('');
};

// Sekundy z jedną cyfrą po przecinku: 2345 ms → „2,3”. Przecinek wstawiamy
// sami — toLocaleString zależy od języka przeglądarki i pokazałby „2.3”
// odwiedzającemu z angielskim interfejsem.
export const formatSeconds = (milliseconds) => (milliseconds / 1000).toFixed(1).replace('.', ',');

const pad = (number) => String(number).padStart(2, '0');

// „05.09.2026, 07:03” w strefie czasowej odwiedzającego. Składane ręcznie
// z tego samego powodu co przecinek wyżej: toLocaleString zmienia kolejność
// i separatory z językiem przeglądarki.
export const formatDateTime = (date) =>
  `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;

// Rzeczownik po liczbie: 1 losowanie, 2–4 losowania (bez 12–14), reszta
// losowań — także 22, 104 i 1 000 000 według ostatnich cyfr.
export const drawsNoun = (count) => {
  const lastTwo = count % 100;
  const last = count % 10;
  if (count === 1) return 'losowanie';
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return 'losowania';
  return 'losowań';
};
