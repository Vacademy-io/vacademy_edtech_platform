# Releasing a white-label iOS app

How a branded learner app (Agilore Global, Smart AI Academy, Sreedhar's TTS, Oui Académie, …) goes from
"the client sent a logo" to "Waiting for Review" — and how to get it past App Review. Everything here was
learned on real submissions; the rejections section is the part to read before writing anything Apple will see.

The mechanical steps are automated by `frontend-learner-dashboard-app/scripts/ios-brand/register-ios-app.sh`
(see its README). This document is the *why* and the checklist around it.

---

## 1. How a brand app is built

One Capacitor web bundle, one Xcode target per brand.

| piece | where | what it does |
|---|---|---|
| app id → institute | `frontend-learner-dashboard-app/flavor.config.ts` | maps the bundle id to the institute's `domain`/`subdomain`; **compiled into the JS**, so a new id needs a web rebuild (`vite build` + `npx cap copy ios`) or the app boots as generic "Vacademy" |
| Xcode target | `ios/App/App.xcodeproj` (target + shared scheme) | cloned from the newest brand; must compile the same **5** Swift files — a target missing `MainViewController.swift` launches to a black screen (rejected twice) |
| Info.plist + Firebase | `ios/App/GoogleServiceConfigs/<Brand>/GoogleService-Info.plist` | **one file is both** the `INFOPLIST_FILE` and the bundled Firebase config. Never paste the raw Firebase download over it — use `merge-firebase-config.sh <Brand>`. A "Verify Firebase config" build phase refuses to build with a placeholder `GOOGLE_APP_ID` (a placeholder crashes on launch) |
| icon / splash / launch screen | `App/Assets.xcassets/<Key>Icon.appiconset`, `<Key>Splash.imageset`, `App/Base.lproj/LaunchScreen<Key>.storyboard` | icon 1024×1024 RGB (no alpha), splash 2732×2732 logo-on-white; storyboard is a copy of Agilore's with the image name swapped |
| entitlements | `App/<Key>.entitlements` | push (`aps-environment` may say `development`; the App Store profile overrides it), Sign in with Apple, `applinks:` for the brand's own host only |
| Apple sign-in server side | `auth_service/src/main/resources/application-{dev,stage,prod,k8s-local}.properties` → `apple.native.audiences` | fail-closed allowlist of bundle ids. **Must be deployed before review** or the "Continue with Apple" button errors and Apple rejects (HCCA) |
| Firebase | project **vacademy-app-2** (sender 779885739059) | new brands go here; API key / project id are shared, only `GOOGLE_APP_ID` + `BUNDLE_ID` are per app |
| Apple team | 35NLZB49QN (developer@vidyayatan.com) | bundle id, profiles, ASC records; a second team (7XKD5M7288) owns ZOE and Shiksha Nation Mac |

Naming convention: iOS `io.<brand>.app`, Android `com.<brand>.app` (they differ on purpose). Target/scheme names
are ASCII without apostrophes ("Sreedhar TTS"); the display name keeps them ("Sreedhar's TTS").

---

## 2. Before you start — the institute must be ready

Check these in prod first; they cause rejections, not build failures.

- [ ] Domain routing resolves: `GET admin-core-service/public/domain-routing/v1/resolve?domain=…&subdomain=…`
- [ ] **A demo learner that logs in** (`POST auth-service/learner/v1/login` with `user_name`/`password`/`institute_id` → 200). the7cs was rejected because its demo account did not exist.
- [ ] The demo learner is enrolled in a course **with real published slides**. Empty courses ("Science", "test") are rejected as placeholder content (Brahm Varchas).
- [ ] `institute_domain_routing.allow_signup = true` on the LEARNER row, and the signup providers in `STUDENT_DISPLAY_SETTINGS.data.signup.providers` include something usable (`emailOtp: true`). Without a public door the app looks like an internal tool → **Guideline 3.2** (Brahm Varchas, Agilore). Only the LEARNER row; leave ADMIN false.
- [ ] `privacy_policy_url` on the routing row, pointing at the brand's own `https://<learner host>/privacypolicy` catalogue page (clone the Smart AI one; never the shared plasmic URL — it names "Vacademy Learner" and sits behind a bot wall).
- [ ] "All Courses" tab hidden if the client does not sell in-app: `STUDENT_DISPLAY_SETTINGS.data.allCourses.tabs[AllCourses].visible = false`. iOS builds already hide it (reader mode), but web screenshots of it read as a marketplace → **2.1(b)**.
- [ ] Google/GitHub flags: if Google is on, the Apple button shows (4.8) — so the audience allowlist above must be live.

---

## 3. The pipeline

```
scripts/ios-brand/register-ios-app.sh brands/<brand>.json check
scripts/ios-brand/register-ios-app.sh brands/<brand>.json all --web
```

| step | automated | you |
|---|---|---|
| `check` | resolves institute, tests demo login, warns on the list above | fix prod config |
| `apple` | bundle id + Push/Associated Domains/Sign in with Apple, App Store profile | — |
| — | — | **Firebase console** → vacademy-app-2 → add iOS app → download plist → `"firebasePlist"` in the config |
| `repo` | flavor ids, assets, storyboard, entitlements, merged plist, Xcode target, `pod install`, auth audiences | commit + PR (also deploys `auth_service`) |
| `web` | `vite build` + `cap copy ios` | — |
| `archive` | archive (automatic signing + ASC key), manual export, validate | — |
| — | — | **App Store Connect → My Apps → + New App** (iOS, name, bundle id, any SKU). No API exists. |
| `upload` | waits for the record, uploads, attaches the processed build | — |
| `shots` | simulator captures via `idb` + device frames | eyeball them |
| `publish` | description, keywords, URLs, notes + demo, EDUCATION, 4+, copyright, Free, content rights, screenshots | — |
| — | — | **App Privacy** label (copy Agilore's answers) → Publish; DSA trader status once per account |
| `submit` | review submission (retries until the label is published) | reply to Apple if asked |

Manual archive, if ever needed:

```bash
xcodebuild -workspace App.xcworkspace -scheme "<Target>" -sdk iphoneos -configuration Release archive \
  -archivePath "<path>.xcarchive" MARKETING_VERSION=1.0.0 CURRENT_PROJECT_VERSION=1 \
  -allowProvisioningUpdates -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_<KID>.p8 \
  -authenticationKeyID <KID> -authenticationKeyIssuerID <ISSUER>
xcodebuild -exportArchive -archivePath "<path>.xcarchive" -exportOptionsPlist ExportOptions.plist -exportPath out/
xcrun altool --validate-app -f out/*.ipa -t ios --apiKey <KID> --apiIssuer <ISSUER>
xcrun altool --upload-app   -f out/*.ipa -t ios --apiKey <KID> --apiIssuer <ISSUER>
```

`ExportOptions.plist`: `method app-store-connect`, `signingStyle manual`, `signingCertificate "Apple Distribution"`,
`provisioningProfiles { <bundle id>: "<Target> App Store" }`. Do **not** pass `CODE_SIGN_STYLE=Manual` /
`PROVISIONING_PROFILE_SPECIFIER` on the archive line — it applies to the Pods targets too and fails.

---

## 4. App Review — what Apple has rejected and what fixed it

Write the reviewer notes and any Resolution Center reply **public path first**. Apple reads them literally.

### Guideline 3.2 — "app is for a specific business or organisation"
Cause, twice: our own text — *"Accounts are issued by the institute. In-app self-registration is disabled."* plus a
login screen with no sign-up. Fix: `allow_signup = true` (+ email-OTP provider), a build that renders "Sign up here"
on native, notes that say anyone can register and browse, and a 5-question reply that states the app is for the
public. Never write that sentence again, even to pre-empt 5.1.1(v).

### Guideline 2.1(b) — business-model questionnaire
Asked when the reviewer sees courses + "enrol". Answer all eight questions plainly: the app is free, no IAP, no
purchase links, the institute sells its programmes on its own website / to organisations outside the app, accounts are
free. Keep the "How do users obtain an account" answer truthful to the institute's actual signup setting. Remove
marketplace-looking screenshots (the "All Courses" tab) and resubmit with the same build.

### Guideline 2.1(a) — app crashed / blank screen
- Crash on launch = placeholder `GOOGLE_APP_ID` in the brand plist (shipped once for six weeks).
- Black screen = target compiles only `AppDelegate.swift`. Check `strings <binary> | grep MainViewController`.
- "Sign in with Apple showed an error" = bundle id missing from `apple.native.audiences` or not deployed. Read the
  running pod's `application-prod.properties`, not the repo.
- "Sign up here does nothing" = the login route had no `onSwitchToSignup` (fixed on main 2026-09-18).

### Guideline 2.1 — demo account / placeholder content
The demo login must work against prod on the day of review, and what it opens must be real content.

### Guideline 4.8 — Sign in with Apple
Required whenever Google/GitHub login is shown. The app gates it correctly; the server allowlist is the usual failure.

### Google Play — privacy policy
Play rejects a policy URL that names a different app. Use the per-brand `/privacypolicy` page.

---

## 5. Reviewer notes template

```
<App> is the learner app of <Institute>, a <kind> that is open to the public: anyone can create an
account, browse the course catalogue and enrol.

ACCOUNTS
- Self-registration is open: tap "Sign up here" under the sign-in form (email one-time code, Google,
  or Sign in with Apple).
- Learners enrolled with the institute directly receive a username and password.
- Account deletion: https://<learner host>/delete-user

DEMO ACCOUNT (an enrolled learner) — use the Username and Password fields, not the social buttons:
  Username: <u>   Password: <p>
The username is not an email address.

WHAT YOU WILL SEE
Home = dashboard and enrolled courses; Learn = catalogue and lessons; Tests = assessments. "Nothing
live right now" on Tests is a correct empty state.

SIGN IN WITH APPLE is implemented and offered alongside Google (Guideline 4.8).

PURCHASES — no paid content, no in-app purchase, no purchase links; nothing needs to be bought.

Contact: <name> — <email> — <phone>
```

---

## 6. Troubleshooting

| symptom | cause / fix |
|---|---|
| app boots with Vacademy branding | bundle id not in `flavor.config.ts` **or** web bundle not rebuilt after adding it (`grep -rl <id> ios/App/App/public/`) |
| `Build input file cannot be found: …/App/App/Base.lproj/LaunchScreen<Key>.storyboard` | storyboard ref parented under the `App` group with an `App/…` path; it belongs under the main group |
| `No profiles for '<id>' were found` at archive | brand-new bundle id has no dev profile — add `-allowProvisioningUpdates` + the ASC key |
| `… does not support provisioning profiles (in target 'CapacitorAppLauncher')` | signing overrides on the xcodebuild line; move them to `ExportOptions.plist` |
| plist suddenly 800 bytes, build fails on missing `CFBundleIdentifier` | raw Firebase download pasted over the combined plist; restore and merge |
| `pod install` changed more than the Podfile checksum | someone ran `cap sync`; revert the Podfile's `capacitor_pods` block |
| `altool`: no suitable application records | the ASC app record has not been created in the web UI |
| `reviewSubmissionItems` 409 "must provide contentRightsDeclaration" / "pricing" / "data usages" | `publish` sets the first two; the third is the App Privacy label (UI only) |
| `reviewSubmission … cannot be found` | someone pressed Submit in the UI; the version is already Waiting for Review |
| simulator screenshot uniformly grey | push-permission alert behind the privacy screen; tap Allow (the script does) |
| `nm … MainViewController` prints nothing on a Release archive | symbols stripped; use `strings` |

---

## 7. Where things are

- Tool: `frontend-learner-dashboard-app/scripts/ios-brand/` (README inside; brand configs in `brands/`)
- Merge script: `frontend-learner-dashboard-app/ios/App/GoogleServiceConfigs/merge-firebase-config.sh`
- ASC API key: `~/.appstoreconnect/private_keys/AuthKey_<KID>.p8` (team 35NLZB49QN); also in the `vacademy-secrets` k8s secret
- Live store versions: `curl "https://itunes.apple.com/lookup?bundleId=<id>&country=in"`
- How the admin App Status page reads store state: `docs/APP_STORE_LIVE_TRACKING.md`
