'use strict';

/**
 * Gate map + voice messages.
 *
 *   node test/gate-map-voice.js
 *
 * The voice tests talk to a fake Cohere server on localhost, so they need no
 * key and no network. They check what we SEND (model, language, a real WAV)
 * as much as what we do with the answer.
 */

const assert = require('assert');
const http = require('http');

const { generateReply } = require('../src/engine');
const { sanitize } = require('../src/store');
const gatemap = require('../src/gatemap');

let passed = 0;
let failed = 0;
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }

const S = sanitize({});
function turn(message, session, lang) {
  const r = generateReply({ message, lang: lang || 'en', profile: 'adult', session: session || {}, settings: S });
  const map = gatemap.decide({ message, meta: r.meta, session: r.session, lang: r.meta.lang, settings: S });
  return { r, map, text: r.messages.map((m) => m.text).join('\n\n') };
}

// --------------------------------------------------------------- gate map --

test('"where is my gate" is a gate question, "what is a gate" is not', () => {
  assert.ok(gatemap.isGateQuestion('Where is my gate?'));
  assert.ok(gatemap.isGateQuestion('how do I get to gate 404'));
  assert.ok(gatemap.isGateQuestion('which gate do I go to'));
  assert.ok(gatemap.isGateQuestion('وين بوابتي؟'));
  assert.ok(gatemap.isGateQuestion('أين البوابة رقم ٣٠٢'));
  assert.ok(gatemap.isGateQuestion('كيف أوصل للبوابة'));
  assert.ok(!gatemap.isGateQuestion('what is a gate'));
  assert.ok(!gatemap.isGateQuestion('وش يعني بوابة'));
  assert.ok(!gatemap.isGateQuestion('I am at Dammam terminal 1'));
});

test('Riyadh gate is pinned exactly, with its floor', () => {
  const { r, map, text } = turn('where is gate 105A', { airport: 'ruh' });
  assert.strictEqual(r.meta.stageKey, 'findgate');
  assert.ok(map && map.exact, 'expected an exact pin');
  assert.strictEqual(map.gate, '105A');
  assert.strictEqual(map.pins.filter((p) => p.kind === 'target').length, 1);
  assert.ok(/Level/.test(map.floor));
  assert.ok(/pinned it on the map/.test(text));
});

test('Arabic: Arabic digits and "رقم" find the gate, floor is in Arabic', () => {
  const { r, map, text } = turn('أين البوابة رقم ٣٠٢', { airport: 'ruh' }, 'ar');
  assert.strictEqual(r.session.gate, '302');
  assert.ok(map.exact);
  assert.ok(/الطابق/.test(map.floor), map.floor);
  assert.ok(/الطابق/.test(text), 'reply should name the floor in Arabic');
});

test('gate numbers: "it is 401", lettered "B7", Arabic "١٠٩ب", colloquial "الجيت"', () => {
  assert.strictEqual(turn('show me my gate, it is 401', { airport: 'ruh' }).map.gate, '401');
  assert.strictEqual(turn('where is gate B7', { airport: 'dmm' }).map.gate, 'B7');
  const ar = turn('كيف أوصل لبوابة ١٠٩ب', { airport: 'ruh' }, 'ar');
  assert.ok(ar.map.exact && ar.map.gate === '109B', JSON.stringify(ar.map.gate));
  assert.strictEqual(turn('وين الجيت 105A', { airport: 'ruh' }, 'ar').map.gate, '105A');
  assert.strictEqual(turn('البوابة 302 وين؟', { airport: 'ruh' }, 'ar').map.gate, '302');
  // "ب" starting the next word is not the gate's letter.
  assert.strictEqual(turn('بوابتي 302 بالطابق الثاني', { airport: 'ruh' }, 'ar').r.session.gate, '302');
  assert.strictEqual(turn('my gate is in 20 minutes').r.session.gate, null);
});

test('Dammam never gets a guessed gate pin', () => {
  const { map, text } = turn('where is my gate', { airport: 'dmm', gate: '14' });
  assert.ok(map);
  assert.strictEqual(map.exact, false);
  assert.strictEqual(map.pins.length, 1);
  assert.strictEqual(map.pins[0].kind, 'airport');
  assert.ok(/kfia\.sa/.test(map.officialMap));
  assert.ok(/will not guess/.test(text));
});

test('unknown gate: asks for it, still shows the airport', () => {
  const { map, text } = turn('where is my gate');
  assert.strictEqual(map.airport, 'dmm');
  assert.strictEqual(map.gate, null);
  assert.ok(/do not know your gate/.test(text));
});

test('Jeddah has no official map link, so the card never points to one', () => {
  const j = gatemap.build('jed', '22', 'en');
  assert.strictEqual(j.officialMap, null);
  assert.ok(!/airport's own map/.test(j.note) && /ask any staff/.test(j.note), j.note);
  assert.ok(/اسأل أي موظف/.test(gatemap.build('jed', '22', 'ar').note));
  assert.ok(/own map/.test(gatemap.build('dmm', '22', 'en').note));
});

test('Riyadh gate missing from the data is said plainly, not pinned', () => {
  const { map } = turn('where is gate 999', { airport: 'ruh' });
  assert.strictEqual(map.exact, false);
  assert.ok(map.pins.every((p) => p.kind === 'gate'));
  assert.ok(/not in our map data/.test(map.note));
});

test('a gate change with the new gate carries the map', () => {
  const { r, map } = turn('my gate changed to 404', { airport: 'ruh' });
  assert.strictEqual(r.meta.stageKey, 'gatechange');
  assert.ok(map && map.exact && map.gate === '404');
});

test('a gate change WITHOUT the number has no map', () => {
  const { map } = turn('my gate changed', { airport: 'ruh' });
  assert.strictEqual(map, null);
});

test('ordinary onboarding turns have no map', () => {
  assert.strictEqual(turn('I am at Dammam terminal 1').map, null);
  assert.strictEqual(turn('45 minutes').map, null);
});

test('admin "hide map" switch also hides the chat map', () => {
  const hidden = sanitize({ mapVisible: false });
  const r = generateReply({ message: 'where is gate 105A', lang: 'en', profile: 'adult', session: { airport: 'ruh' }, settings: hidden });
  assert.strictEqual(gatemap.decide({ message: 'where is gate 105A', meta: r.meta, session: r.session, lang: 'en', settings: hidden }), null);
});

test('the model is told what the map does and does not show', () => {
  assert.ok(/pinned/.test(gatemap.describeForModel(gatemap.build('ruh', '105A', 'en'))));
  assert.ok(/does NOT pin/.test(gatemap.describeForModel(gatemap.build('dmm', '14', 'en'))));
});

// ------------------------------------------------------------------ voice --

function wav(seconds) {
  const rate = 16000;
  const n = Math.round(rate * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}

function fakeCohere(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const srv = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('latin1');
        seen.push({ auth: req.headers.authorization, type: req.headers['content-type'], body });
        handler(req, res, body);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, seen, url: 'http://127.0.0.1:' + srv.address().port + '/v2/audio/transcriptions' }));
  });
}

function freshVoice(env) {
  for (const k of ['COHERE_API_KEY', 'COHERE_TRANSCRIBE_URL', 'COHERE_TRANSCRIBE_MODEL', 'VOICE_ENABLED']) delete process.env[k];
  Object.assign(process.env, env);
  delete require.cache[require.resolve('../src/voice')];
  return require('../src/voice');
}

test('voice is off without COHERE_API_KEY', async () => {
  const voice = freshVoice({});
  assert.strictEqual(voice.config().enabled, false);
  const out = await voice.transcribe({ audio: wav(1), lang: 'en' });
  assert.strictEqual(out.code, 'NOT_CONFIGURED');
});

test('sends model, language and a WAV file to Cohere; returns the text', async () => {
  const fake = await fakeCohere((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: ' where is my gate ' }));
  });
  try {
    const voice = freshVoice({ COHERE_API_KEY: 'co-test-key', COHERE_TRANSCRIBE_URL: fake.url });
    const out = await voice.transcribe({ audio: wav(1), lang: 'ar' });
    assert.ok(out.ok, JSON.stringify(out));
    assert.strictEqual(out.text, 'where is my gate');
    const s = fake.seen[0];
    assert.strictEqual(s.auth, 'Bearer co-test-key');
    assert.ok(/multipart\/form-data/.test(s.type));
    assert.ok(/name="model"\r\n\r\ncohere-transcribe-03-2026/.test(s.body));
    assert.ok(/name="language"\r\n\r\nar/.test(s.body));
    assert.ok(/name="file"; filename="voice\.wav"/.test(s.body));
    assert.ok(s.body.includes('RIFF'));
  } finally { fake.srv.close(); }
});

test('a rejected key is reported as BAD_KEY, not thrown', async () => {
  const fake = await fakeCohere((req, res) => { res.writeHead(401); res.end('{"message":"invalid api token"}'); });
  try {
    const voice = freshVoice({ COHERE_API_KEY: 'bad', COHERE_TRANSCRIBE_URL: fake.url });
    const out = await voice.transcribe({ audio: wav(1), lang: 'en' });
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.code, 'BAD_KEY');
  } finally { fake.srv.close(); }
});

test('silence comes back as NO_SPEECH', async () => {
  const fake = await fakeCohere((req, res) => { res.writeHead(200); res.end('{"text":""}'); });
  try {
    const voice = freshVoice({ COHERE_API_KEY: 'k', COHERE_TRANSCRIBE_URL: fake.url });
    assert.strictEqual((await voice.transcribe({ audio: wav(1), lang: 'en' })).code, 'NO_SPEECH');
  } finally { fake.srv.close(); }
});

test('junk bytes are refused before any API call', async () => {
  const voice = freshVoice({ COHERE_API_KEY: 'k', COHERE_TRANSCRIBE_URL: 'http://127.0.0.1:9/never' });
  assert.strictEqual((await voice.transcribe({ audio: Buffer.alloc(5000, 7), lang: 'en' })).code, 'BAD_AUDIO');
  assert.strictEqual((await voice.transcribe({ audio: Buffer.alloc(10), lang: 'en' })).code, 'NO_AUDIO');
});

(async () => {
  for (const { name, fn } of queue) {
    try {
      await fn();
      passed++;
      console.log('  ok   ' + name);
    } catch (err) {
      failed++;
      console.log('  FAIL ' + name);
      console.log('       ' + String(err && err.message).split('\n')[0]);
    }
  }
  freshVoice({});
  console.log('\n' + passed + ' passed, ' + failed + ' failed — gate map + voice');
  process.exit(failed ? 1 : 0);
})();
