package com.remindme.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.WindowManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;
import android.Manifest;
import android.annotation.SuppressLint;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;

@CapacitorPlugin(name = "RmAlarm", permissions = {
        @Permission(alias = "location", strings = {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}),
        @Permission(alias = "bglocation", strings = {Manifest.permission.ACCESS_BACKGROUND_LOCATION})
})
public class RmAlarmPlugin extends Plugin {
    static RmAlarmPlugin instance;

    @Override
    public void load() {
        instance = this;
        Notifier.ensureChannels(getContext());
    }

    /* ---------------- location reminders ---------------- */

    @PluginMethod
    public void syncPlaces(PluginCall call) {
        Context c = getContext();
        try {
            JSArray arr = call.getArray("places", new JSArray());
            JSONObject old = GeoFences.all(c), nu = new JSONObject();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject p = arr.optJSONObject(i);
                if (p == null) continue;
                String k = String.valueOf(p.optInt("id"));
                JSONObject prev = old.optJSONObject(k);
                if (prev != null && !p.has("lastFired")) p.put("lastFired", prev.optLong("lastFired"));
                nu.put(k, p);
            }
            GeoFences.putAll(c, nu);
            String st = GeoFences.registerAll(c, "sync");
            JSObject r = new JSObject();
            r.put("status", st);
            r.put("count", nu.length());
            call.resolve(r);
        } catch (Exception e) {
            AlarmStore.log(c, "syncPlaces error " + e);
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void locationStatus(PluginCall call) {
        Context c = getContext();
        JSObject r = new JSObject();
        r.put("fine", GeoFences.hasFine(c));
        r.put("background", GeoFences.hasBackground(c));
        r.put("enabled", GeoFences.locationOn(c));
        r.put("gms", GeoFences.gmsOk(c));
        r.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(r);
    }

    @PluginMethod
    public void requestLocation(PluginCall call) {
        if (!GeoFences.hasFine(getContext())) {
            requestPermissionForAlias("location", call, "locPermCb");
            return;
        }
        askBackground(call);
    }

    @PermissionCallback
    private void locPermCb(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            JSObject r = new JSObject();
            r.put("fine", false);
            r.put("background", false);
            call.resolve(r);
            return;
        }
        askBackground(call);
    }

    private void askBackground(PluginCall call) {
        Context c = getContext();
        if (GeoFences.hasBackground(c) || Build.VERSION.SDK_INT < 29) {
            JSObject r = new JSObject();
            r.put("fine", true);
            r.put("background", GeoFences.hasBackground(c));
            call.resolve(r);
            return;
        }
        if (Build.VERSION.SDK_INT == 29) {
            requestPermissionForAlias("bglocation", call, "bgPermCb");
            return;
        }
        // Android 11+: "Allow all the time" can only be chosen in Settings
        JSObject r = new JSObject();
        r.put("fine", true);
        r.put("background", false);
        r.put("needsSettings", true);
        call.resolve(r);
    }

    @PermissionCallback
    private void bgPermCb(PluginCall call) {
        JSObject r = new JSObject();
        r.put("fine", true);
        r.put("background", GeoFences.hasBackground(getContext()));
        call.resolve(r);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void getPosition(PluginCall call) {
        Context c = getContext();
        if (!GeoFences.hasFine(c)) {
            call.reject("no-permission");
            return;
        }
        try {
            CancellationTokenSource cts = new CancellationTokenSource();
            LocationServices.getFusedLocationProviderClient(c)
                    .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.getToken())
                    .addOnSuccessListener(loc -> {
                        if (loc == null) {
                            call.reject("no-fix");
                            return;
                        }
                        JSObject r = new JSObject();
                        r.put("lat", loc.getLatitude());
                        r.put("lng", loc.getLongitude());
                        r.put("accuracy", loc.getAccuracy());
                        call.resolve(r);
                    })
                    .addOnFailureListener(e -> call.reject(e.getMessage()));
        } catch (Throwable e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void firePlace(PluginCall call) {
        GeoFences.trigger(getContext(), call.getInt("id", 0), call.getString("transition", "enter"));
        call.resolve();
    }

    static void emit(JSONObject ev) {
        RmAlarmPlugin p = instance;
        if (p == null) return;
        try {
            p.notifyListeners("alarmEvent", JSObject.fromJSONObject(ev));
        } catch (Exception ignored) {
        }
    }

    @PluginMethod
    public void sync(PluginCall call) {
        Context c = getContext();
        try {
            JSArray incoming = call.getArray("alarms", new JSArray());
            JSArray groups = call.getArray("activeGroups", new JSArray());
            Set<String> active = new HashSet<>();
            for (int i = 0; i < groups.length(); i++) active.add(groups.optString(i));
            long now = System.currentTimeMillis();
            JSONObject old = AlarmStore.all(c);
            JSONObject nu = new JSONObject();
            for (int i = 0; i < incoming.length(); i++) {
                JSONObject a = incoming.optJSONObject(i);
                if (a == null) continue;
                String key = String.valueOf(a.optInt("id"));
                JSONObject prev = old.optJSONObject(key);
                if (prev != null && prev.optBoolean("snoozed") && prev.optLong("at") > now) {
                    a.put("at", prev.optLong("at"));
                    a.put("snoozed", true);
                    a.put("repeats", prev.optInt("repeats"));
                }
                nu.put(key, a);
            }
            // keep snoozed / re-ringing alarms whose task is still open
            Iterator<String> it = old.keys();
            while (it.hasNext()) {
                String k = it.next();
                if (nu.has(k)) continue;
                JSONObject prev = old.optJSONObject(k);
                if (prev == null) continue;
                boolean ringingNow = AlarmService.currentId == prev.optInt("id");
                boolean keep = ringingNow || "test".equals(prev.optString("group"))
                        || (prev.optBoolean("snoozed") && prev.optLong("at") > now && active.contains(prev.optString("group")));
                if (keep) nu.put(k, prev);
                else AlarmStore.cancel(c, prev.optInt("id"));
            }
            AlarmStore.putAll(c, nu);
            int scheduled = 0;
            Iterator<String> it2 = nu.keys();
            while (it2.hasNext()) {
                JSONObject a = nu.optJSONObject(it2.next());
                if (a == null || a.optBoolean("fired") || a.optLong("at") <= now) continue;
                AlarmStore.schedule(c, a);
                scheduled++;
            }
            AlarmStore.log(c, "sync: " + incoming.length() + " in, " + scheduled + " scheduled, exact=" + AlarmStore.canExact(c));
            JSObject r = new JSObject();
            r.put("scheduled", scheduled);
            call.resolve(r);
        } catch (Exception e) {
            AlarmStore.log(c, "sync error " + e);
            call.reject("sync failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSONObject m = AlarmStore.all(getContext());
        JSArray arr = new JSArray();
        Iterator<String> it = m.keys();
        while (it.hasNext()) arr.put(m.optJSONObject(it.next()));
        JSObject r = new JSObject();
        r.put("alarms", arr);
        call.resolve(r);
    }

    @PluginMethod
    public void consumeEvents(PluginCall call) {
        JSONArray ev = AlarmStore.takeEvents(getContext());
        JSArray arr = new JSArray();
        for (int i = 0; i < ev.length(); i++) arr.put(ev.optJSONObject(i));
        JSObject r = new JSObject();
        r.put("events", arr);
        call.resolve(r);
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context c = getContext();
        JSObject r = new JSObject();
        NotificationManager nm = Notifier.nm(c);
        r.put("sdk", Build.VERSION.SDK_INT);
        r.put("manufacturer", Build.MANUFACTURER);
        r.put("model", Build.MODEL);
        r.put("notifications", nm.areNotificationsEnabled());
        r.put("exactAlarm", AlarmStore.canExact(c));
        boolean fs = true;
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                fs = nm.canUseFullScreenIntent();
            } catch (Exception ignored) {
            }
        }
        r.put("fullScreen", fs);
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        r.put("batteryIgnored", Build.VERSION.SDK_INT < 23 || pm.isIgnoringBatteryOptimizations(c.getPackageName()));
        r.put("overlay", Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(c));
        int ringImp = 4;
        if (Build.VERSION.SDK_INT >= 26) {
            Notifier.ensureChannels(c);
            NotificationChannel ch = nm.getNotificationChannel(Notifier.CH_RING);
            if (ch != null) ringImp = ch.getImportance();
            NotificationChannel ch2 = nm.getNotificationChannel(Notifier.CH_NOTIFY);
            r.put("notifyChannelImportance", ch2 != null ? ch2.getImportance() : -1);
        }
        r.put("ringChannelImportance", ringImp);
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        r.put("alarmVolume", am.getStreamVolume(AudioManager.STREAM_ALARM));
        r.put("alarmVolumeMax", am.getStreamMaxVolume(AudioManager.STREAM_ALARM));
        r.put("ringerMode", am.getRingerMode());
        r.put("interruptionFilter", nm.getCurrentInterruptionFilter());
        r.put("stored", AlarmStore.all(c).length());
        AlarmManager alm = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        AlarmManager.AlarmClockInfo next = alm.getNextAlarmClock();
        r.put("nextAlarmClock", next != null ? next.getTriggerTime() : 0);
        r.put("ringing", AlarmService.currentId);
        call.resolve(r);
    }

    private boolean start(Intent i) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (i.resolveActivity(getContext().getPackageManager()) == null && i.getComponent() == null) return false;
            getContext().startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void openSetting(PluginCall call) {
        String which = call.getString("which", "app");
        Context c = getContext();
        String pkg = c.getPackageName();
        Uri pkgUri = Uri.parse("package:" + pkg);
        boolean ok = false;
        switch (which) {
            case "notifications":
                if (Build.VERSION.SDK_INT >= 26) {
                    ok = start(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg));
                }
                break;
            case "channel":
                if (Build.VERSION.SDK_INT >= 26) {
                    ok = start(new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                            .putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
                            .putExtra(Settings.EXTRA_CHANNEL_ID, call.getString("channel", Notifier.CH_RING)));
                }
                break;
            case "exact":
                if (Build.VERSION.SDK_INT >= 31) ok = start(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkgUri));
                break;
            case "fullscreen":
                if (Build.VERSION.SDK_INT >= 34) ok = start(new Intent("android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT", pkgUri));
                break;
            case "battery":
                if (Build.VERSION.SDK_INT >= 23) {
                    ok = start(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkgUri));
                    if (!ok) ok = start(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                }
                break;
            case "overlay":
                if (Build.VERSION.SDK_INT >= 23) ok = start(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkgUri));
                break;
            case "autostart":
                ok = openAutostart();
                break;
            case "miui":
                Intent mi = new Intent("miui.intent.action.APP_PERM_EDITOR");
                mi.setClassName("com.miui.securitycenter", "com.miui.permcenter.permissions.PermissionsEditorActivity");
                mi.putExtra("extra_pkgname", pkg);
                ok = start(mi);
                if (!ok) {
                    Intent mi2 = new Intent("miui.intent.action.APP_PERM_EDITOR");
                    mi2.setClassName("com.miui.securitycenter", "com.miui.permcenter.permissions.AppPermissionsEditorActivity");
                    mi2.putExtra("extra_pkgname", pkg);
                    ok = start(mi2);
                }
                break;
            case "alarmVolume":
                ok = start(new Intent(Settings.ACTION_SOUND_SETTINGS));
                break;
            case "location":
                ok = start(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));
                break;
            case "dnd":
                ok = start(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS));
                break;
        }
        if (!ok) ok = start(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkgUri));
        JSObject r = new JSObject();
        r.put("opened", ok);
        call.resolve(r);
    }

    private boolean openAutostart() {
        String[][] comps = new String[][]{
                {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},
                {"com.letv.android.letvsafe", "com.letv.android.letvsafe.AutobootManageActivity"},
                {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
                {"com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"},
                {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
                {"com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"},
                {"com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"},
                {"com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"},
                {"com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"},
                {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"},
                {"com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity"},
                {"com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"},
                {"com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"},
                {"com.asus.mobilemanager", "com.asus.mobilemanager.entry.FunctionActivity"},
                {"com.transsion.phonemaster", "com.cyin.himgr.autostart.AutoStartActivity"},
        };
        PackageManager pm = getContext().getPackageManager();
        for (String[] cp : comps) {
            Intent i = new Intent();
            i.setComponent(new ComponentName(cp[0], cp[1]));
            try {
                if (i.resolveActivity(pm) != null && start(i)) return true;
            } catch (Exception ignored) {
            }
        }
        return false;
    }

    @PluginMethod
    public void test(PluginCall call) {
        Context c = getContext();
        int sec = call.getInt("seconds", 10);
        String kind = call.getString("kind", "ring");
        try {
            JSONObject a = new JSONObject();
            int id = "ring".equals(kind) ? 2099999001 : 2099999002;
            a.put("id", id);
            a.put("group", "test");
            a.put("kind", kind);
            a.put("title", call.getString("title", "Test alarm"));
            a.put("body", "If you hear this with the phone locked, alarms work.");
            a.put("at", System.currentTimeMillis() + sec * 1000L);
            a.put("tone", call.getString("tone", "default"));
            a.put("snoozeMin", 1);
            a.put("reRingMin", 0);
            a.put("ringSec", 30);
            a.put("buttons", "done,snooze,dismiss");
            AlarmStore.put(c, a);
            AlarmStore.schedule(c, a);
            AlarmStore.log(c, "test " + kind + " in " + sec + "s");
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void stopRinging(PluginCall call) {
        AlarmService.stopIfRinging(getContext(), 0);
        call.resolve();
    }

    @PluginMethod
    public void notifyNow(PluginCall call) {
        Notifier.ensureChannels(getContext());
        Notifier.showSimple(getContext(), call.getInt("id", 2099990000), call.getString("title", "RemindMe"), call.getString("body", ""));
        call.resolve();
    }

    @PluginMethod
    public void getLog(PluginCall call) {
        JSObject r = new JSObject();
        r.put("log", AlarmStore.getLog(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void clearLog(PluginCall call) {
        AlarmStore.clearLog(getContext());
        call.resolve();
    }

    @PluginMethod
    public void setSecure(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        });
        call.resolve();
    }

    @PluginMethod
    public void getLaunchGroup(PluginCall call) {
        JSObject r = new JSObject();
        String g = "";
        try {
            Intent i = getActivity().getIntent();
            if (i != null && i.getStringExtra("rmGroup") != null) {
                g = i.getStringExtra("rmGroup");
                i.removeExtra("rmGroup");
            }
        } catch (Exception ignored) {
        }
        r.put("group", g);
        call.resolve(r);
    }
}
