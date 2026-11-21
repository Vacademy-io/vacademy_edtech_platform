# Vacademy AI Calling — Concurrency Audit & Scaling Plan

_Audit date: 2026-10-07 · Scope: in-house AI calling (`VACADEMY_AI`, `voice_bot_service`) end-to-end, plus the shared queue that also gates `AAVTAAR` / `MOCK`._
_Method: code read of `admin_core_service`, `voice_bot_service`, `ai_service`, `vacademy_devops`, `.github/workflows`. No prod DB, server or `.env` was read — items marked **[verify live]** need a check on the box / DB._

Related docs: [AI_CALL_QUEUE.md](AI_CALL_QUEUE.md), [AI_CALLING_SYSTEM.md](AI_CALLING_SYSTEM.md),
[VACADEMY_AI_AGENT.md](VACADEMY_AI_AGENT.md), [VACADEMY_VOICE_INTEGRATION.md](VACADEMY_VOICE_INTEGRATION.md),
[AI_CALLING_REVIEW_2026_09_19.md](AI_CALLING_REVIEW_2026_09_19.md), [TTS_SPEECH_CACHE.md](TTS_SPEECH_CACHE.md),
[CALL_INTELLIGENCE.md](CALL_INTELLIGENCE.md).

---

## 0. TL;DR

- **Today's effective ceiling is 3 concurrent AI calls**, fleet-wide, across all institutes. It comes from the single
  `ai_voice_box` row seeded by `V472__ai_call_queue.sql:54-56` (`max_concurrent=3`, `base_url='CONFIGURE_ME'`).
  The bot itself would admit 10 (`MAX_CONCURRENT_CALLS`, `voice_bot_service/app/config.py:884`).
- **Raising that number alone will not work.** The bot is **one Python process on one event loop on a 1 vCPU / ~1.9 GB
  Linode** in Mumbai (`voice_bot_service/Dockerfile:34`, `deploy/linode-mumbai/README.md:20-21`). Every frame of every
  call — EQ, ambience mix, resampling, VAD + Smart-Turn ONNX, pipecat frame routing — shares that one core. Past
  saturation *all* calls degrade together (dead air, late barge-in), and the box has an OOM history.
- **A bigger box alone does not scale either**: a single uvicorn process cannot use more than one core, and the process
  keeps capacity / token / key-pool state in memory (`main.py:44-56, 877-927`), so `--workers N` is unsafe as-is.
- **Horizontal scale is blocked in admin_core**: every Plivo `answer_url` is built from one property,
  `telephony.vacademy-ai.bot-base-url` (`VacademyAiAnswerUrls.java:22,119`). `ai_voice_box` *counts* capacity but
  **does not route**. Adding a second box row adds paper capacity and zero real capacity.
- **Recommended path: "cells".** Run N single-process bot containers (≈1 per vCPU), each registered as its own
  `ai_voice_box` with its own URL, and make admin_core pick a box per dial and stamp it on the call log. This keeps the
  bot's single-process assumptions valid, needs no sticky load balancer, and reuses the capacity model that already exists.
- Around that, fix the things that break at 5–10× volume: the public-API queue bypass, missing HTTP timeouts in the
  serial drainer, the post-call report holding the slot for up to ~60 s, the 4-thread recording copier that sleeps,
  shared single-key vendor accounts (Vertex 429s, Navana 2 streams/key, OpenRouter credit), unknown Plivo CPS, and
  zero saturation metrics / no concurrent load-test harness.

**Realistic targets** (estimates — validate with the load test in §8):

| Phase | Work | Concurrent AI calls |
|---|---|---|
| 0 | Config + small fixes on current box | 3 → ~5–6 |
| 1 | 4 vCPU / 8 GB box, 4 bot cells, admin_core per-box routing | ~16–20 |
| 2 | 2–3 such boxes + vendor capacity upgrades + post-call decoupling | ~40–60 |
| 3 | Autoscaled cells (k8s or VM pool), per-institute vendor keys, number pools | 100+ |

---

## 1. Current end-to-end flow

```
 Trigger                         admin_core (Singapore, k8s)                               Plivo            voice_bot (Mumbai Linode, 1 proc)
 ───────                         ───────────────────────────                               ─────            ─────────────────────────────────
 CALL_AI workflow node ─┐
 Manual click-to-call  ─┼─► AiCallQueueService.enqueue ─► ai_call_queue (QUEUED)
 Bulk campaign         ─┘        (dedupe_key, calling window)        │
                                                                    ▼  every 2 s, ShedLock, ONE thread, serial
                                AiCallQueueDrainJob.drain ─► capacity check (fleet / lane)
                                    └─► AiCallService.placeCall
                                          credit check (HTTP ai_service) → settings/audience/mobile →
                                          3 count queries on telephony_call_log → INSERT INITIATED →
                                          VacademyAiOutboundCaller ── createCall(answer_url=bot-base-url) ──►  rings ≤40 s
 Public API (X-API-Key) ──────────────────► placeCall directly  ⚠ bypasses queue & all caps                     │ answered
                                                                                                               ▼
                                                                                    GET /answer ─────────────► admission (_active_calls < 10)
                                                                                    <Record><Stream wss /ws?tok><Redirect>
                                                                                    WS /ws  ◄──── media ────► pipeline: STT ⇄ LLM ⇄ TTS
                                                                ◄── GET call-context (awaited, 10 s) ─────────  (per call, before audio)
                                                                ◄── handoff / actions (async) ─────────────────
                                                                                    hang-up ─────────────────► report: analysis LLM (≤20 s ×2)
                                TelephonyWebhookController ◄── status/hangup events (frees admin_core slot)      │
                                AiVoiceWebhookController   ◄── POST report (10 s ×2, then disk spool) ◄──────────┘ slot freed only now
                                  └─ ingest + AiCallOutcomeProcessor (sync, on request thread)
                                       classify → lead status → resume_at=now → booking/send rules (inline)
                                Quartz workflowResumeJob (2 min) ─► re-runs the paused workflow
                                aiCallRecordingExecutor (4 thr) ─► fetch Plivo recording (sleeps 0/15/45/90 s)
                                call_intelligence (opt.) ─► ai_service poller (4 rows/batch, SKIP LOCKED)
```

---

## 2. Capacity stack — every limit a call passes through

| # | Layer | Limit today | Where | Notes |
|---|---|---|---|---|
| 1 | Fleet cap (VACADEMY_AI) | **3** | `ai_voice_box.max_concurrent` (V472 seed) | Sum of enabled, non-DOWN boxes, then `min(…, ai_call_fleet_limit)` (`AiCallCapacityService:119-141`) |
| 2 | Per-institute lane | `max(1, ceil(fleet / lanesWithWork))` or override | `ai_call_lane.max_concurrent`, `AiCallCapacityService:295-312` | With fleet=3 and 3+ busy institutes, each gets 1 |
| 3 | Per-agent | **none** | — | One noisy agent can take the whole lane |
| 4 | AAVTAAR | 20 | `app_config.ai_call_aavtaar_max_concurrent` | Their infra; courtesy limit |
| 5 | Drainer throughput | ~1–2 dials/s, serial | `AiCallQueueDrainJob:123-124` | Fine for steady state; dangerous when a hop hangs (§4.3) |
| 6 | Plivo CPS / channels | **unknown, not handled** | — | No limiter, 429 burns a retry attempt **[verify with Plivo]** |
| 7 | Bot admission | 10 | `MAX_CONCURRENT_CALLS`, `main.py:999-1008, 1136-1152` | Over cap → spoken "all lines busy" + redirect |
| 8 | Bot CPU | **~3 clean calls / vCPU**, 1 core usable | single uvicorn process | This is the *real* ceiling (V472 comment, README) |
| 9 | Bot memory | ~35 MB + 2 threads / call (VAD + Smart-Turn), box 1.9 GB | `bot.py:5523,5558`, `memory.py` | OOM kills on record (§3.2) |
| 10 | Vendor streams | Navana 2/key; Vertex asia-south1 shared pool (429s seen); Sarvam/Smallest/Deepgram **unknown** | `config.py:297-303, 383-389` | All keys are platform-wide, shared by every institute |
| 11 | Post-call | Slot held until report posts (~up to 60 s) | `main.py:1229` vs `1239-1240` | Causes false "all lines busy" at high churn |
| 12 | Recording copy | effectively **4 threads**/admin-core pod, tasks sleep ≤150 s | `TelephonyAsyncConfig:107-117`, `AiCallRecordingService:46` | Spring only grows past core when the 500-queue is full |

**Important accounting nuance:** admin_core counts in-flight calls from `telephony_call_log` rows in
INITIATED/QUEUED/RINGING/IN_PROGRESS (`TelephonyCallLogRepository:335-345`). A *ringing* call (up to 40 s, and many
never connect) occupies an admin_core slot but costs the bot nothing. With a typical answer rate well under 100%, the
bot is under-utilised relative to the slot count. See §6 Phase 2 "overbook ratio".

---

## 3. voice_bot_service findings

### 3.1 Runtime model
- `CMD ["uvicorn", "app.main:app", ...]` — **no `--workers`** (`Dockerfile:34`). One process, one asyncio loop.
- Mumbai box: docker compose, `voice-bot` + `caddy:2` (auto-TLS), **no CPU/memory limits** on the container
  (`deploy/linode-mumbai/docker-compose.yml`). Cloudflare must be DNS-only (grey cloud) or the Plivo WebSocket breaks.
- Singapore k3s fallback still exists: `replicaCount: 2`, 250m–1 CPU, 768Mi–2Gi, `maxSurge 0 / maxUnavailable 1`,
  no preStop / grace period (`vacademy_devops/vacademy-services/templates/voice-bot-service-deployment.yaml`,
  `values.yaml:2`). Which one takes traffic is decided solely by `VOICE_BOT_BASE_URL` on admin_core.
- No queueing on the bot: over capacity = reject. Handshakes have their own cap `3×cap+5` (`main.py:1120`).

### 3.2 Per-call footprint
- **Models per call:** own Silero VAD + own Smart-Turn v3 ONNX session ≈ **35 MB + 2 executor threads**, released by hand
  at teardown (`bot.py:6592-6604`, `memory.py:198-208`). Not shared across calls.
- **Vendor connections per call:** STT websocket (Sarvam `saaras:v4` code default; README says Smallest Pulse on the
  Mumbai box **[verify live `.env`]**), TTS websocket for the whole call (Sarvam / Smallest / Deepgram / Navana / Rumik;
  Google Chirp3-HD default for new agents), LLM service object per call (Vertex `gemini-2.5-flash` asia-south1,
  Sarvam, Bedrock, OpenRouter). `STT_FALLBACK_PROVIDER` wraps both vendors in a ServiceSwitcher — unverified whether the
  idle fallback also holds a socket.
- **CPU work on the event loop, per frame:**
  - telephone EQ `scipy.signal.sosfilt` on every outbound frame — on by default (`voice_eq.py:107-120`, `config.py:534`)
  - room-tone/ambience mixer — on by default (`config.py:518`)
  - 24 kHz → 8 kHz resampling in the transport
  - caller-gender pitch detection — pure-Python loop over up to 8 s voiced audio (`caller_gender.py:36-118`)
  - optional Praat PSOLA prosody (`prosody.py:111-140, 312-330`) — off at `PROSODY_EXPAND=1.0`, heaviest when on
  - Edge TTS re-decodes its MP3 buffer every chunk (`providers.py:1759,1837`)
- **Memory history:** ~30 MB/call leak (320 MB → 1.84 GB over ~45 calls) OOM-killed uvicorn mid-call
  (`probes/leak_probe.py:1-3`); a probe run on the prod box OOM-killed it on 2026-09-21 and pegged CPU on 2026-09-17
  (`.github/workflows/voice-bot-probe.yml:1-5`). Fix: `memory.reclaim` full GC ~3 s after each call — itself ~232 ms on
  the loop for the first collection (`memory.py:286-299`).

### 3.3 Process-local state (what breaks with >1 process / replica)

| State | Where | Breaks how | Fix |
|---|---|---|---|
| `_active_calls`, `_inflight_handshakes` | `main.py:47,52` | Cap multiplies per process; `/answer` checks whichever process it hit | One process per cell (§6) |
| `_spent_ws_tokens` (replay guard) | `main.py:880-927` | Token replayable once per process/box | Bind token to box slug in HMAC; or Redis SETNX |
| IVR / preview prompt MP3s `/tmp/tts-cache` | `main.py:211-301`, compose volume | Plivo fetches `/tts/{sha1}.mp3` from a replica that never rendered it → 404 | Per-box URLs (cells) or push to S3/CloudFront |
| TTS speech cache + SQLite ledger | `ttscache.py:437-500,977` | Hit rate splits, ledger fragments | Accept per-cell; later shared object store |
| Report spool (disk) | `report.py:891-1001` | Lost if the box dies | Acceptable; ship to admin_core faster (§4.4) |
| Navana key pool holder counts | `providers.py:763-825` | Per-key 2-stream limit only enforced per process | Assign disjoint keys per cell, or central lease |
| Sweeper / reporter tasks | `main.py:103-108` | Run once per process | Fine per cell |

**Good news:** `/answer` → `/ws` needs **no stickiness** — the WS token is a stateless HMAC verifiable by any process
sharing `VOICE_BOT_CLIENT_SECRET`.

### 3.4 Talking to admin_core
- `get_call_context` is **awaited before the pipeline starts**, Mumbai → Singapore, 10 s total / 5 s connect, **no retry**
  (`admin_core.py:28,36-49`, `main.py:1161-1168`); failure closes the socket → the answered callee hears nothing.
- Every request builds a **new `httpx.AsyncClient`** → fresh TLS handshake to Singapore each time
  (`admin_core.py:42,61,83,113`). Use one shared client with keep-alive.
- `post_report`: 10 s, one retry after 2 s, then disk spool retried every 60 s for 20 min, then `.dead`.

### 3.5 Post-call work holds the slot
`build_and_post_report` runs under `asyncio.shield` **inside** the WS handler, and `_active_calls -= 1` is in the outer
`finally` after it (`main.py:1229` vs `1239-1240`). It does: analysis LLM (≤1400 tokens, 20 s timeout, +1 retry on bad
JSON — `report.py:35,280-325`) → `post_report` (≤~22 s) → TTS-cache ladder (SQLite in a thread). Worst case a slot is
busy **~60 s after hang-up**. Meanwhile admin_core already saw the Plivo hangup, freed *its* slot and may dial into a
bot that still reports full → caller hears "all lines busy". This contradicts the intent at `admin_core.py:92`.

### 3.6 Deploys drop calls
CI waits up to 30 min for `activeCalls == 0`, then `docker compose up -d`
(`.github/workflows/docker-publish-voice-bot-service.yml:247-290`). There is **no drain mode** — the box keeps
accepting calls while it waits, so under continuous campaigns it never reaches 0 and the restart kills live calls
anyway. `cancel-in-progress: true` can abort mid-wait. On k8s, `kubectl set image` with no preStop kills calls outright,
and a saturated loop fails the `/health` liveness probe → pod restart → every call on it dropped.

---

## 4. admin_core_service findings

### 4.1 Queue mechanics (`ai_call_queue`, `ai_call_lane`, `ai_voice_box` — V472/V473)
- States: QUEUED → DISPATCHING → DIALED | FAILED | EXPIRED | CANCELLED. TTL 48 h (`ai_call_queue_ttl_hours`).
- Drainer: every 2 s, ShedLock `AiCallQueueDrain` (`lockAtMostFor` **5 min**), LATERAL "head of each lane" candidate
  query (perLane = `min(50, capacity)`, batch 200), CAS claim `UPDATE … WHERE status='QUEUED'`. DISPATCHING > 5 min →
  reset to QUEUED.
- Retries: 1 / 5 / 15 min, FAILED after 3. Recall-gap defers item 20 min; daily cap defers the lane 1 h; no credits
  defers the lane 15 min. **Credit check fails closed** (`AiCallService:133-141`) — an ai_service outage pauses everyone.
- Fairness: strict FIFO by (priority DESC, created_at) + lane cap. `last_dispatched_at` is written but never read, so
  there is no rotation; institutes beyond fleet capacity starve.
- **In-flight accounting:** derived from non-terminal call-log rows created within `ai_call_stuck_grace_sec` = 720 s,
  max'ed with box `/health` activeCalls (`AiCallCapacityService:206-209`). No reaper — rows stay non-terminal forever and
  silently stop counting after 12 min. Bot default max call is 10 min + 40 s ring ≈ 640 s, so any agent configured for
  longer calls gets **over-booked**.
- Health poller (`AiVoiceBoxHealthPoller`, every 30 s) is effectively off while `base_url = CONFIGURE_ME`
  **[verify live: `SELECT slug, base_url, max_concurrent, enabled FROM ai_voice_box`]**. Also verify
  `telephony.ai.queue.enabled` in prod — the 2026-09-19 review noted the drainer had not yet run in prod.

### 4.2 Paths that bypass the queue
- **Public API** — `PublicAiCallingController.java:6` maps up to **1000 numbers** straight to
  `aiCallService.placeCall(..., MANUAL)` on the HTTP thread. Skips fleet/lane caps, pause, calling windows, daily cap,
  dedupe. One request can blow through every limit and pin a Tomcat thread for minutes. (P1 in the 2026-09-19 review,
  still unfixed.)
- **Manual fast path** — `AiCallController:81` `dispatchNowIfLineFree` dials on the request thread; can overshoot by ~1
  per concurrent click (acknowledged `:261-264`).
- **Legacy flag** — `telephony.ai.queue.enabled=false` restores in-memory pacers with no fleet limit
  (`TelephonyAsyncConfig:46-77`).

### 4.3 Serial drainer + missing timeouts
Each dial = credit HTTP + ~6 queries + Plivo HTTP. Throughput is fine (~1–2 dials/s ≫ the ~0.3 dials/s needed to keep
50 slots of 3-min calls busy), but:
- `AavtaarHttpClient:35` is `new RestTemplate()` — **no timeout**.
- The shared `restTemplate` bean used by `CreditClient` is `new RestTemplate()`
  (`core/config/ApplicationSecurityConfig.java:203`) — **no timeout**.
- One hang freezes *all* AI dialling until ShedLock's 5 min lapses, after which a second pod can start an overlapping
  tick with its own capacity snapshot → fleet over-cap.
- `spring.task.scheduling.pool.size=4` (`application.properties:227`) is shared by ~62 `@Scheduled` methods; the 2 s
  drainer competes with all of them.
- Hikari `maximum-pool-size=8` per pod (`application.properties:28`), 60 s connection timeout.

### 4.4 Outcome ingest
- Report webhook → `AiVoiceWebhookService.ingest` (tx) → `AiCallOutcomeProcessor.process` (tx) **synchronously on the
  Tomcat thread**; booking + send rules run inline after commit (`:458-485`).
- **Failures are swallowed**: outer catch returns **200 isSuccess=true** (`AiVoiceWebhookController:93-96`), so the bot
  deletes its spool and the result is lost. No sweeper re-processes `ai_call_result` rows stuck in RECEIVED.
- Dedupe bug: `AiCallQueueTxOps:44-67` catches the unique-violation inside a REQUIRES_NEW tx already marked
  rollback-only → `UnexpectedRollbackException`; concurrent duplicate enqueues error and the bulk per-row fallback never runs.
- `deferLane` also defers queued MANUAL rows (should be exempt).

### 4.5 Workflow coupling
CALL_AI does not block a thread — it enqueues, writes WAITING state, pauses. But:
- Outcome sets `resume_at=now`; the Quartz `workflowResumeJob` (every **2 min**, no Quartz clustering, `claimForResume`
  FOR UPDATE SKIP LOCKED) **re-runs the whole workflow serially**, with **no LIMIT** on `findDueForResume`.
- While a call waits in the queue the node re-pauses every `recheckMinutes` (`AI_CALL_AWAITING_DIAL`,
  `CallAiNodeHandler:188-197`). A backlog of N leads ⇒ ~N/recheckMinutes full workflow re-runs per minute on that one
  serial job. **At 10× queue depth this becomes the bottleneck before the bot does.**

### 4.6 Other multi-replica issues
- Per-lead guard is `synchronized` lock stripes (`AiCallService:101,359`) — pod-local; across pods only the 30 s window helps.
- `CallEventBus` (`core/CallEventBus.java`) is in-JVM SSE with no DB-poll fallback; live-call UIs miss events when the
  webhook lands on another pod.

---

## 5. Telephony, vendors, post-call, observability

### 5.1 Carrier
- **Only Plivo can carry VACADEMY_AI** (needs `<Stream>`); Exotel / Airtel-VBC throw (`VacademyAiOutboundCaller.java:64-74`).
- `ring_timeout=40`, Plivo client 3 s connect / 8 s read. **No CPS limiter, no 429 backoff, no AMD** (machine detection).
- **One caller ID per institute**, no pool/rotation (`VacademyAiOutboundCaller.java:124-155`). At volume a single CLI
  gets spam-flagged by Indian carriers / Truecaller → answer rate falls, which looks like a capacity problem but isn't.
- `purchasedChannels` (`VoiceCallingSettingsPojo:97`) exists but nothing reads it.
- Plivo account / sub-account CPS and concurrent-channel limits are not referenced anywhere **[verify with Plivo]**.

### 5.2 AI vendors (all platform-wide shared keys)

| Stage | Provider(s) | Known / suspected limit | Action |
|---|---|---|---|
| STT | Sarvam saaras:v4 (code default) / Smallest Pulse (Mumbai README) / Google | Concurrent WS limit **unknown** | Get written limits; raise tier |
| LLM | Vertex gemini-2.5-flash asia-south1, Sarvam-105b, Bedrock, OpenRouter | Vertex **429 RESOURCE_EXHAUSTED** on shared pool (2026-09-23, 7.1 s to surface) | Provisioned throughput or multi-region; always set `LLM_FALLBACK_PROVIDER` |
| TTS | Google Chirp3-HD (new-agent default), Sarvam bulbul:v3, Smallest, Navana, Rumik, Deepgram, Edge | **Navana 2 streams/key** for the whole call; others unknown | More Navana keys (disjoint per cell) or steer volume to an engine with high limits |
| Post-call analysis | same backend as the call (Vertex calls → Sarvam) | 20 s × 2 | Move off the slot (§6) |
| Call Intelligence | shared OpenRouter key | credit exhaustion (402) and transcription 429s seen | Balance alarm; separate key |

### 5.3 Post-call pipeline at volume
- **Recording copy** is the weakest link: core 4 / max 8 / queue 500, but `ThreadPoolExecutor` only grows past core when
  the queue is full ⇒ **4 threads per pod**, each task `Thread.sleep`ing through a 0/15/45/90 s backoff (~60% of first
  fetches miss because Plivo hasn't finished uploading). At ~30 concurrent 3-min calls (~10 hang-ups/min) the queue
  grows; recordings drop only after 500 are queued.
- **Call Intelligence** poller claims 4 rows (`ai_service/.../call_intelligence_poller.py:27`) and `gather`s them — batch
  time = slowest row (transcription up to 25 min). Render-worker fallback answered "at capacity" on 45% of runs.
- Outcome processing / booking on the webhook thread (§4.4).

### 5.4 Observability gaps
Exists: bot `/health {activeCalls, maxConcurrentCalls}`, per-call `diag_health` (RED/AMBER/GREEN, SLOW_TTS/SLOW_LLM,
DEAD_AIR) on `ai_call_result`, `call-alert` log line per non-GREEN call, nightly replay of 10 calls.
**Missing:** Prometheus metrics, event-loop lag, CPU/RSS time series, count of "all lines busy" rejections, vendor 429s,
Navana key saturation, queue depth / wait time, recording-executor depth, alerts of any kind.
(`AI_CALLING_SYSTEM.md:741` still says json-file logging; compose now uses journald.)

### 5.5 Load testing
**No tool can drive N concurrent calls.** `loadtest/` is k6 for assessments; `sim.run` is text-only and sequential;
`sim.timing` / `sim.replay` run one pipeline in real time; `probes/leak_probe.py` measures memory back-to-back.

---

## 6. Scaling plan

Design principle: **keep each bot process single-loop and stateless-enough; scale by adding cells that admin_core
routes to explicitly.** This avoids rewriting the bot's in-memory state, avoids sticky L7 load balancing for
WebSockets, and reuses `ai_voice_box`, which was designed for exactly this ("adding a second Mumbai box is an INSERT").

### Phase 0 — this week, current box (3 → ~5–6)
1. **Fix `ai_voice_box`**: set the real `base_url` so the health poller works; set `max_concurrent` to what a load test
   proves (start at 4–5; the V472 comment's "3 clean" was measured before the leak/GC and Vertex-prewarm fixes).
2. **Release the bot slot before the report**: decrement `_active_calls` in the WS handler, then run
   `build_and_post_report` as a tracked background task with its own small cap (`_reporting_calls`). Report work is
   network-bound; it should not consume a live-call slot.
3. **Shared `httpx.AsyncClient`** with keep-alive for admin_core calls; add 1 retry on `get_call_context`.
4. **Timeouts** on `AavtaarHttpClient` and the shared `restTemplate` / `CreditClient` (e.g. 3 s connect / 10 s read).
   Cache credit balance for ~10 s per institute.
5. **Route the Public API through the queue** (`enqueueBatch` for BULK_CALL, manual enqueue for CLICK_TO_CALL).
6. **Raise `ai_call_stuck_grace_sec`** to ≥ max(agent `max_call_minutes`) × 60 + ring + report margin, and add a reaper
   that marks stale non-terminal AI rows FAILED/UNKNOWN.
7. **Webhook honesty**: return 5xx when ingest fails so the bot keeps the spool; add a sweeper for RECEIVED results.
8. Turn off ambience / voice EQ on agents that don't need them if loop lag is the limiter (measure first).

### Phase 1 — cells on one bigger box (→ ~16–20)
1. **Box**: resize the Mumbai Linode to 4 vCPU / 8 GB (dedicated CPU preferred — shared vCPUs steal under load).
2. **Run N bot containers** (N ≈ vCPUs), each its own single uvicorn process, `cpus: 1.0`, `mem_limit` ~1.5 GB,
   `MAX_CONCURRENT_CALLS` = proven per-cell figure (~4–5). Caddy routes by host or path:
   `bot1.<domain>` → `voice-bot-1:8090`, etc. (or `/{cell}/…` prefix — host-based is simpler for Plivo URLs).
3. **admin_core routing** (the real code change):
   - Migration: add `ai_voice_box_id` to `telephony_call_log` (Flyway — schema via migrations only).
   - At dispatch, pick the healthy box with the most free slots (`max_concurrent − inFlight(box)`); stamp it on the row.
   - `VacademyAiAnswerUrls` builds `answer_url` / `/plivo/ai-next` callbacks from **that box's `base_url`** instead of
     the global property (keep the property as fallback when no box row is usable).
   - `AiCallCapacityService` computes in-flight **per box** from the stamped column; fleet = Σ boxes.
   - Health poller already exists — marks a box DOWN and the picker skips it.
4. **Per-box everything else falls out naturally**: `/tts/{sha1}.mp3` URLs are minted by the same box that serves them;
   token replay set is per box (bind the box slug into the HMAC so a token minted for cell 1 is rejected by cell 2);
   speech cache per cell (accept the lower hit rate, or mount one shared volume read-mostly).
5. **Navana**: give each cell a disjoint key set via env, so the per-process key pool stays correct.
6. **Graceful drain per cell**: add `POST /admin/drain` (or `DRAINING` flag on `ai_voice_box`) → admin_core stops
   routing there, bot returns busy for new `/answer`, CI waits for `activeCalls==0` on *that cell only*, restarts it,
   un-drains. Rolling deploy across cells = zero dropped calls.

### Phase 2 — multiple boxes + platform hardening (→ ~40–60)
1. Add boxes = INSERT `ai_voice_box` rows (+ DNS + Caddy). Consider a second region/provider for failure isolation.
2. **Vendor capacity**: written concurrency limits from Sarvam / Smallest / Google TTS / Navana; Vertex provisioned
   throughput or a second region; configure `LLM_FALLBACK_PROVIDER` everywhere; OpenRouter balance alarm.
3. **Plivo**: confirm account/sub-account CPS + channel limits; add a per-account token-bucket in the drainer; handle 429
   as "defer, don't burn an attempt"; **caller-ID pools** with rotation and per-number daily caps; consider AMD to skip
   voicemail before spending bot capacity.
4. **Overbook ratio**: count RINGING/INITIATED separately from IN_PROGRESS against box capacity
   (`effective = in_progress + ringing × ρ`, ρ ≈ observed answer rate), since ringing costs the bot nothing. The bot's
   own admission check stays the safety net. Only after per-box metrics prove the answer rate.
5. **Decouple post-call in admin_core**: ingest writes `ai_call_result` + returns 202; a DB-queue worker
   (`SKIP LOCKED`, like `call_intelligence`) runs `AiCallOutcomeProcessor`, booking and send rules.
6. **Recording copy**: replace `Thread.sleep` backoff with a persisted "fetch after" timestamp polled by a scheduler
   (DB queue), so threads never sleep; or rely on Plivo's recording callback and fetch once.
7. **Workflow resume**: add LIMIT + bounded parallelism to `WorkflowResumeJob`; replace the AWAITING_DIAL polling
   re-pause with a direct wake from the drainer when the call is dialled.
8. **Drainer**: dedicated scheduler (not the shared pool of 4); parallel dispatch of claimed items on a bounded executor;
   `lockAtMostFor` ≈ 30 s with bounded ticks; Hikari sized against pgbouncer.
9. **Fairness**: round-robin lanes on `last_dispatched_at`; add a per-agent cap.
10. Fix the dedupe `UnexpectedRollbackException`, `deferLane` MANUAL exemption, CallEventBus DB-poll fan-out.

### Phase 3 — elastic (100+)
- Move cells to k8s (or a VM autoscaling group) in an India region, one pod = one cell, each pod registering itself as an
  `ai_voice_box` (self-registration + heartbeat), `terminationGracePeriodSeconds` ≥ max call + report, preStop = drain.
  HPA on `activeCalls / max` rather than CPU.
- Share the per-call models: one ONNX Smart-Turn session + VAD per process with per-call state, cutting ~35 MB/call.
- Move per-frame DSP (EQ, mixer, resample) into a numpy-vectorised or native path, or into `run_in_executor` where the
  frame size allows, to raise calls per core.
- Per-institute vendor keys / BYO keys for large tenants so one tenant's volume can't exhaust a shared quota.

### Rejected alternatives
- **`uvicorn --workers N` on one big box** — multiplies the cap, breaks token replay, Navana pool, TTS prompt files and
  `/health`'s activeCalls (reports one worker). Would need all state moved to Redis first; cells give the same CPU
  scaling with none of that.
- **Single URL behind an L7 load balancer** — needs sticky routing for `/tts/*` and a shared admission counter; admin_core
  loses per-box visibility. More moving parts than explicit routing.
- **Just raising `max_concurrent` to 10** — the bot admits it but one vCPU cannot carry it; quality collapses for every call.

---

## 7. Capacity math (rough — replace with measured numbers)

| Resource | Per call | Per cell (1 vCPU, ~1.5 GB) | Notes |
|---|---|---|---|
| CPU | ~0.2–0.3 core (EQ + mixer + resample + VAD/turn + pipecat) | **~3–5 calls** | Today's "3 clean" figure; Phase 0 fixes should lift it |
| Memory | ~35 MB models + pipeline buffers | ~300 MB base + 5 × ~80 MB ≈ 700 MB | Leave headroom for GC spikes |
| Admin_core dials | 1 per call attempt | — | 50 slots × 3-min calls ≈ 0.3 dials/s steady |
| Post-call | ≤60 s report, recording fetch, outcome tx | — | Must be off the slot (Phase 0 #2) |

Example: 4 vCPU dedicated box → 4 cells × 4–5 = **16–20 concurrent calls**. Three such boxes ≈ 50–60, assuming vendor
limits (§5.2) and Plivo channels are raised in step.

---

## 8. Validation & observability (do before raising caps)

1. **Concurrent load harness** (new, run on a *staging* box, never prod): open N fake Plivo `/ws` sessions using the
   `sim.timing` stub vendors, replaying recorded caller audio. Record per-call first-response latency, turn latency
   p50/p95, dead-air %, loop lag, CPU, RSS. Step N = 1, 2, 4, 6, 8 per cell; the per-cell cap = largest N with p95
   turn latency and DEAD_AIR rate still at the N=1 baseline.
2. **Then a real-vendor run** with a handful of internal test numbers to find vendor limits (429s, WS rejects).
3. **Metrics** (Prometheus `/metrics` on the bot + Micrometer on admin_core): `active_calls`, `answer_rejected_busy`,
   `event_loop_lag_ms`, `rss_bytes`, vendor error counters by code, `report_post_seconds`, queue depth / oldest QUEUED
   age per lane, dial-to-answer latency, recording-executor queue depth.
4. **Alerts**: busy-rejections > 0, loop lag p95 > 100 ms, RSS > 80% of limit, Vertex/Sarvam 429 rate, OpenRouter
   balance < threshold, oldest QUEUED > N min, box DOWN.

---

## 9. Prioritised checklist

| # | Item | Phase | Owner area | Effort |
|---|---|---|---|---|
| 1 | Set real `ai_voice_box.base_url`, verify queue flag + health poller in prod | 0 | ops / SQL | S |
| 2 | Release bot slot before post-call report | 0 | voice_bot | S |
| 3 | Shared httpx client + retry on call-context | 0 | voice_bot | S |
| 4 | Timeouts on Aavtaar + shared RestTemplate; cache credit check | 0 | admin_core | S |
| 5 | Public API → queue | 0 | admin_core | S |
| 6 | Stuck-grace ≥ max call length; stale-row reaper | 0 | admin_core | S |
| 7 | Webhook returns 5xx on ingest failure; RECEIVED sweeper | 0 | admin_core | S |
| 8 | Concurrent load harness + bot metrics | 0–1 | voice_bot | M |
| 9 | Per-box routing (`ai_voice_box_id` on call log, per-box answer URLs, per-box in-flight) | 1 | admin_core + migration | M |
| 10 | Multi-cell compose + Caddy + per-cell drain & rolling deploy | 1 | devops | M |
| 11 | Vendor limits in writing; Vertex capacity; LLM fallback; Navana keys per cell | 1–2 | vendors | M |
| 12 | Plivo CPS limiter, 429 defer, caller-ID pools, AMD | 2 | admin_core | M |
| 13 | Outcome processing + recording copy as DB queues | 2 | admin_core | M |
| 14 | Workflow resume LIMIT/parallelism; drop AWAITING_DIAL polling | 2 | workflow engine | M |
| 15 | Dedicated drainer scheduler, parallel dispatch, fairness rotation, per-agent cap | 2 | admin_core | M |
| 16 | Shared ONNX sessions, vectorised DSP, k8s self-registering cells | 3 | voice_bot / devops | L |

## 10. Open questions [verify live]
- Live `ai_voice_box` rows and `app_config` values (`ai_call_fleet_limit`, `ai_call_capacity_enabled`,
  `ai_call_stuck_grace_sec`); is `telephony.ai.queue.enabled=true` in prod?
- Live `/opt/voice-bot/.env` on Mumbai: actual STT / LLM / TTS providers, fallback providers, `MAX_CONCURRENT_CALLS`,
  `VOICE_EQ_ENABLED`, `AMBIENCE_ENABLED`.
- Is the Singapore k3s voice-bot still receiving any traffic, or can it be scaled to 0?
- Plivo account CPS and concurrent-channel limits per sub-account; current answer rate per institute (drives the overbook ratio).
- Vendor contracts: Sarvam / Smallest / Google TTS concurrent-stream limits; Vertex quota for asia-south1.
- Highest `max_call_minutes` configured on any `ai_agent` (sets the stuck-grace floor).
