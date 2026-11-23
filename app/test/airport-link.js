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

console.log(failed ? '\n' + failed + ' failed' : '\nok   airport map link is a real kfia.sa link');
process.exit(failed ? 1 : 0);
