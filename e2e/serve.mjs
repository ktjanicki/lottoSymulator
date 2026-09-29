// Buduje stronę produkcyjnym buildem (scripts/build.mjs: Parcel + CSP) do
// katalogu tymczasowego i podaje ją jak produkcja: z korzenia domeny (Parcel
// pisze ścieżki od „/”), z typami MIME, bez których przeglądarka odrzuci moduł
// i worker. Build poza repozytorium: katalog w drzewie trafiłby do kopii,
// którą buduje test stopki, i do `git status`.
// Uruchamia go Playwright (webServer w playwright.config.mjs).

import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { build } from '../scripts/build.mjs';

const PORT = Number(process.env.PORT ?? 8471);

const dist = mkdtempSync(join(tmpdir(), 'lotto-e2e-'));
build(dist);

// Plik VERSION.<suma>. nie ma rozszerzenia — dostaje text/plain jak na serwerze.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = join(dist, normalize(path === '/' ? '/index.html' : path));
  // normalize() zjada „..”, ale sprawdzamy wprost: serwer nie ma podawać
  // niczego spoza katalogu buildu.
  if (!file.startsWith(dist) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'text/plain; charset=utf-8' });
  response.end(readFileSync(file));
});

server.listen(PORT, '127.0.0.1', () => console.log(`e2e: ${dist} na http://127.0.0.1:${PORT}/`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    rmSync(dist, { recursive: true, force: true });
    process.exit(0);
  });
}
