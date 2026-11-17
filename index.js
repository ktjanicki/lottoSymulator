import { grantAnalytics, startAnalytics } from './analytics.js';
import { drawsNoun, formatDateTime, formatDrawsChoice, formatNumber, formatSeconds, timesNoun } from './format.js';
import { GENERATOR_DRAWS, GENERATOR_SETS } from './generator.js';
import {
  CONSENT_KEY,
  GENERATED_KEY,
  HISTORY_KEY,
  HISTORY_PAGE,
  consentReminderDue,
  giveConsent,
  hasConsent,
  readGenerated,
  readHistory,
  recordGenerated,
  recordWin,
} from './history.js';
import { GAMES } from './simulation.js';

// Gra i tryb pod adresem bez fragmentu (lottosymulator.pl/): tam prowadzą
// link nagłówka („./”), canonical i wszystkie linki sprzed Eurojackpota
// i generatora.
const DEFAULT_GAME = 'lotto';
const SIMULATOR = 'simulator';
const GENERATOR = 'generator';

// Teksty zależne od trybu, które ustawia skrypt (reszta: data-for-mode
// w index.html). „po ponad N losowaniach” pasuje do każdej liczby z postępu.
const MODE_TEXTS = {
  [SIMULATOR]: {
    start: 'Rozpocznij symulację',
    running: 'Symulacja w toku',
    aborted: 'Symulacja przerwana',
    failed: 'Symulacja nie powiodła się. Odśwież stronę i spróbuj ponownie.',
  },
  [GENERATOR]: {
    start: 'Generuj liczby',
    running: 'Generowanie w toku',
    aborted: 'Generowanie przerwane',
    failed: 'Generowanie nie powiodło się. Odśwież stronę i spróbuj ponownie.',
  },
};

const gameButtons = [...document.querySelectorAll('.gameSwitch > button')];
const modeButtons = [...document.querySelectorAll('.modeSwitch > button')];
const drawsChoice = document.querySelector('.drawsChoice');
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
const layout = document.querySelector('.layout');
const resultElement = document.querySelector('.result');
const winResultElement = document.querySelector('.winResult');
const progressLabel = document.querySelector('.progressLabel');
const progressCount = document.querySelector('.progressCount');
const generatorResultElement = document.querySelector('.generatorResult');
const resultGeneratorDraws = document.querySelector('.resultGeneratorDraws');
const resultGeneratorTime = document.querySelector('.resultGeneratorTime');
const generatedSets = document.querySelector('.generatedSets');
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
// Tryb i gra z fragmentu adresu: #minilotto, #eurojackpot, #generator,
// #generator-minilotto, #generator-eurojackpot. Nieznany fragment (np. #historia ze starych
// linków) to symulator gry domyślnej. Object.hasOwn, nie `in`: #toString
// przeszedłby jako gra bez pul i strona padłaby przy starcie.
const GENERATOR_PREFIX = `${GENERATOR}-`;
const viewFromUrl = () => {
  const id = location.hash.slice(1);
  if (id === GENERATOR) return { mode: GENERATOR, game: DEFAULT_GAME };
  const generatorGame = id.startsWith(GENERATOR_PREFIX) ? id.slice(GENERATOR_PREFIX.length) : null;
  if (generatorGame !== null && Object.hasOwn(GAMES, generatorGame)) return { mode: GENERATOR, game: generatorGame };
  return { mode: SIMULATOR, game: Object.hasOwn(GAMES, id) ? id : DEFAULT_GAME };
};
// Symulator gry domyślnej bez fragmentu — jeden adres strony głównej, jak
// w canonical; parametry (?utm_…) zostają.
const urlFor = (viewMode, id) => {
  const fragment = [viewMode === GENERATOR && GENERATOR, id !== DEFAULT_GAME && id].filter(Boolean).join('-');
  return fragment ? `#${fragment}` : location.pathname + location.search;
};

let { mode, game } = viewFromUrl();
// Kupon każdej gry osobno, pula po puli (napisy z data-number), do końca
// wizyty: przełączenie gry nie gubi liczb wybranych w drugiej.
const tickets = Object.fromEntries(Object.entries(GAMES).map(([id, { pools }]) => [id, pools.map(() => [])]));
// Liczba losowań generatora — wspólna dla gier, do końca wizyty.
let generatorDraws = GENERATOR_DRAWS[0];
// Zestawy pokazane na karcie generatora, od najczęstszego ({numbers — pula
// po puli, hits}), albo null: przed pierwszym wynikiem, w trakcie liczenia
// i po zmianie gry lub trybu.
let generated = null;
let simulationRunning = false;
let simulationWorker = null;
let lastProgress = null;
// Wygrane wszystkich gier (readHistory). Przesłania globalne `history` —
// historia przeglądarki to tu zawsze window.history.
let history = [];
// Zestawy generatora wszystkich gier (readGenerated).
let generatedHistory = [];
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
// Ukończone symulacje i generowania w tej wizycie, liczone tylko, dopóki nie
// ma zgody.
let completedWithoutConsent = 0;
// Wynik ({mode, entry}), po którym baner wrócił. Odwiedzający patrzy na
// niego, klikając „Akceptuję” — gdyby zgoda go nie zapisała, historia
// zaczynałaby się od następnego.
let unsavedResult = null;
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
  unsavedResult = null;
  // Baner znika razem z fokusem; bez tego fokus klawiatury spada na <body>.
  // Przy wejściu fokusu nie było nigdzie — idzie na pierwszą wolną liczbę,
  // a w generatorze (plansza ukryta) na przycisk startu.
  const target =
    focusBeforeBanner?.isConnected && focusBeforeBanner !== document.body
      ? focusBeforeBanner
      : mode === GENERATOR
        ? startButton
        : boards[0].querySelector('.ball:not(:disabled)');
  target?.focus({ preventScroll: true });
});

// Zapisuje wynik w historii jego trybu i pokazuje go na górze listy; pozostałe
// wpisy stoją. Bez zgody record* niczego nie zapisują i zwracają listę bez zmian.
const saveResult = ({ mode: resultMode, entry }) => {
  if (resultMode === GENERATOR) generatedHistory = recordGenerated(storage, entry);
  else history = recordWin(storage, entry);
  renderHistory(0, 1);
};

// Zgoda z tej karty („Akceptuję”) albo z innej (zdarzenie `storage` niżej).
const applyConsent = () => {
  consentGiven = true;
  grantAnalytics(window);
  if (unsavedResult) saveResult(unsavedResult);
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
const createHistoryBalls = (entryGame, numbers) => {
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
  return balls;
};

// Nazwa gry z jej przycisku w przełączniku — jedno miejsce w index.html.
const gameName = (id) => gameButtons.find((button) => button.dataset.game === id).textContent;

// Wygrana symulatora: kule, gra z datą, liczba losowań. Generowanie (wpis
// z `sets`): gra z datą i liczba losowań, pod nimi zestawy z liczbą trafień.
// Nazwa gry stoi przy każdym wpisie: lista trybu miesza gry, a zestaw Mini
// Lotto i główne liczby Eurojackpota (po pięć złotych kul) wyglądają tak samo.
const createHistoryItem = ({ game: entryGame, numbers, sets, drawsNumber, date }) => {
  const item = document.createElement('li');
  item.className = sets ? 'historyItem historyRun' : 'historyItem';
  const meta = document.createElement('p');
  meta.className = 'historyMeta';
  const name = document.createElement('span');
  name.className = 'historyGame';
  name.textContent = gameName(entryGame);
  const time = document.createElement('time');
  time.dateTime = new Date(date).toISOString();
  time.textContent = formatDateTime(new Date(date));
  // Kropka we własnym elemencie: na telefonie gra stoi nad datą i kropka
  // znika (style.css) — jako sam tekst zaczynałaby drugą linię.
  const separator = document.createElement('span');
  separator.className = 'historySeparator';
  separator.textContent = ' · ';
  meta.append(name, separator, time);
  const draws = document.createElement('p');
  draws.className = 'historyDraws';
  const count = document.createElement('strong');
  count.textContent = formatNumber(drawsNumber);
  draws.append(count, ` ${drawsNoun(drawsNumber)}`);
  if (!sets) {
    item.append(createHistoryBalls(entryGame, numbers), meta, draws);
    return item;
  }
  const list = document.createElement('ol');
  list.className = 'runSets';
  list.append(
    ...sets.map(({ numbers: setNumbers, hits }) => {
      const row = document.createElement('li');
      const times = document.createElement('span');
      times.className = 'runHits';
      times.textContent = `${formatNumber(hits)} ${timesNoun(hits)}`;
      row.append(createHistoryBalls(entryGame, setNumbers), times);
      return row;
    })
  );
  item.append(meta, draws, list);
  return item;
};

// Wpisy wjeżdżają jeden po drugim: kolejny rusza co HISTORY_STAGGER_MS,
// każdy wjeżdża przez HISTORY_ENTER_MS (czas animacji ustawia stąd JS, CSS
// ma tylko jej przebieg). Porcja 15 wpisów trwa ~2 s; dłużej — „więcej”
// wygląda na zawieszone, krócej — wpisy zlewają się w jeden błysk.
const HISTORY_STAGGER_MS = 100;
const HISTORY_ENTER_MS = 550;
// Odsłaniany element (pierwszy nowy wpis historii, karta wyniku) staje tyle
// pikseli pod górną krawędzią okna.
const SCROLL_OFFSET_PX = 24;
// Przewijanie trwa zawsze tyle samo, niezależnie od odległości.
const SCROLL_MS = 1000;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Przewija stronę (przez SCROLL_MS) tak, żeby `first` stanął tuż pod górną
// krawędzią okna — tylko gdy `last` nie mieści się w oknie (inaczej nowe
// widać bez przewijania).
// Kółko, dotyk albo klawisz przerywają przewijanie: bez tego strona
// szarpałaby się z odwiedzającym.
const scrollToReveal = (first, last) => {
  // getBoundingClientRect liczy z przesunięciem z początku animacji (wpis
  // startuje niżej) — bez odjęcia go wpis staje o tyle za wysoko.
  const shift = new DOMMatrixReadOnly(getComputedStyle(first).transform).m42;
  const top = first.getBoundingClientRect().top - shift;
  if (last.getBoundingClientRect().bottom <= window.innerHeight) return;
  const start = window.scrollY;
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const target = Math.min(start + top - SCROLL_OFFSET_PX, maxScroll);
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
    const progress = Math.min((now - began) / SCROLL_MS, 1);
    // Łagodny start i koniec (ease-in-out), jak wjazd wpisów.
    const eased = progress < 0.5 ? 2 * progress ** 2 : 1 - (-2 * progress + 2) ** 2 / 2;
    if (!cancelled) window.scrollTo(0, start + (target - start) * eased);
    if (progress < 1 && !cancelled) requestAnimationFrame(step);
    else for (const type of events) window.removeEventListener(type, cancel);
  };
  requestAnimationFrame(step);
};

// Wpisy wybranego trybu, wszystkich gier, od najnowszego — lista i licznik
// pokazują tylko je. Bez filtra gry: wygrana Lotto zostaje na liście także
// w Eurojackpocie (nazwę gry niesie wpis). Lista trybu łączy gry, nie tryby —
// generowanie to nie wygrana.
const modeHistory = () => (mode === GENERATOR ? generatedHistory : history);

// Jedyne miejsce, które ustawia listę historii na podstawie `history`
// i `generatedHistory`, wybranego trybu oraz liczby pokazanych wpisów (rośnie o HISTORY_PAGE po „więcej”).
// Wpisy o indeksach [animateFrom, animateTo) wjeżdżają po kolei — tylko
// nowo pokazane; reszta stoi, inaczej każde „więcej” migałoby całą listą.
const renderHistory = (animateFrom = 0, animateTo = 0) => {
  const entries = modeHistory();
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
generatedHistory = readGenerated(storage);
renderHistory();

// Druga karta ze stroną pisze do tego samego magazynu, a ta o tym nie wie:
// bez nasłuchu pokazuje historię sprzed tamtej wygranej, a baner pyta o zgodę
// danej już obok. `storage` przychodzi tylko z innych kart; key null to clear().
window.addEventListener('storage', ({ key }) => {
  if (key === HISTORY_KEY || key === GENERATED_KEY || key === null) {
    history = readHistory(storage);
    generatedHistory = readGenerated(storage);
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
  if (expanded) scrollToReveal(historyList.firstElementChild, historyList.lastElementChild);
});

historyMore.addEventListener('click', () => {
  const firstNew = historyShown;
  historyShown += HISTORY_PAGE;
  renderHistory(firstNew, historyShown);
  const firstItem = historyList.children[firstNew];
  scrollToReveal(firstItem, historyList.lastElementChild);
  // Po ostatniej porcji „więcej” znika; fokus przechodzi na pierwszy nowy
  // wpis zamiast spaść na <body>. Póki przycisk jest, fokus zostaje na nim.
  // preventScroll: fokus przewinąłby stronę skokiem, w poprzek przewijania wyżej.
  if (historyShown >= modeHistory().length) {
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

// Kula wygenerowanego zestawu: <span>, bo nic się na nią nie klika.
const createStaticBall = (number, pool) => {
  const ball = document.createElement('span');
  ball.className = pool > 0 ? 'ball euro' : 'ball';
  ball.textContent = number;
  return ball;
};

// Wiersz wyniku generatora: miejsce w czołówce, kule, liczba trafień
// i przycisk przenoszący zestaw do symulatora. Bez zestawu (przed wynikiem,
// w trakcie liczenia) — puste miejsca i przycisk ukryty, ale trzymający
// miejsce: wiersze stoją od początku, żeby karta nie rosła z wynikiem.
const createGeneratedSet = (pools, set, index) => {
  const row = document.createElement('li');
  row.className = 'generatedSet';
  const rank = document.createElement('span');
  rank.className = 'setRank';
  rank.textContent = `${index + 1}.`;
  const balls = document.createElement('div');
  balls.className = 'setBalls';
  balls.append(
    ...pools.flatMap(({ size }, pool) =>
      set
        ? set.numbers[pool].map((number) => createStaticBall(number, pool))
        : Array.from({ length: size }, () => createSlot(pool))
    )
  );
  const hits = document.createElement('span');
  hits.className = 'setHits';
  hits.textContent = set ? `${formatNumber(set.hits)} ${timesNoun(set.hits)}` : '';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toSimulatorButton';
  button.dataset.set = index;
  button.textContent = 'Do symulatora';
  button.setAttribute('aria-label', `Przenieś zestaw ${index + 1} do symulatora`);
  button.disabled = !set;
  row.append(rank, balls, hits, button);
  return row;
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

// Podpisy kafelków w kolejności GAMES[gra].tiers. Gra z jedną pulą (Lotto,
// Mini Lotto) słowami, jak od pierwszego wydania; gra z kilkoma pulami —
// trafienia w pulach („× 5 + 1”).
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

// Przycisk na każdą liczbę losowań generatora: „100 mln” … „3 mld”.
drawsChoice.replaceChildren(
  ...GENERATOR_DRAWS.map((draws) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.draws = draws;
    button.textContent = formatDrawsChoice(draws);
    return button;
  })
);

drawsChoice.addEventListener('click', ({ target }) => {
  const button = target.closest('button');
  if (!button) return;
  generatorDraws = Number(button.dataset.draws);
  render();
});

// Jedyne miejsce, które ustawia wygląd i dostępność kontrolek na podstawie
// trybu, gry, kuponu, wyniku generatora i trwającego liczenia. Przełączanie klas w kilku procedurach
// naraz rozjeżdżało się przy kolejności kliknięć, której nikt nie przewidział.
const render = () => {
  const { pools } = GAMES[game];
  const ticket = tickets[game];
  const simulator = mode === SIMULATOR;
  // Generator nie potrzebuje kuponu: przycisk startu jest gotowy od razu.
  const full = !simulator || pools.every(({ size }, pool) => ticket[pool].length === size);
  // Kolumny planszy i kuponu w style.css zależą od gry, bloki data-for-mode
  // — od trybu.
  document.body.dataset.game = game;
  document.body.dataset.mode = mode;
  for (const button of gameButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.game === game));
    // Gra nie zmienia się w trakcie liczenia: wynik trafiłby do złej gry.
    button.disabled = simulationRunning;
  }
  for (const button of modeButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    button.disabled = simulationRunning;
  }
  for (const button of drawsChoice.children) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.draws) === generatorDraws));
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
  selectedCount.textContent = simulator
    ? pools.map(({ size }, pool) => `${ticket[pool].length}/${size}`).join(' + ')
    : '';
  // Zawsze GENERATOR_SETS wierszy: z zestawami wyniku albo puste.
  generatedSets.replaceChildren(
    ...Array.from({ length: GENERATOR_SETS }, (_, index) => createGeneratedSet(pools, generated?.[index], index))
  );
  // Przycisk stoi na miejscu od początku (zablokowany), żeby układ nie skakał
  // po wybraniu ostatniej liczby; podpowiedź mówi, czego jeszcze brakuje.
  startButton.textContent = MODE_TEXTS[mode].start;
  progressLabel.textContent = MODE_TEXTS[mode].running;
  startButton.disabled = !full;
  startButton.classList.toggle('inactive', simulationRunning);
  startHint.textContent = full ? '' : missingNumbersHint(pools, ticket);
  startHint.classList.toggle('inactive', full || simulationRunning);
  simulationProgressElement.classList.toggle('inactive', !simulationRunning);
  simulationProgressMessage.classList.toggle('inactive', !simulationRunning);
};

// Przełącza stronę na tryb i grę: plansze i kafelki wyniku od nowa, historia
// trybu. Wynik i komunikat poprzedniego widoku znikają — „Szóstka!” nad
// kuponem Eurojackpota albo zestaw Lotto w generatorze Eurojackpota myliłyby.
// Kafelki stoją od razu (z zerami): od 900 px ukryty wynik trzyma miejsce,
// a bez nich plansza skoczyłaby przy wyniku.
const showView = (viewMode, id) => {
  const hadFocus = document.activeElement !== document.body;
  const modeChanged = viewMode !== mode;
  mode = viewMode;
  game = id;
  generated = null;
  const { pools, tiers } = GAMES[game];
  boards.forEach((board, pool) =>
    board.replaceChildren(
      ...Array.from({ length: pools[pool]?.max ?? 0 }, (_, index) => createBall(String(index + 1), pool))
    )
  );
  statsList.replaceChildren(...tiers.map(createStat));
  winResultElement.classList.add('inactive');
  generatorResultElement.classList.add('inactive');
  abortedElement.classList.add('inactive');
  render();
  // Historia łączy gry, więc zmiana gry jej nie dotyka: przerysowanie
  // zwinęłoby porcje „więcej” i zabrało fokus wpisowi.
  if (modeChanged) {
    historyShown = HISTORY_PAGE;
    renderHistory();
  }
  // Fokus na kuli, wpisie albo przycisku, który zniknął (np. Wstecz
  // z klawiatury, „Przenieś do symulatora”), spada na <body> albo zostaje na
  // ukrytym elemencie — wraca na przycisk przełącznika, który się zmienił.
  if (hadFocus && (document.activeElement === document.body || document.activeElement.getClientRects().length === 0)) {
    const pressed = modeChanged
      ? modeButtons.find((button) => button.dataset.mode === mode)
      : gameButtons.find((button) => button.dataset.game === game);
    pressed.focus();
  }
};

// Wpis w historii przeglądarki: Wstecz wraca do poprzedniego widoku.
const openView = (viewMode, id) => {
  if (viewMode === mode && id === game) return;
  window.history.pushState(null, '', urlFor(viewMode, id));
  showView(viewMode, id);
};

for (const button of gameButtons) button.addEventListener('click', () => openView(mode, button.dataset.game));
for (const button of modeButtons) button.addEventListener('click', () => openView(button.dataset.mode, game));

// Wstecz/Dalej i fragment zmieniony ręcznie. W trakcie liczenia widok zostaje
// (przełączniki są wtedy zablokowane), a adres wraca do niego — inaczej adres
// i strona pokazywałyby różne gry albo tryby.
const followUrl = () => {
  const view = viewFromUrl();
  if (view.mode === mode && view.game === game) return;
  if (simulationRunning) window.history.replaceState(null, '', urlFor(mode, game));
  else showView(view.mode, view.game);
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
  stopSimulation(MODE_TEXTS[mode].failed);
  // Jak po wyniku: znikający „Przerwij” zrzuciłby fokus na <body>.
  if (abortFocused) startButton.focus();
};

// Wynik symulatora: wygrana z licznikami stopni. Zwraca wpis do historii.
const showWin = (data, runGame, runNumbers) => {
  resultTicketNumbers.textContent = data.ticketNumbers;
  resultCounterTotal.textContent = formatNumber(data.drawsNumber);
  // Kafelki w kolejności GAMES[gra].tiers, jak liczniki z workera.
  statsList.querySelectorAll('.statValue').forEach((value, index) => {
    value.textContent = formatNumber(data.tiers[index]);
  });
  resultSimulationTime.textContent = formatSeconds(data.durationMs);
  winResultElement.classList.remove('inactive');
  return { game: runGame, numbers: runNumbers, drawsNumber: data.drawsNumber, date: Date.now() };
};

// Wynik generatora: zestawy w karcie planszy (render()), liczba losowań
// i czas w karcie wyniku. Zwraca wpis do historii — całe generowanie.
const showGenerated = (data, runGame) => {
  generated = data.sets;
  resultGeneratorDraws.textContent = formatNumber(data.drawsNumber);
  resultGeneratorTime.textContent = formatSeconds(data.durationMs);
  generatorResultElement.classList.remove('inactive');
  return {
    game: runGame,
    sets: data.sets.map(({ numbers, hits }) => ({ numbers: numbers.flat(), hits })),
    drawsNumber: data.drawsNumber,
    date: Date.now(),
  };
};

startButton.addEventListener('click', () => {
  // Tryb, gra i wejście z chwili startu: wynik przychodzi później.
  const runMode = mode;
  const runGame = game;
  const runNumbers = tickets[game].flat();
  const runDraws = generatorDraws;
  // Parcel 2 dołącza plik workera do paczki tylko z postaci new URL(…, import.meta.url);
  // sam napis ('simulationWorker.js') przerywa `npm run build` błędem. Worker jest
  // modułem (importuje simulation.js); bez `type: 'module'` przeglądarka odrzuci import.
  simulationWorker = new Worker(new URL('simulationWorker.js', import.meta.url), { type: 'module' });

  // Plik workera się nie wczytał (np. 404 po wdrożeniu, przeglądarka bez
  // workerów modułowych) — wyjątki z samego liczenia (także brak pamięci na
  // liczniki generatora) przychodzą jako {type: 'error'}.
  simulationWorker.addEventListener('error', failSimulation);
  simulationWorker.addEventListener('message', ({ data }) => {
    if (data.type === 'error') {
      failSimulation();
      return;
    }
    if (data.type === 'progress') {
      lastProgress = data;
      // Postęp przychodzi co milion losowań, więc liczba kończy się na „000”
      // i zawsze pasuje do niej forma „losowań”. Generator zna koniec z góry
      // i liczy w milionach („30 z 1 000 mln”): pełne liczby zawijały pasek
      // postępu na telefonie do trzech linii.
      const count =
        runMode === GENERATOR
          ? `${formatNumber(data.drawsNumber / 1_000_000)} z ${formatNumber(runDraws / 1_000_000)}\u00a0mln`
          : formatNumber(data.drawsNumber);
      progressCount.textContent = `${count} losowań · ${formatSeconds(data.durationMs)} s`;
      return;
    }
    const entry = runMode === GENERATOR ? showGenerated(data, runGame) : showWin(data, runGame, runNumbers);
    const result = { mode: runMode, entry };
    saveResult(result);
    simulationWorker.terminate();
    simulationWorker = null;

    simulationRunning = false;
    const abortFocused = document.activeElement === abortButton;
    render();
    // Jak po przerwaniu: znikający „Przerwij” zrzuciłby fokus na <body>.
    if (abortFocused) startButton.focus();
    // W jednej kolumnie wynik wyrasta pod przyciskiem startu, poza oknem
    // telefonu — bez przewinięcia odwiedzający widzi tylko, że pasek zniknął.
    // W generatorze ma się zmieścić także lista zestawów pod kartą wyniku.
    // W dwóch kolumnach (desktop) wynik stoi obok przycisku — przewinięcie
    // tylko zabiera planszę spod oczu (niskie okno, zestawy generatora).
    // Kolumny liczone z siatki, nie z szerokości okna: próg siedzi tylko
    // w style.css; druga kopia „900px” rozjechałaby się z nim po cichu.
    // Po fokusie: focus() przewija skokiem, przewijanie zaczyna od tego miejsca.
    const singleColumn = getComputedStyle(layout).gridTemplateColumns.split(' ').length === 1;
    if (singleColumn) scrollToReveal(resultElement, runMode === GENERATOR ? generatedSets : winResultElement);
    // Na końcu: wynik stoi już na ekranie, a baner zwróci fokus tam, gdzie go zastał.
    if (!consentGiven && consentReminderDue(++completedWithoutConsent)) {
      unsavedResult = result;
      showBanner();
    }
  });

  simulationRunning = true;
  lastProgress = null;
  generated = null;
  progressCount.textContent = '';
  winResultElement.classList.add('inactive');
  generatorResultElement.classList.add('inactive');
  abortedElement.classList.add('inactive');
  render();
  // Przycisk startu znika na czas liczenia; fokus przechodzi na jego
  // następcę w tym samym miejscu, zamiast spaść na <body>.
  abortButton.focus();
  simulationWorker.postMessage(
    runMode === GENERATOR
      ? { mode: GENERATOR, game: runGame, draws: runDraws }
      : { mode: SIMULATOR, game: runGame, numbers: runNumbers }
  );
});

// Pętla workera jest synchroniczna — nie odbierze wiadomości „stop”, więc
// przerwanie to zabicie wątku. Liczba losowań pochodzi z ostatniego postępu,
// stąd „ponad”: worker zdążył wylosować więcej, zanim zginął.
abortButton.addEventListener('click', () => {
  const { aborted } = MODE_TEXTS[mode];
  stopSimulation(
    lastProgress
      ? `${aborted} po ponad ${formatNumber(lastProgress.drawsNumber)} losowaniach (${formatSeconds(lastProgress.durationMs)} s).`
      : `${aborted}.`
  );
  // Przycisk „Przerwij” znika; bez tego fokus klawiatury spada na <body>.
  startButton.focus();
});

// Zestaw z klikniętego wiersza staje się kuponem symulatora tej samej gry
// (napisy, jak z data-number planszy) i strona przechodzi do symulatora.
generatedSets.addEventListener('click', ({ target }) => {
  const button = target.closest('.toSimulatorButton');
  if (!button) return;
  tickets[game] = generated[Number(button.dataset.set)].numbers.map((numbers) => numbers.map(String));
  openView(SIMULATOR, game);
  // Przycisk zniknął razem z wynikiem generatora; kupon jest pełny, więc
  // następny krok to start symulacji.
  startButton.focus();
});

showView(mode, game);
