RemindMe v3 (Android)

Build: GitHub -> Actions -> "Build APK" -> Run workflow. Every push to main also builds.
The APK is published to the "apk" branch (RemindMe.apk) and as the "RemindMe-APK" run artifact.
Keep debug.keystore unchanged so new versions install over the old one without losing data.

Layout:
  www/            web app (index.html, css/, js/)
  native/         Android alarm engine (Java) injected by native/patch.py after "npx cap add android"
  gen_sounds.py   generates alarm tones into android res/raw

First run on the phone: open Settings (gear) -> Alarm reliability, fix every red item,
then "Test alarm in 10 s" and lock the phone.
