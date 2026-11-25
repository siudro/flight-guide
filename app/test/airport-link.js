// The topbar must link straight to the airport's own map page — a link the
// traveller can click, not an embedded map. Guards against regressing back to
// the self-hosted /map route, which was built from Riyadh data.
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../public/chat.js'), 'utf8');

let failed = 0;
const fail = (m) => { failed++; console.log('  FAIL ' + m); };
const ok = (m) => console.log('  ok   ' + m);
const okIf = (cond, m) => cond ? ok(m) : fail(m);

const link = /<a[^>]*id="airportLink"[^>]*>/.exec(html);
okIf(!!link, 'topbar has the official airport link');
if (link) {
  const tag = link[0];
  okIf(/href="https:\/\/kfia\.sa\//.test(tag), 'link points at kfia.sa');
  okIf(/target="_blank"/.test(tag), 'opens in a new tab');
  okIf(/rel="noopener"/.test(tag), 'has rel=noopener');
}
okIf(!/href="\/map"/.test(html), 'no longer links to the self-hosted map route');
okIf(/data-i18n="airportMapLink"/.test(html), 'link label is translated');
okIf((js.match(/airportMapLink:/g) || []).length === 2, 'airportMapLink exists in en and ar');
okIf(!/mapVisible\) mapLink/.test(js), 'no leftover code hides the airport link');


// The category choice is a first screen, not a bubble in the transcript.
// A picker inside the chat duplicated the sidebar card beside it, so opening
// the link looked unchanged to the traveller.
const html2 = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const css2 = fs.readFileSync(path.join(__dirname, '../public/app.css'), 'utf8');

okIf(/id="welcomeScreen"/.test(html2), 'first screen exists in the HTML');
okIf(/id="wsOptions"/.test(html2), 'first screen has an options host');
okIf(/data-i18n="wsHeading"/.test(html2), 'the question is translatable');
okIf(/function renderWelcomeScreen\(/.test(js), 'renderWelcomeScreen() exists');
okIf((js.match(/renderWelcomeScreen\(\)/g) || []).length >= 2, 'rendered at boot and on language switch');
okIf(/needs-profile/.test(js) && /needs-profile/.test(css2), 'the chat is hidden until a choice is made');
okIf(/body\.needs-profile \.layout > \.chat-panel/.test(css2), 'chat panel hidden while choosing');
okIf(/profileChosen/.test(js), 'the choice is remembered across visits');
okIf(!/function addWelcome\(/.test(js), 'the duplicate in-transcript picker is gone');
okIf(/wsHeading:/.test(js) && (js.match(/wsHeading:/g) || []).length === 2, 'wsHeading exists in en and ar');


// The traveller's sketch: الخيارات on its own labelled row, الشارة showing
// live state, then the chat.
const htmlS = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const jsS = fs.readFileSync(path.join(__dirname, '../public/chat.js'), 'utf8');
const cssS = fs.readFileSync(path.join(__dirname, '../public/app.css'), 'utf8');

okIf(/id="gateBadge"/.test(htmlS), 'الشارة element exists');
okIf(/function renderBadge/.test(jsS), 'renderBadge() exists');
okIf((jsS.match(/renderBadge\(\)/g) || []).length >= 3, 'badge re-renders with the trip');
okIf(/badgeGate:/.test(cssS) === false && (jsS.match(/badgeGate:/g) || []).length === 2,
  'badge strings exist in en and ar');
okIf(/\.fg-badge\.show/.test(cssS), 'badge has a visible state');
okIf(/body\.needs-profile \.options-btn/.test(cssS), 'options hidden on the first screen');
okIf(/header\.topbar > \.topbar-actions/.test(cssS), 'options row is laid out above the chat');
okIf(/options-text\} \{ display: inline/.test(cssS) || /options-text \{ display: inline/.test(cssS),
  'الخيارات is a word, not only an icon');


// The chat bubble button from the sketch: the way into the conversation.
okIf(/id="chatLauncher"/.test(htmlS), 'chat launcher exists');
okIf(/chat-launcher \{/.test(cssS), 'launcher is styled');
okIf(/border-radius: 50%/.test(cssS), 'launcher is round, as drawn');
okIf(/56px/.test(cssS), 'launcher meets the 56px touch target');
okIf(/function openChat/.test(jsS), 'openChat() exists');
okIf(/chatLauncher:/.test(jsS) && (jsS.match(/chatLauncher:/g) || []).length === 2,
  'launcher label exists in en and ar');
// It must be reachable from the category screen, where the chat is hidden.
okIf(/btn\.hidden = !document\.body\.classList\.contains\('needs-profile'\)/.test(jsS),
  'launcher shows exactly when the chat is hidden');


// Text and voice take turns on a phone (the traveller's second sketch).
okIf(/fg-voice/.test(cssS) && /fg-text/.test(cssS), 'composer has text and voice modes');
okIf(/initComposerSwap/.test(jsS), 'the swap is wired');
okIf(/#composer\.fg-voice #input/.test(cssS), 'voice mode shrinks the text field');
okIf(/#composer\.fg-text #mic-btn/.test(cssS), 'text mode shrinks the microphone');
// A collapsed field must stay tappable or the traveller is stuck in voice mode.
okIf(!/#composer\.fg-voice #input \{[^}]*pointer-events: none/.test(cssS),
  'the collapsed field must remain tappable');
okIf(/pointerdown', function \(\) \{ setMode\('voice'\)/.test(jsS),
  'the microphone grows on pointerdown, before the record handler');
okIf(/micGrown:/.test(jsS) && (jsS.match(/micGrown:/g) || []).length === 2,
  'the grown microphone is labelled in both languages');


// The composer must not steal focus on load: on a phone that raises the
// keyboard before the traveller has chosen to type, covering the conversation.
const bootBlock = jsS.slice(jsS.indexOf('restoreConversation().then'));
const bootFocus = bootBlock.slice(0, 400).match(/inputEl\.focus\(\)/);
okIf(!bootFocus, 'no focus() in the load sequence');
okIf(/Never focus the composer on load/.test(jsS), 'the reason is documented');
okIf((jsS.match(/inputEl\.focus\(\)/g) || []).length >= 3,
  'deliberate paths (chat button, category pick, after send) still focus');

console.log(failed ? '\n' + failed + ' failed' : '\nok   airport map link is a real kfia.sa link');
process.exit(failed ? 1 : 0);
