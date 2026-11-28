#!/usr/bin/env bash
# Nightly on the Mumbai box (root cron, 21:30 UTC = 03:00 IST, when no calls run):
#   1. pull yesterday's per-call replay records out of journald,
#   2. re-run every call through the real pipeline (sim.replay) and check the
#      call-agnostic invariants,
#   3. send every sentence the bot said yesterday to the real TTS vendor and
#      flag drones / silence (sim.ttsprobe),
#   4. collect the call-alert lines the reports raised,
# and leave one summary file per day under /var/lib/voice-bot-replays/.
# Install:  cp deploy/linode-mumbai/nightly-replay.sh /opt/voice-bot/ && chmod +x /opt/voice-bot/nightly-replay.sh
#           (crontab -l; echo '30 21 * * * /opt/voice-bot/nightly-replay.sh >> /var/log/voice-bot-nightly.log 2>&1') | crontab -
set -u
cd /opt/voice-bot || exit 1
DAY=${1:-$(date -u -d 'yesterday' +%F)}
OUT=/var/lib/voice-bot-replays/$DAY
mkdir -p "$OUT/records"
IMG=$(grep -E '^VOICE_BOT_IMAGE=' .env | cut -d= -f2-)
# A call replays in REAL TIME, so the 3 h budget below fits ~10 calls of 3-6
# min. 30 records meant 25 of them were never looked at (nightly 2026-09-16:
# "records 30 | replay 2 ok / 3 failed"). Take the NEWEST ten.
MAX_CALLS=${MAX_CALLS:-10}

echo "== nightly replay for $DAY (image ${IMG##*:})"
# 1. records
journalctl CONTAINER_NAME=voice-bot-voice-bot-1 -o cat --since "$DAY 00:00:00" --until "$DAY 23:59:59" 2>/dev/null \
  | grep -a 'app.bot replay corr=' \
  | sed -E 's/.*replay corr=([0-9a-f-]+) (.*)$/\1\t\2/' \
  | tail -n "$MAX_CALLS" \
  | while IFS=$'\t' read -r corr js; do printf '%s' "$js" > "$OUT/records/replay_$corr.json"; done
N=$(ls "$OUT/records" | wc -l)
echo "records: $N"

# 2. replay through the real pipeline
if [ "$N" -gt 0 ]; then
  nice -n 10 timeout 3h docker run --rm --env-file .env \
    -v "$OUT/records:/srv/replays:ro" -v "$OUT:/out" -v /opt/voice-bot/vertex-sa.json:/etc/vertex-sa.json:ro \
    "$IMG" python -m sim.replay --dir replays --out /out/replay.json > "$OUT/replay.log" 2>&1
  grep -aE '^(ok|FAIL)|✗' "$OUT/replay.log" > "$OUT/replay.txt"
  echo "replay: $(grep -c '^ok' "$OUT/replay.txt") ok, $(grep -c '^FAIL' "$OUT/replay.txt") failed"
fi

# 3. TTS conformance over yesterday's real sentences, both voices in use
for MV in "lightning_v3.1_pro mrunal hi" "lightning_v3.1 devansh hi" "lightning_v3.1_pro mrunal en"; do
  set -- $MV
  nice -n 10 timeout 40m docker run --rm --env-file .env -v "$OUT/records:/srv/replays:ro" -v "$OUT:/out" \
    "$IMG" python -m sim.ttsprobe --records replays --model "$1" --voice "$2" --language "$3" \
    --out "/out/ttsprobe_$1_$2_$3.json" > "$OUT/ttsprobe_$1_$2_$3.log" 2>&1
  echo "ttsprobe $1/$2/$3: $(grep -a '^summary' "$OUT/ttsprobe_$1_$2_$3.log")"
done

# 4. alerts the reports raised
journalctl CONTAINER_NAME=voice-bot-voice-bot-1 -o cat --since "$DAY 00:00:00" --until "$DAY 23:59:59" 2>/dev/null \
  | grep -a 'call-alert corr=' | sed -E 's/.*call-alert //' > "$OUT/alerts.txt"
echo "call-alerts: $(wc -l < "$OUT/alerts.txt")"

{
  echo "voice-bot nightly $DAY — image ${IMG##*:}"
  echo "records $N | replay $(grep -c '^ok' "$OUT/replay.txt" 2>/dev/null || echo 0) ok / $(grep -c '^FAIL' "$OUT/replay.txt" 2>/dev/null || echo 0) failed | alerts $(wc -l < "$OUT/alerts.txt")"
  echo; echo "-- replay failures"; grep -A8 '^FAIL' "$OUT/replay.txt" 2>/dev/null | head -80
  echo; echo "-- tts probe"; grep -ah '^summary\|^FAIL' "$OUT"/ttsprobe_*.log | head -40
  echo; echo "-- call alerts"; head -40 "$OUT/alerts.txt"
} > "$OUT/summary.txt"
echo "summary → $OUT/summary.txt"
