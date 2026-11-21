# Call Intelligence — Design & Implementation

> Status: **IMPLEMENTED (phase 1 — calls).** Backend pipeline, credit billing and
> frontend surfaces are built and shipped on `feat/AiSalesAvataarAi`. Messaging /
> WhatsApp / email touchpoints are deliberately out of scope (phase 2).
>
> Legend: ✅ built & verified · 🟡 follow-up / known gap.

---

## 0. TL;DR — the decisions that shape everything

1. **One intelligence layer over the universal call record.** Every call —
   manual upload, telephony (Exotel / Airtel), and AI agent (Aavtaar / MOCK) —
   already lands as one row in `telephony_call_log`. Call Intelligence is a 1:1
   sidecar table (`call_intelligence`) that transcribes + LLM-analyzes that
   recording. No per-provider analysis code. ✅
2. **The recording-stored moment is the trigger — not call end.** Recordings and
   duration arrive in *later* webhooks/async copies, so we enqueue when
   `recording_storage_key` is set (the one place all sources converge), not at
   the terminal status transition. ✅
3. **The row IS the queue.** `call_intelligence.status='PENDING'` is the work
   signal. A DB-backed queue, **not** the in-JVM event bus — that bus silently
   drops events across the prod replicas (see `CallEventBus`). ✅
4. **`ai_service` owns the pipeline and writes back directly.** Because
   `ai_service` shares the `admin_core` database, the Python poller transcribes,
   analyzes, deducts credits and writes results straight into `call_intelligence`
   — **no HTTP callback into admin_core**. Same pattern as `chat_sessions` and the
   credit tables. ✅
5. **AI calls are re-analyzed uniformly.** Aavtaar already returns its own
   transcript / disposition / ratings, but we run *our* pipeline on every source
   so all calls are scored on one consistent rubric and are comparable. ✅
6. **The call objective is inferred, not configured.** The LLM infers what the
   caller was trying to achieve from the conversation; an optional per-institute
   `objectiveHint` only nudges it. The rubric *qualities* are tunable. ✅
7. **Charging (revised 2026-09-11).** AI-agent calls (VACADEMY_AI / AAVTAAR / MOCK)
   are analysed **by default and free** — the call is already billed per minute,
   and the institute's CRM Intelligence switch governs human calls only. Human /
   telephony calls stay manual and are charged **0.15 credits per minute of
   recording** (`credit_pricing.call_intelligence`, V506; was 0.5, originally a
   flat 5). Charged only on success, keyed on `call_log_id` so a retry never
   double-bills. ✅
8. **Models (2026-09-11).** Transcription through OpenRouter's audio endpoint —
   `CALL_INTEL_STT_MODEL`, default `openai/gpt-4o-mini-transcribe` ($0.0017/min;
   `whisper-large-v3-turbo` was 9× cheaper but rendered a Hindi call as garbled
   English once the English screener fixed its language guess). Analysis with
   `CALL_INTEL_LLM_MODEL`, default `z-ai/glm-5.3-flash` (~$0.0004/call), falling
   back to `LLM_DEFAULT_MODEL`. All-in ≈ **$0.002 (₹0.17) per minute**. The
   render-worker Whisper (which answered "at capacity" on 45% of runs) remains only
   as a fallback via `CALL_INTEL_STT_BACKEND=render`. Both legs now write
   `ai_token_usage` rows (request_type `call_intelligence`, `metadata.leg`
   stt/llm) with the vendor cost, so the AI Usage page shows the margin. ✅
9. **Two-line update (schema 1.1).** `call_intelligence.short_update` (≤200 chars,
   "what happened / what's next") is on every Call Log row; the transcript itself
   is kept in `analysis_json.transcript` (no S3 artifact any more). ✅

---

## 1. Data model

### `call_intelligence` (V345, admin_core DB — shared with ai_service)

One row per analyzed call, 1:1 with `telephony_call_log` (`uk_call_intelligence_call_log`).
Doubles as the work queue.

| Group | Columns |
| --- | --- |
| Identity | `id`, `call_log_id` (unique), `institute_id` |
| Denormalized dims (for dashboards, avoid join) | `counsellor_user_id`, `response_id`, `user_id`, `source` (MANUAL/TELEPHONY/AI), `direction`, `call_started_at`, `duration_seconds` |
| Pipeline / queue | `status` (PENDING→TRANSCRIBING→ANALYZING→COMPLETED; FAILED / SKIPPED), `skip_reason`, `job_id`, `attempts`, `error` |
| Transcript | `source_text_key`, `english_text_key`, `detected_language`, `language_probability` |
| Data points (first-class, filterable) | `inferred_goal`, `call_type`, `general_summary`, `generic_status`, `caller_self_goal_rating`, `call_output_rating`, `conversion_likelihood`, `lead_sentiment` |
| Full analysis | `analysis_json` (jsonb), `schema_version` |
| Credits / audit | `credits_charged`, `usage_log_id`, `model`, `prompt_version`, `created_at`, `updated_at`, `completed_at` |

Indexes: partial `idx_ci_queue` on `status='PENDING'` (poller), plus institute /
counsellor / response / user roll-up indexes.

### Billing (V345)
- Seeds `credit_pricing('call_intelligence', base_cost=5, token_rate=0, unit_type='none')`
  → a flat 5 credits regardless of call length / LLM tokens.
- **Extends `ai_token_usage_request_type_check`** to allow `call_intelligence`.
  This is the V102/V217/V225/V325 trap: the billing path inserts an
  `ai_token_usage` row first, so a value missing from the CHECK throws a
  CheckViolation → the charge is swallowed → **credits silently never deduct**.

> Note: V345 was committed separately (`807e14e8f`) as part of a batch of
> migration files on this branch.

---

## 2. Enqueue (admin_core)

`CallIntelligenceEnqueueService.enqueueIfEligible(TelephonyCallLog)` inserts a
`PENDING` row. It is:
- **Best-effort** — never throws; a failure here must not roll back or block the
  recording-persistence flow that called it.
- **Idempotent** — existence check + the unique index (race caught explicitly).
- **Gated** — `CRM_INTELLIGENCE_SETTING` on → source toggle on → recording
  present → duration ≥ `minDurationSeconds`.

Called from the **three** code paths that set `recording_storage_key`:

| Source | Hook |
| --- | --- |
| Exotel / synchronous telephony | `RecordingTxOps.persist()` |
| AI agent (Aavtaar / MOCK) | `AiCallRecordingService.copyOnce()` |
| Airtel (S3 CDR/recording import) | `AirtelImportPromoter.promoteRecording()` |

Source bucketing: `MANUAL`→MANUAL, `AAVTAAR`/`MOCK`→AI, everything else→TELEPHONY.
Credit balance is **not** checked here (it's a dispatch-time decision — balance
can change between enqueue and run).

`MANUAL` is a new `ProviderType`. `ManualCallUploadService` stores an uploaded
recording, creates a `MANUAL` `telephony_call_log` row, and enqueues — unifying
off-platform calls into the same pipeline.

---

## 3. Pipeline (ai_service)

`call_intelligence_poller.py` — a single asyncio task started from the app
lifespan:

1. **Re-arm** rows a crashed worker left mid-flight (and bounded `FAILED`
   retries) once stale.
2. **Claim** a batch with `UPDATE … WHERE status='PENDING' … FOR UPDATE SKIP
   LOCKED` — multi-replica safe (no two replicas grab the same row).
3. **Enrich** each with its `recording_storage_key` from `telephony_call_log`.
4. **Process** concurrently.

`call_intelligence_service.process_one()`:

```
resolve recording URL (media_service)
  → read CRM_INTELLIGENCE_SETTING from institutes.setting_json (rubric + override)
  → credit pre-flight (CreditService.check_credits) → SKIPPED/INSUFFICIENT_CREDITS if short
  → transcribe via render worker (task='both' → Hindi source + English)
  → fetch transcript text
  → LLM structured analysis (llm_json.generate_json, OpenRouter)
  → deduct credits + write COMPLETED row  (one transaction, idempotent)
```

Credit deduction uses `precomputed_credits` (override or global) and
`idempotency_key='call_intelligence:{call_log_id}'` (the `credit_transactions`
partial-unique index from V243), so re-runs never double-charge. Failures →
`FAILED` (retried); insufficient balance / no recording / empty transcript →
`SKIPPED` with a reason (no charge).

Transcription supports Hindi / English / Hinglish via faster-whisper on the
render worker; `task='both'` yields source-language + English transcripts in one
pass.

---

## 4. LLM output contract (`schema_version` 1.0)

Fields from `telephony_call_log` (time, duration, counsellor, lead) are **not**
in the LLM output — only the analysis. `caller_self_goal_rating.qualities[]` keys
mirror the institute rubric.

```jsonc
{
  "schema_version": "1.0",
  "language": { "primary": "hi|en|mixed", "code_switching": true },
  "inferred_goal": { "objective": "…", "call_type": "SALES_OUTREACH|FOLLOW_UP|DEMO_BOOKING|OBJECTION_HANDLING|PAYMENT|SUPPORT|OTHER", "confidence": 0.0 },
  "general_summary": "2–4 sentences",
  "action_items": [ { "text": "…", "owner": "CALLER|LEAD|UNSPECIFIED", "due_hint": "…|null", "priority": "HIGH|MEDIUM|LOW" } ],
  "generic_status": "CONNECTED_POSITIVE|CONNECTED_NEUTRAL|CONNECTED_NEGATIVE|CALLBACK_REQUESTED|NOT_INTERESTED|INFORMATION_ONLY|NO_CLEAR_OUTCOME|WRONG_NUMBER",
  "call_analysis": { "key_topics": [], "objections": [ { "objection": "…", "handled": true, "resolution": "…|null" } ], "questions_by_lead": [], "commitments": [], "risk_flags": [] },
  "sentiment": { "lead": "POSITIVE|NEUTRAL|NEGATIVE", "caller": "…", "trajectory": "IMPROVED|FLAT|DECLINED" },
  "caller_self_goal_rating": { "score": 0, "rationale": "…", "qualities": [ { "key": "…", "score": 0, "comment": "…" } ] },
  "call_output_rating": { "score": 0, "rationale": "…", "conversion_likelihood": "HIGH|MEDIUM|LOW" },
  "next_best_action": "…",
  "coaching_tips": [],
  "talk_ratio": { "caller_pct": 0, "lead_pct": 0 },
  "highlights": [ { "quote": "verbatim", "label": "…" } ]
}
```

- **caller_self_goal_rating** (0–10): how well the *caller* advanced their own
  objective — a coaching/performance lens on the counsellor.
- **call_output_rating** (0–10): how the call landed from the *lead's*
  perspective (interest, commitment, progress).

---

## 5. Read APIs (admin_core)

`/admin-core-service/call-intelligence/…`

| Endpoint | Purpose |
| --- | --- |
| `GET /call/{callLogId}` | Per-call intelligence detail |
| `GET /lead/{responseId}` | All analyzed calls for a lead |
| `GET /analytics/counsellor?counsellorUserId=&from=&to=` | One counsellor's roll-up |
| `GET /analytics/team?instituteId=&from=&to=` | Acting user's whole team |
| `POST /manual-call/upload` (multipart) | Upload an off-platform recording |

Team scope is resolved via `CounsellorScopeService.descendantUserIdsForCaller`,
so a sales head sees only their own reporting line. Roll-ups return total
analyzed, average of both ratings, status + sentiment distributions, and a
per-counsellor leaderboard (team view).

---

## 6. Frontend (frontend-admin-dashboard)

| Surface | What was added |
| --- | --- |
| Lead call history (`lead-call-history.tsx`) | Per-call **AI analysis panel** (lazy on expand) + **Upload recording** dialog |
| Counsellor workbench → Calls tab | Per-call panel + counsellor roll-up card |
| Reports Center → Calling tab | Team roll-up card (sales-head leaderboard) |
| Settings → **CRM Intelligence** tab | Master toggle, per-source toggles, min-duration, credit-cost override, scoring rubric |

API layer: `constants/urls.ts` + `services/call-intelligence.ts` (+ React Query
hooks), exported via the `shared/leads` barrel. New components:
`call-intelligence-panel`, `call-intelligence-summary`, `manual-call-upload-dialog`,
`CrmIntelligenceSettings`.

The panel surfaces in-progress / skipped (incl. "out of credits") / failed
states explicitly, so a counsellor always knows *why* analysis isn't shown.

---

## 7. Settings (`CRM_INTELLIGENCE_SETTING`)

Stored in the institute settings envelope (`institutes.setting_json`,
`setting.CRM_INTELLIGENCE_SETTING.data`):

```jsonc
{
  "enabled": false,
  "calls": {
    "enabled": false,
    "sources": { "MANUAL": true, "TELEPHONY": true, "AI": true },
    "minDurationSeconds": 20,
    "analyzeNotConnected": false,
    "creditCostOverride": null,          // null = DB-managed global price
    "ratingScale": 10,
    "rubric": {
      "objectiveHint": null,             // optional nudge; AI infers otherwise
      "qualities": ["rapport", "needs_discovery", "objection_handling", "next_step_secured"],
      "weights": null
    }
  }
}
```

---

## 8. End-to-end flow

```
call ends (manual upload | Exotel/Airtel | Aavtaar/MOCK)
  → recording stored in our S3 (recording_storage_key set)
  → enqueueIfEligible: settings on? source on? duration ok? → INSERT call_intelligence PENDING
  → ai_service poller claims (SKIP LOCKED) → credit pre-flight
  → transcribe (Hindi+English) → LLM structured analysis
  → deduct flat credits (idempotent) → write data points + analysis_json (COMPLETED)
  → dashboards read per-call / per-lead / per-counsellor / per-team
```

---

## 9. Known gaps / follow-ups (🟡)

- **Speaker diarization:** the LLM infers caller-vs-lead from content; there is no
  true diarization yet. Transcript schema is shaped to add speaker labels later
  without a rewrite.
- **Transcript text not exposed to the frontend** — only the S3 keys are stored;
  no transcript viewer/link yet.
- **No automated tests** for the new modules.
- **Concurrency caveat on credit dedup:** the idempotency key makes sequential
  retries safe; truly concurrent double-dispatch relies on the
  `credit_transactions` unique index.
- **Phase 2:** messaging / WhatsApp / email touchpoints reuse this envelope
  (`calls` sits alongside future `messaging` / `email` blocks).

---

## 10. Key files

**admin_core** — `features/call_intelligence/` (entity, repository, DTOs,
`CallIntelligenceEnqueueService`, `CrmIntelligenceSettingsService`,
`ManualCallUploadService`, `CallIntelligenceQueryService`, controllers);
`V345__call_intelligence.sql`; enqueue hooks in `RecordingTxOps`,
`AiCallRecordingService`, `AirtelImportPromoter`; `ProviderType.MANUAL`.

**ai_service** — `services/call_intelligence_poller.py`,
`call_intelligence_service.py`, `call_intelligence_prompt.py`; poller registered
in `app_factory.py`; `CALL_INTELLIGENCE` in `models/ai_token_usage.py`.

**frontend-admin-dashboard** — `components/shared/leads/call-intelligence-*`,
`manual-call-upload-dialog.tsx`, `services/call-intelligence.ts`;
`routes/settings/-components/CrmIntelligenceSettings.tsx`; integrations in
`lead-call-history.tsx`, `CounsellorCallsTab.tsx`, reports `CallingTab.tsx`.
