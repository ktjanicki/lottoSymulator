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
