# Telleo AI Calling API v1

Engineering reference for the public AI calling API: what it does, how it is wired and
what it promises. The client-facing guide lives at https://docs.telleo.ai (Mintlify).

- **Base URL:** `https://api.telleo.ai/v1`. The `vacademy_devops/telleo-api-ingress.yaml`
  ingress rewrites this to `/admin-core-service/open/ai-calling/v1/...` on admin_core.
- **Code:**
  - `admin_core_service/.../telephony/publicapi/` (controller, service, views, webhooks, auth)
  - migration `V572__Ai_calling_public_api_v1.sql`; human calls (v1.2, §10): `V594__Human_call_public_api.sql`;
    counsellor / agent management (v1.3, §11): `V597__Ai_calling_api_idempotency.sql`

## 1. What a client can do

| Method | Path | Scope | Purpose |
|---|---|---|---|
| POST | `/calls` | calls:write | Start one call (queued, dialled as soon as a line is free) |
| GET | `/calls` | calls:read | List calls, newest first (`batch_id`, `external_id`, `created_after`, `limit` 1–100, `starting_after`) |
| GET | `/calls/{id}` | calls:read | One call with status, recording and outcome |
| POST | `/calls/{id}/cancel` | calls:write | Cancel a call that is still queued |
| POST | `/batches` | calls:write | Up to 1000 calls in one request; each row is accepted or rejected on its own |
| GET | `/batches/{id}` | calls:read | Batch progress: counts per status |
| GET | `/agents` | calls:read | Agents the key can name, plus the `{{variables}}` each one's script uses (`include_disabled=true`: every agent) |
| GET | `/credits` | calls:read | Credit balance, can_place_calls, calls_waiting |
| GET | `/usage` | calls:read | Calls, connected, talk seconds, credits per day |
| GET / PUT / DELETE | `/webhook` | webhooks:manage | The one webhook endpoint per account |
| POST | `/webhook/rotate-secret` | webhooks:manage | New signing secret, shown once |
| POST | `/webhook/test` | webhooks:manage | Send a `webhook.test` event now and report the answer |

### Conventions

- JSON in and out is snake_case; camelCase input is also accepted.
- Every response carries `X-Request-Id` and `Cache-Control: no-store`.

## 2. Authentication

- **Header:** `X-API-Key: vak_call_…`, or `Authorization: Bearer vak_call_…`.
- **Issuing keys:** an institute ADMIN issues keys in Settings → AI calling → API & webhooks.
  - Endpoint: `POST /admin-core-service/v1/api-keys` with `product: "ai_calling"`.
  - Storage: SHA-256 hashed in `institute_api_key`, shown once.
  - Self-serve: no platform switch is needed, and there is no daily cap.
  - Scopes: `calls:read`, `calls:write`, `webhooks:manage`. All three are granted when the request leaves them empty.
- **Legacy keys:** `vak_live_…` keys (`ai_call_api_key`, issued before v1) are still accepted, with every scope.
- **Rate limit:** 300 requests per minute per key, counted in memory per pod. Over the limit: 429 `rate_limited` with `Retry-After`.

## 3. Calls

### Request

```json
POST /v1/calls
Idempotency-Key: lead-8812            (optional, up to 255 chars)
{
  "agent_id": "17ea33d2-…",
  "phone_number": "+919876543210",
  "contact": {"name": "Asha Verma", "email": "asha@example.com", "external_id": "lead-8812"},
  "variables": {"course": "NEET 2027", "city": "Indore"},
  "metadata": {"crm_owner": "u_42"},
  "test": false
}
```

### Validation

**Phone number:**
- Must be E.164.
- Spaces, dashes, dots and parentheses are stripped, and a leading `00` becomes `+`.

**Contact:**
- `name`: at most 120 characters.
- `email`: must be a valid email address.
- `external_id`: at most 255 characters.

**Variables:**
- At most 50 per call.
- Keys match `^[A-Za-z][A-Za-z0-9_ ]{0,39}$`.
- Values are scalars of at most 500 characters.
- Keys named like a built-in placeholder (`name`, `lead_name`, the clock words `day`, `today`,
  `date`, `time`, `datetime`, `now`, `tomorrow`, `year`, `month`) are accepted with a
  `warnings[]` entry (`reserved_variable`) on the create response. They reach the bot as lead
  fields but never fill the placeholder: `_fill_placeholders` resolves its own values first.

**Metadata:**
- Any JSON object up to 8 KB.
- Echoed back unchanged; the agent never sees it.

### What the agent sees

- `{{name}}` is filled from `contact.name`.
- Every other variable is filled from `variables`, through the call context: `VoiceBotInternalController` reads `ai_call_api_call` when the call log's subject is `API_CONTACT`.
- `GET /v1/agents` lists the variables each agent's script uses, so a CRM knows which ones to send.

### Placing the call

- **Queue:** each call goes through `ai_call_queue` with `CallTrigger.API`.
  - These rules apply: the daily cap, the per-number cap, the recall gap, the duplicate window and the calling hours.
  - The assigned-lead guard does not apply, because API contacts are not CRM leads.
- **Single calls** are queued at interactive priority and dialled at once when a line is free (`dispatchNowIfLineFree`).
- **Batch calls** wait their turn behind interactive work.
- **Outside calling hours** a call stays `queued`, with `scheduled_for` set.

### Errors

| Situation | Status | Error code |
|---|---|---|
| A number that already has a call waiting | 409 | `call_already_queued` (includes the existing `call_id`) |
| Out of credits | 402 | `insufficient_credits` |

### Idempotency

- **Same key, same body:** returns the first call with 200 and `idempotent_replay: true`.
- **Same key, different body:** 409 `idempotency_key_reused`.
- **Two requests at the same moment:** a unique index decides the winner.
- **Batches** (v1.1.1): each accepted row is stored as `key#index`, so a batch key is at most
  251 characters (400 otherwise; `#999` must fit `VARCHAR(255)`). A replay must match: the
  `test` flag, and every stored row equal to the row at its index (409
  `idempotency_key_reused`, `details.batch_id`). A matching replay places nothing and returns
  the stored rows as `calls` plus `rejected` recomputed from the request (validation,
  agent, `duplicate_in_batch`). A row that passes those checks but has no stored call was
  dropped after acceptance (`call_failed` / `call_already_queued`; only accepted rows are
  stored, no response cache) and comes back as `call_not_placed`. While the newest stored
  row is under 2 minutes old such a row means the first request may still be running: 409
  `request_in_progress`, `Retry-After: 30`. A concurrent first request that loses the
  insert of a `key#index` row gets the same 409. A batch that stored no row at all is not
  remembered.

### Test mode

`test: true` places a MOCK call:
- No phone rings, no credits are used, and no line is taken.
- The call finishes at once as `completed`, with a sample outcome.
- The webhook fires as for a real call.

### Statuses

| Status | Meaning | Final |
|---|---|---|
| queued | Waiting for a line or for calling hours | no |
| dialing | Being placed / ringing | no |
| in_progress | Connected | no |
| completed | Connected and ended. Becomes final once the AI outcome is attached, or 10 minutes after the end without one | yes* |
| no_answer, busy, failed | Did not connect | yes |
| canceled | Canceled before it was dialled | yes |
| expired | No line became free before the queue item expired | yes |

### The call object

- Returned by `GET /v1/calls/{id}` and in webhook `data`.
- **Fields:**
  - `id`, `object: "call"`, `status`, `status_reason`, `scheduled_for`
  - `agent_id`, `phone_number`, `contact`, `variables`, `metadata`, `batch_id`, `test`
  - timing: `duration_seconds`, `created_at`, `dialed_at`, `ended_at`
  - recording: `recording_url` (pre-signed, valid 24 h; fetch again for a fresh one) and `recording_expires_at`
- **`outcome`:**
  - `disposition`, `summary`
  - `answers`: the agent's extraction questions mapped to the answers given
  - `lead_rating`: an integer from 1 to 10
  - `callback_requested`, `callback_time_text`
  - `follow_up` (`CALL` | `CALL_LATER` | `SKIP`), `follow_up_note`
  - `meeting`: `{requested, at, time_text, type}`, read from the report's `raw_payload`
  - `transcript`: a list of `{speaker: agent|contact, text}`
  - `outcome` is null until the AI result is processed.
- **Lists:** `GET /calls` returns the same full object. `GET /batches/{id}` returns counts only.

### Billing

- API calls bill like any other AI call, per connected minute, through the existing call billing.
- They create no CRM lead and run no lead workflows: the subject is `API_CONTACT`, and the call is tied to a deterministic pseudo user id derived from institute + phone.

## 4. Batches

- **Request:** `POST /v1/batches {agent_id, test, calls: [{phone_number, contact, variables, metadata, agent_id?}]}`. Each row may override `agent_id`.
- **Response:** 201 with `accepted_count`, `rejected_count`, `calls: [{index, id, phone_number, external_id}]` and `rejected: [{index, phone_number, code, message, call_id?}]`.
- **Rejection codes:** `invalid_request`, `duplicate_in_batch`, `call_already_queued`, `call_failed` (placement threw; the row is deleted).
- **Progress:** `GET /v1/batches/{id}` returns `total`, `finished` and `counts` per status.

## 5. Webhooks

**Events:**
- `call.completed`: the call connected; `data` is the full call, outcome included.
- `call.not_connected`: no_answer, busy, failed, canceled or expired.
- Each is sent once, when the call becomes final.

**Delivery:**
- An HTTPS POST of `{id, object: "event", type, created_at, data}`.
- **Headers:**
  - `Telleo-Event-Id`: stable across retries; dedupe on it.
  - `Telleo-Event-Type`
  - `Telleo-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + raw body)>`
  - `User-Agent: Telleo-Webhooks/1.0`

**Verifying:**
1. Compute the HMAC over the raw bytes.
2. Compare in constant time.
3. Reject a `t` older than 5 minutes.

**Retries:**
- Any non-2xx answer or a timeout (10 s) is retried after 1 min, 5 min, 30 min, 2 h and 6 h. That is 6 attempts over about 9 hours.
- After the last attempt the delivery is marked FAILED. The call itself stays readable through `GET /v1/calls/{id}`.

**URL rules:**
- https only; redirects are not followed.
- Hosts that resolve to private, loopback, link-local, CGNAT or ULA addresses are refused.

**Engine:** an outbox on `ai_call_api_call` (`final_*` and `webhook_*` columns), run by two ShedLock'd jobs:
- `AiCallingApiFinalize`: every 15 s, scans the last 7 days of open calls.
- `AiCallingApiWebhooks`: every 5 s, delivers due events.

## 6. Errors

```json
{"error": {"code": "invalid_request", "message": "phone_number must be in E.164 format, e.g. +919876543210.",
           "request_id": "…", "details": {"errors": [{"field": "phone_number", "message": "…"}]}}}
```

| Status | Codes |
|---|---|
| 400 | `invalid_request` (also unreadable JSON, a missing header, a wrong content type) |
| 401 | `missing_api_key`, `invalid_api_key` |
| 402 | `insufficient_credits` |
| 403 | `insufficient_scope`, `product_not_enabled` |
| 404 | `not_found`, `agent_not_found` |
| 405 | `method_not_allowed` |
| 409 | `call_already_queued`, `idempotency_key_reused`, `request_in_progress`, `call_not_cancelable`, `agent_disabled`, `agent_inbound_only`, `conflict` |
| 429 | `rate_limited` |
| 500 | `internal_error` |
| 503 | `auth_unavailable` |

## 7. Admin dashboard

- **Location:** Settings → AI calling → **API & webhooks** (`AiCallingApiCard.tsx`). It appears only when the institute uses the VACADEMY_AI provider.
- **What it does:**
  - issues and revokes keys;
  - lists agent ids;
  - sets the webhook, tests it, rotates its secret and removes it, through `/admin-core-service/v1/telephony/ai-call/webhook?instituteId=` (ADMIN only).

## 8. Changes from the pre-v1 endpoint

The old `POST /admin-core-service/open/ai-calling/v1` (`numbers[]`, `mode: CLICK_TO_CALL | BULK_CALL`) and `GET …/{callLogId}` were removed. They:
- dialled up to 1000 numbers at once as MANUAL calls, skipping the caps, calling hours and the queue;
- ignored `agentId`;
- could not pass a name or variables;
- had no results or webhooks.

Only one `vak_live_` key was ever issued (an internal test). Such keys keep working on the v1 routes.

## 9. v1.1 (2026-10-14): review fixes, credits and usage

A 7-dimension review with independent verification (63 confirmed findings) led to:

- **Row writes are targeted.** After the insert nothing saves a whole `ai_call_api_call` row
  (repository `setQueueItemId`, `setCallLogIdIfNull`, `setTerminalSeenAtIfNull`,
  `markChecked`, `finalizeIfOpen`, `recordDelivery`). A finaliser snapshot taken before
  `queue_item_id` was written used to overwrite it and mark a live call failed. A row with
  neither a queue item nor a call log is "being created" (not final) for 5 minutes.
- **Finality.** The outcome wait counts from `terminal_seen_at` (V573), not from
  `telephony_call_log.updated_at`, which is never bumped. A connected call is final when the
  outcome is PROCESSED and the recording is saved (test calls: outcome only). It is also
  final 3 min after the outcome without a recording, or 10 min after the end regardless. A
  call log or dispatched queue item with no end after 2 h is final `failed` ("No result was
  received for this call.").
- **Fairness.**
  - `findOpen` orders by `checked_at` (V573), so the finaliser round-robins.
  - `findWebhooksDue` takes at most 10 rows per institute.
  - `deliverPass` runs institutes in parallel (8 threads, 4-min pass deadline) and stops an
    institute at its first failure in the pass.
  - Deliveries read only the status line (`ofInputStream` + close), so the total time is
    bounded.
- **Webhook guard.**
  - Only ports 443 and 8443 are allowed.
  - `telephony.ai.api.webhook.denied-addresses` (CSV of IPs) blocks our own ingress and nodes.
  - Errors use coarse words: timeout, connection failed, TLS handshake failed, HTTP n.
  - Test events are limited to 5 per minute per institute.
- **Calls.**
  - Batch rows honour their own `agent_id`.
  - Batches accept `Idempotency-Key`, stored per row as `key#index`.
  - Replays compare the whole normalised request, `test` included.
  - Keys expire after 24 h (cleared by the finaliser pass).
  - Test calls are limited to 500 per 24 h (`429 test_limit_reached`) and skip the 30 s duplicate window.
  - A create that fails after enqueue cancels the queue item it made (`abandon`).
  - Over-long contact fields are rejected.
  - The clock placeholders and `name` / `lead_name` were rejected as variables; v1.1.1
    accepts them again with a warning (they never fill the built-in placeholder).
  - `institute_name`, `lead_source` and `booked_slot` are client variables (mirrored to the
    bot's "institute name" / "booked slot" lead-field names).
- **Dispatch.**
  - The drain job cancels an API item whose agent is off or deleted ("The agent was turned
    off or deleted.").
  - The inline dial path reserves interactive slots for non-manual triggers.
  - Capacity counts DISPATCHING items, so parallel inline dials cannot oversubscribe.
  - Items queued outside calling hours get a status reason.
- **Voice bot context.**
  - API calls get no send rules (`sendArtefacts*`, `sendOffers`, `sendConditions`).
  - Mid-call `/action` is a no-op for API calls.
- **Outcome.** `call_quality` is `failed` when `AiCallOutcomeProcessor.isUntrustworthyCall`
  (RED + silence/loop fault); then the disposition is `Incomplete` and `lead_rating` is null.
- **Credits and usage** (`AiCallingUsageService`, scope `calls:read`):
  - `GET /v1/credits` reads `institute_credits` directly. The ai_service balance route
    auto-grants 100 credits to unknown institutes, so it is not used.
  - `GET /v1/usage?from&to&timezone&source=api|all` joins call logs to `credit_transactions`
    through the billing `external_reference_id` keys.
  - `cost {credits, billed}` on every call object.
  - "Not yet billed" (v1.1.1) = a leg `CallBillingService` will still charge: the voice
    leg on PLIVO / VACADEMY_AI (COMPLETED, duration > 0, `telephony_call_log.credits_billed_at`
    NULL), or the AI leg on VACADEMY_AI / AAVTAAR (`ai_call_result` PROCESSED, status
    completed, duration NULL or > 0, a call_uuid or correlation_id, `credits_billed_at`
    NULL). Reading only the call log's stamp counted every AAVTAAR call as unbilled forever.
- **Errors.** A `/**` fallback returns 404 `not_found` / 405 `method_not_allowed` in the
  envelope. Spring's `/error` dispatch used to answer 403.
- **Dashboard.**
  - Call Log rows for `API_CONTACT` show `contact_name`, hide the pseudo `user_id` (no
    "View lead" or assign), and are searchable by name.
  - The Call Queue shows `customer_name` and the source label "API (your systems)".
  - The card asks before rotating the secret and keeps the new-key dialog open until the key
    is copied.

v1.1.1 (same day, review of v1.1): batch replays compare the request and return the same
accepted and rejected rows (see Idempotency above); batch keys are at most 251 characters;
reserved variable names are accepted with a warning; `calls_not_yet_billed` and
`cost.billed` follow the per-provider billing rule; `AiCallingApiViews.state()` and the
create paths no longer set fields on a managed `AiCallApiCall` (open-session-in-view is on
in admin_core, so a setter was flushed as a whole-row UPDATE over the finaliser's columns).

Not changed (noted): legacy `vak_live_` keys still authenticate; DNS-rebinding between
validation and send is not pinned; the bot still describes API variables as "from the form
they filled" (voice-bot change, separate deploy).

## 10. v1.2 (2026-10-17): human (counsellor) click-to-call

The API can ring one of the institute's own counsellors and connect them to a number,
on the institute's PRIMARY provider (PLIVO "Vacademy Voice", EXOTEL or AIRTEL). It is a
separate resource, `/v1/human-calls`, and deliberately NOT a mode of `/v1/calls`: the
pre-v1 `mode: CLICK_TO_CALL` (§8) dialled as MANUAL and skipped every guard. Here every
guard an API caller needs runs up front, and a call that cannot go out now is refused
(an immediate call cannot wait in a queue).

**Code:** `publicapi/HumanCallApiService` (create/list/get/disposition/counsellors),
`HumanCallViews` (object + finality), `HumanCallGuards` (hours, caps, live calls),
`HumanCallWebhookService` (finaliser + delivery), entity `HumanCallApiCall` (table
`human_call_api_call`, V594). Dial path: `CallOrchestrator.connectForCounsellor` →
`CallLifecycleTxOps.prepareAndPersistForCounsellor`, which share the dashboard's
`persist` / `dispatch` code moved verbatim out of `connect` / `prepareAndPersist`
(dashboard behaviour pinned by `CallOrchestratorEntryPointsTest`).

### Endpoints

| Route | Scope | |
|---|---|---|
| `GET /v1/counsellors` | human_calls:read | ACTIVE users with COUNSELLOR/COUNSELOR/ADMIN in the institute (auth_service users-of-status, the same set as the extension picker) with `can_call` / `blocked_reason`. No phone numbers. |
| `POST /v1/human-calls` | human_calls:write | `counsellor_id` xor `counsellor_email`, `phone_number`, `contact`, `metadata`, `analyze`. 201 human_call. |
| `GET /v1/human-calls` | human_calls:read | Keyset pagination like `/calls`; filters `counsellor_id`, `status` (the call log's last status), `phone_number`, `external_id`, `created_after`, `created_before`. |
| `GET /v1/human-calls/{id}` | human_calls:read | |
| `POST /v1/human-calls/{id}/disposition` | human_calls:write | `{key, notes}` → `CallDispositionService.applyDisposition` (institute-checked; may move a linked lead's status). `dispositioned_by` = `"api:" + keyId without hyphens` (the column is VARCHAR(36)). |
| `GET /v1/dispositions` | human_calls:read | The institute's catalog (seeded on first use), `changes_lead_status`, target `lead_status`. |

### Create: checks, in order

1. Idempotency-Key (24 h, full-request compare incl. `analyze`; the counsellor compares by
   whichever selector was sent): same → 200 replay; different → 409 `idempotency_key_reused`;
   first request still dialling (row has no call log, < 2 min) → 409 `request_in_progress`
   (Retry-After 5), also on the concurrent-insert race.
2. Validation (E.164, contact limits, 8 KB metadata — the AI API's rules) → 400.
3. PRIMARY provider enabled and not AI-only → else 422 `telephony_not_configured`.
4. Counsellor in the eligible list → else 404 `counsellor_not_found` (another institute's
   user is simply not in the list).
5. Readiness: Exotel/Plivo need a mobile on the user record (read from the list, no extra
   auth call); Airtel asks `AirtelOriginationResolver.callerBlockedReason` (now
   institute-filtered) → 422 `counsellor_cannot_call` with `details.reason`.
6. `HumanCallGuards`:
   - calling hours = the AI calling shifts exactly as the AI queue evaluates them
     (`CallingWindowUtil`) AND VOICE_CALLING_SETTING.compliance's window (start 9 /
     cutoff 21 in its timezone, on by default) → 422 `outside_calling_hours` +
     `next_allowed_at`. NOTE: the compliance block was not enforced anywhere before
     (AI queue included); it is enforced only here.
   - counsellor already on a live call (non-terminal row < 45 min; skipped on Airtel, whose
     rows stay QUEUED until the CDR import) → 409 `counsellor_busy`.
   - the number already live → 409 `call_in_progress`; ≥ `maxCallsPerDayPerLead`
     (AI setting, default 3) outbound calls placed (not FAILED/CANCELLED) to the number in
     24 h, AI and human, any provider → 422 `contact_daily_limit_reached`; a CONNECTED call
     started within `telephony.ai.min-recall-gap-minutes` (60) → 422
     `contact_called_recently` + Retry-After. Unlike the AI queue, a missed call does not
     start the gap (a counsellor retrying a missed call is normal, and for most providers
     we cannot tell which leg missed).
   - No DND/NCPR scrub: there is no registry in the platform (the AI queue has none either;
     `compliance.dndScrubEnabled` is not wired anywhere).
7. Lead link: exactly one live (non-duplicate, non-INACTIVE) lead of the institute with the
   number (parent_mobile last 10), else the auth user with that mobile having exactly one
   lead here → the call row gets `response_id` + the lead's user (subject type NULL, as on
   the dashboard), shows on the lead timeline and dispositions can move the lead. Otherwise
   `API_CONTACT` with subject_id = `hcall_…` and the AI API's pseudo user id.
8. Insert the API row, then `connectForCounsellor`: the voice credit gate (fails open, as on
   the dashboard; PLIVO only) → 402; provider refusals → 422/502/503. Any failure deletes
   the API row so the same Idempotency-Key can retry.

### Object and finality

`object: "human_call"`. Status from the call log: INITIATED/QUEUED → queued,
COUNSELLOR_RINGING → ringing_counsellor, COUNSELLOR_ANSWERED → connecting, IN_PROGRESS →
in_progress, then completed / no_answer / busy / failed / canceled. `status_updates`:
PLIVO realtime, EXOTEL final_only, AIRTEL delayed. Final: terminal, and for completed once
the recording is in (or recording off, or 10 min; 60 on Airtel). No end after 2 h (Airtel
24 h) → failed "No final status was received". `no_answer_by` only from an unambiguous
provider report (Exotel `Status` vs `DialCallStatus`; Plivo `DialBLeg*`), else null.
`cost`: PLIVO voice leg from the ledger (`voice_call:{log}`); Exotel/Airtel
`{0, billed:true, note:"billed_by_provider"}`. GET never mutates the entity (OSIV); the only
write is the targeted `terminal_seen_at` fill.

### Analysis

`analyze: true` → once the call is COMPLETED with a recording, the finaliser calls
`CallIntelligenceEnqueueService.enqueueRequested`: like `triggerManual` it skips the
source toggles and min duration, and additionally the institute's CRM Intelligence master
switch (off by default — `triggerManual` would return DISABLED). It never resets an
existing row (the recording flow may already have queued and be running it). ai_service
charges 0.15 credits per recorded minute (credit_pricing `call_intelligence`). The
`analysis` block reads `call_intelligence` (summary, short_update, call_type,
inferred_goal, generic_status → `outcome`, lead_sentiment → `sentiment`,
conversion_likelihood, ratings, credits).

### Webhooks

Same endpoint (`ai_call_webhook`), signing, retries, SSRF checks and per-institute
fairness; `AiCallingWebhookService.deliver` sends. Own scheduled passes
(`HumanCallApiFinalize` 15 s, `HumanCallApiWebhooks` 5 s), ShedLocks and a 4-thread pool,
so human-call traffic never delays AI events. Events: `human_call.completed` /
`human_call.not_connected` (id `evt_hc_…`, outbox = final_* / webhook_* columns) and, for
`analyze` calls that connected, `human_call.analysis_ready` (id `evt_hca_…`, outbox =
analysis_* columns) once the analysis is completed or failed.

### Usage

`/v1/usage` appends `human_calls {totals, days}` after the v1.1 fields (unchanged):
outbound counsellor calls on non-AI providers; `source=api` = rows in human_call_api_call.

### Security fixes shipped alongside (separate commit)

`/v1/telephony/calls/connect`, `/calls/options`, `GET /calls`, `GET /calls/{id}/recording`
and every `/v1/telephony/counsellor-endpoints` route now require staff of the institute
(`requireInstituteStaff`); `resolveSubject` refuses another institute's lead; an endpoint
upsert can no longer move another institute's row; Airtel origination only uses the dialling
institute's extension.

### v1.2 review fixes (2026-10-17)

- **Scopes.** Human calls need `human_calls:read` / `human_calls:write`
  (`InstituteApiKeyService.AI_CALLING_ALLOWED_SCOPES`). They are NOT in the default set
  (`AI_CALLING_SCOPES`, what a key gets when created without scopes), so no existing key —
  and no legacy `vak_live_` key, which is treated as having the default set — can ring staff
  or list them. The Settings → AI calling key dialog has a "Can ring counsellors (human
  calls)" box (off by default) that sends all five scopes. Keys cannot be edited after
  creation (there is no update endpoint); an admin creates a new key and revokes the old.
- **Order of checks** (the docs table matches): validation → telephony_not_configured →
  counsellor_not_found → counsellor_cannot_call (now also a mobile that is not 10–15 digits)
  → outside_calling_hours → credits (`CallOrchestrator.assertCanDial`, outside any
  transaction) → `HumanCallReservation.reserve` → `CallOrchestrator.dispatchPrepared`.
- **Double-click race.** `HumanCallReservation.reserve` is one transaction:
  `pg_advisory_xact_lock(hashtext('human-call:counsellor:<inst>:<user>'))`, then
  `…:number:<inst>:<last10>` (always in that order, so no deadlock), an Idempotency-Key
  re-check (a retry that waited on the lock gets the first call), counsellor_busy /
  call_in_progress / caps, the API row, the INITIATED call-log row
  (`prepareAndPersistForCounsellor` joins the transaction) and `setDialed`. Commit releases
  the locks; the provider dial runs afterwards, outside. A dispatch that never reached the
  provider (circuit breaker) is closed with `markFailedIfNotDispatched`, so it does not look
  live. The dashboard's Call button takes no lock.
- **Analysis retries.** A `call_intelligence` FAILED row with attempts < 4 (ai_service
  `call_intelligence_poller.MAX_ATTEMPTS`) is reported `pending`, and `analysis_ready`
  waits; FAILED at 4 attempts, or SKIPPED, is final.
- **Status filter.** `GET /v1/human-calls?status=` filters on the public status, computed in
  SQL (`HumanCallApiCallRepository.PUBLIC_STATUS_SQL`) with the same cut-offs as
  `HumanCallViews.state()` (2-minute creating grace, 2 h / Airtel 24 h stuck limit), so a
  row the object reports `failed` matches `status=failed`.
- **Number errors.** Our own "no phone on file" / "format not supported" → 422
  `invalid_request` (the contact's number); a provider "format rejected" → 422
  `counsellor_cannot_call` (the contact's number was valid E.164, so the counsellor's mobile).
- **Usage.** `human_calls` counts only PLIVO / EXOTEL / AIRTEL rows (MANUAL uploads are not
  calls placed). source=api: rows in human_call_api_call; source=all: every outbound
  counsellor call on those providers.
- **Lead ownership (dashboard /connect).** A campaign lead must be in a campaign of the
  institute; a campaign-less admission/application lead (audience_id NULL) must have an
  applicant whose current application stage belongs to the institute
  (`AudienceResponseRepository.isApplicantLeadInInstitute`). The human-call API's lead
  linking still only matches campaign leads.

## 11. v1.3 (2026-10-19): counsellor and AI agent management

Two new opt-in scopes, never in the defaults and never on legacy `vak_live_` keys:
`counsellors:manage` and `agents:manage` (`InstituteApiKeyService.AI_CALLING_ALLOWED_SCOPES`;
dashboard checkboxes "Can manage counsellors" / "Can manage AI agents" in `AiCallingApiCard`).

**Code:** `publicapi/PublicAiCallingManagementController` (same base path; the old
controller's catch-all `KNOWN_PATHS` covers the new paths for 404/405; the error advice
covers both controllers), `CounsellorApiService`, `AgentApiService`,
`InboundNumberApiService`, `ApiIdempotencyStore` (table `ai_calling_api_idempotency`, V597),
`telephony/core/AiCallingSettingsMutator`. Audit: `admin_activity_log` rows with
`actor_id = "api:<keyId>"` (`InstituteApiAuditWriter.recordApi`); the default-agent change
and the agent registry bridge also record `api:<keyId>` in `institute_setting_history`.

### Endpoints

| Route | Scope | |
|---|---|---|
| `GET /v1/counsellors` | human_calls:read or counsellors:manage | + `status`; never phone numbers |
| `GET /v1/counsellors/{id}` | human_calls:read or counsellors:manage | COUNSELLOR/COUNSELOR/ADMIN of the institute, any status |
| `POST /v1/counsellors` | counsellors:manage | `{name, email, mobile_number?, airtel_extension?, send_welcome_email=true}`; Idempotency-Key |
| `PATCH /v1/counsellors/{id}` | counsellors:manage | `name?`, `mobile_number?`, `airtel_extension?` (null removes), `active?` |
| `DELETE /v1/counsellors/{id}` | counsellors:manage | deactivate (idempotent) |
| `GET /v1/agents/{id}` | calls:read | summary (`configuration: "summary"`, no system_prompt / handoff_numbers / send_rules / booking_page_id); full config with agents:manage |
| `POST /v1/agents` | agents:manage | required `name`, `system_prompt`, `opening_line`; Idempotency-Key |
| `PATCH /v1/agents/{id}` | agents:manage | partial; optional `If-Match` / `expected_updated_at` → 409 `version_conflict` |
| `POST /v1/agents/{id}/enable` · `/disable` | agents:manage | disable reports `waiting_calls_canceled` |
| `DELETE /v1/agents/{id}` | agents:manage | 409 `agent_in_use` with `used_by` |
| `GET /v1/voices` | calls:read | `TtsVoiceCatalog.models()` + `TtsModelPricingAnnotator` |
| `GET` / `PUT /v1/settings/default-agent` | calls:read / agents:manage | |
| `GET /v1/numbers` · `PUT /v1/numbers/{id}/agent` | calls:read / agents:manage | IVR-capable (Plivo) numbers |

### Counsellors

- auth_service is the only store of users and roles; everything goes through HMAC-internal
  routes and is STRICT (a failure is 503 `temporarily_unavailable`, never "no such user"):
  `GET /auth-service/internal/user/by-email` (percent-encoded: a raw `+` in a query string is
  read back as a space), `GET /auth-service/internal/v1/user-roles/memberships` (new),
  `PUT /auth-service/internal/v1/user-roles/role-status` (new; only the named roles, one
  institute), `POST /auth-service/internal/v1/user-roles/add-user-roles` (strict variant),
  `POST /auth-service/v1/user/internal/create-user-or-get-existing?isNotify=`, `PUT …/update-user`.
- **New email:** create-user-or-get-existing with roles `[COUNSELLOR]`, ACTIVE, `isNotify =
  send_welcome_email` (the platform welcome mail with username + generated password, admin
  portal link). The mobile number is NOT sent to that call: for an institute whose user
  identifier is PHONE, `AuthService.createUser` looks the user up by mobile first and would
  attach the role to whichever account has the number. It is set afterwards with update-user
  (digits only, root flag copied — update-user writes `isRootUser` unconditionally).
- **Existing email** (review 2026-10-19: attaching any platform account let a key read another
  institute's learner's name and mobile): only an account that belongs to THIS institute is
  ever touched. Already a live counsellor here → 200 `created: false` (and a missing mobile from
  the request is filled in when the login is ours alone — the retry of a create cut off before
  setMobile); any other role here → 409 `account_has_other_role`; a paused counsellor row → 409
  `counsellor_inactive`; only DELETED rows here and no other membership → add-user-roles
  `[COUNSELLOR]` (a former member), no profile change, no email (the only "you have an
  account" template mails the stored PASSWORD); anything else (a login of another institute,
  or of none) → 409 `email_in_use_elsewhere`, no details. `mobile_number` is null in every
  response for a login shared with another institute, and the list never carries numbers.
  After every grant the memberships are re-read; no live COUNSELLOR row → 500 `role_unavailable`
  (e.g. no built-in role named COUNSELLOR).
- **Stale claims:** an Idempotency-Key claim still without a resource after 2 minutes belongs to a
  request that died and is taken over by the retry (`ApiIdempotencyStore.releaseStale`).
- **Email lock:** a row `('global', 'lock', sha256(email))` in `ai_calling_api_idempotency`
  serialises creates of the same email across pods/institutes (2-minute takeover). Without it
  two concurrent creates both see "no user" and auth_service's second create finds the first
  and mails the stored password. The dashboard's invite path does not take it.
- **Manageable:** only users whose non-deleted rows in the institute are all COUNSELLOR /
  COUNSELOR; anyone else (ADMIN, TEACHER, STUDENT, custom) → 403 `counsellor_not_manageable`.
- **Shared account:** name / mobile changes only when every non-deleted role row of the user
  is in this institute (`409 shared_account` otherwise) — email and mobile are the global login.
- **Deactivate:** role-status DISABLED for the user's counsellor roles in this institute, sent
  by their stored names (auth_service also matches ignoring case — a "Counsellor" row used to
  pass the counsellors-only check and then change nothing). If a live counsellor role exists and
  0 rows changed → 500 `role_update_failed` BEFORE pools / IVR are touched. Other institutes are
  untouched: only this institute's authUserDetails cache entry is evicted, and the user-wide
  lastTokenUpdate stamp is NOT bumped (`effects.sessions_revoked: "this_account"`);
  `counselor_pool_member.status = 'INACTIVE'` for this institute's pools (leads stay assigned;
  shift rows untouched); the user id removed from this institute's `ivr_node.dial_user_ids`
  (`no_one_left` flags a DIAL step left with nobody); `LastCounsellorInboundRouter` skips users
  without an ACTIVE or INVITED role in the institute (memberships lookup; fails open if
  auth_service is down). The Airtel
  extension mapping is kept (history attribution).
- **Reactivate** (`PATCH active=true`): role-status ACTIVE (DISABLED/INACTIVE rows only, never
  DELETED). Pool rows stay INACTIVE and IVR lists are not refilled — nothing records which an
  admin paused on purpose — and the response says so.

### Agents

- Every write goes through `AiAgentService.saveWithResult(dto, "api:<keyId>")`: the registry
  bridge, speech warm and rule checks apply. PATCH loads `dtoOf(stored)`, sets
  `ttsModel`/`speechCacheMode`/`sendRules` to null (= keep stored) and overlays only the
  present JSON fields (camelCase aliases accepted).
- Strict where the dashboard repairs: unknown engine → 422 `unsupported_tts_model`
  (`valid_tts_models`); voice not in the engine's palette → 422 `invalid_voice` (`valid_voices`;
  checked whenever `tts_model` or `voice` is sent, and on create); language outside the bot's
  `_STT_LANGS` names / codes / `xx-YY` tags → 422 `unsupported_language`; deepgram + non-English
  → 422 `voice_language_mismatch`; pace/temperature/voice_modulation/max_call_minutes (1–30)
  out of range → 400 (never clamped); handoff numbers E.164; booking pages (agent and rules)
  must be the institute's; names unique ignoring case (409 `agent_name_taken`; the DB
  constraint is case-sensitive); `speech_cache_mode` read-only (support sets it).
- **Optimistic concurrency:** PATCH with `If-Match` (quotes / `W/` ignored) or
  `expected_updated_at` runs, after validation, `UPDATE ai_agent SET updated_at = now WHERE id
  AND updated_at = :expected` (`AiAgentRepository.claimVersion`); 0 rows → 409 `version_conflict`
  with `current_updated_at`. Without it the last write wins.
- `TtsVoiceCatalog.normalizeModel` now rejects any spelling containing "muga" ("silk muga"
  with a space used to resolve to Rumik).
- `ai_agent.updated_at` had no trigger and is read-only in the entity: `AiAgentRepository.
  touchUpdatedAt` stamps it on every save (and clears the persistence context so the next
  read sees the DB timestamps).
- **agent_in_use** (`AgentApiService.usage`): default agent (`defaultCampaignId` = id or name),
  `ivr_node` AI_AGENT steps of the institute's menus (enabled or not), CALL_AI node templates
  (status ACTIVE) of workflows in ACTIVE/DRAFT whose `config_json` or mapping `override_config`
  names the agent by `campaignId` or `campaignName`, and QUEUED/DISPATCHING queue items.
- **Default agent:** `PUT` needs an enabled, non-INBOUND agent and AI provider VACADEMY_AI or
  unset (warning `provider_not_set`); 409 `ai_provider_not_supported` for AAVTAAR etc. Written
  by `AiCallingSettingsMutator` (row lock on the institute, refresh, change `data` only,
  `InstituteSettingWriter.putSettingKey`). The agent registry bridge now uses the same mutator,
  so the two never undo each other. NOT covered: the dashboard settings page saves its whole
  stale blob.
- **Numbers:** IVR_BUILDER-capable providers only (Plivo). The menu is resolved exactly like
  `PlivoCallbackController.answerInbound` (`IvrMenuService.resolveMenu(institute, number,
  inbound_ivr_menu_id)`). `PUT …/agent` edits `ivr_node.ai_agent_id` with a conditional UPDATE
  only when the menu has exactly one AI_AGENT step and no other number resolves to it; else 409
  `number_routing_complex` with `reason` (`no_menu`, `menu_without_ai_agent`,
  `menu_with_several_ai_agents`, `menu_shared`). The dashboard has no one-click "answer with AI"
  that creates a menu, so neither does the API. The agent must be enabled and INBOUND/BOTH.

### Behaviour changes shipped with v1.3

- **Queue (all triggers):** `AiCallQueueDrainJob.agentRefusal` cancels a waiting call of ANY
  trigger whose agent EXISTS and is DISABLED, resolving it as placeCall does (VACADEMY_AI
  only; campaign id, else name via the registry, else the default; a name-only item for a
  disabled agent is not swapped for the default). When nothing resolves to an existing agent
  (deleted, never created, a default naming no agent) workflow / bulk / manual items dial with
  the generic "Vacademy Agent" persona exactly as before — prod depends on it (2026-10-19
  replica check, last 30 days: Jumpstart has no ai_agent rows and a default that does not
  exist, 26/26 AI calls; CRM 16; Shiksha Nation 6; zero disabled agents anywhere). API items
  keep the v1.1 rule: cancelled when their agent is off, deleted or inbound-only.
  `AiAgentService` cancels the agent's QUEUED items at once when it is turned OFF (any path;
  this is `waiting_calls_canceled`); deleting cancels nothing (the drain job handles API items),
  and a disabled agent's speech cache is no longer warmed.
- **IVR admin routes** (`/v1/telephony/ivr/menus`) now require STAFF of the menu's institute
  (`requireInstituteStaff`, no root bypass; the dashboard's axios instance sends that institute
  as clientId; they had no check at all); a save cannot re-home another institute's menu or node ids;
  an AI_AGENT step must name an enabled agent of the menu's institute.
- **Airtel extensions** resolve within the record's institute only; an upsert refuses an
  extension already mapped (enabled rows only) to another user of the institute (409 naming them).
- **auth_service** role endpoints are institute-scoped (see the auth_service commit):
  add-user-roles dedupes per institute and never uses another institute's custom role;
  remove-user-roles deletes one institute's rows and is guarded; update-role-status is guarded
  (a member may only DELETE their own rows — the learner app's account deletion; anything else
  needs staff, and admin for an admin target).

