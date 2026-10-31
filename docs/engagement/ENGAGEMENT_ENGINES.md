# Vacademy Engagement Engines — Design

> **Status: DESIGN LOCKED 2026-07-17. Phase 0 (ledger) + Phase 1a (read-only brain) + Phase 1b-send
> (the copilot send path) + Phase 1b-templates (the D8 template negotiation state machine) BUILT +
> adversarially reviewed 2026-07-17 — compiles clean across notification/admin_core/assessment/auth,
> NOT deployed.** Phase 0: 15 findings fixed (§6.5). Phase 1a: two passes (22 + 6 findings, incl. a
> runtime-fatal SQL bug the compile hid, cross-tenant IDOR, a lease-outrun double-decide, a
> quiet-hours floor-disable) all fixed (§15). Phase 1b-send: 10 findings (0 refuted, incl. a P0
> reply-sweep silent no-op from a double-encoded cursor, a P1 post-send double-send, a P1 false-SENT
> in-app) all fixed (§15). Phase 1b-templates: 12 + 2 findings (1 refuted, incl. a P1 catch-rollback
> that un-approved a Meta-approved template, and a P2 cluster where submit() couldn't recover a lost
> response — 409 loop / update()-wall deadlock / stranded SUBMITTED) all fixed (§9). Phase
> 1b-brain-picks-template + 1b-autoreply (the FIRST autonomous send): 4 + 10 + 8 findings (1 refuted,
> incl. a P1 classify-on-truncated-text that could auto-answer a refund question) all fixed (§10).
> **Phase 1 (backend + admin-dashboard FE) is FEATURE-COMPLETE.** Phase 2a (proactive autonomous
> sends: graduation ramp + kill switch + holdout + enforced credits, backend + FE) BUILT + reviewed
> 2026-07-17 — 4 findings (3 refuted; 2 P1s: holdout messaged via the reply path, and no circuit
> breaker on a charge-failure divergence) all fixed.
> **Updated 2026-10-31 — see §17.** The week of 2026-10-24 → 10-31 added CRM awareness, CRM actions, AI
> calling inside the engine, send schedules, template reuse, meeting booking from replies, the daily
> report and a reworked admin UI. Decisions **D14** and **D24** below are amended there.
> Grounded in a verified 10-area recon, three competing architectures, three adversarial red-team
> passes, and a 24-question founder interview (§0.1). Every class/table/endpoint named here was
> read in source. Where the recon was wrong, this doc says so (Appendix).
>
> **Migrations claimed:** notification_service **V31** (correlation_id); admin_core **V386**
> (5 engagement tables — V385 was taken by an unrelated feature). New internal endpoints:
> `POST …/notification-service/internal/v1/engagement/ledger-batch`,
> `POST …/assessment-service/internal/student-analysis/assessment-history/batch`,
> `POST …/auth-service/internal/v1/analytics/student-login-stats/batch` (HMAC).
> **Deploy note:** admin_core JVM must stay UTC (the sweep/lease math + naive-UTC timestamp
> binding depend on it — see the known IST bug).
>
> Companion docs: [`../crm/VACADEMY_AI_AGENT.md`](../crm/VACADEMY_AI_AGENT.md),
> [`../crm/VACADEMY_VOICE_INTEGRATION.md`](../crm/VACADEMY_VOICE_INTEGRATION.md),
> [`../scheduler_infra/README.md`](../scheduler_infra/README.md) (**read before touching the scheduler**),
> [`../../notification_service/NOTIFICATION_API.md`](../../notification_service/NOTIFICATION_API.md),
> [`../notifications/inbound-email-receiving.md`](../notifications/inbound-email-receiving.md).

---

## 0. What this is

A per-institute AI brain that decides **when** to message **whom**, with **what**, across WhatsApp,
email, in-app and (later) AI voice — reading an evolving set of data points, obeying a hard
institute-wide frequency cap, and either doing it automatically or handing a human a ready-to-send
suggestion.

**Phase 1 is a copilot, not an autopilot.** The engine decides and drafts; a human reads and presses
send. The one exception is opt-in: inside the 24-hour window a learner opens by replying, the AI may
answer on its own.

### 0.1 Locked decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Where the brain runs | **admin_core_service (Java)**, not ai_service. §2 |
| D2 | Workflow engine | Take its seams; **decline its interpreter**. New feature package. |
| D3 | Scheduler | Per-member `next_action_at` + **lease** under `SKIP LOCKED`, driven by an engine `next_due_at` cursor. Deterministic `shouldWake()` before any LLM call. §4 |
| D4 | Data points | Spring `List<DataPointProvider>`; `fetch(List<subject>)` — N+1 unrepresentable. **All 7 in V1.** §5 |
| D5 | Ledger | `notification_log.correlation_id` (V31) + capture the **wamid**. Phase 0, blocks everything. §6 |
| D6 | Tasks | New `engagement_action` = decision + ledger + task + audit, one row. **No assignment in Phase 1**; actions are ACK / DONE / **send-on-behalf**. **No volume cap** — rank and filter in UI. §7 |
| D7 | Prompt | Immutable `base_text` + append-only deltas → compiled. **Free text + AI clarifying interview.** §8 |
| D8 | Templates | **AI recommends → user approves → Meta → wait → user reviews rejections/recategorisations → alternatives → satisfied → activate.** A real state machine, and the activation gate. §9 |
| D9 | Replies | WhatsApp inbound in Phase 1 (free today); **email inbound stays off**. Claim by Meta `context.id`. §10 |
| D10 | Auto-reply | **Opt-in per engine.** Free-form AI inside the user-opened 24h window. Grounded in the prompt only. Escalates on uncertainty/anger/money. Replies ignore quiet hours. §11 |
| D11 | Audience | **Learners AND unconverted leads from day one.** Leads need a new reachability path — `RecipientType.AUDIENCE` is converted-only. §3 |
| D12 | Engine scope | **Many per institute, one per objective.** Makes the institute-wide cross-engine cap mandatory. |
| D13 | Cadence | **The prompt decides.** A hard institute-wide cross-engine per-user cap is the only safety mechanism — enforced **before** the LLM call. §12 |
| D14 | Channels V1 | WhatsApp + Email + **In-app** (the only first-class read receipt in the platform). **No push** (unobservable). **AI call = task-only.** | **Amended 2026-10-29:** an AI call is now placed through the `SCHEDULE_AI_CALL` CRM action, not a task-only channel. §17.3.
| D15 | Metering | **Log usage, don't enforce**, in Phase 1. Price before automation. §13 |
| D16 | Rollout | All institutes, **off by default**. Institute admin creates/activates. |
| D17 | Quiet hours | Institute compliance floor (9 PM IST cutoff, DND) + engine may tighten, never loosen. Replies exempt. |
| D18 | Language | **English, Hindi, Hinglish only.** (Hinglish is not a Meta language code — authored under `en`.) |
| D19 | Timeline | Engine activity writes `timeline_event` (JOURNEY / REACHOUT) → renders in the existing lead journey + student timeline with **no FE work**. |
| D20 | vs Announcements | **Coexist** — broadcast vs 1:1. But they share one 1000/day rate-limit bucket; surface engine consumption. |
| D21 | `engagement_trigger_config` (V8) | **Leave permanently.** Deterministic thresholds vs judgement — different jobs. |
| D22 | Naming | "Engagement Engine", registered via `getTerminology` per CLAUDE.md so institutes can rename it. |
| D23 | Success metrics | **All four**: learner activity, lead conversion, message engagement, team time saved. §14 |
| D24 | Action vocabulary | Extensible handler registry. V1 = reply + share links; **book meeting / update CRM are tasks for now**, handlers later. | **Amended 2026-10-29:** follow-up, note, escalation, status change, AI call and meeting booking/moving are real handlers. §17.2.

---

## 1. The seven facts that shape this design

All verified in source.

1. **WhatsApp read receipts already exist — the "impossible" verdict was wrong.**
   `MetaWebhookController` (`notification-service/webhook/v1/meta`) is **dead code**: not in
   `WebSecurityConfig.ALLOWED_PATHS`, and `/notification-service/v1/**` doesn't match it, so Meta gets
   a 401. Every doom-finding about it (untyped `WHATSAPP_STATUS_EVENT`, the 60s dedup that eats
   transitions, the stubbed signature check) is real **and irrelevant**. The **live** path is
   `CombotWebhookController` @ `/notification-service/v1/webhook` — permitAll, validates
   `hub.verify_token`, parses WhatsApp Cloud format. `CombotWebhookService.processMessageStatusFromWebhook`
   writes **typed** rows via `CombotNotificationType.fromStatus()`: `WHATSAPP_MESSAGE_SENT`/`_DELIVERED`/
   `_READ`/`_FAILED`, each with `source_id`=wamid, `source`=original log id, `user_id`/`institute_id` copied.
2. **…but the bulk send path throws the wamid away.** `WhatsAppService.logWhatsAppMessages:477-478`
   hardcodes `source="whatsapp-service"`, `source_id=templateName`; the provider returns
   `List<Map<String,Boolean>>` — success flags only. So `findOutgoingByMessageId` misses and falls back
   to *most-recent-outbound-to-that-phone*. **Aggregate read-rate works today; per-message attribution
   is a heuristic that degrades exactly where an engine hurts most.**
3. **Everything the brain must obey is Java, in admin_core.** `AudienceOptOutService`,
   `bounced_emails`, `UserAnnouncementPreferenceService`, `NotificationRateLimitService` (V181),
   `CallAiNodeHandler`'s shift planner, `LeadDistributionService`, and the credit tables
   (`institute_credits`, V100 — **admin_core's Flyway**). ai_service reads admin_core's DB but has
   **no Flyway** (12 hand-run `.sql` files under `app/migrations/`).
4. **The workflow engine's resume is broken for our purposes.** `WorkflowResumeJob.resumeWorkflow`
   calls `run(workflow.getId(), ctx)` — it **replays from the start node**, not `paused_at_node_id`;
   duplicate sends are prevented only by soft context flags. Plus `guard++ < 100` node visits/run and a
   serial unbatched poller. Its good parts: `NodeHandlerRegistry`, `NotificationRateLimitService`,
   `CallAiNodeHandler`'s `withinAnyShift`/`nextShiftOpen`, `WorkflowAiDraftService`'s validate→repair loop.
5. **The safe-concurrency pattern is already proven here, three times.** `claimForResume`,
   `LeadFollowupRepository.claimDueTransition`, `AudienceRepository.tryClaimAiCampaign` — all
   conditional-UPDATE claim-per-row. ShedLock **is** wired (V382, `masterDataSource`, `usingDbTime()`,
   8 jobs incl. `MetaLeadPollingJob` — supersedes the old "Meta poller fans out to 4 replicas" note).
   Quartz is `RAMJobStore` in **both** services: triggers, never replica safety.
6. **Three things the spec assumes exist, don't.** No human-task queue (`lead_followup` is
   `audience_response_id NOT NULL` with **no `assigned_to`**; `announcement_tasks` is *learner
   homework*). No AI-voice medium (`MediumType` = exactly `{WHATSAPP, PUSH_NOTIFICATION, EMAIL}`).
   No template auto-registration.
7. **Proactive WhatsApp = pre-approved template + variables.** Free-form is legal **only** inside the
   24h window a *user* opens — which is why D10 matters so much: it is the only place the AI can
   actually write.

---

## 2. D1 — The brain runs in admin_core_service

ai_service is tempting: it shares admin_core's Postgres and `call_intelligence_poller` is already this
exact shape. **Reject it.**

| Claim for ai_service | Why it fails |
|---|---|
| "Only Python meters fail-closed — `CreditClient.checkCredits` fails open" | The credit tables are **admin_core's** (V100). Read `institute_credits.current_balance` in-process; don't call the fail-open client. |
| "admin_core has no safe recurring loop" | ShedLock is wired (V382); claim-per-row is proven 3× in prod; `FOR UPDATE SKIP LOCKED` is a **Postgres** feature. Conflates "Quartz is RAMJobStore" (true) with "no safe loop exists" (false). |
| "asyncio gives free I/O concurrency for LLM fan-out" | Real, and answerable with a dedicated `ThreadPoolTaskExecutor` (`TelephonyAsyncConfig`, `announcementDeliveryExecutor` are precedents). These are I/O-bound HTTPS calls. **Do not use `spring.task.scheduling.pool.size=4`.** |

The kill shot: **ai_service has no Flyway.** And every consent/cap/suppression/shift rule is Java —
reimplementing that set in Python is how you message someone who opted out. Precedent that closes it:
**`WorkflowAiDraftService` already calls Claude directly from admin_core** with a
validate→repair→strict-JSON-re-emit loop.

```
admin_core_service — the whole brain
  EngagementSweepJob  @Scheduled(60s) + @SchedulerLock   ← waste-reducer ONLY
    └ engine cursor scan (O(engines))
      └ per-engine member claim (SKIP LOCKED + 15-min lease)
        └ DataPointRegistry.hydrate(cohort)     ← 1 batched call per provider per cohort
          └ shouldWake(member, bundle)          ← DETERMINISTIC. zero tokens. kills most ticks.
            └ EngagementBrain.decide(...)       ← LLM, batched by engine (shared cache prefix)
              └ PolicyGate: consent → quiet hours → institute-wide cap → credits   ← BEFORE dispatch
                ├ Phase 1  → engagement_action(kind=TASK)  → inbox → human sends
                └ Phase 2  → EngagementDispatcher → POST /notification-service/internal/v1/send
  EngagementReplyJob  @Scheduled(2m)   ← durable wake for inbound (§10)
notification_service — actuation + ledger        ai_service — metering only
```

**Metering:** Java mints `action_id` **before** the LLM call and pins it across retries, then calls
`CreditClient.deductPrecomputed(..., idempotencyKey=action_id)` — idempotent via the
`external_reference_id` partial unique index (V243). This closes the double-charge-on-timeout hole every
HTTP-`decide` design had (they let Python mint the key, so a Java read-timeout retried with a *new* key
and charged twice).

---

## 3. Data model

`admin_core` **V385** (V384 is head — re-verify at build time).

```sql
CREATE TABLE engagement_engine (
  id, institute_id, name              VARCHAR(255) NOT NULL,
  objective         TEXT,                                    -- one engine = one objective (D12)
  status            VARCHAR(20) NOT NULL DEFAULT 'DRAFT',    -- DRAFT|TEMPLATES_PENDING|DRY_RUN|ACTIVE|PAUSED|ARCHIVED
  language          VARCHAR(10) NOT NULL DEFAULT 'en',       -- en | hi | hinglish (D18)
  data_points       JSONB NOT NULL DEFAULT '[]',
  channels          JSONB NOT NULL DEFAULT '{}',
    -- {WHATSAPP:{enabled,auto:false,autoReply:true,provider:'META'},
    --  EMAIL:{enabled,auto:false,emailType:'UTILITY_EMAIL'},
    --  IN_APP:{enabled,auto:false,mode:'SYSTEM_ALERT'},
    --  AI_CALL:{enabled,auto:false,agentName:'...'}}          ← auto:false everywhere in Phase 1
  audience          JSONB NOT NULL DEFAULT '[]',             -- selectors, mirrors announcement_recipients
  quiet_hours       JSONB NOT NULL DEFAULT '{}',             -- may TIGHTEN the institute floor, never loosen
  next_due_at       TIMESTAMP,                               -- DRIVER: institute selection is O(engines)
  last_swept_at     TIMESTAMP,
  created_by, created_at, updated_at
);
CREATE INDEX idx_ee_due ON engagement_engine (next_due_at) WHERE status IN ('ACTIVE','DRY_RUN');

CREATE TABLE engagement_member (
  id, engine_id, institute_id  VARCHAR(255) NOT NULL,
  user_id              VARCHAR(255),   -- NULLABLE: an unconverted lead has NO user_id
  audience_response_id VARCHAR(255),   -- the lead row
  status               VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE|PAUSED|EXITED|OPTED_OUT
  tier                 SMALLINT NOT NULL DEFAULT 2,           -- 0 HOT .. 3 DORMANT
  next_action_at       TIMESTAMP NOT NULL,
  last_decided_at      TIMESTAMP,
  consecutive_no_ops   SMALLINT NOT NULL DEFAULT 0,
  wake_fingerprint     VARCHAR(64),    -- QUANTIZED features (§4.3)
  window_open_until    TIMESTAMP,      -- the WhatsApp 24h free-form window (D10)
  memory_json          JSONB NOT NULL DEFAULT '{}',
  created_at, updated_at
);
-- NULLs are DISTINCT in Postgres: a naive UNIQUE(engine_id,user_id) lets the same unconverted lead
-- enrol N times = N decisions = N messages, to the population with the highest brand risk.
CREATE UNIQUE INDEX ux_em_subject ON engagement_member
  (engine_id, COALESCE(user_id,''), COALESCE(audience_response_id,''));
CREATE INDEX idx_em_due ON engagement_member (engine_id, tier, next_action_at) WHERE status='ACTIVE';
ALTER TABLE engagement_member ADD CONSTRAINT ck_em_subject
  CHECK (user_id IS NOT NULL OR audience_response_id IS NOT NULL);

CREATE TABLE engagement_action (        -- decision = ledger = task = audit. ONE row.
  id                VARCHAR(255) PRIMARY KEY,  -- == correlation_id on the send. Minted PRE-dispatch.
  engine_id, member_id, institute_id VARCHAR(255) NOT NULL,
  prompt_version_id VARCHAR(255),
  kind              VARCHAR(20) NOT NULL,  -- SEND|TASK|REPLY|NO_OP
  action_type       VARCHAR(30),           -- SEND_MESSAGE|SHARE_LINK|CALL|BOOK_MEETING|UPDATE_CRM (D24)
  channel           VARCHAR(20),           -- WHATSAPP|EMAIL|IN_APP|AI_CALL
  status            VARCHAR(20) NOT NULL,  -- PENDING|DISPATCHING|SENT|FAILED|UNKNOWN|SIMULATED|
                                           -- OPEN|ACKED|DONE|DISMISSED|EXPIRED
  assigned_to       VARCHAR(255),          -- NULL in Phase 1 (D6). Column exists for Phase 2.
  template_name     VARCHAR(255),
  variables_json    JSONB,
  draft_body        TEXT,                  -- the human-editable draft
  sent_body         TEXT,                  -- what actually went out (may differ → the EDITED label)
  rationale         TEXT,                  -- "why did it decide this?" — the trust surface
  priority          NUMERIC(5,2),          -- ranks the inbox. No hard cap (D6).
  scheduled_for, expires_at, dispatched_at, completed_at TIMESTAMP,
  outcome           VARCHAR(30),           -- ACCEPTED|EDITED|DISMISSED|ESCALATED — the autotune labels
  error_message     TEXT,
  created_at, updated_at
);
CREATE INDEX idx_ea_inbox  ON engagement_action (institute_id, status, priority DESC, scheduled_for)
  WHERE kind IN ('TASK','REPLY');
CREATE INDEX idx_ea_member ON engagement_action (member_id, created_at DESC);

CREATE TABLE engagement_prompt_version (
  id, engine_id, institute_id VARCHAR(255) NOT NULL,
  version       INT  NOT NULL,
  base_text     TEXT NOT NULL,   -- IMMUTABLE. never re-summarised.
  delta_text    TEXT,            -- what the admin typed THIS time
  compiled_text TEXT NOT NULL,   -- base + deltas, deterministic assembly
  source        VARCHAR(20) NOT NULL,  -- ADMIN|AUTOTUNE
  status        VARCHAR(20) NOT NULL,  -- ACTIVE|SHADOW|SUPERSEDED|REJECTED
  created_by, created_at
);
CREATE UNIQUE INDEX ux_epv ON engagement_prompt_version (engine_id, version);

CREATE TABLE engagement_template_proposal (   -- the D8 negotiation state machine
  id, engine_id, institute_id VARCHAR(255) NOT NULL,
  notification_template_id VARCHAR(255),      -- FK once drafted in notification_service
  name, language           VARCHAR(255),
  proposed_body            TEXT NOT NULL,
  proposed_category        VARCHAR(20) NOT NULL,   -- AI PROPOSES; a human always confirms (§9)
  meta_category            VARCHAR(20),            -- what Meta actually assigned — may DIFFER
  status                   VARCHAR(30) NOT NULL,
    -- AI_PROPOSED|USER_APPROVED|SUBMITTED|META_PENDING|META_APPROVED
    -- |META_REJECTED|META_RECATEGORISED|USER_REVIEW|SUPERSEDED|WITHDRAWN
  rejection_reason         TEXT,
  round                    INT NOT NULL DEFAULT 1, -- alternatives loop counter
  created_by, created_at, updated_at
);
CREATE INDEX idx_etp_engine ON engagement_template_proposal (engine_id, status);
```

`notification_service` **V31** (V30 is head):

```sql
ALTER TABLE notification_log ADD COLUMN correlation_id VARCHAR(255);
CREATE INDEX idx_nl_correlation ON notification_log (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE UNIQUE INDEX ux_nl_engine_corr ON notification_log (correlation_id)   -- at-most-once backstop
  WHERE correlation_id IS NOT NULL AND source = 'ENGAGEMENT_ENGINE';
```

**Why a new column, not `source_id`.** Two contracts want it and they're incompatible: the status
webhook joins on `source_id = wamid` (`findOutgoingByMessageId`); the engine wants `source_id =
action_id`. One column, two truths. `correlation_id` carries the action_id, `source_id` keeps the wamid
so the **exact** status join works.

**Reaching leads (D11).** `RecipientType.AUDIENCE` → `getConvertedUserIdsByCampaign` →
`findConvertedLeads` filters `user_id IS NOT NULL` — **unconverted leads are invisible to the entire
announcements path**. Since leads are a V1 audience, Phase 1 must add a lead reachability path:
resolve contact from `audience_response.parent_*` + `custom_field_values` and send via the unified-send
seam directly (the campaign path), not via announcements. Also note the centralized resolver **cannot**
resolve `ROLE` (roles live in auth_service's DB) — pre-resolve to USER ids first, exactly as
`RecipientResolutionService.preResolveToUserIds` does.

---

## 4. D3 — The scheduler (the answer to "won't this be bulky?")

Your instinct — *"if the level is high priority then only we check, else we put a future date"* — is
exactly right and it has a name: **cost scales with decisions, not with enrolled users.** A member is
invisible until `next_action_at <= now()`. 300k members on a 72h cadence is ~4k due rows an hour.

### 4.1 The loop

```java
// EngagementSweepJob — @Scheduled(fixedDelay=60_000)
// @SchedulerLock(name="EngagementSweep", lockAtMostFor="PT9M", lockAtLeastFor="PT10S")
//   ^ waste-reducer ONLY. The per-row lease is what protects correctness — and it survives the
//     lock expiring mid-run, which at LLM latencies it will.
for (engine : repo.findDueEngines(now, 25)) {                 // O(engines) via idx_ee_due
    var members = repo.claimDueMembers(engine.id, 200);       // §4.2
    var cohort  = registry.hydrate(engine.dataPoints, members);
    for (m : members) executor.submit(() -> decideOne(engine, m, cohort.get(m)));
    repo.bumpEngineCursor(engine.id, now);                    // fairness lives in the OUTER loop
}
```

Fairness must be in the outer loop, not the sort key. A single `ORDER BY tier, next_action_at LIMIT n`
with no institute predicate **is** the starvation mechanism — one 50k-member institute pins tier 0 and
the 200-member tenant who just enabled their engine sees nothing all day. A
`row_number() OVER (PARTITION BY institute_id …)` is worse: `LIMIT` can't push through it, so cold start
sorts *every* due row to pick 200 — the only design that gets **more expensive the further behind it falls**.

### 4.2 The claim: lease, not status-flip

```sql
WITH due AS (
  SELECT id FROM engagement_member
  WHERE engine_id = :engineId AND status = 'ACTIVE' AND next_action_at <= now()
  ORDER BY tier ASC, next_action_at ASC
  FOR UPDATE SKIP LOCKED LIMIT :batch)
UPDATE engagement_member m SET next_action_at = now() + interval '15 minutes'   -- the LEASE
  FROM due d WHERE m.id = d.id RETURNING m.*;
```

**Never `SET status='CLAIMED'`.** A status flip is a *terminal state on pod death*: the row never
re-enters the due scan, the partial index hides it from every diagnostic query, and that member drops
out of the engine **silently, forever** — the worst failure class for an autonomous system, because
nothing tells you. The lease is immune by construction. `SKIP LOCKED` makes replicas *cooperate* —
strictly better than `WorkflowExecutionJob`'s collide-and-lose-on-unique-index. The lease's own risk
(a batch outrunning 15 min → double decision) is closed by §6.3, not by hoping.

### 4.3 `shouldWake()` — deterministic, and it must know what time it is

Where the money is saved: **most ticks cost zero tokens.**

```java
boolean shouldWake(m, bundle) {
    if (bundle.incomplete())           return DEFER;   // a failed fetch is NOT "no data" — §5
    if (bundle.hasUnansweredReply())   return true;    // always
    if (fingerprint(bundle) != m.wake_fingerprint) return true;
    if (cadenceElapsed(m, engine))     return true;    // ← THE ONE THAT MUST NOT BE FORGOTTEN
    return false;
}
```

**`cadenceElapsed` is the whole product.** Every digest-based proposal used
`hash(events + tier + prompt_version)` — *with no clock in it*. That hash is identical on day 7 and day
14 of silence. For a re-engagement engine **elapsed silence is the trigger**, so the gate goes quiet in
exactly the case that should fire, and `consecutive_no_ops` backoff then gives a learner who stopped
logging in **exponentially less** attention the longer they're gone. That's the product inverted,
defended as a cost optimisation.

**Quantize before hashing.** Raw values save money only where there was none to save: a dormant user's
raw digest is stable (you skip a call you didn't want), while an active user's
`PERCENTAGE_PACKAGE_SESSION_COMPLETED` moves every session so the digest changes every tick and the gate
**never fires** — the saving anti-correlates with the value. Fingerprint on *bands*: completion bucket,
days-since-activity bucketed 1/3/7/14, reply-count band.

**Jitter, always:** enrol with `next_action_at = now() + random() * cadence`. Without it, activating a
2,000-member engine is a thundering herd where the gate *cannot* fire (no `last_decided_at`, no
fingerprint) — 100% LLM on the first pass.

**Never put `prompt_version` in the fingerprint.** One admin edit would re-decide every member at once
(2,000 × 3 engines = 6,000 forced calls per edit), and a weekly autotune would do it platform-wide on a
cron — a cost control that periodically disarms itself. A new prompt applies at each member's next
natural wake.

### 4.4 Events pull rows forward

Polling stays lazy because events promote: a reply does
`UPDATE engagement_member SET next_action_at=now(), tier=0, window_open_until=now()+24h WHERE …`.
That's the tiering you described, driven by evidence rather than a schedule.

---

## 5. D4 — The data-point registry (all 7 in V1)

Same idiom as `RecipientResolverRegistry` — Spring collects `List<DataPointProvider>`; adding a data
point is **one new `@Component`, zero core edits**.

```java
public interface DataPointProvider {
    String key();  boolean alwaysOn();
    DataPointSpec declare();                                                  // label, cost, SENSITIVITY, schema
    Map<String, JsonNode> fetch(FetchContext ctx, List<Subject> subjects);   // PLURAL — N+1 unrepresentable
    String render(JsonNode payload);
}
```

`declare()` feeds prompt assembly, so a new data point becomes visible to the brain automatically — the
catalog-as-grounding trick `WorkflowCatalogController` already uses. Unknown keys warn and skip.

| Provider | Source | Cost |
|---|---|---|
| `ledger` *(always-on)* | `POST /notification-service/internal/v1/engagement/ledger-batch` — **new**, §6.2 | 1 HTTP / cohort |
| `profile` *(always-on)* | SQL: users + `custom_field_values` (`findCustomFieldsWithKeysByUserIdsAndInstitute`) | 1 query |
| `crm_lead` | SQL: `audience_response`, `user_lead_profile`, `lead_status(+history)`, `timeline_event`, `lead_followup` | 1 query |
| `enrollment` | SQL: SSIGM + `learner_operation.PERCENTAGE_PACKAGE_SESSION_COMPLETED` (a rollup — no computation) | 1 query |
| `calls` | SQL: `telephony_call_log` + `call_intelligence` dispositions/summaries | 1 query |
| `assessments` | `/assessment-service/internal/student-analysis/assessment-history` — **per-user today** | ⚠ **needs a batch sibling built** |
| `login` | `/auth-service/analytics/student-login-stats` — **per-user today** | ⚠ **needs a batch sibling built** |

**The last two are real Phase 1 cost.** Both are per-user endpoints; called per member they are an N+1
across a service boundary. Build `POST …/batch` variants first. Also:
`/auth-service/analytics/**` is in `ALLOWED_PATHS` → **permitAll**, so `student-login-stats` leaks any
user's login history by `userId` with no auth, despite the class being named `…InternalController` (its
path has no `internal`, so `InternalAuthFilter` — which matches `getRequestURI().contains("internal")` —
never fires). **File that as an IDOR separately; the new batch endpoint must be HMAC-guarded.**

**A failed fetch must DEFER the decision, never return empty.** This codebase's universal
catch→`List.of()` pathology (every `RecipientResolver` does it; a down auth_service yields "delivered to
0 users" with only a log line) is survivable for a human-triggered announcement and catastrophic for an
autonomous sender: a 500 from assessment_service and "this learner has taken no assessments" become
**the same input to the model**. Mark the bundle incomplete and re-lease.

`declare().sensitivity` drives a wizard consent checkbox and prompt redaction — piping a learner's
failed assessments into an LLM that writes to their **parent** is a conversation an institute must be
given, not defaulted into.

---

## 6. D5 — The ledger (Phase 0 — blocks everything)

### 6.1 Capture the wamid (2 files, no schema change)

Change the provider return from `Boolean` to the message id and set `source_id = wamid`,
`correlation_id = action_id`, `source = 'ENGAGEMENT_ENGINE'` in `logWhatsAppMessages`. That single
change turns `findOutgoingByMessageId` from *miss → most-recent-to-phone heuristic* into an **exact**
join, and the existing typed `WHATSAPP_MESSAGE_READ` rows become per-message truth.

### 6.2 One batched read endpoint

`notification_log` lives in notification_service's DB; admin_core cannot read it with SQL. So the
`ledger` provider is **one HTTP call per cohort**:

```
POST /notification-service/internal/v1/engagement/ledger-batch   (HMAC)
  { instituteId, subjects:[{userId?,phone?,email?}], since }
→ { bySubject: { <key>: { lastSentAt, lastReadAt, lastReplyAt, replyText, windowOpenUntil,
                          sends7d, reads7d, failures7d, lastFailureCode,
                          channelsObservable:["WHATSAPP","IN_APP"] } } }
```

`channelsObservable` is load-bearing: **tell the model what it cannot see.** Push writes *nothing* to
`notification_log` (hence D14). Email inbound is off (D9). In-app read receipts live in
`message_interactions`, not `notification_log` — join them in. If the brain can't distinguish *not read*
from *not observable*, it reads silence as rejection and escalates.

### 6.3 At-most-once at the sender

`UnifiedSendService` has **no dedup** — no key, no constraint, no check. A read timeout leaves the caller
unable to tell "not sent" from "sent, response lost"; then the lease re-fires and the customer gets it
twice. The gates don't save you (`notification_rate_limit` is 1000/day).

1. Mint `action_id`, write `engagement_action(status=PENDING)` **before** dispatch.
2. Claim: `UPDATE engagement_action SET status='DISPATCHING' WHERE id=? AND status='PENDING'` → 0 rows = someone else has it.
3. Stamp `options.source='ENGAGEMENT_ENGINE'`, `options.sourceId=action_id` → `correlation_id`.
4. On timeout → `status='UNKNOWN'`. **Do not auto-retry. Reconcile** via the ledger
   (`idx_nl_correlation` lookup), then settle SENT/FAILED.

**The dispatcher claim (step 2) is the ONLY at-most-once mechanism — deliberately.** The original
design also had a partial unique index on `notification_log(correlation_id)` as a "backstop"; the
Phase 0 adversarial review killed it (P0): `notification_log` is an observation log written *after*
the provider send inside swallowed-exception blocks, so a uniqueness violation there dedupes **rows,
not messages** — a legitimate retry after a failed attempt would send the message and then lose its
ledger row (and in a multi-row `saveAll`, take sibling rows down with it), leaving the ledger blind
right after a real send. Constraints on a log table cannot prevent duplicate sends; they can only
corrupt the record of them. **Phase 1a must implement the claim in the dispatcher.**

### 6.4 What Phase 0 actually shipped (2026-07-17, notification_service only)

- **wamid capture**: `ChatbotMessageProvider.sendTemplate/sendText` return the provider message id;
  `CombotMessageProvider.sendPayload` parses Meta (`messages[0].id`) and Com.bot (`message.queue_id`)
  shapes; `WhatsAppService` threads ids index-aligned through the bulk loop;
  `notification_log.source_id` = wamid (legacy `templateName` fallback for WATI/failures).
  `WhatsAppInboxService` also stores its reply's wamid now.
- **V31**: `correlation_id` column + partial lookup index (`idx_nl_correlation`). No unique index (§6.3).
- **Attribution, engine-gated**: `UnifiedSendService` threads `options.source/sourceId` (and email
  `userId`) **only when `options.source == 'ENGAGEMENT_ENGINE'`** — every other caller's rows stay
  byte-identical (announcements pass `source='announcement-service'`, which would otherwise have
  changed their row values and double-attributed per-user email views).
- **Correlation propagation**: the three status/failure writers in `CombotWebhookService` copy
  `correlation_id` from the original **only on the exact wamid join** — never on the
  most-recent-outbound-to-phone fallback, which could belong to a different decision.
- **Ledger-batch endpoint**: `POST /notification-service/internal/v1/engagement/ledger-batch`
  (≤500 subjects/call; fixed query count per cohort). Honesty fixes from review: `observable`
  read/delivery flags are **per-provider** (false for WATI — its status events land as untyped
  `WHATSAPP_STATUS_EVENT` rows via the other pipeline); `recentSends` excludes provider-rejected
  attempts (body `| Status: FAILED |`); `recentFailures` counts `DISTINCT source_id` (a Meta
  failure currently writes two FAILED rows); email matching is `LOWER()` both sides and excludes
  `source='announcement-service'` duplicate/failed rows.

### 6.5 Recorded, not fixed (pre-existing; revisit in 1a/1b)

- Chatbot executors (`SendTemplateNodeExecutor`, `SendMessageNodeExecutor`, `AiResponseNodeExecutor`
  → `ChatbotFlowEngine.logOutgoingMessage`) still write OUTGOING rows with `sourceId=null` and
  ignore the returned wamid — their status attribution stays phone-heuristic, as it always was.
  Correlation gating means they can no longer contaminate engine decisions. Fix opportunistically.
- `sendAttachmentEmail` carries no attribution — an engine action with an email attachment would
  write an unattributed row. Add the overload when the engine grows attachments.
- Batch outbound rows are saved **after** the whole send loop (100ms/recipient), so a fast status
  can still miss the exact join and land unattributed (correlation-gated → safe, just unattributed).
  Engine dispatch is 1 recipient/request, making the window negligible there.
- META institutes stamp `senderBusinessChannelId = meta.appId` — consistent with the send path
  (which uses the same value as phone_number_id), but an institute whose `appId` ≠ phone_number_id
  would write `institute_id=null` rows the ledger can't see. Pre-existing convention; verify per
  institute during engine onboarding.

### 6.6 Gate on failure — the escalation loop nobody modelled

`WHATSAPP_MESSAGE_FAILED` carries Meta codes (131049 / 130472 = quality-throttled). Ungated the loop is:
engine sends → WABA quality drops → sends fail → engine sees no READ → brain concludes "not read" →
**sends more** → the institute's number gets restricted, for every sender on it, OTPs included.
`PolicyGate` trips the engine to PAUSED and raises a task on rising `failures7d`.

---

## 7. D6 — Tasks: the Phase 1 copilot inbox

`lead_followup` is disqualified twice: `audience_response_id NOT NULL` (learners unrepresentable) and
**no `assigned_to`**. The helpdesk (`support_ticket`) models *Vacademy's own* staff — right reference,
wrong extension point. So `engagement_action` is new, and deliberately one row for decision + ledger +
task + audit.

**Phase 1 inbox — institute-wide queue, no assignment (D6):**

| Action | Effect |
|---|---|
| **Ack** | `status=ACKED`. Someone's on it. |
| **Done** | `status=DONE`, `outcome=ACCEPTED`. Handled outside the system. |
| **Send** | Human reviews `draft_body`, edits if they want, hits send → dispatches via §6.3. `sent_body` recorded; `outcome=ACCEPTED` or `EDITED`. |
| **Dismiss** | `status=DISMISSED`, `outcome=DISMISSED`. |

**Send-on-behalf is what makes Phase 1 valuable.** The engine drafts, a human sends. You get real
messages, a real ledger, and — crucially — the `ACCEPTED / EDITED / DISMISSED` labels that Phase 2's
automation and Phase 3's autotune depend on, with zero autonomy.

**No volume cap (D6, your call).** Every decision becomes a visible task; the UI sorts by `priority` and
filters. `expires_at` reaps stale ones.

> **Accepted risk, recorded.** At 50k learners on a 72h cadence that's ~16k due/day; even at a 90% no-op
> gate, ~1,600 tasks/day into an inbox nobody is assigned to. If it becomes wallpaper and gets
> bulk-dismissed, those dismissals are **indistinguishable from "the AI was wrong"** — and they're the
> exact labels Phase 2 relies on. Mitigation without a cap: `priority` ranking, `expires_at`, and a
> **dismissal-rate alarm** — if an institute's dismiss rate exceeds ~80%, stop trusting its labels for
> autotune and tell someone.

---

## 8. D7 — The prompt that grows

> *"this prompt will be remade with the initial things and whatever changes… a prompt that grows with time"*

`base_text` is **immutable**; each admin edit appends `delta_text`; `compiled_text` is deterministically
assembled. **Never re-summarize the prompt with an LLM** — that's drift-by-resummarization, and after
six edits the engine runs something nobody wrote.

**Creation UX (D7): free text + an AI clarifying interview.** The admin types what they want; the AI
interviews them on the gaps — cadence? which PDF/YouTube links? what counts as success? who's excluded?
should it auto-reply? — and compiles the prompt. The interview is where a vague brief becomes an engine
that works, and it feeds straight into the template proposal (§9).

- **Admin edit** → new version, `status=SHADOW` → sampled against ACTIVE, decisions recorded and diffed,
  **never sent** → admin promotes. Shadow mode was invented for the tuner, but the risky edit is a human
  typing *"be more aggressive about fee reminders"* — point it at admin edits too.
- **Autotune** (Phase 3) → same pipeline, `source=AUTOTUNE`, restricted to **narrowing** amendments
  (add a constraint, tighten a cadence) — mechanically checkable, so "the AI edited its own prompt" never
  means "the AI widened its own remit". Human approves. Tone is **not** auto-applicable: tone is brand.
- Show a **behavioral diff, not a text diff**. A text diff is engineer UX.
- Bound `compiled_text`. It ships on every request, forever.

---

## 9. D8 — The template negotiation loop (and the activation gate)

Your loop, as a state machine. This is a **wizard step**, and `status=TEMPLATES_PENDING` gates activation.

```
prompt compiled
  → AI RECOMMENDS templates (name, body, body_variable_names, proposed_category)   [AI_PROPOSED]
  → user reviews / edits / asks for alternatives  ──┐                              [USER_REVIEW]
  → user approves                                    │                             [USER_APPROVED]
  → createDraft + submitToMeta                       │                             [SUBMITTED → META_PENDING]
  → WAIT for Meta (hours→days; poll via syncFromMeta)│
  → META_APPROVED ──────────────────────────────────┤→ all satisfied? → engine may ACTIVATE
  → META_REJECTED / META_RECATEGORISED (utility→marketing) → user reviews ─┘  round++, alternatives
```

- **The LLM proposes `category`; a human always confirms it, and Meta may override it.** Templates are
  `MARKETING | UTILITY | AUTHENTICATION`; Meta re-categorises and rejects; low-quality marketing degrades
  the **phone number's** quality rating, throttling the institute's messaging tier (1K→10K→100K unique
  users/24h) for every sender on that number. An LLM labelling *"Join our new batch!"* as UTILITY to dodge
  caps is a **policy violation, not a rejection**. `META_RECATEGORISED` is therefore a first-class state
  that demands human review — exactly as you described.
- **Once LIVE, never pause for a new template (D8).** A prompt edit needing a new template keeps the
  engine running on already-approved ones; the pending template surfaces as a task ("waiting on Meta").
  Meta approval takes hours to days — pausing a working engine for it would be painful.
- Media headers: Meta rejects public URLs (subcode 2388273) — bytes go through `POST /{appId}/uploads`
  first. That flow already exists in `WhatsAppTemplateManagerService`.
- Write `body_variable_names` on the draft → `resolveTemplateVariablePositions()` gives semantic
  variables (`{"name":…, "payment_link":…}`) instead of positional `{{1}}` for free.
- **Language (D18):** `notification_template` is `UNIQUE(institute_id, name, language)` — so en/hi are
  separate approvals. **Hinglish is not a Meta language code**: author it under `en` with Latin-script
  Hindi body text.

**And say the quiet part in the wizard.** Proactive WhatsApp is template + variables. A dry-run screen
rendering `draft_body` as beautiful AI prose would be **lying about the highest-stakes channel** — for
WhatsApp, previews must render the *resolved template*, not the draft.

**Built (Phase 1b-templates, 2026-07-17).** The state machine lives in
`admin_core/features/engagement/service/EngagementTemplateProposalService.java` over the
`engagement_template_proposal` table (V386 + V387). notification_service exposes the lifecycle over
HMAC via `WhatsAppTemplateInternalController` → the existing `WhatsAppTemplateManagerService`
(`createDraft`/`update`/`submitToMeta`/`getById`/`by-name`/`syncFromMeta`) — no template logic was
re-implemented. **There is no Meta template-status webhook**, so `EngagementTemplateSyncJob` polls
every 5 min (ShedLock-guarded) and reconciles; a manual `POST /template-proposals/sync` backs the
wizard's "check now". The hard lessons the review taught (all fixed): the `submit()` path spans two
services with non-rollback-able HTTP side effects, so it must be idempotent (adopt an orphan draft
by natural key rather than re-`createDraft` into a 409), must reconcile from the notification row's
**real** Meta status rather than blindly `update()` a row already past DRAFT, and must guard every
status write with a CAS (the poll and the human race the same row — a blind save un-approves a
Meta-approved template). A crashed `submit()` is recovered by a 10-min staleness reaper that needs
only notification-DB reads, so it runs even when the institute's Meta token has expired.

---

## 10. D9 — Replies

`ChatbotFlowEngine` and the legacy `channel_flow_config` router already compete for every inbound
message. A third claimant needs a rule **decidable inside the webhook** (notification_service cannot
query admin_core's DB):

1. Meta inbound `context.id` matches an engine wamid → **engine**. Exact, free once §6.1 lands.
2. Keyword matches a chatbot trigger → **chatbot**.
3. `ChatbotFlowEngine.handleIncomingMessage(...)` returns `handled` → chatbot.
4. Otherwise → engine.

Rejected: *"the system that spoke last owns the reply for 24h"* — engine nudges at 9am, learner texts
"FEES" at 2pm, and the institute's **paid-for Jumpstart chatbot is dead for 24 hours**.

**Durable wake, not fire-and-forget.** Best-effort HMAC POST to admin_core is the fast path; if it 500s
the wake is dropped and the slow path is `base * 2^5` away for a dormant member — a lead replying *"yes,
send me the fee structure"* would be answered days later, precisely for the replies that matter most.
So: fast-path POST **plus** an `EngagementReplyJob` doing a 2-minute
`inbound-since?instituteId=&since=` sweep per active institute (one cheap query) that promotes matching
members to tier 0 and stamps `window_open_until`.

**Email inbound stays OFF (D9).** The code is complete but `aws.inbound.email.enabled` defaults false in
**dev, stage AND prod**, and `SqsInboundEmailListener` is `matchIfMissing=false` — the bean doesn't
exist. Turning it on is AWS work (SES us-east-1, MX, S3, SQS, IAM), not code. Until then the ledger
reports email as not-observable for replies.

**Opt-out must be classified, not keyword-matched.** The STOP matcher was built for chatbot flows where
users tap buttons. AI-authored prose provokes AI-authored replies: *"no thanks"*, *"please stop"*,
*"band karo"*, *"who is this"*. Keyword matching sees none of them; the engine messages again in 48h;
in India that's a user report → quality collapse → WABA restriction. **There is an LLM in the loop —
use it to classify inbound intent for opt-out**, in the same pass as escalation (§11). Note also that
WhatsApp-native *Block* and *Stop promotions* never reach `UserAnnouncementPreferenceService`, so the
consent store will confidently say ALLOW for someone who already told Meta no.

---

## 11. D10 — Auto-reply inside the 24h window

**Opt-in per engine** (`channels.WHATSAPP.autoReply`). This is the only place the AI may write freely,
and the risk boundary is coherent: **the user started the conversation.**

| Aspect | Decision |
|---|---|
| **Grounding** | **The engine's prompt only.** The admin puts facts, PDF links and YouTube links in the prompt — exactly as you described. If it's not in the prompt, the AI does not know it. No fee data, no course DB, no knowledge base in V1. |
| **Escalate on** | uncertainty · anger/complaint · money (refund, negotiation, discount) · explicit ask for a human → `kind=REPLY, status=OPEN, outcome=ESCALATED` with the conversation attached. Same classifier pass as opt-out detection. |
| **Timing** | **Replies ignore quiet hours.** They messaged first; answering at 10 PM is courteous, not spam. Proactive sends still respect the floor. |
| **Can do** | Answer + share links from the prompt. |
| **Cannot do (yet)** | Book meetings, update CRM, register for batches → **emitted as tasks** (D24), with a handler registry so they become real actions later without touching the core. |
| **Window** | `member.window_open_until`; outside it, template-only. |

```java
public interface EngagementActionHandler {          // mirrors NodeHandlerRegistry
    boolean supports(ActionType t);
    ActionResult execute(EngagementAction a, EngagementContext ctx);
}
// V1: SendMessageHandler, ShareLinkHandler, CreateTaskHandler.
// Later: BookMeetingHandler, UpdateCrmHandler, CallHandler — drop in a bean, no core edit.
```

Every auto-reply still passes `PolicyGate` (consent, cap, credits) and writes `engagement_action` +
`timeline_event`, so a counsellor opening the lead sees what the AI said.

### 11.1 Assets — material the agent can send (V625)

Grounding in the prompt cannot carry a brochure or a demo video, so each engine has **assets**
(`engagement_asset`): files and links the admin uploads while creating the engine (wizard step,
optional) or later on the engine page. Each item has a title and a **description saying what it is and
when to send it**; that description is what the agent matches a request against.

| Aspect | Decision |
|---|---|
| **What the brain sees** | `EngagementReplyBrain.assetCatalogue`: id, type, title, description. **Never the URL** — the model names ids, it does not paste links. |
| **Found** | `ANSWER` with `assetIds` (max 3). Ids are re-resolved against *this engine's* assets (`EngagementAssetService.resolve`), so an invented or foreign id resolves to nothing. |
| **Delivery** | Ids ride on the action as `variables_json._assetIds`. `EngagementDispatcher.sendWhatsAppReply` sends the text, then each file as a native WhatsApp session media message (`notification_service` `POST /internal/v1/engagement/whatsapp-media`, Meta `link` / WATI `sendSessionFile`). A `link` item is appended to the text instead. It works the same when a human approves an escalated task: the attachments go with the edited text. |
| **Attachment fails** | The text has already gone, so the action stays `SENT`; the failure is written to `error_message` and `rationale` so the counsellor can send it by hand. |
| **Not found** | The brain returns `ESCALATE` with `escalationType=missing_material` and `requestedMaterial`. An `ANSWER` that names ids that do not resolve is turned into the same thing. An OPEN task (priority 90, above other escalations) holds a drafted holding reply, and `EngagementMaterialAlertService` tells the lead's counsellor (the engine's creator if the lead has none) by **bell alert and email**. Each channel is best-effort and independent. |
| **Link guard** | URLs of assets count as grounded, like links in the brief. The holding reply is never auto-sent: a person sends it. |
| **Team alerts** | `EngagementTeamAlertService` tells people whenever the engine hands a reply to a person: any escalation, a missing asset, an auto-send that failed. Recipients: the team members picked on the engine (`engagement_engine.notify_user_ids`, V626, max 10, each checked to hold a non-student role at the institute via `AuthService.getInstituteRoles`) **plus** the lead's own counsellor, de-duplicated; the engine's creator only if there is neither. Channels: bell alert and email, sent independently and best-effort. |
| **Limits** | https URLs only (Meta fetches them), 50 items per engine, media types `document|image|video|audio|link`. |

---

## 12. D13 — Safety, consent, cost

- **The institute-wide cross-engine per-user cap is the only safety mechanism**, because the prompt
  decides cadence (D13). It must be **hard** and enforced **before** the LLM call. Per-engine caps cap
  nothing: 3 engines × 3/week = **9 messages a week** to one learner, each engine correctly believing it
  was restrained. The first complaint is "why is it spamming?" and every audit log says it behaved.
- **Gate order: consent → quiet hours → institute cap → credits → LLM → dispatch.** Gating after the LLM
  pays for decisions you throw away.
- **Consent is a union, and it is fragmented.** `AudienceOptOutService` moves the user to an OPT_OUT
  audience and soft-deletes only their **most recent** active `audience_response` — a user in several
  audiences who opts out is still reachable from the others, and `sendAudienceMessage` performs **no**
  opt-out suppression at all (`// TODO: apply filters` — it sends to every active lead). Read the union:
  OPT_OUT audience + `UserAnnouncementPreferenceService` + `bounced_emails` (`email` UNIQUE with **no
  institute_id** — one complaint anywhere blocks that address platform-wide, forever).
- **Kill switch stops dispatch, not just decisions.** The dispatcher re-reads engine status at send time.
- **Rate-limit visibility (D20).** `notification_rate_limit` is `UNIQUE(institute_id, channel)`,
  `daily_limit=1000` — **one bucket shared with announcements and workflow sends**. An engine silently
  eating 780 of 1,000 means the principal's exam-day notice becomes "delivered to 0 users". Surface engine
  consumption; never treat rate-limited as a silent DEFER. (Also: the naive
  `UPDATE … WHERE reset_date=CURRENT_DATE AND daily_used<daily_limit` returns 0 rows for *capped*,
  *stale reset_date* **and** *row missing* — at 00:00 every engine reads "capped" and goes dark with no
  error. Insert-or-reset first; note `CURRENT_DATE` resolves against the DB session TZ while
  `NotificationRateLimitService` rolls it with Java `LocalDate.now()`.)
- **Quiet hours (D17):** institute floor from `VOICE_CALLING_SETTING` (9 PM IST cutoff, DND scrub) +
  `CallAiNodeHandler`'s `withinAnyShift`/`nextShiftOpen` extracted; an engine may tighten, never loosen.
  Replies exempt (§11).
- **Never inherit notification_service's auth posture.** It is effectively `permitAll` (`ALLOWED_PATHS`
  includes `/notification-service/v1/**` and `/internal/**`; `HmacAuthFilter` is injected as a field but
  **never added to the filter chain**) and identity comes from request-body fields. Engine CRUD lives in
  admin_core under JWT; internals under `/admin-core-service/internal/**` under HMAC.
- **Creator = institute admin (D16).** ⚠ Verify `InstituteAccessValidator` first — a known bug rejected
  **all non-root admins** across ~35 controllers; fixed (8f8b7ff75) but **not deployed**.
- **Membership reconciliation** (unspecified in every proposal): a nightly re-resolve, idempotent against
  `ux_em_subject`, that sets `status='EXITED'` when someone leaves the audience. Without it an unenrolled
  learner keeps getting nurtured by an engine whose entire premise is enrollment.

---

## 13. D15 — Cost model

Verified rates: **Opus 4.8 $5/$25 per MTok · Sonnet 5 $3/$15 ($2/$10 intro to 2026-08-31) · Haiku 4.5
$1/$5**. Batch API **50% off**. Cache reads ≈**0.1×**; writes **1.25×** (5-min TTL) / **2×** (1h).
Register `use_case='engagement'` in `ai_model_defaults` so the model is DB-swappable without a deploy
(default `claude-opus-4-8`; `credit_multiplier` already exists per model).

At 50 institutes × 3 engines × 2,000 members = 300k members, ~3k in / ~200 out per decision:

| | LLM calls/day | Note |
|---|---:|---|
| Naive: every member daily | 300k | not what we're building |
| `shouldWake()` gate (deterministic, **quantized**) | ~30–120k | zero-token skip. The single biggest lever. |
| + prompt caching, batched **by engine** | same calls, ~56% less input | 1 cache write + N−1 reads |
| + Batch API for non-reply decisions | same calls, 50% off those | ~60s latency is fine; replies stay sync |

**The cache floor is model-dependent and it bites hardest where you'd least expect.** Minimum cacheable
prefix: **4,096 tokens for Opus 4.8 AND Haiku 4.5**; 2,048 for Sonnet 4.6/Fable 5; 1,024 for older
Sonnets. A ~1,500-token compiled prompt + schema **silently will not cache** —
`cache_creation_input_tokens: 0`, no error. Pad the prefix past the floor with the `declare()` catalog we
already generate, keep it byte-identical across the engine's cohort (render order is tools → system →
messages; volatile per-member data goes *after* the last breakpoint), and verify with
`usage.cache_read_input_tokens` rather than assuming.

**On a Haiku screen-then-draft cascade:** mostly unnecessary — the deterministic gate already removes
the calls a cheap screen would remove, at zero tokens instead of some. It also collides with Haiku's
4,096-token floor, so the screen would run uncached. Keep it as a Phase-3 tunable.

**Metering (D15): log, don't enforce.** Write `credit_transactions` so you can see real cost per
institute; never block a Phase 1 decision. Before Phase 2, price it: add an `ai_tool_pricing` row
(`unit_field='flat'`) and **mirror it in `tool_cost_estimator.DEFAULT_TOOL_PRICING`** — V321 says so
explicitly and rates are already synced in three places. `ai_token_usage.request_type` is
CHECK-constrained (V325) with no `engagement` value: add a migration, or use `deductPrecomputed` (sends
no `usage_log_id`, so the CHECK never applies — the workaround already in use).

---

## 14. D23 — What the dashboard shows

All four metrics were selected, so the dashboard needs all four — and they have very different
attribution strength. Say so on the page rather than implying the engine caused everything.

| Metric | Source | Honesty note |
|---|---|---|
| **Message engagement** | ledger: read/reply/opt-out rate per engine, per template, per hour-of-day | Directly measured. Strongest signal, weakest business proof — and it's what the brain itself learns from. |
| **Team time saved** | `engagement_action`: created vs done/sent, drafts accepted-vs-edited, median time-to-handle | Directly measured. The clearest Phase 1 win: messages that would never have been sent otherwise. |
| **Learner activity** | `learner_operation` completion deltas for engaged vs not-yet-engaged members | **Correlational.** Needs a holdout to mean anything — see below. |
| **Lead conversion** | `lead_status_history` → CONVERTED, engaged vs not | **Correlational.** Same. |

**Hold out ~5% of each engine's audience.** Without it, "completion went up" is unfalsifiable and the
first sceptical principal will say so. A holdout costs nothing and turns two of your four metrics from
anecdote into evidence. `lead_status_history.source` is a free varchar — pass `'ENGAGEMENT_ENGINE'` so
engine-driven transitions stay auditable and distinguishable from human ones.

---

## 15. Phasing

Phase 1 grew during the interview (both audiences, all 7 data points, template negotiation,
send-on-behalf, auto-reply, in-app, WhatsApp replies). Splitting it honestly:

| Phase | Ships |
|---|---|
| **0 — Ledger integrity** ✅ **BUILT 2026-07-17** (reviewed, compiles clean, NOT deployed) | wamid capture end-to-end; `correlation_id` (V31, lookup index only — see §6.3); engine-gated attribution in unified send; exact-join-only correlation propagation; `ledger-batch` endpoint with per-provider observable flags + failure-code extraction. 11 files, 1 migration, notification_service only. **Deploy notes: off-peak (index build on the highest-write table) + mirror V31 into devops-baseline.** |
| **1a — The brain, read-only** ✅ **BUILT + 2× adversarially reviewed 2026-07-17** (compiles clean across admin_core/assessment/auth, NOT deployed) | **V386** schema (5 tables; note V385 was taken); sweep + per-row lease CAS + `shouldWake` (quantized bands + cadence clock); registry with 7 providers behind the SPI; **batched assessment + HMAC-guarded login endpoints** (sibling services); lead reachability (unconverted leads, which the announcements path can't reach); prompt v1 with immutable base + amendment recompile; engine CRUD + enroll/reconcile + task inbox (ack/done/dismiss) + data-point catalog. Engine decides → TASKs. **No sends.** Two review passes fixed 22 + 6 findings incl. a runtime-fatal null-cast SQL bug the compile hid, cross-tenant IDOR, the lease-outrun double-decide, and a quiet-hours floor-disable. **Deferred to 1b (the UI chunk): FE wizard/inbox, `channel-capabilities` aggregate, `<RecipientPicker>` extraction, token metering (LLMService exposes no usage yet).** |
| **1b-send** ✅ **BUILT + adversarially reviewed 2026-07-17** (compiles clean notification+admin_core, NOT deployed) | **The send path**: `EngagementDispatcher` (at-most-once `claimForDispatch` OPEN/ACKED→DISPATCHING; correlation stamp `sourceId=action.id`→Phase 0 ledger; email + durable in-app via `createSystemAlertAnnouncement`; WhatsApp gated on an approved template); `POST /tasks/{id}/send` send-on-behalf with edit→`sent_body`; REACHOUT `timeline_event` on the lead journey (D19); `EngagementReplyJob` (2-min inbound-WhatsApp sweep → promote members to tier 0 + 24h window) + notification_service `inbound-since` endpoint; DISPATCHING reaper + FAILED→OPEN reopen. Review fixed 10 findings (0 refuted) incl. a **P0 reply-sweep silent no-op** (double-encoded cursor → epoch millis), a **P1 double-send** on post-send exceptions (dedicated `SendRejectedException` → OPEN only pre-send; anything after the POST → FAILED), and a **P1 false-SENT in-app** (raw FCM push wrote nothing → routed through the durable announcement chain). |
| **1b-templates** ✅ **BUILT + adversarially reviewed 2026-07-17** (compiles clean notification+admin_core, NOT deployed) | **The D8 negotiation state machine** (§9): `EngagementTemplateProposal` (V387 adds `variable_names`/`sample_values`/`footer_text`/`rationale` + `(institute_id,status)` idx); `EngagementTemplateAdvisor` (AI proposes Meta-legal templates — name/body/vars/samples/category with honest-category rules); `EngagementTemplateProposalService` (recommend → edit/approve → **submit** → poll-reconcile → alternatives/withdraw); notification_service `WhatsAppTemplateInternalController` (the missing HMAC surface over `createDraft`/`update`/`submitToMeta`/`getById`/`by-name`/`sync`); the **activation gate** in `transition()` (a WhatsApp engine can't go live without ≥1 `META_APPROVED`/`META_RECATEGORISED` template; D8: an already-LIVE engine is never re-paused for a new template); `EngagementTemplateSyncJob` (5-min Meta poll — **there is no Meta template-status webhook**, polling is the only status source). Two review passes (12 confirmed + 2 fix-verify, 1 refuted) fixed a **P1** unguarded catch-rollback that could un-approve a Meta-approved template (→ status-guarded CAS), a **P2 cluster** where `submit()` couldn't recover a lost response on any leg — 409 loop / `update()`-wall deadlock / stranded `SUBMITTED` (→ adopt-orphan-by-name, reconcile-from-actual-Meta-status, 10-min staleness reaper), and P3s (removed `META_RECATEGORISED` from editable; name capped to 255; `{{0}}` rejected; Meta's returned category persisted; reaper runs even when the Meta refresh fails). |
| **1b-brain-picks-template** ✅ **BUILT + adversarially reviewed 2026-07-17** (compiles clean, NOT deployed) | The brain now PICKS an approved WhatsApp template and fills its variables: `decideCohort` passes the engine's enabled channels + `findApproved` templates (name/body/vars/language) into `EngagementBrainClient` once per cohort; the model returns `templateName` + `variables`; `attachWhatsAppTemplate` validates the pick (approved template, every declared variable non-blank), stamps `action.template_name`/`variables_json`/`template_language` (V388), and **overwrites `draftBody` with the deterministic template render** so the reviewed preview == what Meta sends. Review fixed 4 findings (0 refuted) — all dormant dispatcher bugs the change EXPOSED: a **P1** where WhatsApp recorded the free-text draft/edit as `sent_body` while sending the template render (silent edit loss + falsified ledger → sent_body is now the render, a body edit is rejected not dropped), a **P2** hardcoded `languageCode="en"` that broke `hi` templates (→ carry `template_language`), a **P2** draft/render divergence, and a **P2** prompt-only channel gate (→ server-side enabled-channel enforcement in `decideOne`). |
| **1b-autoreply** ✅ **BUILT + adversarially reviewed 2026-07-17** (compiles clean notification+admin_core, NOT deployed) | **The opt-in AI auto-reply + escalation classifier (D9) — the system's FIRST autonomous send.** `EngagementReplyBrain` (one call: ANSWER vs ESCALATE + draft; escalate on uncertainty/anger/money, grounded in the brief only); `EngagementReplyResponder` orchestrates: candidates (ACTIVE engine + `channels.WHATSAPP.autoReply` + open 24h window, one engine per reply = most recently engaged) → **at-most-once gate = `engagement_handled_reply` set insert (V390, ON CONFLICT DO NOTHING)** + member stamp (V389) → lease claim for the LLM window → decide → `kind=REPLY` action (ANSWER auto-dispatches; ESCALATE = priority-85 inbox task). Free-form session send via notification_service `/whatsapp-reply` (reuses the inbox `sendText` primitive; `source=ENGAGEMENT_ENGINE` + `correlation_id=action.id`; success = explicit `accepted` flag, not a wamid — WATI returns none). Dispatcher branches WhatsApp on `kind=REPLY` (free-form, editable, 24h-window + 4096 guards) vs proactive (fixed template). **Defense-in-depth beyond the LLM**: deterministic money/anger/legal tripwire on inbound AND drafted text; link-not-in-brief guard (schemed + bare domains); truncation guard; full inbound text now stored for REPLY rows (was a 100-char preview — a P1: refund questions past char 100 could auto-answer); delimiter neutralization. **Failure honesty**: a FAILED auto-send creates a deterministic escalation task + nudges the member due (never silently dropped, never auto-retried — the send may have landed). Review: 10 findings (1 refuted) + fix-verify 8 more — all fixed. |
| **1b-fe** ✅ **BUILT + adversarially reviewed 2026-07-17** (admin dashboard; tsc + design-lint + lint:naming clean, NOT deployed) | **The whole operator surface** in `frontend-admin-dashboard/src/routes/engagement-engines/`: engine **list** (status cards) → **create wizard** (6 steps: basics+brief, data-point picker w/ sensitive-data consent gate, per-channel enablement incl. WhatsApp auto-reply toggle, audience via `PackageSelector`+CRM campaigns, cadence+quiet-hours, review) → engine **detail** (status transitions mirroring the backend allow-list, audience resolve + live member count, growing brief w/ amendments) → embedded **template negotiation** (propose→edit w/ live {{n}}-parity check→approve→submit→check-Meta, recategorised/rejected surfaced) → **copilot task inbox** (priority-ranked, status filters, ack/done/dismiss/reopen, review-&-send dialog that keeps a fixed WhatsApp template read-only — no editedBody — while replies/email/in-app stay editable). Sidebar (CRM group, adminOnly); terminology helpers for Learner/Batch/AudienceList. Review: 5 findings (0 refuted) — a P2 missing error-state on the template panel + 4 P3 (alignment-check parity w/ backend alignmentProblem, hardcoded "learners", raw language code, switch a11y) — all fixed. **The API-contract lens found zero defects** (params/body split, JSON-string payloads, send-dialog edit rules all correct). |
| **1b-rest** (remaining) | `channel-capabilities` aggregate; dashboard/analytics v1; per-task WhatsApp variable-editing (send dialog shows variables read-only today). |
| **2a — Automation** ✅ **BUILT + adversarially reviewed 2026-07-17** (admin_core + FE; compiles clean, NOT deployed) | **Proactive AUTONOMOUS sends.** `EngagementDecisionService` creates a `kind=SEND` (not a copilot TASK) only when ALL hold: channel `auto` intent set, engine not killed, GRADUATED (`countApprovedSends >= first_n`; default 5), draft sendable (WhatsApp needs an attached approved template), not dry-run, not AI_CALL (task-only). `EngagementDispatchJob` (2-min, ShedLock) fires due SENDs: re-check kill/channel-auto (→ demote to copilot TASK) → **circuit breaker** (recent unbilled-SENT count ≥ threshold → billing broken → demote) → affordability (`CreditClient.hasActiveCredits`, fail-CLOSED) → claim CAS → `dispatchClaimed` → on SENT `deductPrecomputed('engagement_message', key=action.id)` + `markBilled`; a `dispatched_at`-windowed reconciliation re-charges lost deducts. **Kill switch** `PUT /autonomy?killed=` (auto_send_killed; stops sending, keeps drafting). **Holdout** (`holdout_pct`, stable hash at enroll, `is_holdout`) — skipped in the proactive flow AND excluded from the reply path (findAutoReplyCandidates + promoteByPhones). V391 (engine/member/action cols + `engagement_message` rate). Schedule horizon capped (168h). **FE**: wizard per-channel auto toggle + holdout%/first_n; detail-page autonomy panel (kill/resume + graduation `approved/target` + auto channels + holdout); inbox Auto-send badge; engine GET returns `approvedSends`/`effectiveFirstN`. Backend review: 4 findings (3 refuted) — **P1** holdout messaged via the reply path, **P1** no circuit breaker on charge-failure (unbounded unbilled sends), P2 recon-on-created_at + P2 reject-churn — all fixed. FE review: 6 findings (0 refuted, 4 distinct) — P2 disabled-channel keeps its auto flag, P2 AutonomyPanel green "sending" ignored engine.status, P3 holdout review unclamped, P3 kill-button copy — all fixed. **Deploy/config:** no NEW env vars — but admin_core's `ai.service.url` + `ai.service.internal-token` (INTERNAL_SERVICE_TOKEN, must match ai_service) are now load-bearing (credits); if the token is wrong, /deduct fails while /balance reads → the circuit breaker pauses autonomy (safe). Set `engagement.credits.per-message` (default 1.0, keep in sync with V391 seed) as the price. ai_service must be reachable from admin_core. Run V386–V391 (admin_core) + V31 (notification) off-peak; deploy both services + FE together. |
| **2b** (remaining) | Holdout **lift measurement / analytics dashboard** (cohort assigned, not yet reported); send/read/reply/dismissal + credit-spend dashboards; institute-wide kill; per-institute daily send ceiling. |
| **3 — Reach + learning** | AI-call automation (new `MediumType` end-to-end); SHADOW autotune; `BookMeetingHandler` / `UpdateCrmHandler`; email inbound (AWS work); Haiku cascade if the numbers justify it. |

**Deferred, explicitly:** task assignment/routing (D6 — Phase 2+); push as a channel (D14);
`engagement_trigger_config` absorption (**never** — D21); cross-engine orchestration; sub-org scoping.

**DRY_RUN is a switch, not a mandatory week** — offer it, don't require it (a full loop with zero sends
costs real money producing nothing). Make `SIMULATED` **terminal**: on DRY_RUN→ACTIVE a week of
simulated actions must never be picked up by the dispatcher.

---

## 16. Open questions

1. **Task volume in practice.** No cap by choice (D6). Watch dismissal rate on the pilot institutes; if
   it exceeds ~80%, the labels are worthless for autotune and we need ranking or a cap after all.
2. **Credit rate per decision.** Blocked on Phase 2; anchor against `ai_call_out` = 5.0 cr/min.
3. **Hinglish template approvals.** Meta has no Hinglish language code; authoring under `en` is the plan
   — needs one real submission to confirm Meta doesn't recategorise or reject on script grounds.
4. **`/auth-service/analytics/**` is permitAll** — a live IDOR leaking any user's login history. File
   separately; do not design on it staying open.
5. **Sub-orgs.** `sub_org_id` exists on `audience`/SSIGM. Engines are institute-scoped in V1; revisit if
   sub-org tenants need isolation.

---

## 17. What changed since 2026-10-24

Everything in this section is built on `main` (admin_core, notification_service, admin dashboard). It
extends the design above; where it contradicts an earlier section, this section wins. Commit hashes are
the ones to read for the detail.

### 17.1 The engine reads the whole CRM record, and wakes when it changes

| What | How |
|---|---|
| New data points (`484aadcfd9`) | `crm_timeline` (last notes and journey events, notes capped and marked internal), `crm_followups` (open, overdue, last closed), `ai_calls` (last 3 calls with analysis, what the AI agent promised and whether it went out), `ownership` (counsellor, when a person last wrote or called). Batch-loaded per cohort; a failed fetch defers the cohort instead of deciding on missing data. |
| CRM activity wakes the engine (`280987f993`) | A note, follow-up, status or counsellor change, re-enquiry, duplicate merge, list move, overdue follow-up, AI call outcome or finished call analysis asks for a look within 15-20 minutes instead of the next cadence. `EngagementTimelineWakeHook` (one hook on timeline writes) + `EngagementWakeService` (queued after the CRM save commits, debounced past the decision lease). More than 50 leads from one source in 5 minutes is a bulk change and wakes none (S2). The engine's own CRM writes never wake it. V623 adds the wake stamps. |
| Fingerprint bands | Staff notes, follow-ups and calls join the fingerprint (§4.3); old fingerprints are recognised so the rollout does not send every member to the model at once. After a counsellor's note or call the next decision only drafts. |
| Coordination (`3af76a41e2`) | One contact limit across all systems (S1, L10): the notification ledger counts touches per phone and email from the engine, workflows, announcements and the chatbot (once a day), plus outbound AI calls; at the limit the lead is looked at again tomorrow. Counsellor-active hold (F-1: a person touched the lead in 24 h, or a follow-up is due today) means the engine only drafts. Per-lead **do-not-automate** flag (V624) with an API. A lead marked Lost or Not interested is done like Converted (L2). A lead moved to another list leaves the old list's engines and joins the new one's within minutes (L7). |
| Workflows step aside (`2bdf042400`) | Workflow WhatsApp/email nodes skip an ACTIVE lead member of an ACTIVE engine for scheduled runs and lead-nurture events (logged `SKIPPED / ENGAGEMENT_ENGINE`). Payment, enrolment, class, test and form sends are never held; neither are learners, dry-run engines or the AI-call engine. |
| Converted leads leave fast (`75e2a02600`) | A job every 5 minutes reads conversions (lead status history, profile `converted_at`), exits those members and cancels pending rows. AI-call promises still go out. |

### 17.2 CRM actions (D24 amended)

The brain can propose a CRM action instead of a message (`a24ca06dda`, `6726fa2f43`, `9c50b9408d`).
`EngagementCrmActionService` checks each proposal on the server against the engine's allow-list
(`channels.actions`, empty by default) and the action's own rules, stores it as an inbox TASK, runs it
on approval, and can undo it (S9).

| Action | Rules |
|---|---|
| `ADD_NOTE`, `ESCALATE` | A normal note on the lead, labelled AI. |
| `CREATE_FOLLOWUP` | Through the follow-up service; never a second open one (F-4); owned by the lead's counsellor, else left to a person (F-5). |
| `UPDATE_STATUS` | Through the lead status service; never Converted; Lost / Not interested need a note that says why. |
| `SCHEDULE_AI_CALL` | Through the AI call queue (calling shifts, capacity); never after a wrong number or do-not-disturb; at most 3 a week; held until the time the lead asked for (C-1..C-7); uses the engine's own agent pool (§17.3). |

- **Autonomy is per action type (S7).** A type runs without a person only when the admin marked it
  *Runs on its own* **and** a person approved at least `first_n` actions of that same type
  (`countApprovedCrmActions`: DONE + ACCEPTED). Order of checks in `autonomyBlock`: dry run, kill switch
  (S6), per-type intent, graduation, holdout (S10), do-not-automate / unknown coordination, a counsellor
  active (calls and status changes wait; notes and follow-ups for the counsellor go), credits for a call
  (S5). Anything blocked stays the copilot task it already is, with the reason. Actions the engine ran
  itself are outcome `AUTO`, never count toward graduation, and can be undone.
- **The AI call channel allows the AI call action** (2026-10-30). `EngagementCrmActionService.actionsWhere`
  adds `SCHEDULE_AI_CALL` whenever `channels.AI_CALL.enabled`; "Runs on its own" stays a separate, earned
  setting. The wizard shows the row locked on, and the engine-page panel locks the switch.
- **Wizard parity** (2026-10-30): a *CRM actions* section on the Channels step (`CrmActionsPicker`) with
  *Allowed* and *Runs on its own* per action and a help line that auto works after approvals. Create and
  edit share one wizard, so both forms set the same thing; `channels.actions` is held outside the channel
  state and written back unchanged, so an auto flag set on the engine page survives a wizard save.
- UI: inbox shows the action, what will happen and its fields, with Approve / Undo / cancel-a-held-call;
  engine page has a CRM actions panel (`GET/PUT /engines/{id}/actions`, which only rewrites
  `channels.actions`) with graduation progress.

### 17.3 AI calling inside the engine (D14 amended)

1. **First touch is an AI call (hard rule, 2026-10-30).** With the AI call channel on, a person's first
   touch is an AI call, decided in `EngagementDecisionService` (step 1e, before the wake gate and before
   any LLM call), not left to the model. `EngagementCrmActionService.proposeFirstTouchCall` proposes it as
   an inbox task, or runs it through `tryAutonomous`. If the call cannot be placed (no phone, wrong number,
   weekly limit) it falls through to the normal decision, so the person can still be reached another way.
   "First touch" means `EngagementActionRepository.countTouches == 0`, one predicate
   (`TOUCH_PREDICATE`, `961b1d2723`) shared with the upcoming-calls card: no-ops, dry runs, expired
   drafts and dismissed message drafts are not touches; reply drafts, internal CRM tasks and a dismissed
   AI call are. An unanswered reply skips the rule so the reply is handled first.
2. **The prompt knows what AI_CALL means.** It is not a message channel. The model is told to choose
   `actionType SCHEDULE_AI_CALL` (also for a first touch when the brief says so), never `channel AI_CALL`
   with a draft; if it does anyway, the decision step converts it into the call action
   (`EngagementBrainClient.channelSection`, `EngagementDecisionService` step 3b).
3. **A call that did not connect leads to another channel.** The prompt says: after no answer, busy,
   voicemail, failed or a conversation-less call, do not just call again; use another enabled channel that
   fits, never mention the missed call, call again only after a day or at the asked time, not after two
   unanswered calls. The `ai_calls` data point is **always added** for an engine with the AI call channel
   on (`withCallHistory`), because otherwise a missed call is invisible.
4. **The engine wakes when a call fails to happen.** A call that reaches the call log (no answer, busy,
   failed) already wakes it through the CALL_MADE timeline event. A call that never reaches a call log
   (queue cancelled, failed, or expired) now wakes it too: `AiCallQueueDrainJob.finish` and the expiry
   sweep call `EngagementWakeService.wakeLead` for engine-sourced items, and `ai_calls` lists such
   attempts ("asked for but NEVER CONNECTED", last 7 days) via `EngagementCrmReadDao.unplacedCallsByLeadIds`.
5. **Approved calls use the engine's agent pool** (`27f1c5fe6b`): `SCHEDULE_AI_CALL` takes the next agent
   from `channels.AI_CALL.agentPool` (`EngagementAiCallPool.next`) as the campaign id; with no pool the
   action is refused instead of calling with the institute's default agent.
6. **A lead asking for a call gets one** (2026-10-30). `EngagementReplyResponder.isCallRequest` recognises
   "call me back", "please call me", "I am waiting for a call", "can I talk on call", "call karo" (en +
   Hinglish) and excludes refusals ("don't call me", "call mat karo"). A request is never auto-answered; it
   escalates (inbox task + team alert) **and** `EngagementCrmActionService.proposeCallback` proposes an AI
   call (timing from the text: "in 3 hours", "tomorrow"/"kal", "later"; else the next calling slot),
   through `tryAutonomous`. Allowed only if the engine allows AI calls and the lead has a phone.
7. **Follow-through after a call** (`e58d291841`, `ab06ff37d8`): `AiCallFollowThrough` puts the summary
   and callback ask on the lead timeline, queues a callback for the time the lead asked for
   (`AiCallQueueService.enqueueAt`), and leaves a `CALLBACK_REQUESTED` Lead Journey event, an Activity note
   and a counsellor-owned CRM follow-up. `AiCallbackWatchJob` (5 min) alerts once when a scheduled callback
   was not placed or rang unanswered. `EngagementPointsOfContact` resolves who is told (admins + the lead's
   counsellor).
8. **Upcoming AI calls card** (`961b1d2723`, `57ee30ba59`): `GET /engagement/engines/{id}/upcoming-calls`
   (`EngagementUpcomingCallsService`). The engine page card is shown only with the AI call channel on,
   collapsed to a summary line by default, and lists calls needing approval, held for later, in the dialer
   queue, and the next people to be called first. Placed calls are not listed. Approvals come first in the
   inbox (an *Approvals* tab, `c005b9762f`). The AI call channel card on the engine page counts approved
   AI calls with the CRM-action count, since an approved call is DONE/ACCEPTED with no channel.

### 17.4 Replies, consent and meetings

- **STOP and opt-outs** (`2568adfb87`, `42d3d1ea89`, `7bb0b243a3`): STOP is honoured even when no engine
  auto-replies; an opt-out is mirrored into the CRM (opt-out list, lead rows `OPTED_OUT`, timeline); a
  whole-message "not interested" exits the lead, cancels pending rows and sets CRM status `NOT_INTERESTED`
  (else Lost), never downgrading a Converted lead; a qualified refusal stays a human item. One member per
  phone. A lead opted out in the CRM stops getting engine messages right away (`6c2a2e2a65`).
- **Email replies** are read from the reply feed: "unsubscribe" opts out, a plain refusal exits, anything
  else opens an email REPLY task with a "Re:" subject and holds the person's engines until handled.
- **Meetings** (`ed68664755`, `3f50f63a45`, `3bcfa3a2e0`): an optional booking page
  (`channels.bookingPageId`); a reply like "book the demo for Monday 11 am" books it through the booking
  service; a reschedule or cancel is recognised (Hinglish too) and handled by `EngagementMeetingIntentService`
  before the member lookup; with no clear time it asks "when?" with free slots, in the lead's own language;
  a moved or booked meeting is confirmed on the channel the lead used. The goal `exitOnMeetingBooked`
  takes the lead out once a meeting is booked.
- **Known routing gap:** the WhatsApp webhook hands an inbound message to the chatbot flow engine first
  (`CombotWebhookService`); a chatbot session waiting on an AI response node can answer before the engine
  sees it. §10's rule that the engine owns replies to its own messages is not enforced in the webhook.

### 17.5 Scheduling and sending

- **Send schedule** (`405102568c`, `a9f446125a`): stored with the quiet hours (no migration). Planned
  messages go out in a one-hour window from `sendHour:sendMinute` on chosen days; a new person's first touch
  goes right away or waits for the window; replies go as soon as quiet hours allow
  (`EngagementSendSchedule`, `PolicyGate.scheduleSend(REPLY|ANYTIME|PLANNED)`). With "reach people right
  away", members added in bulk are looked at within the hour.
- **Adaptive send time** (`2b6dfa18cb`): three messages at the same time of day with no reply move the
  next one about half a day away, kept in `memory_json` until three more go unanswered, a reply, or an
  admin change (`EngagementAdaptiveSendTime`).
- **New leads join within a minute** (`3f50f63a45`): `EngagementIntakeSweepJob` reads the lists targeted
  by live engines every minute and enrols new lead rows, instead of waiting for the 02:30 UTC reconcile.
- **Graduation applies to waiting drafts** (2026-10-31): `EngagementDispatchJob.promoteGraduatedTasks`
  runs before each dispatch (every 2 minutes). For each live engine whose kill switch is off, and each
  channel set to auto that has `first_n` approved sends, it turns that channel's untouched OPEN message
  drafts into auto-sends due now (`EngagementActionRepository.promoteTasksToAutoSends`). Excluded: ACKED
  tasks, replies, CRM actions, the AI call channel, WhatsApp drafts without an approved template, template-
  only emails without a template, expired drafts. Quiet hours, consent, holds, credits and the circuit
  breaker still apply at send time. A draft sends as written, so a draft that is days old goes out unchanged.
- **Channel readiness and sender** (`405102568c`, `336d1ae61a`): `GET /engines/channel-readiness`; create
  and update refuse a channel that is not set up; the Email channel has a "From email" sender picker
  (`GET /engagement/engines/email-senders`) with a verified flag and a `SENDER_NOT_VERIFIED` reason.
- **Delivery truth** (`00feffcec6`): `EngagementDeliveryCheckJob` (2 min) moves a WhatsApp send Meta
  later refuses (e.g. 131049) from SENT to FAILED with Meta's reason, from
  `GET /internal/v1/engagement/delivery-failures-since`. Auto-sends now show in the Sent tab.
- **Unsent drafts no longer use the weekly cap** (`44f63472ec`).

### 17.6 Templates

- **Email templates** (`55d0c3bf9b`, `c3df7314de`): AI-written, versioned, with a brief check; modes
  `FREE_WRITE`, `TEMPLATE_ONLY`, `TEMPLATE_PLUS_AI_LINE`; a template that breaks the current brief is not
  sent (V616).
- **WhatsApp** (`04579413b9`, `c406d63c7a`): media headers and buttons, versioned edits, a Meta rate-limit
  queue, a promo-label warning, a brief check, a refusal of links not in the brief, long footers refused,
  and a template Meta later disables is taken out of use (V617, V618). The advisor writes **utility-first**
  because Meta caps MARKETING templates per person (131049), and labels MARKETING only when the purpose is
  promotional.
- **Reuse before writing** (`de31b4054e`): `EngagementTemplateReuseMatcher` offers the institute's
  approved templates from other engines (same language, not archived) to the model first; only one that
  fits as written is taken over, with no new Meta review (V627, `reused_from_id`).
- **The brain's template pick is tolerant** (2026-10-30): `attachWhatsAppTemplate` matches the template
  name ignoring case and spacing, takes the only approved template when the name is missing, and finds a
  variable by name (any case, braces) or by position. When a WhatsApp task still cannot get a template, the
  reason is stored on the task (`error_message`) and shown in the inbox instead of only logged.

### 17.7 Admin UI

- **Brief from the Lead Agent or written with AI** (`b45e90d7bf`): `GET /engagement/brief/lead-agents`,
  `POST /engagement/brief/generate` (admin only, not token-charged). It never invents facts; a missing fact
  becomes a TODO line.
- **Edit in the create wizard, archive from any state, delete one that never reached anyone**
  (`4ef07ba0ee`, `5b473170d2`); template and task actions are in the admin activity log (`557f354b4c`);
  status changes follow the dashboard's allow-list.
- **Simpler wizard** (`f70e38614e`): searchable checkbox lists for batches and audience lists, a day-by-day
  plan preview, names instead of counts on the engine page.
- **Alert contacts card** (2026-10-30): the engine page shows who is told when the engine needs a person
  (the team member picked on the engine, with role, email and phone; else the creator; plus each lead's own
  counsellor) with a Change button.
- **Task inbox filters**: engine, channel, kind, day and date range, template and outcome, in the URL
  (`4f0a658386`, `dc13c60002`, `e83a0aced6`). The filters run on the server
  (`GET /tasks?engineId&channel&kind…`), so paging and chip counts match the filter; search still looks only
  at the current page. The engine page's compact stat cards link to the filtered inbox or lead list.
- **Auto-send channel cards** are smaller and link to the engine's Sent tab for that channel.

### 17.8 Reporting and cost

- **Daily report** (`bdaa97acdc`, `5f4b3bc8ef`, `308bb0e6e7`, `9c46f28a7c`): a report API with a WhatsApp
  rate card, a dashboard with Excel and PDF export, an Overview / Daily report switch, a period picker,
  range-aware exports, report-item lists (leads, demos, status changes, conversions, new templates by
  category) and a *Leads and outcomes* page. No token counts are shown.
- **Spend**: the brain's token usage and cost are saved on every action (`fd5827db4f`, V631); Meta
  WhatsApp pricing is saved from status webhooks (`a1fbbfc56c`, V632) and `report-signals`
  (`cfee5fc9df`) feeds the report.

### 17.9 Schema, endpoints and configuration

- **admin_core migrations:** V616 email templates; V617/V618 WhatsApp template sources, headers, versions,
  queue; V623 CRM wake stamps; V624 do-not-automate; V625 engagement assets; V626 notify contacts; V627
  template reuse; V630 assets ensure; V631 action LLM cost; V632 WhatsApp rate card.
- **New endpoints (admin_core, JWT):** `/engines/{id}/actions` (GET/PUT), `/engines/{id}/upcoming-calls`,
  `/engines/channel-readiness`, `/engines/email-senders`, `/brief/lead-agents`, `/brief/generate`, task
  list filters. **Internal (HMAC):** notification_service `delivery-failures-since`, `report-signals`;
  admin_core `…/internal/…/call-analyzed`.
- **Properties:** `engagement.autonomy.first-n` (5), `engagement.task.expire-hours` (72),
  `engagement.wake.enabled` / `bulk-cap` / `bulk-window-minutes` / `jitter-minutes` / `settle-ms`,
  `engagement.ai-call.max-attempts-per-week` (3), `engagement.dispatch.batch` / `delay-ms`.

### 17.10 Open items

1. A call that never connects **and never reports anything** (a dialler failure with no queue or call-log
   row) still wakes nothing; the next look is the normal cadence.
2. The chatbot flow can answer a WhatsApp reply before the engine does (§17.4).
3. A lead's explicit call request still follows the per-type approval ramp for AI calls. Whether a request
   should skip it is a product decision, not made.
4. Drafts promoted on graduation are not re-checked for staleness beyond the 72-hour expiry.
5. The inbox search is page-local; making it server-side needs a backend search over drafts and people.
6. New UI strings added this week exist in English only unless a commit says en/hi/fr/ar.

---

## Appendix — corrections this design makes to its own recon

Recorded because two independent agents made the same mistake, and consensus is not evidence.

| Claim | Reality |
|---|---|
| "Per-message read attribution is IMPOSSIBLE — the single biggest blocker" | **Wrong.** Both agents read `MetaWebhookController`/`WebhookEventProcessor` — a pipeline that is unreachable (not in `ALLOWED_PATHS` → 401). The live `CombotWebhookService` writes typed `WHATSAPP_MESSAGE_READ` with wamid + a join to the original. The real defect is one discarded return value in the bulk send path. |
| "Minimum cacheable prefix is 2,048 tokens" | Model-dependent: **4,096** for Opus 4.8 **and Haiku 4.5**; 2,048 Sonnet 4.6/Fable 5; 1,024 older Sonnets. Worse than stated, and it defeats the proposed Haiku screen. |
| "ShedLock doesn't exist / the Meta poller fans out to 4 replicas" | ShedLock **is** wired (V382, `masterDataSource`, `usingDbTime()`); `MetaLeadPollingJob` is locked. ~19 other `@Scheduled` jobs still fan out — see `docs/scheduler_infra/README.md`. |
| "ai_service has no Flyway, therefore no SQL files" | No Flyway, but 12 hand-run `.sql` files under `app/migrations/` — drift is invisible to tooling, which is the actual argument against putting the hot table there. |
