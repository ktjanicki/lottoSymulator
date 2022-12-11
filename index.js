const numbersList = document.querySelector('.numbersList');
const itemList = document.querySelector('.itemsList');
const selectedItems = document.querySelector('.selectedItems');
const selectedItemsBlock = document.querySelector('.selectedItemsBlock');
const button = document.querySelector('button');
const resultCounterTotal = document.querySelector('.resultCounterTotal');
const resultThrees = document.querySelector('.resultThrees');
const resultFours = document.querySelector('.resultFours');
const resultFives = document.querySelector('.resultFives');
const resultSimulationTime = document.querySelector('.resultSimulationTime');
const resultTicketNumbers = document.querySelector('.resultTicketNumbers');
const simulationProgressElement = document.querySelector('.simulationProgress');
const simulationProgressMessage = document.querySelector('.simulationProgressMessage');
const operationsCounter = document.querySelector('.operationsCount');
const winResultElement = document.querySelector('.winResult');
const ticketNumbers = [];

const showFormatedNumber = (number) => {
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

// Function for start simulation button toggle, use 'message' argument only for simulation progress div enable.
const buttonDisabled = (value, message) => {
  if (value) {
    button.classList.add('inactive');
    if (message) {
      simulationProgressElement.classList.remove('inactive');
      simulationProgressElement.innerText = message;
    }
  } else {
    button.classList.remove('inactive');
    if (!message) simulationProgressElement.classList.add('inactive');
  }
};

const numbersListDisable = (value) => {
  return value ? itemList.classList.add('itemsListDisabled') : itemList.classList.remove('itemsListDisabled');
};

const winResultShow = (showResult, simulation) => {
  showResult ? winResultElement.classList.remove('inactive') : winResultElement.classList.add('inactive');
  simulation ? simulationProgressMessage.classList.remove('inactive') : simulationProgressMessage.classList.add('inactive');
};

// Select items handler
const selectItemHandler = ({ target }) => {
  if (
    !itemList.classList.contains('itemsListDisabled') &&
    !target.classList.contains('inactiveNumber') &&
    target.classList.contains('numberItem')
  ) {
    const item = document.createElement('div');
    item.className = `selectedItem`;
    item.textContent = target.textContent;
    target.classList.add('inactiveNumber');
    selectedItemsBlock.classList.remove('inactive');
    selectedItems.appendChild(item);
    ticketNumbers.push(item.textContent);

    if (ticketNumbers.length === 6) {
      numbersListDisable(true);
      buttonDisabled(false);
    }
  }
};

// Removing selected items handler
const removeItemHandler = ({ target }) => {
  if (target.classList.contains('selectedItem') && simulationProgressElement.classList.contains('inactive')) {
    document.querySelector(`.item${target.textContent}`).classList.remove('inactiveNumber');
    selectedItems.removeChild(target);
    ticketNumbers.splice(ticketNumbers.indexOf(target.textContent), 1);

    if (ticketNumbers.length !== 6) {
      numbersListDisable(false);
      buttonDisabled(true);
    }
  }

  if (document.querySelectorAll('.selectedItem').length === 0) {
    selectedItemsBlock.classList.add('inactive');
  }
};

// Start simulation button handler
const simulationButtonHandler = () => {
  document.querySelector('.result').style.minHeight = '229px';
  const simulationWorker = new Worker('simulationWorker.js');

  simulationWorker.addEventListener('message', ({ data }) => {
    resultTicketNumbers.textContent = data.ticketNumbers;
    resultCounterTotal.textContent = showFormatedNumber(data.drawsNumber);
    resultThrees.textContent = showFormatedNumber(data.threes);
    resultFours.textContent = showFormatedNumber(data.fours);
    resultFives.textContent = showFormatedNumber(data.fives);
    resultSimulationTime.textContent = data.time;
    operationsCounter.textContent = showFormatedNumber(data.operations);
    simulationWorker.terminate();

    buttonDisabled(false);
    winResultShow(true);
  });

  buttonDisabled(true, 'symulacja w toku ...');
  winResultShow(false, true);
  simulationWorker.postMessage(ticketNumbers);
};

numbersList.addEventListener('click', selectItemHandler);
selectedItems.addEventListener('click', removeItemHandler);
button.addEventListener('click', simulationButtonHandler);
