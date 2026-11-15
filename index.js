import { grantAnalytics, startAnalytics } from './analytics.js';
import { drawsNoun, formatDateTime, formatNumber, formatSeconds } from './format.js';
import {
  CONSENT_KEY,
  HISTORY_KEY,
  HISTORY_PAGE,
  consentReminderDue,
  giveConsent,
  hasConsent,
  readHistory,
  recordWin,
} from './history.js';
import { GAMES } from './simulation.js';

// Gra pod adresem bez fragmentu (lottosymulator.pl/): tam prowadzą link
// nagłówka („./”), canonical i wszystkie linki sprzed Eurojackpota.
const DEFAULT_GAME = 'lotto';

const gameButtons = [...document.querySelectorAll('.gameSwitch > button')];
const gameTexts = document.querySelectorAll('[data-for-game]');
// Plansza puli o indeksie data-pool (kolejność w GAMES[gra].pools).
const boards = [];
for (const board of document.querySelectorAll('.numbersList[data-pool]')) boards[Number(board.dataset.pool)] = board;
const selectedItems = document.querySelector('.selectedItems');
const selectedCount = document.querySelector('.selectedCount');
const startButton = document.querySelector('.startButton');
const startHint = document.querySelector('.startHint');
const resultCounterTotal = document.querySelector('.resultCounterTotal');
const statsList = document.querySelector('.stats');
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
const cookieDecline = document.querySelector('.cookieDecline');
// Gra z fragmentu adresu (#eurojackpot). Nieznany fragment (np. #historia
// ze starych linków) to gra domyślna. Object.hasOwn, nie `in`: #toString
// przeszedłby jako gra bez pul i strona padłaby przy starcie.
const gameFromUrl = () => {
  const id = location.hash.slice(1);
  return Object.hasOwn(GAMES, id) ? id : DEFAULT_GAME;
};
// Gra domyślna bez fragmentu — jeden adres strony głównej, jak w canonical;
// parametry (?utm_…) zostają.
const urlFor = (id) => (id === DEFAULT_GAME ? location.pathname + location.search : `#${id}`);

let game = gameFromUrl();
// Kupon każdej gry osobno, pula po puli (napisy z data-number), do końca
// wizyty: przełączenie gry nie gubi liczb wybranych w drugiej.
const tickets = Object.fromEntries(Object.entries(GAMES).map(([id, { pools }]) => [id, pools.map(() => [])]));
let simulationRunning = false;
let simulationWorker = null;
let lastProgress = null;
// Wygrane wszystkich gier (readHistory). Przesłania globalne `history` —
// historia przeglądarki to tu zawsze window.history.
let history = [];
let historyShown = HISTORY_PAGE;

// Numer z pliku VERSION — jedynego źródła numeru wydania. Strona ma działać
// i po buildzie (produkcja; Parcel kopiuje VERSION do dist/), i podana wprost
// bez buildu — ścieżka względna działa w obu trybach. Import rozwiązywany
// przez bundler, np. `fs`, bez buildu unieważnia w przeglądarce cały moduł:
// tak padła produkcja w 1.1.0, gdy jeszcze podawała surowe pliki.
// Bez sieci (strona z pamięci przeglądarki) stopka zostaje bez numeru —
// bez catch każde takie wejście zostawia w konsoli nieobsłużony błąd.
fetch(new URL('VERSION', import.meta.url))
  .then((response) => (response.ok ? response.text() : ''))
  .then((version) => (document.querySelector('.appVersion').textContent = version.trim()))
  .catch(() => {});

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
// (inert — klawiatura i czytnik ekranu też jej nie dosięgną), dopóki
// odwiedzający nie wybierze. Zamknięty w HTML: odwiedzający po akceptacji nie
// widzi go nawet przez mgnienie, zanim skrypt sprawdzi zgodę. Odmowy nie
// zapisujemy — bez zgody baner wraca przy każdym wejściu i po co piątej
// ukończonej symulacji (consentReminderDue w history.js).
let consentGiven = hasConsent(storage);
// Ukończone symulacje w tej wizycie, liczone tylko, dopóki nie ma zgody.
let completedWithoutConsent = 0;
// Wygrana, po której baner wrócił. Odwiedzający patrzy na nią, klikając
// „Akceptuję” — gdyby zgoda jej nie zapisała, historia zaczynałaby się od następnej.
let unsavedWin = null;
let focusBeforeBanner = null;

const showBanner = () => {
  focusBeforeBanner = document.activeElement;
  cookieBanner.showModal();
};

if (!consentGiven) showBanner();
// Bez zgody GA liczy wizytę bez ciasteczek (analytics.js).
startAnalytics(window, consentGiven);

// Zamyka go „Akceptuję”, „Nie zgadzam się” albo Esc (to też odmowa).
cookieBanner.addEventListener('close', () => {
  unsavedWin = null;
  // Baner znika razem z fokusem; bez tego fokus klawiatury spada na <body>.
  // Przy wejściu fokusu nie było nigdzie — idzie na pierwszą wolną liczbę.
  const target =
    focusBeforeBanner?.isConnected && focusBeforeBanner !== document.body
      ? focusBeforeBanner
      : boards[0].querySelector('.ball:not(:disabled)');
  target?.focus({ preventScroll: true });
});

// Zgoda z tej karty („Akceptuję”) albo z innej (zdarzenie `storage` niżej).
const applyConsent = () => {
  consentGiven = true;
  grantAnalytics(window);
  if (unsavedWin) {
    history = recordWin(storage, unsavedWin);
    renderHistory(0, 1);
  }
  if (cookieBanner.open) cookieBanner.close();
};

cookieAccept.addEventListener('click', () => {
  // Gdy magazyn odmówi, zgoda trwa do końca wizyty (baner znika), ale
  // historia i tak się nie zapisze, a baner wróci przy następnym wejściu.
  giveConsent(storage);
  applyConsent();
});

cookieDecline.addEventListener('click', () => cookieBanner.close());

// Kule historii to <span>, nie przyciski: wyglądają jak na kuponie, ale nic
// się na nie nie klika. Liczby wpisu idą pula po puli (history.js); kule
// dalszych pul — w kolorze euroliczb, jak na kuponie.
const createHistoryItem = ({ game: entryGame, numbers, drawsNumber, date }) => {
  const item = document.createElement('li');
  item.className = 'historyItem';
  const balls = document.createElement('div');
  balls.className = 'historyBalls';
  let offset = 0;
  GAMES[entryGame].pools.forEach(({ size }, pool) => {
    for (const number of numbers.slice(offset, (offset += size))) {
      const ball = document.createElement('span');
      ball.className = pool > 0 ? 'ball euro' : 'ball';
      ball.textContent = number;
      balls.append(ball);
    }
  });
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
// Przewijanie trwa zawsze tyle samo, niezależnie od liczby nowych wpisów.
const HISTORY_SCROLL_MS = 1000;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Przewija stronę (przez HISTORY_SCROLL_MS) tak, żeby pierwszy nowy stanął
// tuż pod górną krawędzią okna — tylko gdy nowe wpisy nie mieszczą się
// w oknie (inaczej widać je bez przewijania). Kółko, dotyk albo klawisz
// przerywają przewijanie: bez tego strona szarpałaby się z odwiedzającym.
const scrollToNewEntries = (first, last) => {
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
  const began = performance.now();
  let cancelled = false;
  const cancel = () => (cancelled = true);
  const events = ['wheel', 'touchstart', 'keydown'];
  for (const type of events) window.addEventListener(type, cancel, { once: true, passive: true });
  const step = (now) => {
    const progress = Math.min((now - began) / HISTORY_SCROLL_MS, 1);
    // Łagodny start i koniec (ease-in-out), jak wjazd wpisów.
    const eased = progress < 0.5 ? 2 * progress ** 2 : 1 - (-2 * progress + 2) ** 2 / 2;
    if (!cancelled) window.scrollTo(0, start + (target - start) * eased);
    if (progress < 1 && !cancelled) requestAnimationFrame(step);
    else for (const type of events) window.removeEventListener(type, cancel);
  };
  requestAnimationFrame(step);
};

// Wygrane wybranej gry, od najnowszej — lista i licznik pokazują tylko je.
const gameHistory = () => history.filter((entry) => entry.game === game);

// Jedyne miejsce, które ustawia listę historii na podstawie `history`,
// wybranej gry i liczby pokazanych wpisów (rośnie o HISTORY_PAGE po „więcej”).
// Wpisy o indeksach [animateFrom, animateTo) wjeżdżają po kolei — tylko
// nowo pokazane; reszta stoi, inaczej każde „więcej” migałoby całą listą.
const renderHistory = (animateFrom = 0, animateTo = 0) => {
  const entries = gameHistory();
  historySection.classList.toggle('inactive', entries.length === 0);
  historyCount.textContent = entries.length;
  historyList.replaceChildren(
    ...entries.slice(0, historyShown).map((entry, index) => {
      const item = createHistoryItem(entry);
      if (index >= animateFrom && index < animateTo) {
        item.classList.add('entering');
        item.style.animationDelay = `${(index - animateFrom) * HISTORY_STAGGER_MS}ms`;
        item.style.animationDuration = `${HISTORY_ENTER_MS}ms`;
      }
      return item;
    })
  );
  historyMore.classList.toggle('inactive', historyShown >= entries.length);
};

history = readHistory(storage);
renderHistory();

// Druga karta ze stroną pisze do tego samego magazynu, a ta o tym nie wie:
// bez nasłuchu pokazuje historię sprzed tamtej wygranej, a baner pyta o zgodę
// danej już obok. `storage` przychodzi tylko z innych kart; key null to clear().
window.addEventListener('storage', ({ key }) => {
  if (key === HISTORY_KEY || key === null) {
    history = readHistory(storage);
    renderHistory();
  }
  if ((key === CONSENT_KEY || key === null) && !consentGiven && hasConsent(storage)) applyConsent();
});

// Zwinięta przy każdym wejściu (tak stoi w HTML) — stanu nie zapamiętujemy.
historyToggle.addEventListener('click', () => {
  const expanded = historyToggle.getAttribute('aria-expanded') !== 'true';
  historyToggle.setAttribute('aria-expanded', String(expanded));
  historyLabel.textContent = expanded ? 'Ukryj historię' : 'Pokaż historię';
  if (expanded) renderHistory(0, historyShown);
  historyBody.classList.toggle('inactive', !expanded);
  // Po odsłonięciu — ukryta lista nie ma jeszcze położenia do przewinięcia.
  if (expanded) scrollToNewEntries(historyList.firstElementChild, historyList.lastElementChild);
});

historyMore.addEventListener('click', () => {
  const firstNew = historyShown;
  historyShown += HISTORY_PAGE;
  renderHistory(firstNew, historyShown);
  const firstItem = historyList.children[firstNew];
  scrollToNewEntries(firstItem, historyList.lastElementChild);
  // Po ostatniej porcji „więcej” znika; fokus przechodzi na pierwszy nowy
  // wpis zamiast spaść na <body>. Póki przycisk jest, fokus zostaje na nim.
  // preventScroll: fokus przewinąłby stronę skokiem, w poprzek przewijania wyżej.
  if (historyShown >= gameHistory().length) {
    firstItem.tabIndex = -1;
    firstItem.focus({ preventScroll: true });
  }
});

// Liczby to przyciski (<button>), a nie <div>: dają się wybrać klawiaturą
// i czytnik ekranu ogłasza je razem ze stanem aria-pressed. data-pool
// rozróżnia tę samą liczbę w dwóch pulach (3 z 50 i 3 z 12 w Eurojackpot).
const createBall = (number, pool, label) => {
  const ball = document.createElement('button');
  ball.type = 'button';
  ball.className = pool > 0 ? 'ball euro' : 'ball';
  ball.dataset.number = number;
  ball.dataset.pool = pool;
  ball.textContent = number;
  if (label) ball.setAttribute('aria-label', label);
  return ball;
};

// Puste miejsce na kuponie: sam wygląd, czytnik ekranu go pomija (liczbę
// wybranych podaje licznik obok nagłówka).
const createSlot = (pool) => {
  const slot = document.createElement('span');
  slot.className = pool > 0 ? 'slot euro' : 'slot';
  slot.setAttribute('aria-hidden', 'true');
  return slot;
};

// W grze z kilkoma pulami ta sama liczba stoi na kuponie dwa razy —
// czytnik ekranu podaje też pulę.
const removeLabel = (number, max) =>
  GAMES[game].pools.length > 1 ? `Usuń liczbę ${number} z ${max}` : `Usuń liczbę ${number}`;

// „Wybierz jeszcze 1 liczbę / 2 liczby / 5 liczb” — odmiana dla 1–6, więcej
// brakujących liczb nie bywa. W grze z kilkoma pulami z pulą i tylko dla pul
// z brakami: „2 liczby z 50 i 1 z 12”, „1 liczbę z 12”.
const numbersNoun = (missing) => (missing === 1 ? 'liczbę' : missing <= 4 ? 'liczby' : 'liczb');
const missingNumbersHint = (pools, ticket) => {
  const parts = pools
    .map(({ max, size }, pool) => ({ max, missing: size - ticket[pool].length }))
    .filter(({ missing }) => missing > 0)
    .map(({ max, missing }, index) =>
      [missing, index === 0 && numbersNoun(missing), pools.length > 1 && `z ${max}`].filter(Boolean).join(' ')
    );
  return `Wybierz jeszcze ${parts.join(' i ')}.`;
};

// Podpisy kafelków w kolejności GAMES[gra].tiers. Lotto słowami, jak od
// pierwszego wydania; gra z kilkoma pulami — trafienia w pulach („× 5 + 1”).
const LOTTO_TIER_LABELS = { 3: 'trójek', 4: 'czwórek', 5: 'piątek' };
const tierLabel = (tier) => (tier.length === 1 ? LOTTO_TIER_LABELS[tier[0]] : `× ${tier.join(' + ')}`);

const createStat = (tier) => {
  const item = document.createElement('li');
  const value = document.createElement('span');
  value.className = 'statValue';
  value.textContent = '0';
  const label = document.createElement('span');
  label.className = 'statLabel';
  label.textContent = tierLabel(tier);
  item.append(value, ' ', label);
  return item;
};

// Jedyne miejsce, które ustawia wygląd i dostępność kontrolek na podstawie
// gry, kuponu i trwającej symulacji. Przełączanie klas w kilku procedurach
// naraz rozjeżdżało się przy kolejności kliknięć, której nikt nie przewidział.
const render = () => {
  const { pools } = GAMES[game];
  const ticket = tickets[game];
  const full = pools.every(({ size }, pool) => ticket[pool].length === size);
  // Kolumny planszy i kuponu w style.css zależą od gry.
  document.body.dataset.game = game;
  for (const button of gameButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.game === game));
    // Gra nie zmienia się w trakcie symulacji: wynik trafiłby do złej gry.
    button.disabled = simulationRunning;
  }
  for (const element of gameTexts) element.classList.toggle('inactive', element.dataset.forGame !== game);
  pools.forEach(({ size }, pool) => {
    const poolFull = ticket[pool].length === size;
    for (const ball of boards[pool].children) {
      const selected = ticket[pool].includes(ball.dataset.number);
      ball.setAttribute('aria-pressed', String(selected));
      ball.disabled = simulationRunning || (poolFull && !selected);
    }
  });
  selectedItems.replaceChildren(
    ...pools.flatMap(({ max, size }, pool) => [
      ...ticket[pool].map((number) => {
        const ball = createBall(number, pool, removeLabel(number, max));
        ball.disabled = simulationRunning;
        return ball;
      }),
      ...Array.from({ length: size - ticket[pool].length }, () => createSlot(pool)),
    ])
  );
  selectedCount.textContent = pools.map(({ size }, pool) => `${ticket[pool].length}/${size}`).join(' + ');
  // Przycisk stoi na miejscu od początku (zablokowany), żeby układ nie skakał
  // po wybraniu ostatniej liczby; podpowiedź mówi, czego jeszcze brakuje.
  startButton.disabled = !full;
  startButton.classList.toggle('inactive', simulationRunning);
  startHint.textContent = full ? '' : missingNumbersHint(pools, ticket);
  startHint.classList.toggle('inactive', full || simulationRunning);
  simulationProgressElement.classList.toggle('inactive', !simulationRunning);
  simulationProgressMessage.classList.toggle('inactive', !simulationRunning);
};

// Przełącza stronę na grę: plansze i kafelki wyniku od nowa, historia gry.
// Wynik i komunikat poprzedniej gry znikają — „Szóstka!” nad kuponem
// Eurojackpota myliłaby. Kafelki stoją od razu (z zerami): od 900 px
// ukryty wynik trzyma miejsce, a bez nich plansza skoczyłaby przy wyniku.
const showGame = (id) => {
  const hadFocus = document.activeElement !== document.body;
  game = id;
  const { pools, tiers } = GAMES[game];
  boards.forEach((board, pool) =>
    board.replaceChildren(
      ...Array.from({ length: pools[pool]?.max ?? 0 }, (_, index) => createBall(String(index + 1), pool))
    )
  );
  statsList.replaceChildren(...tiers.map(createStat));
  winResultElement.classList.add('inactive');
  abortedElement.classList.add('inactive');
  historyShown = HISTORY_PAGE;
  render();
  renderHistory();
  // Fokus na kuli albo wpisie, który zniknął (np. Wstecz z klawiatury),
  // spada na <body> — wraca na przycisk wybranej gry.
  if (hadFocus && document.activeElement === document.body) {
    gameButtons.find((button) => button.dataset.game === game).focus();
  }
};

for (const button of gameButtons) {
  button.addEventListener('click', () => {
    if (button.dataset.game === game) return;
    // Wpis w historii przeglądarki: Wstecz wraca do poprzedniej gry.
    window.history.pushState(null, '', urlFor(button.dataset.game));
    showGame(button.dataset.game);
  });
}

// Wstecz/Dalej i fragment zmieniony ręcznie. W trakcie symulacji gra zostaje
// (przełącznik jest wtedy zablokowany), a adres wraca do niej — inaczej adres
// i strona pokazywałyby różne gry.
const followUrl = () => {
  const id = gameFromUrl();
  if (id === game) return;
  if (simulationRunning) window.history.replaceState(null, '', urlFor(game));
  else showGame(id);
};
window.addEventListener('popstate', followUrl);
window.addEventListener('hashchange', followUrl);

// Kliknięcie wybranej liczby zdejmuje ją z kuponu; liczba ponad pulę nie wchodzi.
const toggleNumber = (pool, number) => {
  const chosen = tickets[game][pool];
  const index = chosen.indexOf(number);
  if (index >= 0) chosen.splice(index, 1);
  else if (chosen.length < GAMES[game].pools[pool].size) chosen.push(number);
  render();
};

boards.forEach((board, pool) =>
  board.addEventListener('click', ({ target }) => {
    const ball = target.closest('.ball');
    if (ball) toggleNumber(pool, ball.dataset.number);
  })
);

selectedItems.addEventListener('click', ({ target }) => {
  const ball = target.closest('.ball');
  if (!ball) return;
  const pool = Number(ball.dataset.pool);
  toggleNumber(pool, ball.dataset.number);
  // Usunięty przycisk znika z DOM; bez tego fokus klawiatury spada na <body>.
  boards[pool].querySelector(`[data-number="${ball.dataset.number}"]`).focus();
});

// Kończy symulację bez wyniku: przerwanie albo awaria workera. Komunikat
// staje w miejscu wyniku; bez tej ścieżki awaria zostawiała stronę w stanie
// „w toku” — spinner kręcił się bez końca, a kupon był zablokowany.
const stopSimulation = (message) => {
  simulationWorker.terminate();
  simulationWorker = null;
  simulationRunning = false;
  abortedElement.textContent = message;
  abortedElement.classList.remove('inactive');
  render();
};

const failSimulation = () => {
  const abortFocused = document.activeElement === abortButton;
  stopSimulation('Symulacja nie powiodła się. Odśwież stronę i spróbuj ponownie.');
  // Jak po wyniku: znikający „Przerwij” zrzuciłby fokus na <body>.
  if (abortFocused) startButton.focus();
};

startButton.addEventListener('click', () => {
  const runGame = game;
  const runNumbers = tickets[game].flat();
  // Parcel 2 dołącza plik workera do paczki tylko z postaci new URL(…, import.meta.url);
  // sam napis ('simulationWorker.js') przerywa `npm run build` błędem. Worker jest
  // modułem (importuje simulation.js); bez `type: 'module'` przeglądarka odrzuci import.
  simulationWorker = new Worker(new URL('simulationWorker.js', import.meta.url), { type: 'module' });

  // Plik workera się nie wczytał (np. 404 po wdrożeniu, przeglądarka bez
  // workerów modułowych) — wyjątki z samej symulacji przychodzą jako {type: 'error'}.
  simulationWorker.addEventListener('error', failSimulation);
  simulationWorker.addEventListener('message', ({ data }) => {
    if (data.type === 'error') {
      failSimulation();
      return;
    }
    if (data.type === 'progress') {
      lastProgress = data;
      // Postęp przychodzi co milion losowań, więc liczba kończy się na „000”
      // i zawsze pasuje do niej forma „losowań”.
      progressCount.textContent = `${formatNumber(data.drawsNumber)} losowań · ${formatSeconds(data.durationMs)} s`;
      return;
    }
    resultTicketNumbers.textContent = data.ticketNumbers;
    resultCounterTotal.textContent = formatNumber(data.drawsNumber);
    // Kafelki w kolejności GAMES[gra].tiers, jak liczniki z workera.
    statsList.querySelectorAll('.statValue').forEach((value, index) => {
      value.textContent = formatNumber(data.tiers[index]);
    });
    resultSimulationTime.textContent = formatSeconds(data.durationMs);
    // Bez zgody recordWin niczego nie zapisuje i zwraca historię bez zmian.
    const win = { game: runGame, numbers: runNumbers, drawsNumber: data.drawsNumber, date: Date.now() };
    history = recordWin(storage, win);
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
    // Na końcu: wynik stoi już na ekranie, a baner zwróci fokus tam, gdzie go zastał.
    if (!consentGiven && consentReminderDue(++completedWithoutConsent)) {
      unsavedWin = win;
      showBanner();
    }
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
  simulationWorker.postMessage({ mode: 'simulator', game: runGame, numbers: runNumbers });
});

// Pętla workera jest synchroniczna — nie odbierze wiadomości „stop”, więc
// przerwanie to zabicie wątku. Liczba losowań pochodzi z ostatniego postępu,
// stąd „ponad”: worker zdążył wylosować więcej, zanim zginął.
abortButton.addEventListener('click', () => {
  stopSimulation(
    lastProgress
      ? `Symulacja przerwana po ponad ${formatNumber(lastProgress.drawsNumber)} losowaniach (${formatSeconds(lastProgress.durationMs)} s).`
      : 'Symulacja przerwana.'
  );
  // Przycisk „Przerwij” znika; bez tego fokus klawiatury spada na <body>.
  startButton.focus();
});

showGame(game);
