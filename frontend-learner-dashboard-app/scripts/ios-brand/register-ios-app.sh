#!/usr/bin/env bash
# Register a white-label iOS app end to end from one brand config.
#
#   scripts/ios-brand/register-ios-app.sh <brand.json> <step|all> [--web] [--yes]
#
# Steps, in order (each is idempotent and can be re-run):
#   check     resolve the institute from domain routing, test the demo login, list what is missing
#   apple     bundle id + capabilities + App Store provisioning profile (ASC API)
#   repo      flavor.config.ts, icon/splash, launch storyboard, entitlements, merged plist,
#             Xcode target + scheme, Podfile + pod install, auth_service Apple audiences
#   web       rebuild the web bundle and copy it into ios/App/App/public (needed once per new app id;
#             slow — only runs with --web or as part of `all --web`)
#   archive   xcodebuild archive + export to an .ipa, validated against ASC
#   upload    wait for the ASC app record (created in the web UI), upload, attach the build
#   shots     capture + frame App Store screenshots on the simulator (idb), into screenshotsDir
#   publish   metadata, review notes, category, age rating, price, rights, screenshots
#   submit    create the review submission and submit (retries until App Privacy is published)
#
# Human steps it cannot do: Firebase console (download the iOS GoogleService-Info.plist and set
# "firebasePlist" in the config), App Store Connect "New App", the App Privacy label, DSA trader status.
set -euo pipefail

CFG=${1:?brand config json}; STEP=${2:-all}; shift 2 || true
WEB=0; YES=0
for a in "$@"; do case "$a" in --web) WEB=1;; --yes) YES=1;; esac; done

HERE=$(cd "$(dirname "$0")" && pwd)
APP=$(cd "$HERE/../.." && pwd)                 # frontend-learner-dashboard-app
REPO=$(cd "$APP/.." && pwd)                    # vacademy_platform
IOS="$APP/ios/App"
export PATH="$HOME/.nvm/versions/node/v20.19.6/bin:/opt/homebrew/bin:$PATH"
CFG=$(cd "$(dirname "$CFG")" && pwd)/$(basename "$CFG")
cfg() { python3 -c "import json,sys; v=json.load(open('$CFG')).get('$1'); print(v if v is not None else '')"; }
cfgn() { python3 -c "import json; v=json.load(open('$CFG')); print(v.get('$1',{}).get('$2',''))"; }

KEY=$(cfg key); TARGET=$(cfg targetName); DISPLAY=$(cfg displayName); BUNDLE=$(cfg bundleId)
ANDROID=$(cfg androidAppId); CFGDIR=$(cfg configDir); DOMAIN=$(cfg domain); SUB=$(cfg subdomain)
LOGO=$(cfg logo); LOGOMODE=$(cfg logoMode); FBPLIST=$(cfg firebasePlist); TEMPLATE=$(cfg templateTarget)
MV=$(cfg marketingVersion); BN=$(cfg buildNumber); DEMO_U=$(cfgn demo username); DEMO_P=$(cfgn demo password)
TEMPLATE=${TEMPLATE:-Agilore Global}; MV=${MV:-1.0.0}; BN=${BN:-1}
FILEKEY=$(echo "$KEY" | tr "[:upper:]" "[:lower:]")   # asset file names are lowercase (case-sensitive CI)
HOST="$SUB.$DOMAIN"; ARCHIVE="$HOME/Library/Developer/Xcode/Archives/$(date +%Y-%m-%d)/$TARGET $MV ($BN).xcarchive"
EXPORT="$APP/scripts/ios-brand/.out/$KEY"; API_BASE=${VACADEMY_API:-https://backend-stage.vacademy.io}

log() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }
confirm() { [ "$YES" = 1 ] && return 0; read -r -p "$1 [y/N] " r; [[ "$r" =~ ^[Yy] ]]; }

step_check() {
  log "check: $DISPLAY ($BUNDLE) ← $HOST"
  local json; json=$(curl -sf --max-time 20 "$API_BASE/admin-core-service/public/domain-routing/v1/resolve?domain=$DOMAIN&subdomain=$SUB") || die "domain routing does not resolve $HOST"
  INSTITUTE=$(echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['instituteId'])")
  echo "$json" | python3 -c "
import sys,json; d=json.load(sys.stdin)
print('  institute', d['instituteId'], '|', d.get('instituteName'))
print('  allowSignup', d.get('allowSignup'), '| google', d.get('allowGoogleAuth'), '| emailOtp', d.get('allowEmailOtpAuth'), '| privacy', d.get('privacyPolicyUrl'))
if not d.get('allowSignup'): print('  WARNING allow_signup=false + no public door = Guideline 3.2 rejection (Brahm Varchas, Agilore). Flip institute_domain_routing.allow_signup.')
if not d.get('privacyPolicyUrl'): print('  WARNING no privacy_policy_url on the routing row')"
  if [ -n "$DEMO_U" ]; then
    local code; code=$(curl -s --max-time 20 -o /tmp/_login.json -w '%{http_code}' -X POST "$API_BASE/auth-service/learner/v1/login" -H 'Content-Type: application/json' -d "{\"user_name\":\"$DEMO_U\",\"password\":\"$DEMO_P\",\"institute_id\":\"$INSTITUTE\"}")
    grep -q accessToken /tmp/_login.json && echo "  demo login $DEMO_U: OK" || die "demo login $DEMO_U failed (HTTP $code) — Apple rejects apps whose demo account does not work"
  else echo "  WARNING no demo account in config"; fi
  [ -n "$FBPLIST" ] && [ -f "$FBPLIST" ] && echo "  firebase plist: $FBPLIST ($(plutil -extract GOOGLE_APP_ID raw "$FBPLIST"))" || echo "  firebase plist: MISSING — register $BUNDLE in Firebase (vacademy-app-2), download GoogleService-Info.plist, set firebasePlist"
  [ -f "$LOGO" ] && echo "  logo: $LOGO" || echo "  WARNING logo not found: $LOGO"
  ls "$HOME/.appstoreconnect/private_keys/"AuthKey_*.p8 >/dev/null 2>&1 && echo "  asc key: ok" || die "no ASC API key in ~/.appstoreconnect/private_keys"
  local ci; ci=$(cd "$APP" && node scripts/ios-brand/lib/asc.mjs status "$CFG" 2>&1 | sed 's/^/  asc /'); echo "$ci"
}

step_apple() {
  log "apple: bundle id, capabilities, profile"
  (cd "$APP" && node scripts/ios-brand/lib/asc.mjs bundle-id "$CFG" && node scripts/ios-brand/lib/asc.mjs profile "$CFG")
}

step_repo() {
  log "repo: flavor.config.ts"
  python3 - "$APP/flavor.config.ts" "$BUNDLE" "$ANDROID" "$DISPLAY" "$DOMAIN" "$SUB" <<'EOF'
import sys, re
p, ios, android, name, domain, sub = sys.argv[1:]
s = open(p).read()
def entry(appid, kind):
    return f'''
  // {name} {kind} app
  "{appid}": {{
    appName: "{name}",
    domain: "{domain}",
    subdomain: "{sub}",
  }},
'''
add = ""
for appid, kind in ((ios, "iOS"), (android, "Android")):
    if appid and f'"{appid}"' not in s: add += entry(appid, kind)
if add:
    i = s.rstrip().rfind("};")
    s = s[:i].rstrip("\n") + "\n" + add + "};\n"
    open(p, "w").write(s); print("  added", [a for a in (ios, android) if a and f'"{a}"' in add])
else: print("  flavor.config.ts already has the ids")
EOF

  log "repo: icon + splash"
  local gen="$APP/scripts/ios-brand/.out/$KEY/assets"
  python3 "$HERE/lib/gen_assets.py" "$LOGO" "$gen" "$FILEKEY" "${LOGOMODE:-auto}" | sed 's/^/  /'
  python3 - "$IOS" "$KEY" "$gen" "$FILEKEY" <<'EOF'
import json, os, shutil, sys
ios, key, gen, fk = sys.argv[1:]
d = f"{ios}/App/Assets.xcassets/{key}Icon.appiconset"; os.makedirs(d, exist_ok=True)
shutil.copy(f"{gen}/{fk}-icon-1024.png", f"{d}/{fk}-icon-1024.png")
json.dump({"images":[{"filename":f"{fk}-icon-1024.png","idiom":"universal","platform":"ios","size":"1024x1024"}],"info":{"author":"xcode","version":1}}, open(f"{d}/Contents.json","w"), indent=2)
d = f"{ios}/App/Assets.xcassets/{key}Splash.imageset"; os.makedirs(d, exist_ok=True)
names = [f"{fk}-splash-2732x2732-2.png", f"{fk}-splash-2732x2732-1.png", f"{fk}-splash-2732x2732.png"]
for n in names: shutil.copy(f"{gen}/{fk}-splash-2732x2732.png", f"{d}/{n}")
json.dump({"images":[{"idiom":"universal","filename":names[0],"scale":"1x"},{"idiom":"universal","filename":names[1],"scale":"2x"},{"idiom":"universal","filename":names[2],"scale":"3x"}],"info":{"version":1,"author":"xcode"}}, open(f"{d}/Contents.json","w"), indent=2)
print("  asset catalog:", f"{key}Icon", f"{key}Splash")
EOF

  log "repo: launch storyboard, entitlements, plist"
  python3 - "$IOS" "$KEY" "$CFGDIR" "$BUNDLE" "$DISPLAY" "$HOST" "$TEMPLATE" <<'EOF'
import os, re, sys, subprocess
ios, key, cfgdir, bundle, display, host, template = sys.argv[1:]
# find the template's key/cfgdir from its build settings
pbx = open(f"{ios}/App.xcodeproj/project.pbxproj").read()
m = re.search(r'INFOPLIST_FILE = "GoogleServiceConfigs/([^/]+)/GoogleService-Info.plist";', pbx[pbx.find(f'/* {template} */'):]) or re.search(r'INFOPLIST_FILE = "GoogleServiceConfigs/([^/]+)/GoogleService-Info.plist";', pbx)
tcfg = m.group(1)
tsb = re.search(r'UILaunchStoryboardName</key>\s*<string>([^<]+)</string>', open(f"{ios}/GoogleServiceConfigs/{tcfg}/GoogleService-Info.plist").read()).group(1)
tkey = tsb.replace("LaunchScreen", "")
sb = f"{ios}/App/Base.lproj/LaunchScreen{key}.storyboard"
if not os.path.exists(sb):
    open(sb, "w").write(open(f"{ios}/App/Base.lproj/{tsb}.storyboard").read().replace(f"{tkey}Splash", f"{key}Splash")); print("  storyboard:", os.path.basename(sb))
ent = f"{ios}/App/{key}.entitlements"
if not os.path.exists(ent):
    tent = open(f"{ios}/App/{tkey}.entitlements").read()
    tent = re.sub(r"\s*<!--.*?-->", "", tent, flags=re.S)
    tent = re.sub(r"applinks:[^<]+", f"applinks:{host}", tent)
    open(ent, "w").write(tent); print("  entitlements:", os.path.basename(ent), "applinks:" + host)
pl = f"{ios}/GoogleServiceConfigs/{cfgdir}/GoogleService-Info.plist"
if not os.path.exists(pl):
    os.makedirs(os.path.dirname(pl), exist_ok=True)
    t = open(f"{ios}/GoogleServiceConfigs/{tcfg}/GoogleService-Info.plist").read()
    tb = re.search(r"<key>BUNDLE_ID</key>\s*<string>([^<]+)</string>", t).group(1)
    tdisp = re.search(r"<key>CFBundleDisplayName</key>\s*<string>([^<]+)</string>", t).group(1)
    t = t.replace(f"<string>{tb}</string>", f"<string>{bundle}</string>").replace(f"<string>{tdisp}</string>", f"<string>{display}</string>")
    t = t.replace(tsb, f"LaunchScreen{key}")
    t = re.sub(r"(<key>GOOGLE_APP_ID</key>\s*<string>)[^<]*(</string>)", r"\g<1>REPLACE_WITH_FIREBASE_GOOGLE_APP_ID\g<2>", t)
    t = t.replace(f"GoogleServiceConfigs/{tcfg}/", f"GoogleServiceConfigs/{cfgdir}/").replace(f"merge-firebase-config.sh {tcfg}", f"merge-firebase-config.sh {cfgdir}")
    open(pl, "w").write(t); print("  plist template:", pl)
EOF
  if [ -n "$FBPLIST" ] && [ -f "$FBPLIST" ]; then
    cp "$FBPLIST" "$IOS/GoogleServiceConfigs/$CFGDIR/GoogleService-Info.firebase.plist"
    (cd "$IOS" && ./GoogleServiceConfigs/merge-firebase-config.sh "$CFGDIR" | sed 's/^/  /')
    rm -f "$IOS/GoogleServiceConfigs/$CFGDIR/GoogleService-Info.firebase.plist"
  else
    echo "  Firebase id left as REPLACE_WITH_ placeholder — the build guard will refuse to archive until it is merged"
  fi
  grep -q "REPLACE_WITH_" "$IOS/GoogleServiceConfigs/$CFGDIR/GoogleService-Info.plist" && echo "  plist: placeholder" || echo "  plist: GOOGLE_APP_ID $(plutil -extract GOOGLE_APP_ID raw "$IOS/GoogleServiceConfigs/$CFGDIR/GoogleService-Info.plist")"

  log "repo: Xcode target + Podfile"
  ruby "$HERE/lib/add_target.rb" "$IOS" "$TARGET" "$KEY" "$BUNDLE" "$CFGDIR" "$DISPLAY" "$TEMPLATE" | sed 's/^/  /'
  if ! grep -q "target '$TARGET' do" "$IOS/Podfile"; then
    python3 - "$IOS/Podfile" "$TARGET" <<'EOF'
import sys; p, t = sys.argv[1:]; s = open(p).read()
i = s.find("post_install do"); s = s[:i] + f"target '{t}' do\n  capacitor_pods\nend\n\n" + s[i:]; open(p, "w").write(s); print("  Podfile: added target")
EOF
    (cd "$IOS" && LANG=en_US.UTF-8 pod install 2>&1 | tail -1 | sed 's/^/  /')
  else echo "  Podfile: target present"; fi

  log "repo: auth_service apple.native.audiences"
  for f in "$REPO"/auth_service/src/main/resources/application-{dev,stage,prod,k8s-local}.properties; do
    python3 - "$f" "$BUNDLE" <<'EOF'
import re, sys; p, b = sys.argv[1:]; s = open(p).read()
m = re.search(r'^(apple\.native\.audiences=\$\{APPLE_NATIVE_AUDIENCES:)([^}]*)(\})', s, re.M)
ids = m.group(2).split(",")
if b not in ids:
    ids.append(b); open(p, "w").write(s[:m.start()] + m.group(1) + ",".join(ids) + m.group(3) + s[m.end():]); print("  +", p.split("/")[-1])
EOF
  done
  echo "  (auth_service must be DEPLOYED before review, or Sign in with Apple errors — HCCA was rejected for this)"
}

step_web() {
  log "web: vite build → ios/App/App/public (this is what compiles the app id into the JS)"
  (cd "$APP" && rm -rf dist && node --max-old-space-size=4096 node_modules/vite/bin/vite.js build >/tmp/ios-brand-vite.log 2>&1) || die "vite build failed, see /tmp/ios-brand-vite.log"
  grep -rlq "$BUNDLE" "$APP/dist/assets" || die "built bundle does not contain $BUNDLE — flavor.config.ts entry missing?"
  (cd "$APP" && npx cap copy ios >/dev/null)   # copy, never sync: sync rewrites the Podfile for every target
  echo "  bundle contains $BUNDLE: yes"
}

step_archive() {
  log "archive: $TARGET $MV ($BN)"
  grep -q "REPLACE_WITH_" "$IOS/GoogleServiceConfigs/$CFGDIR/GoogleService-Info.plist" && die "plist still has the Firebase placeholder — set firebasePlist and re-run repo"
  grep -rlq "$BUNDLE" "$IOS/App/public/assets" || die "ios/App/App/public does not contain $BUNDLE — run the web step (--web)"
  local kid="${ASC_KEY_ID:-KGSU6BPA68}" iss="${ASC_ISSUER_ID:-b488efb0-528d-4e05-8241-8ff52160ddef}"
  rm -rf "$ARCHIVE"; mkdir -p "$(dirname "$ARCHIVE")"
  # project signing (automatic) + API key so xcodebuild can mint the dev profile a brand-new bundle id lacks;
  # CODE_SIGN_STYLE/PROFILE overrides on this line would leak into the Pods targets and fail.
  (cd "$IOS" && xcodebuild -workspace App.xcworkspace -scheme "$TARGET" -sdk iphoneos -configuration Release archive \
      -archivePath "$ARCHIVE" MARKETING_VERSION="$MV" CURRENT_PROJECT_VERSION="$BN" \
      -allowProvisioningUpdates -authenticationKeyPath "$HOME/.appstoreconnect/private_keys/AuthKey_$kid.p8" \
      -authenticationKeyID "$kid" -authenticationKeyIssuerID "$iss" -quiet 2>&1 | grep -E "error:|ARCHIVE FAILED" | head -5 || true)
  [ -d "$ARCHIVE/Products/Applications" ] || die "archive failed"
  mkdir -p "$EXPORT"
  cat > "$EXPORT/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>${APPLE_TEAM_ID:-35NLZB49QN}</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key><dict><key>$BUNDLE</key><string>$TARGET App Store</string></dict>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
EOF
  rm -rf "$EXPORT/ipa"
  xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$EXPORT/ExportOptions.plist" -exportPath "$EXPORT/ipa" 2>&1 | grep -E "EXPORT|error" | head -3
  IPA=$(ls "$EXPORT"/ipa/*.ipa 2>/dev/null | head -1); [ -n "$IPA" ] || die "export failed"
  local app; app=$(find "$ARCHIVE/Products/Applications" -maxdepth 1 -name '*.app' | head -1)
  echo "  $(plutil -extract CFBundleIdentifier raw "$app/Info.plist") $(plutil -extract CFBundleShortVersionString raw "$app/Info.plist") ($(plutil -extract CFBundleVersion raw "$app/Info.plist")) firebase=$(plutil -extract GOOGLE_APP_ID raw "$app/GoogleService-Info.plist")"
  strings "$app/$(plutil -extract CFBundleExecutable raw "$app/Info.plist")" | grep -q MainViewController || die "MainViewController is not in the binary — the target's Sources phase is incomplete (black-screen bug)"
  xcrun altool --validate-app -f "$IPA" -t ios --apiKey "$kid" --apiIssuer "$iss" 2>&1 | grep -E "SUCCEEDED|error" | head -2 | sed 's/^/  /'
  echo "  ipa: $IPA"
}

step_upload() {
  log "upload"
  local kid="${ASC_KEY_ID:-KGSU6BPA68}" iss="${ASC_ISSUER_ID:-b488efb0-528d-4e05-8241-8ff52160ddef}"
  IPA=$(ls "$EXPORT"/ipa/*.ipa 2>/dev/null | head -1); [ -n "$IPA" ] || die "no ipa — run archive first"
  (cd "$APP" && node scripts/ios-brand/lib/asc.mjs wait-app "$CFG" 120)
  xcrun altool --upload-app -f "$IPA" -t ios --apiKey "$kid" --apiIssuer "$iss" 2>&1 | grep -E "SUCCEEDED|UUID|error" | sed 's/^/  /'
  (cd "$APP" && node scripts/ios-brand/lib/asc.mjs attach "$CFG" "$BN")
}

step_shots() {
  log "shots: simulator capture (idb)"
  local dir; dir=$(cfg screenshotsDir); [ -n "$dir" ] || die "screenshotsDir not set in config"
  [[ "$dir" = /* ]] || dir="$(dirname "$CFG")/$dir"
  local iphone="${SIM_IPHONE:-$(xcrun simctl list devices available | grep -m1 'iPhone 16 Pro Max' | grep -o '[0-9A-F-]\{36\}')}"
  local ipad="${SIM_IPAD:-$(xcrun simctl list devices available | grep -m1 'iPad Pro 13' | grep -o '[0-9A-F-]\{36\}')}"
  [ -n "$iphone$ipad" ] || die "no iPhone 16 Pro Max / iPad Pro 13 simulator (set SIM_IPHONE / SIM_IPAD)"
  local dd=/tmp/ios-brand-sim-$KEY; rm -rf "$dd"
  (cd "$IOS" && xcodebuild -workspace App.xcworkspace -scheme "$TARGET" -sdk iphonesimulator -configuration Debug -derivedDataPath "$dd" CODE_SIGNING_ALLOWED=NO -quiet build 2>&1 | grep -E "error:" | head -3 || true)
  local app; app=$(find "$dd/Build/Products/Debug-iphonesimulator" -maxdepth 1 -name '*.app' | head -1); [ -n "$app" ] || die "simulator build failed"
  python3 "$HERE/lib/simshots.py" "$app" "$BUNDLE" "$DEMO_U" "$DEMO_P" "$dir/raw" "$iphone" "$ipad"
  python3 - "$HERE/lib" "$dir" <<'EOF'
import glob, os, sys; sys.path.insert(0, sys.argv[1]); from frame_shots import frame
d = sys.argv[2]
for kind in ("iphone", "ipad"):
    os.makedirs(f"{d}/{kind}", exist_ok=True)
    for f in sorted(glob.glob(f"{d}/raw/{kind}/*.png")): print("  framed", kind, os.path.basename(f), frame(f, kind, f"{d}/{kind}/{os.path.basename(f)}"))
EOF
  rm -rf "$dd"; echo "  review $dir/{iphone,ipad} before publishing"
}

step_publish() { log "publish"; (cd "$APP" && node scripts/ios-brand/lib/asc.mjs publish "$CFG"); }
step_submit()  { log "submit";  confirm "Submit $DISPLAY for App Review?" && (cd "$APP" && node scripts/ios-brand/lib/asc.mjs submit "$CFG" --wait); }

case "$STEP" in
  check|apple|repo|web|archive|upload|shots|publish|submit) "step_$STEP" ;;
  all)
    step_check; step_apple; step_repo
    [ "$WEB" = 1 ] && step_web
    step_archive; step_upload
    [ -n "$(cfg screenshotsDir)" ] && [ ! -d "$(cfg screenshotsDir)" ] && step_shots
    step_publish; step_submit ;;
  *) die "unknown step $STEP" ;;
esac
