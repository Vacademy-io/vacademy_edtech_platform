# ZOE Online School — Mac App Store submission

Ships as the **macOS platform of the existing app record** (app id `6794024192`,
team `7XKD5M7288` / Saurabh Kumar). The Mac build therefore carries the SAME
bundle id as the ZOE iOS app — `io.zoeedtech.app`. A different id would create a
separate listing instead of joining that record.

> The ZOE **iOS** target in `ios/App/App.xcodeproj` still has
> `DEVELOPMENT_TEAM = 35NLZB49QN` (Shreyash) even though the shipping app record
> and the bundle id both live on `7XKD5M7288` (Saurabh). Nothing in this Mac
> build reads that setting, so it does not affect the `.pkg` — but do not take
> the pbxproj as evidence of which account ZOE belongs to.

Version is pinned via `extraMetadata` (currently **1.0.1**) to match the version
record open in App Store Connect; `CFBundleVersion` (`buildVersion`) must be
bumped on every re-upload — now **6**, for the "ZOE Online School" rename.
`electron/package.json` (1.0.12) is untouched, so the Windows Store and DMG
builds are unaffected.

Config: `electron-builder.zoe-mas.json` + `entitlements.zoe.mas.plist` +
`embedded-zoe.provisionprofile`. Build: `./build-mas-zoe.sh`. Output:
`dist-mas-zoe/ZOE-Online-School-MAS.pkg`.

This is separate from the Windows Store AppX build
(`electron-builder.zoe-store.json` / `build-windows-zoe.sh`), which carries the
same rename in its own `productName` / `appx.displayName`.

## Apple-side state (already done)

On team `7XKD5M7288`:

- App ID `io.zoeedtech.app` — registered, platform **UNIVERSAL**, so macOS needs
  no separate enablement.
- Certificates — `Apple Distribution: Saurabh Kumar` (signs the `.app`) and
  `Mac Installer Distribution: Saurabh Kumar` (signs the `.pkg`). Both expire
  2027-08-18.
- Provisioning profile — **ZOE Edtech macOS Store 2026** (`MAC_APP_STORE`,  <!-- Apple-side name, do not rename -->
  Platform `OSX`), saved as `embedded-zoe.provisionprofile` (git-ignored,
  per-account). Verify with `security cms -D -i embedded-zoe.provisionprofile`;
  it must say `Platform: ['OSX']` and
  `com.apple.application-identifier = 7XKD5M7288.io.zoeedtech.app`.
- App Store Connect — macOS platform added to the ZOE app record, showing
  *macOS App 1.0 — Prepare for Submission*.

## Traps this build works around

These all cost real time on the Shiksha Nation MAS build; the script handles
them, so do not "simplify" them away.

1. **Reader mode silently compiling to `false`.** Guideline 3.1.1 applies to the
   Mac App Store too, so the store build must hide commerce like iOS does. The
   flag is a Vite `define` (`__MAC_APP_STORE__`), **not** `import.meta.env` —
   this project has no `.env` files and Vite does not copy `process.env` into
   `import.meta.env`, so an env-var-only version compiles to `false` and ships a
   non-compliant package that looks correct. Step 2 of the script verifies the
   compiled gate and refuses to continue if reader mode is off.
2. **`mas.icon` alone is ignored** — the app icon resolves from the `mac` block,
   so both are set. Without a `mac` block it builds with the default Electron
   icon.
3. **`mas.identity` doubles as the INSTALLER cert qualifier.** electron-builder
   calls `findIdentity("3rd Party Mac Developer Installer", masOptions.identity)`
   and the qualifier is a plain substring match, so it must be the part BOTH
   certs share: `Saurabh Kumar (7XKD5M7288)` — not either full cert name, and
   **not** `CSC_NAME` (applied globally, breaks the same lookup). A full-name pin
   also made it auto-pick the other team's cert (35NLZB49QN, Shreyash), which
   sits in the same keychain.
4. **electron-builder 23.6.0 never produces the `.pkg`** (exits 0, app signed, no
   package) and **crashes on universal MAS** builds. The script builds the `.app`
   and then wraps it with `productbuild` itself.
5. **Apple rejects arm64-only uploads (409) unless `LSMinimumSystemVersion >= 12.0`.**
   Hence `minimumSystemVersion: "12.0"`. Consequence: **Apple Silicon only,
   macOS 12+ — Intel Macs are excluded.** The proper fix is a universal binary,
   which needs an electron-builder upgrade.
6. **Apple's profile wizard defaults to the iOS App Store type**; the macOS one is
   a separate entry lower down. `.provisionprofile` = macOS,
   `.mobileprovision` = iOS.

## Build and upload

```bash
cd electron
./build-mas-zoe.sh

xcrun altool --upload-app -f dist-mas-zoe/ZOE-Online-School-MAS.pkg -t macos \
  --apiKey PSXF55PAG3 --apiIssuer ce0d8810-9d44-4cd7-9817-f825bb51bf2e
```

(or drag the `.pkg` into Transporter.app)

## Still needed before the listing can be submitted

- **Mac screenshots** (1280×800 or 2880×1800) on the macOS version record.
- A decision on the **Shiksha Nation macOS rejection** (that record is
  `REJECTED`) — ZOE is the same Electron shell, so whatever Apple objected to
  there very likely applies here too. Read the Resolution Center message before
  submitting ZOE for review.
- Uploading a build does **not** submit it. Attach it to the macOS 1.0 version
  and submit explicitly.

See `ELECTRON_OTA.md` for how this build receives updates between review cycles.
