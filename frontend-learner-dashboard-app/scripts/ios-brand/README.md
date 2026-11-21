# ios-brand — register a white-label iOS app from one config

Everything that was done by hand for Agilore, Smart AI Academy and Sreedhar's TTS, as one command.

```bash
# 1. copy a config and fill it in
cp scripts/ios-brand/brands/example.json scripts/ios-brand/brands/<brand>.json

# 2. run it (each step is idempotent; `all` runs them in order)
scripts/ios-brand/register-ios-app.sh scripts/ios-brand/brands/<brand>.json check
scripts/ios-brand/register-ios-app.sh scripts/ios-brand/brands/<brand>.json all --web
```

## What you must do by hand (the script stops and tells you)

| When | Where | What |
|---|---|---|
| before `repo` | Firebase console → project **vacademy-app-2** → Add app → iOS | register the bundle id, download `GoogleService-Info.plist`, put its path in `"firebasePlist"` |
| before `upload` | App Store Connect → My Apps → **+ New App** | iOS, the display name, the bundle id (already registered by `apple`), any SKU — the API cannot create app records; `upload` polls until it exists |
| before `submit` | ASC → the app → **App Privacy** | answer the questionnaire (copy Agilore Global's) and **Publish**; `submit --wait` retries every 2 min until it is |
| once per account | ASC → Business | DSA trader status, or the app is hidden in the EU |
| before review | deploy `auth_service` | `apple.native.audiences` gained the bundle id; until the pod runs it, Sign in with Apple errors and Apple rejects (HCCA) |

## Steps

| step | does | needs |
|---|---|---|
| `check` | resolves the institute from `domain`/`subdomain`, tests the demo login, warns on `allow_signup=false` (Guideline 3.2), reports ASC state | network |
| `apple` | bundle id + Push / Associated Domains / Sign in with Apple, App Store profile installed for xcodebuild | ASC API key |
| `repo` | `flavor.config.ts` entries (iOS + Android), icon/splash from `logo`, launch storyboard, entitlements (own applinks host), merged plist, Xcode target + scheme (cloned from `templateTarget`), Podfile + `pod install`, `auth_service` audiences | Firebase plist (else a `REPLACE_WITH_` placeholder that blocks archiving) |
| `web` | vite build + `cap copy ios` — the app id is compiled into the JS; skip it and the app boots with generic Vacademy branding | 4–10 min |
| `archive` | archive with the project's automatic signing + the ASC key (mints the dev profile a new id lacks), export with a manual `ExportOptions.plist`, validate | `web` done once |
| `upload` | waits for the ASC app record, `altool --upload-app`, waits for processing, attaches the build to version 1.0 | app record |
| `shots` | simulator capture through `idb` (no desktop interaction) + device frames into `screenshotsDir/{iphone,ipad}` | `brew install idb-companion`, `pip3 install fb-idb`, an iPhone 16 Pro Max + iPad Pro 13 simulator |
| `publish` | description, keywords, support/privacy URLs, review notes + demo account, EDUCATION, age rating copied from `templateAppId`, copyright, Free price, content rights, screenshots | app record |
| `submit` | creates the review submission, adds version 1.0, submits; cancels a stale `UNRESOLVED_ISSUES` submission first | App Privacy published |

Outputs (archives excepted) land in `scripts/ios-brand/.out/<key>/` (git-ignored).

## Things learned the hard way (already encoded above)

- Reviewer notes must never say "self-registration is disabled" / "accounts are issued by the institute" —
  that sentence alone produced Guideline 3.2 rejections twice. Lead with the public path.
- The brand plist is BOTH the `INFOPLIST_FILE` and a bundled resource. Never paste the raw Firebase download
  over it; the tool merges only the Firebase keys (`merge-firebase-config.sh`).
- `CODE_SIGN_STYLE=Manual … PROVISIONING_PROFILE_SPECIFIER=…` on the `xcodebuild archive` line fails: it
  leaks into the Pods targets. Archive with automatic signing, export manually.
- `npx cap copy ios`, never `cap sync` — sync rewrites the Podfile for every brand target.
- Brand storyboard refs must be parented under the main group with an `App/…` path; parenting under the
  `App` group resolves to `App/App/…` and the build fails.
- Screenshot sets cap at 10 per display type; Apple's API occasionally returns a 500 right after a set
  delete — retry after ~10 s. `privacyPolicyUrl` lives on `appInfoLocalizations`, not the version localization.
- Every course in a fresh institute usually has 0 published slides; Apple rejects "placeholder content"
  (Brahm Varchas). Load real content and enrol the demo account before submitting.
