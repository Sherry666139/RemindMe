/* RemindMe v3.1 — location reminders ("Places") */
'use strict';
var PLACE_ICONS = ['🛒', '🏪', '💊', '🏥', '🏦', '🏢', '🏠', '⛽', '🕌', '🎓', '🍽️', '📮', '🚉', '🧺', '📍'];
var placeLoc = null; // last loc status

function placesInit() {
  if (!Array.isArray(db.places)) db.places = [];
  if (db.settings.placesFast === undefined) db.settings.placesFast = false;
  // migrate v2/v3.0 single-text location reminders
  if (db.locs && db.locs.length) {
    db.locs.forEach(function (l) {
      db.places.push({ id: uid(), name: l.place || 'Place', icon: '📍', lat: l.lat, lng: l.lng, radius: l.radius || 200, trigger: 'enter', style: 'alarm', cooldownMin: 120, active: l.active !== false,
        items: [{ id: uid(), text: l.text, done: false }], createdAt: new Date().toISOString() });
    });
    db.locs = []; save();
  }
}
function placeById(id) { return db.places.filter(function (p) { return p.id === +id; })[0]; }
function placeTasks(p) {
  var now = new Date();
  return db.tasks.filter(function (t) {
    if (t.placeId !== p.id) return false;
    if (t.repeat === 'none') return !t.done;
    return !isOccDone(t, nextOcc(t)) && sameDay(nextOcc(t), now);
  });
}
function placeOpen(p) { return (p.items || []).filter(function (i) { return !i.done; }); }
function placeBody(p) {
  var lines = placeOpen(p).map(function (i) { return '• ' + i.text; }).concat(placeTasks(p).map(function (t) { return '• ' + t.title + ' (task)'; }));
  return lines.join('\n');
}
function placeCount(p) { return placeOpen(p).length + placeTasks(p).length; }

async function syncPlaces() {
  var R = P.RmAlarm; if (!R) return;
  var list = db.places.map(function (p) {
    var body = placeBody(p);
    return { id: p.id, name: p.name, lat: p.lat, lng: p.lng, radius: p.radius, trigger: p.trigger, style: p.style, cooldownMin: p.cooldownMin,
      active: p.active !== false, armed: !!body, body: body, tone: db.settings.defaultTone || 'default' };
  });
  try { var r = await R.syncPlaces({ places: list }); placeSyncStatus = r.status; } catch (e) { placeSyncStatus = 'error: ' + e.message; jlog('syncPlaces ' + e.message); }
  startFastTracking();
}
var placeSyncStatus = '';

/* ---- optional fast detection (foreground location service) ---- */
var fastId = null, insideNow = {};
function haversine(a, b, c, d) { var R = 6371000, r = Math.PI / 180, dLa = (c - a) * r, dLo = (d - b) * r; var x = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2); return 2 * R * Math.asin(Math.sqrt(x)); }
async function startFastTracking() {
  var BG = P.BackgroundGeolocation; if (!BG) return;
  var want = db.settings.placesFast && db.places.some(function (p) { return p.active !== false && placeCount(p); });
  if (!want) { if (fastId !== null) { try { await BG.removeWatcher({ id: fastId }); } catch (e) {} fastId = null; } return; }
  if (fastId !== null) return;
  try {
    fastId = await BG.addWatcher({ backgroundTitle: 'RemindMe', backgroundMessage: 'Watching for your saved places', requestPermissions: true, stale: false, distanceFilter: 30 }, function (loc, err) {
      if (err || !loc) return;
      db.places.forEach(function (p) {
        if (p.active === false || !placeCount(p)) return;
        var inside = haversine(loc.latitude, loc.longitude, p.lat, p.lng) <= p.radius;
        var was = insideNow[p.id];
        insideNow[p.id] = inside;
        if (was === undefined) return; // first fix: don't alert for where you already are
        if (inside && !was && /enter/.test(p.trigger)) P.RmAlarm.firePlace({ id: p.id, transition: 'enter' });
        if (!inside && was && /exit/.test(p.trigger)) P.RmAlarm.firePlace({ id: p.id, transition: 'exit' });
      });
    });
  } catch (e) { jlog('fast tracking ' + e.message); }
}

/* ---- location helpers ---- */
async function locStatus() { if (!P.RmAlarm) return null; try { placeLoc = await P.RmAlarm.locationStatus(); } catch (e) { placeLoc = null; } return placeLoc; }
async function ensureLocationPermission(askBackground) {
  if (!P.RmAlarm) return true;
  extNav = Date.now();
  var r = await P.RmAlarm.requestLocation();
  if (!r.fine) { toast('Location permission is needed for place reminders'); return false; }
  if (askBackground && !r.background) {
    if (confirm('To remind you when the app is closed, set Location to “Allow all the time”.\n\nOpen settings now? (Permissions → Location → Allow all the time)')) {
      extNav = Date.now(); await P.RmAlarm.openSetting({ which: 'app' });
    }
  }
  return true;
}
async function currentPosition() {
  if (P.RmAlarm) {
    var ok = await ensureLocationPermission(false); if (!ok) throw new Error('No location permission');
    var st = await locStatus(); if (st && !st.enabled) { await P.RmAlarm.openSetting({ which: 'location' }); throw new Error('Turn on location (GPS) first'); }
    try { return await P.RmAlarm.getPosition(); } catch (e) { jlog('native position ' + e.message); }
  }
  return new Promise(function (res, rej) {
    if (!navigator.geolocation) return rej(new Error('Location not available'));
    navigator.geolocation.getCurrentPosition(function (p) { res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); }, function (e) { rej(new Error(e.message || 'Could not get location')); }, { enableHighAccuracy: true, timeout: 25000 });
  });
}
async function geoSearch(q) {
  var near = '';
  try { if (lastFix) near = '&lat=' + lastFix.lat + '&lon=' + lastFix.lng; } catch (e) {}
  var url = 'https://photon.komoot.io/api/?limit=6&q=' + encodeURIComponent(q) + near;
  var data;
  try { data = await httpGet(url); }
  catch (e) {
    jlog('photon ' + e.message);
    var n = await httpGet('https://nominatim.openstreetmap.org/search?format=json&limit=6&q=' + encodeURIComponent(q));
    return n.map(function (x) { return { name: x.display_name, lat: +x.lat, lng: +x.lon }; });
  }
  return (data.features || []).map(function (f) {
    var pr = f.properties || {}, c = f.geometry.coordinates;
    return { name: [pr.name, pr.street, pr.city || pr.county, pr.country].filter(Boolean).join(', '), lat: c[1], lng: c[0] };
  });
}
async function httpGet(url) {
  var headers = { 'User-Agent': 'RemindMe/3.1 (personal reminder app)', Accept: 'application/json' };
  if (P.CapacitorHttp) {
    var r = await P.CapacitorHttp.request({ url: url, method: 'GET', headers: headers, connectTimeout: 15000, readTimeout: 20000 });
    if (r.status >= 400) throw new Error('HTTP ' + r.status);
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }
  var res = await fetch(url, { headers: { Accept: 'application/json' } }); if (!res.ok) throw new Error('HTTP ' + res.status); return res.json();
}
var lastFix = null;

/* ---- views ---- */
function viewPlaces() {
  var h = '';
  if (placeLoc && db.places.length) {
    var bad = [];
    if (!placeLoc.fine) bad.push('location permission');
    else if (!placeLoc.background) bad.push('“Allow all the time”');
    if (!placeLoc.enabled) bad.push('GPS is off');
    if (!placeLoc.gms) bad.push('Google Play services missing (use Fast detection)');
    if (bad.length) h += '<div class="banner red">📍<div class="grow"><b>Place reminders need:</b><br><span class="sm">' + esc(bad.join(' · ')) + '</span></div><button class="btn sm" data-act="locfix">Fix</button></div>';
  }
  if (!db.places.length) {
    return h + emptyBox(I.place, 'Save places like the market, pharmacy or bank and add what you need to do there. When you arrive, RemindMe rings and shows the list.') +
      '<div class="btns" style="justify-content:center"><button class="btn" data-act="padd">' + I.plus + 'Add a place</button></div>';
  }
  var list = db.places.slice().sort(function (a, b) { return placeCount(b) - placeCount(a) || a.name.localeCompare(b.name); });
  h += list.map(function (p) {
    var open = placeOpen(p), tasks = placeTasks(p), n = open.length + tasks.length;
    var preview = open.slice(0, 3).map(function (i) { return esc(i.text); }).concat(tasks.slice(0, 2).map(function (t) { return esc(t.title); }));
    return '<div class="card" style="' + (p.active === false ? 'opacity:.55' : '') + '"><div class="row" data-act="pview" data-id="' + p.id + '"><div class="cicon">' + (p.icon || '📍') + '</div><div class="grow"><div class="title">' + esc(p.name) + '</div>' +
      '<div class="when">' + (n ? n + ' thing' + (n > 1 ? 's' : '') + ' to do' : 'Nothing to do — no alert') + ' · ' + (p.trigger === 'exit' ? 'on leaving' : p.trigger === 'enter,exit' ? 'arrive & leave' : 'on arrival') + ' · ' + p.radius + ' m</div>' +
      (preview.length ? '<div class="mut" style="margin-top:4px">' + preview.join(' · ') + (n > preview.length ? ' …' : '') + '</div>' : '') + '</div></div>' +
      '<div class="row" style="margin-top:8px"><input data-pq="' + p.id + '" placeholder="+ Add something to do here" style="margin:0"><button class="btn sm" data-act="pitemadd" data-id="' + p.id + '">Add</button></div></div>';
  }).join('');
  h += '<div class="mut" style="margin:14px 4px">Alerts come only when a place has something on its list. Detection usually takes 1–3 minutes after you arrive' + (db.settings.placesFast ? ' (fast detection is on).' : '. Turn on Fast detection in Settings for quicker alerts.') + '</div>';
  return h;
}
function placeSheet(id) {
  var p = placeById(id); if (!p) return;
  var items = (p.items || []), tasks = placeTasks(p);
  sheet('<div class="row"><div class="cicon">' + (p.icon || '📍') + '</div><h3 class="grow" style="margin:0">' + esc(p.name) + '</h3></div>' +
    '<div class="mut" style="margin:6px 0 10px">' + (p.trigger === 'exit' ? 'Alerts when you leave' : p.trigger === 'enter,exit' ? 'Alerts when you arrive and leave' : 'Alerts when you arrive') + ' · within ' + p.radius + ' m · ' + (p.style === 'alarm' ? '⏰ rings' : '🔔 notification') + '</div>' +
    '<div class="row"><input id="pi_new" placeholder="Add something to do here" style="margin:0"><button class="btn sm" id="pi_add">Add</button></div>' +
    '<div class="card" style="margin-top:10px">' + (items.length ? items.map(function (i) {
      return '<div class="row' + (i.done ? ' done' : '') + '" style="padding:6px 0"><button class="chk' + (i.done ? ' on' : '') + '" data-act="pitem" data-id="' + p.id + '" data-v="' + i.id + '">' + I.check + '</button><div class="grow title" style="font-weight:500">' + esc(i.text) + '</div><button class="ib" data-act="pitemdel" data-id="' + p.id + '" data-v="' + i.id + '">' + I.close + '</button></div>';
    }).join('') : '<div class="mut">No items yet.</div>') +
    (tasks.length ? '<div class="k" style="margin-top:10px;font-size:12px;color:var(--mut);font-weight:700">LINKED TASKS</div>' + tasks.map(function (t) { return '<div class="row" style="padding:6px 0" data-act="tview" data-id="' + t.id + '"><span>⏰</span><div class="grow">' + esc(t.title) + '</div></div>'; }).join('') : '') + '</div>' +
    '<div class="btns">' + (items.some(function (i) { return i.done; }) ? '<button class="btn sec sm" data-act="pclear" data-id="' + p.id + '">Clear ticked</button>' : '') +
    '<button class="btn sec sm" data-act="ptest" data-id="' + p.id + '">Test alert</button><button class="btn sec sm" data-act="ptoggle" data-id="' + p.id + '">' + (p.active === false ? 'Turn on' : 'Turn off') + '</button>' +
    '<button class="btn sec sm" data-act="pedit" data-id="' + p.id + '">' + I.edit + 'Edit place</button><button class="btn danger sm" data-act="pdel" data-id="' + p.id + '">' + I.trash + '</button></div>');
  var add = function () { var v = $('#pi_new').value.trim(); if (!v) return; addPlaceItems(p, splitItems(v)); placeSheet(p.id); render(); setTimeout(function () { $('#pi_new') && $('#pi_new').focus(); }, 50); };
  $('#pi_add').onclick = add;
  $('#pi_new').onkeydown = function (e) { if (e.key === 'Enter') add(); };
}
function splitItems(s) { return String(s).split(/\s*(?:\n|,|;| and )\s*/i).map(function (x) { return cap1(x.trim()); }).filter(Boolean); }
function addPlaceItems(p, texts) {
  p.items = p.items || [];
  texts.forEach(function (t) { p.items.push({ id: uid(), text: t, done: false }); });
  save(); rescheduleSoon();
}

var pmap = null, pmarker = null, pcircle = null;
function placeForm(id, preset) {
  var p = placeById(id), isNew = !p;
  if (isNew) p = { name: '', icon: '🛒', lat: null, lng: null, radius: 200, trigger: 'enter', style: 'alarm', cooldownMin: 120, items: [] };
  if (preset) for (var k in preset) p[k] = preset[k];
  var pos = p.lat != null ? { lat: p.lat, lng: p.lng } : null;
  sheet('<h3>' + (isNew ? 'New place' : 'Edit place') + '</h3>' +
    '<label>Name</label><input id="p_name" value="' + esc(p.name) + '" placeholder="e.g. Market, Pharmacy, Office">' +
    '<label>Icon</label>' + chipsHtml('picon', PLACE_ICONS.map(function (e) { return [e, e]; }), p.icon) +
    '<label>Location</label><div class="btns" style="margin:4px 0 8px"><button class="btn sm" id="p_here">📍 Use where I am now</button></div>' +
    '<div class="row"><input id="p_q" placeholder="…or search an address / shop name" style="margin:0"><button class="btn sec sm" id="p_go">' + I.search + '</button></div><div id="p_res"></div>' +
    '<div id="p_map" style="height:240px;border-radius:14px;overflow:hidden;margin:10px 0 4px;background:var(--card2)"></div><div class="mut" id="p_info">' + (pos ? 'Drag the pin or tap the map to adjust.' : 'Pick a location — or tap the map.') + '</div>' +
    '<label style="margin-top:10px;display:block">Alert me within</label>' + chipsHtml('prad', [[100, '100 m'], [200, '200 m'], [300, '300 m'], [500, '500 m'], [1000, '1 km']], p.radius) +
    '<label>Alert when I</label>' + chipsHtml('ptrig', [['enter', 'Arrive'], ['exit', 'Leave'], ['enter,exit', 'Both']], p.trigger) +
    '<label>Alert type</label>' + chipsHtml('pstyle', [['alarm', '⏰ Ring like an alarm'], ['notify', '🔔 Notification']], p.style) +
    '<label>Don’t repeat the alert for</label><select id="p_cool">' + opt({ 30: '30 minutes', 60: '1 hour', 120: '2 hours', 360: '6 hours', 1440: '1 day' }, p.cooldownMin) + '</select>' +
    (isNew ? '<label>Things to do there (one per line or comma separated)</label><textarea id="p_items" rows="3" placeholder="Buy milk, eggs and bread\nGet keys cut"></textarea>' : '') +
    '<div class="btns"><button class="btn" id="p_save">Save place</button><button class="btn sec" data-act="close">Cancel</button></div>');
  initMap(pos);
  $$('[data-chips="prad"] .chip').forEach(function (b) { b.addEventListener('click', function () { setTimeout(function () { if (pcircle) pcircle.setRadius(+chipsVal('prad')); }, 0); }); });
  $('#p_here').onclick = async function () {
    $('#p_info').textContent = 'Getting your location…';
    try { var c = await currentPosition(); lastFix = c; pos = { lat: c.lat, lng: c.lng }; setPin(pos, 17); $('#p_info').textContent = '✓ Location set (accuracy ±' + Math.round(c.accuracy || 0) + ' m). Drag the pin to adjust.'; }
    catch (e) { $('#p_info').textContent = 'Could not get location: ' + e.message; }
  };
  var doSearch = async function () {
    var q = $('#p_q').value.trim(); if (!q) return;
    $('#p_res').innerHTML = '<div class="mut" style="margin:6px 0">Searching…</div>';
    try {
      var res = await geoSearch(q);
      $('#p_res').innerHTML = res.length ? res.map(function (r, i) { return '<div class="card" style="padding:9px 12px;margin:6px 0;font-size:14px" data-pr="' + i + '">' + esc(r.name) + '</div>'; }).join('') : '<div class="mut" style="margin:6px 0">No results. Try a different spelling or use the map.</div>';
      $$('[data-pr]').forEach(function (el) { el.onclick = function () { var r = res[+el.getAttribute('data-pr')]; pos = { lat: r.lat, lng: r.lng }; setPin(pos, 17); $('#p_res').innerHTML = ''; if (!$('#p_name').value) $('#p_name').value = r.name.split(',')[0]; $('#p_info').textContent = '✓ ' + r.name; }; });
    } catch (e) { $('#p_res').innerHTML = '<div class="mut" style="margin:6px 0">Search needs internet: ' + esc(e.message) + '</div>'; }
  };
  $('#p_go').onclick = doSearch;
  $('#p_q').onkeydown = function (e) { if (e.key === 'Enter') doSearch(); };
  $('#p_save').onclick = async function () {
    var name = $('#p_name').value.trim(); if (!name) { toast('Give the place a name'); return; }
    if (pmarker) { var ll = pmarker.getLatLng(); pos = { lat: ll.lat, lng: ll.lng }; }
    if (!pos) { toast('Set the location first'); return; }
    var o = { name: name, icon: chipsVal('picon') || '📍', lat: pos.lat, lng: pos.lng, radius: +chipsVal('prad') || 200, trigger: chipsVal('ptrig') || 'enter', style: chipsVal('pstyle') || 'alarm', cooldownMin: +$('#p_cool').value };
    if (isNew) {
      o.id = uid(); o.active = true; o.createdAt = new Date().toISOString(); o.items = (p.items || []).slice();
      splitItems($('#p_items').value).forEach(function (t) { o.items.push({ id: uid(), text: t, done: false }); });
      db.places.push(o);
    } else for (var k2 in o) p[k2] = o[k2];
    save(); closeSheet(); if (view !== 'places') view = 'places'; render(); rescheduleAll();
    toast('Place saved');
    await ensureLocationPermission(true); locStatus().then(function () { render(); });
  };
}
function initMap(pos) {
  pmap = null; pmarker = null; pcircle = null;
  if (!window.L) { $('#p_map').innerHTML = '<div class="empty">Map unavailable — use “Use where I am now” or search.</div>'; return; }
  setTimeout(function () {
    var el = $('#p_map'); if (!el) return;
    var center = pos || (lastFix ? { lat: lastFix.lat, lng: lastFix.lng } : { lat: 32.94, lng: 73.73 });
    pmap = L.map(el, { zoomControl: true, attributionControl: true }).setView([center.lat, center.lng], pos ? 17 : (lastFix ? 15 : 12));
    var carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19, subdomains: 'abcd', attribution: '© OpenStreetMap © CARTO' });
    var tileErrors = 0;
    carto.on('tileerror', function () { if (++tileErrors === 4) { pmap.removeLayer(carto); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(pmap); } });
    carto.addTo(pmap);
    if (pos) setPin(pos, 17);
    pmap.on('click', function (e) { setPin({ lat: e.latlng.lat, lng: e.latlng.lng }); $('#p_info').textContent = 'Pin placed. Drag to fine-tune.'; });
  }, 60);
}
function setPin(pos, zoom) {
  if (!pmap) return;
  var ll = [pos.lat, pos.lng], r = +chipsVal('prad') || 200;
  if (!pmarker) {
    pmarker = L.marker(ll, { draggable: true }).addTo(pmap);
    pcircle = L.circle(ll, { radius: r, color: getComputedStyle(document.documentElement).getPropertyValue('--pri').trim() || '#4f46e5', weight: 2, fillOpacity: .12 }).addTo(pmap);
    pmarker.on('drag', function () { pcircle.setLatLng(pmarker.getLatLng()); });
  } else { pmarker.setLatLng(ll); pcircle.setLatLng(ll); }
  pmap.setView(ll, zoom || pmap.getZoom());
}
function findPlace(name) {
  var n = String(name || '').toLowerCase().replace(/^the\s+/, '').trim(); if (!n) return null;
  return db.places.filter(function (p) { return p.name.toLowerCase() === n; })[0] ||
    db.places.filter(function (p) { var pn = p.name.toLowerCase(); return pn.indexOf(n) >= 0 || n.indexOf(pn) >= 0; })[0] || null;
}
