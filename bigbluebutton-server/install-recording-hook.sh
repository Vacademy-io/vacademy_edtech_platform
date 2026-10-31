#!/bin/bash
# =============================================================
# Install BBB Recording Upload Hook
# =============================================================
# Run this script on the BBB server to install the post-publish
# hook that uploads recordings to S3 via the Vacademy backend.
#
# Prerequisites:
#   - BBB 3.0 installed and running
#   - ffmpeg installed (for WebM → MP4 conversion)
#   - python3 available (for JSON/XML parsing)
#
# Usage:
#   bash install-recording-hook.sh <BACKEND_URL> <BBB_SECRET>
#
# Example:
#   bash install-recording-hook.sh https://api.vacademy.io 8VhLHf3B2ouubT3nTJlUzD6m69oa8hC32GdWdpuvDU
# =============================================================

set -euo pipefail

BACKEND_URL="${1:?Usage: bash install-recording-hook.sh <BACKEND_URL> <BBB_SECRET> [BBB_DOMAIN] [HEALTH_TOKEN]}"
BBB_SECRET="${2:?Usage: bash install-recording-hook.sh <BACKEND_URL> <BBB_SECRET> [BBB_DOMAIN] [HEALTH_TOKEN]}"
BBB_DOMAIN_ARG="${3:-}"        # Optional: e.g. meet.vacademy.io
HEALTH_TOKEN_ARG="${4:-}"      # Optional: fixed dashboard token from .env

HOOK_DIR="/usr/local/bigbluebutton/core/scripts/post_publish"
HOOK_SCRIPT="$HOOK_DIR/post-publish-s3-upload.sh"
CONF_FILE="/etc/bigbluebutton/vacademy-recording.conf"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_SCRIPT="$SCRIPT_DIR/post-publish-s3-upload.sh"

echo "Installing Vacademy BBB Recording Upload Hook"
echo "============================================="
echo "  Backend URL: $BACKEND_URL"
echo "  Hook dir:    $HOOK_DIR"
echo ""

# ── 1. Install ffmpeg if not present ─────────────────────────
if ! command -v ffmpeg &>/dev/null; then
    echo "[1/10] Installing ffmpeg..."
    apt-get update -qq && apt-get install -y -qq ffmpeg
else
    echo "[1/10] ffmpeg already installed ✓"
fi

# ── 2. Configure BBB to retain raw recordings ────────────────
# Raw recordings contain individual webcam streams per user, which we
# need to extract the presenter-only video. By default BBB deletes
# raw files after publishing — this keeps them.
BBB_YML="/usr/local/bigbluebutton/core/scripts/bigbluebutton.yml"
echo "[2/10] Configuring BBB to retain raw recordings..."
if [ -f "$BBB_YML" ]; then
    if grep -q "^delete_raw_after_publish:" "$BBB_YML"; then
        # Update existing setting
        sed -i 's/^delete_raw_after_publish:.*/delete_raw_after_publish: false/' "$BBB_YML"
        echo "  Updated delete_raw_after_publish: false in $BBB_YML"
    elif grep -q "^#.*delete_raw_after_publish:" "$BBB_YML"; then
        # Uncomment and set
        sed -i 's/^#.*delete_raw_after_publish:.*/delete_raw_after_publish: false/' "$BBB_YML"
        echo "  Uncommented and set delete_raw_after_publish: false in $BBB_YML"
    else
        # Append
        echo "" >> "$BBB_YML"
        echo "# Retain raw recordings for presenter-only video extraction (Vacademy)" >> "$BBB_YML"
        echo "delete_raw_after_publish: false" >> "$BBB_YML"
        echo "  Appended delete_raw_after_publish: false to $BBB_YML"
    fi
else
    echo "  WARN: $BBB_YML not found — BBB may not be installed yet."
    echo "  After installing BBB, add this to $BBB_YML:"
    echo "    delete_raw_after_publish: false"
fi

# ── 3. Create configuration file ─────────────────────────────
echo "[3/10] Writing config to $CONF_FILE..."

# Preserve existing extra vars (dashboard token, domain) across rewrites
PREV_HEALTH_TOKEN=""
PREV_BBB_DOMAIN=""
if [ -f "$CONF_FILE" ]; then
    PREV_HEALTH_TOKEN=$(grep '^HEALTH_DASHBOARD_TOKEN=' "$CONF_FILE" 2>/dev/null | cut -d= -f2 || true)
    PREV_BBB_DOMAIN=$(grep '^BBB_DOMAIN=' "$CONF_FILE" 2>/dev/null | cut -d= -f2 || true)
fi

cat > "$CONF_FILE" <<EOF
# Vacademy BBB Recording Upload Configuration
# Generated on $(date)

# Backend API URL (no trailing slash)
VACADEMY_BACKEND_URL=$BACKEND_URL

# BBB shared secret (must match the secret in the Vacademy DB)
VACADEMY_BBB_SECRET=$BBB_SECRET
EOF

# Re-append preserved vars
[ -n "$PREV_HEALTH_TOKEN" ] && echo "HEALTH_DASHBOARD_TOKEN=$PREV_HEALTH_TOKEN" >> "$CONF_FILE"
[ -n "$PREV_BBB_DOMAIN" ] && echo "BBB_DOMAIN=$PREV_BBB_DOMAIN" >> "$CONF_FILE"

chmod 644 "$CONF_FILE"
echo "  Config written (permissions: 644 — readable by bigbluebutton rap worker)"

# ── 4. Install the post-publish script ────────────────────────
echo "[4/10] Installing post-publish hook..."

# Ensure hook directory exists
mkdir -p "$HOOK_DIR"

# Remove old-named hook files from previous installations
rm -f "$HOOK_DIR/a]_vacademy_s3_upload.sh" "$HOOK_DIR/a]_vacademy_s3_upload.rb"

if [ -f "$SOURCE_SCRIPT" ]; then
    cp "$SOURCE_SCRIPT" "$HOOK_SCRIPT"
else
    echo "  ERROR: Source script not found at $SOURCE_SCRIPT"
    echo "  Please copy post-publish-s3-upload.sh to $HOOK_SCRIPT manually"
    exit 1
fi

chmod +x "$HOOK_SCRIPT"
echo "  Installed: $HOOK_SCRIPT"

# Create Ruby wrapper — BBB's rap-worker only executes .rb files
RUBY_WRAPPER="${HOOK_SCRIPT%.sh}.rb"
cat > "$RUBY_WRAPPER" << 'RUBYSCRIPT'
#!/usr/bin/ruby
# Wrapper to call the Vacademy S3 upload bash script
# BBB rap-worker only runs .rb files in post_publish/

meeting_id = nil
ARGV.each_with_index do |arg, i|
  meeting_id = ARGV[i + 1] if arg == '-m'
end

exit 0 if meeting_id.nil? || meeting_id.empty?

script = File.join(__dir__, File.basename(__FILE__, '.rb') + '.sh')
system("bash", script, meeting_id)
exit $?.exitstatus
RUBYSCRIPT
chmod +x "$RUBY_WRAPPER"
echo "  Ruby wrapper: $RUBY_WRAPPER"

# ── 5. Create log file ───────────────────────────────────────
echo "[5/10] Setting up logging..."
LOG_FILE="/var/log/bigbluebutton/vacademy-recording-upload.log"
touch "$LOG_FILE"
chown bigbluebutton:bigbluebutton "$LOG_FILE" 2>/dev/null || true
HEAL_LOG="/var/log/bigbluebutton/vacademy-heal-service.log"
touch "$HEAL_LOG"
chown bigbluebutton:bigbluebutton "$HEAL_LOG" 2>/dev/null || true
DASHBOARD_LOG="/var/log/bigbluebutton/vacademy-health-dashboard.log"
touch "$DASHBOARD_LOG"
chown bigbluebutton:bigbluebutton "$DASHBOARD_LOG" 2>/dev/null || true
echo "  Upload log:     $LOG_FILE"
echo "  Heal log:       $HEAL_LOG"
echo "  Dashboard log:  $DASHBOARD_LOG"

# ── 6. Install BBB heal service ──────────────────────────────
echo "[6/10] Installing BBB heal service (on-demand pipeline recovery)..."
HEAL_PY_SOURCE="$SCRIPT_DIR/bbb-heal-service.py"
HEAL_PY_DEST="/usr/local/bin/bbb-heal-service.py"
HEAL_UNIT_SOURCE="$SCRIPT_DIR/bbb-heal-service.service"
HEAL_UNIT_DEST="/etc/systemd/system/bbb-heal-service.service"

if [ ! -f "$HEAL_PY_SOURCE" ] || [ ! -f "$HEAL_UNIT_SOURCE" ]; then
    echo "  ERROR: Heal service files missing at $HEAL_PY_SOURCE / $HEAL_UNIT_SOURCE"
    exit 1
fi

cp "$HEAL_PY_SOURCE" "$HEAL_PY_DEST"
chmod +x "$HEAL_PY_DEST"
cp "$HEAL_UNIT_SOURCE" "$HEAL_UNIT_DEST"

systemctl daemon-reload
systemctl enable bbb-heal-service.service
systemctl restart bbb-heal-service.service
sleep 1
if systemctl is-active --quiet bbb-heal-service.service; then
    echo "  Heal service running on 127.0.0.1:9091"
else
    echo "  WARN: Heal service failed to start — check: journalctl -u bbb-heal-service -n 50"
fi

# ── 7. Install BBB health dashboard service ─────────────────
echo "[7/10] Installing BBB health dashboard (server monitoring & quick actions)..."
DASH_PY_SOURCE="$SCRIPT_DIR/bbb-health-dashboard.py"
DASH_PY_DEST="/usr/local/bin/bbb-health-dashboard.py"
DASH_UNIT_SOURCE="$SCRIPT_DIR/bbb-health-dashboard.service"
DASH_UNIT_DEST="/etc/systemd/system/bbb-health-dashboard.service"

if [ ! -f "$DASH_PY_SOURCE" ] || [ ! -f "$DASH_UNIT_SOURCE" ]; then
    echo "  SKIP: Health dashboard files not found at $DASH_PY_SOURCE / $DASH_UNIT_SOURCE"
else
    # Set HEALTH_DASHBOARD_TOKEN in conf — prefer argument, then existing, then generate
    CONF_FILE="/etc/bigbluebutton/vacademy-recording.conf"
    if [ -n "$HEALTH_TOKEN_ARG" ]; then
        sed -i '/^HEALTH_DASHBOARD_TOKEN=/d' "$CONF_FILE" 2>/dev/null || true
        echo "HEALTH_DASHBOARD_TOKEN=$HEALTH_TOKEN_ARG" >> "$CONF_FILE"
        echo "  Dashboard token: $HEALTH_TOKEN_ARG (from argument)"
    elif grep -q '^HEALTH_DASHBOARD_TOKEN=' "$CONF_FILE" 2>/dev/null; then
        EXISTING_TOKEN=$(grep '^HEALTH_DASHBOARD_TOKEN=' "$CONF_FILE" | cut -d= -f2)
        echo "  Dashboard token: $EXISTING_TOKEN (existing)"
    else
        GENERATED_TOKEN=$(openssl rand -hex 16)
        echo "HEALTH_DASHBOARD_TOKEN=$GENERATED_TOKEN" >> "$CONF_FILE"
        echo "  Dashboard token: $GENERATED_TOKEN (generated)"
    fi

    # Add or update BBB_DOMAIN in conf
    if [ -n "$BBB_DOMAIN_ARG" ]; then
        # Explicit domain passed as argument — always use it
        sed -i '/^BBB_DOMAIN=/d' "$CONF_FILE" 2>/dev/null || true
        echo "BBB_DOMAIN=$BBB_DOMAIN_ARG" >> "$CONF_FILE"
        echo "  Set BBB_DOMAIN=$BBB_DOMAIN_ARG in conf (from argument)"
    elif ! grep -q '^BBB_DOMAIN=' "$CONF_FILE" 2>/dev/null; then
        # No argument and not in conf — derive from nginx
        BBB_DOMAIN_VAL=$(grep -r 'server_name' /etc/nginx/sites-enabled/ 2>/dev/null | grep -oP 'server_name\s+\K[^;]+' | head -1 | xargs)
        [ -z "$BBB_DOMAIN_VAL" ] && BBB_DOMAIN_VAL=$(bbb-conf --secret 2>/dev/null | grep -oP 'URL:\s+https://\K[^/]+' || echo "meet.vacademy.io")
        echo "BBB_DOMAIN=$BBB_DOMAIN_VAL" >> "$CONF_FILE"
        echo "  Set BBB_DOMAIN=$BBB_DOMAIN_VAL in conf (auto-detected)"
    else
        echo "  BBB_DOMAIN already set: $(grep '^BBB_DOMAIN=' "$CONF_FILE" | cut -d= -f2)"
    fi

    cp "$DASH_PY_SOURCE" "$DASH_PY_DEST"
    chmod +x "$DASH_PY_DEST"
    cp "$DASH_UNIT_SOURCE" "$DASH_UNIT_DEST"

    systemctl daemon-reload
    systemctl enable bbb-health-dashboard.service
    systemctl restart bbb-health-dashboard.service
    sleep 1
    if systemctl is-active --quiet bbb-health-dashboard.service; then
        echo "  Health dashboard running on 127.0.0.1:9092"
    else
        echo "  WARN: Health dashboard failed to start — check: journalctl -u bbb-health-dashboard -n 50"
    fi
fi

# ── 8. Install nginx snippets for services ──────────────────
echo "[8/10] Installing nginx snippets..."

if [ -d "/etc/bigbluebutton/nginx" ]; then
    # Heal service nginx
    NGINX_HEAL_SOURCE="$SCRIPT_DIR/vacademy-heal.nginx"
    NGINX_HEAL_DEST="/etc/bigbluebutton/nginx/vacademy-heal.nginx"
    if [ -f "$NGINX_HEAL_SOURCE" ]; then
        cp "$NGINX_HEAL_SOURCE" "$NGINX_HEAL_DEST"
        echo "  ✓ vacademy-heal.nginx"
    fi

    # Health dashboard nginx
    NGINX_DASH_SOURCE="$SCRIPT_DIR/vacademy-health.nginx"
    NGINX_DASH_DEST="/etc/bigbluebutton/nginx/vacademy-health.nginx"
    if [ -f "$NGINX_DASH_SOURCE" ]; then
        cp "$NGINX_DASH_SOURCE" "$NGINX_DASH_DEST"
        echo "  ✓ vacademy-health.nginx"
    fi

    if nginx -t 2>/dev/null; then
        systemctl reload nginx
        echo "  Nginx reloaded"
        DASH_TOKEN=$(grep '^HEALTH_DASHBOARD_TOKEN=' /etc/bigbluebutton/vacademy-recording.conf 2>/dev/null | cut -d= -f2)
        HOST=$(grep '^BBB_DOMAIN=' /etc/bigbluebutton/vacademy-recording.conf 2>/dev/null | cut -d= -f2)
        [ -z "$HOST" ] && HOST=$(hostname -f 2>/dev/null || echo '<host>')
        echo "  Heal service:     https://$HOST/vacademy-heal/"
        echo "  Health dashboard: https://$HOST/internal/health?token=$DASH_TOKEN"
    else
        echo "  WARN: nginx -t failed, snippets installed but nginx NOT reloaded"
        echo "  Run 'nginx -t' to debug, then 'systemctl reload nginx'"
    fi
else
    echo "  WARN: /etc/bigbluebutton/nginx not found — manual install required"
fi

# ── 8b. HTML5 plugins built in this repo ────────────────────
# Each plugins/<name>/ (built from plugins-src/<name>/) is served at
# https://<host>/plugins/<name>/manifest.json — nginx's root for that path is
# .../assets. Only the directories shipped here are replaced; plugins installed
# by hand (picture-in-picture) are left alone. Swapped in via a temp dir so a
# meeting starting mid-copy never loads half a bundle.
echo "[8b/10] Installing repo HTML5 plugins..."
PLUGINS_SRC="$SCRIPT_DIR/plugins"
PLUGINS_DEST="/var/www/bigbluebutton-default/assets/plugins"
# Every step is checked explicitly: a failed copy (disk full has happened) warns,
# keeps the previous version in place and moves on — it must never abort the
# recording-isolation steps below (set -e is not reliable inside `|| …` lists).
if [ -d "$PLUGINS_SRC" ] && mkdir -p "$PLUGINS_DEST"; then
    for plugin_dir in "$PLUGINS_SRC"/*/; do
        [ -f "$plugin_dir/manifest.json" ] || continue
        name="$(basename "$plugin_dir")"
        new="$PLUGINS_DEST/.$name.new"
        old="$PLUGINS_DEST/.$name.old"
        rm -rf "$new" "$old" 2>/dev/null || true
        if ! { cp -r "$plugin_dir" "$new" && chmod -R a+rX "$new"; }; then
            rm -rf "$new" 2>/dev/null || true
            echo "  WARN: could not stage $name — the previous version stays live"
            continue
        fi
        if [ -d "$PLUGINS_DEST/$name" ] && ! mv "$PLUGINS_DEST/$name" "$old"; then
            rm -rf "$new" 2>/dev/null || true
            echo "  WARN: could not replace $name — the previous version stays live"
            continue
        fi
        if mv "$new" "$PLUGINS_DEST/$name"; then
            rm -rf "$old" 2>/dev/null || true
            echo "  ✓ $name ($(grep -o '"version": *"[^"]*"' "$PLUGINS_DEST/$name/manifest.json" 2>/dev/null | cut -d'"' -f4))"
        else
            [ -d "$old" ] && mv "$old" "$PLUGINS_DEST/$name" 2>/dev/null
            echo "  WARN: could not install $name — the previous version stays live"
        fi
    done
else
    echo "  (no plugins/ directory, or $PLUGINS_DEST not writable — skipped)"
fi

# ── 9. Resource isolation drop-ins + deferred-upload drainer ──
# Three coordinated pieces to keep recording-pipeline ffmpeg out of the
# live-meeting CPU window:
#   (a) Drop-ins lower bbb-rap-resque-worker priority (CPUWeight=10) and
#       raise FreeSWITCH/SFU priority (CPUWeight=1000) so under contention
#       live meetings always win.
#   (b) The post-publish hook (installed in step 4) now QUEUES recordIds
#       to /var/spool/bbb-recording-queue.txt and returns immediately.
#   (c) bbb-recording-drain.timer drains the queue every minute during
#       19:00-20:59 IST (off-peak) and bbb-schedule.sh stop forces a final
#       drain before snapshot.
echo "[9/10] Installing resource-isolation drop-ins and deferred-upload drainer..."

# (a) drop-ins
WORKER_OVERRIDE_DIR="/etc/systemd/system/bbb-rap-resque-worker.service.d"
mkdir -p "$WORKER_OVERRIDE_DIR"
# Remove the legacy COUNT=2 override.conf if it exists — it caused
# bundler LoadError in forked resque children. Kept the explicit cleanup
# from earlier installs so a stale file doesn't merge with our new drop-in.
if [ -f "$WORKER_OVERRIDE_DIR/override.conf" ]; then
    rm -f "$WORKER_OVERRIDE_DIR/override.conf"
    echo "  ✓ removed legacy COUNT=2 override.conf"
fi
cp "$SCRIPT_DIR/systemd/bbb-rap-resque-worker.service.d/lowprio.conf" \
   "$WORKER_OVERRIDE_DIR/lowprio.conf"
echo "  ✓ rap-resque-worker low-priority drop-in"

for svc in freeswitch bbb-webrtc-sfu; do
    SRC="$SCRIPT_DIR/systemd/${svc}.service.d/highprio.conf"
    DEST_DIR="/etc/systemd/system/${svc}.service.d"
    if [ -f "$SRC" ]; then
        mkdir -p "$DEST_DIR"
        cp "$SRC" "$DEST_DIR/highprio.conf"
        echo "  ✓ $svc high-priority drop-in"
    fi
done

# (b) drainer script + spool dir + lock file with explicit ownership
# Both the post-publish hook (run as 'bigbluebutton' by rap-worker) and the
# drainer (run as 'bigbluebutton' by systemd) must be able to append-and-flock
# the queue and lock files. Pre-create both with the correct owner so the
# first writer doesn't accidentally lock out the other.
install -m 755 "$SCRIPT_DIR/bbb-recording-drain.sh" /usr/local/bin/bbb-recording-drain.sh
install -d -m 755 /var/spool
for f in /var/spool/bbb-recording-queue.txt /var/spool/bbb-recording-queue.txt.lock; do
    [ -f "$f" ] || touch "$f"
    chown bigbluebutton:bigbluebutton "$f" 2>/dev/null || true
    chmod 664 "$f"
done
# Marker dir for recordings that have completed S3 upload. Touched by the
# post-publish hook on successful backend registration, read by the health
# dashboard to render "Uploaded" badges in the Recordings tab. Must be owned
# by 'bigbluebutton' since the hook runs as that user; the fallback (root
# ownership at mode 755) would silently break marker writes.
install -d -m 775 -o bigbluebutton -g bigbluebutton /var/spool/bbb-recording-uploaded
echo "  ✓ bbb-recording-drain.sh installed"

# (c) systemd unit + timer
cp "$SCRIPT_DIR/systemd/bbb-recording-drain.service" /etc/systemd/system/
cp "$SCRIPT_DIR/systemd/bbb-recording-drain.timer"   /etc/systemd/system/

# (d) rap-worker auto-tune — flips CPUWeight up/down based on live meeting count
install -m 755 "$SCRIPT_DIR/bbb-rap-autotune.sh" /usr/local/bin/bbb-rap-autotune.sh
cp "$SCRIPT_DIR/systemd/bbb-rap-autotune.service" /etc/systemd/system/
cp "$SCRIPT_DIR/systemd/bbb-rap-autotune.timer"   /etc/systemd/system/
install -m 644 /dev/null /var/log/bigbluebutton/vacademy-rap-autotune.log 2>/dev/null
chown bigbluebutton:bigbluebutton /var/log/bigbluebutton/vacademy-rap-autotune.log 2>/dev/null || true
echo "  ✓ bbb-rap-autotune.sh installed"

# (e) One-time baseline patch to BBB's video.rb — keep original at -threads 2,
# but also keep a known-good backup. The autotune timer flips it to 0 within
# 60s if the box has no live meetings, so initial state doesn't really matter
# — this step exists mainly to (i) take the .autotune-original snapshot and
# (ii) make sure the line we expect to sed is actually there.
VIDEO_RB="/usr/local/bigbluebutton/core/lib/recordandplayback/edl/video.rb"
if [ -f "$VIDEO_RB" ]; then
    if grep -q "'-threads', '[02]'" "$VIDEO_RB"; then
        if [ ! -f "${VIDEO_RB}.autotune-original" ]; then
            cp "$VIDEO_RB" "${VIDEO_RB}.autotune-original"
            echo "  ✓ video.rb backup saved: ${VIDEO_RB}.autotune-original"
        else
            echo "  ✓ video.rb backup already present"
        fi
    else
        echo "  WARN: video.rb has no '-threads' line in the expected form."
        echo "        Autotune will be a no-op for ffmpeg threads. Check the file."
    fi
else
    echo "  WARN: $VIDEO_RB not found — autotune ffmpeg-threads logic will be a no-op."
fi

systemctl daemon-reload
systemctl enable --now bbb-recording-drain.timer
systemctl enable --now bbb-rap-autotune.timer
systemctl start bbb-rap-autotune.service   # fire once immediately so weight is set
systemctl restart bbb-rap-resque-worker 2>/dev/null || true
systemctl restart freeswitch            2>/dev/null || true
systemctl restart bbb-webrtc-sfu        2>/dev/null || true
echo "  ✓ drain + auto-tune timers enabled"

# ── 10. Install daily cleanup cron (recordings older than 4 days) ──
# Ensure any previous stalled-recording hourly cron is removed — we no longer
# auto-rebuild stalled recordings; healing is on-demand via the heal service.
rm -f /etc/cron.hourly/bbb-unstall-recordings 2>/dev/null || true

echo "[10/10] Installing cleanup cron job (recordings older than 4 days)..."
CRON_JOB="0 3 * * * find /var/bigbluebutton/published/presentation/ -maxdepth 1 -mindepth 1 -type d -mtime +4 -exec rm -rf {} + ; find /var/bigbluebutton/recording/raw/ -maxdepth 1 -mindepth 1 -type d -mtime +4 -exec rm -rf {} + ; find /var/bigbluebutton/recording/status/sanity/ -name '*.done' -mtime +4 -delete ; find /var/bigbluebutton/recording/status/archived/ -name '*.done' -mtime +4 -delete ; find /var/bigbluebutton/recording/status/recorded/ -name '*.done' -mtime +4 -delete ; find /var/bigbluebutton/recording/status/processed/ -name '*.done' -mtime +4 -delete ; find /var/bigbluebutton/recording/status/published/ -name '*.done' -mtime +4 -delete"
CRON_MARKER="# vacademy-bbb-cleanup"

# Remove any previous version of this cron entry, then add fresh
( crontab -l 2>/dev/null | grep -v "$CRON_MARKER" ; echo "$CRON_MARKER" ; echo "$CRON_JOB" ) | crontab -
echo "  Daily cleanup cron installed — runs 03:00, deletes recordings older than 4 days"

# ── Done ──────────────────────────────────────────────────────
echo ""
echo "============================================="
echo "  Installation complete!"
echo "============================================="
echo ""
echo "The recording upload hook will run automatically"
echo "after each BBB recording is processed."
echo ""
echo "Deployed components:"
echo "  - Post-publish hook    → $HOOK_SCRIPT"
echo "  - Heal service         → $HEAL_PY_DEST (systemd: bbb-heal-service)"
echo "  - Health dashboard     → /usr/local/bin/bbb-health-dashboard.py (systemd: bbb-health-dashboard)"
echo "  - Nginx proxies        → /vacademy-heal/ (9091), /internal/health (9092)"
echo "  - Daily 4d cleanup     → crontab (03:00)"
echo ""
echo "To test:"
echo "  1. Start a BBB meeting with recording enabled"
echo "  2. Record for a few minutes, then end the meeting"
echo "  3. Wait for BBB to process the recording (~5-15 min)"
echo "  4. Check the log: tail -f $LOG_FILE"
echo ""
echo "To manually heal a stalled recording:"
echo "  curl -X POST -H \"X-BBB-Secret: \$VACADEMY_BBB_SECRET\" \\"
echo "    'https://$(hostname -f 2>/dev/null || echo '<host>')/vacademy-heal/heal?externalMeetingId=<meetingId>'"
echo ""
echo "To uninstall:"
echo "  systemctl disable --now bbb-heal-service"
echo "  rm $HOOK_SCRIPT $RUBY_WRAPPER $HEAL_PY_DEST $HEAL_UNIT_DEST $DASH_PY_DEST $DASH_UNIT_DEST $CONF_FILE"
echo "  rm /etc/bigbluebutton/nginx/vacademy-heal.nginx /etc/bigbluebutton/nginx/vacademy-health.nginx"
echo "  crontab -l | grep -v 'vacademy-bbb-cleanup' | crontab -"
echo "  systemctl daemon-reload && systemctl reload nginx"
echo ""
