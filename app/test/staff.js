'use strict';

/**
 * Vibe Flight — don't outsource the traveller to staff.
 *
 * Reported 2026-11-24: "you told the user too much airport staff in every
 * reply don't do that."
 *
 * The clinic is right. "Ask a staff member" had become the fallback for every
 * question the app could not answer from data — toilets, restaurants, an
 * unlisted gate. A self-service guide that answers "ask someone else" is not
 * guiding; it is a redirect. It also undermines the premise: the traveller is
 * alone precisely because there is nobody to ask.
 *
 * Staff must still appear when it genuinely matters — a missed flight, a
 * cancellation, a safety issue, or a rule the app must not override. Those
 * are the exceptions, not the default.
 *
 * Run with: node test/staff.js  (also part of `npm test`)
 */

const assert = require('assert');

const { generateReply } = require('../src/engine');
const { sanitize } = require('../src/store');

let passed = 0;
let failed = 0;
const fails = [];

function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; fails.push(name); console.log('  FAIL ' + name); console.log('       ' + e.message.split('\n')[0]); }
}

const S = sanitize({});
const EN = /\b(staff|desk|information desk|ask someone)\b/i;
const AR = /(موظف|موظفو|الاستعلامات)/;

function reply(message, session, lang) {
  const r = generateReply({ message, lang: lang || 'en', profile: 'nervous', session: session || {}, settings: S });
  return { text: r.messages.map((m) => m.text).join(' '), meta: r.meta };
}

// ---------------------------------------------------------------------------
// Routine questions must be answered, not delegated.
// ---------------------------------------------------------------------------

const ROUTINE = [
  'where is the toilet',
  'where can I eat',
  'where do I check in',
  'what happens at security',
  'where do I go',
  'how long until boarding',
  'what is this airport like',
  'i am nervous',
  'what do I do now',
];

test('routine questions do not fall back to "ask staff"', () => {
  const offenders = [];
  for (const m of ROUTINE) {
    const { text } = reply(m);
    if (EN.test(text)) offenders.push(m + ' → ' + text.slice(0, 80));
  }
  assert.strictEqual(offenders.length, 0,
    'these routine replies still delegate to staff:\n  ' + offenders.join('\n  '));
});

test('the same holds in Arabic', () => {
  const offenders = [];
  for (const m of ['وين الحمام', 'وين أروح', 'ايش يصير في الأمن', 'وين أسجل']) {
    const { text } = reply(m, {}, 'ar');
    if (AR.test(text)) offenders.push(m + ' → ' + text.slice(0, 80));
  }
  assert.strictEqual(offenders.length, 0,
    'Arabic replies still delegate:\n  ' + offenders.join('\n  '));
});

// ---------------------------------------------------------------------------
// Safety-critical moments must still name staff. Removing the fallback
// entirely would be worse than the bug.
// ---------------------------------------------------------------------------

test('a missed or cancelled flight still points to airline staff', () => {
  const { text } = reply('my flight is cancelled', { flight: 'XY-811' });
  assert.ok(EN.test(text), 'a cancellation must still mention staff — this is not a routine case');
});

test('a genuinely urgent case still names staff', () => {
  const { text } = reply('i am late and boarding has started', { minutes: 3, flight: 'XY-811' });
  assert.ok(EN.test(text), 'when time has run out, staff are the correct answer');
});

// ---------------------------------------------------------------------------
// The prompt must stop asking for staff by default.
// ---------------------------------------------------------------------------

test('the prompt no longer tells the model to send people to staff routinely', () => {
  const prompts = require('../src/prompts');
  const t = prompts.build({ lang: 'en', context: { stageName: 'security' }, ticket: null }).text;
  const lower = t.toLowerCase();
  // The old default: "point to airline or airport staff" for anything refused,
  // and "find airport staff" whenever time is short.
  assert.ok(!/point to airline or airport staff/.test(lower),
    'the refuse-everything-to-staff instruction is still in the prompt');
  assert.ok(!/first thing you say is to find airport staff/.test(lower),
    'the "always find staff when rushed" instruction is still in the prompt');
});

test('the prompt tells it to answer before escalating', () => {
  const prompts = require('../src/prompts');
  const t = prompts.build({ lang: 'en', context: { stageName: 'security' }, ticket: null }).text;
  assert.ok(/answer|first/i.test(t) && /only/i.test(t),
    'the prompt should say: answer first, involve staff only when it matters');
});


test('Arabic cancellations are recognised and escalate to the airline desk', () => {
  // "ملغاة" (feminine) was missing from the intent pattern, so an Arabic
  // cancellation fell through to the generic onboarding question.
  for (const m of ['هل رحلتي ملغاة', 'رحلتي ملغية', 'ألغيت رحلتي']) {
    const r = reply(m, { flight: 'XY-811' }, 'ar');
    assert.strictEqual(r.meta.intent, 'flightcheck', m + ' must be recognised as a flight change');
    assert.ok(/شركة الطيران|كاونتر/.test(r.text), m + ' must point to the airline desk');
  }
});

test('Arabic routine questions still never delegate', () => {
  for (const m of ['وين الحمام', 'وين أروح']) {
    const { text } = reply(m, {}, 'ar');
    assert.ok(!AR.test(text), m + ' must not send them to staff: ' + text.slice(0, 70));
  }
});

console.log('');
if (failed) { console.log(failed + ' failed, ' + passed + ' passed'); process.exit(1); }
console.log(passed + ' passed, 0 failed — staff escalation');
