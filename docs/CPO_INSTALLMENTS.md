# CPO Installments — Admin Enrollment Flow

How a learner gets enrolled from the admin side (**Manage Students → Students List → Enroll Learner**) against an invite that has a **CPO (Complex Payment Option)** linked, how the installment schedule is fetched and shown, and what the backend writes when the admin confirms.

> Background on the CPO ↔ PaymentOption model (mirror `payment_option`, synthetic `payment_plan`, V232/V233) lives in [CPO_PAYMENT_OPTION_CONTEXT.md](../CPO_PAYMENT_OPTION_CONTEXT.md). This doc covers the admin enrollment flow end to end, as the code stands on 2026-10-14.
>
> [CPO_ENROLLMENT_CHANGES.md](../CPO_ENROLLMENT_CHANGES.md) is out of date: `CpoInstallmentPanel` and `assign-course-dialog.tsx` no longer exist, and the localhost URL overrides it mentions have been removed.

---

## 1. Data model in one picture

```
complex_payment_option (CPO)                       ← template, created in Fee Plans
 └─ fee_type (N)                                   e.g. "Tuition", "Transport"
     └─ assigned_fee_value (1 per fee type)        amount, has_installment, no_of_installments
         └─ aft_installments (0..N)                installment_number, amount, start_date, due_date

payment_option  (type='CPO', complex_payment_option_id → CPO)   ← "mirror", 1 per CPO
 └─ payment_plan (tag='DEFAULT', actual_price = SUM(installments)) ← synthetic, 1 per mirror

enroll_invite
 └─ package_session_learner_invitation_to_payment_option (bridge)
        package_session_id, payment_option_id → the CPO mirror, status

--- per learner, created at enrollment ---
user_plan (payment_option = mirror, payment_plan = synthetic,
           payment_option_json.cpo_discount_state = CPO discount snapshot)
 └─ student_fee_payment (SFP)  one row per aft_installment (or one per lump-sum AFV)
        amount_expected, amount_paid, original_amount, start_date, due_date, status, i_id, asv_id
 └─ payment_log (MANUAL, PAID)               only if admin records an offline payment
     └─ student_fee_allocation_ledger        payment_log ↔ SFP, amount_allocated (FIFO)
user_account_ledger                          debit accrual per SFP, credit per payment, CPO_DISCOUNT reversals
```

Key points:

- The **template** (`aft_installments`) is shared by everyone on the CPO. The **per-learner copy** (`student_fee_payment`) is created at enrollment, and every per-learner edit (dates, amounts, discounts) goes into that copy, never into the template.
- How the frontend spots a CPO invite: the invite's payment option has `type === 'CPO'` and a non-null `complex_payment_option_id`.

---

## 2. Entry points (frontend)

Both admin entry points open the **same wizard**, `BulkAssignDialog`:

| Entry point | Component | How it opens the wizard |
|---|---|---|
| Students List header → **Enroll {Learner}** button | [enroll-students-button.tsx](../frontend-admin-dashboard/src/components/common/students/enroll-students-button.tsx) | `<BulkAssignDialog open … initialPackageSessionId?>`. Also auto-opens on `?action=enroll`. |
| Students List → **Enroll in Bulk** | [enroll-bulk-button.tsx](../frontend-admin-dashboard/src/routes/manage-students/students-list/-components/enroll-bulk/enroll-bulk-button.tsx) | Same dialog. |
| Student side view → Courses → **Assign to course** | [student-courses.tsx](../frontend-admin-dashboard/src/routes/manage-students/students-list/-components/students-list/student-side-view/student-courses/student-courses.tsx) | `<BulkAssignDialog initialLearner={…}>`. Step 1 (learner picker) is skipped. Steps 2–5 are the same, including the CPO panel. |

Wizard steps ([BulkAssignDialog.tsx](../frontend-admin-dashboard/src/routes/manage-students/students-list/-components/enroll-bulk/bulk-assign-dialog/BulkAssignDialog.tsx)):

```
learners → courses → config → (suborg, only for org-associated batches) → preview
 Step1      Step2     Step3                                                 Step4Preview
```

CPO handling happens in **Step 3 (config)** and **Step 4 (preview)**.

---

## 3. Step 3: picking the invite and fetching the installments

[Step3EnrollConfig.tsx](../frontend-admin-dashboard/src/routes/manage-students/students-list/-components/enroll-bulk/bulk-assign-dialog/steps/Step3EnrollConfig.tsx#L61) renders one `CourseConfigRow` per selected package session. Each row runs this chain:

```
InvitePickerDropdown ──(enrollInviteId | null)──► useResolvedInviteDetails
                                                     │
                                                     ├─ paymentOption.type === 'CPO' ?
                                                     └─ complexPaymentOptionId
                                                              │
                                                              ▼
                                               CpoEnrollmentConfigPanel(cpoId)
                                                     └─ useCPOFullDetails(cpoId)
                                                          GET /cpo/{cpoId}/full
```

### 3.1 Invite dropdown: list the invites for the package session

[InvitePickerDropdown.tsx](../frontend-admin-dashboard/src/routes/manage-students/students-list/-components/enroll-bulk/components/InvitePickerDropdown.tsx) → [useInvitesForPackageSession.ts](../frontend-admin-dashboard/src/routes/manage-students/students-list/-hooks/useInvitesForPackageSession.ts)

```http
POST /admin-core-service/v1/enroll-invite/get-enroll-invite?instituteId={id}&pageNo=0&pageSize=20
{ "package_session_ids": ["<psId>"], "sort_columns": { "created_at": "desc" } }
```

- Invites tagged `SUB_ORG` are hidden, because enrolling through them makes the learner a ROOT_ADMIN of the sub-org. `SUBORG_LEARNER` invites stay visible.
- The first option is **Auto** (`__auto__` → `enrollInviteId = null`).
- Changing the invite **resets `cpoConfig` and `adminDiscount`** for that row, because a different invite may carry a different CPO or none at all.

### 3.2 Resolve the invite's payment option

[useResolvedInviteDetails.ts](../frontend-admin-dashboard/src/routes/manage-students/students-list/-hooks/useResolvedInviteDetails.ts#L56) (React Query key `['invite-detail-resolution', instituteId, psId, inviteId]`, staleTime 60s):

1. **Explicit invite:** go straight to step 2.
   **Auto mode:** call the same `get-enroll-invite` list (pageSize 50) and pick, in order:
   1. the `tag === 'DEFAULT'` and `status === 'ACTIVE'` invite
   2. otherwise the first `ACTIVE` invite
   3. otherwise `invites[0]`

   Then set `resolvedFromDefault = true`, which shows "auto-resolved from default" in the UI.
2. Fetch the invite detail:
   ```http
   GET /admin-core-service/v1/enroll-invite/{instituteId}/{enrollInviteId}
   ```
   Backend: [EnrollInviteController.java:62](../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/enroll_invite/controller/EnrollInviteController.java#L62) → `EnrollInviteService.findByEnrollInviteId`. The payment option DTO includes `type`, `complex_payment_option_id` and `payment_plans` ([EnrollInviteService.java:673](../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/enroll_invite/service/EnrollInviteService.java#L673)).
3. In `package_session_to_payment_options`, find the entry where `package_session_id === psId` and `status === 'ACTIVE'`, and take its `payment_option`.
4. Return `{ invite, paymentOption, complexPaymentOptionId, resolvedFromDefault }`.

The row then shows the payment option's name and a type badge (CPO is amber). If `paymentOption.type === 'CPO'` and `complexPaymentOptionId` is set, it renders the CPO panel.

> **Admin discount vs CPO discount.** The generic `AdminDiscountField` only appears for discountable plan types (ONE_TIME / SUBSCRIPTION). CPO invites use the CPO panel's own discount controls. If `admin_discount` is sent on a CPO assignment, the backend fails the item with *"Use the CPO discount for installment plans, not admin_discount"*.

### 3.3 Fetch the installment template

[CpoEnrollmentConfigPanel.tsx](../frontend-admin-dashboard/src/routes/manage-students/students-list/-components/enroll-bulk/components/CpoEnrollmentConfigPanel.tsx#L96) → `useCPOFullDetails(cpoId)` ([cpo-service.ts](../frontend-admin-dashboard/src/routes/financial-management/fee-plans/-services/cpo-service.ts), key `['cpo-full-details', cpoId]`, staleTime 30s):

```http
GET /admin-core-service/v1/fee-management/cpo/{cpoId}/full
```

Backend: [FeeManagementController.java:55](../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/fee_management/controller/FeeManagementController.java#L55) → `FeeManagementService.getFullCpo(cpoId, feeTypePage=0, feeTypeSize=20, installmentPage=0, installmentSize=50)`:

- loads the CPO (`status != DELETED`), otherwise returns 4xx "not found or deleted"
- loads its fee types (`status != DELETED`, paged)
- for each fee type, uses the **first** non-deleted AFV ("one AFV per fee type")
- loads that AFV's installments (`status != DELETED`, ordered by `installment_number`, paged)

The response shape it reads is `fee_types[].assigned_fee_value.{id, amount, installments[].{id, installment_number, amount, start_date, due_date}}`.

### 3.4 Flatten the template into rows

`flattenInstallments(fee_types)` produces one `InstallmentRow` per installment:

| Case | Row `id` | Amount | Dates |
|---|---|---|---|
| AFV has installments | `aft_installment.id` | `installment.amount` | template start/due |
| AFV has **no** installments (lump-sum fee) | **`assigned_fee_value.id`** (virtual row) | `afv.amount` | none |

The lump-sum alias matters. The SFP for a one-off fee has `i_id = null`, so the backend matches such overrides by `asv_id` instead (see §5.3).

---

## 4. What the admin can configure (the CPO panel)

All edits go into a `CpoEnrollmentConfig` stored on `SelectedPackageSession.cpoConfig`. One config applies to **every learner** in that assignment.

```ts
interface CpoEnrollmentConfig {
  installment_overrides?: {
    aft_installment_id: string;      // or AFV id for lump-sum rows
    start_date?: string | null;      // YYYY-MM-DD
    due_date?: string | null;
    amount?: number | null;          // manual amount; beats discount on same row
    discount?: { type: 'PERCENTAGE' | 'FLAT'; value: number; reason?: string | null } | null;
  }[];
  cpo_discount?: { type: 'PERCENTAGE' | 'FLAT'; value: number; reason?: string | null } | null;
  payment_mode?: 'SKIP' | 'OFFLINE' | null;
  payment_amount?: number | null;
  payment_reference?: string | null;
}
```

| Control | Effect |
|---|---|
| Per-row **Start / Due** date | Overrides that learner's SFP dates. Does not affect amounts. |
| Per-row **Amount** | Manual net amount for that installment. Takes priority over that row's discount. |
| Per-row **Discount** (% / flat) | Installment-level discount on the template amount. |
| **CPO discount** (% / flat + reason) | Whole-plan discount, spread across rows in proportion to their amounts. |
| **Skip — enroll only** (default) | Only generates the schedule. The learner pays later (self-serve or side-view). |
| **Record offline payment** | Amount (prefilled with the **full net total**, editable) plus reference/txn id. Creates a MANUAL payment that is FIFO-allocated. |

An override where every field is empty is removed from the payload, which keeps the request small.

### Live preview math (mirrors the backend)

For each row:
1. `step3 = override.amount ?? (template − rowDiscount)`, floored at 0
2. `cpoDiscountAmt = PERCENTAGE ? step3Sum × v% : min(step3Sum, v)`
3. Each row's share of the CPO discount is `row.step3 / step3Sum × cpoDiscountAmt`. **The last row absorbs rounding drift.**
4. The header shows `Total` (template gross) and `After discount` (net).

`CpoDiscountService` on the backend runs the same pipeline, so the preview matches what gets stored.

---

## 5. Submitting: preview (dry run) and confirm

### 5.1 Request

`buildRequest(dryRun)` ([BulkAssignDialog.tsx:201](../frontend-admin-dashboard/src/routes/manage-students/students-list/-components/enroll-bulk/bulk-assign-dialog/BulkAssignDialog.tsx#L201)) → `useBulkAssign` →

```http
POST /admin-core-service/v3/learner-management/assign
```
```json
{
  "institute_id": "…",
  "user_ids": ["existing-user-id"],
  "new_users": [ { "email": "…", "full_name": "…" } ],
  "assignments": [
    {
      "package_session_id": "ps-1",
      "enroll_invite_id": "invite-with-cpo",        // null = Auto
      "access_days": null,
      "cpo_config": {
        "installment_overrides": [
          { "aft_installment_id": "inst-2", "due_date": "2026-11-15" }
        ],
        "cpo_discount": { "type": "PERCENTAGE", "value": 10, "reason": "Sibling" },
        "payment_mode": "OFFLINE",
        "payment_amount": 15000,
        "payment_reference": "UPI-REF-123"
      }
    }
  ],
  "options": {
    "duplicate_handling": "SKIP",
    "notify_learners": false,
    "send_credentials": false,
    "transaction_id": null,
    "payment_date": null,
    "dry_run": true
  }
}
```

Legacy flat fields `cpo_payment_mode` and `cpo_payment_amount` still exist on `AssignmentItem`. If `cpo_config` is non-null, it takes precedence over them.

The wizard sends `dry_run: true` first (Step 4 preview), then `dry_run: false` on confirm. The dry run writes nothing. On a real run, the hook invalidates `students`, `student-count`, `GET_LEARNER_PACKAGES` and `user-plans`.

### 5.2 Backend orchestration

[BulkLearnerManagementController](../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/learner_management/controller/BulkLearnerManagementController.java) → [BulkAssignmentService.bulkAssign](../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/learner_management/service/BulkAssignmentService.java#L144)

```
bulkAssign
 ├─ resolveUserIds / create new users (skipped on dry run)
 ├─ for each assignment:
 │    config = DefaultInviteResolver.resolve(assignment)         ← once per package session
 │    for each user:
 │       processAssignment
 │         ├─ ACTIVE / INVITED mapping exists → SKIPPED (or FAILED if duplicate_handling=ERROR)
 │         ├─ TERMINATED / INACTIVE / EXPIRED  → handleReEnroll   (reuses the SSIGM row)
 │         └─ none                             → handleNewEnrollment
 └─ notifications / workflows / response
```

**[DefaultInviteResolver.resolve](../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/learner_management/service/DefaultInviteResolver.java#L74)** resolves the invite, payment option and plan:

1. **Invite:** the explicit `enroll_invite_id`. Otherwise the latest ACTIVE invite tagged `DEFAULT` for the package session. If there is none, it **auto-creates a free DEFAULT invite**.
2. **Payment option:** the bridge row for (invite, package session, ACTIVE). If none matches, any ACTIVE option on the invite. For a CPO invite, this is the **CPO mirror**.
3. **Payment plan:** the ACTIVE plan tagged `DEFAULT`, otherwise the first ACTIVE plan. For CPO, this is the **synthetic plan** (`actual_price` = contract total).

`isCpo = paymentOption.type == 'CPO'`.

#### Dry run (preview)

`handleNewEnrollment` / `handleReEnroll` return early with a preview row:

- `summarizeCpoFromTemplate(cpoId)` walks fee_type → AFV → installments and returns `cpo_total_amount` (template gross, **before** any `cpo_config` discount) and `cpo_installment_count`. A lump-sum AFV counts as 1.
- `cpo_initial_payment_mode` / `cpo_initial_payment_amount` come from `resolveCpoMode` / `resolveCpoAmount`. The mode is `OFFLINE` only if it was requested **and** the amount is > 0. Otherwise it is `SKIP`.

[Step4Preview.tsx](../frontend-admin-dashboard/src/routes/manage-students/students-list/-components/enroll-bulk/bulk-assign-dialog/steps/Step4Preview.tsx) shows a CPO badge, "N installments", the total, and either "recording ₹X now" or "no initial payment".

#### Real run: `handleNewEnrollment` for a CPO

1. Grant the `STUDENT` role, mark the lead CONVERTED (unless the course opted out), and resolve the sub-org for org-associated batches.
2. `resolveAdminDiscount` **throws for CPO** if `admin_discount` was sent.
3. `userPlanService.createUserPlan(userId, syntheticPlan, null, invite, cpoMirror, …, ACTIVE, …)`
4. Create the Student, link it to the institute (SSIGM `ACTIVE`, `user_plan_id`), generate the referral coupon, and fire the enrollment workflow.
5. Decrement package-session availability and auto-link the sub-org admin.
6. **`applyCpoEnrollmentSideEffects`** (§5.3).
7. The generic "payment date / transaction id → PaymentLog at `actual_price`" branch is **skipped for CPO**. It would charge the full contract value.
8. Result row: `SUCCESS`, `CREATED`, `user_plan_id`, plus the CPO summary fields.

`handleReEnroll` ([L902](../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/learner_management/service/BulkAssignmentService.java#L902)) does the same CPO steps for the fresh UserPlan of a re-enrolled learner.

### 5.3 `applyCpoEnrollmentSideEffects`: where installments become per-learner rows

[BulkAssignmentService.java:1894](../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/learner_management/service/BulkAssignmentService.java#L1894)

The order matters: **generate → override/discount → pay**.

**Step 1: Generate the schedule (always runs).**
[StudentFeePaymentGenerationService.generateFeeBills(userPlanId, cpoId, userId, instituteId)](../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/fee_management/service/StudentFeePaymentGenerationService.java#L54)

- Throws if the CPO has no fee types.
- For each `fee_type` → `assigned_fee_value`:
  - **with installments:** one SFP per `aft_installment`: `i_id = installment.id`, `asv_id = afv.id`, `amount_expected = installment.amount`, `amount_paid = 0`, `due_date = installment.due_date`, `start_date` copied if present, `status = PENDING`.
  - **lump sum:** one SFP with `i_id = null` (V452 relaxed NOT NULL; setting it to the AFV id would break `fk_sfp_installment` and abort the whole batch), `amount_expected = afv.amount`, and `due_date = today` so the fee counts as due now.
- Each SFP posts a **debit accrual** to `user_account_ledger` (`source_type = STUDENT_FEE_PAYMENT`).
- If `complexPaymentOptionId` is null on the mirror, an error is logged and generation is **skipped**. That points to a mirror-sync bug.

**Step 2: Apply `cpo_config` (only if present).**
[CpoEnrollmentConfigApplier.apply](../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/fee_management/service/CpoEnrollmentConfigApplier.java#L36)

- Loads the plan's SFPs and builds two maps: `i_id → sfpId` (real installments) and `asv_id → sfpId` (lump-sum rows only, where `i_id` is null).
- For each override, it resolves `aft_installment_id` against the first map, then the lump-sum alias map. An unmatched override is **logged and ignored**, not raised as an error.
  - dates → `CpoDiscountService.setInstallmentDates` (writes to the SFP directly, audit only, no recompute)
  - `amount` → `setInstallmentAmount` (manual override, wins)
  - else `discount` → `setInstallmentDiscount`
- `cpo_discount` → `CpoDiscountService.setCpoDiscount(userPlanId, …)`

[CpoDiscountService](../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/fee_management/service/CpoDiscountService.java) keeps **two layers**:
- The discount snapshot is the *why*: CPO discount, per-row discounts, manual overrides and history. It is stored in `user_plan.payment_option_json` under the key `cpo_discount_state` (`PaymentOptionJsonDiscountAccessor`). There is no `discount_json` column, although code comments use that name.
- `student_fee_payment.amount_expected` is the *how much*: the net amount FIFO allocates against, recomputed from `original_amount` on every change:
  `original → − row discount → (manual override replaces) → − proportional share of CPO discount → clamp ≥ 0 → recompute status`
- The discount is booked to `user_account_ledger` as a **delta** under `source_type = CPO_DISCOUNT` (a reversal if the discount grew, an accrual if it shrank), so Account Summary totals match the Fee Plan block.

**Step 3: Record the offline payment (only if `OFFLINE` and amount > 0).**

1. `paymentLogService.createPaymentLog(userId, amount, MANUAL, MANUAL, currency, userPlan, …, paymentDate)`. The payment date is the per-user CSV date, then the global `options.payment_date`, then now.
2. `updatePaymentLogOnly(… SUCCESS, PAID, {"transaction_id": payment_reference ?? options.transaction_id, "source": "BULK_ASSIGN_CPO"})`
3. `userAccountLedgerService.recordCreditPayment(…, "USER_PLAN", userPlanId, paymentLogId, …)`. This is idempotent per payment log.
4. [FeeLedgerAllocationService.allocatePaymentForNewLog(paymentLogId, amount, userPlanId)](../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/fee_management/service/FeeLedgerAllocationService.java#L175):
   - unpaid SFPs ordered by `due_date ASC` (FIFO)
   - fills each row to `PAID`, or leaves the last one `PARTIAL_PAID`
   - writes one `student_fee_allocation_ledger` row per SFP touched (`allocation_type = PAYMENT`)
   - **any excess** goes to `payment_log.unallocated_amount`. There is no upper bound check, so an admin can record more than is outstanding.
5. If the institute's `INVOICE_SETTING.generateInvoiceOnManualEnroll` is on, `invoiceService.generateInvoiceAfterCommit(paymentLogId, instituteId)`. This runs after commit so the invoice's REQUIRES_NEW transaction can see the PaymentLog.

Any exception in steps 1–3 is rethrown as `VacademyException`. `processAssignment` catches it and marks that user/package-session row `FAILED` with the message.

---

## 6. Worked example

The CPO "Annual 2026" has:
- Tuition: 3 installments × ₹10,000, due 1 Jul, 1 Oct and 1 Jan
- Admission: lump sum ₹5,000 (no installments)

The admin picks this invite, sets a 10% CPO discount, moves installment 2 to 15 Oct, and records ₹15,000 offline.

| Stage | Result |
|---|---|
| Panel | Total ₹35,000 · After discount ₹31,500 |
| Preview row | CPO · 4 installments · ₹35,000 · recording ₹15,000 now |
| `generateFeeBills` | 4 SFPs: 10k (1 Jul), 10k (1 Oct), 10k (1 Jan), 5k (today, `i_id=null`) |
| Override | SFP #2 due date → 15 Oct |
| CPO discount | ₹3,500 spread proportionally: 9,000 / 9,000 / 9,000 / 4,500 |
| FIFO ₹15,000 (by due date, enrolled 14 Oct) | 1 Jul ₹9,000 → PAID; lump sum (due 14 Oct) ₹4,500 → PAID; 15 Oct gets ₹1,500 → PARTIAL_PAID; 1 Jan untouched |
| Ledgers | 4 debit accruals, CPO_DISCOUNT reversal ₹3,500, 1 credit ₹15,000, 3 allocation rows |

---

## 7. After enrollment: where the installments show up

| Surface | Reads |
|---|---|
| Admin side view → Fee Plan / CPO editor | `GET /v1/fee-management/user/{userId}/cpo-user-plans` (SFP rows + the `cpo_discount_state` snapshot). Later edits go through `PUT /user-plan/{id}/cpo-discount`, the split-installment endpoint, and offline-payment recording (`CpoSideViewService`). |
| Learner pay (backend only) | No learner screen calls these after enrollment; the learner app only uses the open endpoints inside enrollment checkout. Later installments are collected by the admin (offline payment, or an admin invoice with a `/pay/invoice/{id}` link). Backend: `POST /learner/v1/fee/pay-installments` ([FeeTrackingLearnerController](../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/fee_management/controller/FeeTrackingLearnerController.java)) or the open `/cpo-pay-installments`. Amounts come from [CpoDuesCalculator](../admin_core_service/src/main/java/vacademy/io/admin_core_service/features/fee_management/service/CpoDuesCalculator.java): "due now" is the unpaid rows with `due_date ≤ today` (rows with no date count as due), and "full outstanding" is all unpaid rows. |
| Payment history / invoices | `InvoiceService.getInvoicesByUserId` merges unpaid SFPs into the invoice list. |
| Account summary tiles | `user_account_ledger` (accruals, discount reversals, credits). |

---

## 8. Learner self-enroll vs admin enroll (CPO)

| | Admin (this doc) | Learner self-enroll (`/v1` or `/v2/learner/enroll`) |
|---|---|---|
| Entry | `BulkAssignmentService` | `ComplexPaymentOptionOperation` strategy |
| UserPlan status | `ACTIVE` immediately | `PENDING_FOR_PAYMENT` until the gateway confirms |
| SFP generation | `applyCpoEnrollmentSideEffects` calls the generator explicitly | the strategy calls the same generator |
| Per-learner overrides / discount | yes (`cpo_config`) | no |
| First charge | optional offline amount chosen by the admin | the next unpaid installment (or `OVERRIDE_TOTAL_AMOUNT` / the learner's amount) via Razorpay `SCHOOL` |
| Allocation | `allocatePaymentForNewLog` | the Razorpay webhook `handleSchoolPayment` → the same FIFO allocator. **Only Razorpay routes `SCHOOL` payments**; on other gateways the payment is marked PAID but the installments are not allocated |

---

## 9. Gotchas and known gaps

1. **Auto mode can disagree between the UI and the backend.** With no DEFAULT invite, the frontend previews the *first ACTIVE invite* (which might be a CPO invite), but `DefaultInviteResolver` **auto-creates a free invite** and enrolls against that. If the package session has no DEFAULT invite, pick the CPO invite explicitly.
2. **There is no transaction around one learner's enrollment.** `BulkAssignmentService` has no `@Transactional`. If the CPO side effects fail (for example, a CPO with zero fee types, or a bad override), the UserPlan, SSIGM and any SFPs already saved **stay in place**, but the row is reported `FAILED`. Check the learner before retrying, or the retry is SKIPPED as "Already enrolled".
3. **The installment due date must be set.** `generateFeeBills` calls `Date.valueOf(installment.getDueDate())`. A template installment with a null `due_date` throws an NPE and fails generation for that learner.
4. **Template reads differ.** The panel's `/full` call filters `DELETED` rows and pages (20 fee types, 50 installments per AFV, with no params sent). The generator and `summarizeCpoFromTemplate` read **all** rows and all AFVs. Today this only matters for very large CPOs or ones with several AFVs per fee type, because installment edits hard-delete and soft-delete only happens for the whole CPO.
5. **The preview total is the gross amount.** `cpo_total_amount` in Step 4 is the template sum before `cpo_config` discounts. The panel header shows the net.
6. **The offline amount is not bounds-checked.** Excess goes to `payment_log.unallocated_amount`. The UI prefills the full net amount, not the next installment.
7. **Overrides that don't match are ignored without an error.** They are only logged (`Override for aft_installment=… ignored`).
8. **One `cpo_config` applies to every learner in the assignment.** Learners who need different schedules must be enrolled separately, or edited afterwards in the side view.

---

## 10. File index

**Frontend** (`frontend-admin-dashboard/src`)

| File | Role |
|---|---|
| `components/common/students/enroll-students-button.tsx` | Enroll {Learner} button → wizard |
| `routes/manage-students/students-list/-components/enroll-bulk/bulk-assign-dialog/BulkAssignDialog.tsx` | Wizard, `buildRequest` |
| `…/bulk-assign-dialog/steps/Step3EnrollConfig.tsx` | Per-course invite picker + CPO panel |
| `…/bulk-assign-dialog/steps/Step4Preview.tsx` | Dry-run result with CPO summary |
| `…/enroll-bulk/components/InvitePickerDropdown.tsx` | Invite list (hides `SUB_ORG`) |
| `…/enroll-bulk/components/CpoEnrollmentConfigPanel.tsx` | Installment table, overrides, discount, offline payment |
| `…/students-list/-hooks/useResolvedInviteDetails.ts` | Invite → payment option → CPO id |
| `…/students-list/-hooks/useInvitesForPackageSession.ts` | Invite list query |
| `…/students-list/-hooks/useBulkAssign.ts` | `POST /v3/learner-management/assign` |
| `…/students-list/-types/bulk-assign-types.ts` | `CpoEnrollmentConfig`, `InstallmentOverride`, result DTO |
| `routes/financial-management/fee-plans/-services/cpo-service.ts` | `useCPOFullDetails` |
| `constants/urls.ts` | `GET_INVITE_LINKS`, `GET_SINGLE_INVITE_DETAILS`, `GET_CPO_FULL_DETAILS`, `BULK_ASSIGN_LEARNERS` |

**Backend** (`admin_core_service/.../features`)

| File | Role |
|---|---|
| `learner_management/controller/BulkLearnerManagementController.java` | `POST /v3/learner-management/assign` |
| `learner_management/service/BulkAssignmentService.java` | Orchestration, CPO side effects |
| `learner_management/service/DefaultInviteResolver.java` | Invite / option / plan resolution |
| `learner_management/dto/AssignmentItemDTO.java`, `CpoEnrollmentConfigDTO.java`, `InstallmentOverrideDTO.java` | Request DTOs |
| `enroll_invite/controller/EnrollInviteController.java`, `enroll_invite/service/EnrollInviteService.java` | Invite detail with `complex_payment_option_id` |
| `fee_management/controller/FeeManagementController.java`, `fee_management/service/FeeManagementService.java` | `GET /cpo/{id}/full` |
| `fee_management/service/StudentFeePaymentGenerationService.java` | Template → SFP rows |
| `fee_management/service/CpoEnrollmentConfigApplier.java` | `cpo_config` → SFP mutations |
| `fee_management/service/CpoDiscountService.java` | Discount/override math, recompute, ledger delta |
| `fee_management/service/FeeLedgerAllocationService.java` | FIFO allocation |
| `fee_management/service/CpoDuesCalculator.java` | Due-now / outstanding |
