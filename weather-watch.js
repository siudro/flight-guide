'use strict';

/**
 * Weather heads-up + flight watch.   node test/weather-watch.js
 * Open-Meteo and the airport board are faked on localhost: no network needed.
 */

const assert = require('assert');
const http = require('http');

let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }

function serve(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: 'http://127.0.0.1:' + srv.address().port }));
  });
}

// Hourly rows starting at the current hour, Open-Meteo style ("YYYY-MM-DDTHH:00", GMT).
function hours(n, row) {
  const start = new Date(); start.setUTCMinutes(0, 0, 0);
  const out = { time: [], weather_code: [], visibility: [], wind_gusts_10m: [], precipitation: [], temperature_2m: [], dust: [] };
  for (let i = 0; i < n; i++) {
    const t = new Date(start.getTime() + i * 3600000).toISOString().slice(0, 13) + ':00';
    const r = row(i);
    out.time.push(t);
    out.weather_code.push(r.code != null ? r.code : 0);
    out.visibility.push(r.vis != null ? r.vis : 20000);
    out.wind_gusts_10m.push(r.gusts != null ? r.gusts : 15);
    out.precipitation.push(r.precip || 0);
    out.temperature_2m.push(r.temp != null ? r.temp : 24);
    out.dust.push(r.dust != null ? r.dust : 40);
  }
  return out;
}

function freshWeather(base) {
  process.env.OPENMETEO_FORECAST_URL = base + '/v1/forecast';
  process.env.OPENMETEO_AIR_URL = base + '/v1/air-quality';
  delete require.cache[require.resolve('../src/weather')];
  delete require.cache[require.resolve('../src/engine')];
  return require('../src/weather');
}

// A fake Open-Meteo: Dammam has a dust storm, Dubai fog, everything else calm.
async function fakeMeteo() {
  const seen = [];
  const f = await serve((req, res) => {
    const u = new URL(req.url, 'http://x');
    seen.push(u.pathname + ' ' + u.searchParams.get('latitude'));
    const lat = Number(u.searchParams.get('latitude'));
    let data;
    if (Math.abs(lat - 26.4712) < 0.01) data = hours(30, () => ({ dust: 1400, vis: 2500, gusts: 55, temp: 31 }));
    else if (Math.abs(lat - 25.2532) < 0.01) data = hours(30, (i) => ({ code: i === 3 ? 45 : 1, vis: i === 3 ? 400 : 9000, temp: 22 }));
    else data = hours(30, () => ({}));
    const isAir = u.pathname.includes('air-quality');
    const body = isAir ? { hourly: { time: data.time, dust: data.dust } }
      : { hourly: { time: data.time, weather_code: data.weather_code, visibility: data.visibility,
          wind_gusts_10m: data.wind_gusts_10m, precipitation: data.precipitation, temperature_2m: data.temperature_2m } };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  f.seen = seen;
  return f;
}

// ---------------------------------------------------------------- weather --

test('weather words are recognised; "train" and "window" are not', () => {
  const w = require('../src/weather');
  assert.ok(w.isWeatherQuestion('Will there be a sandstorm?'));
  assert.ok(w.isWeatherQuestion('هل في غبار اليوم'));
  assert.ok(w.isWeatherQuestion('كيف الجو في دبي'));
  assert.ok(!w.isWeatherQuestion('do I take the train'));
  assert.ok(!w.isWeatherQuestion('can I get a window seat'));
  assert.ok(w.isDelayQuestion('will my flight be delayed'));
  assert.ok(!w.isDelayQuestion('I am running late'));
});

test('destinations resolve from codes, English and Arabic names', () => {
  const w = require('../src/weather');
  assert.strictEqual(w.resolvePlace('DXB'), 'DXB');
  assert.strictEqual(w.resolvePlace('DUBAI'), 'DXB');
  assert.strictEqual(w.resolvePlace('القاهرة'), 'CAI');
  assert.strictEqual(w.resolvePlace('ruh'), 'RUH');
  assert.strictEqual(w.resolvePlace('Atlantis'), null);
});

test('hour judging: sandstorm, fog, thunder, calm', () => {
  const { judgeHour } = require('../src/weather')._internal;
  assert.deepStrictEqual(judgeHour({ dust: 1500 }).map((f) => f.key), ['sandstorm']);
  assert.strictEqual(judgeHour({ code: 45 })[0].key, 'fog');
  assert.strictEqual(judgeHour({ code: 95 })[0].level, 2);
  assert.deepStrictEqual(judgeHour({ code: 1, visibility: 20000, gusts: 20, dust: 30 }), []);
});

test('report: dust storm at Dammam, fog in Dubai, both named in the reply', async () => {
  const f = await fakeMeteo();
  try {
    const w = freshWeather(f.base);
    const rep = await w.report({ airport: 'dmm', destination: 'DUBAI' });
    assert.ok(rep.ok);
    assert.strictEqual(rep.level, 2);
    assert.deepStrictEqual(rep.departure.summary.reasons.slice(0, 1), ['sandstorm']);
    assert.ok(rep.destination.summary.reasons.includes('fog'));
    const en = w.toText(rep, 'en');
    assert.ok(/sand or dust storm/.test(en) && /fog/.test(en), en);
    assert.ok(/only the airline decides/.test(en), 'must not promise a delay');
    assert.ok(/عاصفة غبارية/.test(w.toText(rep, 'ar')));
    const card = w.toCard(rep, 'en');
    assert.strictEqual(card.rows.length, 2);
    assert.strictEqual(card.rows[0].role, 'departure');
  } finally { f.srv.close(); }
});

test('unknown destination is said plainly; service down is said plainly', async () => {
  const f = await fakeMeteo();
  try {
    const w = freshWeather(f.base);
    const rep = await w.report({ airport: 'ruh', destination: 'Atlantis' });
    assert.ok(rep.ok && rep.destinationUnknown);
    assert.ok(/do not know it yet/.test(w.toText(rep, 'en')));
  } finally { f.srv.close(); }
  const w2 = freshWeather('http://127.0.0.1:9');
  w2._internal.cache.clear();
  const down = await w2.report({ airport: 'jed' });
  assert.strictEqual(down.ok, false);
  assert.ok(/could not reach the weather service/.test(w2.toText(down, 'en')));
});

test('engine: a weather question is answered from the report, not invented', async () => {
  const f = await fakeMeteo();
  try {
    const w = freshWeather(f.base);
    const { generateReply } = require('../src/engine');
    const { sanitize } = require('../src/store');
    const rep = await w.report({ airport: 'dmm', destination: 'DXB' });
    const r = generateReply({ message: 'is there a sandstorm today?', lang: 'en', profile: 'adult', session: {}, settings: sanitize({}), weather: rep });
    assert.strictEqual(r.meta.stageKey, 'weather');
    assert.ok(/sand or dust storm/.test(r.messages[0].text));
    const none = generateReply({ message: 'is there a sandstorm today?', lang: 'en', profile: 'adult', session: {}, settings: sanitize({}) });
    assert.ok(/could not reach/.test(none.messages[0].text));
  } finally { f.srv.close(); }
});

test('engine: a delay question gets a weather line next to the board link', async () => {
  const f = await fakeMeteo();
  try {
    const w = freshWeather(f.base);
    const { generateReply } = require('../src/engine');
    const { sanitize } = require('../src/store');
    const rep = await w.report({ airport: 'dmm' });
    const r = generateReply({ message: 'will my flight be delayed?', lang: 'en', profile: 'adult', session: {}, settings: sanitize({}), weather: rep });
    const text = r.messages.map((m) => m.text).join('\n');
    assert.ok(/kfia\.sa/.test(text), 'board link kept');
    assert.ok(/\*\*Weather:\*\*/.test(text), 'weather line added');
  } finally { f.srv.close(); }
});

// ------------------------------------------------------------------ watch --

const watch = require('../src/watch');

test('diff: gate, delay (>=10 min), status; small delay changes are ignored', () => {
  const a = { gate: 'A4', status: 'SCHEDULED', delayMinutes: 0 };
  assert.deepStrictEqual(watch.diff(null, a), [], 'first poll is a baseline');
  assert.strictEqual(watch.diff(a, Object.assign({}, a, { gate: 'B7' }))[0].kind, 'gate');
  assert.deepStrictEqual(watch.diff(a, Object.assign({}, a, { delayMinutes: 5 })), []);
  assert.strictEqual(watch.diff(a, Object.assign({}, a, { delayMinutes: 40 }))[0].kind, 'delay');
  const fc = watch.diff(a, Object.assign({}, a, { status: 'FINAL CALL' }));
  assert.ok(fc[0].kind === 'status' && fc[0].urgent);
});

test('poll: baseline first, then announces the change and updates the session', async () => {
  let board = { gate: 'A4', status: 'SCHEDULED', delayMinutes: 0 };
  const findFlight = async () => ({ ok: true, flight: Object.assign({}, board) });
  const session = { flight: 'XY837', airport: 'dmm', gate: 'A4' };
  const first = await watch.poll({ session, lang: 'en', findFlight });
  assert.ok(first.ok && first.baseline && !first.text);
  board = { gate: 'B7', status: 'BOARDING', delayMinutes: 0 };
  const second = await watch.poll({ session, lang: 'en', findFlight });
  assert.ok(second.urgent);
  assert.ok(/gate has changed.*B7/i.test(second.text), second.text);
  assert.strictEqual(session.gate, 'B7');
  assert.ok(session.gateChanged);
  const ar = watch.message(second.changes, 'XY837', 'ar');
  assert.ok(/تغيّرت بوابتك/.test(ar));
  const third = await watch.poll({ session, lang: 'en', findFlight });
  assert.strictEqual(third.text, null, 'no repeat alerts');
});

test('a cancellation sends the traveller to the airline desk, not the gate', () => {
  const en = watch.message([{ kind: 'status', from: 'SCHEDULED', to: 'CANCELLED', urgent: true }], 'XY837', 'en');
  assert.ok(/airline's desk/.test(en) && /Do not go to the gate/.test(en), en);
  const ar = watch.message([{ kind: 'status', from: 'SCHEDULED', to: 'CANCELLED', urgent: true }], 'XY837', 'ar');
  assert.ok(/ملغاة \(CANCELLED\)/.test(ar) && /مكتب شركة الطيران/.test(ar), ar);
});

test('board statuses are translated and keep the board wording', () => {
  assert.strictEqual(watch.statusWords('FINAL CALL', 'ar').label, 'النداء الأخير (FINAL CALL)');
  assert.ok(/Go to the gate now/.test(watch.statusWords('FINAL CALL', 'en').action));
  assert.strictEqual(watch.statusWords('GATE CLOSED', 'en').label, 'Gate closed (GATE CLOSED)');
  assert.strictEqual(watch.statusWords('SOMETHING NEW', 'en').label, 'SOMETHING NEW');
});

test('poll: only Dammam flights, and only with a flight number', async () => {
  const ff = async () => ({ ok: true, flight: {} });
  assert.strictEqual((await watch.poll({ session: { airport: 'dmm' }, findFlight: ff })).code, 'NO_FLIGHT');
  assert.strictEqual((await watch.poll({ session: { flight: 'SV1', airport: 'ruh' }, findFlight: ff })).code, 'NOT_SUPPORTED');
});

(async () => {
  for (const { name, fn } of queue) {
    try { await fn(); passed++; console.log('  ok   ' + name); }
    catch (err) { failed++; console.log('  FAIL ' + name); console.log('       ' + String(err && err.message).split('\n')[0]); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed — weather + flight watch');
  process.exit(failed ? 1 : 0);
})();
