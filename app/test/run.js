'use strict';

/**
 * Flight Guide — engine tests.
 *
 * Plain Node, no test framework (the app has no dependencies, so neither do
 * its tests). Run with: npm test  /  node test/run.js
 *
 * These assert the behaviours the WAI-199 acceptance criteria name:
 * onboarding before advice, six-stage flow, profile wording differences,
 * Arabic RTL output, and the escalation threshold.
 */

const assert = require('assert');
const { generateReply } = require('../src/engine');
const { sanitize } = require('../src/store');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message.split('\n')[0]}`);
  }
}

function settings(overrides) {
  return sanitize(overrides || {});
}

/** Runs a list of turns through the engine, carrying session forward. */
function converse(turns, opts) {
  // `opts.settings` may already be an effective settings object — do not
  // re-sanitize it, or the override shape gets flattened twice.
  const s = (opts && opts.settings) || settings();
  let session = (opts && opts.session) || {};
  const transcript = [];
  for (const turn of turns) {
    const res = generateReply({
      message: turn.message || turn,
      lang: turn.lang || (opts && opts.lang) || 'en',
      langLocked: turn.langLocked === true || (opts && opts.langLocked) === true,
      profile: (turn.profile) || (opts && opts.profile) || 'nervous',
      session,
      settings: s
    });
    session = res.session;
    transcript.push(res);
  }
  return { transcript, session };
}

const text = (res) => res.messages.map((m) => m.text).join('\n\n');

console.log('\nonboarding');
// WAI-246: the airport is Dammam, assumed. Asking was the most-repeated
// complaint — a traveller had to say "I am at Dammam" twice before live data
// appeared. This replaces the old test that asserted the question existed.
test('never asks which airport — Dammam is assumed', () => {
  const { transcript, session } = converse(['hello']);
  const out = text(transcript[0]);
  assert.ok(!/which airport/i.test(out), 'must not ask for the airport');
  assert.ok(!/Dammam, Riyadh|Riyadh, Jeddah|الرياض أم جدة/i.test(out), 'must not offer other airports');
  assert.strictEqual(session.airport, 'dmm', 'Dammam is assumed silently');
});

test('directions are answered with the airport link, not a question', () => {
  const { transcript, session } = converse(['where do I go']);
  const out = text(transcript[0]);
  assert.ok(/kfia\.sa/.test(out), 'expected the airport link immediately');
  assert.ok(!/which airport/i.test(out), 'a directions request must not be gated on a question');
  assert.strictEqual(transcript[0].meta.intent, 'directions');
  assert.strictEqual(session.airport, 'dmm');
});

test('never re-asks a fact already given', () => {
  const { transcript } = converse(['I am at Dammam airport']);
  const out = text(transcript[0]);
  assert.ok(/terminal/i.test(out), 'should move on to terminal');
  assert.ok(!/which airport/i.test(out), 'should not ask airport again');
});

test('collects all four onboarding facts before the first stage', () => {
  const { transcript, session } = converse([
    'I am at Dammam, terminal 1, 90 minutes until boarding, and I have a bag to check in'
  ]);
  assert.strictEqual(session.airport, 'dmm');
  assert.ok(session.terminal, 'terminal parsed');
  assert.strictEqual(session.minutes, 90);
  assert.strictEqual(session.bags, 'checked');
  assert.strictEqual(transcript[0].meta.stageKey, 'checkin', 'should now give stage 1');
});

console.log('\nsix-stage flow');
test('advances checkin -> security -> passport -> customs -> gate -> boarding', () => {
  const { transcript } = converse(['Dammam terminal 1, 120 minutes, carry-on only'], {});
  const keys = [transcript[0].meta.stageKey];
  for (let i = 0; i < 6; i++) {
    const r = generateReply({
      message: 'done',
      lang: 'en',
      profile: 'adult',
      session: Object.assign({}, transcript[0].session, { stage: keys.length - 1 }),
      settings: settings({})
    });
    keys.push(r.meta.stageKey);
  }
  const uniq = keys.filter((k, i) => keys.indexOf(k) === i);
  assert.deepStrictEqual(uniq.slice(0, 6), ['checkin', 'security', 'passport', 'customs', 'gate', 'boarding']);
});

test('never dumps all six stages in one message', () => {
  const { transcript } = converse(['Dammam, terminal 1, 90 minutes, one bag']);
  const out = text(transcript[0]).toLowerCase();
  const mentioned = ['security', 'passport', 'customs', 'boarding gate'].filter((k) => out.includes(k));
  assert.ok(mentioned.length <= 1, `one message mentioned ${mentioned.join(', ')}`);
});

test('gate change is handled as its own branch', () => {
  const { transcript } = converse(['Dammam, terminal 1, 120 minutes, carry-on', 'my gate changed to 404'], { profile: 'adult' });
  const last = transcript[transcript.length - 1];
  assert.strictEqual(last.meta.stageKey, 'gatechange');
  assert.ok(/404/.test(text(last)), 'should repeat the new gate');
});

test('a gate change with no number asks instead of inventing one', () => {
  const { transcript } = converse(['Dammam, terminal 1, 120 minutes, carry-on', 'my gate changed'], { profile: 'adult' });
  const last = transcript[transcript.length - 1];
  assert.strictEqual(last.session.awaitingGate, true);
  assert.ok(/what is the new gate number/i.test(text(last)), 'must ask for the gate');
  assert.ok(!/120/.test(text(last)), 'must not reuse the minutes figure as a gate');
});

test('the follow-up number becomes the gate, not the wait', () => {
  const { transcript } = converse(
    ['Dammam, terminal 1, 120 minutes, carry-on', 'my gate changed', '404'],
    { profile: 'adult' }
  );
  const last = transcript[transcript.length - 1];
  assert.strictEqual(last.session.gate, '404');
  assert.strictEqual(last.session.minutes, 120, 'minutes must not be overwritten by the gate');
  assert.ok(/404/.test(text(last)));
  assert.strictEqual(last.session.awaitingGate, false);
});

console.log('\nprofiles');
test('the three profiles produce three different messages for the same input', () => {
  const base = ['Dammam, terminal 1, 90 minutes, one bag'];
  const a = text(converse(base, { profile: 'nervous' }).transcript[0]);
  const b = text(converse(base, { profile: 'adult' }).transcript[0]);
  const c = text(converse(base, { profile: 'hurried' }).transcript[0]);
  assert.notStrictEqual(a, b, 'nervous vs adult must differ');
  assert.notStrictEqual(b, c, 'adult vs hurried must differ');
  assert.notStrictEqual(a, c, 'nervous vs hurried must differ');
  assert.ok(a.length > b.length, 'nervous should say more than adult');
  // Hurried is not "shorter in characters" — it drops all filler but gives the
  // next action too, so it covers two steps in roughly one step's worth of words.
  assert.ok(!/Take a breath|you're doing fine/i.test(c), 'hurried must carry no reassurance');
  assert.ok(!/Confirm you are through/i.test(c), 'hurried must carry no closing prompt');
  assert.ok(/^Then:/m.test(c), 'hurried should hand over the following action');
});

test('a profile disabled in admin is not used', () => {
  const s = settings({ profilesEnabled: { nervous: false } });
  const res = generateReply({
    message: 'Dammam, terminal 1, 90 minutes, one bag',
    lang: 'en',
    profile: 'nervous',
    session: {},
    settings: s
  });
  assert.notStrictEqual(res.meta.profile, 'nervous');
  assert.ok(res.meta.profile === 'adult' || res.meta.profile === 'hurried');
});

console.log('\nlanguage');
test('an Arabic message produces Arabic output', () => {
  const { transcript } = converse(['أنا في الدمام']);
  const out = text(transcript[0]);
  assert.ok(/[\u0600-\u06FF]/.test(out), 'reply should contain Arabic');
  assert.strictEqual(transcript[0].meta.lang, 'ar');
});

test('Arabic typed into an English UI answers in English when the traveller pinned EN', () => {
  // A traveller may read Arabic but want the app in English, or be stuck on an
  // Arabic keyboard. Pressing EN is an explicit choice and must win over
  // script detection -- otherwise there was no way to keep replies in English.
  const { transcript } = converse(['مرحبا، بوابتي تغيرت، ماذا أفعل الآن؟'],
    { lang: 'en', langLocked: true });
  const out = text(transcript[0]);
  assert.strictEqual(transcript[0].meta.lang, 'en', 'pinned language must win over script');
  const arabic = (out.match(/[\u0600-\u06FF]/g) || []).length;
  assert.strictEqual(arabic, 0, `English reply contained Arabic: ${out.slice(0, 80)}`);
});

test('Arabic typed into an unlocked English UI still answers in Arabic', () => {
  // The safety default: an Arabic speaker must never be answered in a language
  // they may not read just because the toggle defaulted to English.
  const { transcript } = converse(['مرحبا، بوابتي تغيرت، ماذا أفعل الآن؟'], { lang: 'en' });
  assert.strictEqual(transcript[0].meta.lang, 'ar');
});

test('Arabic onboarding reply has no Latin body text', () => {
  const { transcript } = converse(['مرحبا']);
  const out = text(transcript[0]);
  const latinWords = out.match(/[A-Za-z]{4,}/g) || [];
  assert.deepStrictEqual(latinWords, [], `found latin words: ${latinWords.join(', ')}`);
});

console.log('\nescalation');
test('under the 60-minute default the reply leads with the staff instruction', () => {
  const { transcript } = converse(['Dammam, terminal 1, 45 minutes, one bag'], { profile: 'adult' });
  const out = text(transcript[0]);
  assert.strictEqual(transcript[0].meta.escalated, true);
  assert.ok(/staff/i.test(out), 'should tell them to find staff');
});

test('comfortable margin does not escalate', () => {
  const { transcript } = converse(['Dammam, terminal 1, 150 minutes, one bag'], { profile: 'adult' });
  assert.strictEqual(transcript[0].meta.escalated, false);
});

test('the admin threshold is honoured', () => {
  const s = settings({ escalateMinutes: 120 });
  const { transcript } = converse(['Dammam, terminal 1, 90 minutes, one bag'], { profile: 'adult', settings: s });
  assert.strictEqual(transcript[0].meta.escalated, true, '90 <= 120 should escalate');
});

console.log('\nnever trap the traveller');
test('a question about a word gets a plain explanation, not a repeat', () => {
  const { transcript } = converse(['what is a terminal'], { profile: 'nervous' });
  const out = text(transcript[0]);
  assert.strictEqual(transcript[0].meta.stageKey, 'explain', 'should be an explanation');
  assert.ok(/main building/i.test(out), 'should explain what a terminal is');
  assert.ok(!/which airport/i.test(out), 'must not just re-ask the airport');
});

test('the same works in Arabic', () => {
  const { transcript } = converse(['وش يعني تيرمنال'], { profile: 'nervous', lang: 'ar' });
  const out = text(transcript[0]);
  assert.strictEqual(transcript[0].meta.stageKey, 'explain');
  assert.ok(/المبنى الرئيسي/.test(out), 'should explain in Arabic');
});

test('everyday airport words are all explained', () => {
  const words = ['what is a boarding pass', 'what does customs mean',
                 'explain passport control', 'what is security'];
  for (const w of words) {
    const { transcript } = converse([w], { profile: 'adult' });
    assert.strictEqual(transcript[0].meta.stageKey, 'explain', w + ' was not explained');
  }
});

test('free text that matches nothing is acknowledged, never ignored', () => {
  const { transcript } = converse(['I have never travelled before in my life'], { profile: 'nervous' });
  const out = text(transcript[0]);
  assert.ok(/hear you|not going to ignore/i.test(out), 'must acknowledge the person');
});

test('a scared traveller is reassured before being questioned', () => {
  const { transcript } = converse(['I am really scared about flying alone'], { profile: 'nervous' });
  const out = text(transcript[0]);
  assert.ok(/normal way to feel|completely normal/i.test(out), 'should normalise the feeling');
});

test('typing is never blocked by the onboarding questions', () => {
  // Any message gets a reply, whatever it says.
  const messages = ['hello', 'x', 'I do not understand', 'بصراحة ما أدري', '12345'];
  for (const m of messages) {
    const { transcript } = converse([m], { profile: 'nervous' });
    assert.ok(transcript[0].messages.length > 0, 'no reply to: ' + m);
  }
});

console.log('\nno repetition');
test('the escalation warning is shown once, not on every turn', () => {
  const { transcript } = converse(
    ['Dammam, terminal 1, 45 minutes', 'carry-on only', 'done', 'done'],
    { profile: 'nervous' }
  );
  const all = transcript.map(text).join(' ');
  const n = (all.match(/Your boarding is close/g) || []).length;
  assert.strictEqual(n, 1, 'warning appeared ' + n + ' times');
});

test('the reassurance line is shown once', () => {
  const { transcript } = converse(['hello', 'Dammam', 'terminal 1'], { profile: 'nervous' });
  const all = transcript.map(text).join(' ');
  const n = (all.match(/nothing here to worry about/g) || []).length;
  assert.strictEqual(n, 1, 'reassurance appeared ' + n + ' times');
});

test('consecutive stage messages do not open with the same words', () => {
  const { transcript } = converse(
    ['Dammam, terminal 1, 200 minutes, one bag', 'done', 'done', 'done'],
    { profile: 'nervous' }
  );
  const opens = transcript.slice(1).map(r => r.messages[0].text.split(' ').slice(0,4).join(' '));
  for (let i = 1; i < opens.length; i++) {
    assert.notStrictEqual(opens[i], opens[i-1], 'turn ' + i + ' repeated the opener: ' + opens[i]);
  }
});

test('escalation still escalates — suppression is display-only', () => {
  const { transcript } = converse(['Dammam, terminal 1, 45 minutes', 'carry-on only'], { profile: 'adult' });
  assert.strictEqual(transcript[0].meta.escalated, true);
  assert.strictEqual(transcript[1].meta.escalated, true, 'still knows boarding is close');
});

console.log('\nLLM layer (no network)');
// These run offline: they exercise prompt assembly, key resolution and the
// safety check, none of which should need a provider. That is deliberate — the
// suite must pass on a laptop with no key and no internet.
test('the .env parser reads real pairs and skips blanks', () => {
  const { parse } = require('../src/env');
  const out = parse([
    '# a comment',
    'OPENAI_API_KEY=sk-abc',
    'EMPTY=',
    'QUOTED="a b"',
    'LLM_ENABLED=1'
  ].join('\n'));
  assert.strictEqual(out.OPENAI_API_KEY, 'sk-abc');
  assert.strictEqual(out.QUOTED, 'a b');
  assert.strictEqual(out.LLM_ENABLED, '1');
  assert.ok(!('EMPTY' in out), 'an empty value must be skipped');
  assert.ok(!('a comment' in out), 'comments must be skipped');
});

test('prompt versions are ordered and the active one exists', () => {
  const prompts = require('../src/prompts');
  assert.ok(prompts.PROMPT_VERSIONS.length >= 2, 'keep a history, do not overwrite');
  const versions = prompts.PROMPT_VERSIONS.map((v) => v.version);
  for (let i = 1; i < versions.length; i++) {
    assert.ok(versions[i] > versions[i - 1], 'versions must increase');
  }
  assert.ok(versions.includes(prompts.ACTIVE_VERSION), 'ACTIVE must be a real version');
  for (const v of prompts.PROMPT_VERSIONS) {
    assert.ok(v.note && v.note.length > 8, 'version ' + v.version + ' needs a change note');
  }
});

test('a prompt always carries the language and the no-invention rule', () => {
  const prompts = require('../src/prompts');
  for (const lang of ['en', 'ar']) {
    const built = prompts.build({ lang, context: { stageName: 'check-in' } });
    assert.ok(/Answer in (English|Arabic)/.test(built.text), 'missing language instruction');
    assert.ok(/NEVER invent a gate/.test(built.text), 'missing the no-invention rule');
    assert.ok(built.version >= 1);
    assert.ok(built.chars > 200);
    assert.ok(built.segments.length >= 3);
  }
});

test('a prompt includes ticket and status only when they exist', () => {
  const prompts = require('../src/prompts');
  const bare = prompts.build({ lang: 'en', context: {} });
  assert.ok(!/READ FROM THEIR TICKET PHOTO/.test(bare.text), 'no ticket means no ticket section');

  const withTicket = prompts.build({
    lang: 'en',
    context: {},
    ticket: { flight: 'SV1234', gate: 'B12', seat: '14A' },
    status: { delayMinutes: 40 }
  });
  assert.ok(/SV1234/.test(withTicket.text));
  assert.ok(/14A/.test(withTicket.text));
  assert.ok(/CURRENT FLIGHT STATUS/.test(withTicket.text));
  assert.ok(/delayed by about 40 minutes/.test(withTicket.text));
});

test('key resolution prefers the environment and reports its source', () => {
  const llm = require('../src/llm');
  const prev = process.env.OPENAI_API_KEY;

  try {
    delete process.env.OPENAI_API_KEY;
    let cfg = llm.resolveConfig({ ai: { provider: 'openai', apiKey: 'sk-from-admin', enabled: true } });
    assert.strictEqual(cfg.source, 'admin');
    assert.strictEqual(cfg.apiKey, 'sk-from-admin');

    process.env.OPENAI_API_KEY = 'sk-from-env';
    cfg = llm.resolveConfig({ ai: { provider: 'openai', apiKey: 'sk-from-admin', enabled: true } });
    assert.strictEqual(cfg.source, 'env', 'the environment must win');
    assert.strictEqual(cfg.apiKey, 'sk-from-env');

    delete process.env.OPENAI_API_KEY;
    cfg = llm.resolveConfig({ ai: { provider: 'openai' } });
    assert.strictEqual(cfg.configured, false);
  } finally {
    if (prev === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prev;
  }
});

test('the key is never logged in full', () => {
  const llm = require('../src/llm');
  const key = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
  const masked = llm.mask(key);
  assert.ok(!masked.includes('abcdefghij'), 'the middle of the key must be hidden');
  assert.ok(masked.startsWith('sk-pro'));
  assert.ok(masked.length < key.length);
});

test('an invented gate is rejected before it reaches the traveller', () => {
  const { _internal } = require('../src/llm');
  // No gate known: any gate claim is a fabrication.
  assert.ok(_internal.looksUnsafe('Go to gate B12 now.', {}), 'must reject with no known gate');
  // Known gate B12: saying B12 is fine, saying C44 is not.
  assert.strictEqual(_internal.looksUnsafe('Go to gate B12 now.', { gate: 'B12' }), null);
  assert.ok(_internal.looksUnsafe('Go to gate C44 now.', { gate: 'B12' }), 'must reject a different gate');
  // The Arabic form must be caught too.
  assert.ok(_internal.looksUnsafe('اذهب إلى بوابة C44', { gate: 'B12' }), 'must reject in Arabic');
});

test('ticket JSON is parsed and never invents fields', () => {
  const { _internal } = require('../src/llm');
  const ok = _internal.parseTicketJson('{ "flight": "SV123", "gate": "B12", "seat": null }');
  assert.strictEqual(ok.flight, 'SV123');
  assert.strictEqual(ok.gate, 'B12');
  assert.ok(!('seat' in ok), 'nulls must be dropped, not guessed');
  assert.strictEqual(_internal.parseTicketJson('I cannot read this'), null);
});

test('the rule engine still decides when the model is unavailable', () => {
  // With no key configured, generateReply must be untouched: the app never
  // depends on the network to answer.
  const prev = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    const { transcript, session } = converse(['Dammam, terminal 1, 120 minutes, carry-on']);
    assert.strictEqual(session.airport, 'dmm');
    assert.strictEqual(transcript[0].meta.stageKey, 'checkin');
  } finally {
    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
  }
});

console.log('\nairport honesty');
test('Jeddah answers carry an explicit unverified warning', () => {
  const { transcript } = converse(['Jeddah, terminal 1, 120 minutes, one bag'], { profile: 'adult' });
  assert.ok(/not verified|check the signs/i.test(text(transcript[0])));
});

test('Riyadh answers are marked partially verified', () => {
  const { transcript } = converse(['Riyadh, terminal 5, 120 minutes, one bag'], { profile: 'adult' });
  assert.ok(/partially verified|confirm on the signs/i.test(text(transcript[0])));
});

console.log('\nadmin-edited guidance');
test('edited stage text reaches the reply', () => {
  const s = settings({ stages: { checkin: { guidance_en: 'CUSTOM CHECKIN TEXT', enabled: true } } });
  const { transcript } = converse(['Dammam, terminal 1, 120 minutes, one bag'], { profile: 'adult', settings: s });
  assert.ok(/CUSTOM CHECKIN TEXT/.test(text(transcript[0])));
});

test('a disabled stage is skipped in the flow', () => {
  const s = settings({ stages: { security: { enabled: false } } });
  const { transcript } = converse(['Dammam, terminal 1, 120 minutes, one bag'], { profile: 'adult', settings: s });
  const second = generateReply({
    message: 'done', lang: 'en', profile: 'adult',
    session: transcript[0].session, settings: s
  });
  assert.notStrictEqual(second.meta.stageKey, 'security');
});

console.log('\ndeterminism');
test('the same input produces the same output twice', () => {
  const a = text(converse(['Dammam, terminal 1, 90 minutes, one bag'], { profile: 'adult' }).transcript[0]);
  const b = text(converse(['Dammam, terminal 1, 90 minutes, one bag'], { profile: 'adult' }).transcript[0]);
  assert.strictEqual(a, b);
});

console.log('\nflight number parsing');

// A real ticket photographed by a traveller printed "XY-811". The parser only
// stripped whitespace, so the dash broke it, the live lookup silently skipped,
// and the agent told the traveller it could not see flight status. These lock
// every format a real ticket actually uses.
const status = require('../src/status');
const digits = status._internal.flightDigits;

test('parses the dashed format printed on tickets', () => {
  const r = digits('XY-811');
  assert.strictEqual(r.airline, 'XY');
  assert.strictEqual(r.number, '811');
});

test('parses letter+digit airline codes with a dash', () => {
  const r = digits('F3-123');
  assert.strictEqual(r.airline, 'F3');
  assert.strictEqual(r.number, '123');
});

test('parses digit+letter airline codes with a dash', () => {
  const r = digits('3O-123');
  assert.strictEqual(r.airline, '3O');
  assert.strictEqual(r.number, '123');
});

test('all common flight-number spellings agree', () => {
  const want = { airline: 'XY', number: '811' };
  for (const raw of ['XY811', 'XY-811', 'XY 811', 'xy811', ' xy - 811 ']) {
    const r = digits(raw);
    assert.strictEqual(r.airline, want.airline, 'airline for ' + raw);
    assert.strictEqual(r.number, want.number, 'number for ' + raw);
  }
});

test('a bare number still resolves', () => {
  const r = digits('811');
  assert.strictEqual(r.airline, null);
  assert.strictEqual(r.number, '811');
});

test('nonsense does not claim a flight number', () => {
  assert.strictEqual(digits('hello').number, null);
  assert.strictEqual(digits('').number, null);
});

console.log('\ndefault airport');

// Dammam is the only airport with a live feed. A traveller who states a flight
// number but not an airport must still get live data — requiring "I am at
// Dammam" first was the most common complaint on the live site.
test('DMM is the default airport when nothing is stated', () => {
  const status = require('../src/status');
  assert.strictEqual(status.normalizeAirport('dmm'), 'dmm');
  // And the server must resolve an empty airport to dmm, not to null.
  const src = require('fs').readFileSync(__dirname + '/../src/server.js', 'utf8');
  assert.ok(
    /\|\|\s*'dmm';/.test(src),
    'server must fall back to dmm when no airport is known'
  );
});

test('only Dammam has a live feed', () => {
  const status = require('../src/status');
  assert.strictEqual(status.FEEDS.dmm.supported, true);
  assert.strictEqual(status.FEEDS.ruh.supported, false);
  assert.strictEqual(status.FEEDS.jed.supported, false);
});

console.log('\nshareable transcript');

// A WAICY submission needs a LINK a judge can open, not raw JSON. These guard
// the route that renders the conversation as a plain HTML page.
test('a transcript route exists and renders HTML', () => {
  const src = require('fs').readFileSync(__dirname + '/../src/server.js', 'utf8');
  assert.ok(src.includes("p.indexOf('/transcript/') === 0"),
    'server must serve /transcript/:sessionId');
  assert.ok(src.includes('function sendHtml'),
    'server must be able to send an HTML body');
});

test('the transcript keeps enough turns to show the opening', () => {
  const src = require('fs').readFileSync(__dirname + '/../src/server.js', 'utf8');
  const m = src.match(/history\.slice\(-(\d+)\)/);
  assert.ok(m, 'history retention must be explicit');
  // The judged conversation must show its first message, so the cap has to be
  // comfortably above the 10-message minimum.
  assert.ok(Number(m[1]) >= 30, 'history cap too small for a judged transcript: ' + m[1]);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) {
  for (const f of failures) console.error(`\n${f.name}\n${f.err.stack}`);
  process.exit(1);
}
