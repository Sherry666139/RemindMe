/* RemindMe v3 — events & startup */
'use strict';
document.addEventListener('click', async function (e) {
  var k = e.target.closest('[data-k]'); if (k) { pressKey(k.getAttribute('data-k')); return; }
  var chip = e.target.closest('[data-chips] .chip');
  if (chip) {
    var box = chip.parentNode;
    if (box.getAttribute('data-multi') === '1') chip.classList.toggle('on');
    else { $$('.chip', box).forEach(function (c) { c.classList.remove('on'); }); chip.classList.add('on'); }
  }
  if (e.target.id === 'sheet') { closeSheet(); return; }
  var el = e.target.closest('[data-act]'); if (!el) return;
  var act = el.getAttribute('data-act'), id = el.getAttribute('data-id'), v = el.getAttribute('data-v');
  var t = id ? taskById(id) : null;
  var vi = (VAULT.items || []).filter(function (x) { return x.id === +id; })[0];
  try {
    switch (act) {
      case 'tab': closeSearch(); go(v); break;
      case 'fab': fab(); break;
      case 'close': closeSheet(); break;
      case 'search': openSearch(''); break;
      case 'scl': closeSearch(); break;
      case 'assistant': closeSearch(); go('assistant'); break;
      case 'settings': go('settings'); checkHealthQuiet(); break;
      case 'hback': go('today'); break;
      case 'tpl': {
        var tp = TEMPLATES.filter(function (x) { return x.k === v; })[0];
        if (tp.routine) routineForm(); else if (tp.note) noteForm(); else if (tp.vault) { closeSheet(); go('vault'); vaultForm(); } else taskForm(null, tp.t);
        break;
      }
      case 'openai': closeSheet(); go('assistant'); setTimeout(function () { $('#aiinput').focus(); }, 100); break;
      case 'tdone': if (t) { var at = new Date(+el.getAttribute('data-at')), was = isOccDone(t, at); setOccDone(t, at, !was); render(); if (!was) toast('Done ✓', function () { setOccDone(t, at, false); render(); }); } break;
      case 'tdone2': if (t) { var at2 = new Date(+el.getAttribute('data-at')); setOccDone(t, at2, !isOccDone(t, at2)); closeSheet(); render(); } break;
      case 'tview': closeSearch(); if (t) taskDetail(t.id, el.getAttribute('data-at')); break;
      case 'tedit': if (t) taskForm(t.id); break;
      case 'tdel': if (t) deleteTask(t); break;
      case 'tdelc': if (t) { deleteTask(t); render(); } break;
      case 'tundo': if (t) { db.tasks = db.tasks.filter(function (x) { return x !== t; }); save(); rescheduleSoon(); toast('Removed'); render(); } break;
      case 'tdup': if (t) { var c = JSON.parse(JSON.stringify(t)); c.id = uid(); c.done = false; c.doneOcc = {}; c.title += ' (copy)'; db.tasks.push(c); save(); rescheduleSoon(); taskForm(c.id); } break;
      case 'tseg': taskSeg = v; render(); break;
      case 'tcat': taskCat = v; render(); break;
      case 'rdone': { var r = db.routine.filter(function (x) { return x.id === +id; })[0]; if (r) { r.doneDates = r.doneDates || {}; if (r.doneDates[todayStr()]) delete r.doneDates[todayStr()]; else r.doneDates[todayStr()] = 1; save(); rescheduleSoon(); render(); } break; }
      case 'redit': closeSearch(); routineForm(id); break;
      case 'nedit': closeSearch(); noteForm(id); break;
      case 'vcatf': vaultCat = v; openV = null; render(); break;
      case 'vcatadd': vcatForm(); break;
      case 'vcatedit': vcatForm(v); break;
      case 'vopen': openV = openV === +id ? null : +id; render(); break;
      case 'vgo': closeSearch(); view = 'vault'; vaultCat = ''; openV = +id; render(); break;
      case 'vshow': showPw[id + el.getAttribute('data-f')] = !showPw[id + el.getAttribute('data-f')]; render(); break;
      case 'vcopy': if (vi) { var f = el.getAttribute('data-f'); copyText(vaultValue(vi, f), (f === 'pass' ? 'Password' : f === 'user' ? 'Username' : 'Value') + ' copied', f === 'pass' || (f.charAt(0) === 'f' && vi.fields[+f.slice(1)] && vi.fields[+f.slice(1)].secret)); } break;
      case 'vurl': extNav = Date.now(); if (vi && vi.url) window.open(/^https?:/.test(vi.url) ? vi.url : 'https://' + vi.url, '_system'); break;
      case 'vedit': vaultForm(id); break;
      case 'vchanged': if (vi) { vi.pwChangedAt = new Date().toISOString(); await saveVault(); rescheduleSoon(); render(); toast('Password age reset'); } break;
      case 'vdel': if (vi && confirm('Delete "' + vi.name + '" from the vault?')) { var idx = VAULT.items.indexOf(vi); VAULT.items.splice(idx, 1); await saveVault(); rescheduleSoon(); openV = null; render(); toast('Deleted', async function () { VAULT.items.splice(idx, 0, vi); await saveVault(); render(); }); } break;
      case 'copytxt': copyText(v); break;
      case 'aiq': sendAssistant(v === 'This week' ? "What's due this week?" : v === 'Overdue' ? 'What is overdue?' : v); break;
      case 'aiclear': db.chat = []; save(); render(); break;
      case 'aisend': sendAssistant($('#aiinput').value); break;
      case 'aimic': { extNav = Date.now(); var said = await listen(); if (said) sendAssistant(said); break; }
      case 'aitest': {
        toast('Testing…');
        try { var res = await cloudAssistant('Reply with {"reply":"OK","actions":[]}'); toast('Connected: ' + (res.reply || 'OK')); } catch (err) { toast('Failed: ' + err.message.slice(0, 150)); }
        break;
      }
      case 'health': healthSheet(false); break;
      case 'setupdone': db.settings.setupDone = true; save(); closeSheet(); checkHealthQuiet(); break;
      case 'fix': { extNav = Date.now();
        if (v === 'notif') { await requestNotif(); var st = await getStatus(); if (st && !st.notifications) await P.RmAlarm.openSetting({ which: 'notifications' }); }
        else await P.RmAlarm.openSetting({ which: v });
        toast('Come back here after changing the setting');
        break;
      }
      case 'testring': if (P.RmAlarm) { await P.RmAlarm.test({ seconds: 10, kind: 'ring', tone: db.settings.defaultTone }); toast('Alarm in 10 seconds — lock your phone now'); } else toast('Only in the installed app'); break;
      case 'testnotif': if (P.RmAlarm) { await P.RmAlarm.test({ seconds: 5, kind: 'notify', title: 'Test reminder' }); toast('Notification in 5 seconds'); } break;
      case 'chpin': {
        if (!confirm('Change your PIN? You will set a new one now.')) break;
        var items = VAULT.items; db.settings.pin = null; save();
        locked = true; $('#lock').style.display = 'flex'; $('#app').style.visibility = 'hidden';
        VAULT.items = items; pinStage = 'new'; newPinLen = db.settings.pinLen || 4; pinBuf = '';
        lockMsg('Create a new PIN', '<button class="btn sec sm" id="pinlenBtn">Use ' + (newPinLen === 4 ? 6 : 4) + ' digits instead</button>'); bindPinLen(); drawDots();
        break;
      }
      case 'lock': showLock(); break;
      case 'accent': db.settings.accent = v; save(); applyTheme(); render(); break;
      case 'catadd': { var nc = $('#s_newcat').value.trim(); if (nc && db.cats.indexOf(nc) < 0) { db.cats.push(nc); save(); render(); } break; }
      case 'catdel': if (db.cats.length > 1 && confirm('Remove category "' + v + '"? Tasks keep their label.')) { db.cats = db.cats.filter(function (c) { return c !== v; }); save(); render(); } break;
      case 'ladd': locForm(); break;
      case 'ltog': db.locs.forEach(function (l) { if (l.id === +id) l.active = !l.active; }); save(); render(); startGeo(); break;
      case 'ldel': if (confirm('Delete this location reminder?')) { db.locs = db.locs.filter(function (l) { return l.id !== +id; }); save(); render(); startGeo(); } break;
      case 'backup': backupNow(); break;
      case 'sharebk': extNav = Date.now(); try { if (VAULT.items) await saveVault(); await shareText(bkName(), backupJson(), 'RemindMe backup'); } catch (err) { toast('Share failed: ' + err.message); } break;
      case 'restore': extNav = Date.now(); $('#restoreFile').click(); break;
      case 'dbgcopy': copyText(await debugReport(), 'Debug report copied'); break;
      case 'dbgsave': extNav = Date.now(); try { var w = await writeDoc('remindme-debug-' + Date.now() + '.txt', await debugReport()); toast('Saved to ' + w.where); } catch (err) { toast('Save failed: ' + err.message); } break;
      case 'dbgview': sheet('<h3>Debug report</h3><pre class="log">' + esc(await debugReport()) + '</pre><div class="btns"><button class="btn" data-act="dbgcopy">Copy</button><button class="btn sec" data-act="close">Close</button></div>'); break;
      case 'dbgclear': _log = []; localStorage.removeItem(LOGKEY); if (P.RmAlarm) await P.RmAlarm.clearLog(); toast('Logs cleared'); break;
    }
  } catch (err) { jlog('action ' + act + ' failed: ' + (err.message || err)); toast('Error: ' + (err.message || err)); }
});
$('#restoreFile').addEventListener('change', function () { if (this.files[0]) restoreFrom(this.files[0]); this.value = ''; });
$('#sq').addEventListener('input', debounce(runSearch, 120));
$('#aiinput').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); sendAssistant(this.value); } });
if (window.matchMedia) try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); } catch (e) {}

/* ---------- startup ---------- */
(async function start() {
  jlog('start v' + APP_VERSION + ' native=' + IS_NATIVE);
  applyTheme(); buildPad(); showLock(); applySecure();
  if (P.RmAlarm) {
    try { P.RmAlarm.addListener('alarmEvent', function (ev) { applyEvent(ev); save(); rescheduleSoon(); render(); }); } catch (e) {}
  }
  // One-time: remove v2 notifications (now handled by the native alarm engine)
  if (!db.settings.migratedV3 && P.LocalNotifications) {
    try { var pend = await P.LocalNotifications.getPending(); if (pend.notifications.length) await P.LocalNotifications.cancel({ notifications: pend.notifications.map(function (n) { return { id: n.id }; }) }); jlog('cleared ' + pend.notifications.length + ' v2 notifications'); } catch (e) { jlog('v2 cleanup ' + e.message); }
    db.settings.migratedV3 = true; save();
  }
  await requestNotif();
  await consumeEvents();
  rescheduleAll(); startGeo(); checkHealthQuiet();
  setInterval(function () { if (!locked) { consumeEvents(); if (view === 'today' || view === 'tasks') render(); } }, 60000);
})();
if (P.App) {
  try {
    P.App.addListener('backButton', function () {
      if ($('#sheet').classList.contains('on')) { closeSheet(); return; }
      if ($('#search').classList.contains('on')) { closeSearch(); return; }
      if (locked) { try { P.App.minimizeApp(); } catch (e) {} return; }
      if (view !== 'today') { go('today'); return; }
      try { P.App.minimizeApp(); } catch (e) {}
    });
    P.App.addListener('appStateChange', async function (s) {
      if (!s.isActive) { lastHide = Date.now(); if (!locked && VAULT.items) saveVault(); return; }
      await consumeEvents();
      var ext = Date.now() - extNav < 300000; extNav = 0;
      if (!locked && !ext && db.settings.pin && lastHide && Date.now() - lastHide >= (db.settings.lockAfter || 0) * 1000) { showLock(); return; }
      if (!locked) { rescheduleAll(); checkHealthQuiet(); render(); openLaunchGroup(); }
    });
  } catch (e) {}
}
