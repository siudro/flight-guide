'use strict';

/**
 * Reload restore, red only for safety, other airports, translations.
 *   node test/improvements.js
 * Starts the real server on a free port (rules only, no keys, no network).
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const { generateReply, detectOtherAirport } = require('../src/engine');
const { sanitize } = require('../src/store');
const gatemap = require('../src/gatemap');
const watch = require('../src/watch');
const weather = require('../src/weather');

let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }
const S = sanitize({});
const say = (message, session, lang) => generateReply({ message, lang: lang || 'en', profile: 'adult', session: session || {}, settings: S });

// ------------------------------------------------------------ other airports

test('"I am at Abha" is Abha, not Dammam; destinations are not locations', () => {
  assert.strictEqual(detectOtherAirport('I am at Abha airport').code, 'AHB');
  assert.strictEqual(detectOtherAirport('انا في مطار أبها').code, 'AHB');
  assert.strictEqual(detectOtherAirport('I am at Dubai airport, going home to Riyadh').code, 'DXB');
  assert.strictEqual(detectOtherAirport('I am flying to Dubai'), null);
  assert.strictEqual(detectOtherAirport('flying from Dammam to Abha'), null);
  assert.strictEqual(detectOtherAirport('رحلتي إلى القاهرة'), null);
});

test('at another airport: said once, no Dammam map, links or board', () => {
  let r = say('I am at Abha airport');
  assert.strictEqual(r.session.airport, null);
  assert.ok(/only know Dammam, Riyadh and Jeddah/.test(r.messages[0].text));
  let s = r.session;
  r = say('where is gate 12', s);
  assert.ok(/do not have a map of Abha/.test(r.messages[0].text));
  assert.strictEqual(gatemap.decide({ message: 'where is gate 12', meta: r.meta, session: r.session, lang: 'en', settings: S }), null);
  r = say('show me the map', r.session);
  assert.ok(!/kfia\.sa/.test(r.messages.map((m) => m.text).join(' ')), 'no Dammam links at Abha');
  r = say('my flight is cancelled', r.session);
  assert.ok(/cannot read the departure board at Abha/.test(r.messages[0].text));
  r = say('where is my gate', r.session);
  assert.ok(!r.messages.some((m) => /only know Dammam/.test(m.text)), 'the note is said once');
});

test('naming a supported airport afterwards switches back', () => {
  let r = say('I am at Abha airport');
  r = say('sorry, I am at Riyadh actually', r.session);
  assert.strictEqual(r.session.airport, 'ruh');
  assert.strictEqual(r.session.otherAirport, null);
  r = say('where is gate 105A', r.session);
  assert.ok(gatemap.decide({ message: 'where is gate 105A', meta: r.meta, session: r.session, lang: 'en', settings: S }).exact);
});

test('no flight watch and no Dammam weather at another airport', async () => {
  const w = await watch.poll({ session: { flight: 'SV1', otherAirport: { code: 'AHB' } }, findFlight: async () => ({ ok: true, flight: {} }) });
  assert.strictEqual(w.code, 'NOT_SUPPORTED');
  const rep = await weather.report({ airport: 'HAS' });       // Hail: not in the forecast list
  assert.strictEqual(rep.code, 'UNKNOWN_AIRPORT');
  assert.ok(/do not have a weather forecast for this airport/.test(weather.toText(rep, 'en')));
});

test('Arabic: Abha note in Arabic', () => {
  const r = say('أنا في مطار أبها', {}, 'ar');
  assert.ok(/ليست عندي معلومات خاصة بمطار أبها/.test(r.messages[0].text));
});

// ------------------------------------------------------------- translations

test('Arabic table has every key the English table has', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'chat.js'), 'utf8');
  const block = src.match(/var STRINGS = (\{[\s\S]*?\n  \});/)[1];
  // eslint-disable-next-line no-eval
  const STR = eval('(' + block + ')');
  const unused = ['ticketFirst', 'ticketSkip'];   // never shown
  const missing = Object.keys(STR.en).filter((k) => !(k in STR.ar) && !unused.includes(k));
  assert.deepStrictEqual(missing, []);
});

// -------------------------------------------------------- through the server

function startServer() {
  return new Promise((resolve, reject) => {
    const port = 18000 + Math.floor(Math.random() * 2000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-'));
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
      env: Object.assign({}, process.env, { PORT: String(port), FG_DATA_DIR: dir, LLM_ENABLED: '0', OPENAI_API_KEY: '',
        FG_SKIP_BOOT_TESTS: '1', FG_DMM_FEED_URL: 'http://127.0.0.1:9/none' }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const timer = setTimeout(() => reject(new Error('server did not start')), 60000);
    child.stdout.on('data', (d) => {
      if (/listening|http:\/\//i.test(String(d))) { clearTimeout(timer); resolve({ child, base: 'http://127.0.0.1:' + port }); }
    });
  });
}

async function chat(base, sid, message, lang) {
  const r = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, lang: lang || 'en', profile: 'adult', sessionId: sid }) });
  return r.json();
}

test('server: only the safety warning is red, not every reply near boarding', async (srv) => {
  const sid = 'red-' + Date.now();
  const a = await chat(srv.base, sid, 'I am at Dammam, 30 minutes to boarding');
  const red = a.messages.filter((m) => m.urgent);
  assert.strictEqual(red.length, 1, JSON.stringify(a.messages));
  assert.ok(/boarding is close/i.test(red[0].text));
  const b = await chat(srv.base, sid, 'terminal 1');
  assert.ok(b.meta.escalated, 'still within the escalation window');
  assert.ok(b.messages.every((m) => !m.urgent), 'the next reply is not red');
});

test('server: history returns everything a reloaded chat needs', async (srv) => {
  const sid = 'reload-' + Date.now();
  await chat(srv.base, sid, 'I am at Riyadh, flight SV123, terminal 3');
  await chat(srv.base, sid, 'where is gate 105A');
  const h = await (await fetch(srv.base + '/api/history/' + sid)).json();
  assert.ok(h.ok);
  assert.strictEqual(h.history.length, 4);
  assert.strictEqual(h.airport, 'ruh');
  assert.strictEqual(h.gate, '105A');
  assert.strictEqual(h.flight, 'SV123');
  assert.strictEqual(h.terminal, '3');
});

(async () => {
  let srv = null;
  try {
    for (const { name, fn } of queue) {
      try {
        if (fn.length && !srv) srv = await startServer();
        await fn(srv);
        passed++; console.log('  ok   ' + name);
      } catch (err) {
        failed++; console.log('  FAIL ' + name); console.log('       ' + String(err && err.message).split('\n')[0]);
      }
    }
  } finally {
    if (srv) srv.child.kill();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed — improvements');
  process.exit(failed ? 1 : 0);
})();
