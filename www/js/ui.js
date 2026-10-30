/* RemindMe v3 — UI */
'use strict';
var extNav = 0, view = 'today', taskSeg = 'upcoming', taskCat = '', vaultCat = '', openV = null, showPw = {}, locked = true, lastHide = 0;

/* ================= LOCK ================= */
var pinBuf = '', pinStage = 'enter', pinFirst = '', newPinLen = 4;
function pinLen() { return pinStage === 'enter' ? (db.settings.pinLen || 4) : newPinLen; }
function drawDots() { var n = pinLen(); $('#dots').innerHTML = Array.from({ length: n }, function (_, i) { return '<i class="' + (i < pinBuf.length ? 'f' : '') + '"></i>'; }).join(''); }
function lockMsg(m, sub) { $('#lockmsg').textContent = m; $('#locksub').innerHTML = sub || ''; }
function showLock() {
  locked = true; pinBuf = ''; VAULT.key = null; VAULT.items = null;
  $('#lock').style.display = 'flex'; $('#app').style.visibility = 'hidden'; closeSheet(); closeSearch();
  if (!db.settings.pin) { pinStage = 'new'; newPinLen = 4; lockMsg('Create a PIN', '<button class="btn sec sm" id="pinlenBtn">Use 6 digits instead</button>'); bindPinLen(); }
  else { pinStage = 'enter'; lockMsg('Enter your PIN', db.settings.bio ? '<button class="btn sec sm" id="bioBtn">' + I.finger + ' Use fingerprint</button>' : ''); if (db.settings.bio) { $('#bioBtn').onclick = tryBio; setTimeout(tryBio, 250); } }
  drawDots();
}
function bindPinLen() {
  var b = $('#pinlenBtn'); if (!b) return;
  b.onclick = function () { newPinLen = newPinLen === 4 ? 6 : 4; pinBuf = ''; b.textContent = 'Use ' + (newPinLen === 4 ? 6 : 4) + ' digits instead'; drawDots(); };
}
async function tryBio() {
  var B = P.NativeBiometric; if (!B) return; extNav = Date.now();
  try {
    var a = await B.isAvailable(); if (!a.isAvailable) return;
    await B.verifyIdentity({ reason: 'Unlock RemindMe', title: 'Unlock RemindMe', subtitle: 'Use your fingerprint', negativeButtonText: 'Use PIN' });
    var cred = await B.getCredentials({ server: 'com.remindme.app.vault' });
    VAULT.key = await importKey(cred.password);
    await openVault();
    unlock();
  } catch (e) { jlog('bio: ' + (e.message || e)); }
}
async function openVault() {
  if (db.vaultEnc) VAULT.items = await decryptJson(VAULT.key, db.vaultEnc);
  else { VAULT.items = Array.isArray(db.vault) ? db.vault : []; await saveVault(); }
}
async function pressKey(k) {
  var s = db.settings;
  if (s.failUntil && Date.now() < s.failUntil) { lockMsg('Too many attempts', 'Try again in ' + Math.ceil((s.failUntil - Date.now()) / 1000) + 's'); return; }
  if (k === 'bk') { pinBuf = pinBuf.slice(0, -1); drawDots(); return; }
  if (pinBuf.length >= pinLen()) return;
  pinBuf += k; drawDots();
  if (pinBuf.length < pinLen()) return;
  var pin = pinBuf; pinBuf = '';
  if (pinStage === 'new') { pinFirst = pin; pinStage = 'confirm'; lockMsg('Enter the same PIN again'); }
  else if (pinStage === 'confirm') {
    if (pin === pinFirst) {
      var oldItems = VAULT.items;
      s.pin = await pinHash(pin); s.pinLen = newPinLen; s.vaultSalt = newSalt();
      VAULT.key = await deriveKey(pin, s.vaultSalt);
      if (oldItems) VAULT.items = oldItems; else VAULT.items = Array.isArray(db.vault) ? db.vault : (VAULT.items || []);
      await saveVault(); await storeBioKey();
      save(); unlock(); toast('PIN set');
    } else { pinStage = 'new'; shake(); lockMsg('PINs did not match — create a PIN', '<button class="btn sec sm" id="pinlenBtn">Use ' + (newPinLen === 4 ? 6 : 4) + ' digits instead</button>'); bindPinLen(); }
  } else {
    if (await pinHash(pin) === s.pin) {
      s.failCount = 0; s.failUntil = 0;
      try {
        if (!s.vaultSalt) { s.vaultSalt = newSalt(); }
        VAULT.key = await deriveKey(pin, s.vaultSalt);
        await openVault();
        await storeBioKey();
      } catch (e) { jlog('vault open failed: ' + e.message); toast('Vault could not be opened: ' + e.message); VAULT.items = []; }
      save(); unlock();
    } else {
      s.failCount = (s.failCount || 0) + 1; shake();
      if (s.failCount >= 5) { s.failUntil = Date.now() + 30000 * Math.pow(2, Math.min(4, s.failCount - 5)); lockMsg('Wrong PIN', 'Locked for ' + Math.round((s.failUntil - Date.now()) / 1000) + 's'); }
      else lockMsg('Wrong PIN — try again', (5 - s.failCount) + ' attempts left');
      save();
    }
  }
  setTimeout(drawDots, 0);
}
async function storeBioKey() {
  if (!db.settings.bio || !P.NativeBiometric || !VAULT.key) return;
  try { await P.NativeBiometric.setCredentials({ username: 'rmkey', password: await exportKey(VAULT.key), server: 'com.remindme.app.vault' }); } catch (e) { jlog('setCredentials ' + e.message); }
}
function shake() { var d = $('#dots'); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake'); if (navigator.vibrate) navigator.vibrate(80); }
function buildPad() {
  var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'bk'];
  $('#pad').innerHTML = keys.map(function (k) { return k === '' ? '<span class="blank"></span>' : '<button data-k="' + k + '">' + (k === 'bk' ? I.del : k) + '</button>'; }).join('');
}
function unlock() {
  locked = false; $('#lock').style.display = 'none'; $('#app').style.visibility = 'visible';
  render(); rescheduleAll(); consumeEvents(); openLaunchGroup();
  if (!db.settings.setupDone) setTimeout(function () { healthSheet(true); }, 400);
  else checkHealthQuiet();
  maybeAutoBackup();
}

/* ================= RENDER ================= */
var TITLES = { today: 'Today', tasks: 'Tasks', routine: 'Routine', notes: 'Notes', vault: 'Vault', assistant: 'Assistant', settings: 'Settings' };
function render() {
  if (locked) return;
  $('#htitle').textContent = TITLES[view] || 'RemindMe';
  $$('nav button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === view); });
  $('#fab').style.display = (view === 'settings' || view === 'assistant') ? 'none' : 'flex';
  $('#hback').style.display = view === 'settings' ? 'flex' : 'none';
  var comp = $('#composer'); comp.style.display = view === 'assistant' ? 'flex' : 'none';
  var m = $('#main'), keep = m.scrollTop;
  var fn = { today: viewToday, tasks: viewTasks, routine: viewRoutine, notes: viewNotes, vault: viewVault, assistant: viewAssistant, settings: viewSettings }[view];
  m.innerHTML = fn();
  if (view === 'settings') bindSettings();
  if (view === 'assistant') { m.scrollTop = m.scrollHeight; return; }
  m.scrollTop = keep;
}
function go(v) { view = v; openV = null; showPw = {}; $('#main').scrollTop = 0; render(); }

function taskCard(t, at, opts) {
  opts = opts || {};
  var done = isOccDone(t, at), over = !done && at < new Date() && !opts.noOver;
  var tags = '<span class="tag">' + esc(t.cat) + '</span>';
  if (t.repeat !== 'none') tags += '<span class="tag">🔁 ' + esc(repLabel(t)) + '</span>';
  if (t.priority === 'high') tags += '<span class="tag hi">High</span>';
  if (t.style === 'alarm') tags += '<span class="tag">⏰ Alarm</span>';
  if (t.follow && t.follow !== 'off') tags += '<span class="tag">↻ Follow-up</span>';
  return '<div class="card' + (done ? ' done' : '') + (over ? ' over' : '') + '"><div class="row">' +
    '<button class="chk' + (done ? ' on' : '') + '" data-act="tdone" data-id="' + t.id + '" data-at="' + at.getTime() + '">' + I.check + '</button>' +
    '<div class="grow" data-act="tview" data-id="' + t.id + '" data-at="' + at.getTime() + '">' +
    '<div class="title">' + esc(t.title) + '</div>' +
    '<div class="when">' + esc(opts.label || whenLabel(at)) + (over ? ' · overdue' : (!done && at > new Date() && at - new Date() < 864e5 ? ' · ' + relLabel(at) : '')) + '</div>' +
    '<div>' + tags + '</div></div></div></div>';
}
function emptyBox(icon, txt) { return '<div class="empty">' + icon + esc(txt) + '</div>'; }

/* ---- Today ---- */
function viewToday() {
  var now = new Date(), items = dayItems(now), open = items.filter(function (x) { return !x.done; }).length, over = allOverdue();
  var rt = routineFor(now), rdone = rt.filter(function (r) { return r.doneDates && r.doneDates[todayStr()]; }).length;
  var h = '<div class="hero"><div class="mut" style="color:rgba(255,255,255,.8)">' + now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) + '</div>' +
    '<div class="big">' + (open ? open + ' task' + (open > 1 ? 's' : '') + ' left today' : (items.length ? 'All done for today ✓' : 'Nothing due today')) + '</div>' +
    '<div class="stats"><div><b>' + items.length + '</b>today</div><div><b>' + over.length + '</b>overdue</div><div><b>' + rdone + '/' + rt.length + '</b>routine</div></div></div>';
  if (healthBad.length) h += '<div class="banner red" data-act="health">⚠️<div class="grow"><b>Alarms may not ring when locked.</b><br><span class="sm">' + esc(healthBad.join(', ')) + '</span></div><button class="btn sm">Fix</button></div>';
  if (over.length) h += '<h2 style="color:var(--red)">Overdue <span class="cnt">' + over.length + '</span></h2>' + over.map(function (x) { return taskCard(x.t, x.at); }).join('');
  h += '<h2>Today <span class="cnt">' + items.length + '</span></h2>';
  h += items.length ? items.map(function (x) { return taskCard(x.t, x.at, { label: hm(x.at) + (x.t.repeat !== 'none' ? '' : '') }); }).join('') : emptyBox(I.cal, 'No tasks today. Tap + to add one.');
  if (rt.length) {
    h += '<h2>Routine <span class="cnt">' + rdone + '/' + rt.length + '</span></h2><div class="card"><div class="bar"><i style="width:' + (rt.length ? Math.round(rdone / rt.length * 100) : 0) + '%"></i></div>';
    h += rt.map(function (r) { var d = r.doneDates && r.doneDates[todayStr()]; return '<div class="row' + (d ? ' done' : '') + '" style="margin-top:10px"><button class="chk' + (d ? ' on' : '') + '" data-act="rdone" data-id="' + r.id + '">' + I.check + '</button><div class="grow title" style="font-weight:500">' + esc(r.text) + '</div>' + (r.time ? '<span class="mut">' + esc(r.time) + '</span>' : '') + '</div>'; }).join('') + '</div>';
  }
  var up = [];
  for (var i = 1; i <= 7; i++) { var d = addDays(now, i); dayItems(d).forEach(function (x) { if (x.t.repeat !== 'daily' && x.t.repeat !== 'weekdays') up.push(x); }); }
  if (up.length) h += '<h2>Next 7 days <span class="cnt">' + up.length + '</span></h2>' + up.slice(0, 12).map(function (x) { return taskCard(x.t, x.at, { noOver: true }); }).join('');
  var pinned = db.notes.filter(function (n) { return n.pinned; });
  if (pinned.length) h += '<h2>Pinned notes</h2>' + pinned.map(function (n) { return '<div class="card" data-act="nedit" data-id="' + n.id + '">' + (n.title ? '<div class="title">' + esc(n.title) + '</div>' : '') + '<div class="small-note">' + esc(n.text) + '</div></div>'; }).join('');
  return h;
}

/* ---- Tasks ---- */
function viewTasks() {
  var h = '<div class="seg">' + [['upcoming', 'Upcoming'], ['overdue', 'Overdue'], ['done', 'Completed'], ['all', 'All']].map(function (x) { return '<button data-act="tseg" data-v="' + x[0] + '" class="' + (taskSeg === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>';
  h += '<div class="hscroll"><button class="chip' + (!taskCat ? ' on' : '') + '" data-act="tcat" data-v="">All</button>' + db.cats.map(function (c) { return '<button class="chip' + (taskCat === c ? ' on' : '') + '" data-act="tcat" data-v="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>';
  var list = db.tasks.filter(function (t) { return !taskCat || t.cat === taskCat; });
  if (taskSeg === 'overdue') {
    var ov = allOverdue().filter(function (x) { return !taskCat || x.t.cat === taskCat; });
    return h + (ov.length ? ov.map(function (x) { return taskCard(x.t, x.at); }).join('') : emptyBox(I.check, 'Nothing overdue.'));
  }
  if (taskSeg === 'done') {
    var dn = [];
    list.forEach(function (t) {
      if (t.repeat === 'none' && t.done) dn.push({ t: t, at: new Date(t.dueAt), when: t.doneAt });
      else Object.keys(t.doneOcc || {}).forEach(function (k) { var o = occursOn(t, parseLocal(k, '00:00'))[0]; if (o) dn.push({ t: t, at: o, when: t.doneOcc[k] }); });
    });
    dn.sort(function (a, b) { return new Date(b.when) - new Date(a.when); });
    return h + (dn.length ? dn.slice(0, 100).map(function (x) { return taskCard(x.t, x.at, { noOver: true }); }).join('') : emptyBox(I.check, 'No completed tasks yet.'));
  }
  if (taskSeg === 'all') {
    var all = list.slice().sort(function (a, b) { return a.title.localeCompare(b.title); });
    return h + (all.length ? all.map(function (t) { return taskCard(t, nextOcc(t), { noOver: t.repeat !== 'none', label: (t.repeat === 'none' ? '' : repLabel(t) + ' · next ') + whenLabel(nextOcc(t)) }); }).join('') : emptyBox(I.tasks, 'No tasks yet. Tap + to add one.'));
  }
  var up = [];
  list.forEach(function (t) {
    if (t.repeat === 'none') { if (!t.done && new Date(t.dueAt) >= sod(new Date())) up.push({ t: t, at: new Date(t.dueAt) }); return; }
    var n = occsFrom(t, sod(new Date()), 5).filter(function (o) { return !isOccDone(t, o); })[0];
    if (n) up.push({ t: t, at: n });
  });
  up.sort(function (a, b) { return a.at - b.at; });
  if (!up.length) return h + emptyBox(I.tasks, 'No upcoming tasks. Tap + to add one.');
  var last = '';
  up.forEach(function (x) {
    var g = bucket(x.at); if (g !== last) { h += '<h2>' + g + '</h2>'; last = g; }
    h += taskCard(x.t, x.at);
  });
  return h;
}
function bucket(d) {
  var diff = Math.round((sod(d) - sod(new Date())) / 864e5);
  if (diff <= 0) return 'Today'; if (diff === 1) return 'Tomorrow'; if (diff < 7) return 'This week'; if (diff < 31) return 'This month'; return 'Later';
}

/* ---- Routine ---- */
function viewRoutine() {
  var now = new Date(), rt = routineFor(now), rd = rt.filter(function (r) { return r.doneDates && r.doneDates[todayStr()]; }).length;
  var h = '<div class="card"><div class="row"><div class="grow"><b>' + rd + ' of ' + rt.length + ' done today</b><div class="mut">Checklist resets every day automatically</div></div></div><div class="bar"><i style="width:' + (rt.length ? Math.round(rd / rt.length * 100) : 0) + '%"></i></div></div>';
  if (!db.routine.length) return h + emptyBox(I.routine, 'No routine items yet. Add daily habits like medicine, prayers, gym or checking email.');
  var sorted = db.routine.slice().sort(function (a, b) { return (a.time || '99') < (b.time || '99') ? -1 : 1; });
  h += sorted.map(function (r) {
    var active = !r.days || !r.days.length || r.days.indexOf(now.getDay()) >= 0, d = r.doneDates && r.doneDates[todayStr()];
    var week = '';
    for (var i = 6; i >= 0; i--) { var day = addDays(now, -i), on = r.doneDates && r.doneDates[ymd(day)]; week += '<i title="' + ymd(day) + '" style="display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:3px;background:' + (on ? 'var(--grn)' : 'var(--card2)') + '"></i>'; }
    return '<div class="card' + (d ? ' done' : '') + '" style="' + (active ? '' : 'opacity:.55') + '"><div class="row"><button class="chk' + (d ? ' on' : '') + '" data-act="rdone" data-id="' + r.id + '">' + I.check + '</button>' +
      '<div class="grow" data-act="redit" data-id="' + r.id + '"><div class="title">' + esc(r.text) + '</div><div class="when">' + (r.time ? (r.style === 'alarm' ? '⏰ ' : '🔔 ') + esc(r.time) : 'No reminder') + ' · ' + (r.days && r.days.length ? r.days.map(function (x) { return DOW[x]; }).join(' ') : 'Every day') + '</div><div style="margin-top:6px">' + week + '</div></div></div></div>';
  }).join('');
  return h;
}

/* ---- Notes ---- */
function viewNotes() {
  if (!db.notes.length) return emptyBox(I.notes, 'No notes yet. Tap + for a quick note.');
  var list = db.notes.slice().sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.updated) - new Date(a.updated); });
  return '<div class="notegrid">' + list.map(function (n) {
    return '<div class="card" data-act="nedit" data-id="' + n.id + '">' + (n.pinned ? '<div style="float:right;color:var(--pri)">📌</div>' : '') + (n.title ? '<div class="title" style="margin-bottom:4px">' + esc(n.title) + '</div>' : '') + '<div class="small-note">' + esc(n.text) + '</div><div class="mut" style="font-size:11px;margin-top:6px">' + new Date(n.updated).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + '</div></div>';
  }).join('') + '</div>';
}

/* ---- Vault ---- */
function vcat(id) { return db.vcats.filter(function (c) { return c.id === id; })[0] || { id: 'other', name: 'Other', icon: '🔐' }; }
function pwAge(v) { return Math.floor((Date.now() - new Date(v.pwChangedAt || Date.now())) / 864e5); }
function rotateDays(v) { return v.rotate === null || v.rotate === undefined ? +db.settings.pwRotateDays : +v.rotate; }
function viewVault() {
  var items = VAULT.items || [];
  var h = '<div class="hscroll"><button class="chip' + (!vaultCat ? ' on' : '') + '" data-act="vcatf" data-v="">All (' + items.length + ')</button>' +
    db.vcats.map(function (c) { var n = items.filter(function (v) { return v.catId === c.id; }).length; return '<button class="chip' + (vaultCat === c.id ? ' on' : '') + '" data-act="vcatf" data-v="' + esc(c.id) + '">' + c.icon + ' ' + esc(c.name) + (n ? ' (' + n + ')' : '') + '</button>'; }).join('') +
    '<button class="chip" data-act="vcatadd">＋ Category</button></div>';
  var due = items.filter(function (v) { var R = rotateDays(v); return R && pwAge(v) >= R; });
  if (due.length && !vaultCat) h += '<div class="banner">🔑<div class="grow"><b>' + due.length + ' password' + (due.length > 1 ? 's' : '') + ' due for a change</b><br><span class="sm">' + esc(due.map(function (v) { return v.name; }).join(', ')) + '</span></div></div>';
  var list = items.filter(function (v) { return !vaultCat || v.catId === vaultCat; });
  if (!list.length) return h + emptyBox(I.vault, items.length ? 'Nothing in this category.' : 'Your vault is empty. Tap + to save an account. Everything is encrypted with your PIN.');
  list.sort(function (a, b) { return (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || vcat(a.catId).name.localeCompare(vcat(b.catId).name) || a.name.localeCompare(b.name); });
  var last = '';
  list.forEach(function (v) {
    var c = vcat(v.catId), g = v.fav ? '★ Favorites' : c.icon + ' ' + c.name;
    if (!vaultCat && g !== last) { h += '<h2>' + esc(g) + '</h2>'; last = g; }
    var age = pwAge(v), R = rotateDays(v), dueNow = R && age >= R;
    h += '<div class="card"><div class="row" data-act="vopen" data-id="' + v.id + '"><div class="cicon">' + c.icon + '</div><div class="grow"><div class="title">' + esc(v.name) + '</div><div class="mut">' + esc(v.user || '—') + '</div></div>' +
      (dueNow ? '<span class="tag warn">Change due</span>' : '') +
      (v.user ? '<button class="ib" data-act="vcopy" data-id="' + v.id + '" data-f="user" title="Copy username">' + I.copy + '</button>' : '') + '</div>';
    if (openV === v.id) {
      h += '<div style="margin-top:8px">' + credRow(v, 'user', 'Email / username', v.user, false) + credRow(v, 'pass', 'Password', v.pass, true) +
        (v.url ? credRow(v, 'url', 'Website', v.url, false) : '') +
        (v.fields || []).map(function (f, i) { return credRow(v, 'f' + i, f.label || 'Field', f.value, !!f.secret); }).join('') +
        (v.notes ? credRow(v, 'notes', 'Notes', v.notes, false) : '') +
        '<div class="kv"><div class="grow"><div class="k">Password age</div><div class="v">' + age + ' day' + (age === 1 ? '' : 's') + (R ? ' · reminder every ' + R + ' days' : ' · reminders off') + '</div></div></div>' +
        '<div class="btns"><button class="btn sec sm" data-act="vedit" data-id="' + v.id + '">' + I.edit + 'Edit</button><button class="btn sec sm" data-act="vchanged" data-id="' + v.id + '">✓ I changed it</button><button class="btn danger sm" data-act="vdel" data-id="' + v.id + '">' + I.trash + '</button></div></div>';
    }
    h += '</div>';
  });
  return h;
}
function credRow(v, f, label, value, secret) {
  var shown = !secret || showPw[v.id + f];
  return '<div class="kv"><div class="grow"><div class="k">' + esc(label) + '</div><div class="v' + (secret ? ' pw' : '') + '">' + (shown ? esc(value || '—') : '••••••••••') + '</div></div>' +
    (secret ? '<button class="ib" data-act="vshow" data-id="' + v.id + '" data-f="' + f + '">' + (shown ? I.eyeoff : I.eye) + '</button>' : '') +
    (f === 'url' ? '<button class="ib" data-act="vurl" data-id="' + v.id + '">' + I.link + '</button>' : '') +
    '<button class="btn sm" data-act="vcopy" data-id="' + v.id + '" data-f="' + f + '">' + I.copy + 'Copy</button></div>';
}
function vaultValue(v, f) {
  if (f === 'user') return v.user; if (f === 'pass') return v.pass; if (f === 'url') return v.url; if (f === 'notes') return v.notes;
  if (f.charAt(0) === 'f') { var x = (v.fields || [])[+f.slice(1)]; return x ? x.value : ''; }
  return '';
}

/* ---- Assistant ---- */
function viewAssistant() {
  var prov = db.settings.ai.provider;
  var h = '<div class="card" style="font-size:13.5px"><b>✨ Assistant</b> — ' + (prov === 'offline' ? 'offline mode (works without internet). Connect a free AI key in Settings for smarter understanding.' : 'using ' + prov + ' AI. Vault data is never sent.') + '</div>';
  h += '<div class="chat">';
  if (!db.chat.length) {
    h += '<div class="msg ai">' + esc(HELP_TEXT) + '</div>';
  }
  db.chat.slice(-40).forEach(function (m) {
    h += '<div class="msg ' + (m.role === 'me' ? 'me' : 'ai') + '">' + esc(m.text) + (m.acts && m.acts.length ? '<div class="acts">' + m.acts.map(function (a) { return '<div class="act">' + a + '</div>'; }).join('') + '</div>' : '') + '</div>';
  });
  h += '</div><div class="chips" style="margin-top:4px">' + ["What's due today?", 'This week', 'Overdue', 'Help'].map(function (q) { return '<button class="chip" data-act="aiq" data-v="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + (db.chat.length ? '<button class="chip" data-act="aiclear">Clear chat</button>' : '') + '</div><div style="height:70px"></div>';
  return h;
}
var aiBusy = false;
async function sendAssistant(text) {
  text = String(text || '').trim(); if (!text || aiBusy) return;
  aiBusy = true; $('#aiinput').value = '';
  db.chat.push({ role: 'me', text: text, at: Date.now() }); render();
  var thinking = { role: 'ai', text: '…', at: Date.now() }; db.chat.push(thinking); render();
  var r;
  try { r = await runAssistant(text); } catch (e) { r = { reply: 'Error: ' + e.message, actions: [] }; }
  db.chat.pop();
  var acts = [];
  for (var i = 0; i < r.actions.length; i++) acts.push(await applyAiAction(r.actions[i]));
  db.chat.push({ role: 'ai', text: r.reply || (acts.length ? 'Done.' : '…'), acts: acts.filter(Boolean), at: Date.now() });
  if (db.chat.length > 60) db.chat = db.chat.slice(-60);
  save(); aiBusy = false; render();
}
async function applyAiAction(a) {
  if (a.type === 'add_task') {
    var t = a.task; t.id = uid(); t.done = false; t.doneOcc = {}; t.createdAt = new Date().toISOString(); db.tasks.push(t); save(); rescheduleSoon();
    return '✅ Task: <b>' + esc(t.title) + '</b><br>' + esc(whenLabel(new Date(t.dueAt))) + ' · ' + esc(repLabel(t)) + '<br>' + esc(preLabel(t.pres)) + (t.follow !== 'off' ? ' · follow-up: ' + esc(FOLLOW[t.follow]) : '') + ' · ' + (t.style === 'alarm' ? 'alarm' : 'notification') +
      '<div class="btns"><button class="btn sec sm" data-act="tedit" data-id="' + t.id + '">Edit</button><button class="btn sec sm" data-act="tundo" data-id="' + t.id + '">Undo</button></div>';
  }
  if (a.type === 'add_note') { var n = { id: uid(), title: '', text: a.text, pinned: false, at: new Date().toISOString(), updated: new Date().toISOString() }; db.notes.unshift(n); save(); return '📝 Note saved: ' + esc(a.text.slice(0, 80)); }
  if (a.type === 'add_routine') { var r = { id: uid(), text: a.text, time: a.time || '', days: [], style: 'notify', doneDates: {} }; db.routine.push(r); save(); rescheduleSoon(); return '🔁 Routine: ' + esc(r.text) + (r.time ? ' at ' + esc(r.time) : ''); }
  if (a.type === 'complete_task') { var t2 = taskById(a.id); if (!t2) return ''; setOccDone(t2, nextOcc(t2), true); return '✓ Marked done: ' + esc(t2.title); }
  if (a.type === 'delete_task') { var t3 = taskById(a.id); if (!t3) return ''; return '🗑 ' + esc(t3.title) + '<div class="btns"><button class="btn danger sm" data-act="tdelc" data-id="' + t3.id + '">Confirm delete</button></div>'; }
  if (a.type === 'search') { setTimeout(function () { openSearch(a.q); }, 50); return '🔍 Searching for "' + esc(a.q) + '"'; }
  return '';
}
function taskById(id) { return db.tasks.filter(function (x) { return x.id === +id; })[0]; }

/* ================= TASK ACTIONS ================= */
function setOccDone(t, at, on) {
  if (t.repeat === 'none') { t.done = on; t.doneAt = on ? new Date().toISOString() : null; }
  else { t.doneOcc = t.doneOcc || {}; if (on) t.doneOcc[occKey(at)] = Date.now(); else delete t.doneOcc[occKey(at)]; }
  save(); rescheduleSoon();
  if (on && P.RmAlarm) P.RmAlarm.stopRinging().catch(function () {});
}
function deleteTask(t) {
  var idx = db.tasks.indexOf(t); if (idx < 0) return;
  db.tasks.splice(idx, 1); save(); rescheduleSoon(); closeSheet(); render();
  toast('Task deleted', function () { db.tasks.splice(idx, 0, t); save(); rescheduleSoon(); render(); });
}

/* ================= SHEETS ================= */
function sheet(html) { var s = $('#sheet'); s.innerHTML = '<div class="panel"><div class="grab"></div>' + html + '</div>'; s.classList.add('on'); }
function closeSheet() { var s = $('#sheet'); s.classList.remove('on'); s.innerHTML = ''; }
function val(id) { var e = $('#' + id); return e ? e.value : ''; }
function chipsHtml(name, options, selected, multi) {
  return '<div class="chips" data-chips="' + name + '" data-multi="' + (multi ? 1 : 0) + '">' + options.map(function (o) {
    var on = multi ? selected.indexOf(o[0]) >= 0 : String(selected) === String(o[0]);
    return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-cv="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
  }).join('') + '</div>';
}
function chipsVal(name) { var box = $('[data-chips="' + name + '"]'); var on = $$('.chip.on', box).map(function (b) { return b.getAttribute('data-cv'); }); return box.getAttribute('data-multi') === '1' ? on : (on[0] || ''); }
function opt(map, sel) { return Object.keys(map).map(function (k) { return '<option value="' + k + '"' + (String(k) === String(sel) ? ' selected' : '') + '>' + esc(map[k]) + '</option>'; }).join(''); }

var TEMPLATES = [
  { k: 'custom', icon: '✏️', name: 'Custom task', t: {} },
  { k: 'bill', icon: '💳', name: 'Pay a bill', t: { cat: 'Bill', repeat: 'monthly', pres: [4320, 1440], follow: '1440x7', style: 'alarm', title: 'Pay ' } },
  { k: 'bday', icon: '🎂', name: 'Birthday', t: { cat: 'Birthday', repeat: 'yearly', pres: [10080, 1440], follow: 'off', style: 'notify', title: "'s birthday", time: '09:00' } },
  { k: 'doc', icon: '📄', name: 'Submit documents', t: { cat: 'Document', repeat: 'none', pres: [10080, 2880, 1440], follow: '1440x7', style: 'alarm', title: 'Submit ' } },
  { k: 'appt', icon: '📅', name: 'Appointment / meeting', t: { cat: 'Appointment', repeat: 'none', pres: [1440, 60], follow: 'off', style: 'alarm' } },
  { k: 'follow', icon: '📞', name: 'Follow up with someone', t: { cat: 'Follow-up', repeat: 'none', pres: [], follow: '1440x7', style: 'notify', title: 'Follow up with ' } },
  { k: 'routine', icon: '🔁', name: 'Daily routine item', routine: true },
  { k: 'note', icon: '📝', name: 'Quick note', note: true },
  { k: 'vault', icon: '🔑', name: 'Save a password', vault: true }
];
function addPicker() {
  sheet('<h3>Add</h3><div class="mut" style="margin-bottom:10px">Pick a type — reminders are pre-filled, you can change everything.</div>' +
    TEMPLATES.map(function (x) { return '<div class="card row" data-act="tpl" data-v="' + x.k + '" style="margin-bottom:6px"><div class="cicon">' + x.icon + '</div><div class="grow title">' + x.name + '</div></div>'; }).join('') +
    '<div class="card row" data-act="openai" style="margin-bottom:6px"><div class="cicon">✨</div><div class="grow"><div class="title">Tell the assistant</div><div class="mut">"Pay rent on 1st at 10am, 2 days before"</div></div></div>');
}
function fab() {
  if (view === 'vault') return vaultForm();
  if (view === 'notes') return noteForm();
  if (view === 'routine') return routineForm();
  addPicker();
}

function taskForm(id, preset) {
  var t = taskById(id), isNew = !t;
  if (isNew) {
    var d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
    t = { title: '', dueAt: d.toISOString(), repeat: 'none', everyN: 2, priority: 'normal', cat: 'Personal', tone: db.settings.defaultTone || 'default', pres: [], follow: 'off', style: 'alarm', notes: '' };
    if (preset) { for (var k in preset) if (k !== 'time') t[k] = preset[k]; if (preset.time) { var dd = new Date(t.dueAt); var p = preset.time.split(':'); dd.setHours(+p[0], +p[1]); t.dueAt = dd.toISOString(); } }
  }
  var due = new Date(t.dueAt);
  sheet('<h3>' + (isNew ? 'New task' : 'Edit task') + '</h3>' +
    (isNew ? '<div class="btns" style="margin:0 0 10px"><button class="btn sec sm" id="f_mic">' + I.mic + 'Speak it</button></div>' : '') +
    '<label>What</label><input id="f_title" value="' + esc(t.title) + '" placeholder="e.g. Pay electricity bill">' +
    '<div class="two"><div><label>Date</label><input id="f_date" type="date" value="' + ymd(due) + '"></div><div><label>Time</label><input id="f_time" type="time" value="' + hm(due) + '"></div></div>' +
    '<label>Category</label>' + chipsHtml('cat', db.cats.map(function (c) { return [c, c]; }), t.cat) +
    '<label>Repeat</label><select id="f_rep">' + opt(REP, t.repeat) + '</select>' +
    '<div id="f_everyBox" style="display:' + (t.repeat === 'everyN' ? 'block' : 'none') + '"><label>Every how many days</label><input id="f_every" type="number" min="1" value="' + (t.everyN || 2) + '"></div>' +
    '<label>Remind me before (pick any)</label>' + chipsHtml('pres', PRE_OPTS.map(function (m) { return [m, durLabel(m)]; }), (t.pres || []).map(String), true) +
    '<label>When it\'s due</label>' + chipsHtml('style', [['alarm', '⏰ Ring like an alarm until I act'], ['notify', '🔔 Notification only']], t.style) +
    '<label>Follow up if not marked done</label><select id="f_follow">' + opt(FOLLOW, t.follow) + '</select>' +
    '<div class="two"><div><label>Priority</label><select id="f_pri">' + opt({ normal: 'Normal', high: 'High' }, t.priority) + '</select></div><div><label>Sound</label><select id="f_tone">' + opt(TONES, t.tone) + '</select></div></div>' +
    '<label>Details (optional)</label><textarea id="f_notes" rows="3" placeholder="Amount, account no., address, what to bring…">' + esc(t.notes || '') + '</textarea>' +
    '<div class="btns"><button class="btn" id="f_save">' + I.check + 'Save</button><button class="btn sec" data-act="close">Cancel</button>' + (isNew ? '' : '<button class="btn danger" id="f_del">' + I.trash + '</button>') + '</div>');
  $('#f_rep').onchange = function () { $('#f_everyBox').style.display = this.value === 'everyN' ? 'block' : 'none'; };
  if (isNew) {
    $('#f_mic').onclick = async function () {
      var text = await listen(); if (!text) return;
      var p = parseTask(text).draft; $('#f_title').value = p.title || text;
      if (p.dueAt) { var x = new Date(p.dueAt); $('#f_date').value = ymd(x); $('#f_time').value = hm(x); }
      if (p.repeat !== 'none') $('#f_rep').value = p.repeat;
      toast('Check the details, then Save');
    };
    var ti = $('#f_title'); setTimeout(function () { ti.focus(); var L = ti.value.length; if (t.title && t.title.charAt(0) === "'") ti.setSelectionRange(0, 0); else ti.setSelectionRange(L, L); }, 200);
  }
  $('#f_save').onclick = function () {
    var title = val('f_title').trim();
    if (!title) { toast('Enter what to do'); return; }
    if (!val('f_date')) { toast('Choose a date'); return; }
    var o = { title: title, dueAt: parseLocal(val('f_date'), val('f_time') || '09:00').toISOString(), cat: chipsVal('cat') || 'Personal', repeat: val('f_rep'), everyN: Math.max(1, +val('f_every') || 2),
      pres: chipsVal('pres').map(Number), style: chipsVal('style') || 'alarm', follow: val('f_follow'), priority: val('f_pri'), tone: val('f_tone'), notes: val('f_notes').trim(), updatedAt: new Date().toISOString() };
    if (isNew) { o.id = uid(); o.done = false; o.doneOcc = {}; o.createdAt = o.updatedAt; db.tasks.push(o); }
    else { var timeChanged = t.dueAt !== o.dueAt; for (var k in o) t[k] = o[k]; if (t.repeat === 'none' && timeChanged && new Date(t.dueAt) > new Date()) t.done = false; }
    save(); rescheduleAll(); closeSheet(); render();
    var nd = new Date(o.dueAt);
    toast(nd < new Date() && o.repeat === 'none' ? 'Saved (time is in the past)' : 'Saved · ' + whenLabel(isNew ? nextOcc(o) : nextOcc(t)));
  };
  if (!isNew) $('#f_del').onclick = function () { deleteTask(t); };
}
function taskDetail(id, atMs) {
  var t = taskById(id); if (!t) return;
  var at = atMs ? new Date(+atMs) : nextOcc(t), done = isOccDone(t, at);
  var hist = Object.keys(t.doneOcc || {}).sort().reverse().slice(0, 8);
  var rows = [
    ['When', whenLabel(at) + ' (' + relLabel(at) + ')'], ['Repeat', repLabel(t)], ['Reminders', preLabel(t.pres)],
    ['Alert', t.style === 'alarm' ? '⏰ Rings until Done / Snooze' : '🔔 Notification'], ['Follow-up', FOLLOW[t.follow] || 'Off'],
    ['Category', t.cat], ['Priority', t.priority === 'high' ? 'High' : 'Normal'], ['Sound', TONES[t.tone] || 'Default']
  ];
  if (t.repeat !== 'none') rows.push(['Next 3', occsFrom(t, new Date(), 3).map(function (d) { return dayLabel(d); }).join(' · ')]);
  sheet('<h3>' + esc(t.title) + '</h3>' + (done ? '<span class="tag ok">✓ Done</span>' : (at < new Date() ? '<span class="tag hi">Overdue</span>' : '<span class="tag">Pending</span>')) +
    '<div class="card" style="margin-top:10px">' + rows.map(function (r) { return '<div class="kv"><div class="grow"><div class="k">' + r[0] + '</div><div class="v" style="word-break:normal">' + esc(r[1]) + '</div></div></div>'; }).join('') +
    (t.notes ? '<div class="kv"><div class="grow"><div class="k">Details</div><div class="v" style="white-space:pre-wrap;word-break:normal">' + esc(t.notes) + '</div></div><button class="ib" data-act="copytxt" data-v="' + esc(t.notes) + '">' + I.copy + '</button></div>' : '') +
    (hist.length ? '<div class="kv"><div class="grow"><div class="k">Completed</div><div class="v">' + hist.map(function (k) { return k; }).join(', ') + '</div></div></div>' : '') + '</div>' +
    '<div class="btns"><button class="btn ' + (done ? 'sec' : 'ok') + '" data-act="tdone2" data-id="' + t.id + '" data-at="' + at.getTime() + '">' + (done ? 'Mark not done' : I.check + 'Mark done') + '</button>' +
    '<button class="btn sec" data-act="tedit" data-id="' + t.id + '">' + I.edit + 'Edit</button><button class="btn sec" data-act="tdup" data-id="' + t.id + '">Duplicate</button><button class="btn danger" data-act="tdel" data-id="' + t.id + '">' + I.trash + '</button></div>');
}

function routineForm(id) {
  var r = db.routine.filter(function (x) { return x.id === +id; })[0], isNew = !r;
  if (isNew) r = { text: '', time: '', days: [], style: 'notify' };
  sheet('<h3>' + (isNew ? 'Routine item' : 'Edit routine item') + '</h3>' +
    '<label>What (e.g. Take medicine, Check emails)</label><input id="r_text" value="' + esc(r.text) + '">' +
    '<label>Reminder time (optional)</label><input id="r_time" type="time" value="' + esc(r.time) + '">' +
    '<label>Days (none selected = every day)</label>' + chipsHtml('days', DOW.map(function (d, i) { return [String(i), d]; }), (r.days || []).map(String), true) +
    '<label>Alert</label>' + chipsHtml('rstyle', [['notify', '🔔 Notification'], ['alarm', '⏰ Ring until done']], r.style) +
    '<div class="btns"><button class="btn" id="r_save">Save</button><button class="btn sec" data-act="close">Cancel</button>' + (isNew ? '' : '<button class="btn danger" id="r_del">' + I.trash + '</button>') + '</div>');
  setTimeout(function () { $('#r_text') && $('#r_text').focus(); }, 200);
  $('#r_save').onclick = function () {
    var text = val('r_text').trim(); if (!text) { toast('Enter a name'); return; }
    var o = { text: text, time: val('r_time'), days: chipsVal('days').map(Number), style: chipsVal('rstyle') || 'notify' };
    if (isNew) { o.id = uid(); o.doneDates = {}; db.routine.push(o); } else for (var k in o) r[k] = o[k];
    save(); rescheduleAll(); closeSheet(); render();
  };
  if (!isNew) $('#r_del').onclick = function () {
    var idx = db.routine.indexOf(r); db.routine.splice(idx, 1); save(); rescheduleSoon(); closeSheet(); render();
    toast('Removed', function () { db.routine.splice(idx, 0, r); save(); rescheduleSoon(); render(); });
  };
}
function noteForm(id) {
  var n = db.notes.filter(function (x) { return x.id === +id; })[0], isNew = !n;
  if (isNew) n = { title: '', text: '', pinned: false };
  sheet('<h3>' + (isNew ? 'Quick note' : 'Note') + '</h3><input id="n_title" placeholder="Title (optional)" value="' + esc(n.title) + '">' +
    '<textarea id="n_text" rows="8" placeholder="Write anything…">' + esc(n.text) + '</textarea>' +
    '<label class="inl"><input type="checkbox" id="n_pin"' + (n.pinned ? ' checked' : '') + '> Pin to Today screen</label>' +
    '<div class="btns"><button class="btn" id="n_save">Save</button><button class="btn sec" data-act="close">Cancel</button>' +
    (isNew ? '' : '<button class="btn sec" id="n_copy">' + I.copy + '</button><button class="btn sec" id="n_task">⏰ Reminder</button><button class="btn danger" id="n_del">' + I.trash + '</button>') + '</div>');
  setTimeout(function () { if (isNew) $('#n_text').focus(); }, 200);
  $('#n_save').onclick = function () {
    var text = val('n_text').trim(), title = val('n_title').trim(); if (!text && !title) { closeSheet(); return; }
    var now = new Date().toISOString();
    if (isNew) db.notes.unshift({ id: uid(), title: title, text: text, pinned: $('#n_pin').checked, at: now, updated: now });
    else { n.title = title; n.text = text; n.pinned = $('#n_pin').checked; n.updated = now; }
    save(); closeSheet(); render(); toast('Note saved');
  };
  if (!isNew) {
    $('#n_copy').onclick = function () { copyText((n.title ? n.title + '\n' : '') + n.text, 'Note copied'); };
    $('#n_task').onclick = function () { taskForm(null, { title: (n.title || n.text).slice(0, 80), notes: n.title ? n.text : '' }); };
    $('#n_del').onclick = function () { var idx = db.notes.indexOf(n); db.notes.splice(idx, 1); save(); closeSheet(); render(); toast('Note deleted', function () { db.notes.splice(idx, 0, n); save(); render(); }); };
  }
}

/* ---- vault forms ---- */
function genPassword(len) {
  var sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%&*?-_+='], all = sets.join(''), out = [];
  var rnd = crypto.getRandomValues(new Uint32Array(len + 4));
  sets.forEach(function (s, i) { out.push(s[rnd[i] % s.length]); });
  for (var i = 4; i < len; i++) out.push(all[rnd[i] % all.length]);
  for (var j = out.length - 1; j > 0; j--) { var k = rnd[j] % (j + 1); var tmp = out[j]; out[j] = out[k]; out[k] = tmp; }
  return out.join('');
}
function vaultForm(id) {
  if (!VAULT.items) { toast('Unlock first'); return; }
  var v = VAULT.items.filter(function (x) { return x.id === +id; })[0], isNew = !v;
  if (isNew) v = { name: '', catId: vaultCat || 'other', user: '', pass: '', url: '', notes: '', fields: [], fav: false, rotate: null };
  var fields = (v.fields || []).map(function (f) { return { label: f.label, value: f.value, secret: f.secret }; });
  function fieldsHtml() {
    return fields.map(function (f, i) { return '<div class="card" style="padding:8px 10px"><div class="two"><input data-fl="' + i + '" placeholder="Label (e.g. PIN, Security answer)" value="' + esc(f.label) + '"><input data-fv="' + i + '" placeholder="Value" value="' + esc(f.value) + '"></div><div class="row"><label class="inl grow" style="margin:0"><input type="checkbox" data-fs="' + i + '"' + (f.secret ? ' checked' : '') + '> Hide value</label><button class="btn danger sm" data-frm="' + i + '">Remove</button></div></div>'; }).join('');
  }
  var rot = v.rotate === null || v.rotate === undefined ? 'default' : String(v.rotate);
  sheet('<h3>' + (isNew ? 'Save account' : 'Edit account') + '</h3>' +
    '<label>Name</label><input id="v_name" value="' + esc(v.name) + '" placeholder="e.g. Amazon Seller Central, Gmail (work)">' +
    '<label>Category</label>' + chipsHtml('vcat', db.vcats.map(function (c) { return [c.id, c.icon + ' ' + c.name]; }), v.catId) +
    '<label>Email / username</label><input id="v_user" value="' + esc(v.user) + '" autocapitalize="off" autocomplete="off" spellcheck="false">' +
    '<label>Password</label><div class="row"><input id="v_pass" class="pw" value="' + esc(v.pass) + '" autocapitalize="off" autocomplete="off" spellcheck="false" style="margin-bottom:0"><button class="btn sec sm" id="v_gen">' + I.dice + '</button></div><div id="v_strength" class="mut" style="margin:4px 0 12px"></div>' +
    '<label>Website (optional)</label><input id="v_url" value="' + esc(v.url || '') + '" autocapitalize="off" placeholder="https://…">' +
    '<label>Extra fields (each gets its own Copy button)</label><div id="v_fields">' + fieldsHtml() + '</div><button class="btn sec sm" id="v_addf" style="margin-bottom:12px">＋ Add field</button>' +
    '<label>Notes</label><textarea id="v_notes" rows="2">' + esc(v.notes || '') + '</textarea>' +
    '<label>Remind me to change this password</label><select id="v_rot">' + opt({ 'default': 'Default (' + (+db.settings.pwRotateDays ? 'every ' + db.settings.pwRotateDays + ' days' : 'off') + ')', '30': 'Every 30 days', '60': 'Every 60 days', '90': 'Every 90 days', '180': 'Every 180 days', '0': 'Never' }, rot) + '</select>' +
    '<label class="inl"><input id="v_fav" type="checkbox"' + (v.fav ? ' checked' : '') + '> ★ Favorite</label>' +
    '<div class="btns"><button class="btn" id="v_save">Save</button><button class="btn sec" data-act="close">Cancel</button></div>');
  function strength() { var p = val('v_pass'), sc = 0; if (p.length >= 10) sc++; if (p.length >= 14) sc++; if (/[A-Z]/.test(p) && /[a-z]/.test(p)) sc++; if (/\d/.test(p)) sc++; if (/[^A-Za-z0-9]/.test(p)) sc++; $('#v_strength').textContent = p ? 'Strength: ' + ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'][sc] : ''; }
  function readFields() { fields.forEach(function (f, i) { f.label = $('[data-fl="' + i + '"]').value; f.value = $('[data-fv="' + i + '"]').value; f.secret = $('[data-fs="' + i + '"]').checked; }); }
  function bindFields() { $$('[data-frm]').forEach(function (b) { b.onclick = function () { readFields(); fields.splice(+b.getAttribute('data-frm'), 1); $('#v_fields').innerHTML = fieldsHtml(); bindFields(); }; }); }
  bindFields(); strength();
  $('#v_pass').oninput = strength;
  $('#v_gen').onclick = function () { $('#v_pass').value = genPassword(16); strength(); };
  $('#v_addf').onclick = function () { readFields(); fields.push({ label: '', value: '', secret: false }); $('#v_fields').innerHTML = fieldsHtml(); bindFields(); };
  $('#v_save').onclick = async function () {
    var name = val('v_name').trim(); if (!name) { toast('Enter a name'); return; }
    readFields();
    var r = val('v_rot');
    var o = { name: name, catId: chipsVal('vcat') || 'other', user: val('v_user').trim(), pass: val('v_pass'), url: val('v_url').trim(), notes: val('v_notes'),
      fields: fields.filter(function (f) { return f.label || f.value; }), fav: $('#v_fav').checked, rotate: r === 'default' ? null : +r };
    if (isNew) { o.id = uid(); o.pwChangedAt = new Date().toISOString(); o.createdAt = o.pwChangedAt; VAULT.items.push(o); }
    else { if (o.pass !== v.pass) o.pwChangedAt = new Date().toISOString(); for (var k in o) v[k] = o[k]; }
    await saveVault(); rescheduleSoon(); closeSheet(); openV = isNew ? o.id : v.id; render(); toast('Saved & encrypted');
  };
}
var EMOJIS = ['🛒', '📧', '📷', '💬', '🏦', '💼', '🎬', '🎮', '☁️', '🛍️', '📦', '💳', '🏠', '🎓', '✈️', '🔐', '🌐', '📱', '🧾', '⭐'];
var SUGGEST_VCATS = [['Amazon', '📦'], ['Gmail', '📧'], ['Instagram', '📷'], ['Facebook', '💬'], ['WhatsApp', '📱'], ['LinkedIn', '💼'], ['Walmart', '🛒'], ['Bank', '🏦'], ['Cloud', '☁️']];
function vcatForm(id) {
  var c = db.vcats.filter(function (x) { return x.id === id; })[0], isNew = !c;
  if (isNew) c = { name: '', icon: '🔐' };
  var used = db.vcats.map(function (x) { return x.name.toLowerCase(); });
  sheet('<h3>' + (isNew ? 'New category' : 'Edit category') + '</h3>' +
    (isNew ? '<div class="chips">' + SUGGEST_VCATS.filter(function (s) { return used.indexOf(s[0].toLowerCase()) < 0; }).map(function (s) { return '<button class="chip" data-sug="' + s[0] + '" data-ic="' + s[1] + '">' + s[1] + ' ' + s[0] + '</button>'; }).join('') + '</div>' : '') +
    '<label>Name</label><input id="c_name" value="' + esc(c.name) + '" placeholder="e.g. Amazon, Gmail, Instagram">' +
    '<label>Icon</label>' + chipsHtml('icon', EMOJIS.map(function (e) { return [e, e]; }), c.icon) +
    '<div class="btns"><button class="btn" id="c_save">Save</button><button class="btn sec" data-act="close">Cancel</button>' + (isNew || c.id === 'other' ? '' : '<button class="btn danger" id="c_del">Delete</button>') + '</div>');
  $$('[data-sug]').forEach(function (b) { b.onclick = function () { $('#c_name').value = b.getAttribute('data-sug'); var ic = b.getAttribute('data-ic'); $$('[data-chips="icon"] .chip').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-cv') === ic); }); }; });
  $('#c_save').onclick = async function () {
    var name = val('c_name').trim(); if (!name) return;
    if (isNew) { var nid = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + uid(); db.vcats.push({ id: nid, name: name, icon: chipsVal('icon') || '🔐' }); vaultCat = nid; }
    else { c.name = name; c.icon = chipsVal('icon') || c.icon; }
    save(); closeSheet(); render();
  };
  if (!isNew && $('#c_del')) $('#c_del').onclick = async function () {
    (VAULT.items || []).forEach(function (v) { if (v.catId === c.id) v.catId = 'other'; });
    db.vcats = db.vcats.filter(function (x) { return x !== c; }); vaultCat = '';
    await saveVault(); save(); closeSheet(); render(); toast('Category deleted — its accounts moved to Other');
  };
}

/* ================= SEARCH ================= */
function openSearch(q) {
  var s = $('#search'); s.classList.add('on');
  var inp = $('#sq'); inp.value = q || ''; runSearch(); setTimeout(function () { inp.focus(); }, 100);
}
function closeSearch() { $('#search').classList.remove('on'); }
function hlText(text, words) {
  var out = esc(text);
  words.forEach(function (w) { if (!w) return; out = out.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<span class="hl">$1</span>'); });
  return out;
}
function runSearch() {
  var q = $('#sq').value.trim().toLowerCase(), box = $('#sres');
  if (!q) { box.innerHTML = '<div class="empty">' + I.search + 'Search tasks, routine, notes and vault.<br>One word is enough.</div>'; return; }
  var words = q.split(/\s+/).filter(Boolean);
  function match(h) { h = h.toLowerCase(); return words.every(function (w) { return h.indexOf(w) >= 0; }); }
  var h = '';
  var ts = db.tasks.filter(function (t) { return match(t.title + ' ' + t.cat + ' ' + (t.notes || '') + ' ' + repLabel(t)); });
  if (ts.length) h += '<h2>Tasks <span class="cnt">' + ts.length + '</span></h2>' + ts.map(function (t) {
    var n = nextOcc(t);
    return '<div class="card" data-act="tview" data-id="' + t.id + '" data-at="' + n.getTime() + '"><div class="title">' + hlText(t.title, words) + '</div><div class="when">' + esc(whenLabel(n)) + ' · ' + esc(repLabel(t)) + (t.repeat === 'none' && t.done ? ' · ✓ done' : '') + '</div>' + (t.notes ? '<div class="mut">' + hlText(t.notes.slice(0, 140), words) + '</div>' : '') + '<span class="tag">' + esc(t.cat) + '</span></div>';
  }).join('');
  var rs = db.routine.filter(function (r) { return match(r.text); });
  if (rs.length) h += '<h2>Routine</h2>' + rs.map(function (r) { return '<div class="card" data-act="redit" data-id="' + r.id + '"><div class="title">' + hlText(r.text, words) + '</div><div class="when">' + (r.time || 'No reminder') + '</div></div>'; }).join('');
  var ns = db.notes.filter(function (n) { return match(n.title + ' ' + n.text); });
  if (ns.length) h += '<h2>Notes</h2>' + ns.map(function (n) { return '<div class="card" data-act="nedit" data-id="' + n.id + '">' + (n.title ? '<div class="title">' + hlText(n.title, words) + '</div>' : '') + '<div class="small-note">' + hlText(n.text.slice(0, 300), words) + '</div></div>'; }).join('');
  var vs = (VAULT.items || []).filter(function (v) { return match(v.name + ' ' + v.user + ' ' + vcat(v.catId).name + ' ' + (v.url || '') + ' ' + (v.notes || '')); });
  if (vs.length) h += '<h2>Vault</h2>' + vs.map(function (v) { return '<div class="card row"><div class="cicon">' + vcat(v.catId).icon + '</div><div class="grow" data-act="vgo" data-id="' + v.id + '"><div class="title">' + hlText(v.name, words) + '</div><div class="mut">' + hlText(v.user || '', words) + '</div></div><button class="btn sm" data-act="vcopy" data-id="' + v.id + '" data-f="pass">' + I.copy + 'Pass</button></div>'; }).join('');
  box.innerHTML = h || '<div class="empty">No results for "' + esc(q) + '"</div>';
}

/* ================= HEALTH CHECK (lock-screen reliability) ================= */
var healthBad = [], lastStatus = null;
async function getStatus() { if (!P.RmAlarm) return null; try { lastStatus = await P.RmAlarm.status(); } catch (e) { jlog('status ' + e.message); } return lastStatus; }
function healthItems(s) {
  if (!s) return [];
  var oem = (s.manufacturer || '').toLowerCase(), list = [];
  list.push({ ok: s.notifications, name: 'Notifications allowed', fix: 'notif', why: 'Without this nothing can show or ring.' });
  list.push({ ok: s.ringChannelImportance >= 4, name: 'Alarm channel set to “Urgent / Pop on screen”', fix: 'channel', why: 'Needed so the alarm pops up over the lock screen.' });
  list.push({ ok: s.exactAlarm, name: 'Alarms & reminders permission', fix: 'exact', why: 'Lets reminders fire at the exact minute instead of being delayed.' });
  list.push({ ok: s.fullScreen, name: 'Full-screen alerts on lock screen', fix: 'fullscreen', why: 'Shows the big alarm screen when the phone is locked.' });
  list.push({ ok: s.batteryIgnored, name: 'Battery optimisation off for RemindMe', fix: 'battery', why: 'Stops the phone from putting alarms to sleep.' });
  list.push({ ok: s.overlay, name: 'Display over other apps', fix: 'overlay', why: 'Lets the alarm screen open by itself on phones like Xiaomi, Oppo, Vivo, Infinix.', optional: true });
  list.push({ ok: s.alarmVolume > 0, name: 'Alarm volume above zero', fix: 'alarmVolume', why: 'RemindMe raises it while ringing, but some phones block that.', optional: true });
  if (/xiaomi|redmi|poco/.test(oem)) list.push({ ok: null, name: 'Xiaomi: “Show on Lock screen” + “Display pop-up windows while running in background”', fix: 'miui', why: 'Xiaomi blocks lock-screen alarms by default. Turn both ON in Other permissions.' });
  if (/xiaomi|redmi|poco|oppo|realme|vivo|iqoo|huawei|honor|oneplus|infinix|tecno|itel|asus|letv|samsung/.test(oem)) list.push({ ok: null, name: 'Autostart / background activity allowed', fix: 'autostart', why: 'Your phone brand (' + s.manufacturer + ') can kill apps in the background. Allow Autostart / “No restrictions”.' });
  return list;
}
async function checkHealthQuiet() {
  var s = await getStatus(); if (!s) { healthBad = []; return; }
  healthBad = healthItems(s).filter(function (x) { return x.ok === false && !x.optional; }).map(function (x) { return x.name; });
  if (view === 'today') render();
}
async function healthSheet(first) {
  var s = await getStatus();
  var items = healthItems(s);
  var h = '<h3>' + (first ? 'Make alarms ring on the lock screen' : 'Alarm health check') + '</h3><div class="mut" style="margin-bottom:10px">' +
    (s ? 'Fix every red item. Then tap “Test alarm”, lock your phone and wait.' : 'Only available in the installed app.') + '</div>';
  if (s) {
    h += '<div class="card">' + items.map(function (x) {
      return '<div class="status"><span class="dot ' + (x.ok === true ? 'g' : x.ok === false ? (x.optional ? 'a' : 'r') : 'a') + '"></span><div class="grow"><div style="font-weight:600;font-size:14.5px">' + esc(x.name) + '</div><div class="mut">' + esc(x.ok === null ? 'Cannot be checked automatically — ' + x.why : x.why) + '</div></div>' +
        (x.ok === true ? '<span class="mut">OK</span>' : '<button class="btn sm' + (x.ok === false && !x.optional ? '' : ' sec') + '" data-act="fix" data-v="' + x.fix + '">Open</button>') + '</div>';
    }).join('') + '</div>';
    h += '<div class="btns"><button class="btn" data-act="testring">⏰ Test alarm in 10 s</button><button class="btn sec" data-act="testnotif">🔔 Test notification</button><button class="btn sec" data-act="health">↻ Re-check</button></div>' +
      '<div class="mut" style="margin-top:10px">After pressing Test, lock the phone immediately. You should hear the alarm and see the full-screen alarm with Done / Snooze.</div>';
  }
  h += '<div class="btns" style="margin-top:14px"><button class="btn sec block" data-act="setupdone">' + (first ? 'Done — continue to app' : 'Close') + '</button></div>';
  sheet(h);
  healthBad = items.filter(function (x) { return x.ok === false && !x.optional; }).map(function (x) { return x.name; });
}
async function requestNotif() { try { if (P.LocalNotifications) await P.LocalNotifications.requestPermissions(); } catch (e) {} }

/* ================= SETTINGS ================= */
function viewSettings() {
  var s = db.settings, ai = s.ai;
  function sel(id, map, v) { return '<select id="' + id + '">' + opt(map, v) + '</select>'; }
  var h = '';
  h += '<h2>Alarm reliability</h2><div class="card"><div class="row"><div class="grow"><b>' + (healthBad.length ? '⚠ ' + healthBad.length + ' issue(s) found' : '✓ Check lock-screen ringing') + '</b><div class="mut">Permissions, battery, lock screen, phone-brand settings</div></div><button class="btn sm" data-act="health">Open</button></div></div>';
  h += '<h2>Alarm behaviour</h2><div class="card">' +
    '<label>Snooze length</label>' + sel('s_snooze', { 5: '5 minutes', 10: '10 minutes', 15: '15 minutes', 30: '30 minutes', 60: '1 hour' }, s.snoozeMin) +
    '<label>If I don’t respond, ring again every</label>' + sel('s_rering', { 0: 'Don’t ring again', 2: '2 minutes', 5: '5 minutes', 10: '10 minutes', 15: '15 minutes', 30: '30 minutes' }, s.reRingMin) +
    '<label>Stop ringing again after</label>' + sel('s_maxrep', { 0: 'Never — until Done', 3: '3 times', 5: '5 times', 10: '10 times', 20: '20 times' }, s.maxRepeats) +
    '<label>Each ring lasts</label>' + sel('s_ringsec', { 30: '30 seconds', 60: '1 minute', 120: '2 minutes', 300: '5 minutes' }, s.ringSec) +
    '<label>Default sound</label>' + sel('s_tone', TONES, s.defaultTone) +
    '<label class="inl"><input type="checkbox" id="s_vol"' + (s.forceVolume ? ' checked' : '') + '> Raise alarm volume if it is too low</label>' +
    '<label class="inl"><input type="checkbox" id="s_vib"' + (s.vibrate ? ' checked' : '') + '> Vibrate</label></div>';
  h += '<h2>Daily summary</h2><div class="card">' +
    '<label class="inl"><input type="checkbox" id="s_sum"' + (s.summaryOn ? ' checked' : '') + '> Morning summary of the day</label><input type="time" id="s_sumt" value="' + esc(s.summaryTime) + '">' +
    '<label class="inl"><input type="checkbox" id="s_eve"' + (s.eveningOn ? ' checked' : '') + '> Evening review (what’s left + tomorrow)</label><input type="time" id="s_evet" value="' + esc(s.eveningTime) + '"></div>';
  h += '<h2>Security</h2><div class="card">' +
    '<label class="inl"><input type="checkbox" id="s_bio"' + (s.bio ? ' checked' : '') + '> Unlock with fingerprint</label>' +
    '<label>Lock the app after leaving it for</label>' + sel('s_lock', { 0: 'Immediately', 30: '30 seconds', 60: '1 minute', 300: '5 minutes', 900: '15 minutes' }, s.lockAfter) +
    '<label>Password change reminders (default for all accounts)</label>' + sel('s_rot', { 0: 'Off', 30: 'Every 30 days', 60: 'Every 60 days', 90: 'Every 90 days' }, s.pwRotateDays) +
    '<label class="inl"><input type="checkbox" id="s_secure"' + (s.secure ? ' checked' : '') + '> Hide app in recent apps & block screenshots</label>' +
    '<div class="btns"><button class="btn sec sm" data-act="chpin">Change PIN</button><button class="btn sec sm" data-act="lock">Lock now</button></div></div>';
  h += '<h2>Appearance</h2><div class="card"><label>Theme</label>' + chipsHtml('theme', [['light', '☀ Light'], ['dark', '🌙 Dark'], ['auto', 'Auto']], s.theme) +
    '<label>Accent colour</label><div class="chips">' + ['#4f46e5', '#0d9488', '#e11d48', '#d97706', '#16a34a', '#0284c7', '#7c3aed', '#334155'].map(function (c) { return '<button class="swatch' + (s.accent === c ? ' on' : '') + '" data-act="accent" data-v="' + c + '" style="background:' + c + '"></button>'; }).join('') + '</div></div>';
  h += '<h2>Task categories</h2><div class="card"><div class="chips">' + db.cats.map(function (c) { return '<button class="chip" data-act="catdel" data-v="' + esc(c) + '">' + esc(c) + ' ✕</button>'; }).join('') + '</div><div class="row"><input id="s_newcat" placeholder="New category" style="margin:0"><button class="btn sm" data-act="catadd">Add</button></div></div>';
  h += '<h2>Vault categories</h2><div class="card"><div class="chips">' + db.vcats.map(function (c) { return '<button class="chip" data-act="vcatedit" data-v="' + esc(c.id) + '">' + c.icon + ' ' + esc(c.name) + '</button>'; }).join('') + '<button class="chip" data-act="vcatadd">＋ Add</button></div></div>';
  h += '<h2>AI assistant</h2><div class="card"><label>Engine</label>' + sel('s_aiprov', { offline: 'Offline (built-in, free, no internet)', gemini: 'Google Gemini (free API key)', openai: 'OpenAI', anthropic: 'Anthropic Claude', compat: 'OpenAI-compatible (Groq, OpenRouter…)' }, ai.provider) +
    '<div id="aiBox" style="display:' + (ai.provider === 'offline' ? 'none' : 'block') + '"><label>API key</label><input id="s_aikey" type="password" value="' + esc(ai.key) + '" autocomplete="off" placeholder="Paste your key">' +
    '<label>Model</label><input id="s_aimodel" value="' + esc(ai.model) + '" placeholder="' + esc(AI_DEFAULT_MODEL[ai.provider] || '') + '">' +
    '<div id="aiBase" style="display:' + (ai.provider === 'compat' ? 'block' : 'none') + '"><label>Base URL</label><input id="s_aibase" value="' + esc(ai.baseUrl) + '" placeholder="https://api.groq.com/openai/v1"></div>' +
    '<div class="mut">Get a free Gemini key at aistudio.google.com → “Get API key”. Only your request and task titles are sent — never vault data.</div>' +
    '<div class="btns"><button class="btn sec sm" data-act="aitest">Test connection</button></div></div></div>';
  h += '<h2>Voice</h2><div class="card"><label>Voice input language</label>' + sel('s_vl', { 'en-US': 'English (US)', 'en-GB': 'English (UK)', 'ur-PK': 'Urdu', 'hi-IN': 'Hindi', 'ar-SA': 'Arabic' }, s.voiceLang) + '</div>';
  h += '<h2>Location reminders</h2>' + (db.locs.length ? db.locs.map(function (l) { return '<div class="card"><div class="title">📍 ' + esc(l.place) + '</div><div>' + esc(l.text) + '</div><div class="mut">' + l.radius + ' m · ' + (l.active ? 'On' : 'Off') + '</div><div class="btns"><button class="btn sec sm" data-act="ltog" data-id="' + l.id + '">' + (l.active ? 'Turn off' : 'Turn on') + '</button><button class="btn danger sm" data-act="ldel" data-id="' + l.id + '">Delete</button></div></div>'; }).join('') : '') +
    '<div class="card"><div class="mut">Get reminded when you arrive somewhere.</div><div class="btns"><button class="btn sec sm" data-act="ladd">＋ Location reminder</button></div></div>';
  h += '<h2>Backup</h2><div class="card"><div class="mut" style="margin-bottom:6px">Everything (tasks, routine, notes, encrypted vault, settings) in one file. Restoring needs the PIN you had when the backup was made.</div>' +
    '<label class="inl"><input type="checkbox" id="s_auto"' + (s.autoBackup ? ' checked' : '') + '> Automatic daily backup to Documents/RemindMe</label>' +
    '<div class="mut">Last backup: ' + (s.lastAutoBackup ? new Date(s.lastAutoBackup).toLocaleString() : 'never') + '</div>' +
    '<div class="btns"><button class="btn sm" data-act="backup">Save backup now</button><button class="btn sec sm" data-act="sharebk">Share / send</button><button class="btn sec sm" data-act="restore">Restore</button></div></div>';
  h += '<h2>Diagnostics</h2><div class="card"><div class="mut">If something does not work, copy this report and send it.</div><div class="btns"><button class="btn sm" data-act="dbgcopy">' + I.copy + 'Copy debug report</button><button class="btn sec sm" data-act="dbgsave">Save report</button><button class="btn sec sm" data-act="dbgview">View</button><button class="btn sec sm" data-act="dbgclear">Clear logs</button></div>' +
    '<div class="mut" style="margin-top:8px">Last sync: ' + (lastSync.at ? new Date(lastSync.at).toLocaleTimeString() + ' · ' + lastSync.count + ' alarms scheduled' + (lastSync.error ? ' · ' + esc(lastSync.error) : '') : '—') + '</div></div>';
  h += '<div class="mut" style="text-align:center;margin:24px 0">RemindMe v' + APP_VERSION + ' · works offline · data stays on this phone</div>';
  return h;
}
function bindSettings() {
  var s = db.settings;
  function on(id, ev, fn) { var e = $('#' + id); if (e) e[ev] = fn; }
  function num(id, key, resync) { on(id, 'onchange', function () { s[key] = +this.value; save(); if (resync) rescheduleSoon(); }); }
  num('s_snooze', 'snoozeMin', 1); num('s_rering', 'reRingMin', 1); num('s_maxrep', 'maxRepeats', 1); num('s_ringsec', 'ringSec', 1); num('s_lock', 'lockAfter'); num('s_rot', 'pwRotateDays', 1);
  on('s_tone', 'onchange', function () { s.defaultTone = this.value; save(); });
  on('s_vol', 'onchange', function () { s.forceVolume = this.checked; save(); rescheduleSoon(); });
  on('s_vib', 'onchange', function () { s.vibrate = this.checked; save(); rescheduleSoon(); });
  on('s_sum', 'onchange', function () { s.summaryOn = this.checked; save(); rescheduleSoon(); });
  on('s_sumt', 'onchange', function () { if (this.value) { s.summaryTime = this.value; save(); rescheduleSoon(); } });
  on('s_eve', 'onchange', function () { s.eveningOn = this.checked; save(); rescheduleSoon(); });
  on('s_evet', 'onchange', function () { if (this.value) { s.eveningTime = this.value; save(); rescheduleSoon(); } });
  on('s_vl', 'onchange', function () { s.voiceLang = this.value; save(); });
  on('s_auto', 'onchange', function () { s.autoBackup = this.checked; save(); });
  on('s_secure', 'onchange', function () { s.secure = this.checked; save(); applySecure(); });
  on('s_bio', 'onchange', async function () {
    var el = this, B = P.NativeBiometric; extNav = Date.now();
    if (!el.checked) { s.bio = false; save(); try { await B.deleteCredentials({ server: 'com.remindme.app.vault' }); } catch (e) {} return; }
    try {
      var a = await B.isAvailable(); if (!a.isAvailable) throw new Error('No fingerprint set up on this phone');
      await B.verifyIdentity({ reason: 'Turn on fingerprint unlock', title: 'RemindMe' });
      s.bio = true; save(); await storeBioKey(); toast('Fingerprint unlock on');
    } catch (e) { el.checked = false; toast('Fingerprint not available: ' + (e.message || e)); }
  });
  on('s_aiprov', 'onchange', function () { s.ai.provider = this.value; save(); render(); });
  on('s_aikey', 'onchange', function () { s.ai.key = this.value.trim(); save(); });
  on('s_aimodel', 'onchange', function () { s.ai.model = this.value.trim(); save(); });
  on('s_aibase', 'onchange', function () { s.ai.baseUrl = this.value.trim(); save(); });
  $$('[data-chips="theme"] .chip').forEach(function (b) { b.addEventListener('click', function () { setTimeout(function () { s.theme = chipsVal('theme'); save(); applyTheme(); }, 0); }); });
}
function applyTheme() {
  var t = db.settings.theme, dark = t === 'dark' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.style.setProperty('--pri', db.settings.accent || '#4f46e5');
  var meta = $('meta[name=theme-color]'); if (meta) meta.content = dark ? '#0c0f18' : '#f5f6fb';
}
function applySecure() { if (P.RmAlarm) P.RmAlarm.setSecure({ on: !!db.settings.secure }).catch(function () {}); }

/* ================= BACKUP ================= */
function backupJson() {
  var copy = JSON.parse(JSON.stringify(db));
  copy.settings.ai = { provider: copy.settings.ai.provider, key: '', model: copy.settings.ai.model, baseUrl: copy.settings.ai.baseUrl };
  copy.backupMeta = { app: 'RemindMe', version: APP_VERSION, at: new Date().toISOString() };
  return JSON.stringify(copy, null, 1);
}
function bkName() { var d = new Date(); return 'remindme-backup-' + ymd(d) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + '.json'; }
async function backupNow() {
  try { if (VAULT.items) await saveVault(); var r = await writeDoc(bkName(), backupJson()); db.settings.lastAutoBackup = new Date().toISOString(); save(); toast('Saved to ' + r.where); render(); }
  catch (e) { toast('Backup failed: ' + e.message); jlog('backup ' + e.message); }
}
async function maybeAutoBackup() {
  var s = db.settings; if (!s.autoBackup || !P.Filesystem) return;
  if (s.lastAutoBackup && Date.now() - new Date(s.lastAutoBackup) < 20 * 3600e3) return;
  try {
    await writeDoc('auto/remindme-auto-' + ymd(new Date()) + '.json', backupJson());
    s.lastAutoBackup = new Date().toISOString(); save();
    try { var ls = await P.Filesystem.readdir({ path: 'RemindMe/auto', directory: 'DOCUMENTS' }); var names = ls.files.map(function (f) { return f.name || f; }).filter(function (n) { return /^remindme-auto-/.test(n); }).sort();
      for (var i = 0; i < names.length - 7; i++) await P.Filesystem.deleteFile({ path: 'RemindMe/auto/' + names[i], directory: 'DOCUMENTS' }); } catch (e) {}
    jlog('auto backup ok');
  } catch (e) { jlog('auto backup failed ' + e.message); }
}
function restoreFrom(file) {
  var r = new FileReader();
  r.onload = async function () {
    try {
      var d = JSON.parse(r.result);
      if (!d || !Array.isArray(d.tasks)) throw new Error('This is not a RemindMe backup file');
      if (!confirm('Replace ALL current data with this backup' + (d.backupMeta ? ' from ' + new Date(d.backupMeta.at).toLocaleString() : '') + '?\n\nAfter restoring, unlock with the PIN you used when the backup was made.')) return;
      var keepAi = db.settings.ai;
      delete d.backupMeta; db = migrate(d); if (!db.settings.ai.key) db.settings.ai = keepAi;
      save(); applyTheme(); await rescheduleAll(); startGeo(); view = 'today'; toast('Restored'); showLock();
    } catch (e) { toast('Restore failed: ' + e.message); }
  };
  r.readAsText(file);
}

/* ================= DEBUG REPORT ================= */
async function debugReport() {
  var st = await getStatus(), nativeLog = '', list = [];
  try { if (P.RmAlarm) { nativeLog = (await P.RmAlarm.getLog()).log; list = (await P.RmAlarm.list()).alarms || []; } } catch (e) { nativeLog = 'error: ' + e.message; }
  var s = JSON.parse(JSON.stringify(db.settings)); s.pin = s.pin ? '(set)' : null; s.vaultSalt = s.vaultSalt ? '(set)' : null; s.ai.key = s.ai.key ? '(set)' : '';
  list.sort(function (a, b) { return a.at - b.at; });
  var lines = [
    '=== RemindMe debug report ===', 'App: v' + APP_VERSION + ' · native: ' + IS_NATIVE + ' · time: ' + new Date().toString(), 'UA: ' + navigator.userAgent,
    'Plugins: ' + Object.keys(P).map(function (k) { return k + '=' + (P[k] ? 'y' : 'n'); }).join(' '),
    'Status: ' + JSON.stringify(st), 'Health issues: ' + (healthBad.join('; ') || 'none'),
    'Counts: tasks=' + db.tasks.length + ' routine=' + db.routine.length + ' notes=' + db.notes.length + ' vault=' + (VAULT.items ? VAULT.items.length : '(locked)') + ' locs=' + db.locs.length,
    'Last sync: ' + JSON.stringify(lastSync), 'Settings: ' + JSON.stringify(s),
    '--- Next 40 stored alarms (' + list.length + ' total) ---'
  ].concat(list.slice(0, 40).map(function (a) { return new Date(a.at).toLocaleString() + ' | ' + a.kind + (a.snoozed ? ' (snoozed)' : '') + (a.fired ? ' (fired)' : '') + ' | ' + a.group + ' | ' + (a.title || '').slice(0, 40); }))
    .concat(['--- JS log ---'], _log.slice(-150), ['--- Native log ---', nativeLog.split('\n').slice(-200).join('\n')]);
  return lines.join('\n');
}

/* ================= VOICE ================= */
async function listen() {
  var SR = P.SpeechRecognition; extNav = Date.now();
  if (!SR) { toast('Voice input is not available in this build'); return ''; }
  try {
    var av = await SR.available(); if (!av.available) { toast('Speech recognition is not available on this phone'); return ''; }
    try { await SR.requestPermissions(); } catch (e) {}
    var r = await SR.start({ language: db.settings.voiceLang, maxResults: 1, prompt: 'Say it', partialResults: false, popup: true });
    return (r && r.matches && r.matches[0]) || '';
  } catch (e) { toast('Voice input failed: ' + (e.message || e)); return ''; }
}

/* ================= LOCATION REMINDERS (kept from v2) ================= */
var geoId = null;
function haversine(a, b, c, d) { var R = 6371000, r = Math.PI / 180, dLa = (c - a) * r, dLo = (d - b) * r; var x = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2); return 2 * R * Math.asin(Math.sqrt(x)); }
function checkLocs(loc) {
  var now = Date.now(), changed = false;
  db.locs.forEach(function (l) {
    if (!l.active) return;
    if (haversine(loc.latitude, loc.longitude, l.lat, l.lng) <= l.radius && now - (l.lastFired || 0) > 6 * 3600e3) {
      l.lastFired = now; changed = true;
      if (P.RmAlarm) P.RmAlarm.notifyNow({ id: 2100000000 + (l.id % 40000000), title: '📍 ' + l.place, body: l.text }).catch(function () {});
    }
  });
  if (changed) save();
}
async function startGeo() {
  var BG = P.BackgroundGeolocation; if (!BG) return;
  if (geoId !== null) { try { await BG.removeWatcher({ id: geoId }); } catch (e) {} geoId = null; }
  if (!db.locs.some(function (l) { return l.active; })) return;
  try {
    geoId = await BG.addWatcher({ backgroundTitle: 'RemindMe', backgroundMessage: 'Location reminders are active', requestPermissions: true, stale: false, distanceFilter: 50 }, function (loc, err) {
      if (err) { if (err.code === 'NOT_AUTHORIZED') toast('Allow location “All the time” in Settings'); return; }
      if (loc) checkLocs(loc);
    });
  } catch (e) { jlog('geo ' + e.message); }
}
function locForm() {
  var got = null;
  sheet('<h3>Location reminder</h3><div class="mut" style="margin-bottom:10px">Stand at the place and tap “Use my current location”. You will be reminded when you come near it again.</div>' +
    '<label>Remind me to</label><input id="l_text" placeholder="e.g. Buy milk"><label>Place name</label><input id="l_place" placeholder="e.g. Market">' +
    '<label>When within</label><select id="l_rad"><option value="100">100 m</option><option value="200" selected>200 m</option><option value="500">500 m</option><option value="1000">1 km</option></select>' +
    '<div class="btns" style="margin-bottom:10px"><button class="btn sec" id="l_get">📍 Use my current location</button></div><div class="mut" id="l_info"></div>' +
    '<div class="btns"><button class="btn" id="l_save">Save</button><button class="btn sec" data-act="close">Cancel</button></div>');
  $('#l_get').onclick = function () {
    $('#l_info').textContent = 'Finding location…';
    navigator.geolocation.getCurrentPosition(function (pos) { got = { lat: pos.coords.latitude, lng: pos.coords.longitude }; $('#l_info').textContent = '✓ Location captured'; },
      function () { $('#l_info').textContent = 'Could not get location. Turn on GPS and allow permission.'; }, { enableHighAccuracy: true, timeout: 20000 });
  };
  $('#l_save').onclick = function () {
    var text = val('l_text').trim(); if (!text) { toast('Enter what to remind'); return; } if (!got) { toast('Capture the location first'); return; }
    db.locs.push({ id: uid(), text: text, place: val('l_place').trim() || 'Place', lat: got.lat, lng: got.lng, radius: +val('l_rad'), active: true, lastFired: 0 });
    save(); closeSheet(); render(); startGeo();
  };
}

/* ================= LAUNCH FROM NOTIFICATION ================= */
async function openLaunchGroup() {
  if (!P.RmAlarm || locked) return;
  try {
    var r = await P.RmAlarm.getLaunchGroup(); var g = r && r.group; if (!g) return;
    var m = /^t(\d+)@(\d{4}-\d{2}-\d{2})$/.exec(g);
    if (m) { var t = taskById(+m[1]); if (t) { var o = occursOn(t, parseLocal(m[2], '00:00'))[0] || nextOcc(t); taskDetail(t.id, o.getTime()); } }
    else if (/^v\d+/.test(g)) go('vault');
    else if (g === 'sum') go('today');
    else if (/^r\d+/.test(g)) go('routine');
  } catch (e) {}
}
