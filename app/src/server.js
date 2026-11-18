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

const store = require('./store');
const { generateReply, detectLanguage } = require('./engine');
const DEFAULTS = require('../config/defaults');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = Number(process.env.FG_MAX_BODY_BYTES || 64 * 1024);
const MAX_SESSIONS = 500;

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAP_DIR = path.join(__dirname, '..', 'map');

// Settings are cached in memory and invalidated on every successful write.
let settings = store.loadSettings();

// In-memory conversation sessions, so the engine remembers where the traveller
// is in the flow. Lost on restart by design; the ticket data is not worth
// persisting and the log in /data gives the operator the history.
const sessions = new Map();

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
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
    airports: settings.airports
  };
}

function pruneSessions() {
  if (sessions.size <= MAX_SESSIONS) return;
  const keys = Array.from(sessions.keys()).slice(0, sessions.size - MAX_SESSIONS);
  for (const k of keys) sessions.delete(k);
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
  if (p === '/api/settings') {
    if (method === 'GET') return sendJson(res, 200, publicSettings());
    if (method === 'PUT') {
      const body = await readBody(req);
      settings = store.saveSettings(body);
      return sendJson(res, 200, publicSettings());
    }
    return sendJson(res, 405, { error: 'method not allowed' });
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

    const session = sessions.get(sessionId) || {};
    const lang = body.lang === 'ar' || body.lang === 'en'
      ? body.lang
      : detectLanguage(message, 'en');
    const profile = body.profile;

    const result = generateReply({
      message,
      lang,
      profile,
      session,
      settings
    });

    sessions.set(sessionId, result.session);
    pruneSessions();

    // Log the turn for /admin. Bounded and volume-backed.
    try {
      store.appendConversation({
        at: new Date().toISOString(),
        sessionId,
        lang: result.meta.lang,
        profile: result.meta.profile,
        stage: result.meta.stageKey,
        airport: result.meta.airport || null,
        escalated: !!result.meta.escalated,
        user: message.slice(0, 500),
        assistant: result.messages.map((m) => m.text).join('\n\n').slice(0, 1500)
      });
    } catch (err) {
      console.warn(`[chat] log failed: ${err.message}`);
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

server.listen(PORT, HOST, () => {
  // Plain-language banner: whoever runs this needs to know what to open.
  console.log('');
  console.log('  Flight Guide is running.');
  console.log('');
  console.log(`  Open this in your browser:   http://localhost:${PORT}`);
  console.log('');
  console.log('  Leave this window open. Press Ctrl+C here to stop the app.');
  console.log('');
  console.log(`  Settings stored in: ${store.SETTINGS_FILE}`);
  console.log(`  Map visible: ${settings.mapVisible} | Escalate at ${settings.escalateMinutes} min`);
});

function shutdown(signal) {
  console.log(`\n${signal} received — shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { server };
