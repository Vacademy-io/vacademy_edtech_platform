# Vacademy Admin — Capacitor (Android + iOS)

The admin dashboard ships as more than one native app from the **same web
bundle**, selected by a build-time **flavor**:

| Flavor          | appId                  | Display name     | Shell        | OTA          | Anchor institute |
| --------------- | ---------------------- | ---------------- | ------------ | ------------ | ---------------- |
| `vacademy-admin`| `io.vacademy.admin.app`| **Vacademy Admin** | full portal | self-hosted  | `ca3c4734-7913-48a8-b116-f8f7e0c60eba` |
| `vimotion`      | `io.vimotion.app`      | Vimotion         | `/vim` only  | Capgo cloud  | — (host-based)   |
| `evalezy`       | `io.evalezy.app`       | Evalezy          | `/evalezy` only | self-hosted | — (Evalezy brand; see [EVALEZY_APP.md](./EVALEZY_APP.md)) |

The flavor is chosen with the `VITE_CAP_FLAVOR` env var. It is read in two
places (single source of truth: [`flavor.config.ts`](./flavor.config.ts)):

- **`capacitor.config.ts`** (at `cap add` / `cap sync` time) — stamps the native
  `appId`, `appName`, and OTA plugin config.
- **`src/native/flavor.ts`** (baked into the JS bundle) — drives runtime
  behaviour (force `/vim` or not, anchor institute, OTA mode).

Because each native binary is built **and** synced with the same
`VITE_CAP_FLAVOR`, the baked runtime value always matches the installed `appId`.
When `VITE_CAP_FLAVOR` is unset it defaults to `vimotion`, so any pre-existing
`cap sync` pipeline keeps producing exactly the Vimotion app it did before.

> The npm scripts set `VITE_CAP_FLAVOR` for you — prefer `pnpm run cap:*:vacademy-admin`.

---

## Base institute, domain routing & initial theme

A native WebView has no meaningful hostname, so the Vacademy Admin flavor does
**not** resolve branding from the host. Instead:

1. On boot, `src/index.tsx` seeds `localStorage.selectedInstituteId =
   ca3c4734-…` so `getCurrentInstituteId()` and the pre-paint branding script in
   `index.html` use this institute immediately.
2. Branding/theme are fetched with `resolveInstituteById(instituteId)` →
   `GET /admin-core-service/public/domain-routing/v1/resolve-by-institute?instituteId=…`
   (added in `admin_core_service`). This returns the same shape as the host
   resolver (theme code, logo, tab text, font, auth toggles, …).
3. If that endpoint is unavailable (e.g. not yet deployed), the app still works:
   the institute id is set, and branding falls back to defaults.

To change the anchor institute, edit `ADMIN_FLAVORS['vacademy-admin'].instituteId`
in [`flavor.config.ts`](./flavor.config.ts).

> **Backend dependency:** the `resolve-by-institute` endpoint must be deployed to
> the environment the app points at (`BACKEND_BASE_URL`). It requires that the
> institute has at least one row in `institute_domain_routing`.

---

## One-time native project generation

`android/` and `ios/` are **not** committed yet. Generate them on a machine with
the right toolchain (these were not present in this checkout).

**Android** (needs Android Studio / Android SDK + **JDK 21** — Capacitor 8's
Android modules compile with `sourceCompatibility 21`; JDK 17 fails with
`invalid source release: 21`. The backend services still use JDK 17 — keep them
separate, e.g. point `JAVA_HOME` at `openjdk@21` only for the Android build):

```bash
pnpm install
pnpm run build:vacademy-admin
pnpm run cap:add:vacademy-admin:android   # stamps io.vacademy.admin.app / "Vacademy Admin"
pnpm run cap:open:vacademy-admin:android  # opens Android Studio
```

**iOS** (needs macOS + **full Xcode** from the App Store — `xcode-select -p` must point at `Xcode.app`, not CommandLineTools). This Capacitor 8 project is **Swift Package Manager** based (`ios/App/CapApp-SPM/Package.swift`), so **CocoaPods is NOT required** — Xcode resolves the packages on open. The `ios/` project is already generated and synced (bundle id `io.vacademy.admin.app`, display name "Vacademy Admin", self-hosted OTA, splash auto-hide). After installing Xcode:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
pnpm run build:vacademy-admin               # refresh dist with current JS (optional if unchanged)
pnpm run cap:sync:vacademy-admin:fast       # or full cap:sync:vacademy-admin
pnpm run cap:open:vacademy-admin:ios        # opens Xcode → let SPM resolve → Run
```

Set the signing Team in Xcode (target → Signing & Capabilities) before running on a device.

### Firebase config (push notifications)

Both native apps register under the existing **`vacademy-app`** Firebase project
(#`117550803134`) as bundle **`io.vacademy.admin.app`**. The config files live
*inside* the native folders, split by platform — same layout as the learner app.
See [`ios/App/GoogleServiceConfigs/README.md`](./ios/App/GoogleServiceConfigs/README.md):

```
ios/App/GoogleServiceConfigs/vacademy-admin/GoogleService-Info.plist   → iOS (App target bundles it directly)
android/app/GoogleServiceConfigs/vacademy-admin/google-services.json   → Android (Gradle copies → android/app/google-services.json)
```

The wiring is already in place:
- **Android** — `android/app/build.gradle` copies the registry json to
  `android/app/google-services.json` (git-ignored, generated) and applies
  `com.google.gms.google-services`; `firebase-bom` + `firebase-messaging` deps
  are added.
- **iOS** — the App target's *Copy Bundle Resources* phase references
  `GoogleServiceConfigs/vacademy-admin/GoogleService-Info.plist` directly (no
  Podfile — this project is **Swift Package Manager**, so the plist is bundled
  directly, not via pods).

> ⚠️ **iOS REQUIRES a `GoogleService-Info.plist` or it crashes on launch.** The
> bundled `@capacitor-firebase/messaging` plugin calls `FirebaseApp.configure()`
> at startup; with no config the app dies immediately with
> `*** Terminating app due to uncaught exception 'com.firebase.core'`.
>
> The committed configs are **format-valid placeholders** — the app builds and
> launches, but push won't work until you replace them with the real files
> downloaded from the Firebase console (see the registry README for the exact
> steps). On the simulator the `no valid "aps-environment" entitlement` log is
> expected regardless.

After `cap add`, set the bundle id / display name if you ever edit them:
- Android: `android/app/build.gradle` → `applicationId` + `android/app/src/main/res/values/strings.xml` → `app_name`.
- iOS: Xcode target → **General → Identity** (`io.vacademy.admin.app`, "Vacademy Admin").

### App icon & splash

Drop a 1024×1024 `icon.png` (and optional `splash.png`) into an `assets/` folder
at the app root, then:

```bash
npx @capacitor/assets generate --iconBackgroundColor '#FAFAF7' --splashBackgroundColor '#FAFAF7'
```

`@capacitor/assets` is already a dependency in the learner app; install it here
with `pnpm add -D @capacitor/assets` if missing.

---

## Day-to-day dev

```bash
# Rebuild web + copy into the native projects
pnpm run cap:sync:vacademy-admin

# Build + sync + launch on a device/emulator
pnpm run cap:run:vacademy-admin:android
pnpm run cap:run:vacademy-admin:ios

# Live reload against the Vite dev server (optional)
CAP_DEV_SERVER=http://<your-lan-ip>:5173 pnpm run cap:sync:vacademy-admin:fast
```

---

## OTA updates (self-hosted, learner-app style)

OTA uses `@capgo/capacitor-updater` with `autoUpdate: false`; we drive the
lifecycle ourselves against our own backend (`admin_core_service` OTA feature —
the same backend the learner app uses):

- `src/services/ota-update.ts` — check / download / set / notifyAppReady.
- `src/native/otaSelfHosted.ts` — runs at boot: marks the bundle healthy, checks
  for a newer bundle, force-applies or surfaces a banner.
- `src/components/ota-update/OtaUpdateBanner.tsx` — optional banner / force overlay.

### Publish a bundle

```bash
BACKEND_URL=https://backend-stage.vacademy.io \
ADMIN_JWT_TOKEN=<admin jwt> \
RELEASE_NOTES="Bug fixes" \
pnpm run ota:publish:vacademy-admin
```

The script builds the **`vacademy-admin`** flavor, zips `dist/`, uploads via the
media service, and registers the version with
`target_app_ids=io.vacademy.admin.app`.

> ⚠️ **Isolation (defense-in-depth):** always keep
> `TARGET_APP_IDS=io.vacademy.admin.app` (the script's default). Additionally the
> backend treats `io.vacademy.admin.app` as a **strict** app (see
> `ota.strict-target-app-ids`): untargeted "all-apps" bundles (the learner
> default) are never served to it, and the admin client refuses any bundle not
> explicitly targeted to its app id. So an untargeted learner bundle can never
> land in the admin WebView.
>
> ⚠️ **Versioning (two rules):**
> 1. The OTA bundle version must be **strictly greater than the native shell
>    versionName** (the floor on a fresh install). Native baseline is **1.0.0**,
>    so OTA bundles use **1.0.x** (bump `package.json.version`, currently `1.0.1`,
>    or pass `OTA_VERSION`). On a store release that bumps the native versionName,
>    resume OTA versions above the new floor.
> 2. The OTA `version` is **globally unique** across all apps sharing the backend.
>    Admin uses `1.0.x`, learner uses `2.x` — keep them distinct.
>
> OTA replaces only the JS/CSS/HTML bundle. Native changes (new plugins,
> permissions, native version bumps) require a new store build.

---

## Safe area

Handled at the framework level, so most screens need nothing extra:

- `index.html` has `viewport-fit=cover`.
- `capacitor.config.ts`: `StatusBar.overlaysWebView: false` (status bar
  non-overlapping) and iOS `contentInset: 'always'` (WebView auto-insets).
- `src/native/safeArea.ts` mirrors `env(safe-area-inset-*)` into
  `--safe-area-inset-{top,right,bottom,left}` CSS vars at boot.
- `src/index.css` exposes utilities (`pt-safe`, `pb-safe`, `px-safe`, `p-safe`,
  `min-h-screen-safe`, `pb-keyboard`, …) and pads the native `body`
  bottom/sides as a safety net (top is left to the native layer).

For a full-bleed native surface (sticky bottom bar, edge-to-edge header), compose
the `*-safe` utilities rather than hard-coding pixel insets.
