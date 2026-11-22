'use strict';

/**
 * Live flight status — real departures from the airport's own feed.
 *
 * King Fahd International publishes departures as JSON behind its own site:
 *     https://kfia.sa/api/aodb/flights?arr_dep=D
 *
 * Verified live 2026-11-22: HTTP 200, 718 departures, real gates. Records carry
 * GATE_1, CHECKIN_1/2, TERMINAL, FL_STATUS_1, SCH_TIME, EST_TIME and a remark.
 *
 * RULES
 *  1. Never invent. A null on the feed is null here.
 *  2. Never block the conversation. Failures are values, not throws.
 *  3. Cache briefly so one chat does not hammer the airport server.
 *  4. The fallback is honest: { ok:false }, never a guessed gate.
 */

const FEEDS = {
  dmm: {
    name: 'King Fahd International Airport (Dammam)',
    departures: 'https://kfia.sa/api/aodb/flights?arr_dep=D',
    supported: true
  },
  ruh: { name: 'King Khalid International Airport (Riyadh)', supported: false },
  jed: { name: 'King Abdulaziz International Airport (Jeddah)', supported: false }
};

const CACHE_TTL_MS = Number(process.env.FG_STATUS_TTL_MS || 90000);
const FETCH_TIMEOUT_MS = Number(process.env.FG_STATUS_TIMEOUT_MS || 12000);
const cache = new Map();

function log(event, detail) {
  const stamp = new Date().toISOString();
  const tail = detail === undefined ? '' : ' ' + JSON.stringify(detail);
  console.log('[status] ' + stamp + ' ' + event + tail);
}

function normalizeAirport(code) {
  const c = String(code || '').trim().toLowerCase();
  if (c === 'dmm' || c === 'dammam' || c === 'kfia') return 'dmm';
  if (c === 'ruh' || c === 'riyadh' || c === 'kkia') return 'ruh';
  if (c === 'jed' || c === 'jeddah' || c === 'kaia') return 'jed';
  return null;
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || FETCH_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'FlightGuide/1.0 (first-time-traveller assistant)',
        Accept: 'application/json'
      }
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      log('feed-http-error', { url, status: res.status, ms });
      return { ok: false, code: 'FEED_HTTP', status: res.status, ms };
    }
    const json = await res.json();
    log('feed-ok', { url, ms, flights: Array.isArray(json.FLIGHTS) ? json.FLIGHTS.length : 0 });
    return { ok: true, json, ms };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    const ms = Date.now() - started;
    log('feed-error', { url, ms, code: aborted ? 'TIMEOUT' : 'NETWORK' });
    return { ok: false, code: aborted ? 'TIMEOUT' : 'NETWORK', ms };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Split a flight number as printed on a ticket into airline + digits.
 *
 * Real tickets and boarding passes write these inconsistently:
 *   XY811   XY-811   XY 811   EY-7450   F3-123   3O-123   MS 1234
 * The feed only stores the digits, so every one of those has to resolve to
 * the same number. Stripping only whitespace meant "XY-811" — the exact
 * format on a scanned ticket — parsed to nothing, the live lookup never ran,
 * and the agent told a traveller it could not see flight status.
 */
function flightDigits(flight) {
  const raw = String(flight || '').toUpperCase().trim();
  // Airline designator: two letters/digits (F3, 3O) optionally separated from
  // the number by a space or hyphen. Captured separately so "3O-123" is not
  // misread as airline "3O" with an empty number.
  const m = raw.match(/^([A-Z0-9]{1,2})\s*-?\s*(\d{1,4}[A-Z]?)$/);
  if (m && /[A-Z]/.test(m[1])) {
    return { airline: m[1], number: m[2].replace(/[A-Z]$/, '') };
  }
  // Bare number ("811") — no airline, still worth a lookup.
  const bare = raw.replace(/[^0-9]/g, '');
  if (/^\d{1,4}$/.test(bare)) {
    return { airline: null, number: bare };
  }
  return { airline: null, number: null };
}

function minutesBetween(a, b) {
  const ta = Date.parse(a), tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round((tb - ta) / 60000);
}

function shapeFlight(f) {
  const delayMin = minutesBetween(f.SCH_TIME, f.EST_TIME);
  const out = {
    airline: f.AIRLINE_DESCR || f.AIRLINE || null,
    airlineCode: f.AIRLINE || null,
    flight: f.FL_NUMBER ? String(f.FL_NUMBER).trim() : null,
    international: f.INT_DOM === 'I' ? true : (f.INT_DOM === 'D' ? false : null),
    destination: f.ROUTING_ENG || f.ROUTING || null,
    destinationAr: f.ROUTING_KA || null,
    scheduled: f.SCH_TIME || null,
    estimated: f.EST_TIME || null,
    delayMinutes: delayMin != null && delayMin > 0 ? delayMin : 0,
    status: f.FL_STATUS_1 || null,
    terminal: f.TERMINAL || null,
    gate: f.GATE_1 ? String(f.GATE_1).trim() : null,
    checkinCounters: [f.CHECKIN_1, f.CHECKIN_2].filter(Boolean).join(', ') || null,
    remark: f.PUB_RMK_ENG || f.PUB_RMK || null,
    remarkAr: f.PUB_RMK_KA || null,
    via: f.VIA_ENG || null
  };
  for (const k of Object.keys(out)) {
    if (out[k] === null || out[k] === '') delete out[k];
  }
  return out;
}

async function departures(airport, opts) {
  const code = normalizeAirport(airport);
  const force = !!(opts && opts.force);
  if (!code) return { ok: false, code: 'UNKNOWN_AIRPORT', error: 'unknown airport' };

  const feed = FEEDS[code];
  if (!feed.supported) {
    log('not-supported', { airport: code });
    return {
      ok: false, code: 'NOT_SUPPORTED',
      error: feed.name + ' does not publish the same live feed',
      airport: code, airportName: feed.name
    };
  }

  const now = Date.now();
  const hit = cache.get(code);
  if (!force && hit && now - hit.at < CACHE_TTL_MS) {
    log('cache-hit', { airport: code, ageMs: now - hit.at });
    return Object.assign({}, hit.payload, { cached: true });
  }

  const res = await fetchJson(feed.departures);
  if (!res.ok) {
    if (hit) {
      log('serve-stale', { airport: code, ageMs: now - hit.at });
      return Object.assign({}, hit.payload, { cached: true, stale: true, ageMs: now - hit.at });
    }
    return { ok: false, code: res.code, error: 'live departures unreachable',
      airport: code, airportName: feed.name };
  }

  const flights = Array.isArray(res.json.FLIGHTS) ? res.json.FLIGHTS : [];
  const payload = {
    ok: true, airport: code, airportName: feed.name,
    currentTime: res.json.CURRENT_TIME || null,
    count: flights.length, flights, ms: res.ms
  };
  cache.set(code, { at: now, payload });
  return payload;
}

async function findFlight(airport, flight, opts) {
  const parts = flightDigits(flight);
  if (!parts.number) return { ok: false, code: 'NO_FLIGHT_NUMBER', error: 'no flight number given' };
  const airline = parts.airline;
  const number = parts.number;

  const dep = await departures(airport, opts);
  if (!dep.ok) return dep;

  const all = dep.flights || [];
  let matches = all.filter(function (f) {
    if (String(f.FL_NUMBER || '').trim() !== number) return false;
    if (airline && String(f.AIRLINE || '').toUpperCase() !== airline) return false;
    return true;
  });

  if (matches.length > 1) {
    const nowMs = Date.now();
    const upcoming = matches.filter(function (f) {
      const t = Date.parse(f.EST_TIME || f.SCH_TIME || '');
      return !Number.isNaN(t) && t > nowMs - 30 * 60000;
    });
    if (upcoming.length) matches = upcoming;
  }

  if (!matches.length) {
    log('flight-not-found', { airport: dep.airport, flight: number });
    return { ok: false, code: 'NOT_FOUND',
      error: 'flight ' + number + " is not in today's departures",
      airport: dep.airport, airportName: dep.airportName, count: dep.count };
  }

  const chosen = matches[0];
  log('flight-found', { airport: dep.airport, flight: chosen.FL_NUMBER,
    gate: chosen.GATE_1 || null, status: chosen.FL_STATUS_1 || null,
    matches: matches.length });

  return {
    ok: true, airport: dep.airport, airportName: dep.airportName,
    flight: shapeFlight(chosen), matches: matches.length,
    cached: !!dep.cached, stale: !!dep.stale
  };
}

function summaryLine(result, lang) {
  if (!result || !result.ok || !result.flight) return null;
  const f = result.flight;
  const bits = [];
  if (lang === 'ar') {
    if (f.gate) bits.push('\u0627\u0644\u0628\u0648\u0627\u0628\u0629 ' + f.gate);
    if (f.terminal) bits.push('\u0627\u0644\u0635\u0627\u0644\u0629 ' + f.terminal);
    if (f.delayMinutes) bits.push('\u0645\u062a\u0623\u062e\u0631\u0629 ' + f.delayMinutes + ' \u062f\u0642\u064a\u0642\u0629');
    if (f.remarkAr) bits.push(f.remarkAr);
    if (f.checkinCounters) bits.push('\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u0648\u0635\u0648\u0644 ' + f.checkinCounters);
  } else {
    if (f.gate) bits.push('gate ' + f.gate);
    if (f.terminal) bits.push('terminal ' + f.terminal);
    if (f.delayMinutes) bits.push(f.delayMinutes + ' minutes late');
    if (f.remark) bits.push(f.remark);
    if (f.checkinCounters) bits.push('check-in ' + f.checkinCounters);
  }
  if (!bits.length) return null;
  return (f.flight ? 'Flight ' + f.flight + ': ' : '') + bits.join(', ') + '.';
}

module.exports = {
  FEEDS, CACHE_TTL_MS,
  normalizeAirport, departures, findFlight, summaryLine,
  _internal: { shapeFlight, flightDigits, minutesBetween, cache }
};
