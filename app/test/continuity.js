'use strict';

/**
 * Flight Guide — conversation continuity tests.
 *
 * These exist because of a real failure reported on 2026-11-23. The traveller
 * photographed a boarding pass, the app rendered a tidy card, and then:
 *
 *   user: am i late
 *   bot : I can help you check. What time does your boarding pass say
 *         boarding starts?
 *   user: i already gave you the ticket picture?
 *   bot : I can't see the ticket picture here.
 *
 * The ticket had been read and displayed. The agent could not "remember" it
 * and asked for the one fact the ticket already printed. Three defects
 * produced that; each has a test below.
 *
 *   1. The ticket never entered the conversation history — only chat text did.
 *   2. The prompt still told the model to ask for a boarding time it held.
 *   3. The card split flight numbers ("XY 406") so the live lookup missed.
 *
 * Run with: node test/continuity.js  (also part of `npm test`)
 */

const assert = require('assert');

const prompts = require('../src/prompts');
const { recordTicketInHistory, normalizeTicketFields } = require('../src/engine');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL ' + name);
    console.log('       ' + err.message.split('\n')[0]);
  }
}

const TICKET = {
  flight: 'XY-811', airline: 'flynas', destination: 'DUBAI (DXB)',
  airport: 'DMM', boarding: '11:40', seat: '7B'
};

// 1 — the ticket must land in the history the model replays ------------------

test('a scanned ticket becomes an assistant turn in the history', () => {
  const session = { history: [{ role: 'user', content: 'hi' }] };
  recordTicketInHistory(session, TICKET, 'en');
  const last = session.history[session.history.length - 1];
  assert.strictEqual(last.role, 'assistant', 'replayed as something the agent said');
  assert.ok(/XY-811/.test(last.content), 'flight number survives into history');
  assert.ok(/11:40/.test(last.content), 'boarding time survives into history');
});

test('the recorded turn says the facts are already known', () => {
  const session = {};
  recordTicketInHistory(session, TICKET, 'en');
  assert.ok(/already/i.test(session.history[0].content),
    'must say the fact is already known, not merely list it');
});

test('re-scanning replaces rather than duplicates the ticket turn', () => {
  const session = {};
  recordTicketInHistory(session, TICKET, 'en');
  recordTicketInHistory(session, TICKET, 'en');
  assert.strictEqual(session.history.length, 1, 'a re-scan must replace, not append');
});

test('the ticket turn is written in Arabic when the app is in Arabic', () => {
  const session = {};
  recordTicketInHistory(session, TICKET, 'ar');
  assert.ok(/قرأت تذكرتك/.test(session.history[0].content), 'Arabic ticket turn');
  assert.ok(/XY-811/.test(session.history[0].content), 'codes stay unchanged');
});

// 2 — a known boarding time is never asked for again ------------------------

const build = (o) => prompts.build(Object.assign({ lang: 'en', context: {}, ticket: null }, o)).text;

test('a known countdown reaches the prompt and bans re-asking', () => {
  const text = build({ context: { minutes: 25 }, ticket: TICKET });
  assert.ok(/25/.test(text), 'minutes must reach the prompt');
  assert.ok(/never ask/i.test(text), 'prompt must forbid asking for a known value');
});

test('the ticket block states the boarding time is already known', () => {
  const text = build({ context: { minutes: 25 }, ticket: TICKET });
  const block = text.slice(text.indexOf('READ FROM THEIR TICKET'));
  assert.ok(block.length > 0, 'ticket block present');
  assert.ok(/already have the boarding time/i.test(block), 'block says boarding is known');
  assert.ok(/do not ask/i.test(block), 'block forbids asking');
});

test('the blanket "ask for it" rule is scoped to genuinely unknown values', () => {
  const text = build({ context: { flight: 'XY-811', minutes: 25 }, ticket: TICKET });
  assert.ok(!/If you do not have a value, ask for it/i.test(text),
    'the unscoped rule must be replaced');
  assert.ok(/genuinely unknown/i.test(text), 'scoped rule present');
});

test('with no live feed but a ticket, the model is told not to disown the ticket', () => {
  const text = build({ context: { flight: 'XY-811', minutes: 25 }, ticket: TICKET });
  assert.ok(/never claim you cannot see their ticket/i.test(text),
    'the exact phrase that caused "I can\'t see the ticket picture" must be blocked');
});

test('with no ticket and no feed, asking is still correct', () => {
  const text = build({ context: { flight: 'XY-811' }, ticket: null });
  assert.ok(/Ask for the boarding time/i.test(text), 'asking remains correct when nothing is known');
  assert.ok(!/never claim you cannot see their ticket/i.test(text), 'no ticket-tuning without a ticket');
});

// 3 — the boarding card must not split a flight number ----------------------

test('a spaced flight number becomes the printed dashed form', () => {
  assert.strictEqual(normalizeTicketFields({ flight: 'XY 406' }).flight, 'XY-406');
});

test('an already-dashed flight number is unchanged', () => {
  assert.strictEqual(normalizeTicketFields({ flight: 'XY-811' }).flight, 'XY-811');
});

test('letter+digit and digit+letter airline codes normalise', () => {
  assert.strictEqual(normalizeTicketFields({ flight: 'F3 123' }).flight, 'F3-123');
  assert.strictEqual(normalizeTicketFields({ flight: '3O-123' }).flight, '3O-123');
});

test('unreadable fields are dropped, not kept as "null"', () => {
  const out = normalizeTicketFields({ flight: 'XY-811', seat: 'null', gate: 'N/A', airline: '' });
  assert.strictEqual(out.flight, 'XY-811');
  assert.ok(!('seat' in out), '"null" must not survive as a seat');
  assert.ok(!('gate' in out), '"N/A" must not survive as a gate');
  assert.ok(!('airline' in out), 'empty string must not survive');
});

// 4 — the reported transcript must be answerable from the ticket alone ------

test('every fact in the reported transcript is in the prompt', () => {
  const text = build({
    context: { airportName: 'Dammam', flight: 'XY-811', minutes: 25, gate: 'A17' },
    ticket: TICKET
  });
  assert.ok(/XY-811/.test(text), 'flight known');
  assert.ok(/11:40/.test(text), 'boarding time known');
  assert.ok(/Dammam/.test(text), 'airport known in words');
  assert.ok(/A17/.test(text), 'gate known');
  assert.ok(/25/.test(text), 'countdown known');
});

test('the airport is never left as a bare code', () => {
  assert.strictEqual(require('../src/engine').airportWords('dmm'), 'Dammam (King Fahd International)');
});


// 5 — directions hand over the airport's own link ---------------------------

const { generateReply } = require('../src/engine');
const { sanitize } = require('../src/store');

test('a directions request returns the airport link, in English', () => {
  const r = generateReply({ message: 'where do I go', lang: 'en', profile: 'nervous', session: {}, settings: sanitize({}) });
  const out = r.messages.map((m) => m.text).join(' ');
  assert.ok(/kfia\.sa/.test(out), 'the airport link must be in the reply');
  assert.ok(!/which airport/i.test(out), 'no airport question before a link');
  assert.strictEqual(r.meta.intent, 'directions');
});

test('a directions request returns the airport link, in Arabic', () => {
  const r = generateReply({ message: 'وين أروح', lang: 'ar', profile: 'nervous', session: {}, settings: sanitize({}) });
  const out = r.messages.map((m) => m.text).join(' ');
  assert.ok(/kfia\.sa/.test(out), 'the airport link must be in the Arabic reply');
});

test('the airport is never asked, and Dammam is assumed', () => {
  const r = generateReply({ message: 'hello', lang: 'en', profile: 'nervous', session: {}, settings: sanitize({}) });
  const out = r.messages.map((m) => m.text).join(' ');
  assert.ok(!/which airport/i.test(out), 'must not ask for the airport');
  assert.strictEqual(r.session.airport, 'dmm', 'Dammam is assumed silently');
});

console.log('');
if (failed) {
  console.log(failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log(passed + ' passed, 0 failed — conversation continuity');
