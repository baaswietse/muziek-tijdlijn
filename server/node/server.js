// Spelserver als gewoon Node-programma (HTTP + WebSocket).
// Gebruikt voor lokaal ontwikkelen en testen, en bruikbaar op een eigen server
// of een Node-host. De spelregels zelf staan in ../src.
//
// Instellingen (omgevingsvariabelen):
//   PORT             poort, standaard 8787
//   HOST             adres om op te luisteren, standaard 0.0.0.0
//   TRACKS_URL       waar tracks.json staat (de GitHub Pages-site)
//   TRACKS_FILE      of: pad naar een lokale tracks.json (voorrang op TRACKS_URL)
//   ALLOWED_ORIGINS  komma-gescheiden lijst van toegelaten sites, of * (standaard)
//   DATA_FILE        optioneel: bestand om lopende spellen en de gedeelde lijst
//                    met jaartallen in te bewaren

import http from 'node:http';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import * as room from '../src/room.js';
import { GameError } from '../src/rules.js';
import { normaliseTracks } from '../src/tracks.js';
import * as yearlist from '../src/yearlist.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const TRACKS_URL = process.env.TRACKS_URL || 'https://baaswietse.github.io/muziek-tijdlijn/tracks.json';
const TRACKS_FILE = process.env.TRACKS_FILE || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);
const DATA_FILE = process.env.DATA_FILE || '';

const MAX_ROOMS = 200;
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY = 2048;

/** code -> { state, sockets:Set<WebSocket> } */
const rooms = new Map();

/** De gedeelde lijst met jaartallen (zie ../src/yearlist.js): id -> { id, y, s, d, r?, b?, title?, artist?, at } */
const years = new Map();

// ---------- nummers ----------

let tracksCache = { at: 0, tracks: null };

async function loadTracks() {
  try {
    if (TRACKS_FILE) {
      return normaliseTracks(JSON.parse(await readFile(TRACKS_FILE, 'utf8')));
    }
    if (tracksCache.tracks && Date.now() - tracksCache.at < 60_000) return tracksCache.tracks;
    const res = await fetch(TRACKS_URL, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tracks = normaliseTracks(await res.json());
    tracksCache = { at: Date.now(), tracks };
    return tracks;
  } catch (err) {
    console.error('tracks.json laden mislukt:', err.message);
    throw new GameError('TRACKS', 'De server kon de lijst met nummers (tracks.json) niet laden.');
  }
}

// ---------- bewaren (optioneel) ----------

let saveTimer = null;

function scheduleSave() {
  if (!DATA_FILE || saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      const data = JSON.stringify({ rooms: [...rooms.values()].map((r) => r.state), years: [...years.values()] });
      await writeFile(DATA_FILE + '.tmp', data);
      await rename(DATA_FILE + '.tmp', DATA_FILE);
    } catch (err) {
      console.error('bewaren mislukt:', err.message);
    }
  }, 500);
}

function loadSaved() {
  if (!DATA_FILE || !existsSync(DATA_FILE)) return;
  try {
    const data = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    // Oudere bestanden zijn alleen een lijst met spellen.
    const saved = Array.isArray(data) ? data : data?.rooms || [];
    for (const state of saved) {
      if (state?.code) rooms.set(state.code, { state, sockets: new Set() });
    }
    for (const raw of Array.isArray(data?.years) ? data.years : []) {
      const entry = yearlist.normaliseEntry(raw);
      if (!entry) continue;
      if (Number.isInteger(raw.at)) entry.at = raw.at;
      years.set(entry.id, entry);
    }
    console.log(`${rooms.size} spel(len) en ${years.size} jaartallen hersteld uit ${DATA_FILE}`);
  } catch (err) {
    console.error('herstellen mislukt:', err.message);
  }
}

// ---------- kamers ----------

function onlineSet(r) {
  const online = new Set();
  for (const ws of r.sockets) if (ws.playerId) online.add(ws.playerId);
  return online;
}

function broadcast(r) {
  const online = onlineSet(r);
  for (const ws of r.sockets) {
    if (!ws.playerId || ws.readyState !== ws.OPEN) continue;
    ws.send(JSON.stringify({ t: 'state', state: room.view(r.state, ws.playerId, online) }));
  }
  scheduleSave();
}

function createRoom(name) {
  if (rooms.size >= MAX_ROOMS) throw new GameError('SERVER_FULL', 'De server zit vol. Probeer later opnieuw.');
  let code;
  do code = room.randomCode();
  while (rooms.has(code));
  const state = room.createRoomState(code);
  const creds = room.join(state, name);
  rooms.set(code, { state, sockets: new Set() });
  scheduleSave();
  return { code, ...creds };
}

function getRoom(code) {
  const r = rooms.get(String(code || '').toUpperCase());
  if (!r) throw new GameError('NO_ROOM', 'Dit spel bestaat niet (meer). Controleer de code.');
  return r;
}

setInterval(() => {
  const limit = Date.now() - ROOM_TTL_MS;
  for (const [code, r] of rooms) {
    if (r.sockets.size === 0 && r.state.updatedAt < limit) rooms.delete(code);
  }
  scheduleSave();
}, 10 * 60 * 1000).unref();

// ---------- HTTP ----------

function originAllowed(origin) {
  if (ALLOWED_ORIGINS.includes('*')) return true;
  return Boolean(origin) && ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ''));
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (ALLOWED_ORIGINS.includes('*')) headers['Access-Control-Allow-Origin'] = '*';
  else if (originAllowed(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function sendJson(req, res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(req) });
  res.end(JSON.stringify(body));
}

async function readJson(req, limit = MAX_BODY) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new GameError('TOO_LARGE', 'Verzoek te groot.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new GameError('BAD_JSON', 'Ongeldig verzoek.');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(req));
      return res.end();
    }
    if (req.method === 'GET' && (path === '/' || path === '/api/health')) {
      return sendJson(req, res, 200, { ok: true, service: 'muziek-tijdlijn', rooms: rooms.size });
    }
    if (req.method === 'POST' && path === '/api/rooms') {
      const body = await readJson(req);
      return sendJson(req, res, 200, createRoom(body.name));
    }
    const m = path.match(/^\/api\/rooms\/([A-Za-z]{4})\/join$/);
    if (req.method === 'POST' && m) {
      const body = await readJson(req);
      const r = getRoom(m[1]);
      const creds = room.join(r.state, body.name);
      broadcast(r);
      return sendJson(req, res, 200, { code: r.state.code, ...creds });
    }
    const d = path.match(/^\/api\/rooms\/([A-Za-z]{4})\/deck$/);
    if (req.method === 'POST' && d) {
      // De host stuurt een eigen lijst met nummers (een gekozen playlist).
      const body = await readJson(req, room.MAX_DECK_BODY);
      const r = getRoom(d[1]);
      room.setDeck(r.state, body);
      broadcast(r);
      return sendJson(req, res, 200, { ok: true, count: r.state.custom.tracks.length });
    }
    const y = path.match(/^\/api\/rooms\/([A-Za-z]{4})\/years(\/lookup|\/export)?$/);
    if (req.method === 'POST' && y) {
      // De gedeelde lijst met jaartallen: lezen (/years/lookup), aanvullen
      // (/years) of in pagina's opvragen (/years/export). Alleen voor de host
      // van een bestaand spel.
      const body = await readJson(req, yearlist.MAX_YEARS_BODY);
      room.authenticateHost(getRoom(y[1]).state, body.token);
      if (y[2] === '/lookup') {
        const found = {};
        for (const id of yearlist.parseLookup(body).ids) {
          if (years.has(id)) found[id] = yearlist.publicEntry(years.get(id));
        }
        // names: deze server bewaart ook titel en artiest (een oudere niet).
        return sendJson(req, res, 200, { years: found, names: true });
      }
      if (y[2] === '/export') {
        const { after, limit } = yearlist.parseExport(body);
        const ids = [...years.keys()].filter((id) => id > after).sort();
        const page = ids.slice(0, limit + 1).map((id) => years.get(id));
        return sendJson(req, res, 200, yearlist.exportPage(page, limit));
      }
      const { entries, skipped } = yearlist.parseEntries(body);
      const changed = yearlist.mergeEntries(years, entries, yearlist.MAX_ROWS - years.size);
      const now = Date.now();
      for (const e of changed) years.set(e.id, { ...e, at: now });
      if (changed.length) scheduleSave();
      return sendJson(req, res, 200, { ok: true, saved: changed.length, skipped: skipped + entries.length - changed.length });
    }
    return sendJson(req, res, 404, { error: 'NOT_FOUND', message: 'Niet gevonden.' });
  } catch (err) {
    const payload = room.errorPayload(err);
    if (!(err instanceof GameError)) console.error(err);
    const status = payload.code === 'NO_ROOM' ? 404 : payload.code === 'SERVER' ? 500 : 400;
    return sendJson(req, res, status, { error: payload.code, message: payload.message });
  }
});

// ---------- WebSocket ----------

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/api\/rooms\/([A-Za-z]{4})\/ws\/?$/);
  if (!m || !originAllowed(req.headers.origin || (ALLOWED_ORIGINS.includes('*') ? '*' : ''))) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, m[1].toUpperCase()));
});

function onConnection(ws, code) {
  const r = rooms.get(code);
  if (!r) {
    ws.send(JSON.stringify({ t: 'error', code: 'NO_ROOM', message: 'Dit spel bestaat niet (meer).' }));
    return ws.close(4004, 'no room');
  }
  ws.playerId = null;
  r.sockets.add(ws);
  // Wie zich niet snel aanmeldt, vliegt eruit.
  const helloTimer = setTimeout(() => {
    if (!ws.playerId) ws.close(4001, 'no hello');
  }, 10_000);

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }
    if (msg?.t === 'ping') return ws.send('{"t":"pong"}');
    if (msg?.t === 'hello') {
      const playerId = room.authenticate(r.state, msg.token);
      if (!playerId) {
        ws.send(JSON.stringify({ t: 'error', code: 'BAD_TOKEN', message: 'Je zit niet (meer) in dit spel.' }));
        return ws.close(4003, 'bad token');
      }
      ws.playerId = playerId;
      return broadcast(r);
    }
    if (!ws.playerId) return;
    try {
      await room.applyAction(r.state, ws.playerId, msg, { loadTracks, online: onlineSet(r) });
      // Een verwijderde speler krijgt nog één melding en wordt dan afgesloten.
      for (const other of r.sockets) {
        if (other.playerId && !r.state.players.some((p) => p.id === other.playerId)) {
          other.send(JSON.stringify({ t: 'error', code: 'BAD_TOKEN', message: 'De host heeft je uit het spel gehaald.' }));
          other.playerId = null;
          other.close(4003, 'removed');
        }
      }
      broadcast(r);
    } catch (err) {
      if (!(err instanceof GameError)) console.error(err);
      ws.send(JSON.stringify(room.errorPayload(err)));
    }
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    r.sockets.delete(ws);
    if (ws.playerId) broadcast(r);
  });
  ws.on('error', () => {});
}

loadSaved();
server.listen(PORT, HOST, () => {
  console.log(`Muziek-tijdlijn server luistert op http://${HOST}:${PORT}`);
  console.log(`  nummers: ${TRACKS_FILE || TRACKS_URL}`);
  console.log(`  toegelaten sites: ${ALLOWED_ORIGINS.join(', ')}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}
