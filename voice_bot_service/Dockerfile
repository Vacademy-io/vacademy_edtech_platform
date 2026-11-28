# Vacademy AI voice-bot service. Real-time audio loop — deploy in ap-south-1
# (Plivo India media anchoring) with a public WSS ingress.
FROM python:3.12-slim

WORKDIR /srv

# torch/onnx (Silero VAD) need build essentials on slim images.
# haproxy: the in-pod balancer when VB_PROCS > 1 (app/supervisor.py).
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential haproxy \
    && rm -rf /var/lib/apt/lists/*

# One native thread per process for numpy/BLAS/OpenMP. Left at their defaults
# they size to the NODE's cores (6), and their bursts tripped the pod's CPU
# quota: the kernel then froze every call's event loop for the rest of the
# 100 ms period. Load test 2026-11-23: 2 processes x 4 calls went from failing
# to clean, throttled time 5.5 s -> 0.7 s. Our ONNX sessions are already 1-thread.
ENV OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake the Smart Turn v3 model into the image: constructing the analyzer pulls
# its weights once at BUILD time. The 1-vCPU Mumbai box must never download a
# model during a live call's cold start (and outbound HF may be slow/blocked).
ENV HF_HOME=/srv/.hf
RUN python -c "\
from pipecat.audio.turn.smart_turn.base_smart_turn import SmartTurnParams; \
from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3; \
LocalSmartTurnAnalyzerV3(params=SmartTurnParams(stop_secs=1.5)); \
print('smart turn v3 baked')"

COPY app ./app
# Conversation simulator (sim/run.py) — ships in the image so it can be run
# against the box's own credentials: docker compose exec voice-bot python -m sim.run
COPY sim ./sim
# Room-tone loop mixed under every call (app/ambience.py). Resolved relative
# to the package, so it must sit beside app/ in the image exactly as in the repo.
COPY assets ./assets

EXPOSE 8090
# VB_PROCS unset/1: plain uvicorn on :8090, exactly as before. VB_PROCS=N:
# N processes behind an in-pod HAProxy on :8090 (app/supervisor.py).
CMD ["python", "-m", "app.supervisor"]
