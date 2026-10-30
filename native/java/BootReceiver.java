package com.remindme.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Re-arms every stored alarm after reboot, app update, time change or exact-alarm permission change. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        String a = intent.getAction();
        if ("android.intent.action.LOCKED_BOOT_COMPLETED".equals(a)) return; // storage not unlocked yet
        try {
            Notifier.ensureChannels(c);
            AlarmStore.rescheduleAll(c, a == null ? "boot" : a);
            if (GeoFences.all(c).length() > 0) GeoFences.registerAll(c, a == null ? "boot" : a);
        } catch (Exception e) {
            AlarmStore.log(c, "boot error " + e);
        }
    }
}
