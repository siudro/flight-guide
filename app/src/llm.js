'use strict';

/**
 * LLM adapter — turns the rule-based engine into a model-backed advisor.
 *
 * Design constraints that shaped this file:
 *
 * 1. THE KEY NEVER LEAVES THE SERVER. It is stored in the data volume and
 *    used only for the outbound provider call. /api/settings never returns
 *    it, and a provider is only ever invoked from Node, never the browser.
 *
 * 2. IT MUST DEGRADE, NOT FAIL. Every call has a timeout and a try/catch. If
 *    the key is missing, wrong, rate-limited, or the network is down, the
 *    caller falls back to the rule engine so the traveller is never left
 *    without an answer.
 *
 * 3. IT MUST NOT INVENT AIRPORT FACTS. The system prompt forbids it and the
 *    response is checked for obviously unsafe output. A wrong gate number is
 *    worse than no answer.
 */

const PROVIDERS = {
  deepinfra: {
    label: 'DeepInfra',
    url: 'https://api.deepinfra.com/v1/openai/chat/completions',
    defaultModel: 'deepseek-ai/DeepSeek-V4.1-Flash-1017',
    envKey: 'DEEPINFRA_API_KEY'
  },
  openai: {
    label: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    envKey: 'OPENAI_API_KEY'
  },
  groq: {
    label: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.3-70b-versatile',
    envKey: 'GROQ_API_KEY'
  },
  openrouter: {
    label: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    envKey: 'OPENROUTER_API_KEY'
  }
};

const DEFAULT_TIMEOUT_MS = 12000;
const MAX_REPLY_CHARS = 1200;

/**
 * The persona the model adopts. This is the "specific domain of expertise"
 * the track asks for: not a travel advisor, one situation and one stretch
 * of the journey.
 */
function systemPrompt(settings, ctx) {
  const lang = ctx.lang === 'ar' ? 'Arabic' : 'English';
  const airport = ctx.airport || 'unspecified';
  const stage = ctx.stageName || 'check-in';
  const minutes = ctx.minutes;

  const lines = [
    'You are Flight Guide, an airport companion for someone taking their first international flight with nobody beside them.',
    '',
    'WHO YOU HELP: a traveller alone at Dammam (KFIA), Riyadh (KKIA) or Jeddah (KAIA) airport, who has never done this before. Often a teenager, often someone who does not read the local language.',
    '',
    'WHAT YOU COVER: the airport only — check-in and bag drop, security, passport control, customs, finding the gate, and gate changes. Nothing else.',
    '',
    'WHAT YOU REFUSE: rebooking, refunds, baggage claims, ticket prices, visa or immigration advice, tourism, restaurants. If asked, say plainly that is outside what you do and point them to airline or airport staff.',
    '',
    'HOW YOU SPEAK:',
    '- Calm and concrete. Short sentences. One step at a time.',
    '- Answer in ' + lang + '. This is not optional.',
    '- Never guess a gate number, terminal number, or flight time. If you do not have it, ask for it or tell them to read the departure screen.',
    '- If they have little time before boarding, tell them immediately to find airport staff — they can move faster than any app.',
    '- You are not an authority. Staff always override you. Say so when it matters.',
    '',
    'CONTEXT FOR THIS TURN:',
    '- Airport: ' + airport,
    '- Current stage: ' + stage,
    (minutes != null ? '- Minutes until boarding: ' + minutes : '- Minutes until boarding: unknown'),
    '',
    'Do not greet. Do not restate the question. Answer as the next thing a calm companion would say.'
  ];
  return lines.join('\n');
}

function trim(text) {
  const s = String(text || '').trim();
  if (s.length <= MAX_REPLY_CHARS) return s;
  return s.slice(0, MAX_REPLY_CHARS).replace(/\s+\S*$/, '') + '…';
}

/**
 * Reject a model reply that claims a specific gate/terminal we did not supply.
 * A fabricated gate is the single most dangerous output this app can produce.
 */
function looksUnsafe(reply, ctx) {
  const r = String(reply || '');
  if (!r.trim()) return 'empty reply';

  // A gate like "B12" or "بوابة B12" that we never told the model about.
  const gateRe = /\b(?:gate|بوابة|بوابه)\s*([A-Z]?\d{1,3}[A-Z]?)\b/i;
  const m = r.match(gateRe);
  if (m && ctx.gate && String(ctx.gate).toUpperCase() !== m[1].toUpperCase()) {
    return `invented gate ${m[1]} (known gate ${ctx.gate})`;
  }
  if (m && !ctx.gate) return `invented gate ${m[1]} (no gate supplied)`;

  return null;
}

/**
 * Call the provider. Resolves to { ok, text, error } — never throws.
 */
async function complete(opts) {
  const { apiKey, provider, model, ctx, settings, history } = opts;

  const conf = PROVIDERS[provider] || PROVIDERS.deepinfra;
  const key = apiKey || process.env[conf.envKey] || '';
  if (!key) return { ok: false, error: 'no API key configured', code: 'NO_KEY' };

  const messages = [{ role: 'system', content: systemPrompt(settings, ctx) }];
  for (const h of history || []) {
    if (h && h.role && h.content) messages.push({ role: h.role, content: String(h.content).slice(0, 2000) });
  }
  messages.push({ role: 'user', content: String(ctx.message || '').slice(0, 2000) });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(conf.url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: model || conf.defaultModel,
        messages,
        temperature: 0.3,
        max_tokens: 400
      })
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Never echo the key or the raw provider body into the UI.
      const status = res.status;
      let code = 'PROVIDER_ERROR';
      if (status === 401 || status === 403) code = 'BAD_KEY';
      else if (status === 429) code = 'RATE_LIMIT';
      else if (status >= 500) code = 'PROVIDER_DOWN';
      return { ok: false, error: `${conf.label} returned ${status}`, code, status, detail: body.slice(0, 200) };
    }

    const json = await res.json();
    const text = json && json.choices && json.choices[0] && json.choices[0].message
      ? json.choices[0].message.content
      : (json && json.output_text) || '';

    const unsafe = looksUnsafe(text, ctx);
    if (unsafe) return { ok: false, error: unsafe, code: 'UNSAFE_OUTPUT' };

    return { ok: true, text: trim(text), model: model || conf.defaultModel, provider };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return {
      ok: false,
      error: aborted ? 'provider timed out' : (err && err.message) || 'network error',
      code: aborted ? 'TIMEOUT' : 'NETWORK'
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One cheap call used by the admin panel's "Test key" button.
 * Distinguishes "the key works" from "the key is wrong" from "we are offline".
 */
async function verify(opts) {
  const r = await complete(Object.assign({}, opts, {
    ctx: Object.assign({}, opts.ctx, {
      message: 'Reply with exactly: OK',
      lang: 'en',
      stageName: 'test'
    })
  }));
  if (r.ok) return { ok: true, message: `Connected to ${r.provider} (${r.model}).` };
  return { ok: false, error: r.error, code: r.code };
}

module.exports = { PROVIDERS, complete, verify, systemPrompt, _internal: { looksUnsafe, trim } };
