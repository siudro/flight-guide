'use strict';

/**
 * Vibe Flight — HTTP layer.
 *
 * Deliberately dependency-free: Node's built-in `http` module only. That keeps
 * the final image tiny (no node_modules), removes any supply-chain surface, and
 * means `docker build` cannot fail because a registry is unreachable.
 *
 * Routes
 *   GET  /healthz                 liveness probe -> 200 JSON
 *   GET  /                        chat UI
 *   GET  /map                     interactive airport map (static asset)
 *   GET  /map/mapdata.json        map points
 *   GET  /admin                   control panel
 *   GET  /api/settings            current effective settings
 *   PUT  /api/settings            save settings (admin)
 *   POST /api/settings/reset      restore shipped defaults (admin)
 *   POST /api/chat                one chat turn -> { messages, session, meta }
 *   GET  /api/conversations       recent conversation log (admin)
 *   DELETE /api/conversations     clear the log (admin)
 *
 * Request bodies are small JSON only. Every handler is wrapped so a thrown
 * error returns a 500 JSON body instead of killing the process.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env before anything reads process.env. A real environment variable
// always wins, so Docker and CI are unaffected. This is where the API key comes
// from when it is pasted into a file rather than exported in a shell.
const path0 = require('path');
const env = require('./env');
const envResult = env.load([
  path0.join(__dirname, '..', '.env'),
  path0.join(process.cwd(), '.env')
]);

const store = require('./store');
const { generateReply, detectLanguage, detectAirport, recordTicketInHistory, normalizeTicketFields } = require('./engine');
const llm = require('./llm');
const status = require('./status');
const prompts = require('./prompts');
const boot = require('./boot');
const gatemap = require('./gatemap');
const voice = require('./voice');
const weather = require('./weather');
const watch = require('./watch');
const DEFAULTS = require('../config/defaults');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = Number(process.env.FG_MAX_BODY_BYTES || 64 * 1024);
const MAX_IMAGE_BODY = Number(process.env.FG_MAX_IMAGE_BYTES || 8 * 1024 * 1024);
const MAX_SESSIONS = 500;

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAP_DIR = path.join(__dirname, '..', 'map');

// Settings are cached in memory and invalidated on every successful write.
let settings = store.loadSettings();

// In-memory conversation sessions, so the engine remembers where the traveller
// is in the flow. Lost on restart by design; the ticket data is not worth
// persisting and the log in /data gives the operator the history.
const sessions = new Map();

// Ticket details read from a photo, keyed by session. In memory only: a
// boarding pass has a name, flight and seat, and none of it belongs on disk.
// After a restart the traveller simply photographs it again.
const ticketStore = new Map();

// The last N assembled prompts, so a surprising answer can be traced to the
// exact text that produced it. Read-only at /api/prompts.
const promptLog = prompts.createLog();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

function sendHtml(res, status, html) {
  const buf = Buffer.from(String(html), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(buf);
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

/**
 * Static file serving rooted at `rootDir`, with traversal protection.
 * Returns true when handled.
 */
function serveStatic(req, res, rootDir, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = 'index.html';

  // Reject traversal before touching the filesystem.
  const resolved = path.resolve(rootDir, '.' + rel);
  const rootResolved = path.resolve(rootDir);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    sendText(res, 403, 'Forbidden');
    return true;
  }

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (_) {
    return false;
  }
  if (stat.isDirectory()) return false;

  const ext = path.extname(resolved).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff'
  });
  fs.createReadStream(resolved).pipe(res);
  return true;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > (limit || MAX_BODY)) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function publicSettings() {
  return {
    stages: settings.stages.map((s) => ({
      key: s.key,
      label: s.label,
      guidance: s.guidance,
      enabled: !!settings.byKey[s.key]
    })),
    profilesEnabled: settings.profilesEnabled,
    // Lets the chat hide the microphone when this instance has no Cohere key.
    voice: { enabled: voice.config().enabled },
    escalateMinutes: settings.escalateMinutes,
    mapVisible: settings.mapVisible,
    airports: settings.airports,
    // The key itself never crosses this boundary. The panel only learns
    // whether one is stored, so it can show "Saved" without echoing it.
    ai: {
      provider: (settings.ai && settings.ai.provider) || 'deepinfra',
      model: (settings.ai && settings.ai.model) || '',
      enabled: !!(settings.ai && settings.ai.enabled),
      hasKey: !!(settings.ai && settings.ai.apiKey)
    }
  };
}

function pruneSessions() {
  if (sessions.size <= MAX_SESSIONS) return;
  const keys = Array.from(sessions.keys()).slice(0, sessions.size - MAX_SESSIONS);
  for (const k of keys) sessions.delete(k);
}


/**
 * Minutes from now until a HH:MM boarding time. Returns null when the time is
 * unparseable, or when the result is absurd (a boarding time more than 18
 * hours away is almost certainly yesterday's or tomorrow's, so guessing would
 * be worse than saying nothing).
 */
function minutesUntilBoarding(boarding, fallback) {
  const raw = String(boarding || fallback || '').trim();
  const m = raw.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, min, 0, 0);
  let diff = Math.round((target - now) / 60000);
  if (diff < 0) diff += 24 * 60;          // boarding just after midnight
  if (diff > 18 * 60) return null;         // too far to be today's boarding
  return diff;
}

// One line per status lookup so an operator can see the live feed working.
function logStatusLookup(airport, flightNo, result) {
  const id = String(flightNo || '').toUpperCase();
  if (result && result.ok && result.flight) {
    console.log('[status] lookup ' + airport + ' ' + id +
      ' -> gate=' + (result.flight.gate || 'none') +
      ' status=' + (result.flight.status || 'unknown') +
      ' delay=' + (result.flight.delayMinutes || 0) + 'm');
  } else {
    console.log('[status] lookup ' + airport + ' ' + id +
      ' -> ' + (result && result.code ? result.code : 'failed'));
  }
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  const method = req.method || 'GET';

  // --- health -------------------------------------------------------------
  if (p === '/healthz') {
    if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });
    // `ai` is published so a deployment can be checked from outside with one
    // curl, instead of reading logs or guessing why replies feel dumb.
    const hcfg = llm.resolveConfig(settings);
    return sendJson(res, 200, {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      version: process.env.FG_VERSION || 'prototype',
      ai: {
        enabled: !!(hcfg.apiKey && process.env.LLM_ENABLED !== '0'),
        model: hcfg.configured ? hcfg.model : null,
        // Mirror the boot logic: name the actual cause, not a derived flag.
        reason: process.env.LLM_ENABLED === '0' ? 'LLM_ENABLED=0'
              : !hcfg.apiKey ? 'no OPENAI_API_KEY on this instance'
              : !hcfg.enabled ? 'LLM disabled for this provider'
              : null
      },
      liveFeed: { dammam: true, riyadh: false, jeddah: false },
      voice: { enabled: voice.config().enabled, provider: 'cohere', model: voice.config().model }
    });
  }

  // --- chat UI ------------------------------------------------------------
  if (p === '/' && method === 'GET') {
    return serveStatic(req, res, PUBLIC_DIR, '/index.html');
  }

  // --- map ----------------------------------------------------------------
  // The existing asset expects `mapdata.json` beside `index.html`.
  if (p === '/map' || p === '/map/') {
    if (method !== 'GET') return sendText(res, 405, 'Method not allowed');
    if (!settings.mapVisible) {
      return serveStatic(req, res, PUBLIC_DIR, '/map-hidden.html');
    }
    return serveStatic(req, res, MAP_DIR, '/index.html');
  }
  // The map page fetches its data by path. Accept both the canonical
  // /map/mapdata.json and a bare /mapdata.json, so the asset works whether it
  // is served at /map or mounted at the document root.
  if (p === '/mapdata.json') {
    if (!settings.mapVisible) return sendText(res, 404, 'Not found');
    return serveStatic(req, res, MAP_DIR, '/mapdata.json');
  }

  if (p.startsWith('/map/')) {
    if (method !== 'GET') return sendText(res, 405, 'Method not allowed');
    if (!settings.mapVisible) return sendText(res, 404, 'Not found');
    const sub = p.slice('/map'.length);
    if (serveStatic(req, res, MAP_DIR, sub)) return;
    return sendText(res, 404, 'Not found');
  }

  // --- admin --------------------------------------------------------------
  if (p === '/admin' && method === 'GET') {
    return serveStatic(req, res, PUBLIC_DIR, '/admin.html');
  }

  // --- API: settings ------------------------------------------------------
  // --- live airport status -------------------------------------------------
  // GET /api/flights/:airport           -> shaped departures from the airport
  // GET /api/flights/:airport/:flight   -> one flight: gate, status, delay
  if (p.indexOf('/api/flights/') === 0 && method === 'GET') {
    const parts = p.split('/').filter(Boolean);
    const airportCode = parts[2] || '';
    const flightNo = parts[3] ? decodeURIComponent(parts[3]) : '';
    const force = url.searchParams.get('refresh') === '1';
    try {
      if (flightNo) {
        const found = await status.findFlight(airportCode, flightNo, { force });
        logStatusLookup(airportCode, flightNo, found);
        return sendJson(res, found.ok ? 200 : (found.code === 'NOT_FOUND' ? 404 : 200), found);
      }
      const deps = await status.departures(airportCode, { force });
      if (!deps.ok) {
        console.log('[status] departures failed airport=' + airportCode + ' code=' + deps.code);
        return sendJson(res, 200, { ok: false, code: deps.code, error: deps.error });
      }
      const flights = (deps.flights || []).slice(0, 60).map(status._internal.shapeFlight);
      return sendJson(res, 200, {
        ok: true, airport: deps.airport, airportName: deps.airportName,
        currentTime: deps.currentTime, count: deps.count,
        cached: !!deps.cached, flights
      });
    } catch (err) {
      console.log('[status] route error ' + (err && err.message));
      return sendJson(res, 500, { ok: false, code: 'ROUTE_ERROR', error: String((err && err.message) || err) });
    }
  }

  // --- flight watch: alert on changes while the traveller waits -------------
  // GET /api/watch/:sessionId?lang=en|ar
  // Polled by the chat every couple of minutes once a Dammam flight is known.
  // Returns only what changed since the last poll (see src/watch.js).
  if (p.indexOf('/api/watch/') === 0 && method === 'GET') {
    const wid = decodeURIComponent(p.split('/')[3] || '');
    if (!wid || wid.length > 100) return sendJson(res, 400, { ok: false, error: 'session id required' });
    const wlang = url.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
    let wsession = sessions.get(wid) || store.loadSession(wid);
    if (!wsession) return sendJson(res, 404, { ok: false, code: 'NO_SESSION' });
    const out = await watch.poll({ session: wsession, lang: wlang, findFlight: status.findFlight });
    if (out.ok) {
      if (out.intro) {
        if (!Array.isArray(wsession.history)) wsession.history = [];
        wsession.history.push({ role: 'assistant', content: out.intro });
      }
      if (out.text) {
        if (!Array.isArray(wsession.history)) wsession.history = [];
        // `alert` lets a reloaded chat draw it red again.
        wsession.history.push({ role: 'assistant', content: out.text.slice(0, 900), alert: true });
        wsession.history = wsession.history.slice(-60);
        console.log('[watch] ' + wid.slice(0, 8) + ' ' + out.flight.number + ' changes=' +
          out.changes.map((c) => c.kind + ':' + (c.from != null ? c.from : '') + '->' + c.to).join(','));
      }
      sessions.set(wid, wsession);
      try { store.saveSession(wid, wsession); } catch (_) { /* in memory is enough */ }
      if (out.changes.some((c) => c.kind === 'gate')) {
        out.map = settings.mapVisible === false ? null
          : gatemap.build(wsession.airport || 'dmm', wsession.gate, wlang);
      }
      out.session = { gate: wsession.gate || null, flight: wsession.flight || null, airport: wsession.airport || null };
    }
    return sendJson(res, 200, out);
  }

  // --- durable chat history -----------------------------------------------
  if (p.indexOf('/api/history/') === 0 && method === 'GET') {
    const hid = decodeURIComponent(p.split('/')[3] || '');
    if (!hid) return sendJson(res, 400, { error: 'session id required' });
    // Memory first: it can be a poll or two newer than the file.
    const stored = sessions.get(hid) || store.loadSession(hid);
    if (!stored) return sendJson(res, 404, { ok: false, error: 'no such session' });
    // Everything the chat needs to come back exactly where it was after a
    // reload: the transcript, the trip card, and whether to resume the watch.
    return sendJson(res, 200, {
      ok: true, sessionId: hid,
      history: Array.isArray(stored.history) ? stored.history : [],
      stage: stored.stage != null ? stored.stage : null,
      flight: stored.flight || null, gate: stored.gate || null,
      airport: stored.airport || null,
      otherAirport: stored.otherAirport || null,
      terminal: stored.terminal || null,
      minutes: stored.minutes != null ? stored.minutes : null,
      bags: stored.bags || null,
      flightStatus: stored.watch && stored.watch.snapshot ? stored.watch.snapshot.status || null : null
    });
  }

  // --- shareable transcript ------------------------------------------------
  // GET /transcript/:sessionId
  //
  // A submission requires a LINK a judge can open and read. Raw JSON at
  // /api/history is not that. This renders the conversation as a plain HTML
  // page: no login, no JavaScript, no dependencies — just the messages.
  if (p.indexOf('/transcript/') === 0 && method === 'GET') {
    const hid = decodeURIComponent(p.split('/')[2] || '');
    if (!hid) return sendJson(res, 400, { error: 'session id required' });
    const stored = store.loadSession(hid);
    if (!stored) {
      return sendHtml(res, 404, '<h1>No conversation found</h1><p>This link does not match a stored conversation.</p>');
    }
    const turns = Array.isArray(stored.history) ? stored.history : [];
    const esc = (t) => String(t || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows = turns.map((m, i) => {
      const who = m.role === 'user' ? 'Traveller' : 'Vibe Flight';
      const cls = m.role === 'user' ? 'u' : 'b';
      return '<div class="t"><div class="who">' + (i + 1) + '  ' + who + '</div>' +
             '<div class="msg ' + cls + '" dir="auto">' + esc(m.content) + '</div></div>';
    }).join('');
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Vibe Flight — conversation record</title><style>' +
      'body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'max-width:760px;margin:0 auto;padding:32px 20px 80px;color:#18211f;background:#f6f3ee}' +
      'h1{color:#0f2547;font-size:22px;margin:0 0 4px}' +
      '.sub{color:#667570;font-size:13px;margin-bottom:26px}' +
      '.t{margin:0 0 16px}.who{font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;' +
      'color:#667570;margin-bottom:4px}' +
      '.msg{padding:13px 16px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}' +
      '.msg.b{background:#f1ece3;border-start-start-radius:5px}' +
      '.msg.u{background:#0f2547;color:#fff;border-start-end-radius:5px}' +
      'footer{margin-top:34px;color:#667570;font-size:12px;border-top:1px solid #ddd3c2;padding-top:14px}' +
      '</style></head><body>' +
      '<h1>Vibe Flight — conversation record</h1>' +
      '<div class="sub">' + turns.length + ' exchanged messages' +
      (stored.flight ? ' &middot; flight ' + esc(stored.flight) : '') +
      (stored.airport ? ' &middot; ' + esc(String(stored.airport).toUpperCase()) : '') +
      '</div>' + rows +
      '<footer>Recorded against the deployed build at flight-guide-production.up.railway.app. ' +
      'Vibe Flight is a WAICY 2026 LLM &amp; AI Agent track submission.</footer>' +
      '</body></html>';
    return sendHtml(res, 200, html);
  }

  if (p === '/api/settings') {
    if (method === 'GET') return sendJson(res, 200, publicSettings());
    if (method === 'PUT') {
      const body = await readBody(req);
      settings = store.saveSettings(body);
      return sendJson(res, 200, publicSettings());
    }
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  // --- API: verify an AI key ---------------------------------------------
  // Lets the panel prove a key works before the traveller ever relies on it.
  // Accepts a key in the body (testing before save) or falls back to the
  // stored one, so "Test" works both before and after saving.
  if (p === '/api/ai/verify' && method === 'POST') {
    const body = await readBody(req);
    const ai = settings.ai || {};
    const key = (typeof body.apiKey === 'string' && body.apiKey.trim()) || ai.apiKey || '';
    const provider = body.provider || ai.provider || 'deepinfra';
    const model = typeof body.model === 'string' ? body.model : ai.model;
    if (!key) return sendJson(res, 400, { ok: false, code: 'NO_KEY', error: 'No API key supplied.' });
    const out = await llm.verify({ apiKey: key, provider, model, settings, ctx: {} });
    return sendJson(res, 200, out);
  }

  if (p === '/api/settings/reset' && method === 'POST') {
    settings = store.resetSettings();
    return sendJson(res, 200, publicSettings());
  }

  if (p === '/api/meta' && method === 'GET') {
    return sendJson(res, 200, {
      stages: DEFAULTS.STAGES.map((s) => ({ key: s.key, label: s.label })),
      profiles: DEFAULTS.PROFILES,
      airports: DEFAULTS.AIRPORTS
    });
  }

  // --- API: conversations -------------------------------------------------
  if (p === '/api/conversations') {
    if (method === 'GET') {
      const list = store.loadConversations();
      return sendJson(res, 200, { conversations: list.slice(-100).reverse(), total: list.length });
    }
    if (method === 'DELETE') {
      store.clearConversations();
      return sendJson(res, 200, { cleared: true });
    }
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  // --- API: chat ----------------------------------------------------------
  if (p === '/api/chat') {
    if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });

    const body = await readBody(req);
    const message = typeof body.message === 'string' ? body.message : '';
    if (!message.trim()) return sendJson(res, 400, { error: 'message is required' });

    const sessionId = typeof body.sessionId === 'string' && body.sessionId.length < 100
      ? body.sessionId
      : crypto.randomUUID();

    // Memory first, then disk: a traveller who closed the tab keeps their
    // conversation instead of starting over.
    let session = sessions.get(sessionId);
    if (!session) {
      const stored = store.loadSession(sessionId);
      if (stored && typeof stored === 'object') {
        session = stored;
        console.log('[chat] resumed session ' + sessionId.slice(0, 8) + ' from disk (' +
          (Array.isArray(stored.history) ? stored.history.length : 0) + ' msgs)');
      } else {
        session = {};
      }
    }
    const lang = body.lang === 'ar' || body.lang === 'en'
      ? body.lang
      : detectLanguage(message, 'en');
    const profile = body.profile;

    // Some questions are answered from live data fetched BEFORE the engine
    // writes its reply, so the words and the data cannot disagree:
    //   "where is my gate?"      -> the gate from the airport's live board
    //   weather / delay question -> the forecast at both ends of the flight
    const wantsGate = gatemap.isGateQuestion(message);
    const wantsWeather = weather.isWeatherQuestion(message) || weather.isDelayQuestion(message);
    let weatherReport = null;
    if (wantsGate || wantsWeather) {
      const t0 = ticketStore.get(sessionId) || null;
      const fNo = session.flight || (t0 && t0.flight) || null;
      const msgOther = require('./engine').detectOtherAirport(message);
      const other = msgOther || (detectAirport(message) ? null : session.otherAirport) || null;
      // At another airport: no Dammam board lookup; the forecast uses that
      // airport if we know where it is.
      const aCode = other ? other.code : (session.airport || detectAirport(message) ||
        (t0 && String(t0.airport || '').toLowerCase()) || 'dmm');
      let pre = null;
      if (fNo && aCode === 'dmm') {
        try {
          pre = await status.findFlight(aCode, fNo);
          if (pre && pre.ok && pre.flight && pre.flight.gate && wantsGate) {
            session.gate = pre.flight.gate;
            if (!session.flight) session.flight = fNo;
            console.log('[map] live gate for ' + fNo + ' -> ' + pre.flight.gate);
          }
        } catch (err) {
          console.log('[status] pre-lookup failed: ' + (err && err.message));
          pre = null;
        }
      }
      if (wantsWeather) {
        const lf = pre && pre.ok ? pre.flight : null;
        // Destination: live board, then ticket, then a city named in the message.
        const named = weather.resolvePlace(message);
        const depPlace = weather.resolvePlace(aCode);
        const destination = (lf && lf.destination) || (t0 && t0.destination) || session.destination ||
          (named && named !== depPlace ? named : null);
        try {
          weatherReport = await weather.report({
            airport: aCode,
            destination,
            departure: lf ? (lf.estimated || lf.scheduled) : null
          });
          if (weatherReport.destination && weatherReport.destination.place) {
            session.destination = weatherReport.destination.place;
          }
          console.log('[weather] ' + (weatherReport.ok
            ? weatherReport.departure.place + (weatherReport.destination ? '->' + weatherReport.destination.place : '') +
              ' level=' + weatherReport.level
            : 'unavailable (' + weatherReport.code + ')'));
        } catch (err) {
          console.log('[weather] failed: ' + (err && err.message));
          weatherReport = null;
        }
      }
    }

    // The rule engine always runs FIRST. It owns the conversation state, the
    // safety escalation and the "do I have the four facts yet" logic. The model
    // writes the words; it cannot change what the engine decided, so a bad
    // model reply can never advance a stage, invent a gate, or drop the
    // "find staff" warning.
    const result = generateReply({
      message,
      lang,
      // The client sets this when the traveller picks a language by hand, so
      // an explicit choice is never overridden by script detection.
      langLocked: body.langLocked === true,
      profile,
      session,
      settings,
      weather: weatherReport
    });

    // --- who answers this turn? One log line, always. -----------------------
    const turnNo = result.session.askedCount || 0;
    const cfg = llm.resolveConfig(settings);
    const stageKey = result.meta.stageKey || 'unknown';
    let aiMeta = { used: false, mode: 'rules', reason: 'llm-off' };

    // Declared outside the block: the response meta reports it afterwards.
    let live = null;
    // undefined = not decided yet (rules-only turns decide after the block).
    let mapCard;

    if (cfg.enabled && cfg.apiKey) {
      const ticket = ticketStore.get(sessionId) || null;
      const sessionStatus = session.status || null;

      // --- ground the reply in the airport's own live feed ---------------
      // The session is the source of truth, but a session created before a
      // ticket was scanned (or restored from disk) may not carry the flight
      // yet. The ticket store is the backstop, so a scanned ticket always
      // enables the live lookup.
      const flightNo = result.session.flight || (ticket && ticket.flight) || null;
      // Dammam is the only airport with a live feed, so it is the default.
      // Requiring the traveller to type "I am at Dammam" before any live data
      // appears was the most common complaint: they had to say it twice
      // before the agent would look anything up.
      const defaultAirport = result.session.airport
        || (ticket && String(ticket.airport || '').toLowerCase())
        || 'dmm';
      // Not at another airport, where Dammam's board would be the wrong board.
      const airportCode = result.session.otherAirport ? null : defaultAirport;
      if (!result.session.flight && flightNo) result.session.flight = flightNo;
      if (!result.session.airport && airportCode) result.session.airport = airportCode;
      if (flightNo && airportCode) {
        try {
          live = await status.findFlight(airportCode, flightNo);
          if (live && live.ok) {
            console.log('[status] grounded turn ' + turnNo + ' flight=' + flightNo +
              ' gate=' + (live.flight.gate || 'none') +
              ' delay=' + (live.flight.delayMinutes || 0) + 'm');
            if (live.flight.gate) result.session.gate = live.flight.gate;
            if (live.flight.terminal) result.session.terminal = live.flight.terminal;
          } else {
            console.log('[status] no live data turn ' + turnNo + ' flight=' + flightNo +
              ' code=' + (live && live.code));
          }
        } catch (err) {
          console.log('[status] grounding failed turn ' + turnNo + ': ' + (err && err.message));
          live = null;
        }
      }

      // If we already know the boarding time, work out the countdown instead
      // of asking the traveller. Telling someone "you have 25 minutes" is the
      // product; asking them to compute it is the thing we exist to replace.
      let minutesLeft = result.session.minutes;
      if (minutesLeft == null) {
        minutesLeft = minutesUntilBoarding(
          (ticket && ticket.boarding) || null,
          result.session.boarding || null
        );
        if (minutesLeft != null) {
          result.session.minutes = minutesLeft;
          console.log('[ticket] computed minutes-to-boarding=' + minutesLeft);
        }
      }

      // Decide the map now, with the live gate in hand, so the model knows a
      // map is on screen and does not reply "I can't show you a map".
      mapCard = gatemap.decide({
        message, meta: result.meta, session: result.session, lang: result.meta.lang, settings
      });
      const mapLine = gatemap.describeForModel(mapCard);
      const toolLines = [mapLine, weatherReport ? weather.toModelLine(weatherReport) : null].filter(Boolean);

      const out = await llm.reply({
        config: cfg,
        settings,
        tools: toolLines.length ? toolLines : undefined,
        lang: result.meta.lang,
        history: session.history || [],
        context: {
          airport: result.session.airport,
          stageName: result.meta.stageName || stageKey,
          minutes: minutesLeft,
          terminal: result.session.terminal,
          gate: result.session.gate,
          flight: result.session.flight,
          airline: result.session.airline,
          bags: result.session.bags,
          live: live && live.ok ? {
            gate: live.flight.gate || null,
            terminal: live.flight.terminal || null,
            status: live.flight.status || null,
            delayMinutes: live.flight.delayMinutes || 0,
            remark: live.flight.remark || null,
            checkinCounters: live.flight.checkinCounters || null,
            destination: live.flight.destination || null,
            scheduled: live.flight.scheduled || null,
            estimated: live.flight.estimated || null,
            stale: !!live.stale,
            source: 'kfia.sa live departures'
          } : null
        },
        ticket,
        status: sessionStatus,
        engine: { text: result.messages.map((m) => m.text).join('\n\n') },
        message
      });

      if (out.ok) {
        result.messages = [{ text: out.text }];
        result.meta.model = out.model;
        aiMeta = { used: true, mode: 'llm', provider: out.provider, model: out.model };
        console.log('[llm] LLM   turn ' + turnNo + '  stage=' + stageKey +
          '  prompt=v' + (out.prompt ? out.prompt.version : '?') +
          '  ' + out.model + '  ' + out.ms + 'ms' +
          (out.usage && out.usage.total_tokens ? '  ' + out.usage.total_tokens + ' tok' : ''));
        promptLog.add({
          sessionId, turn: turnNo, version: out.prompt.version,
          segments: out.prompt.segments, chars: out.prompt.chars,
          text: out.prompt.text, model: out.model, ms: out.ms
        });
      } else {
        aiMeta = { used: false, mode: 'rules', reason: out.code, error: out.error };
        console.log('[llm] RULES turn ' + turnNo + '  stage=' + stageKey +
          '  (' + out.code + ': ' + out.error + ') — rule-engine reply kept');
      }
    } else {
      const why = !cfg.enabled ? 'LLM_ENABLED=0' : 'no key configured';
      aiMeta = { used: false, mode: 'rules', reason: why };
      console.log('[llm] RULES turn ' + turnNo + '  stage=' + stageKey + '  (' + why + ')');
    }

    // Keep the transcript on the object we persist (result.session), not the
    // one we loaded, or a resumed conversation loses its history.
    if (!Array.isArray(result.session.history)) {
      result.session.history = Array.isArray(session.history) ? session.history.slice() : [];
    }
    result.session.history.push({ role: 'user', content: message.slice(0, 600) });
    result.session.history.push({
      role: 'assistant',
      content: result.messages.map((m) => m.text).join('\n\n').slice(0, 900)
    });
    result.session.history = result.session.history.slice(-60);

    if (mapCard === undefined) {
      mapCard = gatemap.decide({
        message, meta: result.meta, session: result.session, lang: result.meta.lang, settings
      });
    }
    if (mapCard) {
      console.log('[map] turn ' + turnNo + ' airport=' + mapCard.airport +
        ' gate=' + (mapCard.gate || 'none') + ' exact=' + mapCard.exact);
    }

    result.meta.ai = aiMeta;
    result.meta.live = live && live.ok ? {
      gate: live.flight.gate || null,
      status: live.flight.status || null,
      delayMinutes: live.flight.delayMinutes || 0,
      remark: live.flight.remark || null,
      stale: !!live.stale
    } : null;

    sessions.set(sessionId, result.session);
    try {
      store.saveSession(sessionId, result.session);
    } catch (err) {
      console.warn('[chat] session persist failed: ' + err.message);
    }
    pruneSessions();

    try {
      store.appendConversation({
        at: new Date().toISOString(),
        sessionId,
        lang: result.meta.lang,
        profile: result.meta.profile,
        stage: result.meta.stageKey,
        airport: result.meta.airport || null,
        escalated: !!result.meta.escalated,
        mode: aiMeta.mode,
        user: message.slice(0, 500),
        assistant: result.messages.map((m) => m.text).join('\n\n').slice(0, 1500)
      });
    } catch (err) {
      console.warn('[chat] log failed: ' + err.message);
    }

    // Mark which bubble is the safety warning, so only it is drawn red.
    // The model folds everything into one message: then that one is red when
    // the engine announced the warning this turn.
    const escText = (DEFAULTS.TEXT[result.meta.lang] || DEFAULTS.TEXT.en).escalate;
    const outMessages = result.messages.map((m) => Object.assign({}, m, {
      urgent: aiMeta.used ? !!result.meta.escalationAnnounced : String(m.text).indexOf(escText) === 0
    }));

    return sendJson(res, 200, {
      sessionId,
      messages: outMessages,
      map: mapCard || null,
      weather: weatherReport ? weather.toCard(weatherReport, result.meta.lang) : null,
      meta: result.meta,
      session: {
        stage: result.session.stage,
        airport: result.session.airport,
        terminal: result.session.terminal,
        minutes: result.session.minutes,
        bags: result.session.bags,
        gate: result.session.gate,
        flight: result.session.flight || null
      }
    });
  }

  // --- API: voice message -> text (Cohere Transcribe) -----------------------
  // Body: { audio: base64 WAV, mime: 'audio/wav', lang: 'en'|'ar' }.
  // Returns only the text; the browser then sends it through /api/chat like
  // a typed message, so the rule engine still owns the conversation.
  if (p === '/api/voice') {
    if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
    const vcfg = voice.config();
    if (!vcfg.enabled) {
      return sendJson(res, 200, { ok: false, code: 'NOT_CONFIGURED', message: 'Voice messages are not switched on.' });
    }
    const body = await readBody(req, Math.ceil(voice.MAX_AUDIO_BYTES * 1.4) + 4096);
    const b64 = typeof body.audio === 'string' ? body.audio.replace(/^data:[^,]*,/, '') : '';
    const audio = Buffer.from(b64, 'base64');
    const out = await voice.transcribe({
      audio,
      mime: typeof body.mime === 'string' ? body.mime : 'audio/wav',
      lang: body.lang === 'ar' ? 'ar' : 'en'
    });
    if (!out.ok) {
      console.log('[voice] failed (' + out.code + '): ' + out.error + '  ' + (out.ms || 0) + 'ms');
      return sendJson(res, 200, { ok: false, code: out.code });
    }
    console.log('[voice] ' + out.lang + '  ' + Math.round(audio.length / 1024) + 'KB  ' +
      out.ms + 'ms  ' + out.text.length + ' chars');
    return sendJson(res, 200, { ok: true, text: out.text.slice(0, 1000), lang: out.lang });
  }

  // --- API: ticket photo -> fields (vision) --------------------------------
  // The browser sends base64. The key stays on the server: the browser never
  // sees it and never talks to the provider directly.
  if (p === '/api/ticket') {
    if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });

    const body = await readBody(req, MAX_IMAGE_BODY);
    const cfg = llm.resolveConfig(settings);

    if (!cfg.configured) {
      console.log('[llm] TICKET skipped (' + (cfg.enabled ? 'no key configured' : 'LLM_ENABLED=0') + ')');
      return sendJson(res, 200, {
        ok: false, code: 'NOT_CONFIGURED',
        message: 'Ticket reading by the model is not available. Type the details instead.'
      });
    }

    const image = {
      data: typeof body.image === 'string' ? body.image : '',
      mime: typeof body.mime === 'string' ? body.mime : 'image/jpeg'
    };
    if (!image.data || image.data.length > 7.5 * 1024 * 1024) {
      return sendJson(res, 400, { ok: false, code: 'NO_IMAGE', message: 'No usable image was received.' });
    }

    const out = await llm.readTicket({ config: cfg, settings, image });
    if (!out.ok) {
      console.log('[llm] TICKET failed (' + out.code + '): ' + out.error + '  ' + (out.ms || 0) + 'ms');
      return sendJson(res, 200, {
        ok: false, code: out.code,
        message: 'I could not read the ticket photo. You can type the details instead.'
      });
    }

    const sid = typeof body.sessionId === 'string' ? body.sessionId : null;
    // Normalise once, at the boundary: the vision model returns "null"
    // strings and splits flight numbers ("XY 406"), and both broke the
    // card, the live lookup and the replayed history.
    const fields = normalizeTicketFields(out.fields || {});
    if (sid && Object.keys(fields).length) {
      ticketStore.set(sid, fields);

      // Also write the usable facts onto the session. Without this the ticket
      // only reached the prompt: every later turn looked for
      // session.flight, found nothing, and skipped the live airport lookup
      // entirely — so the agent told a traveller "I can't see live flight
      // information" while holding their flight number.
      const sess = sessions.get(sid) || store.loadSession(sid) || {};
      if (fields.flight) sess.flight = fields.flight;
      if (fields.airline) sess.airline = fields.airline;
      if (fields.terminal) sess.terminal = fields.terminal;
      if (fields.gate) sess.gate = fields.gate;
      if (fields.boarding) sess.boarding = fields.boarding;
      const dep = String(fields.airport || '').toUpperCase();
      if (dep) sess.airport = dep.toLowerCase();
      // The scan must become part of the conversation, or the model replays a
      // history in which no ticket was ever mentioned and answers "I can't
      // see the ticket picture" while the flight number is on screen.
      const langForTicket = typeof body.lang === 'string' ? body.lang : 'en';
      recordTicketInHistory(sess, fields, langForTicket);
      sessions.set(sid, sess);
      try { store.saveSession(sid, sess); } catch (_) {}
      console.log('[ticket] wrote to session ' + sid.slice(0, 8) +
        ' flight=' + (sess.flight || 'none') + ' airport=' + (sess.airport || 'none'));
    }

    const summary = Object.keys(fields).join(', ') || 'nothing';
    console.log('[llm] TICKET ' + out.provider + '/' + out.model + '  ' + out.ms + 'ms  read: ' + summary);

    return sendJson(res, 200, { ok: true, fields, ms: out.ms, model: out.model });
  }

  // --- API: prompts (versions + recent assemblies) -------------------------
  if (p === '/api/prompts') {
    if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
    const url2 = new URL(req.url, 'http://localhost');
    const n = Number(url2.searchParams.get('recent') || 5);
    return sendJson(res, 200, {
      active: prompts.ACTIVE_VERSION,
      versions: prompts.PROMPT_VERSIONS.map((v) => ({
        version: v.version, date: v.date, note: v.note,
        segments: Object.keys(v.segments)
      })),
      recent: promptLog.recent(Math.min(Math.max(n, 1), 40))
    });
  }

  // --- static fallbacks ---------------------------------------------------
  if (serveStatic(req, res, PUBLIC_DIR, p)) return;

  return sendJson(res, 404, { error: 'not found' });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  Promise.resolve()
    .then(() => handle(req, res))
    .catch((err) => {
      const status = err.statusCode || 500;
      if (status >= 500) console.error('[error]', err);
      if (!res.headersSent) sendJson(res, status, { error: err.message || 'internal error' });
      else res.end();
    });
});

// A slow or half-open client must not hold the server hostage.
server.headersTimeout = 20000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 5000;

/**
 * Boot, then listen.
 *
 * The boot step runs before listen() on purpose: it runs the test suite,
 * resolves the API key, and makes one live provider check when a key exists.
 * Whoever starts the app — npm start, node src/server.js, docker run — sees at
 * the top of the log whether tests pass and whether replies come from the model
 * or the rules.
 */
async function start() {
  if (envResult.loaded) {
    console.log('');
    console.log('  [env] loaded ' + require('path').basename(envResult.file) +
      '  (' + envResult.keys.length + ' variable' + (envResult.keys.length === 1 ? '' : 's') + ' applied)');
  }

  await boot.boot(settings, {
    skipTests: process.env.FG_SKIP_BOOT_TESTS === '1',
    skipLiveCheck: process.env.FG_SKIP_LIVE_CHECK === '1'
  });

  server.listen(PORT, HOST, () => {
    console.log('  Vibe Flight is running.');
    console.log('');
    console.log('  Open this in your browser:   http://localhost:' + PORT);
    console.log('');
    console.log('  Leave this window open. Press Ctrl+C here to stop the app.');
    console.log('');
    console.log('  Settings stored in: ' + store.SETTINGS_FILE);
    console.log('  Map visible: ' + settings.mapVisible + ' | Escalate at ' + settings.escalateMinutes + ' min');
    console.log('');
    console.log('  Prompt versions:  http://localhost:' + PORT + '/api/prompts');
    console.log('  Health:           http://localhost:' + PORT + '/healthz');
    console.log('');
  });
}

start().catch((err) => {
  console.error('[boot] failed:', err);
  process.exit(1);
});

function shutdown(signal) {
  console.log(`\n${signal} received — shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { server };
