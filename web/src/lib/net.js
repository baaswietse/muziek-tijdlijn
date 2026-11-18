// Verbinding met de spelserver: een paar POST-verzoeken om een spel te maken
// of binnen te komen, en daarna één WebSocket die bij elke wijziging de
// volledige spelstatus krijgt. Valt de verbinding weg (scherm vergrendeld,
// wifi kwijt), dan herverbindt ze vanzelf en is de status meteen weer juist.

import { SERVER_URL } from '../config.js';

export class ServerError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function post(path, body) {
  if (!SERVER_URL) throw new ServerError('NO_SERVER', 'Het adres van de spelserver is nog niet ingesteld.');
  let res;
  try {
    res = await fetch(SERVER_URL + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ServerError('OFFLINE', 'De spelserver is niet bereikbaar. Controleer je internetverbinding.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    // geen JSON: hieronder afgehandeld
  }
  if (!res.ok) throw new ServerError(data?.error || 'SERVER', data?.message || 'De spelserver gaf een fout.');
  return data;
}

export const createRoom = (name) => post('/api/rooms', { name });
export const joinRoom = (code, name) => post(`/api/rooms/${encodeURIComponent(code)}/join`, { name });

const PING_EVERY = 15_000;
const SILENCE_LIMIT = 35_000;
const PROBE_TIMEOUT = 4_000;

export class Connection {
  /**
   * @param {{code:string, token:string, onState:Function, onStatus:Function,
   *          onError:Function, onGone:Function}} opts
   */
  constructor(opts) {
    this.opts = opts;
    this.ws = null;
    this.wanted = false;
    this.attempts = 0;
    this.lastSeen = 0;
    this.retryTimer = null;
    this.pingTimer = null;
    this.probeTimer = null;
    // Hoe lang een ping heen en terug duurt (ms), voor wie geluid gelijk met de anderen wil spelen.
    this.pingAt = 0;
    this.rtts = [];
    this.wake = this.wake.bind(this);
  }

  start() {
    this.wanted = true;
    document.addEventListener('visibilitychange', this.wake);
    window.addEventListener('online', this.wake);
    window.addEventListener('pageshow', this.wake);
    this.pingTimer = setInterval(() => this.heartbeat(), PING_EVERY);
    this.open();
  }

  stop() {
    this.wanted = false;
    document.removeEventListener('visibilitychange', this.wake);
    window.removeEventListener('online', this.wake);
    window.removeEventListener('pageshow', this.wake);
    clearInterval(this.pingTimer);
    clearTimeout(this.retryTimer);
    clearTimeout(this.probeTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) ws.close();
  }

  status(s) {
    this.opts.onStatus?.(s);
  }

  open() {
    if (!this.wanted || this.ws) return;
    clearTimeout(this.retryTimer);
    this.status('connecting');
    let ws;
    try {
      ws = new WebSocket(`${SERVER_URL.replace(/^http/, 'ws')}/api/rooms/${this.opts.code}/ws`);
    } catch {
      return this.retryLater();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.lastSeen = Date.now();
      ws.send(JSON.stringify({ t: 'hello', token: this.opts.token }));
      // Meteen ook een ping: zo is de vertraging van de verbinding snel gekend.
      this.ping(ws);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.lastSeen = Date.now();
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'pong') {
        this.pong();
      } else if (msg.t === 'sound') {
        // Alleen voor wie om geluid vroeg (zie lib/listen.js); met het tijdstip van ontvangst.
        this.opts.onSound?.(msg.sound ?? null, performance.now());
      } else if (msg.t === 'state') {
        this.attempts = 0;
        this.status('online');
        this.opts.onState?.(msg.state);
      } else if (msg.t === 'error') {
        if (msg.code === 'BAD_TOKEN' || msg.code === 'NO_ROOM') {
          // Dit spel bestaat niet meer of je zit er niet meer in: niet blijven proberen.
          this.stop();
          this.opts.onGone?.(msg);
        } else {
          this.opts.onError?.(msg);
        }
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.status('offline');
      this.retryLater();
    };
    ws.onerror = () => {};
  }

  retryLater() {
    if (!this.wanted) return;
    clearTimeout(this.retryTimer);
    const wait = Math.min(5000, 300 * 2 ** this.attempts) + Math.random() * 200;
    this.attempts++;
    this.retryTimer = setTimeout(() => this.open(), wait);
  }

  /** Sluit een verbinding die niets meer zegt en begint opnieuw. */
  drop() {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    try {
      ws.close();
    } catch {
      // al dicht
    }
    this.status('offline');
    this.attempts = 0;
    this.open();
  }

  heartbeat() {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - this.lastSeen > SILENCE_LIMIT) return this.drop();
    this.ping(ws);
  }

  ping(ws) {
    this.pingAt = performance.now();
    ws.send('{"t":"ping"}');
  }

  pong() {
    if (!this.pingAt) return;
    this.rtts = [...this.rtts.slice(-4), performance.now() - this.pingAt];
    this.pingAt = 0;
  }

  /** Geschatte tijd (s) die een bericht van de server onderweg is: de helft van de kortste recente ping. */
  latency() {
    return this.rtts.length ? Math.min(...this.rtts) / 2000 : 0;
  }

  /** De pagina komt terug in beeld of het netwerk is terug. */
  wake() {
    if (!this.wanted || document.visibilityState === 'hidden') return;
    const ws = this.ws;
    if (!ws) {
      this.attempts = 0;
      return this.open();
    }
    if (ws.readyState !== WebSocket.OPEN) return;
    // Na een vergrendeld scherm lijkt een verbinding soms open terwijl ze dood
    // is. Stuur een ping; komt er niet snel antwoord, begin dan opnieuw.
    const asked = Date.now();
    this.ping(ws);
    clearTimeout(this.probeTimer);
    this.probeTimer = setTimeout(() => {
      if (this.ws === ws && this.lastSeen < asked) this.drop();
    }, PROBE_TIMEOUT);
  }

  /** Stuurt een actie; geeft false terug als er geen verbinding is. */
  send(msg) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.opts.onError?.({ code: 'OFFLINE', message: 'Geen verbinding met de server. Even geduld…' });
      return false;
    }
    ws.send(JSON.stringify(msg));
    return true;
  }
}
