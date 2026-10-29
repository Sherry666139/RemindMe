#!/bin/bash
# Builds the APK. If an optional plugin (location / voice) breaks the build, retries without it.
try_build() { (cd android && chmod +x gradlew && ./gradlew assembleDebug --no-daemon); }

if try_build; then echo "Features: voice + location reminders included" > build-info.txt; exit 0; fi

echo "Retrying without location plugin..."
npm uninstall @capacitor-community/background-geolocation || true
npx cap sync android
if try_build; then echo "Features: voice included, location reminders NOT included" > build-info.txt; exit 0; fi

echo "Retrying without voice plugin..."
npm uninstall @capacitor-community/speech-recognition || true
npx cap sync android
if try_build; then echo "Features: voice and location NOT included" > build-info.txt; exit 0; fi

exit 1
