'use strict';

/**
 * Flight Guide — spoken voice selection.
 *
 * The traveller asked for a US English male voice, conversational in tone.
 * Browser voice lists differ by device, so the selector scores candidates
 * rather than assuming one exists. These tests feed realistic voice lists
 * (Chrome on Windows, Safari on macOS, iPhone) and assert the chosen voice.
 *
 * What these tests CANNOT prove: how the voice actually sounds. There is no
 * audio output in this environment. They prove the selection logic.
 *
 * Run with: node test/voice.js  (also part of `npm test`)
 */

const assert = require('assert');
const fs = require('node:fs');
const path = require('node:path');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name); console.log('       ' + e.message.split('\n')[0]); }
}

// Load just the scoring functions out of chat.js by evaluating them in a
// sandbox with a fake speech object. Avoids a DOM.
const src = fs.readFileSync(path.join(__dirname, '../public/chat.js'), 'utf8');
const start = src.indexOf('  var MALE_NAMES');
const end = src.indexOf('  function speakText');
assert.ok(start > 0 && end > start, 'could not locate the voice selector');
const body = src.slice(start, end);

function build(voices) {
  const sandbox = { speech: { getVoices: () => voices }, String, RegExp };
  const fn = new Function('speech', body + '\nreturn { pickVoice: pickVoice, scoreVoice: scoreVoice };');
  return fn(sandbox.speech);
}

const CHROME_WIN = [
  { name: 'Google US English', lang: 'en-US' },
  { name: 'Google UK English Male', lang: 'en-GB' },
  { name: 'Google UK English Female', lang: 'en-GB' },
  { name: 'Microsoft Zira - English (United States)', lang: 'en-US' },
  { name: 'Microsoft David - English (United States)', lang: 'en-US' },
  { name: 'Google हिन्दी', lang: 'hi-IN' }
];

const SAFARI_MAC = [
  { name: 'Samantha', lang: 'en-US' },
  { name: 'Alex', lang: 'en-US' },
  { name: 'Daniel', lang: 'en-GB' },
  { name: 'Karen', lang: 'en-AU' },
  { name: 'Moira', lang: 'en-IE' }
];

const IPHONE = [
  { name: 'Samantha', lang: 'en-US' },
  { name: 'Aaron', lang: 'en-US' },
  { name: 'Maged', lang: 'ar-SA' }
];

const NO_US = [
  { name: 'Daniel', lang: 'en-GB' },
  { name: 'Samantha', lang: 'en-US' },
  { name: 'Kate', lang: 'en-GB' }
];

test('picks a US male voice from a Chrome/Windows list', () => {
  const v = build(CHROME_WIN).pickVoice('en');
  assert.ok(v, 'a voice must be chosen');
  assert.strictEqual(v.lang, 'en-US', 'must be US English, got ' + v.lang);
  assert.ok(/David|Guy|Mark|male/i.test(v.name) || v.name === 'Google US English',
    'expected a male US voice, got ' + v.name);
});

test('prefers a named male over a female US voice (Safari)', () => {
  const v = build(SAFARI_MAC).pickVoice('en');
  assert.strictEqual(v.name, 'Alex', 'expected Alex (male US), got ' + v.name);
});

test('works on a short iPhone voice list', () => {
  const v = build(IPHONE).pickVoice('en');
  assert.strictEqual(v.lang, 'en-US');
  assert.ok(!/samantha/i.test(v.name), 'must not choose the female voice when a male exists');
});

test('falls back sensibly when no US male exists', () => {
  const v = build(NO_US).pickVoice('en');
  assert.ok(v, 'must still return a voice rather than nothing');
  assert.strictEqual(v.name, 'Daniel', 'expected the male British fallback, got ' + v.name);
});

test('never picks a non-English voice for English', () => {
  const v = build([{ name: 'Ting-Ting', lang: 'zh-CN' }, { name: 'Thomas', lang: 'fr-FR' }]).pickVoice('en');
  assert.strictEqual(v, null, 'no English voice exists, so return null and let the engine default');
});

test('Arabic still prefers a Saudi voice', () => {
  const v = build([{ name: 'Maged', lang: 'ar-SA' }, { name: 'Tarik', lang: 'ar-EG' }]).pickVoice('ar');
  assert.strictEqual(v.lang, 'ar-SA', 'expected ar-SA, got ' + v.lang);
});

test('female names are penalised in English', () => {
  const v = build([{ name: 'Samantha', lang: 'en-US' }, { name: 'Tom', lang: 'en-GB' }]).pickVoice('en');
  assert.strictEqual(v.name, 'Tom', 'a male voice should beat a female one even across regions');
});

test('the utterance requests en-US, not en-GB', () => {
  assert.ok(/u\.lang = lang === 'ar' \? 'ar-SA' : 'en-US'/.test(src),
    'the BCP-47 tag must be en-US so the engine defaults to a US voice');
});

test('speaking rate is conversational, not clipped', () => {
  assert.ok(/u\.rate = lang === 'ar' \? 0\.95 : 0\.96/.test(src),
    'English rate should be slightly under native speed');
});


test('the prompt tells the model the reply will be spoken aloud', () => {
  const prompts = require('../src/prompts');
  const t = prompts.build({ lang: 'en', context: {} }).text;
  assert.ok(/SPOKEN aloud/.test(t), 'the style guide must mention that replies are spoken');
  assert.ok(/contractions/i.test(t), 'it should ask for contractions — that is what makes speech sound human');
});

console.log('');
if (failed) { console.log(failed + ' failed, ' + passed + ' passed'); process.exit(1); }
console.log(passed + ' passed, 0 failed — voice selection');
