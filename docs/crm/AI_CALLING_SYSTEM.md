# AI Calling — System Reference

**What this is:** the single end-to-end reference for Vacademy's own AI voice calling —
the agents, the STT / LLM / TTS stack, the real-time pipeline, the credit metering, the
logs, and how a finished call turns into a disposition on a lead.

**Read from the code on 2026-08-11** (`main`). Every number, default and quirk below was
taken from source, not from memory; file paths are given so you can re-derive any claim.
Where a value is per-deployment (an env var on the box, a DB row), that is called out —
the repo cannot tell you what production is actually running.

**Companion docs**
- [`VACADEMY_AI_AGENT.md`](./VACADEMY_AI_AGENT.md) — the original design + phase plan.
- [`AI_CALL_QUEUE.md`](./AI_CALL_QUEUE.md) — what happens BEFORE step 2 below: every AI dial
  is now queued and placed by a single fleet-wide drainer, so the pre-dial throttles in §2.4
  are re-evaluated at dial time rather than at request time.
- [`AI_CALL_DEEP_REVIEW.md`](./AI_CALL_DEEP_REVIEW.md) — humanness/latency review (2026-07-14). Some of its "not done yet" items have since shipped; this doc is the current state.
- [`VACADEMY_VOICE_INTEGRATION.md`](./VACADEMY_VOICE_INTEGRATION.md) — Plivo telephony + IVR.
- [`AAVTAAR_AI_CALLING.md`](./AAVTAAR_AI_CALLING.md) — the third-party AI provider that shares this pipeline.
- [`CALL_INTELLIGENCE.md`](./CALL_INTELLIGENCE.md) — recording-based analysis of **human** calls (also covered in §9 here).
- [`TTS_SPEECH_CACHE.md`](./TTS_SPEECH_CACHE.md) — replaying already-paid-for TTS audio on an exact sentence match (§6 is the engine list it keys on; both switches default OFF).

---

## Table of contents

1. [The map — what runs where](#1-the-map--what-runs-where)
2. [End-to-end call flow](#2-end-to-end-call-flow)
3. [The agent — registry, persona, prompt assembly](#3-the-agent--registry-persona-prompt-assembly)
4. [STT — speech to text](#4-stt--speech-to-text)
5. [LLM — the conversation model](#5-llm--the-conversation-model)
6. [TTS — text to speech (five engines)](#6-tts--text-to-speech-five-engines)
7. [The real-time pipeline](#7-the-real-time-pipeline)
8. [End-of-call analysis → lead outcome](#8-end-of-call-analysis--lead-outcome)
9. [Call Intelligence (the other analysis pipeline)](#9-call-intelligence-the-other-analysis-pipeline)
10. [Credits & billing](#10-credits--billing)
11. [Logs, diagnostics & observability](#11-logs-diagnostics--observability)
12. [Data model](#12-data-model)
13. [Configuration reference](#13-configuration-reference)
14. [Failure modes & runbook](#14-failure-modes--runbook)
15. [Known gaps](#15-known-gaps)

---

## 1. The map — what runs where

| Component | Where | Role |
|---|---|---|
| **`admin_core_service`** (Java/Spring, Singapore k3s) | `admin_core_service/src/main/java/.../features/telephony/**` | Control plane: agent registry, dial decision, throttles, webhook receiver, outcome → lead actions, billing, call log |
| **`voice_bot_service`** (Python/FastAPI + Pipecat, **Mumbai box**) | `voice_bot_service/app/**` | The live call: audio in/out over Plivo `<Stream>`, VAD → STT → LLM → TTS, end-of-call report. **Stateless — no DB** |
| **`ai_service`** (Python) | `ai_service/app/services/call_intelligence_*.py`, credits API | Credit wallet + Call Intelligence (recording transcription + LLM scoring) |
| **Plivo** | vendor | PSTN leg, media anchoring, `<Stream>` websocket, recording |
| **`frontend-admin-dashboard`** | `src/routes/calling/ai-agents/`, `src/routes/audience-manager/call-log/`, `src/routes/settings/-components/AiCallingSettings.tsx` | Agent authoring, call log + health panel, settings |

Only the voice bot moved to Mumbai; the control plane stays in Singapore. The audio path is
caller (India) ↔ Plivo media (India) ↔ Mumbai box ↔ Sarvam (India), which is worth
~150–300 ms per turn (`voice_bot_service/deploy/linode-mumbai/README.md`). The three
control-plane HTTP calls per call (context, optional handoff, report) are not
latency-critical, so they cross the ocean.

**Which box takes calls is one knob**: `VOICE_BOT_BASE_URL` on admin-core-service. The
Singapore k8s deployment is the fallback.

Deployment on the Mumbai box is `docker compose` (bot + Caddy for TLS), image pinned to an
immutable `:<git-sha>` rewritten by CI in `/opt/voice-bot/.env`
(`voice_bot_service/deploy/linode-mumbai/docker-compose.yml`).

---

## 2. End-to-end call flow

### 2.1 Outbound ("call this lead with the AI")

```
 1. Trigger        CALL_AI workflow node │ bulk campaign │ manual click (lead row / Call Log)
                            │
 2. AiCallService   ── credit gate (fail-CLOSED) → provider+campaign resolve → lead phone
    .placeCall()       → assigned-lead guard → daily cap → 30s dedup
                       → INSERT telephony_call_log (status=INITIATED, id = corr)
                            │
 3. VacademyAiOutboundCaller → Plivo Call API on the institute's AI CARRIER (§2.5)
                       answer_url = {bot}/answer?corr&agent&inst&nxt[&rcb]
                            │
 4. Lead answers   → Plivo GETs {bot}/answer
                       XML: [<Record recordSession>] <Stream wss://bot/ws?corr&agent&inst&tok>
                            <Redirect> admin_core /plivo/ai-next
                            │
 5. Plivo opens the WS → /ws: single-use HMAC token check → telephony handshake
                       → GET admin_core /internal/voice-bot/call-context   (lead+agent+handoff+token)
                       → Pipecat pipeline runs the conversation
                            │
 6. Conversation ends (LLM emits <<END_CALL>>, idle hangup, max-minutes cap, or caller hangs up)
                            │
 7. report.build_and_post_report → one non-streaming LLM analysis of the transcript
                       → POST /v1/telephony/webhook/ai-voice/VACADEMY_AI?instituteId&token
                            │
 8. AiVoiceWebhookService  → upsert ai_call_result (idempotent on provider+call_uuid)
    AiCallOutcomeProcessor → bind to lead, promote call_log row, classify, act:
                             ASSIGN counsellor │ STOP │ RETRY, stamp lead status,
                             resume paused workflow, auto-book meeting, copy recording
                            │
 9. CallBillingService     → voice minutes + AI minutes deducted from the credit wallet
10. Recording lands in our storage → CallIntelligenceEnqueueService (optional, separate)
```

Key files: [`AiCallService.java`](../../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/telephony/core/AiCallService.java),
[`VacademyAiOutboundCaller.java`](../../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/telephony/providers/vacademy_ai/VacademyAiOutboundCaller.java),
[`VacademyAiAnswerUrls.java`](../../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/telephony/providers/vacademy_ai/VacademyAiAnswerUrls.java),
[`main.py`](../../voice_bot_service/app/main.py), [`bot.py`](../../voice_bot_service/app/bot.py), [`report.py`](../../voice_bot_service/app/report.py).

### 2.2 Inbound (IVR → AI agent)

The Vacademy Voice IVR has an `AI_AGENT` node. `PlivoIvrRenderer` emits the same
`<Stream>` XML through `VacademyAiAnswerUrls`, so the bot path is byte-identical; only the
context differs (`direction=INBOUND`, and the person on the line is `from_number`, not
`to_number` — see `VoiceBotInternalController.callContext`). Inbound outcomes fire the
`LEAD_CALLED_BACK` workflow trigger.

### 2.3 Why the call must survive the stream ending

`PlivoFrameSerializer.InputParams(auto_hang_up=False)` is non-negotiable
(`main.py:878`). The call has to outlive the websocket so Plivo falls through to
`<Redirect>` → admin_core `/plivo/ai-next`, which serves either the human-handoff `<Dial>`
or `<Hangup/>`. With the pipecat default (`True`), the call would be API-killed on
`EndFrame` and **no handoff could ever happen**.

### 2.4 Pre-dial throttles (all in `AiCallService.placeCall`)

| Guard | Behaviour | Applies to |
|---|---|---|
| **Credit gate** | `creditClient.hasActiveCredits()`; **fails closed** (unreadable balance ⇒ no call). Throws 409 with a top-up message | every path |
| Deleted lead | `audience_status = INACTIVE` ⇒ 409 | every path |
| Already-assigned lead | Skip (`SKIPPED_ASSIGNED`, HTTP 200, `dispatched=false`) | automation only — a human clicking is honoured |
| Daily cap | institute `maxCallsPerDay`, else `telephony.ai.max-calls-per-day-default` (500). `SKIPPED_DAILY_CAP` | bulk/automation |
| Duplicate window | 30 s per institute+user+provider, striped per-lead lock + time window | bulk/automation |

The credit gate exists because AI calls were previously billed only *after* the fact — an
institute was observed live at **−5759 credits still dialling**.

### 2.5 Which line the call goes out on (the AI carrier)

Vacademy AI is **not a carrier** — it is a media application on top of Plivo. The bot only
ever receives audio through Plivo's `<Stream>`, and Airtel IQ (a white-labelled Vonage VBC)
and Exotel expose no media fork, so an AI call **must** be placed on a Plivo line.

Until V448 that line was, by definition, the institute's own telephony provider: the dialer
refused any institute whose `institute_telephony_config.provider_type != PLIVO`, and
`institute_telephony_config` was `UNIQUE(institute_id)` — one provider, full stop. An
institute running its counsellors on Airtel therefore **could not use AI calling at all**,
and the failure was invisible until the first dial (the AI settings saved happily with
`provider=VACADEMY_AI`).

V448 adds a **role** to that table so an institute can hold two rows:

| `role` | What it is | Who resolves it |
|---|---|---|
| `PRIMARY` | the provider humans click-to-call and receive inbound on | `TelephonyConfigCache.get()` — every human-calling path |
| `AI_VOICE` | an **optional** dedicated Plivo subaccount used only by `VACADEMY_AI` calls | `TelephonyConfigCache.getForAi()` |

`getForAi()` returns the `AI_VOICE` row when one exists **and is enabled**, else falls back
to `PRIMARY` — so an institute already on Vacademy Voice is byte-identical to before, and a
disabled AI line degrades to the primary rather than blocking every dial. Any path handed an
*existing* call uses `forCallProvider(instituteId, row.providerType)`, which routes only
`VACADEMY_AI` rows to the AI carrier.

Four places had to follow the carrier, not the institute:

| Path | Why |
|---|---|
| `VacademyAiOutboundCaller` | credentials + caller-ID come from the account that dials |
| `TelephonyWebhookController` | a `VACADEMY_AI` row's status/recording callbacks are **Plivo** events; the authoritative provider is the carrier, not the institute's human one, or every callback 400s on the provider-mismatch guard |
| `PlivoCallbackController.aiNext` | the `?token=` the bot embedded came from the AI config; the primary's token would never match |
| `RecordingTxOps` / `AiCallRecordingService` | the recording lives in the AI carrier's subaccount and needs *its* Basic auth |

**A dedicated line's caller-ID lives on the config** (`provider_config.callerId`), *not* as a
`telephony_provider_number`. That is deliberate: adding one therefore cannot alter the
institute's number pool, the Numbers card, or `findEnabledByPhoneNumber` — the inbound DID
lookup that attributes every incoming call. `Resolved.getAiCallerId()` returns null on a
PRIMARY row for the same reason.

Managed at **Settings → Calling → AI calling line**
(`GET|PUT|DELETE /v1/telephony/ai-carrier/{instituteId}`, `AiVoiceCarrierService`): pick
*"use our calling account"* (refused, with the reason, when the primary can't carry AI) or
*"use a separate line"* (Plivo Auth ID/Token + caller-ID). Unlinking is non-destructive —
AI falls back to the primary provider.

> Inbound AI (the IVR `AI_AGENT` node) on a **dedicated** line is not wired: it would need
> the DID registered as an inbound-routable number, which is exactly what this design keeps
> out of the number pool. Outbound AI is unaffected.

---

## 3. The agent — registry, persona, prompt assembly

### 3.1 The registry (`ai_agent` table)

CRUD: `GET|POST|DELETE /admin-core-service/v1/telephony/ai-agents` (`AiAgentController` →
`AiAgentService`). Saving an agent **auto-registers it as a `VACADEMY_AI` campaign**
(campaignId = agent id) so workflows, campaigns and the IVR can pick it by name.

| Column | Meaning |
|---|---|
| `id`, `institute_id`, `name`, `enabled` | identity |
| `direction` | `OUTBOUND` / `INBOUND` / `BOTH` |
| `language` | free text (`hinglish`, `hi`, `en`) → drives STT pin + prompt language rules |
| `voice`, `tts_model` | the engine and one of **its** voices (§6) |
| `pace`, `temperature` | delivery (0.5–2.0 / 0.01–2.0) |
| `opening_line` | what it says the moment the call connects |
| `system_prompt` | the persona — authoritative, never merged with the built-in template |
| `extraction_questions` | what each call must find out (feeds the analyser) |
| `dispositions` | the closed vocabulary the analyser may choose from |
| `handoff_numbers` | mid-call human transfer targets |
| `max_call_minutes` | hard per-call cap (default 6; bot's global fallback 10) |
| `booking_page_id` | auto-book a meeting when the call agrees a time |

UI: **CRM → Calling → AI Agents** (`frontend-admin-dashboard/src/routes/calling/ai-agents/`),
and the older card in **Settings → AI Calling** (`AiAgentsCard.tsx`).

### 3.2 Call context — what the bot is told

`GET /admin-core-service/internal/voice-bot/call-context?corr=&agent=`
([`VoiceBotInternalController`](../../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/telephony/controller/VoiceBotInternalController.java)),
gated by `InternalAuthFilter` (`clientName` + `Signature` from `client_secret_key`).

Returns: `corr`, `instituteId`, `instituteName`, `direction`, `leadPhone`, `leadName`,
`leadGender`, `leadFields` (the lead's captured custom fields), `responseId`, `userId`,
`agent{…}`, `handoff{enabled,numbers}`, `callRetry` (prior attempts in 7 days — feeds the
classifier's exhaustion path), `webhookToken`.

Two things worth knowing:
- **Registry content is authoritative.** A blank `systemPrompt`/`extractionQuestions` means
  *none*, not "inherit the built-in admissions template" — otherwise a religious-shivir agent
  would be told to ask "which course are you interested in".
- **`tts_model` is emitted in snake_case on purpose** (the bot reads `agent["tts_model"]`) and
  is *always* emitted, because the bot's fallback for a missing key is `sarvam` — an agent
  stamped `rumik` whose key got dropped would be served Sarvam while billed for Rumik.
- If no registry agent resolves, a **built-in persona** is used (Hinglish, voice `priya`,
  Sarvam, 6-minute cap, admissions questions).

### 3.3 System prompt assembly (`bot.build_system_prompt`, `bot.py:1406`)

The agent's own prompt is one layer of several. The bot wraps it with things no agent
author can know:

| Layer | Why it exists (all from live-call failures) |
|---|---|
| **Non-negotiable rules (7)** | never repeat a sentence; answer direct questions first; frustration ⇒ stop the script; assume mis-hear when the conversation stops making sense; stay in one language; end every turn with a question then **stop**; a neutral ack means yes |
| **Gender agreement** | Hindi first-person verbs are gendered — conjugated from the *configured voice's* gender (`main kar rahi hoon` vs `raha`) |
| **Addressee agreement + honorific** | `leadGender` drives `aap kaisi/kaise hain` and sir/ma'am; **unknown ⇒ forbidden to guess**, use `<name> ji` |
| **Script rule** | Hindi in Devanagari, English business words in Latin (Sarvam docs: romanized Hindi degrades TTS). Rumik agents additionally get "English-origin words in English letters" because Rumik reads `लाइव क्लासेस` as "लव असेस" |
| **Plain-phone-Hindi register** | 20+ concrete swaps (`performance` not `प्रदर्शन`, `enquiry` not `पूछताछ`) after 198 uses of literary vocabulary across two days of calls |
| **Plain-speech rules** | no markdown (a call once read its own bullet list aloud), numbers as words, phone numbers digit by digit |
| **No echo-confirm** | never repeat the caller's answer back ("okay, so you got ninety-four") — a call confirmed every single answer, which is the clearest AI tell there is. Two exceptions only: a phone number and a booked day/time get read back once. **Second line of defence only** — the load-bearing fix is `NoRepeatGate._trim_echo` (§7.3a), because prompt-only attempts at this class have been measured to do nothing |
| **Time-aware greeting** | uses the RIGHT-NOW line — a call went out in the evening saying "good morning" |
| **One-step-at-a-time / listen / goal-drive / close-concretely** | the model used to answer its own questions, plough past what the caller said, and close on a vague "okay" |
| **Name sanity** | never "Mr. ___" with a non-name — a call once addressed someone as "Ms. Robotics STEM Programs for Schools" |
| **Direction intent** | outbound: *you* placed this call; inbound: they called you |
| **Sentinels** | `<<END_CALL>>` and `<<TRANSFER>>` (§7.4) |

Placeholders in the authored prompt (`{{leadName}}` etc.) are filled by `_fill_placeholders`,
and anything unfilled is recorded as the `PROMPT_UNFILLED` diagnostic fault.

### 3.4 AI-assisted authoring

`POST /v1/telephony/ai-agents/assist/{draft|analyze|improve|feedback}`
([`AiAgentAssistService`](../../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/telephony/core/AiAgentAssistService.java)):
draft a prompt from a plain brief, score it against a live-call rubric, apply selected
suggestions, or revise from real post-call feedback. **1 credit** per successful operation
(`request_type=content`, post-paid). This is what the new **use-case gallery** on the AI
Agents page drives (doubt solving, mentoring, parent updates, admissions, fees,
re-engagement).

---

## 4. STT — speech to text

Built in [`providers.build_stt`](../../voice_bot_service/app/providers.py). Two arms behind
`STT_PROVIDER`.

### 4.1 Sarvam (default arm)

| Knob | Default | Notes |
|---|---|---|
| `SARVAM_STT_MODEL` | `saaras:v4` | pipecat 1.4's model table stops at v3, so the bot **registers v4 at runtime** with v3's capability shape (`_register_saaras_v4`), falling back to v3 rather than crashing |
| `SARVAM_STT_MODE` | `transcribe` | `transcribe \| translate \| verbatim \| translit \| codemix`; only meaningful on saaras v3/v4 |
| `SARVAM_STT_LANGUAGE` | `hi-IN` | auto-detect drifts Hindi callers into Punjabi/Marathi, and the "stay in the caller's language" rule then locks the whole call there |
| `SARVAM_STT_HIGH_VAD` | `true` | asks Sarvam to finalize sooner; server endpointing (~0.65–0.76 s) is the measured binding constraint on reply latency |
| `SARVAM_TTFS_P99` | `0.5` | how long the 1.4 turn-stop strategy may hold a turn waiting for a final. **Sarvam never flags `finalized=True`**, and pipecat's default of 1.17 adds ~1 s of dead air *every turn* |

Capability probing is deliberate: 1.4 raises on unsupported fields, and the families differ
in both directions (saaras v2.5 takes a `prompt` but no language; v3/v4 take language + mode
+ server-VAD but no prompt; saarika takes language only). The bot asks
`MODEL_CONFIGS` what the model accepts instead of guessing.

**Model history, recorded honestly in `config.py`:** `saarika:v2.5` transliterated English
callers into Devanagari and went deaf on a live call on 2026-08-03 (caller said "hybrid
model" four times, zero finals). An older `saaras:v3` had been abandoned earlier for
garbling code-switched Hinglish. Rollback path is `SARVAM_STT_MODEL=saarika:v2.5` — env
only, no deploy. Note that a *translate* model (saaras v4 in translate mode) makes the
language pin inert and delivers Hindi speech to the LLM as English.

### 4.2 Google arm (`STT_PROVIDER=google`)

Streaming v2 on the **same GCP project/credentials as the Vertex LLM**, model `telephony`
(**not** `latest_long` — measured on real 8 kHz call audio, `latest_long` dropped most of
every utterance), location `global` (`chirp_2` only serves from us-central1 = a cross-ocean
hop per turn). Its one structural advantage: **interim results**, which Sarvam never sends —
the Smart Turn analyzer and the turn-gate both benefit.

Per memory of the A/B on real call audio, **Sarvam won**: its word accuracy was never the
problem; streaming endpointing was.

---

## 5. LLM — the conversation model

[`providers.build_llm`](../../voice_bot_service/app/providers.py). One switch,
`LLM_PROVIDER`, governs **both** the live conversation and the end-of-call analysis — they
must never diverge (a Sarvam-only analysis 401s forever on an OpenRouter deployment, and
every call degrades to `disposition=Incomplete`, which makes the classifier re-dial leads who
just had a full conversation).

| `LLM_PROVIDER` | Model | Params | Notes |
|---|---|---|---|
| `sarvam` (code default) | `sarvam-105b` via OpenAI-compatible `api.sarvam.ai/v1` | `temperature 0.35`, `max_tokens 300`, `extra_body.reasoning_effort = null` | The literal JSON **null** is the only value that disables hybrid thinking. 0.14 s median TTFT from Mumbai with it; 6–14 s (or `content=None`) without |
| `vertex` | Gemini on Vertex AI, `VERTEX_LOCATION=asia-south1` | same + `thinking_budget=0` | Thinking is **not** auto-disabled by pipecat. Measured same-region, same model: default thinking 2.16/2.43/2.55 s vs `budget=0` 0.37/0.51/0.91 s — 4.8×. Auth = service-account JSON. `gemini-2.5-flash-lite` is **not** served in asia-south1 (404 verified) |
| `google` | Gemini OpenAI-compat endpoint, direct | `reasoning_effort: "none"` | What the Mumbai box's `env.example` sets |
| `openrouter` | `google/gemini-3.1-flash-lite` | — | Proxy fallback; its routing lottery once spiked TTFT to 7.9 s |

**Which is live is per-deployment** — read `/opt/voice-bot/.env` on the box. The checked-in
`deploy/linode-mumbai/env.example` sets `LLM_PROVIDER=google`; `config.py`'s code default is
`sarvam`.

Two operational details:
- The LLM service is **pre-warmed at startup off the event loop** (`main._warm_llm` in a
  thread) because the Vertex constructor does a synchronous OAuth round-trip — ~1–2 s of
  loop blocking if done per call, audible as garble on concurrent calls.
- Analysis target mapping (`report._llm_target`): `google→google`, `openrouter→openrouter`,
  `vertex→**sarvam**` (a one-shot bearer-key HTTP call doesn't fit Vertex's refreshing OAuth),
  `sarvam→sarvam`.

---

## 6. TTS — text to speech (five engines)

Per-agent selectable (`ai_agent.tts_model`), built in `providers.build_tts`, catalogued in
[`TtsVoiceCatalog.java`](../../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/telephony/core/TtsVoiceCatalog.java)
— the **single backend source of truth** served to the UI via `GET /ai-agents/voices`.

| Engine | Model | Voices | Vendor cost | Credit surcharge | Notes |
|---|---|---|---|---|---|
| **`google`** | Cloud TTS **Chirp3-HD** (+ Neural2/WaveNet tiers) | 20 curated hi-IN | $30/1M chars ≈ **₹2.06/call-min** (measured 779 chars/call-min over 13 prod calls); 1M chars/month free | **0** | **`NEW_AGENT_DEFAULT`.** Founder's pick by ear; cheaper per minute than Sarvam. Auth reuses the Vertex service account — no new vendor |
| **`edge`** | Microsoft Edge read-aloud | 5 (2 hi-IN, 3 en-IN) | **free**, no key | **−3** (i.e. 2 AI + 1 voice = 3 credits/min vs the standard 6) | Hand-written pipecat service with **streaming MP3 decode** (0.67 s first audio vs 1.04 s buffered). Not offline — Microsoft's public endpoint, no SLA |
| **`smallest`** | Lightning v3.1 | 9 hi-IN | rate TBC against invoice | **0** | ⚠️ palettes are **per-model**; a `_pro` voice on the standard model is rejected outright = a silent call |
| **`rumik`** | Silk Mulberry 1.5 | 12 | ₹0.50/1k chars | **0** | Cheapest. Mispronounces some Hindi on the phone leg (`प्रतिशत` → "प्रतिलत"), which is why it lost the default |
| **`sarvam`** | bulbul:v3 | 38 | ₹3.00/1k chars | **+4/min** | The fallback when an agent has no `tts_model` — deliberately, because such an agent predates the picker, approved a Sarvam voice and is billed at the Sarvam rate |

### 6.1 Invariants the catalog exists to protect

1. **Palettes do not overlap.** A wrong-engine voice fails differently on each: Sarvam
   returns 400 (no audio at all), Rumik **silently substitutes a default speaker** — the
   quiet substitution is the more dangerous one, because the call sounds fine while the
   voice is not the one anyone chose and the Hindi verb gender was conjugated for the
   configured voice.
2. **Gender is load-bearing.** Hindi first-person verbs are gendered; the bot conjugates
   from a speaker→gender map. `TtsVoiceCatalog` and `bot.py`'s `_MALE_VOICES`/`RUMIK_VOICES`
   **must agree**.
3. **Case matters for Google only.** Google voice ids are case-sensitive
   (`hi-IN-Chirp3-HD-Achernar`); everything else is lowercase. Storing a lowercased Google id
   made the vendor reject it → fallback to Sarvam → Sarvam's default voice is **male**. A
   founder picked a female Chirp3-HD voice, saved it, and every call still came out male.
   `canonicalVoice()` now accepts any casing and stores the catalog's.

### 6.2 Engine-specific mechanics

- **Rumik** is a hand-written `InterruptibleTTSService`. Its socket is **request/response,
  strictly one at a time** — a second `{"text":…}` *cancels* the first, and pipecat sends one
  message per aggregated sentence, so the naive port truncated every multi-sentence reply to
  its last sentence. Hence a background sender loop that serialises sends and a
  `_pending_sends` counter that ends the bot's turn only when no sentence is outstanding.
  Its `_handle_interruption` deliberately does **not** call `super()` (which would close and
  re-mint the socket — the exact path Rumik was chosen to avoid).
- **Devanagari→Latin normalisation** (`normalize_for_rumik`) runs at the synthesis boundary
  for Rumik only, because a prompt rule failed twice to stop the LLM transliterating English
  product terms. Transcripts and LLM context keep the written form.
- **Sarvam `min_buffer_size`** defaults to *don't send* (server default 50). 30 produced
  audible seams; **20 is rejected by Sarvam's config validation and killed TTS on every
  call** (2026-07-20 silent-call outage). `build_tts` clamps any override to ≥ 30.
- **Every optional engine falls back to Sarvam on construction failure** — a misconfigured
  vendor must degrade to a working call in a different voice, never to a mute call.
- **Letterless input is skipped** (`has_word_char`): Sarvam rejects it with an error pipecat
  only logs, leaving an open-but-dead socket and 8–10 s of dead air.

### 6.3 Voice preview

`GET /voice-bot-service/preview.mp3?text&voice&lang&pace&temperature&model` routes to the
**same engine the call will use** — an audition that lies about what ships is worse than no
audition. Cached per engine+voice+pace+text (separately from the IVR `/tts` cache, which is
keyed by `sha1(text)` alone because the admin-core play URL depends on that contract).

---

## 7. The real-time pipeline

Pipecat **1.4.0** (`requirements.txt`), migrated 2026-08-05 from 0.0.95.

### 7.1 Processor chain (`bot.run_bot`, `bot.py:2089`)

```
transport.input()          Plivo <Stream>, 8 kHz μ-law
  → stt                    Sarvam saaras / Google STT
  → TranscriptCollector    records caller finals, filler ack, duck/absorb decisions
  → aggregators.user()     owns VAD + turn strategies + idle clock (1.4)
  → llm
  → SentinelGate           strips <<END_CALL>> / <<TRANSFER>>, drives stop/handoff
  → NoRepeatGate           suppresses a sentence already said this call, and trims
                           an opener that only parrots the caller (§7.3a)
  → tts
  → DuckGate               instant barge-in hold
  → transport.output()
  → PlayedTranscriptRecorder   what the caller ACTUALLY heard
  → aggregators.assistant()
```

`PipelineParams(audio_in_sample_rate=8000, audio_out_sample_rate=8000, enable_metrics=True)`
with a `TtfbObserver` feeding the latency reservoirs.

### 7.2 Turn-taking

- **VAD**: Silero, `stop_secs 0.2`, `start_secs 0.2`, `confidence 0.6`, **`min_volume 0.35`**.
  Pipecat's 0.6 default made the VAD *stone-deaf to phone-leg callers* on live call
  `8e1e00ad` — zero VAD onsets during bot speech, so the duck never engaged and the bot
  talked through every interruption. This was the single worst finding of the migration.
- **End of turn**: `LocalSmartTurnAnalyzerV3` (semantic, ~12 ms CPU) with
  `SMART_TURN_STOP_SECS=1.5` as the hard ceiling.
- **Start strategies**: VAD onset (**interrupts**, `INTERRUPT_ON_VAD=true`) + transcription
  with interims (**never** interrupts on its own).
- **Why VAD interrupts, reversed from the duck-only design:** by the time the caller speaks,
  the reply has already flowed past the duck into pipecat's output queue and Plivo's buffer.
  Live call `d6e82def` logged "dropping 0 held frame(s)" on an interrupt; probed talk-over
  was **1.96 s**. Only a flush empties those.
- **`AGG_TIMEOUT_SECS=0.08`** — measured over 141 turns, Sarvam's final trails local VAD stop
  in 85% of turns, so the aggregation wait is pure additive delay.
- **Audio lead cap** (`AUDIO_MAX_LEAD_SECS=0.3`, `main._cap_audio_lead`): pipecat's websocket
  output paces at **twice real time**, so Plivo accumulates up to ~half the reply (10 s on a
  20 s pitch). The patch bursts until 0.3 s of cushion, then tracks real time — so ducking
  actually silences the line, and `BotStoppedSpeaking` stops firing half a reply early
  (which was skewing every dead-air measurement).

### 7.3 Barge-in: "absorb but never lose"

`DuckGate` holds bot audio at VAD onset. When the transcript arrives,
[`turntake.mid_reply_action`](../../voice_bot_service/app/turntake.py) decides:

- **ABSORB** — a bare acknowledgment (`haan`, `achha`, `theek hai`, `hello`, Devanagari *and*
  romanized, both scripts because saaras emits either): the reply resumes and the words are
  appended to the LLM context **without a generation**, so consent said mid-pitch still counts.
- **INTERRUPT** — anything else (a question, a negation, a real one-word answer like "IGCSE").

`hello` moved into the absorb list after call `77cb4b47`: interrupting doesn't restore the
caller's audio, it cancels the sentence and the model re-asks from the top — the founder heard
the same opening four times in eleven seconds in a self-feeding loop.

Related knobs: `DUCK_NO_WORDS_RESUME_SECS=2.0`, `DUCK_MAX_HOLD_SECS=12.0`,
`BACKCHANNEL_CARRY_SECS=3.0`, `BACKCHANNEL_EXTRA` (per-deployment word list).

### 7.3a Never say it twice — and never say it back (`NoRepeatGate`)

Two trims between the LLM and the TTS, both in code rather than the prompt for the
same measured reason: **four prompt-level attempts at this class of repetition were
each measured over 3+ live conversations and moved nothing** — style rules
(1.7 → 1.7 repeats, and they broke script and gender), no-echo rules with
GALAT/SAHI examples (3.0 → 3.0), deleting the scripted acknowledgement lines the
model was parroting (2.7 → 2.7), swapping the model (1.0 → 0.3, reverted for
latency). At ~10 K characters the prompt is saturated; "what have I already said"
is state, and state belongs in code.

| Trim | What it drops | Key state |
|---|---|---|
| **No-repeat** | a sentence already spoken this call (fuzzy, 0.80) or a question whose *topic* was already asked (`question_topic` — paraphrases score ~0.6 and sailed through similarity alone) | `_spoken`, `_asked`, `_suppressions` |
| **No-echo** (`_trim_echo` → `turntake.strip_echo_opener`) | a leading **clause** that only restates what the caller just answered | the caller's last turn + the bot's own last question |

**The ban is bounded, and that bound is load-bearing.** It used to be permanent, and
that is what destroyed call 3148ccd4 (2026-08-13, the worst call in the logs). The bot
asked *"Raman abhi kaun si class mein hai?"* once; the caller — still working out who was
calling — never answered; the gate then blocked **all six** attempts to ask again. Twenty
sentences were suppressed, the bot fell through to its handback line **seven times**, and
the caller spent the last forty-five seconds asking *"मैं क्या बताऊँ?"* — *what am I
supposed to tell you* — before hanging up. Latency was fine throughout (LLM 0.18–0.32 s,
TTS 0.14–0.39 s): the bot was not slow, it was **gagged**.

So `_MAX_SUPPRESSIONS = 2`. The model holds the whole conversation in its context; if it
asks the same thing a third time across three separate turns it is not being sloppy, it is
reporting that the answer never arrived (`ANSWER_DELETED` fired on that very call,
confirming it). Being wrong costs one repeated question; being right saves the call. The
counter resets on release, so a model stuck in a loop still only gets one attempt in three.

Two more guards from the same call:

- **Never hand back twice running.** Every handback line means *"you talk"*, from the party
  that placed the call. After one, the held sentence goes out instead — repeat and all,
  because it is almost always the question the caller never answered.
- **Handbacks follow the agent's language** (`_HANDBACK` / `_HANDBACK_EN`). They never pass
  through the LLM, so the prompt's SCRIPT rule cannot reach them, and an English agent was
  handing back in romanized Hindi (*"Ji, boliye."*).

`handbacks` and `repeatEscalations` ride the diagnostics blob, and a run of handbacks now
fires `HANDBACK_LOOP` (§11.3) — before this, twenty suppressions and seven handbacks
produced **no signal at all**.

Echo-trimming is **clause**-level, not sentence-level, because the parroting and
the real next question share one sentence — *"ओके, सुबोध अभी आठवीं क्लास में है, तो
लास्ट exam में कितने marks आए थे?"* — so dropping the sentence would drop the
question with it. What survives is whatever the bot **added**: the caller's marks
go, *"बहुत बढ़िया स्कोर है"* stays.

A clause is parroting when ≥60% of its content words (function words and
acknowledgments removed) already appear in the caller's answer or the bot's own
question — i.e. it introduces nothing. It refuses to touch: a clause containing a
question, a clause with 2+ digit groups (the **required** phone/date read-back),
anything at all when the caller was **asking** rather than answering (reflecting a
question back is wanted behaviour), the last remaining clause, or a tail too thin
to stand alone. Counted as `diagnostics.turnTaking.echoesTrimmed`; kill switch
`NO_ECHO_ENABLED=false`.

> A high `echoesTrimmed` is not a bug report — it is the model reaching for the
> restatement anyway, which is the evidence that the trim has to live in code.

### 7.4 Sentinels (no dependency on provider tool-calling)

| Marker | Effect |
|---|---|
| `<<END_CALL>>` | say the farewell, then stop the task; Plivo's `<Redirect>` hangs up. Held open for `END_GRACE_SECS=2.0` — a caller who answers *after* the goodbye cancels the close (a demo booking was once lost to our own hangup) |
| `<<TRANSFER>>` | `POST /internal/voice-bot/handoff` → admin_core stores the target on the call-log row → bridge line → stop; Plivo's `<Redirect>` then `<Dial>`s |

### 7.5 Watchdog & guards (`callstate.py`, pure + testable)

Decisions: `NUDGE`, `IDLE_HANGUP`, `ORPHAN_ASK`, `STALL_RECOVER`, `CAP_FAREWELL`,
`HEARING_FAILED`, `DUCK_RESUME`, `REISSUE_STOP`, `CANCEL_STARVED`.

| Guard | Default | Purpose |
|---|---|---|
| Idle nudge → hangup | `IDLE_TIMEOUT_SECS=8`, `MAX_NUDGES=2` | clock only runs while the bot is quiet and the caller is not mid-utterance |
| TTS stall recovery | `STALL_AFTER_SECS=3.5`, `STALL_MAX_RECOVERIES=3` | reconnect + re-say; kill-switch `STALL_RECOVERY_ENABLED` |
| Deaf streak | `MAX_DEAF_STREAK=2` | stop apologising and close honestly (a call once apologised four times for the same unheard phrase) |
| Reply in flight | `REPLY_INFLIGHT_GRACE_SECS=6` | closes the 0.5–1 s hole between "LLM started" and "bot audible" where a second final once made the bot deliver its whole pitch **twice** |
| Machine-greeting window | `MACHINE_GREETING_WINDOW_SECS=22` | how long an operator/voicemail recording is still plausible |
| No-repeat gate | `NO_REPEAT_ENABLED=true` | suppresses a sentence already said this call |
| Max call minutes | agent value, else 10 | bounds telephony + AI spend on a runaway conversation |

### 7.6 Admission control & abuse bounds (`main.py`)

- `MAX_CONCURRENT_CALLS=10` (sized for a 1 vCPU / 2 GB box). Over cap, `/answer` serves a
  spoken "all lines busy" + `<Redirect>` instead of opening a `<Stream>` it would have to drop.
- `/answer` mints a **single-use HMAC token** (`VOICE_BOT_CLIENT_SECRET`, 900 s TTL) that
  `/ws` verifies and spends. Pre-handshake sockets are counted in a **separate** bucket
  (cap = 3× + 5) so stalled handshakes cannot starve running calls.
- Public `/tts` + `/preview` write to disk, so the cache is bounded (`TTS_CACHE_MAX_FILES=4000`,
  `TTS_CACHE_MAX_BYTES=500 MB`) with previews evicted before IVR prompts, LRU by *serve* time.

### 7.7 Latency budget (measured, from code comments)

| Stage | Where it stands |
|---|---|
| VAD stop | 0.2 s (Smart Turn decides the real end) |
| STT final | Sarvam server endpointing ~0.65–0.76 s; held at most `SARVAM_TTFS_P99=0.5` past VAD stop |
| Aggregation | 0.08 s |
| LLM TTFT | Sarvam-105b ~0.14 s median (thinking off) · Vertex Gemini 0.37–0.91 s (`thinking_budget=0`) · **2.16–2.55 s if thinking is left on** |
| TTS TTFB | Chirp3-HD 0.18 s · Edge 0.27 s · Rumik 0.295 s · Sarvam ~0.20 s median but **4.5 s p95** |
| Greeting | `GREET_DELAY_SECS=0.8` after pickup |
| Filler mask | `FILLER_PROBABILITY=0.10`, phrase `Hmm…` only (0.7 → 0.25 → 0.10 as latency improved; "Achha/Okay" sounded like complete replies) |

---

## 8. End-of-call analysis → lead outcome

### 8.1 The analysis call (`report._analyze`)

One non-streaming chat completion over the transcript, `temperature 0.1`, `max_tokens 500`,
on the provider `_llm_target` resolves (§5). The prompt injects **RIGHT NOW** (agent
timezone, default `Asia/Kolkata`) so relative times ("kal shaam") resolve to a concrete ISO
instant, and constrains the answer to the **agent's own disposition vocabulary**.

Returned JSON: `disposition`, `summary` (2–3 sentences), `leadRating` (1–10 or null),
`extractedQa` (only what was actually said), `callbackRequested`, `callbackTimeText`,
`meetingRequested` (true **only** if a specific day/time was agreed), `meetingDatetimeIso`,
`meetingDatetimeText`, `meetingType`.

Two guards that matter:
- **`REPORT_REQUIRE_CONVERSATION=true`** — a call with zero real caller turns is forced to
  `Incomplete` and the analysis is skipped entirely. 23 live calls where the caller
  contributed no words had been given `Not_Interested`/`Wrong_Person`, and ~17% of dials are
  answering machines (this also saves the LLM round trip on them).
- An unparseable/failed analysis degrades to `Incomplete` **rather than dropping the report** —
  a missing report strands the paused CALL_AI workflow until its safety timeout.
- Synthetic bracketed turns (`[unclear sound from the caller]`) never count as caller speech.

### 8.2 The report contract

`POST {admin_core}/v1/telephony/webhook/ai-voice/VACADEMY_AI?instituteId=&token=` with
`call_uuid`, `correlationId`, `direction`, `campaignType`, `campaignId`, `status`
(`completed` / `no-answer` / `failed`), `durationSeconds`, `callStart`, the analysis fields,
`transferAttempted`/`transferStatus`, `systemError`, **`diagnostics`** (§11), `transcript`,
`phoneNumber`, `customerName`, `callRetry`, and `metadata.{correlationId, subjectType,
subjectId, reportGeneratedAt}`.

`status` is honest by construction: `completed` only if the caller said real words; a
pipeline crash before anyone spoke is **`failed`**, never `no-answer` (an unknown status
would be stamped `COMPLETED` on the call log by `mapStatus`).

**Delivery is durable.** Two inline attempts (2 s apart), then the report **spools to disk**
under the mounted tts-cache volume and a sweeper retries every 60 s. Max age is deliberately
short (20 min, `REPORT_SPOOL_MAX_AGE_SECS`): admin_core applies decisions with no recency
guard, so a stale no-answer landing after a newer call would regress the lead. Past that,
the file is parked as `.dead` with a CRITICAL log. Spooled reports are replayed
**oldest-first** by `spooledAt`.

### 8.3 Receiver → outcome

1. [`AiVoiceWebhookService`](../../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/telephony/core/AiVoiceWebhookService.java) —
   NaN-sanitises, accepts object or array, resolves the provider's parser, upserts
   `ai_call_result` (idempotent on `provider + call_uuid`).
2. [`AiCallOutcomeProcessor`](../../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/telephony/core/AiCallOutcomeProcessor.java) —
   resolves the lead (outbound: `correlationId`; inbound: phone), promotes/upserts the
   `telephony_call_log` row, reads `AI_CALLING_SETTING`, classifies, acts, stamps lead
   status (`AI_QUALIFIED` / `AI_NOT_INTERESTED` / `AI_NO_ANSWER` / `AI_RETRY_PENDING` — only
   if the institute's catalog has the key), resumes paused workflows, auto-books the meeting
   when the agent has a booking page, copies the recording, triggers billing.
3. [`AiCallOutcomeClassifier`](../../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/telephony/core/AiCallOutcomeClassifier.java) — pure:

| Situation | Action |
|---|---|
| AI calling disabled | `NONE` |
| Not connected (`status != completed`, or duration < `connectThresholdSec`) | `RETRY` while `priorAttempts < maxRetries`, else exhausted |
| Disposition in `assignOnDispositions` | `ASSIGN` |
| Disposition in `stopOnDispositions` | `STOP` |
| `Callback` / `Incomplete` | `RETRY` / exhausted |
| Disposition the **agent** defined but the institute didn't map | terminal — `ASSIGN` if `assignExhaustedToHuman`, else `STOP` (never re-dial someone who fully answered) |
| Truly unmapped | `RETRY` / exhausted |
| Exhausted | `ASSIGN` if `assignExhaustedToHuman`, else `STOP` |

---

## 9. Call Intelligence (the other analysis pipeline)

Distinct from §8: this transcribes and scores **recordings** (human counsellor calls
*and* AI calls), and runs in `ai_service`.

```
recording lands in our storage (recording_storage_key set)
  → CallIntelligenceEnqueueService  (admin_core; best-effort, idempotent on call_log_id)
      gates: institute enabled · source enabled · min duration · connected-only (opt-out)
  → PENDING row in call_intelligence
  → ai_service poller claims it
      → transcribe (render worker, "small" model — best for Hindi/English code-switching;
        25-min cap per job)
      → credit check → LLM structured analysis (prompt + schema versioned)
      → deduct credits + write results
```

Credits: `request_type=call_intelligence`, **per-minute** (`credit_pricing.token_rate`, seeded
5.0, floor 5.0), charged only on success, idempotent on `call_log_id`. No balance ⇒
`SKIPPED/INSUFFICIENT_CREDITS` and nothing is transcribed. Files:
`ai_service/app/services/call_intelligence_{service,poller,prompt}.py`,
`admin_core .../features/call_intelligence/**`. Deeper treatment in
[`CALL_INTELLIGENCE.md`](./CALL_INTELLIGENCE.md).

---

## 10. Credits & billing

### 10.1 Two meters per physical call

[`CallBillingService`](../../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/telephony/core/CallBillingService.java)

| Meter | `request_type` | Billed for | Providers |
|---|---|---|---|
| **Voice leg** (telephony minutes) | `voice_call_out` / `voice_call_in` | calls carried on **Vacademy-provided trunks** | `PLIVO`, `VACADEMY_AI` |
| **AI leg** (STT+LLM+TTS minutes) | `ai_call_out` / `ai_call_in` | AI-conversation minutes off the **verified** `ai_call_result` | `VACADEMY_AI`, `AAVTAAR` |

Airtel/Exotel/Vonage ride the institute's own carrier account and are never billed;
`MOCK`/`MANUAL` never are. An outbound AI call pays **voice + AI**; an inbound IVR call
answered by a human pays voice only; the same call answered by the AI pays both.

### 10.2 Rates (all DB-tunable)

Global `credit_pricing` (V378): `voice_call_*` **1.0 credit/min**, `ai_call_*` **5.0
credits/min**, `minimum_charge 0`. Calibration: 1 credit ≈ ₹0.56.

Per-engine surcharge `ai_tts_model_pricing` (V421/V426/V430/V431):

| Engine | Surcharge | All-in (voice + AI) |
|---|---|---|
| `edge` | **−3.0** | 3 credits/min |
| `rumik`, `google`, `smallest` | 0.0 | 6 credits/min |
| `sarvam` | **+4.0** | 10 credits/min |

Per-institute overrides live in `institutes.setting_json → VOICE_CALLING_SETTING.data.billing`
and are **ops-only** (the tenant-facing save endpoint preserves the stored block — a tenant
zeroing their own rates would mean free calls). An override is treated as a **negotiated
all-in price**, so engine surcharges are *not* stacked on top of it.

`cost = max(minimum_charge, ceil(duration/60) × (perMinute + surcharge))`, floored at zero
(a discount can never refund credits), 4 dp.

**Pricing is against the agent's *configured* engine, not the engine that actually spoke.**
If our own fallback swaps engines mid-incident, that is our problem, not the customer's bill;
the diagnostics field is the audit trail for spotting the mismatch. An unresolvable agent
resolves to `sarvam` — and this must stay in lockstep with the bot's own fallback for a
missing `tts_model`, or we would serve one engine and charge for another.

### 10.3 At-least-once, exactly-charged

Deduction goes through `CreditClient.deductPrecomputed` → ai_service `POST /credits/v1/deduct`
with `precomputed_credits`, `allow_negative=true` (post-paid — the call already happened) and
an **idempotency key** enforced by a partial unique index (V243), so any number of attempts
charge once. Key preference: provider `call_uuid` → the call-log id, but only when the row
provably pre-dates the report (never the id of a row the promotion itself created — an
unbindable report would otherwise charge once per webhook re-delivery).

On success the source row is stamped `credits_billed_at`;
`CallBillingReconciliationJob` sweeps unstamped completed rows every **10 min** (initial delay
2 min) so a lost HTTP call is healed instead of silently leaking revenue.

### 10.4 Other AI-calling charges

| What | Cost |
|---|---|
| Agent prompt assist (draft/analyze/improve/feedback) | 1 credit (`content`) |
| Call Intelligence | 5 credits/min, floor 5 (`call_intelligence`) |
| Per-call transcript + AI analysis from the Call Log row | 5 credits (see [`call-log-row-actions`] behaviour in the Call Log UI) |

---

## 11. Logs, diagnostics & observability

### 11.1 Where the logs physically are

| Service | Location | Retention |
|---|---|---|
| voice bot | Mumbai Linode, `docker compose logs -f voice-bot` (json-file driver) | **20 MB × 5 files** — i.e. minutes-to-hours under load. Container restarts have destroyed evidence before a call could be diagnosed; this is exactly why the diagnostics blob travels with the report |
| Caddy (TLS/WS ingress) | same box | 10 MB × 3 |
| admin_core / ai_service | Singapore k3s | `kubectl logs deploy/admin-core-service` |

`GET /voice-bot-service/health` → `{status, activeCalls, maxConcurrentCalls, ws}`.

### 11.2 Log lines worth knowing (voice bot)

| Line | Meaning |
|---|---|
| `answer XML served corr= agent= record=` | Plivo fetched the answer XML |
| `ws connected corr= transport= call= active=` | pipeline starting; `active` = concurrency |
| `setup timing corr= ctx_fetch=` | how long the call-context fetch took |
| `dead air %.1fs — bot was <cause> corr=` | a silence > 2.5 s, with *what the bot was doing* (`ducked`, `awaiting_playout`, `caller_speaking`, `after_caller_turn`, `both_quiet`) |
| `rumik: …` / `tts: …` | per-engine socket lifecycle, cancels, fallbacks |
| `sentinel: caller re-engaged after farewell` | the end-grace latch saved a call |
| `report posted corr= ok= disposition= status=` | the terminal line for every call |
| `report spooled for retry corr= -> path` / `spool: report UNDELIVERABLE past max age` | webhook delivery trouble |
| `ws-token: replay rejected` / `at capacity` | admission control |

### 11.3 The per-call diagnostics blob

[`diagnostics.py`](../../voice_bot_service/app/diagnostics.py) collects cheap per-turn
counters and derives a **pure verdict**, shipped as `report.diagnostics` and stored verbatim
in `ai_call_result.diagnostics` (jsonb).

**Honesty discipline (the whole point):** a signal we could not measure is `null`, **never 0**.
`answersDeleted: null` means *not measured* and the UI must render it that way.

Fault codes (closed, append-only; `RULES_VERSION` bumps when thresholds change):

| Code | Fires when | Headline shown |
|---|---|---|
| `CRASH` | pipeline exception | Pipeline crashed mid-call |
| `BOT_SILENT` | caller spoke, bot produced zero audio | The agent never spoke |
| `STT_DEAF` | hearing failures ≥1, STT reconnects ≥3, or VAD heard speech and we transcribed nothing | The agent could not hear the caller |
| `REPLY_LOOP` | ≥3 consecutive near-identical bot turns (fuzzy, 0.82 similarity) | The agent kept restarting the same reply |
| `HANDBACK_LOOP` | ≥3 handbacks (RED) / ≥2 (AMBER) — replies suppressed *whole*, so the caller got "you talk" instead of an answer (§7.3a) | The agent had nothing to say and kept asking the caller to talk |
| `TTS_WEDGE` | stalls ≥2 / cap hit / stall + silent generation | Voice synthesis stalled |
| `REPLY_UNPLAYED` | a generated reply never reached the caller | A reply was never played |
| `ANSWER_DELETED` | caller finals that never reached the LLM context **and carried something** — see the scrap carve-out below | Caller answers were discarded |
| `DEAD_AIR` | worst gap ≥6 s (RED) / ≥3.5 s (AMBER) — **only in a real conversation** | Long silence |
| `FALSE_REASK` | re-asked for something already heard | — |
| `LIKELY_MACHINE` | bounded 0–1 heuristic ≥0.7 | Probably an answering machine (**inferred, never changes disposition**) |
| `SLOW_TTS` / `SLOW_LLM` | p95 > 3 s (RED) / >1.5 s (AMBER), min 5 samples | — |
| `TRANSFER_FAILED`, `PROMPT_UNFILLED` | transfer requested but not registered; unresolved prompt placeholders | — |

Payload sections: `tts` (wedges, stalls, TTFB p50/p95/max, vendor, **vendor credits + metered
requests + chars**), `playout`, `turnTaking` (barge-ins, cancels, ducks/absorbs, orphan
re-asks, nudges, idle hangup, answers deleted **+ verbatim samples**), `silences` (seconds +
cause), `latency` (LLM/STT TTFB, dead-air p95/max), `setup` (greet path/delay, setup secs),
`machine` (score, markers, first/longest user turn), `infra` (STT reconnects, unheard
utterances, crash, transfer state).

`split_lost()` is the ground truth behind `ANSWER_DELETED`: it diffs the finals the
`TranscriptCollector` saw (it sits *before* the aggregator) against what actually reached the
LLM context. The 2026-07 forensics found **179 deleted caller utterances across 40% of
calls** — including literal answers ("IGCSE", "Symbiosis", "Monday") that nothing ever
re-asked for. (`reconcile_answers()` is still there as the answers-only view of it.)

**What it never reached is the MODEL** — a discarded answer *is* in the transcript and the
report, because `heard` is derived from `outcome.transcript`, which `report.py` posts verbatim.
The panel used to claim "never reached the agent, the transcript or the report", which was
wrong in two of the three.

**The sub-word scrap carve-out (`RULES_VERSION` 3, 2026-08-12).** Every unmatched final used
to count as a discarded answer, and one live call went AMBER on a single lost final whose
entire text was `"वो।"` — one syllable of an utterance the caller broke off. That was
structural, not luck: `_norm_answer` keeps only alphanumerics and Devanagari vowel signs are
not alphanumeric, so `"वो।"` is the single character `"व"`, below `_CONTAIN_MIN_CHARS` where
pass 2 is off. **Below that floor a final could never be matched, so the guard against a false
*match* had become a guaranteed false *fault*.** Now `_lost_carries_meaning` splits the losses:

| Bucket | What lands here | Fires |
|---|---|---|
| `answersDeleted` | a phrase (2+ words), a digit (`"94"`), consent or refusal (`"हाँ"`, `"नहीं"` — "absorb but never lose" exists for exactly these), a question, or any single word over one character | `ANSWER_DELETED` |
| `fragmentsLost` | a one-character scrap and nothing else | nothing — **evidence only**, like `LIKELY_MACHINE` |

The floor is **one** character, deliberately not the containment floor of four: genuine
one-word answers normalize short too (`"SSC"` 3, `"DPS"` 3, `"आठवीं"` 3, `"पाँच"` 2), and the
first version of this fix reused 4 and was caught by the existing multiset test doing exactly
that. Scraps stay in the payload and on the page — a measured loss must never be hidden — just
not as a fault, and not called an answer.

### 11.4 Where a human sees all this

- **CRM → Calling → Call Log** (`frontend-admin-dashboard/src/routes/audience-manager/call-log/`):
  per-row green/amber/red health dot with the headline on hover, and a full
  `CallHealthSheet` (verdict, numbers, timings, deleted answers verbatim, raw JSON to copy).
  Backed by `GET /v1/telephony/calls/{id}/detail`, which serves the *verdict* to any
  dashboard viewer but withholds the full blob unless the caller holds `VIEW_CALL_NUMBERS`
  (it contains verbatim caller speech).
- **Live status**: `GET /v1/telephony/calls/{callLogId}/events` (SSE).
- **Search / metrics / export**: `POST /v1/telephony/calls/{search,metrics,export}`.
- **Per-call transcript + AI panel** on the Call Log row (Call Intelligence).

---

## 12. Data model

| Table | Purpose | Notable columns |
|---|---|---|
| `ai_agent` | the persona registry | §3.1; `tts_model` (V421), `pace`/`temperature` (V379), `booking_page_id` |
| `ai_tts_model_pricing` | per-engine credit surcharge | `model` PK, `surcharge_credits_per_min`, `is_active` |
| `telephony_call_log` | one row per physical call; **`id` = `corr`** | `provider_type`, `provider_call_id`, `response_id`, `user_id`, `counsellor_user_id`, `direction`, `status`, `duration_seconds`, `recording_url`/`recording_storage_key`/`recording_private`, `ai_handoff_target`, `disposition_*`, `credits_billed_at`, `raw_payload_json` |
| `ai_call_result` | the landed AI report | `provider`+`call_uuid` (unique), `correlation_id`, `campaign_id`, `status`, `disposition`, `lead_rating`, `ai_summary`, `extracted_qa` (jsonb), `metadata` (jsonb), **`diagnostics`** (jsonb), `processing_status`, `credits_billed_at` |
| `call_intelligence` | recording analysis queue + results | unique on `call_log_id`; `status`, rubric outputs |
| `credit_pricing` | global rates | `request_type`, `token_rate` (credits/min here), `minimum_charge` |
| `institutes.setting_json` | per-institute settings | `AI_CALLING_SETTING`, `VOICE_CALLING_SETTING` (incl. ops-only `billing`), `CRM_INTELLIGENCE_SETTING` |
| `institute_telephony_config` | the carrier accounts — **one row per (institute, `role`)** since V448 | `role` (`PRIMARY` \| `AI_VOICE`), `provider_type`, `provider_secrets_enc`, `provider_config` (an AI line's `callerId` lives here, **not** in `telephony_provider_number` — §2.5), `webhook_token_enc`, `enabled` |

Relevant migrations: V345 (call intelligence), V354 (handoff target), V378 (call credit
rates + `credits_billed_at` + sweep indexes), V379 (voice tuning), V421 (`tts_model` +
`ai_tts_model_pricing`), V426 (google/smallest pricing), V429 (voice rate card),
V430/V431 (edge pricing + discount), **V448** (`institute_telephony_config.role` +
`UNIQUE(institute_id, role)` — the AI carrier split, §2.5).

---

## 13. Configuration reference

### 13.1 Voice bot env (`voice_bot_service/app/config.py` — every field is env-overridable)

**Identity / plumbing**: `PUBLIC_BASE`, `ADMIN_CORE_BASE`, `VOICE_BOT_CLIENT_NAME`,
`VOICE_BOT_CLIENT_SECRET`, `MAX_CONCURRENT_CALLS=10`, `TTS_CACHE_DIR=/tmp/tts-cache`,
`TTS_CACHE_MAX_FILES=4000`, `TTS_CACHE_MAX_BYTES=500MB`, `TTS_PROMPT_SAMPLE_RATE=44100`
(**must** be 44.1/48 kHz — 8 kHz forces MPEG-2.5 which Plivo renders as silence).

**STT**: `STT_PROVIDER=sarvam`, `SARVAM_STT_MODEL=saaras:v4`, `SARVAM_STT_MODE=transcribe`,
`SARVAM_STT_LANGUAGE=hi-IN`, `SARVAM_STT_HIGH_VAD=true`, `SARVAM_TTFS_P99=0.5`,
`GOOGLE_STT_{LANGUAGE=hi-IN,MODEL=telephony,LOCATION=global}`.

**LLM**: `LLM_PROVIDER=sarvam`, `SARVAM_LLM_MODEL=sarvam-105b`, `GEMINI_API_KEY`,
`GOOGLE_LLM_MODEL=gemini-3.1-flash-lite`, `VERTEX_{PROJECT_ID,LOCATION=asia-south1,MODEL=gemini-2.5-flash,CREDENTIALS_JSON|PATH}`,
`VERTEX_THINKING_BUDGET=0`, `OPENROUTER_*`.

**TTS**: `TTS_MODEL=sarvam` (fallback only), `SARVAM_TTS_MODEL=bulbul:v3`,
`SARVAM_TTS_VOICE=priya`, `SARVAM_TTS_MIN_BUFFER=0`, `TTS_PACE=1.1`, `RUMIK_API_KEY`,
`RUMIK_VOICE=ira`, `RUMIK_TERM_MAP`, `GOOGLE_TTS_{VOICE=hi-IN-Chirp3-HD-Achird,LANGUAGE,SPEAKING_RATE=1.05,SAMPLE_RATE=24000}`,
`SMALLEST_{API_KEY,MODEL=lightning_v3.1,VOICE=devansh,SAMPLE_RATE}`, `EDGE_TTS_VOICE=hi-IN-SwaraNeural`.

**Turn-taking**: `VAD_STOP_SECS=0.2`, `VAD_START_SECS=0.2`, `VAD_CONFIDENCE=0.6`,
`VAD_MIN_VOLUME=0.35`, `AGG_TIMEOUT_SECS=0.08`, `SMART_TURN_STOP_SECS=1.5`,
`INTERRUPT_ON_VAD=true`, `DUCK_ENABLED=true`, `DUCK_NO_WORDS_RESUME_SECS=2.0`,
`DUCK_MAX_HOLD_SECS=12.0`, `BACKCHANNEL_CARRY_SECS=3.0`, `BACKCHANNEL_EXTRA`,
`AUDIO_MAX_LEAD_SECS=0.3`.

**Call shape**: `GREET_DELAY_SECS=0.8`, `IDLE_TIMEOUT_SECS=8.0`, `MAX_NUDGES=2`,
`END_GRACE_SECS=2.0`, `MAX_DEAF_STREAK=2`, `MACHINE_GREETING_WINDOW_SECS=22`,
`FILLER_PROBABILITY=0.10`, `FILLER_PHRASES=Hmm…`, `AMBIENCE_ENABLED=true`, `AMBIENCE_VOLUME=0.15`, `AMBIENCE_DRIFT_DB=2.0`,
`VOICE_EQ_ENABLED=true` (300 Hz high-pass + 1.7 kHz presence on the bot voice, so it sits in
the caller's telephone band — see the service README)
(room tone under every call — voice_bot_service/assets/call_center_ambience_8k_mono.wav, see the
service README), `NO_REPEAT_ENABLED=true`,
`NO_ECHO_ENABLED=true` (§7.3a — drop an opener that only parrots the caller's answer),
`WARM_QUESTIONS_ENABLED=true` (prompt rule for every agent: cushion a question with one
clause of assumption/reason/their-last-answer instead of firing it bare — founder feedback
2026-09-08, "it's asking questions as if she is my mother"),
`PROSODY_EXPAND=1.0` (box default for voice modulation — pitch-range expansion applied to the
bot's audio by `app/prosody.py`, engine-agnostic; the per-agent "Voice modulation" setting in
the dashboard (`ai_agent.voice_modulation`, V504) overrides it — Off 1.0 / Subtle 1.3 /
Conversational 1.6 / Lively 2.0; see the service README),
`PROSODY_HINTS_ENABLED=true` (prompt rule for every agent: one '...' before the key phrase and
at most one '!' per reply, so the TTS — which has no prosody knobs — gets a pitch contour from
the text; +15% pitch spread measured on Smallest/mrunal — client feedback 2026-09-11, "the tone
is very linear, bot like"),
`REPLY_INFLIGHT_GRACE_SECS=6.0`, `REPORT_REQUIRE_CONVERSATION=true`,
`REPORT_SPOOL_MAX_AGE_SECS=1200`.

**Watchdog**: `STALL_AFTER_SECS=3.5`, `STALL_MAX_RECOVERIES=3`, `STALL_RECOVERY_ENABLED=true`,
`STOP_REISSUE_EVERY_SECS=3.0`, `ORPHAN_*`, `UNPLAYED_CONFIRM_SECS=3.0`,
`NO_WORDS_TIMEOUT_SECS=30`.

> ⚠️ `config.py` warns: **remove any `VAD_STOP_SECS=0.5` override** left on the box/k8s from
> the 0.0.95 era — end-of-turn is Smart Turn's job on 1.4 and a long window just delays it.

### 13.2 admin_core properties

`telephony.vacademy-ai.bot-base-url` (a.k.a. `VOICE_BOT_BASE_URL` — the cutover knob),
`telephony.webhook.callback-base`, `telephony.ivr.tts-base-url`,
`telephony.ai.credit-gate.enabled=true`, `telephony.ai.max-calls-per-day-default=500`,
`aavtaar.dispatch.dedup-window-sec=30`, `ai.service.url`, `ai.service.internal-token`.

### 13.3 Per-institute settings

`AI_CALLING_SETTING`: enabled, provider, default campaign, `assignOnDispositions`,
`stopOnDispositions`, `maxRetries`, `retryGapMinutes`, `connectThresholdSec`,
`maxCallsPerDay`, `assignExhaustedToHuman`, `showInLeadList`.
`VOICE_CALLING_SETTING.billing`: the ops-only per-minute overrides.
`CRM_INTELLIGENCE_SETTING`: Call Intelligence enablement, sources, min duration, rubric.

---

## 14. Failure modes & runbook

| Symptom | Most likely cause | Where to look |
|---|---|---|
| **Caller hears nothing at all** | TTS construction/signature mismatch (the 1.4 migration shipped a mute bot this way), missing vendor key | `BOT_SILENT` fault; bot log `tts:`/`rumik:` lines; check the agent's `tts_model` vs configured keys |
| **8–10 s of silence mid-call** | wedged TTS socket (letterless chunk, Sarvam reject) | `TTS_WEDGE`, `tts.wedges`/`stalls`; `dead air … awaiting_playout` |
| **Bot talks over the caller** | VAD deaf on the phone leg | `VAD_MIN_VOLUME` (must be ~0.35), `turnTaking.bargeIns = 0` with long user turns |
| **Bot repeats the same opening** | reply cut then regenerated in a loop | `REPLY_LOOP`, `maxReplyRestarts`; check absorb list for the word the caller used |
| **Caller says "why aren't you saying anything?" / "what am I supposed to tell you?"** | the no-repeat gate suppressed whole replies and the bot fell through to "you talk" (§7.3a) | `HANDBACK_LOOP`, `turnTaking.handbacks`; bot log `no-repeat: dropping already-said` — the sentence dropped most often is the question the call needed |
| **Caller says "you never told me who you are"** | the opening was VAD-interrupted seconds in, but the FULL text was already committed to the LLM context, so `already_said_rule` then forbids re-introducing | bot log `greet: openingLine spoken at +Ns` vs a `broadcasting interruption` right after; a greet later than ~2 s invites the caller's "hello?" that cancels it |
| **"It never heard my answer"** | aggregator deleted the turn | `ANSWER_DELETED` + `answersDeletedSamples` |
| **Bot confirms every answer back ("okay, you got ninety-four")** | the model reaches for a restatement opener on every turn; the prompt rule alone does not hold it | `turnTaking.echoesTrimmed` — if it is climbing the trim is working; if it is 0 and the parroting is audible, check `NO_ECHO_ENABLED` and whether the authored agent script *itself* contains echo lines (a registry prompt ≥600 chars is authoritative, §3.3) |
| **Caller hears a HUM / steady tone, then silence; Call Health says "agent's audio wasn't ready (15-19s)"** | Smallest lightning_v3.1_pro returns a ~200 Hz drone (up to 72 s for one sentence) when ENGLISH text is tagged `language: hi` — short interjection openers ("Perfect.", "Got it.", "Ah, okay…") trigger it; the transport plays the drone while the real sentences queue behind it | check the agent's `language` is `english` (providers._smallest_language maps it to `en`); replay the turn's sentences against `wss://api.smallest.ai/waves/v1/tts/live` from the box and look for spectral flatness < 0.08 (calls c9aa4062 / e73a839b / 0e26a0c9, 2026-09-09) |
| **Panel says an answer was discarded but the transcript looks complete** | a one-character scrap, not an answer — fixed in `RULES_VERSION` 3 (§11.3). On a row stored under v2 read `answersDeletedSamples`: a single syllable is the tell | `rulesVersion` on the row; `turnTaking.fragmentsLost` on v3+ rows |
| **Wrong voice / wrong gender Hindi** | cross-vendor or wrong-cased voice id fell back to another engine | agent's `voice` vs `TtsVoiceCatalog.forModel`; `diagnostics.tts.vendor` vs configured `tts_model` |
| **Every call `Incomplete`** | analysis LLM unreachable/misrouted (provider mismatch) | `report._llm_target`; bot log `analysis failed` |
| **Lead outcome never applied** | report never delivered | bot log `report spooled…`; `_report_spool/*.json`, `.dead` files |
| **Calls stopped dialling** | credit gate (fails closed) or daily cap | admin_core log `AI call BLOCKED — no credits` / `hit the daily cap`; wallet balance |
| **"AI calling runs over a Vacademy Voice (Plivo) line…"** on the first dial | the institute has no AI carrier — its primary provider is Airtel/Exotel and no `AI_VOICE` row exists (§2.5) | Settings → Calling → **AI calling line**; `GET /v1/telephony/ai-carrier/{id}` reports `ready` + `blockingReason` |
| **AI calls dial but every callback 400s** | `?provider=` vs stored-config mismatch — pre-V448 shape, or a `VACADEMY_AI` row whose AI carrier was unlinked mid-flight | admin_core log `telephony webhook: ?provider=… != configured …`; the carrier is authoritative for `VACADEMY_AI` rows |
| **Charged for the wrong engine** | agent's configured engine ≠ engine that spoke | `diagnostics.tts.vendor` vs `ai_agent.tts_model`; billing prices the *configured* one by design |
| **"All lines busy"** | `MAX_CONCURRENT_CALLS` reached | `/health` `activeCalls`; resize the box |
| **IVR prompt plays silence** | wrong MP3 profile or a 206 response | `TTS_PROMPT_SAMPLE_RATE=44100`; `/tts/{token}.mp3` must be a full 200 |

---

## 15. Known gaps

- **Live env values are not in the repo.** `LLM_PROVIDER`, `STT_PROVIDER` and the keys live in
  `/opt/voice-bot/.env` on the Mumbai box. This doc gives code defaults and the checked-in
  example (which sets `LLM_PROVIDER=google`); confirm the box before reasoning about latency.
- **Rumik has still never been proven on a real phone line at the time its default was
  switched away** (`TtsVoiceCatalog` says so explicitly); Google Chirp3-HD is now
  `NEW_AGENT_DEFAULT`.
- **Smallest.ai has no confirmed invoice rate** — it carries a 0 surcharge pending one, i.e.
  we may be under-billing it.
- **`LIKELY_MACHINE` is evidence-only** — voicemail greetings still reach the classifier as
  caller text, so a machine can still produce a disposition (mitigated, not solved, by
  `REPORT_REQUIRE_CONVERSATION`).
- **Out-of-order report clobber**: `reportGeneratedAt` rides the payload but admin_core does
  not yet discount a stale report; the 20-minute spool cap is the current mitigation.
- **Bot log retention is ~100 MB total.** Anything not in the diagnostics blob is gone after a
  restart — if you need a new signal, add a counter, not a log line.
- **`/answer` is public** (Plivo must reach it), so the single-use `/ws` token raises the bar
  on socket abuse but does not close it; edge rate-limiting is still the real fix.
