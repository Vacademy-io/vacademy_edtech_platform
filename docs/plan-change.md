# Plan Change (Upgrade / Downgrade)

How a learner moves between payment plans without their membership being torn down and rebuilt.

Companion to [`payment-system.md`](./payment-system.md), which describes the entities this
feature sits on top of (`PaymentOption` → `PaymentPlan` → `UserPlan` → `PaymentLog`).

---

## Table of Contents

1. [Why this exists](#why-this-exists)
2. [The two flags](#1-the-two-flags--admin-opens-the-door)
3. [What a learner is allowed to see](#2-what-a-learner-is-allowed-to-see)
4. [Upgrade — pay the prorated difference](#3-upgrade--pay-the-prorated-difference)
5. [Downgrade — scheduled to the end of the cycle](#4-downgrade--scheduled-to-the-end-of-the-cycle)
6. [applyChange — the single writer](#5-applychange--the-single-writer)
7. [Admin override — no payment](#6-admin-override--no-payment)
8. [Cross-option moves](#7-cross-option-moves)
9. [Schema](#schema)
10. [API reference](#api-reference)
11. [Enums](#enums)
12. [Traps and edge cases](#traps-and-edge-cases)
13. [Where the code lives](#where-the-code-lives)

---

## Why this exists

Before this, a learner was locked to the `payment_plan` they bought at enrollment. The only
way to move them was **cancel + re-enroll**, which mints a *new* `user_plan`. That breaks
continuity: payment history, invoices and the account ledger all hang off the plan id, and
the enrollment mappings get rewritten.

Here the `user_plan` row is **mutated in place** — same id, same package sessions, same
learner — exactly as manual renewal already reactivates the same membership. A learner's
billing history therefore survives every upgrade and downgrade.

### Why a change needs a record of its own

A plan change is not atomic:

- An **upgrade** has to survive a gateway round trip, and the gateway hands back nothing but
  an order id. The intent is written to `user_plan_change_request` first, keyed by the
  payment log, and applied only when the webhook confirms.
- A **downgrade** is deliberately deferred to the end of the paid cycle — no refunds, no lost
  days — so it sits `SCHEDULED` until the renewal path picks it up.

---

## 1. The three gates — admin opens the door

```
PAYMENT_SETTING.planChangeEnabled    ← institute master switch (Payment Settings page)
payment_option.plan_change_allowed   ← per option   (toggle in the plan editor)
payment_plan.plan_change_allowed     ← per interval (checkbox on each plan)
```

The institute switch decides whether the feature is **exposed at all**; the other two
decide **which** plans are switchable. All three default to off.

With the institute switch off, every learner-facing path behaves exactly as it did before
this feature existed — `can_change_plan` is false, the options listing returns empty with
`blocked_reason = PLAN_CHANGE_DISABLED_FOR_INSTITUTE`, and a change request is refused —
regardless of what the per-option and per-plan flags say. It lives in the existing
`PAYMENT_SETTING` institute-settings blob alongside
`packageSessionRenewalSchedulerEnabled`, so it needs no migration.

The **admin override is deliberately not gated** by the institute switch: it is a
back-office correction tool and is already constrained by the per-option and per-plan flags.

**Both option and plan flags must be true** for a plan to be offered as a target. This lets an admin open "Gold" to
switching while still deciding that only *Annual* — not *Monthly* — is a landing spot.

Both ride the existing `POST` / `PUT /admin-core-service/v1/payment-option`; there is no new
admin endpoint. Defaults are `FALSE`, so the feature is off everywhere until switched on.

---

## 2. What a learner is allowed to see

`GET /admin-core-service/learner/subscription/v1/{userPlanId}/change-options`

```
user_plan
  → ACTIVE StudentSessionInstituteGroupMapping rows → packageSessionIds
  → findActiveByPackageSessionIdsAndInstituteId(...)        ← pre-existing query, no new SQL
  → every PaymentOption bound by an ACTIVE EnrollInvite to those package sessions
  → filter by the compatibility matrix below
  → price each survivor for THIS learner, right now
```

### Compatibility matrix

A target is offered only when **all** hold:

| # | Rule | Why |
|---|------|-----|
| 1 | Bound by an ACTIVE invite to one of **this learner's** ACTIVE package sessions | Keeps the move inside what they already have; a course/batch move is enrollment, not a plan change |
| 2 | Option `status=ACTIVE` **and** `plan_change_allowed` | Master switch |
| 3 | Plan `status=ACTIVE` **and** `plan_change_allowed` | Per-plan opt-in |
| 4 | Option `type ∈ {SUBSCRIPTION, ONE_TIME}` | CPO carries an installment tree that would need `student_fee_payment` bills regenerated; DONATION has no fixed price to prorate |
| 5 | Same `currency` as the current plan | A credit in one currency cannot be subtracted from a price in another |
| 6 | Not the plan they are already on | — |

Rule 1 is what keeps this tractable: `StudentSessionInstituteGroupMapping` holds **no** invite
or option reference, so a change never rewrites enrollment rows — it only extends their
expiry.

### Proration

```
remainingDays  = ceil((user_plan.end_date − now) / 1 day)        // 0 once lapsed
currentValidity= live plan's validityInDays, else plan_json snapshot
unusedValue    = min(currentPrice, currentPrice × min(remainingDays, validity) / validity)
amountDueNow   = max(0, targetPrice − unusedValue)
newEndDate     = today + target.validityInDays                   // null ⇒ lifetime
```

No refund is ever produced: the credit is capped at the current plan's price and the charge
floors at zero. A lapsed plan yields no credit and pays in full — which is also what makes
"upgrade" a natural reactivation path for a dunning-expired membership.

### Direction decides the money model

Direction comes from **price**, not from plan names:

| Comparison | Direction | Effective type |
|---|---|---|
| target > current | `UPGRADE` | `IMMEDIATE` — charge the prorated difference now |
| target < current | `DOWNGRADE` | `END_OF_CYCLE` — free, at `end_date` |
| target = current | `LATERAL` | `END_OF_CYCLE` — free, at `end_date` |

---

## 3. Upgrade — pay the prorated difference

```
POST .../change-plan { target_plan_id, with_autopay }
  │
  ├─ insert user_plan_change_request        status = PENDING_PAYMENT
  │
  ├─ PaymentInitiationRequestDTO
  │     amount   = amountDueNow
  │     type     = PaymentType.PLAN_CHANGE
  │     vendor   = the TARGET's enroll invite      ← not the learner's current one
  │
  ├─ paymentService.handleUserPlanPayment(...)
  │     (or handleMandatePayment when auto-pay must be re-registered)
  │
  ├─ stamp the returned orderId (= payment_log.id) onto payment_log_id
  │
  └─ return { status: PENDING_PAYMENT, payment_response } → gateway checkout opens
```

`payment_type` propagates into Razorpay `notes` and Stripe `metadata` straight off
`request.getPaymentType()`, so **no gateway manager changed**.

Then the money settles:

```
webhook / poller sees payment_type = PLAN_CHANGE
  → PlanChangeService.handlePlanChangePaymentConfirmation(orderId, instituteId, status)
  → look up the request by payment_log_id
      │
      ├─ PAID   → paymentLogService.claimPaidIfNotAlready(orderId)   ← idempotency gate
      │           → mark log PAID / SUCCESS
      │           → userAccountLedgerService.recordSettledCharge(...)
      │           → applyChange(request)
      │           → invoice generated AFTER commit
      │
      └─ FAILED → status = FAILED; user_plan untouched, learner keeps their old plan
```

The **idempotency claim matters**: Razorpay delivers both `payment.captured` and `order.paid`
for one payment, and production runs several replicas. Without it, one upgrade could be
applied — and ledgered — twice.

If the proration credit fully covers the new price (`amountDueNow ≤ 0`), no order is created
at all — the change applies immediately.

The learner UI re-polls at 3s / 8s / 15s after checkout, so the card flips without a reload.

---

## 4. Downgrade — scheduled to the end of the cycle

```
POST .../change-plan  →  status = SCHEDULED, scheduled_for = user_plan.end_date
```

No payment, no refund, no lost days. The membership card then reads *"Moving to Monthly on
14 Oct"* with a **Cancel this change** link (`DELETE .../change-plan`).

It lands at the next renewal via three hooks:

| Hook | What it does |
|---|---|
| `RenewalChargeService.resolveAmount()` | Quotes the **target** plan's price — charging the old price would take money for a plan they will not be on the moment it settles |
| `RenewalPaymentService.handleSuccessfulRenewal()` | Calls `applyScheduledChangeIfDue()` **before** `calculateNewEndDate`, so the extension uses the new plan's validity |
| `SubscriptionService.initiateRenewalPayment()` | Same quote for the manual "pay to continue" button |

---

## 5. `applyChange` — the single writer

Every route ends here. That is what stops the paid, scheduled and admin paths from drifting
apart.

```java
plan_id + plan_json                                  // always
paymentPlan association refreshed                    // read-only mapping would else serve the OLD plan
payment_option_id + payment_option_json               \
enroll_invite_id                                      / cross-option only
start_date = now, end_date = now + newValidity        // unless preserveEndDate
auto-pay re-read from the NEW invite                 // ENABLED only — never re-runs TRIAL_DAYS
mappings: ACTIVE extended, INACTIVE reactivated
status = APPLIED, applied_at stamped
emit WorkflowTriggerEvent.SUBSCRIPTION_PLAN_CHANGED   // best-effort
```

`preserveEndDate` is true for an **admin override** (nothing was paid, so changing the window
would be arbitrary) and for a **scheduled downgrade** (the renewal that triggered it sets the
window itself, from the new plan's validity).

`SUBSCRIPTION_PLAN_CHANGED` fires only once the change has actually **landed** — never on
request — so messaging workflows describe what is true. `eventId = enrollInviteId` (the new
one on a cross-option move), falling back to `instituteId`, per the existing convention.

---

## 6. Admin override — no payment

Manage Students → side-view → **Membership** → *Change plan*.

`POST /admin-core-service/v1/user-plan/{userPlanId}/change-plan`

Same eligibility rules — an admin **cannot** move someone onto a plan the institute has not
flagged as switchable. But:

- `charge_amount = 0`, `requested_by = ADMIN`, `effective_type = IMMEDIATE`
- **the access window is left alone** — no money changed hands, so extending or truncating
  what the learner already paid for would be arbitrary. The new price bills at the next renewal.
- `reason` is persisted on the request row for audit
- the caches `userPlanById`, `userPlansByUser`, `userPlanWithPaymentLogs`, `membershipDetails`
  are evicted, or the side-view would keep showing the plan they just left

The membership card itself now leads with the **payment plan** name; the course is the
subtitle and the payment option a muted chip.

---

## 7. Cross-option moves

A `PaymentOption` is reachable **only** through an `EnrollInvite` — the bridge
`package_session_learner_invitation_to_payment_option` binds (invite, package session, option),
and the runtime lookup `findActiveByEnrollInviteIdAndPackageSessionId` returns an `Optional`,
i.e. effectively one option per (invite, package session).

**So changing the option necessarily changes the enroll invite**, which drags along:

- `vendor` / `vendor_id` — the payment gateway
- `currency`
- `learner_access_days`
- `setting_json` → `AUTOPAY_SETTING`
- the enrollment / expiry policies

That is why `applyChange` repoints all three (`payment_option_id`, `payment_option_json`,
`enroll_invite_id`) together, and why auto-pay is re-derived from the new invite rather than
carried over. The admin dialog states this explicitly on cross-option targets.

---

## Schema

Migration: `V498__plan_change.sql`

### Flag columns

| Table | Column | Type | Default |
|---|---|---|---|
| `payment_option` | `plan_change_allowed` | BOOLEAN NOT NULL | `FALSE` |
| `payment_plan` | `plan_change_allowed` | BOOLEAN NOT NULL | `FALSE` |

### `user_plan_change_request`

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `user_plan_id` | FK → `user_plan` | The membership being changed |
| `institute_id` | String | |
| `from_plan_id` / `to_plan_id` | String | |
| `from_plan_json` / `to_plan_json` | TEXT | Snapshots — `to_plan_json` is what gets applied if the live plan was retired by a later Payment Settings edit |
| `from_payment_option_id` / `to_payment_option_id` | String | |
| `from_enroll_invite_id` / `to_enroll_invite_id` | String | |
| `direction` | String | `UPGRADE` \| `DOWNGRADE` \| `LATERAL` |
| `effective_type` | String | `IMMEDIATE` \| `END_OF_CYCLE` |
| `status` | String | see below |
| `proration_credit` | NUMERIC(12,2) | Unused value of the plan being left |
| `charge_amount` | NUMERIC(12,2) | `max(0, newPrice − credit)` |
| `currency` | String | |
| `payment_log_id` | String | The order id — how the webhook finds this row |
| `scheduled_for` | Timestamp | END_OF_CYCLE only: the `end_date` it waits for |
| `requested_by` | String | `LEARNER` \| `ADMIN` \| `SYSTEM` |
| `requested_by_user_id` | String | |
| `reason` | TEXT | Admin overrides |
| `applied_at` | Timestamp | |

The `from_*` / `to_*` pairs are the audit record. A cross-option change repoints the option
**and** the invite, so without them an applied change cannot be reconstructed afterwards.

Indexes: `(user_plan_id, status)`, `(payment_log_id)`, and a partial
`(scheduled_for) WHERE status='SCHEDULED'`.

---

## API reference

### Learner — `/admin-core-service/learner/subscription/v1`

User id always comes from the JWT, never the request body.

| Method | Path | Returns |
|---|---|---|
| `GET` | `/{userPlanId}/change-options?instituteId` | `PlanChangeOptionsDTO` — current plan + priced targets + any scheduled change |
| `POST` | `/{userPlanId}/change-plan?instituteId` | `PlanChangeResponseDTO` — branch on `status` |
| `DELETE` | `/{userPlanId}/change-plan?instituteId` | 204 — cancels a `SCHEDULED` change |

`SubscriptionDTO` (the existing `GET /` listing) also gained `can_change_plan` and
`scheduled_plan_change`, so the membership card renders without a second round trip.

### Admin — `/admin-core-service/v1/user-plan`

| Method | Path | Returns |
|---|---|---|
| `GET` | `/{userPlanId}/change-options?instituteId` | `PlanChangeOptionsDTO` |
| `POST` | `/{userPlanId}/change-plan?instituteId` | updated `UserPlanDTO` |

Request body (both sides) carries **only a plan id** — price, proration and eligibility are
always derived server-side, never trusted from the client.

---

## Enums

### PlanChangeStatus

```
upgrade:   PENDING_PAYMENT --(webhook PAID)----> APPLIED
                           --(webhook FAILED)--> FAILED
downgrade: SCHEDULED       --(renewal)---------> APPLIED
                           --(learner cancels)-> CANCELLED
admin:                     -------------------> APPLIED   (straight to it, no money)
```

`PENDING_PAYMENT` and `SCHEDULED` are the **open** statuses — a plan may only have one change
in flight at a time, or two pending upgrades could both clear and the second would apply on
top of a `user_plan` the first already moved.

### PlanChangeDirection
`UPGRADE`, `DOWNGRADE`, `LATERAL`

### PlanChangeEffectiveType
`IMMEDIATE`, `END_OF_CYCLE`

### PaymentType (extended)
`INITIAL`, `RENEWAL`, `SCHOOL`, `APPLICATION_FEE`, `AI_CREDIT_PACK`, **`PLAN_CHANGE`**

---

## Traps and edge cases

**Auto-pay can break silently on an upgrade.** Two ways:

1. `RazorpayPaymentManager` throws when `amount > mandate.max_amount`. An upgrade above the
   ceiling would land fine and then have every *future* recurring charge rejected at the sweep.
2. A cross-option move to an invite with a **different vendor** leaves the mandate registered
   with the wrong gateway.

Targets therefore report `requires_mandate_reauth`, and the UI forces mandate-mode checkout —
one approval both pays and re-registers auto-pay — rather than letting the learner opt out
into a broken renewal.

**All three gateways needed a branch.** Stripe's `else` falls through to `handleInitialPayment`
and eWay's switch ends in `throw new IllegalStateException`. Either would have taken the money
and left the learner on the old plan.

**A trial is never re-run.** `applyChange` reads only `AUTOPAY_SETTING.ENABLED` from the new
invite, deliberately ignoring `TRIAL_DAYS` — otherwise a paying member would get a free window
every time they changed plan.

**A lifetime plan cannot be downgraded on a schedule.** With no `end_date` there is no cycle
to wait for, so the request would sit `SCHEDULED` forever. It is refused up front.

**A retired target still applies.** If a Payment Settings edit deletes the target plan between
request and apply, `to_plan_json` is used — the learner agreed to what was on offer at request
time.

**Invoicing runs after commit.** PDF generation and the S3 upload open their own transaction; a
failure inside the change transaction would mark it rollback-only and silently undo a plan
change the learner has already paid for.

**Plan ids must survive a Payment Settings edit.** `PaymentPlanService.editPaymentPlans` treats
an id-less DTO as *new* and soft-deletes everything not resent by id. The admin UI previously
dropped the id on the round trip, so **every edit of a subscription option retired the whole
ladder and minted fresh ids** — orphaning `user_plan.plan_id` and, once this feature existed,
wiping every plan's switchable flag. The id is now threaded through both mappings.

---

## Where the code lives

### Backend — `admin_core_service`

| Path | Purpose |
|---|---|
| `features/plan_change/entity/UserPlanChangeRequest.java` | The request row |
| `features/plan_change/repository/UserPlanChangeRequestRepository.java` | Open-request, by-payment-log and due-scheduled lookups |
| `features/plan_change/enums/*` | Direction / EffectiveType / Status |
| `features/plan_change/dto/*` | `PlanChangeTargetDTO`, `PlanChangeOptionsDTO`, `PlanChangeRequestDTO`, `PlanChangeResponseDTO`, `ScheduledPlanChangeDTO` |
| `features/plan_change/service/PlanChangeTargetResolver.java` | Candidate discovery + compatibility matrix + mandate-reauth detection |
| `features/plan_change/service/PlanChangeProrationCalculator.java` | Pure, unit-testable money maths |
| `features/plan_change/service/PlanChangeService.java` | Orchestrator; `applyChange` is the single writer |
| `features/user_subscription/util/PlanValidityResolver.java` | Shared "how long is this plan good for?" — used by both proration and renewal |
| `db/migration/V498__plan_change.sql` | The migration |

Touched: `PaymentOption` / `PaymentPlan` (+ DTOs, + `PaymentOptionService`, `PaymentPlanService`),
`SubscriptionController` / `SubscriptionService`, `UserPlanController` / `UserPlanService`,
`RazorpayWebHookService`, `StripeWebHookService`, `EwayPoolingService`,
`RenewalChargeService`, `RenewalPaymentService`, `WorkflowTriggerEvent`, and
`common_service`'s `PaymentType`.

### Frontend — `frontend-admin-dashboard`

| Path | Purpose |
|---|---|
| `routes/settings/-components/Payment/PaymentPlanCreator/PlanChangeToggle.tsx` | Option-level master switch |
| `routes/settings/-components/Payment/PaymentPlanCreator/SubscriptionPlanConfiguration.tsx` | Per-interval checkbox |
| `routes/settings/-components/Payment/PaymentPlanEditor.tsx` | Same, on the edit path |
| `.../student-side-view/student-membership/change-plan-dialog.tsx` | Admin override dialog |
| `.../student-side-view/student-overview/StudentPlanDetails.tsx` | Card leads with the plan; hosts the button |
| `services/user-plan.ts`, `services/payment-options.ts`, `types/payment.ts` | Wire types + id round-trip |

Because `manage-contacts` reuses the same drawer, the admin button appears there for free.

### Frontend — `frontend-learner-dashboard-app`

| Path | Purpose |
|---|---|
| `components/common/subscription/ChangePlanDialog.tsx` | Shared picker, grouped by payment option |
| `hooks/use-subscription-manager.ts` | `startPlanChange`, `cancelPlanChange` |
| `components/common/user-profile/payment-billing/subscription-services.ts` | API + types |
| `routes/dashboard/-components/MyMembershipWidget.tsx` | Dashboard surface |
| `components/common/user-profile/payment-billing/subscription-mandate-list.tsx` | Profile → billing surface |
| `routes/subscriptions/$username/index.tsx` | Public WhatsApp-linked surface |

Any paid-upgrade CTA sits behind `shouldHidePaidPurchaseUI()` (Apple guideline 3.1.1).
