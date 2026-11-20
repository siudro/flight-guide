'use strict';

/**
 * Boot sequence — runs every time the app starts.
 *
 * The user asked for three things here, and this file is all three:
 *
 *   1. TESTS ALWAYS RUN. "node src/server.js", "npm start", "docker run" —
 *      whichever way it is started, the suite runs first and its result is
 *      printed. A failed test does not stop a prototype from booting (you may
 *      be mid-edit), but it is impossible to miss.
 *
 *   2. YOU CAN SEE WHICH PATH ANSWERS. A startup banner states whether the
 *      model or the rule engine will write replies, which model, and where the
 *      key came from. Every turn then logs its own "[llm] LLM …" or
 *      "[llm] RULES …" line, so "is it the AI or the rules?" is never a guess.
 *
 *   3. A LIVE KEY CHECK. If a key is present, one tiny call confirms it works —
 *      so you learn about a bad key at boot, not mid-conversation. A failure
 *      here is reported, not fatal: the app still serves, on rules.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const llm = require('./llm');
const prompts = require('./prompts');

const RULE = '─'.repeat(66);

function line(s) {
  console.log(s == null ? '' : s);
}

/** Run the test suite in a child process. Returns { ok, passed, failed, output }. */
function runTests() {
  const testFile = path.join(__dirname, '..', 'test', 'run.js');
  try {
    const out = execFileSync(process.execPath, [testFile], {
      encoding: 'utf8',
      timeout: 90000,
      env: Object.assign({}, process.env, { FG_BOOT_TESTS: '1' }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const m = out.match(/(\d+) passed, (\d+) failed/);
    return {
      ok: !m || Number(m[2]) === 0,
      passed: m ? Number(m[1]) : 0,
      failed: m ? Number(m[2]) : 0,
      output: out
    };
  } catch (err) {
    const out = (err && (err.stdout || '')) + (err && err.stderr ? '\n' + err.stderr : '');
    const m = String(out).match(/(\d+) passed, (\d+) failed/);
    return {
      ok: false,
      passed: m ? Number(m[1]) : 0,
      failed: m ? Number(m[2]) : 1,
      output: out || String((err && err.message) || err)
    };
  }
}

/** Say, in plain words, who answers and where the key came from. */
async function reportConfig(settings, opts) {
  const cfg = llm.resolveConfig(settings);
  const skipLiveCheck = opts && opts.skipLiveCheck;

  line('');
  line(RULE);
  line('  REPLY ENGINE');
  line(RULE);

  if (!cfg.enabled) {
    line('  Mode ......... RULE ENGINE ONLY  (LLM_ENABLED=0)');
    line('  Every reply is written by the deterministic rule engine.');
  } else if (!cfg.apiKey) {
    line('  Mode ......... RULE ENGINE ONLY  (no API key found)');
    line('');
    line('  To switch to model-written replies:');
    line('     1. open  ' + path.join(__dirname, '..', '.env'));
    line('     2. set   OPENAI_API_KEY=sk-...');
    line('     3. restart the app');
    line('  The app works fully without a key — this is not an error.');
  } else {
    line('  Mode ......... LLM WRITES REPLIES  (' + cfg.label + ')');
    line('  Model ........ ' + cfg.model);
    line('  Key .......... ' + llm.mask(cfg.apiKey) + '   from ' + cfg.source);
    line('  Vision ....... ' + (cfg.supportsVision
      ? 'yes — ticket photos are read by the model'
      : 'no — ticket photos fall back to typing'));
    line('  Prompts ...... v' + prompts.ACTIVE_VERSION + ' (versions in src/prompts.js)');
    line('  Fallback ..... any failure returns the rule-engine reply instead');

    if (!skipLiveCheck) {
      const v = await llm.verify({ config: cfg });
      if (v.ok) {
        line('  Live check ... OK  ' + v.message + '  ' + (v.ms || 0) + 'ms');
      } else {
        line('  Live check ... FAILED  (' + (v.code || 'ERROR') + ') ' + v.error);
        line('  The app still works: replies fall back to the rule engine.');
        if (v.code === 'BAD_KEY') {
          line('  -> The key was rejected. Check .env and that the key is active.');
        } else if (v.code === 'RATE_LIMIT') {
          line('  -> Rate limited or out of credit. Replies use the rule engine.');
        } else if (v.code === 'NETWORK' || v.code === 'TIMEOUT') {
          line('  -> No route to the provider. Replies use the rule engine.');
        }
      }
    }
  }

  line(RULE);
  return cfg;
}

/** The whole boot report. Called before the server starts listening. */
async function boot(settings, opts) {
  opts = opts || {};
  const skip = opts.skipTests === true;

  line('');
  line('  Flight Guide — starting up');
  line('');

  line('  Running tests…');
  const t = skip ? { ok: true, passed: 0, failed: 0, skipped: true } : runTests();

  if (skip) {
    line('  Tests ......... skipped (FG_SKIP_BOOT_TESTS=1)');
  } else if (t.ok) {
    line('  Tests ......... ' + t.passed + ' passed, 0 failed');
  } else {
    line('  Tests ......... ' + t.passed + ' passed, ' + t.failed + ' FAILED');
    line('');
    String(t.output)
      .split('\n')
      .filter((l) => /FAIL|AssertionError|Error:/.test(l))
      .slice(0, 12)
      .forEach((l) => line('     ' + l.trim()));
    line('');
    line('  The app will still start so you can keep working, but a failing');
    line('  test means behaviour you rely on is broken. Fix it before shipping.');
  }

  const cfg = await reportConfig(settings, opts);
  return { tests: t, config: cfg };
}

module.exports = { boot, runTests, reportConfig, RULE };
