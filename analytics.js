// Google Analytics (GA4) w trybie zgody (Consent Mode v2). gtag.js wczytuje
// się zawsze — statyczny <script> w index.html, żeby wykrywacz instalacji
// Google widział tag w źródle strony. Bez zgody GA nie ustawia ciasteczek
// i dostaje tylko pingi bez identyfikatora; „Akceptuję” włącza ciasteczka.
// Identyfikator stoi tylko w adresie tego skryptu — kopia tutaj prędzej czy
// później wskazałaby inną usługę niż wczytany tag.
// Okno jest wstrzykiwane, żeby test wołał moduł bez przeglądarki.
// Domeny Google wpuszcza polityka CSP (scripts/build.mjs).

export const GTAG_SCRIPT = 'script[src^="https://www.googletagmanager.com/gtag/js"]';

// gtag.js rozpoznaje polecenia po obiekcie `arguments`, nie po tablicy:
// z (...args) => dataLayer.push(args) kolejka wygląda tak samo, a GA
// niczego nie wysyła.
const gtagFor = (win) =>
  function () {
    win.dataLayer.push(arguments);
  };

// Wołana raz, przy wejściu. Odmowa domyślna musi stać w kolejce PRZED
// `config` — inaczej pierwszy pomiar wychodzi z ciasteczkami bez zgody.
// Zapisana zgoda idzie od razu w domyślnej, bez mignięcia odmowy.
// Bez tagu w HTML-u analityka się nie uruchamia, ale strona działa: wyjątek
// tutaj zatrzymałby index.js, a z nim całą symulację.
export const startAnalytics = (win, consented) => {
  const script = win.document.querySelector(GTAG_SCRIPT);
  const id = script && new URL(script.src).searchParams.get('id');
  if (!id) return;
  win.dataLayer = win.dataLayer || [];
  win.gtag = gtagFor(win);
  // Reklam na stronie nie ma — zgody reklamowe zostają odrzucone na stałe.
  win.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: consented ? 'granted' : 'denied',
  });
  win.gtag('js', new Date());
  win.gtag('config', id);
};

// Zgoda w trakcie wizyty („Akceptuję” albo zgoda z innej karty).
export const grantAnalytics = (win) => win.gtag?.('consent', 'update', { analytics_storage: 'granted' });
