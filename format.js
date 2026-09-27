// Grupuje cyfry po trzy spacją: 1819580 → „1 819 580”.
export const formatNumber = (number) => {
  const reverseNumber = number.toString().split('').reverse();
  const result = [];
  let count = 1;

  reverseNumber.forEach((item, index) => {
    result.push(item);
    if (count === 3 && index !== reverseNumber.length - 1) result.push(' ');
    count === 3 ? (count = 1) : count++;
  });

  return result.reverse().join('');
};

// Sekundy z jedną cyfrą po przecinku: 2345 ms → „2,3”. Przecinek wstawiamy
// sami — toLocaleString zależy od języka przeglądarki i pokazałby „2.3”
// odwiedzającemu z angielskim interfejsem.
export const formatSeconds = (milliseconds) => (milliseconds / 1000).toFixed(1).replace('.', ',');
