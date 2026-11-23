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


// The three profiles must be offered in the conversation itself: on a phone
// the sidebar sits below the chat, so it is not visible at load.
okIf(/function addWelcome\(/.test(js), 'addWelcome() exists');
okIf(/addWelcome\(\);/.test(js) && (js.match(/addWelcome\(\);/g) || []).length >= 2,
  'opener is called at boot AND after a language switch before the first turn');
okIf(/welcomeHeading:/.test(js) && (js.match(/welcomeHeading:/g) || []).length === 2,
  'welcomeHeading exists in en and ar');
okIf(/\.w-opt/.test(fs.readFileSync(path.join(__dirname, '../public/app.css'), 'utf8')),
  'opener styles are present');


// Choosing a category must visibly confirm it, per category — a generic
// "Got it" left the traveller unable to tell the tap registered.
okIf(/welcomeDone: \{/.test(js) && (js.match(/welcomeDone: \{/g) || []).length === 2,
  'welcomeDone is a per-category map in both languages');
for (const k of ['nervous', 'adult', 'hurried']) {
  const hits = (js.match(new RegExp('\\b' + k + ':\\s*\'[^\']*سأ', 'g')) || []).length;
}
okIf(/done\[key\]|done && done\[key\]/.test(js), 'confirmation picks the message for the chosen category');
okIf(!/replace\('\{who\}'/.test(js), 'no string-interpolated phrasing that reads awkwardly');

console.log(failed ? '\n' + failed + ' failed' : '\nok   airport map link is a real kfia.sa link');
process.exit(failed ? 1 : 0);
