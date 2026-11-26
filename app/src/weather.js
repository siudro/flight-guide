'use strict';

/**
 * Weather heads-up — "could weather slow my flight down?"
 *
 * Source: Open-Meteo (free, no key for non-commercial use).
 *   forecast     https://api.open-meteo.com/v1/forecast
 *                hourly weather_code, visibility (m), wind_gusts_10m (km/h),
 *                precipitation, temperature_2m
 *   air quality  https://air-quality-api.open-meteo.com/v1/air-quality
 *                hourly dust (µg/m³) — sand and dust storms matter at
 *                Riyadh and Dammam far more than rain does.
 *
 * What this is NOT: a delay prediction. Airlines delay flights for many
 * reasons and only the departure board says what is happening. The report
 * names weather that commonly slows airports down — thunderstorms, fog, dust
 * storms, strong wind, heavy rain or snow — around departure time at the
 * departure airport, and over the next hours at the destination. Every reply
 * built from it sends the traveller back to the board.
 *
 * Rules shared with the rest of the app: failures are values, never throws;
 * an unknown destination is said plainly, never guessed; results are cached
 * so one conversation does not hammer the service.
 */

const FORECAST_URL = process.env.OPENMETEO_FORECAST_URL || 'https://api.open-meteo.com/v1/forecast';
const AIR_URL = process.env.OPENMETEO_AIR_URL || 'https://air-quality-api.open-meteo.com/v1/air-quality';
const TIMEOUT_MS = Number(process.env.FG_WEATHER_TIMEOUT_MS || 8000);
const TTL_MS = Number(process.env.FG_WEATHER_TTL_MS || 15 * 60000);

// Airport coordinates (city scale is enough for weather). The three Saudi
// airports the app serves, Saudi domestic airports, and the common
// international destinations from them. Keys are IATA codes.
const PLACES = {
  DMM: { lat: 26.4712, lon: 49.7979, en: 'Dammam', ar: 'الدمام', names: ['dammam', 'الدمام', 'دمام'] },
  RUH: { lat: 24.9576, lon: 46.6988, en: 'Riyadh', ar: 'الرياض', names: ['riyadh', 'الرياض', 'رياض'] },
  JED: { lat: 21.6796, lon: 39.1565, en: 'Jeddah', ar: 'جدة', names: ['jeddah', 'jiddah', 'جدة', 'جده'] },
  MED: { lat: 24.5534, lon: 39.7051, en: 'Madinah', ar: 'المدينة المنورة', names: ['madinah', 'medina', 'madina', 'المدينة'] },
  AHB: { lat: 18.2404, lon: 42.6566, en: 'Abha', ar: 'أبها', names: ['abha', 'أبها', 'ابها'] },
  TIF: { lat: 21.4834, lon: 40.5443, en: 'Taif', ar: 'الطائف', names: ['taif', 'الطائف'] },
  GIZ: { lat: 16.9011, lon: 42.5858, en: 'Jazan', ar: 'جازان', names: ['jazan', 'jizan', 'gizan', 'جازان', 'جيزان'] },
  TUU: { lat: 28.3654, lon: 36.6189, en: 'Tabuk', ar: 'تبوك', names: ['tabuk', 'تبوك'] },
  ELQ: { lat: 26.3028, lon: 43.7744, en: 'Qassim', ar: 'القصيم', names: ['qassim', 'gassim', 'buraydah', 'القصيم'] },
  HOF: { lat: 25.2853, lon: 49.4852, en: 'Al-Ahsa', ar: 'الأحساء', names: ['ahsa', 'hofuf', 'الأحساء', 'الاحساء'] },
  DXB: { lat: 25.2532, lon: 55.3657, en: 'Dubai', ar: 'دبي', names: ['dubai', 'دبي'] },
  AUH: { lat: 24.4330, lon: 54.6511, en: 'Abu Dhabi', ar: 'أبوظبي', names: ['abu dhabi', 'أبوظبي', 'ابوظبي', 'أبو ظبي'] },
  SHJ: { lat: 25.3286, lon: 55.5172, en: 'Sharjah', ar: 'الشارقة', names: ['sharjah', 'الشارقة'] },
  DOH: { lat: 25.2731, lon: 51.6081, en: 'Doha', ar: 'الدوحة', names: ['doha', 'الدوحة', 'qatar'] },
  BAH: { lat: 26.2708, lon: 50.6336, en: 'Bahrain', ar: 'البحرين', names: ['bahrain', 'manama', 'البحرين', 'المنامة'] },
  KWI: { lat: 29.2266, lon: 47.9689, en: 'Kuwait', ar: 'الكويت', names: ['kuwait', 'الكويت'] },
  MCT: { lat: 23.5933, lon: 58.2844, en: 'Muscat', ar: 'مسقط', names: ['muscat', 'مسقط'] },
  CAI: { lat: 30.1219, lon: 31.4056, en: 'Cairo', ar: 'القاهرة', names: ['cairo', 'القاهرة'] },
  HBE: { lat: 30.9177, lon: 29.6964, en: 'Alexandria', ar: 'الإسكندرية', names: ['alexandria', 'borg el arab', 'الإسكندرية', 'الاسكندرية'] },
  AMM: { lat: 31.7226, lon: 35.9932, en: 'Amman', ar: 'عمّان', names: ['amman', 'عمّان'] },
  BEY: { lat: 33.8209, lon: 35.4884, en: 'Beirut', ar: 'بيروت', names: ['beirut', 'بيروت'] },
  IST: { lat: 41.2753, lon: 28.7519, en: 'Istanbul', ar: 'إسطنبول', names: ['istanbul', 'إسطنبول', 'اسطنبول'] },
  SAW: { lat: 40.8986, lon: 29.3092, en: 'Istanbul Sabiha Gökçen', ar: 'إسطنبول صبيحة', names: ['sabiha'] },
  LHR: { lat: 51.4700, lon: -0.4543, en: 'London', ar: 'لندن', names: ['london', 'heathrow', 'لندن'] },
  CDG: { lat: 49.0097, lon: 2.5479, en: 'Paris', ar: 'باريس', names: ['paris', 'باريس'] },
  KHI: { lat: 24.9065, lon: 67.1608, en: 'Karachi', ar: 'كراتشي', names: ['karachi', 'كراتشي'] },
  LHE: { lat: 31.5216, lon: 74.4036, en: 'Lahore', ar: 'لاهور', names: ['lahore', 'لاهور'] },
  ISB: { lat: 33.5491, lon: 72.8256, en: 'Islamabad', ar: 'إسلام آباد', names: ['islamabad', 'إسلام آباد'] },
  DEL: { lat: 28.5562, lon: 77.1000, en: 'Delhi', ar: 'دلهي', names: ['delhi', 'دلهي'] },
  BOM: { lat: 19.0896, lon: 72.8656, en: 'Mumbai', ar: 'مومباي', names: ['mumbai', 'bombay', 'مومباي'] },
  COK: { lat: 10.1520, lon: 76.4019, en: 'Kochi', ar: 'كوتشي', names: ['kochi', 'cochin', 'كوتشي'] },
  HYD: { lat: 17.2403, lon: 78.4294, en: 'Hyderabad', ar: 'حيدر آباد', names: ['hyderabad', 'حيدر آباد'] },
  DAC: { lat: 23.8433, lon: 90.3978, en: 'Dhaka', ar: 'دكا', names: ['dhaka', 'دكا'] },
  KTM: { lat: 27.6966, lon: 85.3591, en: 'Kathmandu', ar: 'كاتماندو', names: ['kathmandu', 'كاتماندو'] },
  CMB: { lat: 7.1808, lon: 79.8841, en: 'Colombo', ar: 'كولومبو', names: ['colombo', 'كولومبو'] },
  MNL: { lat: 14.5086, lon: 121.0198, en: 'Manila', ar: 'مانيلا', names: ['manila', 'مانيلا'] },
  KUL: { lat: 2.7456, lon: 101.7072, en: 'Kuala Lumpur', ar: 'كوالالمبور', names: ['kuala lumpur', 'كوالالمبور'] },
  CGK: { lat: -6.1256, lon: 106.6559, en: 'Jakarta', ar: 'جاكرتا', names: ['jakarta', 'جاكرتا'] },
  ADD: { lat: 8.9779, lon: 38.7993, en: 'Addis Ababa', ar: 'أديس أبابا', names: ['addis ababa', 'أديس أبابا'] },
  KRT: { lat: 15.5895, lon: 32.5532, en: 'Khartoum', ar: 'الخرطوم', names: ['khartoum', 'الخرطوم'] },
  TUN: { lat: 36.8510, lon: 10.2272, en: 'Tunis', ar: 'تونس', names: ['tunis'] },
  CMN: { lat: 33.3675, lon: -7.5899, en: 'Casablanca', ar: 'الدار البيضاء', names: ['casablanca', 'الدار البيضاء'] }
};

const APP_AIRPORTS = { dmm: 'DMM', ruh: 'RUH', jed: 'JED' };

/** "DXB", "Dubai", "DUBAI (DXB)", "دبي", "dmm" -> PLACES key, or null. */
function resolvePlace(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (APP_AIRPORTS[lower]) return APP_AIRPORTS[lower];
  const code = raw.toUpperCase().match(/\b([A-Z]{3})\b/g) || [];
  for (const c of code) if (PLACES[c]) return c;
  for (const [k, p] of Object.entries(PLACES)) {
    if (p.names.some((n) => lower.includes(n))) return k;
  }
  return null;
}

// "will the weather delay my flight", "is there a sandstorm", "الجو", "غبار"
// English on word boundaries, so "train" is not rain and "window" not wind.
const WEATHER_Q = /\b(weather|storms?|sandstorms?|dust|dusty|fog|foggy|rain|raining|rainy|snow|snowing|wind|windy|thunder\w*|forecast)\b|(طقس|الطقس|الجو|غبار|عاصفة|عاصفه|عجاج|ضباب|مطر|أمطار|امطار|رياح|ثلج|رعد)/;
// Delay questions that weather can inform (not "I am running late").
const DELAY_Q = /(delay|delayed|on time|will (my|the) flight be (late|delayed)|تأخير|تأخّر|تتأخر|الرحلة متأخرة|رحلتي متأخرة|بالموعد|في موعدها|بوقتها)/;

function isWeatherQuestion(message) { return WEATHER_Q.test(String(message || '').toLowerCase()); }
function isDelayQuestion(message) { return DELAY_Q.test(String(message || '').toLowerCase()); }

// ---------------------------------------------------------------- fetching --

const cache = new Map();

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': 'VibeFlight/1.0' } });
    if (!res.ok) return { ok: false, code: 'HTTP_' + res.status };
    return { ok: true, json: await res.json() };
  } catch (err) {
    return { ok: false, code: err && err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK' };
  } finally {
    clearTimeout(timer);
  }
}

async function hourly(placeKey) {
  const p = PLACES[placeKey];
  const hit = cache.get(placeKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const q = 'latitude=' + p.lat + '&longitude=' + p.lon + '&timezone=GMT&forecast_hours=30';
  const [fc, air] = await Promise.all([
    getJson(FORECAST_URL + '?' + q + '&hourly=weather_code,visibility,wind_gusts_10m,precipitation,temperature_2m'),
    getJson(AIR_URL + '?' + q + '&hourly=dust')
  ]);
  if (!fc.ok) return { ok: false, code: fc.code };
  const h = fc.json.hourly || {};
  const dust = air.ok && air.json.hourly ? air.json.hourly : {};
  const dustByTime = new Map();
  (dust.time || []).forEach((t, i) => dustByTime.set(t, dust.dust ? dust.dust[i] : null));
  const rows = (h.time || []).map((t, i) => ({
    at: Date.parse(t + 'Z'),
    code: h.weather_code ? h.weather_code[i] : null,
    visibility: h.visibility ? h.visibility[i] : null,
    gusts: h.wind_gusts_10m ? h.wind_gusts_10m[i] : null,
    precip: h.precipitation ? h.precipitation[i] : null,
    temp: h.temperature_2m ? h.temperature_2m[i] : null,
    dust: dustByTime.has(t) ? dustByTime.get(t) : null
  }));
  const data = { ok: true, rows, dustKnown: air.ok };
  cache.set(placeKey, { at: Date.now(), data });
  return data;
}

// ---------------------------------------------------------------- judging ---

// Rough thresholds for weather that commonly slows an airport. Level 2 means
// "likely to cause delays", level 1 "worth watching the board".
function judgeHour(r) {
  const found = [];
  const c = r.code;
  if (c >= 95 && c <= 99) found.push({ key: 'thunder', level: 2 });
  if (c === 45 || c === 48 || (r.visibility != null && r.visibility < 1000)) found.push({ key: 'fog', level: 2 });
  else if (r.visibility != null && r.visibility < 3000) found.push({ key: 'haze', level: 1 });
  if (r.dust != null && r.dust >= 1000) found.push({ key: 'sandstorm', level: 2 });
  else if (r.dust != null && r.dust >= 300) found.push({ key: 'dust', level: 1 });
  if (r.gusts != null && r.gusts >= 70) found.push({ key: 'wind', level: 2 });
  else if (r.gusts != null && r.gusts >= 50) found.push({ key: 'wind', level: 1 });
  if ([65, 82].includes(c) || (r.precip != null && r.precip >= 7)) found.push({ key: 'rain', level: 2 });
  else if ([63, 81].includes(c)) found.push({ key: 'rain', level: 1 });
  if ([56, 57, 66, 67, 71, 73, 75, 77, 85, 86].includes(c)) found.push({ key: 'snow', level: 2 });
  return found;
}

const WORDS = {
  thunder: { en: 'thunderstorms', ar: 'عواصف رعدية' },
  fog: { en: 'fog and low visibility', ar: 'ضباب ورؤية منخفضة' },
  haze: { en: 'hazy, reduced visibility', ar: 'رؤية منخفضة قليلًا' },
  sandstorm: { en: 'a sand or dust storm', ar: 'عاصفة غبارية' },
  dust: { en: 'dusty air', ar: 'غبار في الجو' },
  wind: { en: 'strong wind gusts', ar: 'رياح قوية' },
  rain: { en: 'heavy rain', ar: 'أمطار غزيرة' },
  snow: { en: 'snow or ice', ar: 'ثلوج أو جليد' }
};

function summarize(rows, fromMs, toMs) {
  const span = rows.filter((r) => r.at >= fromMs - 30 * 60000 && r.at <= toMs);
  if (!span.length) return null;
  let level = 0;
  const reasons = new Map();
  for (const r of span) {
    for (const f of judgeHour(r)) {
      level = Math.max(level, f.level);
      reasons.set(f.key, Math.max(reasons.get(f.key) || 0, f.level));
    }
  }
  const temps = span.map((r) => r.temp).filter((x) => x != null);
  return {
    level,
    reasons: Array.from(reasons.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k),
    tempMin: temps.length ? Math.round(Math.min(...temps)) : null,
    tempMax: temps.length ? Math.round(Math.max(...temps)) : null
  };
}

/**
 * @param {{ airport: string, destination?: string, departure?: string|number }} opts
 *   airport      app airport code (dmm/ruh/jed)
 *   destination  anything naming the destination (code, city, Arabic name)
 *   departure    scheduled/estimated departure (ISO) — defaults to now
 */
async function report(opts) {
  // An airport we cannot place gets no forecast, never Dammam's.
  const depKey = opts.airport ? resolvePlace(opts.airport) : 'DMM';
  if (!depKey) return { ok: false, code: 'UNKNOWN_AIRPORT', level: 0, source: 'Open-Meteo' };
  const destKey = opts.destination ? resolvePlace(opts.destination) : null;
  let depAt = opts.departure ? Date.parse(opts.departure) : NaN;
  const now = Date.now();
  // A departure in the past or more than a day away is not today's flight.
  if (Number.isNaN(depAt) || depAt < now - 3600000 || depAt > now + 26 * 3600000) depAt = null;
  const center = depAt || now;

  const out = {
    ok: false,
    departure: { place: depKey, en: PLACES[depKey].en, ar: PLACES[depKey].ar },
    destination: destKey ? { place: destKey, en: PLACES[destKey].en, ar: PLACES[destKey].ar } : null,
    destinationUnknown: !!opts.destination && !destKey,
    atDepartureTime: !!depAt,
    level: 0,
    source: 'Open-Meteo'
  };

  const depData = await hourly(depKey);
  if (!depData.ok) return Object.assign(out, { code: depData.code });
  out.ok = true;
  out.departure.summary = summarize(depData.rows, center - 3600000, center + 3 * 3600000);
  out.departure.dustKnown = depData.dustKnown;

  if (destKey && destKey !== depKey) {
    const destData = await hourly(destKey);
    if (destData.ok) {
      out.destination.summary = summarize(destData.rows, center, center + 8 * 3600000);
      out.destination.dustKnown = destData.dustKnown;
    }
  }
  out.level = Math.max(
    (out.departure.summary && out.departure.summary.level) || 0,
    (out.destination && out.destination.summary && out.destination.summary.level) || 0
  );
  return out;
}

// ----------------------------------------------------------------- wording --

function reasonsText(sum, lang) {
  const list = sum.reasons.map((k) => WORDS[k][lang === 'ar' ? 'ar' : 'en']);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  const and = lang === 'ar' ? ' و' : ' and ';
  return list.slice(0, -1).join(lang === 'ar' ? '، ' : ', ') + and + list[list.length - 1];
}

function placeLine(side, lang, when) {
  const s = side.summary;
  const name = lang === 'ar' ? side.ar : side.en;
  if (!s) return null;
  const temp = s.tempMax != null ? (s.tempMin !== s.tempMax ? s.tempMin + '–' + s.tempMax : s.tempMax) + '°C' : '';
  if (lang === 'ar') {
    if (s.level === 0) return `**${name}** ${when}: لا أرى طقسًا يعطّل الطيران عادةً${temp ? ' (' + temp + ')' : ''}.`;
    return `**${name}** ${when}: متوقع ${reasonsText(s, 'ar')}${temp ? ' (' + temp + ')' : ''}. ${s.level === 2 ? 'هذا النوع من الطقس يؤخّر الرحلات أحيانًا.' : 'قد يبطّئ الحركة قليلًا.'}`;
  }
  if (s.level === 0) return `**${name}** ${when}: nothing that usually slows flights${temp ? ' (' + temp + ')' : ''}.`;
  return `**${name}** ${when}: ${reasonsText(s, 'en')} expected${temp ? ' (' + temp + ')' : ''}. ${s.level === 2 ? 'Weather like this sometimes delays flights.' : 'It can slow things down a little.'}`;
}

/** Plain-language reply for the rule engine. */
function toText(rep, lang) {
  const ar = lang === 'ar';
  if (rep && rep.code === 'UNKNOWN_AIRPORT') {
    return ar
      ? 'ليست عندي توقعات طقس لهذا المطار. شاشة المغادرة وموظفو شركة الطيران هم المرجع لأي تأخير.'
      : 'I do not have a weather forecast for this airport. The departure screens and your airline\'s staff are the place to check for any delay.';
  }
  if (!rep || !rep.ok) {
    return ar
      ? 'لم أستطع الوصول إلى خدمة الطقس الآن. شاشة المغادرة هي المرجع لأي تأخير.'
      : 'I could not reach the weather service just now. The departure board is the place to check for any delay.';
  }
  const lines = [];
  lines.push(ar ? 'نظرت في توقعات الطقس لرحلتك:' : 'I checked the weather forecast for your trip:');
  const depWhen = rep.atDepartureTime ? (ar ? 'وقت إقلاعك' : 'around your departure time') : (ar ? 'في الساعات القادمة' : 'over the next few hours');
  const d = placeLine(rep.departure, lang, depWhen);
  if (d) lines.push(d);
  if (rep.destination && rep.destination.summary) {
    lines.push(placeLine(rep.destination, lang, ar ? 'عند الوصول' : 'when you arrive'));
  } else if (rep.destinationUnknown || !rep.destination) {
    lines.push(ar
      ? 'لم أتحقق من طقس وجهتك لأني لا أعرفها بعد — أخبرني بالمدينة إن أردت.'
      : 'I did not check your destination because I do not know it yet — tell me the city if you want me to.');
  }
  lines.push(rep.level === 2
    ? (ar
      ? 'هذا تنبيه وليس تأكيدًا: شركة الطيران وحدها تقرر التأخير. راقب شاشة المغادرة، ووصل للبوابة مبكرًا ولا تبتعد عنها.'
      : 'This is a heads-up, not a decision: only the airline decides a delay. Keep an eye on the departure board, and get to your gate early rather than late.')
    : (ar
      ? 'الطقس ليس السبب الوحيد للتأخير، فتأكّد دائمًا من شاشة المغادرة.'
      : 'Weather is not the only reason flights are delayed, so always check the departure board.'));
  return lines.join('\n\n');
}

/** Two or three short lines, added to an answer about a delay. */
function toShortText(rep, lang) {
  if (!rep || !rep.ok) return null;
  const ar = lang === 'ar';
  const lines = [];
  const depWhen = rep.atDepartureTime ? (ar ? 'وقت إقلاعك' : 'around your departure time') : (ar ? 'في الساعات القادمة' : 'over the next few hours');
  const d = placeLine(rep.departure, lang, depWhen);
  if (d) lines.push(d);
  if (rep.destination && rep.destination.summary) lines.push(placeLine(rep.destination, lang, ar ? 'عند الوصول' : 'when you arrive'));
  if (!lines.length) return null;
  return (ar ? '**الطقس:** ' : '**Weather:** ') + lines.join('\n');
}

/** One line of context for the model. */
function toModelLine(rep) {
  if (!rep || !rep.ok) return 'The weather service could not be reached this turn. Do not describe the weather.';
  const parts = [];
  const side = (s, label) => {
    if (!s || !s.summary) return;
    parts.push(label + ' ' + s.en + ': ' + (s.summary.level ? s.summary.reasons.join(', ') + ' (level ' + s.summary.level + '/2)' : 'no disruptive weather') +
      (s.summary.tempMax != null ? ', ' + s.summary.tempMin + '–' + s.summary.tempMax + '°C' : ''));
  };
  side(rep.departure, 'Departure');
  side(rep.destination, 'Destination');
  return 'Weather forecast checked just now (Open-Meteo): ' + parts.join('; ') +
    '. A weather card is shown under your reply. This is a heads-up only — never say the flight WILL be delayed; only the departure board and the airline decide that.';
}

/** Small payload for the chat's weather card. */
function toCard(rep, lang) {
  if (!rep || !rep.ok) return null;
  const L = lang === 'ar' ? 'ar' : 'en';
  const side = (s, role) => s && s.summary ? {
    role, name: s[L], level: s.summary.level,
    reasons: s.summary.reasons.map((k) => WORDS[k][L]),
    tempMin: s.summary.tempMin, tempMax: s.summary.tempMax
  } : null;
  return {
    level: rep.level,
    rows: [side(rep.departure, 'departure'), side(rep.destination, 'destination')].filter(Boolean),
    atDepartureTime: rep.atDepartureTime,
    source: 'Open-Meteo'
  };
}

module.exports = {
  report, toText, toShortText, toModelLine, toCard, resolvePlace, isWeatherQuestion, isDelayQuestion,
  _internal: { judgeHour, summarize, cache, PLACES }
};
