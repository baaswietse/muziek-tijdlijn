import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  openPhone,
  hostGame,
  setupMusic,
  joinGame,
  setTarget,
  myId,
  playCount,
  lastPlayed,
  countOf,
  activeYears,
  correctSlot,
  wrongSlot,
  placeCard,
  placeToken,
  passWaiting,
  othersHaveTokens,
  expectFullyVisible,
  openStand,
  YEAR,
} from './helpers.js';

// Het eindscherm: het overzicht (winnaar, eindstand, cijfers per speler,
// prijzen, duur) en «Deel het resultaat».

const tokenButton = (page, id) => page.locator(`[data-testid="token-button"][data-player="${id}"]`);

/** De PNG-kop: handtekening en de afmetingen uit het IHDR-blok. */
function pngInfo(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const isPng = sig.every((b, i) => buf[i] === b) && buf.toString('ascii', 12, 16) === 'IHDR';
  return { isPng, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
}

/** Tekent een PNG in de browser en telt hoeveel verschillende kleuren er in staan (leeg = 1). */
async function pngColors(page, b64) {
  return page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    const colors = new Set();
    let dark = 0;
    for (let i = 0; i < px.length; i += 4 * 7) {
      colors.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
      if (px[i] + px[i + 1] + px[i + 2] < 150) dark++;
    }
    return { colors: colors.size, dark };
  }, b64);
}

/** Wat het overzicht op een gsm toont, zonder wat per gsm verschilt ("jij"). */
async function summaryData(page) {
  const s = page.getByTestId('summary');
  await expect(s).toBeVisible();
  const rows = await s.getByTestId('summary-row').evaluateAll((els) => els.map((el) => ({ ...el.dataset })));
  const prizes = await s.getByTestId('summary-prize').evaluateAll((els) => els.map((el) => ({ ...el.dataset })));
  const meta = await s.getByTestId('summary-meta').evaluate((el) => ({ ...el.dataset, text: el.textContent }));
  const winners = await s.getByTestId('summary-winner').getAttribute('data-winners');
  return { rows, prizes, meta, winners, complete: await s.getAttribute('data-complete') };
}

/** De laatste stand die de server naar deze gsm stuurde. */
function lastState(page) {
  for (let i = page.frames_.length - 1; i >= 0; i--) {
    const msg = JSON.parse(page.frames_[i]);
    if (msg.t === 'state') return msg.state;
  }
  return null;
}

async function threePhones(browser, target) {
  const host = await openPhone(browser);
  const code = await hostGame(host, 'Hanne');
  await setupMusic(host);
  const bob = await openPhone(browser);
  await joinGame(bob, code, 'Bob');
  const cas = await openPhone(browser);
  await joinGame(cas, code, 'Cas');
  const pages = [host, bob, cas];
  for (const p of pages) await expect(p.getByTestId('lobby-player')).toHaveCount(3);
  await setTarget(host, target);
  const ids = await Promise.all(pages.map(myId));
  return { host, bob, cas, pages, ids, code };
}

test('eindscherm: een kort spel met drie gsm\'s, het overzicht is overal hetzelfde en juist; delen; nog een spel', async ({ browser }) => {
  const { host, pages, ids, code } = await threePhones(browser, 4);
  await host.getByTestId('start-game').click();
  for (const p of pages) await expect(p.getByTestId('turn-banner')).toBeVisible();

  // Wat de test zelf bijhoudt, om het overzicht mee te vergelijken.
  const exp = Object.fromEntries(ids.map((id) => [id, { placed: 0, correct: 0, streak: 0, best: 0, guessed: 0, won: 0, lost: 0, tokens: 2 }]));
  // Per beurt: fout leggen of niet, wie inzet (en waar), en wie het raad-token krijgt.
  // Beurt 1: fout, de volgende speler zet juist in. Beurt 2: juist, iemand zet fout in.
  const plan = [
    { wrong: true, bet: 'correct' },
    { bet: 'other' },
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
  ];
  let plays = 0;
  let turns = 0;
  let finished = false;
  for (const step of plan) {
    const banner = host.getByTestId('turn-banner');
    await expect(banner).toBeVisible();
    const activeId = await banner.getAttribute('data-active');
    const ai = ids.indexOf(activeId);
    const activePage = pages[ai];
    await expect.poll(() => playCount(host)).toBe(plays + 1);
    plays++;
    const year = YEAR.get(await lastPlayed(host));
    const years = await activeYears(activePage);
    const good = correctSlot(years, year);
    const bad = wrongSlot(years, year);
    const slot = step.wrong && bad !== null ? bad : good;
    await placeCard(activePage, slot);
    // Tot de onthulling verandert er aan de cijfers niets (geen extra info over het nummer).
    const statsBefore = JSON.stringify(lastState(pages[(ai + 1) % 3]).players.map((p) => p.stats));
    await activePage.getByTestId('confirm-place').click();
    let bettor = null;
    if (await othersHaveTokens(host, activeId)) {
      if (step.bet) {
        bettor = ids[(ai + 1) % 3];
        const bp = pages[ids.indexOf(bettor)];
        await expect(bp.getByTestId('challenge-banner')).toHaveAttribute('data-can-bet', 'yes');
        // Juist inzetten: de juiste plaats als die vrij is; anders een andere vrije plaats.
        const free = [...Array(years.length + 1).keys()].filter((i) => i !== slot);
        const want = step.bet === 'correct' && good !== slot ? good : free.find((i) => i !== good) ?? free[0];
        await placeToken(bp, want);
        await bp.getByTestId('confirm-bet').click();
        await expect(host.locator(`[data-testid="bet-mark"][data-player="${bettor}"]`)).toBeVisible();
        exp[bettor].tokens -= 1;
      }
      expect(JSON.stringify(lastState(pages[(ai + 1) % 3]).players.map((p) => p.stats))).toBe(statsBefore);
      await passWaiting(pages, activePage);
      await activePage.getByTestId('reveal-now').click();
    }
    const reveal = host.getByTestId('reveal');
    await expect(reveal).toBeVisible();
    const correct = (await reveal.getAttribute('data-correct')) === 'yes';
    turns++;
    const e = exp[activeId];
    e.placed++;
    if (correct) {
      e.correct++;
      e.streak++;
      e.best = Math.max(e.best, e.streak);
    } else e.streak = 0;
    if (bettor) {
      const to = correct ? activeId : await host.getByTestId('reveal-card-to').getAttribute('data-player');
      if (to === bettor) exp[bettor].won++;
      else exp[bettor].lost++;
    }
    // Het raad-token: altijd voor Cas behalve in beurt 3 en 4 (dan de speler aan beurt).
    const guesser = turns === 3 || turns === 4 ? activeId : ids[2];
    await tokenButton(activePage, guesser).click();
    await expect(tokenButton(activePage, guesser)).toHaveAttribute('aria-pressed', 'true');
    exp[guesser].guessed++;
    exp[guesser].tokens++;
    if (await host.getByTestId('winner').isVisible()) {
      finished = true;
      break;
    }
    await activePage.getByTestId('next-turn').click();
    await expect(host.getByTestId('reveal')).toHaveCount(0);
  }
  expect(finished).toBe(true);
  const winner = await host.getByTestId('winner').getAttribute('data-winners');

  // Het overzicht: bij iedereen hetzelfde.
  const data = await Promise.all(pages.map(summaryData));
  for (const d of data.slice(1)) expect(d).toEqual(data[0]);
  const d = data[0];
  expect(d.complete).toBe('yes');
  expect(d.winners).toBe(winner);
  expect(d.rows[0].player).toBe(winner);
  expect(d.rows[0].rank).toBe('1');
  expect(Number(d.meta.turns)).toBe(turns);
  expect(Number(d.meta.ms)).toBeGreaterThan(0);
  expect(d.meta.text).toContain(`${turns} beurten`);
  expect(d.meta.text).toContain('naar 4 kaarten');
  // En juist: wat de test bijhield, en de kaarten zoals op het bord.
  for (const row of d.rows) {
    const e = exp[row.player];
    expect(Number(row.cards)).toBe(await countOf(pages[0], row.player));
    expect({
      placed: Number(row.placed),
      correct: Number(row.correct),
      streak: Number(row.streak),
      guessed: Number(row.guessed),
      won: Number(row.betsWon),
      lost: Number(row.betsLost),
      tokens: Number(row.tokens),
      bought: Number(row.bought),
    }).toEqual({ placed: e.placed, correct: e.correct, streak: e.best, guessed: e.guessed, won: e.won, lost: e.lost, tokens: e.tokens, bought: 0 });
  }
  // De volgorde: winnaar, dan meeste kaarten, dan meeste tokens.
  const order = d.rows.map((r) => [Number(r.cards), Number(r.tokens)]);
  for (let i = 2; i < order.length; i++) {
    expect(order[i - 1][0] > order[i][0] || (order[i - 1][0] === order[i][0] && order[i - 1][1] >= order[i][1])).toBe(true);
  }
  // Cas raadde het vaakst (de andere beurten): de prijs «Beste rader» is voor hem alleen.
  const guessPrize = d.prizes.find((p) => p.prize === 'guess');
  expect(guessPrize?.players).toBe(ids[2]);
  // Geen prijs onder haar minimum, en nergens een willekeurige winnaar bij gelijke stand.
  for (const p of d.prizes) expect(p.players.split(',').length).toBeLessThanOrEqual(2);

  // De winnaar ziet «Jij wint!», de anderen de naam; elke tijdlijn blijft te bekijken.
  const winnerPage = pages[ids.indexOf(winner)];
  await expect(winnerPage.getByTestId('summary-winner')).toContainText('Jij wint!');
  const other = pages.find((p) => p !== winnerPage);
  const winnerName = ['Hanne', 'Bob', 'Cas'][ids.indexOf(winner)];
  await expect(other.getByTestId('summary-winner')).toContainText(`${winnerName} wint!`);
  await other.getByTestId('summary-open').click();
  await expect(other.getByTestId('outcome-sheet')).toHaveAttribute('data-open', 'no');
  await expect(other.getByTestId('summary')).toBeInViewport();
  // Een tik op een naam in de eindstand toont die tijdlijn; via «Stand» ook.
  const otherId = await myId(other);
  const third = ids.find((id) => id !== winner && id !== otherId);
  await other.locator(`[data-testid="summary-row"][data-player="${third}"] button`).click();
  await expect(other.getByTestId('timeline-section')).toHaveAttribute('data-player', third);
  await expect(other.getByTestId('timeline-section')).toBeInViewport();
  await openStand(other);
  await other.locator(`[data-testid="board-row"][data-player="${winner}"] .board-head`).click();
  await expect(other.getByTestId('timeline-section')).toHaveAttribute('data-player', winner);

  // Delen zonder deelmenu: een download met de PNG.
  const [hostPage, bob, cas] = pages;
  // Eerst het paneel met de uitkomst inklappen («Bekijk het overzicht»), zoals een speler doet.
  for (const p of [bob, cas]) {
    if ((await p.getByTestId('outcome-sheet').getAttribute('data-open')) === 'yes') await p.getByTestId('summary-open').click();
  }
  await bob.evaluate(() => {
    delete Navigator.prototype.share;
    delete Navigator.prototype.canShare;
  });
  const [download] = await Promise.all([bob.waitForEvent('download'), bob.getByTestId('share-result').click()]);
  expect(download.suggestedFilename()).toBe('muziek-tijdlijn-uitslag.png');
  const buf = readFileSync(await download.path());
  const info = pngInfo(buf);
  expect(info.isPng).toBe(true);
  expect(info.width).toBe(1080);
  expect(info.height).toBeGreaterThan(900);
  expect(info.height).toBeLessThan(2400);
  expect(info.bytes).toBeGreaterThan(15_000);
  const look = await pngColors(bob, buf.toString('base64'));
  expect(look.colors).toBeGreaterThan(40);
  expect(look.dark).toBeGreaterThan(200);
  await expect(bob.getByTestId('share-status')).toHaveAttribute('data-status', 'downloaded');
  if (process.env.MT_SHOT_DIR) await download.saveAs(`${process.env.MT_SHOT_DIR}/deel-3-spelers.png`);

  // Delen met deelmenu: het bestand gaat naar navigator.share, er komt geen download.
  await cas.evaluate(() => {
    window.__shared = [];
    Navigator.prototype.canShare = (d) => Array.isArray(d?.files) && d.files.length > 0;
    Navigator.prototype.share = async (d) => {
      const f = d.files[0];
      const bytes = new Uint8Array(await f.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      window.__shared.push({ name: f.name, type: f.type, title: d.title, text: d.text ?? '', b64: btoa(bin) });
    };
  });
  let downloads = 0;
  cas.on('download', () => downloads++);
  await cas.getByTestId('share-result').click();
  await expect(cas.getByTestId('share-status')).toHaveAttribute('data-status', 'shared');
  const shared = await cas.evaluate(() => window.__shared);
  expect(shared).toHaveLength(1);
  expect(shared[0]).toMatchObject({ name: 'muziek-tijdlijn-uitslag.png', type: 'image/png', title: 'Muziek-tijdlijn' });
  const sbuf = Buffer.from(shared[0].b64, 'base64');
  const sinfo = pngInfo(sbuf);
  expect(sinfo).toMatchObject({ isPng: true, width: 1080 });
  expect(sinfo.height).toBe(info.height);
  expect((await pngColors(cas, shared[0].b64)).colors).toBeGreaterThan(40);
  // Geen spelcode in wat gedeeld wordt (ook niet als tekst bij de afbeelding).
  expect(shared[0].title + shared[0].text).not.toContain(code);
  expect(downloads).toBe(0);
  // Zelf weggetikt (AbortError): geen download, geen melding.
  await cas.evaluate(() => {
    Navigator.prototype.share = async () => {
      throw new DOMException('weg', 'AbortError');
    };
  });
  await cas.getByTestId('share-result').click();
  await expect(cas.getByTestId('share-result')).toBeEnabled();
  expect(downloads).toBe(0);

  // De vertrouwde knoppen blijven: host «Nog een spel» en «Terug naar de wachtkamer», gast «Verlaat het spel».
  await expect(hostPage.getByTestId('to-lobby')).toHaveCount(1);
  await expect(bob.getByTestId('play-again')).toHaveCount(0);

  // «Nog een spel»: lege tellers bij iedereen, en geen overzicht meer.
  await hostPage.getByTestId('play-again').click();
  for (const p of pages) {
    await expect(p.getByTestId('turn-banner')).toBeVisible();
    await expect(p.getByTestId('summary')).toHaveCount(0);
    await expect.poll(() => lastState(p)?.phase).toBe('playing');
    const st = lastState(p);
    expect(st.summary).toEqual({ turns: 0, ms: null });
    for (const pl of st.players) {
      expect(pl.stats).toEqual({ placed: 0, correct: 0, bestStreak: 0, guessed: 0, betsWon: 0, betsLost: 0, bought: 0 });
    }
  }
  for (const p of pages) await p.context().close();
});

test('eindscherm op 320 px met grotere letters en vreemde namen: alles in beeld, niets onder de balk', async ({ browser }) => {
  const big = async (page) => {
    await page.context().addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = 'html, body, button, input, select { font-size: 21px; }';
        document.head.append(style);
      });
    });
    await page.reload();
  };
  const host = await openPhone(browser, { viewport: { width: 320, height: 640 } });
  await big(host);
  const code = await hostGame(host, 'WWWWWWWWWWWWWWWW');
  await setupMusic(host);
  const bob = await openPhone(browser, { viewport: { width: 320, height: 640 } });
  await big(bob);
  await joinGame(bob, code, '🎸🎸 Rocker 🎸🎸');
  await setTarget(host, 3);
  const pages = [host, bob];
  const ids = await Promise.all(pages.map(myId));
  await host.getByTestId('start-game').click();
  let plays = 0;
  for (let k = 0; k < 12; k++) {
    const activeId = await host.getByTestId('turn-banner').getAttribute('data-active');
    const p = pages[ids.indexOf(activeId)];
    await expect.poll(() => playCount(host)).toBe(++plays);
    const year = YEAR.get(await lastPlayed(host));
    await placeCard(p, correctSlot(await activeYears(p), year));
    await p.getByTestId('confirm-place').click();
    if (await othersHaveTokens(host, activeId)) {
      await passWaiting(pages, p);
      await p.getByTestId('reveal-now').click();
    }
    await expect(host.getByTestId('reveal')).toBeVisible();
    // Elke beurt raadt de speler aan beurt zelf: zo komen er prijzen en cijfers.
    await tokenButton(p, activeId).click();
    if (await host.getByTestId('winner').isVisible()) break;
    await p.getByTestId('next-turn').click();
    await expect(host.getByTestId('reveal')).toHaveCount(0);
  }
  for (const page of pages) {
    await expect(page.getByTestId('summary')).toBeVisible();
    await page.getByTestId('summary-open').click();
    await expect(page.getByTestId('outcome-sheet')).toHaveAttribute('data-open', 'no');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const parts = ['summary-winner', 'summary-meta', 'summary-list', 'share-result'];
    if (await page.getByTestId('summary-prizes').count()) parts.push('summary-prizes');
    for (const id of parts) {
      const el = page.getByTestId(id);
      await el.scrollIntoViewIfNeeded();
      await expectFullyVisible(el);
    }
    // Elke rij en de deelknop: midden in beeld ligt er niets over (bovenbalk, paneel, zwevende balk).
    const targets = [...(await page.getByTestId('summary-row').all()).map((r) => r.locator('button')), page.getByTestId('share-result')];
    for (const el of targets) {
      await el.evaluate((node) => node.scrollIntoView({ block: 'center' }));
      const onTop = await el.evaluate((node) => {
        const r = node.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return node === hit || node.contains(hit);
      });
      expect(onTop, 'ligt onder iets anders').toBe(true);
    }
    // Ook helemaal onderaan gescrold ligt de deelknop boven de zwevende balk (of het ingeklapte paneel).
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const share = await page.getByTestId('share-result').boundingBox();
    const floorY = await page.evaluate(() =>
      Math.min(
        window.innerHeight,
        ...[...document.querySelectorAll('[data-testid="action-bar"], [data-testid="outcome-sheet"]')].map((el) => el.getBoundingClientRect().top),
      ),
    );
    expect(share.y + share.height, 'deelknop onder de balk').toBeLessThanOrEqual(floorY + 1);
    // Lange of vreemde namen lopen niet buiten hun rij.
    for (const row of await page.getByTestId('summary-row').all()) {
      const box = await row.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(321);
    }
  }
  // De host kan meteen opnieuw: «Nog een spel» staat in de zwevende balk, in beeld.
  await expectFullyVisible(host.getByTestId('play-again'));
  for (const p of pages) await p.context().close();
});
