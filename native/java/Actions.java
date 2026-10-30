package com.remindme.app;

import android.content.Context;

import org.json.JSONObject;

/** Done / Snooze / Dismiss handling, shared by notification buttons and the full-screen alarm. */
public class Actions {

    static void handle(Context c, String action, int id, int min) {
        JSONObject a = AlarmStore.get(c, id);
        String group = a != null ? a.optString("group") : "";
        AlarmService.stopIfRinging(c, id);
        Notifier.cancel(c, id);
        JSONObject ev = new JSONObject();
        try {
            ev.put("id", id);
            ev.put("group", group);
            ev.put("ref", a != null ? a.optString("ref") : "");
            ev.put("at", System.currentTimeMillis());
        } catch (Exception ignored) {
        }
        if (AlarmReceiver.ACTION_DONE.equals(action)) {
            AlarmStore.cancelGroup(c, group);
            AlarmStore.cancel(c, id);
            AlarmStore.remove(c, id);
            put(ev, "action", "done");
            AlarmStore.log(c, "DONE id=" + id + " group=" + group);
        } else if (AlarmReceiver.ACTION_SNOOZE.equals(action)) {
            if (a != null) {
                if (min <= 0) min = a.optInt("snoozeMin", 10);
                long at = System.currentTimeMillis() + min * 60_000L;
                try {
                    a.put("at", at);
                    a.put("snoozed", true);
                    a.put("fired", false);
                    a.put("repeats", 0);
                } catch (Exception ignored) {
                }
                AlarmStore.put(c, a);
                AlarmStore.schedule(c, a);
                put(ev, "until", at);
                AlarmStore.log(c, "SNOOZE id=" + id + " " + min + "m -> " + AlarmStore.hm(at));
            }
            put(ev, "action", "snooze");
        } else {
            // Dismiss: stop this alarm only, keep follow-ups of the group
            AlarmStore.cancel(c, id);
            AlarmStore.remove(c, id);
            put(ev, "action", "dismiss");
            AlarmStore.log(c, "DISMISS id=" + id);
        }
        AlarmStore.addEvent(c, ev);
        RmAlarmPlugin.emit(ev);
        AlarmActivity.closeIfShowing(id);
    }

    static void put(JSONObject o, String k, Object v) {
        try {
            o.put(k, v);
        } catch (Exception ignored) {
        }
    }
}
