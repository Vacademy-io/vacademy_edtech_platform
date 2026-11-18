# In-app live classes: handoff, device testing and next steps

**Status (18 Nov 2026):**
- Live classes (BigBlueButton, `meet.vacademy.io`) now open **inside the learner app**, not in a new tab, Chrome or Safari.
- The in-app class has its own **picture-in-picture (PiP)**. Learners get **no "open in browser" option**; that is an owner decision.
- **Web** is live for one pilot institute.
- **Android, iOS, Mac and Windows** code is on `main` but **not built, not released, not device-tested**. That is your job; see sections 4 and 5.

Read sections 1–3 first so the tests make sense.

---

## 1. How it works

```
Learner taps "Join"
  └─ learner app calls GET /admin-core-service/live-sessions/provider/meeting/join
        ?scheduleId=…&role=VIEWER&client=web|android|ios|electron
  └─ admin_core answers { joinUrl, openMode: "IN_APP" | "EXTERNAL", … }
        IN_APP only if ALL are true:
          • client is sent and listed in bbb.inapp.clients
          • institute is listed in bbb.inapp.institute-ids
          • BBB confirms the meeting was created in-app capable (meta vacademy-inapp=1)
  └─ learner app checks THIS installed app can host it (canHostClassInApp):
          • web: always
          • Android / iOS: only if the native plugin "VacademyLiveClass" exists
          • Electron: only if window.vacademyShell.liveClass.version >= 1
  ├─ both yes → route /study-library/live-class/classroom
  │             (full-screen <iframe> of the BBB class + thin bar with "Leave")
  └─ otherwise → opened outside the app, exactly like before
```

**Why old apps are safe.** New JS reaches installed apps over the air (Capgo), but native code only arrives with a store or installer update. An app without the native piece fails the second check and keeps opening classes outside. The native piece is the gate, never the JS version.

**Why a class works inside a frame.**
- **Login cookie:** normally BBB needs its login cookie, which browsers drop inside a frame on another site. In-app meetings are created with `allowRequestsWithoutSession=true`, so the per-user session token is enough.
- **Framing rules:** `/etc/nginx/conf.d/vacademy-frame-ancestors.conf` on the BBB server decides which sites may frame which page (`frame-ancestors`), and `/etc/bigbluebutton/nginx/iframe-allow.nginx` sends the header. Class pages: any https site plus the apps. Recordings and the learning dashboard: our own sites only.

**Leaving / class end.**
- When a learner leaves or the class ends, BBB sends the frame to its logoutURL, the learner feedback page.
- For in-app meetings that URL carries `vxBbbExit=1`. A small script at the top of the learner app's `index.html` sees the marker inside the frame, tells the app to close the class view, and stops loading.
- The app then shows the feedback page.

**PiP.**
- **Old plugin:** BBB's stock PiP plugin uses *Document* Picture-in-Picture, which only works in a top-level tab, so it is dead in a frame.
- **Our plugin, `vacademy-pip`, used for in-app institutes only:**
  - Draws the screen share and up to 4 webcams onto a canvas.
  - Turns the canvas into a video and opens normal *video* PiP, which is allowed in a frame (web, Electron, iOS).
  - **Android:** the WebView has no video PiP, so the button asks the app and the app shrinks into Android's own system PiP.
  - The plugin first asks the app whether it can do PiP (`vacademy:bbb-pip-hello`, reply `vacademy:bbb-pip-native`), so a browser or app that can't do PiP never shows a dead button.

---

## 2. Where the code is

| Area | Files |
|---|---|
| Backend: decision + meeting creation | `admin_core_service/.../live_session/provider/manager/BbbMeetingManager.java`: `isInAppEnabled`, `resolveOpenMode`, `isMeetingInAppCapable`; create params `allowRequestsWithoutSession`, `meta_vacademy-inapp`, `vxBbbExit` on logoutURL; picks `vacademy-pip` instead of the stock PiP plugin<br>`.../controller/LiveSessionProviderController.java`: `/meeting/join` takes `client`, returns `openMode` |
| BBB server config | `bigbluebutton-server/configure-bbb.sh` step 7: `frame-ancestors` rules per path and the `getJoinUrl` block (the same is applied live on the server) |
| PiP plugin | source `bigbluebutton-server/plugins-src/vacademy-pip/` (`src/pip.ts`, `src/index.tsx`); built output `bigbluebutton-server/plugins/vacademy-pip/` |
| Learner app: join | `frontend-learner-dashboard-app/src/lib/live-class/bbb-join.ts` (`openBbbJoinForLearner` returns `IN_APP` / `EXTERNAL` / `FAILED`) |
| Learner app: class view | `src/routes/study-library/live-class/classroom/index.tsx` |
| Learner app: helpers | `src/lib/live-class/bbb-classroom.ts` (gate, messages, iframe `allow` list)<br>`src/lib/live-class/native-live-class.ts` (contract with native code + shell gate) |
| Learner app: exit script | `index.html`, the first `<script>` |
| Android | `android/app/src/main/java/com/template/app/liveclass/`:<br>• `LiveClassPlugin` (`VacademyLiveClass`)<br>• `LiveClassService` (foreground service + notification)<br>• `LiveClassAudioRouter` (loudspeaker)<br>• `LiveClassChromeClient` (fullscreen)<br>Also `MainActivity.java` (registration, PiP hooks), `AndroidManifest.xml` (PiP flags, service, permissions), `res/drawable/ic_stat_live_class.xml` |
| iOS | `ios/App/App/VacademyLiveClassPlugin.swift`, `ios/App/App/MainViewController.swift` (registration, PiP allowed), `App.xcodeproj/project.pbxproj` (file in all 20 targets), `UIBackgroundModes: audio` in every brand plist under `ios/App/GoogleServiceConfigs/<Brand>/GoogleService-Info.plist` and `ios/App/App/Info.plist` |
| Electron (Win/Mac) | `electron/src/live-class.ts` (keep awake, no background throttling, screen-share picker), `electron/src/preload.ts` (`vacademyShell.liveClass`), `electron/src/index.ts`, `electron/entitlements.*.plist`, `extendInfo` camera/mic texts in every `electron/electron-builder*.json` |

Commits on `main`: `352b9f6e7a`, `078fae2c6e`, `4e74b05169`, `9c8c3e01db`, `ad46721f53`, `fb87e90350`, `1893896aca`.

---

## 3. Switches (production)

All on `admin-core-service` in the CloudPe cluster (`kubectl -n default`). They are set as cluster env vars, not in the deploy workflow; the CI `kubectl set env` keeps vars it doesn't list, so they survive deploys.

| Env var | Current value | Meaning |
|---|---|---|
| `BBB_INAPP_INSTITUTEIDS` | `6b600940-2134-40ec-93ed-b61e403c5a87` (institute "Vacademy", learner site https://learn.vacademy.io) | Institutes whose classes run in-app. Comma list, or `*` for all. Empty = feature off. |
| `BBB_INAPP_CLIENTS` | `web,android,ios,electron` | App types allowed in-app. Each app still checks its own native support. |

- **Adding an institute:** `kubectl -n default set env deployment/admin-core-service BBB_INAPP_INSTITUTEIDS=<id1>,<id2>`. This restarts admin_core one pod at a time, with no downtime.
- **Only new classes are affected:** classes created **after** the change are in-app; classes already running stay as they were.
- **Turning it off:** remove the institute from the list. New classes then open outside the app again. Nothing else needs to change.
- **White-label learner domains:** nothing to do. Since 18 Nov 2026, class pages may be framed by any https site, so every institute's own learner domain (current and future) works without server changes. A framing site still needs the learner's own signed join link. Recordings (`/playback`, `/presentation`) and the learning dashboard stay limited to `*.vacademy.io` and the apps.

---

## 4. Releasing each app

Nothing builds or publishes automatically; every app workflow is manual. Until a platform is released and installed, its learners keep opening classes outside the app, which is safe.

### Android
- **Build environment:** Capacitor 7 needs **JDK 21**. The code was only checked with `javac` against the Android 36 SDK, never run through a full Gradle build.
- **Version codes:** bump them for the flavors you release.
- **Play Console:**
  - Declare the **foreground service types `microphone` and `mediaPlayback`**, required when targeting API 34+. Google asks for a short video showing the "Live class in progress" notification while a class runs with the app in the background.
  - The listing will show the new **"Nearby devices"** permission (`BLUETOOTH_CONNECT`, used for Bluetooth headsets).
- **One flavor manifest:** `src/shikshanation/AndroidManifest.xml` merges with the main one; check the merged manifest of one release build.

### iOS
- **Build:** use the white-label workflow (`.github/workflows/ios-white-label-build.yml`). Pods were not installed on the machine this was written on, so do a clean `pod install` + build first.
- 🚨 **`ios/App/App/Info.plist` is malformed (this predates this work).** Its keys and values are padded with line breaks, so they read as `"\n  UIBackgroundModes\n"` and so on. Background audio, the bundle ID and the permission texts may not be read for the **Vacademy** target. Reformat it before shipping that app. The 18 brand plists are fine.
- **App Review notes:** say the app plays and records audio in the background **for live classes**, and give a test login plus a class the reviewer can join.
- **Check after build:** in the running app, `Capacitor.isPluginAvailable("VacademyLiveClass")` must be `true`.

### Mac App Store (Electron, `electron-store-build.yml`)
- The **camera** entitlement is added. It was **rejected once before** (Guideline 2.4.5(i), "camera not used"). The review notes **must** include a test login and a class with a camera button.
- **Also added:** `com.apple.security.network.server`, which WebRTC needs to receive media under the sandbox. Check whether audio and video connect without it; if they do, it can be removed.

### Windows / Mac installers (Electron)
- Learners get it only with a **new installer**, because DMG and Windows builds have no over-the-air web updates.
- If the DMG is signed with hardened runtime, `electron/entitlements.mac.plist` provides camera and mic.

### Web
Already live: Cloudflare Pages deploys on every push to `main`.

---

## 5. Device test plan

**Setup.**
- Use the pilot institute ("Vacademy"). Ask the owner for the pilot test login.
- Start a class as the teacher from the admin dashboard, and join as a learner from each app.
- Test with the teacher sharing the **camera** and, separately, a **screen share**, so PiP has something to show.

**Expected everywhere.**
- The class opens **inside the app** with a thin top bar containing the class name and **Leave**.
- There is **no "open in browser"** anywhere.
- Leave asks "Leave the class?".
- When the teacher ends the class, the app shows the **feedback page** by itself.

### 5.1 Web (Chrome, Edge, Safari, Firefox; desktop and phone browsers)
| # | Test | Expected |
|---|---|---|
| W1 | Join from Live classes, the dashboard and the waiting room | Class opens in-app, never a new tab |
| W2 | Mic, camera, raise hand, chat, polls, shared notes, whiteboard | All work as in a normal tab |
| W3 | PiP button (bottom bar, right side) in Chrome / Edge / Safari | Floating window with screen share + webcams, keeps moving when you switch tabs |
| W4 | Firefox | No PiP button (Firefox has no PiP API). Everything else works |
| W5 | Presentation / webcam fullscreen | Works |
| W6 | Browser Back, sidebar link, closing the tab mid-class | Asks before leaving |
| W7 | Reload during class | Rejoins the class in-app |
| W8 | Phone browser: screen stays on during class | Screen doesn't sleep |
| W9 | Institute **not** in the pilot list | Class opens in a new tab exactly as before |

### 5.2 Android (test on Android 10, 12, 14+, and one low-end 2–3 GB phone)
| # | Test | Expected |
|---|---|---|
| A1 | First join after install | One system prompt for mic + camera (and "Nearby devices" if a Bluetooth headset is connected); class opens in-app |
| A2 | Old app (current Play Store build) with the new JS | Class still opens in Chrome as before. **This is the backward-compatibility check** |
| A3 | Screen stays on for 5+ minutes without touching | Doesn't sleep |
| A4 | Press Home during class | App shrinks to Android PiP (auto on Android 12+, on Home for 8–11); audio continues |
| A5 | PiP button inside the class | App shrinks into PiP |
| A6 | Tap the PiP window to go back | Class still running, not reloaded |
| A7 | Close the PiP window (X) | **Agreed behaviour: the learner stays in the class in the background** (mic still on, notification shown) |
| A8 | Lock the screen for 2+ minutes, then unlock | Teacher still hears the learner, learner still hears the teacher; "Live class in progress" notification shown |
| A9 | Speaker vs earpiece | Sound from the **loudspeaker** without a headset |
| A10 | Wired headset; Bluetooth headset; plug/unplug mid-class | Sound and mic switch to the headset and back |
| A11 | Presentation / webcam fullscreen; Back while fullscreen | Fullscreen works; Back closes fullscreen first |
| A12 | Hardware Back during class | Asks "Leave the class?" |
| A13 | Screenshot / screen recording during class | Blocked (black). The **PiP window must still show the class**, not black; check this |
| A14 | Phone call during class | Class audio returns after the call |
| A15 | Leave class | Notification gone, screen sleeps normally again, sound routing back to normal (play a course video) |
| A16 | Upload a file / grant a permission mid-class (Android 8–11) | App does **not** jump into PiP |
| A17 | 60-minute class on a low-end phone | No crash, no overheating complaints, memory OK |

### 5.3 iPhone / iPad (iOS 15, 16, 17, 18)
| # | Test | Expected |
|---|---|---|
| I1 | First join | Mic and camera prompts; class opens in-app |
| I2 | Old App Store build with the new JS | Class opens in Safari view as before (backward-compat check) |
| I3 | Screen stays on | Doesn't sleep |
| I4 | Sound from loudspeaker, not earpiece (with mic on) | Loudspeaker |
| I5 | Home / lock screen for 2+ minutes | Learner still hears the class. **Check whether the mic keeps sending**: WebKit may stop capture in the background; record the result per iOS version. Camera always stops in the background on iPhone (expected) |
| I6 | PiP button inside the class | Floating video window. **Not confirmed that iOS allows PiP of this live video inside a frame:** record per iOS version and iPad vs iPhone |
| I7 | Bluetooth headset (AirPods), switching mid-class | Works |
| I8 | Phone call / alarm during class | Class audio comes back afterwards |
| I9 | Leave class | Normal audio afterwards (play a course video; mute switch respected) |
| I10 | Screenshot during class | Blocked/blurred as elsewhere in the app; PiP window still usable |

### 5.4 Mac (App Store build and DMG) and Windows (installer)
| # | Test | Expected |
|---|---|---|
| D1 | Join | Class opens inside the app window; mic + camera prompts on Mac show the new texts |
| D2 | Old installed app | Opens in the system browser as before (backward-compat check) |
| D3 | Minimise / put another window on top for 5 min | Audio both ways keeps going |
| D4 | Display doesn't sleep during class; sleeps normally after leaving | As described |
| D5 | PiP button | Floating window; survives minimising the main window |
| D6 | Become presenter → share screen (needs teacher to make the learner presenter) | Picker lists screens/windows; sharing works; Cancel/Esc gives a clean "not shared"; Mac asks for Screen Recording permission the first time (restart the app after granting) |
| D7 | Windows with two monitors | Both screens selectable |
| D8 | Mac App Store build | Helpers launch (app doesn't crash on start), camera + mic work under the sandbox; repeat once without `network.server` to see if it's needed |
| D9 | Screenshot of the app window | Blocked (black) as today |

**Report per test:** device and OS version, pass/fail, and a screen recording for failures. For failures also send the browser/WebView console (Android: `chrome://inspect`; iOS: Safari → Develop; Electron: DevTools).

---

## 6. Remaining work (not started)

1. **Breakout rooms.** BBB does **not** copy `allowRequestsWithoutSession` to breakout rooms, but does copy the `meta_vacademy-inapp` tag. A learner sent to a breakout from inside the app will hit "not authorised" because the cookie is missing.
   - **Option A:** set `allowRequestsWithoutSession=true` server-wide in `/etc/bigbluebutton/bbb-web.properties`, after a security review. It needs a bbb-web restart outside class hours.
   - **Option B:** block breakouts for in-app institutes.

   Never trust the meta tag for breakouts. (On 16 Nov no class used breakouts.)
2. **Join links stay valid for the whole class.** Signed join URLs have no `createTime`. A shared link works until the class ends, and with `allowRequestsWithoutSession` a leaked `/html5client/?sessionToken=` link works on any device. Add `createTime` (from the create response) to join URLs, and consider a stricter `maxUserConcurrentAccesses`. Do this **before** switching on more institutes.
3. **iOS `Info.plist` reformat** for the Vacademy target (section 4).
4. **Electron screen share** uses our own picker, because Electron 26 has no system picker. Upgrading Electron (33+) would allow the macOS system picker.
5. **Desktop learners lose BBB's stock Document PiP** (the bigger, interactive PiP window) in in-app institutes; they get our video PiP instead. Accepted for now.
6. **Wider rollout.** After device tests pass:
   - add institutes to `BBB_INAPP_INSTITUTEIDS` a few at a time, then set it to `*` (all institutes, including new ones, with no per-institute step);
   - watch the first classes.
   - No domain step is needed (see section 3).

---

## 7. Troubleshooting

- **Class opens outside the app when it should be in-app:**
  - **Backend response:** call `/meeting/join` with `client=…` and look at `openMode`. It is `EXTERNAL` if the institute isn't listed, the client isn't allowed, or the meeting was created before the institute was switched on (end the class and start a new one).
  - **App side:** `canHostClassInApp()` is false if the native piece is missing (old app), the page isn't a secure context, or the learner portal is itself inside a frame.
- **Is a meeting in-app capable?** On the BBB server, `getMeetingInfo` for the meeting shows `<vacademy-inapp>1</vacademy-inapp>` in its metadata.
- **"Refused to connect" inside the class view:** check the `Content-Security-Policy` header on `/html5client/`. It should be `frame-ancestors 'self' https: capacitor://localhost …`. A BBB package update may have overwritten `iframe-allow.nginx`; re-run step 7 of `configure-bbb.sh`. An `http://` (non-https) learner site can't frame the class.
- **PiP button missing:**
  - The class may be using the stock plugin: the meeting was created before the institute was switched on, or the institute isn't in-app.
  - Or the browser has no PiP API (Firefox).
  - Or, on Android, the app has no native plugin.
- **PiP plugin deploy:**
  1. `cd bigbluebutton-server/plugins-src/vacademy-pip && npm ci --ignore-scripts && npm run build`.
  2. Copy `bigbluebutton-server/plugins/vacademy-pip/` to `/var/www/bigbluebutton-default/assets/plugins/vacademy-pip/` on each BBB server.
  3. Bump `version` in `package.json` on every change so browsers fetch the new file.
