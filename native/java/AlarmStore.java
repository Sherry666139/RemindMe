package com.remindme.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;

/** Persistent alarm list + AlarmManager scheduling + debug log. */
public class AlarmStore {
    static final String PREFS = "rm_alarm_store";
    static final String K_ALARMS = "alarms";
    static final String K_EVENTS = "events";
    static final String K_LOG = "log";

    static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized JSONObject all(Context c) {
        try {
            return new JSONObject(prefs(c).getString(K_ALARMS, "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static synchronized void putAll(Context c, JSONObject m) {
        prefs(c).edit().putString(K_ALARMS, m.toString()).apply();
    }

    static synchronized JSONObject get(Context c, int id) {
        return all(c).optJSONObject(String.valueOf(id));
    }

    static synchronized void put(Context c, JSONObject a) {
        try {
            JSONObject m = all(c);
            m.put(String.valueOf(a.optInt("id")), a);
            putAll(c, m);
        } catch (Exception e) {
            log(c, "put error " + e);
        }
    }

    static synchronized void remove(Context c, int id) {
        JSONObject m = all(c);
        m.remove(String.valueOf(id));
        putAll(c, m);
    }

    static PendingIntent firePi(Context c, int id) {
        Intent i = new Intent(c, AlarmReceiver.class);
        i.setAction(AlarmReceiver.ACTION_FIRE);
        i.setData(Uri.parse("rm://fire/" + id));
        i.putExtra("id", id);
        return PendingIntent.getBroadcast(c, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static boolean canExact(Context c) {
        if (Build.VERSION.SDK_INT < 31) return true;
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        try {
            return am.canScheduleExactAlarms();
        } catch (Exception e) {
            return false;
        }
    }

    static void schedule(Context c, JSONObject a) {
        int id = a.optInt("id");
        long at = a.optLong("at");
        String kind = a.optString("kind", "notify");
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = firePi(c, id);
        try {
            if (canExact(c)) {
                if ("ring".equals(kind)) {
                    Intent show = new Intent(c, MainActivity.class);
                    show.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    PendingIntent showPi = PendingIntent.getActivity(c, id, show, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                    am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, showPi), pi);
                } else {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                }
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (Exception e) {
            log(c, "schedule fallback " + id + ": " + e);
            try {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } catch (Exception e2) {
                log(c, "schedule failed " + id + ": " + e2);
            }
        }
    }

    static void cancel(Context c, int id) {
        try {
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            am.cancel(firePi(c, id));
        } catch (Exception e) {
            log(c, "cancel error " + e);
        }
    }

    /** Cancels and removes every alarm in the group. Returns removed ids. */
    static synchronized List<Integer> cancelGroup(Context c, String group) {
        List<Integer> ids = new ArrayList<>();
        if (group == null || group.length() == 0) return ids;
        JSONObject m = all(c);
        Iterator<String> it = m.keys();
        List<String> rm = new ArrayList<>();
        while (it.hasNext()) {
            String k = it.next();
            JSONObject a = m.optJSONObject(k);
            if (a != null && group.equals(a.optString("group"))) rm.add(k);
        }
        for (String k : rm) {
            int id = Integer.parseInt(k);
            cancel(c, id);
            Notifier.cancel(c, id);
            m.remove(k);
            ids.add(id);
        }
        putAll(c, m);
        return ids;
    }

    static synchronized void rescheduleAll(Context c, String why) {
        JSONObject m = all(c);
        long now = System.currentTimeMillis();
        int n = 0;
        Iterator<String> it = m.keys();
        while (it.hasNext()) {
            JSONObject a = m.optJSONObject(it.next());
            if (a == null || a.optBoolean("fired")) continue;
            long at = a.optLong("at");
            if (at <= now) {
                // Missed while phone was off / app was updated: fire shortly if recent (12h)
                if (now - at < 12L * 3600_000L) {
                    try { a.put("at", now + 15_000L + n * 2000L); } catch (Exception ignored) { }
                } else continue;
            }
            schedule(c, a);
            n++;
        }
        putAll(c, m);
        log(c, "rescheduleAll(" + why + ") -> " + n + " alarms");
    }

    static synchronized void addEvent(Context c, JSONObject ev) {
        try {
            JSONArray arr = new JSONArray(prefs(c).getString(K_EVENTS, "[]"));
            arr.put(ev);
            while (arr.length() > 300) arr.remove(0);
            prefs(c).edit().putString(K_EVENTS, arr.toString()).apply();
        } catch (Exception e) {
            log(c, "event error " + e);
        }
    }

    static synchronized JSONArray takeEvents(Context c) {
        JSONArray arr;
        try {
            arr = new JSONArray(prefs(c).getString(K_EVENTS, "[]"));
        } catch (Exception e) {
            arr = new JSONArray();
        }
        prefs(c).edit().putString(K_EVENTS, "[]").apply();
        return arr;
    }

    static synchronized void log(Context c, String msg) {
        try {
            String ts = new SimpleDateFormat("MM-dd HH:mm:ss", Locale.US).format(new Date());
            String cur = prefs(c).getString(K_LOG, "");
            cur = cur + ts + " " + msg + "\n";
            if (cur.length() > 40000) cur = cur.substring(cur.length() - 30000);
            prefs(c).edit().putString(K_LOG, cur).apply();
        } catch (Exception ignored) {
        }
    }

    static String getLog(Context c) {
        return prefs(c).getString(K_LOG, "");
    }

    static void clearLog(Context c) {
        prefs(c).edit().putString(K_LOG, "").apply();
    }

    static String hm(long t) {
        return new SimpleDateFormat("HH:mm", Locale.US).format(new Date(t));
    }
}
