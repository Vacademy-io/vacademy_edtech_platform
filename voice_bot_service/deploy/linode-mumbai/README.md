# Voice-bot Mumbai anchor (Linode ap-west)

Anchors the live audio path in India: caller (India) ↔ Plivo media (India) ↔
**this box (Mumbai)** ↔ Sarvam STT/TTS (India) ↔ Gemini (Mumbai edge). Measured
from Singapore, Sarvam alone costs ~65 ms RTT per round trip; the move saves
~150–300 ms per conversational turn and makes barge-in noticeably snappier.

The bot is **stateless** — no DB, no disk state. It serves `/answer` (XML) and
`/ws` (Plivo `<Stream>` audio), and makes three control-plane HTTP calls per
call to admin_core in Singapore (call-context, optional handoff, end-of-call
report). Those three are not latency-critical, so **only this service moves**.

The Singapore k8s deployment keeps running as a fallback. Which one takes the
calls is decided by ONE knob: `VOICE_BOT_BASE_URL` on admin-core-service.

## 1. Create the Linode

- Region: **Mumbai (ap-west)**
- Image: **Ubuntu 24.04 LTS**
- Plan: **Shared 2 GB** ($12/mo, 1 vCPU) — handles ~5–10 concurrent calls;
  resize to 4 GB ($24/mo, 2 vCPU) when volume grows.
- Add your SSH key. Note the public IPv4.

## 2. DNS

Add an **A record** `voice-bot-in.vacademy.io → <linode-ip>`.
On Cloudflare this MUST be **DNS-only (grey cloud)** — the orange proxy breaks
the long-lived Plivo WebSocket.

## 3. Bootstrap (as root on the box)

```bash
curl -fsSL https://raw.githubusercontent.com/Vacademy-io/vacademy_edtech_platform/main/voice_bot_service/deploy/linode-mumbai/bootstrap.sh | bash
# fill the three blank secrets in /opt/voice-bot/.env
#   (VOICE_BOT_CLIENT_SECRET / SARVAM_API_KEY / GEMINI_API_KEY — same values as
#    the k8s deployment: kubectl get deploy voice-bot-service -o yaml | grep -A1 …)
cd /opt/voice-bot && docker compose up -d
```

Verify (Caddy needs DNS to resolve before it can get the LetsEncrypt cert):

```bash
curl -s https://voice-bot-in.vacademy.io/voice-bot-service/health
```

## 4. Cut over

```bash
kubectl set env deployment/admin-core-service \
  VOICE_BOT_BASE_URL=https://voice-bot-in.vacademy.io/voice-bot-service
```

All NEW AI calls (outbound + IVR AI_AGENT) now anchor via Mumbai. Rollback is
the same command with the old Singapore URL.

## 5. CI (auto-deploy on every push)

Set once on the GitHub repo:
- variable `VOICE_BOT_MUMBAI_HOST` = the box IP/hostname
- secret `VOICE_BOT_MUMBAI_SSH_KEY` = private key for `root@host`

The voice-bot workflow then SSH-rolls the exact `:<git-sha>` image here after
the k8s deploy (rewrites `VOICE_BOT_IMAGE` in `.env`, `docker compose up -d`).

## Notes

- `/ws` carries no auth yet (per-call capability token is a Phase E item) —
  same exposure as the Singapore deployment; ufw only opens 22/80/443.
- Logs: `cd /opt/voice-bot && docker compose logs -f voice-bot`
- The ECR repo is public — no registry credentials needed on the box.
