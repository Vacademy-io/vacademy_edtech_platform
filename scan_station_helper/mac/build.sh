#!/bin/bash
# Builds "build/Vacademy Scan Helper.app" with swiftc only (Command Line Tools; no Xcode needed).
#   ./build.sh                 universal app (arm64 + x86_64)
#   ARCHS=arm64 ./build.sh     one architecture (faster while developing)
# The result is ad-hoc signed (codesign -s -). It is not notarized: on another Mac, right-click → Open
# the first time, or remove the quarantine flag (xattr -dr com.apple.quarantine "<app>").
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="Vacademy Scan Helper"
EXE="VacademyScanHelper"
BUNDLE_ID="io.vacademy.scanhelper"
MIN_MACOS="13.0"
ARCHS="${ARCHS:-arm64 x86_64}"
VERSION="$(sed -n 's/.*static let version = "\(.*\)".*/\1/p' Sources/Shared.swift)"
[ -n "$VERSION" ] || { echo "could not read version from Sources/Shared.swift" >&2; exit 1; }

APP="build/$APP_NAME.app"
rm -rf "$APP" build/obj
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" build/obj

SLICES=()
for arch in $ARCHS; do
  echo "compiling ${arch}..."
  swiftc -O -swift-version 5 -target "$arch-apple-macos$MIN_MACOS" \
    -module-name VacademyScanHelper \
    -framework AppKit -framework ImageCaptureCore -framework Network -framework ImageIO \
    -o "build/obj/$EXE-$arch" Sources/*.swift 2>&1 | grep -v "^$" || true
  [ -f "build/obj/$EXE-$arch" ] || { echo "build failed for $arch" >&2; exit 1; }
  SLICES+=("build/obj/$EXE-$arch")
done
lipo -create -output "$APP/Contents/MacOS/$EXE" "${SLICES[@]}"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>$EXE</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>$MIN_MACOS</string>
  <key>LSUIElement</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.education</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>© 2026 Vacademy. All rights reserved.</string>
  <key>NSLocalNetworkUsageDescription</key><string>Vacademy Scan Helper finds the scanner and printer on your network so the Scan Station page can use them.</string>
  <key>NSBonjourServices</key>
  <array>
    <string>_uscan._tcp</string>
    <string>_uscans._tcp</string>
    <string>_scanner._tcp</string>
    <string>_ipp._tcp</string>
    <string>_ipps._tcp</string>
  </array>
</dict>
</plist>
PLIST
plutil -lint "$APP/Contents/Info.plist" >/dev/null

codesign --force --sign - --identifier "$BUNDLE_ID" "$APP"
codesign --verify "$APP"
rm -rf build/obj
echo "built $APP ($VERSION; $(lipo -archs "$APP/Contents/MacOS/$EXE"))"
