'use strict';

/**
 * Persisted operator settings.
 *
 * Overrides live in a single JSON file on a volume so `/admin` edits survive a
 * container restart. Only *overrides* are stored — anything not written here
 * still comes from config/defaults.js, so a new image can ship improved
 * defaults for settings the operator never touched.
 *
 * Writes are atomic: write a temp file in the same directory, then rename.
 * A corrupt file on boot is moved aside rather than crashing the container.
 */

const fs = require('fs');
const path = require('path');
const DEFAULTS = require('../config/defaults');

// Where settings.json and conversations.json live.
//
// FG_DATA_DIR wins (Docker sets it to /data, the mounted volume). Without it
// we must NOT default to /data: a normal user running `node src/server.js`
// has no permission to write there, and the app would only fail later, when
// they first pressed Save in /admin. Fall back to a folder beside the code.
const DATA_DIR = process.env.FG_DATA_DIR || path.join(__dirname, '..', '.data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversations.json');
const MAX_CONVERSATIONS = Number(process.env.FG_MAX_CONVERSATIONS || 200);

function ensureDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    // Corrupt (or unreadable) store: keep the evidence, start clean.
    try {
      fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
    } catch (_) { /* best effort */ }
    console.warn(`[store] ${path.basename(file)} unreadable (${err.message}) — starting from defaults`);
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  ensureDir();
  const tmp = path.join(DATA_DIR, `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Turn a raw persistable blob into the effective settings object used by the
 * engine. Missing or blank values fall back to config/defaults.js, so this is
 * both the boot path and the write-validation path.
 */
function sanitize(overrides) {
  const o = overrides && typeof overrides === 'object' ? overrides : {};

  // Stages: per-stage guidance per language, seeded from defaults.
  // Two on-disk shapes are accepted so the file stays readable while the API
  // and the admin panel can speak either:
  //   flat   { guidance_en, guidance_ar, enabled }      (what we persist)
  //   nested { guidance: { en, ar }, enabled }          (what defaults use)
  const stages = DEFAULTS.STAGES.map((def) => {
    const saved = (o.stages && o.stages[def.key]) || {};
    const nested = saved.guidance || {};
    const pick = (nestedVal, flatVal) => {
      if (typeof nestedVal === 'string' && nestedVal.trim()) return nestedVal.trim();
      if (typeof flatVal === 'string' && flatVal.trim()) return flatVal.trim();
      return null;
    };
    const en = pick(nested.en, saved.guidance_en);
    const ar = pick(nested.ar, saved.guidance_ar);
    const guidance = { en: en || def.guidance.en, ar: ar || def.guidance.ar };
    const enabled = saved.enabled === undefined ? true : !!saved.enabled;
    return { key: def.key, label: def.label, guidance, enabled };
  });

  const byKey = {};
  for (const s of stages) byKey[s.key] = s.enabled ? s : null;

  // Profiles.
  const savedProfiles = (o && o.profilesEnabled) || {};
  const profilesEnabled = {};
  for (const p of DEFAULTS.PROFILES) {
    profilesEnabled[p.key] = savedProfiles[p.key] === undefined ? p.enabled : !!savedProfiles[p.key];
  }

  // Escalation threshold — clamp to something sane.
  let escalateMinutes = Number(o.escalateMinutes);
  if (!Number.isFinite(escalateMinutes)) escalateMinutes = 60;
  escalateMinutes = Math.max(5, Math.min(600, Math.round(escalateMinutes)));

  // Map visibility.
  const mapVisible = o.mapVisible === undefined ? true : !!o.mapVisible;

  // Enabled airports.
  let airports = Array.isArray(o.airports) && o.airports.length
    ? o.airports.filter((k) => DEFAULTS.AIRPORTS[k])
    : Object.keys(DEFAULTS.AIRPORTS);
  if (!airports.length) airports = Object.keys(DEFAULTS.AIRPORTS);

  // --- AI provider settings --------------------------------------------
  // The key lives in the data volume beside settings.json. It is NEVER part
  // of the object handed to the browser; publicSettings() strips it.
  const ai = o.ai && typeof o.ai === 'object' ? o.ai : {};
  const provider = ['deepinfra', 'openai', 'groq', 'openrouter'].includes(ai.provider)
    ? ai.provider : 'deepinfra';
  const model = typeof ai.model === 'string' ? ai.model.trim().slice(0, 120) : '';
  const apiKey = typeof ai.apiKey === 'string' ? ai.apiKey.trim().slice(0, 400) : '';
  const enabled = ai.enabled === undefined ? false : !!ai.enabled;

  return {
    stages, byKey, profilesEnabled, escalateMinutes, mapVisible, airports,
    ai: { provider, model, apiKey, enabled }
  };
}

/**
 * Settings safe to send to the browser: everything except the key.
 * A key that reaches /api/settings is a key that can be copied by anyone
 * who opens the page, so this is a hard boundary, not a convenience.
 */
function publicSettings(settings) {
  const s = Object.assign({}, settings);
  const ai = settings.ai || {};
  s.ai = {
    provider: ai.provider,
    model: ai.model,
    enabled: !!ai.enabled,
    hasKey: !!(ai.apiKey && ai.apiKey.length)
  };
  return s;
}

function loadSettings() {
  const overrides = readJson(SETTINGS_FILE, {});
  return sanitize(overrides);
}

/**
 * Persist a partial update. Unknown keys are ignored; each known key is
 * sanitized through the same path so a bad admin payload cannot break boot.
 */
function saveSettings(patch) {
  const current = readJson(SETTINGS_FILE, {});
  const next = Object.assign({}, current);

  if (patch.stages && typeof patch.stages === 'object') {
    const stages = {};
    for (const def of DEFAULTS.STAGES) {
      const incoming = patch.stages[def.key];
      const previous = (current.stages && current.stages[def.key]) || {};
      if (!incoming) {
        if (previous && Object.keys(previous).length) stages[def.key] = previous;
        continue;
      }
      // Accept flat (guidance_en) or nested (guidance.en) on the way in.
      const nested = incoming.guidance || {};
      const pick = (nestedVal, flatVal, prevNested, prevFlat) => {
        if (typeof nestedVal === 'string') return nestedVal.slice(0, 4000);
        if (typeof flatVal === 'string') return flatVal.slice(0, 4000);
        if (typeof prevNested === 'string') return prevNested;
        if (typeof prevFlat === 'string') return prevFlat;
        return undefined;
      };
      const prevNested = previous.guidance || {};
      const entry = {
        guidance_en: pick(nested.en, incoming.guidance_en, prevNested.en, previous.guidance_en),
        guidance_ar: pick(nested.ar, incoming.guidance_ar, prevNested.ar, previous.guidance_ar),
        enabled: incoming.enabled === undefined ? previous.enabled : !!incoming.enabled
      };
      // Keep the file tidy: do not write keys we do not actually have.
      for (const k of Object.keys(entry)) {
        if (entry[k] === undefined) delete entry[k];
      }
      if (Object.keys(entry).length) stages[def.key] = entry;
    }
    next.stages = stages;
  }

  if (patch.profilesEnabled && typeof patch.profilesEnabled === 'object') {
    next.profilesEnabled = Object.assign({}, current.profilesEnabled || {});
    for (const p of DEFAULTS.PROFILES) {
      if (patch.profilesEnabled[p.key] !== undefined) {
        next.profilesEnabled[p.key] = !!patch.profilesEnabled[p.key];
      }
    }
  }

  if (patch.escalateMinutes !== undefined) {
    const n = Number(patch.escalateMinutes);
    if (Number.isFinite(n)) next.escalateMinutes = Math.max(5, Math.min(600, Math.round(n)));
  }

  if (patch.mapVisible !== undefined) next.mapVisible = !!patch.mapVisible;

  if (Array.isArray(patch.airports)) {
    const valid = patch.airports.filter((k) => DEFAULTS.AIRPORTS[k]);
    if (valid.length) next.airports = valid;
  }

  if (patch.ai && typeof patch.ai === 'object') {
    const cur = next.ai && typeof next.ai === 'object' ? Object.assign({}, next.ai) : {};
    if (['deepinfra', 'openai', 'groq', 'openrouter'].includes(patch.ai.provider)) {
      cur.provider = patch.ai.provider;
    }
    if (typeof patch.ai.model === 'string') cur.model = patch.ai.model.trim().slice(0, 120);
    if (typeof patch.ai.enabled === 'boolean') cur.enabled = patch.ai.enabled;
    // Only overwrite the key when a non-empty one is supplied, so saving the
    // panel without re-pasting the key does not wipe it. An explicit empty
    // string clears it.
    if (typeof patch.ai.apiKey === 'string') {
      const k = patch.ai.apiKey.trim();
      if (k === '' && patch.ai.clearKey) cur.apiKey = '';
      else if (k !== '') cur.apiKey = k.slice(0, 400);
    }
    next.ai = cur;
  }

  writeJsonAtomic(SETTINGS_FILE, next);
  return sanitize(next);
}

function resetSettings() {
  try { fs.unlinkSync(SETTINGS_FILE); } catch (_) { /* already gone */ }
  return loadSettings();
}

// ---------------------------------------------------------------------------
// Conversation log (bounded, in the same volume)
// ---------------------------------------------------------------------------

function loadConversations() {
  const list = readJson(CONVERSATIONS_FILE, []);
  return Array.isArray(list) ? list : [];
}

function appendConversation(entry) {
  const list = loadConversations();
  list.push(entry);
  const trimmed = list.slice(-MAX_CONVERSATIONS);
  try {
    writeJsonAtomic(CONVERSATIONS_FILE, trimmed);
  } catch (err) {
    console.warn(`[store] could not persist conversation: ${err.message}`);
  }
  return trimmed;
}

function clearConversations() {
  try { writeJsonAtomic(CONVERSATIONS_FILE, []); } catch (_) { /* best effort */ }
}

module.exports = {
  publicSettings,
  DATA_DIR,
  SETTINGS_FILE,
  MAX_CONVERSATIONS,
  loadSettings,
  saveSettings,
  resetSettings,
  sanitize,
  loadConversations,
  appendConversation,
  clearConversations
};
