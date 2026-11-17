// Een kaart (of een token) naar een plaats op een tijdlijn slepen, met de
// vinger of de muis. Alleen pointer events, geen bibliotheek.
//
// Hoe het blijft lopen op een gewone gsm: bij het begin van een sleep wordt
// de tijdlijn één keer opgemeten. Daarna verplaatst elke beweging alleen nog
// een zwevende kopie (transform), en krijgen de kaarten pas een nieuwe
// transform als de plaats onder de vinger verandert. Er wordt tijdens het
// slepen niets opnieuw getekend door Preact en de pagina wordt niet opnieuw
// opgemeten; pas bij het loslaten komt de keuze in de state.
//
// Wat waar staat in de tijdlijn (`<ol>` met `ref`):
//   - elke rij heeft `data-row`;
//   - een kaart heeft `data-card` (haar index), een andere rij (de vastgelegde
//     kaart, een ingezet token) `data-slot` (de plaats waar ze bij hoort);
//   - de rij met de eigen keuze heeft ook `data-pick`;
//   - `.tl-drop` is de omlijning die toont waar de kaart zou landen.
// Plaats i ligt vóór kaart i; plaats n (het aantal kaarten) ligt achteraan.

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

// Zo ver moet de vinger bewegen voor het een sleep is (een tik blijft een tik).
const THRESHOLD = 5;
// Zo dicht bij de boven- of onderrand begint de tijdlijn mee te schuiven.
const EDGE = 56;
// Zo snel schuift ze hoogstens (pixels per beeld).
const MAX_SPEED = 18;

/**
 * Volgende vrije plaats omhoog of omlaag. Van boven naar onder: plaats 0 tot
 * en met n, en daaronder de houder (null). Geeft `undefined` als het niet
 * verder kan.
 */
export function step(index, dir, n, blocked) {
  const free = (i) => !blocked?.has(i);
  if (dir === 'up') {
    for (let i = (index ?? n + 1) - 1; i >= 0; i--) if (free(i)) return i;
    return undefined;
  }
  if (index === null) return undefined;
  for (let i = index + 1; i <= n; i++) if (free(i)) return i;
  return null;
}

/**
 * @param {object} o
 * @param {{current: HTMLElement}} o.listRef  de tijdlijn (`<ol>`)
 * @param {number} o.count       aantal kaarten op die tijdlijn
 * @param {number|null} o.index  huidige keuze (null = in de houder)
 * @param {Set<number>} [o.blocked]  plaatsen die niets aannemen
 * @param {boolean} o.enabled    mag er nu gesleept worden
 * @param {Function} o.onDrop    (index|null) bij het loslaten op een andere plaats
 * @param {Function} [o.labelFor]  (index) naam van een plaats, voor de omlijning
 * @param {*} o.resetKey         verandert dit (nieuwe beurt), dan stopt een lopende sleep
 */
export function useSlotDrag({ listRef, count, index, blocked, enabled, onDrop, labelFor, resetKey }) {
  // Wat er zweeft: { left, top, width, height } van het opgepakte stuk.
  const [ghost, setGhost] = useState(null);
  const ghostRef = useRef(null);
  const holderRef = useRef(null);
  const live = useRef(null);
  const latest = useRef(null);
  latest.current = { count, index, blocked, onDrop, labelFor, enabled };

  // De kopie volgt de vinger meteen, ook voor ze voor het eerst getekend is.
  useLayoutEffect(() => {
    if (ghost && live.current) placeGhost(live.current);
  }, [ghost]);

  // Een nieuwe beurt, of slepen kan niet meer (verbinding weg, kaart gelegd):
  // niets mag in de lucht blijven hangen.
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled]);
  useEffect(() => () => cancel(), [resetKey]);
  // Scherm gedraaid, naar een andere app: de opmeting klopt niet meer, dus
  // stoppen zonder iets te kiezen. Wordt alleen de hoogte anders (de
  // adresbalk van een gsm schuift in of uit), dan gaat de sleep gewoon door.
  useEffect(() => {
    const stop = () => cancel();
    const hidden = () => document.hidden && cancel();
    const resized = () => {
      const s = live.current;
      if (!s?.started) return;
      if (Math.abs(window.innerWidth - s.width) > 1) cancel();
      else s.barTop = document.querySelector('[data-testid="action-bar"]')?.getBoundingClientRect().top ?? window.innerHeight;
    };
    window.addEventListener('resize', resized);
    window.addEventListener('orientationchange', stop);
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('resize', resized);
      window.removeEventListener('orientationchange', stop);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);

  function onPointerDown(e) {
    if (!latest.current.enabled || live.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // De knoppen in het stuk (omhoog, omlaag, bevestigen) blijven knoppen.
    if (e.target.closest('button')) return;
    const el = e.currentTarget;
    // Geen tekst selecteren met de muis; met de vinger schuift er niets
    // (touch-action: none op het stuk zelf, nergens anders).
    if (e.pointerType === 'mouse') e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // Kan niet in elke browser bij elk soort pointer: dan zonder.
    }
    const s = { id: e.pointerId, el, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, started: false, hover: undefined, over: undefined };
    s.onMove = (ev) => move(s, ev);
    s.onUp = (ev) => ev.pointerId === s.id && finish(s, true);
    s.onCancel = (ev) => ev.pointerId === s.id && finish(s, false);
    el.addEventListener('pointermove', s.onMove);
    el.addEventListener('pointerup', s.onUp);
    el.addEventListener('pointercancel', s.onCancel);
    el.addEventListener('lostpointercapture', s.onCancel);
    live.current = s;
  }

  function move(s, e) {
    if (e.pointerId !== s.id || live.current !== s) return;
    s.x = e.clientX;
    s.y = e.clientY;
    if (!s.started) {
      if (Math.hypot(s.x - s.x0, s.y - s.y0) < THRESHOLD) return;
      if (!begin(s)) return;
    }
    placeGhost(s);
    update(s);
  }

  /** Begin van de sleep: de tijdlijn één keer opmeten. */
  function begin(s) {
    const list = listRef.current;
    if (!list) {
      finish(s, false);
      return false;
    }
    const lr = list.getBoundingClientRect();
    const rows = Array.from(list.children).filter((el) => el.hasAttribute('data-row'));
    const pick = rows.find((el) => el.hasAttribute('data-pick')) ?? null;
    const pickAt = pick ? rows.indexOf(pick) : rows.length;
    const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
    const src = s.el.getBoundingClientRect();
    // Zoveel plaats maakt de kaart als ze ergens tussen komt.
    const size = (pick ? pick.getBoundingClientRect().height : rowHeight(rows, src.height)) + gap;
    const meta = rows.map((el, k) => {
      const r = el.getBoundingClientRect();
      return {
        el,
        top: r.top - lr.top,
        bottom: r.bottom - lr.top,
        card: el.hasAttribute('data-card') ? Number(el.dataset.card) : null,
        slot: el.hasAttribute('data-slot') ? Number(el.dataset.slot) : null,
        afterPick: Boolean(pick) && k > pickAt,
      };
    });
    // Midden van elke kaart zoals ze zou liggen zonder de eigen keuze erin.
    const mids = meta.filter((m) => m.card !== null).map((m) => (m.top + m.bottom) / 2 - (m.afterPick ? size : 0));
    const rest = meta.filter((m) => m.el !== pick);
    const end = rest.length ? Math.max(...rest.map((m) => m.bottom - (m.afterPick ? size : 0))) + gap : 0;
    const bar = document.querySelector('[data-testid="action-bar"]');
    const head = document.querySelector('.game-top');
    s.layout = { list, pick, meta, mids, size, gap, end, docTop: lr.top + window.scrollY };
    s.barTop = bar ? bar.getBoundingClientRect().top : window.innerHeight;
    s.headBottom = head ? head.getBoundingClientRect().bottom : 0;
    s.width = window.innerWidth;
    s.started = true;
    list.classList.add('is-dragging');
    // Komt de kaart uit de houder, dan is er achteraan plaats nodig.
    if (!pick) list.style.paddingBottom = `${size}px`;
    (pick ?? s.el).classList.add('lifted');
    document.documentElement.classList.add('dragging');
    setGhost({ left: src.left, top: src.top, width: src.width, height: src.height });
    s.raf = requestAnimationFrame(() => tick(s));
    return true;
  }

  function placeGhost(s) {
    const g = ghostRef.current;
    if (g) g.style.transform = `translate3d(${s.x - s.x0}px, ${s.y - s.y0}px, 0)`;
  }

  /** Waar zou de kaart nu landen? Alleen bij een andere plaats verandert er iets. */
  function update(s) {
    const L = s.layout;
    const { blocked: taken, labelFor: name } = latest.current;
    const over = s.y >= s.barTop;
    let hover = null;
    if (!over) {
      const y = s.y + window.scrollY - L.docTop;
      hover = L.mids.filter((m) => m < y).length;
      // Een bezette plaats neemt niets aan.
      if (taken?.has(hover)) hover = null;
    }
    if (hover === s.hover && over === s.over) return;
    s.hover = hover;
    s.over = over;
    for (const m of L.meta) {
      if (m.el === L.pick) continue;
      const after = hover !== null && (m.card !== null ? m.card >= hover : m.slot > hover);
      const shift = (after ? L.size : 0) - (m.afterPick ? L.size : 0);
      m.el.style.transform = shift ? `translateY(${shift}px)` : '';
    }
    const drop = L.list.querySelector('.tl-drop');
    if (drop) {
      if (hover === null) drop.classList.remove('on');
      else {
        const first = L.meta.find((m) => m.el !== L.pick && (m.card !== null ? m.card >= hover : m.slot > hover));
        const y = first ? first.top - (first.afterPick ? L.size : 0) : L.end;
        drop.style.transform = `translateY(${y}px)`;
        drop.style.height = `${L.size - L.gap}px`;
        drop.textContent = name ? `Hier: ${name(hover)}` : '';
        drop.classList.add('on');
      }
    }
    L.list.dataset.hover = hover === null ? '' : String(hover);
    holderRef.current?.classList.toggle('target', over);
  }

  /** Tot bij de boven- of onderrand gesleept: de pagina schuift mee. */
  function tick(s) {
    if (live.current !== s || !s.started) return;
    const top = s.headBottom + EDGE;
    const bottom = s.barTop - EDGE;
    let v = 0;
    if (s.y < top) v = -Math.min(MAX_SPEED, (top - s.y) / 3 + 2);
    else if (s.y > bottom && s.y < s.barTop) v = Math.min(MAX_SPEED, (s.y - bottom) / 3 + 2);
    if (v) {
      const before = window.scrollY;
      window.scrollBy(0, v);
      if (window.scrollY !== before) update(s);
    }
    s.raf = requestAnimationFrame(() => tick(s));
  }

  /** Loslaten (`drop`) of afbreken: alles terug, en bij loslaten de keuze. */
  function finish(s, drop) {
    if (live.current !== s) return;
    live.current = null;
    const { el } = s;
    el.removeEventListener('pointermove', s.onMove);
    el.removeEventListener('pointerup', s.onUp);
    el.removeEventListener('pointercancel', s.onCancel);
    el.removeEventListener('lostpointercapture', s.onCancel);
    try {
      if (el.hasPointerCapture?.(s.id)) el.releasePointerCapture(s.id);
    } catch {
      // al losgelaten
    }
    if (!s.started) return;
    cancelAnimationFrame(s.raf);
    const L = s.layout;
    for (const m of L.meta) m.el.style.transform = '';
    L.list.classList.remove('is-dragging');
    L.list.style.paddingBottom = '';
    delete L.list.dataset.hover;
    L.list.querySelector('.tl-drop')?.classList.remove('on');
    (L.pick ?? el).classList.remove('lifted');
    holderRef.current?.classList.remove('target');
    document.documentElement.classList.remove('dragging');
    setGhost(null);
    if (!drop) return;
    const { index: now, onDrop: done } = latest.current;
    // Op de houder: terug. Op een bezette plaats: blijft waar ze was.
    const target = s.over ? null : s.hover ?? now;
    if (target !== now) done(target);
  }

  function cancel() {
    if (live.current) finish(live.current, false);
  }

  return { ghost, ghostRef, holderRef, onPointerDown, cancel };
}

/** Hoogte van een kaartrij op deze tijdlijn (of van het opgepakte stuk). */
function rowHeight(rows, fallback) {
  const card = rows.find((el) => el.hasAttribute('data-card'));
  return card ? card.getBoundingClientRect().height : fallback;
}
