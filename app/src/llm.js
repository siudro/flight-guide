'use strict';

/**
 * LLM adapter — the model writes the reply, the rules own the state.
 *
 * DESIGN RULES that shaped this file:
 *
 * 1. THE KEY NEVER LEAVES THE SERVER. It comes from ".env" (git-ignored) or the
 *    real environment. It is used only for the outbound provider call;
 *    /api/settings reports only whether one exists. It is never logged in full:
 *    mask() shows six leading and four trailing characters.
 *
 * 2. THE RULE ENGINE STILL RUNS FIRST. It owns conversation state, the
 *    four-facts gate and the safety escalation. The model is given those
 *    decisions and writes the words: it cannot advance the flow, invent a gate,
 *    or skip the safety warning.
 *
 * 3. IT DEGRADES, IT NEVER FAILS. No key, bad key, rate limit, offline,
 *    timeout, unsafe output — every case falls back to the deterministic reply
 *    and the reason is logged. The traveller always gets an answer.
 *
 * 4. EVERY DECISION IS LOUD. Each turn logs one line saying which path ran:
 *      [llm] LLM   turn 3  stage=checkin  prompt=v2  gpt-4o-mini  842ms
 *      [llm] RULES turn 4  stage=security  (no key configured)
 */

const prompts = require('./prompts');

const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    envKey: 'OPENAI_API_KEY',
    supportsVision: true
  },
  deepinfra: {
    label: 'DeepInfra',
    url: 'https://api.deepinfra.com/v1/openai/chat/completions',
    defaultModel: 'deepseek-ai/DeepSeek-V4.1-Flash-1017',
    envKey: 'DEEPINFRA_API_KEY',
    supportsVision: false
  },
  deepseek: {
    label: 'DeepSeek',
    url: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-chat',
    envKey: 'DEEPSEEK_API_KEY',
    supportsVision: false
  },
  groq: {
    label: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.3-70b-versatile',
    envKey: 'GROQ_API_KEY',
    supportsVision: false
  },
  openrouter: {
    label: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    envKey: 'OPENROUTER_API_KEY',
    supportsVision: false
  }
};

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_VISION_TIMEOUT_MS = 45000;
const MAX_REPLY_CHARS = 1200;

/** First 6 and last 4 characters. Enough to recognise, useless to steal. */
function mask(key) {
  const k = String(key || '');
  if (k.length <= 12) return k ? '••••' : '';
  return k.slice(0, 6) + '…' + k.slice(-4);
}

/**
 * Resolve the effective provider configuration.
 * Precedence: real environment > admin panel > nothing.
 * Returns { provider, label, model, apiKey, source, enabled, configured, supportsVision }
 */
function resolveConfig(settings) {
  const ai = (settings && settings.ai) || {};
  const provider = PROVIDERS[ai.provider] ? ai.provider : 'openai';
  const conf = PROVIDERS[provider];

  const fromEnv = process.env[conf.envKey] || '';
  const fromSettings = ai.apiKey || '';
  const apiKey = fromEnv || fromSettings;
  const source = fromEnv ? 'env' : (fromSettings ? 'admin' : 'none');

  const model = ai.model || process.env.OPENAI_MODEL || conf.defaultModel;
  // An environment key is an explicit opt-in: putting OPENAI_API_KEY in .env
  // means "use it". The admin toggle still governs a key entered in the panel,
  // and LLM_ENABLED=0 is the master switch for both.
  const enabled = process.env.LLM_ENABLED !== '0' && (!!fromEnv || ai.enabled !== false);

  return {
    provider, label: conf.label, model, apiKey, source, enabled,
    configured: !!apiKey && enabled,
    supportsVision: !!conf.supportsVision
  };
}

function buildSystemPrompt(opts) {
  const ctx = opts.context || {};
  const airportName = ctx.airportName || ctx.airport || 'an airport in Saudi Arabia';
  return prompts.build({
    lang: opts.lang,
    version: opts.promptVersion,
    context: Object.assign({}, ctx, { airportName }),
    ticket: opts.ticket,
    status: opts.status,
    tools: opts.tools
  });
}

function trim(text) {
  const s = String(text || '').trim();
  if (s.length <= MAX_REPLY_CHARS) return s;
  return s.slice(0, MAX_REPLY_CHARS).replace(/\s+\S*$/, '') + '…';
}

/**
 * Reject a reply that claims a specific gate/terminal we never supplied.
 * A fabricated gate is the most dangerous output this app can produce.
 */
function looksUnsafe(reply, ctx) {
  const r = String(reply || '');
  if (!r.trim()) return 'empty reply';

  // No \b anywhere: JavaScript word boundaries are ASCII-only, so "بوابة"
  // would never match. The number must start the token, which is enough.
  const gateRe = /(?:gate|بوابة|بوابه)\s*(?:number\s*)?([A-Z]?\d{1,3}[A-Z]?)/i;
  const m = r.match(gateRe);
  if (m && ctx.gate && String(ctx.gate).toUpperCase() !== m[1].toUpperCase()) {
    return 'invented gate ' + m[1] + ' (known gate ' + ctx.gate + ')';
  }
  if (m && !ctx.gate) return 'invented gate ' + m[1] + ' (no gate supplied)';
  return null;
}

/**
 * GPT-6 / GPT-5 / o-series reject `max_tokens` and expect
 * `max_completion_tokens`; GPT-6 Luna also rejects any temperature but 1.
 * Either would be a hard 400 on every call, so both are decided from the
 * model name instead of being sent blindly.
 */
function usesCompletionTokens(model) {
  return /^(gpt-6|gpt-5|o1|o3|o4)/.test(String(model || '').toLowerCase());
}

async function callProvider(opts) {
  const { apiKey, provider, model, messages, timeoutMs, temperature, maxTokens } = opts;
  const conf = PROVIDERS[provider] || PROVIDERS.openai;
  if (!apiKey) return { ok: false, error: 'no API key configured', code: 'NO_KEY' };

  const effectiveModel = model || conf.defaultModel;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);

  const body = { model: effectiveModel, messages };
  if (usesCompletionTokens(effectiveModel)) {
    body.max_completion_tokens = Math.max(maxTokens || 400, 1500);
    body.reasoning_effort = opts.reasoningEffort || 'low';
    if (temperature === 1) body.temperature = 1;
  } else {
    body.temperature = temperature == null ? 0.4 : temperature;
    body.max_tokens = maxTokens || 400;
  }

  try {
    const res = await fetch(conf.url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const status = res.status;
      let code = 'PROVIDER_ERROR';
      if (status === 401 || status === 403) code = 'BAD_KEY';
      else if (status === 429) code = 'RATE_LIMIT';
      else if (status >= 500) code = 'PROVIDER_DOWN';
      return {
        ok: false, error: conf.label + ' returned ' + status, code, status,
        detail: String(body).slice(0, 200)
      };
    }

    const json = await res.json();
    const text = json && json.choices && json.choices[0] && json.choices[0].message
      ? json.choices[0].message.content
      : (json && json.output_text) || '';

    return {
      ok: true, text: text || '', model: effectiveModel,
      provider, usage: (json && json.usage) || null
    };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return {
      ok: false,
      error: aborted ? 'provider timed out' : ((err && err.message) || 'network error'),
      code: aborted ? 'TIMEOUT' : 'NETWORK'
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Write one reply. Resolves to { ok, text, ... } and never throws.
 * opts.engine is what the rule engine decided; the model expresses it.
 */
async function reply(opts) {
  const cfg = opts.config || resolveConfig(opts.settings);
  if (!cfg.configured) {
    return { ok: false, code: 'NOT_CONFIGURED', error: 'LLM not configured' };
  }

  const built = buildSystemPrompt({
    lang: opts.lang,
    promptVersion: opts.promptVersion,
    context: opts.context,
    ticket: opts.ticket,
    status: opts.status,
    tools: opts.tools
  });

  const messages = [{ role: 'system', content: built.text }];

  if (opts.engine && opts.engine.text) {
    messages.push({
      role: 'system',
      content:
        'The rule engine decided this turn\'s substance. Say the same thing in your own words, ' +
        'warmer and shorter, keeping every fact identical:\n\n' + opts.engine.text
    });
  }

  for (const h of (opts.history || []).slice(-8)) {
    if (h && (h.role === 'user' || h.role === 'assistant') && h.content) {
      messages.push({ role: h.role, content: String(h.content).slice(0, 1200) });
    }
  }

  messages.push({ role: 'user', content: String(opts.message || '').slice(0, 2000) });

  const started = Date.now();
  const res = await callProvider({
    apiKey: cfg.apiKey, provider: cfg.provider, model: cfg.model, messages
  });
  const ms = Date.now() - started;

  if (!res.ok) return Object.assign({}, res, { ms, prompt: built });

  const unsafe = looksUnsafe(res.text, opts.context || {});
  if (unsafe) return { ok: false, code: 'UNSAFE_OUTPUT', error: unsafe, ms, prompt: built };

  return {
    ok: true, text: trim(res.text), model: res.model, provider: res.provider,
    usage: res.usage, ms, prompt: built
  };
}

const TICKET_SCHEMA_INSTRUCTIONS = [
  'You are reading a boarding pass or flight ticket photographed by a traveller.',
  'Return ONLY a JSON object, no markdown, with these keys, using null where a value is not visible:',
  '{"flight":null,"airline":null,"terminal":null,"gate":null,"seat":null,"destination":null,"boarding":null,"date":null,"airport":null}',
  '',
  'Rules:',
  '- Copy values exactly as printed. Never guess or complete a partial value.',
  '- "boarding" is the boarding time as HH:MM (24h). "date" is YYYY-MM-DD if visible.',
  '- "airport" is the departure airport code (DMM, RUH, JED) if visible.',
  '- Terminal is often printed as "Terminal" / "T" / "الصالة".',
  '- If the image is not a ticket at all, return all keys as null.',
  '- If you cannot read a field, use null. Do not invent a plausible gate or seat.'
].join('\n');

function parseTicketJson(text) {
  const raw = String(text || '').trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const out = {};
    for (const k of ['flight','airline','terminal','gate','seat','destination','boarding','date','airport']) {
      if (obj[k] != null && String(obj[k]).trim() !== '') {
        out[k] = String(obj[k]).trim().slice(0, 40);
      }
    }
    return out;
  } catch (_) {
    return null;
  }
}

/**
 * Read a ticket image. image is { data: base64, mime: 'image/jpeg' }.
 * Resolves to { ok, fields, ms } or { ok:false, code, error }. Never throws,
 * never returns a fabricated field.
 */
async function readTicket(opts) {
  const cfg = opts.config || resolveConfig(opts.settings);
  if (!cfg.configured) return { ok: false, code: 'NOT_CONFIGURED', error: 'LLM not configured' };
  if (!cfg.supportsVision) return { ok: false, code: 'NO_VISION', error: cfg.label + ' cannot read images in this build' };

  const img = opts.image || {};
  if (!img.data) return { ok: false, code: 'NO_IMAGE', error: 'no image supplied' };
  const mime = /^image\/(png|jpe?g|webp|gif)$/i.test(img.mime || '') ? img.mime : 'image/jpeg';

  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: TICKET_SCHEMA_INSTRUCTIONS },
      { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + img.data } }
    ]
  }];

  const started = Date.now();
  const res = await callProvider({
    apiKey: cfg.apiKey, provider: cfg.provider, model: cfg.model, messages,
    timeoutMs: opts.timeoutMs || DEFAULT_VISION_TIMEOUT_MS, maxTokens: 300
  });
  const ms = Date.now() - started;

  if (!res.ok) return Object.assign({}, res, { ms });

  const fields = parseTicketJson(res.text);
  if (!fields) {
    return { ok: false, code: 'BAD_JSON', error: 'model did not return readable fields', ms,
      raw: String(res.text).slice(0, 300) };
  }
  return { ok: true, fields, ms, model: res.model, provider: res.provider };
}

async function verify(opts) {
  // The panel tests a key it has not saved yet, so an explicit key/provider in
  // opts must win over whatever is on disk.
  let cfg;
  if (opts.apiKey) {
    const provider = PROVIDERS[opts.provider] ? opts.provider : 'openai';
    const conf = PROVIDERS[provider];
    cfg = {
      provider, label: conf.label,
      model: opts.model || conf.defaultModel,
      apiKey: opts.apiKey, source: 'test', enabled: true, configured: true
    };
  } else {
    cfg = opts.config || resolveConfig(opts.settings);
  }
  if (!cfg.configured) {
    const conf = PROVIDERS[cfg.provider] || PROVIDERS.openai;
    return {
      ok: false, code: 'NOT_CONFIGURED',
      error: `No key yet. Paste a ${conf.label} key above, or put ${conf.envKey} in .env and restart.`
    };
  }
  const started = Date.now();
  const res = await callProvider({
    apiKey: cfg.apiKey, provider: cfg.provider, model: cfg.model,
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    timeoutMs: 20000, maxTokens: 10
  });
  const ms = Date.now() - started;
  if (res.ok) return { ok: true, message: 'Connected to ' + res.provider + ' (' + res.model + ').', ms };

  const friendly = {
    BAD_KEY: 'That key was rejected. Check you copied the whole key, and that it belongs to this provider.',
    NO_KEY: 'No API key supplied. Paste one first.',
    RATE_LIMIT: 'This key is rate-limited. Wait a minute and try again.',
    PROVIDER_DOWN: 'The provider is having an outage. The site still works without it.',
    TIMEOUT: 'The provider did not answer in time. Try again.',
    NETWORK: 'No internet connection from the server.',
    UNSAFE_OUTPUT: 'The model returned something unusable. Try again.'
  };
  return { ok: false, code: res.code, error: friendly[res.code] || res.error, detail: res.error, ms };
}

module.exports = {
  PROVIDERS, DEFAULT_TIMEOUT_MS, resolveConfig, buildSystemPrompt,
  reply, readTicket, verify, mask,
  _internal: { looksUnsafe, trim, parseTicketJson, callProvider, usesCompletionTokens }
};
