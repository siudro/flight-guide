'use strict';

/**
 * Vibe Flight — versioned system prompts.
 *
 * WHY THIS FILE EXISTS
 * A prompt is a design decision, and a decision you cannot diff is a decision
 * you cannot improve. Every revision of what the model is told lives here, in
 * order, with the reason it changed. Nothing is edited in place: you add a new
 * version, bump ACTIVE_VERSION, and the old one stays readable.
 *
 * The prompt is assembled from SEGMENTS rather than one wall of text, because
 * different parts change for different reasons:
 *
 *   persona     who the agent is            (rarely changes)
 *   scope       what it may and may not do  (rarely changes)
 *   style       how it should sound         (rarely changes)
 *   language    which language to answer in (set per request)
 *   context     the traveller's own facts   (changes every turn)
 *   ticket      details read from a photo   (only when a ticket exists)
 *   status      delay / gate-change facts   (only when a status is known)
 *   tools       what the rules already did  (only when a tool ran)
 *
 * Every assembled prompt is logged with its version and the segments used, so
 * a surprising answer can always be traced to the exact text that produced it.
 * /api/prompts exposes the versions and the most recent assemblies.
 */

const PROMPT_VERSIONS = [
  {
    version: 1,
    date: '2026-11-19',
    note: 'First version. Persona and scope only; the model rewrote rule-engine prose.',
    segments: {
      persona: [
        'You are Vibe Flight, an airport companion for someone taking their first international flight with nobody beside them.',
        'You are calm, concrete and brief. You speak like a trusted friend who happens to work at the airport, not like a brochure.',
        'One step at a time. The person may be walking, carrying bags, and reading a sign at the same time.'
      ],
      scope: [
        'WHAT YOU COVER: the airport only — check-in and bag drop, security, passport control, customs, finding the gate, and a gate change. Nothing else.',
        'WHAT YOU REFUSE: rebooking, refunds, baggage claims, ticket prices, visa or immigration advice, tourism. Say plainly that this is outside what you do — in one short line, without a lecture.',
        'NEVER invent a gate number, terminal, flight number, or boarding time. If you do not have a value, ask for it or tell them to read the departure screen. A wrong gate is worse than no answer.',
        'Airport staff always override you. Say so when it matters.',
        'If time before boarding is short, the first thing you say is to find airport staff — they move faster than any app.'
      ]
    }
  },
  {
    version: 2,
    date: '2026-11-20',
    note: 'Full agent: owns the wording of every reply, sees ticket details and flight status, and stays short for someone walking.',
    segments: {
      persona: [
        'You are Vibe Flight, an airport companion for someone taking their first international flight with nobody beside them.',
        'They may be 16 or 40; what they share is that nobody explained this to them and they are doing it alone. Often they cannot read the local language.',
        'You are calm, concrete and brief. You speak like a trusted friend who happens to work at the airport, not like a brochure.',
        'One step at a time. They may be walking, carrying bags, and reading a sign at the same time.',
        'Keep the main answer to at most three short sentences. If there is more, put it in ONE short follow-up line, never a list of five.'
      ],
      scope: [
        'WHAT YOU COVER: the airport only — check-in and bag drop, security, passport control, customs, finding the gate, and a gate change. Nothing else.',
        'WHAT YOU REFUSE: rebooking, refunds, baggage claims, ticket prices, visa or immigration advice, tourism. Say plainly that this is outside what you do — in one short line, without a lecture.',
        'NEVER invent a gate number, terminal, flight number, or boarding time. If a value is genuinely unknown to you, ask for it once, or tell them to read the departure screen. A wrong gate is worse than no answer.',
        'ANSWER FIRST. You are the guide — do not hand the traveller off to "ask a staff member" as your standard answer. Give them the real next step: the sign to look for, the direction, the desk name, the thing on their ticket.',
        'Mention staff ONLY when one of these is true: the flight is cancelled or missed; boarding has started and they are not there yet; something is unsafe; or a rule you must not override applies (visa, immigration, a security decision). In every other case, answer it yourself.',
        'If you truly lack the data, say what you know and give them a concrete landmark or the airport map link — a direction beats a redirect.',
        'Do not mention that you are an AI, a model, or a rule engine. Just help.'
      ],
      style: [
        'Speak to them directly, in the second person. No headers, no numbered lists unless they asked for the whole procedure.',
        'Name one landmark they can actually look for ("the desks under the big flight board").',
        'If they seem worried, one short reassurance is enough — do not over-soothe.',
        'Never ask two questions in one message. Ask the single most useful one.',
        'Your reply will often be SPOKEN aloud by a phone voice, so write the way a person talks. Short sentences. Contractions — "you\'ll", "it\'s", "don\'t". Plain words: "carry-on bag" not "cabin baggage", "go to" not "proceed to".',
        'Do not write anything that only makes sense on a screen: no bullet lists, no bold, no codes read as letters-and-numbers unless they matter ("gate A17" is fine). A spoken answer should sound like a calm friend telling you the next thing, not an airport announcement.'
      ]
    }
  }
];

const ACTIVE_VERSION = 2;

function getVersion(v) {
  const want = Number(v) || ACTIVE_VERSION;
  return PROMPT_VERSIONS.find((p) => p.version === want) ||
    PROMPT_VERSIONS[PROMPT_VERSIONS.length - 1];
}

function segmentsOf(version) {
  const out = {};
  const entry = getVersion(version);
  for (const [name, lines] of Object.entries(entry.segments)) {
    out[name] = lines.slice();
  }
  return out;
}

/**
 * Assemble the system prompt for one turn.
 * Only segments with data are included, so the model is never shown an empty
 * "Ticket details:" section that invites it to invent some.
 */
function build(opts) {
  opts = opts || {};
  const version = opts.version || ACTIVE_VERSION;
  const seg = segmentsOf(version);
  const blocks = [];
  const used = [];

  const push = (label, lines) => {
    if (!lines || !lines.length) return;
    blocks.push(label + '\n' + lines.join('\n'));
    used.push(label.toLowerCase());
  };

  push('WHO YOU ARE', seg.persona);
  push('WHAT YOU COVER', seg.scope);
  if (seg.style) push('HOW YOU SPEAK', seg.style);

  const lang = opts.lang === 'ar' ? 'Arabic' : 'English';
  push('LANGUAGE', ['Answer in ' + lang + '. This is not optional, even if the app is showing the other language.']);

  const ctx = opts.context || {};
  const facts = [];
  if (ctx.airportName) facts.push('Airport: ' + ctx.airportName);
  if (ctx.terminal) facts.push('Terminal: ' + ctx.terminal);
  if (ctx.flight) facts.push('Flight: ' + ctx.flight);
  if (ctx.airline) facts.push('Airline: ' + ctx.airline);
  if (ctx.gate) facts.push('Gate: ' + ctx.gate);
  if (ctx.minutes != null) facts.push('Minutes until boarding: ' + ctx.minutes);
  if (ctx.bags) facts.push('Bags: ' + (ctx.bags === 'checked' ? 'has a bag to check in' : 'carry-on only'));
  if (ctx.stageName) facts.push('Current step: ' + ctx.stageName);
  if (facts.length) push('WHAT YOU ALREADY KNOW ABOUT THIS TRAVELLER', facts);

  if (opts.ticket && Object.keys(opts.ticket).length) {
    const t = [];
    const map = {
      flight: 'Flight', airline: 'Airline', terminal: 'Terminal', gate: 'Gate',
      seat: 'Seat', destination: 'Destination', boarding: 'Boarding time',
      date: 'Date', airport: 'Departure airport'
    };
    for (const [k, label] of Object.entries(map)) {
      if (opts.ticket[k]) t.push(label + ': ' + opts.ticket[k]);
    }
    if (t.length) {
      push('READ FROM THEIR TICKET PHOTO', t.concat([
        'These values were read from a photo of their own ticket. You may repeat them.',
        'Never ask for any of these again. They are already known; asking tells the traveller you were not listening.',
        'You already have the boarding time from this ticket. Do not ask for it, and do not ask which terminal or gate when it is listed above.',
        'Do not add any value that is not listed here.',
        'This person may be flying for the first time and may not know what any of it means. Never answer with bare codes or jargon.',
        'Always translate: say "Dammam" not only "DMM", "Abha" not only "AHB", and explain gate and boarding in plain words the first time you use them.',
        'If they say they do not understand, apologise once, then say the same thing again in simpler words with no codes at all.'
      ]));
    }
  }

  // --- LIVE AIRPORT FEED -------------------------------------------------
  // Read from the airport's own departures endpoint moments ago. This is the
  // only place the model may take a gate number from.
  if (ctx.live && Object.keys(ctx.live).length) {
    const L = ctx.live;
    const lines = [];
    if (L.flight) lines.push('Flight: ' + L.flight);
    if (L.destination) lines.push('Destination: ' + L.destination);
    if (L.gate) lines.push('Gate (live): ' + L.gate);
    if (L.terminal) lines.push('Terminal (live): ' + L.terminal);
    if (L.status) lines.push('Status (live): ' + L.status);
    if (L.delayMinutes) lines.push('Delayed by: ' + L.delayMinutes + ' minutes');
    if (L.remark) lines.push('Airport remark: ' + L.remark);
    if (L.checkinCounters) lines.push('Check-in counters: ' + L.checkinCounters);
    if (L.scheduled) lines.push('Scheduled: ' + L.scheduled);
    if (L.estimated) lines.push('Now expected: ' + L.estimated);
    if (L.stale) lines.push('NOTE: this feed data is a few minutes old.');
    lines.push('Source: ' + (L.source || 'the airport departures feed') + ', checked just now.');
    lines.push('State these as current fact. If a value is missing above, you do NOT have it.');
    push('LIVE FROM THE AIRPORT (checked a moment ago)', lines);
  } else if (ctx.flight) {
    // Only reached when there is no live feed data. It must not tell the model
    // to disown facts it already holds from the ticket — that produced the
    // "I can't see the ticket picture here" reply while the flight number was
    // on screen. Separate "no live screen" from "no ticket".
    const lines = [
      'No live departure-screen data was retrieved for this flight just now. Do not state a live gate, delay or cancellation as current fact.'
    ];
    if (opts.ticket && Object.keys(opts.ticket).length) {
      lines.push('You DO have their ticket details above. Use them. The only thing you lack is the airport\'s live screen — say that, and never claim you cannot see their ticket.');
    } else {
      lines.push('You also have no ticket details for this flight. Ask for the boarding time, or send them to the nearest departure board.');
    }
    push('LIVE STATUS', lines);
  }

  if (opts.status && Object.keys(opts.status).length) {
    const st = opts.status;
    const lines = [];
    if (st.delayMinutes) lines.push('The flight is delayed by about ' + st.delayMinutes + ' minutes.');
    if (st.gate) lines.push('The gate has changed to ' + st.gate + '.');
    if (st.cancelled) lines.push('The flight is showing as cancelled.');
    if (st.message) lines.push(st.message);
    if (lines.length) {
      lines.push('This is the current status. Mention it naturally if it affects what they should do.');
      push('CURRENT FLIGHT STATUS', lines);
    }
  }

  if (opts.tools && opts.tools.length) {
    const lines = opts.tools.map((t) => '- ' + t);
    lines.push('These were already checked for you. Use them; do not contradict them.');
    push('WHAT THE SYSTEM ALREADY DECIDED', lines);
  }

  const text = blocks.join('\n\n');
  return { version, text, segments: used, chars: text.length };
}

const MAX_LOG = 40;

function createLog() {
  const entries = [];
  return {
    add(entry) {
      entries.push(Object.assign({ at: new Date().toISOString() }, entry));
      if (entries.length > MAX_LOG) entries.splice(0, entries.length - MAX_LOG);
    },
    recent(n) {
      return entries.slice(-(n || 10)).reverse();
    },
    clear() {
      entries.length = 0;
    }
  };
}

module.exports = {
  PROMPT_VERSIONS, ACTIVE_VERSION, getVersion, segmentsOf, build, createLog
};
