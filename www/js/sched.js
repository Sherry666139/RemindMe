/* RemindMe v3 — dates, occurrences, alarm scheduling */
'use strict';
var REP = { none: 'Once', daily: 'Every day', weekdays: 'Weekdays (Mon–Fri)', weekly: 'Every week', monthly: 'Every month', yearly: 'Every year', everyN: 'Every N days' };
var TONES = { default: 'Phone alarm sound', alarm: 'Urgent beeps', bell: 'Bell', chime: 'Chime', melody: 'Melody', soft: 'Soft', beep: 'Beep' };
var PRE_OPTS = [10, 30, 60, 180, 1440, 2880, 4320, 10080];
var FOLLOW = { off: 'Off', '30x6': 'Every 30 min (×6)', '60x8': 'Every hour (×8)', '180x4': 'Every 3 hours (×4)', '1440x1': 'Next day', '1440x7': 'Every day until done (×7)' };
var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function stepAt(t, k) {
  var b = new Date(t.dueAt), d;
  switch (t.repeat) {
    case 'daily': d = addDays(b, k); break;
    case 'weekly': d = addDays(b, 7 * k); break;
    case 'everyN': d = addDays(b, Math.max(1, t.everyN || 1) * k); break;
    case 'monthly': {
      var y = b.getFullYear(), m = b.getMonth() + k; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
      d = new Date(y, m, Math.min(b.getDate(), daysInMonth(y, m)), b.getHours(), b.getMinutes()); break;
    }
    case 'yearly': {
      var yy = b.getFullYear() + k;
      d = new Date(yy, b.getMonth(), Math.min(b.getDate(), daysInMonth(yy, b.getMonth())), b.getHours(), b.getMinutes()); break;
    }
    default: d = new Date(b);
  }
  return d;
}
/** Occurrences of t with time >= from, at most n. */
function occsFrom(t, from, n) {
  var b = new Date(t.dueAt), res = [];
  if (t.repeat === 'none') return b >= from ? [b] : [];
  if (t.repeat === 'weekdays') {
    var d = new Date(Math.max(sod(from), sod(b)));
    d.setHours(b.getHours(), b.getMinutes(), 0, 0);
    for (var i = 0; i < 400 && res.length < n; i++) {
      var dw = d.getDay();
      if (dw > 0 && dw < 6 && d >= from && d >= b) res.push(new Date(d));
      d = addDays(d, 1);
    }
    return res;
  }
  // jump close to `from` quickly for daily/weekly/everyN
  var k0 = 0, span = { daily: 1, weekly: 7, everyN: Math.max(1, t.everyN || 1) }[t.repeat];
  if (span && from > b) k0 = Math.max(0, Math.floor((from - b) / (span * 864e5)) - 1);
  if ((t.repeat === 'monthly') && from > b) k0 = Math.max(0, (from.getFullYear() - b.getFullYear()) * 12 + from.getMonth() - b.getMonth() - 1);
  if ((t.repeat === 'yearly') && from > b) k0 = Math.max(0, from.getFullYear() - b.getFullYear() - 1);
  for (var k = k0; k < k0 + 5000 && res.length < n; k++) { var x = stepAt(t, k); if (x >= from) res.push(x); }
  return res;
}
function occursOn(t, day) {
  var s = sod(day);
  return occsFrom(t, s, 1).filter(function (d) { return sameDay(d, day); });
}
function occKey(d) { return ymd(d); }
function isOccDone(t, d) { return t.repeat === 'none' ? !!t.done : !!(t.doneOcc && t.doneOcc[occKey(d)]); }
function groupOf(t, d) { return 't' + t.id + '@' + occKey(d); }
/** next not-done occurrence (may be in the past for overdue one-offs) */
function nextOcc(t) {
  if (t.repeat === 'none') return new Date(t.dueAt);
  var list = occsFrom(t, sod(new Date()), 30);
  for (var i = 0; i < list.length; i++) if (!isOccDone(t, list[i]) && (list[i] >= new Date() || sameDay(list[i], new Date()))) return list[i];
  return list[0] || new Date(t.dueAt);
}
function isTaskOpen(t) { return t.repeat !== 'none' || !t.done; }
function overdueOccs(t) {
  var now = new Date();
  if (t.repeat === 'none') return (!t.done && new Date(t.dueAt) < now) ? [new Date(t.dueAt)] : [];
  if (t.repeat === 'daily' || t.repeat === 'weekdays') {
    return occsFrom(t, sod(now), 3).filter(function (d) { return sameDay(d, now) && d < now && !isOccDone(t, d); });
  }
  var lookback = t.repeat === 'weekly' ? 6 : t.repeat === 'everyN' ? Math.max(1, t.everyN) - 1 : 31;
  return occsFrom(t, addDays(sod(now), -lookback), 10).filter(function (d) { return d < now && !isOccDone(t, d); });
}
function repLabel(t) {
  if (t.repeat === 'everyN') return 'Every ' + (t.everyN || 1) + ' days';
  if (t.repeat === 'weekly') return 'Every ' + DOW[new Date(t.dueAt).getDay()];
  if (t.repeat === 'monthly') return 'Monthly on day ' + new Date(t.dueAt).getDate();
  if (t.repeat === 'yearly') return 'Yearly on ' + new Date(t.dueAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  return REP[t.repeat] || 'Once';
}
function preLabel(pres) { return (pres && pres.length) ? pres.slice().sort(function (a, b) { return b - a; }).map(durLabel).join(', ') + ' before' : 'Only at the time'; }

/* ---------- build alarm instances ---------- */
function alarmBase(kind, tone) {
  var s = db.settings;
  return { kind: kind, tone: tone || s.defaultTone || 'default', snoozeMin: +s.snoozeMin || 10, reRingMin: +s.reRingMin, ringSec: +s.ringSec || 60,
    maxRepeats: +s.maxRepeats || 0, forceVolume: !!s.forceVolume, vibrate: !!s.vibrate, buttons: 'done,snooze,dismiss' };
}
function mk(base, extra) { var o = {}; for (var k in base) o[k] = base[k]; for (var j in extra) o[j] = extra[j]; return o; }
var OCC_COUNT = { none: 1, daily: 10, weekdays: 10, weekly: 6, everyN: 6, monthly: 3, yearly: 2 };

function buildAlarms() {
  var now = new Date(), nowMs = now.getTime(), out = [], groups = {};
  function push(a) { if (a.at > nowMs + 1000) out.push(a); }
  db.tasks.forEach(function (t) {
    var from = addDays(now, -3);
    var occs = occsFrom(t, from, OCC_COUNT[t.repeat] || 3);
    if (t.repeat === 'none') occs = [new Date(t.dueAt)];
    occs.forEach(function (o) {
      if (isOccDone(t, o)) return;
      var g = groupOf(t, o); groups[g] = 1;
      var kind = t.style === 'notify' ? 'notify' : 'ring';
      var base = alarmBase(kind, t.tone);
      var body = [t.cat, t.notes ? t.notes.slice(0, 120) : ''].filter(Boolean).join(' · ');
      var title = (t.priority === 'high' ? '‼ ' : '') + t.title;
      push(mk(base, { id: hid(g + '#main'), group: g, ref: 'task:' + t.id, at: o.getTime(), title: title, body: body || 'Due now' }));
      (t.pres || []).forEach(function (m) {
        var at = o.getTime() - m * 60000;
        push(mk(alarmBase('notify'), { id: hid(g + '#pre' + m), group: g, ref: 'task:' + t.id, at: at, title: '⏳ ' + t.title,
          body: 'Due in ' + durLabel(m) + ' — ' + whenLabel(o), doneLabel: '✓ Mark done' }));
      });
      if (t.follow && t.follow !== 'off') {
        var p = t.follow.split('x'), every = +p[0], cnt = +p[1];
        for (var i = 1; i <= cnt; i++) {
          push(mk(alarmBase(kind, t.tone), { id: hid(g + '#fu' + i), group: g, ref: 'task:' + t.id, at: o.getTime() + i * every * 60000,
            title: '🔁 Follow-up: ' + t.title, body: 'Still not done (due ' + whenLabel(o) + ')' }));
        }
      }
    });
  });
  db.routine.forEach(function (r) {
    if (!r.time) return;
    var tm = r.time.split(':');
    for (var i = 0; i < 4; i++) {
      var d = addDays(sod(now), i); d.setHours(+tm[0], +tm[1], 0, 0);
      if (r.days && r.days.length && r.days.indexOf(d.getDay()) < 0) continue;
      if (r.doneDates && r.doneDates[ymd(d)]) continue;
      var g = 'r' + r.id + '@' + ymd(d); groups[g] = 1;
      push(mk(alarmBase(r.style === 'alarm' ? 'ring' : 'notify'), { id: hid(g), group: g, ref: 'routine:' + r.id, at: d.getTime(), title: '🔁 ' + r.text, body: 'Daily routine' }));
    }
  });
  if (VAULT.items) db._vmeta = VAULT.items.map(function (v) { return { id: v.id, name: v.name, changed: v.pwChangedAt, rotate: v.rotate }; });
  (db._vmeta || []).forEach(function (v) {
    var R = v.rotate === null || v.rotate === undefined ? +db.settings.pwRotateDays : +v.rotate;
    if (!R) return;
    var c = new Date(v.changed || Date.now());
    for (var k = 1; k <= 12; k++) {
      var d = addDays(c, R * k); d.setHours(10, 0, 0, 0);
      if (d.getTime() <= nowMs) continue;
      var g = 'v' + v.id; groups[g] = 1;
      push(mk(alarmBase('notify'), { id: hid('v' + v.id + '#' + k), group: g, ref: 'vault:' + v.id, at: d.getTime(), buttons: 'snooze,dismiss', snoozeMin: 1440,
        title: '🔑 Time to change your ' + v.name + ' password', body: "It's been " + (R * k) + ' days since you last changed it. Changing it regularly keeps the account safe.' }));
      break;
    }
  });
  var s = db.settings;
  if (s.summaryOn || s.eveningOn) {
    for (var i = 0; i < 7; i++) {
      var day = addDays(sod(now), i);
      if (s.summaryOn) {
        var at = parseLocal(ymd(day), s.summaryTime);
        var sm = summaryText(day, 'morning');
        push(mk(alarmBase('summary'), { id: hid('sum@' + ymd(day)), group: 'sum', at: at.getTime(), title: sm.title, body: sm.body, buttons: '' }));
      }
      if (s.eveningOn) {
        var at2 = parseLocal(ymd(day), s.eveningTime);
        var ev = summaryText(day, 'evening');
        push(mk(alarmBase('summary'), { id: hid('eve@' + ymd(day)), group: 'sum', at: at2.getTime(), title: ev.title, body: ev.body, buttons: '' }));
      }
    }
  }
  out.sort(function (a, b) { return a.at - b.at; });
  if (out.length > 450) out = out.slice(0, 450);
  return { alarms: out, groups: Object.keys(groups) };
}

function dayItems(day) {
  var items = [];
  db.tasks.forEach(function (t) { occursOn(t, day).forEach(function (o) { items.push({ t: t, at: o, done: isOccDone(t, o) }); }); });
  items.sort(function (a, b) { return a.at - b.at; });
  return items;
}
function routineFor(day) { return db.routine.filter(function (r) { return !r.days || !r.days.length || r.days.indexOf(new Date(day).getDay()) >= 0; }); }
function allOverdue() {
  var res = [], today = new Date();
  db.tasks.forEach(function (t) { overdueOccs(t).forEach(function (o) { if (!sameDay(o, today) || t.repeat === 'none') res.push({ t: t, at: o }); }); });
  return res.filter(function (x) { return !sameDay(x.at, today) || x.t.repeat === 'none'; }).sort(function (a, b) { return a.at - b.at; });
}
function summaryText(day, mode) {
  var items = dayItems(day).filter(function (x) { return !x.done; }), rt = routineFor(day);
  var over = allOverdue().filter(function (x) { return !sameDay(x.at, day); });
  if (mode === 'evening') {
    var tm = dayItems(addDays(day, 1));
    var lines = [];
    if (items.length) lines.push('Still open today: ' + items.map(function (x) { return x.t.title; }).join(', '));
    lines.push(tm.length ? 'Tomorrow: ' + tm.map(function (x) { return hm(x.at) + ' ' + x.t.title; }).join(' · ') : 'Nothing planned for tomorrow.');
    return { title: '🌙 Evening review — ' + items.length + ' open', body: lines.join('\n') };
  }
  var body = items.length ? items.slice(0, 8).map(function (x) { return hm(x.at) + '  ' + x.t.title; }).join('\n') : 'No tasks scheduled.';
  if (items.length > 8) body += '\n+' + (items.length - 8) + ' more';
  if (over.length) body += '\n⚠ ' + over.length + ' overdue';
  if (rt.length) body += '\n🔁 Routine: ' + rt.length + ' items';
  return { title: '☀ Today: ' + items.length + ' task' + (items.length === 1 ? '' : 's') + (over.length ? ' · ' + over.length + ' overdue' : ''), body: body };
}

var lastSync = { at: 0, count: 0, error: '' };
var syncing = Promise.resolve();
function rescheduleAll() { syncing = syncing.then(doSync).catch(function (e) { jlog('sync failed ' + e.message); }); return syncing; }
var rescheduleSoon = debounce(rescheduleAll, 400);
async function doSync() {
  var R = P.RmAlarm, b = buildAlarms();
  if (!R) { lastSync = { at: Date.now(), count: b.alarms.length, error: 'web preview (no native)' }; return; }
  try {
    var r = await R.sync({ alarms: b.alarms, activeGroups: b.groups });
    lastSync = { at: Date.now(), count: r.scheduled, error: '' };
  } catch (e) { lastSync = { at: Date.now(), count: 0, error: e.message }; jlog('sync error ' + e.message); }
}

/* ---------- events from notification buttons / alarm screen ---------- */
async function consumeEvents() {
  if (!P.RmAlarm) return;
  try {
    var r = await P.RmAlarm.consumeEvents();
    (r.events || []).forEach(applyEvent);
    if (r.events && r.events.length) { save(); rescheduleSoon(); if (typeof render === 'function') render(); }
  } catch (e) { jlog('consumeEvents ' + e.message); }
}
function applyEvent(ev) {
  jlog('event ' + ev.action + ' ' + ev.group);
  if (ev.action !== 'done' || !ev.group) return;
  var m = /^([tr])(\d+)@(\d{4}-\d{2}-\d{2})$/.exec(ev.group);
  if (!m) return;
  var id = +m[2], key = m[3];
  if (m[1] === 't') {
    var t = db.tasks.filter(function (x) { return x.id === id; })[0]; if (!t) return;
    if (t.repeat === 'none') { t.done = true; t.doneAt = new Date().toISOString(); }
    else { t.doneOcc = t.doneOcc || {}; t.doneOcc[key] = Date.now(); }
  } else {
    var r = db.routine.filter(function (x) { return x.id === id; })[0]; if (!r) return;
    r.doneDates = r.doneDates || {}; r.doneDates[key] = 1;
  }
}
