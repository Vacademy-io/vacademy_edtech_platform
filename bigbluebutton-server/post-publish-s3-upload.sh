#!/bin/bash
# =============================================================
# BBB Post-Publish Hook — Upload Recording to S3
# =============================================================
# This script runs on the BBB server AFTER recording processing
# completes. It uploads up to THREE recordings when content is available:
#   A) Content recording (screen share OR camera-as-content + audio)
#   B) Webcams recording (all participants combined + audio)
#   C) Presenter recording (presenter-only webcam, no students)
#
# Content video source priority:
#   1. Deskshare (screen share) — published deskshare/
#   2. Camera-as-content (BBB 3.0) — identified via events.xml
#   3. Presenter webcam (individual stream from raw recordings)
#
# Audio: extracted from published webcams.webm (time-aligned with
# deskshare.webm — both span full recording from t=0).
#
# Steps per recording:
#   1. Find video source
#   2. Combine with mixed audio, convert to MP4
#   3. Get presigned S3 URL from Vacademy backend
#   4. Upload MP4 to S3
#   5. Register recording in Vacademy database (with type tag)
#
# BBB passes the meeting internal ID as the first argument.
#
# Install location:
#   /usr/local/bigbluebutton/core/scripts/post_publish/
#
# Configuration is loaded from:
#   /etc/bigbluebutton/vacademy-recording.conf
# =============================================================

set -uo pipefail
# NOTE: We intentionally do NOT use 'set -e' because we need to handle
# ffmpeg failures gracefully with fallback logic.

# Support two invocation modes to keep ffmpeg out of the live-meeting CPU window:
#   $0 <recordId>             — queue mode (called by BBB rap-worker). Appends the
#                               recordId to the drain queue and exits in <100ms.
#   $0 --drain <recordId>     — drain mode. Runs the actual ffmpeg + S3 upload.
# When QUEUE_MODE=0, we always run inline (legacy behaviour, useful for manual runs).
QUEUE_MODE="${BBB_RECORDING_QUEUE_MODE:-1}"
QUEUE_FILE="/var/spool/bbb-recording-queue.txt"
LOG_FILE="/var/log/bigbluebutton/vacademy-recording-upload.log"

if [ "${1:-}" = "--drain" ]; then
    INTERNAL_MEETING_ID="${2:-}"
elif [ "$QUEUE_MODE" = "1" ]; then
    INTERNAL_MEETING_ID="${1:-}"
    if [ -z "$INTERNAL_MEETING_ID" ]; then
        echo "Usage: $0 <recordId>" >&2
        exit 1
    fi
    # Skip enqueue if this recording is already uploaded — avoids waking up
    # the drainer unnecessarily for duplicate rap-worker pipeline runs.
    # (See full idempotency guard below for force-override semantics.)
    if [ -f "/var/spool/bbb-recording-uploaded/${INTERNAL_MEETING_ID}" ] \
       && [ "${BBB_RECORDING_FORCE:-0}" != "1" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Skip enqueue: $INTERNAL_MEETING_ID already in S3" >> "$LOG_FILE"
        exit 0
    fi
    mkdir -p "$(dirname "$QUEUE_FILE")"
    # flock-protected append so concurrent rap-worker invocations don't garble the file
    (flock 9; echo "$INTERNAL_MEETING_ID" >> "$QUEUE_FILE") 9>>"$QUEUE_FILE.lock"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Queued $INTERNAL_MEETING_ID for deferred upload" >> "$LOG_FILE"
    exit 0
else
    INTERNAL_MEETING_ID="${1:-}"
fi

if [ -z "$INTERNAL_MEETING_ID" ]; then
    echo "Usage: $0 <recordId>  |  $0 --drain <recordId>" >&2
    exit 1
fi

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

# Idempotency guard: if this recording already has its S3 marker, skip the
# whole upload work. Duplicate rap-worker pipeline runs (left over from
# repeated rebuilds) would otherwise re-encode and re-upload the same
# recording every time their captions/process/publish chain replays.
# Set BBB_RECORDING_FORCE=1 to override (e.g. to genuinely re-upload).
UPLOADED_MARKER="/var/spool/bbb-recording-uploaded/${INTERNAL_MEETING_ID}"
# Parts that already reached S3 on an earlier attempt at this recording. The
# real marker is promoted from this file only once every part succeeded, so
# "marker exists" means complete rather than "something uploaded" — PHASE 3.
PARTIAL_MARKER="${UPLOADED_MARKER}.partial"
# How hard to try one S3 PUT before handing the recording back to the drain
# queue, which returns with a freshly signed upload URL.
UPLOAD_ATTEMPTS="${BBB_RECORDING_UPLOAD_ATTEMPTS:-3}"
UPLOAD_RETRY_DELAY="${BBB_RECORDING_UPLOAD_RETRY_DELAY:-10}"
# ...and how many whole-recording retries before we stop, so a part that can
# never upload does not rebuild a 400 MB MP4 on every drain tick forever.
MAX_RECORDING_ATTEMPTS="${BBB_RECORDING_MAX_ATTEMPTS:-5}"

if [ -f "$UPLOADED_MARKER" ] && [ "${BBB_RECORDING_FORCE:-0}" != "1" ]; then
    log "Already uploaded to S3 (marker present) — skipping duplicate post-publish for $INTERNAL_MEETING_ID"
    exit 0
fi
[ "${BBB_RECORDING_FORCE:-0}" = "1" ] && rm -f "$PARTIAL_MARKER" 2>/dev/null

# Did this part already reach S3? Lets a re-queued recording ship only what is
# missing instead of re-encoding and re-uploading what is already there.
part_done() {
    [ -f "$PARTIAL_MARKER" ] && grep -q "^$1=" "$PARTIAL_MARKER" 2>/dev/null
}

log "=========================================="
log "Post-publish started for internal meeting: $INTERNAL_MEETING_ID"

# ── Load configuration ──────────────────────────────────────
CONF_FILE="/etc/bigbluebutton/vacademy-recording.conf"
if [ ! -f "$CONF_FILE" ]; then
    log "ERROR: Config file not found: $CONF_FILE"
    exit 1
fi
source "$CONF_FILE"

BACKEND_URL="${VACADEMY_BACKEND_URL:?Set VACADEMY_BACKEND_URL in $CONF_FILE}"
BBB_SECRET="${VACADEMY_BBB_SECRET:?Set VACADEMY_BBB_SECRET in $CONF_FILE}"

# ── Locate directories ─────────────────────────────────────
PUBLISHED_DIR="/var/bigbluebutton/published/presentation/$INTERNAL_MEETING_ID"
RAW_DIR="/var/bigbluebutton/recording/raw/$INTERNAL_MEETING_ID"

if [ ! -d "$PUBLISHED_DIR" ]; then
    log "ERROR: Published directory not found: $PUBLISHED_DIR"
    exit 1
fi

log "Published dir: $PUBLISHED_DIR"
log "Raw dir: $RAW_DIR"

# ── Extract external meeting ID from metadata ────────────────
METADATA_FILE="$PUBLISHED_DIR/metadata.xml"
MEETING_ID="$INTERNAL_MEETING_ID"
if [ -f "$METADATA_FILE" ]; then
    EID=$(MFILE="$METADATA_FILE" python3 -c "
import xml.etree.ElementTree as ET, os
tree = ET.parse(os.environ['MFILE'])
root = tree.getroot()
mid = root.find('.//meetingId')
if mid is not None and mid.text: print(mid.text)
" 2>/dev/null || echo "")
    if [ -n "$EID" ]; then
        MEETING_ID="$EID"
        log "Resolved external meeting ID: $MEETING_ID"
    else
        log "WARN: Could not extract external meeting ID from metadata, using internal ID"
    fi
else
    log "WARN: metadata.xml not found, using internal meeting ID"
fi

# ── Extract recording start time (used by all uploads) ─────
START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
if [ -f "$METADATA_FILE" ]; then
    START_EPOCH=$(MFILE="$METADATA_FILE" python3 -c "
import xml.etree.ElementTree as ET, datetime, os
tree = ET.parse(os.environ['MFILE'])
root = tree.getroot()
st = root.find('.//start_time')
if st is not None and st.text:
    print(datetime.datetime.utcfromtimestamp(int(st.text)/1000).strftime('%Y-%m-%dT%H:%M:%SZ'))
" 2>/dev/null || echo "")
    if [ -n "$START_EPOCH" ]; then
        START_TIME="$START_EPOCH"
    fi
fi

# ── Helper: find published webcams file (used as audio source) ─
# BBB's published webcams.webm and deskshare.webm are already
# time-aligned (both span full recording duration from t=0).
# Using webcams.webm as audio source avoids all sync issues
# vs raw FreeSWITCH audio which has different timestamps.
find_webcams_audio_source() {
    for candidate in \
        "$PUBLISHED_DIR/video/webcams.webm" \
        "$PUBLISHED_DIR/video/webcams.mp4"; do
        if [ -f "$candidate" ]; then
            echo "$candidate"
            return
        fi
    done
    echo ""
}

# ── Helper: build MP4 from video + optional audio source ──────
# Usage: build_mp4 <video_source> <audio_source> <output_mp4>
# audio_source: file to extract audio from (e.g. webcams.webm). Empty = use video's own audio.
# When audio_source is provided, both files must share the same timeline (published BBB files do).
build_mp4() {
    local video_src="$1"
    local audio_src="$2"
    local output="$3"

    if [ ! -f "$video_src" ]; then
        log "ERROR: Video source not found: $video_src"
        return 1
    fi

    if ! command -v ffmpeg &>/dev/null; then
        if [[ "$video_src" == *.mp4 ]]; then
            cp "$video_src" "$output"
            return 0
        fi
        log "WARN: ffmpeg not installed — cannot convert"
        return 1
    fi

    # Common encoding settings: 480p, ultrafast for speed, good enough quality.
    # -threads 2 caps total CPU usage so even an accidental run during a live
    # meeting can't saturate all cores (the cgroup CPUWeight on the rap-worker
    # service is the hard guarantee, this is defence in depth).
    local THREADS="-threads 2 -filter_threads 1"
    local VFILTER="-vf scale=-2:480"
    local VCODEC="-c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p"
    local ACODEC="-c:a aac -b:a 128k"
    local FLAGS="-movflags +faststart"

    if [ -n "$audio_src" ] && [ -f "$audio_src" ]; then
        # Both published files (deskshare.webm + webcams.webm) share the same
        # timeline from t=0, so no offset/sync calculation is needed.
        log "Merging video from $video_src + audio from $audio_src"

        # shellcheck disable=SC2086
        ffmpeg -y \
            $THREADS \
            -i "$video_src" \
            -i "$audio_src" \
            $VFILTER $VCODEC $ACODEC \
            -map 0:v:0 -map 1:a:0 \
            -shortest \
            $FLAGS \
            "$output" >> "$LOG_FILE" 2>&1

        if [ $? -ne 0 ]; then
            log "WARN: ffmpeg merge failed — trying video-only"
            # shellcheck disable=SC2086
            ffmpeg -y \
                $THREADS \
                -i "$video_src" \
                $VFILTER $VCODEC $ACODEC \
                $FLAGS \
                "$output" >> "$LOG_FILE" 2>&1
        fi
    else
        # No separate audio source — convert video with its own audio track
        # shellcheck disable=SC2086
        ffmpeg -y \
            $THREADS \
            -i "$video_src" \
            $VFILTER $VCODEC $ACODEC \
            $FLAGS \
            "$output" >> "$LOG_FILE" 2>&1
    fi

    [ -f "$output" ]
}

# ── Helper: upload a recording to S3 and register in backend ──
# Usage: upload_recording <mp4_file> <file_name> <recording_type>
# recording_type: "content", "webcams", or "full"
upload_recording() {
    local mp4_file="$1"
    local file_name="$2"
    local rec_type="$3"

    if [ ! -f "$mp4_file" ]; then
        log "ERROR: Cannot upload — file not found: $mp4_file"
        return 1
    fi

    local file_type="video/mp4"
    if [[ "$mp4_file" == *.webm ]]; then
        file_type="video/webm"
    fi
    local file_size
    file_size=$(stat -c%s "$mp4_file" 2>/dev/null || stat -f%z "$mp4_file")

    local duration_seconds=0
    if command -v ffprobe &>/dev/null; then
        duration_seconds=$(ffprobe -v error -show_entries format=duration \
            -of default=noprint_wrappers=1:nokey=1 "$mp4_file" 2>/dev/null | cut -d. -f1 || echo "0")
    fi

    local recording_id="${MEETING_ID}-${rec_type}"

    log "[$rec_type] File: $file_name, Size: $file_size bytes, Duration: ${duration_seconds}s"

    # Step 1: Get presigned upload URL
    log "[$rec_type] Requesting presigned upload URL..."
    local init_response http_code init_body
    init_response=$(curl -s -w "\n%{http_code}" -X POST \
        "${BACKEND_URL}/admin-core-service/live-sessions/provider/meeting/recording/init-upload?meetingId=${MEETING_ID}&fileName=${file_name}&fileType=${file_type}" \
        -H "X-BBB-Secret: ${BBB_SECRET}" \
        -H "Content-Type: application/json")

    http_code=$(echo "$init_response" | tail -1)
    init_body=$(echo "$init_response" | sed '$d')

    if [ "$http_code" != "200" ]; then
        log "[$rec_type] ERROR: init-upload failed (HTTP $http_code): $init_body"
        return 1
    fi

    local upload_url file_id
    upload_url=$(echo "$init_body" | python3 -c "import sys,json; print(json.load(sys.stdin)['uploadUrl'])" 2>/dev/null)
    file_id=$(echo "$init_body" | python3 -c "import sys,json; print(json.load(sys.stdin)['fileId'])" 2>/dev/null)

    if [ -z "$upload_url" ] || [ -z "$file_id" ]; then
        log "[$rec_type] ERROR: Failed to parse presigned URL response: $init_body"
        return 1
    fi

    log "[$rec_type] Got presigned URL. FileId: $file_id"

    # Step 2: Upload to S3
    #
    # This used to be one bare curl with no retry and no timeout. A single
    # stalled connection (HTTP 000 after 138 s on a 390 MB body, 2026-10-28)
    # lost the part permanently, because the caller deletes the built MP4 as
    # soon as this returns. Three things changed:
    #   -T streams the file instead of --data-binary reading all 400 MB into
    #     memory, and lets curl rewind cleanly on a retry;
    #   --speed-limit/--speed-time abort a stalled transfer instead of hanging
    #     until something upstream cuts it with no HTTP status at all;
    #   the loop retries, and if every attempt fails the caller now reports the
    #     recording as incomplete so the drain re-queues it with a fresh URL.
    # Expect: is suppressed to keep the request shape identical to the old one.
    log "[$rec_type] Uploading to S3 ($(du -h "$mp4_file" | cut -f1))..."
    local upload_http_code attempt=0
    while :; do
        attempt=$((attempt + 1))
        upload_http_code=$(curl -s -o /dev/null -w "%{http_code}" \
            --connect-timeout 30 \
            --speed-limit 10240 --speed-time 120 \
            -H "Content-Type: ${file_type}" \
            -H "Expect:" \
            -T "${mp4_file}" \
            "$upload_url")

        if [ "$upload_http_code" = "200" ] || [ "$upload_http_code" = "204" ]; then
            break
        fi

        if [ "$attempt" -ge "$UPLOAD_ATTEMPTS" ]; then
            log "[$rec_type] ERROR: S3 upload failed (HTTP $upload_http_code) after $attempt attempt(s)"
            return 1
        fi
        log "[$rec_type] WARN: S3 upload attempt $attempt failed (HTTP $upload_http_code) — retrying in ${UPLOAD_RETRY_DELAY}s"
        sleep "$UPLOAD_RETRY_DELAY"
    done

    log "[$rec_type] S3 upload complete (HTTP $upload_http_code, attempt $attempt)"

    # Step 3: Register in backend
    log "[$rec_type] Registering recording in backend..."
    local complete_response complete_code complete_body
    complete_response=$(curl -s -w "\n%{http_code}" -X POST \
        "${BACKEND_URL}/admin-core-service/live-sessions/provider/meeting/recording/complete" \
        -H "X-BBB-Secret: ${BBB_SECRET}" \
        -H "Content-Type: application/json" \
        -d "{
            \"meetingId\": \"${MEETING_ID}\",
            \"internalMeetingId\": \"${INTERNAL_MEETING_ID}\",
            \"fileId\": \"${file_id}\",
            \"recordingId\": \"${recording_id}\",
            \"type\": \"${rec_type}\",
            \"durationSeconds\": ${duration_seconds},
            \"startTime\": \"${START_TIME}\"
        }")

    complete_code=$(echo "$complete_response" | tail -1)
    complete_body=$(echo "$complete_response" | sed '$d')

    if [ "$complete_code" != "200" ]; then
        log "[$rec_type] WARN: Registration returned HTTP $complete_code: $complete_body"
    else
        log "[$rec_type] Recording registered successfully"
        # Record "type=fileId" so the health dashboard can surface the S3 file
        # id, and so a retry of this recording knows to skip this part. These
        # lines go to the staging file: PHASE 3 promotes it to the real marker
        # only when the whole recording made it, because every pending check on
        # this box treats the marker as "this recording is in S3".
        mkdir -p /var/spool/bbb-recording-uploaded 2>/dev/null
        if ! printf '%s=%s\n' "$rec_type" "$file_id" >> "$PARTIAL_MARKER" 2>/dev/null; then
            touch "$PARTIAL_MARKER" 2>/dev/null || true
        fi
    fi

    return 0
}

# ══════════════════════════════════════════════════════════════
# PHASE 1: Find the CONTENT video source
# ══════════════════════════════════════════════════════════════
# Priority:
#   1. Published/raw deskshare (screen share)
#   2. Camera-as-content (BBB 3.0 — identified via events.xml)
#   3. Presenter webcam from raw recordings
# ══════════════════════════════════════════════════════════════

CONTENT_VIDEO=""
CONTENT_IS_PUBLISHED=false   # true = time-aligned with webcams.webm, safe to merge audio

# ── Priority 1: Check for published deskshare (screen share) ──
for candidate in \
    "$PUBLISHED_DIR/deskshare/deskshare.webm" \
    "$PUBLISHED_DIR/deskshare/deskshare.mp4"; do
    if [ -f "$candidate" ]; then
        FSIZE=$(stat -c%s "$candidate" 2>/dev/null || stat -f%z "$candidate")
        if [ "$FSIZE" -gt 50000 ] 2>/dev/null; then
            CONTENT_VIDEO="$candidate"
            CONTENT_IS_PUBLISHED=true
            log "Found published deskshare: $candidate ($(du -h "$candidate" | cut -f1))"
            break
        else
            log "Skipping tiny deskshare file: $candidate (${FSIZE} bytes)"
        fi
    fi
done

# ── Priority 2: Camera-as-content (BBB 3.0) ─────────────────
# "Share camera as content" stores the stream in video/<meetingId>/
# alongside regular webcams. We identify it via screenshare-related
# events in events.xml that reference a stream/filename.
if [ -z "$CONTENT_VIDEO" ] && [ -d "$RAW_DIR" ] && [ -f "$RAW_DIR/events.xml" ]; then
    log "No deskshare found — checking for camera-as-content in events.xml"

    CAC_INFO=$(EVENTS_FILE="$RAW_DIR/events.xml" RAW_DIR="$RAW_DIR" INTERNAL_ID="$INTERNAL_MEETING_ID" python3 << 'PYEOF'
import xml.etree.ElementTree as ET
import os, glob

events_file = os.environ['EVENTS_FILE']
raw_dir = os.environ['RAW_DIR']
internal_id = os.environ['INTERNAL_ID']
tree = ET.parse(events_file)
root = tree.getroot()

# Collect all screenshare/camera-as-content related streams
# BBB 3.0 uses various event names — check all known variants
cac_events = [
    'ScreenshareRtcStartedEvent',
    'DeskShareStartedEvent',
    'DeskshareStartedEvent',
    'StartDeskShareEvent',
    'SetScreenshareAsContentEvent',
    'StartScreenshareAsContentEvent',
    'ShareCameraAsContentEvent',
]

cac_streams = []
for event in root.findall(".//event"):
    ename = event.get('eventname', '')
    if ename not in cac_events:
        continue

    # Try to extract stream/filename from the event
    for field in ['stream', 'filename', 'file', 'streamPath']:
        el = event.find(field)
        if el is not None and el.text and el.text.strip():
            cac_streams.append(el.text.strip())

# Also check for StartWebRTCShareEvent with contentType indicating screenshare
for event in root.findall(".//event[@eventname='StartWebRTCShareEvent']"):
    ct = event.find('contentType')
    if ct is not None and ct.text and 'screen' in ct.text.lower():
        fname = event.find('filename')
        if fname is not None and fname.text:
            cac_streams.append(fname.text.strip())

# Check for ShareStartedEvent with screenshare indication
for event in root.findall(".//event"):
    ename = event.get('eventname', '')
    if 'share' in ename.lower() and 'screen' in ename.lower():
        for field in ['stream', 'filename', 'file']:
            el = event.find(field)
            if el is not None and el.text and el.text.strip():
                cac_streams.append(el.text.strip())

if not cac_streams:
    # Fallback: check if there's a video file in deskshare-like directories
    # BBB 3.0 might store camera-as-content in video/<meetingId>/
    video_mid_dir = os.path.join(raw_dir, 'video', internal_id)
    if os.path.isdir(video_mid_dir):
        # If there are video files here, they might be camera-as-content
        # We can't distinguish without events, so report them for logging
        files = [f for f in os.listdir(video_mid_dir) if f.endswith(('.webm', '.mp4'))]
        if files:
            print(f"VIDEO_DIR_FILES|{video_mid_dir}|{','.join(files)}")
            exit(0)
    print("NO_CAC")
    exit(0)

# Resolve streams to actual files
search_dirs = [
    os.path.join(raw_dir, 'video', internal_id),
    os.path.join(raw_dir, 'video'),
    os.path.join(raw_dir, 'deskshare'),
    raw_dir,
]

found = set()
for stream in cac_streams:
    for d in search_dirs:
        if not os.path.isdir(d):
            continue
        # Try exact path
        if os.path.isfile(stream):
            if os.path.getsize(stream) > 50000:
                found.add(stream)
            continue
        # Try basename in directory
        basename = os.path.basename(stream)
        for ext in ['', '.webm', '.mp4']:
            candidate = os.path.join(d, basename + ext)
            if os.path.isfile(candidate) and os.path.getsize(candidate) > 50000:
                found.add(candidate)
        # Glob match
        for match in glob.glob(os.path.join(d, f'*{basename}*')):
            if os.path.isfile(match) and os.path.getsize(match) > 50000:
                found.add(match)

if found:
    best = max(found, key=os.path.getsize)
    print(f"CAC|{best}")
else:
    print(f"NO_CAC_FILE|streams={','.join(cac_streams)}")
PYEOF
    )

    log "Camera-as-content detection result: $CAC_INFO"

    if [[ "$CAC_INFO" == CAC\|* ]]; then
        CONTENT_VIDEO="${CAC_INFO#CAC|}"
        log "Found camera-as-content video: $CONTENT_VIDEO ($(du -h "$CONTENT_VIDEO" | cut -f1))"
    elif [[ "$CAC_INFO" == VIDEO_DIR_FILES\|* ]]; then
        # Found files in video/<meetingId>/ but no events to confirm camera-as-content
        # Log for debugging, don't use as content (could be regular webcams)
        log "Found video files in raw/video/$INTERNAL_MEETING_ID/ but no CAC events — will check presenter webcam next"
    elif [[ "$CAC_INFO" == NO_CAC_FILE\|* ]]; then
        log "WARN: Found CAC events in events.xml but could not locate files on disk"
    fi
fi

# ── Presenter webcam extraction (always runs — feeds both content fallback + presenter-only upload) ──
PRESENTER_BEST_VIDEO=""
if [ -d "$RAW_DIR" ] && [ -f "$RAW_DIR/events.xml" ]; then
    log "Extracting presenter webcam info from raw recordings"

    PRESENTER_INFO=$(EVENTS_FILE="$RAW_DIR/events.xml" python3 << 'PYEOF'
import xml.etree.ElementTree as ET
import os

events_file = os.environ['EVENTS_FILE']
raw_dir = os.path.dirname(events_file)
tree = ET.parse(events_file)
root = tree.getroot()

# 1. Find all presenter assignments (ordered by timestamp)
presenters = []
for event in root.findall(".//event[@eventname='AssignPresenterEvent']"):
    userid = event.find('userid')
    if userid is None:
        userid = event.find('userId')
    name = event.find('name')
    ts = event.get('timestamp', '0')
    if userid is not None and userid.text:
        presenters.append({
            'timestamp': int(ts),
            'userId': userid.text,
            'name': name.text if name is not None else 'unknown'
        })

if not presenters:
    print("NO_PRESENTER")
    exit(0)

presenters.sort(key=lambda p: p['timestamp'])

# Deduplicate
seen = set()
unique_presenters = []
for p in presenters:
    if p['userId'] not in seen:
        seen.add(p['userId'])
        unique_presenters.append(p)

# 2. Build userId -> webcam filename mapping from events
webcam_by_user = {}
for event in root.findall(".//event"):
    ename = event.get('eventname', '')
    if ename in ('StartWebRTCShareEvent', 'StartWebcamShareEvent'):
        # Skip screenshare streams (camera-as-content)
        ct = event.find('contentType')
        if ct is not None and ct.text and 'screen' in ct.text.lower():
            continue
        uid_el = event.find('userId')
        if uid_el is None:
            uid_el = event.find('userid')
        fname_el = event.find('filename')
        if uid_el is not None and uid_el.text and fname_el is not None and fname_el.text:
            webcam_by_user.setdefault(uid_el.text, []).append(fname_el.text)

# 3. Also scan raw/video/ directory for userId-matching files as fallback
video_dir = os.path.join(raw_dir, 'video')
if os.path.isdir(video_dir):
    for f in sorted(os.listdir(video_dir)):
        if f.endswith('.webm'):
            for p in unique_presenters:
                if p['userId'] in f:
                    webcam_by_user.setdefault(p['userId'], []).append(
                        os.path.join(video_dir, f))

# 4. Resolve actual file paths
def resolve_file(wf):
    if os.path.isfile(wf):
        return wf
    basename = os.path.basename(wf)
    archived = os.path.join(raw_dir, 'video', basename)
    if os.path.isfile(archived):
        return archived
    return None

found_names = []
found_files = []
seen_files = set()

for p in unique_presenters:
    files = webcam_by_user.get(p['userId'], [])
    for wf in files:
        resolved = resolve_file(wf)
        if resolved and resolved not in seen_files:
            seen_files.add(resolved)
            found_files.append(resolved)
            if p['name'] not in found_names:
                found_names.append(p['name'])

if not found_files:
    print("NO_WEBCAM")
    exit(0)

print(f"PRESENTER|{','.join(found_names)}|{','.join(found_files)}")
PYEOF
    )

    log "Presenter extraction result: $PRESENTER_INFO"

    if [[ "$PRESENTER_INFO" == PRESENTER\|* ]]; then
        IFS='|' read -r _ PRESENTER_NAMES PRESENTER_FILES <<< "$PRESENTER_INFO"
        log "Found presenter(s): $PRESENTER_NAMES"
        log "Presenter webcam file(s): $PRESENTER_FILES"

        IFS=',' read -ra PRESENTER_VIDEO_ARRAY <<< "$PRESENTER_FILES"
        PRESENTER_BEST_VIDEO="${PRESENTER_VIDEO_ARRAY[0]}"

        # Pick longest segment if multiple
        if [ ${#PRESENTER_VIDEO_ARRAY[@]} -gt 1 ] && command -v ffprobe &>/dev/null; then
            log "Multiple presenter segments (${#PRESENTER_VIDEO_ARRAY[@]}) — picking longest..."
            BEST_FILE=""
            BEST_DUR=0
            for seg in "${PRESENTER_VIDEO_ARRAY[@]}"; do
                if [ -f "$seg" ]; then
                    SEG_DUR=$(ffprobe -v error -show_entries format=duration \
                        -of default=noprint_wrappers=1:nokey=1 "$seg" 2>/dev/null || echo "0")
                    SEG_DUR_INT=$(echo "$SEG_DUR" | cut -d. -f1)
                    SEG_DUR_INT=${SEG_DUR_INT:-0}
                    log "  segment: $seg (${SEG_DUR}s)"
                    if [ "$SEG_DUR_INT" -gt "$BEST_DUR" ] 2>/dev/null; then
                        BEST_DUR=$SEG_DUR_INT
                        BEST_FILE="$seg"
                    fi
                fi
            done
            if [ -n "$BEST_FILE" ]; then
                PRESENTER_BEST_VIDEO="$BEST_FILE"
                log "Selected longest presenter segment: $PRESENTER_BEST_VIDEO (${BEST_DUR}s)"
            fi
        fi

        # Use presenter webcam as content source only if no deskshare/CAC was found
        if [ -z "$CONTENT_VIDEO" ]; then
            CONTENT_VIDEO="$PRESENTER_BEST_VIDEO"
            log "Using presenter webcam as content source (no deskshare/CAC available)"
        fi
    elif [[ "$PRESENTER_INFO" == "NO_PRESENTER" ]]; then
        log "WARN: No presenter assignment found in events.xml"
    elif [[ "$PRESENTER_INFO" == "NO_WEBCAM" ]]; then
        log "WARN: Presenter found but no webcam file"
    fi
elif [ -z "$CONTENT_VIDEO" ]; then
    log "WARN: Raw recording directory not found — no content video available"
fi

# ── Find audio source for content recording ──────────────────
# Only use webcams.webm as audio when content is from published dir
# (published deskshare.webm and webcams.webm are time-aligned from t=0).
# Raw files have different timelines — merging would cause sync issues.
WEBCAMS_AUDIO=""
if [ "$CONTENT_IS_PUBLISHED" = true ]; then
    WEBCAMS_AUDIO=$(find_webcams_audio_source)
    if [ -n "$WEBCAMS_AUDIO" ]; then
        log "Audio source for content: $WEBCAMS_AUDIO (time-aligned, no offset needed)"
    else
        log "WARN: No published webcams file found for audio"
    fi
else
    log "Content is from raw recording — skipping audio merge (would cause sync issues)"
fi

# ══════════════════════════════════════════════════════════════
# PHASE 2: Build MP4 files and upload
# ══════════════════════════════════════════════════════════════

UPLOAD_COUNT=0
FAILED_PARTS=0        # parts whose upload failed — the recording is incomplete
CONTENT_ATTEMPTED=0   # a content video exists, so webcams is NOT the whole class
CONTENT_FAILED=0      # ...and it did not reach S3

mkdir -p /var/spool/bbb-recording-uploaded 2>/dev/null
RECORDING_ATTEMPT=1
if [ -f "$PARTIAL_MARKER" ]; then
    RECORDING_ATTEMPT=$(( $(grep -c '^attempt=' "$PARTIAL_MARKER" 2>/dev/null || echo 0) + 1 ))
fi
printf 'attempt=%s\n' "$RECORDING_ATTEMPT" >> "$PARTIAL_MARKER" 2>/dev/null || true
[ "$RECORDING_ATTEMPT" -gt 1 ] && log "Retry $RECORDING_ATTEMPT/$MAX_RECORDING_ATTEMPTS for $INTERNAL_MEETING_ID — only missing parts will be rebuilt"

[ -n "$CONTENT_VIDEO" ] && CONTENT_ATTEMPTED=1

# ── Recording A: Content (screen share / camera-as-content / presenter) ──
if [ -n "$CONTENT_VIDEO" ] && ! part_done content; then
    MP4_CONTENT="/tmp/vacademy-recording-${MEETING_ID}-content.mp4"
    log "Building content recording from: $CONTENT_VIDEO"

    if build_mp4 "$CONTENT_VIDEO" "$WEBCAMS_AUDIO" "$MP4_CONTENT"; then
        log "Content MP4 created: $(du -h "$MP4_CONTENT" | cut -f1)"

        FILE_NAME_CONTENT="recording-${MEETING_ID}-content.mp4"
        if upload_recording "$MP4_CONTENT" "$FILE_NAME_CONTENT" "content"; then
            UPLOAD_COUNT=$((UPLOAD_COUNT + 1))
        else
            FAILED_PARTS=$((FAILED_PARTS + 1))
            CONTENT_FAILED=1
        fi

        # Cleanup
        if [[ "$MP4_CONTENT" == /tmp/* ]] && [ -f "$MP4_CONTENT" ]; then
            rm -f "$MP4_CONTENT"
            log "Cleaned up: $MP4_CONTENT"
        fi
    else
        log "ERROR: Failed to build content MP4"
        # A build failure is deterministic (bad source), so it is NOT counted as
        # a failed upload — retrying would rebuild and fail again every tick.
        # It still means the screen share is missing, which the webcams branch
        # below needs to know so it does not call itself the full recording.
        CONTENT_FAILED=1
    fi
elif [ -n "$CONTENT_VIDEO" ]; then
    log "[content] already in S3 from an earlier attempt — not rebuilding"
    UPLOAD_COUNT=$((UPLOAD_COUNT + 1))
else
    log "No content video source found — skipping content recording"
fi

# ── Recording B: Webcams (all participants combined) ─────────
WEBCAMS_SOURCE=""
for candidate in \
    "$PUBLISHED_DIR/video/webcams.webm" \
    "$PUBLISHED_DIR/video/webcams.mp4"; do
    if [ -f "$candidate" ]; then
        WEBCAMS_SOURCE="$candidate"
        break
    fi
done

if [ -n "$WEBCAMS_SOURCE" ] && ! part_done webcams && ! part_done full; then
    MP4_WEBCAMS="/tmp/vacademy-recording-${MEETING_ID}-webcams.mp4"
    log "Building webcams recording from: $WEBCAMS_SOURCE"

    # webcams.webm already has audio mixed in, so no need for separate audio
    if build_mp4 "$WEBCAMS_SOURCE" "" "$MP4_WEBCAMS"; then
        log "Webcams MP4 created: $(du -h "$MP4_WEBCAMS" | cut -f1)"

        # When a class had no screen share, the webcam video genuinely IS the
        # whole recording, so it is tagged "full" for backward compatibility.
        # This used to key off "UPLOAD_COUNT -eq 0", which is also true when the
        # content upload FAILED — so a class whose 70-minute screen share had
        # just been lost got its webcam-only video registered as the complete
        # recording. Decide on whether a content video existed, not on whether
        # anything happened to upload.
        local_type="webcams"
        if [ "$CONTENT_ATTEMPTED" -eq 0 ]; then
            local_type="full"
            log "No content video in this recording — tagging webcams as 'full'"
        elif [ "$CONTENT_FAILED" -eq 1 ]; then
            log "Content did not reach S3 — keeping this as 'webcams', NOT 'full' (the screen share is still missing)"
        fi

        FILE_NAME_WEBCAMS="recording-${MEETING_ID}-webcams.mp4"
        if upload_recording "$MP4_WEBCAMS" "$FILE_NAME_WEBCAMS" "$local_type"; then
            UPLOAD_COUNT=$((UPLOAD_COUNT + 1))
        else
            FAILED_PARTS=$((FAILED_PARTS + 1))
        fi

        # Cleanup
        if [[ "$MP4_WEBCAMS" == /tmp/* ]] && [ -f "$MP4_WEBCAMS" ]; then
            rm -f "$MP4_WEBCAMS"
            log "Cleaned up: $MP4_WEBCAMS"
        fi
    else
        log "ERROR: Failed to build webcams MP4"
    fi
elif [ -n "$WEBCAMS_SOURCE" ]; then
    log "[webcams] already in S3 from an earlier attempt — not rebuilding"
    UPLOAD_COUNT=$((UPLOAD_COUNT + 1))
else
    log "WARN: No published webcams video found"
fi

# ── Recording C: Presenter-only webcam (individual stream, no students) ──
if [ -n "$PRESENTER_BEST_VIDEO" ] && ! part_done presenter; then
    MP4_PRESENTER="/tmp/vacademy-recording-${MEETING_ID}-presenter.mp4"
    log "Building presenter-only recording from: $PRESENTER_BEST_VIDEO"

    # Raw presenter webcam has its own audio track — don't merge with published
    # audio (different timelines would cause sync issues, see line ~598).
    if build_mp4 "$PRESENTER_BEST_VIDEO" "" "$MP4_PRESENTER"; then
        log "Presenter MP4 created: $(du -h "$MP4_PRESENTER" | cut -f1)"

        FILE_NAME_PRESENTER="recording-${MEETING_ID}-presenter.mp4"
        if upload_recording "$MP4_PRESENTER" "$FILE_NAME_PRESENTER" "presenter"; then
            UPLOAD_COUNT=$((UPLOAD_COUNT + 1))
        else
            FAILED_PARTS=$((FAILED_PARTS + 1))
        fi

        # Cleanup
        if [[ "$MP4_PRESENTER" == /tmp/* ]] && [ -f "$MP4_PRESENTER" ]; then
            rm -f "$MP4_PRESENTER"
            log "Cleaned up: $MP4_PRESENTER"
        fi
    else
        log "ERROR: Failed to build presenter MP4"
    fi
elif [ -n "$PRESENTER_BEST_VIDEO" ]; then
    log "[presenter] already in S3 from an earlier attempt — not rebuilding"
    UPLOAD_COUNT=$((UPLOAD_COUNT + 1))
else
    log "No presenter webcam found — skipping presenter-only recording"
fi

# ── Fallback: if there was nothing to upload, try any available video ──
# Only when nothing FAILED. If a part was built and its upload failed, the
# right answer is to let the drain retry it, not to ship a different, worse
# video under the name "full" and call the recording done.
if [ $UPLOAD_COUNT -eq 0 ] && [ $FAILED_PARTS -eq 0 ]; then
    log "No recordings uploaded yet — trying any available video as fallback"

    FALLBACK_VIDEO=""
    for candidate in \
        "$PUBLISHED_DIR/deskshare/deskshare.webm" \
        "$PUBLISHED_DIR/deskshare/deskshare.mp4" \
        "$PUBLISHED_DIR/video/webcams.webm" \
        "$PUBLISHED_DIR/video/webcams.mp4"; do
        if [ -f "$candidate" ]; then
            FALLBACK_VIDEO="$candidate"
            break
        fi
    done

    if [ -n "$FALLBACK_VIDEO" ]; then
        MP4_FALLBACK="/tmp/vacademy-recording-${MEETING_ID}-full.mp4"
        log "Using fallback: $FALLBACK_VIDEO"

        if build_mp4 "$FALLBACK_VIDEO" "" "$MP4_FALLBACK"; then
            FILE_NAME_FALLBACK="recording-${MEETING_ID}.mp4"
            upload_recording "$MP4_FALLBACK" "$FILE_NAME_FALLBACK" "full"

            if [[ "$MP4_FALLBACK" == /tmp/* ]] && [ -f "$MP4_FALLBACK" ]; then
                rm -f "$MP4_FALLBACK"
            fi
        fi
    else
        log "WARN: No video file found at all for meeting $MEETING_ID — nothing to upload"
    fi
fi

# ── Run analytics callback (piggyback on post_publish) ──
ANALYTICS_SCRIPT="/usr/local/bigbluebutton/core/scripts/post_events/post_events_analytics_callback.rb"
if [ -f "$ANALYTICS_SCRIPT" ]; then
    log "Running analytics callback..."
    cd /usr/local/bigbluebutton/core/scripts
    # Must pass INTERNAL_MEETING_ID — the analytics script looks up BBB's internal
    # file paths (events.xml, raw recordings) by internal ID, not external ID.
    ruby "$ANALYTICS_SCRIPT" -m "$INTERNAL_MEETING_ID" 2>&1 | while read line; do log "[analytics] $line"; done
    log "Analytics callback complete"
else
    log "Analytics script not found, skipping"
fi

# ══════════════════════════════════════════════════════════════
# PHASE 3: Publish the marker only if the recording is complete
# ══════════════════════════════════════════════════════════════
# Every pending check on this box asks one question: does
# /var/spool/bbb-recording-uploaded/<id> exist? Writing that file the moment
# any single part registered is what let a class keep its webcam video and
# silently lose its 70-minute screen share while every check still reported
# "0 pending". So the per-part lines are staged in <id>.partial and only
# promoted here, which also means the drain and the nightly sweep keep seeing
# an incomplete recording as pending and retry it with a fresh upload URL.
if [ "$FAILED_PARTS" -gt 0 ] && [ "$RECORDING_ATTEMPT" -lt "$MAX_RECORDING_ATTEMPTS" ]; then
    log "INCOMPLETE (attempt $RECORDING_ATTEMPT/$MAX_RECORDING_ATTEMPTS): $FAILED_PARTS part(s) did not reach S3"
    log "Leaving $INTERNAL_MEETING_ID unmarked so it is picked up again — uploaded $UPLOAD_COUNT so far"
    log "=========================================="
    exit 1
fi

if [ "$FAILED_PARTS" -gt 0 ]; then
    # Out of retries. Mark it so the drain stops rebuilding this MP4 on every
    # tick, but say so loudly: the recording IS short a part, and the parts
    # listed in the marker are the ones that actually made it.
    log "GIVING UP after $RECORDING_ATTEMPT attempts — $FAILED_PARTS part(s) never reached S3"
    log "RECORDING INCOMPLETE IN S3: $INTERNAL_MEETING_ID — compare the marker's parts against the published dir"
fi

if [ -f "$PARTIAL_MARKER" ]; then
    # Strip the attempt bookkeeping so the marker holds only "type=fileId"
    # lines, the format the health dashboard already reads. grep exits 1 when
    # it filters every line out (a recording that gave up with nothing
    # uploaded), so the move must not be gated on grep's status.
    grep -v '^attempt=' "$PARTIAL_MARKER" > "${PARTIAL_MARKER}.tmp" 2>/dev/null
    if mv -f "${PARTIAL_MARKER}.tmp" "$UPLOADED_MARKER" 2>/dev/null; then
        rm -f "$PARTIAL_MARKER" 2>/dev/null
    else
        rm -f "${PARTIAL_MARKER}.tmp" 2>/dev/null
        log "WARN: could not promote $PARTIAL_MARKER to $UPLOADED_MARKER — left for the next run"
    fi
fi

log "Post-publish complete for meeting: $MEETING_ID (uploaded $UPLOAD_COUNT recording(s))"
log "=========================================="
exit 0
