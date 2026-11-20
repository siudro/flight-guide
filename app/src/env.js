'use strict';

/**
 * Tiny .env loader. No dependency, ~50 lines.
 *
 * The app has zero runtime dependencies on purpose (a docker build cannot fail
 * on a registry outage), so we do not pull in dotenv for this.
 *
 * Rules, deliberately simple:
 *   KEY=value             sets process.env.KEY unless it is already set
 *   # comment             ignored
 *   quotes are stripped   KEY="a b"  ->  a b
 *   an empty value is skipped, so "OPENAI_API_KEY=" never clobbers a real env
 *
 * A variable already present in the real environment always wins, which is
 * what Docker and CI expect.
 */

const fs = require('fs');

function parse(text) {
  const out = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value === '') continue;
    out[key] = value;
  }
  return out;
}

/** Load the first existing file from candidates. Returns { loaded, file, keys }. */
function load(candidates) {
  const files = candidates && candidates.length ? candidates : ['.env'];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (_) {
      continue;
    }
    const vars = parse(text);
    const applied = [];
    for (const [k, v] of Object.entries(vars)) {
      if (process.env[k] === undefined || process.env[k] === '') {
        process.env[k] = v;
        applied.push(k);
      }
    }
    return { loaded: true, file, keys: applied };
  }
  return { loaded: false, file: null, keys: [] };
}

module.exports = { load, parse };
