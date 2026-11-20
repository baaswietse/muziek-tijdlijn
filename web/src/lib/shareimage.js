// De gedeelde afbeelding van het eindscherm: zelf getekend op een canvas (geen
// externe dienst of bibliotheek) en als PNG gedeeld via het deelmenu van het
// toestel, of anders aangeboden als download. Er staat bewust geen spelcode op,
// niets waarmee iemand het spel kan binnenkomen: alleen de naam van het spel,
// de winnaar, de eindstand, de prijzen en hoe lang het duurde.

import { metaLine, winnerTitle, plural } from './summary.js';

export const IMAGE_WIDTH = 1080;
export const FILE_NAME = 'muziek-tijdlijn-uitslag.png';

// Altijd de lichte kleuren van het spel (warm papier, inkt, groen en amber):
// een gedeelde afbeelding moet overal hetzelfde ogen.
const C = {
  bg: '#f4efe6',
  surface: '#fffdf8',
  sunken: '#ebe4d6',
  ink: '#1f1d2b',
  muted: '#676273',
  line: '#d9d1c1',
  accent: '#0e7c66',
  accentInk: '#ffffff',
  accentSoft: '#d9efe8',
  amber: '#f2b33d',
  amberSoft: '#fdf0cf',
  amberInk: '#3b2a02',
};
const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";

const PAD = 56; // rand rond de kaart
const IN = 64; // binnenrand van de kaart
const ROW = 92; // hoogte van een rij in de eindstand
const PRIZE_ROW = 90;

/** Tekens zoals een mens ze telt (een emoji is er één), voor het inkorten. */
function graphemes(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return Array.from(new Intl.Segmenter('nl', { granularity: 'grapheme' }).segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/** Zet de letter en verkleint ze (tot `min`) tot de tekst in `width` past. */
function fitFont(ctx, text, { weight = 400, size, min = size, family = SANS, width }) {
  let s = size;
  for (; s > min; s -= 2) {
    ctx.font = `${weight} ${s}px ${family}`;
    if (ctx.measureText(text).width <= width) return s;
  }
  ctx.font = `${weight} ${min}px ${family}`;
  return min;
}

/** Kort de tekst in met "…" tot ze in `width` past (in de letter die nu gezet is). */
function ellipsize(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  const g = graphemes(text);
  while (g.length > 1 && ctx.measureText(`${g.join('').trimEnd()}…`).width > width) g.pop();
  return `${g.join('').trimEnd()}…`;
}

/** Verdeelt tekst over hoogstens `max` regels van `width` breed (de laatste ingekort). */
function wrap(ctx, text, width, max) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > max) {
    const rest = lines.slice(max - 1).join(' ');
    lines.length = max - 1;
    lines.push(rest);
  }
  return lines.map((l) => ellipsize(ctx, l, width));
}

/**
 * Namen naast elkaar ("A & B") in `width`: is het te lang, dan wordt elke naam
 * apart ingekort, zodat een gedeelde prijs nooit een naam verliest.
 */
function fitNames(ctx, names, width) {
  const all = names.join(' & ');
  if (ctx.measureText(all).width <= width || names.length < 2) return ellipsize(ctx, all, width);
  const each = (width - ctx.measureText(' & ').width * (names.length - 1)) / names.length;
  return names.map((n) => ellipsize(ctx, n, each)).join(' & ');
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Het merkteken van het spel: een groene meetlat met een amber en een groene stip. */
function brandMark(ctx, x, y, h) {
  ctx.fillStyle = C.accent;
  ctx.fillRect(x, y, 6, h);
  for (const [dy, color] of [
    [h * 0.25, C.amber],
    [h * 0.75, C.accent],
  ]) {
    ctx.beginPath();
    ctx.arc(x + 3, y + dy, 9, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

/** Een token: een amber muntje met een rand. */
function coin(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = C.amber;
  ctx.fill();
  ctx.lineWidth = Math.max(2, r / 5);
  ctx.strokeStyle = '#c98a14';
  ctx.stroke();
}

/** Een eenvoudige ster voor de prijzen. */
function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx[i ? 'lineTo' : 'moveTo'](x + rr * Math.cos(a), y + rr * Math.sin(a));
  }
  ctx.closePath();
  ctx.fillStyle = C.amber;
  ctx.fill();
}

/** De regels van de winnaar(s) in het groene blok. */
function winnerLines(ctx, s, width) {
  const names = s.winners.map((w) => w.name);
  const label = names.length > 1 ? 'Gelijkspel' : names.length ? 'Winnaar' : 'Spel afgelopen';
  let size = 0;
  let lines = [];
  if (names.length >= 2 && names.length <= 3) {
    // Gelijkspel: elke naam op een eigen regel ("Ann &", "Bob").
    const parts = names.map((n, i) => (i < names.length - 1 ? `${n} &` : n));
    const longest = parts.reduce((a, b) => (ctx.measureText(a).width >= ctx.measureText(b).width ? a : b));
    size = fitFont(ctx, longest, { weight: 700, size: 80, min: 52, family: SERIF, width });
    lines = parts.map((l) => ellipsize(ctx, l, width));
  } else if (names.length) {
    const text = names.join(' & ');
    size = fitFont(ctx, text, { weight: 700, size: 92, min: 52, family: SERIF, width });
    lines = wrap(ctx, text, width, 3);
  }
  const sub = names.length
    ? `${names.length > 1 ? 'elk ' : 'met '}${plural(s.winners[0].cards, 'kaart', 'kaarten')}`
    : '';
  return { label, lines, size, sub };
}

/** Rekent uit hoe hoog de afbeelding wordt (de breedte ligt vast). */
function measure(ctx, s) {
  const inner = IMAGE_WIDTH - 2 * PAD - 2 * IN;
  const w = winnerLines(ctx, s, inner - 64);
  const winnerH = 56 + 40 + w.lines.length * w.size * 1.12 + (w.sub ? 56 : 0) + 40;
  const standH = 64 + s.standings.length * ROW;
  const prizesH = s.prizes.length ? 48 + 64 + s.prizes.length * PRIZE_ROW : 0;
  const top = PAD + 56 + 70 + 40; // merk en naam van het spel
  const footer = 56 + 20;
  return { inner, w, winnerH, standH, prizesH, top, height: Math.ceil(top + winnerH + 48 + standH + prizesH + footer + PAD + IN) };
}

/**
 * Tekent het overzicht `s` (uit buildSummary) op een canvas en geeft de hoogte
 * terug. Het canvas krijgt breedte IMAGE_WIDTH en de nodige hoogte.
 */
export function drawSummary(canvas, s) {
  const ctx = canvas.getContext('2d');
  const m = measure(ctx, s);
  canvas.width = IMAGE_WIDTH;
  canvas.height = m.height;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // De kaart.
  roundRect(ctx, PAD, PAD, IMAGE_WIDTH - 2 * PAD, m.height - 2 * PAD, 40);
  ctx.fillStyle = C.surface;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = C.line;
  ctx.stroke();

  const x0 = PAD + IN;
  const right = IMAGE_WIDTH - PAD - IN;
  let y = PAD + 56;

  // Merk en naam van het spel.
  brandMark(ctx, x0 + 6, y, 64);
  ctx.fillStyle = C.ink;
  ctx.font = `700 52px ${SERIF}`;
  ctx.fillText('Muziek-tijdlijn', x0 + 40, y + 50);
  ctx.textAlign = 'right';
  ctx.fillStyle = C.muted;
  ctx.font = `600 28px ${SANS}`;
  ctx.fillText('Eindstand', right, y + 46);
  ctx.textAlign = 'left';
  y += 70 + 40;

  // De winnaar: een groen blok, feestelijk maar sober.
  const w = m.w;
  roundRect(ctx, x0, y, m.inner, m.winnerH, 28);
  ctx.fillStyle = C.accent;
  ctx.fill();
  // Een rij stippen als maatstreepjes, zoals op de tijdlijn.
  ctx.fillStyle = 'rgb(255 255 255 / 18%)';
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.arc(x0 + m.inner - 40 - i * 34, y + 40, i % 4 === 0 ? 7 : 4, 0, Math.PI * 2);
    ctx.fill();
  }
  let wy = y + 56;
  ctx.fillStyle = C.amber;
  ctx.font = `700 28px ${SANS}`;
  ctx.fillText(w.label.toUpperCase().split('').join(String.fromCharCode(8202)), x0 + 32, wy);
  wy += 40;
  ctx.fillStyle = C.accentInk;
  ctx.font = `700 ${w.size}px ${SERIF}`;
  for (const line of w.lines) {
    wy += w.size;
    ctx.fillText(line, x0 + 32, wy);
    wy += w.size * 0.12;
  }
  if (w.sub) {
    ctx.font = `500 32px ${SANS}`;
    ctx.fillStyle = 'rgb(255 255 255 / 88%)';
    ctx.fillText(w.sub, x0 + 32, wy + 48);
  }
  y += m.winnerH + 48;

  // De eindstand: een verticale meetlat met per speler een stip.
  ctx.fillStyle = C.muted;
  ctx.font = `700 24px ${SANS}`;
  ctx.fillText('EINDSTAND', x0, y + 24);
  ctx.textAlign = 'right';
  ctx.fillText('KAARTEN', right, y + 24);
  ctx.fillText('TOKENS', right - 190, y + 24);
  ctx.textAlign = 'left';
  y += 64;
  const lineX = x0 + 22;
  ctx.fillStyle = C.line;
  ctx.fillRect(lineX - 2, y + ROW / 2, 4, Math.max(0, (s.standings.length - 1) * ROW));
  const nameX = x0 + 108;
  const tokenX = right - 190;
  const nameW = tokenX - 110 - nameX;
  for (const p of s.standings) {
    const mid = y + ROW / 2;
    if (p.winner) {
      roundRect(ctx, x0 - 16, y + 6, m.inner + 32, ROW - 12, 20);
      ctx.fillStyle = C.accentSoft;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(lineX, mid, p.winner ? 13 : 10, 0, Math.PI * 2);
    ctx.fillStyle = p.winner ? C.accent : C.surface;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = p.winner ? C.accent : C.muted;
    ctx.stroke();
    ctx.fillStyle = C.muted;
    ctx.font = `700 30px ${SERIF}`;
    ctx.fillText(`${p.rank}.`, x0 + 50, mid + 11);
    ctx.fillStyle = C.ink;
    fitFont(ctx, p.name, { weight: p.winner ? 700 : 600, size: 42, min: 32, width: nameW });
    ctx.fillText(ellipsize(ctx, p.name, nameW), nameX, mid + 14);
    // Tokens: muntje en getal.
    ctx.textAlign = 'right';
    ctx.font = `600 36px ${SANS}`;
    ctx.fillStyle = C.ink;
    ctx.fillText(String(p.tokens), tokenX, mid + 13);
    const tw = ctx.measureText(String(p.tokens)).width;
    coin(ctx, tokenX - tw - 26, mid, 13);
    // Kaarten: groot, met het doel erbij.
    ctx.font = `700 46px ${SERIF}`;
    ctx.fillStyle = p.winner ? C.accent : C.ink;
    const target = s.target ? ` / ${s.target}` : '';
    ctx.font = `500 28px ${SANS}`;
    const targetW = target ? ctx.measureText(target).width : 0;
    ctx.fillStyle = C.muted;
    if (target) ctx.fillText(target, right, mid + 13);
    ctx.font = `700 46px ${SERIF}`;
    ctx.fillStyle = p.winner ? C.accent : C.ink;
    ctx.fillText(String(p.cards), right - targetW - 4, mid + 15);
    ctx.textAlign = 'left';
    y += ROW;
  }

  // De prijzen, elk op één regel.
  if (s.prizes.length) {
    y += 48;
    ctx.fillStyle = C.line;
    ctx.fillRect(x0, y - 24, m.inner, 2);
    ctx.fillStyle = C.muted;
    ctx.font = `700 24px ${SANS}`;
    ctx.fillText('PRIJZEN', x0, y + 24);
    y += 64;
    for (const prize of s.prizes) {
      const mid = y + PRIZE_ROW / 2;
      star(ctx, x0 + 22, mid - 2, 20);
      ctx.fillStyle = C.ink;
      ctx.font = `700 34px ${SANS}`;
      const title = `${prize.title}: `;
      ctx.fillText(title, x0 + 60, mid + 4);
      const tw = ctx.measureText(title).width;
      ctx.font = `400 34px ${SANS}`;
      ctx.fillText(fitNames(ctx, prize.names, right - x0 - 60 - tw), x0 + 60 + tw, mid + 4);
      ctx.fillStyle = C.muted;
      ctx.font = `400 26px ${SANS}`;
      ctx.fillText(ellipsize(ctx, prize.detail, right - x0 - 60), x0 + 60, mid + 40);
      y += PRIZE_ROW;
    }
  }

  // Onderaan: duur, beurten en doel.
  y += 56;
  ctx.fillStyle = C.line;
  ctx.fillRect(x0, y - 20, m.inner, 2);
  ctx.fillStyle = C.muted;
  ctx.font = `500 28px ${SANS}`;
  const meta = metaLine(s);
  ctx.fillText(ellipsize(ctx, meta || winnerTitle(s), m.inner), x0, y + 32);
  return m.height;
}

/** Maakt de PNG (een Blob) van het overzicht. */
export function summaryPng(s, doc = document) {
  const canvas = doc.createElement('canvas');
  drawSummary(canvas, s);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Geen afbeelding'))), 'image/png');
  });
}

/**
 * Deelt de PNG via het deelmenu van het toestel als dat bestanden kan delen;
 * anders (of als delen mislukt) als download. Geeft 'shared', 'cancelled' of
 * 'downloaded' terug. `blob` is liefst al klaar: sommige browsers (Safari)
 * openen het deelmenu alleen meteen na de tik.
 */
export async function shareOrDownload(blob, { title = 'Muziek-tijdlijn', text = '' } = {}) {
  const file = typeof File === 'function' ? new File([blob], FILE_NAME, { type: 'image/png' }) : null;
  const data = { files: file ? [file] : [], title, ...(text ? { text } : {}) };
  if (file && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (err) {
      // Zelf weggetikt: niets meer doen. Een andere fout: dan toch de download.
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = FILE_NAME;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}
