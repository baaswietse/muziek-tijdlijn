// Spelserver op Cloudflare Workers. Elk spel is één Durable Object: een klein
// stukje server met eigen opslag dat alle WebSockets van dat spel bijhoudt.
// De spelregels zelf staan in ../src en zijn dezelfde als bij de Node-server.
// Daarnaast is er één Durable Object YearStore met de gedeelde lijst met
// jaartallen (zie ../src/yearlist.js), voor alle spellen samen.

import { DurableObject } from 'cloudflare:workers';
import * as room from '../src/room.js';
import { GameError } from '../src/rules.js';
import { normaliseTracks } from '../src/tracks.js';
import * as yearlist from '../src/yearlist.js';

const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY = 2048;
// Er is maar één gedeelde lijst: altijd hetzelfde exemplaar van YearStore.
const YEARS_NAME = 'gedeeld';

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function originAllowed(env, origin) {
  const list = allowedOrigins(env);
  if (list.includes('*')) return true;
  return Boolean(origin) && list.includes(origin.replace(/\/$/, ''));
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowedOrigins(env).includes('*')) headers['Access-Control-Allow-Origin'] = '*';
  else if (originAllowed(env, origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function errorResponse(err) {
  const payload = room.errorPayload(err);
  if (!(err instanceof GameError)) console.error(err);
  const status = payload.code === 'NO_ROOM' ? 404 : payload.code === 'SERVER' ? 500 : 400;
  return json({ error: payload.code, message: payload.message }, status);
}

async function readBody(request, limit = MAX_BODY) {
  const text = await request.text();
  if (text.length > limit) throw new GameError('TOO_LARGE', 'Verzoek te groot.');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new GameError('BAD_JSON', 'Ongeldig verzoek.');
  }
}

/** Geeft het antwoord van de kamer door met de CORS-kopregels erbij. */
function withCors(response, request, env) {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(corsHeaders(request, env))) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const stubFor = (code) => env.ROOMS.get(env.ROOMS.idFromName(code.toUpperCase()));
    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(request, env) });
      }
      if (request.method === 'GET' && (path === '/' || path === '/api/health')) {
        return json({ ok: true, service: 'muziek-tijdlijn' }, 200, corsHeaders(request, env));
      }
      if (request.method === 'POST' && path === '/api/rooms') {
        const body = await readBody(request);
        // Probeer codes tot er een vrije is.
        for (let i = 0; i < 6; i++) {
          const code = room.randomCode();
          const res = await stubFor(code).fetch('https://room/create', {
            method: 'POST',
            body: JSON.stringify({ code, name: body.name }),
          });
          if (res.status !== 409) return withCors(res, request, env);
        }
        throw new GameError('SERVER_FULL', 'Er kon geen vrije code gevonden worden. Probeer opnieuw.');
      }
      let m = path.match(/^\/api\/rooms\/([A-Za-z]{4})\/join$/);
      if (request.method === 'POST' && m) {
        const body = await readBody(request);
        const res = await stubFor(m[1]).fetch('https://room/join', {
          method: 'POST',
          body: JSON.stringify({ name: body.name }),
        });
        return withCors(res, request, env);
      }
      m = path.match(/^\/api\/rooms\/([A-Za-z]{4})\/deck$/);
      if (request.method === 'POST' && m) {
        // De host stuurt een eigen lijst met nummers (een gekozen playlist).
        const body = await readBody(request, room.MAX_DECK_BODY);
        const res = await stubFor(m[1]).fetch('https://room/deck', { method: 'POST', body: JSON.stringify(body) });
        return withCors(res, request, env);
      }
      m = path.match(/^\/api\/rooms\/([A-Za-z]{4})\/years(\/lookup|\/export)?$/);
      if (request.method === 'POST' && m) {
        // De gedeelde lijst met jaartallen: lezen (/years/lookup), aanvullen
        // (/years) of in pagina's opvragen (/years/export). Alleen voor de
        // host van een bestaand spel.
        const body = await readBody(request, yearlist.MAX_YEARS_BODY);
        const check = await stubFor(m[1]).fetch('https://room/host', {
          method: 'POST',
          body: JSON.stringify({ token: body.token }),
        });
        if (!check.ok) return withCors(check, request, env);
        const store = env.YEARS.get(env.YEARS.idFromName(YEARS_NAME));
        const result =
          m[2] === '/lookup'
            ? await store.lookup(yearlist.parseLookup(body).ids)
            : m[2] === '/export'
              ? await store.exportPage(yearlist.parseExport(body))
              : await store.write(yearlist.parseEntries(body));
        return json(result, 200, corsHeaders(request, env));
      }
      m = path.match(/^\/api\/rooms\/([A-Za-z]{4})\/ws$/);
      if (m) {
        if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'UPGRADE', message: 'WebSocket verwacht.' }, 426);
        if (!originAllowed(env, request.headers.get('Origin'))) return json({ error: 'ORIGIN', message: 'Niet toegelaten.' }, 403);
        return stubFor(m[1]).fetch(request);
      }
      return json({ error: 'NOT_FOUND', message: 'Niet gevonden.' }, 404, corsHeaders(request, env));
    } catch (err) {
      return withCors(errorResponse(err), request, env);
    }
  },
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.state = null;
    this.tracks = null;
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get('state')) ?? null;
      // De eigen lijst van de host staat apart, zodat geen enkele waarde in de
      // opslag te groot wordt.
      if (this.state) this.state.custom = (await ctx.storage.get('custom')) ?? null;
    });
    // Pings beantwoordt Cloudflare zelf, zonder de kamer wakker te maken.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/create') {
        if (this.state) return json({ error: 'TAKEN' }, 409);
        const body = await request.json();
        const state = room.createRoomState(body.code);
        const creds = room.join(state, body.name); // gooit bij een ongeldige naam
        this.state = state;
        await this.save();
        return json({ code: state.code, ...creds });
      }
      if (url.pathname === '/join') {
        if (!this.state) throw new GameError('NO_ROOM', 'Dit spel bestaat niet (meer). Controleer de code.');
        const body = await request.json();
        const creds = room.join(this.state, body.name);
        await this.save();
        this.broadcast();
        return json({ code: this.state.code, ...creds });
      }
      if (url.pathname === '/deck') {
        if (!this.state) throw new GameError('NO_ROOM', 'Dit spel bestaat niet (meer). Controleer de code.');
        room.setDeck(this.state, await request.json());
        await this.save({ custom: true });
        this.broadcast();
        return json({ ok: true, count: this.state.custom.tracks.length });
      }
      if (url.pathname === '/host') {
        // Alleen een controle voor de gedeelde lijst met jaartallen; verandert niets.
        if (!this.state) throw new GameError('NO_ROOM', 'Dit spel bestaat niet (meer). Controleer de code.');
        room.authenticateHost(this.state, (await request.json()).token);
        return json({ ok: true });
      }
      if (url.pathname.endsWith('/ws')) {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ playerId: null });
        if (!this.state) {
          server.send(JSON.stringify({ t: 'error', code: 'NO_ROOM', message: 'Dit spel bestaat niet (meer).' }));
          server.close(4004, 'no room');
        }
        return new Response(null, { status: 101, webSocket: client });
      }
      return json({ error: 'NOT_FOUND' }, 404);
    } catch (err) {
      return errorResponse(err);
    }
  }

  async webSocketMessage(ws, message) {
    let msg;
    try {
      msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }
    if (msg?.t === 'ping') return ws.send('{"t":"pong"}');
    if (!this.state) return;
    if (msg?.t === 'hello') {
      const playerId = room.authenticate(this.state, msg.token);
      if (!playerId) {
        ws.send(JSON.stringify({ t: 'error', code: 'BAD_TOKEN', message: 'Je zit niet (meer) in dit spel.' }));
        return ws.close(4003, 'bad token');
      }
      ws.serializeAttachment({ playerId, listen: ws.deserializeAttachment()?.listen === true });
      return this.broadcast();
    }
    const attachment = ws.deserializeAttachment();
    const playerId = attachment?.playerId;
    if (!playerId) return;
    if (msg?.t === 'listen') {
      // Geluid op dit toestel aan of uit: geldt voor deze verbinding (blijft
      // bij de verbinding bewaard, ook als de kamer even slaapt).
      const listen = msg.on === true;
      ws.serializeAttachment({ ...attachment, listen });
      if (listen) this.sendSound(ws, playerId, true);
      return;
    }
    if (msg?.t === 'soundFail') {
      // Het adres speelt niet bij deze speler: de host vraagt een vers adres.
      if (attachment.listen === true && room.soundFailed(this.state, playerId, msg.n)) {
        await this.save();
        this.broadcast();
      }
      return;
    }
    try {
      const hadCustom = Boolean(this.state.custom);
      await room.applyAction(this.state, playerId, msg, {
        loadTracks: () => this.loadTracks(),
        online: this.onlineIds(),
      });
      const customChanged = hadCustom !== Boolean(this.state.custom);
      // Een verwijderde speler krijgt nog één melding en wordt dan afgesloten.
      for (const other of this.ctx.getWebSockets()) {
        const id = other.deserializeAttachment()?.playerId;
        if (id && !this.state.players.some((p) => p.id === id)) {
          other.serializeAttachment({ playerId: null });
          try {
            other.send(JSON.stringify({ t: 'error', code: 'BAD_TOKEN', message: 'De host heeft je uit het spel gehaald.' }));
            other.close(4003, 'removed');
          } catch {
            // al dicht
          }
        }
      }
      await this.save({ custom: customChanged });
      this.broadcast();
    } catch (err) {
      if (!(err instanceof GameError)) console.error(err);
      ws.send(JSON.stringify(room.errorPayload(err)));
    }
  }

  webSocketClose(ws) {
    try {
      ws.close();
    } catch {
      // al dicht
    }
    if (this.state && ws.deserializeAttachment()?.playerId) this.broadcast(ws);
  }

  webSocketError(ws) {
    if (this.state && ws.deserializeAttachment()?.playerId) this.broadcast(ws);
  }

  /** Aangemelde verbindingen met hun speler; `gone` sluit net af. */
  sockets(gone) {
    return this.ctx
      .getWebSockets()
      .filter((s) => s !== gone)
      .map((s) => {
        const a = s.deserializeAttachment();
        return { s, playerId: a?.playerId, listen: a?.listen === true };
      })
      .filter((x) => x.playerId);
  }

  /** Wie nu verbonden is, zoals het bord het toont. */
  onlineIds(gone) {
    return new Set(this.sockets(gone).map((x) => x.playerId));
  }

  /** Stuurt iedereen zijn eigen kijk op het spel; `gone` sluit net af. */
  broadcast(gone) {
    const sockets = this.sockets(gone);
    const online = new Set(sockets.map((x) => x.playerId));
    const now = Date.now();
    for (const { s, playerId, listen } of sockets) {
      try {
        s.send(JSON.stringify({ t: 'state', state: room.view(this.state, playerId, online) }));
        // Alleen wie om geluid vroeg, krijgt het adres van het fragment (apart bericht).
        this.sendSound(s, playerId, listen, now);
      } catch {
        // verbinding net weggevallen
      }
    }
  }

  /** Het geluidsbericht voor één verbinding, als die meeluistert (zie ../src/sound.js). */
  sendSound(ws, playerId, listen, now = Date.now()) {
    const msg = room.soundMessage(this.state, playerId, listen, now);
    if (msg) ws.send(JSON.stringify(msg));
  }

  /** Bewaart het spel. De eigen lijst alleen als die veranderd is (`custom`). */
  async save({ custom = false } = {}) {
    const { custom: deck, ...rest } = this.state;
    await this.ctx.storage.put('state', rest);
    if (custom) {
      if (deck) await this.ctx.storage.put('custom', deck);
      else await this.ctx.storage.delete('custom');
    }
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }

  /** Ruimt een kamer op die een halve dag stil lag. */
  async alarm() {
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      return;
    }
    await this.ctx.storage.deleteAll();
    this.state = null;
  }

  async loadTracks() {
    try {
      if (this.tracks && Date.now() - this.tracks.at < 60_000) return this.tracks.list;
      const res = await fetch(this.env.TRACKS_URL, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = normaliseTracks(await res.json());
      this.tracks = { at: Date.now(), list };
      return list;
    } catch (err) {
      console.error('tracks.json laden mislukt:', err.message);
      throw new GameError('TRACKS', 'De server kon de lijst met nummers (tracks.json) niet laden.');
    }
  }
}

/**
 * De gedeelde lijst met jaartallen, in één tabel. Er bestaat maar één
 * exemplaar (YEARS_NAME). Het wordt alleen via de Worker aangesproken, nadat
 * die gecontroleerd heeft dat het verzoek van de host van een spel komt en de
 * inhoud nagekeken is (yearlist.parseLookup / parseEntries).
 */
export class YearStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS years (
         id TEXT PRIMARY KEY,
         y INTEGER,
         s TEXT NOT NULL,
         d TEXT NOT NULL,
         r INTEGER,
         t INTEGER NOT NULL
       )`,
    );
    // Kolommen die er later bij kwamen (titel, artiest, jaren per bron als
    // JSON). Een bestaande tabel krijgt ze hier; oude rijen hebben ze leeg.
    const have = new Set([...this.sql.exec('PRAGMA table_info(years)')].map((c) => c.name));
    for (const col of ['b', 'title', 'artist']) {
      if (!have.has(col)) this.sql.exec(`ALTER TABLE years ADD COLUMN ${col} TEXT`);
    }
    this.count = null; // aantal rijen, pas geteld bij het eerste schrijfverzoek
  }

  /** Een rij uit de tabel als item (zie yearlist.normaliseEntry), met at = tijdstip van de laatste wijziging. */
  static entry(row) {
    let d = [];
    try {
      d = JSON.parse(row.d);
    } catch {
      // kapotte rij: zonder twijfels
    }
    const entry = { id: row.id, y: row.y, s: row.s, d: Array.isArray(d) ? d : [] };
    if (row.r !== null) entry.r = row.r;
    if (row.b) {
      try {
        const b = JSON.parse(row.b);
        if (b && typeof b === 'object' && !Array.isArray(b)) entry.b = b;
      } catch {
        // kapot: zonder jaren per bron
      }
    }
    if (row.title) entry.title = row.title;
    if (row.artist) entry.artist = row.artist;
    entry.at = row.t;
    return entry;
  }

  /** Map id -> item voor de gevraagde nummers die al gekend zijn. */
  read(ids) {
    const found = new Map();
    if (ids.length === 0) return found;
    // Eén parameter in plaats van honderden: SQLite pakt de lijst zelf uit.
    const rows = this.sql.exec(
      'SELECT id, y, s, d, r, b, title, artist, t FROM years WHERE id IN (SELECT value FROM json_each(?))',
      JSON.stringify(ids),
    );
    for (const row of rows) found.set(row.id, YearStore.entry(row));
    return found;
  }

  /**
   * Eén pagina van de hele lijst, op track-ID, na `after`. Leest hoogstens
   * limit + 1 rijen (via de primaire sleutel): een volledige export van
   * duizenden nummers kost een handvol verzoeken.
   */
  exportPage({ after, limit }) {
    const rows = this.sql.exec(
      'SELECT id, y, s, d, r, b, title, artist, t FROM years WHERE id > ? ORDER BY id LIMIT ?',
      after,
      limit + 1,
    );
    return yearlist.exportPage([...rows].map((row) => YearStore.entry(row)), limit);
  }

  /** { years: { id: { y, s, d, r?, b?, named? } }, names: true } */
  lookup(ids) {
    const years = {};
    for (const [id, entry] of this.read(ids)) years[id] = yearlist.publicEntry(entry);
    // names: deze server bewaart ook titel en artiest (een oudere niet).
    return { years, names: true };
  }

  /** Voegt nagekeken items samen met wat er al staat; schrijft alleen wat verandert. */
  write({ entries, skipped }) {
    if (this.count === null) this.count = this.sql.exec('SELECT COUNT(*) AS n FROM years').one().n;
    const existing = this.read(entries.map((e) => e.id));
    const changed = yearlist.mergeEntries(existing, entries, yearlist.MAX_ROWS - this.count);
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      for (const e of changed) {
        this.sql.exec(
          'INSERT OR REPLACE INTO years (id, y, s, d, r, b, title, artist, t) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          e.id,
          e.y,
          e.s,
          JSON.stringify(e.d),
          e.r ?? null,
          e.b ? JSON.stringify(e.b) : null,
          e.title ?? null,
          e.artist ?? null,
          now,
        );
      }
    });
    this.count += changed.filter((e) => !existing.has(e.id)).length;
    return { ok: true, saved: changed.length, skipped: skipped + entries.length - changed.length };
  }
}
