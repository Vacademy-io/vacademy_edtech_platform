# AI-Assisted Workflow Creation — Design & Build Plan

**Status:** Phase 0 + Phase 1 BUILT (2026-07-07, compiles + typechecks; not yet live-tested against the LLM) · **Owner:** TBD
**Decision locked:** Template-first hybrid generation · assistive / human-in-the-loop (never auto-publishes)

## Build status (2026-07-07)

**Phase 0 — DONE (admin_core, BUILD SUCCESS):**
- P0 fix: `fetch_expiring_memberships` is now institute-scoped + real end_date window (new `UserPlanRepository.findActivePlansExpiringSoonByInstitute`). No more cross-tenant leak.
- Catalog reconciliation: fixed ~10 param-name mismatches in `WorkflowCatalogController.getQueryKeys()`, added the 2 missing queries (`fetch_live_session_attendance`, `fetch_enrollment_details`), added `POOL` applied-type.
- New AI-grade grounding endpoint `GET /admin-core-service/v1/workflow/ai-catalog` (`WorkflowAiCatalogController`): query output shapes, per-node safety flags, generation rules, workflow JSON shape (aligned to `WorkflowBuilderDTO` @JsonProperty names).

**Phase 1 — DONE (backend BUILD SUCCESS, frontend typecheck + design-lint clean):**
- `POST /admin-core-service/v1/workflow/ai-draft` (`WorkflowAiDraftController` + `WorkflowAiDraftService`): grounding pack → LLM (reuses `LLMService`/OpenRouter, model prop `workflow.ai.draft.model`) → parse → `WorkflowValidationService.validate` → bounded repair loop (3 attempts) → returns `{workflow, rationale, clarifyingQuestions, templateUsed, validationErrors, warnings}`. Forces `status=DRAFT` + the caller's `instituteId`.
- Frontend: `draftWorkflowWithAi` service + types; `AiDraftPanel` "Describe your automation" box wired into Step 1 of the create wizard — drafts, shows rationale/warnings, and loads the draft into the existing builder canvas (reusing the editor's DTO→ReactFlow mapping) for review before Publish.

**Smoke test — PASSED 3/3 (2026-07-07)** against real OpenRouter (key from the ai-service/voice-bot pods): reproduced the exact system prompt + grounding pack and generated workflows for (1) instant thank-you email `TRIGGER→SEND_EMAIL`, (2) 3-day delayed conditional WhatsApp `TRIGGER→DELAY→CONDITION→SEND_WHATSAPP`, (3) scheduled weekly attendance `TRIGGER→QUERY→SEND_EMAIL`. All matched the `WorkflowBuilderDTO` shape (correct `trigger_event_name`/`node_type`/`source_node_id`), used no dead/mutating nodes, and had valid edges + rationale. Two bugs found + fixed: (a) the model default `anthropic/claude-3.5-sonnet` 404s on this OpenRouter account — changed to `anthropic/claude-sonnet-4.5`; (b) **admin_core has NO `openrouter.api.key`/`OPENROUTER_API_KEY` env** (only ai-service + voice-bot do), so the endpoint will 500 in prod until that key is added to admin_core's deployment.

**Deploy prerequisites:** (1) add `OPENROUTER_API_KEY` to the admin_core pod env (same value ai-service uses); (2) optionally set `workflow.ai.draft.model` (default `anthropic/claude-sonnet-4.5`; `anthropic/claude-sonnet-5`/`opus-4.8` also available on the account).

## Drip / weekday-aligned sequences (2026-07-23)

Driven by the SuchBliss 14-day trial requirement ("WhatsApp drip that always starts the Monday after signup"), which the drafter could not previously express:

- **Engine:** `DelayNodeHandler` gained `delay.until = NEXT_DAY_OF_WEEK` (`dayOfWeek`, `time` default 09:00, `timezone` default Asia/Kolkata, `includeSameDay` default false = strictly next occurrence). Reuses the existing persistent pause/resume path, so it survives restarts like any long DELAY.
- **Completion budget:** `LLMService` hardcoded `max_tokens=4096`, so any ~15-node draft (a 14-day drip) hit `finish_reason=length` on every attempt and failed. `ConversationSession` now carries an optional `maxTokens`; the drafter sets `workflow.ai.draft.max-tokens` (default 16000).
- **Grounding:** ai-catalog documents both DELAY shapes, plus two new generation rules (delay shapes; "a drip is ONE workflow of DELAY→SEND pairs, never per-day workflows or LOOP"). System prompt teaches the drip/trial pattern incl. `on = "{#ctx['user']}"` for single-learner sends and EVENT_BASED idempotency.
- **Validation:** `WorkflowValidationService` now checks DELAY configs (nested shape required; weekday/time/timezone parse) so the repair loop catches bad delay configs instead of them executing as 0-delays.
- **Builder UI:** DELAY node config panel has a "Wait mode" toggle (Fixed duration / Until next weekday) so AI-drafted until-weekday delays are reviewable and hand-editable.

### Hardening pass (2026-07-24) — audit fixes

- **SpEL survives pause/resume:** `SpelEvaluator` registers a `MapAccessor`, so `#ctx['user'].fullName` still resolves after a persisted DELAY JSON-round-trips beans into Maps (previously every dot-access after a multi-day delay threw EL1008 and could kill the rest of a drip).
- **Trigger idempotency is now authorable:** `WorkflowBuilderDTO.TriggerDTO.idempotency_generation_setting` (validated in `WorkflowValidationService`, persisted by `WorkflowBuilderService`, passed through the FE store/publish payload and AI drafts). Guidance corrected: per-person drips need `CUSTOM_EXPRESSION` including the learner — `EVENT_BASED` on an enrollment event would admit only the first learner per batch.
- **Statuses tell the truth:** `markAsCompleted` and the resume path no longer clobber PAUSED with COMPLETED when a run parks at the next DELAY; a sweeper (resume job tick) fails executions stuck PROCESSING >6h with no pending resume state.
- **Sends recorded post-success:** the engine marks notification nodes executed only after a successful dispatch (errors/rate-limits no longer count as "sent").
- **Drafting ops:** `LLMService` uses its own timeout-bounded RestTemplate (5s connect / 160s read); `/ai-draft` has a per-institute sliding-hour rate limit (`workflow.ai.draft.rate-limit-per-hour`, default 30).
- **Panel UX:** clarifying questions render real entity pickers (audience/batch/session/invite), drafting is cancellable, empty responses surface a toast, position-less drafts get a layered auto-layout, and `workflow_type` is inferred from trigger/schedule when missing so triggers can't silently drop at publish.

## Review + hardening (2026-07-07)

Adversarial multi-agent code review (45 agents) + adversarial LLM pseudo-tests (6/6 passed — the model asks instead of guessing, refuses SEND_PUSH/mutating queries, uses correct field casing, and resists a prompt-injection goal). **Fixes applied this pass** (backend BUILD SUCCESS, FE tsc + design-lint clean):
- **Grounding accuracy:** corrected two non-existent query keys in ai-catalog (`fetch_audience_responses_by_day_difference`→`getAudienceResponsesByDayDifference`, `fetch_upcoming_fee_installments`→`getUpcomingFeeInstallments`); fixed the CONDITION example so the SpEL `condition` sits inside the routing entry (what the engine evaluates) — a drafted conditional branch would otherwise misroute.
- **Security (P1):** `/ai-draft` now requires `@RequestAttribute("user")` + `InstituteAccessValidator.validateUserAccess` (was: any authenticated user could bill LLM spend to any institute); the requesting user is attributed on the LLM usage row.
- **Robustness:** detect `finish_reason=="length"` (truncated JSON) and retry compactly instead of burning attempts; `safeValidate` now fails **closed** (validator exception surfaces an error, not a false-clean); drop any model-invented `workflow.id`.
- **Frontend:** clear stale draft/answers when the goal is edited; surface clarifying questions even when a partial draft is returned (was silently dropped); 150s request timeout so the panel can't hang forever.
- **Docs:** un-marked `fetch_expiring_memberships` as BROKEN (now fixed + institute-scoped).

**Still open (recommended follow-ups):**
- **P1 — LLM call has no HTTP timeout:** `LLMService` uses the shared `new RestTemplate()` bean (infinite connect/read), so a stalled OpenRouter response blocks the servlet thread forever; each admin retry leaks another Tomcat worker. Give `LLMService` a dedicated `RestTemplate`/`RestClient` with ~5s connect / ~120s read (don't mutate the shared bean — other clients depend on it). The 150s FE timeout only bounds the browser side.
- **P1 — no rate limit / credit gate:** each `/ai-draft` is up to 3 Sonnet completions with a large prompt; add a per-institute rate limit (reuse `notification_rate_limit` or the AI-credits path). The membership check limits *who* can call it but not *how often*.
- **P2/P3 (grounding polish):** verify + correct `producedContextKeys` for a few triggers (AUDIENCE_LEAD_SUBMISSION `lead`, PAYMENT_FAILED `user`, ABANDONED_CART eventId meaning), the FILTER `outputKey` vs `resultKey`, and `fetch_ssigm_by_package` status param name; make `extractJson` robust to fences-inside-strings / two JSON objects; keep `rationale` when the model emits an array-of-strings.
- **P3:** `findActivePlansExpiringSoonByInstitute` (like the MEMBERSHIP_EXPIRY scheduler) skips plans with NULL `enroll_invite_id` (some sub-org plans) — documented, not a regression, but a coverage gap if sub-org expiry reminders are needed.

**Not yet done:** in-cluster end-to-end test of the deployed `/ai-draft` endpoint (the LLM path itself is verified; the Spring wiring is not exercised until deployed); institute-entity grounding injection (real audiences/batches/templates into the prompt — currently the drafter asks clarifying questions for IDs); `ai_workflow_draft` audit table + eval harness (Phase 2); conversational refinement (Phase 3).

> Companion to [WORKFLOW_PLATFORM_PROGRESS.md](WORKFLOW_PLATFORM_PROGRESS.md) (the verified engine reference). Every constraint in this doc is grounded in the 2026-07-07 code+prod audit — read that doc first if a term here is unfamiliar.

---

## 1. Goal

Let an admin describe an automation in plain language —

> *"3 days after someone fills the JEE lead form, if they haven't enrolled yet, WhatsApp them the brochure."*

— and get back a **complete, valid, editable workflow draft** loaded into the existing builder canvas, with a plain-English explanation of each node. The admin reviews, tweaks any node, and clicks **Publish**. Nothing is ever auto-activated.

**Non-goals (v1):** autonomous/unattended workflow creation; editing arbitrary existing production workflows via chat; generating brand-new node *types* or prebuilt queries; multi-workflow campaign orchestration.

### Why this is tractable (architecture fit)

1. Workflows are already **declarative JSON** (`{name, trigger|schedule, nodes[], edges[]}`) — the model emits a data structure, not code or freehand SpEL.
2. A **machine-readable catalog** already exists (`/catalog/trigger-events`, `/query-keys`, `/event-applied-types`, `/trigger-context-variables`, `/actions`) — the grounding schema is 80% there.
3. `POST /v1/workflow/validate` gives a **closed generate→validate→repair loop** before a human sees anything.
4. **25 tested use-case templates** with deterministic `generateWorkflow(answers)` codegen are both few-shot examples and a safe parameterization path.
5. The builder **already loads a workflow JSON for editing** — the AI output lands in the real editor; review-before-publish *is* the human-in-the-loop guarantee.

---

## 2. Prerequisite (Phase 0) — the catalog is the model's ground truth, and it is currently wrong

An LLM fed today's catalog will confidently emit invalid params. Before generation can be reliable, reconcile `WorkflowCatalogController` with `QueryServiceImpl` and **enrich it into an AI-grade schema**. This also fixes the human builder's dropdowns, so it pays for itself independent of the AI feature.

### 2a. Fix the ~12 known param mismatches (source of truth = `QueryServiceImpl.execute()`)

| Catalog says | Code actually reads |
|---|---|
| `statuses` | `statusList` |
| `fieldId` (upsertUserCustomField) | `customFieldId` |
| `studentId` (checkStudentIsPresentInPackageSession) | `userId` |
| `dayDifference` (getAudienceResponsesByDayDifference) | `instituteId` + `daysAgo` |
| `userId` (createSessionParticipent) | `sourceId` |
| createSessionSchedule: `endTime`/`timezone` | only `sessionId` (+ recurrence fields) exist |
| fetchPackageLMSSetting: `packageId` only | also requires `settingKey` |
| getUpcomingFeeInstallments: `startDate`/`endDate` | no such params; zero required |
| fetch_live_session_participants: `status` | no status param |
| fetch_batch_attendance_report | omits `from`/`to`/`excludeToday` |

Also: **add the 2 implemented-but-uncatalogued queries** (`fetch_live_session_attendance`, `fetch_enrollment_details`); **add event metadata** for `LEAD_CALLED_BACK` and `AUDIENCE_OPT_OUT` (currently fall back to "General/null" in the picker); **add the `POOL` event-applied-type** description.

### 2b. Enrich into an AI-grade schema (new fields per catalog entry)

The current catalog describes *inputs*. The model also needs *outputs* and *safety metadata*:

- **Per query:** exact output keys **and the field names inside list items** (e.g. `fetch_ssigm_by_package` → `ssigm_list[]` with snake_case `full_name`/`mobile_number`; `fetch_batch_attendance_report` → `students[]` with camelCase `fullName`/`attendancePercentage`). Field-name casing differs per query — this is the #1 thing the model gets wrong.
- **Per trigger event:** the context keys it produces (already partially in `/trigger-context-variables` — extend to all 34 wired events, not just 6).
- **Per node type:** its config JSON schema.
- **Safety flags:** `mutating: true` (createLiveSession, createSessionSchedule, createSessionParticipent, upsertUserCustomField, updateSSIGMRemaingDaysByOne), `dryRunSafe: false` (QUERY, SET_LEAD_STATUS, COMBOT), `hasHandler: false` (ROUTER), `stub: true` (SEND_PUSH_NOTIFICATION), `semanticWarning` (INVITE_FORM_FILL fires on page view; LIVE_SESSION_START/END are 5-min-scan approximations).

Ship this as a single internal endpoint the drafter consumes: `GET /internal/workflow/ai-catalog?instituteId=…` returning the merged, corrected, enriched schema.

> **Bundle the P0 fix here.** `fetch_expiring_memberships` does `userPlanRepository.findAll()` with no institute or expiry filter (cross-tenant exposure; `QueryServiceImpl.java:1616-1676`). Fix its scoping in the same pass — it lives in the layer being reconciled, and an AI that offers the expiry-reminder templates would otherwise generate a data-leaking workflow.

---

## 3. UX flow

```
Workflow → Create
  ┌─────────────────────────────────────────────┐
  │  ✦ Describe your automation                  │
  │  ┌───────────────────────────────────────┐   │
  │  │ 3 days after a JEE lead form fill, if  │   │
  │  │ they haven't enrolled, WhatsApp the    │   │
  │  │ brochure.                              │   │
  │  └───────────────────────────────────────┘   │
  │                       [ Draft with AI ]       │
  └─────────────────────────────────────────────┘
        │
        ▼  (0–2 clarifying questions if ambiguous)
   "Which audience is the JEE lead form?"  [ dropdown of real audiences ]
        │
        ▼
   Draft rendered in the existing builder canvas
   + right-panel explanation:
     "① Trigger: Audience Lead Submission (JEE Leads)
      ② Delay 3 days
      ③ Condition: not yet enrolled
      ④ Send WhatsApp: brochure template"
        │
        ▼
   Admin edits any node → [ Publish ]   (never auto-activated; lands as DRAFT)
```

Key properties:
- **Clarifying questions are bounded** (≤2) and prefer resolving to a *real entity picker* (audiences/batches/invites the institute owns) rather than free text — reuses the existing `EventEntityPicker` data sources.
- The draft is a **normal workflow in the builder** — no special "AI mode." Everything downstream (validate, test-run, publish) is the existing path.
- The explanation panel is generated alongside the JSON (the model returns `{workflow, rationale[]}`), so the admin understands what they're about to publish.

---

## 4. Architecture

```
┌── frontend-admin-dashboard ──────────────────────────────┐
│  workflow/create: "Describe your automation" box         │
│  → POST /v1/workflow/ai-draft {goal, answers?}           │
│  ← {workflow JSON, rationale[], clarifyingQuestions[]}   │
│  loads workflow JSON into the existing Zustand builder    │
└──────────────────────────────────────────────────────────┘
                         │
                         ▼
┌── admin_core_service (orchestrator — owns workflow domain) ┐
│  WorkflowAiDraftController.draft(goal, answers)            │
│   1. build GROUNDING PACK (§5)                             │
│   2. call model (ai_service / registry) with pack + goal   │
│   3. parse → workflow JSON + rationale                     │
│   4. VALIDATE (/validate) + LINT (§6)  ── repair loop ×N   │
│   5. return draft (persist as DRAFT only on Publish)       │
└───────────────────────────────────────────────────────────┘
                         │  model completion only
                         ▼
┌── ai_service (model provider) ───────────────────────────┐
│  /v1/workflow/generate  → LLM via DB model registry       │
│  (Claude / OpenRouter; same gateway as other AI features) │
└──────────────────────────────────────────────────────────┘
```

**Why admin_core orchestrates (not ai_service):** the catalog, `/validate`, the institute's entities/templates, and persistence all live in admin_core. Keeping the workflow-domain logic there and treating ai_service purely as the model call avoids splitting workflow knowledge across two services. ai_service stays a thin, swappable completion provider (consistent with the existing AI-in-ai_service migration).

---

## 5. The grounding pack (the crux)

Assembled per-request by admin_core and handed to the model. Contents:

1. **Corrected + enriched catalog** (§2b) — events, queries (with output field names + safety flags), node config schemas, actions.
2. **The institute's real entities** — audiences, batches, live sessions, enroll invites (same APIs the entity picker uses), so the model resolves "the JEE lead form" → a real `audienceId`. Names + IDs only; capped.
3. **The institute's existing templates** — ACTIVE EMAIL + WHATSAPP `message_template` names, their `dynamic_parameters`, and channel. Lets the model reference a real `templateName` (or flag "you'll need to create a template").
4. **Few-shot exemplars** — 3–5 of the 25 `USE_CASE_TEMPLATES`' generated JSON, chosen by trigger-type relevance to the goal. These encode the correct patterns (list-wrapping `on`, `forEach`, real field names, EVENT_BASED idempotency where needed).
5. **The hard constraints (§7)** as explicit system-prompt rules.

Token budget: the catalog + node schemas are static (cache); entities/templates are institute-scoped and capped (top-N by recency, with a note if truncated — never silently drop).

---

## 6. Generation strategy — template-first hybrid

```
                ┌─ goal ─┐
                ▼        │
   Classify trigger + intent (which of the 25 templates, if any, fits?)
                │
        ┌───────┴────────┐
   template fits?      no template fits
        │                    │
        ▼                    ▼
  Parameterize the     Freeform node composition
  template's answers   from the catalog (few-shot
  (safe codegen path;  guided). Higher scrutiny in
  reuses tested JSON)  validate + lint.
        │                    │
        └──────┬─────────────┘
               ▼
     VALIDATE (/validate) + LINT (§6 rules)
               │
        errors?├── yes → feed errors back to model → regenerate (≤3 tries)
               │
               ▼ no
        Draft + rationale returned
```

Template-first because the 25 templates already bake in the patterns a naive LLM breaks (see §7). The model's *first* job is classification + slot-filling against a proven template; only genuinely novel goals drop to freeform, where the validate+lint net is tightest.

### Output contract the model must emit

```jsonc
{
  "workflow": {
    "name": "…", "description": "…",
    "workflow_type": "EVENT_DRIVEN | SCHEDULED",
    "trigger": { "event_name": "...", "event_applied_type": "...", "event_id": "..." },   // or
    "schedule": { "schedule_type": "CRON", "cron_expression": "...", "timezone": "..." },
    "nodes": [ { "id", "data": { "label", "nodeType", "config" } } ],
    "edges": [ { "source", "target" } ]
  },
  "rationale": [ { "nodeId": "...", "explains": "why this node, in plain English" } ],
  "clarifyingQuestions": [ { "id", "question", "entityType": "AUDIENCE|BATCH|...|FREE" } ],
  "templateUsed": "lead_followup_email | null"
}
```

If `clarifyingQuestions` is non-empty, the frontend renders them (entity pickers where possible) and re-submits with `answers` — the model must not invent an `event_id` it wasn't given.

---

## 7. Guardrails — the lint pass

Every draft (template or freeform) runs a static lint before it's returned. Each rule encodes an audited failure mode:

| # | Rule | Why (audit finding) |
|---|---|---|
| L1 | No reliance on QUERY `resultKey`; downstream refs use the query's real output keys | `resultKey` is silently ignored — results flat-merge via `putAll` |
| L2 | SEND_EMAIL/SEND_WHATSAPP `on` must resolve to a List; wrap singletons `{#ctx['x']}` | handler errors if `on` isn't a Collection |
| L3 | Recipient + `templateVars` field names must exist in the source query's output field set | snake_case vs camelCase differs per query; wrong name → literal `{{var}}` / skipped recipient |
| L4 | Reject `ROUTER` (no handler) and `SEND_PUSH_NOTIFICATION` (stub) | unexecutable / no-op |
| L5 | Event trigger on an at-least-once emitter → require `EVENT_BASED` idempotency | default is random UUID = no dedup → double-fires |
| L6 | No `mutating` query in a flow the admin will Test-Run; block auto test-run if present | QUERY/SET_LEAD_STATUS/COMBOT have no dryRun gate |
| L7 | Attach a semanticWarning when using INVITE_FORM_FILL / LIVE_SESSION_START / LIVE_SESSION_END | fires on page view / 5-min-scan approximation |
| L8 | DELAY must use nested `delay.{value,unit}`, never flat `delayValue/delayUnit` | legacy flat shape executes as 0 delay |
| L9 | Graph reachability: every node reachable from start; every path reaches `end`; every `targetNodeId` exists | unknown target = dropped branch + Sentry |
| L10 | `templateName` must reference an ACTIVE institute template of the right channel — else emit "create this template first" | missing/empty `dynamic_parameters` → no mapping UI |
| L11 | `event_id` and all entity IDs must belong to the requesting institute | cross-tenant scoping |
| L12 | User-facing copy in any generated template must use terminology settings, not hardcoded terms | per CLAUDE.md naming rule |

Lint failures that the model can fix → fed back into the repair loop. Lint *warnings* (L7) travel with the draft into the rationale panel so the admin sees them.

---

## 8. Safety model

- **Never auto-activates.** AI output is a DRAFT; publish is a separate human action (the existing Publish button with its confirm).
- **No side effects during drafting.** Generation reads catalog/entities/templates only; it does not run the workflow. If we later offer an in-draft "preview run," it must use `/test-run` (dryRun) **and** be blocked by L6 when mutating nodes are present.
- **Institute-scoped** end to end (L11); the drafter only sees the requesting institute's entities/templates.
- **Model output is untrusted** — always through validate + lint before it reaches the builder; the builder itself remains the final editable gate.
- **Bounded cost** — ≤3 repair iterations, capped grounding pack, per-institute rate limit on drafting.

---

## 9. API surface (new)

| Endpoint | Purpose |
|---|---|
| `POST /admin-core-service/v1/workflow/ai-draft` | `{goal, answers?}` → `{workflow, rationale, clarifyingQuestions, templateUsed}` |
| `GET /admin-core-service/internal/workflow/ai-catalog?instituteId` | merged/corrected/enriched grounding schema (also reusable by the human builder) |
| `POST /ai-service/v1/workflow/generate` | thin model-completion endpoint (grounding pack + goal → raw model JSON) |

Reuses existing: `POST /v1/workflow/validate`, `POST /v1/workflow` (create as DRAFT), the entity-picker and template-list APIs.

No new tables required for v1 (drafts live client-side until Publish). *Optional* later: an `ai_workflow_draft` audit table (goal, generated JSON, accepted/edited/discarded) to build an eval set and measure edit-distance between generated and published.

---

## 10. Prompt design (sketch, not final)

- **System:** role + the §7 constraints as hard rules + the output contract + "prefer parameterizing a template; only compose freeform if none fits; never invent an entity ID you weren't given — ask instead."
- **Tools/context:** the grounding pack (§5) as structured JSON blocks (catalog, entities, templates, few-shot).
- **User:** the goal, plus any prior clarifying answers.
- **Response format:** forced JSON matching the §6 contract (use the model's structured-output / tool-call mode so parsing can't drift).

Use the latest capable Claude model via the registry for generation quality; the classification step (template match) can use a cheaper tier.

---

## 11. Evaluation

- **Golden set:** 30–50 NL goals → expected workflow skeletons (trigger type, node sequence, key params), spanning all major templates + a few genuinely novel goals. Score: `/validate` pass rate, node-sequence match, param correctness, lint-clean rate.
- **Live-fire in staging:** publish a sample of generated drafts against a test institute and confirm they actually execute (watch `workflow_execution_log`) — because the Executions tab shows COMPLETED even on node failure, assert on per-node `SUCCESS`, not workflow status.
- **Edit-distance metric (post-launch):** how much admins change the draft before publishing → the real quality signal.

---

## 12. Phasing

| Phase | Scope | Rough effort |
|---|---|---|
| **0** | Reconcile + enrich catalog into the AI-grade schema; fix the `fetch_expiring_memberships` P0 in the same pass; expose `/internal/workflow/ai-catalog` | S–M |
| **1 (spike)** | `POST /v1/workflow/ai-draft` (classify → template-first → validate/repair), "Describe your automation" box loading the draft into the builder, ≤2 clarifying questions | M |
| **2** | Freeform composition for uncovered goals; full lint pass (§7); rationale/explanation panel; golden-set eval harness | M |
| **3** | Conversational refinement ("make it 5 days", "also CC the parent") editing the draft in place; fold into the **Vacademy Assistant** initiative | M–L |

---

## 13. Open decisions

- **Host surface:** standalone "Describe your automation" box now vs entry point inside the broader Vacademy Assistant. (Recommendation: standalone in the create page for Phase 1; converge into the Assistant at Phase 3.)
- **Model:** single strong model for both classify + generate, or cheap-classify + strong-generate split. (Recommendation: split once volume justifies it.)
- **Draft persistence/audit:** ship the `ai_workflow_draft` audit table in Phase 1 for the eval loop, or defer. (Recommendation: ship a minimal version — it's the only way to measure quality.)
- **Freeform ceiling:** how far to let the model compose novel graphs vs. always requiring a human to wire routing for anything template-less.
```

---

## 14. The MCP path — authoring automations from Claude / ChatGPT / Cursor (2026-09-19)

An admin with the Vacademy MCP server connected (see `ai_service/MCP_SERVER_GUIDE.md`)
can now build automations from their own AI app. This is the Phase-3 "fold into the
Assistant" step, done the way the website builder did it: **the connected LLM is the
only model**. Nothing on this path calls `/v1/workflow/ai-draft`, OpenRouter, or spends
credits — which also sidesteps the missing `OPENROUTER_API_KEY` on admin_core.

Two tools in `ai_service/app/services/assistant_tools_workflow.py`, each one toggle in
Settings → MCP Server (and in Assistant settings, same groups):

| Tool | Group | Actions |
|---|---|---|
| `workflows` (READ) | `workflows` | `list`, `get`, `runs` (executions + per-node log), `catalog`, `context`, `template` |
| `workflows_edit` (WRITE, draft-only + additive) | `workflows_edits` | `validate`, `create_draft`, `update_draft`, `discard_draft`, `create_email_template`, `create_whatsapp_template`, `sync_whatsapp_templates` |

**Grounding is the existing grounding.** `workflows(catalog)` proxies
`GET /v1/workflow/ai-catalog` (§2b's AI-grade schema) in sections — `overview` (JSON shape
+ generation rules), `node_types`, `queries`, `triggers`, plus the plain catalog's
`trigger_events` and `query_keys` — so the rules the in-product drafter obeys are the
rules an external model reads. `workflows(context)` is the §5 entity grounding served as
data: batches (`package_session_id`), lead campaigns, ACTIVE email + APPROVED WhatsApp
templates with their placeholders, live sessions, enroll invites. The description tells
the model to take ids and template names only from there.

**The write path is the §6/§7 loop with the model outside the server.**
`workflows_edit(validate | create_draft | update_draft)` runs one shared `check_workflow`:

1. *Normalise* — accept the drafter contract (`{workflow: …}`), the builder shape or the
   canvas shape (`data.nodeType`), camel or snake case; fold `config.routing[]` into
   edges (the builder derives routing from edges); copy a CONDITION node's predicate onto
   its true edge and label the other `false` (what `workflow-builder.tsx` does on save);
   backfill `trigger.trigger_event_name` from the TRIGGER node; default the start node;
   and **force** `id` (none / the draft's), `institute_id` (the pinned principal's) and
   `status = DRAFT`.
2. *Lint* — the §7 rules the backend validator does not cover: L4 dead node types
   (ROUTER, SEND_PUSH_NOTIFICATION) are errors; L8 flat DELAY is an error; L9
   reachability from the start node; L2 `on` must be SpEL; L1 `resultKey` warns; L6
   mutating query keys and `SET_LEAD_STATUS`/`COMBOT` warn; L5 missing idempotency warns;
   L7 INVITE_FORM_FILL / LIVE_SESSION_* warn; non-cron cron strings error.
3. *Templates (L10)* — `templateName` on SEND_EMAIL must be a real institute email
   template (error), on SEND_WHATSAPP/COMBOT an APPROVED one (warning otherwise) — the
   same split as `WorkflowAiDraftService.verifyTemplates`.
4. *Institute scoping (L11)* — trigger `event_ids` and literal QUERY `batchId` /
   `packageSessionIds` / `audienceId` are checked against the institute (exact lookups
   for batches and campaigns → error; list membership for sessions/invites → warning).
5. *Backend `/validate`* — its ERRORs block, its WARNINGs are relayed.

Only a clean check reaches `POST /v1/workflow` (or `PUT /{id}` for a draft). The result
carries `editor_url` (`<institute admin portal>/workflow/<id>/edit`) and the instruction
to have the admin review and publish there. `update_draft` and `discard_draft` load the
workflow through `/edit`, refuse it if `institute_id` differs, and refuse it if
`status != DRAFT` — a published automation cannot be changed or removed from an AI app.

**Templates (L10, the other half of the flow).** A send node is only as good as the
template it names, so the model can create what is missing: `create_email_template`
posts to `/institute/template/v1/create` with `status=ACTIVE`, `contentType=text/html`
and `dynamicParameters` derived from the `{{placeholders}}` in subject + HTML (empty
`dynamic_parameters` is why the builder's mapping UI sometimes never appears); the
response carries a `send_node_hint` with the `templateVars` keys to fill.
`create_whatsapp_template` creates a draft in notification-service and submits it to
Meta (`PENDING`), after checking Meta's rules locally — name `[a-z0-9_]`, positional
`{{1}}…{{n}}` with no gaps, no leading/trailing variable, one sample value per
variable, body ≤ 1024, UTILITY (default; MARKETING repeats to one number are
rate-limited by Meta, AUTHENTICATION refused). `sync_whatsapp_templates` pulls the
status back. `context` lists DRAFT/PENDING/REJECTED WhatsApp templates separately so a
just-created one is visible but not offered as sendable, and the lint keeps warning
until it is APPROVED. Existing templates are never edited or removed from here — a
live automation may be sending them.

**Deliberately not exposed:** publish/activate (the human-in-the-loop guarantee of §8),
Test Run (`QUERY`, `SET_LEAD_STATUS`, `COMBOT` have no dry-run gate), `trigger-now`,
the in-place node-template editor (it edits live workflows), and editing/deleting
message templates.

Tests: `ai_service/tests/test_workflow_tools.py` (normaliser, lint, template/ownership
checks, draft-only containment, reads) and the exposure assertions in
`tests/test_mcp_adapter.py`.
