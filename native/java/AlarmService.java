package com.remindme.app;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;

import org.json.JSONObject;

/** Foreground service that plays the alarm sound (USAGE_ALARM) until Done / Snooze / Dismiss / timeout. */
public class AlarmService extends Service {
    static final String CMD_RING = "ring";
    static final String CMD_STOP = "stop";
    static volatile int currentId = 0;

    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private int prevVolume = -1;
    private Runnable timeout;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    static void stopIfRinging(Context c, int id) {
        if (currentId == 0) return;
        if (id != 0 && currentId != id) return;
        try {
            Intent s = new Intent(c, AlarmService.class);
            s.setAction(CMD_STOP);
            c.startService(s);
        } catch (Exception e) {
            AlarmStore.log(c, "stop error " + e);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String cmd = intent != null ? intent.getAction() : null;
        if (CMD_STOP.equals(cmd) || intent == null) {
            if (currentId == 0) {
                // Still must call startForeground if started via startForegroundService
                safeForeground(0, null);
            }
            stopRinging();
            stopSelf();
            return START_NOT_STICKY;
        }
        int id = intent.getIntExtra("id", 0);
        JSONObject a = AlarmStore.get(this, id);
        if (a == null) {
            safeForeground(0, null);
            stopRinging();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (currentId != 0 && currentId != id) {
            // Another alarm takes over; the old one re-rings later
            JSONObject prev = AlarmStore.get(this, currentId);
            stopSound();
            if (prev != null) {
                long next = scheduleReRing(this, prev);
                Notifier.showMissed(this, prev, next);
            }
        }
        currentId = id;
        safeForeground(id, Notifier.ring(this, a));
        startSound(a.optString("tone", "default"), a.optBoolean("forceVolume", true));
        if (a.optBoolean("vibrate", true)) startVibrate();
        acquireWake();
        tryLaunchActivity(id);
        if (timeout != null) handler.removeCallbacks(timeout);
        final int ringId = id;
        timeout = () -> onTimeout(ringId);
        int sec = Math.max(15, a.optInt("ringSec", 60));
        handler.postDelayed(timeout, sec * 1000L);
        AlarmStore.log(this, "RINGING id=" + id + " for " + sec + "s");
        return START_NOT_STICKY;
    }

    private void safeForeground(int id, Notification n) {
        try {
            if (n == null) n = Notifier.builder(this, Notifier.CH_MISSED).setContentTitle("RemindMe").build();
            int nid = id != 0 ? id : 424242;
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(nid, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(nid, n);
            }
        } catch (Exception e) {
            AlarmStore.log(this, "startForeground error " + e);
            try {
                Notifier.nm(this).notify(id != 0 ? id : 424242, n);
            } catch (Exception ignored) {
            }
        }
    }

    private void tryLaunchActivity(int id) {
        // Full-screen intent handles locked screens. If "display over other apps" is granted we can also open directly.
        try {
            boolean overlay = Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(this);
            if (!overlay) return;
            Intent i = new Intent(this, AlarmActivity.class);
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
            i.putExtra("id", id);
            startActivity(i);
        } catch (Exception e) {
            AlarmStore.log(this, "launch activity error " + e);
        }
    }

    private void onTimeout(int id) {
        if (currentId != id) return;
        JSONObject a = AlarmStore.get(this, id);
        AlarmStore.log(this, "TIMEOUT id=" + id + " (not answered)");
        stopRinging();
        if (a != null) {
            long next = scheduleReRing(this, a);
            Notifier.showMissed(this, a, next);
        }
        AlarmActivity.closeIfShowing(id);
        stopSelf();
    }

    /** Ring again later if the alarm was ignored. Returns next time or 0. */
    static long scheduleReRing(Context c, JSONObject a) {
        int every = a.optInt("reRingMin", 5);
        int max = a.optInt("maxRepeats", 0);
        int repeats = a.optInt("repeats", 0);
        if (every <= 0 || (max > 0 && repeats >= max)) {
            try {
                a.put("fired", true);
            } catch (Exception ignored) {
            }
            AlarmStore.put(c, a);
            return 0;
        }
        long at = System.currentTimeMillis() + every * 60_000L;
        try {
            a.put("at", at);
            a.put("snoozed", true);
            a.put("fired", false);
            a.put("repeats", repeats + 1);
        } catch (Exception ignored) {
        }
        AlarmStore.put(c, a);
        AlarmStore.schedule(c, a);
        AlarmStore.log(c, "RE-RING id=" + a.optInt("id") + " at " + AlarmStore.hm(at) + " (#" + (repeats + 1) + ")");
        return at;
    }

    private Uri toneUri(String tone) {
        if (tone != null && !"default".equals(tone)) {
            int res = getResources().getIdentifier(tone, "raw", getPackageName());
            if (res != 0) return Uri.parse("android.resource://" + getPackageName() + "/" + res);
        }
        Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        return u;
    }

    private void startSound(String tone, boolean forceVolume) {
        stopSound();
        AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (forceVolume && am != null) {
            try {
                int max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
                int cur = am.getStreamVolume(AudioManager.STREAM_ALARM);
                int want = Math.max(1, (int) Math.ceil(max * 0.7));
                if (cur < want) {
                    prevVolume = cur;
                    am.setStreamVolume(AudioManager.STREAM_ALARM, want, 0);
                }
            } catch (Exception e) {
                AlarmStore.log(this, "volume error " + e);
            }
        }
        Uri[] tries = new Uri[]{toneUri(tone), RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)};
        for (Uri u : tries) {
            if (u == null) continue;
            try {
                MediaPlayer p = new MediaPlayer();
                p.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
                p.setDataSource(this, u);
                p.setLooping(true);
                p.prepare();
                p.start();
                player = p;
                return;
            } catch (Exception e) {
                AlarmStore.log(this, "sound error " + u + ": " + e);
            }
        }
    }

    private void startVibrate() {
        try {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null) return;
            long[] pattern = new long[]{0, 900, 700};
            if (Build.VERSION.SDK_INT >= 26) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0),
                        new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
            } else {
                vibrator.vibrate(pattern, 0);
            }
        } catch (Exception e) {
            AlarmStore.log(this, "vibrate error " + e);
        }
    }

    private void acquireWake() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (wakeLock == null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RemindMe:alarm");
                wakeLock.setReferenceCounted(false);
            }
            wakeLock.acquire(10 * 60_000L);
        } catch (Exception e) {
            AlarmStore.log(this, "wakelock error " + e);
        }
    }

    private void stopSound() {
        if (player != null) {
            try {
                player.stop();
            } catch (Exception ignored) {
            }
            try {
                player.release();
            } catch (Exception ignored) {
            }
            player = null;
        }
        if (vibrator != null) {
            try {
                vibrator.cancel();
            } catch (Exception ignored) {
            }
        }
        if (prevVolume >= 0) {
            try {
                AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                am.setStreamVolume(AudioManager.STREAM_ALARM, prevVolume, 0);
            } catch (Exception ignored) {
            }
            prevVolume = -1;
        }
    }

    private void stopRinging() {
        if (timeout != null) handler.removeCallbacks(timeout);
        stopSound();
        int id = currentId;
        currentId = 0;
        try {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(Service.STOP_FOREGROUND_REMOVE);
            else stopForeground(true);
        } catch (Exception ignored) {
        }
        if (id != 0) Notifier.cancel(this, id);
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onDestroy() {
        stopRinging();
        super.onDestroy();
    }
}
