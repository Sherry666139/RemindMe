"""Injects the native alarm engine into the generated Capacitor Android project."""
import os, re, shutil, glob, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(os.path.dirname(ROOT), 'android', 'app', 'src', 'main')
JAVA = os.path.join(APP, 'java', 'com', 'remindme', 'app')
os.makedirs(JAVA, exist_ok=True)

for f in glob.glob(os.path.join(ROOT, 'java', '*.java')):
    shutil.copy(f, JAVA)
shutil.copy(os.path.join(ROOT, 'MainActivity.java'), os.path.join(JAVA, 'MainActivity.java'))

for d in glob.glob(os.path.join(ROOT, 'res', '*')):
    dst = os.path.join(APP, 'res', os.path.basename(d))
    os.makedirs(dst, exist_ok=True)
    for f in glob.glob(os.path.join(d, '*')):
        shutil.copy(f, dst)

snd = os.path.join(os.path.dirname(ROOT), 'sounds')
raw = os.path.join(APP, 'res', 'raw')
os.makedirs(raw, exist_ok=True)
for f in glob.glob(os.path.join(snd, '*.wav')):
    shutil.copy(f, raw)

p = os.path.join(APP, 'AndroidManifest.xml')
s = open(p).read()
perms = ['POST_NOTIFICATIONS', 'SCHEDULE_EXACT_ALARM', 'USE_EXACT_ALARM', 'USE_FULL_SCREEN_INTENT',
         'VIBRATE', 'RECEIVE_BOOT_COMPLETED', 'WAKE_LOCK', 'FOREGROUND_SERVICE',
         'FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
         'SYSTEM_ALERT_WINDOW', 'TURN_SCREEN_ON', 'DISABLE_KEYGUARD', 'ACCESS_NOTIFICATION_POLICY',
         'USE_BIOMETRIC', 'USE_FINGERPRINT', 'RECORD_AUDIO', 'INTERNET',
         'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_BACKGROUND_LOCATION',
         'FOREGROUND_SERVICE_LOCATION']
add = ''.join('    <uses-permission android:name="android.permission.%s" />\n' % x
              for x in perms if 'android.permission.%s"' % x not in s)
s = s.replace('<application', add + '\n    <application', 1)

comps = '''
        <activity
            android:name=".AlarmActivity"
            android:exported="false"
            android:showWhenLocked="true"
            android:turnScreenOn="true"
            android:launchMode="singleInstance"
            android:excludeFromRecents="true"
            android:taskAffinity="com.remindme.app.alarm"
            android:screenOrientation="portrait"
            android:theme="@style/AppTheme.NoActionBar" />
        <service
            android:name=".AlarmService"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />
        <receiver android:name=".AlarmReceiver" android:exported="false" />
        <receiver android:name=".GeofenceReceiver" android:exported="false" />
        <receiver android:name=".AlarmReceiver$Boot" android:exported="true" />
'''
# Boot receiver: separate exported receiver with system intent filters
comps = comps.replace('<receiver android:name=".AlarmReceiver$Boot" android:exported="true" />',
'''<receiver android:name=".BootReceiver" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.LOCKED_BOOT_COMPLETED" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
                <action android:name="android.intent.action.TIME_SET" />
                <action android:name="android.intent.action.TIMEZONE_CHANGED" />
                <action android:name="android.intent.action.QUICKBOOT_POWERON" />
                <action android:name="com.htc.intent.action.QUICKBOOT_POWERON" />
                <action android:name="android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" />
                <action android:name="android.location.PROVIDERS_CHANGED" />
            </intent-filter>
        </receiver>''')
if '.AlarmService' not in s:
    s = s.replace('</application>', comps + '    </application>', 1)
open(p, 'w').write(s)
print('patched manifest; java files:', sorted(os.listdir(JAVA)))

g = os.path.join(os.path.dirname(APP), '..', 'build.gradle')
g = os.path.normpath(g)
if os.path.exists(g):
    t = open(g).read()
    t = re.sub(r'versionCode \d+', 'versionCode 31', t)
    t = re.sub(r'versionName "[^"]*"', 'versionName "3.1"', t)
    if 'play-services-location' not in t:
        t = t.replace('dependencies {', "dependencies {\n    implementation 'com.google.android.gms:play-services-location:21.3.0'", 1)
    open(g, 'w').write(t)
    print('set version 3.1 + gms location in', g)
