'use strict';
/**
 * Static demo shim — lets the real UI run on GitHub Pages.
 *
 * GitHub Pages serves static files only, so /api/chat and /api/ticket cannot
 * exist there. This intercepts those endpoints in the browser and answers from
 * a small deterministic engine plus a Dammam feed snapshot taken at build time.
 * The goal is to let someone click through the real interface on a public URL.
 */
(function () {
  var DEMO = { builtAt: '2026-11-22', flights: [{"flight":"8031","airline":"SAUDI ARABIAN AIRLINES","destination":"TABUK","terminal":"INT/DOM Terminal","gate":"DACO1","status":"LANDED","remark":"LANDED","scheduled":"2026-11-22T04:50:00","estimated":"2026-11-22T05:35:00","delayMinutes":45},{"flight":"8023","airline":"SAUDI ARABIAN AIRLINES","destination":"MADINAH","terminal":"INT/DOM Terminal","gate":"G115","status":"DEPARTED","remark":"DEPARTED","scheduled":"2026-11-22T04:40:00","estimated":"2026-11-22T05:40:00","delayMinutes":60},{"flight":"318","airline":"NAS AIR","destination":"LAHORE","terminal":"INT/DOM Terminal","gate":"G21A","status":"CAROUSEL OPEN","remark":"BAGGAGE CLAIM","scheduled":"2026-11-22T06:35:00","estimated":"2026-11-22T05:58:00"},{"flight":"837","airline":"NAS AIR","destination":"ADDIS ABABA","terminal":"INT/DOM Terminal","gate":"G25","checkinCounters":"E12, E14","status":"DELAYED","remark":"GATE CLOSED","scheduled":"2026-11-21T22:10:00","estimated":"2026-11-22T06:00:00","delayMinutes":470},{"flight":"744","airline":"ROYAL JORDANIAN AIRLINES","destination":"AMMAN","terminal":"INT/DOM Terminal","gate":"G21A","status":"CAROUSEL OPEN","remark":"LANDED","scheduled":"2026-11-22T06:00:00","estimated":"2026-11-22T06:00:00"},{"flight":"161","airline":"AIR ARABIA","destination":"SHARJAH","terminal":"INT/DOM Terminal","gate":"G20","checkinCounters":"D13, D14","status":"COUNTER CLOSED","remark":"DELAY","scheduled":"2026-11-22T04:45:00","estimated":"2026-11-22T06:00:00","delayMinutes":75},{"flight":"747","airline":"AIRSIAL","destination":"ISLAMABAD","terminal":"INT/DOM Terminal","gate":"G23","checkinCounters":"C01, C03","status":"DELAYED","remark":"DELAY","scheduled":"2026-11-22T05:40:00","estimated":"2026-11-22T06:00:00","delayMinutes":20},{"flight":"1105","airline":"SAUDI ARABIAN AIRLINES","destination":"JEDDAH","terminal":"INT/DOM Terminal","gate":"G115","status":"FINAL CALL","remark":"FINAL CALL","scheduled":"2026-11-22T06:00:00","estimated":"2026-11-22T06:00:00"},{"flight":"4801","airline":"MALAYSIA AIRLINES","destination":"JEDDAH","terminal":"INT/DOM Terminal","gate":"G115","status":"FINAL CALL","remark":"FINAL CALL","scheduled":"2026-11-22T06:00:00","estimated":"2026-11-22T06:00:00"},{"flight":"5811","airline":"Kenya Airways","destination":"JEDDAH","terminal":"INT/DOM Terminal","gate":"G115","status":"FINAL CALL","remark":"FINAL CALL","scheduled":"2026-11-22T06:00:00","estimated":"2026-11-22T06:00:00"},{"flight":"151","airline":"NESMA AIRLINES","destination":"CAIRO","terminal":"INT/DOM Terminal","gate":"G21","checkinCounters":"A03, A01","status":"FINAL CALL","remark":"FINAL CALL","scheduled":"2026-11-22T05:20:00","estimated":"2026-11-22T06:10:00","delayMinutes":50},{"flight":"101","airline":"Gulf Air","destination":"BAHRAIN","terminal":"INT/DOM Terminal","gate":"G21A","status":"LANDED","remark":"BAGGAGE CLAIM","scheduled":"2026-11-22T06:35:00","estimated":"2026-11-22T06:14:00"},{"flight":"330","airline":"NAS AIR","destination":"DELHI","terminal":"INT/DOM Terminal","gate":"G21A","status":"LANDED","remark":"LANDED","scheduled":"2026-11-22T06:20:00","estimated":"2026-11-22T06:20:00"},{"flight":"373","airline":"NAS AIR","destination":"CALICUT","terminal":"INT/DOM Terminal","gate":"G25","checkinCounters":"E12, E14","status":"COUNTER CLOSED","remark":"COUNTER CLOSED","scheduled":"2026-11-22T06:20:00","estimated":"2026-11-22T06:20:00"},{"flight":"838","airline":"NAS AIR","destination":"ADDIS ABABA","terminal":"INT/DOM Terminal","gate":"G21A","scheduled":"2026-11-22T06:30:00","estimated":"2026-11-22T06:30:00"},{"flight":"745","airline":"ROYAL JORDANIAN AIRLINES","destination":"AMMAN","terminal":"INT/DOM Terminal","gate":"G21","checkinCounters":"D02, D01","status":"FINAL CALL","remark":"FINAL CALL","scheduled":"2026-11-22T06:55:00","estimated":"2026-11-22T06:55:00"},{"flight":"102","airline":"Gulf Air","destination":"BAHRAIN","terminal":"INT/DOM Terminal","gate":"G27","checkinCounters":"B13, B14","status":"COUNTER CLOSED","remark":"COUNTER CLOSED","scheduled":"2026-11-22T07:10:00","estimated":"2026-11-22T07:10:00"},{"flight":"6446","airline":"SAUDI ARABIAN AIRLINES","destination":"CAIRO","terminal":"INT/DOM Terminal","gate":"G23","checkinCounters":"G05, G07","status":"COUNTER CLOSED","remark":"COUNTER CLOSED","scheduled":"2026-11-22T07:20:00","estimated":"2026-11-22T07:20:00"},{"flight":"911","airline":"FLYADEAL","destination":"CAIRO","terminal":"INT/DOM Terminal","gate":"G23","checkinCounters":"G05, G07","status":"COUNTER CLOSED","remark":"COUNTER CLOSED","scheduled":"2026-11-22T07:20:00","estimated":"2026-11-22T07:20:00"},{"flight":"883","airline":"FLY DUBAI","destination":"DUBAI","terminal":"INT/DOM Terminal","gate":"G21A","scheduled":"2026-11-22T07:35:00","estimated":"2026-11-22T07:35:00"},{"flight":"387","airline":"NAS AIR","destination":"DAMASCUS","terminal":"INT/DOM Terminal","gate":"G20","checkinCounters":"F14, F13","status":"COUNTER OPEN","remark":"CHECK-IN","scheduled":"2026-11-22T07:45:00","estimated":"2026-11-22T07:45:00"},{"flight":"1651","airline":"FLYADEAL","destination":"ISLAMABAD","terminal":"INT/DOM Terminal","gate":"G26","checkinCounters":"G01, G02","status":"COUNTER OPEN","remark":"CHECK-IN","scheduled":"2026-11-22T07:50:00","estimated":"2026-11-22T07:50:00"},{"flight":"888","airline":"SAUDI ARABIAN AIRLINES","destination":"BEIJING","terminal":"INT/DOM Terminal","gate":"G25","checkinCounters":"E03, E01","status":"COUNTER OPEN","remark":"CHECK-IN","scheduled":"2026-11-22T07:55:00","estimated":"2026-11-22T07:55:00"},{"flight":"7450","airline":"ETIHAD AIRWAYS","destination":"ABHA","terminal":"INT/DOM Terminal","gate":"G115","scheduled":"2026-11-22T08:10:00","estimated":"2026-11-22T08:10:00"},{"flight":"709","airline":"NAS AIR","destination":"ABHA","terminal":"INT/DOM Terminal","gate":"G115","scheduled":"2026-11-22T08:10:00","estimated":"2026-11-22T08:10:00"},{"flight":"5850","airline":"Gulf Air","destination":"ABHA","terminal":"INT/DOM Terminal","gate":"G115","scheduled":"2026-11-22T08:10:00","estimated":"2026-11-22T08:10:00"},{"flight":"811","airline":"NAS AIR","destination":"DUBAI","terminal":"INT/DOM Terminal","gate":"G20","checkinCounters":"E12, E14","status":"COUNTER OPEN","remark":"CHECK-IN","scheduled":"2026-11-22T08:25:00","estimated":"2026-11-22T08:25:00"},{"flight":"3722","airline":"SAUDI ARABIAN AIRLINES","destination":"LAHORE","terminal":"INT/DOM Terminal","gate":"G23","checkinCounters":"E04, E03","status":"COUNTER OPEN","remark":"CHECK-IN","scheduled":"2026-11-22T08:30:00","estimated":"2026-11-22T08:30:00"},{"flight":"884","airline":"FLY DUBAI","destination":"DUBAI","terminal":"INT/DOM Terminal","gate":"G27","checkinCounters":"C14, C13","status":"COUNTER OPEN","remark":"CHECK-IN","scheduled":"2026-11-22T08:35:00","estimated":"2026-11-22T08:35:00"},{"flight":"163","airline":"AIR ARABIA","destination":"SHARJAH","terminal":"INT/DOM Terminal","gate":"G21A","scheduled":"2026-11-22T08:45:00","estimated":"2026-11-22T08:45:00"},{"flight":"101","airline":"AirArabia","destination":"MADINAH","terminal":"INT/DOM Terminal","gate":"G116","checkinCounters":"D13, D11","status":"COUNTER OPEN","remark":"CHECK-IN","scheduled":"2026-11-22T09:00:00","estimated":"2026-11-22T09:00:00"},{"flight":"402","airline":"NAS AIR","destination":"JEDDAH","terminal":"INT/DOM Terminal","gate":"DACO1","scheduled":"2026-11-22T09:05:00","estimated":"2026-11-22T09:05:00"},{"flight":"897","airline":"NAS AIR","destination":"LUCKNOW","terminal":"INT/DOM Terminal","gate":"G21A","scheduled":"2026-11-22T09:20:00","estimated":"2026-11-22T09:20:00"},{"flight":"164","airline":"AIR ARABIA","destination":"SHARJAH","terminal":"INT/DOM Terminal","gate":"G25","checkinCounters":"C03, C01","status":"COUNTER OPEN","remark":"CHECK-IN","scheduled":"2026-11-22T09:25:00","estimated":"2026-11-22T09:25:00"},{"flight":"7335","airline":"TURKISH AIRLINES","destination":"JEDDAH","terminal":"INT/DOM Terminal","gate":"G115","scheduled":"2026-11-22T09:30:00","estimated":"2026-11-22T09:30:00"},{"flight":"403","airline":"NAS AIR","destination":"JEDDAH","terminal":"INT/DOM Terminal","gate":"G115","scheduled":"2026-11-22T09:30:00","estimated":"2026-11-22T09:30:00"},{"flight":"319","airline":"NAS AIR","destination":"LUCKNOW","terminal":"INT/DOM Terminal","gate":"G20","checkinCounters":"E09, E11","scheduled":"2026-11-22T09:40:00","estimated":"2026-11-22T09:40:00"},{"flight":"303","airline":"FLYADEAL","destination":"JEDDAH","terminal":"INT/DOM Terminal","gate":"DACO1","scheduled":"2026-11-22T09:50:00","estimated":"2026-11-22T09:50:00"},{"flight":"457","airline":"FLYADEAL","destination":"BISHA","terminal":"INT/DOM Terminal","gate":"G116","scheduled":"2026-11-22T09:55:00","estimated":"2026-11-22T09:55:00"},{"flight":"764","airline":"NAS AIR","destination":"TABUK","terminal":"INT/DOM Terminal","gate":"G116D","scheduled":"2026-11-22T10:00:00","estimated":"2026-11-22T10:00:00"}] };
  var STAGES = ['check-in and bag drop', 'security screening', 'passport control',
                'customs', 'find your gate', 'boarding'];
  function norm(s) { return String(s || '').toLowerCase(); }

  function findFlight(msg) {
    var m = norm(msg).toUpperCase().match(/\b([A-Z]{2}|[A-Z][0-9]|[0-9][A-Z])\s?-?\s?([0-9]{1,4})\b/);
    if (!m) return null;
    var STOP = ['TO','AT','IN','ON','OF','BY','OR','IS','IT','MY','NO','SO','UP','GO'];
    if (STOP.indexOf(m[1]) !== -1) return null;
    return m[1] + m[2];
  }

  function lookup(flight) {
    if (!flight || !DEMO.flights) return null;
    var num = String(flight).replace(/[^0-9]/g, '');
    for (var i = 0; i < DEMO.flights.length; i++) {
      if (String(DEMO.flights[i].flight) === num) return DEMO.flights[i];
    }
    return null;
  }

  function answer(message) {
    var msg = norm(message), flight = findFlight(message), out = [];
    if (flight) {
      var f = lookup(flight);
      if (f) {
        var line = 'That is flight ' + f.flight;
        if (f.destination) line += ' to ' + f.destination;
        line += '.';
        if (f.delayMinutes) line += ' It is running ' + f.delayMinutes + ' minutes late.';
        if (f.gate) line += ' The gate is ' + f.gate + '.';
        if (f.terminal) line += ' Terminal: ' + f.terminal + '.';
        if (f.checkinCounters) line += ' Check-in counters: ' + f.checkinCounters + '.';
        if (f.remark) line += ' The airport says: ' + f.remark + '.';
        out.push(line);
        out.push('Always confirm on the departure screen. Staff have the final word.');
      } else {
        out.push('I do not have ' + flight + ' in the feed snapshot this demo was built with.');
        out.push('Read the gate from the departure screen, or ask a member of staff.');
      }
      return out;
    }
    if (/gate.*chang|changed|new gate/.test(msg)) {
      out.push('If your gate changed, read the new number from the nearest departure screen.');
      out.push('Go straight there without stopping to ask directions. If boarding has started, speak to airline staff now.');
      return out;
    }
    if (/how long|minutes|hour/.test(msg)) {
      out.push('Tell me how many minutes until boarding and I will pace the six steps for you.');
      return out;
    }
    if (/bag|luggage|suitcase/.test(msg)) {
      out.push('Are you checking a bag, or carrying on only? If you are checking one, go to bag drop first.');
      return out;
    }
    // A first-timer opening with nerves deserves warmth, not a contents page.
    if (/first time|first flight|alone|nervous|scared|worried|help/.test(msg)) {
      out.push('You are in the right place, and there is nothing here you are expected to already know.');
      out.push('Start with check-in and bag drop: find the counter for your airline, show your passport and boarding pass, then put your bag on the belt.');
      out.push('Tell me your flight number and I will show you the gate and check-in counters from the feed snapshot.');
      return out;
    }
    out.push('Tell me your flight number and I will show you the gate from the feed snapshot.');
    out.push('Or ask about any step: ' + STAGES.join(', ') + '.');
    return out;
  }

  var realFetch = window.fetch.bind(window);
  function jsonResponse(obj) {
    return Promise.resolve(new Response(JSON.stringify(obj), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    }));
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/chat') !== -1) {
      var body = {};
      try { body = JSON.parse((init && init.body) || '{}'); } catch (_) {}
      var replies = answer(body.message || '');
      var sid = body.sessionId || ('demo-' + Math.random().toString(36).slice(2, 10));
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve(new Response(JSON.stringify({
            sessionId: sid,
            messages: replies.map(function (t) { return { text: t }; }),
            meta: { ai: { used: false, mode: 'demo', reason: 'static-page' }, live: null }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }, 450);
      });
    }
    if (url.indexOf('/api/ticket') !== -1) {
      return jsonResponse({ ok: false, code: 'NOT_CONFIGURED',
        message: 'Ticket reading needs the AI key and a server. This static demo cannot read photos — type the details instead.' });
    }
    if (url.indexOf('/api/settings') !== -1) {
      return jsonResponse({ profilesEnabled: { nervous: true, adult: true, hurried: true },
        mapVisible: false, escalateMinutes: 60 });
    }
    if (url.indexOf('/api/history/') !== -1) {
      return jsonResponse({ ok: false, error: 'static demo has no history' });
    }
    return realFetch(input, init);
  };

  window.addEventListener('DOMContentLoaded', function () {
    var bar = document.createElement('div');
    bar.setAttribute('dir', 'ltr');
    bar.style.cssText = ['position:sticky','top:0','z-index:9999','background:#8a5a11',
      'color:#fff','font:600 13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'padding:10px 16px','text-align:center'].join(';');
    bar.innerHTML = 'DEMO BUILD &middot; The interface is real, the replies are scripted. ' +
      'Live AI and the live airport feed need the server, which GitHub Pages cannot run. ' +
      'Feed snapshot from ' + DEMO.builtAt + '.';
    document.body.insertBefore(bar, document.body.firstChild);
    console.log('[demo] static build — replies scripted, snapshot ' + DEMO.builtAt);
  });
  console.log('[demo] shim loaded; flights in snapshot:', (DEMO.flights || []).length);
})();
