# Learner side-view → Workflows tab (with Retry)

A tab on the learner/contact side-view listing **the automations that ran for that
person**, each expandable into its per-node steps, with a **Retry** that re-runs one
with the inputs it originally started from.

Visible wherever the learner side-view is (manage-contacts, manage-students,
audience-manager, admissions, assessments) — it is one component in the shared
side-view, not a per-route addition.

---

## The problem this had to solve first

`workflow_execution` had **no user column**. Executions were reachable only by
workflow, schedule, or trigger. The existing per-course view
(`EnrollmentWorkflowRunService`) had to go the long way round —
`trigger.event_id = packageSessionId` → latest execution — which only works for
course-attached enrollment triggers and can never scope to one learner.

The seed context (the payload the trigger handed the run) lived only in memory, so
once a run finished there was nothing left to re-run it *with*. Only paused runs keep
a context, in `workflow_execution_state.serialized_context`, and that is the
mid-flight state of one specific pause — not the original inputs.

Both gaps are closed by V488.

---

## Backend

### V488 — `workflow_execution` gains four nullable columns

> **Version number — check this before merging.** This working tree's highest migration
> is V474, but prod (per the veted Flyway work on 2026-09-01) is already at **487**, so
> V475–V487 exist somewhere this tree does not have. V488 was chosen as the next free
> number after the highest known-applied version. Confirm against
> `SELECT MAX(version::int) FROM flyway_schema_history` — and note that this tree being
> 13 migrations behind prod is a pre-existing problem worth resolving on its own.

| column | purpose |
| --- | --- |
| `subject_user_id` | the auth user the run was FOR. NULL for bulk/scheduled runs with no single subject. |
| `seed_context` (jsonb) | JSON-safe snapshot of the seed context, so the run can be repeated. NULL = not retryable. |
| `retry_of_execution_id` | set on a run created by Retry; the execution it re-runs. |
| `retried_by_user_id` | the admin who pressed Retry. |

Plus `idx_workflow_execution_subject_user (subject_user_id, started_at DESC)`, partial
on the non-null rows — the overwhelming majority of executions are subject-less
scheduled runs the index would never serve.

### Who is a run "for"?

`WorkflowSubjectResolver` reads the seed context. Trigger emitters have never agreed
on one key — the lead paths put `userId` (`LeadTriggerContextBuilder`), the enrollment
path puts a whole `user` DTO (`StudentRegistrationManager`), others use
`studentUserId` / `learnerId` — so it reads them in priority order rather than forcing
a rename across ~40 call sites.

It deliberately **ignores actor keys** (`counselorId`, `statusChangedByUserId`): those
are who *did* it, not who it was *for*. Attributing a run to a counsellor would pile
every one of their leads' automations onto their own profile.

`toStorableContext` strips the context to what Postgres can hold as jsonb. Contexts
routinely carry live JPA entities (`subOrg` is an `Institute`), and serializing one can
drag in a lazy proxy and throw. Values that will not serialize — or exceed 32k chars,
e.g. a cached QUERY result set — are dropped individually, so the rest of the context
survives for a retry.

### Recording is best-effort, on purpose

`WorkflowTriggerService.recordRunSubject()` wraps the whole thing in its own
try/catch. It sits inside the per-trigger try block whose catch marks the execution
FAILED and moves on — so an exception escaping there would **fail a workflow that was
about to run perfectly well**. This is bookkeeping for a UI tab; the worst outcome of a
failure is one run missing from one tab.

It is written **before** the run, so a run that crashes mid-way still appears on the
tab (as FAILED) and can still be retried. Recording it afterwards would lose exactly
the failures worth retrying.

### Endpoints

Both added to the existing `WorkflowExecutionController`; no existing method changed.

```
GET  /admin-core-service/v1/workflow-execution/user/{userId}?instituteId=&pageNo=&pageSize=
POST /admin-core-service/v1/workflow-execution/{executionId}/retry?instituteId=
```

The list is scoped by institute as well as user — an auth user can be a learner at more
than one institute, and an admin of institute A must not see what institute B fired for
the same person. Retry re-checks the same scope; an execution id is guessable.

### What Retry does

A retry is a **new execution, never a mutation of the old one**:

- the original keeps its status and error, so the history stays honest about what
  happened the first time;
- the new row records `retry_of_execution_id`, so the tab can show the pair;
- the new row gets a **fresh `idempotency_key`** (`retry_<originalId>_<uuid>`) — that
  column is UNIQUE, and reusing the original's would have the dedup mechanism reject
  the very thing the admin asked for;
- the context is the stored seed minus the engine's per-run bookkeeping
  (`executionId`, `dryRun`, `__resumed_at_node`, …). Leaving `executionId` in would log
  the retry's nodes against the *original* execution; leaving the resume markers in
  would make it skip to a node from a pause that is not happening this time.

Dispatch goes through the ordinary `AsyncWorkflowExecutor` — the same path the trigger
queue uses — so a re-run is indistinguishable from any other run to the engine, and a
long workflow does not hold an HTTP request open.

**Refused** when the run is still `PROCESSING`, or when it has no recorded seed context
(pre-V488). The API returns the reason as text; the UI shows it in place of the button
rather than silently hiding it.

### No backfill

The migration is **schema-only**. Runs that pre-date it keep a NULL `subject_user_id`,
so they are not listed on anyone's tab and cannot be retried — the API returns that as
the reason rather than hiding the button.

Nothing is inferred from an idempotency key: under the default strategy it is a random
UUID encoding no subject, and a wrong guess would show one learner **another learner's**
automations.

One narrow source of historical subjects does exist — `workflow_execution_state.
serialized_context ->> 'userId'`, for EVENT_DRIVEN runs that paused mid-drip. If you
want those runs listed, that is a deliberate one-off UPDATE against production data,
decided separately.

---

## Frontend

New component
`manage-students/students-list/-components/students-list/student-side-view/student-workflows/student-workflows.tsx`.

- run cards: workflow name, status chip, humanised trigger event, timestamp, and the
  workflow-level error when it failed;
- steps collapse open by default on a failed run (that is the one you opened the tab
  for) and closed otherwise; each failed step reveals its error on click, matching the
  existing `EnrollmentWorkflowStatus` checklist;
- a run that is itself a retry is badged as one;
- polls every 5s only while a run on the page is `PROCESSING`/`PENDING`, so a retry
  finishes in front of you without a manual refresh, and the tab is idle otherwise.

Retry is behind a confirm dialog — re-running really does re-send the emails/WhatsApp
and re-call the webhooks. A `PAUSED` run gets an extra warning: it is mid-drip and will
resume on its own regardless, so re-running puts the person in the sequence twice.

### Settings wiring

New tab id `workflows` / visibility key `workflowsTab`, threaded through
`display-settings` types, the tab-id↔flag maps, `nav-groups` (grouped rail, under
**Records** beside Full History), the merge in `services/display-settings.ts`, the three
role settings screens, and en/fr/hi/ar locale catalogs.

Default: **OFF for every role.** Re-running an automation re-sends its messages, so the
tab is opt-in — an admin enables it per role from Display Settings → Student Side View,
like the other opt-in tabs (Full History, Guardian, Onboarding). Nothing appears on any
existing learner profile until someone turns it on.

The tab is gated on its own flag only. It has nothing to do with the lead system, so an
institute that never turned leads on still gets it.

---

## Verification

- `admin_core_service` compiles clean (targeted `javac` over the module).
  Two **pre-existing** breakages had to be excluded and are unrelated to this work:
  `SuperAdminCallService.java` contains unresolved `<<<<<<< Updated upstream` merge
  markers, and `features/queue/` (referenced by `workflow/queue/*Handler.java`) is
  absent from the working tree.
- `tsc --noEmit`: no errors in any touched file (24 pre-existing errors elsewhere).
- `eslint` and `scripts/design-lint.mjs`: clean on the new component; no new findings in
  the shared files touched.
