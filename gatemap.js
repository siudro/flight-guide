'use strict';

/**
 * Gate map — decides when a chat reply carries a map, and what is on it.
 *
 * The rule the rest of the app follows applies here too: never invent a
 * location. A pin is drawn only where we hold a real coordinate:
 *
 *   Riyadh (RUH)  35 boarding gates from the airport's own indoor map
 *                 (map/mapdata.json). The traveller's gate gets its own pin.
 *   Dammam (DMM)  No gate coordinates. The map shows the airport and the gate
 *                 number (live from kfia.sa when we have the flight), plus a
 *                 link to the airport's own map. Never a guessed gate pin.
 *   Jeddah (JED)  Same as Dammam, without a live feed.
 *
 * The browser receives a small payload (centre, zoom, pins, links) and draws
 * it with Leaflet. No map logic lives in the browser.
 */

const fs = require('fs');
const path = require('path');

const MAP_FILE = path.join(__dirname, '..', 'map', 'mapdata.json');

// Airport reference points (published ICAO aerodrome coordinates). They mark
// the airport, not a gate, and the card says so.
const AIRPORTS = {
  dmm: {
    center: [26.4712, 49.7979], zoom: 14,
    name: { en: 'King Fahd International Airport (Dammam)', ar: 'مطار الملك فهد الدولي (الدمام)' },
    short: { en: 'Dammam airport', ar: 'مطار الدمام' },
    officialMap: 'https://kfia.sa/ar/Guide/Passenger/airport-map',
    departures: 'https://kfia.sa/ar/Flights#departures',
    hasGatePins: false
  },
  ruh: {
    center: [24.9585, 46.7040], zoom: 16,
    name: { en: 'King Khalid International Airport (Riyadh)', ar: 'مطار الملك خالد الدولي (الرياض)' },
    short: { en: 'Riyadh airport', ar: 'مطار الرياض' },
    officialMap: 'https://maps.kkia.sa/maps/map.html',
    departures: 'https://www.kkia.sa/en/flights/departures-and-arrivals?tab=0#departures',
    hasGatePins: true
  },
  jed: {
    center: [21.6794, 39.1567], zoom: 13,
    name: { en: 'King Abdulaziz International Airport (Jeddah)', ar: 'مطار الملك عبدالعزيز الدولي (جدة)' },
    short: { en: 'Jeddah airport', ar: 'مطار جدة' },
    officialMap: null,
    departures: 'https://www.kaia.sa/ar-SA/Flights?tab=0',
    hasGatePins: false
  }
};

let points = null;
function loadPoints() {
  if (points) return points;
  try {
    points = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  } catch (_) {
    points = [];
  }
  return points;
}

/** "Level 2" -> "الطابق 2" for Arabic replies; the map data is English only. */
function floorLabel(floor, lang) {
  const f = String(floor || '');
  if (lang !== 'ar') return f;
  const m = f.match(/^Level\s*(.+)$/i);
  if (!m) return f;
  return m[1] === 'G' ? 'الطابق الأرضي (G)' : 'الطابق ' + m[1];
}

function normGate(g) {
  return String(g || '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toUpperCase()
    .replace(/^(GATE|بوابة|بوابه)\s*/i, '')
    .replace(/[\s\-#]/g, '');
}

/** Riyadh gate lookup: "105a", "Gate 105A", "١٠٥A" -> the map point, or null. */
function findRiyadhGate(gate) {
  const want = normGate(gate);
  if (!want) return null;
  return loadPoints().find((p) => p.cat === 'gate' && normGate(p.name) === want) || null;
}

// "where is my gate", "how do I get to gate 404", "show me my gate", "which gate"
const GATE_Q_EN = /(where('?s| is| are)?\s+(my|the|our)?\s*gate|gate\b.{0,20}\bwhere\b|(find|reach|get to|go to|way to|walk to|directions to|route to|show( me)?)\s+(my|the|our)?\s*gate|which gate|what('?s| is) my gate|my gate number|gate on (the|a) map|map\b.{0,20}\bgate)/;
// "وين البوابة" "أين بوابتي" "كيف أوصل للبوابة" "رقم بوابتي" "البوابة وين"
const GATE_Q_AR = /((وين|أين|اين|فين|كيف أوصل|كيف اوصل|كيف أروح|كيف اروح|طريق|دلني|دلّني|وريني|ورني)\s*.{0,14}(بوابت|البواب|بوابة|بوابه|جيت)|(بوابتي|البوابة|البوابه|الجيت)\s*.{0,10}(وين|أين|اين|فين)|(أي|اي|ايش|وش|ما)\s*(رقم)?\s*(بوابتي|البوابة)|رقم بوابتي)/;

/** True when the traveller is asking where their gate is (not what a gate is). */
function isGateQuestion(message) {
  const m = String(message || '').toLowerCase();
  if (/(what('?s| is)? (a|the meaning of)|meaning of|وش يعني|ايش يعني|معنى)\s*.{0,6}(gate|بواب)/.test(m)) return false;
  return GATE_Q_EN.test(m) || GATE_Q_AR.test(m);
}

/** "show me the map", "خريطة" — a map request without naming the gate. */
function isMapRequest(message) {
  return /\bmaps?\b|خريطة|خريطه|الخريطة/.test(String(message || '').toLowerCase());
}

/**
 * Build the card payload for one airport and (optional) gate.
 * Returns null for an airport we know nothing about.
 */
function build(airportCode, gate, lang) {
  const code = String(airportCode || '').toLowerCase();
  const a = AIRPORTS[code];
  if (!a) return null;
  const L = lang === 'ar' ? 'ar' : 'en';
  const g = gate ? normGate(gate) : null;

  const card = {
    airport: code,
    airportName: a.name[L],
    gate: g,
    center: a.center,
    zoom: a.zoom,
    pins: [],
    exact: false,
    floor: null,
    officialMap: a.officialMap,
    departures: a.departures,
    note: null
  };

  if (a.hasGatePins) {
    const all = loadPoints().filter((p) => p.cat === 'gate');
    const hit = g ? findRiyadhGate(g) : null;
    for (const p of all) {
      const isHit = hit && p === hit;
      card.pins.push({
        lat: p.lat, lon: p.lon, kind: isHit ? 'target' : 'gate',
        label: p.name, labelAr: p.ar || null, floor: p.floor
      });
    }
    if (hit) {
      card.exact = true;
      card.floor = floorLabel(hit.floor, L);
      card.center = [hit.lat, hit.lon];
      card.zoom = 18;
      card.note = L === 'ar'
        ? `بوابتك ${g} على الخريطة، ${floorLabel(hit.floor, 'ar')}. الدبابيس الرمادية هي بقية البوابات.`
        : `Gate ${g} is pinned on the map, ${hit.floor}. Grey pins are the other gates.`;
    } else if (g) {
      card.note = L === 'ar'
        ? `البوابة ${g} ليست في بيانات خريطتنا. هذه كل البوابات التي نعرف مواقعها — اتبع اللوحات أو اسأل موظفًا.`
        : `Gate ${g} is not in our map data. These are all the gates we have positions for — follow the overhead signs or ask staff.`;
    } else {
      card.note = L === 'ar'
        ? 'هذه بوابات الصعود في مطار الرياض. أخبرني رقم بوابتك وسأحدّدها لك.'
        : 'These are the boarding gates at Riyadh. Tell me your gate number and I will pin it.';
    }
  } else {
    // Labelled with the airport, never the gate: a gate label on this pin
    // would read as the gate's position.
    card.pins.push({ lat: a.center[0], lon: a.center[1], kind: 'airport', label: a.short.en, labelAr: a.short.ar });
    if (g) {
      card.note = L === 'ar'
        ? `بوابتك ${g}. مواقع البوابات داخل هذا المطار ليست على خريطتنا بعد، فلا أحدّد مكانًا لم أتحقق منه. بعد الجوازات اتبع لوحات «البوابات»${a.officialMap ? '، أو افتح خريطة المطار الرسمية' : '، أو اسأل أي موظف'}.`
        : `Your gate is ${g}. Gate positions inside this airport are not on our map yet, so I will not pin a place I have not verified. After passport control, follow the overhead "Gates" signs${a.officialMap ? ', or open the airport\'s own map' : ', or ask any staff member'}.`;
    } else {
      card.note = L === 'ar'
        ? 'رقم بوابتك على بطاقة الصعود وعلى شاشات المغادرة. أخبرني به أو صوّر تذكرتك.'
        : 'Your gate number is on your boarding pass and on the departure screens. Tell me, or send a photo of your ticket.';
    }
  }
  return card;
}

/**
 * Should this turn carry a map? Called by the server after the engine (and
 * after any live gate lookup), with the final session.
 */
function decide({ message, meta, session, lang, settings }) {
  if (settings && settings.mapVisible === false) return null;
  // At an airport we have no data for, a Dammam map would be a wrong map.
  if (session && session.otherAirport) return null;
  const key = meta && meta.stageKey;
  const wants =
    key === 'findgate' ||
    key === 'directions' ||
    (key === 'gatechange' && !(meta && meta.needsGate) && !!(session && session.gate)) ||
    isGateQuestion(message) ||
    isMapRequest(message);
  if (!wants) return null;
  const airport = (session && session.airport) || 'dmm';
  return build(airport, session && session.gate, lang);
}

/** One line for the model, so it refers to the map instead of denying it. */
function describeForModel(card) {
  if (!card) return null;
  if (card.exact) {
    return 'A map is shown under your reply with the traveller\'s gate ' + card.gate + ' pinned (' + card.floor + '). Refer to "the map below". Do not describe a walking route you were not given.';
  }
  return 'A map of the airport is shown under your reply' + (card.gate ? ' with gate ' + card.gate + ' written on it' : '') +
    '. It does NOT pin the gate\'s exact position — never claim it does. Refer to "the map below" and the airport\'s official map link.';
}

module.exports = { isGateQuestion, isMapRequest, findRiyadhGate, floorLabel, build, decide, describeForModel, AIRPORTS, _normGate: normGate };
