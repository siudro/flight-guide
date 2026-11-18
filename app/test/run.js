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
test('asks the airport question before giving any directions', () => {
  const { transcript } = converse(['hello']);
  const out = text(transcript[0]);
  assert.ok(/which airport/i.test(out), 'expected an airport question');
  assert.ok(!/security screening|passport control/i.test(out), 'must not give directions yet');
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

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) {
  for (const f of failures) console.error(`\n${f.name}\n${f.err.stack}`);
  process.exit(1);
}
