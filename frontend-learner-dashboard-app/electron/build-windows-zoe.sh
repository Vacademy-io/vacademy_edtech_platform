#!/bin/bash

# Microsoft Store (AppX) Windows build script for ZOE Online School.
#
# ZOE's Windows version is pinned by "extraMetadata.version" in
# electron-builder.zoe-store.json. Without it the AppX Identity Version comes
# from electron/package.json, which is Shiksha Nation's Electron shell version
# — so ZOE's Store version would move whenever SN shipped. Keep it above
# whatever this product already has in Partner Center.
# (electron-builder 23.6.0 validates its config strictly and rejects unknown
# keys, so that note cannot live in the JSON as a "_comment" field.)
# Publishes under the Shiksha Nation Partner Center account (shared publisher
# identity CN=86D745F8-... in electron-builder.zoe-store.json).
#
# NOTE: the "appx" target can only be PACKAGED on Windows (needs the Windows SDK
# makeappx). Run this on a Windows machine (Git Bash / WSL) — it will fail on
# macOS/Linux at the electron-builder appx step.
#
# Sets FLAVOR=zoe for capacitor.config.ts and VITE_ELECTRON_APP_ID for the
# frontend flavor resolution (-> flavor.config.ts "com.zoeedtech.app").

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Ensure package.json is restored even if the build fails
cleanup() {
    if [ -f "$SCRIPT_DIR/package.json.bak" ]; then
        mv "$SCRIPT_DIR/package.json.bak" "$SCRIPT_DIR/package.json"
        echo "🔄 Restored original package.json"
    fi
}
trap cleanup EXIT

export FLAVOR="zoe"
export VITE_ELECTRON_APP_ID="com.zoeedtech.app"

echo "🚀 Building ZOE Online School Windows Store (AppX) App (x64 + x86)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   FLAVOR=$FLAVOR"
echo "   VITE_ELECTRON_APP_ID=$VITE_ELECTRON_APP_ID"
echo ""

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

PARENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Step 1: Build the frontend with the ZOE flavor
echo -e "${BLUE}🌐 Building frontend with ZOE flavor...${NC}"
cd "$PARENT_DIR"
VITE_ELECTRON_APP_ID="$VITE_ELECTRON_APP_ID" pnpm run build
echo -e "${GREEN}✅ Frontend built${NC}"
echo ""

# Step 2: Copy frontend build to electron/app
echo -e "${BLUE}📁 Copying frontend build to electron/app...${NC}"
rm -rf "$SCRIPT_DIR/app"
cp -r "$PARENT_DIR/dist" "$SCRIPT_DIR/app"

# Record which OTA bundle version is baked in. Without it ota.ts falls back to the
# ELECTRON package version (1.0.x) — a different numbering space — so every OTA
# bundle looks newer and the fresh builtin bundle is replaced by an older one on
# first launch. build-mas-zoe.sh has always done this; this script had not.
WEB_VERSION=$(node -p "require('$PARENT_DIR/package.json').version")
echo -n "$WEB_VERSION" > "$SCRIPT_DIR/app/ota-bundle-version.txt"
echo -e "${GREEN}✅ Frontend copied (packaged OTA bundle version: ${WEB_VERSION})${NC}"
echo ""

cd "$SCRIPT_DIR"

# Step 3: Write flavor file so capacitor.config reads it at runtime
echo -e "${BLUE}📝 Writing electron-flavor.json...${NC}"
# otaAppId is the STORE bundle id (com.zoeedtech.app for the Microsoft Store
# package). ota.ts falls back to app.getName() without it, which never matches an
# OTA target_app_ids, so the app would silently never receive an update.
echo '{"flavor":"zoe","otaAppId":"com.zoeedtech.app"}' > "$SCRIPT_DIR/electron-flavor.json"
echo -e "${GREEN}✅ Flavor file written${NC}"
echo ""

# Step 4: Patch package.json for ZOE branding
echo -e "${BLUE}📝 Patching package.json for ZOE Online School...${NC}"
cp "$SCRIPT_DIR/package.json" "$SCRIPT_DIR/package.json.bak"
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('$SCRIPT_DIR/package.json', 'utf8'));
pkg.name = 'ZOE_Online_School';
pkg.productName = 'ZOE Online School';
pkg.description = 'ZOE Global Online School — AI-Powered Learning Platform';
pkg.author = { name: 'ZOE Global Online School', email: 'support@zoeedtech.com' };
fs.writeFileSync('$SCRIPT_DIR/package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo -e "${GREEN}✅ package.json patched${NC}"
echo ""

# Step 5: Clean previous builds
echo -e "${BLUE}🧹 Cleaning previous builds...${NC}"
rm -rf dist-store
rm -rf build
echo -e "${GREEN}✅ Clean complete${NC}"
echo ""

# Step 6: Ensure dependencies
echo -e "${BLUE}📦 Checking dependencies...${NC}"
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠️  node_modules not found, installing...${NC}"
    npm install
fi
echo -e "${GREEN}✅ Dependencies ready${NC}"
echo ""

# Step 7: Compile Electron main TypeScript
echo -e "${BLUE}📝 Compiling Electron TypeScript...${NC}"
npm run build
echo -e "${GREEN}✅ TypeScript compiled${NC}"
echo ""

# Step 8: Build the AppX with electron-builder (WINDOWS ONLY)
echo -e "${BLUE}🔨 Building Windows Store AppX (x64 + x86)...${NC}"
echo "   Using config: electron-builder.zoe-store.json"
npx electron-builder build --win -c ./electron-builder.zoe-store.json

echo ""
echo -e "${GREEN}✅ Build complete!${NC}"
echo ""

if [ -d "dist-store" ]; then
    echo "AppX packages:"
    ls -lh dist-store/*.appx 2>/dev/null | awk '{print "  📦 " $9 " (" $5 ")"}'
    echo ""
fi

# Restore original package.json (trap also handles failures)
mv "$SCRIPT_DIR/package.json.bak" "$SCRIPT_DIR/package.json"
echo -e "${GREEN}✅ ZOE Online School Store build finished. Upload dist-store/*.appx to Partner Center.${NC}"
