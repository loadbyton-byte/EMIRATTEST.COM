# Android app

The Android app is a **Capacitor** shell around the same React build, so features and records are identical across channels (plan §11: "Account data is consistent across channels"). Native-feel additions: bottom navigation, camera capture for documents (`<input capture>` → Android camera), geolocation on custody events, offline queue for the field-agent tool, branded adaptive icon and splash.

## Get the APK (no Android Studio needed)
1. Push to the branch (or run **Actions → Emirattest Android APK → Run workflow**, optionally entering your server URL).
2. Download the **Emirattest-android-apk** artifact → `Emirattest-debug.apk` → install on a phone (allow unknown sources).
3. First launch → Sign in → expand **Server** and enter the URL of your hosted demo (or set repository variable `EMIRATTEST_API_URL` before the build to bake it in).

The build runs on GitHub's Ubuntu runner (Android SDK preinstalled): `npm run build` → `cap add android` → manifest permissions → `@capacitor/assets` (icons/splash from `mobile/resources`) → `./gradlew assembleDebug`.

## Local build
```bash
npm run build                      # in repo root
cd mobile && npm install && npx cap add android
npx @capacitor/assets generate --android && npx cap sync android
cd android && ./gradlew assembleDebug      # needs JDK 17 + Android SDK
```

## Release path (funded)
Signed release bundle (`bundleRelease` + Play App Signing), Play Console listing, FCM push notifications, biometric unlock, ML-assisted document edge detection, iOS build. The API already accepts Bearer tokens and CORS for `https://localhost` / `capacitor://localhost`.

> This APK is built by CI, not inside the authoring sandbox (which cannot reach Google's Android SDK servers). Check the workflow run for the build log.
