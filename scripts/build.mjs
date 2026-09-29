// Build produkcyjny: Parcel, a potem w dist/index.html pełny adres og:image
// i Content-Security-Policy.
// Tą funkcją budują serwer (`npm run build` w kontenerze bez sieci), testy
// w przeglądarce (e2e/serve.mjs) i test stopki — inaczej testy sprawdzałyby
// stronę bez polityki, a na produkcję szłaby inna.
//
// Polityka jest znacznikiem <meta>, a nie nagłówkiem serwera, bo zależy od
// buildu: Parcel wstawia do HTML-a skrypt inline (importmapę) z sumami nazw
// plików, więc jego skrót zmienia się z każdym wydaniem. Bez skrótu
// przeglądarka zablokuje importmapę — worker i numer wersji się nie wczytają;
// z 'unsafe-inline' polityka przepuszcza każdy wstrzyknięty skrypt.
//
// Użycie: node scripts/build.mjs [katalog wyniku, domyślnie dist]

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Wszystko z własnego źródła; wtyczek, <base> i wysyłania formularzy strona
// nie używa, więc zamykamy je wprost (default-src ich nie obejmuje).
// Ramkowanie blokuje X-Frame-Options z Traefika: frame-ancestors w <meta>
// przeglądarka ignoruje.
export const policy = (scriptHashes) =>
  [
    "default-src 'self'",
    ["script-src 'self'", ...scriptHashes.map((hash) => `'${hash}'`)].join(' '),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

// Skrypty inline: <script> bez src. Skrót liczy się z treści DOKŁADNIE między
// znacznikami — spacja albo nowa linia więcej i przeglądarka go nie uzna.
export const inlineScriptHashes = (html) =>
  [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attributes]) => !/\bsrc\s*=/i.test(attributes))
    .map(([, , body]) => `sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}`);

// Meta zaraz po <html>: polityka obejmuje tylko to, co przeglądarka przeczyta
// PO niej, a Parcel stawia importmapę przed <meta charset>. Zbudowany HTML
// nie ma <head> (minifikacja usuwa znaczniki opcjonalne), więc punktem
// zaczepienia jest <html>.
export const injectCsp = (html) => {
  const opening = /<html\b[^>]*>/i.exec(html);
  if (!opening) throw new Error('Zbudowany index.html nie ma znacznika <html> — nie ma gdzie wstawić polityki CSP.');
  if (/http-equiv=["']?Content-Security-Policy/i.test(html)) {
    throw new Error('index.html ma już politykę CSP — druga zaostrzyłaby pierwszą; usuń ją ze źródła.');
  }
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy(inlineScriptHashes(html))}">`;
  const at = opening.index + opening[0].length;
  return html.slice(0, at) + meta + html.slice(at);
};

// <meta property=X content=…> — wartość w cudzysłowach albo bez nich
// (minifikator zdejmuje zbędne). Grupa 1: cała wartość z cudzysłowami.
const ogMeta = (property) =>
  new RegExp(`(<meta\\s+property=["']?${property}["']?\\s+content=)("[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
const unquote = (value) => value.replace(/^["']|["']$/g, '');

// og:image musi być pełnym adresem: Facebook, LinkedIn i komunikatory nie
// rozwiązują ścieżki względnej i pokazują podgląd bez obrazka. Parcel daje
// ścieżkę od korzenia (/og-image.png), a adres strony stoi w og:url — jedynym
// miejscu z domeną, więc zmiana domeny to zmiana jednej linii w index.html.
export const absolutizeOgImage = (html) => {
  const image = ogMeta('og:image').exec(html);
  if (!image) return html;
  const url = ogMeta('og:url').exec(html);
  if (!url) throw new Error('index.html ma og:image bez og:url — nie ma z czego policzyć pełnego adresu obrazka.');
  const absolute = new URL(unquote(image[2]), unquote(url[2])).href;
  return html.replace(ogMeta('og:image'), (_, prefix) => `${prefix}"${absolute}"`);
};

export const build = (distDir = join(ROOT, 'dist')) => {
  execFileSync(
    join(ROOT, 'node_modules', '.bin', 'parcel'),
    ['build', 'index.html', '--dist-dir', distDir, '--no-cache'],
    {
      cwd: ROOT,
      stdio: 'inherit',
    }
  );
  const indexFile = join(distDir, 'index.html');
  writeFileSync(indexFile, injectCsp(absolutizeOgImage(readFileSync(indexFile, 'utf8'))));
};

if (process.argv[1] === fileURLToPath(import.meta.url)) build(process.argv[2]);
