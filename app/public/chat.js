/* Flight Guide — passenger chat UI. No framework, no build step. */

(function () {
  'use strict';

  var state = {
    lang: localStorage.getItem('fg.lang') || 'en',
    profile: localStorage.getItem('fg.profile') || 'nervous',
    sessionId: sessionStorage.getItem('fg.session') || null,
    profilesEnabled: { nervous: true, adult: true, hurried: true },
    mapVisible: true,
    busy: false,
    trip: {}
  };

  var $ = function (sel) { return document.querySelector(sel); };
  var messagesEl = $('#messages');
  var inputEl = $('#input');
  var formEl = $('#composer');
  var profilesEl = $('#profiles');
  var tripEl = $('#trip');
  var quickEl = $('#quick');

  // ------------------------------------------------------------------ i18n
  var STRINGS = {
    en: {
      tagline: 'First international flight? Walk with me.',
      mapLink: 'Airport map',
      adminLink: 'Control panel',
      profileHeading: 'How should I talk to you?',
      profileHint: 'You can change this at any time.',
      tripHeading: 'Your trip so far',
      simNote: 'Flight status is simulated in this prototype. Always confirm the gate on the departure screens. For anything unexpected, staff at the airport are your fastest route.',
      inputLabel: 'Your message',
      placeholder: 'Type your question — for example: I have 90 minutes and one bag to check in.',
      send: 'Send',
      stage: 'Stage', airport: 'Airport', terminal: 'Terminal', minutes: 'Minutes to boarding', bags: 'Bags', gate: 'Gate',
      bagsChecked: 'Bag to check in', bagsCarryon: 'Carry-on only',
      unset: '—',
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
      mapLink: 'خريطة المطار',
      adminLink: 'لوحة التحكم',
      profileHeading: 'كيف تريدني أن أحدّثك؟',
      profileHint: 'يمكنك تغيير ذلك في أي وقت.',
      tripHeading: 'رحلتك حتى الآن',
      simNote: 'حالة الرحلة محاكاة في هذا النموذج الأولي. تحقّق دائمًا من البوابة على شاشات المغادرة. وأي أمر غير متوقع، أسرع حل هو موظف المطار.',
      inputLabel: 'رسالتك',
      placeholder: 'اكتب سؤالك — مثلًا: بقي معي ٩٠ دقيقة وعندي حقيبة أسجّلها.',
      send: 'إرسال',
      stage: 'المرحلة', airport: 'المطار', terminal: 'الصالة', minutes: 'المتبقي للصعود', bags: 'الحقائب', gate: 'البوابة',
      bagsChecked: 'حقيبة تُسجَّل', bagsCarryon: 'حقيبة يد فقط',
      unset: '—',
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
      btn.className = 'profile' + (state.profile === key ? ' on' : '');
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(state.profile === key));
      btn.disabled = !enabled;
      btn.innerHTML =
        '<span class="radio"></span>' +
        '<span class="body">' +
          '<span class="name">' + esc(copy[key].name) + '</span>' +
          '<span class="tone">' + esc(copy[key].tone) + '</span>' +
        '</span>';
      if (enabled) {
        btn.addEventListener('click', function () {
          state.profile = key;
          localStorage.setItem('fg.profile', key);
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
      return '<dt>' + esc(t(r[0])) + '</dt><dd>' + esc(String(r[1])) + '</dd>';
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

  function addBubble(text, who, opts) {
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'bubble ' + (who === 'user' ? 'user' : 'bot') + (opts.urgent ? ' urgent' : '');
    el.innerHTML = format(text);
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
        sessionStorage.setItem('fg.session', body.sessionId);

        (body.messages || []).forEach(function (m) {
          // Only the very first bubble of an escalated turn carries the red flag.
          addBubble(m.text, 'bot', { urgent: !!body.meta && body.meta.escalated });
        });

        // Auto-follow the reply language, so an Arabic answer renders RTL
        // even if the toggle said English.
        if (body.meta && body.meta.lang && body.meta.lang !== state.lang) {
          state.lang = body.meta.lang;
          localStorage.setItem('fg.lang', state.lang);
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
    inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + 'px';
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
      state.lang = b.getAttribute('data-lang');
      localStorage.setItem('fg.lang', state.lang);
      applyLanguage();
    });
  });

  // ------------------------------------------------------------------ boot
  // Pull the live settings so a disabled profile or a hidden map is respected
  // in the UI immediately, not just on the server.
  fetch('/api/settings')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (s) {
      if (s) {
        state.profilesEnabled = s.profilesEnabled || state.profilesEnabled;
        state.mapVisible = s.mapVisible !== false;
        if (!state.profilesEnabled[state.profile]) {
          state.profile = ['nervous', 'adult', 'hurried'].find(function (p) {
            return state.profilesEnabled[p];
          }) || 'adult';
        }
        var mapLink = document.querySelector('a[href="/map"]');
        if (mapLink && !state.mapVisible) mapLink.style.display = 'none';
      }
    })
    .catch(function () { /* defaults are fine */ })
    .finally(function () {
      applyLanguage();
      addBubble(t('greeting'), 'bot');
      inputEl.focus();
    });
})();
