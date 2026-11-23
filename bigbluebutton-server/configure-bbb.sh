#!/bin/bash
# =============================================================
# Post-install BBB configuration for Vacademy
# Run AFTER setup-hetzner.sh completes successfully.
#
# This script makes the BBB server fully NEUTRAL (no BBB branding,
# no Vacademy branding). Per-institute branding is applied at
# meeting creation time via the BBB API (logo, banner, colors).
# =============================================================

set -euo pipefail

echo "Applying BBB white-label configuration..."

# ── 1. Optimize for Hetzner CCX33 (8 cores, 32 GB) ───────────
echo "[1/8] Tuning media workers..."
if [ -f /etc/bigbluebutton/bbb-webrtc-sfu/production.yml ]; then
    CPUS=$(nproc)
    yq e ".mediaWorkers = $CPUS" -i /etc/bigbluebutton/bbb-webrtc-sfu/production.yml 2>/dev/null || true
fi

# ── 1b. Optimize recording quality (frame rate & resolution) ──
echo "[1b/8] Tuning recording output quality..."
PRESENTATION_YML="/usr/local/bigbluebutton/core/scripts/presentation.yml"
if [ -f "$PRESENTATION_YML" ]; then
    # Deskshare (screen share) recording: 15 fps @ 480p
    yq e '.deskshare_output_framerate = 15' -i "$PRESENTATION_YML" 2>/dev/null || true
    yq e '.deskshare_output_width = 854'    -i "$PRESENTATION_YML" 2>/dev/null || true
    yq e '.deskshare_output_height = 480'   -i "$PRESENTATION_YML" 2>/dev/null || true

    # Webcam/video recording: 20 fps @ 480p
    yq e '.video_output_framerate = 20'     -i "$PRESENTATION_YML" 2>/dev/null || true
    yq e '.video_output_width = 854'        -i "$PRESENTATION_YML" 2>/dev/null || true
    yq e '.video_output_height = 480'       -i "$PRESENTATION_YML" 2>/dev/null || true
fi

# ── 2. Recording & server settings ────────────────────────────
echo "[2/8] Configuring recording defaults & server branding..."
# NOTE: /etc/bigbluebutton/bbb-web.properties is the override file.
# BBB merges it on top of the package defaults in
# /usr/share/bbb-web/WEB-INF/classes/bigbluebutton.properties
cat > /etc/bigbluebutton/bbb-web.properties <<'EOF'
# === Recording ===
disableRecordingDefault=false
autoStartRecording=false
allowStartStopRecording=true
learningDashboardEnabled=true

# === Analytics: retain event data so analytics callback fires after meeting ends ===
keepEvents=true

# === White-label: neutral defaults ===
# Empty welcome message — per-meeting welcome is set via API
defaultWelcomeMessage=Welcome! Your session will begin shortly.
defaultWelcomeMessageFooter=

# Default layout: video focus (no presentation by default)
defaultMeetingLayout=VIDEO_FOCUS

# Hide BBB version from API responses
allowRevealOfBBBVersion=false

# Disable default logo — per-meeting logo is set via API create param
useDefaultLogo=false
useDefaultDarkLogo=false
EOF

# ── 3. Blank default presentation (replaces BBB welcome slide) ─
echo "[3/8] Creating blank default presentation..."
BLANK_PDF="/var/bigbluebutton/default.pdf"
if command -v python3 &>/dev/null; then
    python3 -c "
# Minimal valid PDF with a blank white 16:9 page
pdf = b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 960 540]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<</Root 1 0 R/Size 4>>\nstartxref\n190\n%%EOF'
with open('$BLANK_PDF', 'wb') as f:
    f.write(pdf)
" 2>/dev/null
    chown bigbluebutton:bigbluebutton "$BLANK_PDF" 2>/dev/null || true
    # Also copy to web-accessible location so BBB can fetch it via URL
    cp "$BLANK_PDF" /var/www/bigbluebutton-default/assets/default.pdf
    # Use URL (not file path) — bbb-conf --check validates via curl
    BBB_HOSTNAME=$(grep -oP 'server_name\s+\K[^;]+' /etc/nginx/sites-available/bigbluebutton | head -1)
    echo "beans.presentationService.defaultUploadedPresentation=https://${BBB_HOSTNAME}/default.pdf" >> /etc/bigbluebutton/bbb-web.properties
else
    echo "  WARNING: python3 not found, skipping blank presentation creation"
fi

# ── 4. White-label HTML5 client ───────────────────────────────
echo "[4/8] White-labeling HTML5 client..."

BBB_HTML5_CONFIG="/etc/bigbluebutton/bbb-html5.yml"
if [ ! -f "$BBB_HTML5_CONFIG" ]; then
    echo "public:" > "$BBB_HTML5_CONFIG"
fi

# Neutral tab title and app name (no BBB, no Vacademy)
yq e '.public.app.clientTitle = "Live Class"' -i "$BBB_HTML5_CONFIG" 2>/dev/null || true
yq e '.public.app.appName = "Live Class"' -i "$BBB_HTML5_CONFIG" 2>/dev/null || true

# Remove all BBB branding text
yq e '.public.app.copyright = ""' -i "$BBB_HTML5_CONFIG" 2>/dev/null || true
yq e '.public.app.html5ClientBuild = ""' -i "$BBB_HTML5_CONFIG" 2>/dev/null || true

# Hide help button (points to BBB docs by default)
yq e '.public.app.showHelpButton = false' -i "$BBB_HTML5_CONFIG" 2>/dev/null || true

# Enable branding area so per-meeting logo param is displayed
yq e '.public.app.branding.displayBrandingArea = true' -i "$BBB_HTML5_CONFIG" 2>/dev/null || true

# Default layout
yq e '.public.layout.defaultLayout = "VIDEO_FOCUS"' -i "$BBB_HTML5_CONFIG" 2>/dev/null || true
yq e '.public.presentation.defaultPresentationFile = ""' -i "$BBB_HTML5_CONFIG" 2>/dev/null || true

# ── 5. Neutral favicon ────────────────────────────────────────
echo "[5/8] Setting neutral favicon..."

# Create a simple neutral favicon (small colored square)
FAVICON_DIR="/var/www/bigbluebutton-default/site"
mkdir -p "$FAVICON_DIR"

if command -v python3 &>/dev/null; then
    python3 -c "
import struct
# Minimal 16x16 ICO file — solid white square (brand-neutral)
width, height = 16, 16
pixels = b''
for y in range(height):
    for x in range(width):
        pixels += b'\xff\xff\xff\xff'  # BGRA white
    # No padding needed for 16px at 32bpp
# ICO header
ico = struct.pack('<HHH', 0, 1, 1)  # reserved, type=ico, count=1
# Directory entry: w,h,colors,reserved,planes,bpp,size,offset
bmp_size = 40 + len(pixels)
ico += struct.pack('<BBBBHHII', width, height, 0, 0, 1, 32, bmp_size, 22)
# BMP info header (BITMAPINFOHEADER)
ico += struct.pack('<IiiHHIIiiII', 40, width, height*2, 1, 32, 0, len(pixels), 0, 0, 0, 0)
ico += pixels
with open('$FAVICON_DIR/favicon.ico', 'wb') as f:
    f.write(ico)
" 2>/dev/null
    echo "  Created neutral favicon"
else
    # Fallback: copy a 1x1 pixel favicon
    printf '\x00\x00\x01\x00\x01\x00\x01\x01\x00\x00\x01\x00\x18\x00\x30\x00\x00\x00\x16\x00\x00\x00' > "$FAVICON_DIR/favicon.ico"
fi

# Nginx alias so /favicon.ico serves our custom one
cat > /etc/bigbluebutton/nginx/favicon.nginx <<NGINX
location = /favicon.ico {
    alias $FAVICON_DIR/favicon.ico;
}
NGINX

# ── 6. Neutral landing page ───────────────────────────────────
echo "[6/8] Setting neutral landing page..."
cat > /var/www/bigbluebutton-default/assets/index.html <<'HTML'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Live Class</title>
  <style>
    body {
      margin: 0; display: flex; align-items: center; justify-content: center;
      min-height: 100vh; font-family: -appleb-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f8f9fa; color: #333;
    }
    .container { text-align: center; }
    h1 { font-size: 1.5rem; font-weight: 500; margin-bottom: 0.5rem; }
    p { color: #666; font-size: 0.95rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Live Class Server</h1>
    <p>Please join through your institute's portal.</p>
  </div>
</body>
</html>
HTML

# Fix root location: replace undefined @bbb-fe fallback with standard index.html
sed -i 's|try_files $uri @bbb-fe;|try_files $uri $uri/ /index.html;|' /etc/nginx/sites-available/bigbluebutton 2>/dev/null || true

# Stop Greenlight if running (not needed — meeting creation via backend API)
docker stop greenlight-v3 2>/dev/null && docker update --restart=no greenlight-v3 2>/dev/null || true

# ── 7. Allow iframe embedding ─────────────────────────────────
echo "[7/8] Configuring nginx for iframe embedding..."

# Who may frame which BBB page. A map must live at http level (conf.d); the
# server-level include below only reads its result.
# - Live class pages: any https site. Every white-label learner domain (and any
#   new institute's) works with no per-domain setup. A framing page still needs
#   the learner's own signed join link, so this exposes nothing by itself.
# - Recordings + learning dashboard: our own sites only.
# - Capacitor apps (Android https://localhost, iOS capacitor://localhost), the
#   Electron app and local dev everywhere.
cat > /etc/nginx/conf.d/vacademy-frame-ancestors.conf <<'NGINX'
map $uri $vacademy_frame_ancestors {
    default "'self' https: capacitor://localhost capacitor-electron: http://localhost:*";
    ~^/(playback|presentation|podcast|notes|screenshare|video|learning-analytics-dashboard)(/|$) "'self' https://*.vacademy.io https://localhost capacitor://localhost capacitor-electron: http://localhost:*";
}
NGINX

cat > /etc/bigbluebutton/nginx/iframe-allow.nginx <<'NGINX'
# Allow embedding BBB in frames; allowed parents per path come from
# /etc/nginx/conf.d/vacademy-frame-ancestors.conf.
proxy_hide_header X-Frame-Options;
proxy_hide_header Content-Security-Policy;

add_header Content-Security-Policy "frame-ancestors $vacademy_frame_ancestors;" always;
NGINX

# getJoinUrl turns any valid sessionToken into fresh signed join links (same
# role, incl. MODERATOR). Nothing of ours calls it; block it so a leaked token
# can't be multiplied.
cat > /etc/bigbluebutton/nginx/block-getjoinurl.nginx <<'NGINX'
location = /bigbluebutton/api/getJoinUrl { return 403; }
NGINX

# Remove X-Frame-Options from bbb-html5 nginx so our iframe-allow.nginx
# Content-Security-Policy header takes effect (frame-ancestors replaces X-Frame-Options)
if [ -f /etc/bigbluebutton/nginx/bbb-html5.nginx ]; then
    sed -i '/X-Frame-Options/d' /etc/bigbluebutton/nginx/bbb-html5.nginx 2>/dev/null || true
fi

# ── 8. Cookie SameSite for iframe ─────────────────────────────
# No server-side cookie change. The old step added `proxy_cookie_flags` to
# bbb-html5.nginx, which needs nginx >= 1.19.3 (Ubuntu 22.04 ships 1.18, so
# `nginx -t` would fail) and never touched bbb-web's JSESSIONID anyway.
# Framed classes work because admin_core creates each meeting with
# allowRequestsWithoutSession=true (BbbMeetingManager), so bbb-web authorises
# audio/video/chat/slides by sessionToken without the cookie.
echo "[8/8] Cookies: nothing to do (per-meeting allowRequestsWithoutSession)."

# ── Persist changes across BBB updates ────────────────────────
APPLY_SCRIPT="/etc/bigbluebutton/bbb-conf/apply-config.sh"
if [ ! -f "$APPLY_SCRIPT" ]; then
    mkdir -p "$(dirname "$APPLY_SCRIPT")"
    cat > "$APPLY_SCRIPT" <<'APPLY'
#!/bin/bash
# Re-apply custom branding after BBB package updates.
# This runs automatically on `bbb-conf --restart`.
SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIGURE_SCRIPT="$SCRIPT_DIR/configure-bbb.sh"

# Detect if BBB update overwrote our landing page
if grep -qi "bigbluebutton" /var/www/bigbluebutton-default/assets/index.html 2>/dev/null; then
    echo "[apply-config] BBB update detected — re-applying white-label..."
    if [ -x "$CONFIGURE_SCRIPT" ]; then
        bash "$CONFIGURE_SCRIPT"
    else
        echo "[apply-config] WARN: configure-bbb.sh not found at $CONFIGURE_SCRIPT"
    fi
fi
APPLY
    chmod +x "$APPLY_SCRIPT"
fi

# ── Install Ruby gems required for analytics callback ─────────
echo ""
echo "Installing Ruby gems for BBB analytics callback..."
apt-get install -y ruby-dev libsystemd-dev > /dev/null 2>&1 || true
gem install redis builder nokogiri trollop loofah open4 absolute_time journald-logger journald-native java_properties bbbevents jwt 2>/dev/null || true

# ── Fix events_dir for post_events scripts ─────────────────────
# BBB 3.0 stores events in recording/raw/ not /var/bigbluebutton/events/
# The post_events analytics callback script reads events_dir from bigbluebutton.yml
BBB_YML="/usr/local/bigbluebutton/core/scripts/bigbluebutton.yml"
if [ -f "$BBB_YML" ]; then
    CURRENT_EVENTS_DIR=$(grep 'events_dir:' "$BBB_YML" | awk '{print $2}')
    if [ "$CURRENT_EVENTS_DIR" = "/var/bigbluebutton/events" ]; then
        echo "  Updating events_dir to recording/raw for analytics callback..."
        sed -i 's|events_dir: /var/bigbluebutton/events|events_dir: /var/bigbluebutton/recording/raw|' "$BBB_YML"
    fi
fi

# ── Ensure hostname is set to domain (not IP) ─────────────────
BBB_HOSTNAME=$(grep -oP 'server_name\s+\K[^;]+' /etc/nginx/sites-available/bigbluebutton 2>/dev/null | head -1)
if [ -n "$BBB_HOSTNAME" ]; then
    echo ""
    echo "Setting BBB hostname to $BBB_HOSTNAME..."
    bbb-conf --setip "$BBB_HOSTNAME"
fi

# ── Restart services ──────────────────────────────────────────
echo ""
echo "Restarting BigBlueButton..."
bbb-conf --restart
bbb-conf --check

echo ""
echo "============================================="
echo "  White-label configuration complete!"
echo "============================================="
echo ""
echo "Global settings: NEUTRAL (no branding)"
echo "Per-meeting branding: via API create params"
echo "  - logo, bannerText, bannerColor, copyright"
echo "  - logoutURL, welcome message"
echo "  - Custom CSS via userdata-bbb_custom_style_url on join"
echo ""
echo "Run 'sudo bbb-conf --secret' to get your API credentials."
