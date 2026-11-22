// Simulates Safari Private Browsing: localStorage/sessionStorage THROW on any
// access. Before the fix chat.js died at line 7 and bound zero listeners.
// This harness asserts the script completes and wires up its controls.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/chat.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

// --- ids/classes that exist in the real markup -----------------------------
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

const listeners = [];
function el(id, extra) {
  const e = Object.assign({
    id,
    style: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    innerHTML: '',
    textContent: '',
    value: '',
    files: [],
    disabled: false,
    placeholder: '',
    dataset: {},
    addEventListener(evt) { listeners.push(id + ':' + evt); },
    setAttribute() {},
    getAttribute: () => null,
    appendChild() {},
    focus() {},
    querySelector: () => el('inner'),
    querySelectorAll: () => [],
    removeChild() {},
    scrollTo() {}
  }, extra || {});
  return e;
}

const registry = {};
for (const id of ids) registry[id] = el(id);

const document = {
  documentElement: { lang: 'en', dir: 'ltr' },
  body: el('body'),
  getElementById: (id) => registry[id] || null,
  querySelector: (sel) => {
    if (sel && sel[0] === '#') return registry[sel.slice(1)] || null;
    return el(sel);
  },
  querySelectorAll: (sel) => {
    if (sel === '.seg-btn') {
      return [el('seg-en', { getAttribute: () => 'en' }), el('seg-ar', { getAttribute: () => 'ar' })];
    }
    if (sel === '[data-i18n]' || sel === '[data-i18n-placeholder]' || sel === '[data-i18n-aria]') {
      return [];
    }
    return [];
  },
  createElement: () => el('created'),
  addEventListener() {}
};

function throwingStorage() {
  const s = {
    getItem() { throw new Error('SecurityError: storage disabled'); },
    setItem() { throw new Error('SecurityError: storage disabled'); },
    removeItem() { throw new Error('SecurityError: storage disabled'); }
  };
  return s;
}

const win = {
  document,
  navigator: {},
  console: { log() {}, warn() {}, error() {} },
  setTimeout, clearTimeout,
  Promise,
  fetch: () => Promise.reject(new Error('offline in test')),
  addEventListener() {},
  get localStorage() { return throwingStorage(); },
  get sessionStorage() { return throwingStorage(); }
};
win.window = win;

const ctx = vm.createContext(win);
let threw = null;
try {
  vm.runInContext(src, ctx, { filename: 'chat.js' });
} catch (e) {
  threw = e;
}

if (threw) {
  console.log('FAIL script threw on load: ' + threw.message);
  process.exit(1);
}

const required = ['input', 'composer', 'photo-btn', 'photo-input'];
const bound = new Set(listeners.map((l) => l.split(':')[0]));
const missing = required.filter((r) => !bound.has(r));

if (missing.length) {
  console.log('FAIL script loaded but never bound: ' + missing.join(', '));
  console.log('bound: ' + listeners.join(', '));
  process.exit(1);
}

console.log('ok   script survives thrown storage access');
console.log('ok   controls bound: ' + [...bound].join(', '));
console.log('ok   shared store exposed: ' + (ctx.FGStore ? 'yes' : 'no'));
if (!ctx.FGStore) {
  console.log('FAIL walking-mode store not shared');
  process.exit(1);
}
