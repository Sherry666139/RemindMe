package com.remindme.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONObject;

public class AlarmReceiver extends BroadcastReceiver {
    static final String ACTION_FIRE = "com.remindme.app.FIRE";
    static final String ACTION_DONE = "com.remindme.app.DONE";
    static final String ACTION_SNOOZE = "com.remindme.app.SNOOZE";
    static final String ACTION_DISMISS = "com.remindme.app.DISMISS";

    @Override
    public void onReceive(Context c, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        int id = intent.getIntExtra("id", 0);
        try {
            Notifier.ensureChannels(c);
            if (ACTION_FIRE.equals(action)) {
                fire(c, id);
            } else if (ACTION_DONE.equals(action) || ACTION_SNOOZE.equals(action) || ACTION_DISMISS.equals(action)) {
                Actions.handle(c, action, id, intent.getIntExtra("min", 0));
            } else {
                // BOOT_COMPLETED, MY_PACKAGE_REPLACED, TIME_SET, TIMEZONE_CHANGED ...
                AlarmStore.rescheduleAll(c, action);
            }
        } catch (Exception e) {
            AlarmStore.log(c, "receiver error " + action + ": " + e);
        }
    }

    static void fire(Context c, int id) {
        JSONObject a = AlarmStore.get(c, id);
        if (a == null) {
            AlarmStore.log(c, "FIRE id=" + id + " not found (cancelled)");
            return;
        }
        String kind = a.optString("kind", "notify");
        AlarmStore.log(c, "FIRE id=" + id + " kind=" + kind + " '" + a.optString("title") + "'");
        if ("ring".equals(kind)) {
            Intent s = new Intent(c, AlarmService.class);
            s.setAction(AlarmService.CMD_RING);
            s.putExtra("id", id);
            try {
                if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(s);
                else c.startService(s);
            } catch (Exception e) {
                // Foreground service start blocked: fall back to a loud full-screen notification
                AlarmStore.log(c, "FGS blocked, fallback: " + e);
                try {
                    Notifier.nm(c).notify(id, Notifier.ring(c, a));
                } catch (Exception e2) {
                    Notifier.showNotify(c, a);
                }
                AlarmService.scheduleReRing(c, a);
            }
        } else {
            try {
                a.put("fired", true);
            } catch (Exception ignored) {
            }
            AlarmStore.put(c, a);
            Notifier.showNotify(c, a);
            if ("summary".equals(kind)) AlarmStore.remove(c, id);
        }
    }
}
