//
// "LOTTO" random game program dedicated to run at the terminal.
//
// run with the command:
// $ node lottoSymulatorConsole.js
// or
// $ node lottoSymulatorConsole.js full (to run the program with results logging)
//

const ticketNumbers = [12, 33, 17, 41, 27, 6];
let showDrawResult;

const numbersDraw = () => {
  const result = new Set();

  while (result.size < 6) {
    result.add(parseInt(Math.random() * (49 - 1) + 1));
  }

  showDrawResult = [...result].join(', ');
  return result;
};

const showFormatedNumber = (number) => {
  const numberArray = number.split('').reverse();
  const result = [];
  let count = 1;

  numberArray.forEach((item, index) => {
    result.push(item);
    if (count === 3 && index !== numberArray.length - 1) result.push(' ');
    count === 3 ? (count = 1) : count++;
  });

  return result.reverse().join('');
};

const drawResultCompare = (object) => {
  let matchNumbersQuantity = 0;

  ticketNumbers.forEach((number) => {
    if (object.has(number)) {
      matchNumbersQuantity++;
    }
  });

  return matchNumbersQuantity;
};

const startSimulation = () => {
  let threeNumbers = 0;
  let fourNumbers = 0;
  let fiveNumbers = 0;
  let win = false;
  let drawCounter = 0;
  const getStartTime = new Date().getTime();

  console.log(`symulacja w toku...
    `);

  const drawSimulation = () => {
    const result = drawResultCompare(numbersDraw());
    drawCounter++;

    switch (result) {
      case 6:
        win = true;
        break;
      case 5:
        fiveNumbers++;
        break;
      case 4:
        fourNumbers++;
        break;
      case 3:
        threeNumbers++;
        break;
    }

    if (process.argv[2] === '-dev') {
      console.log(
        `${showFormatedNumber(
          drawCounter.toString()
        )} - ${threeNumbers}, ${fourNumbers}, ${fiveNumbers}, ${win} - ${showDrawResult}`
      );
    }
  };

  do {
    drawSimulation();
    if (win) {
      const getEndTime = new Date().getTime();
      console.log(`---------------------------------------------
               BRAWO WYRAŁEŚ!

          Trafiłeś szóstkę w ${showFormatedNumber(drawCounter.toString())} losowaniu.
          W międzyczasie trafiłeś:

          ${showFormatedNumber(threeNumbers.toString())} trójek,
          ${showFormatedNumber(fourNumbers.toString())} czwórek,
          ${showFormatedNumber(fiveNumbers.toString())} piątek
          
          Czas symulacji: ${((getEndTime - getStartTime) / 1000).toFixed(1)} sekundy
          `);
    }
  } while (!win);

  //   console.log(`${parseInt((getEndTime - getStartTime) / 1000)} sekund`);
};

startSimulation();
