package com.remindme.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import org.json.JSONObject;

/** Builds every notification the app shows. */
public class Notifier {
    static final String CH_RING = "rm_ring_v3";
    static final String CH_NOTIFY = "rm_notify_v3";
    static final String CH_SUMMARY = "rm_summary_v3";
    static final String CH_MISSED = "rm_missed_v3";

    static NotificationManager nm(Context c) {
        return (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = nm(c);
        if (nm.getNotificationChannel(CH_RING) == null) {
            NotificationChannel ch = new NotificationChannel(CH_RING, "Alarms (ring until done)", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Task alarms. Sound is played by the app itself so it works on the lock screen.");
            ch.setSound(null, null);
            ch.enableVibration(false);
            ch.setBypassDnd(true);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CH_NOTIFY) == null) {
            NotificationChannel ch = new NotificationChannel(CH_NOTIFY, "Reminders", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Early reminders, follow-ups and password reminders");
            Uri snd = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            ch.setSound(snd, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            ch.enableVibration(true);
            ch.setBypassDnd(true);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CH_SUMMARY) == null) {
            NotificationChannel ch = new NotificationChannel(CH_SUMMARY, "Daily summary", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CH_MISSED) == null) {
            NotificationChannel ch = new NotificationChannel(CH_MISSED, "Missed alarms", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setSound(null, null);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
    }

    static Notification.Builder builder(Context c, String ch) {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, ch) : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_stat_rm);
        b.setVisibility(Notification.VISIBILITY_PUBLIC);
        b.setShowWhen(true);
        return b;
    }

    static PendingIntent openApp(Context c, int id, String group) {
        Intent i = new Intent(c, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.setData(Uri.parse("rm://open/" + id));
        i.putExtra("rmGroup", group);
        return PendingIntent.getActivity(c, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static PendingIntent actionPi(Context c, int id, String action, int min) {
        Intent i = new Intent(c, AlarmReceiver.class);
        i.setAction(action);
        i.setData(Uri.parse("rm://act/" + id + "/" + action + "/" + min));
        i.putExtra("id", id);
        i.putExtra("min", min);
        return PendingIntent.getBroadcast(c, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void addActions(Context c, Notification.Builder b, JSONObject a) {
        int id = a.optInt("id");
        String buttons = a.optString("buttons", "done,snooze,dismiss");
        int snooze = a.optInt("snoozeMin", 10);
        if (buttons.contains("done"))
            b.addAction(new Notification.Action.Builder(0, a.optString("doneLabel", "✓ Done"), actionPi(c, id, AlarmReceiver.ACTION_DONE, 0)).build());
        if (buttons.contains("snooze"))
            b.addAction(new Notification.Action.Builder(0, "Snooze " + snoozeLabel(snooze), actionPi(c, id, AlarmReceiver.ACTION_SNOOZE, snooze)).build());
        if (buttons.contains("dismiss"))
            b.addAction(new Notification.Action.Builder(0, "Dismiss", actionPi(c, id, AlarmReceiver.ACTION_DISMISS, 0)).build());
    }

    static String snoozeLabel(int min) {
        if (min >= 1440 && min % 1440 == 0) return (min / 1440) + "d";
        if (min >= 60 && min % 60 == 0) return (min / 60) + "h";
        return min + "m";
    }

    /** Notification shown while ringing (also the foreground-service notification). */
    static Notification ring(Context c, JSONObject a) {
        int id = a.optInt("id");
        Notification.Builder b = builder(c, CH_RING);
        b.setContentTitle(a.optString("title", "Reminder"));
        String body = a.optString("body", "");
        b.setContentText(body.length() > 0 ? body : "Tap Done when finished");
        b.setStyle(new Notification.BigTextStyle().bigText(body));
        b.setCategory(Notification.CATEGORY_ALARM);
        b.setPriority(Notification.PRIORITY_MAX);
        b.setOngoing(true);
        b.setAutoCancel(false);
        Intent fs = new Intent(c, AlarmActivity.class);
        fs.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        fs.setData(Uri.parse("rm://ring/" + id));
        fs.putExtra("id", id);
        PendingIntent fsPi = PendingIntent.getActivity(c, id, fs, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        b.setFullScreenIntent(fsPi, true);
        b.setContentIntent(fsPi);
        b.setDeleteIntent(actionPi(c, id, AlarmReceiver.ACTION_DISMISS, 0));
        addActions(c, b, a);
        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT;
        return n;
    }

    static void showNotify(Context c, JSONObject a) {
        int id = a.optInt("id");
        String kind = a.optString("kind");
        String ch = "summary".equals(kind) ? CH_SUMMARY : CH_NOTIFY;
        Notification.Builder b = builder(c, ch);
        b.setContentTitle(a.optString("title", "Reminder"));
        String body = a.optString("body", "");
        b.setContentText(body);
        b.setStyle(new Notification.BigTextStyle().bigText(body));
        b.setPriority("summary".equals(kind) ? Notification.PRIORITY_DEFAULT : Notification.PRIORITY_HIGH);
        b.setCategory("summary".equals(kind) ? Notification.CATEGORY_STATUS : Notification.CATEGORY_REMINDER);
        b.setAutoCancel(true);
        b.setContentIntent(openApp(c, id, a.optString("group")));
        if (!"summary".equals(kind)) addActions(c, b, a);
        try {
            nm(c).notify(id, b.build());
        } catch (Exception e) {
            AlarmStore.log(c, "notify error " + e);
        }
    }

    static void showMissed(Context c, JSONObject a, long nextAt) {
        int id = a.optInt("id");
        Notification.Builder b = builder(c, CH_MISSED);
        b.setContentTitle("Missed: " + a.optString("title", "Reminder"));
        String txt = nextAt > 0 ? "Not done yet — will ring again at " + AlarmStore.hm(nextAt) : "Not marked done";
        b.setContentText(txt);
        b.setCategory(Notification.CATEGORY_REMINDER);
        b.setAutoCancel(false);
        b.setContentIntent(openApp(c, id, a.optString("group")));
        addActions(c, b, a);
        try {
            nm(c).notify(id, b.build());
        } catch (Exception e) {
            AlarmStore.log(c, "missed notify error " + e);
        }
    }

    static void showSimple(Context c, int id, String title, String body) {
        Notification.Builder b = builder(c, CH_NOTIFY);
        b.setContentTitle(title);
        b.setContentText(body);
        b.setStyle(new Notification.BigTextStyle().bigText(body));
        b.setAutoCancel(true);
        b.setContentIntent(openApp(c, id, ""));
        try {
            nm(c).notify(id, b.build());
        } catch (Exception e) {
            AlarmStore.log(c, "simple notify error " + e);
        }
    }

    static void cancel(Context c, int id) {
        try {
            nm(c).cancel(id);
        } catch (Exception ignored) {
        }
    }
}
