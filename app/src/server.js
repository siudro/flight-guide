'use strict';

/**
 * Flight Guide — HTTP layer.
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
const { generateReply, detectLanguage } = require('./engine');
const llm = require('./llm');
const status = require('./status');
const prompts = require('./prompts');
const boot = require('./boot');
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
    return sendJson(res, 200, {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      version: process.env.FG_VERSION || 'prototype'
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

  // --- durable chat history -----------------------------------------------
  if (p.indexOf('/api/history/') === 0 && method === 'GET') {
    const hid = decodeURIComponent(p.split('/')[3] || '');
    if (!hid) return sendJson(res, 400, { error: 'session id required' });
    const stored = store.loadSession(hid);
    if (!stored) return sendJson(res, 404, { ok: false, error: 'no such session' });
    return sendJson(res, 200, {
      ok: true, sessionId: hid,
      history: Array.isArray(stored.history) ? stored.history : [],
      stage: stored.stage != null ? stored.stage : null,
      flight: stored.flight || null, gate: stored.gate || null,
      airport: stored.airport || null
    });
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

    // The rule engine always runs FIRST. It owns the conversation state, the
    // safety escalation and the "do I have the four facts yet" logic. The model
    // writes the words; it cannot change what the engine decided, so a bad
    // model reply can never advance a stage, invent a gate, or drop the
    // "find staff" warning.
    const result = generateReply({ message, lang, profile, session, settings });

    // --- who answers this turn? One log line, always. -----------------------
    const turnNo = result.session.askedCount || 0;
    const cfg = llm.resolveConfig(settings);
    const stageKey = result.meta.stageKey || 'unknown';
    let aiMeta = { used: false, mode: 'rules', reason: 'llm-off' };

    // Declared outside the block: the response meta reports it afterwards.
    let live = null;

    if (cfg.enabled && cfg.apiKey) {
      const ticket = ticketStore.get(sessionId) || null;
      const sessionStatus = session.status || null;

      // --- ground the reply in the airport's own live feed ---------------
      const flightNo = result.session.flight;
      const airportCode = result.session.airport;
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

      const out = await llm.reply({
        config: cfg,
        settings,
        lang: result.meta.lang,
        history: session.history || [],
        context: {
          airport: result.session.airport,
          stageName: result.meta.stageName || stageKey,
          minutes: result.session.minutes,
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

    if (!Array.isArray(session.history)) session.history = [];
    session.history.push({ role: 'user', content: message.slice(0, 600) });
    session.history.push({
      role: 'assistant',
      content: result.messages.map((m) => m.text).join('\n\n').slice(0, 900)
    });
    session.history = session.history.slice(-16);

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

    return sendJson(res, 200, {
      sessionId,
      messages: result.messages,
      meta: result.meta,
      session: {
        stage: result.session.stage,
        airport: result.session.airport,
        terminal: result.session.terminal,
        minutes: result.session.minutes,
        bags: result.session.bags,
        gate: result.session.gate
      }
    });
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
    if (sid && out.fields && Object.keys(out.fields).length) {
      ticketStore.set(sid, out.fields);
    }

    const summary = Object.keys(out.fields || {}).join(', ') || 'nothing';
    console.log('[llm] TICKET ' + out.provider + '/' + out.model + '  ' + out.ms + 'ms  read: ' + summary);

    return sendJson(res, 200, { ok: true, fields: out.fields, ms: out.ms, model: out.model });
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
    console.log('  Flight Guide is running.');
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
