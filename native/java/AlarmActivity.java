package com.remindme.app;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Full-screen alarm shown over the lock screen. */
public class AlarmActivity extends Activity {
    static WeakReference<AlarmActivity> current = new WeakReference<>(null);
    int alarmId;

    static void closeIfShowing(int id) {
        AlarmActivity a = current.get();
        if (a != null && (id == 0 || a.alarmId == id)) {
            a.runOnUiThread(a::finish);
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON);
        current = new WeakReference<>(this);
        build(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        build(intent);
    }

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private Button btn(String label, int bg, int fg) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(fg);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        GradientDrawable d = new GradientDrawable();
        d.setColor(bg);
        d.setCornerRadius(dp(18));
        b.setBackground(d);
        b.setPadding(dp(12), dp(14), dp(12), dp(14));
        return b;
    }

    private void build(Intent intent) {
        alarmId = intent.getIntExtra("id", 0);
        JSONObject a = AlarmStore.get(this, alarmId);
        if (a == null && alarmId == 0) alarmId = AlarmService.currentId;
        if (a == null) a = AlarmStore.get(this, alarmId);
        if (a == null) {
            finish();
            return;
        }
        final int snooze = Math.max(1, a.optInt("snoozeMin", 10));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(Color.parseColor("#0F1220"));
        root.setPadding(dp(24), dp(56), dp(24), dp(32));

        TextView time = new TextView(this);
        time.setText(new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date()));
        time.setTextColor(Color.WHITE);
        time.setTextSize(TypedValue.COMPLEX_UNIT_SP, 64);
        time.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL));
        time.setGravity(Gravity.CENTER);
        root.addView(time);

        TextView badge = new TextView(this);
        badge.setText("⏰  REMINDER");
        badge.setTextColor(Color.parseColor("#A5B4FC"));
        badge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        badge.setLetterSpacing(0.15f);
        badge.setGravity(Gravity.CENTER);
        badge.setPadding(0, dp(18), 0, dp(10));
        root.addView(badge);

        TextView title = new TextView(this);
        title.setText(a.optString("title", "Reminder"));
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        root.addView(title);

        String bodyTxt = a.optString("body", "");
        if (bodyTxt.length() > 0) {
            TextView body = new TextView(this);
            body.setText(bodyTxt);
            body.setTextColor(Color.parseColor("#C7CBE0"));
            body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
            body.setGravity(Gravity.CENTER);
            body.setPadding(0, dp(10), 0, 0);
            root.addView(body);
        }

        View spacer = new View(this);
        root.addView(spacer, new LinearLayout.LayoutParams(1, 0, 1f));

        Button done = btn("✓  Done", Color.parseColor("#22C55E"), Color.parseColor("#05210F"));
        done.setOnClickListener(v -> act(AlarmReceiver.ACTION_DONE, 0));
        root.addView(done, full(dp(8)));

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        int[] opts = new int[]{snooze, 30, 60};
        if (snooze == 30) opts = new int[]{10, 30, 60};
        if (snooze == 60) opts = new int[]{10, 30, 60};
        for (int i = 0; i < opts.length; i++) {
            final int m = opts[i];
            Button s = btn("Snooze " + Notifier.snoozeLabel(m), Color.parseColor("#312E81"), Color.WHITE);
            s.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            s.setOnClickListener(v -> act(AlarmReceiver.ACTION_SNOOZE, m));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            lp.setMargins(i == 0 ? 0 : dp(5), 0, i == opts.length - 1 ? 0 : dp(5), 0);
            row.addView(s, lp);
        }
        root.addView(row, full(dp(8)));

        Button dismiss = btn("Stop ringing (not done)", Color.TRANSPARENT, Color.parseColor("#9CA3AF"));
        dismiss.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        dismiss.setOnClickListener(v -> act(AlarmReceiver.ACTION_DISMISS, 0));
        root.addView(dismiss, full(dp(4)));

        Button open = btn("Open app", Color.TRANSPARENT, Color.parseColor("#9CA3AF"));
        open.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        open.setOnClickListener(v -> {
            Intent i = new Intent(this, MainActivity.class);
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (Build.VERSION.SDK_INT >= 26) {
                KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
                if (km != null) km.requestDismissKeyguard(this, null);
            }
            startActivity(i);
        });
        root.addView(open, full(0));

        setContentView(root);
    }

    private LinearLayout.LayoutParams full(int bottom) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, 0, 0, bottom);
        return lp;
    }

    private void act(String action, int min) {
        Actions.handle(this, action, alarmId, min);
        finish();
    }

    @Override
    public void onBackPressed() {
        // Back does not silence the alarm; use a button.
    }

    @Override
    protected void onDestroy() {
        if (current.get() == this) current = new WeakReference<>(null);
        super.onDestroy();
    }
}
