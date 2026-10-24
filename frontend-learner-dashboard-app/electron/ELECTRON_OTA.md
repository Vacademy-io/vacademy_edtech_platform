# OTA updates for desktop store builds

## Why this exists

The desktop app normally updates through `electron-updater` (`src/index.ts`):
it downloads a whole new `.app`/`.exe` from the GitHub release feed and swaps it
in on quit. That is impossible in a **store** build:

- a **Mac App Store** package is sandboxed and installed read-only under
  `/Applications`, and Apple only lets a store app change through the store;
- a **Microsoft Store** (MSIX/AppX) package is likewise read-only under
  `WindowsApps`.

`index.ts` already refused to run `electron-updater` in those builds, which left
them with **no patch channel at all** — a bug fix could not reach a Mac App Store
user until the next review cycle.

`src/ota.ts` closes that gap using the same trick the iOS/Android apps use
(`@capgo/capacitor-updater`): the native shell is frozen, but the web bundle it
serves is just HTML/JS/CSS, so a newer bundle can be fetched into the app's own
writable container and served from there. **No native code is downloaded or
executed** — only web assets rendered in the WebView that already shipped.

## How it works

The channel is chosen with `process.mas`, the same kind of signal `index.ts`
already used for the Store. Everything below is inert in DMG, NSIS, portable and
dev builds, which keep the full `electron-updater` flow untouched.

**Microsoft Store builds are deliberately NOT included.** They have the identical
problem and the fix would be `|| process.windowsStore === true` in
`isWebBundleOtaShell()` — but that AppX ships today with no self-update at all,
and switching one on is a change to a live product that should be made on
purpose rather than inherited from the Mac work.

1. On launch, `getActiveWebDirectory()` decides what `electron-serve` serves:
   the staged OTA bundle if one is present and intact, otherwise the bundle
   packaged inside the app.
2. After the window is up, `checkAndStageOtaBundle()` calls
   `/admin-core-service/public/ota/v1/check` with `platform=MACOS`, then again
   every 6 hours.
3. A newer bundle is downloaded, **SHA-256 verified against the checksum the
   backend declares**, extracted into `<userData>/ota/bundles/<version>/`, and
   recorded in `<userData>/ota/state.json`.
4. It is applied on the **next launch** — never mid-session. Swapping the bundle
   live would reload the WebView and destroy a learner's in-progress exam
   attempt, which is the same reason mobile only auto-applies at launch.

Backend and bundle stream are shared with mobile: publish once with
`scripts/publish-ota.sh` and the bundle reaches iOS, Android and desktop. The
backend query already matches `platform = 'ALL' OR platform = :platform`, so
`MACOS` needs no server change and leaves room for Mac-only bundles later.

### Which bundles a Mac build accepts

Two independent gates, exactly as on mobile:

- `target_app_ids` must contain the app's id or be blank. The Mac build reports
  `otaAppId` from `electron-flavor.json` — the **store bundle id**
  (`io.zoeedtech.app` for ZOE), so one target covers the iOS app and the Mac app.
- the published version must be **greater than** the version currently running.

The running version is the staged OTA bundle, or — on a fresh install — the web
version baked into the package, which the build script writes to
`app/ota-bundle-version.txt` from the frontend `package.json`. That file matters:
without it the shell falls back to the Electron package version (`1.0.12`), a
different numbering space that would make every OTA bundle look older.

## The compliance trap this had to solve

A Mac App Store build must hide commerce under Guideline 3.1.1, and that gate
used to be a build-time constant (`__MAC_APP_STORE__`) compiled into the JS.
OTA exists precisely to replace that JS. A bundle pulled from the shared learner
stream is built **without** the flag, so the first OTA would have silently
switched commerce back on inside the store app — a remotely re-enabled commerce
surface after review is exactly what gets an app pulled under Guideline 2.3.1.

So the shell now reports it directly: `preload.ts` exposes
`window.vacademyShell.macAppStore` from `process.mas`, and
`src/utils/ios-iap-compliance.ts` treats **either** signal as reader mode on.
The shell cannot be swapped by OTA, so this survives every bundle update. The
build-time flag is kept as well — it covers the bundle inside the `.pkg`.

**Consequence:** the reader-mode check in `build-mas-zoe.sh` verifies the
*packaged* bundle only. Any OTA bundle is covered by the shell flag instead.

## Failure behaviour

OTA is best-effort and never throws into app startup. Every failure path falls
back to the bundle that shipped:

- backend unreachable / non-200 → logged, no change;
- **checksum mismatch, or no checksum at all → refused**, bundle discarded;
- extraction is done into a `.incoming` directory and atomically renamed, so a
  crash mid-write cannot leave a half-written bundle at the served path;
- a staged bundle missing `index.html` at launch → state cleared, packaged
  bundle served;
- zip entries that would escape the bundle directory (zip slip) are rejected.

The zip reader is a dependency-free STORE/DEFLATE implementation
(`zlib.inflateRawSync`) — a sandboxed app should not be shelling out to
`/usr/bin/unzip`. It was verified byte-for-byte against system `unzip` on the
live 23 MB production bundle (189 files).

## Operational note

Only bundles **newer than the packaged one** are delivered. At the time of
writing the frontend is at `2.4.9`, and the newest bundle ZOE actually matches is
the untargeted `2.2.2` — older, so a fresh ZOE Mac install correctly sees "no
update". Recent bundles (`2.4.6`–`2.4.9`) target
`io.vacademy.student.app,io.ssdc.student.app` only. **To ship an OTA to ZOE Mac,
publish a bundle above `2.4.9` whose `target_app_ids` includes
`io.zoeedtech.app`** (or leave it untargeted).

Verify what a device would receive:

```bash
curl -s "https://backend-stage.vacademy.io/admin-core-service/public/ota/v1/check\
?platform=MACOS&currentBundleVersion=2.4.9&nativeVersion=1.0&appId=io.zoeedtech.app"
```

Remember the public endpoint only returns **active** bundles — list the admin
endpoint (`/admin/ota/v1/versions`) and read `is_active` when diagnosing a
"no update" report.
