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
  var DEMO = { builtAt: '__BUILT_AT__', flights: __FLIGHTS__ };
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
