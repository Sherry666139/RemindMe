/* RemindMe v3 — assistant: offline parser + optional cloud AI (Gemini / OpenAI / Anthropic / compatible) */
'use strict';
var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
var WD = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
var NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, 'forty five': 45, half: 0.5 };
var UNIT = { min: 1, mins: 1, minute: 1, minutes: 1, hr: 60, hrs: 60, hour: 60, hours: 60, day: 1440, days: 1440, week: 10080, weeks: 10080, month: 43200, months: 43200 };
var AI_DEFAULT_MODEL = { gemini: 'gemini-2.5-flash', openai: 'gpt-4o-mini', anthropic: 'claude-haiku-5-5', compat: 'llama-3.3-70b-versatile' };

function digitsFix(s) { return s.replace(/[۰-۹]/g, function (c) { return String(c.charCodeAt(0) - 0x06F0); }).replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 0x0660); }); }
function numFrom(w) { if (/^\d+(\.\d+)?$/.test(w)) return +w; return NUMW[w] !== undefined ? NUMW[w] : NaN; }

/** Parse free text into a task draft. Returns {draft, missing, rest} */
function parseTask(text) {
  var raw = String(text).trim(), s = ' ' + digitsFix(raw.toLowerCase()).replace(/[,;]/g, ' ').replace(/\s+/g, ' ') + ' ';
  var now = new Date(), date = null, time = null, repeat = 'none', everyN = 0, pres = [], follow = 'off', style = 'alarm', cat = null, priority = 'normal';
  function cut(re) { s = s.replace(re, ' '); }

  // pre-reminders: "2 days before", "1 day and 2 hours before", "a week prior", "remind me 3 days early"
  var preRe = /((?:(?:\d+|a|an|one|two|three|four|five|six|seven|ten|half)\s*(?:min(?:ute)?s?|hours?|hrs?|days?|weeks?)(?:\s*(?:and|&|\+)\s*)?)+)\s*(?:before|prior|in advance|early|earlier|ahead)/g;
  var pm;
  while ((pm = preRe.exec(s))) {
    var parts = pm[1].match(/(\d+|a|an|one|two|three|four|five|six|seven|ten|half)\s*(min(?:ute)?s?|hours?|hrs?|days?|weeks?)/g) || [];
    parts.forEach(function (p) { var m2 = /(\S+)\s*(\S+)/.exec(p.replace(/(\d)([a-z])/, '$1 $2')); var n = numFrom(m2[1]), u = UNIT[m2[2]] || UNIT[m2[2].replace(/s$/, '')]; if (n && u) pres.push(Math.round(n * u)); });
  }
  cut(/((?:(?:\d+|a|an|one|two|three|four|five|six|seven|ten|half)\s*(?:min(?:ute)?s?|hours?|hrs?|days?|weeks?)(?:\s*(?:and|&|\+)\s*)?)+)\s*(?:before|prior|in advance|early|earlier|ahead)/g);
  cut(/\b(and )?(also )?remind me\s*(?=\s)/g);

  // follow-up / nag
  if (/\b(until (it'?s |i'?m |i )?done|keep (on )?(reminding|ringing|nagging)|nag me|follow[ -]?up|don'?t let me forget)\b/.test(s)) { follow = /\bdaily|every day\b/.test(s) && /follow/.test(s) ? '1440x7' : '30x6'; }
  cut(/\b(until (it'?s |i'?m |i )?done|keep (on )?(reminding|ringing|nagging)( me)?|nag me|don'?t let me forget)\b/g);
  if (/\b(just )?(notify|notification|silent(ly)?|quiet(ly)?)\b/.test(s)) style = 'notify';
  if (/\b(urgent|important|asap|high priority)\b/.test(s)) { priority = 'high'; cut(/\b(urgent|important|asap|high priority)\b/g); }
  cut(/\b(with an? )?(alarm|ring|notify me|notification|silently|quietly)\b/g);

  // repeat
  var m;
  if ((m = /\bevery (\d+|two|three|four|five|six|ten) days\b/.exec(s))) { repeat = 'everyN'; everyN = numFrom(m[1]); cut(m[0]); }
  else if ((m = /\bevery (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(s))) { repeat = 'weekly'; date = nextWeekday(WD.indexOf(m[1]), true); cut(m[0]); }
  else if (/\b(every ?day|daily|each day|har roz|rozana)\b/.test(s)) { repeat = 'daily'; cut(/\b(every ?day|daily|each day|har roz|rozana)\b/g); }
  else if (/\b(weekdays|every weekday|mon(day)? to fri(day)?)\b/.test(s)) { repeat = 'weekdays'; cut(/\b(on )?(weekdays|every weekday|mon(day)? to fri(day)?)\b/g); }
  else if (/\b(every week|weekly)\b/.test(s)) { repeat = 'weekly'; cut(/\b(every week|weekly)\b/g); }
  else if (/\b(every month|monthly|each month)\b/.test(s)) { repeat = 'monthly'; cut(/\b(every month|monthly|each month)\b/g); }
  else if (/\b(every year|yearly|annually|each year)\b/.test(s)) { repeat = 'yearly'; cut(/\b(every year|yearly|annually|each year)\b/g); }

  // relative "in N units"
  if ((m = /\bin (\d+|a|an|one|two|three|four|five|ten|fifteen|twenty|thirty|half an?|half)\s*(min(?:ute)?s?|hours?|hrs?|days?|weeks?)\b/.exec(s))) {
    var n = numFrom(m[1].replace(/ an?$/, '')), u = UNIT[m[2]] || UNIT[m[2].replace(/s$/, '')];
    if (n && u) { var d0 = new Date(now.getTime() + n * u * 60000); date = sod(d0); time = [d0.getHours(), d0.getMinutes()]; }
    cut(m[0]);
  }
  // explicit dates
  if (!date) {
    if ((m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(s))) { date = new Date(+m[1], +m[2] - 1, +m[3]); cut(m[0]); }
    else if ((m = /\b(?:on )?(?:the )?(\d{1,2})(?:st|nd|rd|th)?(?: of)? (jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?: (\d{4}))?\b/.exec(s))) { date = mkDate(+m[1], MONTHS.indexOf(m[2].slice(0, 3)), m[3]); cut(m[0]); }
    else if ((m = /\b(?:on )?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]* (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?\b/.exec(s))) { date = mkDate(+m[2], MONTHS.indexOf(m[1].slice(0, 3)), m[3]); cut(m[0]); }
    else if ((m = /\b(?:on )?(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/.exec(s))) { date = mkDate(+m[1], +m[2] - 1, m[3]); cut(m[0]); }
    else if ((m = /\b(?:on )?the (\d{1,2})(?:st|nd|rd|th)\b|\bon (\d{1,2})(?:st|nd|rd|th)\b/.exec(s))) {
      var dd = +(m[1] || m[2]); var c = new Date(now.getFullYear(), now.getMonth(), dd); if (c < sod(now)) c = new Date(now.getFullYear(), now.getMonth() + 1, dd); date = c; cut(m[0]);
    }
    else if (/\b(day after tomorrow|parson|parso)\b/.test(s)) { date = addDays(sod(now), 2); cut(/\b(the )?(day after tomorrow|parson|parso)\b/g); }
    else if (/\b(tomorrow|tmrw|tmr|kal)\b/.test(s)) { date = addDays(sod(now), 1); cut(/\b(tomorrow|tmrw|tmr|kal)\b/g); }
    else if (/\btonight\b/.test(s)) { date = sod(now); if (!time) time = [21, 0]; cut(/\btonight\b/g); }
    else if (/\btoday\b/.test(s)) { date = sod(now); cut(/\btoday\b/g); }
    else if ((m = /\b(?:on |this |next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/.exec(s))) {
      var idx = WD.findIndex(function (w) { return w.indexOf(m[1].slice(0, 3)) === 0; });
      date = nextWeekday(idx, false, /\bnext\b/.test(m[0])); cut(m[0]);
    }
    else if (/\bnext week\b/.test(s)) { date = addDays(sod(now), 7); cut(/\bnext week\b/g); }
    else if (/\bnext month\b/.test(s)) { date = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()); cut(/\bnext month\b/g); }
    else if (/\b(end of (the )?month|month end)\b/.test(s)) { date = new Date(now.getFullYear(), now.getMonth() + 1, 0); cut(/\b(by |at |on )?(the )?(end of (the )?month|month end)\b/g); }
  }
  // time
  if (!time) {
    if ((m = /\b(?:at |@ ?|by )?(\d{1,2})(?::|\.)(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/.exec(s)) && +m[1] < 24) { time = to24(+m[1], +m[2], m[3]); cut(m[0]); }
    else if ((m = /\b(?:at |@ ?|by )?(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.|o'?clock|baje|bje)/.exec(s)) && +m[1] <= 12) { time = to24(+m[1], 0, m[2]); cut(m[0]); }
    else if ((m = /\bat (\d{1,2})\b/.exec(s)) && +m[1] < 24) { time = to24(+m[1], 0, null); cut(m[0]); }
    else if (/\b(noon|midday|dopahar)\b/.test(s)) { time = [12, 0]; cut(/\b(at )?(noon|midday|dopahar)\b/g); }
    else if (/\bmidnight\b/.test(s)) { time = [23, 59]; cut(/\b(at )?midnight\b/g); }
  }
  var dayPart = /\b(in the )?(morning|subah|afternoon|evening|shaam|sham|night|raat)\b/.exec(s);
  if (dayPart) {
    var w = dayPart[2];
    if (!time) time = { morning: [9, 0], subah: [9, 0], afternoon: [14, 0], evening: [18, 0], shaam: [18, 0], sham: [18, 0], night: [21, 0], raat: [21, 0] }[w];
    else if (time[0] < 12 && /afternoon|evening|night|shaam|sham|raat/.test(w)) time[0] += 12;
    cut(dayPart[0]);
  }

  // category inference
  var low = raw.toLowerCase();
  if (/\b(birthday|bday|b'day|anniversary|saalgirah)\b/.test(low)) { cat = 'Birthday'; if (repeat === 'none') repeat = 'yearly'; if (!pres.length) pres = [1440]; if (style === 'alarm' && !/alarm/.test(low)) style = 'notify'; }
  else if (/\b(pay|bill|bills|rent|electricity|gas bill|water bill|internet bill|fee|fees|installment|emi|credit card|invoice|loan)\b/.test(low)) { cat = 'Bill'; if (!pres.length) pres = [2880]; if (follow === 'off') follow = '1440x7'; }
  else if (/\b(submit|document|documents|docs|form|application|passport|visa|cnic|license|licence|renew|tax|return|filing|paperwork)\b/.test(low)) { cat = 'Document'; if (!pres.length) pres = [4320, 1440]; if (follow === 'off') follow = '1440x7'; }
  else if (/\b(doctor|dentist|appointment|meeting|interview|call with|clinic)\b/.test(low)) { cat = /doctor|dentist|clinic|medicine/.test(low) ? 'Health' : 'Appointment'; if (!pres.length) pres = [60]; }
  else if (/\b(medicine|pill|pills|tablet|gym|workout|exercise)\b/.test(low)) cat = 'Health';
  else if (/\b(follow up|follow-up|reply|call back|get back to)\b/.test(low)) cat = 'Follow-up';
  else if (/\b(client|office|work|project|deadline|report|proposal|audit)\b/.test(low)) cat = 'Work';
  if (cat && db.cats.indexOf(cat) < 0) cat = null;

  // title
  var title = s.replace(/^\s*(please |pls |hey |ok |okay )*/, ' ')
    .replace(/\b(can you |could you |would you )?(please )?(set (up )?(a |an )?(reminder|alarm|task)( for me)?( to| for| about)?|add (a |an )?(task|reminder|todo)( to| for)?|create (a |an )?(task|reminder)( to| for)?|remind me (to |about |that |of )?|remind me|i need to|i have to|i must|i should|don'?t forget to|make sure (i|to)|schedule)\b/g, ' ')
    .replace(/\b(on|at|by|for|this|next|in|of|the)\s*$/g, ' ')
    .replace(/^\s*(to|for|about|that)\b/, ' ')
    .replace(/\s+/g, ' ').trim();
  title = title.replace(/\b(on|at|by|for|this|next|in|and|to)$/g, '').trim();
  // keep original casing where possible
  var origIdx = raw.toLowerCase().indexOf(title);
  if (title && origIdx >= 0) title = raw.substr(origIdx, title.length);
  title = cap1(title.replace(/[.!?]+$/, ''));

  var missing = [];
  if (!title) missing.push('title');
  var when = null;
  if (date || time) {
    var base = date ? new Date(date) : sod(now);
    var tt = time || ((cat === 'Birthday' || cat === 'Bill' || cat === 'Document') ? [9, 0] : (date ? [9, 0] : null));
    if (tt) {
      base.setHours(tt[0], tt[1], 0, 0);
      if (!date && base <= now) base = addDays(base, 1);
      if (date && repeat === 'yearly' && base < now) base.setFullYear(base.getFullYear() + 1);
      when = base;
    }
  }
  if (!when) missing.push('when');
  return { draft: { title: title, dueAt: when ? when.toISOString() : null, repeat: repeat, everyN: everyN || 2, pres: uniq(pres), follow: follow, style: style, cat: cat || 'Personal', priority: priority, notes: '', tone: db.settings.defaultTone || 'default' }, missing: missing };
}
function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
function to24(h, mi, ap) {
  ap = ap ? ap.replace(/\./g, '') : '';
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (!ap && h >= 1 && h <= 6) h += 12; // "at 5" => 17:00
  return [h, mi];
}
function mkDate(d, mIdx, y) {
  var now = new Date(), yr = y ? (+y < 100 ? 2000 + +y : +y) : now.getFullYear();
  var x = new Date(yr, mIdx, d);
  if (!y && x < sod(now)) x = new Date(yr + 1, mIdx, d);
  return x;
}
function nextWeekday(idx, includeToday, forceNext) {
  var d = sod(new Date()), diff = (idx - d.getDay() + 7) % 7;
  if (diff === 0 && !includeToday) diff = 7;
  if (forceNext && diff < 7 && diff !== 0) { /* "next friday" = the coming one */ }
  return addDays(d, diff);
}

/* ---------- intents ---------- */
function findTasks(q) {
  var words = q.toLowerCase().split(/\s+/).filter(function (w) { return w.length > 1 && ['the', 'my', 'task', 'reminder', 'as', 'done', 'to'].indexOf(w) < 0; });
  return db.tasks.filter(function (t) { var h = (t.title + ' ' + t.cat + ' ' + t.notes).toLowerCase(); return words.length && words.every(function (w) { return h.indexOf(w) >= 0; }); });
}
function agenda(range) {
  var now = new Date(), days = range === 'week' ? 7 : 1, start = range === 'tomorrow' ? addDays(sod(now), 1) : sod(now), lines = [];
  if (range === 'overdue') {
    var ov = allOverdue();
    return ov.length ? 'Overdue:\n' + ov.map(function (x) { return '• ' + x.t.title + ' — ' + whenLabel(x.at); }).join('\n') : 'Nothing overdue.';
  }
  for (var i = 0; i < days; i++) {
    var d = addDays(start, i), it = dayItems(d);
    if (it.length) lines.push(dayLabel(d) + ':\n' + it.map(function (x) { return (x.done ? '✓ ' : '• ') + hm(x.at) + ' ' + x.t.title; }).join('\n'));
  }
  return lines.length ? lines.join('\n\n') : 'Nothing scheduled ' + (range === 'week' ? 'this week' : range) + '.';
}

var pendingDraft = null;
async function offlineAssistant(text) {
  var low = digitsFix(text.toLowerCase().trim()), m;
  if (pendingDraft) {
    var p = parseTask('x ' + text);
    if (p.draft.dueAt) { var d = pendingDraft; pendingDraft = null; d.dueAt = p.draft.dueAt; if (p.draft.repeat !== 'none') d.repeat = p.draft.repeat; return { reply: 'Done.', actions: [{ type: 'add_task', task: d }] }; }
    if (/^(cancel|never ?mind|no)\b/.test(low)) { pendingDraft = null; return { reply: 'Cancelled.', actions: [] }; }
  }
  if (/^(help|what can you do|\?)$/.test(low)) return { reply: HELP_TEXT, actions: [] };
  if ((m = /^(?:add |save |new |take )?(?:a )?(?:quick )?note[:\s-]+(.+)$/i.exec(text.trim()))) return { reply: 'Note saved.', actions: [{ type: 'add_note', text: m[1].trim() }] };
  if ((m = /^(?:add (?:to )?(?:my )?routine|routine)[:\s-]+(.+)$/i.exec(text.trim()))) {
    var pr = parseTask(m[1]); var tm = pr.draft.dueAt ? hm(pr.draft.dueAt) : '';
    return { reply: 'Added to your daily routine' + (tm ? ' with a reminder at ' + tm : '') + '.', actions: [{ type: 'add_routine', text: pr.draft.title || m[1], time: tm }] };
  }
  if (/\b(what|whats|what's|show|list|any)\b.*\b(today|tomorrow|this week|week|overdue|pending|agenda|schedule|due)\b/.test(low) || /^(agenda|today|tomorrow|overdue)\??$/.test(low)) {
    var rg = /overdue|pending/.test(low) ? 'overdue' : /tomorrow/.test(low) ? 'tomorrow' : /week/.test(low) ? 'week' : 'today';
    return { reply: agenda(rg), actions: [] };
  }
  if ((m = /^(?:mark |set )?(.+?) (?:as )?(?:done|complete|completed|finished)$/.exec(low)) || (m = /^(?:done|complete|finish|finished|mark done)[:\s]+(.+)$/.exec(low))) {
    var f = findTasks(m[1]);
    if (f.length === 1) return { reply: 'Marked "' + f[0].title + '" as done.', actions: [{ type: 'complete_task', id: f[0].id }] };
    if (f.length > 1) return { reply: 'Which one? ' + f.slice(0, 5).map(function (t) { return '"' + t.title + '"'; }).join(', '), actions: [] };
  }
  if ((m = /^(?:delete|remove|cancel)(?: the)?(?: task| reminder)?[:\s]+(.+)$/.exec(low))) {
    var f2 = findTasks(m[1]);
    if (f2.length === 1) return { reply: 'Delete "' + f2[0].title + '"?', actions: [{ type: 'delete_task', id: f2[0].id }] };
    return { reply: f2.length ? 'More than one match: ' + f2.slice(0, 5).map(function (t) { return '"' + t.title + '"'; }).join(', ') : 'I could not find that task.', actions: [] };
  }
  if ((m = /^(?:find|search|look for|where is)[:\s]+(.+)$/.exec(low))) return { reply: '', actions: [{ type: 'search', q: m[1] }] };
  if (/\b(password|passwords|vault|credential|login)\b/.test(low) && !/\bchange\b.*\b(remind|every)\b/.test(low)) return { reply: 'For safety I never handle passwords. Open the Vault tab to add or view credentials.', actions: [] };

  var res = parseTask(text);
  if (res.missing.indexOf('title') >= 0) return { reply: 'What should I remind you about? Try: "Pay electricity bill on 5th at 10am, remind me 2 days before".', actions: [] };
  if (res.missing.indexOf('when') >= 0) { pendingDraft = res.draft; return { reply: 'When should I remind you about "' + res.draft.title + '"? (e.g. "tomorrow 9am", "on 12 Nov", "every Monday at 8")', actions: [] }; }
  return { reply: 'Done.', actions: [{ type: 'add_task', task: res.draft }] };
}
var HELP_TEXT = 'Tell me in plain words, for example:\n• Remind me to pay the electricity bill on 5th at 10am, 2 days before\n• Ali\'s birthday on 12 March\n• Submit visa documents next Friday at 11, remind me 3 days and 1 day before, until done\n• Take medicine every day at 9pm\n• Call the client in 2 hours\n• note: wifi password is on the router\n• routine: drink water at 11am\n• What\'s due this week?\n• Mark electricity bill done\n• Delete gym task';

/* ---------- cloud AI ---------- */
function aiSystemPrompt() {
  var now = new Date();
  var tasks = db.tasks.filter(isTaskOpen).slice(0, 60).map(function (t) { return { id: t.id, title: t.title, next: ymd(nextOcc(t)) + ' ' + hm(nextOcc(t)), repeat: t.repeat, category: t.cat }; });
  return 'You are the assistant inside "RemindMe", a personal reminder app. Current local date-time: ' + ymd(now) + ' ' + hm(now) + ' (' + DOW[now.getDay()] + '), UTC offset ' + (-now.getTimezoneOffset() / 60) + 'h.\n' +
    'Turn the user request into app actions. Reply ONLY with JSON: {"reply": "short friendly confirmation or answer", "actions": [ ... ]}.\n' +
    'Action types:\n' +
    '{"type":"add_task","title":str,"date":"YYYY-MM-DD","time":"HH:MM","repeat":"none|daily|weekdays|weekly|monthly|yearly|everyN","everyN":int,"remindBefore":[minutes...],"followUp":"off|30x6|60x8|180x4|1440x1|1440x7","alert":"alarm|notify","category":one of ' + JSON.stringify(db.cats) + ',"priority":"normal|high","notes":str}\n' +
    '{"type":"add_note","text":str}\n{"type":"add_routine","text":str,"time":"HH:MM or empty"}\n{"type":"complete_task","id":int}\n{"type":"delete_task","id":int}\n{"type":"search","q":str}\n' +
    'Rules: default alert "alarm". Birthdays: yearly, notify, remindBefore [1440]. Bills: followUp "1440x7", remindBefore [2880]. Document submissions: remindBefore [4320,1440], followUp "1440x7". If no time is given use 09:00. If the date is ambiguous or missing, ask in "reply" with no actions. ' +
    'For questions about the schedule, answer in "reply" using the task list. Never handle passwords or vault data.\nOpen tasks: ' + JSON.stringify(tasks);
}
async function httpPost(url, headers, data) {
  if (P.CapacitorHttp) {
    var r = await P.CapacitorHttp.request({ url: url, method: 'POST', headers: headers, data: data, connectTimeout: 20000, readTimeout: 60000 });
    if (r.status >= 400) throw new Error('HTTP ' + r.status + ': ' + (typeof r.data === 'string' ? r.data : JSON.stringify(r.data)).slice(0, 300));
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }
  var res = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(data) });
  var j = await res.json();
  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + JSON.stringify(j).slice(0, 300));
  return j;
}
async function cloudAssistant(text) {
  var ai = db.settings.ai, model = ai.model || AI_DEFAULT_MODEL[ai.provider], sys = aiSystemPrompt();
  var hist = (db.chat || []).slice(-8).map(function (m) { return { role: m.role === 'me' ? 'user' : 'assistant', content: m.text }; });
  hist.push({ role: 'user', content: text });
  var out;
  if (ai.provider === 'gemini') {
    var g = await httpPost('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(ai.key),
      { 'Content-Type': 'application/json' },
      { systemInstruction: { parts: [{ text: sys }] }, contents: hist.map(function (h) { return { role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] }; }), generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } });
    out = g.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('');
  } else if (ai.provider === 'anthropic') {
    var a = await httpPost('https://api.anthropic.com/v1/messages', { 'Content-Type': 'application/json', 'x-api-key': ai.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      { model: model, max_tokens: 1024, system: sys, messages: hist });
    out = a.content.map(function (c) { return c.text || ''; }).join('');
  } else {
    var base = ai.provider === 'compat' ? (ai.baseUrl || 'https://api.groq.com/openai/v1').replace(/\/$/, '') : 'https://api.openai.com/v1';
    var o = await httpPost(base + '/chat/completions', { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ai.key },
      { model: model, temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }].concat(hist) });
    out = o.choices[0].message.content;
  }
  var j = JSON.parse(String(out).replace(/^```(json)?/, '').replace(/```$/, '').trim());
  return { reply: j.reply || '', actions: (j.actions || []).map(normalizeAiAction).filter(Boolean) };
}
function normalizeAiAction(a) {
  if (!a || !a.type) return null;
  if (a.type === 'add_task') {
    if (!a.title || !a.date) return null;
    var due = parseLocal(a.date, a.time || '09:00');
    return { type: 'add_task', task: { title: cap1(a.title), dueAt: due.toISOString(), repeat: REP[a.repeat] ? a.repeat : 'none', everyN: a.everyN || 2,
      pres: Array.isArray(a.remindBefore) ? a.remindBefore.map(Number).filter(function (x) { return x > 0; }) : [],
      follow: FOLLOW[a.followUp] ? a.followUp : 'off', style: a.alert === 'notify' ? 'notify' : 'alarm',
      cat: db.cats.indexOf(a.category) >= 0 ? a.category : 'Personal', priority: a.priority === 'high' ? 'high' : 'normal', notes: a.notes || '', tone: db.settings.defaultTone || 'default' } };
  }
  return a;
}
async function runAssistant(text) {
  var ai = db.settings.ai;
  if (ai.provider !== 'offline' && ai.key) {
    try { return await cloudAssistant(text); }
    catch (e) { jlog('AI error ' + e.message); var r = await offlineAssistant(text); r.reply = '(Cloud AI failed: ' + e.message.slice(0, 120) + ' — used offline mode)\n' + r.reply; return r; }
  }
  return offlineAssistant(text);
}
