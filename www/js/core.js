/* RemindMe v3 — core: helpers, plugins, storage, crypto, logging */
'use strict';
var APP_VERSION = '3.1';
var Cap = window.Capacitor || {};
var IS_NATIVE = !!(Cap.isNativePlatform && Cap.isNativePlatform());

function plug(name) {
  try {
    if (Cap.Plugins && Cap.Plugins[name]) return Cap.Plugins[name];
    if (IS_NATIVE && Cap.registerPlugin) return Cap.registerPlugin(name);
  } catch (e) {}
  return undefined;
}
var P = {};
['RmAlarm', 'LocalNotifications', 'App', 'Filesystem', 'Share', 'NativeBiometric', 'SpeechRecognition',
 'BackgroundGeolocation', 'Clipboard', 'CapacitorHttp'].forEach(function (n) { P[n] = plug(n); });

/* ---------- debug log ---------- */
var LOGKEY = 'rm_log';
var _log = [];
try { _log = JSON.parse(localStorage.getItem(LOGKEY)) || []; } catch (e) { _log = []; }
function jlog(msg) {
  var line = new Date().toISOString().slice(5, 19).replace('T', ' ') + ' ' + msg;
  _log.push(line);
  if (_log.length > 500) _log = _log.slice(-400);
  try { localStorage.setItem(LOGKEY, JSON.stringify(_log)); } catch (e) {}
}
window.addEventListener('error', function (e) { jlog('JS error: ' + e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno); });
window.addEventListener('unhandledrejection', function (e) { jlog('Promise rejection: ' + ((e.reason && (e.reason.message || e.reason)) || '?')); });

/* ---------- small helpers ---------- */
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function ymd(d) { d = new Date(d); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function hm(d) { d = new Date(d); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function todayStr() { return ymd(new Date()); }
function sod(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
function sameDay(a, b) { return ymd(a) === ymd(b); }
function parseLocal(dateStr, timeStr) { var p = dateStr.split('-'), t = (timeStr || '09:00').split(':'); return new Date(+p[0], +p[1] - 1, +p[2], +t[0], +t[1], 0, 0); }
function dayLabel(d) {
  d = new Date(d); var t = sod(new Date()), dd = sod(d), diff = Math.round((dd - t) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}
function whenLabel(d) { return dayLabel(d) + ', ' + hm(d); }
function durLabel(min) {
  if (min % 10080 === 0) return (min / 10080) + (min === 10080 ? ' week' : ' weeks');
  if (min % 1440 === 0) return (min / 1440) + (min === 1440 ? ' day' : ' days');
  if (min % 60 === 0) return (min / 60) + (min === 60 ? ' hour' : ' hours');
  return min + ' min';
}
function relLabel(d) {
  var ms = new Date(d) - new Date(), a = Math.abs(ms), m = Math.round(a / 60000), s;
  if (m < 1) s = 'now'; else if (m < 60) s = m + ' min'; else if (m < 1440) s = Math.round(m / 60) + ' h'; else s = Math.round(m / 1440) + ' d';
  if (s === 'now') return 'now';
  return ms > 0 ? 'in ' + s : s + ' ago';
}
function cap1(s) { s = String(s || '').trim(); return s.charAt(0).toUpperCase() + s.slice(1); }
function hid(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 2000000000) + 1; }
function uid() { return db.nextId++; }
function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
function b64(buf) { var s = '', b = new Uint8Array(buf); for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
function unb64(s) { var bin = atob(s), b = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }

var toastTimer;
function toast(msg, undoFn) {
  var t = $('#toast');
  t.innerHTML = esc(msg) + (undoFn ? '<button id="undoBtn">UNDO</button>' : '');
  t.style.display = 'block';
  if (undoFn) $('#undoBtn').onclick = function () { t.style.display = 'none'; undoFn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.style.display = 'none'; }, undoFn ? 5000 : 2400);
}

/* ---------- icons ---------- */
var I = (function () {
  function s(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }
  return {
    home: s('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
    tasks: s('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>'),
    routine: s('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M12 7v5l3 2"/>'),
    notes: s('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>'),
    vault: s('<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
    search: s('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
    spark: s('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>'),
    gear: s('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    place: s('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>'),
    plus: s('<path d="M12 5v14M5 12h14"/>'),
    check: s('<path d="m5 12 5 5L20 7"/>'),
    copy: s('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    eye: s('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeoff: s('<path d="M17.9 17.9A10 10 0 0 1 12 19c-6.5 0-10-7-10-7a18 18 0 0 1 5.1-5.9M9.9 4.2A9 9 0 0 1 12 4c6.5 0 10 7 10 7a18 18 0 0 1-2.2 3.2M1 1l22 22"/>'),
    back: s('<path d="m15 18-6-6 6-6"/>'),
    close: s('<path d="M18 6 6 18M6 6l12 12"/>'),
    mic: s('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/>'),
    send: s('<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>'),
    bell: s('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
    finger: s('<path d="M12 11v4M8 9a4 4 0 0 1 8 0v4a8 8 0 0 1-1.5 4.7M6 13V9a6 6 0 0 1 11-3.3M4 15a9 9 0 0 0 .7 3M9 21a10 10 0 0 0 1.5-6V11"/>'),
    del: s('<path d="M21 5H9l-7 7 7 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="m18 9-6 6M12 9l6 6"/>'),
    cal: s('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
    edit: s('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    trash: s('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
    pin: s('<path d="M12 17v5M9 10.8V4h6v6.8l3 3.2H6z"/>'),
    shield: s('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
    link: s('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
    dice: s('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><circle cx="16" cy="16" r="1"/><circle cx="16" cy="8" r="1"/><circle cx="8" cy="16" r="1"/>')
  };
})();

/* ---------- storage ---------- */
var KEY = 'rm_data_v1';
var DEFAULT_CATS = ['Personal', 'Work', 'Bill', 'Birthday', 'Document', 'Appointment', 'Health', 'Follow-up'];
var DEFAULT_VCATS = [
  { id: 'email', name: 'Email', icon: '📧' }, { id: 'social', name: 'Social', icon: '💬' },
  { id: 'shopping', name: 'Shopping', icon: '🛒' }, { id: 'bank', name: 'Banking', icon: '🏦' },
  { id: 'work', name: 'Work', icon: '💼' }, { id: 'other', name: 'Other', icon: '🔐' }
];
function defaults() {
  return {
    v: 3, nextId: 1, tasks: [], places: [], routine: [], notes: [], vault: null, vaultEnc: null, locs: [], chat: [],
    cats: DEFAULT_CATS.slice(), vcats: JSON.parse(JSON.stringify(DEFAULT_VCATS)),
    settings: {
      pin: null, pinLen: 4, bio: false, theme: 'auto', accent: '#4f46e5',
      summaryOn: true, summaryTime: '08:00', eveningOn: false, eveningTime: '21:00',
      voiceLang: 'en-US', snoozeMin: 10, reRingMin: 5, ringSec: 60, maxRepeats: 0, forceVolume: true, vibrate: true,
      defaultTone: 'default', lockAfter: 30, secure: false, autoBackup: true, lastAutoBackup: '',
      pwRotateDays: 30, placesFast: false, vaultSalt: null, setupDone: false, migratedV3: false, failCount: 0, failUntil: 0,
      ai: { provider: 'offline', key: '', model: '', baseUrl: '' }
    }
  };
}
function migrate(d) {
  var b = defaults();
  for (var k in b) if (d[k] === undefined) d[k] = b[k];
  if (!d.settings) d.settings = {};
  for (var s in b.settings) if (d.settings[s] === undefined) d.settings[s] = b.settings[s];
  if (!d.settings.ai) d.settings.ai = b.settings.ai;
  // v2 -> v3 task fields
  d.tasks.forEach(function (t) {
    if (!t.pres) t.pres = t.pre > 0 ? [t.pre * 1440] : [];
    if (!t.style) t.style = t.nag || t.priority === 'high' ? 'alarm' : 'alarm';
    if (!t.follow) t.follow = t.nag ? '30x6' : 'off';
    if (!t.doneOcc) t.doneOcc = {};
    if (t.lastDone) { t.doneOcc[t.lastDone] = Date.now(); delete t.lastDone; }
    if (t.notes === undefined) t.notes = '';
    if (!t.tone) t.tone = 'default';
    if (t.cat === 'Business') t.cat = 'Work';
    delete t.pre; delete t.nag;
  });
  if (d.cats.indexOf('Work') < 0 && d.cats.indexOf('Business') >= 0) d.cats[d.cats.indexOf('Business')] = 'Work';
  d.routine.forEach(function (r) {
    if (!r.doneDates) r.doneDates = {};
    if (r.doneDate) { r.doneDates[r.doneDate] = 1; delete r.doneDate; }
    if (!r.days) r.days = [];
    if (!r.style) r.style = 'notify';
  });
  d.notes.forEach(function (n) { if (n.title === undefined) n.title = ''; if (!n.updated) n.updated = n.at; });
  // plaintext v2 vault entries (kept until first PIN unlock encrypts them)
  if (Array.isArray(d.vault)) {
    var map = { Bank: 'bank', Email: 'email', Social: 'social', Shopping: 'shopping', Other: 'other' };
    d.vault.forEach(function (v) {
      if (!v.catId) v.catId = map[v.cat] || 'other';
      if (!v.pwChangedAt) v.pwChangedAt = new Date().toISOString();
      if (!v.fields) v.fields = [];
      if (v.rotate === undefined) v.rotate = null;
      if (v.url === undefined) v.url = '';
    });
  }
  d.v = 3;
  return d;
}
function load() {
  try { var d = JSON.parse(localStorage.getItem(KEY)); if (d) return migrate(d); } catch (e) { jlog('load error ' + e.message); }
  return defaults();
}
var db = load();
var dirtyHook = null;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast('Could not save: ' + e.message); jlog('save error ' + e.message); }
  if (dirtyHook) dirtyHook();
}

/* ---------- crypto (vault) ---------- */
var VAULT = { key: null, items: null };
async function sha(s) {
  var b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.prototype.map.call(new Uint8Array(b), function (x) { return pad2(x.toString(16)); }).join('');
}
async function pinHash(pin) { return sha('rm:' + pin); }
async function deriveKey(pin, saltB64) {
  var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(saltB64), iterations: 150000, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function exportKey(k) { return b64(await crypto.subtle.exportKey('raw', k)); }
async function importKey(s) { return crypto.subtle.importKey('raw', unb64(s), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']); }
async function encryptJson(key, obj) {
  var iv = crypto.getRandomValues(new Uint8Array(12));
  var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}
async function decryptJson(key, blob) {
  var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
function newSalt() { return b64(crypto.getRandomValues(new Uint8Array(16))); }
async function saveVault() {
  if (!VAULT.key || !VAULT.items) return;
  db.vaultEnc = await encryptJson(VAULT.key, VAULT.items);
  db.vault = null;
  save();
}

/* ---------- clipboard ---------- */
var clipTimer;
async function copyText(txt, label, sensitive) {
  var ok = false;
  try { if (P.Clipboard) { await P.Clipboard.write({ string: String(txt) }); ok = true; } } catch (e) {}
  if (!ok) try { await navigator.clipboard.writeText(String(txt)); ok = true; } catch (e) {}
  if (!ok) {
    var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch (e) {} ta.remove();
  }
  toast(ok ? (label || 'Copied') + (sensitive ? ' — clears in 45s' : '') : 'Could not copy');
  if (ok && sensitive) {
    clearTimeout(clipTimer);
    clipTimer = setTimeout(async function () {
      try { if (P.Clipboard) await P.Clipboard.write({ string: ' ' }); else await navigator.clipboard.writeText(' '); } catch (e) {}
    }, 45000);
  }
}

/* ---------- files ---------- */
async function writeDoc(name, text) {
  var FS = P.Filesystem;
  if (!FS) { downloadFallback(name, text); return { uri: null, where: 'download' }; }
  try {
    var w = await FS.writeFile({ path: 'RemindMe/' + name, data: text, directory: 'DOCUMENTS', encoding: 'utf8', recursive: true });
    return { uri: w.uri, where: 'Documents/RemindMe/' + name };
  } catch (e) {
    jlog('Documents write failed: ' + e.message);
    var w2 = await FS.writeFile({ path: 'RemindMe/' + name, data: text, directory: 'EXTERNAL', encoding: 'utf8', recursive: true });
    return { uri: w2.uri, where: 'Android/data/com.remindme.app/files/RemindMe/' + name };
  }
}
function downloadFallback(name, text) {
  var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click();
}
async function shareText(name, text, title) {
  var FS = P.Filesystem, SH = P.Share;
  if (!FS || !SH) { downloadFallback(name, text); return; }
  var w = await FS.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
  await SH.share({ title: title || name, files: [w.uri] });
}
