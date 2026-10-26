# Enrollment Lifecycle — Status Flows

Abandoned cart · inactive learner · cancel subscription · soft terminate · hard terminate ·
re-enrollment. Every claim here is cited to a `file:line` in `admin_core_service` and was
cross-checked against production data. Where an older document disagrees, this one is right —
the others were written from intent, not from the code.

---

## 1. The data model

Learner state lives in **one** table:
`admin_core_service.student_session_institute_group_mapping` — "SSIGM" throughout.

- `student` has **no** status column (`V1__Initial_schema.sql:812`).
- `auth_service.users` has none either. Termination is always institute-scoped; the global
  account is never touched.
- `payment_log`, `invoice` and `student_fee_payment` are **never mutated** by any cancel or
  terminate path. They remain historical billing records.
- `learner_operation` is unrelated — it tracks content progress, not enrollment status.

Four SSIGM columns carry state, and they are **independent of each other**:

| Column | Enum | Enum values |
|---|---|---|
| `status` | `LearnerSessionStatusEnum` | ACTIVE, INACTIVE, TERMINATED, INVITED, PENDING_FOR_APPROVAL, DELETED, EXPIRED |
| `type` | `LearnerSessionTypeEnum` | LIVE_SESSION, PACKAGE_SESSION, PAYMENT_FAILED, ABANDONED_CART |
| `source` | `LearnerSessionSourceEnum` | EXPIRED, COURSE_CATALOG, TERMINATED |
| `destination_package_session_id` | — | the *real* batch the learner is heading to |

The second table is `user_plan` (`UserPlanStatusEnum`: ACTIVE, PENDING_FOR_PAYMENT,
PAYMENT_FAILED, CANCELED, EXPIRED, PENDING, TERMINATED), joined via `ssigm.user_plan_id`.

> **The enums are not the data.** Neither status column has a DB CHECK constraint — both are
> free-text `varchar` validated only in Java. Production contains types (`COURSE_CATALOGUE_LEAD`,
> `PUBLIC_LIVE_SESSION`, `ONBOARDING_STEP`), sources (`LEAD`, `ONBOARDING`, `BULK_ASSIGN`) and
> statuses (`NULL`, `'Active'`) that appear in no enum. Never assume a query written off the enum
> sees every row. See §7.

### The INVITED package session

Every package has a synthetic session with `level_id='INVITED'`, `session_id='INVITED'`.
Pre-payment rows park **there**, with `destination_package_session_id` pointing at the real batch.
Fully-enrolled rows sit on the **real batch** with `destination_package_session_id = NULL`.

This is why "the learner is enrolled but I can't find them in the batch" is usually not a bug:
they are on the INVITED session awaiting payment.

### The constraint that shapes every flow

`V1__Initial_schema.sql:2327`:

```sql
CONSTRAINT uq_dest_pkg_inst_user_status
  UNIQUE (destination_package_session_id, package_session_id, institute_id, user_id, status)
```

Plain UNIQUE, no `WHERE` clause. A learner may hold **at most one row per status** per
(destination, package_session, institute).

Two consequences that explain a lot of otherwise-odd code:

1. **Hard terminate rebuilds the row rather than flipping its status.** The replacement is not
   just a different `status`: it moves to the INVITED package session and gains a
   `destination_package_session_id`, so in constraint terms it is a different row. `cancelUserPlan`
   deletes and re-inserts accordingly — and an in-place flip would additionally risk colliding with
   an INVITED row the learner already holds for the same tuple.
2. **The constraint does not protect fully-enrolled rows.** `destination_package_session_id` is
   NULL for them, and SQL treats `NULL <> NULL`, so two ACTIVE rows with a NULL destination do
   **not** collide. The only guard there is application-level
   (`LearnerAccessService.changeAccess`'s `claimedActiveSlots`).

---

## 2. Master status matrix

| Scenario | `ssigm.status` | `type` | `source` | sits on | `user_plan.status` | autopay | seat freed | workflow fired | row deleted? |
|---|---|---|---|---|---|---|---|---|---|
| Form submitted, unpaid | **ACTIVE** | ABANDONED_CART | – | INVITED session | *(none yet)* | – | no | `ABANDONED_CART` | no |
| Payment failed | **ACTIVE** | PAYMENT_FAILED | – | INVITED session | PAYMENT_FAILED | – | no | `PAYMENT_FAILED` | cart row hard-deleted |
| Awaiting payment | INVITED | – | – | INVITED session | PENDING_FOR_PAYMENT | – | no | – | no |
| Awaiting admin approval | PENDING_FOR_APPROVAL | – | – | INVITED session | PENDING_FOR_PAYMENT | – | no | – | no |
| Paid / enrolled | ACTIVE | PACKAGE_SESSION | – | real batch | ACTIVE | on | – | `PAYMENT_SUCCESS` | INVITED row → DELETED |
| Admin "make inactive" | **INACTIVE** | *unchanged* | – | real batch | *untouched* | – | no | `LEARNER_TERMINATION` | no |
| Autopay dunning exhausted | **INACTIVE** | – | – | real batch | **EXPIRED** | on, `next_charge_at=NULL` | no | dunning | no |
| Cancel subscription | *untouched (ACTIVE)* | – | – | real batch | **CANCELED** | **off**, mandate revoked | no | `SUBSCRIPTION_CANCELLED` | no |
| **Soft terminate** | *untouched (ACTIVE)*, or INACTIVE if `access_till_date` is past | – | – | real batch | **CANCELED** | off | **no** | `SUBSCRIPTION_CANCELLED` | no |
| **Hard terminate** (has plan) | **INVITED** on a new row | PACKAGE_SESSION | **TERMINATED** | INVITED session | **TERMINATED** | off | **yes** | `SUBSCRIPTION_TERMINATED` + `LEARNER_TERMINATION` | **yes — old row DELETEd** |
| **Hard terminate** (no plan) | **TERMINATED** in place (no INVITED row — see §5) | *unchanged* | – | real batch | – | – | yes | `LEARNER_TERMINATION` | no |
| Natural expiry (scheduler) | **DELETED**, plus a new INVITED row | PACKAGE_SESSION | **EXPIRED** | INVITED session | **EXPIRED** | – | no | expiry notifications | no |
| Renewal paid after lapse | INACTIVE → **ACTIVE**, expiry extended | – | – | real batch | **ACTIVE** | – | – | `PAYMENT_SUCCESS` | no |

---

## 3. Abandoned cart

**It is a `type`, not a status.** The row's `status` is `ACTIVE`.

Created at **form submit, before payment** — there is no cron and no cart table.

- `EnrollmentFormService.submitEnrollmentForm` (`enroll_invite/service/:70-102`)
- `ProductPageEnrollmentService` (`product_page/service/:136-189`)
- both → `LearnerEnrollmentEntryService.createOnlyDetailsFilledEntry` (`institute_learner/service/:133-157`)

`WorkflowTriggerEvent.ABANDONED_CART` fires immediately at creation.

Row shape: `package_session_id` = INVITED session · `destination_package_session_id` = real batch ·
`type = ABANDONED_CART` · `status = ACTIVE` · `user_plan_id = NULL`.

**On re-submit**, `deletePreviousThrowawayEntries` runs first. It is a **hard `DELETE`**
(`StudentSessionRepository.deleteThrowawayEntries`), not a status flip — soft-deleting tripped
`uq_dest_pkg_inst_user_status` on a third attempt because a `DELETED` row already existed.
**Side effect: checkout-attempt history is not retained.** "How many times did this person try to
check out?" is unanswerable from this table.

**On payment:**
- success → `PaymentLogService.handlePaymentSuccessEntryCleanup` (`:1912`) clears the cart row;
  `UserPlanService.applyOperationsOnFirstPayment` creates the real `PACKAGE_SESSION` / `ACTIVE` row.
- failure → `handlePaymentFailure` (`:1820`) replaces it with a `PAYMENT_FAILED` row and sets
  `user_plan.status = PAYMENT_FAILED`.

Cart rows are deliberately ignored by `ReenrollmentGapValidationService` (`:197-241`) and
`UserPlanService.hasRealEnrollmentEntries` (`:506`) — an unverified enrollment must not block or
stack anything.

---

## 4. Inactive learner

`ssigm.status = INACTIVE`. Three writers:

1. **Admin** — `POST /institute/institute_learner-operation/v1/update` with
   `operation = MAKE_INACTIVE` → `StudentSessionManager.handleMakeInactive` (`:133`), a plain
   `UPDATE ... SET status`. Fires `LEARNER_TERMINATION` after commit.
2. **Dunning exhausted** — `RenewalChargeService.applyDunning` (`:305-309`) sets
   `user_plan.status = EXPIRED` and `next_charge_at = NULL`, then `deactivateMappings` (`:327`)
   flips every ACTIVE mapping to INACTIVE.
3. **Back-dated soft cancel** — `BulkDeassignmentService.deactivateIfAccessAlreadyEnded`.

**Reversal:** `RenewalPaymentService` (`:306-313`) finds INACTIVE mappings for the plan and sets
them back to ACTIVE with the new expiry — same rows, no new records.

INACTIVE is chosen over TERMINATED on purpose: it is denied by the ACTIVE-only content gates but
still appears in the institute's `studentStatuses` roster, so the learner stays visible and
filterable in Manage Students instead of vanishing.

---

## 5. Cancel vs soft terminate vs hard terminate

All three converge on `UserPlanService.cancelUserPlan(userPlanId, force)` (`:1345`).

### Cancel subscription
- Learner: `POST /admin-core-service/learner/subscription/v1/{userPlanId}/cancel`
  → `SubscriptionService.cancelSubscription` (`:64`)
- Admin: `PUT /admin-core-service/v1/user-plan/{userPlanId}/cancel` (force=false)

Both set `user_plan.status = CANCELED`, `auto_renewal_enabled = false`, revoke the mandate and
fire `SUBSCRIPTION_CANCELLED`. **SSIGM is untouched** — access runs to `end_date`.

> **No payment-gateway webhook ever cancels anything.** `StripeWebHookService` and
> `RazorpayWebHookService` only handle succeeded/failed payment events. Cancellation is always
> app-initiated; the app then pushes `revokeMandate` *out* to the gateway.

### Soft terminate — `POST /v3/learner-management/deassign`, `mode = "SOFT"`
- `cancelUserPlan(id, false)` → plan `CANCELED`
- SSIGM **stays ACTIVE**; the seat is **not** returned to inventory
- optional `access_till_date` overwrites `ssigm.expiry_date`; if that date is already past the
  mapping is flipped to `INACTIVE` (an ACTIVE row with a past expiry would keep rendering the
  course as live, because the learner lists filter on `status` with no expiry check)
- does **not** fire `LEARNER_TERMINATION` — nothing was revoked
- `action_taken = "SOFT_CANCELED"`

### Hard terminate — same endpoint, `mode = "HARD"`
- `cancelUserPlan(id, true)` → plan `TERMINATED`, autopay off, mandate revoked,
  `SUBSCRIPTION_TERMINATED` fired
- the ACTIVE SSIGM rows are **physically deleted** (`deleteAllInBatch`, `UserPlanService:1468`)
  and replaced by rows on the INVITED session via `createInvitedMappingFromTerminated`
  (`StudentSessionInstituteGroupMapping:97-130`), `source = TERMINATED`
- **carried onto the replacement row:** `institute_enrollment_number`, `enrolled_date`,
  `expiry_date`, `user_plan_id`, `sub_org`, `org_roles`, `certificate_file_id`,
  `desired_level_id`, `desired_package_id`; `type_id` = the original package session
- **lost:** the row `id` — anything logged against the old mapping id dangles
- seat returned via `packageSessionService.incrementAvailability`
- `LEARNER_TERMINATION` fires async, per package session
- `action_taken = "HARD_TERMINATED"`

**When the mapping has no `user_plan_id`**, HARD sets `status = TERMINATED` in place and creates
**no** INVITED row. That asymmetry is deliberate, not an oversight: the TERMINATED row stays on the
*real* package session, so the re-enrolment lookup (`findTopReusableMapping`, which keys on
`package_session_id` = the INVITED session) does not see it, `createNewMapping` runs, and the new
row gets the correct `destination_package_session_id`.

> Adding an INVITED re-entry row here for symmetry was tried and reverted. The INVITED session is
> shared by **every** session of a package, while the row pins `destination_package_session_id` to
> the one de-assigned. A later purchase of a *different* session in the same package therefore
> reuses that row (`findTopReusableMapping` does not filter on destination) and
> `updateExistingMapping` never re-points the destination. Payment then succeeds, the seat is
> decremented, and `shiftLearnerFromInvitedToActivePackageSessions` — which matches on destination —
> finds nothing, leaving a paying learner with no enrolment. The plan-backed HARD path
> (`cancelUserPlan`) creates the same row shape and carries the same latent hazard.

### Four different things are called "terminate"

| Path | Endpoint | Touches `user_plan`? | SSIGM effect |
|---|---|---|---|
| Bulk deassign v3 | `POST /v3/learner-management/deassign` | yes | SOFT: none / HARD: deleted + INVITED re-inserted |
| Sub-org terminate | `POST /sub-org/v1/terminate-member` | **no** | SOFT: `expiry_date` only / HARD: `TERMINATED` in place |
| Learner ops update | `POST /institute/institute_learner-operation/v1/update` | **no** | `TERMINATE` → `TERMINATED` (hardcoded, the `new_state` you send is ignored on this branch); `MAKE_INACTIVE` → your `new_state` |
| Learner self-service | `POST /learner/subscription/v1/{id}/cancel` | yes | none |

> **Admin UI: the TERMINATE operation is unreachable.** The students-list menu item historically
> called "Terminate Registration" sends `MAKE_INACTIVE` and writes **INACTIVE**; it is now labelled
> "Make Inactive" in the row menu, the bulk menu, the dialog and the toast, in all four locales.
>
> The `TERMINATE` operation — the one that writes **TERMINATED** — has a complete dialog, store
> action and mutation, but **nothing renders a menu item for it**: `'Delete Student'` is absent
> from `getMenuOptions()` (`student-menu-options.tsx`) and `MENU_ACTION.DELETE` has no entry in
> `buildBulkActionDropdownList()` (`bulk-actions-menu.tsx`). So from the admin UI, `TERMINATED`
> reaches production **only** via the deassign v3 and sub-org terminate endpoints — never from
> Manage Students.

---

## 6. Natural expiry

`PackageSessionScheduler` runs at `0 0 4 * * ?`, ShedLock'd (prod has 4 replicas), and **only for
institutes that opted in** via `PAYMENT_SETTING.packageSessionRenewalSchedulerEnabled = true`
(`:68`). Absent = off, so most institutes are never swept.

Pre-expiry notifications → waiting period (2 payment attempts) → `FinalExpiryProcessor`:

1. `user_plan.status = EXPIRED` is written **first**, so a failure mid-way cannot cause
   re-processing.
2. Per mapping: create or update an INVITED row (`source = EXPIRED`), then set the old row to
   **`DELETED`** (`:303`).

`ENROLLMENT_POLICY_COMPREHENSIVE_GUIDE.md` used to claim this marks `TERMINATED`. It does not, and
never has.

---

## 7. Re-enrollment — three paths that disagree

All three prefer UPDATE over INSERT: they find the newest row for
`(user, package_session, institute)` in a "reusable" status set and reuse it. INSERT happens only
when nothing matches. `DELETED`, `ABANDONED_CART` and `PAYMENT_FAILED` rows are **excluded from the
lookup**, so a learner whose only prior row is DELETED gets a brand-new row.

| Path | Entry point | Reusable statuses | Flips `status` on reuse? |
|---|---|---|---|
| **1.** `StudentRegistrationManager.linkStudentToInstitute` — self-serve enroll, invite accept, `AdminDirectEnrollService`, bulk upload | `findTopReusableMapping` (`StudentSessionRepository:259`) | ACTIVE, INVITED, TERMINATED, INACTIVE, EXPIRED, PENDING_FOR_APPROVAL | Yes, but **only for dormant rows** — see below |
| **2.** `LearnerSessionOperationService.reEnrollStudent` — `POST .../re-enroll-learner` | ACTIVE, INVITED, TERMINATED, INACTIVE | Yes — to the caller-supplied status |
| **3.** `BulkAssignmentService.handleReEnroll` — `POST /v3/learner-management/assign` | same 4 + EXPIRED | Yes — hardcoded ACTIVE, resets `enrolled_date`, repoints `user_plan_id` |

**Path 1's promotion rule** (`updateExistingMapping` → `reviveDormantMapping`): a row is promoted
only when the caller supplied a status **and** the current status is TERMINATED / EXPIRED /
INACTIVE **and** no other row already holds the target status for the same unique-constraint tuple.
`INVITED` and `PENDING_FOR_APPROVAL` are deliberately **not** promoted here — those are pre-payment
parking states owned by the payment webhook (`shiftStudentBatch` →
`applyOperationsOnFirstPayment`), and promoting them would grant access before the money arrived.

**Payment promotion** is a separate path: `shiftStudentBatch` → `findOrCreateMapping` writes the
status only on its *new-row* branch, then `markOldMappingDeleted` sets the INVITED row to DELETED.

**Expiry on reuse:** the base date is the current `expiry_date` only when the row is ACTIVE **and**
`ReenrollmentPolicyDTO.activeRepurchaseBehavior == STACK` **and** the expiry is still in the future;
otherwise it is `now`. Then `+ accessDays`. If `accessDays` is absent the expiry is left alone —
deliberate, because paid rows arrive as INVITED with no days yet and an unguarded write would null
a live expiry into unlimited access.

**Re-enrollment can be blocked outright:** `allowReenrollmentAfterExpiry = false` plus
`reenrollmentGapInDays` throws *"Re-enrollment is not allowed for this course at this time. Please
try again after &lt;date&gt;"*, measured from `expiry_date`, falling back to `updated_at`.

**`user_plan` on re-enroll is always a NEW row.** `createUserPlan` (`:267`) never updates an
existing plan. If an ACTIVE/PENDING plan already exists for the same enroll invite, the new plan is
**stacked**: `start_date` = the old plan's `end_date`, and its status is forced to `PENDING`
(`:354`) instead of ACTIVE, to be activated later by `applyOperationsOnFirstPayment`.

**Access-days source depends on the plan type:**

| Plan type | Days come from |
|---|---|
| ONE_TIME, SUBSCRIPTION | `payment_plan.validity_in_days` |
| FREE, DONATION, CPO | `enroll_invite.learner_access_days` |

**What the learner sees:** `LearnerPackageService` (`:155-190`) stamps `enrollment_status` on each
course card from ACTIVE/INACTIVE/TERMINATED/INVITED rows; the frontend picks the CTA from it. The
lookup is **case-sensitive** — a row with `status = 'Active'` renders with no status at all.

---

## 8. Known traps

| # | Trap |
|---|---|
| 1 | **ABANDONED_CART rows have `status = ACTIVE`.** Filtering carts by status finds nothing; filter on `type`. |
| 2 | **`deleteThrowawayEntries` is a hard DELETE.** Cart history is destroyed on every retry. Capturing it needs a new append-only table — soft-delete is not an option, it trips the unique constraint. |
| 3 | **Hard terminate deletes the mapping row.** Its `id` is gone; only the field values survive on the replacement row. |
| 4 | **The menu action writes INACTIVE, not TERMINATED.** The `TERMINATE` operation is dead UI — no menu item renders it, so `TERMINATED` only arrives via the deassign v3 / sub-org endpoints. Neither operation deletes anything. |
| 5 | **`uq_dest_pkg_inst_user_status` does not stop duplicate ACTIVE enrollments** when `destination_package_session_id` is NULL, which is the case for every fully-enrolled row. |
| 6 | **A shared `UserPlan` spans package sessions.** Cancelling it affects every enrollment that points at it — `BulkDeassignmentService` warns about this in its response, so surface that warning. |
| 7 | **The enums are not the data.** No CHECK constraint on either status column. Production holds `NULL` and `'Active'` statuses (invisible to every ACTIVE-only gate), plus types and sources absent from the enums. All such rows are legacy (newest created 2025-12-02), but they are still there. |
| 8 | **The expiry scheduler is off for almost every institute.** If you expect automatic expiry, check `PAYMENT_SETTING.packageSessionRenewalSchedulerEnabled` before debugging anything else. |
| 9 | **Product-page checkouts write `user_plan.status = "INVITED"`, which is not a `UserPlanStatusEnum` value.** This is deliberate (`ProductPageEnrollmentService.provisionPendingEnrollments`): `PENDING_FOR_PAYMENT` would make `createUserPlan` post a ledger `DEBIT_ACCRUAL` and make `findOutstandingLearners` bill the row, turning every abandoned checkout into phantom Due. The cost of the workaround is that these plans fall outside every status-keyed query — membership and finance filters included — so they are invisible until payment flips them to `ACTIVE`. Prod carried 216 such rows; 186 belonged to learners who were already fully enrolled and were backfilled to ACTIVE/PENDING on 2026-09-04. Closing the wart properly needs a status that is neither accrued nor billed. |

---

## 9. Support runbook

Read-only. Run against `admin_core_service`.

```sql
-- Which state combinations actually exist (start here for any "why can/can't they see it")
SELECT status, type, source,
       (destination_package_session_id IS NULL) AS dest_null, count(*) AS rows
FROM student_session_institute_group_mapping
GROUP BY 1,2,3,4 ORDER BY 5 DESC;

-- One learner's full enrollment picture, newest first
SELECT m.id, m.status, m.type, m.source, m.package_session_id,
       m.destination_package_session_id, m.enrolled_date, m.expiry_date,
       up.status AS plan_status, up.auto_renewal_enabled, up.end_date
FROM student_session_institute_group_mapping m
LEFT JOIN user_plan up ON up.id = m.user_plan_id
WHERE m.user_id = :userId AND m.institute_id = :instituteId
ORDER BY m.created_at DESC;

-- Genuine abandoned carts (the tab must match this count)
SELECT count(*) FROM student_session_institute_group_mapping
WHERE type = 'ABANDONED_CART' AND status = 'ACTIVE' AND institute_id = :instituteId;

-- Hard-terminate fingerprint: plan TERMINATED + learner parked back on the INVITED session
SELECT up.status AS plan_status, m.status AS mapping_status, count(*)
FROM user_plan up JOIN student_session_institute_group_mapping m ON m.user_plan_id = up.id
WHERE up.status IN ('CANCELED','TERMINATED','EXPIRED','PAYMENT_FAILED')
GROUP BY 1,2 ORDER BY 1,3 DESC;

-- Rows no ACTIVE-only gate will ever match (case drift / NULL / junk)
SELECT status, count(*), count(DISTINCT user_id) AS learners, max(created_at)::date AS last_seen
FROM student_session_institute_group_mapping
WHERE status IS NULL
   OR status NOT IN ('ACTIVE','INACTIVE','TERMINATED','INVITED',
                     'PENDING_FOR_APPROVAL','DELETED','EXPIRED')
GROUP BY 1 ORDER BY 2 DESC;

-- Plans outside UserPlanStatusEnum (invisible in the learner Subscriptions list)
SELECT status, count(*), max(created_at)::date AS last_created
FROM user_plan
WHERE status IS NULL
   OR status NOT IN ('ACTIVE','PENDING_FOR_PAYMENT','PAYMENT_FAILED',
                     'CANCELED','EXPIRED','PENDING','TERMINATED')
GROUP BY 1 ORDER BY 2 DESC;

-- Duplicate ACTIVE enrollments (the constraint cannot catch these)
SELECT user_id, package_session_id, count(*)
FROM student_session_institute_group_mapping
WHERE status = 'ACTIVE'
GROUP BY 1,2 HAVING count(*) > 1;
```
