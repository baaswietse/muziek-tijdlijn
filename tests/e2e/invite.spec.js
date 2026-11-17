import { test, expect } from '@playwright/test';
import { openPhone, hostGame, joinGame, myId, openInvite, hashOf, NO_SUCH_ROOM } from './helpers.js';

// Binnenkomen via de uitnodigingslink (#/j/CODE) die achter de QR-code zit.

/** Speler `name` staat in de wachtkamer van `page`, met of zonder "offline". */
function lobbyRow(page, name) {
  return page.getByTestId('lobby-player').filter({ hasText: name });
}

test('gekende naam: via de link meteen in de wachtkamer, zonder iets in te vullen', async ({ browser }) => {
  const host = await openPhone(browser);
  const code = await hostGame(host, 'Hanne');

  const bob = await openPhone(browser, { name: 'Bob', hash: `#/j/${code}` });
  await expect(bob.getByTestId('big-code')).toHaveText(code);
  await expect(bob.getByTestId('waiting')).toBeVisible();
  await expect(bob.getByTestId('invite-name')).toHaveCount(0);
  await expect.poll(() => hashOf(bob)).toBe('');
  await expect(lobbyRow(host, 'Bob')).toBeVisible();
  await expect(host.getByTestId('lobby-player')).toHaveCount(2);

  // Herladen na het meedoen: dezelfde speler, geen tweede.
  const id = await myId(bob);
  await bob.reload();
  await expect(bob.getByTestId('big-code')).toHaveText(code);
  expect(await myId(bob)).toBe(id);
  await expect(host.getByTestId('lobby-player')).toHaveCount(2);
  for (const p of [host, bob]) await p.context().close();
});

test('geen naam: sober instapscherm met enkel een naamveld', async ({ browser }) => {
  const host = await openPhone(browser);
  const code = await hostGame(host, 'Hanne');

  const cas = await openPhone(browser, { hash: `#/j/${code}` });
  await expect(cas.getByTestId('invite-screen')).toContainText(`Je doet mee met spel ${code}`);
  await expect(cas.getByTestId('code-input')).toHaveCount(0);
  await expect(cas.getByRole('tab')).toHaveCount(0);
  await expect(cas.getByTestId('enter-button')).toHaveCount(0);

  // Leeg laten mag niet.
  await cas.getByTestId('invite-join').click();
  await expect(cas.getByTestId('toast')).toContainText('naam');

  // Een dubbele tik geeft geen twee pogingen (de tweede zou "naam al bezet" geven).
  // Twee klikken in één taak: de knop is dan nog niet uitgeschakeld.
  await cas.getByTestId('invite-name').fill('Cas');
  await cas.getByTestId('invite-join').evaluate((btn) => {
    btn.click();
    btn.click();
  });
  await expect(cas.getByTestId('big-code')).toHaveText(code);
  await expect(cas.getByTestId('waiting')).toBeVisible();
  await expect(host.getByTestId('lobby-player')).toHaveCount(2);
  await expect.poll(() => hashOf(cas)).toBe('');

  // Wie toch iets anders wil, kan naar het gewone startscherm; de code verdwijnt uit de adresbalk.
  const dirk = await openPhone(browser, { hash: `#/j/${code}` });
  await dirk.getByTestId('invite-cancel').click();
  await expect(dirk.getByRole('tab', { name: 'Nieuw spel' })).toBeVisible();
  await expect(dirk.getByTestId('code-input')).toHaveValue('');
  expect(await hashOf(dirk)).toBe('');
  await expect(host.getByTestId('lobby-player')).toHaveCount(2);
  for (const p of [host, cas, dirk]) await p.context().close();
});

test('gast in spel A opent de link van B: zit in B, A ziet hem offline', async ({ browser }) => {
  const hanne = await openPhone(browser);
  const a = await hostGame(hanne, 'Hanne');
  const bob = await openPhone(browser);
  await joinGame(bob, a, 'Bob');
  await expect(lobbyRow(hanne, 'Bob')).not.toContainText('offline');

  const dirk = await openPhone(browser);
  const b = await hostGame(dirk, 'Dirk');

  // Als nieuw geladen pagina, zoals na het scannen met de camera.
  await openInvite(bob, b, { fresh: true });
  await expect(bob.getByTestId('big-code')).toHaveText(b);
  await expect(bob.getByTestId('toast')).toContainText(`Je zat nog in spel ${a}. Je doet nu mee met ${b}.`);
  await expect.poll(() => hashOf(bob)).toBe('');
  await expect(lobbyRow(dirk, 'Bob')).toBeVisible();
  // De oude plaats blijft staan, maar offline.
  await expect(lobbyRow(hanne, 'Bob')).toContainText('offline');
  await expect(hanne.getByTestId('lobby-player')).toHaveCount(2);
  for (const p of [hanne, bob, dirk]) await p.context().close();
});

test('host van A opent de link van B: eerst de vraag, blijven en overstappen', async ({ browser }) => {
  const hanne = await openPhone(browser);
  const a = await hostGame(hanne, 'Hanne');
  const bob = await openPhone(browser);
  await joinGame(bob, a, 'Bob');
  const dirk = await openPhone(browser);
  const b = await hostGame(dirk, 'Dirk');

  // De link komt binnen terwijl het spel al open staat (hashchange).
  await openInvite(hanne, b);
  const ask = hanne.getByTestId('invite-confirm');
  await expect(ask).toContainText(`Je bent host van spel ${a}`);
  await expect(hanne.getByTestId('invite-step-over')).toHaveText(`Stap over naar ${b}`);
  await hanne.getByTestId('invite-stay').click();
  await expect(hanne.getByTestId('big-code')).toHaveText(a);
  await expect(hanne.getByTestId('start-game')).toBeVisible();
  expect(await hashOf(hanne)).toBe('');
  await expect(dirk.getByTestId('lobby-player')).toHaveCount(1);

  // Een oudere sessie weet niet of ze host is: dan wacht de app op de server en vraagt toch.
  await hanne.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('mt.session'));
    delete s.host;
    localStorage.setItem('mt.session', JSON.stringify(s));
  });
  await openInvite(hanne, b, { fresh: true });
  await expect(ask).toBeVisible();
  await hanne.getByTestId('invite-step-over').click();
  await expect(hanne.getByTestId('big-code')).toHaveText(b);
  await expect(hanne.getByTestId('waiting')).toBeVisible();
  await expect(hanne.getByTestId('toast')).toContainText(`Je zat nog in spel ${a}`);
  await expect(lobbyRow(dirk, 'Hanne')).toBeVisible();
  await expect(lobbyRow(bob, 'Hanne')).toContainText('offline');
  for (const p of [hanne, bob, dirk]) await p.context().close();
});

test('link naar een onbestaand spel: met sessie blijf je, zonder kom je op het startscherm', async ({ browser }) => {
  const hanne = await openPhone(browser);
  const a = await hostGame(hanne, 'Hanne');
  const bob = await openPhone(browser);
  await joinGame(bob, a, 'Bob');

  await openInvite(bob, NO_SUCH_ROOM);
  await expect(bob.getByTestId('toast')).toContainText('bestaat niet');
  await expect(bob.getByTestId('big-code')).toHaveText(a);
  await expect.poll(() => hashOf(bob)).toBe('');
  await expect(lobbyRow(hanne, 'Bob')).not.toContainText('offline');

  // Zonder sessie, met gekende naam: meteen geprobeerd, dan het gewone startscherm.
  const cas = await openPhone(browser, { name: 'Cas', hash: `#/j/${NO_SUCH_ROOM}` });
  await expect(cas.getByTestId('toast')).toContainText('bestaat niet');
  await expect(cas.getByRole('tab', { name: 'Nieuw spel' })).toBeVisible();
  await expect(cas.getByTestId('code-input')).toHaveValue('');
  await expect.poll(() => hashOf(cas)).toBe('');
  // Herladen probeert het niet opnieuw.
  await cas.reload();
  await expect(cas.getByTestId('enter-button')).toBeVisible();
  await expect(cas.getByTestId('toast')).toHaveCount(0);

  // Zonder sessie en zonder naam: na het instapscherm hetzelfde.
  const dirk = await openPhone(browser, { hash: `#/j/${NO_SUCH_ROOM}` });
  await dirk.getByTestId('invite-name').fill('Dirk');
  await dirk.getByTestId('invite-join').click();
  await expect(dirk.getByTestId('toast')).toContainText('bestaat niet');
  await expect(dirk.getByRole('tab', { name: 'Nieuw spel' })).toBeVisible();
  for (const p of [hanne, bob, cas, dirk]) await p.context().close();
});

test('link naar je eigen spel: geen tweede speler', async ({ browser }) => {
  const hanne = await openPhone(browser);
  const a = await hostGame(hanne, 'Hanne');
  const bob = await openPhone(browser);
  await joinGame(bob, a, 'Bob');
  const ids = await Promise.all([hanne, bob].map(myId));

  await openInvite(bob, a);
  await expect.poll(() => hashOf(bob)).toBe('');
  await openInvite(hanne, a, { fresh: true });
  await expect(hanne.getByTestId('big-code')).toHaveText(a);
  await expect(hanne.getByTestId('start-game')).toBeVisible();
  await expect.poll(() => hashOf(hanne)).toBe('');
  await expect(hanne.getByTestId('invite-confirm')).toHaveCount(0);

  await expect(bob.getByTestId('big-code')).toHaveText(a);
  expect(await Promise.all([hanne, bob].map(myId))).toEqual(ids);
  for (const p of [hanne, bob]) await expect(p.getByTestId('lobby-player')).toHaveCount(2);
  for (const p of [hanne, bob]) await p.context().close();
});

test('naam al bezet in het nieuwe spel: een andere naam kiezen lukt', async ({ browser }) => {
  const host = await openPhone(browser);
  const code = await hostGame(host, 'Hanne');

  // Deze gsm kent de naam Hanne ook: meedoen faalt, het instapscherm toont de melding.
  const other = await openPhone(browser, { name: 'hanne', hash: `#/j/${code}` });
  await expect(other.getByTestId('invite-error')).toContainText('al bezet');
  await expect(other.getByTestId('invite-name')).toHaveValue('hanne');
  await other.getByTestId('invite-name').fill('Hanne B');
  await other.getByTestId('invite-join').click();
  await expect(other.getByTestId('big-code')).toHaveText(code);
  await expect(lobbyRow(host, 'Hanne B')).toBeVisible();
  await expect(host.getByTestId('lobby-player')).toHaveCount(2);

  // Ook vanuit een ander spel: de oude sessie blijft tot het meedoen lukt.
  const dirk = await openPhone(browser);
  const b = await hostGame(dirk, 'Dirk');
  const bob = await openPhone(browser);
  await joinGame(bob, b, 'Hanne B');
  await openInvite(bob, code);
  await expect(bob.getByTestId('invite-error')).toContainText('al bezet');
  await expect(bob.getByTestId('invite-cancel')).toHaveText(`Terug naar spel ${b}`);
  expect(await bob.evaluate(() => JSON.parse(localStorage.getItem('mt.session')).code)).toBe(b);
  await bob.getByTestId('invite-name').fill('Bob');
  await bob.getByTestId('invite-join').click();
  await expect(bob.getByTestId('big-code')).toHaveText(code);
  await expect(bob.getByTestId('toast')).toContainText(`Je zat nog in spel ${b}`);
  for (const p of [host, other, dirk, bob]) await p.context().close();
});

test('server onbereikbaar: het instapscherm toont de melding en opnieuw proberen is één tik', async ({ browser }) => {
  const host = await openPhone(browser);
  const code = await hostGame(host, 'Hanne');

  const cas = await openPhone(browser);
  await cas.context().setOffline(true);
  await openInvite(cas, code);
  await cas.getByTestId('invite-name').fill('Cas');
  await cas.getByTestId('invite-join').click();
  await expect(cas.getByTestId('invite-error')).toContainText('niet bereikbaar');

  await cas.context().setOffline(false);
  await cas.getByTestId('invite-join').click();
  await expect(cas.getByTestId('big-code')).toHaveText(code);
  await expect(host.getByTestId('lobby-player')).toHaveCount(2);
  for (const p of [host, cas]) await p.context().close();
});
