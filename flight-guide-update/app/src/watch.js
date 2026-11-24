'use strict';

/**
 * Flight watch — tell the traveller when their flight changes, before they ask.
 *
 * The chat polls GET /api/watch/:sessionId every couple of minutes while the
 * page is open. Each poll reads the flight from the airport's live board
 * (src/status.js, cached 90 s), compares it with the last snapshot stored on
 * the session, and returns only what changed. The first poll records a
 * baseline and alerts nothing: we only announce changes we watched happen.
 *
 * Only Dammam publishes a live feed, so only Dammam flights can be watched.
 * Everything else answers NOT_SUPPORTED and the chat simply does not poll.
 */

// Delay changes smaller than this are noise on a departure board.
const DELAY_STEP_MIN = Number(process.env.FG_WATCH_DELAY_STEP || 10);

function snapshot(f) {
  return {
    gate: f.gate || null,
    status: f.status || null,
    delayMinutes: f.delayMinutes || 0,
    estimated: f.estimated || null,
    remark: f.remark || null,
    remarkAr: f.remarkAr || null
  };
}

const URGENT_STATUS = /(final|last call|closing|closed|boarding|cancel|divert)/i;

// What each board status means for the traveller, in words they can act on.
// The board's own wording is kept in brackets so it matches the screen.
const STATUS = [
  { re: /cancel/i, ar: 'ملغاة', en: 'cancelled',
    do: { en: 'Do not go to the gate. Go to your airline\'s desk or ask any staff member — they will put you on another flight.',
          ar: 'لا تذهب إلى البوابة. اذهب إلى مكتب شركة الطيران أو اسأل أي موظف — سيحجزون لك رحلة أخرى.' } },
  { re: /divert/i, ar: 'محوّلة', en: 'diverted',
    do: { en: 'Ask airline staff what happens next.', ar: 'اسأل موظفي شركة الطيران عن الخطوة التالية.' } },
  { re: /gate clos|closed/i, ar: 'البوابة مغلقة', en: 'gate closed',
    do: { en: 'Go to the gate or the nearest airline staff member immediately.', ar: 'اذهب إلى البوابة أو أقرب موظف لشركة الطيران فورًا.' } },
  { re: /final|last call/i, ar: 'النداء الأخير', en: 'final call',
    do: { en: 'Go to the gate now. If you are far away, ask any staff member to help you hurry.', ar: 'اذهب إلى البوابة الآن. إن كنت بعيدًا فاطلب من أي موظف أن يساعدك على الإسراع.' } },
  { re: /boarding/i, ar: 'بدأ الصعود', en: 'boarding',
    do: { en: 'If you are not at the gate, go there now.', ar: 'إن لم تكن عند البوابة فاذهب إليها الآن.' } },
  { re: /gate open/i, ar: 'البوابة مفتوحة', en: 'gate open',
    do: { en: 'You can go to the gate now.', ar: 'يمكنك الذهاب إلى البوابة الآن.' } },
  { re: /depart|airborne/i, ar: 'أقلعت', en: 'departed',
    do: { en: 'If you are not on board, go to your airline\'s desk now.', ar: 'إن لم تكن على متن الطائرة فاذهب إلى مكتب شركة الطيران الآن.' } },
  { re: /delay/i, ar: 'متأخرة', en: 'delayed',
    do: { en: 'Stay near the gate and watch for a new time.', ar: 'ابقَ قريبًا من البوابة وانتظر الوقت الجديد.' } },
  { re: /on time|schedul/i, ar: 'في موعدها', en: 'on time', do: null }
];

function statusWords(raw, lang) {
  const hit = STATUS.find((x) => x.re.test(String(raw || '')));
  if (!hit) return { label: raw, action: null };
  const ar = lang === 'ar';
  return {
    label: (ar ? hit.ar : hit.en.charAt(0).toUpperCase() + hit.en.slice(1)) + ' (' + raw + ')',
    action: hit.do ? hit.do[ar ? 'ar' : 'en'] : null
  };
}

/** Changes between two snapshots, most important first. */
function diff(prev, cur) {
  if (!prev) return [];
  const out = [];
  if (cur.gate && prev.gate !== cur.gate) {
    out.push({ kind: 'gate', from: prev.gate, to: cur.gate, urgent: true });
  }
  const st = (x) => String(x || '').trim().toUpperCase();
  if (cur.status && st(prev.status) !== st(cur.status)) {
    out.push({ kind: 'status', from: prev.status, to: cur.status, urgent: URGENT_STATUS.test(cur.status) });
  }
  if (Math.abs((cur.delayMinutes || 0) - (prev.delayMinutes || 0)) >= DELAY_STEP_MIN) {
    out.push({ kind: 'delay', from: prev.delayMinutes || 0, to: cur.delayMinutes || 0, estimated: cur.estimated, urgent: false });
  }
  if (cur.remark && prev.remark !== cur.remark && !out.some((c) => c.kind === 'status')) {
    out.push({ kind: 'remark', to: cur.remark, toAr: cur.remarkAr, urgent: URGENT_STATUS.test(cur.remark) });
  }
  return out;
}

function clock(iso) {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return null;
  // The board is Saudi local time; the server may run in UTC.
  return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' });
}

/** The words the traveller sees and hears. Fixed text, never the model. */
function message(changes, flightNo, lang) {
  const ar = lang === 'ar';
  const lines = [];
  for (const c of changes) {
    if (c.kind === 'gate') {
      lines.push(ar
        ? `**تغيّرت بوابتك:** من ${c.from || '—'} إلى **${c.to}**. اذهب إلى البوابة ${c.to} الآن، وتحقّق منها على أقرب شاشة مغادرة.`
        : `**Your gate has changed:** from ${c.from || '—'} to **${c.to}**. Go to gate ${c.to} now, and check it on the nearest departure screen.`);
    } else if (c.kind === 'status') {
      const w = statusWords(c.to, lang);
      lines.push((ar ? `**حالة رحلتك الآن:** ${w.label}.` : `**Your flight now shows:** ${w.label}.`) +
        (w.action ? ' ' + w.action : ''));
    } else if (c.kind === 'delay') {
      const at = clock(c.estimated);
      if (c.to > c.from) {
        lines.push(ar
          ? `**تأخّرت رحلتك** حوالي ${c.to} دقيقة${at ? '، والإقلاع المتوقع الآن ' + at : ''}. ابقَ قريبًا من البوابة — قد يتغيّر الوقت مرة أخرى.`
          : `**Your flight is delayed** by about ${c.to} minutes${at ? ', now expected at ' + at : ''}. Stay near the gate — the time can change again.`);
      } else {
        lines.push(ar
          ? `**تقدّم وقت رحلتك**${at ? ' إلى ' + at : ''}. التأخير الآن ${c.to} دقيقة. لا تبتعد عن البوابة.`
          : `**Your flight's time has moved earlier**${at ? ' to ' + at : ''}. The delay is now ${c.to} minutes. Do not wander from the gate.`);
      }
    } else if (c.kind === 'remark') {
      lines.push(ar ? `**ملاحظة من المطار:** ${c.toAr || c.to}` : `**Airport notice:** ${c.to}`);
    }
  }
  if (!lines.length) return null;
  const head = ar ? `تحديث لرحلة ${flightNo} من شاشة المغادرة في المطار:` : `Update for flight ${flightNo} from the airport's departure board:`;
  return head + '\n\n' + lines.join('\n\n');
}

/** Said once, when watching starts. Stored in the transcript so a reload keeps it. */
function introText(flightNo, gate, lang) {
  return lang === 'ar'
    ? `أراقب الآن رحلتك ${flightNo} على شاشة المغادرة في مطار الدمام. إذا تغيّرت البوابة أو الوقت أو الحالة، سأخبرك هنا فورًا — أبقِ هذه الصفحة مفتوحة.` + (gate ? ` البوابة الآن ${gate}.` : '')
    : `I am now watching flight ${flightNo} on the Dammam departure board. If the gate, the time or the status changes, I will tell you here straight away — keep this page open.` + (gate ? ` Right now it shows gate ${gate}.` : '');
}

/**
 * One poll. Mutates `session` (snapshot, gate) and returns the response body.
 * @param {{ session: object, lang: string, findFlight: Function }} opts
 */
async function poll(opts) {
  const session = opts.session || {};
  const lang = opts.lang === 'ar' ? 'ar' : 'en';
  const flightNo = session.flight;
  const airport = session.airport || 'dmm';
  if (!flightNo) return { ok: false, code: 'NO_FLIGHT' };
  // Another airport's flight could share a number with a Dammam one.
  if (session.otherAirport) return { ok: false, code: 'NOT_SUPPORTED' };
  if (airport !== 'dmm') return { ok: false, code: 'NOT_SUPPORTED' };

  const live = await opts.findFlight(airport, flightNo);
  if (!live || !live.ok || !live.flight) {
    return { ok: false, code: (live && live.code) || 'NO_DATA' };
  }
  const cur = snapshot(live.flight);
  const prev = session.watch && session.watch.snapshot ? session.watch.snapshot : null;
  // The traveller may already know the gate from the chat; a "change" to the
  // gate they were told is not news.
  const base = prev || null;
  const changes = diff(base, cur);

  session.watch = { snapshot: cur, at: new Date().toISOString(), flight: flightNo };
  if (cur.gate) {
    if (session.gate && session.gate !== cur.gate) session.gateChanged = true;
    session.gate = cur.gate;
  }

  const text = changes.length ? message(changes, flightNo, lang) : null;
  return {
    ok: true,
    baseline: !prev,
    intro: !prev ? introText(flightNo, cur.gate, lang) : null,
    flight: Object.assign({ number: flightNo }, cur, { stale: !!live.stale }),
    changes,
    urgent: changes.some((c) => c.urgent),
    text
  };
}

module.exports = { poll, diff, snapshot, message, statusWords, introText, URGENT_STATUS };
