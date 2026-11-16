// Spelserver op Cloudflare Workers. Elk spel is één Durable Object: een klein
// stukje server met eigen opslag dat alle WebSockets van dat spel bijhoudt.
// De spelregels zelf staan in ../src en zijn dezelfde als bij de Node-server.

import { DurableObject } from 'cloudflare:workers';
import * as room from '../src/room.js';
import { GameError } from '../src/rules.js';
import { normaliseTracks } from '../src/tracks.js';

const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY = 2048;

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

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new GameError('TOO_LARGE', 'Verzoek te groot.');
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
      ws.serializeAttachment({ playerId });
      return this.broadcast();
    }
    const playerId = ws.deserializeAttachment()?.playerId;
    if (!playerId) return;
    try {
      await room.applyAction(this.state, playerId, msg, { loadTracks: () => this.loadTracks() });
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
      await this.save();
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

  /** Stuurt iedereen zijn eigen kijk op het spel; `gone` sluit net af. */
  broadcast(gone) {
    const sockets = this.ctx
      .getWebSockets()
      .filter((s) => s !== gone)
      .map((s) => ({ s, playerId: s.deserializeAttachment()?.playerId }))
      .filter((x) => x.playerId);
    const online = new Set(sockets.map((x) => x.playerId));
    for (const { s, playerId } of sockets) {
      try {
        s.send(JSON.stringify({ t: 'state', state: room.view(this.state, playerId, online) }));
      } catch {
        // verbinding net weggevallen
      }
    }
  }

  async save() {
    await this.ctx.storage.put('state', this.state);
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
