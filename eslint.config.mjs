// ESLint: tylko błędy logiczne (reguły `recommended`). Wygląd kodu należy do
// Prettiera (.prettierrc.json) — reguły stylu tutaj kłóciłyby się z nim.
//
// Globalne zmienne zależą od tego, GDZIE plik się wykonuje: moduły strony
// w przeglądarce, worker w wątku bez `window` i `document`, testy i skrypty
// w Node. Zły zestaw przepuszcza np. `document` w workerze — pada dopiero
// w przeglądarce, po kliknięciu „Rozpocznij”.

import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', '.parcel-cache/', 'test-results/', 'playwright-report/', 'plan/'] },
  js.configs.recommended,
  {
    files: ['index.js', 'format.js', 'history.js', 'simulation.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['simulationWorker.js'],
    languageOptions: { globals: globals.worker },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    files: ['scripts/**/*.mjs', 'e2e/serve.mjs', '*.config.mjs'],
    languageOptions: { globals: globals.node },
  },
  // Scenariusze działają w Node, ale funkcje podawane do addInitScript
  // i evaluate wykonują się w przeglądarce.
  {
    files: ['e2e/*.spec.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
