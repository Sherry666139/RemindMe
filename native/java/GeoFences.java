package com.remindme.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;

import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/** Location reminders: stored places + Android geofences. */
public class GeoFences {
    static final String K_PLACES = "places";

    static synchronized JSONObject all(Context c) {
        try {
            return new JSONObject(AlarmStore.prefs(c).getString(K_PLACES, "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static synchronized void putAll(Context c, JSONObject m) {
        AlarmStore.prefs(c).edit().putString(K_PLACES, m.toString()).apply();
    }

    static boolean hasFine(Context c) {
        return c.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || c.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean hasBackground(Context c) {
        if (Build.VERSION.SDK_INT < 29) return hasFine(c);
        return c.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean locationOn(Context c) {
        try {
            LocationManager lm = (LocationManager) c.getSystemService(Context.LOCATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 28) return lm.isLocationEnabled();
            return lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (Exception e) {
            return false;
        }
    }

    static boolean gmsOk(Context c) {
        try {
            return GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(c) == ConnectionResult.SUCCESS;
        } catch (Throwable e) {
            return false;
        }
    }

    static PendingIntent pi(Context c) {
        Intent i = new Intent(c, GeofenceReceiver.class);
        i.setAction(GeofenceReceiver.ACTION);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
        return PendingIntent.getBroadcast(c, 7700, i, flags);
    }

    /** Removes all geofences and registers the active places again. Returns a status string. */
    @SuppressLint("MissingPermission")
    static String registerAll(Context c, String why) {
        GeofencingClient client;
        try {
            client = LocationServices.getGeofencingClient(c);
        } catch (Throwable e) {
            AlarmStore.log(c, "geofence client error " + e);
            return "no-gms";
        }
        try {
            client.removeGeofences(pi(c));
        } catch (Exception ignored) {
        }
        JSONObject m = all(c);
        List<Geofence> list = new ArrayList<>();
        Iterator<String> it = m.keys();
        while (it.hasNext()) {
            JSONObject p = m.optJSONObject(it.next());
            if (p == null || !p.optBoolean("active", true) || !p.optBoolean("armed", true)) continue;
            int radius = Math.max(80, p.optInt("radius", 200));
            String trig = p.optString("trigger", "enter");
            int t = 0;
            if (trig.contains("enter")) t |= Geofence.GEOFENCE_TRANSITION_ENTER;
            if (trig.contains("exit")) t |= Geofence.GEOFENCE_TRANSITION_EXIT;
            if (t == 0) t = Geofence.GEOFENCE_TRANSITION_ENTER;
            list.add(new Geofence.Builder()
                    .setRequestId(String.valueOf(p.optInt("id")))
                    .setCircularRegion(p.optDouble("lat"), p.optDouble("lng"), radius)
                    .setExpirationDuration(Geofence.NEVER_EXPIRE)
                    .setTransitionTypes(t)
                    .setNotificationResponsiveness(30_000)
                    .build());
            if (list.size() >= 95) break;
        }
        if (list.isEmpty()) {
            AlarmStore.log(c, "geofences cleared (" + why + ")");
            return "none";
        }
        if (!hasFine(c)) {
            AlarmStore.log(c, "geofences not registered: no location permission");
            return "no-permission";
        }
        if (!hasBackground(c)) {
            AlarmStore.log(c, "geofences: background location not granted; will only work while app is open");
        }
        try {
            GeofencingRequest req = new GeofencingRequest.Builder()
                    .setInitialTrigger(0)
                    .addGeofences(list)
                    .build();
            final int n = list.size();
            client.addGeofences(req, pi(c))
                    .addOnSuccessListener(v -> AlarmStore.log(c, "geofences registered: " + n + " (" + why + ")"))
                    .addOnFailureListener(e -> AlarmStore.log(c, "geofence register FAILED: " + e));
            return "ok";
        } catch (Exception e) {
            AlarmStore.log(c, "geofence add error " + e);
            return "error: " + e.getMessage();
        }
    }

    /** Called on arrival/leave (from geofence or from the fast-tracking watcher). */
    static void trigger(Context c, int placeId, String transition) {
        JSONObject m = all(c);
        JSONObject p = m.optJSONObject(String.valueOf(placeId));
        if (p == null) {
            AlarmStore.log(c, "geofence " + placeId + " unknown");
            return;
        }
        if (!p.optBoolean("active", true) || !p.optBoolean("armed", true)) return;
        long now = System.currentTimeMillis();
        long cool = p.optInt("cooldownMin", 120) * 60_000L;
        if (now - p.optLong("lastFired", 0) < cool) {
            AlarmStore.log(c, "place " + placeId + " " + transition + " ignored (cooldown)");
            return;
        }
        String body = p.optString("body", "");
        if (body.length() == 0) {
            AlarmStore.log(c, "place " + placeId + " has nothing open, no alert");
            return;
        }
        try {
            p.put("lastFired", now);
            m.put(String.valueOf(placeId), p);
            putAll(c, m);
            JSONObject a = new JSONObject();
            int id = 1900000000 + (placeId % 90000000);
            String g = "p" + placeId + "@" + now;
            a.put("id", id);
            a.put("group", g);
            a.put("ref", "place:" + placeId);
            a.put("kind", "alarm".equals(p.optString("style", "alarm")) ? "ring" : "notify");
            String verb = "exit".equals(transition) ? "Leaving " : "You're at ";
            a.put("title", "📍 " + verb + p.optString("name", "this place"));
            a.put("body", body);
            a.put("at", now);
            a.put("tone", p.optString("tone", "default"));
            a.put("snoozeMin", 10);
            a.put("reRingMin", 0);
            a.put("ringSec", 45);
            a.put("buttons", "done,dismiss");
            a.put("doneLabel", "✓ All done");
            a.put("forceVolume", true);
            a.put("vibrate", true);
            AlarmStore.put(c, a);
            AlarmStore.log(c, "PLACE " + transition + " " + p.optString("name"));
            AlarmReceiver.fire(c, id);
        } catch (Exception e) {
            AlarmStore.log(c, "place trigger error " + e);
        }
    }
}
