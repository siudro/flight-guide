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
      airportMapLink: 'Official airport map ↗',
      airportMapTitle: 'King Fahd International — the airport\'s own map page',
      adminLink: 'Control panel',
      profileHeading: 'How should I talk to you?',
      profileHint: 'You can change this at any time.',
      tripHeading: 'Your trip so far',
      simNote: 'Live gates and delays come from Dammam airport directly. Riyadh and Jeddah are not connected yet. Always confirm on the departure screen, and staff are your fastest route for anything unexpected.',
      inputLabel: 'Your message',
      placeholder: 'Ask me anything about getting to your gate…',
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
      welcomeHeading: 'Before we start — who is travelling?',
      welcomeHint: 'Pick the one that fits. I will talk to you differently because of it, and you can change it any time.',
      welcomeDone: {
        nervous: 'Got it — I will keep things calm and take you one step at a time. Tap a ticket photo, or just tell me what is happening.',
        adult: 'Got it — I will give you the full detail. Tap a ticket photo, or just tell me what is happening.',
        hurried: 'Got it — I will keep it to the next action only. Tap a ticket photo, or just tell me what is happening.'
      },
      welcomeDoneHint: 'You can change this any time from the panel on the side.',
      greeting: 'Hello. I am Flight Guide, and I will stay with you from the terminal door to your boarding gate.\n\nI will not give you directions until I know four things, because the wrong route is worse than no route. It will take you under a minute.',
      errorNetwork: 'I could not reach the app just now. Check your connection and send again — nothing you typed is lost.',
      errorEmpty: 'Write something first, then send.',
      profiles: {
        nervous: { name: 'Nervous first-timer', tone: 'Reassuring · one step at a time' },
        adult: { name: 'Adult, first international flight', tone: 'Efficient · full detail' },
        hurried: { name: 'Experienced / hurried', tone: 'Direct · next action only' }
      },
      quick: ['I am at Dammam', 'What is this airport like?', 'My gate changed', 'I am running late']
    },
    ar: {
      tagline: 'أول رحلة دولية؟ سأمشي معك خطوة بخطوة.',
      airportMapLink: 'خريطة المطار الرسمية ↗',
      airportMapTitle: 'مطار الملك فهد الدولي — صفحة الخريطة الرسمية للمطار',
      adminLink: 'لوحة التحكم',
      profileHeading: 'كيف تريدني أن أحدّثك؟',
      profileHint: 'يمكنك تغيير ذلك في أي وقت.',
      tripHeading: 'رحلتك حتى الآن',
      simNote: 'البوابة والتأخير في مطار الدمام تُقرأ مباشرة من المطار. الرياض وجدة غير مربوطتين بعد. تحقّق دائمًا من شاشة المغادرة، وموظف المطار هو أسرع حل لأي أمر غير متوقع.',
      inputLabel: 'رسالتك',
      placeholder: 'اسألني أي شيء عن الوصول إلى بوابتك…',
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
      welcomeHeading: 'قبل أن نبدأ — من المسافر؟',
      welcomeHint: 'اختر الأنسب لك. سأحدّثك بطريقة مختلفة بناءً عليه، ويمكنك تغييره في أي وقت.',
      welcomeDone: {
        nervous: 'تمام — سأكون هادئًا وأمشي معك خطوة بخطوة. التقط صورة تذكرتك، أو قل لي ما الذي يحدث.',
        adult: 'تمام — سأعطيك التفاصيل كاملة. التقط صورة تذكرتك، أو قل لي ما الذي يحدث.',
        hurried: 'تمام — سأقول لك الخطوة التالية فقط. التقط صورة تذكرتك، أو قل لي ما الذي يحدث.'
      },
      welcomeDoneHint: 'يمكنك تغيير ذلك في أي وقت من اللوحة الجانبية.',
      greeting: 'مرحبًا. أنا Flight Guide، وسأبقى معك من باب صالة المغادرة إلى بوابة الصعود.\n\nلن أعطيك أي إرشاد قبل أن أعرف أربعة أمور، لأن المسار الخاطئ أسوأ من لا مسار. لن يستغرق الأمر دقيقة.',
      errorNetwork: 'لم أستطع الوصول إلى التطبيق الآن. تحقّق من الاتصال ثم أرسل مرة أخرى، فما كتبته لم يُفقد.',
      errorEmpty: 'اكتب رسالتك أولًا ثم أرسل.',
      profiles: {
        nervous: { name: 'المسافر المبتدئ القلق', tone: 'مطمئن · خطوة واحدة في كل مرة' },
        adult: { name: 'بالغ في أول رحلة دولية', tone: 'فعّال · بكل التفاصيل' },
        hurried: { name: 'خبير / مستعجل', tone: 'مباشر · الإجراء التالي فقط' }
      },
      quick: ['أنا في الدمام', 'كيف هو هذا المطار؟', 'تغيّرت بوابتي', 'أنا متأخر']
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
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
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
    renderQuick();
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
  function addWelcome() {
    var copy = t('profiles');
    var el = document.createElement('div');
    el.className = 'bubble bot welcome';
    el.setAttribute('dir', 'auto');

    var head = document.createElement('div');
    head.className = 'w-head';
    head.textContent = t('welcomeHeading');
    el.appendChild(head);

    var hint = document.createElement('div');
    hint.className = 'w-hint';
    hint.textContent = t('welcomeHint');
    el.appendChild(hint);

    var wrap = document.createElement('div');
    wrap.className = 'w-options';
    ['nervous', 'adult', 'hurried'].forEach(function (key) {
      if (state.profilesEnabled[key] === false) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'w-opt' + (state.profile === key ? ' on' : '');
      b.setAttribute('aria-pressed', String(state.profile === key));
      b.innerHTML = '<span class="w-name"></span><span class="w-sub"></span>';
      b.querySelector('.w-name').textContent = copy[key].name;
      b.querySelector('.w-sub').textContent = copy[key].tone;
      b.addEventListener('click', function () {
        state.profile = key;
        store.local.set('fg.profile', key);
        renderProfiles();
        Array.prototype.forEach.call(wrap.children, function (c) {
          c.classList.toggle('on', c === b);
          c.setAttribute('aria-pressed', String(c === b));
        });
        var done = t('welcomeDone');
        addBubble((done && done[key]) || t('welcomeDone').nervous || '', 'bot');
      });
      wrap.appendChild(b);
    });
    el.appendChild(wrap);
    messagesEl.appendChild(el);
    scrollDown();
    return el;
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

  // ------------------------------------------------------------------ chat
  function send(message) {
    anyTurn = true;
    if (state.busy) return;
    message = String(message || '').trim();
    if (!message) {
      addBubble(t('errorEmpty'), 'bot');
      return;
    }

    state.busy = true;
    formEl.querySelector('.send').disabled = true;

    addBubble(message, 'user');
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
          // Only the very first bubble of an escalated turn carries the red flag.
          addBubble(m.text, 'bot', {
            urgent: !!body.meta && body.meta.escalated,
            definition: isDefinition
          });
        });

        // Auto-follow the reply language, so an Arabic answer renders RTL even
        // if the toggle said English -- unless the traveller pinned a language
        // by hand, in which case their choice must not be overridden.
        if (!state.langLocked && body.meta && body.meta.lang && body.meta.lang !== state.lang) {
          state.lang = body.meta.lang;
          store.local.set('fg.lang', state.lang);
          applyLanguage();
        }

        state.trip = {
          stage: body.meta && body.meta.stageName ? body.meta.stageName
               : (body.session && body.session.stage != null ? 'Step ' + (body.session.stage + 1) : null),
          airport: body.session && body.session.airport ? aix(body.session.airport) : null,
          terminal: body.session && body.session.terminal,
          minutes: body.session ? body.session.minutes : null,
          bags: body.session ? body.session.bags : null,
          gate: body.session ? body.session.gate : null
        };
        renderTrip();
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
        addWelcome();
      }
    });
  });

  // ------------------------------------------------------------------ boot
  // Pull the live settings so a disabled profile is respected in the UI
  // immediately, not just on the server. The map link now points at the
  // airport's own page, so the "hidden map" toggle no longer applies to it.
  fetch('/api/settings')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (s) {
      if (s) {
        state.profilesEnabled = s.profilesEnabled || state.profilesEnabled;
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
      addBubble(t('greeting'), 'bot');
      addWelcome();
      inputEl.focus();
    });
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
