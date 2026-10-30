package com.remindme.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;

import java.util.List;

public class GeofenceReceiver extends BroadcastReceiver {
    static final String ACTION = "com.remindme.app.GEOFENCE";

    @Override
    public void onReceive(Context c, Intent intent) {
        try {
            Notifier.ensureChannels(c);
            GeofencingEvent ev = GeofencingEvent.fromIntent(intent);
            if (ev == null) return;
            if (ev.hasError()) {
                AlarmStore.log(c, "geofence error code " + ev.getErrorCode());
                if (ev.getErrorCode() == 1000) GeoFences.registerAll(c, "error-1000"); // location turned off then on
                return;
            }
            int tr = ev.getGeofenceTransition();
            String t = tr == Geofence.GEOFENCE_TRANSITION_EXIT ? "exit" : "enter";
            List<Geofence> list = ev.getTriggeringGeofences();
            if (list == null) return;
            for (Geofence g : list) {
                try {
                    GeoFences.trigger(c, Integer.parseInt(g.getRequestId()), t);
                } catch (NumberFormatException ignored) {
                }
            }
        } catch (Exception e) {
            AlarmStore.log(c, "geofence receiver error " + e);
        }
    }
}
