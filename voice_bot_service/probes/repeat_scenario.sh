#!/bin/bash
# Run one timing-sim scenario N times; print verdicts and the first failing run's log.
S=${1:?scenario}; N=${2:-5}
for i in $(seq 1 $N); do
  python -m sim.timing --scenarios "$S" --verbose --app-log > run$i.log 2>&1
  echo "run $i: $(grep -aE '^(ok|FAIL) ' run$i.log | cut -c1-120)"
done
for i in $(seq 1 $N); do
  if grep -q '^FAIL' run$i.log; then
    echo "===== FAILED RUN $i"
    sed -E 's/\x1b\[[0-9;]*m//g' run$i.log | grep -aE 'filler|run-guard|turn-gate|floor|STT final|LLM run|CALLER|TTS run_tts|tts-cache|nudge|greet|Hmm|dead air|✗|Generating TTS|cleaning up|Bot (started|stopped)' | cut -c1-220 | head -90
    break
  fi
done
