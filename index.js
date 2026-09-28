import { drawsNoun, formatDateTime, formatNumber, formatSeconds } from './format.js';
import { HISTORY_PAGE, giveConsent, hasConsent, readHistory, recordWin } from './history.js';
import { MAX_NUMBER, TICKET_SIZE } from './simulation.js';

const numbersList = document.querySelector('.numbersList');
const selectedItems = document.querySelector('.selectedItems');
const selectedCount = document.querySelector('.selectedCount');
const startButton = document.querySelector('.startButton');
const startHint = document.querySelector('.startHint');
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
const historySection = document.querySelector('.history');
const historyToggle = document.querySelector('.historyToggle');
const historyLabel = document.querySelector('.historyLabel');
const historyCount = document.querySelector('.historyCount');
const historyBody = document.querySelector('.historyBody');
const historyList = document.querySelector('.historyList');
const historyMore = document.querySelector('.historyMore');
const cookieBanner = document.querySelector('.cookieBanner');
const cookieAccept = document.querySelector('.cookieAccept');
const ticketNumbers = [];
let simulationRunning = false;
let simulationWorker = null;
let lastProgress = null;
let history = [];
let historyShown = HISTORY_PAGE;

// Numer z pliku VERSION — jedynego źródła numeru wydania. Strona ma działać
// i po buildzie (produkcja; Parcel kopiuje VERSION do dist/), i podana wprost
// bez buildu — ścieżka względna działa w obu trybach. Import rozwiązywany
// przez bundler, np. `fs`, bez buildu unieważnia w przeglądarce cały moduł:
// tak padła produkcja w 1.1.0, gdy jeszcze podawała surowe pliki.
fetch(new URL('VERSION', import.meta.url))
  .then((response) => (response.ok ? response.text() : ''))
  .then((version) => (document.querySelector('.appVersion').textContent = version.trim()));

// Bieżący rok z zegara odwiedzającego; w HTML stoi rok wydania na wypadek
// strony bez skryptów. Wpisany na sztywno zestarzałby się z Sylwestrem.
document.querySelector('.copyrightYear').textContent = new Date().getFullYear();

// Sam dostęp do window.localStorage rzuca przy zablokowanych danych witryny;
// null dalej obsługuje history.js jak magazyn, który odmawia.
const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

// Baner to modalny <dialog>: reszta strony jest wyszarzona i nieaktywna
// (inert — klawiatura i czytnik ekranu też jej nie dosięgną), dopóki nie
// padnie „Akceptuję”. Zamknięty w HTML: odwiedzający po akceptacji nie widzi
// go nawet przez mgnienie, zanim skrypt sprawdzi zgodę.
let consentGiven = hasConsent(storage);
if (!consentGiven) cookieBanner.showModal();

// Esc zamyka modalny dialog; przeglądarka potrafi zignorować anulowanie
// zdarzenia `cancel` (np. przy drugim Esc), więc zamknięty bez zgody
// otwiera się od nowa.
cookieBanner.addEventListener('cancel', (event) => event.preventDefault());
cookieBanner.addEventListener('close', () => {
  if (!consentGiven) cookieBanner.showModal();
});

cookieAccept.addEventListener('click', () => {
  // Gdy magazyn odmówi, zgoda trwa do końca wizyty (baner znika), ale
  // historia i tak się nie zapisze, a baner wróci przy następnym wejściu.
  giveConsent(storage);
  consentGiven = true;
  cookieBanner.close();
  // Baner znika razem z fokusem; bez tego fokus klawiatury spada na <body>.
  numbersList.querySelector('.ball:not(:disabled)')?.focus({ preventScroll: true });
});

// Kule historii to <span>, nie przyciski: wyglądają jak na kuponie, ale nic
// się na nie nie klika.
const createHistoryItem = ({ numbers, drawsNumber, date }) => {
  const item = document.createElement('li');
  item.className = 'historyItem';
  const balls = document.createElement('div');
  balls.className = 'historyBalls';
  for (const number of numbers) {
    const ball = document.createElement('span');
    ball.className = 'ball';
    ball.textContent = number;
    balls.append(ball);
  }
  const time = document.createElement('time');
  time.className = 'historyDate';
  time.dateTime = new Date(date).toISOString();
  time.textContent = formatDateTime(new Date(date));
  const draws = document.createElement('p');
  draws.className = 'historyDraws';
  const count = document.createElement('strong');
  count.textContent = formatNumber(drawsNumber);
  draws.append(count, ` ${drawsNoun(drawsNumber)}`);
  item.append(balls, time, draws);
  return item;
};

// Wpisy wjeżdżają jeden po drugim: kolejny rusza co HISTORY_STAGGER_MS,
// każdy wjeżdża przez HISTORY_ENTER_MS (czas animacji ustawia stąd JS, CSS
// ma tylko jej przebieg). Porcja 15 wpisów trwa ~2 s; dłużej — „więcej”
// wygląda na zawieszone, krócej — wpisy zlewają się w jeden błysk.
const HISTORY_STAGGER_MS = 100;
const HISTORY_ENTER_MS = 550;
// Pierwszy nowy wpis staje tyle pikseli pod górną krawędzią okna.
const HISTORY_SCROLL_OFFSET_PX = 24;
// Przewijanie kończy się nieco przed ostatnim wpisem: przy równym czasie
// strona dojeżdżała, gdy wpisy już stały, i ruch wyglądał na spóźniony.
const HISTORY_SCROLL_PACE = 0.8;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Przewija stronę w tempie wjeżdżania wpisów tak, żeby pierwszy nowy stanął
// tuż pod górną krawędzią okna — tylko gdy nowe wpisy nie mieszczą się
// w oknie (inaczej widać je bez przewijania). Kółko, dotyk albo klawisz
// przerywają przewijanie: bez tego strona szarpałaby się z odwiedzającym.
const scrollToNewEntries = (first, last, count) => {
  // getBoundingClientRect liczy z przesunięciem z początku animacji (wpis
  // startuje niżej) — bez odjęcia go wpis staje o tyle za wysoko.
  const shift = new DOMMatrixReadOnly(getComputedStyle(first).transform).m42;
  const top = first.getBoundingClientRect().top - shift;
  if (last.getBoundingClientRect().bottom <= window.innerHeight) return;
  const start = window.scrollY;
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const target = Math.min(start + top - HISTORY_SCROLL_OFFSET_PX, maxScroll);
  if (target <= start) return;
  if (reducedMotion.matches) {
    window.scrollTo(0, target);
    return;
  }
  const duration = ((count - 1) * HISTORY_STAGGER_MS + HISTORY_ENTER_MS) * HISTORY_SCROLL_PACE;
  const began = performance.now();
  let cancelled = false;
  const cancel = () => (cancelled = true);
  const events = ['wheel', 'touchstart', 'keydown'];
  for (const type of events) window.addEventListener(type, cancel, { once: true, passive: true });
  const step = (now) => {
    const progress = Math.min((now - began) / duration, 1);
    // Łagodny start i koniec (ease-in-out), jak wjazd wpisów.
    const eased = progress < 0.5 ? 2 * progress ** 2 : 1 - (-2 * progress + 2) ** 2 / 2;
    if (!cancelled) window.scrollTo(0, start + (target - start) * eased);
    if (progress < 1 && !cancelled) requestAnimationFrame(step);
    else for (const type of events) window.removeEventListener(type, cancel);
  };
  requestAnimationFrame(step);
};

// Jedyne miejsce, które ustawia listę historii na podstawie `history`
// i liczby pokazanych wpisów (rośnie o HISTORY_PAGE po „więcej”).
// Wpisy o indeksach [animateFrom, animateTo) wjeżdżają po kolei — tylko
// nowo pokazane; reszta stoi, inaczej każde „więcej” migałoby całą listą.
const renderHistory = (animateFrom = 0, animateTo = 0) => {
  historySection.classList.toggle('inactive', history.length === 0);
  historyCount.textContent = history.length;
  historyList.replaceChildren(
    ...history.slice(0, historyShown).map((entry, index) => {
      const item = createHistoryItem(entry);
      if (index >= animateFrom && index < animateTo) {
        item.classList.add('entering');
        item.style.animationDelay = `${(index - animateFrom) * HISTORY_STAGGER_MS}ms`;
        item.style.animationDuration = `${HISTORY_ENTER_MS}ms`;
      }
      return item;
    })
  );
  historyMore.classList.toggle('inactive', historyShown >= history.length);
};

history = readHistory(storage);
renderHistory();

// Zwinięta przy każdym wejściu (tak stoi w HTML) — stanu nie zapamiętujemy.
historyToggle.addEventListener('click', () => {
  const expanded = historyToggle.getAttribute('aria-expanded') !== 'true';
  historyToggle.setAttribute('aria-expanded', String(expanded));
  historyLabel.textContent = expanded ? 'Ukryj historię' : 'Pokaż historię';
  if (expanded) renderHistory(0, historyShown);
  historyBody.classList.toggle('inactive', !expanded);
  // Po odsłonięciu — ukryta lista nie ma jeszcze położenia do przewinięcia.
  if (expanded) scrollToNewEntries(historyList.firstElementChild, historyList.lastElementChild, historyList.children.length);
});

historyMore.addEventListener('click', () => {
  const firstNew = historyShown;
  historyShown += HISTORY_PAGE;
  renderHistory(firstNew, historyShown);
  const firstItem = historyList.children[firstNew];
  scrollToNewEntries(firstItem, historyList.lastElementChild, historyList.children.length - firstNew);
  // Po ostatniej porcji „więcej” znika; fokus przechodzi na pierwszy nowy
  // wpis zamiast spaść na <body>. Póki przycisk jest, fokus zostaje na nim.
  // preventScroll: fokus przewinąłby stronę skokiem, w poprzek przewijania wyżej.
  if (historyShown >= history.length) {
    firstItem.tabIndex = -1;
    firstItem.focus({ preventScroll: true });
  }
});

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

// Puste miejsce na kuponie: sam wygląd, czytnik ekranu go pomija (liczbę
// wybranych podaje licznik obok nagłówka).
const createSlot = () => {
  const slot = document.createElement('span');
  slot.className = 'slot';
  slot.setAttribute('aria-hidden', 'true');
  return slot;
};

// „Wybierz jeszcze 1 liczbę / 2 liczby / 5 liczb” — odmiana dla 1–6, więcej
// brakujących liczb nie bywa.
const missingNumbersHint = (missing) =>
  `Wybierz jeszcze ${missing} ${missing === 1 ? 'liczbę' : missing <= 4 ? 'liczby' : 'liczb'}.`;

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
    }),
    ...Array.from({ length: TICKET_SIZE - ticketNumbers.length }, createSlot)
  );
  selectedCount.textContent = `${ticketNumbers.length}/${TICKET_SIZE}`;
  // Przycisk stoi na miejscu od początku (zablokowany), żeby układ nie skakał
  // po wybraniu szóstej liczby; podpowiedź mówi, czego jeszcze brakuje.
  startButton.disabled = !full;
  startButton.classList.toggle('inactive', simulationRunning);
  startHint.textContent = full ? '' : missingNumbersHint(TICKET_SIZE - ticketNumbers.length);
  startHint.classList.toggle('inactive', full || simulationRunning);
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
    // Bez zgody recordWin niczego nie zapisuje i zwraca historię bez zmian.
    history = recordWin(storage, { numbers: ticketNumbers, drawsNumber: data.drawsNumber, date: Date.now() });
    // Nowa wygrana wjeżdża na górę listy; pozostałe wpisy stoją.
    renderHistory(0, 1);
    simulationWorker.terminate();
    simulationWorker = null;

    simulationRunning = false;
    winResultElement.classList.remove('inactive');
    const abortFocused = document.activeElement === abortButton;
    render();
    // Jak po przerwaniu: znikający „Przerwij” zrzuciłby fokus na <body>.
    if (abortFocused) startButton.focus();
  });

  simulationRunning = true;
  lastProgress = null;
  progressCount.textContent = '';
  winResultElement.classList.add('inactive');
  abortedElement.classList.add('inactive');
  render();
  // Przycisk startu znika na czas symulacji; fokus przechodzi na jego
  // następcę w tym samym miejscu, zamiast spaść na <body>.
  abortButton.focus();
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
