// Google Analytics (GA4) — wczytywany dopiero po zgodzie z banera (index.js).
// Fragment od Google to skrypt inline w <head>: wysyłałby dane i ustawiał
// ciasteczka _ga, zanim odwiedzający cokolwiek kliknie. Okno jest
// wstrzykiwane, żeby test wołał moduł bez przeglądarki.
// Domeny Google wpuszcza polityka CSP (scripts/build.mjs) — zmiana adresu
// skryptu bez zmiany polityki i przeglądarka go zablokuje.

export const GA_MEASUREMENT_ID = 'G-DCYZYG9SB7';
export const GTAG_URL = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;

// Wołana przy każdej zgodzie (wejście, „Akceptuję”, zgoda z innej karty);
// drugi skrypt i drugi `config` liczyłyby tę samą wizytę dwa razy.
export const startAnalytics = (win) => {
  if (win.gtag) return;
  win.dataLayer = win.dataLayer || [];
  // gtag.js rozpoznaje polecenia po obiekcie `arguments`, nie po tablicy:
  // z (...args) => dataLayer.push(args) kolejka wygląda tak samo, a GA
  // niczego nie wysyła.
  win.gtag = function () {
    win.dataLayer.push(arguments);
  };
  win.gtag('js', new Date());
  win.gtag('config', GA_MEASUREMENT_ID);
  const script = win.document.createElement('script');
  script.async = true;
  script.src = GTAG_URL;
  win.document.head.append(script);
};
