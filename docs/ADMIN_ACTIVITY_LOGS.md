# Admin Activity Logs

An audit log of administrative mutations in `admin_core_service`. Every annotated controller method writes one row to `admin_activity_log` after the wrapped business call returns.

> **Correction (2026-07-17).** This document previously claimed the row is written *inside* the business transaction (a "transactional outbox", atomic with the mutation). **That has never been true.** `AuditableAspect#audit` carries `@Transactional(REQUIRED)`, but Spring's `AspectJAwareAdvisorAutoProxyCreator` **does not proxy `@Aspect` beans** — so an aspect cannot advise itself — and the annotation is silently ignored. The advice runs with no transaction of its own; by the time it executes, the service's own `@Transactional` has already committed, and the audit `INSERT` commits separately.
>
> Verified empirically against Spring 6.1.5 with a standalone context reproducing the exact wiring: an ordinary `@Transactional` bean shows an active transaction, the `@Aspect`'s advice does not.
>
> What this means in practice:
> - **The audit row is not atomic with the mutation.** A crash between the commit and the `INSERT` loses the audit row while keeping the business change. Rare, but possible — do not treat this log as a guaranteed-complete ledger.
> - **An audit failure genuinely cannot break a customer mutation** — the hard rule below still holds, just for a different reason than claimed. Nothing the aspect does can mark the business transaction rollback-only, because it does not share one.
> - **Annotating a partial-success endpoint is safe.** The aspect does not impose all-or-nothing semantics on the method it wraps. This is why the v3 bulk endpoints could be annotated.
> - **`async = true` is not meaningfully different** from the default today. Neither path is atomic; async only moves the write off the request thread.

The feature is **opt-in per endpoint** via the `@Auditable` annotation. If a method doesn't carry the annotation, nothing runs — no bytecode, no allocation, zero overhead.

---

## How to instrument a new endpoint

### Minimum required

Add `@Auditable` to the controller method (it works on service methods too, but controllers are where the request context and `clientId` header live, so prefer controllers).

```java
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;

@PostMapping("/add-course/{instituteId}")
@Auditable(
    entityType = "COURSE",
    action = "CREATE",
    entityIdExpr = "#result",
    descriptionExpr = "'created course ' + #addCourseDTO?.courseName"
)
public String addCourse(@RequestBody AddCourseDTO addCourseDTO,
                        @PathVariable String instituteId,
                        @RequestAttribute("user") CustomUserDetails userDetails) {
    return courseService.addCourse(addCourseDTO, userDetails, instituteId);
}
```

That single annotation produces a row like:

```
{
  actor_name: "John Doe",
  actor_email: "john@vacademy.io",
  entity_type: "COURSE",
  entity_id: "7bd4615a-...",
  action: "CREATE",
  description: "created course Mathematics 101",
  http_method: "POST",
  endpoint: "/admin-core-service/course/v1/add-course/{instituteId}",
  request_payload: { courseName: "Mathematics 101", ... },
  response_status: 200,
  response_time_ms: 87
}
```

The frontend renders this in `/admin-activity-logs` as **"John Doe created course Mathematics 101"** (the entity name "Mathematics 101" is auto-bolded by a pattern matcher in [ActivityLogTable.tsx](../frontend-admin-dashboard/src/routes/admin-activity-logs/-components/ActivityLogTable.tsx)).

### Annotation fields

| Field | Required | Type | Purpose |
|---|---|---|---|
| `entityType` | yes | String | Logical resource type, uppercase snake. Used to filter audit rows. Examples: `COURSE`, `LIVE_SESSION`, `LEARNER`, `INSTITUTE_SETTING`. New types are free-form — add to the frontend's `RESOURCE_OPTIONS` dropdown in [ActivityLogFilters.tsx](../frontend-admin-dashboard/src/routes/admin-activity-logs/-components/ActivityLogFilters.tsx) once you start emitting them. |
| `action` | yes* | String | Logical action, uppercase. Examples: `CREATE`, `UPDATE`, `DELETE`, `CANCEL`, `ENROLL`, `PUBLISH`. Same dropdown convention as above (`ACTIVITY_OPTIONS`). *Optional only when `actionExpr` is set, in which case it acts as the fallback. |
| `actionExpr` | optional | SpEL | Resolves the action at runtime, for one mapping that performs several logical operations. Evaluated after the call, so `#result` is available. Takes precedence over `action`; falls back to it when blank. If both are empty the row is **skipped** — `action` is NOT NULL. See the multi-operation example below. |
| `conditionExpr` | optional | SpEL | Guard. When set and it does not evaluate to `true`, no row is written. Evaluated after the call, so it can read `#result`. For endpoints that return 200 without mutating anything — a dry-run, or a bulk call where every item was skipped. Fails closed: a failed evaluation skips the row. See gotcha 7. |
| `entityIdExpr` | optional | SpEL | Returns the id of the affected entity. Pulled from method args, `#user`, or `#result`. Example: `"#courseId"`, `"#result"`, `"#req?.id"`. |
| `descriptionExpr` | optional but recommended | SpEL | Produces the human-readable verb-and-object fragment ("created course X"). Actor name is prepended automatically by the frontend, so don't include the actor. |
| `captureBefore` | optional | SpEL | Evaluated *before* the wrapped method runs. Used for UPDATE/DELETE to snapshot the entity's prior state. Supports bean references — see the example below. |
| `payload` | optional | enum | `FULL` / `REDACTED` (default) / `NONE`. `REDACTED` masks fields named `password`, `token`, `otp`, `cardNumber`, `cvv`, `secret`, `apiKey` (case-insensitive). `NONE` omits the body. |
| `maxPayloadBytes` | optional | int | Caps the serialized payload size (default 64,000). Bodies above this are truncated with `...[truncated]`. Set lower for bulk-import endpoints with multi-MB bodies. |
| `async` | optional | bool | Default `false` = the row is written inline, on the request thread, after the business call returns. `true` = fire-and-forget on a separate executor. Neither path is atomic with the business transaction (see the correction at the top), so this only trades a little request latency for a lost-on-crash window. |

### SpEL context variables

Inside any SpEL expression on the annotation, these are available:

- **Method parameter names** — every `@RequestBody`, `@PathVariable`, `@RequestParam`, etc. is bound by its parameter name. `#courseId`, `#instituteId`, `#addCourseDTO?.courseName`, etc. Use `?.` safe-navigation to avoid NPEs on null DTOs.
- **`#user`** — the `CustomUserDetails` extracted from `@RequestAttribute("user")` if present in the method args.
- **`#result`** — the return value of the wrapped method. Available in `entityIdExpr` and `descriptionExpr` (evaluated *after* the call). For controllers returning `ResponseEntity<X>`, use `#result?.body?.id`.
- **`#before`** — the result of `captureBefore` (raw object, not JSON). Lets `descriptionExpr` reference data that only existed before the mutation — e.g., names of rows being deleted.
- **`@beanName.method(args)`** — Spring bean references via the configured `BeanFactoryResolver`. Useful for `captureBefore` to call a service method that loads the current entity.

### Bean references (the killer feature for `captureBefore`)

Use `@beanName.method(...)` to invoke a Spring bean from SpEL. The bean name follows the standard Spring convention (camelCase class name).

```java
@Auditable(
    entityType = "INSTITUTE_SETTING",
    action = "UPDATE",
    entityIdExpr = "#instituteId",
    descriptionExpr = "'updated certificate settings'",
    captureBefore = "@instituteSettingManager.getSettingData(#userDetails, #instituteId, 'CERTIFICATE_SETTING').body"
)
```

The aspect resolves `@instituteSettingManager` to the `InstituteSettingManager` Spring bean, calls `getSettingData(...)` with the request's args, and stores the returned object as JSON in the `before_payload` column. The frontend's drawer renders this as a side-by-side **Before → After** view.

If the bean call throws (entity not found, etc.), the aspect catches silently — the audit row still writes with `before_payload = null`.

---

## Examples

### CREATE — name from request body

```java
@PostMapping("/add-course/{instituteId}")
@Auditable(
    entityType = "COURSE",
    action = "CREATE",
    entityIdExpr = "#result",
    descriptionExpr = "'created course ' + #addCourseDTO?.courseName"
)
public String addCourse(@RequestBody AddCourseDTO addCourseDTO, ...) { ... }
```

### UPDATE — fallback to id when name is missing

```java
@PutMapping("/update-course/{courseId}")
@Auditable(
    entityType = "COURSE",
    action = "UPDATE",
    entityIdExpr = "#packageId",
    descriptionExpr = "'updated course ' + (#packageDTO?.name ?: #packageId)"
)
public String updateCourse(@RequestBody PackageDTO packageDTO,
                            @PathVariable("courseId") String packageId, ...) { ... }
```

The Elvis `?:` falls back to `#packageId` when the DTO's `name` field is null.

### DELETE — capture names *before* the row is gone

```java
@DeleteMapping("/delete-courses")
@Auditable(
    entityType = "COURSE",
    action = "DELETE",
    entityIdExpr = "T(java.lang.String).join(',', #courseIds)",
    captureBefore = "@packageRepository.findAllById(#courseIds).![packageName]",
    descriptionExpr = "#before != null and !#before.isEmpty() ? "
            + "'deleted course ' + T(java.lang.String).join(', ', #before) : "
            + "'deleted ' + #courseIds.size() + ' course(s)'"
)
public String deleteCourse(@RequestBody List<String> courseIds, ...) { ... }
```

- `@packageRepository.findAllById(#courseIds)` returns `List<PackageEntity>` (the JPA repo's `findAllById` is free with `JpaRepository`).
- `.![packageName]` is SpEL's projection operator — projects each entity to its `packageName` field, yielding `List<String>` of names.
- `descriptionExpr` references the projected list as `#before` and joins with commas.
- Ternary fallback: if the lookup failed or returned empty, the description degrades to a count.

Output row: `John deleted course Mathematics 101, Physics 201, Chemistry 110`.

### Bulk — count when individual names aren't meaningful

```java
@PostMapping("/delete")
@Auditable(
    entityType = "LIVE_SESSION",
    action = "DELETE",
    descriptionExpr = "'deleted ' + (#request?.ids?.size() ?: 0) + ' live session(s)'"
)
public ResponseEntity<?> deleteLiveSessions(@RequestBody DeleteLiveSessionRequest request, ...) { ... }
```

### Multi-operation endpoint — action derived from the request

`POST /institute_learner-operation/v1/update` switches on an `operation` field to
terminate, deactivate, reactivate, move batches, or change expiry. A fixed
`action` would stamp all six identically and make terminations unfilterable, so
the action comes from the request itself:

```java
@PostMapping("/update")
@Auditable(
        entityType = "LEARNER",
        actionExpr = "#requestWrapper?.operation",
        descriptionExpr = "@auditNarrator.statusChangeFor(#requestWrapper?.operation, #requestWrapper?.requests)")
public void updateStudentStatus(@RequestAttribute("user") CustomUserDetails user,
                                @RequestBody StudentStatusUpdateRequestWrapper requestWrapper) { ... }
```

Emits `TERMINATE`, `MAKE_INACTIVE`, `MAKE_ACTIVE`, `UPDATE_BATCH`, `ADD_EXPIRY`,
`UPDATE_STATUS` as distinct actions. Each needs an entry in `ACTIVITY_OPTIONS`
to be filterable from the UI.

### Naming things: `AuditNarrator`

Requests carry ids, not names — a termination knows a `userId` and a
`packageSessionId`, but the log has to read "terminated Amit Kumar from Physics
201". Rather than repeat lookups across annotations as unreadable SpEL, they
live in the [`AuditNarrator`](../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/admin_activity_logs/service/AuditNarrator.java)
bean and annotations call `@auditNarrator.<method>(...)`:

| Method | Produces |
|---|---|
| `enrollmentOf(verb, name, psIds)` | `enrolled learner Amit Kumar in Physics 201` |
| `bulkEnrollmentOf(verb, userIds, psIds)` | `enrolled 5 learner(s) in Physics 201` |
| `statusChangeFor(operation, requests)` | `terminated 5 learner(s) from Physics 201` |
| `coursesFor(ids)` | `Physics 201` / `3 courses` |
| `learnerFor(id)` / `learnersFor(ids)` | `Amit Kumar` / `5 learner(s)` |

Conventions worth keeping if you extend it:

- **Never throw.** Every method degrades to a count, an id, or null. Audit must
  not break a mutation.
- **Course names are deduplicated**, so several batches of one course read as
  that course rather than "3 courses".
- **One name, many counted.** Listing every learner in a bulk action makes the
  row unreadable; the count is what an admin scanning the log needs.
- **No actor in the phrase** — the table prepends `actor_name` when rendering.
- **Distinct method names, no overloads.** SpEL resolves overloads poorly when
  an argument is null.

### Settings UPDATE — before/after diff

```java
@PostMapping("/save-setting")
@Auditable(
    entityType = "INSTITUTE_SETTING",
    action = "UPDATE",
    entityIdExpr = "#instituteId",
    descriptionExpr = "'updated ' + #settingKey?.toLowerCase()?.replace('_', ' ')",
    captureBefore = "@instituteSettingManager.getSettingData(#userDetails, #instituteId, #settingKey).body"
)
public ResponseEntity<String> saveSetting(@RequestAttribute("user") CustomUserDetails userDetails,
                                            @RequestParam("instituteId") String instituteId,
                                            @RequestParam("settingKey") String settingKey,
                                            @RequestBody GenericSettingRequest request) { ... }
```

The drawer in the audit-log UI shows the prior setting JSON on the left and the new (request) payload on the right, with copy-to-clipboard buttons on each.

---

## Frontend description rendering

The audit table renders each row as `**{actor_name}** {description}`. Names inside the description are auto-bolded by regex match in [ActivityLogTable.tsx](../frontend-admin-dashboard/src/routes/admin-activity-logs/-components/ActivityLogTable.tsx).

`NAMED_DESCRIPTION_PATTERNS` entries capture **alternating groups**: odd groups are connective text, even groups are names. That lets one sentence bold more than one subject. First match wins, so specific patterns must precede looser ones.

| Backend `descriptionExpr` outputs | Renders as |
|---|---|
| `created course X` | created course **X** |
| `updated course X` | updated course **X** |
| `deleted course X, Y, Z` | deleted course **X, Y, Z** |
| `scheduled live session X` | scheduled live session **X** |
| `created booking X` | created booking **X** |
| `enrolled learner X in Y` | enrolled learner **X** in **Y** |
| `re-enrolled learner X in Y` | re-enrolled learner **X** in **Y** |
| `enrolled 5 learner(s) in Y` | enrolled **5 learner(s)** in **Y** |
| `terminated X from Y` | terminated **X** from **Y** |
| `deactivated X in Y` / `reactivated X in Y` | deactivated **X** in **Y** |
| `moved X from A to B` | moved **X** from **A** to **B** |
| `changed status of X in Y to Z` | changed status of **X** in **Y** to **Z** |
| `changed expiry date of X in Y to Z` | changed expiry date of **X** in **Y** to **Z** |
| `switched WhatsApp provider to X` | switched WhatsApp provider to **X** |
| `updated WhatsApp credentials for X` | updated WhatsApp credentials for **X** |
| `removed WhatsApp credentials for X` | removed WhatsApp credentials for **X** |

CRM sentences (added 2026-09-08):

| Backend `descriptionExpr` outputs | Renders as |
|---|---|
| `created / updated / deleted audience X` | created audience **X** |
| `sent a message to audience X` | sent a message to audience **X** |
| `imported 340 lead(s) into X` | imported **340 lead(s)** into **X** |
| `added / updated / deleted / restored lead X` | added lead **X** |
| `registered walk-in lead X` | registered walk-in lead **X** |
| `assigned lead X to Y` | assigned lead **X** to **Y** |
| `assigned / reassigned 12 lead(s) to Y` | assigned **12 lead(s)** to **Y** |
| `changed lead status / tier / score of X to Y` | changed lead status of **X** to **Y** |
| `marked lead X as converted` | marked lead **X** as converted |
| `scheduled / rescheduled / closed a follow-up for lead X` | … for lead **X** |
| `created / updated / deleted lead status X` | created lead status **X** |
| `connected Meta lead form X to audience Y` | connected Meta lead form **X** to audience **Y** |
| `created / updated counsellor pool X` | created counsellor pool **X** |
| `tagged 48 contact(s) with X` | tagged **48 contact(s)** with **X** |
| `created / updated / deleted automation X` | created automation **X** |
| `created engagement engine X` | created engagement engine **X** |
| `changed the status of 6 enquiry(s) to X` | changed the status of **6 enquiry(s)** to **X** |

If your new endpoint emits a verb-noun phrase the frontend doesn't recognize, the description renders as plain text (no bolding). That's fine — adding a new pattern is a one-line regex addition in `NAMED_DESCRIPTION_PATTERNS`. Keep the alternating-group convention or the renderer will bold the wrong half.

**Mind the prefixes you share with an existing pattern.** `updated lead <X>` bolds
`<X>` as a lead's name, so a settings endpoint phrased "updated lead TAT and
follow-up SLA settings" rendered "updated lead **TAT and follow-up SLA
settings**". It now says "updated TAT and follow-up SLA settings". The split is
pinned by [activity-log-sentence.test.ts](../frontend-admin-dashboard/src/routes/admin-activity-logs/-components/activity-log-sentence.test.ts)
— add a case there with every new phrase, since a mis-bolded row is invisible to
types and to a passing render.

---

## Filtering (read side)

`GET /logs` and `GET /logs/export.csv` accept `actorId`, `entityType` and
`action` as **comma-separated lists** (`actorId=a,b,c`), with `actorIds` /
`entityTypes` / `actions` as plural aliases. One value emits `= ?`, several emit
`IN (...)`; both are served by the existing composite indexes. A single value
behaves exactly as before, so old links and bookmarks keep working.

Commas rather than repeated `actorId[]=` keys is not a style choice — the
ingress rejects raw brackets in a query string with a 400 before the request
reaches the service.

`entityId` is deliberately **not** split: bulk actions store a comma-joined list
of ids in that column, so splitting it would break the "history of this entity"
lookup.

On the UI side the three filters are multi-selects. "Performed by" lists the
institute's own team (the Teams-page roster, via `fetchEligibleOrgUsers`) by full
name and email rather than asking for a pasted user id — deliberately not a
`DISTINCT actor_id` over the log table, which would be an aggregate over every
row an institute has ever written. An actor who has since left the institute is
therefore not offered in the dropdown; a URL that names their id still filters
correctly and shows the id in the chip.

---

## Display Settings gating

The `/admin-activity-logs` route ships **hidden** for every institute. Admin owners opt in via **Settings → Display Settings → Sidebar Tabs** → toggle "Admin Activity Logs" on.

Gating happens in three places — keep them in sync if you ever rename the tab ID:

1. The tab ID `'admin-activity-logs'` must be in `controlledTabs` ([constant.ts](../frontend-admin-dashboard/src/components/common/layout-container/sidebar/constant.ts)).
2. The admin defaults set `visible: false` via `OPT_IN_TAB_IDS` ([admin-defaults.ts](../frontend-admin-dashboard/src/constants/display-settings/admin-defaults.ts)).
3. The route's `beforeLoad` hook redirects to `/dashboard` if the tab is disabled ([routes/admin-activity-logs/index.tsx](../frontend-admin-dashboard/src/routes/admin-activity-logs/index.tsx)).

Once the institute enables it, anyone with the `ADMIN` role can view the log (the sidebar item itself is filtered to admins via `filterSidebarByRole` in [helper.ts](../frontend-admin-dashboard/src/components/common/layout-container/sidebar/helper.ts)).

---

## How the audit write actually works

1. Spring AOP weaves `AuditableAspect#audit(...)` around any method annotated with `@Auditable`.
2. The advice calls `joinPoint.proceed()`, which invokes the controller and its service. **The service's own `@Transactional` opens and commits the business transaction here** — it is the outermost transaction in play.
3. On return, the advice builds the `AdminActivityLog` row and calls `repository.save(log)`. The business transaction has already committed, so this `INSERT` runs on its own.
4. If the wrapped method throws, the advice rethrows before ever building a row. **There is never an audit row without a successful action** — not because of a shared transaction, but because the write happens after a successful `proceed()`.
5. The aspect is `@Order(Ordered.LOWEST_PRECEDENCE - 10)`, so it sits outside Spring's `@Transactional` advice on the wrapped method.

**The `@Transactional(Propagation.REQUIRED)` on `audit(...)` is dead code.** Spring does not proxy `@Aspect` beans, so it never takes effect (see the correction at the top). Removing it would be honest, but it is load-bearing in one direction: anyone who "fixes" the aspect so the annotation *does* apply would silently convert every partial-success endpoint to all-or-nothing. Don't do that without re-auditing the annotated endpoints.

For `async = true`, the aspect dispatches the row to a dedicated `ThreadPoolTaskExecutor` named `auditAsyncExecutor` instead of writing inline. Since the sync path is not atomic either, async only buys getting the write off the request thread.

---

## Performance characteristics

| | Without `@Auditable` | With `@Auditable` (default sync) | With `captureBefore` | With `async = true` |
|---|---|---|---|---|
| Per-call latency added | 0 | ~1–2 ms | ~3–8 ms (extra SELECT) | ~15–35 μs (snapshot + executor submit) |
| Extra DB hits | 0 | +1 INSERT | +1 SELECT, +1 INSERT | 0 in the request path; +1 INSERT off-thread |
| Connection pool pressure | 0 | Uses the request's existing connection | Same | One slot per concurrent async write |
| Atomicity with business txn | n/a | **No** | **No** | **No** |

A typical admin mutation takes 50–500 ms end-to-end. Audit overhead is **<1% of that** in the worst case. Storage growth is bounded by retention.

The aspect uses Spring's compiled SpEL (`SpelCompilerMode.MIXED`) — hot expressions are promoted to bytecode after a few invocations, so SpEL evaluation is single-digit microseconds in steady state.

---

## Failure modes (handled — no business call ever fails because of audit)

| Failure | What happens |
|---|---|
| `clientId` header missing | Aspect skips the audit row write; logs DEBUG; the business call proceeds normally. |
| SpEL expression throws (e.g., typo in `entityIdExpr`) | Aspect catches, logs WARN, sets that field to null. Row still writes; other fields are unaffected. |
| `captureBefore` bean call throws (e.g., entity not found yet) | Aspect catches; `before_payload` stays null; row still writes. |
| `repository.save(log)` throws | Aspect catches; logs ERROR. The business transaction already committed and is unaffected — the aspect shares no transaction with it. Audit data is lost for that one call; the customer's mutation succeeds. |
| Payload above `maxPayloadBytes` | JSON is truncated with `...[truncated]` suffix. |
| JVM crash mid-mutation | Postgres rolls back the business txn; no audit row was written yet — consistent. |
| JVM crash between the business commit and the audit INSERT | Mutation is durable, audit row is lost. The one real gap from the write not being atomic. |

The hard rule: **an audit issue never breaks a customer-facing API**.

---

## Retention

Rows older than `audit.retention.days` (default 365) are hard-deleted by `AdminActivityLogRetentionJob` running at `0 0 3 * * *` UTC. The job chunks the DELETE in batches of 5,000 (`audit.retention.batch-size`) so row locks stay short — never holds a table lock, no live-traffic impact. Total run time for a normal day's expired rows is 1–2 seconds.

Tunable via `application.properties`:

```properties
audit.retention.days=365
audit.retention.batch-size=5000
audit.payload.default-max-bytes=64000
audit.async.executor.core=2
audit.async.executor.max=5
audit.async.executor.queue=200
```

---

## CSV export

`GET /admin-core-service/audit/v1/logs/export.csv` streams a CSV of all rows matching the active list filters (date range, resource, activity, actor). Hard-capped at 50,000 rows server-side to prevent runaway exports. Columns: `When (UTC), Actor name, Actor email, Activity, Action, Resource, Entity ID, HTTP method, Endpoint, Status, Latency (ms), IP address`. JSON payloads are intentionally omitted — they're available per-row via `GET /logs/{id}`.

The frontend's "Export CSV" button passes whatever filters are currently set, so admins control the scope by adjusting the date range and dropdowns before clicking.

---

## Architecture decisions you'll inherit

- **Why a synchronous write and not an in-memory queue + batch writer?** Earlier design used `ArrayBlockingQueue` + a daemon consumer for throughput. Switched to writing inline because admin mutation volume is in the tens/sec, never thousands/sec, so the +1 ms per call is invisible. This was *intended* to be a transactional outbox buying crash-safety and atomicity with the business txn — it never actually did (see the correction at the top); the write is simply inline and non-atomic. The `async = true` escape hatch is the only place the original queue idea survives.
- **Why does it live in `admin_core_service` and not `common_service`?** 99% of admin mutations are here today. If `assessment_service` or another service ever wants to audit, we move just the `annotation/`, `aspect/`, `util/` packages into `common_service` (about a half-day's work). The table + read API + UI naturally belong to the admin app and would stay here regardless.
- **Why one `admin_activity_log` table, not one per service?** Cross-service queries ("show me everything user X did across the platform") become trivial. The trade-off is that if a non-admin service wants to write here, it needs DB access to the admin-core DB. We'll cross that bridge when we get there.
- **Why opt-in `@Auditable` and not a global HTTP interceptor that logs every mutation?** Interceptors can't capture semantic metadata (entity_id, human description) without a giant URL-pattern matcher. Opt-in per method also means deployments don't suddenly start logging unintended endpoints. Lower blast radius.

---

## File reference

Backend — `admin_core_service/src/main/java/vacademy/io/admin_core_service/features/admin_activity_logs/`:

| Path | Purpose |
|---|---|
| `annotation/Auditable.java` | The annotation itself. Source of truth for fields. |
| `aspect/AuditableAspect.java` | The `@Around` advice — request snapshot, SpEL eval, JSON serialization, save. |
| `async/AsyncAuditDispatcher.java` | Off-thread persister for `async = true`. |
| `config/AuditAsyncExecutorConfig.java` | The `auditAsyncExecutor` `ThreadPoolTaskExecutor` bean. |
| `config/AuditProperties.java` | `@ConfigurationProperties("audit")` tunables. |
| `controller/AdminActivityLogController.java` | `GET /logs`, `GET /logs/{id}`, `GET /logs/export.csv`. |
| `entity/AdminActivityLog.java` | JPA entity. JSONB columns for `request_payload` and `before_payload`. |
| `repository/AdminActivityLogRepository.java` | `JpaRepository + JpaSpecificationExecutor`; chunked retention DELETE native query. |
| `retention/AdminActivityLogRetentionJob.java` | Nightly chunked DELETE. |
| `service/AdminActivityLogReadService.java` | Filter spec (equality for one value, `IN` for several) + CSV builder. |
| `service/AuditNarrator.java` | Learner / course id → name phrasing for descriptions. |
| `service/CrmAuditNarrator.java` | Audience, lead, follow-up, counsellor id → name phrasing. |
| `service/PayloadRedactor.java` | Sensitive-key masking before JSON serialization. |
| `util/AuditSpelEvaluator.java` | Cached SpEL parser + `BeanFactoryResolver` wiring. |
| `util/RequestContextSnapshot.java` | Immutable POJO for the request-thread context. |

Migration: `src/main/resources/db/migration/V259__Admin_activity_log.sql`. No migration was
needed for the CRM coverage or the multi-select filters — the table and its three composite
indexes already carry both.

Tests — `admin_core_service/src/test/java/.../admin_activity_logs/`:

| Path | Purpose |
|---|---|
| `AuditableAnnotationContractTest.java` | Every `@Auditable` expression parses, its `#vars` are real parameters of that method, its `@beans` exist, and its entityType/action appear in the UI's filter dropdowns. |
| `AdminActivityLogFilterParsingTest.java` | Comma-separated / plural / single-value query params → filter, and `entityId` is never split. |

POM: `spring-boot-starter-aop` added in `admin_core_service/pom.xml`.

Frontend — `frontend-admin-dashboard/src/routes/admin-activity-logs/`:

| Path | Purpose |
|---|---|
| `index.tsx` | Route registration + `beforeLoad` toggle gate. |
| `index.lazy.tsx` | Page shell + state plumbing. |
| `-components/ActivityLogFilters.tsx` | Resource / Activity / Performed-by multi-selects, date presets + range, applied-filter chips, refresh, **Export CSV**. |
| `-components/ActivityLogTable.tsx` | The table — relative timestamps, actor initials, status dots, resource column, sentence rendering with entity-name bolding, `MyPagination`. |
| `-components/PayloadDrawer.tsx` | Side drawer: fixed header + one scrolling body, request/actor detail that wraps rather than truncates, payload rendered as labelled fields with a Raw JSON toggle, Before → After for `captureBefore` rows. |
| `-components/activity-log-sentence.test.ts` | Pins which fragment of each description gets bolded. |

Service hooks: `frontend-admin-dashboard/src/services/admin-activity-logs/getActivityLogs.ts`
(list, by-id, CSV export) and `getActivityLogActors.ts` (the institute team roster behind the
"Performed by" filter).

Display-settings integration: `sidebar/constant.ts` (`controlledTabs`), `sidebar/helper.ts` (`adminOnlyIds`), `constants/display-settings/admin-defaults.ts` + `teacher-defaults.ts` (default-off).

---

## Gotchas

1. **`@Auditable` on the controller, not the service.** The request context (`clientId` header, `user` attribute, IP, user-agent) is thread-bound to the request thread. Putting the annotation on a deeper service method means the aspect can still snapshot context (it uses `RequestContextHolder`), but if the service is called from a non-request thread — e.g., a `@Scheduled` job — the snapshot is null and the row is skipped. Controllers are always called on the request thread.

2. **SpEL is evaluated at runtime — typos compile but break at first invocation.** The aspect catches the throw and logs a WARN, but the column ends up null. Always grep your logs once for `SpEL evaluation failed for expression` after adding a new annotation.

3. **`#result` is null in `captureBefore`.** The before-snapshot runs *before* `proceed()`, so `#result` doesn't exist yet. Only the method args, `#user`, and `@bean` references are available in `captureBefore` expressions.

4. **JpaRepository `findAllById` is your friend.** For `captureBefore` on DELETE operations, `@repositoryName.findAllById(#ids).![fieldName]` gives you a `List<String>` of the field projections in one query. Pair with `T(java.lang.String).join(', ', #before)` in `descriptionExpr` to produce comma-joined names.

5. **PayloadMode.NONE on file-upload endpoints.** If your endpoint takes a `MultipartFile`, set `payload = PayloadMode.NONE` — Jackson will try to serialize the multipart and either explode or produce useless binary. The action + actor are still captured.

6. **Adding to the frontend dropdowns is enforced.** New `entityType` / `action` values work in the backend immediately but are unfilterable until they are added to `RESOURCE_GROUPS` / `ACTIVITY_OPTIONS` in [ActivityLogFilters.tsx](../frontend-admin-dashboard/src/routes/admin-activity-logs/-components/ActivityLogFilters.tsx). That gap went unnoticed for months — the HR, ERP, mentorship and booking resources were all being written and none of them could be picked. `AuditableAnnotationContractTest#filterDropdownsCoverEveryAuditedValue` now fails the build when a value is missing (it skips itself when the frontend is not checked out beside the service). Values from an `actionExpr` cannot be checked statically — add those by hand.

7. **Partial-success endpoints need `conditionExpr`, not avoidance.** Endpoints
   that loop over items, catch per-item exceptions, and return a
   `successful/failed/skipped` report (`POST /v3/learner-management/assign` and
   `/deassign`, CSV bulk learner upload) are safe to annotate — the aspect
   opens no transaction, so it cannot turn them all-or-nothing. What they *do*
   need is a guard: they return 200 having changed nothing when `dry_run` is set
   or when every item was skipped. Audit those and the log claims enrollments
   that never happened. Use the response summary, not the request:
   `conditionExpr = "#result?.body != null and !#result.body.dryRun and (#result.body.summary?.successful ?: 0) > 0"`.
   For the same reason, derive counts in the description from
   `summary.successful` rather than `request.userIds` — bulk assign also selects
   users by inline `new_users` or a filter, so the request does not say how many
   learners were actually enrolled.

8. **A description that starts like an existing pattern gets bolded like it.** Prefixes are shared across resources — `updated lead …` claims everything after it as a lead's name — so read the "Frontend description rendering" table before choosing a phrase, and add the phrase to `activity-log-sentence.test.ts`.

9. **The `clientId` header is required.** The axios interceptor in [axiosInstance.ts](../frontend-admin-dashboard/src/lib/auth/axiosInstance.ts) attaches it automatically from `getInstituteId()`. If you ever build a non-axios request path (e.g., a worker-side fetch), make sure that header is included or audit silently drops the row.

10. **A narrator can only read admin_core's own database.** `users` (and the rest
    of auth_service's schema) does **not** exist in `admin_core_service`. Resolving a
    person through `vacademy.io.common.auth.repository.UserRepository` compiles,
    starts, and then throws `relation "users" does not exist` on every call — which
    the narrator's catch swallows, exactly as it must, leaving the description
    naming a raw UUID. That shipped on 2026-09-08 and produced live rows reading
    *"changed lead tier of 664d3077-29b4-4dcb-8c64-d2ed9417f529"*. Inside admin_core
    the name sources are: `student.full_name` (enrolled learners),
    `audience_response.parent_name/email/mobile` (a lead's own form), and
    `user_lead_profile.assigned_counselor_name` (the only staff name written down
    here). `CrmAuditNarratorNamingTest` fails the build if the narrator ever takes a
    dependency on `common.auth.repository` again.

11. **A derived query name is validated at pod startup, not at compile time.** A typo
    in `findFirstByAssignedCounselorIdAnd…` does not fail a build — it fails every
    pod's context refresh, taking the whole service down for every institute. There
    is no in-memory database on this module's test classpath, so
    `CrmAuditNarratorNamingTest#derivedQueriesResolve` runs Spring's own `PartTree`
    parser over the repository's derived methods to catch it without one.

---

## CRM coverage (added 2026-09-08)

The CRM was the largest unaudited surface — audience lists, leads and every
counsellor action were invisible in the log. Now instrumented:

| Resource | Actions | Where |
|---|---|---|
| `AUDIENCE` | CREATE, UPDATE, DELETE, SEND_MESSAGE, RECALCULATE_SCORES | `AudienceController` |
| `LEAD` | CREATE (manual, walk-in), IMPORT, UPDATE, DELETE, RESTORE, ASSIGN, UNASSIGN, REASSIGN, STATUS_CHANGE, TIER_CHANGE, SCORE_CHANGE, CONVERT | `AudienceController`, `LeadStatusController`, `CounsellorWorkbenchController` |
| `LEAD_STATUS` | CREATE, UPDATE, DELETE | `LeadStatusController` |
| `LEAD_FOLLOWUP` | CREATE, UPDATE, CLOSE | `LeadFollowupController` |
| `LEAD_SLA_CONFIG` | UPDATE (with before/after) | `LeadSlaConfigController` |
| `LEAD_CONNECTOR` | CREATE, UPDATE, DELETE, RESUBSCRIBE | `MetaOAuthController` |
| `ENQUIRY` | ASSIGN, STATUS_CHANGE | `EnquiryInternalController` |
| `COUNSELLOR` | STATUS_CHANGE | `CounsellorWorkbenchController` |
| `COUNSELLOR_POOL` | CREATE, UPDATE, DELETE, ADD_MEMBER, REMOVE_MEMBER, MEMBER_STATUS_CHANGE | `CounselorPoolController` |
| `COUNSELLOR_TARGET` | UPDATE, BULK_UPDATE, DELETE | `CounsellorTargetController` |
| `COUNSELLOR_WORKBENCH_CONFIG` | UPDATE | `CounsellorWorkbenchController` |
| `TAG` | CREATE, DELETE, TAG_USERS, UNTAG_USERS | `TagController` |
| `TELEPHONY_CONFIG` / `TELEPHONY_NUMBER` | UPDATE / CREATE, UPDATE, ATTACH, DELETE | `TelephonyConfigController`, `TelephonyNumberController` |
| `ENGAGEMENT_ENGINE` | CREATE, UPDATE, DELETE, ENROLL, STATUS_CHANGE, AUTONOMY_CHANGE | `EngagementEngineController` |
| `AUTOMATION` | CREATE, UPDATE, DELETE, TRIGGER | `WorkflowController` |

Three decisions worth keeping if you extend this:

- **`payload = NONE` wherever the body carries a credential or is unbounded** —
  the Meta/Google connector saves (OAuth session keys, `googleKey`), the
  telephony config (provider API tokens; `REDACTED` only masks the key names it
  knows), the CSV lead import (thousands of rows of PII) and the workflow
  builder (the whole node graph). The actor, the action and a counted
  description are what an audit reader needs from those.
- **Previews must not be logged.** `/counsellor-workbench/assign` and
  `/reassign` back both the dry run and the real thing;
  `conditionExpr = "#result?.body?.dryRun != true"` keeps a preview out of the
  log. Written as `!= true` rather than `!…dryRun`, since a SpEL `!null` throws
  and the aspect fails closed — silently dropping real rows.
- **Names come from `CrmAuditNarrator`, not from SpEL.** Lead and audience ids
  mean nothing in a log line; the narrator resolves them, degrades to a count or
  an id, and never throws.

## Coverage reality check

Worth knowing before assuming a mutation is logged: as of 2026-07-17 the local
snapshot of `admin_activity_log` held **3,030 rows** against **~11,358**
enrollment rows created in the same window. Enrollment *is* audited, but only on
the four annotated enroll endpoints — the bulk paths above are unannotated, and
most enrollments are learner-driven (self-signup, invitation response,
payment/`UserPlanService`, workflow activation, Keap migrations) rather than
admin actions. Roughly 3.5% of `admin_core_service`'s ~687 mutation endpoints
carry `@Auditable`. An absent row usually means *not instrumented*, not *broken*.

## Future improvements (not yet wired)

- **Real atomicity, if it is ever wanted.** The audit row is not atomic with the mutation (see the correction at the top), so a crash between commit and INSERT loses it. Achieving atomicity needs the write moved into the business transaction deliberately — e.g. a `TransactionTemplate` in the advice or an actual outbox table — *not* by making the aspect's `@Transactional` apply, which would convert partial-success endpoints to all-or-nothing.
- **Promote annotation + aspect to `common_service`** so other services can audit into the same table without DB changes. `auth_service` (role grants, permission changes, password resets) is the highest-value gap and is blocked on this.
- **Failed/denied attempts are never recorded.** The row writes inside the business transaction, so a throw rolls the audit away too — "who *tried* to do X" is unanswerable by design.
- **Bolding patterns auto-derived from `entityType`/`action`** instead of regex matching the description text.
- **Per-institute retention override** via institute settings, falling back to the global `audit.retention.days`.
- **S3 / cold-storage archival before delete** — required for SOC 2 / ISO 27001 evidence trails.
- ~~**Read-side filter on actor by name/email** instead of raw user-id paste.~~
  Done 2026-09-08 without touching the backend: the UI lists the institute's own
  team roster and sends the ids it already knows.
- **Compaction** — if volume ever crosses 50M rows, switch to monthly partitioning by `created_at` so retention deletes become `DROP PARTITION` (instant) instead of chunked DELETEs.
