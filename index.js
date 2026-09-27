import { formatNumber, formatSeconds } from './format.js';
import { MAX_NUMBER, TICKET_SIZE } from './simulation.js';

const numbersList = document.querySelector('.numbersList');
const selectedItems = document.querySelector('.selectedItems');
const selectedItemsBlock = document.querySelector('.selectedItemsBlock');
const startButton = document.querySelector('.startButton');
const resultSection = document.querySelector('.result');
const resultCounterTotal = document.querySelector('.resultCounterTotal');
const resultThrees = document.querySelector('.resultThrees');
const resultFours = document.querySelector('.resultFours');
const resultFives = document.querySelector('.resultFives');
const resultSimulationTime = document.querySelector('.resultSimulationTime');
const resultTicketNumbers = document.querySelector('.resultTicketNumbers');
const simulationProgressElement = document.querySelector('.simulationProgress');
const simulationProgressMessage = document.querySelector('.simulationProgressMessage');
const winResultElement = document.querySelector('.winResult');
const progressCount = document.querySelector('.progressCount');
const abortButton = document.querySelector('.abortButton');
const abortedElement = document.querySelector('.simulationAborted');
const ticketNumbers = [];
let simulationRunning = false;
let simulationWorker = null;
let lastProgress = null;

// Numer z pliku VERSION — jedynego źródła numeru wydania. Strona ma działać
// i po buildzie (produkcja; Parcel kopiuje VERSION do dist/), i podana wprost
// bez buildu — ścieżka względna działa w obu trybach. Import rozwiązywany
// przez bundler, np. `fs`, bez buildu unieważnia w przeglądarce cały moduł:
// tak padła produkcja w 1.1.0, gdy jeszcze podawała surowe pliki.
fetch(new URL('VERSION', import.meta.url))
  .then((response) => (response.ok ? response.text() : ''))
  .then((version) => (document.querySelector('.appVersion').textContent = version.trim()));

// Liczby to przyciski (<button>), a nie <div>: dają się wybrać klawiaturą
// i czytnik ekranu ogłasza je razem ze stanem aria-pressed.
const createBall = (number, label) => {
  const ball = document.createElement('button');
  ball.type = 'button';
  ball.className = 'ball';
  ball.dataset.number = number;
  ball.textContent = number;
  if (label) ball.setAttribute('aria-label', label);
  return ball;
};

for (let number = 1; number <= MAX_NUMBER; number++) numbersList.append(createBall(number));

// Jedyne miejsce, które ustawia wygląd i dostępność kontrolek na podstawie
// kuponu i trwającej symulacji. Przełączanie klas w kilku procedurach naraz
// rozjeżdżało się przy kolejności kliknięć, której nikt nie przewidział.
const render = () => {
  const full = ticketNumbers.length === TICKET_SIZE;
  for (const ball of numbersList.children) {
    const selected = ticketNumbers.includes(ball.dataset.number);
    ball.setAttribute('aria-pressed', String(selected));
    ball.disabled = simulationRunning || (full && !selected);
  }
  selectedItems.replaceChildren(
    ...ticketNumbers.map((number) => {
      const ball = createBall(number, `Usuń liczbę ${number}`);
      ball.disabled = simulationRunning;
      return ball;
    })
  );
  selectedItemsBlock.classList.toggle('inactive', ticketNumbers.length === 0);
  startButton.classList.toggle('inactive', !full || simulationRunning);
  simulationProgressElement.classList.toggle('inactive', !simulationRunning);
  simulationProgressMessage.classList.toggle('inactive', !simulationRunning);
};

// Kliknięcie wybranej liczby zdejmuje ją z kuponu; siódma nie wchodzi.
const toggleNumber = (number) => {
  const index = ticketNumbers.indexOf(number);
  if (index >= 0) ticketNumbers.splice(index, 1);
  else if (ticketNumbers.length < TICKET_SIZE) ticketNumbers.push(number);
  render();
};

numbersList.addEventListener('click', ({ target }) => {
  const ball = target.closest('.ball');
  if (ball) toggleNumber(ball.dataset.number);
});

selectedItems.addEventListener('click', ({ target }) => {
  const ball = target.closest('.ball');
  if (!ball) return;
  toggleNumber(ball.dataset.number);
  // Usunięty przycisk znika z DOM; bez tego fokus klawiatury spada na <body>.
  numbersList.querySelector(`[data-number="${ball.dataset.number}"]`).focus();
});

startButton.addEventListener('click', () => {
  // Parcel 2 dołącza plik workera do paczki tylko z postaci new URL(…, import.meta.url);
  // sam napis ('simulationWorker.js') przerywa `npm run build` błędem. Worker jest
  // modułem (importuje simulation.js); bez `type: 'module'` przeglądarka odrzuci import.
  simulationWorker = new Worker(new URL('simulationWorker.js', import.meta.url), { type: 'module' });

  simulationWorker.addEventListener('message', ({ data }) => {
    if (data.type === 'progress') {
      lastProgress = data;
      // Postęp przychodzi co milion losowań, więc liczba kończy się na „000”
      // i zawsze pasuje do niej forma „losowań”.
      progressCount.textContent = `${formatNumber(data.drawsNumber)} losowań · ${formatSeconds(data.durationMs)} s`;
      return;
    }
    resultTicketNumbers.textContent = data.ticketNumbers;
    resultCounterTotal.textContent = formatNumber(data.drawsNumber);
    resultThrees.textContent = formatNumber(data.threes);
    resultFours.textContent = formatNumber(data.fours);
    resultFives.textContent = formatNumber(data.fives);
    resultSimulationTime.textContent = formatSeconds(data.durationMs);
    simulationWorker.terminate();
    simulationWorker = null;

    simulationRunning = false;
    winResultElement.classList.remove('inactive');
    render();
  });

  simulationRunning = true;
  lastProgress = null;
  progressCount.textContent = '';
  resultSection.classList.add('started');
  winResultElement.classList.add('inactive');
  abortedElement.classList.add('inactive');
  render();
  simulationWorker.postMessage([...ticketNumbers]);
});

// Pętla workera jest synchroniczna — nie odbierze wiadomości „stop”, więc
// przerwanie to zabicie wątku. Liczba losowań pochodzi z ostatniego postępu,
// stąd „ponad”: worker zdążył wylosować więcej, zanim zginął.
abortButton.addEventListener('click', () => {
  simulationWorker.terminate();
  simulationWorker = null;
  simulationRunning = false;
  abortedElement.textContent = lastProgress
    ? `Symulacja przerwana po ponad ${formatNumber(lastProgress.drawsNumber)} losowaniach (${formatSeconds(lastProgress.durationMs)} s).`
    : 'Symulacja przerwana.';
  abortedElement.classList.remove('inactive');
  render();
  // Przycisk „Przerwij” znika; bez tego fokus klawiatury spada na <body>.
  startButton.focus();
});

render();
