#!/usr/bin/env bash
#
# publish-ota.sh — Build, zip, upload, and register a Vacademy Admin OTA bundle.
#
# Mirrors the learner app's self-hosted OTA flow against the same admin-core OTA
# backend. The web bundle is built with the `vacademy-admin` flavor so the JS
# behaves as the admin app, and TARGET_APP_IDS defaults to io.vacademy.admin.app
# so the bundle is ONLY served to the Vacademy Admin app (never the learner /
# Vimotion apps that share the OTA backend).
#
# Required env vars:
#   BACKEND_URL       — Backend base URL (e.g. https://backend-stage.vacademy.io)
#   ADMIN_JWT_TOKEN   — Admin JWT for registering the version
#
# Optional env vars:
#   PLATFORM           — Target platform: ALL (default), ANDROID, IOS
#   MIN_NATIVE_VERSION — Minimum native shell version required (default: 1.0.0)
#   FORCE_UPDATE       — true/false (default: false)
#   TARGET_APP_IDS     — Comma-separated app IDs (default: io.vacademy.admin.app)
#   RELEASE_NOTES      — Release notes text
#   VITE_CAP_FLAVOR    — Build flavor (default: vacademy-admin)
#   OTA_VERSION        — Bundle version to register (default: package.json version)
#
# VERSIONING RULES (both must hold or the bundle is never delivered):
#   1. OTA_VERSION MUST be strictly greater than the native shell versionName /
#      CFBundleShortVersionString (the floor on a fresh install). Native baseline
#      is 1.0.0, so OTA bundles use 1.0.x (1.0.1, 1.0.2, ...). On a store release
#      that bumps the native versionName, resume OTA versions above the new floor.
#   2. OTA `version` is GLOBALLY UNIQUE across every app sharing the OTA backend
#      (register rejects a duplicate version string). Admin uses 1.0.x, learner
#      uses 2.x — keep them distinct.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

export VITE_CAP_FLAVOR="${VITE_CAP_FLAVOR:-vacademy-admin}"

# Evalezy shares package.json (and so its version) with Vacademy Admin, and OTA
# versions are globally unique: an Evalezy bundle must name its own version line.
if [ "$VITE_CAP_FLAVOR" = "evalezy" ] && [ -z "${OTA_VERSION:-}" ]; then
  echo "ERROR: set OTA_VERSION for Evalezy bundles (its own line, e.g. 5.0.1; see EVALEZY_APP.md)." >&2
  exit 1
fi
VERSION="${OTA_VERSION:-$(node -p "require('$APP_DIR/package.json').version")}"
PLATFORM="${PLATFORM:-ALL}"
MIN_NATIVE_VERSION="${MIN_NATIVE_VERSION:-1.0.0}"
FORCE_UPDATE="${FORCE_UPDATE:-false}"
# The default target follows the flavor, so an Evalezy bundle can never be
# published to the Vacademy Admin app (or the other way round) by omission.
case "$VITE_CAP_FLAVOR" in
  evalezy) DEFAULT_TARGET_APP_IDS="io.evalezy.app" ;;
  *) DEFAULT_TARGET_APP_IDS="io.vacademy.admin.app" ;;
esac
TARGET_APP_IDS="${TARGET_APP_IDS:-$DEFAULT_TARGET_APP_IDS}"
RELEASE_NOTES="${RELEASE_NOTES:-}"

if [ -z "${BACKEND_URL:-}" ] || [ -z "${ADMIN_JWT_TOKEN:-}" ]; then
  echo "ERROR: BACKEND_URL and ADMIN_JWT_TOKEN are required." >&2
  exit 1
fi

echo "==> Publishing admin-portal OTA bundle v${VERSION} (flavor=${VITE_CAP_FLAVOR}, platform=${PLATFORM}, targets=${TARGET_APP_IDS})"

# 1. Build (flavored web bundle)
echo "==> Building web assets..."
cd "$APP_DIR"
pnpm run build

# 2. Zip
BUNDLE_NAME="${VITE_CAP_FLAVOR}-bundle-${VERSION}.zip"
echo "==> Creating bundle zip: ${BUNDLE_NAME}"
cd dist
zip -r "../${BUNDLE_NAME}" .
cd "$APP_DIR"

# 3. Checksum
CHECKSUM=$(shasum -a 256 "$BUNDLE_NAME" | awk '{print $1}')
BUNDLE_SIZE=$(stat -f%z "$BUNDLE_NAME" 2>/dev/null || stat --format=%s "$BUNDLE_NAME")
echo "==> Checksum: ${CHECKSUM}"
echo "==> Size: ${BUNDLE_SIZE} bytes"

# 4. Upload to S3 via media_service presigned URL
echo "==> Getting presigned upload URL..."
PRESIGNED_RESPONSE=$(curl -s -X POST \
  "${BACKEND_URL}/media-service/public/get-signed-url" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_JWT_TOKEN}" \
  -d "{
    \"file_name\": \"${BUNDLE_NAME}\",
    \"file_type\": \"application/zip\",
    \"source\": \"OTA_BUNDLE\",
    \"source_id\": \"VACADEMY_ADMIN_APP\"
  }")

UPLOAD_URL=$(echo "$PRESIGNED_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('url',''))" 2>/dev/null)
FILE_ID=$(echo "$PRESIGNED_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)

if [ -z "$UPLOAD_URL" ] || [ -z "$FILE_ID" ]; then
  echo "ERROR: Failed to get presigned URL. Response: $PRESIGNED_RESPONSE" >&2
  exit 1
fi

echo "==> Uploading bundle to S3..."
curl -s -X PUT "$UPLOAD_URL" \
  -H "Content-Type: application/zip" \
  --data-binary "@${BUNDLE_NAME}"

# 5. Get the public download URL
echo "==> Resolving public download URL..."
PUBLIC_URL_RESPONSE=$(curl -s -X GET \
  "${BACKEND_URL}/media-service/public/get-public-url?fileId=${FILE_ID}" \
  -H "Authorization: Bearer ${ADMIN_JWT_TOKEN}")
DOWNLOAD_URL=$(echo "$PUBLIC_URL_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('url', d) if isinstance(d, dict) else d)" 2>/dev/null || echo "$PUBLIC_URL_RESPONSE")

if [ -z "$DOWNLOAD_URL" ]; then
  echo "ERROR: Failed to get public URL." >&2
  exit 1
fi

# 6. Register the version
echo "==> Registering OTA version v${VERSION}..."
REGISTER_BODY=$(cat <<EOF
{
  "version": "${VERSION}",
  "platform": "${PLATFORM}",
  "bundle_file_id": "${FILE_ID}",
  "bundle_download_url": "${DOWNLOAD_URL}",
  "checksum": "${CHECKSUM}",
  "bundle_size_bytes": ${BUNDLE_SIZE},
  "min_native_version": "${MIN_NATIVE_VERSION}",
  "force_update": ${FORCE_UPDATE},
  "target_app_ids": $([ -n "$TARGET_APP_IDS" ] && echo "\"${TARGET_APP_IDS}\"" || echo "null"),
  "release_notes": $([ -n "$RELEASE_NOTES" ] && echo "\"${RELEASE_NOTES}\"" || echo "null")
}
EOF
)

REGISTER_RESPONSE=$(curl -s -X POST \
  "${BACKEND_URL}/admin-core-service/admin/ota/v1/register" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_JWT_TOKEN}" \
  -d "$REGISTER_BODY")

echo "==> Registration response: ${REGISTER_RESPONSE}"

# Cleanup
rm -f "$BUNDLE_NAME"

echo ""
echo "==> Vacademy Admin OTA v${VERSION} published!"
echo "    Platform:           ${PLATFORM}"
echo "    Min native version: ${MIN_NATIVE_VERSION}"
echo "    Force update:       ${FORCE_UPDATE}"
echo "    Target app IDs:     ${TARGET_APP_IDS}"
echo "    Checksum:           ${CHECKSUM}"
