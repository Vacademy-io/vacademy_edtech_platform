# Vacademy AI voice-bot service. Real-time audio loop — deploy in ap-south-1
# (Plivo India media anchoring) with a public WSS ingress.
FROM python:3.12-slim

WORKDIR /srv

# torch/onnx (Silero VAD) need build essentials on slim images.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

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
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090"]
