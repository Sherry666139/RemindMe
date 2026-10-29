RemindMe (Android) - APK banane ke steps  [dost ke liye]

Zaroorat: computer + free GitHub account. Kuch install nahi karna.

1. github.com par login karen, "New repository" banayen (Private theek hai).
2. Is zip ko EXTRACT karen. Phir extract hui SAARI cheezyn ek saath repository mein upload karen
   (Add file -> Upload files, files/folders drag karen) aur ek hi dafa "Commit" karen.
   Cheezyn: www (folder), .github (folder), package.json, capacitor.config.json,
            gen_sounds.py, build.sh, debug.keystore, README.txt
   NOTE: ".github" folder dot se shuru hota hai, Mac/Linux par hidden hota hai.
         Mac: Cmd+Shift+. dabayen. Linux: Ctrl+H. Yeh folder lazmi upload hona chahiye.
         Is ke andar workflows/build-apk.yml hoti hai.
3. Upload ke fauran baad kuch runs khud shuru ho kar fail ho sakte hain, unhein nazarandaz karen.
4. "Actions" tab -> left side "Build APK" -> "Run workflow" (green button) -> Run workflow.
5. 8-15 minute baad run ke aagay green tick aayega. Run par click karen, neeche
   "Artifacts" mein "RemindMe-APK" download karen.
6. Zip kholen: RemindMe.apk (app) aur build-info.txt (yeh batati hai ke voice aur location shamil huin ya nahi).
7. RemindMe.apk phone mein bhej den. Phone par install karte waqt "Install unknown apps" ki ijazat deni hogi.

Agar run red cross (fail) ho to us run ka error ka screenshot/text bhej den.

Pehli dafa app kholne par:
- Notifications ki ijazat "Allow".
- "Alarms & reminders" ki ijazat (agar app maange).
- Voice ke liye microphone, location reminder ke liye location "Allow all the time".

Naya version update karna ho to naye files isi repository mein upload karen aur dobara "Run workflow" chalayen.
debug.keystore wohi rakhen, is se purani app ke upar update install hoti hai aur data nahi jata.
