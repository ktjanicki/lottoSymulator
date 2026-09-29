// Testy strony w prawdziwej przeglądarce (e2e/). Dwa tryby:
// - domyślny: zbudowany dist/ podany lokalnie przez e2e/serve.mjs (CI, npm run test:e2e);
// - BASE_URL=https://… : ta sama strona na produkcji, tylko scenariusze
//   oznaczone @prod (npm run check:prod) — po każdym wdrożeniu.

import { defineConfig, devices } from '@playwright/test';

const PORT = 8471;
const baseURL = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  // Bez tego Playwright wziąłby też test/*.test.js, czyli testy node --test.
  testDir: 'e2e',
  // Pełna symulacja trwa zwykle kilka sekund, ale czas do szóstki ma rozkład
  // geometryczny: raz na kilkaset przebiegów wychodzi kilkanaście razy
  // dłużej. Limit niższy niż ~2 min daje losowo czerwone CI.
  timeout: 150_000,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: { baseURL },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'firefox', use: devices['Desktop Firefox'] },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'node e2e/serve.mjs',
        url: baseURL,
        env: { PORT: String(PORT) },
        timeout: 120_000,
        stdout: 'pipe',
      },
});
