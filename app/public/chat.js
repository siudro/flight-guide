/* Flight Guide — passenger chat UI. No framework, no build step. */

(function () {
  'use strict';

  // Safari Private Browsing and some hardened mobile browsers THROW on any
  // access to localStorage/sessionStorage rather than returning null. Reading
  // them unguarded at the top of the IIFE killed the whole script before a
  // single listener was bound: the page rendered, looked complete, and was
  // completely dead to touch. That is unrecoverable from the user's side, so
  // every access now goes through these safe wrappers.
  var store = (function () {
    function make(kind) {
      var backing = null;
      try { backing = window[kind]; } catch (_) { backing = null; }
      return {
        get: function (k) {
          try { return backing ? backing.getItem(k) : null; } catch (_) { return null; }
        },
        set: function (k, v) {
          try { if (backing) backing.setItem(k, v); } catch (_) { /* quota / private mode */ }
        }
      };
    }
    return { local: make('localStorage'), session: make('sessionStorage') };
  })();
  // Shared with the walking-mode IIFE below, which runs in its own scope.
  window.FGStore = store;

  var state = {
    lang: store.local.get('fg.lang') || 'en',
    profile: store.local.get('fg.profile') || 'nervous',
    profileChosen: store.local.get('fg.profileChosen') === '1',
    sessionId: store.session.get('fg.session') || null,
    // True once the traveller presses EN/ع. From then on their choice wins
    // over script detection, so an Arabic keyboard cannot flip the app.
    langLocked: store.local.get('fg.langLocked') === '1',
    profilesEnabled: { nervous: true, adult: true, hurried: true },
    mapVisible: true,
    busy: false,
    trip: {}
  };

  var $ = function (sel) { return document.querySelector(sel); };
  var messagesEl = $('#messages');
  // false until the passenger sends their first message.
  var anyTurn = false;
  var inputEl = $('#input');
  var formEl = $('#composer');
  var profilesEl = $('#profiles');
  var tripEl = $('#trip');
  var quickEl = $('#quick');

  // ------------------------------------------------------------------ i18n
  var STRINGS = {
    en: {
      tagline: 'First international flight? Walk with me.',
      optionsLabel: 'Options',
      badgeGate: 'Gate',
      badgeMinutes: '{n} min to boarding',
      badgeFinalCall: 'Final call',
      badgeCancelled: 'Flight cancelled',
      airportMapLink: 'Official airport map ↗',
      airportMapTitle: 'King Fahd International — the airport\'s own map page',
      adminLink: 'Control panel',
      profileHeading: 'How should I talk to you?',
      profileHint: 'You can change this at any time.',
      tripHeading: 'Your trip so far',
      simNote: 'Live gates and delays come from Dammam airport directly. Riyadh and Jeddah are not connected yet. Always confirm on the departure screen, and staff are your fastest route for anything unexpected.',
      inputLabel: 'Your message',
      placeholder: 'Ask me anything about getting to your gate…',
      placeholderShort: 'Ask me anything…',
      send: 'Send',
      photo: 'Photo of your ticket',
      photoTitle: 'Take a photo of your ticket and I will read it.',
      photoCap: 'Your ticket',
      photoReading: 'Reading your ticket… a few seconds.',
      photoFailed: 'I could not read that photo. You can type the details instead.',
      photoNoModel: 'Ticket reading needs the AI key. For now, please type the details.',
      ticketUse: 'Use these details',
      ticketAgain: 'Try another photo',
      ticketHeading: 'From your ticket',
      stage: 'Stage', airport: 'Airport', terminal: 'Terminal', minutes: 'Minutes to boarding', bags: 'Bags', gate: 'Gate',
      bagsChecked: 'Bag to check in', bagsCarryon: 'Carry-on only',
      unset: '—',
      ticketFirst: 'Do you have your ticket? A photo is fastest - I can read the gate, terminal and time from it in a few seconds.',
      ticketSkip: 'Skip - I will type it',
      driveMode: 'Walking mode',
      driveHint: 'Bigger text, one instruction at a time, screen kept awake.',
      stepWord: 'Step',
      wsHeading: 'Who is travelling?',
      wsSub: 'I will talk to you differently depending on what you pick. You can change it later.',
      wsFoot: 'Flight Guide walks you from the airport door to your boarding gate.',
      wsPick: 'Continue',
      welcomeHint: 'Pick the one that fits. I will talk to you differently because of it, and you can change it any time.',
      greeting: 'Hello. I am Flight Guide, and I will stay with you from the terminal door to your boarding gate.\n\nI will not give you directions until I know four things, because the wrong route is worse than no route. It will take you under a minute.',
      errorNetwork: 'I could not reach the app just now. Check your connection and send again — nothing you typed is lost.',
      errorEmpty: 'Write something first, then send.',
      profiles: {
        nervous: { name: 'Nervous first-timer', tone: 'Reassuring · one step at a time' },
        adult: { name: 'Adult, first international flight', tone: 'Efficient · full detail' },
        hurried: { name: 'Experienced / hurried', tone: 'Direct · next action only' }
      },
      quick: ['I am at Dammam', 'Where is my gate?', 'My gate changed', 'I am running late'],
      mapGate: 'Gate', mapYourGate: 'Your gate', mapOfficial: 'Airport\'s own map ↗',
      mapDepartures: 'Live departures ↗', mapFull: 'Full map ↗', mapAirport: 'Airport',
      mapUnavailable: 'The map could not load. The links below still work.',
      micLabel: 'Voice message', micTitle: 'Tap, speak, then tap again to send',
      micListening: 'Listening… tap the microphone again to send.',
      micReading: 'Turning your voice into text…',
      micDenied: 'I need permission to use the microphone. Allow it in your browser, or type instead.',
      micUnsupported: 'This browser cannot record voice. Please type instead.',
      micShort: 'That was too short to hear. Tap the microphone, speak, then tap it again.',
      micNoSpeech: 'I could not hear any words. Try again, a little closer to the phone.',
      micOff: 'Voice messages are not switched on here. Please type instead.',
      micFailed: 'I could not turn that into text. Please try again or type it.',
      speakLabel: 'Read aloud',
      wTitle: 'Weather check', wDeparture: 'Departure', wArrival: 'Arrival',
      wLevel: ['Nothing that usually slows flights', 'Worth watching', 'May cause delays'],
      wSource: 'Forecast from Open-Meteo. Only the departure board says if a flight is delayed.',
      watchIntro: 'I am now watching flight {f} on the Dammam departure board. If the gate, the time or the status changes, I will tell you here straight away — keep this page open.',
      watchIntroGate: ' Right now it shows gate {g}.',
      watchNotify: 'Also alert me with a phone notification',
      watchNotifyOn: 'Phone notifications are on.',
      watchNotifyNo: 'Notifications are blocked in this browser. I will still alert you here.',
      notifTitle: 'Flight {f} changed',
      staffBtn: 'Ask staff', staffShow: 'Show this to staff', staffClose: 'Close'
    },
    ar: {
      tagline: 'أول رحلة دولية؟ سأمشي معك خطوة بخطوة.',
      optionsLabel: 'الخيارات',
      badgeGate: 'البوابة',
      badgeMinutes: 'باقٍ {n} دقيقة',
      badgeFinalCall: 'النداء الأخير',
      badgeCancelled: 'الرحلة ملغاة',
      airportMapLink: 'خريطة المطار الرسمية ↗',
      airportMapTitle: 'مطار الملك فهد الدولي — صفحة الخريطة الرسمية للمطار',
      adminLink: 'لوحة التحكم',
      profileHeading: 'كيف تريدني أن أحدّثك؟',
      profileHint: 'يمكنك تغيير ذلك في أي وقت.',
      tripHeading: 'رحلتك حتى الآن',
      simNote: 'البوابة والتأخير في مطار الدمام تُقرأ مباشرة من المطار. الرياض وجدة غير مربوطتين بعد. تحقّق دائمًا من شاشة المغادرة، وموظف المطار هو أسرع حل لأي أمر غير متوقع.',
      inputLabel: 'رسالتك',
      placeholder: 'اسألني أي شيء عن الوصول إلى بوابتك…',
      placeholderShort: 'اسألني أي شيء…',
      send: 'إرسال',
      photo: 'صورة من تذكرتك',
      photoTitle: 'صوّر تذكرتك وسأقرأها لك.',
      photoCap: 'تذكرتك',
      photoReading: 'أقرأ تذكرتك… لحظات.',
      photoFailed: 'لم أستطع قراءة الصورة. يمكنك كتابة التفاصيل.',
      photoNoModel: 'قراءة التذكرة تحتاج مفتاح الذكاء الاصطناعي. الآن، اكتب التفاصيل.',
      ticketUse: 'استخدم هذه التفاصيل',
      ticketAgain: 'جرّب صورة أخرى',
      ticketHeading: 'من تذكرتك',
      stage: 'المرحلة', airport: 'المطار', terminal: 'الصالة', minutes: 'المتبقي للصعود', bags: 'الحقائب', gate: 'البوابة',
      bagsChecked: 'حقيبة تُسجَّل', bagsCarryon: 'حقيبة يد فقط',
      unset: '—',
      ticketFirstAr: 'عندك تذكرتك؟ الصورة أسرع - أقرأ منها البوابة والصالة والوقت في ثوانٍ.',
      ticketSkipAr: 'تخطَّ - سأكتبها بنفسي',
      driveMode: 'وضع المشي',
      driveHint: 'خط أكبر، تعليمة واحدة في كل مرة، والشاشة تبقى مضاءة.',
      stepWord: 'الخطوة',
      wsHeading: 'من المسافر؟',
      wsSub: 'سأحدّثك بطريقة مختلفة حسب اختيارك. يمكنك تغييره لاحقًا.',
      wsFoot: 'Flight Guide يمشي معك من باب المطار إلى بوابة الصعود.',
      wsPick: 'متابعة',
      welcomeHint: 'اختر الأنسب لك. سأحدّثك بطريقة مختلفة بناءً عليه، ويمكنك تغييره في أي وقت.',
      greeting: 'مرحبًا. أنا Flight Guide، وسأبقى معك من باب صالة المغادرة إلى بوابة الصعود.\n\nلن أعطيك أي إرشاد قبل أن أعرف أربعة أمور، لأن المسار الخاطئ أسوأ من لا مسار. لن يستغرق الأمر دقيقة.',
      errorNetwork: 'لم أستطع الوصول إلى التطبيق الآن. تحقّق من الاتصال ثم أرسل مرة أخرى، فما كتبته لم يُفقد.',
      errorEmpty: 'اكتب رسالتك أولًا ثم أرسل.',
      profiles: {
        nervous: { name: 'المسافر المبتدئ القلق', tone: 'مطمئن · خطوة واحدة في كل مرة' },
        adult: { name: 'بالغ في أول رحلة دولية', tone: 'فعّال · بكل التفاصيل' },
        hurried: { name: 'خبير / مستعجل', tone: 'مباشر · الإجراء التالي فقط' }
      },
      quick: ['أنا في الدمام', 'وين بوابتي؟', 'تغيّرت بوابتي', 'أنا متأخر'],
      mapGate: 'البوابة', mapYourGate: 'بوابتك', mapOfficial: 'خريطة المطار الرسمية ↗',
      mapDepartures: 'المغادرة المباشرة ↗', mapFull: 'الخريطة الكاملة ↗', mapAirport: 'المطار',
      mapUnavailable: 'تعذّر تحميل الخريطة. الروابط أدناه تعمل.',
      micLabel: 'رسالة صوتية', micTitle: 'اضغط، تكلّم، ثم اضغط مرة ثانية للإرسال',
      micListening: 'أسمعك… اضغط الميكروفون مرة ثانية للإرسال.',
      micReading: 'أحوّل صوتك إلى نص…',
      micDenied: 'أحتاج إذنًا لاستخدام الميكروفون. اسمح به في المتصفح، أو اكتب رسالتك.',
      micUnsupported: 'هذا المتصفح لا يسجّل الصوت. اكتب رسالتك من فضلك.',
      micShort: 'التسجيل قصير جدًا. اضغط الميكروفون، تكلّم، ثم اضغطه مرة ثانية.',
      micNoSpeech: 'لم أسمع كلامًا. حاول مرة ثانية وقرّب الجوال منك.',
      micOff: 'الرسائل الصوتية غير مفعّلة هنا. اكتب رسالتك من فضلك.',
      micFailed: 'لم أستطع تحويل الصوت إلى نص. حاول مرة ثانية أو اكتب.',
      speakLabel: 'قراءة بصوت',
      wTitle: 'توقعات الطقس', wDeparture: 'المغادرة', wArrival: 'الوصول',
      wLevel: ['لا شيء يعطّل الطيران عادةً', 'يستحق المتابعة', 'قد يسبب تأخيرًا'],
      wSource: 'التوقعات من Open-Meteo. شاشة المغادرة وحدها تحدد تأخير الرحلة.',
      watchIntro: 'أراقب الآن رحلتك {f} على شاشة المغادرة في مطار الدمام. إذا تغيّرت البوابة أو الوقت أو الحالة، سأخبرك هنا فورًا — أبقِ هذه الصفحة مفتوحة.',
      watchIntroGate: ' البوابة الآن {g}.',
      watchNotify: 'نبّهني أيضًا بإشعار على الجوال',
      watchNotifyOn: 'إشعارات الجوال مفعّلة.',
      watchNotifyNo: 'الإشعارات محظورة في هذا المتصفح. سأنبّهك هنا في المحادثة.',
      notifTitle: 'تغيير في رحلة {f}',
      staffBtn: 'اسأل موظف', staffShow: 'اعرض هذا على الموظف', staffClose: 'إغلاق'
    }
  };

  function t(key) { return (STRINGS[state.lang] || STRINGS.en)[key]; }

  // ------------------------------------------------------------------ render
  function applyLanguage() {
    var html = document.documentElement;
    html.lang = state.lang;
    html.dir = state.lang === 'ar' ? 'rtl' : 'ltr';

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var v = t(el.getAttribute('data-i18n'));
      if (typeof v === 'string') el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      // A phone gives the field roughly 220px, so the full sentence would be
      // cut off. Use the short form there and keep the fuller one on desktop.
      var narrow = window.matchMedia && window.matchMedia('(max-width: 560px)').matches;
      el.placeholder = (narrow && t(key + 'Short')) || t(key);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });

    document.querySelectorAll('.seg-btn').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-lang') === state.lang);
    });

    renderProfiles();
    renderTrip();
    renderBadge();
    renderQuick();
    if (typeof renderWelcomeScreen === 'function') renderWelcomeScreen();
  }

  function renderProfiles() {
    var copy = t('profiles');
    profilesEl.innerHTML = '';
    ['nervous', 'adult', 'hurried'].forEach(function (key) {
      var enabled = state.profilesEnabled[key] !== false;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'profile';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(state.profile === key));
      btn.disabled = !enabled;
      btn.innerHTML =
        '<span class="dot" aria-hidden="true"></span>' +
        '<span class="p-body">' +
          '<span class="p-name">' + esc(copy[key].name) + '</span>' +
          '<span class="p-sub">' + esc(copy[key].tone) + '</span>' +
        '</span>';
      if (enabled) {
        btn.addEventListener('click', function () {
          state.profile = key;
          store.local.set('fg.profile', key);
          renderProfiles();
        });
      }
      profilesEl.appendChild(btn);
    });
  }

  function renderTrip() {
    var rows = [
      ['stage', state.trip.stage || t('unset')],
      ['airport', state.trip.airport || t('unset')],
      ['terminal', state.trip.terminal || t('unset')],
      ['minutes', state.trip.minutes != null ? state.trip.minutes : t('unset')],
      ['bags', state.trip.bags === 'checked' ? t('bagsChecked')
             : state.trip.bags === 'carryon' ? t('bagsCarryon') : t('unset')],
      ['gate', state.trip.gate || t('unset')]
    ];
    tripEl.innerHTML = rows.map(function (r) {
      var unset = String(r[1]) === t('unset');
      var hot = (r[0] === 'gate' && !unset);
      return '<div class="row"><dt>' + esc(t(r[0])) + '</dt>' +
             '<dd class="' + (unset ? 'unset' : (hot ? 'hot' : '')) + '">' +
             esc(String(r[1])) + '</dd></div>';
    }).join('');
  }

  // الشارة — one line of live state at the top of a phone screen.
  // Shows the most urgent true thing: a gate change or final call first, then
  // the countdown, then the gate, then the stage. Nothing invented.
  function renderBadge() {
    var el = document.getElementById('gateBadge');
    var txt = document.getElementById('gateBadgeText');
    if (!el || !txt) return;
    var trip = state.trip || {};
    var parts = [];
    var warn = false;

    if (trip.finalCall) { parts.push(t('badgeFinalCall')); warn = true; }
    else if (trip.cancelled) { parts.push(t('badgeCancelled')); warn = true; }

    if (trip.gate) parts.push(t('badgeGate') + ' ' + trip.gate);
    if (trip.minutes != null) {
      parts.push(t('badgeMinutes').replace('{n}', String(trip.minutes)));
      if (trip.minutes <= 20) warn = true;
    }
    if (!parts.length && trip.stage) parts.push(trip.stage);

    if (!parts.length) { el.hidden = true; el.classList.remove('show', 'warn'); return; }
    txt.textContent = parts.join('  ·  ');
    el.hidden = false;
    el.classList.add('show');
    el.classList.toggle('warn', warn);
  }

  function renderQuick() {
    quickEl.innerHTML = '';
    t('quick').forEach(function (phrase) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = phrase;
      b.addEventListener('click', function () {
        inputEl.value = phrase;
        autosize();
        formEl.requestSubmit();
      });
      quickEl.appendChild(b);
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Renders **bold** and *italic* without letting anything else be HTML. */
  function format(text) {
    return esc(text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\n)\*([^*\n]+)\*/g, '$1<em>$2</em>');
  }

  // ------------------------------------------------------------------ ticket
  // The photo goes to OUR server, which holds the API key. The browser never
  // talks to OpenAI and never sees the key. The model reads the image and
  // returns fields; the traveller confirms before they are used.
  var photoInput = $('#photo-input');
  var photoBtn = $('#photo-btn');
  var ticketBusy = false;

  function shrinkImage(file, maxSide) {
    // Downscale before upload: a 12MP phone photo is ~4MB and slow to send.
    // 1400px on the long side is plenty for a boarding pass.
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type || '')) return reject(new Error('not an image'));
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, (maxSide || 1400) / Math.max(w, h));
        var cw = Math.round(w * scale), ch = Math.round(h * scale);
        var canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        try {
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        } catch (e) { reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image failed to load')); };
      img.src = url;
    });
  }

  function addTicketBubble(dataUrl) {
    var el = document.createElement('div');
    el.className = 'bubble user photo';
    var img = document.createElement('img');
    img.src = dataUrl;
    img.alt = t('photoCap');
    el.appendChild(img);
    messagesEl.appendChild(el);
    scrollDown();
  }

  function addTicketCard(fields) {
    var card = document.createElement('div');
    card.className = 'ticket-card';
    var labels = {
      flight: ['Flight', 'الرحلة'], airline: ['Airline', 'شركة الطيران'],
      terminal: ['Terminal', 'الصالة'], gate: ['Gate', 'البوابة'],
      seat: ['Seat', 'المقعد'], destination: ['Destination', 'الوجهة'],
      boarding: ['Boarding', 'الصعود'], date: ['Date', 'التاريخ'],
      airport: ['Airport', 'المطار']
    };
    var html = '<h4>' + esc(t('ticketHeading')) + '</h4>';
    Object.keys(labels).forEach(function (k) {
      if (!fields[k]) return;
      var pair = labels[k];
      html += '<div class="row"><span>' + esc(state.lang === 'ar' ? pair[1] : pair[0]) +
        '</span><b>' + esc(fields[k]) + '</b></div>';
    });
    html += '<div class="acts"></div>';
    card.innerHTML = html;

    var acts = card.querySelector('.acts');
    var use = document.createElement('button');
    use.type = 'button';
    use.className = 'quick-use';
    use.textContent = t('ticketUse');
    use.style.cssText = 'border:0;background:var(--accent);color:#fff;padding:8px 14px;border-radius:10px;font:inherit;font-weight:650;cursor:pointer';
    use.addEventListener('click', function () {
      card.remove();
      applyTicket(fields);
    });
    var again = document.createElement('button');
    again.type = 'button';
    again.textContent = t('ticketAgain');
    again.style.cssText = 'background:transparent;border:1px solid var(--line);color:var(--ink-dim);padding:8px 14px;border-radius:10px;font:inherit;cursor:pointer';
    again.addEventListener('click', function () {
      card.remove();
      photoInput.value = '';
      photoInput.click();
    });
    acts.appendChild(use);
    acts.appendChild(again);

    messagesEl.appendChild(card);
    scrollDown();
  }

  function applyTicket(f) {
    var parts = [];
    if (f.airport) parts.push(f.airport);
    if (f.terminal) parts.push('terminal ' + f.terminal);
    if (f.flight) parts.push('flight ' + f.flight);
    if (f.airline) parts.push(f.airline);
    if (f.gate) parts.push('gate ' + f.gate);
    // Feed the engine exactly as if the traveller had typed it, so the
    // rule engine still owns the state.
    send('From my ticket: ' + parts.join(', '));
  }

  function handleTicketFile(file) {
    if (!file || ticketBusy) return;
    ticketBusy = true;
    photoBtn.disabled = true;

    shrinkImage(file, 1400)
      .then(function (dataUrl) {
        addTicketBubble(dataUrl);
        showTyping();
        addBubble(t('photoReading'), 'bot');
        return fetch('/api/ticket', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: dataUrl.split(',')[1],
            mime: 'image/jpeg',
            sessionId: state.sessionId
          })
        });
      })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        hideTyping();
        if (body && body.ok) {
          addTicketCard(body.fields || {});
        } else {
          addBubble(body && body.code === 'NOT_CONFIGURED' ? t('photoNoModel') : t('photoFailed'), 'bot');
        }
      })
      .catch(function (err) {
        hideTyping();
        addBubble(t('photoFailed') + '  (' + err.message + ')', 'bot');
      })
      .finally(function () {
        ticketBusy = false;
        photoBtn.disabled = false;
        photoInput.value = '';
      });
  }

  photoBtn.addEventListener('click', function () {
    if (state.busy || ticketBusy) return;
    photoInput.value = '';
    photoInput.click();
  });
  photoInput.addEventListener('change', function () {
    handleTicketFile(photoInput.files && photoInput.files[0]);
  });

  function addBubble(text, who, opts) {
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'bubble ' + (who === 'user' ? 'user' : 'bot')
      + (opts.urgent ? ' urgent' : '')
      + (opts.definition ? ' definition' : '');
    // dir="auto" lets each bubble follow its own script. Without it, switching
    // the UI to Arabic re-renders English history with the punctuation on the
    // wrong side, because every bubble inherits the page direction.
    el.setAttribute('dir', 'auto');
    el.innerHTML = format(text);
    messagesEl.appendChild(el);
    scrollDown();
    return el;
  }

  // The three profiles, offered in the conversation itself.
  //
  // They already exist in the sidebar, but on a phone the sidebar is stacked
  // *below* the chat (order: 2), so a first-time visitor opening the link sees
  // a greeting and no visible way to say who they are. Asking here means the
  // choice is on screen before the first message, on every device.
  // First screen: the only thing on the page until a category is chosen.
  // A picker inside the transcript duplicated the sidebar card right beside
  // it, so opening the link looked unchanged. This is a separate step that
  // hides the chat, so the choice cannot be missed or mistaken for the old one.
  function renderWelcomeScreen() {
    var host = document.getElementById('wsOptions');
    if (!host) return;
    var body = document.body;
    var hasChosen = state.profileChosen === true || state.explicitProfile === true;
    body.classList.toggle('needs-profile', !hasChosen);

    var copy = t('profiles');
    host.innerHTML = '';
    ['nervous', 'adult', 'hurried'].forEach(function (key) {
      if (state.profilesEnabled[key] === false) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ws-opt' + (state.profile === key ? ' on' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(state.profile === key));
      b.innerHTML = '<span class="ws-name"></span><span class="ws-sub"></span><span class="ws-go"></span>';
      b.querySelector('.ws-name').textContent = copy[key].name;
      b.querySelector('.ws-sub').textContent = copy[key].tone;
      b.querySelector('.ws-go').textContent = t('wsPick') + ' →';
      b.addEventListener('click', function () {
        state.profile = key;
        state.profileChosen = true;
        store.local.set('fg.profile', key);
        store.local.set('fg.profileChosen', '1');
        renderProfiles();
        renderWelcomeScreen();
        var last = messagesEl.lastElementChild;
        if (last) last.scrollIntoView({ block: 'nearest' });
        if (inputEl) inputEl.focus();
      });
      host.appendChild(b);
    });
  }

  function scrollDown() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showTyping() {
    var el = document.createElement('div');
    el.className = 'bubble bot';
    el.id = 'typing';
    el.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    messagesEl.appendChild(el);
    scrollDown();
  }

  function hideTyping() {
    var el = document.getElementById('typing');
    if (el) el.remove();
  }

  // ------------------------------------------------------------------ map
  // The server decides when a reply carries a map (src/gatemap.js) and sends
  // a small payload: centre, zoom, pins, a note and the airport's own links.
  // Leaflet is loaded only the first time a map is needed.
  var leafletPromise = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise(function (resolve, reject) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
      var js = document.createElement('script');
      js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      js.onload = function () { window.L ? resolve(window.L) : reject(new Error('leaflet missing')); };
      js.onerror = function () { leafletPromise = null; reject(new Error('leaflet failed to load')); };
      document.head.appendChild(js);
    });
    return leafletPromise;
  }

  function addMapCard(card) {
    if (!card || !card.center) return;
    var el = document.createElement('div');
    el.className = 'map-card' + (card.exact ? ' exact' : '');
    el.setAttribute('dir', state.lang === 'ar' ? 'rtl' : 'ltr');

    var title = card.gate
      ? (card.exact ? t('mapYourGate') : t('mapGate')) + ' ' + card.gate + (card.floor ? ' · ' + card.floor : '')
      : card.airportName;
    var head = document.createElement('div');
    head.className = 'map-head';
    head.innerHTML = '<span class="map-pin" aria-hidden="true"></span><span class="map-title"></span>' +
      '<span class="map-sub"></span>';
    head.querySelector('.map-title').textContent = title;
    head.querySelector('.map-sub').textContent = card.gate ? card.airportName : '';
    el.appendChild(head);

    // Leaflet's controls assume LTR; the canvas stays LTR on an Arabic page.
    var canvas = document.createElement('div');
    canvas.className = 'map-canvas';
    canvas.setAttribute('dir', 'ltr');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', title);
    el.appendChild(canvas);

    if (card.note) {
      var note = document.createElement('p');
      note.className = 'map-note';
      note.setAttribute('dir', 'auto');
      note.textContent = card.note;
      el.appendChild(note);
    }

    var links = document.createElement('div');
    links.className = 'map-links';
    function link(href, label) {
      if (!href) return;
      var a = document.createElement('a');
      a.href = href; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = label;
      links.appendChild(a);
    }
    link(card.officialMap, t('mapOfficial'));
    link(card.departures, t('mapDepartures'));
    if (card.airport === 'ruh') link('/map', t('mapFull'));
    el.appendChild(links);

    messagesEl.appendChild(el);
    scrollDown();

    loadLeaflet().then(function (L) {
      var map = L.map(canvas, { zoomControl: true, attributionControl: true, scrollWheelZoom: false })
        .setView(card.center, card.zoom || 16);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(map);

      var target = null;
      (card.pins || []).forEach(function (p) {
        var label = state.lang === 'ar' && p.labelAr ? p.labelAr : p.label;
        if (p.kind === 'target') {
          target = L.marker([p.lat, p.lon], {
            icon: L.divIcon({ className: 'fg-target', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 13] }),
            zIndexOffset: 1000, title: label
          }).addTo(map);
          target.bindTooltip(card.gate, { permanent: true, direction: 'top', offset: [0, -12], className: 'fg-tip' });
        } else if (p.kind === 'airport') {
          L.circleMarker([p.lat, p.lon], {
            radius: 11, color: '#fff', weight: 2.5, fillColor: '#0f2547', fillOpacity: .9
          }).addTo(map).bindTooltip(label,
            { permanent: true, direction: 'top', offset: [0, -10], className: 'fg-tip' });
        } else {
          L.circleMarker([p.lat, p.lon], {
            radius: 4.5, color: '#fff', weight: 1, fillColor: '#8b96a3', fillOpacity: .85
          }).addTo(map).bindPopup('<b>' + esc(label) + '</b><br>' + esc(p.floor || ''));
        }
      });
      // The card was laid out before Leaflet measured it.
      setTimeout(function () { map.invalidateSize(); if (target) map.setView(card.center, card.zoom); }, 60);
      scrollDown();
    }).catch(function () {
      canvas.classList.add('failed');
      canvas.textContent = t('mapUnavailable');
    });
  }

  // ------------------------------------------------------------ read aloud
  // The phone's own voice (Web Speech API): free, no key, works offline on
  // most phones. On when the traveller presses "Read aloud"; a reply to a
  // voice message is always read, because they may be walking.
  var speech = window.speechSynthesis || null;
  var speakBtn = $('#speakToggle');
  var speakOn = store.local.get('fg.speak') === '1';

  function setSpeak(on) {
    speakOn = on;
    store.local.set('fg.speak', on ? '1' : '0');
    if (speakBtn) speakBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (!on && speech) speech.cancel();
  }

  function unlockSpeech() {
    // iOS only allows speech that a tap started; an empty utterance inside
    // the tap unlocks the replies that arrive later.
    if (!speech) return;
    try { speech.speak(new SpeechSynthesisUtterance('')); } catch (_) {}
  }

  // Names reliably male on the platforms we care about. Chrome/Edge expose
  // "Google US English" and Microsoft "Guy"/"David"/"Mark"; Safari "Alex",
  // "Tom". Phone voice lists are short, so this is a preference order: it
  // degrades to the best available voice instead of failing.
  var MALE_NAMES = /(guy|david|mark|alex|tom|aaron|fred|daniel|james|male|matthew|joey|eric|ryan|christopher|roger|steffan|arthur)/;
  var FEMALE_NAMES = /(samantha|victoria|karen|susan|zira|aria|jenny|michelle|female|allison|ava|serena|fiona|moira|tessa|kathy|nicky|martha|libby|sonia|hazel)/;

  function scoreVoice(v, lang) {
    if (!v || !v.lang) return -1;
    var code = String(v.lang).toLowerCase().replace('_', '-');
    var name = String(v.name || '').toLowerCase();
    var score = 0;

    if (lang === 'ar') {
      if (code.indexOf('ar') !== 0) return -1;
      if (code === 'ar-sa') score += 40;   // the traveller is in Dammam
      if (MALE_NAMES.test(name)) score += 20;
      return score;
    }

    if (code.indexOf('en') !== 0) return -1;
    if (code === 'en-us') score += 50;     // a US voice, as asked
    else if (code === 'en-gb') score += 5;
    if (MALE_NAMES.test(name)) score += 40;
    if (FEMALE_NAMES.test(name)) score -= 40;
    // Prefer higher-quality network/natural voices where a device offers them.
    if (/(natural|neural|online|premium|enhanced)/.test(name)) score += 10;
    return score;
  }

  function pickVoice(lang) {
    if (!speech) return null;
    var voices = speech.getVoices() || [];
    if (!voices.length) return null;
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < voices.length; i++) {
      var sc = scoreVoice(voices[i], lang);
      if (sc > bestScore) { bestScore = sc; best = voices[i]; }
    }
    return bestScore >= 0 ? best : null;
  }

  function speakText(text, lang) {
    if (!speech || !text) return;
    var clean = String(text)
      .replace(/https?:\/\/\S+/g, lang === 'ar' ? 'الرابط' : 'the link')
      .replace(/[*_#`>]/g, '')
      .replace(/\n{2,}/g, '. ')
      .trim();
    if (!clean) return;
    speech.cancel();
    var u = new SpeechSynthesisUtterance(clean);
    u.lang = lang === 'ar' ? 'ar-SA' : 'en-US';
    var v = pickVoice(lang);
    // Assigning a voice the engine does not recognise throws, and the throw
    // used to abort the whole reply handler — the traveller saw
    // "I could not reach the app" although the answer had already arrived.
    // Speech is a convenience; it must never break the conversation.
    if (v) { try { u.voice = v; } catch (_) { /* fall back to u.lang */ } }
    // Just under native speed reads as conversational; 1.0 sounds clipped
    // when announcing short instructions.
    u.rate = lang === 'ar' ? 0.95 : 0.96;
    u.pitch = 1;
    try { speech.speak(u); } catch (_) { /* no voice on this device */ }
  }

  if (speech && speakBtn) {
    speakBtn.hidden = false;
    speakBtn.setAttribute('aria-pressed', speakOn ? 'true' : 'false');
    speakBtn.addEventListener('click', function () {
      unlockSpeech();
      setSpeak(!speakOn);
    });
    // Chrome fills the voice list asynchronously.
    try { speech.getVoices(); } catch (_) {}
  }

  // ------------------------------------------------------------ voice input
  // Records raw audio and encodes a 16 kHz mono WAV in the browser. That
  // format works everywhere and is on Cohere's list; MediaRecorder's webm/mp4
  // are not. One minute is plenty for one question at an airport.
  var micBtn = $('#mic-btn');
  var micTime = micBtn ? micBtn.querySelector('.mic-time') : null;
  var MAX_REC_SECONDS = 60;
  var TARGET_RATE = 16000;
  var rec = null;
  var micBusy = false;

  function micSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
      (window.AudioContext || window.webkitAudioContext));
  }

  function downsample(buffers, inRate) {
    var length = 0;
    buffers.forEach(function (b) { length += b.length; });
    var merged = new Float32Array(length);
    var off = 0;
    buffers.forEach(function (b) { merged.set(b, off); off += b.length; });
    if (inRate === TARGET_RATE) return merged;
    var ratio = inRate / TARGET_RATE;
    var outLen = Math.floor(merged.length / ratio);
    var out = new Float32Array(outLen);
    for (var i = 0; i < outLen; i++) {
      // Average the source samples this output sample covers (cheap low-pass).
      var start = Math.floor(i * ratio), end = Math.min(Math.floor((i + 1) * ratio), merged.length);
      var sum = 0, n = 0;
      for (var j = start; j < end; j++) { sum += merged[j]; n++; }
      out[i] = n ? sum / n : 0;
    }
    return out;
  }

  function encodeWav(samples, rate) {
    var buf = new ArrayBuffer(44 + samples.length * 2);
    var v = new DataView(buf);
    function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (var i = 0, o = 44; i < samples.length; i++, o += 2) {
      var x = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }

  function setMicState(on) {
    if (!micBtn) return;
    micBtn.classList.toggle('rec', on);
    micBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (micTime) micTime.textContent = '';
    inputEl.placeholder = on ? t('micListening') : t('placeholder');
  }

  function startRecording() {
    if (!micSupported()) { addBubble(t('micUnsupported'), 'bot'); return; }
    if (speech) speech.cancel();          // do not record our own voice
    unlockSpeech();
    var Ctx = window.AudioContext || window.webkitAudioContext;
    // Created inside the tap: Safari will not start audio otherwise.
    var ctx = new Ctx();
    rec = { ctx: ctx, chunks: [], stream: null, started: Date.now(), timer: null, proc: null, src: null };
    var mine = rec;
    setMicState(true);
    navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    }).then(function (stream) {
      if (rec !== mine) { stream.getTracks().forEach(function (tr) { tr.stop(); }); return; }
      mine.stream = stream;
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      mine.src = ctx.createMediaStreamSource(stream);
      mine.proc = ctx.createScriptProcessor(4096, 1, 1);
      mine.proc.onaudioprocess = function (e) {
        mine.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      mine.src.connect(mine.proc);
      mine.proc.connect(ctx.destination);   // the output is silence
      mine.started = Date.now();
      mine.timer = setInterval(function () {
        var s = Math.floor((Date.now() - mine.started) / 1000);
        if (micTime) micTime.textContent = '0:' + (s < 10 ? '0' : '') + s;
        if (s >= MAX_REC_SECONDS) stopRecording(true);
      }, 250);
    }).catch(function (err) {
      cleanupRecording(mine);
      rec = null;
      setMicState(false);
      addBubble(err && err.name === 'NotAllowedError' ? t('micDenied') : t('micUnsupported'), 'bot');
    });
  }

  function cleanupRecording(r) {
    if (!r) return;
    if (r.timer) clearInterval(r.timer);
    try { if (r.src) r.src.disconnect(); } catch (_) {}
    try { if (r.proc) r.proc.disconnect(); } catch (_) {}
    if (r.stream) r.stream.getTracks().forEach(function (tr) { tr.stop(); });
    try { r.ctx.close(); } catch (_) {}
  }

  function stopRecording(send_) {
    var r = rec;
    rec = null;
    if (!r) return;
    var rate = r.ctx.sampleRate;
    var seconds = (Date.now() - r.started) / 1000;
    cleanupRecording(r);
    setMicState(false);
    if (!send_) return;
    if (seconds < 0.6 || !r.chunks.length) { addBubble(t('micShort'), 'bot'); return; }

    var wav = encodeWav(downsample(r.chunks, rate), TARGET_RATE);
    micBusy = true;
    micBtn.disabled = true;
    var pending = addBubble(t('micReading'), 'bot');
    pending.classList.add('pending');
    blobToBase64(wav)
      .then(function (b64) {
        return fetch('/api/voice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: b64, mime: 'audio/wav', lang: state.lang })
        });
      })
      .then(function (res) { return res.json(); })
      .then(function (body) {
        pending.remove();
        if (body && body.ok && body.text) {
          send(body.text, { viaVoice: true });
        } else {
          var code = body && body.code;
          addBubble(code === 'NOT_CONFIGURED' ? t('micOff')
            : code === 'NO_SPEECH' ? t('micNoSpeech') : t('micFailed'), 'bot');
        }
      })
      .catch(function () {
        pending.remove();
        addBubble(t('micFailed'), 'bot');
      })
      .finally(function () {
        micBusy = false;
        micBtn.disabled = false;
      });
  }

  if (micBtn) {
    micBtn.addEventListener('click', function () {
      if (micBusy) return;
      if (rec) { stopRecording(true); return; }
      if (state.busy) return;
      startRecording();
    });
  }

  // --------------------------------------------------------------- weather
  // Shown under a reply to a weather or delay question. The words come from
  // the engine; this card only lays the forecast out at a glance.
  function addWeatherCard(w) {
    if (!w || !w.rows || !w.rows.length) return;
    var el = document.createElement('div');
    el.className = 'weather-card lvl-' + w.level;
    el.setAttribute('dir', state.lang === 'ar' ? 'rtl' : 'ltr');
    var levels = t('wLevel');
    var html = '<div class="w-title">' + esc(t('wTitle')) + '</div>';
    w.rows.forEach(function (r) {
      var temp = r.tempMax != null
        ? (r.tempMin !== r.tempMax ? r.tempMin + '–' + r.tempMax : r.tempMax) + '°C' : '';
      html += '<div class="w-row lvl-' + r.level + '">' +
        '<div class="w-place"><span class="w-role">' + esc(r.role === 'destination' ? t('wArrival') : t('wDeparture')) +
        '</span><b>' + esc(r.name) + '</b>' + (temp ? '<span class="w-temp">' + esc(temp) + '</span>' : '') + '</div>' +
        '<div class="w-verdict"><span class="w-chip">' + esc(levels[r.level] || '') + '</span>' +
        (r.reasons && r.reasons.length ? '<span class="w-why">' + esc(r.reasons.join(' · ')) + '</span>' : '') +
        '</div></div>';
    });
    html += '<div class="w-src">' + esc(t('wSource')) + '</div>';
    el.innerHTML = html;
    messagesEl.appendChild(el);
    scrollDown();
  }

  // ------------------------------------------------------------ staff card
  // Fixed text in both languages, never the model: a staff member may read
  // Arabic or English, and the traveller may read neither well.
  function boardClock() {
    if (!state.trip.boardAt) return null;
    var d = new Date(state.trip.boardAt);
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  function openStaffCard() {
    var old = document.getElementById('staffCard');
    if (old) old.remove();
    var tr = state.trip || {};
    var code = tr.airportCode;
    var names = code && AIRPORT_NAMES[code] ? AIRPORT_NAMES[code] : null;
    var at = boardClock();
    var soon = tr.boardAt && tr.boardAt - Date.now() < 45 * 60000;

    var rows = [];
    function row(en, ar, v) { if (v) rows.push('<div class="sc-row"><span class="sc-k">' + esc(en) + ' · <span dir="rtl">' + esc(ar) + '</span></span><span class="sc-v' + (String(v).length > 9 ? ' long' : '') + '" dir="ltr">' + esc(v) + '</span></div>'); }
    row('Flight', 'الرحلة', tr.flight);
    if (!tr.cancelled) row('Gate', 'البوابة', tr.gate || '?');
    row('Boarding', 'الصعود', at);
    row('Terminal', 'الصالة', tr.terminal);
    row('Airport', 'المطار', names ? names.en : null);

    // What to ask depends on what the board last said about the flight.
    var wantAr, wantEn;
    if (tr.cancelled) {
      wantAr = '<b>رحلتي ألغيت.</b> أرجو أن تدلّني على مكتب شركة الطيران لأحجز رحلة أخرى.';
      wantEn = '<b>My flight has been cancelled.</b> Please show me the way to my airline\'s desk so I can get another flight.';
      soon = false;
    } else if (tr.finalCall) {
      wantAr = '<b>رحلتي في النداء الأخير.</b> أرجو مساعدتي للوصول إلى بوابتي بسرعة.';
      wantEn = '<b>My flight is at final call.</b> Please help me get to my gate quickly.';
      soon = false;
    } else {
      wantAr = esc(tr.gate ? 'أرجو مساعدتي للوصول إلى بوابتي.' : 'أرجو مساعدتي لمعرفة بوابتي والوصول إليها.');
      wantEn = esc(tr.gate ? 'Please help me get to my gate.' : 'Please help me find my gate and get there.');
    }

    var el = document.createElement('div');
    el.id = 'staffCard';
    el.className = 'staff-card';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', t('staffShow'));
    el.innerHTML =
      '<div class="sc-inner">' +
        '<p class="sc-ar" dir="rtl" lang="ar">مرحبًا، هذه أول رحلة دولية لي وأنا مسافر وحدي. ' + wantAr +
          (soon ? ' <b>رحلتي سيبدأ صعودها قريبًا.</b>' : '') + '</p>' +
        '<p class="sc-en" dir="ltr" lang="en">Hello — this is my first international flight and I am travelling alone. ' + wantEn +
          (soon ? ' <b>My flight is boarding soon.</b>' : '') + '</p>' +
        '<div class="sc-rows">' + rows.join('') + '</div>' +
        '<p class="sc-thanks"><span dir="rtl">شكرًا لك</span> · <span dir="ltr">Thank you</span></p>' +
        '<button type="button" class="sc-close">' + esc(t('staffClose')) + ' ✕</button>' +
      '</div>';
    document.body.appendChild(el);
    document.body.classList.add('staff-open');
    var close = function () {
      el.remove();
      document.body.classList.remove('staff-open');
      document.removeEventListener('keydown', onKey);
    };
    var onKey = function (e) { if (e.key === 'Escape') close(); };
    el.querySelector('.sc-close').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    el.querySelector('.sc-close').focus();
  }

  function addStaffButton() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'staff-inline';
    b.textContent = t('staffShow') + ' ›';
    b.addEventListener('click', openStaffCard);
    messagesEl.appendChild(b);
    scrollDown();
  }

  var staffBtn = $('#staffBtn');
  if (staffBtn) staffBtn.addEventListener('click', openStaffCard);

  // ----------------------------------------------------------- flight watch
  // Once a Dammam flight number is known, poll the airport's live board
  // through our server and say so the moment the gate, time or status
  // changes — the traveller should not have to ask. Works while this page is
  // open (walking mode keeps the screen awake).
  var WATCH_MS = 120000;
  var watchState = { flight: null, timer: null, last: 0, busy: false };

  function fill(tpl, vals) {
    return String(tpl).replace(/\{(\w)\}/g, function (_, k) { return vals[k] != null ? vals[k] : ''; });
  }

  function stopWatch() {
    if (watchState.timer) clearInterval(watchState.timer);
    watchState.timer = null;
    watchState.flight = null;
  }

  function maybeStartWatch(sess) {
    if (!sess || !sess.flight || !state.sessionId) return;
    if (sess.airport && sess.airport !== 'dmm') { stopWatch(); return; }
    if (watchState.flight === sess.flight && watchState.timer) return;
    stopWatch();
    watchState.flight = sess.flight;
    pollWatch();
    watchState.timer = setInterval(pollWatch, WATCH_MS);
  }

  function swRegistration() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker.register('/sw.js').then(function () {
      return navigator.serviceWorker.ready;
    }).catch(function () { return null; });
  }

  function notify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var opts = { body: body, icon: '/favicon.svg', tag: 'fg-flight', renotify: true, vibrate: [300, 150, 300] };
    swRegistration().then(function (reg) {
      if (reg && reg.showNotification) return reg.showNotification(title, opts);
      try { new Notification(title, opts); } catch (_) { /* Android needs the service worker */ }
    });
  }

  function addWatchIntro(f, serverText) {
    // The server only sends the intro on the very first poll of a flight and
    // keeps it in the transcript, so a reload shows it once, from history.
    var text = serverText || (fill(t('watchIntro'), { f: f.number }) + (f.gate ? fill(t('watchIntroGate'), { g: f.gate }) : ''));
    var bubble = addBubble(text, 'bot');
    if ('Notification' in window && Notification.permission === 'default') {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'bubble-action';
      b.textContent = '🔔 ' + t('watchNotify');
      b.addEventListener('click', function () {
        Notification.requestPermission().then(function (perm) {
          b.remove();
          if (perm === 'granted') { swRegistration(); addBubble(t('watchNotifyOn'), 'bot'); }
          else addBubble(t('watchNotifyNo'), 'bot');
        });
      });
      bubble.appendChild(document.createElement('br'));
      bubble.appendChild(b);
    }
  }

  function noteStatus(st) {
    if (!st) return;
    state.trip.cancelled = /cancel/i.test(st);
    state.trip.finalCall = !state.trip.cancelled && /final|last call|gate clos/i.test(st);
  }

  function alertChange(body) {
    noteStatus(body.flight && body.flight.status);
    addBubble(body.text, 'bot', { urgent: true });
    if (body.map) addMapCard(body.map);
    if (body.urgent || body.changes.some(function (c) { return c.kind === 'gate'; })) addStaffButton();
    if (body.session && body.session.gate) { state.trip.gate = body.session.gate; renderTrip(); }
    try { if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]); } catch (_) {}
    if (speech && speakOn) speakText(body.text, state.lang);
    if (document.hidden) {
      notify(fill(t('notifTitle'), { f: body.flight.number }), body.text.replace(/\*\*/g, '').split('\n\n').slice(1).join(' '));
    }
  }

  function pollWatch() {
    if (!state.sessionId || watchState.busy) return;
    watchState.busy = true;
    watchState.last = Date.now();
    fetch('/api/watch/' + encodeURIComponent(state.sessionId) + '?lang=' + state.lang)
      .then(function (r) { return r.json(); })
      .then(function (body) {
        if (!body || !body.ok) {
          if (body && (body.code === 'NOT_SUPPORTED' || body.code === 'NO_FLIGHT' || body.code === 'NO_SESSION')) stopWatch();
          return;    // NOT_FOUND / feed down: keep trying quietly
        }
        if (body.baseline) addWatchIntro(body.flight, body.intro);
        if (body.text) alertChange(body);
      })
      .catch(function () { /* offline for a moment: next poll */ })
      .finally(function () { watchState.busy = false; });
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && watchState.timer && Date.now() - watchState.last > 45000) pollWatch();
  });

  // ------------------------------------------------------------------ chat
  function send(message, opts) {
    opts = opts || {};
    anyTurn = true;
    if (state.busy) return;
    message = String(message || '').trim();
    if (!message) {
      addBubble(t('errorEmpty'), 'bot');
      return;
    }

    state.busy = true;
    formEl.querySelector('.send').disabled = true;

    var userBubble = addBubble(message, 'user');
    if (opts.viaVoice) userBubble.classList.add('voice');
    inputEl.value = '';
    autosize();
    showTyping();

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message,
        lang: state.lang,
        langLocked: state.langLocked === true,
        profile: state.profile,
        sessionId: state.sessionId
      })
    })
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) throw new Error(body && body.error ? body.error : 'HTTP ' + r.status);
          return body;
        });
      })
      .then(function (body) {
        hideTyping();
        state.sessionId = body.sessionId;
        store.session.set('fg.session', body.sessionId);

        // A turn that answered a "what does X mean" question is styled
        // differently so the traveller can tell an explanation apart from
        // the route they are following.
        var isDefinition = !!body.meta && body.meta.stageKey === 'explain';

        (body.messages || []).forEach(function (m) {
          // Red is kept for the safety warning itself (the server marks it).
          // Painting every reply red while boarding is near made a real alert
          // impossible to tell apart from a weather answer.
          addBubble(m.text, 'bot', {
            urgent: m.urgent === true,
            definition: isDefinition
          });
        });

        // "Where is my gate?" — the server attached a map to this turn.
        if (body.map) addMapCard(body.map);
        if (body.weather) addWeatherCard(body.weather);
        // "Find staff now" replies come with the card to show them.
        if (body.meta && body.meta.escalated && body.meta.escalationAnnounced) addStaffButton();

        if (speech && (speakOn || opts.viaVoice)) {
          var said = (body.messages || []).map(function (m) { return m.text; }).join('\n\n');
          // Never let speech break the turn: the answer is already on screen.
          try { speakText(said, (body.meta && body.meta.lang) || state.lang); } catch (_) {}
        }

        // Auto-follow the reply language, so an Arabic answer renders RTL even
        // if the toggle said English -- unless the traveller pinned a language
        // by hand, in which case their choice must not be overridden.
        if (!state.langLocked && body.meta && body.meta.lang && body.meta.lang !== state.lang) {
          state.lang = body.meta.lang;
          store.local.set('fg.lang', state.lang);
          applyLanguage();
        }

        var prevTrip = state.trip || {};
        state.trip = {
          stage: body.meta && body.meta.stageName ? body.meta.stageName
               : (body.session && body.session.stage != null ? t('stepWord') + ' ' + (body.session.stage + 1) : null),
          airport: body.session && body.session.airport ? aix(body.session.airport) : null,
          terminal: body.session && body.session.terminal,
          minutes: body.session ? body.session.minutes : null,
          bags: body.session ? body.session.bags : null,
          gate: body.session ? body.session.gate : null,
          flight: body.session ? body.session.flight : null,
          airportCode: body.session ? body.session.airport : null,
          boardAt: prevTrip.boardAt || null
        };
        // Boarding as a clock time, fixed when the minutes were first given,
        // so the staff card does not drift as the conversation goes on.
        if (state.trip.minutes != null && state.trip.minutes !== prevTrip.minutes) {
          state.trip.boardAt = Date.now() + state.trip.minutes * 60000;
        }
        state.trip.cancelled = prevTrip.cancelled; state.trip.finalCall = prevTrip.finalCall;
        if (body.meta && body.meta.live) noteStatus(body.meta.live.status);
        renderTrip();
        renderBadge();
        maybeStartWatch(body.session);
      })
      .catch(function (err) {
        hideTyping();
        addBubble(t('errorNetwork') + '  (' + err.message + ')', 'bot');
      })
      .finally(function () {
        state.busy = false;
        formEl.querySelector('.send').disabled = false;
        inputEl.focus();
      });
  }

  var AIRPORT_NAMES = {
    dmm: { en: 'Dammam (DMM)', ar: 'الدمام (DMM)' },
    ruh: { en: 'Riyadh (RUH)', ar: 'الرياض (RUH)' },
    jed: { en: 'Jeddah (JED)', ar: 'جدة (JED)' }
  };
  function aix(code) {
    var a = AIRPORT_NAMES[code];
    return a ? (a[state.lang] || a.en) : code;
  }

  // ------------------------------------------------------------------ input
  function autosize() {
    inputEl.style.height = 'auto';
    var cap = document.body.classList.contains('walking-mode') ? 220 : 150;
    inputEl.style.height = Math.min(inputEl.scrollHeight, cap) + 'px';
  }

  inputEl.addEventListener('input', autosize);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      formEl.requestSubmit();
    }
  });

  formEl.addEventListener('submit', function (e) {
    e.preventDefault();
    send(inputEl.value);
  });

  document.querySelectorAll('.seg-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      var next = b.getAttribute('data-lang');
      if (next === state.lang) return;
      state.lang = next;
      state.langLocked = true;
      store.local.set('fg.lang', state.lang);
      store.local.set('fg.langLocked', '1');
      applyLanguage();
      // The greeting is written once at boot in one language. If the traveller
      // switches before saying anything, rewrite it rather than leaving the
      // conversation in a language they cannot read. Once a real exchange has
      // started we leave history alone — silently translating a transcript the
      // traveller already read is more confusing than helpful.
      if (!anyTurn) {
        if (messagesEl) messagesEl.innerHTML = '';
        addBubble(t('greeting'), 'bot');
      }
    });
  });

  // ------------------------------------------------------------------ options
  // On a phone the top bar can only hold the brand, the language toggle and
  // one more control. Everything secondary lives behind Options.
  (function initOptions() {
    var btn = document.getElementById('optionsBtn');
    var menu = document.getElementById('optionsMenu');
    if (!btn || !menu) return;
    function close() {
      menu.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = !menu.classList.contains('open');
      menu.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    });
    // Tapping anywhere else, or choosing something, closes it.
    document.addEventListener('click', function (e) {
      if (!menu.contains(e.target) && e.target !== btn) close();
    });
    menu.addEventListener('click', function (e) {
      if (e.target.closest('button, a')) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  })();

  // ------------------------------------------------------------------ boot
  // Pull the live settings so a disabled profile is respected in the UI
  // immediately, not just on the server. The map link now points at the
  // airport's own page, so the "hidden map" toggle no longer applies to it.
  fetch('/api/settings')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (s) {
      if (s) {
        state.profilesEnabled = s.profilesEnabled || state.profilesEnabled;
        // The microphone appears only when this server can transcribe.
        if (micBtn && s.voice && s.voice.enabled && micSupported()) micBtn.hidden = false;
        if (!state.profilesEnabled[state.profile]) {
          state.profile = ['nervous', 'adult', 'hurried'].find(function (p) {
            return state.profilesEnabled[p];
          }) || 'adult';
        }
      }
    })
    .catch(function () { /* defaults are fine */ })
    .finally(function () {
      applyLanguage();
      renderWelcomeScreen();
      restoreConversation().then(function (restored) {
        if (!restored) addBubble(t('greeting'), 'bot');
        inputEl.focus();
      });
    });

  // A phone reloads background tabs without asking, and a traveller may
  // refresh by accident. The server keeps the conversation, so bring it back:
  // the transcript, the trip card and the flight watch. Without this the
  // alerts silently stopped until the traveller typed again.
  function restoreConversation() {
    if (!state.sessionId) return Promise.resolve(false);
    return fetch('/api/history/' + encodeURIComponent(state.sessionId))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (h) {
        if (!h || !h.ok || !h.history || !h.history.length) return false;
        anyTurn = true;
        h.history.forEach(function (m) {
          if (!m || !m.content) return;
          addBubble(m.content, m.role === 'user' ? 'user' : 'bot', { urgent: m.alert === true });
        });
        state.trip = {
          stage: h.stage != null ? t('stepWord') + ' ' + (h.stage + 1) : null,
          airport: h.airport ? aix(h.airport) : null,
          airportCode: h.airport || null,
          terminal: h.terminal, minutes: h.minutes, bags: h.bags, gate: h.gate,
          flight: h.flight,
          cancelled: /cancel/i.test(h.flightStatus || ''),
          finalCall: /final|last call|gate clos/i.test(h.flightStatus || '')
        };
        renderTrip();
        if (!h.otherAirport) maybeStartWatch({ flight: h.flight, airport: h.airport });
        return true;
      })
      .catch(function () { return false; });
  }
})();


/* ---------------------------------------------------------------------------
   Walking mode
   A traveller may be reading this while walking through a terminal. The mode
   raises type size, keeps the screen awake, and shows one instruction at a
   time. The preference is remembered.
   --------------------------------------------------------------------------- */
(function initWalkingMode() {
  var btn = document.getElementById('walkingToggle');
  if (!btn) return;

  // Defined in the main IIFE above; may be absent if that script body failed.
  var store = window.FGStore || { local: { get: function () { return null; }, set: function () {} } };

  var wakeLock = null;

  function setOn(on) {
    document.body.classList.toggle('walking-mode', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    store.local.set('fg.walking', on ? '1' : '0');
    if (on) {
      requestWake();
      console.log('[ui] walking mode on — larger type, screen kept awake');
    } else {
      releaseWake();
      console.log('[ui] walking mode off');
    }
  }

  function requestWake() {
    // Screen Wake Lock keeps the phone from dimming mid-instruction. Not all
    // browsers support it, and it requires a visible page, so failure is fine.
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      console.log('[ui] wake lock acquired');
      lock.addEventListener('release', function () {
        console.log('[ui] wake lock released');
      });
    }).catch(function (err) {
      console.log('[ui] wake lock unavailable: ' + err.message);
    });
  }

  function releaseWake() {
    if (wakeLock) { try { wakeLock.release(); } catch (_) {} wakeLock = null; }
  }

  btn.addEventListener('click', function () {
    setOn(!document.body.classList.contains('walking-mode'));
  });

  var saved = false;
  saved = store.local.get('fg.walking') === '1';
  if (saved) setOn(true);
})();
