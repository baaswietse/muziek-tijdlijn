import { test, expect } from '@playwright/test';

// Installeren als app: het manifest, de iconen en de meta's voor iOS. Alles
// wordt via de site zelf opgehaald, zodat dit ook met MT_LIVE=1 werkt.

// De volledige Chromium in plaats van de lichte headless-versie: alleen die
// kijkt na of de site installeerbaar is (Page.getInstallabilityErrors).
test.use({ channel: 'chromium' });

/** Breedte, hoogte en kleurtype uit de kop van een PNG (of null als het geen PNG is). */
function pngInfo(buf) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 26 || signature.some((b, i) => buf[i] !== b)) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

async function fetchPng(page, url) {
  const res = await page.request.get(url);
  expect(res.ok(), url).toBe(true);
  const info = pngInfo(await res.body());
  expect(info, `${url} is geen PNG`).not.toBeNull();
  return info;
}

test('manifest, iconen en iOS-meta: de site is als app te installeren', async ({ page }) => {
  await page.goto('./');
  const base = new URL('./', page.url()).href;

  // Het manifest: geldige JSON, standalone, start en scope binnen het basispad.
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifestUrl = new URL(href, page.url()).href;
  expect(manifestUrl.startsWith(base)).toBe(true);
  const res = await page.request.get(manifestUrl);
  expect(res.ok()).toBe(true);
  const manifest = JSON.parse(await res.text());
  expect(manifest.name).toBe('Muziek-tijdlijn');
  expect(manifest.short_name).toBeTruthy();
  expect(manifest.display).toBe('standalone');
  const startUrl = new URL(manifest.start_url, manifestUrl);
  const scope = new URL(manifest.scope, manifestUrl).href;
  expect(scope.startsWith(base)).toBe(true);
  expect(startUrl.href.startsWith(scope)).toBe(true);
  // Geen uitnodigingscode of testmodus in de startpagina.
  expect(startUrl.search).toBe('');
  expect(startUrl.hash).toBe('');

  // Elk icoon bestaat, is een PNG en heeft de opgegeven afmetingen.
  expect(manifest.icons.length).toBeGreaterThan(0);
  for (const icon of manifest.icons) {
    const info = await fetchPng(page, new URL(icon.src, manifestUrl).href);
    expect(icon.type).toBe('image/png');
    expect(`${info.width}x${info.height}`, icon.src).toBe(icon.sizes);
  }
  const purposes = manifest.icons.map((i) => i.purpose || 'any');
  expect(purposes).toContain('maskable');
  expect(manifest.icons.some((i) => (i.purpose || 'any') === 'any' && i.sizes === '512x512')).toBe(true);

  // Het icoon voor iOS: 180×180 en zonder doorzichtigheid (kleurtype 2 = RGB).
  const appleHref = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  const apple = await fetchPng(page, new URL(appleHref, page.url()).href);
  expect(apple).toEqual({ width: 180, height: 180, colorType: 2 });

  // iOS: op volledig scherm openen, ook op oudere versies, met een eigen titel.
  const meta = (name) => page.locator(`meta[name="${name}"]`);
  await expect(meta('apple-mobile-web-app-capable')).toHaveAttribute('content', 'yes');
  await expect(meta('mobile-web-app-capable')).toHaveAttribute('content', 'yes');
  await expect(meta('apple-mobile-web-app-title')).toHaveAttribute('content', /\S/);
  await expect(meta('apple-mobile-web-app-status-bar-style')).toHaveAttribute('content', /\S/);
  await expect(meta('robots')).toHaveAttribute('content', 'noindex');

  // Wat Chromium zelf vindt. "in-incognito" telt niet: elke Playwright-context
  // is een incognitovenster. Een service worker is niet nodig: Chromium meldt
  // er geen fout over.
  const cdp = await page.context().newCDPSession(page);
  await expect
    .poll(async () => {
      const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
      return installabilityErrors.map((e) => e.errorId).filter((id) => id !== 'in-incognito');
    })
    .toEqual([]);
  const { appId } = await cdp.send('Page.getAppId');
  expect(appId.startsWith(base)).toBe(true);
});
