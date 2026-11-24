'use strict';

/**
 * Voice messages -> text, with Cohere Transcribe.
 *
 *   POST https://api.cohere.com/v2/audio/transcriptions   (multipart)
 *     model     cohere-transcribe-03-2026
 *     language  ISO 639-1 ("en", "ar") — required by the API
 *     file      flac / mp3 / mpeg / mpga / ogg / wav, max 25 MB
 *   -> { "text": "..." }
 *
 * The browser records 16 kHz mono WAV (every browser can make that; the
 * MediaRecorder formats — webm, mp4 — are not on Cohere's list) and posts it
 * to OUR server. The Cohere key stays here and never reaches the browser.
 *
 * Zero dependencies: Node 20+ ships fetch, FormData and Blob.
 */

const ENDPOINT = process.env.COHERE_TRANSCRIBE_URL || 'https://api.cohere.com/v2/audio/transcriptions';
const DEFAULT_MODEL = 'cohere-transcribe-03-2026';
// Of Cohere Transcribe's 14 languages, the app speaks these two.
const LANGS = new Set(['en', 'ar']);
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;

function config() {
  const key = String(process.env.COHERE_API_KEY || '').trim();
  return {
    apiKey: key,
    model: String(process.env.COHERE_TRANSCRIBE_MODEL || DEFAULT_MODEL).trim(),
    timeoutMs: Number(process.env.VOICE_TIMEOUT_MS || 20000),
    enabled: !!key && process.env.VOICE_ENABLED !== '0'
  };
}

function maskKey(k) {
  return k ? k.slice(0, 4) + '…' + k.slice(-4) : '';
}

/** Cheap check that the bytes really are a WAV, before spending an API call. */
function looksLikeWav(buf) {
  return buf.length > 44 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WAVE';
}

/**
 * @param {{ audio: Buffer, lang: string, mime?: string }} opts
 * @returns {Promise<{ok:true,text:string,ms:number}|{ok:false,code:string,error:string,ms?:number}>}
 */
async function transcribe(opts) {
  const cfg = config();
  if (!cfg.enabled) return { ok: false, code: 'NOT_CONFIGURED', error: 'COHERE_API_KEY is not set' };

  const audio = opts && opts.audio;
  if (!Buffer.isBuffer(audio) || audio.length < 1000) {
    return { ok: false, code: 'NO_AUDIO', error: 'recording is empty or too short' };
  }
  if (audio.length > MAX_AUDIO_BYTES) {
    return { ok: false, code: 'TOO_LONG', error: 'recording is too long' };
  }
  const mime = (opts.mime || 'audio/wav').toLowerCase();
  if (mime.includes('wav') && !looksLikeWav(audio)) {
    return { ok: false, code: 'BAD_AUDIO', error: 'not a WAV file' };
  }
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mpeg') || mime.includes('mp3') ? 'mp3'
    : mime.includes('flac') ? 'flac' : 'wav';
  const lang = LANGS.has(opts.lang) ? opts.lang : 'en';

  const form = new FormData();
  form.append('model', cfg.model);
  form.append('language', lang);
  form.append('temperature', '0');
  form.append('file', new Blob([audio], { type: mime }), 'voice.' + ext);

  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.apiKey, Accept: 'application/json' },
      body: form,
      signal: ctrl.signal
    });
    const ms = Date.now() - started;
    const raw = await res.text();
    let body = null;
    try { body = JSON.parse(raw); } catch (_) { body = null; }
    if (!res.ok) {
      const msg = (body && (body.message || body.error)) || raw.slice(0, 200) || ('HTTP ' + res.status);
      const code = res.status === 401 || res.status === 403 ? 'BAD_KEY'
        : res.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR';
      return { ok: false, code, error: String(msg), status: res.status, ms };
    }
    const text = String((body && body.text) || '').trim();
    if (!text) return { ok: false, code: 'NO_SPEECH', error: 'no speech recognised', ms };
    return { ok: true, text, ms, model: cfg.model, lang };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return {
      ok: false,
      code: aborted ? 'TIMEOUT' : 'NETWORK',
      error: aborted ? 'Cohere did not answer within ' + cfg.timeoutMs + ' ms' : String((err && err.message) || err),
      ms: Date.now() - started
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { transcribe, config, maskKey, looksLikeWav, MAX_AUDIO_BYTES, DEFAULT_MODEL };
