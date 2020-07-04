const simulation = (ticketNumbers) => {
  const numbersDraw = () => {
    const result = new Set();

    while (result.size < 6) {
      result.add(parseInt(Math.random() * (50 - 1) + 1));
    }

    return result;
  };

  const drawResultCompare = (object) => {
    let matchNumbersQuantity = 0;

    ticketNumbers.forEach((number) => {
      if (object.has(parseInt(number))) {
        matchNumbersQuantity++;
      }
    });

    return matchNumbersQuantity;
  };

  const startSimulation = () => {
    const getStartTime = new Date().getTime();
    const counters = {
      win: false,
      threeNumbers: 0,
      fourNumbers: 0,
      fiveNumbers: 0,
      drawCounter: 0,
    };

    const drawSimulation = () => {
      const result = drawResultCompare(numbersDraw());
      counters.drawCounter++;

      switch (result) {
        case 6:
          counters.win = true;
          break;
        case 5:
          counters.fiveNumbers++;
          break;
        case 4:
          counters.fourNumbers++;
          break;
        case 3:
          counters.threeNumbers++;
          break;
      }
    };

    do {
      drawSimulation();
    } while (!counters.win);

    const getEndTime = new Date().getTime();

    return {
      ticketNumbers: ticketNumbers.sort((a, b) => a - b).join(', '),
      drawsNumber: counters.drawCounter,
      threes: counters.threeNumbers,
      fours: counters.fourNumbers,
      fives: counters.fiveNumbers,
      time: ((getEndTime - getStartTime) / 1000).toFixed(1),
    };
  };

  return startSimulation();
};

onmessage = ({ data }) => {
  const result = simulation(data);
  postMessage(result);
};
