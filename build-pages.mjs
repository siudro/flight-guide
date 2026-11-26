#!/usr/bin/env node
/**
 * Build the static GitHub Pages demo into ./_site
 *
 * GitHub Pages serves files only, so the Node server cannot run there. This
 * copies the real UI and injects demo-static.js, which answers /api/* in the
 * browser. The flight snapshot comes from the live Dammam feed at build time.
 */
import { mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PUB = path.join(ROOT, 'app', 'public');
const OUT = path.join(ROOT, '_site');
const FEED = 'https://kfia.sa/api/aodb/flights?arr_dep=D';

function shape(f) {
  const out = {
    flight: f.FL_NUMBER ? String(f.FL_NUMBER).trim() : null,
    airline: f.AIRLINE_DESCR || f.AIRLINE || null,
    destination: f.ROUTING_ENG || f.ROUTING || null,
    terminal: f.TERMINAL || null,
    gate: f.GATE_1 ? String(f.GATE_1).trim() : null,
    checkinCounters: [f.CHECKIN_1, f.CHECKIN_2].filter(Boolean).join(', ') || null,
    status: f.FL_STATUS_1 || null,
    remark: f.PUB_RMK_ENG || f.PUB_RMK || null,
    scheduled: f.SCH_TIME || null,
    estimated: f.EST_TIME || null
  };
  const ta = Date.parse(f.SCH_TIME), tb = Date.parse(f.EST_TIME);
  const mins = (!Number.isNaN(ta) && !Number.isNaN(tb)) ? Math.round((tb - ta) / 60000) : 0;
  out.delayMinutes = mins > 0 ? mins : 0;
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}

async function snapshot() {
  try {
    console.log('fetching live departures:', FEED);
    const res = await fetch(FEED, {
      headers: { 'User-Agent': 'VibeFlight-build/1.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const flights = (json.FLIGHTS || [])
      .filter((f) => f.GATE_1 || f.FL_STATUS_1)
      .slice(0, 40)
      .map(shape);
    console.log('snapshot flights:', flights.length);
    return flights;
  } catch (err) {
    console.warn('feed unavailable, shipping empty snapshot:', err.message);
    return [];
  }
}

async function main() {
  if (!existsSync(PUB)) throw new Error('app/public not found; run from the repo root');
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await cp(PUB, OUT, { recursive: true });

  for (const f of ['admin.html', 'admin.js', 'admin.css', 'map-hidden.html', 'demo-static.js']) {
    await rm(path.join(OUT, f), { force: true });
  }

  const flights = await snapshot();
  const builtAt = new Date().toISOString().slice(0, 10);

  const shim = await readFile(path.join(PUB, 'demo-static.js'), 'utf8');
  await writeFile(path.join(OUT, 'demo-static.js'),
    shim.replace('__BUILT_AT__', builtAt).replace('__FLIGHTS__', JSON.stringify(flights)));

  const idxPath = path.join(OUT, 'index.html');
  let idx = await readFile(idxPath, 'utf8');
  idx = idx.replace(/<a[^>]*href="\/admin"[^>]*>[\s\S]*?<\/a>\s*/g, '');
  idx = idx.replace(/<a[^>]*href="\/map"[^>]*>[\s\S]*?<\/a>\s*/g, '');
  idx = idx.replace(/<p data-i18n="simNote">[\s\S]*?<\/p>/,
    '<p>Static demo. This page shows a snapshot of the Dammam departures feed ' +
    'taken on ' + builtAt + '. The live feed and AI replies run on the server, ' +
    'which GitHub Pages cannot host. Always confirm the gate on the departure screen.</p>');
  if (!idx.includes('demo-static.js')) {
    idx = idx.replace('</head>', '  <script src="demo-static.js"></script>\n</head>');
  }

  // A GitHub Pages project site is served from /<repo>/, not the domain root.
  // The app uses root-absolute paths (/app.css, /chat.js), which would 404
  // there, so every local asset reference is rewritten to a relative one.
  idx = idx.replace(/(src|href)="\/(?!\/)/g, '$1="');

  await writeFile(idxPath, idx);
  await writeFile(path.join(OUT, '.nojekyll'), '');

  // Pages is configured as branch=main, path=/, so what it serves is whatever
  // sits at the repo root. Copying the build there (plus a root index.html and
  // .nojekyll) is what replaces the rendered README with the actual app.
  for (const f of ['app.css', 'chat.js', 'demo-static.js', 'favicon.svg', 'index.html']) {
    await cp(path.join(OUT, f), path.join(ROOT, f));
  }
  await writeFile(path.join(ROOT, '.nojekyll'), '');
  console.log('built', OUT, '| flights', flights.length, '| date', builtAt);
}

main().catch((e) => { console.error('BUILD FAILED:', e.message); process.exit(1); });
