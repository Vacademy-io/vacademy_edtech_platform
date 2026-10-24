# Flexible Installments at Enrollment

**Status:** Phases 1 (backend) and 2 (admin UI) built 2026-10-14; phases 3–5 proposed. See [§9](#9-phases).

Let an admin decide **how many installments and how far apart** while enrolling a learner,
instead of creating one fee plan and one invite link per schedule in advance.

Read first: [payment-system.md](./payment-system.md) (entities),
[CPO_INSTALLMENTS.md](./CPO_INSTALLMENTS.md) (today's admin enrollment flow for fee plans).

---

## 1. The problem

A CPO (fee plan) today carries a **fixed** installment template (`aft_installments`: amount and
due date per installment). Every learner on that plan gets the same schedule. Institutes that
offer "pay in 3", "pay in 4" or "pay monthly" therefore create a separate fee plan **and** a
separate invite link for each variant, and the admin has to pick the right link at enrollment.
Clients report this as the hardest part of setting up fees.

What they want, in the Enroll wizard:

```
Total ₹40,000   Discount [10 %]   → ₹36,000
Installments [4]   every [30] [days ▾]   first due [15 Oct 2026]
──────────────────────────────────────────────
#1  15 Oct 2026   ₹9,000   ✎
#2  14 Nov 2026   ₹9,000   ✎
#3  14 Dec 2026   ₹9,000   ✎
#4  13 Jan 2027   ₹9,000   ✎
Record offline payment now? [ ]
```

## 2. Decisions taken (2026-10-14)

| Question | Decision |
|---|---|
| Which courses | **Both**: fee plans marked *flexible*, and any course sold at a single one-time price |
| Gap between installments | **Admin picks**: every N days, or monthly on the same date |
| Who chooses the count | **Admins only** for now (Enroll wizard, student side view). Learner checkout unchanged |
| Paying later installments | Review today's options first (§8). A learner "Pay dues" page may follow, behind an institute setting |

## 3. Design in one paragraph

The per-learner installment bills (`student_fee_payment`) are already the single source of
truth for everything after enrollment: the side-view editor, allocation, dues, reminders,
invoices, the account ledger and the Manage Payments forecast all read them. The template
(`aft_installments`) is only read **once**, at enrollment, to produce those bills. So we add a
second way to produce the bills, **from a rule** (count + gap + first due date) instead of from
the template, and leave everything downstream alone. The learner stays on a CPO-type plan so
every existing CPO guard keeps working.

```
                    ┌──────────── today ─────────────┐
 fee plan template ─┤ generateFeeBills (template)    ├──► student_fee_payment rows ──► side view, FIFO,
                    └────────────────────────────────┘                                 dues, reminders,
 admin's rule ──────► generateFromSchedule (new) ───────► student_fee_payment rows ──► invoices, ledger
   (N, gap, first due)                                     (i_id = null)                (unchanged)
```

## 4. Why this has no side effects on current behaviour

1. **Opt-in per enrollment.** The new code runs only when the request carries an
   `installment_schedule`. Requests without it take today's path byte-for-byte.
2. **Existing fee plans are untouched.** Their templates, invites, mirrors and learners do not
   change. A new `schedule_mode` column defaults to `FIXED`.
3. **Template-less bills already exist.** "Split installment" in the side view creates bills
   with `i_id = null` (`CpoDiscountService.splitInstallment`), and so do lump-sum fees (V452).
   Every reader already tolerates them.
4. **The learner stays on a CPO-type plan.** CPO plans have deliberate special cases that must
   keep firing:
   - no plan-level ledger accrual, because the bills accrue individually
     (`UserPlanService` ~L469); bolting installments onto a ONE_TIME plan would book the debt twice;
   - no "charge the full plan price" PaymentLog at admin enrollment (`BulkAssignmentService`);
   - `admin_discount` is refused in favour of the CPO discount;
   - Manage Payments' "CPO" filter and the dues/forecast queries find the learner.
5. **Discounts and offline payments reuse the current code.** After the bills are written, the
   existing `CpoDiscountService` and `allocatePaymentForNewLog` steps run exactly as today.

## 5. Data model changes

One migration, all additive (check the latest version on `origin/main` right before numbering
it; see the Flyway collision notes in the team memory):

```sql
-- complex_payment_option
ALTER TABLE complex_payment_option
    ADD COLUMN schedule_mode VARCHAR(20) NOT NULL DEFAULT 'FIXED',   -- FIXED | FLEXIBLE
    ADD COLUMN source_payment_plan_id VARCHAR(255) NULL;             -- set only on auto-built plans
CREATE UNIQUE INDEX uq_cpo_source_payment_plan
    ON complex_payment_option (source_payment_plan_id)
    WHERE source_payment_plan_id IS NOT NULL;

-- student_fee_payment
ALTER TABLE student_fee_payment
    ADD COLUMN installment_number INTEGER NULL;                      -- display only
```

- `schedule_mode = 'FLEXIBLE'`: the plan has fee types and amounts but no fixed dates; the
  schedule is decided per learner. Defaults for the rule live in the existing `metadata_json`:
  `{"flexible_defaults": {"count": 4, "interval": {"unit": "MONTHS", "value": 1},
  "min_count": 1, "max_count": 24}}`.
- `source_payment_plan_id`: marks a **system-built** flexible plan created behind a one-time
  course price (§6.2). These are hidden from Fee Plans and invite pickers.
- `installment_number`: template-less bills have no `aft_installments` row to take a number
  from, so reminders show a blank "Installment #" and the dues view shows none. The new
  generator fills this column; the reminder query, `ManualReminderService` and
  `FeeTrackingService` read it first and fall back to the template number.

## 6. Backend

### 6.1 Request shape

`POST /v3/learner-management/assign`, new optional field on `cpo_config`, and allowed on any
assignment whose resolved option is ONE_TIME (§6.2):

```json
"installment_schedule": {
  "count": 4,
  "interval": { "unit": "DAYS", "value": 30 },
  "first_due_date": "2026-10-15",
  "rows": [
    { "due_date": "2026-10-15", "amount": 10000 },
    { "due_date": "2026-11-14", "amount": 10000 },
    { "due_date": "2026-12-14", "amount": 10000 },
    { "due_date": "2027-01-13", "amount": 10000 }
  ]
}
```

- `interval.unit`: `DAYS` (due k = first + k×value days) or `MONTHS` (due k = first plus
  k×value months, computed from the first date each time so 31 Jan → 28 Feb → 31 Mar).
- `rows` is optional. When present (the admin edited the preview), the backend uses it as given
  after validating it. When absent, the backend generates the rows from the rule.
- Amounts are **gross** (before discount). The existing `cpo_discount` then spreads the
  discount proportionally, so equal rows stay equal.
- Validation: `1 ≤ count ≤ max_count`; `rows.length == count`; amounts ≥ 0; due dates
  non-decreasing; **sum of rows == the plan's gross total** to the paisa. A price change goes
  through the discount field, never through a silently short row.
- `installment_overrides` and `installment_schedule` are mutually exclusive (overrides address
  template rows that will not exist).

### 6.2 Resolving the plan

In `BulkAssignmentService`, right after `DefaultInviteResolver.resolve` and only when
`installment_schedule` is present:

| Resolved option | Action |
|---|---|
| CPO, `FLEXIBLE` | use it as is |
| CPO, `FIXED` | use it; the rule replaces the template **for this learner only** |
| ONE_TIME | `FlexiblePlanProvisioner.forOneTimePlan(plan)` finds or creates the hidden flexible CPO for that `payment_plan` (one fee type "Course fee", one fee value = `actual_price`, mirror + synthetic plan via `findOrCreateMirrorForCpo`). The assignment then proceeds with the hidden CPO's mirror option and synthetic plan, but **keeps** the invite and the access days already resolved from the original plan |
| FREE, DONATION, SUBSCRIPTION | reject the item with a clear message |

The hidden CPO is reused by every later enrollment on the same one-time plan. If the course
price has changed since it was built, the provisioner updates the fee value and re-syncs the
mirror before use; existing learners keep their own bills.

### 6.3 Generating the bills

New `InstallmentScheduleService.generateFromSchedule(userPlanId, cpoId, userId, instituteId, schedule)`,
`@Transactional`, called from `applyCpoEnrollmentSideEffects` **instead of** `generateFeeBills`
when a schedule is present. The rest of that method (discount, offline payment, invoice) runs
unchanged.

For each fee type on the CPO:
- if its fee value is marked to be split (`assigned_fee_value.has_installment = true`, the
  default): write `count` bills, one per row;
- otherwise (e.g. an admission fee): write one bill due on `first_due_date`.

Each bill: `i_id = null`, `asv_id` = the fee value, `installment_number` = k,
`original_amount = amount_expected` = row amount (or the fee type's equal share, see below),
`start_date` = previous due date (enrollment date for #1), `status = PENDING`, plus a
`DEBIT_ACCRUAL` in `user_account_ledger` exactly like `generateFeeBills`, in the plan's currency
instead of the hard-coded `INR`.

Equal split: whole currency units, remainder on installment #1
(₹40,000 / 3 → 13,334 + 13,333 + 13,333). With several split fee types, each is split on its
own and the preview groups bills by installment number; amount edits in the preview are
allowed only when the plan has a single split fee type (always true for one-time courses).
Per-bill edits remain possible afterwards in the side view.

Bill generation is all-or-nothing: every bill is saved before any ledger accrual is posted, in
one transaction. The rest of admin enrollment (UserPlan, discount, offline payment) is still not
wrapped in a single transaction, as today.

### 6.4 Dry run

`dry_run: true` returns the generated rows (`cpo_schedule` on each result item: total, bill
count, one row per installment, and any upfront fees), so Step 4
shows what the backend will actually write instead of the gross total only.

### 6.5 Learner self-enroll on a FLEXIBLE plan

Until phase 4, learner self-enrollment (invite checkout, product pages) on a FLEXIBLE plan is
**refused** with "Installments for this fee plan are set up by the institute when it enrolls
you" (`ComplexPaymentOptionOperation`). The learner checkout previews a plan's template
installments, which a flexible plan does not have, so the preview and the bills written would
not match. Admin enrollment (the Enroll wizard) is unaffected.

Admin paths that create a learner on a FLEXIBLE plan without sending a schedule (admissions,
sub-org members) go through `generateFeeBills`, which then builds the schedule from
`flexible_defaults` with `first_due_date` = today. Hidden one-time-course plans are never
attached to invites, so learners never reach them.

Phase 4 lifts the refusal: `cpo-schedule` returns the default schedule for a FLEXIBLE plan and
the checkout shows it.

### 6.6 Reschedule after enrollment

New side-view action, `POST /v1/fee-management/user-plan/{userPlanId}/reschedule`, same
`installment_schedule` body, applied to the **untouched** bills only (`amount_paid = 0`, no
approved adjustment). Paid and part-paid bills stay. The replaced bills' accruals are reversed
(`DEBIT_REVERSAL`) and the new ones accrued, so the Account Summary stays correct, and the
event is appended to the `cpo_discount_state` history for audit.

### 6.7 Listing hygiene

Exclude `source_payment_plan_id IS NOT NULL` from: Fee Plans list (`/cpo/{instituteId}`),
`/package-session/{id}/cpo-options`, invite CPO pickers, and the Payment Settings plan list.
`get-payment-options` already excludes CPO mirrors by default.

### 6.8 Creating a flexible fee plan

`POST /v1/fee-management/cpo` accepts two new optional fields; `GET /cpo/{id}/full` and the
list return them:

```json
{
  "name": "Class 10 – 2026-27 (pay in installments)",
  "schedule_mode": "FLEXIBLE",
  "flexible_defaults": { "count": 4, "interval": { "unit": "MONTHS", "value": 1 }, "max_count": 12 },
  "fee_types": [
    { "name": "Tuition", "code": "TUITION", "assigned_fee_value": { "amount": 40000 } },
    { "name": "Admission", "code": "ADMISSION", "assigned_fee_value": { "amount": 5000, "has_installment": false } }
  ]
}
```

- A FLEXIBLE plan may not carry template installments (rejected).
- Each fee is split over the learner's schedule unless `has_installment` is `false`, which makes
  it an upfront fee due on the first due date.
- `flexible_defaults` can be changed later through `PUT /cpo/{id}`; `schedule_mode` is fixed at
  creation.

## 7. Admin UI

| Where | Change |
|---|---|
| Enroll wizard, Step 3 (`Step3EnrollConfig.tsx`, `CpoEnrollmentConfigPanel.tsx`) | For a CPO invite, a **Schedule** switch: "Use plan schedule" (today) or "Custom schedule" (count, every N days / monthly, first due date, editable preview). A FLEXIBLE plan opens on "Custom schedule" with its defaults. For a ONE_TIME invite, a new **Pay in installments** toggle shows the same panel, and the plan's price becomes the total; `AdminDiscountField` hides while it is on, since the CPO discount takes over |
| Enroll wizard, Step 4 (`Step4Preview.tsx`) | Show the backend's generated rows from the dry run |
| Student side view → Fee Plan (`cpo-installments-editor.tsx`) | **Reschedule remaining** action using the same panel |
| Fee Plans → Create (`CreateCPODialog.tsx`) and Settings → Payment Settings → CPO (`CPOPlanConfiguration.tsx`) | "Installments decided at enrollment" option: fee types and amounts only, plus default count, gap and allowed range |
| Admissions fee assignment (`Step5AFeeAssignment`) | Later phase, same panel |

The preview maths lives in one shared helper mirroring §6.3 (equal split, remainder on #1,
month arithmetic from the first date), as the current CPO panel already mirrors
`CpoDiscountService`.

## 8. Paying later installments: what exists today

Checked 2026-10-14. **The only route that reliably settles a later installment is an admin
recording an offline payment.** Flexible schedules make this more visible (a 30-day cycle
means a payment every month), so phase 5 matters more than it did with 2–3 fixed installments.

| Path | Who | Works today? | Notes |
|---|---|---|---|
| Admin: Fee Management → Pay installments, side view "Record offline payment", sub-org "Record payment" | Admin | **Yes** | Offline only; settles oldest due first (side view) or the selected bills (Pay installments) |
| Scheduled fee reminders (workflow, 7/3/0/−3 days) | Learner / parent | Only if the institute builds the workflow | Nothing is seeded (V162 is a no-op; the V179 template refers to a query key that doesn't exist). The message carries **no pay link** |
| Admin "send reminder" for one installment | Admin → learner | Only with a workflow on `INSTALLMENT_DUE_REMINDER` | No pay link |
| Admin invoice for the installment amount + `/pay/invoice/{id}` link | Learner | Collects money, **does not settle the bill** | `markAdminInvoicePaidByPaymentLog` never touches `student_fee_payment`; the admin must then allocate by hand |
| `POST /learner/v1/fee/pay-installments` | Logged-in learner | API only, no screen | Settles only on Razorpay; allocates oldest due first regardless of which bills were picked |
| `POST /open/v1/fee/cpo-pay-installments` | Learner at checkout | Used only inside enrollment checkout | Razorpay only |
| Parent portal → child → Payments → Pay Now | Parent | **Broken for CPO** | Unpaid installments have id `sfp:<id>` and `/pay/invoice/sfp:…` returns "Invoice not found"; WAIVED rows still show Pay Now. Off unless `PARENT_SETTING.modules.payments` |
| Parent portal → Fees | Parent | View and receipt download only | — |
| Learner dashboard | Learner | Nothing shows dues | My Orders lists past payments only, hidden by default |

No institute setting gates learner-side dues today. Proposed for phase 5: a new key
`FEE_SETTING` (or a field on `PAYMENT_SETTING`) such as
`{ "learnerDuesEnabled": false, "learnerPayDuesEnabled": false, "allowCustomAmount": false }`,
read by both the learner app and the pay endpoints.

What phase 5 must fix before it is safe to open to learners:
1. Route `SCHOOL` payments in the Stripe, Cashfree, PhonePe and Eway confirmations, or restrict
   learner installment payment to Razorpay institutes.
2. Allocate to the bills the learner selected, not oldest-due-first, and skip WAIVED bills.
3. Use the logged-in `/learner/v1/fee/*` endpoints for the dues page (not the open checkout
   ones) and bound any custom amount to the outstanding total.
4. Fix the parent portal `sfp:` link (route it to the pay-installments flow instead of
   `/pay/invoice`).
5. Add a pay link to the reminder payload so workflow messages can carry it.

## 9. Phases

| Phase | Scope |
|---|---|
| 1 ✅ | Migration V575; `InstallmentScheduleService`; `installment_schedule` on admin assign (CPO FIXED/FLEXIBLE + ONE_TIME provisioning via `OneTimeInstallmentPlanProvisioner`); FLEXIBLE default schedule in `generateFeeBills`; dry-run preview; listing hygiene; `installment_number` readers; `schedule_mode` + `flexible_defaults` on the fee-plan create/read/update API |
| 2 ✅ | Admin UI: Enroll wizard panel (`InstallmentScheduleEditor`, plan vs custom schedule, "Pay in installments" for one-time prices), Step 4 preview, FLEXIBLE option in Fee Plans → Create and Settings → Payment Settings (`FlexibleScheduleSettings`), flexible badge in the fee-plans list |
| 3 | Side-view "Reschedule remaining" |
| 4 | FLEXIBLE plans on learner invite checkout (default rule); until then learner self-enrollment on them is refused (§6.5) |
| 5 | Learner "Pay dues" page behind an institute setting (§8) |

## 10. Open points

- Max installment count (proposed 24) and whether it is per institute.
- Should "monthly" also offer a fixed day of month (e.g. always the 5th) independent of the
  first due date?
- Back-dated first due dates: allowed (imports, late enrollments) with a warning in the UI.
- Multi-course admin enrollments: one schedule per course row, as today.
