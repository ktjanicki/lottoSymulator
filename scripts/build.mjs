// Build produkcyjny: Parcel, a potem w dist/index.html pełny adres og:image,
// <link rel=canonical>, dane strukturalne i Content-Security-Policy, obok
// robots.txt, sitemap.xml i manifest.json z nazwą z og:title.
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
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// Adres strony z og:url — jedyne miejsce z domeną (index.html).
const siteUrl = (html) => {
  const url = ogMeta('og:url').exec(html);
  if (!url) throw new Error('index.html nie ma og:url — nie ma z czego policzyć adresu kanonicznego i mapy strony.');
  return new URL(unquote(url[2])).href;
};

// Ta sama strona odpowiada pod /, /index.html i www.; bez adresu kanonicznego
// wyszukiwarka sama wybiera wersję do wyników i dzieli między nie sygnały.
// Wstawiamy go zaraz za og:url, z którego pochodzi.
// Wstawia znacznik zaraz za og:url, z którego pochodzi jego treść.
const afterOgUrl = (html, tag) => {
  const url = ogMeta('og:url').exec(html);
  const at = html.indexOf('>', url.index + url[0].length) + 1;
  return `${html.slice(0, at)}${tag}${html.slice(at)}`;
};

export const addCanonical = (html) => {
  if (/<link\b[^>]*\brel=["']?canonical/i.test(html)) {
    throw new Error('index.html ma już <link rel=canonical> — adres liczy build z og:url; usuń go ze źródła.');
  }
  return afterOgUrl(html, `<link rel=canonical href="${siteUrl(html)}">`);
};

// Dane strukturalne WebSite: Google bierze z nich nazwę witryny pokazywaną
// nad wynikiem; bez nich zgaduje ją z tytułu albo domeny. Nazwa z og:title,
// adres z og:url — w źródle nie ma ich drugiej kopii. Przeglądarka nie
// wykonuje bloku danych, ale build i tak policzy jego skrót do CSP (jak
// każdego <script> bez src) — nieszkodliwe. „<” jako \u003c: napis
// „</script>” w nazwie zamknąłby blok i resztę wstawił jako HTML.
export const addStructuredData = (html) => {
  const title = ogMeta('og:title').exec(html);
  if (!title)
    throw new Error('index.html nie ma og:title — nie ma z czego wziąć nazwy witryny do danych strukturalnych.');
  const data = { '@context': 'https://schema.org', '@type': 'WebSite', name: unquote(title[2]), url: siteUrl(html) };
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  return afterOgUrl(html, `<script type=application/ld+json>${json}</script>`);
};

// Manifest aplikacji (instalacja na telefonie i komputerze). Ścieżki ikon
// przepisuje Parcel (@parcel/transformer-webmanifest); nazwę dopisujemy tu
// z og:title, jak w danych strukturalnych — w manifest.json nie ma jej kopii.
// Bez short_name: przeglądarka bierze wtedy name. Kolory tła i paska to --bg
// ciemnego motywu (style.css) — manifest nie ma wariantów jasny/ciemny.
export const completeManifest = (html, manifest) => {
  const title = ogMeta('og:title').exec(html);
  if (!title) throw new Error('index.html nie ma og:title — nie ma z czego wziąć nazwy aplikacji do manifestu.');
  const data = JSON.parse(manifest);
  if ('name' in data || 'short_name' in data) {
    throw new Error('manifest.json ma już name albo short_name — nazwę liczy build z og:title; usuń ją ze źródła.');
  }
  return `${JSON.stringify({ name: unquote(title[2]), ...data })}\n`;
};

// <link rel=manifest href=…> w zbudowanym HTML-u. Grupa 1: ścieżka.
const manifestLink = /(<link\b[^>]*\brel=["']?manifest["']?[^>]*\bhref=)["']?([^"'\s>]+)["']?/i;

// Parcel zapisuje manifest jako manifest.webmanifest, a nginx na serwerze
// (obraz nginx z grossnet-vps-iac) nie zna tego rozszerzenia i podaje plik
// jako application/octet-stream. Pod nazwą manifest.json idzie jako
// application/json, który specyfikacja dopuszcza — bez zmiany na serwerze.
const MANIFEST_FILE = 'manifest.json';

export const renameManifest = (html) => html.replace(manifestLink, (_, prefix) => `${prefix}/${MANIFEST_FILE}`);

// Bez lastmod: data buildu zmieniałaby się przy każdym przebudowaniu tego
// samego wydania, a Google ignoruje lastmod, który nie odpowiada zmianom treści.
export const sitemapXml = (html) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${siteUrl(html)}</loc></url>
</urlset>
`;

// Pusty Disallow: wolno wszystko. Wskazuje mapę strony wyszukiwarkom, które
// nie dostały jej przez Search Console.
export const robotsTxt = (html) => `User-agent: *
Disallow:

Sitemap: ${new URL('sitemap.xml', siteUrl(html)).href}
`;

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
  let html = readFileSync(indexFile, 'utf8');
  const manifest = manifestLink.exec(html);
  if (manifest) {
    const built = join(distDir, manifest[2]);
    writeFileSync(join(distDir, MANIFEST_FILE), completeManifest(html, readFileSync(built, 'utf8')));
    if (manifest[2] !== `/${MANIFEST_FILE}`) rmSync(built);
    html = renameManifest(html);
  }
  writeFileSync(indexFile, injectCsp(addStructuredData(addCanonical(absolutizeOgImage(html)))));
  writeFileSync(join(distDir, 'robots.txt'), robotsTxt(html));
  writeFileSync(join(distDir, 'sitemap.xml'), sitemapXml(html));
};

if (process.argv[1] === fileURLToPath(import.meta.url)) build(process.argv[2]);
