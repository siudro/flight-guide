/* Flight Guide — control panel logic. Talks only to /api/settings and /api/conversations. */

(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var stagesEl = $('#stages');
  var profilesEl = $('#profiles');
  var airportsEl = $('#airports');
  var escalateEl = $('#escalate');
  var mapEl = $('#mapVisible');
  var saveStateEl = $('#saveState');
  var logEl = $('#log');
  var toastEl = $('#toast');

  var meta = null;
  var settings = null;
  var dirty = false;

  // ------------------------------------------------------------------ utils
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(msg, kind) {
    toastEl.textContent = msg;
    toastEl.className = 'toast show ' + (kind || '');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.className = 'toast'; }, 3200);
  }

  function markDirty() {
    dirty = true;
    saveStateEl.textContent = 'Unsaved changes.';
    saveStateEl.className = 'save-state dirty';
  }

  function markClean(msg) {
    dirty = false;
    saveStateEl.textContent = msg || 'All changes saved.';
    saveStateEl.className = 'save-state saved';
  }

  // ------------------------------------------------------------------ render
  function renderStages() {
    stagesEl.innerHTML = '';

    settings.stages.forEach(function (stage, i) {
      var m = meta.stages.find(function (s) { return s.key === stage.key; }) || { label: { en: stage.key, ar: stage.key } };

      var wrap = document.createElement('div');
      wrap.className = 'stage' + (stage.enabled ? '' : ' disabled');

      wrap.innerHTML =
        '<div class="stage-head">' +
          '<span class="idx">' + (i + 1) + '</span>' +
          '<span class="names">' +
            '<b>' + esc(m.label.en) + '</b>' +
            '<span dir="rtl" style="text-align:left">' + esc(m.label.ar) + '</span>' +
          '</span>' +
          '<label class="switch-row" style="font-size:11.5px!important">' +
            '<input type="checkbox" class="on-toggle"' + (stage.enabled ? ' checked' : '') + '>' +
            '<span>Enabled</span>' +
          '</label>' +
        '</div>' +
        '<div class="stage-body">' +
          '<div class="lang-row">' +
            '<div class="lang-box">' +
              '<label>English <span class="chars en-count"></span></label>' +
              '<textarea class="en" dir="ltr"></textarea>' +
            '</div>' +
            '<div class="lang-box">' +
              '<label>Arabic <span class="chars ar-count"></span></label>' +
              '<textarea class="ar" dir="rtl"></textarea>' +
            '</div>' +
          '</div>' +
        '</div>';

      var en = wrap.querySelector('textarea.en');
      var ar = wrap.querySelector('textarea.ar');
      en.value = stage.guidance.en;
      ar.value = stage.guidance.ar;

      var countEn = wrap.querySelector('.en-count');
      var countAr = wrap.querySelector('.ar-count');
      var updateCounts = function () {
        countEn.textContent = en.value.length + ' chars';
        countAr.textContent = ar.value.length + ' chars';
      };
      updateCounts();

      en.addEventListener('input', function () { stage.guidance.en = en.value; updateCounts(); markDirty(); });
      ar.addEventListener('input', function () { stage.guidance.ar = ar.value; updateCounts(); markDirty(); });

      wrap.querySelector('.on-toggle').addEventListener('change', function (e) {
        stage.enabled = e.target.checked;
        wrap.classList.toggle('disabled', !stage.enabled);
        markDirty();
      });

      // Collapse/expand on the header, but not when the toggle is clicked.
      wrap.querySelector('.stage-head').addEventListener('click', function (e) {
        if (e.target.closest('.switch-row')) return;
        var body = wrap.querySelector('.stage-body');
        body.hidden = !body.hidden;
      });

      stagesEl.appendChild(wrap);
    });
  }

  function renderChecks() {
    profilesEl.innerHTML = '';
    meta.profiles.forEach(function (p) {
      var id = 'p-' + p.key;
      var label = document.createElement('label');
      label.innerHTML =
        '<input type="checkbox" id="' + id + '"' +
        (settings.profilesEnabled[p.key] ? ' checked' : '') + '>' +
        '<span>' + esc(p.label.en) + '</span>';
      label.querySelector('input').addEventListener('change', function (e) {
        settings.profilesEnabled[p.key] = e.target.checked;
        markDirty();
      });
      profilesEl.appendChild(label);
    });

    airportsEl.innerHTML = '';
    Object.keys(meta.airports).forEach(function (key) {
      var a = meta.airports[key];
      var label = document.createElement('label');
      label.innerHTML =
        '<input type="checkbox" data-airport="' + key + '"' +
        (settings.airports.indexOf(key) >= 0 ? ' checked' : '') + '>' +
        '<span>' + esc(a.short.en) + ' · ' + esc(a.code) + '</span>';
      label.querySelector('input').addEventListener('change', function (e) {
        var on = e.target.checked;
        settings.airports = Object.keys(meta.airports).filter(function (k) {
          if (k === key) return on;
          return settings.airports.indexOf(k) >= 0;
        });
        if (!settings.airports.length) {
          e.target.checked = true;
          settings.airports = [key];
          toast('At least one airport must stay enabled.', 'bad');
          return;
        }
        markDirty();
      });
      airportsEl.appendChild(label);
    });
  }

  function renderLog(data) {
    $('#logMeta').textContent = data.total
      ? data.total + ' turn' + (data.total === 1 ? '' : 's') + ' logged (showing latest ' + data.conversations.length + ')'
      : 'Nothing logged yet.';

    if (!data.conversations.length) {
      logEl.innerHTML = '<p class="empty">No conversations yet. Open the chat and send a message.</p>';
      return;
    }

    logEl.innerHTML = data.conversations.map(function (c) {
      var when = new Date(c.at);
      var time = isNaN(when) ? c.at : when.toLocaleString();
      return '<div class="turn">' +
        '<div class="meta">' +
          '<span>' + esc(time) + '</span>' +
          '<span class="chip">' + esc(c.lang || '?') + '</span>' +
          '<span class="chip">' + esc(c.profile || '?') + '</span>' +
          '<span class="chip">' + esc(c.stage || '?') + '</span>' +
          (c.airport ? '<span class="chip ok">' + esc(c.airport) + '</span>' : '') +
          (c.escalated ? '<span class="chip warn">ESCALATED</span>' : '') +
        '</div>' +
        '<div class="q">' + esc(c.user || '') + '</div>' +
        '<div class="a">' + esc(c.assistant || '') + '</div>' +
      '</div>';
    }).join('');
  }

  function renderAll() {
    escalateEl.value = settings.escalateMinutes;
    mapEl.checked = !!settings.mapVisible;
    renderStages();
    renderChecks();
  }

  // ------------------------------------------------------------------ load
  function load() {
    saveStateEl.textContent = 'Loading…';
    Promise.all([
      fetch('/api/meta').then(function (r) { return r.json(); }),
      fetch('/api/settings').then(function (r) { return r.json(); })
    ]).then(function (res) {
      meta = res[0];
      settings = res[1];
      renderAll();
      markClean('Loaded settings from the server.');
    }).catch(function (err) {
      saveStateEl.textContent = 'Could not load settings: ' + err.message;
      saveStateEl.className = 'save-state err';
    });
  }

  function loadLog() {
    fetch('/api/conversations')
      .then(function (r) { return r.json(); })
      .then(renderLog)
      .catch(function (err) {
        logEl.innerHTML = '<p class="empty">Could not load the log: ' + esc(err.message) + '</p>';
      });
  }

  // ------------------------------------------------------------------ save
  function collect() {
    return {
      stages: settings.stages.reduce(function (acc, s) {
        acc[s.key] = {
          guidance_en: s.guidance.en,
          guidance_ar: s.guidance.ar,
          enabled: s.enabled
        };
        return acc;
      }, {}),
      profilesEnabled: settings.profilesEnabled,
      escalateMinutes: Number(escalateEl.value),
      mapVisible: mapEl.checked,
      airports: settings.airports
    };
  }

  $('#save').addEventListener('click', function () {
    var btn = $('#save');
    btn.disabled = true;
    saveStateEl.textContent = 'Saving…';
    saveStateEl.className = 'save-state';

    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collect())
    })
      .then(function (r) {
        return r.json().then(function (b) {
          if (!r.ok) throw new Error(b.error || 'HTTP ' + r.status);
          return b;
        });
      })
      .then(function (saved) {
        settings = saved;
        renderAll();
        markClean('Saved. These settings persist across restarts.');
        toast('Saved — changes are live in the chat.', 'good');
      })
      .catch(function (err) {
        saveStateEl.textContent = 'Save failed: ' + err.message;
        saveStateEl.className = 'save-state err';
        toast('Save failed: ' + err.message, 'bad');
      })
      .finally(function () { btn.disabled = false; });
  });

  escalateEl.addEventListener('input', markDirty);
  mapEl.addEventListener('change', markDirty);

  $('#resetStages').addEventListener('click', function () {
    if (!confirm('Restore the shipped guidance text for all stages? Behaviour settings are kept.')) return;
    fetch('/api/settings/reset', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (fresh) {
        // Keep current behaviour settings but take fresh stage text.
        settings.stages = fresh.stages;
        renderStages();
        markDirty();
        toast('Stage text restored to defaults. Press Save to apply.', 'good');
      })
      .catch(function (err) { toast('Reset failed: ' + err.message, 'bad'); });
  });

  $('#resetAll').addEventListener('click', function () {
    if (!confirm('Reset everything to shipped defaults? All edited guidance, profiles and threshold are lost.')) return;
    fetch('/api/settings/reset', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (fresh) {
        settings = fresh;
        renderAll();
        markClean('Everything reset to defaults.');
        toast('All settings reset.', 'good');
      })
      .catch(function (err) { toast('Reset failed: ' + err.message, 'bad'); });
  });

  $('#refreshLog').addEventListener('click', loadLog);
  $('#clearLog').addEventListener('click', function () {
    if (!confirm('Delete the conversation log? This cannot be undone.')) return;
    fetch('/api/conversations', { method: 'DELETE' })
      .then(function () { loadLog(); toast('Log cleared.', 'good'); })
      .catch(function (err) { toast('Could not clear: ' + err.message, 'bad'); });
  });

  window.addEventListener('beforeunload', function (e) {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  load();
  loadLog();
  setInterval(loadLog, 15000);
})();
