'use strict';

/**
 * Flight Guide reply engine.
 *
 * THE AI-SWAP BOUNDARY. Everything that decides what the traveller is told
 * lives in this file. The UI and the HTTP layer never build a sentence
 * themselves — they call `generateReply(state)` and render `reply.messages`.
 *
 * To move to an LLM later, replace the body of `generateReply` with a model
 * call that takes the same `state` and returns the same shape. Nothing else
 * in the app needs to change.
 *
 * ---------------------------------------------------------------------------
 * INPUT — `state` (already merged with persisted settings by the server):
 * {
 *   message:     string          raw traveller message
 *   lang:        'en' | 'ar'     UI language
 *   profile:     'nervous' | 'adult' | 'hurried'
 *   session:     {               conversational memory, owned by the caller
 *     stage:         number,     index into the active stage list (0-based)
 *     airport:       'dmm'|'ruh'|'jed'|null,
 *     terminal:      string|null,
 *     flight:        string|null,
 *     airline:       string|null,
 *     gate:          string|null,
 *     bags:          'checked'|'carryon'|null,
 *     minutes:       number|null,   minutes until boarding
 *     concern:       string|null,
 *     askedCount:    number,     how many turns already spent
 *     gateChanged:   boolean,
 *     awaitingGate:  boolean   the traveller said the gate changed but has
 *                              not yet told us the new number
 *   }
 *   settings: { stages, profilesEnabled, escalateMinutes, mapVisible, airports }
 * }
 *
 * OUTPUT:
 * {
 *   messages: [{ role: 'assistant', text: string }],   // 1..3 bubbles
 *   session:  { ... },                                 // updated state
 *   meta:     { stage, stageKey, escalated, airportWiki, intent }
 * }
 *
 * Deterministic: no network, no randomness, no clock dependence — so the same
 * input always produces the same reply, which is what the prototype promises.
 */

const { AIRPORTS, TEXT } = require('../config/defaults');
const gatemap = require('./gatemap');
const weather = require('./weather');

// ---------------------------------------------------------------------------
// Small parsing helpers
// ---------------------------------------------------------------------------

const AR_LETTERS = /[\u0600-\u06FF]/;
const AR_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

function normalize(s) {
  let out = String(s || '').toLowerCase().replace(/[\u0660-\u0669]/g, (d) => AR_DIGITS[d] || d);
  return out;
}

function detectLanguage(message, fallback) {
  const text = String(message || '');
  // The language the traveller picked in the UI is the default. Only override
  // it when the message is clearly in the other language — writing "hello"
  // while Arabic is selected must NOT switch the whole app to English.
  if (AR_LETTERS.test(text)) return 'ar';
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const total = text.replace(/\s/g, '').length || 1;
  // A few Latin letters inside Arabic text (a gate "105A") stays Arabic.
  if (latin > 0 && latin / total > 0.85) {
    // Mostly Latin: honour the UI language unless it is a real English sentence
    // while the UI is Arabic, in which case the person chose to write English.
    if (fallback === 'ar') {
      const words = text.trim().split(/\s+/).filter(Boolean);
      const commonEn = /\b(what|where|how|the|is|are|i|my|please|help|why|do|does|can|you|me|a|an|to|of|it|this|that)\b/i;
      return words.length >= 3 && commonEn.test(text) ? 'en' : 'ar';
    }
    return 'en';
  }
  return fallback || 'en';
}

function detectAirport(message) {
  const m = normalize(message);
  if (/(dammam|dmm|damam|الدمام|دمام|kfia|king fahd)/.test(m)) return 'dmm';
  if (/(riyadh|ruh|رياض|الرياض|kkia|king khalid)/.test(m)) return 'ruh';
  if (/(jeddah|jed|جدة|جده|kaia|king abdulaziz)/.test(m)) return 'jed';
  return null;
}

// Airports the app has no specific knowledge of. Named so the traveller is
// told the truth ("I only know Dammam, Riyadh and Jeddah") instead of being
// handed Dammam's map, links and live board while standing in Abha.
const OTHER_AIRPORTS = [
  ['AHB', 'Abha', 'أبها', 'abha|ابها|أبها'], ['MED', 'Madinah', 'المدينة المنورة', 'madinah|medina|madina|المدينة'],
  ['TIF', 'Taif', 'الطائف', 'taif|الطائف'], ['GIZ', 'Jazan', 'جازان', 'jazan|jizan|gizan|جازان|جيزان'],
  ['TUU', 'Tabuk', 'تبوك', 'tabuk|تبوك'], ['ELQ', 'Qassim', 'القصيم', 'qassim|gassim|buraydah|القصيم|بريدة'],
  ['HOF', 'Al-Ahsa', 'الأحساء', 'ahsa|hofuf|الأحساء|الاحساء'], ['HAS', 'Hail', 'حائل', 'hail|ha\'il|حائل'],
  ['EAM', 'Najran', 'نجران', 'najran|نجران'], ['ULH', 'AlUla', 'العلا', 'alula|al ula|العلا'],
  ['YNB', 'Yanbu', 'ينبع', 'yanbu|ينبع'], ['AJF', 'Al-Jouf', 'الجوف', 'jouf|jawf|الجوف'],
  ['RAE', 'Arar', 'عرعر', 'arar|عرعر'], ['BHH', 'Bisha', 'بيشة', 'bisha|بيشة'],
  ['ABT', 'Al-Baha', 'الباحة', 'baha|الباحة'], ['SHW', 'Sharurah', 'شرورة', 'sharurah|شرورة'],
  ['URY', 'Qurayyat', 'القريات', 'qurayyat|القريات'], ['RSI', 'Red Sea International', 'مطار البحر الأحمر', 'red sea international|مطار البحر الأحمر'],
  ['DXB', 'Dubai', 'دبي', 'dubai|دبي'], ['DOH', 'Doha', 'الدوحة', 'doha|الدوحة'], ['BAH', 'Bahrain', 'البحرين', 'bahrain|البحرين'],
  ['KWI', 'Kuwait', 'الكويت', 'kuwait|الكويت'], ['CAI', 'Cairo', 'القاهرة', 'cairo|القاهرة'], ['AMM', 'Amman', 'عمّان', 'amman|عمّان']
];

/**
 * "I am at Abha airport", "انا في مطار أبها" -> { code, en, ar }.
 * Only where the traveller IS (at/in/from), never where they are going
 * ("flying to Dubai" is a destination, not a location).
 */
function detectOtherAirport(message) {
  const m = normalize(message);
  // A supported airport named only as the destination ("going home to
  // Riyadh") does not mean the traveller is standing in it.
  const DEST = /(?:flying|going|travel+ing|heading|home|returning|flight|fly)\s+(?:back\s+|home\s+)?to\s+(?:the\s+)?\S+|(?:مسافر|رايح|راجع|متجه|رحلتي|طالع)\s*(?:إلى|الى|ل)\s*\S+/g;
  if (detectAirport(m.replace(DEST, ' '))) return null;
  for (const [code, en, ar, names] of OTHER_AIRPORTS) {
    const n = '(?:' + names + ')';
    const here = new RegExp('(?:\\bat|\\bin|\\bfrom)\\s+(?:the\\s+)?(?:airport\\s+(?:of|in)\\s+)?' + n +
      '|(?:^|\\s)(?:في|من|بمطار|مطار)\\s*' + n);
    const goingTo = new RegExp('(?:\\bto|إلى|الى)\\s+(?:the\\s+)?(?:مطار\\s*)?' + n);
    if (here.test(m) && !goingTo.test(m)) return { code, en, ar };
  }
  return null;
}

function otherAirportNote(o, lang) {
  return lang === 'ar'
    ? `ليست عندي معلومات خاصة بمطار ${o.ar} — أعرف فقط الدمام والرياض وجدة. سأرشدك بالخطوات العامة التي تنفع في أي مطار، أما البوابة وأي تغيير في رحلتك فشاشات المغادرة وموظفو المطار هناك هم مصدرك.`
    : `I do not have information specific to ${o.en} airport — I only know Dammam, Riyadh and Jeddah. I will guide you with the general steps that work at any airport; for your gate and any change to your flight, the departure screens and the staff there are your source.`;
}

/** The app's default: Dammam, unless the traveller said they are elsewhere. */
function assumeDammam(session) {
  if (!session.airport && !session.otherAirport) session.airport = 'dmm';
}

function detectTerminal(message) {
  const m = normalize(message);
  // No leading \b: JavaScript's word boundary does not treat Arabic letters as
  // word characters, so "الصالة 3" would never match with one.
  const t = m.match(/(?:terminal|term|صالة|صاله|مبنى)\s*#?\s*([0-9]{1,2}[a-z]?)(?![0-9])/);
  if (t) return t[1].toUpperCase();
  const t2 = m.match(/\bt\s?([1-5])\b/);
  if (t2) return t2[1];
  const t3 = m.match(/^\s*([1-5])\s*(?:$|،|,)/);
  if (t3) return t3[1];
  if (/(terminal|صالة)\s*[a-z]\b/.test(m)) {
    const l = m.match(/(terminal|صالة)\s*([a-z])\b/);
    if (l && /^[saimdg]$/.test(l[2])) return l[2].toUpperCase();
  }
  return null;
}

function detectFlight(message) {
  const m = String(message || '').toUpperCase();
  // Airline designator: two letters, or one letter + digit, followed by 1-4 digits.
  const f = m.match(/\b([A-Z]{2}|[A-Z][0-9]|[0-9][A-Z])\s?-?\s?([0-9]{1,4})\b/);
  if (!f) return null;
  // "gate changed TO 404", "walk TO 12" are prepositions, not carriers.
  const STOP = new Set(['TO', 'AT', 'IN', 'ON', 'OF', 'BY', 'OR', 'IS', 'IT', 'MY', 'NO', 'SO', 'UP', 'GO']);
  if (STOP.has(f[1])) return null;
  if (/^(LEVEL|GATE|TERM|STEP|MIN|PM|AM)$/.test(f[1])) return null;
  return f[1] + f[2];
}

// Arabic writes Riyadh's "109B" as "١٠٩ب" or "109 ب": a lone أ/ا/ب straight
// after the number is the gate's letter, not the start of the next word.
function withArabicSuffix(id, rest) {
  const up = id.toUpperCase();
  if (/[A-Z]/.test(up)) return up;
  const s = String(rest || '').match(/^\s?([أاب])(?![؀-ۿ])/);
  return s ? up + (s[1] === 'ب' ? 'B' : 'A') : up;
}

function detectGate(message) {
  const m = normalize(message);
  // "gate 404", "gate changed to 404", "new gate is 404", "gate:404",
  // "my gate, it is 401", and lettered gates as some boards print them ("B7").
  const GATE_ID = '([a-z][0-9]{1,3}|[0-9]{2,3}[a-z]?)(?![0-9a-z])';
  const g = m.match(new RegExp('(?:gate|بوابتي|بوابة|بوابه|جيت)\\s*(?:[,:\\-]\\s*)?' +
    '(?:(?:it|that)\\s*(?:\'s|’s|is)\\s*|number\\s*|no\\.?\\s*|رقم\\s*)?' +
    '(?:changed|change|is|now|to|became)?\\s*(?:to|is|:)?\\s*#?\\s*' + GATE_ID));
  if (g) return withArabicSuffix(g[1], m.slice(g.index + g[0].length));
  // "my gate changed to 404" — the number follows the verb, not the noun.
  const g3 = m.match(new RegExp('(?:changed|change|moved|new)\\s*(?:to|is)?\\s*' + GATE_ID));
  if (g3) return withArabicSuffix(g3[1], m.slice(g3.index + g3[0].length));
  // A bare three-digit number is a gate, never minutes — minutes are asked in
  // prose ("120 minutes") and a lone "404" is not a plausible wait.
  // Only consult this fallback when the message is ONLY that number, or when
  // the message is clearly about a gate; otherwise "120" in "I have 120" would
  // be read as a gate.
  const g2 = m.match(/^\s*([0-9]{3}[a-z]?)\s*$/);
  if (g2) return g2[1].toUpperCase();
  return null;
}

/** Minutes until boarding, from "45", "45 minutes", "an hour", "٢٠ دقيقة"... */
function detectMinutes(message, bareNumberIsMinutes) {
  if (bareNumberIsMinutes === undefined) bareNumberIsMinutes = true;
  const m = normalize(message);
  const h = m.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h\b|ساعة|ساعه|ساعات)/);
  if (h) return Math.round(parseFloat(h[1]) * 60);
  const hr = m.match(/(half an hour|نصف ساعة|نصف ساعه)/);
  if (hr) return 30;
  const anHour = m.match(/(an hour|one hour|ساعة واحدة|ساعه واحده)/);
  if (anHour) return 60;
  const min = m.match(/(\d+)\s*(?:minutes?|mins?|m\b|دقيقة|دقيقه|دقائق)/);
  if (min) return parseInt(min[1], 10);
  // A bare number is minutes only when nothing else claims it. The caller
  // passes a hint so a lone "404" answering "what is your new gate?" is not
  // also read as a 404-minute wait.
  const bare = m.trim().match(/^(\d{1,4})$/);
  if (bare && bareNumberIsMinutes) return parseInt(bare[1], 10);
  return null;
}

function detectBags(message) {
  const m = normalize(message);
  // Carry-on wins outright: "carry-on only, no checked bag" must not read as
  // "has a checked bag" just because the word "bag" appears.
  if (/(carry[\s-]?on|hand baggage|hand luggage|no bag|nothing to check|بدون حقائب|حقيبة يد|حقيبه يد|لا يوجد|مفيش|فقط شنطة ظهر|شنطة ظهر)/.test(m)) return 'carryon';
  if (/(checked|check[\s-]?in bag|checked bag|suitcase|bag to check|bags? to check|luggage|حقيبة مسجلة|حقيبه مسجله|حقيبة|حقائب|شنطة كبيرة|شنطه كبيرة)/.test(m)) return 'checked';
  // "one bag", "a bag", "my bag" with no qualifier reads as a checked bag —
  // a traveller with only hand luggage almost always says "hand" or "carry-on".
  if (/\b(one|two|three|a|an|my|the|\d)\s+(?:big\s+|small\s+)?(bag|bags|suitcase|suitcases)\b/.test(m)) return 'checked';
  if (/(شنطة|شنطه|حقيبة|حقيبه)/.test(m)) return 'checked';
  return null;
}

const CONCERNS = {
  lost: { en: 'getting lost or not finding the gate', ar: 'الضياع أو عدم إيجاد البوابة' },
  queue: { en: 'long queues and missing the flight', ar: 'الطوابير الطويلة وضياع الرحلة' },
  security: { en: 'security screening', ar: 'التفتيش الأمني' },
  customs: { en: 'customs and declarations', ar: 'الجمارك والتصريح' },
  alone: { en: 'being alone with nobody to ask', ar: 'البقاء وحدك بلا من تسأله' },
  language: { en: 'not being able to read the signs', ar: 'عدم فهم اللوحات' }
};

function detectConcern(message) {
  const m = normalize(message);
  if (/(ضياع|ضايع|أضيع|اضيع|lost|find my gate|find the gate|لا أجد|لا اجد)/.test(m)) return 'lost';
  if (/(طابور|زحمة|زحمه|queue|line|miss the flight|miss my flight|اللحاق|تلحق)/.test(m)) return 'queue';
  if (/(امين|أمن|امن|security|تفتيش|فحص)/.test(m)) return 'security';
  if (/(جمارك|customs|تصريح|declare)/.test(m)) return 'customs';
  if (/(وحيد|وحدي|لوحدي|لوحدى|alone|nobody|no one|myself)/.test(m)) return 'alone';
  if (/(انجليزي|لغة|لغه|لغة|language|english|signs|لوحات)/.test(m)) return 'language';
  return null;
}

// The airport's own pages. Handed over verbatim when someone asks the way:
// a link they can tap beats any description we could write.
const DIRECTIONS_LINKS = {
  en: {
    intro: 'Here is the airport\'s own map, straight from King Fahd International. Open it on your phone:',
    map: 'Map: https://kfia.sa/ar/Guide/Passenger/airport-map',
    departures: 'Live departures (gates and delays): https://kfia.sa/ar/Flights#departures',
    checkIntro: 'If you think something has changed with your flight, this is the airport\'s own departure board — it is the most current answer there is:',
    checkFlight: 'Your flight on that board: ',
    checkPlan: 'Look for your flight number. If it says delayed, final call or cancelled, tell me what it says and I will tell you what to do next.'
  },
  ar: {
    intro: 'هذه خريطة المطار الرسمية مباشرة من مطار الملك فهد الدولي. افتحها على جهازك:',
    map: 'الخريطة: https://kfia.sa/ar/Guide/Passenger/airport-map',
    departures: 'المغادرة المباشرة (البوابات والتأخير): https://kfia.sa/ar/Flights#departures',
    checkIntro: 'إذا كنت تعتقد أن شيئًا تغيّر في رحلتك، فهذه شاشة مغادرة المطار الرسمية — وهي أحدث جواب متاح:',
    checkFlight: 'رحلتك على هذه الشاشة: ',
    checkPlan: 'ابحث عن رقم رحلتك. إن كانت مؤجّلة أو النداء الأخير أو ملغاة، أخبرني بما تراه وسأخبرك بما تفعله بعد ذلك.'
  }
};

function detectIntent(message) {
  const m = normalize(message);
  if (/(gate change|changed gate|new gate|تغيرت البوابة|تغيّرت البوابة|بوابة جديدة|بوابه جديده)/.test(m)) return 'gatechange';
  // Something may have happened to the flight itself: a delay, a cancellation,
  // a missed flight, or "I think something changed". These deserve the live
  // departure board, not a generic walkthrough.
  if (/(delay|delayed|late|cancel|cancelled|canceled|missed|miss my flight|something happened|something changed|on time|final call|gate closed|\u0645\u062a\u0623\u062e\u0631|\u0645\u062a\u0627\u062e\u0631|\u0645\u0644\u063a\u064a|\u0623\u0644\u063a\u064a\u062a|\u0627\u0644\u063a\u064a\u062a|\u0641\u0627\u062a\u062a\u0646\u064a|\u0641\u0627\u062a\u062a|\u0635\u0627\u0631 \u0634\u064a|\u0634\u064a \u0635\u0627\u0631|\u062a\u063a\u064a\u0631 \u0634\u064a|\u0628\u0627\u0644\u0645\u0648\u0639\u062f|\u0627\u0644\u0646\u062f\u0627\u0621 \u0627\u0644\u0623\u062e\u064a\u0631)/.test(m)) return 'flightcheck';
  // Directions / "what does the airport look like". This must be tested before
  // the broad question rule, or "where do I go" is swallowed by 'explain' and
  // the traveller gets prose instead of the airport's own map link.
  if (/(direction|directions|how do i get|how do i reach|where do i go|where is the|airport look|look like|show me the airport|map|navigate|اتجاه|اتجاهات|الطريق|وين أروح|وين اروح|أين أذهب|اين اذهب|كيف أوصل|كيف اوصل|خريطة|خريطه|شكل المطار|المطار مثل)/.test(m)) return 'directions';
  // --- progression wins over the broad question rule ----------------------
  // "What do I do now?" contains "what", so it would otherwise be classified
  // as an explanation request and the traveller would never move on.
  if (/\b(what now|what next|then what|and then|what do i do|what should i do|what's next|whats next|go on|continue|move on|next)\b/.test(m)) return 'next';
  // Arabic definition words: معنى / يعني / اشرح / وش يعني / ايش معنى.
  // These must be tested before the length guard: "ايش معنى تيرمنال" is a
  // definitional question even though it is short.
  if (/(معنى|معني|يعني|اشرح|فسر|وش يعني|ايش يعني|ايش معنى|وش معنى|اي معنى)/.test(m)) return 'explain';
  if (/(what|ماذا|وين|أين|اين|where|how do i|how to|كيف|steps|خطوات|explain)/.test(m) && m.length > 8) return 'explain';
  // `done`/`ok`/`next` are matched on whole words so "I don't read Arabic"
  // or "where do I go" cannot trip the advance.
  // "What now / what do I do" is the most natural way a traveller asks to move
  // on. Leaving it unmatched made the app repeat the same stage verbatim,
  // which reads as a frozen conversation. Matched on whole words where the
  // phrase is short enough for `\b` to be meaningful.
  if (/\b(done|finished|ok|okay|next|next step|next one|what now|what next|and then|then what|what do i do|what should i do|what do i do now|what's next|whats next|go on|continue|move on|i'm done|im done)\b/.test(m)) return 'next';
  // Arabic: "وش أسوي", "ايش أسوي", "بعدين", "وبعدين", "الحين وش" and friends.
  if (/(تم|خلصت|انتهيت|انهيت|أكملت|اكملت|التالي|الخطوة التالية|وش أسوي|وش اسوي|ايش أسوي|ايش اسوي|وش الحين|ايش الحين|وش بعد|ايش بعد|وبعدين|بعدين|الحين وش|الحين ايش|الخطوة الجاية|الخطوه الجايه|كمل|نكمل)/.test(m)) return 'next';
  if (/(stuck|help|ساعدني|مساعدة|مساعده|تائه|ضائع|ضايع)/.test(m)) return 'help';
  return null;
}

function detectAirline(message, airports) {
  const m = normalize(message);
  const known = [
    ['Saudia', /saudia|السعودية|السعوديه|sv\b/],
    ['flyadeal', /flyadeal|فلاي أديل|فلاي ادايل/],
    ['flynas', /flynas|طيران ناس|فليناس/],
    ['Emirates', /emirates|الامارات|الإمارات/],
    ['Etihad', /etihad|الاتحاد/],
    ['Qatar Airways', /qatar|القطرية|القطريه/],
    ['Turkish Airlines', /turkish|التركية|التركيه/],
    ['EgyptAir', /egyptair|مصر للطيران/],
    ['Cairo Air', /cairo/]
  ];
  for (const [name, re] of known) if (re.test(m)) return name;
  return null;
}


// ---------------------------------------------------------------------------
// Plain-language explanations
//
// The traveller may not know a single airport word. Every term is explained
// the way you would explain it to a friend, with no jargon in the answer.
// Matching is on the word inside the message, so "what is a terminal",
// "وش يعني تيرمنال" and "I don't understand terminal" all resolve.
// ---------------------------------------------------------------------------

const GLOSSARY = [
  {
    keys: /terminal|تيرمنال|تيرمينال|الصالة|صالة/,
    en: 'A terminal is the main building at the airport — the big hall you walk into from the street. It holds the check-in desks, the security line, and the shops. Big airports have several buildings like this, numbered 1, 2, 3 and so on. The number is written on your ticket, and it tells you which building to go to.',
    ar: 'الصالة هي المبنى الرئيسي في المطار — القاعة الكبيرة اللي تدخلها من الشارع. فيها كاونترات تسجيل الوصول، وطابور التفتيش، والمحلات. المطارات الكبيرة فيها أكثر من مبنى، مرقّمين ١ و٢ و٣. الرقم مكتوب على تذكرتك، وهو اللي يقول لك أي مبنى تروح.'
  },
  {
    keys: /check[\s-]?in|تسجيل الوصول|كاونتر/,
    en: 'Check-in is the desk where you swap your ticket for a boarding pass. You hand over your passport and your big bag, and they put the bag on a belt that carries it to the plane. You keep a small receipt. From here on you only carry your hand luggage.',
    ar: 'تسجيل الوصول هو الكاونتر اللي تعطيهم فيه تذكرتك وياخذون حقيبتك الكبيرة. توريهم جوازك، ويحطون الشنطة على سير يوصلها للطيارة. وبيعطونك ورقة صغيرة احتفظ فيها. بعدها ما يبقى معك إلا الشنطة اليدوية.'
  },
  {
    keys: /boarding pass|بطاقة الصعود|البوردنق/,
    en: 'A boarding pass is the small paper or phone code you get at check-in. It is your proof that you are allowed on that flight. It has your flight number, your gate and your seat on it. Keep it in your hand — you show it at security, at passport control and at the gate.',
    ar: 'بطاقة الصعود هي الورقة الصغيرة (أو الرمز في الجوال) اللي تستلمها في تسجيل الوصول. هي إثبات إنك مسموح لك تركب هذي الرحلة. مكتوب فيها رقم رحلتك، وبوابتك، ومقعدك. خلها في يدك — توريها في التفتيش، وفي الجوازات، وعند البوابة.'
  },
  {
    keys: /security|تفتيش|الأمن|فحص/,
    en: 'Security is the checkpoint where they check what you are carrying. You put your bag in a plastic tray, take out your laptop, and walk through a gate that beeps if it detects metal. It is not about you — everybody goes through it. It takes two or three minutes.',
    ar: 'التفتيش هو النقطة اللي يشيكون فيها على اللي معك. تحط شنطتك في صينية بلاستيك، تطلع اللابتوب، وتعبر بوابة تصفر إذا فيها معدن. هذا مو شك فيك — الكل يمر منه. ياخذ دقيقتين أو ثلاث.'
  },
  {
    keys: /passport control|immigration|الجوازات|الهجرة/,
    en: 'Passport control is a desk with an officer in a booth. You give them your passport and boarding pass, they look at your face, and sometimes they take a fingerprint or a photo. Then they stamp it or wave you through. Have both documents in your hand before you reach the desk.',
    ar: 'الجوازات هو كاونتر فيه موظف داخل كابينة. تعطيهم جوازك وبطاقة الصعود، يشوفون وجهك، وأحيانًا يأخذون بصمة أو صورة. بعدها يختمون الجواز أو يأشرون لك تعدي. خلي الورقتين في يدك قبل ما توصل الكاونتر.'
  },
  {
    keys: /customs|جمارك|الجمارك/,
    en: 'Customs is the last check before you reach the shops and the gates. There are two paths: green if you have nothing to declare, red if you are carrying something valuable or restricted that must be reported. If you are not sure, take the red one — an officer will help you, and that is normal.',
    ar: 'الجمارك هو آخر فحص قبل ما توصل للمحلات والبوابات. فيه مسارين: الأخضر إذا ما معك شي يستوجب التصريح، والأحمر إذا معك شي ثمين أو ممنوع لازم تبلغ عنه. إذا مو متأكد خذ الأحمر — الموظف بيساعدك، وهذا شي عادي.'
  },
  {
    keys: /gate|بواب(ة|ه)|البوابة/,
    en: 'The gate is the door where you get on the plane. It has a number like 105A, and it is written on your boarding pass. When they call your flight, you show your pass and walk through that door. Gates can change, so check the screens near your gate once you arrive.',
    ar: 'البوابة هي الباب اللي منه تركب الطيارة. لها رقم مثل ١٠٥ أ، ومكتوب على بطاقة الصعود. لمن ينادون رحلتك، توري بطاقتك وتعبر من هذا الباب. البوابات تتغير أحيانًا، فتشيك على الشاشات القريبة منك لمن توصل.'
  },
  {
    keys: /boarding\b|الصعود/,
    en: 'Boarding means getting on the plane. It starts about 40 minutes before the flight leaves and closes 20–30 minutes before. If you are at the gate when they call, you have nothing to worry about. Do not go far from the gate in the last half hour.',
    ar: 'الصعود يعني ركوب الطيارة. يبدأ قبل الإقلاع بحوالي ٤٠ دقيقة، ويقفل قبل الإقلاع بـ ٢٠ إلى ٣٠ دقيقة. إذا كنت عند البوابة وقت النداء فأنت بخير. لا تبتعد عن البوابة في النصف ساعة الأخيرة.'
  },
  {
    keys: /duty free|السوق الحرة|المنطقة الحره/,
    en: 'Duty free is a shop inside the airport after passport control. It sells perfume, chocolate and gifts without the usual tax. You do not have to buy anything — walking straight past it is completely normal.',
    ar: 'السوق الحرة هو محل داخل المطار بعد الجوازات. يبيع عطور وشوكولاتة وهدايا بدون الضريبة المعتادة. مو لازم تشتري شي — تعدي جنبه عادي جدًا.'
  },
  {
    keys: /baggage claim|استلام الأمتعة|المفقودات/,
    en: 'Baggage claim is where you pick up your big bag after you land. It is a moving belt with a number above it. The number matches the one on the tag they gave you at check-in. If your bag does not arrive, there is an office beside the belt for that exact problem.',
    ar: 'استلام الأمتعة هو المكان اللي تستلم فيه شنطتك الكبيرة بعد ما تنزل من الطيارة. هو سير متحرك فوقه رقم. الرقم يطابق اللي على الملصق اللي أعطوك إياه في تسجيل الوصول. إذا ما وصلت شنطتك، في مكتب جانب السير مخصص لهذي الحالة بالضبط.'
  }
];

function explainTerm(message, lang){
  const m = normalize(message);
  for (const g of GLOSSARY) {
    if (g.keys.test(m)) {
      return lang === 'ar' ? g.ar : g.en;
    }
  }
  return null;
}

/**
 * The traveller asked something we cannot answer with a stage instruction.
 * Be honest, explain what we can, and hand control back — never repeat the
 * question they just asked about.
 */
function unknownReply(message, lang){
  if (lang === 'ar') {
    return 'والله ما فهمت قصدك بالضبط، وأعتذر عن ذلك.\n\n'
      + 'أقدر أساعدك في أشياء محددة: كيف تسجل الوصول، تفتيش الأمن، الجوازات، الجمارك، كيف تدور بوابتك، وإيش تسوي لو تغيرت البوابة.\n\n'
      + 'جرّب تسألني بطريقتك، ولا تخاف تكتب — ما في إجابة غلط. لو استخدمت كلمة ما تعرفها، اسألني «وش يعني …» وأنا أشرحها لك بكلام بسيط.';
  }
  return 'I did not quite understand that, and I am sorry for that.\n\n'
    + 'I can help with specific things: check-in, the security line, passport control, customs, finding your gate, and what to do if your gate changes.\n\n'
    + 'Ask me in your own words — there is no wrong way to write it. If a word is unfamiliar, ask me "what does … mean" and I will explain it in plain language.';
}

// ---------------------------------------------------------------------------
// Stage list — the seven guidance keys, of which six are the numbered flow
// and `gatechange` is the exceptional branch.
// ---------------------------------------------------------------------------

const FLOW_KEYS = ['checkin', 'security', 'passport', 'customs', 'gate', 'boarding'];

function stageKeyAt(settings, index) {
  const keys = FLOW_KEYS.filter((k) => settings.byKey[k]);
  return keys[Math.min(index, keys.length - 1)] || 'checkin';
}

function flowLength(settings) {
  return FLOW_KEYS.filter((k) => settings.byKey[k]).length;
}

// ---------------------------------------------------------------------------
// Fill placeholders in operator-edited guidance text
// ---------------------------------------------------------------------------

function text_of(messages) {
  return messages.map((m) => m.text).join('\n\n');
}

function fill(template, session, lang) {  const airport = session.airport ? AIRPORTS[session.airport] : null;
  return String(template || '')
    .replace(/\{airport\}/g, airport ? airport.short[lang] : (lang === 'ar' ? 'المطار' : 'the airport'))
    .replace(/\{terminal\}/g, session.terminal || (lang === 'ar' ? 'المذكورة على التذكرة' : 'the one on your ticket'))
    .replace(/\{flight\}/g, session.flight || (lang === 'ar' ? 'الرحلة' : 'your flight'))
    .replace(/\{gate\}/g, session.gate || (lang === 'ar' ? 'البوابة' : 'the gate'))
    .replace(/\{airline\}/g, session.airline || (lang === 'ar' ? 'شركة الطيران' : 'your airline'));
}

// ---------------------------------------------------------------------------
// Profile voice
// ---------------------------------------------------------------------------

/**
 * Wraps the core instruction in the cadence of the selected profile.
 * The guidance text itself is the same fact for everyone — the *delivery*
 * is what changes, which is exactly the claim the rubric tests.
 */
const VOICE = {
  nervous: {
    en: {
      open: (s, i) => {
        const lines = [
          'Take a breath — you are doing fine. ',
          'Good, that went well. ',
          'You are further along than most people expect at this point. ',
          'Still with you. ',
          'Almost there. ',
          'Last step. '
        ];
        return lines[i % lines.length] + s;
      },
      close: (i) => {
        const lines = [
          'Read it once, then do just that one thing. Tell me when you are through and I will give you the next step. If anything feels wrong, any staff member in uniform will help — that is what they are there for.',
          'One thing at a time — you do not need to think about the rest yet. Say "done" and I will take you on.',
          'Nothing here is complicated once you are standing at it. Tell me when it is finished.',
          'You are not behind. Say "done" when you are through and we will keep moving.',
          'Take it at your own pace. I will wait.',
          'That is the last gate. You made it — listen for your flight and board when called.'
        ];
        return lines[i % lines.length];
      }
    },
    ar: {
      open: (s, i) => {
        const lines = [
          'خذ نفسًا، فأنت تسير على ما يُرام. ',
          'أحسنت، هذه الخطوة انتهت. ',
          'أنت متقدّم أكثر مما يتوقع الناس في هذه المرحلة. ',
          'ما زلت معك. ',
          'قريب جدًا. ',
          'آخر خطوة. '
        ];
        return lines[i % lines.length] + s;
      },
      close: (i) => {
        const lines = [
          'اقرأها مرة واحدة، ثم نفّذ هذا الشيء الواحد فقط. أخبرني عندما تنتهي وسأعطيك الخطوة التالية. وإن شعرت بأي شيء غير طبيعي فتوجّه إلى أي موظف بالزي الرسمي.',
          'خطوة واحدة في كل مرة، لا داعي للتفكير في الباقي الآن. قل «تم» وسأكمل معك.',
          'لا شيء هنا صعب عندما تكون واقفًا عنده. أخبرني عندما تنتهي.',
          'أنت لست متأخرًا. قل «تم» عندما تنتهي وسنكمل.',
          'خذ وقتك، سأنتظر.',
          'هذه آخر بوابة. وصلت — أنصت لرحلتك واصعد عندما يُنادى.'
        ];
        return lines[i % lines.length];
      }
    }
  },
  adult: {
    en: {
      open: () => '',
      close: (i) => [
        'Everything you need for this desk is above. Confirm you are through and I will give you the next stage.',
        'Stage complete. Tell me and I will move you on.',
        'Next stage follows once you confirm.',
        'Say "done" for the following step.'
      ][i % 4]
    },
    ar: {
      open: () => '',
      close: (i) => [
        'كل ما تحتاجه لهذا المكتب مذكور أعلاه. أكّد لي أنك انتهيت وسأعطيك المرحلة التالية.',
        'انتهت المرحلة. أخبرني وأنقلك للتالية.',
        'المرحلة التالية بعد تأكيدك.',
        'قل «تم» للخطوة التي بعدها.'
      ][i % 4]
    }
  },
  hurried: {
    en: { open: () => '', close: () => 'Next.' },
    ar: { open: () => '', close: () => 'التالي.' }
  }
};

function voice(profile, lang) {
  const p = VOICE[profile] || VOICE.adult;
  return p[lang] || p.en;
}

// ---------------------------------------------------------------------------
// Onboarding — the four questions, asked before any directions
// ---------------------------------------------------------------------------

function missingField(session) {
  // The airport is never asked. Every session is Dammam: it is the only
  // airport with a live feed, and making a traveller type "I am at Dammam"
  // before anything works was the single most-repeated complaint.
  assumeDammam(session);
  if (!session.terminal) return 'terminal';
  if (session.minutes === null || session.minutes === undefined) return 'minutes';
  if (!session.bags) return 'bags';
  return null;
}

const ASK_KEY = { airport: 'askAirport', terminal: 'askTerminal', minutes: 'askTime', bags: 'askBags' };

function askQuestion(field, lang, settings) {
  const base = TEXT[lang][ASK_KEY[field]] || TEXT.en[ASK_KEY[field]];

  if (field === 'airport') {
    const active = settings.airports
      .map((k) => AIRPORTS[k].short[lang])
      .join(lang === 'ar' ? ' أم ' : ', ');
    return lang === 'ar'
      ? `أولًا، من أي مطار تسافر — ${active}؟`
      : `First, which airport are you flying from — ${active}?`;
  }
  if (field === 'terminal') {
    const lines = [base];
    if (lang === 'ar') {
      lines.push('اقرأها من تذكرة السفر — وليس من لوحة في المطار.');
    } else {
      lines.push('Read it from your ticket, not from a board at the airport.');
    }
    return lines.join('\n');
  }
  if (field === 'minutes') {
    return lang === 'ar'
      ? `${base}\nاذكرها بالدقائق أو بالساعات، مثل «40 دقيقة» أو «ساعة».`
      : `${base}\nA number of minutes or hours is enough — for example "40 minutes" or "one hour".`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * @param {object} state see file header
 * @returns {{messages: Array, session: object, meta: object}}
 */
function generateReply(state) {
  const message = String(state.message || '').slice(0, 2000);
  const settings = state.settings;

  const session = Object.assign(
    {
      stage: 0,
      airport: null,
      terminal: null,
      flight: null,
      airline: null,
      gate: null,
      bags: null,
      minutes: null,
      concern: null,
      askedCount: 0,
      gateChanged: false,
      awaitingGate: false,
      // Repeat-suppression: an urgent warning is a one-off safety alert, not a
      // banner on every message. Same for the reassurance line.
      escalationShown: false,
      reassured: false,
      explained: []
    },
    state.session || {}
  );

  // --- 1. Language ---------------------------------------------------------
  // `state.lang` and `state.langLocked` are decided by the caller: locked means
  // the traveller pressed a language button, so that choice wins outright.
  // Unlocked means auto-follow the script of the message.
  const lang = state.langLocked === true && (state.lang === 'ar' || state.lang === 'en')
    ? state.lang
    : detectLanguage(message, state.lang === 'ar' ? 'ar' : 'en');

  // --- 2. Allowed profile (admin can switch any of the three off) ----------
  let profile = state.profile;
  const allowed = settings.profilesEnabled || {};
  if (!allowed[profile]) {
    profile = ['nervous', 'adult', 'hurried'].find((p) => allowed[p]) || 'adult';
  }
  const v = voice(profile, lang);

  const messages = [];
  const push = (text) => {
    const t = String(text || '').trim();
    if (t) messages.push({ role: 'assistant', text: t });
  };

  // --- 3. Harvest facts from this message ----------------------------------
  const otherIn = detectOtherAirport(message);
  // "I am at Dubai, going home to Riyadh": the traveller is in Dubai.
  const airportIn = otherIn ? null : detectAirport(message);
  if (airportIn) { session.airport = airportIn; session.otherAirport = null; }
  if (otherIn) {
    const isNew = !session.otherAirport || session.otherAirport.code !== otherIn.code;
    session.otherAirport = otherIn;
    session.airport = null;
    // Said once, when they first tell us where they are.
    if (isNew) push(otherAirportNote(otherIn, lang));
  }
  const other = session.otherAirport || null;
  const terminalIn = detectTerminal(message);
  if (terminalIn) session.terminal = terminalIn;
  const flightIn = detectFlight(message);
  if (flightIn) session.flight = flightIn;
  const gateIn = detectGate(message);
  if (gateIn) session.gate = gateIn;
  // A gate-change follow-up ("what is the new gate?") owns any bare number in
  // this message, so it must not also land in `minutes`.
  const minsIn = detectMinutes(message, !session.awaitingGate);
  if (minsIn !== null && minsIn >= 0 && !session.awaitingGate) session.minutes = minsIn;
  const bagsIn = detectBags(message);
  if (bagsIn) session.bags = bagsIn;
  const concernIn = detectConcern(message);
  if (concernIn) session.concern = concernIn;
  const airlineIn = detectAirline(message, settings.airports);
  if (airlineIn) session.airline = airlineIn;

  const intent = detectIntent(message);
  session.askedCount += 1;

  // Never route to an airport the operator has disabled.
  if (session.airport && !settings.airports.includes(session.airport)) {
    session.airport = null;
  }

  // --- 4. Hard safety branch: escalation -----------------------------------
  const escalateAt = Number(settings.escalateMinutes || 60);
  const escalated = session.minutes !== null && session.minutes <= escalateAt;
  // Say the safety instruction once. Repeating it every turn reads as a broken
  // app and trains the traveller to ignore the red box.
  const announceEscalation = escalated && !session.escalationShown;
  if(announceEscalation) session.escalationShown = true;

  // --- 4a0. Weather ---------------------------------------------------------
  // The server fetched the forecast before calling us (state.weather), so the
  // reply is written from real numbers. No forecast -> say so, never invent.
  if (weather.isWeatherQuestion(message)) {
    assumeDammam(session);
    push(weather.toText(state.weather || null, lang));
    if (announceEscalation) push(TEXT[lang].escalate);
    return {
      messages,
      session,
      meta: { stage: session.stage, stageKey: 'weather', escalated,
              escalationAnnounced: !!announceEscalation, intent: 'weather', lang, profile,
              airport: session.airport, weatherLevel: state.weather && state.weather.ok ? state.weather.level : null }
    };
  }
  // A delay question gets the forecast as an extra line wherever it lands.
  const weatherNote = weather.isDelayQuestion(message) ? weather.toShortText(state.weather || null, lang) : null;

  // --- 4a. "Where is my gate?" -------------------------------------------
  // Answered before the glossary, or "what is my gate" would explain what a
  // gate is. The server attaches a map card to this turn (src/gatemap.js);
  // the words here never claim a position the map does not pin.
  if (intent !== 'gatechange' && !session.awaitingGate && gatemap.isGateQuestion(message)) {
    assumeDammam(session);
    const gate = session.gate;
    const hit = gate && session.airport === 'ruh' ? gatemap.findRiyadhGate(gate) : null;
    let body;
    if (other) {
      body = lang === 'ar'
        ? (gate
          ? `بوابتك **${gate}**. ليست عندي خريطة لمطار ${other.ar}، فاتبع لوحات «البوابات» المعلّقة في السقف حتى ترى الرقم ${gate}، وتحقّق منه على أقرب شاشة مغادرة. إن لم تجده فاسأل أي موظف.`
          : `ليست عندي خريطة لمطار ${other.ar}. رقم بوابتك مكتوب على بطاقة الصعود وعلى شاشات المغادرة، وأي موظف يدلّك عليها.`)
        : (gate
          ? `Your gate is **${gate}**. I do not have a map of ${other.en} airport, so follow the overhead "Gates" signs until you see ${gate}, and check it on the nearest departure screen. If you cannot find it, ask any staff member.`
          : `I do not have a map of ${other.en} airport. Your gate is on your boarding pass and on the departure screens, and any staff member can point you to it.`);
    } else if (gate && hit) {
      body = lang === 'ar'
        ? `بوابتك **${gate}**، وهي في ${gatemap.floorLabel(hit.floor, 'ar')}. حدّدتها لك على الخريطة تحت هذه الرسالة.\n\nتحقّق من الرقم مرة أخرى على أقرب شاشة مغادرة، فالبوابة قد تتغيّر.`
        : `Your gate is **${gate}**, on ${hit.floor}. I have pinned it on the map below this message.\n\nCheck the number once more on the nearest departure screen — gates can change.`;
    } else if (gate) {
      body = lang === 'ar'
        ? `بوابتك **${gate}**. وضعت لك المطار على الخريطة تحت هذه الرسالة، لكن موقع البوابة بالضبط ليس عندي، فلن أخمّنه.\n\nبعد الجوازات اتبع لوحات «البوابات» المعلّقة في السقف حتى ترى الرقم ${gate}، وتحقّق منه على أقرب شاشة مغادرة.`
        : `Your gate is **${gate}**. I have put the airport on the map below, but I do not have the exact position of that gate, so I will not guess it.\n\nAfter passport control, follow the overhead "Gates" signs until you see ${gate}, and check it on the nearest departure screen.`;
    } else {
      body = lang === 'ar'
        ? 'لا أعرف رقم بوابتك بعد. هو مكتوب على بطاقة الصعود وعلى شاشات المغادرة.\n\nاكتب لي رقم البوابة أو رقم رحلتك، أو صوّر تذكرتك، وسأضعها لك على الخريطة.'
        : 'I do not know your gate yet. It is printed on your boarding pass and shown on the departure screens.\n\nTell me the gate or your flight number, or send a photo of your ticket, and I will put it on the map.';
    }
    push(body);
    if (announceEscalation) push(TEXT[lang].escalate);
    return {
      messages,
      session,
      meta: { stage: session.stage, stageKey: 'findgate', escalated,
              escalationAnnounced: !!announceEscalation, intent: 'findgate',
              lang, profile, airport: session.airport, gate: gate || null, exact: !!hit }
    };
  }

  // --- 4b. Answer a question before asking anything -------------------------
  // A traveller who writes "what is a terminal" is stuck, not confused about
  // the form. Explain the word, then continue exactly where they left off —
  // and never trap them: they can always keep typing.
  const asked = /\b(what|whats|what is|what does|meaning|mean|explain|why|how come)\b/i.test(message)
             || /(وش يعني|ايش يعني|معنى|اشرح|لماذا|ايش معنى)/.test(message);

  if (asked) {
    const explained = explainTerm(message, lang);
    if (explained) {
      // Asking the same word twice means the first answer did not land.
      // Say it a different, shorter way instead of repeating the paragraph.
      const already = (session.explained || []).indexOf(message.trim().toLowerCase()) >= 0;
      let body = explained;
      if (already) {
        body = lang === 'ar'
          ? 'أعيدها بطريقة ثانية: ' + explained.split(/[.。]/)[0] + '.\n\nبكلام أبسط: هذا شي عادي جدًا، وكل المسافرين يمرون منه.'
          : 'Let me say it another way: ' + explained.split(/[.。]/)[0] + '.\n\nIn simpler words: this is completely normal, and every traveller goes through it.';
      }
      session.explained = (session.explained || []).concat(message.trim().toLowerCase()).slice(-12);

      const tail = lang === 'ar'
        ? '\n\nلا تقلق — كمّل براحتك، وأنا معك خطوة بخطوة.'
        : '\n\nDo not worry — carry on at your own pace, I am with you.';
      push(body + tail);
      if (announceEscalation && session.airport) push(TEXT[lang].escalate);
      return {
        messages,
        session,
        meta: { stage: session.stage, stageKey: 'explain', escalated,
                escalationAnnounced: !!announceEscalation, intent: 'explain',
                lang, profile }
      };
    }
  }

  // --- 5. Gate change is always handled first ------------------------------
  // Two ways in: the traveller says the gate changed, or we asked for the new
  // gate on the previous turn and this message supplies it.
  const gatechangeStage = settings.byKey.gatechange;
  const wantsGateChange = intent === 'gatechange'
    || (gateIn && session.gateChanged && /change|تغير|تغيّر/.test(normalize(message)))
    || (session.awaitingGate && !!gateIn);

  if (gatechangeStage) {
    if (wantsGateChange) {
      session.gateChanged = true;
      const newGate = gateIn || session.gate;

      // If we were not told the new gate number we must not invent one.
      if (!newGate) {
        session.awaitingGate = true;
        const ask = lang === 'ar'
          ? 'فهمت أن البوابة تغيّرت. **ما رقم البوابة الجديدة** كما هو مكتوب على الشاشة؟ لن أخبرك ببوابة لم أتأكد منها.\n\nفي هذه الأثناء: اذهب إلى أقرب شاشة مغادرة واقرأ رقم بوابتك من هناك.'
          : 'I understand your gate changed. **What is the new gate number**, exactly as it appears on the screen? I will not send you to a gate I have not confirmed.\n\nIn the meantime: go to the nearest departure screen and read your gate from it.';
        push(ask);
        if (announceEscalation) push(TEXT[lang].escalate);
        return {
          messages,
          session,
          meta: { stage: session.stage, stageKey: 'gatechange', escalated, escalationAnnounced: !!announceEscalation, intent, lang, profile, needsGate: true }
        };
      }

      session.awaitingGate = false;

      if (profile === 'hurried') {
        push(lang === 'ar'
          ? `البوابة الجديدة ${newGate || ''} — اذهب مباشرة. إن بدأ الصعود أو كانت بعيدة فتحدّث إلى موظف الطيران فورًا.`
          : `New gate ${newGate || ''} — go straight there. If boarding has started or it is far, speak to airline staff now.`);
      } else {
        const head = lang === 'ar'
          ? `**${TEXT.ar.gateChange}.** ${fill(gatechangeStage.guidance.ar, Object.assign({}, session, { gate: newGate }), 'ar')}`
          : `**${TEXT.en.gateChange}.** ${fill(gatechangeStage.guidance.en, Object.assign({}, session, { gate: newGate }), 'en')}`;
        push(profile === 'nervous' ? `${v.open(head, session.stage)}\n\n${v.close(session.stage)}` : head);
      }

      if (announceEscalation) push(TEXT[lang].escalate);

      return {
        messages,
        session,
        meta: { stage: session.stage, stageKey: 'gatechange', escalated, escalationAnnounced: !!announceEscalation, intent, lang, profile }
      };
    }
  }

  // --- 5b. Directions: hand over the airport's own link immediately ------
  // Before onboarding, on purpose. Someone asking "where do I go" wants a
  // URL, not four questions first. A link is never wrong, so it needs no
  // personalisation.
  if (intent === 'directions' && other) {
    push(lang === 'ar'
      ? `ليست عندي خريطة لمطار ${other.ar}. لوحات الإرشاد في المطار وشاشات المغادرة هي دليلك، ومكتب الاستعلامات أو أي موظف يدلّك على الطريق.`
      : `I do not have a map of ${other.en} airport. The signs and departure screens there are your guide, and the information desk or any staff member can show you the way.`);
    return {
      messages, session,
      meta: { stage: session.stage, stageKey: 'directions', escalated,
              escalationAnnounced: !!announceEscalation, intent, lang, profile, otherAirport: other.code }
    };
  }
  if (intent === 'directions') {
    assumeDammam(session);
    const L = DIRECTIONS_LINKS[lang] || DIRECTIONS_LINKS.en;
    push(L.intro);
    push(L.map);
    push(L.departures);
    return {
      messages,
      session,
      meta: { stage: session.stage, stageKey: 'directions', escalated,
              escalationAnnounced: !!announceEscalation, intent, lang, profile, links: true }
    };
  }

  // --- 5c. "Something happened to my flight" -----------------------------
  // The airport's own board is authoritative and always current. When the
  // traveller suspects a delay, cancellation or a missed flight, send them
  // straight to it with their flight number ready, rather than describing it.
  // A ticket with a boarding time answers "am I late" arithmetically — that is
  // the core product. Only fall through to the board when we cannot compute a
  // countdown, or when the traveller reports something specific (cancelled,
  // missed). Otherwise "am i late" would trade a number for a URL.
  if (intent === 'flightcheck') {
    const hasCountdown = session.minutes != null || (session.boarding && session.flight);
    const reportsEvent = /(cancel|missed|miss my flight|final call|gate closed|ألغيت|الغيت|فاتت|فاتتني|النداء الأخير|ملغاة)/i.test(message);
    if ((!hasCountdown || reportsEvent) && other) {
      push(lang === 'ar'
        ? `لا أستطيع قراءة شاشة مغادرة مطار ${other.ar}. انظر إلى أقرب شاشة مغادرة${session.flight ? ' وابحث عن رحلتك ' + session.flight : ''}، أو اسأل مكتب شركة الطيران. أخبرني بما تراه وسأقول لك ماذا تفعل.`
        : `I cannot read the departure board at ${other.en} airport. Look at the nearest departure screen${session.flight ? ' for flight ' + session.flight : ''}, or ask your airline's desk. Tell me what it says and I will tell you what to do next.`);
      if (weatherNote) push(weatherNote);
      return {
        messages, session,
        meta: { stage: session.stage, stageKey: 'flightcheck', escalated,
                escalationAnnounced: !!announceEscalation, intent, lang, profile, otherAirport: other.code }
      };
    }
    if (!hasCountdown || reportsEvent) {
      assumeDammam(session);
    const L = DIRECTIONS_LINKS[lang] || DIRECTIONS_LINKS.en;
    push(L.checkIntro);
    push(L.departures);
    if (session.flight) push(L.checkFlight + session.flight);
    push(L.checkPlan);
    if (weatherNote) push(weatherNote);
    return {
      messages,
      session,
      meta: { stage: session.stage, stageKey: 'flightcheck', escalated,
              escalationAnnounced: !!announceEscalation, intent, lang, profile,
              links: true, flight: session.flight || null }
      };
    }
  }

  // --- 6. Onboarding: ask before advising ---------------------------------
  const missing = missingField(session);

  // A traveller who is already moving (gave terminal + time) gets a stage
  // answer if they ask for one; otherwise we keep collecting.
  const wantsStageNow = intent === 'next' && !missing;

  if (missing && !wantsStageNow) {
    // Urgency shortcut: if we know time is short, lead with the safety action
    // and collect the rest afterwards.
    if (announceEscalation && session.airport) {
      push(TEXT[lang].escalate);
    }

    // If the traveller wrote something substantial that we did not understand,
    // say so once — then still ask the question we need. Silently repeating
    // the same prompt is what makes the app feel like it is not listening.
    const looksLikeStatement = message.trim().split(/\s+/).length >= 3
      && !airportIn && !terminalIn && bagsIn === null
      && (minsIn === null || minsIn === undefined);

    if (looksLikeStatement) {
      // Nervous travellers are not asking for a procedure — they are telling
      // us they are uneasy. Acknowledge the feeling before asking anything.
      const worried = /(scared|afraid|nervous|worried|anxious|never done|first time|don.t know|confused|خايف|قلق|متوتر|أول مرة|اول مره|ما أعرف|ما اعرف|مو فاهم)/i.test(message);

      let ack;
      if (lang === 'ar') {
        ack = worried
          ? 'سمعتك، وهذا شعور طبيعي تمامًا — أول رحلة لوحدك مربكة على أي أحد، صغير أو كبير.\n\nما راح أتجاهلك. عطني معلومة أو معلومتين بس وأنا أمسك يدك بالباقي:\n\n'
          : 'سمعتك، وما راح أتجاهلك.\n\nعشان أقدر أساعدك بالضبط، محتاج منك:';
      } else {
        ack = worried
          ? 'I hear you, and that is a completely normal way to feel — a first flight alone is confusing for anyone, at any age.\n\nI am not going to ignore you. Give me one or two facts and I will take it from there:\n\n'
          : 'I hear you, and I am not going to ignore you.\n\nTo help you properly I need one thing:';
      }
      push(ack + askQuestion(missing, lang, settings));
      return {
        messages,
        session,
        meta: { stage: session.stage, stageKey: 'onboarding', escalated,
                escalationAnnounced: !!announceEscalation, intent, lang, profile,
                missing, acknowledged: true }
      };
    }

    let q = askQuestion(missing, lang, settings);

    if (profile === 'hurried') {
      if (!messages.length) {
        push(lang === 'ar' ? `${TEXT.ar.hurry} ${q}` : `${TEXT.en.hurry} ${q}`);
      } else {
        push(q);
      }
    } else if (profile === 'nervous' && !session.reassured) {
      // Said once, at the start. Repeating it before every question makes the
      // app feel like it is not listening.
      const reassure = lang === 'ar'
        ? 'لا يوجد ما يستدعي القلق — سأرشدك خطوة بخطوة، ولن أتجاوز أي خطوة قبل أن تطمئن.'
        : 'There is nothing here to worry about — I will walk you through it one step at a time, and I will not move on until you are comfortable.';
      session.reassured = true;
      push(`${reassure}\n\n${q}`);
    } else {
      push(q);
    }

    return {
      messages,
      session,
      meta: { stage: session.stage, stageKey: 'onboarding', escalated, escalationAnnounced: !!announceEscalation, intent, lang, profile, missing }
    };
  }

  // --- 7. Small-talk / meta branches --------------------------------------
  if (intent === 'help') {
    const help = lang === 'ar'
      ? 'أنا هنا للتنقل في مطار. قل لي في أي مرحلة أنت الآن — تسجيل الوصول، الأمن، الجوازات، الجمارك، إيجاد البوابة — وسأرشدك للخطوات. وإن حدث شيء فجائي، اسألني عن تغيير البوابة.'
      : 'I am here for airport navigation. Tell me which stage you are at — check-in, security, passport control, customs, or finding the gate — and I will walk you there. If something changes suddenly, ask me about a gate change.';
    push(help);
    if (announceEscalation) push(TEXT[lang].escalate);
    return {
      messages,
      session,
      meta: { stage: session.stage, stageKey: 'help', escalated, escalationAnnounced: !!announceEscalation, intent, lang, profile }
    };
  }

  // --- 8. Deliver the current stage ---------------------------------------
  const maxStage = flowLength(settings) - 1;

  // "next" advances the pointer (never past the last stage).
  if (intent === 'next' && session.stage < maxStage) session.stage += 1;

  const stageKey = stageKeyAt(settings, session.stage);
  const stage = settings.byKey[stageKey];

  const body = fill(stage.guidance[lang] || stage.guidance.en, session, lang);
  const stageName = (stage.label && (stage.label[lang] || stage.label.en)) || stageKey;

  // Escalation wins the framing the first time only.
  if (announceEscalation) {
    push(TEXT[lang].escalate);
  }

  if (profile === 'hurried') {
    push(body);
    // A hurried traveller gets the next action too, but never more than three.
    const nextIdx = session.stage + 1;
    if (nextIdx <= maxStage) {
      const nextKey = stageKeyAt(settings, nextIdx);
      const nextStage = settings.byKey[nextKey];
      const nextBody = fill(nextStage.guidance[lang] || nextStage.guidance.en, session, lang);
      push(lang === 'ar' ? `ثم: ${nextBody}` : `Then: ${nextBody}`);
    }
  } else if (profile === 'nervous') {
    push(`${v.open(`**${stageName}.** ${body}`, session.stage)}\n\n${v.close(session.stage)}`);
  } else {
    const lines = [`**${stageName}.** ${body}`];

    if (session.airport) {
      const a = AIRPORTS[session.airport];
      if (a.specifics) lines.push(a.specifics[lang] || a.specifics.en);
      if (a.unverifiedNote) lines.push(a.unverifiedNote[lang] || a.unverifiedNote.en);
    }
    lines.push(v.close(session.stage));
    push(lines.join('\n\n'));
  }

  // Honesty is not a tone choice: an unverified airport is flagged for every
  // profile, including the hurried one who gets everything else stripped back.
  if (session.airport) {
    const a = AIRPORTS[session.airport];
    const note = a.unverifiedNote && (a.unverifiedNote[lang] || a.unverifiedNote.en);
    const alreadySaid = note && text_of(messages).includes(note.slice(0, 40));
    if (note && !alreadySaid) push(note);
  }

  if (weatherNote) push(weatherNote);

  // Concern acknowledged once, in the traveller's own words, without raising fear.
  if (session.concern === 'queue' && profile !== 'hurried') {
    push(lang === 'ar'
      ? `لوحات المغادرة تبيّن لك وقت الإقلاع، وفريق الشركة عند الكاونتر يستطيع تسريعك إن لزم.`
      : 'The departure screens show the boarding time, and the airline desk can move you faster if it comes to that.');
  }

  return {
    messages,
    session,
    meta: {
      stage: session.stage,
      stageKey,
      stageName,
      escalated,
      escalationAnnounced: !!announceEscalation,
      intent,
      lang,
      profile,
      airport: session.airport,
      airportVerified: session.airport ? AIRPORTS[session.airport].verified : null
    }
  };
}

// ---------------------------------------------------------------------------
// TICKET -> CONVERSATION
//
// A scanned ticket used to reach only the prompt's ticket block. The chat
// history — the thing the model actually replays each turn — contained no
// trace of it. The traveller saw a tidy card on screen while the model saw a
// conversation in which no ticket had ever been mentioned, and answered
// "I can't see the ticket picture here" while holding their flight number.
//
// The scan is therefore made a real conversational event: when a ticket is
// read it is written into the history as something the agent said, with the
// facts spelled out. From then on the model remembers it like any other turn.
// ---------------------------------------------------------------------------

const AIRPORT_WORDS = {
  DMM: 'Dammam (King Fahd International)',
  RUH: 'Riyadh (King Khalid International)',
  JED: 'Jeddah (King Abdulaziz International)',
  DXB: 'Dubai (DXB)', AUH: 'Abu Dhabi (AUH)', DOH: 'Doha (DOH)',
  BAH: 'Bahrain (BAH)', KWI: 'Kuwait (KWI)', CAI: 'Cairo (CAI)',
  IST: 'Istanbul (IST)', LHR: 'London Heathrow (LHR)'
};

function airportWords(code) {
  const c = String(code || '').trim().toUpperCase();
  return c ? (AIRPORT_WORDS[c] || c) : '';
}

/**
 * Make a model-read ticket safe to store, replay and show.
 *
 * The vision model returns literal "null"/"N/A" strings for fields it could
 * not read, and splits flight numbers ("XY 406") which then fail the live
 * lookup. Both are fixed here, once, so every consumer sees the same values.
 */
function normalizeTicketFields(fields) {
  const out = {};
  const BAD = /^(null|undefined|n\/?a|none|-|—|)$/i;
  for (const [k, raw] of Object.entries(fields || {})) {
    if (raw === null || raw === undefined) continue;
    const v = String(raw).trim();
    if (BAD.test(v)) continue;
    out[k] = v;
  }
  if (out.flight) {
    // "XY 406", "XY406", "XY-406" all become the printed "XY-406".
    const f = String(out.flight).toUpperCase().replace(/\s+/g, '');
    const m = f.match(/^([A-Z]{2}|[A-Z][0-9]|[0-9][A-Z])-?([0-9]{1,4})$/);
    out.flight = m ? m[1] + '-' + m[2] : f;
  }
  if (out.airport) out.airport = String(out.airport).toUpperCase().replace(/[^A-Z]/g, '');
  return out;
}

const TICKET_TURN = /^I have read your ticket\.|^قرأت تذكرتك\./;

/**
 * Write a ticket into the session history as an assistant turn.
 *
 * Idempotent: a re-scan replaces the previous ticket turn instead of adding a
 * second one, so a traveller can photograph another boarding pass without the
 * model replaying two contradictory cards.
 */
function recordTicketInHistory(session, fields, lang) {
  if (!session) return session;
  if (!Array.isArray(session.history)) session.history = [];
  const t = normalizeTicketFields(fields);
  if (!Object.keys(t).length) return session;

  const ar = lang === 'ar';
  const parts = [];
  if (t.flight) parts.push((ar ? 'رقم الرحلة' : 'Flight') + ': ' + t.flight);
  if (t.airline) parts.push((ar ? 'الناقل' : 'Airline') + ': ' + t.airline);
  if (t.airport) parts.push((ar ? 'مطار المغادرة' : 'Departure airport') + ': ' + airportWords(t.airport));
  if (t.destination) parts.push((ar ? 'الوجهة' : 'Destination') + ': ' + t.destination);
  if (t.terminal) parts.push((ar ? 'الصالة' : 'Terminal') + ': ' + t.terminal);
  if (t.gate) parts.push((ar ? 'البوابة' : 'Gate') + ': ' + t.gate);
  if (t.boarding) parts.push((ar ? 'وقت الصعود' : 'Boarding time') + ': ' + t.boarding);
  if (t.seat) parts.push((ar ? 'المقعد' : 'Seat') + ': ' + t.seat);
  if (t.date) parts.push((ar ? 'التاريخ' : 'Date') + ': ' + t.date);

  const content = (ar
    ? 'قرأت تذكرتك. هذه التفاصيل موجودة لديّ بالفعل في هذه المحادثة، ولن أطلبها منك مرة أخرى:\n'
    : 'I have read your ticket. These details are already in this conversation — do not ask for them again:\n'
  ).concat(parts.join('\n')).slice(0, 900);

  session.history = session.history.filter((h) => !(h && h.role === 'assistant' && TICKET_TURN.test(String(h.content))));
  session.history.push({ role: 'assistant', content });
  session.ticketRecorded = true;
  return session;
}

module.exports = {
  generateReply,
  detectLanguage,
  detectAirport,
  detectOtherAirport,
  detectMinutes,
  detectBags,
  normalizeTicketFields,
  recordTicketInHistory,
  airportWords,
  FLOW_KEYS,
  // exported for tests
  _internal: { fill, detectTerminal, detectGate, detectFlight, detectConcern, stageKeyAt }
};
