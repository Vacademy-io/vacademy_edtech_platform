# Payment System Documentation

This document covers every payment-related entity in `admin_core_service`, how they are created, how they get assigned to users, and how discounts/concessions work.

> **See also:**
> - [`plan-change.md`](./plan-change.md) — how a learner moves between payment plans (upgrade
>   with prorated charge, downgrade scheduled to the end of the cycle, admin override) without
>   the `UserPlan` being replaced.
> - [`CPO_INSTALLMENTS.md`](./CPO_INSTALLMENTS.md) — admin enrollment against a CPO invite,
>   per-learner installment overrides, discounts and offline payments.
> - [`../CPO_PAYMENT_OPTION_CONTEXT.md`](../CPO_PAYMENT_OPTION_CONTEXT.md) — how a CPO is exposed
>   as a `payment_option` of type `CPO` (mirror option + synthetic plan, V232/V233).
> - [`invoices.md`](./invoices.md) — invoice lifecycle, the user account ledger, admin invoices.
>
> Checked against the code on 2026-10-14. Section [Known gaps](#known-gaps) lists behaviour that
> differs from what a reader would assume.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Part A -- Subscription / Plan Entities](#part-a----subscription--plan-entities)
   - [PaymentOption](#1-paymentoption)
   - [PaymentPlan](#2-paymentplan)
   - [UserPlan](#3-userplan)
   - [PaymentLog](#4-paymentlog)
   - [PaymentLogLineItem](#5-paymentloglineitem)
3. [Part B -- Fee Management Entities (New)](#part-b----fee-management-entities-new)
   - [ComplexPaymentOption (CPO)](#6-complexpaymentoption-cpo)
   - [FeeType](#7-feetype)
   - [AssignedFeeValue](#8-assignedfeevalue)
   - [AftInstallment](#9-aftinstallment)
   - [StudentFeePayment](#10-studentfeepayment)
   - [StudentFeeAllocationLedger](#11-studentfeeallocationledger)
   - [StudentFeeAdjustmentHistory](#12-studentfeeadjustmenthistory)
   - [InstituteFeeTypePriority](#13-institutefeetypepriority)
4. [Part C -- Discount & Coupon Entities](#part-c----discount--coupon-entities)
   - [CouponCode](#14-couponcode)
   - [AppliedCouponDiscount](#15-appliedcoupondiscount)
   - [ReferralOption](#16-referraloption)
   - [ReferralMapping](#17-referralmapping)
   - [ReferralBenefitLogs](#18-referralbenefitlogs)
5. [Part D -- Invoice Entities](#part-d----invoice-entities)
   - [Invoice](#19-invoice)
   - [InvoiceLineItem](#20-invoicelineitem)
   - [InvoicePaymentLogMapping](#21-invoicepaymentlogmapping)
6. [Part E -- Gateways, Ledger, Plan Changes and Audit](#part-e----gateways-ledger-plan-changes-and-audit)
7. [Entity Relationship Diagram](#entity-relationship-diagram)
8. [Flows](#flows)
   - [How a PaymentOption + Plans Get Created](#flow-1-how-a-paymentoption--plans-get-created)
   - [How a User Gets Assigned a Plan (UserPlan creation)](#flow-2-how-a-user-gets-assigned-a-plan-userplan-creation)
   - [How a CPO Gets Created](#flow-3-how-a-cpo-gets-created)
   - [How Fee Bills Get Generated for a Student](#flow-4-how-fee-bills-get-generated-for-a-student)
   - [How Payments Get Allocated to Fee Bills](#flow-5-how-payments-get-allocated-to-fee-bills)
   - [How to Apply a Special Discount to a User](#flow-6-how-to-apply-a-special-discount-to-a-user)
   - [How a Paid Live Session Gets Charged](#flow-7-how-a-paid-live-session-gets-charged-v401)
   - [How a Gateway Payment Is Confirmed (webhooks)](#flow-8-how-a-gateway-payment-is-confirmed-webhooks)
   - [Regional (Country-Based) Pricing](#flow-9-regional-country-based-pricing-v585)
9. [API Reference](#api-reference)
10. [Statuses & Enums](#statuses--enums)
11. [Scheduled Jobs](#scheduled-jobs)
12. [Known gaps](#known-gaps)

---

## System Overview

The payment system has two parallel tracks:

| Track | Purpose | Key Entities |
|-------|---------|--------------|
| **Subscription / Plan** | Online course purchases, one-time payments, donations, free access | PaymentOption -> PaymentPlan -> UserPlan -> PaymentLog |
| **Fee Management** | School/institute fee structures with installments, concessions, penalties | CPO -> FeeType -> AssignedFeeValue -> AftInstallment -> StudentFeePayment |
| **Live Session Fees** | Paid live classes (public guests + private learners) | PaymentOption(LIVE_SESSION) -> SessionGuestRegistration -> Invoice(LIVE_SESSION) -> PaymentLog |

All tracks converge at `PaymentLog` (the actual money transaction), `Invoice` (the generated receipt) and `user_account_ledger` (per-learner debits and credits, see [Part E](#part-e----gateways-ledger-plan-changes-and-audit)).

Since V232 the fee management track is no longer a separate entry point: every CPO has a
**mirror** `payment_option` row (`type = 'CPO'`, `complex_payment_option_id` set) holding one
synthetic `payment_plan` whose `actual_price` is the full contract value. Invites, enrollment
strategies and `user_plan` rows point at the mirror like any other payment option. See
[CPO_PAYMENT_OPTION_CONTEXT.md](../CPO_PAYMENT_OPTION_CONTEXT.md).

```
                    SUBSCRIPTION TRACK                          FEE MANAGEMENT TRACK
                    ==================                          ====================
                    PaymentOption                               ComplexPaymentOption (CPO)
                        |                                           |
                    PaymentPlan                                 FeeType
                        |                                           |
                    UserPlan  <-------- enrollment -------->    AssignedFeeValue
                        |                                           |
                    PaymentLog  <------- money flows ------->   AftInstallment
                        |                                           |
                    Invoice                                     StudentFeePayment
                                                                    |
                                                                StudentFeeAllocationLedger
```

---

## Part A -- Subscription / Plan Entities

### 1. PaymentOption

**Table:** `payment_option`  
**File:** `features/user_subscription/entity/PaymentOption.java`

A **PaymentOption** represents a purchasable offering (e.g. "Annual Subscription", "One-Time Course Access"). It is the top-level container that holds one or more pricing tiers (PaymentPlans).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | String | Display name (e.g. "Gold Plan") |
| `status` | String | ACTIVE, DELETED |
| `source` | String | Where this option lives: `INSTITUTE`, `PACKAGE_SESSION`, or `LIVE_SESSION` (paid live class fee, source_id = live_session.id) |
| `source_id` | String | ID of the source entity |
| `tag` | String | DEFAULT, etc. |
| `type` | String | SUBSCRIPTION, ONE_TIME, FREE, DONATION, CPO |
| `require_approval` | boolean | Whether enrollment needs admin approval (default: true) |
| `unit` | String | Subscription unit -- day, month, year |
| `payment_option_metadata_json` | TEXT | Flexible JSON for extra config |
| `complex_payment_option_id` | FK | Set only on CPO mirror rows (V232). Partial unique: one mirror per CPO |
| `plan_change_allowed` | boolean | Per-option plan-change switch (V498, see `plan-change.md`) |
| `created_by_user_id` | String | Creator (V507) |

**Relationships:**
- One-to-Many with `PaymentPlan` (only ACTIVE plans are loaded via `@Where`)

**Listing:** `get-payment-options` excludes `type = 'CPO'` by default, so mirror rows do not
show up next to ordinary plans unless the caller asks for them.

---

### 2. PaymentPlan

**Table:** `payment_plan`  
**File:** `features/user_subscription/entity/PaymentPlan.java`

A **PaymentPlan** is a specific pricing tier within a PaymentOption. For example, a "Gold Plan" PaymentOption might have a "Monthly" plan at $9.99 and a "Yearly" plan at $99.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | String | Plan name (e.g. "Monthly", "Yearly") |
| `status` | String | ACTIVE, DELETED |
| `validity_in_days` | Integer | How many days the plan lasts |
| `actual_price` | double | The real price the user pays |
| `elevated_price` | double | Strike-through / original price (for showing discount) |
| `currency` | String | INR, USD, etc. |
| `description` | TEXT | Rich text description |
| `tag` | String | Grouping tag |
| `feature_json` | TEXT | JSON listing features included |
| `member_count` | Integer | For group plans -- how many seats |
| `payment_option_id` | FK | Parent PaymentOption |
| `plan_change_allowed` | boolean | Per-plan plan-change switch (V498) |

**Relationships:**
- Many-to-One with `PaymentOption`

---

### 3. UserPlan

**Table:** `user_plan`  
**File:** `features/user_subscription/entity/UserPlan.java`

A **UserPlan** represents a student/user's enrollment in a specific payment plan. This is the central entity that ties a user to what they purchased.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | String | **Always required** -- the individual user (never null, even for SUB_ORG) |
| `plan_id` | FK | Reference to PaymentPlan |
| `plan_json` | TEXT | Snapshot of the plan at enrollment time |
| `payment_option_id` | FK | Reference to PaymentOption |
| `payment_option_json` | TEXT | Snapshot of the option at enrollment time |
| `applied_coupon_discount_id` | FK | Discount applied at enrollment |
| `applied_coupon_discount_json` | TEXT | Snapshot of discount |
| `enroll_invite_id` | FK | The enrollment invite used |
| `status` | String | ACTIVE, PENDING, PENDING_FOR_PAYMENT, PAYMENT_FAILED, CANCELED, EXPIRED, TERMINATED |
| `source` | String | `USER` (direct purchase) or `SUB_ORG` (organization enrollment) |
| `sub_org_id` | String | Sub-organization ID (only when source=SUB_ORG) |
| `json_payment_details` | TEXT | Flexible JSON for payment metadata |
| `start_date` | Date | Plan start |
| `end_date` | Date | Plan expiry |
| `auto_renewal_enabled`, `next_charge_at`, `is_trial`, `renewal_attempt_count`, `last_renewal_attempt_at` | various | Autopay state (V369). The mandate itself lives in `user_institute_payment_gateway_mapping` |
| `discount_granted_by_user_id`, `discount_granted_at`, `discount_cycles_applied` | various | Admin-granted discount audit (V557) |

**Relationships:**
- Many-to-One with `PaymentPlan`, `PaymentOption`, `AppliedCouponDiscount`, `EnrollInvite`
- One-to-Many with `PaymentLog`

**CPO discount snapshot:** there is no `discount_json` column. For CPO plans the discount and
per-installment override history is stored inside `payment_option_json` under the key
`cpo_discount_state` (`PaymentOptionJsonDiscountAccessor`). Code comments call this snapshot
"`user_plan.discount_json`".

---

### 4. PaymentLog

**Table:** `payment_log`  
**File:** `features/user_subscription/entity/PaymentLog.java`

A **PaymentLog** records an actual payment transaction. One UserPlan can have multiple PaymentLogs (e.g. failed attempt then success, or recurring payments).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | String | Who paid |
| `status` | String | Record lifecycle: INITIATED, ACTIVE, SUCCESS, FAILED (see [Statuses](#paymentlog-statuses)) |
| `payment_status` | String | Money outcome: PAYMENT_PENDING, PAID, FAILED, plus ABANDONED and VOIDED |
| `vendor` | String | RAZORPAY, STRIPE, CASHFREE, PHONEPE, EWAY, PAYPAL, MANUAL (offline) |
| `vendor_id` | String | Transaction ID from the payment gateway |
| `date` | Date | When payment happened |
| `currency` | String | INR, USD, etc. |
| `payment_amount` | Double | Amount paid |
| `unallocated_amount` | Double | Overpayment not allocated to any fee bill (V155, default 0) |
| `payment_specific_data` | TEXT | Full JSON response from the gateway; also holds `order_id` used by webhooks to find the row |
| `tracking_id` | String | External tracking reference (shipping) |
| `tracking_source` | String | Source of tracking ID |
| `order_status` | String | Shipping/order status, unrelated to payment |
| `user_plan_id` | FK | Parent UserPlan. **Nullable**: admin invoices, paid live sessions and donations create logs with no UserPlan |

`tracking_id`, `tracking_source` and `order_status` are mapped in `PaymentLog.java` but no
Flyway migration creates them (they exist in prod; V465 indexes them).

**Relationships:**
- Many-to-One with `UserPlan`

---

### 5. PaymentLogLineItem

**Table:** `payment_log_line_item`  
**File:** `features/user_subscription/entity/PaymentLogLineItem.java`

Breaks down a payment into line items (e.g. the base amount, discount amount, tax).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `type` | String | e.g. DISCOUNT (stored as a negative amount) |
| `amount` | NUMERIC(12,2) | Line item amount (was int4 before V558) |
| `source` | String | coupon, referral, etc. |
| `source_id` | String | ID of the source entity |
| `payment_log_id` | FK | Parent PaymentLog |

---

## Part B -- Fee Management Entities (New)

These entities support complex school/institute fee structures with multiple fee types, installment schedules, and payment allocation.

### 6. ComplexPaymentOption (CPO)

**Table:** `complex_payment_option`  
**File:** `features/fee_management/entity/ComplexPaymentOption.java`

A **CPO** is a fee template/structure for an institute. It groups multiple fee types (tuition, lab, transport, etc.) into a single billable package. Think of it as a "fee plan" that gets assigned to a class/batch.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | String | e.g. "Class 10 - 2025-26 Fee Structure" |
| `institute_id` | String | Which institute owns this CPO |
| `default_payment_option_id` | String | Default PaymentOption for gateway payments |
| `status` | String | ACTIVE, PENDING_APPROVAL, DELETED |
| `created_by` | String | User who created it |
| `approved_by` | String | User who approved it (if approval was needed) |
| `metadata_json` | TEXT | Flexible JSON |

**Approval flow:** ADMINs create CPOs in ACTIVE status directly. Non-admins create CPOs in PENDING_APPROVAL -- an admin must call the approve endpoint to activate. Enrollment refuses a CPO that is PENDING_APPROVAL or DELETED (`CpoValidationService`). The admin UI has no approve button.

**Mirror sync:** every create, update, approve and soft-delete calls
`PaymentOptionService.findOrCreateMirrorForCpo` / `syncMirrorForCpo`, which keeps the mirror
`payment_option` and its synthetic `payment_plan` (`actual_price` = sum of installments) in step.

---

### 7. FeeType

**Table:** `fee_type`  
**File:** `features/fee_management/entity/FeeType.java`

A **FeeType** represents a category of fee within a CPO (e.g. Tuition Fee, Lab Fee, Transport Fee).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | String | e.g. "Tuition Fee" |
| `code` | String | Short code, e.g. "TUITION" |
| `description` | TEXT | Detailed description |
| `cpo_id` | String | Parent CPO |
| `status` | String | ACTIVE, DELETED |
| `is_skippable` | Boolean | Can a student opt out of this fee? (default: false) |

---

### 8. AssignedFeeValue

**Table:** `assigned_fee_value`  
**File:** `features/fee_management/entity/AssignedFeeValue.java`

**AssignedFeeValue** defines the monetary amount and payment terms for a FeeType. Each FeeType has one AssignedFeeValue.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `fee_type_id` | String | Parent FeeType |
| `amount` | BigDecimal | The final fee amount (after any template-level discount) |
| `original_amount` | BigDecimal | Original amount before discount |
| `discount_type` | String | PERCENTAGE, FLAT, or null |
| `discount_value` | BigDecimal | Discount amount or percentage |
| `no_of_installments` | Integer | Number of installments |
| `has_installment` | Boolean | Whether installment payment is enabled |
| `is_refundable` | Boolean | Whether this fee is refundable |
| `has_penalty` | Boolean | Whether late payment incurs penalty |
| `penalty_percentage` | BigDecimal | Penalty % for late payment |
| `status` | String | ACTIVE, DELETED |

---

### 9. AftInstallment

**Table:** `aft_installments`  
**File:** `features/fee_management/entity/AftInstallment.java`

**AftInstallment** defines individual installment due dates and amounts within an AssignedFeeValue.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `assigned_fee_value_id` | String | Parent AssignedFeeValue |
| `installment_number` | Integer | Sequence number (1, 2, 3...) |
| `amount` | BigDecimal | Amount due for this installment |
| `due_date` | LocalDate | When this installment is due |
| `start_date` | LocalDate | Period start |
| `end_date` | LocalDate | Period end |
| `status` | String | PENDING, DELETED |

---

### 10. StudentFeePayment

**Table:** `student_fee_payment`  
**File:** `features/fee_management/entity/StudentFeePayment.java`

A **StudentFeePayment** is the actual fee bill for a student. One row is created per installment per fee type. This is the row that tracks how much a student owes and has paid.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | String | The student |
| `user_plan_id` | String | The student's UserPlan |
| `cpo_id` | String | The CPO this bill was generated from (NOT NULL) |
| `asv_id` | String | AssignedFeeValue reference (NOT NULL) |
| `i_id` | String | AftInstallment reference. **Nullable since V452**: null for a lump-sum fee (AFV with no installments) and for rows created by "split installment" |
| `fee_type_id` | String | FeeType reference |
| `amount_expected` | BigDecimal | Net amount due after per-learner discounts and overrides. This is what allocation targets |
| `original_amount` | BigDecimal | Template amount before per-learner discounts (V246) |
| `amount_paid` | BigDecimal | Amount paid so far (default: 0) |
| `start_date` | Date | Installment window start (V246) |
| `due_date` | Date | When payment is due. Lump-sum fees get the enrollment date |
| `status` | String | PENDING, PARTIAL_PAID, PAID, WAIVED. OVERDUE is computed for display and never written by any job |
| `is_skippable` | Boolean | Inherited from FeeType |
| `institute_id` | String | For workflow triggers (fee reminders) |
| `current_adjustment_history_id` | String | Latest adjustment event |
| `package_session_ids` | String | Comma-separated package session IDs |

**Relationships:**
- Many-to-One with `ComplexPaymentOption`

---

### 11. StudentFeeAllocationLedger

**Table:** `student_fee_allocation_ledger`  
**File:** `features/fee_management/entity/StudentFeeAllocationLedger.java`

The **ledger** tracks how payment money gets allocated to specific fee bills. When a student pays, the system distributes the payment across their pending bills and records each allocation here.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | String | The student |
| `payment_log_id` | String | Which PaymentLog the money came from |
| `student_fee_payment_id` | String | Which fee bill it was applied to |
| `amount_allocated` | BigDecimal | How much was allocated |
| `transaction_type` | String | INSTALLMENT_PAYMENT, ADVANCE_ROLLOVER, REFUND, BOUNCE_REVERSAL (V119) |
| `remarks` | String | e.g. "Auto-allocated [ALL_DUES, priority-based]" |

---

### 12. StudentFeeAdjustmentHistory

**Table:** `student_fee_adjustment_history`  
**File:** `features/fee_management/entity/StudentFeeAdjustmentHistory.java`

Tracks fee adjustments like concessions (fee reduction) and penalties (fee increase). Forms a linked list via `previous_event_id` for full audit trail.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `student_fee_payment_id` | String | Which fee bill was adjusted |
| `institute_id` | String | Institute |
| `event_type` | String | SUBMITTED, APPROVED, REJECTED (plus retraction) |
| `adjustment_type` | String | CONCESSION or PENALTY |
| `amount` | BigDecimal | Adjustment amount |
| `reason` | String | Free text reason |
| `resulting_status` | String | Bill status after adjustment |
| `actor_user_id` | String | Who made the adjustment |
| `actor_role` | String | Their role |
| `previous_event_id` | String | Previous adjustment in the chain (audit trail) |
| `metadata` | JSONB | Flexible JSON metadata |

---

### 13. InstituteFeeTypePriority

**Table:** `institute_fee_type_priority`  
**File:** `features/fee_management/entity/InstituteFeeTypePriority.java`

Configures which fee types get paid first when allocating a student's payment. Lower `priority_order` = paid first.

Only the admin `/{userId}/allocate` and `/allocate-selected` endpoints use it (through
`FeeAllocationEngine`). Gateway payments and offline payments recorded at enrollment or in the
side view allocate strictly by due date and ignore this table. It is edited through
`PUT /v1/admin/student-fee/priority`; there is no admin UI for it.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `institute_id` | String | Institute |
| `scope` | String | OVERDUE_ONLY, UPCOMING_ONLY, ALL_DUES |
| `fee_type_id` | String | Which fee type |
| `priority_order` | Integer | Lower = higher priority |

**Unique constraint:** (institute_id, scope, fee_type_id)

---

## Part C -- Discount & Coupon Entities

### 14. CouponCode

**Table:** `coupon_code`  
**File:** `features/user_subscription/entity/CouponCode.java`

A **CouponCode** is the actual code string that users enter to get a discount.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `code` | String | Unique coupon string shown to users |
| `status` | String | ACTIVE, EXPIRED, REDEEMED |
| `source_type` | String | ADMIN, SYSTEM |
| `source_id` | String | Who/what created it |
| `is_email_restricted` | boolean | If true, only allowed emails can use it |
| `allowed_email_ids` | String (JSON) | JSON array of allowed email addresses |
| `tag` | String | Grouping tag |
| `generation_date` | Date | When the code was generated |
| `short_url` | String | Shareable short link |
| `redeem_start_date` | Date | Earliest redemption date |
| `redeem_end_date` | Date | Latest redemption date |
| `usage_limit` | Long | Max times this code can be used |
| `can_be_added` | boolean | Whether it can still be applied |
| `institute_id` | String | Owning institute (V310). The code is unique per institute among non-DELETED rows (V318) |
| `min_items` | Integer | Minimum basket size for product-page carts (V474) |

`coupon_package_session` and `coupon_enroll_invite` (V310) scope a coupon to specific
courses or invites.

**Where a coupon is applied:** the learner's code is re-validated on the server at enrollment
(`LearnerEnrollRequestService.resolveAppliedCoupon` → `CouponValidationService.validate`) and
applied to the plan price in the ONE_TIME and SUBSCRIPTION strategies. The CPO strategy does not
apply coupons.

---

### 15. AppliedCouponDiscount

**Table:** `applied_coupon_discount`  
**File:** `features/user_subscription/entity/AppliedCouponDiscount.java`

**AppliedCouponDiscount** defines the discount rules attached to a coupon code. When a user applies a coupon, this entity determines how much they save.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | String | Display name |
| `discount_type` | String | percentage, amount, media |
| `media_ids` | TEXT | JSON of media IDs (for media-type discounts) |
| `status` | String | ACTIVE, EXPIRED |
| `validity_in_days` | Integer | How long the discount is valid |
| `discount_source` | String | referral, coupon_code |
| `currency` | String | Currency for amount-type discounts |
| `max_discount_point` | Double | Maximum discount cap |
| `discount_point` | Double | The discount value (% or amount) |
| `max_applicable_times` | Integer | Max times this discount can be applied |
| `redeem_start_date` | Date | Valid from |
| `redeem_end_date` | Date | Valid until |
| `coupon_code_id` | FK | Parent CouponCode |

---

### 16. ReferralOption

**Table:** `referral_option`  
**File:** `features/user_subscription/entity/ReferralOption.java`

Configures referral programs -- what discount the referrer and referee get.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | String | Program name |
| `source` | String | campaign, user_referral |
| `source_id` | String | Related entity ID |
| `status` | String | ACTIVE, INACTIVE, EXPIRED |
| `referrer_discount_json` | TEXT | JSON discount config for the referrer |
| `referee_discount_json` | TEXT | JSON discount config for the referee |
| `referrer_vesting_days` | Integer | Days before referrer benefit activates |
| `allow_combine_offers` | boolean | Can this be combined with other discounts? |
| `setting_json` | TEXT | Additional settings |

---

### 17. ReferralMapping

Tracks who referred whom and which referral code was used.

### 18. ReferralBenefitLogs

Logs individual referral benefit applications (DISCOUNT, CREDIT) with status (APPLIED, PENDING, EXPIRED).

---

## Part D -- Invoice Entities

### 19. Invoice

**Table:** `invoice`  
**File:** `features/invoice/entity/Invoice.java`

Generated invoice after a successful payment.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `invoice_number` | String | Unique invoice number |
| `user_id` | String | Customer |
| `institute_id` | String | Seller institute |
| `invoice_date` | Date | Invoice date |
| `due_date` | Date | Payment due date |
| `subtotal`, `discount_amount`, `tax_amount`, `total_amount` | BigDecimal | Monetary fields |
| `currency` | String | Currency |
| `status` | String | GENERATED (receipt for a payment already made), PENDING_PAYMENT (admin invoice / live session awaiting payment), PAID, REJECTED |
| `pdf_file_id` | String | S3 file reference for the PDF |
| `invoice_data_json` | TEXT | Full invoice data as JSON |
| `tax_included` | Boolean | Whether tax is included in prices |
| `source` | String | What raised it: `USER_PLAN`, `STUDENT_FEE_PAYMENT`, `ADMIN_MANUAL`, `LIVE_SESSION` (V375) |
| `source_id` | String | ID of the source entity (for LIVE_SESSION: the session_guest_registrations id) |
| `seq_no`, `seq_scope_key` | various | Per-institute numbering (V432). Invoice numbers are unique per institute, not globally |

Numbering, tax and email behaviour come from the institute's `INVOICE_SETTING`
(`sendInvoiceEmail`, `taxRate`, `taxIncluded`, `taxComponents`, `numbering{format, seqScope, ...}`,
`generateInvoiceOnManualEnroll`, `proformaEnabled`). See [invoices.md](./invoices.md).

### 20. InvoiceLineItem

Individual line items in an invoice (PLAN, DISCOUNT, TAX, COUPON, REFERRAL).

### 21. InvoicePaymentLogMapping

Links invoices to payment logs. Supports multi-package enrollments where one invoice covers multiple payments.

Related tables: `invoice_billing_profile` (V363, the learner's billing name/GSTIN per institute)
and `invoice_released_number` (V531, numbers freed by deleted invoices).

---

## Part E -- Gateways, Ledger, Plan Changes and Audit

### 22. InstitutePaymentGatewayMapping

**Table:** `institute_payment_gateway_mapping` (V1)

One row per institute per gateway. `vendor` (STRIPE, RAZORPAY, PHONEPE, CASHFREE, EWAY),
`payment_gateway_specific_data` (JSON credentials: apiKey, keySecret, publishableKey,
webhookSecret, saltKey, ...), `status`. Managed from **Settings → Payment Gateways**
(`/v1/institute/payment-gateways`); secrets are returned masked.

**Which gateway is used:** the newest ACTIVE mapping is the institute's default (falls back to
STRIPE). It is stamped onto each `enroll_invite.vendor` when the invite is created, and the
payment uses the invite's vendor. Admin invoices and live sessions use the institute default.

### 23. UserInstitutePaymentGatewayMapping

**Table:** `user_institute_payment_gateway_mapping` (V1)

Per learner per gateway: `payment_gateway_customer_id` and `payment_gateway_customer_data`
(saved card / mandate token used by autopay renewals).

### 24. UserAccountLedger

**Table:** `user_account_ledger` (V375, gross/discount columns V420)

Append-only per-learner money ledger behind the Account Summary tiles.

| Column | Description |
|--------|-------------|
| `event_type` | DEBIT_ACCRUAL, DEBIT_REVERSAL, DEBIT_PENALTY, CREDIT_PAYMENT, CREDIT_WAIVER, CREDIT_ADJUSTMENT, CREDIT_REVERSAL |
| `source_type` | USER_PLAN, STUDENT_FEE_PAYMENT, ADMIN_INVOICE, LIVE_SESSION, CPO_DISCOUNT |
| `amount` | Always ≥ 0 (CHECK); direction comes from `event_type` |

Who writes it:
- one DEBIT_ACCRUAL per fee bill when CPO bills are generated; one per paid plan for non-CPO
  enrollments (CPO plans are skipped there to avoid booking the contract twice,
  `UserPlanService` ~L469);
- CPO discounts are booked as deltas under `source_type = CPO_DISCOUNT`;
- one CREDIT_PAYMENT per successful payment, de-duplicated on the payment log id;
- voiding an offline payment writes a CREDIT_REVERSAL.

### 25. UserPlanChangeRequest

**Table:** `user_plan_change_request` (V498). Upgrade/downgrade intent keyed by payment log,
statuses PENDING_PAYMENT, SCHEDULED, APPLIED, FAILED, CANCELLED. See [plan-change.md](./plan-change.md).

### 26. WebHook

**Table:** `web_hook` (V1). Every incoming gateway webhook is stored here first (vendor,
payload, order_id, status, error_message) and can be replayed through
`/payments/webhook/reprocess/{id}`.

---

## Entity Relationship Diagram

```
SUBSCRIPTION TRACK
==================

PaymentOption (1) ----< PaymentPlan (N)
                              |
                              | (FK: plan_id)
                              v
                         UserPlan (N)
                          |   |   |
          (FK)            |   |   |         (FK)
  AppliedCouponDiscount --+   |   +-- EnrollInvite
          |                   |
          v                   v
     CouponCode          PaymentLog (N)
                              |
                              v
                     PaymentLogLineItem (N)


FEE MANAGEMENT TRACK
=====================

ComplexPaymentOption (CPO)
        |
        | (FK: cpo_id)
        v
    FeeType (N)
        |
        | (FK: fee_type_id)
        v
    AssignedFeeValue (1 per FeeType)
        |
        | (FK: assigned_fee_value_id)
        v
    AftInstallment (N)
        |
        | (generates)
        v
    StudentFeePayment (1 per installment per student)
        |          |
        |          +-----> StudentFeeAdjustmentHistory (audit chain)
        v
    StudentFeeAllocationLedger ----> PaymentLog (money source)


INVOICE
=======

Invoice (1) ----< InvoiceLineItem (N)
    |
    +----------< InvoicePaymentLogMapping (N) -----> PaymentLog
```

---

## Flows

### Flow 1: How a PaymentOption + Plans Get Created

**API:** `POST /admin-core-service/v1/payment-option`  
**Service:** `PaymentOptionService.savePaymentOption()`

1. Admin sends a `PaymentOptionDTO` with nested `PaymentPlanDTO[]`
2. A `PaymentOption` entity is created (name, type, source, etc.)
3. Each `PaymentPlanDTO` is saved as a `PaymentPlan` linked to the option
4. The option can be tagged as DEFAULT for a source via `make-default-payment-option`

```json
{
  "name": "Annual Subscription",
  "type": "SUBSCRIPTION",
  "source": "PACKAGE_SESSION",
  "sourceId": "<package-session-id>",
  "unit": "year",
  "requireApproval": false,
  "paymentPlans": [
    {
      "name": "Monthly",
      "actualPrice": 999,
      "elevatedPrice": 1499,
      "validityInDays": 30,
      "currency": "INR"
    },
    {
      "name": "Yearly",
      "actualPrice": 9999,
      "elevatedPrice": 14999,
      "validityInDays": 365,
      "currency": "INR"
    }
  ]
}
```

---

### Flow 2: How a User Gets Assigned a Plan (UserPlan creation)

**Service:** `UserPlanService.createUserPlan()`

1. User selects a `PaymentPlan` and initiates enrollment
2. A `UserPlan` is created with:
   - `user_id` = the student
   - `plan_id` = selected PaymentPlan
   - `payment_option_id` = parent PaymentOption
   - `status` = PENDING_FOR_PAYMENT (or ACTIVE if free/admin-assigned)
   - Snapshots of plan and option are stored in `plan_json` and `payment_option_json`
3. If a coupon was applied, `applied_coupon_discount_id` is set
4. A `PaymentLog` is created with status=INITIATED; once the gateway order exists it becomes
   status=ACTIVE, payment_status=PAYMENT_PENDING
5. User pays on the institute's gateway (Razorpay, Stripe, Cashfree, PhonePe or Eway; PayPal has
   no learner-side integration)
6. On successful payment callback (see [Flow 8](#flow-8-how-a-gateway-payment-is-confirmed-webhooks)):
   - `PaymentLog.status` -> SUCCESS, `payment_status` -> PAID
   - `UserPlan.status` -> ACTIVE
   - Invoice is generated
7. For **SUB_ORG** enrollments: `source` = "SUB_ORG", `sub_org_id` is set, but `user_id` still tracks the individual learner

**Strategy per payment option type** (`PaymentOptionOperationFactory`, endpoints
`/v1/learner/enroll` and `/v2/learner/enroll` for multi-course baskets):

| Type | UserPlan status at creation | Payment |
|------|-----------------------------|---------|
| FREE | ACTIVE | none |
| DONATION | ACTIVE | learner-chosen amount, optional |
| ONE_TIME | PENDING_FOR_PAYMENT | plan price minus coupon; a 100% coupon skips the gateway |
| SUBSCRIPTION | PENDING_FOR_PAYMENT | as ONE_TIME, plus an autopay mandate when the invite enables it |
| CPO | PENDING_FOR_PAYMENT (ACTIVE when no payment is requested) | generates the fee bills, then charges the installments due now (or a learner-chosen amount) as a `SCHOOL` payment |

Admin enrollment (`POST /v3/learner-management/assign`) bypasses these strategies and creates the
UserPlan as ACTIVE; for CPO it generates the bills itself. See [CPO_INSTALLMENTS.md](./CPO_INSTALLMENTS.md).

---

### Flow 3: How a CPO Gets Created

**API:** `POST /admin-core-service/v1/fee-management/cpo`  
**Service:** `FeeManagementService.createCpo()`

1. Admin sends a `ComplexPaymentOptionDTO` with nested fee types, values, and installments
2. System creates the full hierarchy in one transaction:

```
Step 1: Save ComplexPaymentOption
Step 2: For each FeeType in request:
   -> Save FeeType (linked to CPO)
   -> Save AssignedFeeValue (linked to FeeType) 
   -> For each installment:
      -> Save AftInstallment (linked to AssignedFeeValue)
Step 3: Link CPO to package sessions (via bridge table)
```

3. **Approval:** ADMINs get ACTIVE status immediately. Non-admins get PENDING_APPROVAL and need admin approval via `POST /fee-management/cpo/{cpoId}/approve`

**Example request:**
```json
{
  "name": "Class 10 Fee Structure 2025-26",
  "instituteId": "<institute-id>",
  "feeTypes": [
    {
      "name": "Tuition Fee",
      "code": "TUITION",
      "assignedFeeValue": {
        "amount": 50000,
        "originalAmount": 50000,
        "hasInstallment": true,
        "noOfInstallments": 4,
        "hasPenalty": true,
        "penaltyPercentage": 2.0,
        "installments": [
          { "installmentNumber": 1, "amount": 12500, "dueDate": "2025-07-01" },
          { "installmentNumber": 2, "amount": 12500, "dueDate": "2025-10-01" },
          { "installmentNumber": 3, "amount": 12500, "dueDate": "2026-01-01" },
          { "installmentNumber": 4, "amount": 12500, "dueDate": "2026-04-01" }
        ]
      }
    },
    {
      "name": "Lab Fee",
      "code": "LAB",
      "assignedFeeValue": {
        "amount": 5000,
        "originalAmount": 5000,
        "hasInstallment": false,
        "isRefundable": true
      }
    }
  ],
  "packageSessionLinks": [
    { "packageSessionId": "<class-10-session-id>" }
  ]
}
```

---

### Flow 4: How Fee Bills Get Generated for a Student

**Service:** `StudentFeePaymentGenerationService.generateFeeBills()`

When a student enrolls in a class that has a CPO assigned:

```
Input: userPlanId, cpoId, userId, instituteId

1. Fetch all FeeTypes for the CPO
2. For each FeeType:
   a. Fetch AssignedFeeValues
   b. For each AssignedFeeValue:
      - Fetch AftInstallments (ordered by installment number)
      - If installments exist:
          Create one StudentFeePayment per installment
          (amount = installment amount, dueDate = installment dueDate)
      - If no installments:
          Create one StudentFeePayment for the full amount
          (amount = AssignedFeeValue.amount, i_id = null, dueDate = today
           so the fee counts as due now)
3. All bills start with status=PENDING, amountPaid=0
4. Each bill posts a DEBIT_ACCRUAL to user_account_ledger
   (source_type = STUDENT_FEE_PAYMENT)
```

Callers: the CPO enrollment strategy (learner self-enroll), `BulkAssignmentService`
(admin enroll, see [CPO_INSTALLMENTS.md](./CPO_INSTALLMENTS.md)), `SchoolEnrollService`
(admissions) and product-page CPO enrollment. A template installment with a null `due_date`
fails generation.

**Example output for the CPO above:**

| StudentFeePayment | FeeType | Amount | Due Date | Status |
|---|---|---|---|---|
| sfp-1 | Tuition | 12,500 | 2025-07-01 | PENDING |
| sfp-2 | Tuition | 12,500 | 2025-10-01 | PENDING |
| sfp-3 | Tuition | 12,500 | 2026-01-01 | PENDING |
| sfp-4 | Tuition | 12,500 | 2026-04-01 | PENDING |
| sfp-5 | Lab | 5,000 | (enrollment date) | PENDING |

---

### Flow 5: How Payments Get Allocated to Fee Bills

There are two allocators. Which one runs depends on how the money arrived:

| Path | Allocator | Order |
|------|-----------|-------|
| Razorpay webhook for a `SCHOOL` payment (CPO checkout, learner pay-installments) | `FeeLedgerAllocationService.allocatePayment` | Unpaid bills by `due_date` ASC |
| Offline payment at admin enrollment, side-view "record offline payment", sub-org payments | `FeeLedgerAllocationService.allocatePaymentForNewLog` | Unpaid bills by `due_date` ASC |
| Admin "Pay installments" screen (`/v1/admin/student-fee/{userId}/allocate`, `/allocate-selected`) | `FeeAllocationEngine.allocate()` | Priority-aware, described below |

Gateway payments for `SCHOOL` bills are only allocated by the **Razorpay** webhook. Stripe,
PhonePe, Cashfree and Eway webhooks take the generic path, which marks the payment log PAID but
does not touch `student_fee_payment` (see [Known gaps](#known-gaps)).

**Priority-aware engine** (`FeeAllocationEngine.allocate()`, admin endpoints only):

```
1. PaymentLog is created (amount = what they paid)
2. Fetch all unpaid StudentFeePayments for the student
3. Determine allocation scope: OVERDUE_ONLY, UPCOMING_ONLY, or ALL_DUES
4. Sort bills:
   a. If InstituteFeeTypePriority is configured:
      -> Sort by priority_order ASC, then due_date ASC
   b. Otherwise (FIFO fallback):
      -> Sort by due_date ASC, then higher amount first
   c. Overdue bills always come before upcoming bills
5. For each bill in order:
   a. Compute amount_due = amount_expected + adjustments - amount_paid
   b. Allocate min(remaining_payment, amount_due)
   c. Update StudentFeePayment.amount_paid
   d. Set status to PAID or PARTIAL_PAID
   e. Create a StudentFeeAllocationLedger entry
6. Any leftover goes to PaymentLog.unallocated_amount
```

---

### Flow 6: How to Apply a Special Discount to a User

There are **three ways** to give a user a discount:

#### Method 1: Coupon Code Discount (Subscription Track)

Best for: one-off discounts for specific users at enrollment time.

1. **Create an AppliedCouponDiscount** with the discount rules:
   - `discountType`: "percentage" or "amount"
   - `discountPoint`: the value (e.g. 20 for 20%, or 500 for flat $500)
   - `maxDiscountPoint`: cap for percentage discounts
2. **Create a CouponCode** linked to the discount:
   - Set `isEmailRestricted = true` and `allowedEmailIds` to the user's email for user-specific coupons
   - Set `usageLimit = 1` for one-time use
3. User applies the coupon at checkout -> discount is applied to the PaymentPlan price
4. The `UserPlan` records the `applied_coupon_discount_id`

**API:** Use `CouponCodeController` endpoints.

#### Method 2: Fee Concession (Fee Management Track)

Best for: reducing a specific fee bill for a student (e.g. scholarship, hardship waiver).

1. Submit the adjustment: `PATCH /v1/admin/student-fee/adjustment/submit` with
   `adjustmentType` = CONCESSION or PENALTY, `amount`, `reason`.
   - A **PENALTY** is auto-approved.
   - A **CONCESSION** is recorded as SUBMITTED and waits for review.
2. Review it: `PATCH /adjustment/review` with APPROVED or REJECTED (admin UI:
   **Fee Management → Adjustment Approvals**). The submitter can withdraw it with
   `/adjustment/retract`.
3. The `AdjustmentResolver` computes the bill's due amount from approved adjustments:
   - `amount_due = amount_expected - concessions + penalties - amount_paid`
4. If an approved concession covers the full remaining amount, the status becomes WAIVED.
5. Every event is a `StudentFeeAdjustmentHistory` row chained by `previous_event_id`.

#### Method 2b: CPO discount at or after enrollment

For learners on a CPO, the admin can also discount the whole plan or individual installments
in the Enroll wizard or the student side view (`PUT /v1/fee-management/user-plan/{id}/cpo-discount`).
This rewrites `student_fee_payment.amount_expected` directly instead of going through approval.
See [CPO_INSTALLMENTS.md §4](./CPO_INSTALLMENTS.md).

#### Method 3: Referral Discount

Best for: viral growth -- existing users refer new users, both get benefits.

1. Configure a `ReferralOption` with discount rules for referrer and referee
2. Referrer shares their code
3. New user signs up with the referral code
4. `ReferralMapping` links the two users
5. `ReferralBenefitLogs` tracks benefit application
6. Benefits can have vesting periods (`referrerVestingDays`)

---

### Flow 7: How a Paid Live Session Gets Charged (V401)

Live classes reuse the legacy rails end-to-end — **no parallel payment system**. Both
convergence points from the System Overview apply: money lands in `PaymentLog`, the
receipt is an `Invoice`.

**Fee configuration (admin wizard Step 2):**
`Step2Service` -> `LiveSessionPaymentService.upsertPaymentConfig()` upserts a standard
`PaymentOption` with `source = LIVE_SESSION`, `source_id = <live_session.id>`,
`type = ONE_TIME`, holding exactly one `PaymentPlan` (price + currency). Disabling the
toggle soft-deletes the option — the session becomes free again and all legacy
behaviour is untouched.

**Purchase flow:**

```
1. Registrant submits the public form (or an authenticated learner hits the paywall)
   -> POST /admin-core-service/live-session/register-and-pay        (open, guests)
   -> POST /admin-core-service/live-sessions/v1/payment/register-and-pay (JWT, learners)
2. Backend guarantees an auth user for the payer (create-or-get via auth_service)
   -- invoices require user_id, and the invoice email goes to that user
3. SessionGuestRegistration row = the "bill" (live-session analogue of
   StudentFeePayment): payment_status PENDING, payment_amount/currency snapshot,
   plus FKs invoice_id + payment_log_id into the legacy tables
4. InvoiceService.createLiveSessionInvoice() raises a standard Invoice:
   source = LIVE_SESSION, source_id = registration id, one LIVE_SESSION line item,
   institute tax settings (INVOICE_SETTING), standard invoice numbering, PDF,
   ledger debit accrual (source type LIVE_SESSION)
5. Payer settles it on the existing open /pay/invoice/{invoiceId} page ->
   initiatePaymentForAdminInvoice(): PaymentLog created (user_id set,
   user_plan_id = null -- the same sanctioned null-UserPlan track that donations and
   admin invoices use), InvoicePaymentLogMapping links log -> invoice, institute's
   default gateway charges via the normal PaymentServiceFactory strategies
6. Gateway webhook marks the log PAID -> PaymentLogService.handlePostPaymentLogic
   -> markAdminInvoicePaidByPaymentLog(): invoice -> PAID, ledger credit,
   invoice email (force-sent for LIVE_SESSION regardless of the institute's
   sendInvoiceEmail opt-in), and the registration flips to payment_status = PAID
   (unlockLiveSessionRegistrationIfNeeded — same hook fires for offline
   "mark paid manually" settlements)
7. Join gating: LiveSessionJoinAuthorizer + the open guest endpoints refuse
   non-host joins on a paid session until a PAID registration exists
```

**Why no UserPlan:** `applyOperationsOnFirstPayment()` activates package-session
enrollment (SSIGM), which does not exist for a live class, and the UserPlan webhook
branch would generate a second USER_PLAN-source invoice. Live sessions therefore use
the established `user_plan = null` PaymentLog track (donations / admin invoices).

---

### Flow 8: How a Gateway Payment Is Confirmed (webhooks)

**Controller:** `WebHookController` at `/admin-core-service/payments/webhook/callback/{vendor}`

Every payload is saved to `web_hook` first, then verified and routed:

| Vendor | Routed payment types |
|--------|----------------------|
| Stripe | RENEWAL, PLAN_CHANGE, default |
| Razorpay | RENEWAL, **SCHOOL**, APPLICATION_FEE, PLAN_CHANGE, default |
| PhonePe | default only |
| Cashfree | default only |
| Eway | no webhook; `EwayPoolingService` polls every 30 s; initial, renewal, plan change |

The payment type comes from the order's notes/metadata (`PaymentType`: INITIAL, RENEWAL, SCHOOL,
APPLICATION_FEE, AI_CREDIT_PACK, PLAN_CHANGE).

**Default path** (`PaymentLogService.updatePaymentLogsByOrderId`): finds the payment log by
`order_id`, claims it atomically (`markPaidIfNotAlready`), then `handlePostPaymentLogic`:
- **FAILED:** only `payment_status` changes; `status` stays ACTIVE.
- **No UserPlan:** an admin invoice or live session (`markAdminInvoicePaidByPaymentLog`), or a
  donation confirmation.
- **Otherwise:** ledger credit, `applyOperationsOnFirstPayment` (plan ACTIVE, learner INVITED →
  ACTIVE, seat inventory, referral benefits), invoice, PAYMENT_SUCCESS workflow and emails.

**SCHOOL path** (Razorpay only, `RazorpayWebHookService.handleSchoolPayment`): claim, mark
PAID, allocate to fee bills by due date, ledger credit, UserPlan ACTIVE, school receipt, invoice.

---

### Flow 9: Regional (Country-Based) Pricing (V585)

A `PaymentOption` can price its plans by the viewer's country. Code: `features/regional_pricing/`.

**Tables:** `payment_option.regional_pricing_enabled` + `regional_pricing_currencies` (switch and
auto-priced currency list), `payment_plan_regional_price` (one row per plan × currency × optional
country, `price_source` AUTO | MANUAL), `fx_rate` (daily USD-based rates), and
`user_plan.regional_price / regional_currency / regional_country` (the price lock).

**Admin setup** (`/v1/regional-pricing`):
1. `PUT /payment-option/{id}/settings` `{enabled: true, currencies: ["USD","GBP","AED"]}` creates an
   AUTO row per paid plan per currency: base price × exchange rate, rounded up to a clean price
   (11.87 → 11.99, 437 → 439, 4,321 → 4,399).
2. `PUT /price` sets a MANUAL price (per currency, or for one country, e.g. NP → NPR 1,200), or adds a
   country as AUTO with `auto: true`. `POST /price/{id}/reset-to-auto` hands it back to the system.
3. Editing a plan's base price recomputes its AUTO rows immediately and flags MANUAL rows
   `needs_review` (`POST /price/{id}/mark-reviewed` to keep them). MANUAL rows are never overwritten.
4. `FxRateRefreshJob` (01:15 daily, ShedLock) fetches rates and moves an AUTO price only when it has
   drifted more than `regional.pricing.auto-drift-threshold` (5%). `POST /payment-option/{id}/refresh`
   forces it.

**Learner flow:**
```
1. Country = Cloudflare CF-IPCountry header (CloudFront-Viewer-Country also read). No geo-IP lookup.
2. Public reads (open enroll-invite GET, open product-page by-code) swap each plan's
   actual/elevated price + currency for the regional one and keep the base in
   base_actual_price / base_currency / pricing_country.
   Lookup: exact-country row → currency-wide row for the country's currency → base price.
   Rows in a currency the invite's gateway cannot charge (PhonePe/Cashfree = INR, eWay = AUD/NZD) are skipped.
3. Checkout re-resolves the price server-side (never trusts the client), locks it on the UserPlan,
   and charges that amount in that currency. Coupon amounts (base currency) are scaled by
   regional ÷ base price.
4. Renewals (auto + manual), invoices, ledger accrual, mandate max amount and discount line items
   all read the lock (RegionalPriceLock), so a USD buyer keeps paying USD.
```

**Out of scope / rules:** CPO fees, sub-org seats, live sessions and admin-side enrolments stay on base
price. Product pages with basket pricing or offers stay on base price. Multi-course carts (product page
and v2 multi-package) are all-or-nothing: if any item would not price in the same regional currency,
the whole order uses base prices. Plan change is not offered on a regionally priced membership.

---

## API Reference

All endpoints are prefixed with `/admin-core-service`.

### Payment Option APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/payment-option` | Create payment option with plans |
| POST | `/v1/payment-option/get-payment-options` | List with filters (excludes CPO mirrors by default) |
| POST | `/v1/payment-option/make-default-payment-option` | Set default option |
| DELETE | `/v1/payment-option` | Soft delete |
| PUT | `/v1/payment-option` | Edit option + plans |
| GET | `/v1/payment-option/default-payment-option` | Get default |

### UserPlan APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/user-plan/{id}/with-payment-logs` | Plan + payment history |
| POST | `/v1/user-plan/all` | List with pagination + filters |
| POST | `/v1/user-plan/payment-logs` | Payment logs (Manage Payments page) |
| PUT | `/v1/user-plan/status` | Bulk status update |
| PUT | `/v1/user-plan/{id}/cancel` | Cancel enrollment |
| POST | `/v1/user-plan/membership-details` | Membership info |
| GET / POST | `/v1/user-plan/{id}/change-options`, `/change-plan` | Admin plan change (see `plan-change.md`) |

### Enrollment APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/learner/enroll` | Learner self-enroll for one course |
| POST | `/v2/learner/enroll` | Learner self-enroll for several courses in one payment |
| POST | `/v3/learner-management/assign` | Admin enroll (Enroll wizard), supports `dry_run` and `cpo_config` |

### Fee Management APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/fee-management/cpo` | Create CPO with full hierarchy |
| GET | `/v1/fee-management/cpo/{instituteId}` | List CPOs |
| GET | `/v1/fee-management/cpo/{cpoId}/full` | Full CPO with installments |
| PUT | `/v1/fee-management/cpo/{cpoId}` | Update CPO metadata |
| PUT | `/v1/fee-management/fee-type/{feeTypeId}` | Update fee type + commercials |
| PUT | `/v1/fee-management/cpo/{cpoId}/soft-delete` | Soft delete |
| POST | `/v1/fee-management/cpo/{cpoId}/approve` | Approve pending CPO |
| GET | `/v1/fee-management/package-session/{id}/cpo-options` | CPOs for a class |
| PUT | `/v1/enroll-invite/{id}/assign-cpo` | Attach a CPO (its mirror) to an invite |

### Per-learner CPO APIs (admin side view)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/fee-management/user/{userId}/cpo-user-plans` | The learner's CPO plans with totals |
| GET | `/v1/fee-management/user-plan/{userPlanId}/installments` | Installment rows + discount snapshot |
| PUT | `/v1/fee-management/installments/{sfpId}` | Edit one installment (dates, amount, discount) |
| POST | `/v1/fee-management/installments/{sfpId}/split` | Split an installment in two |
| PUT | `/v1/fee-management/user-plan/{userPlanId}/cpo-discount` | Whole-plan discount |
| POST | `/v1/fee-management/user-plan/{userPlanId}/record-offline-payment` | Record an offline payment, allocated by due date |

### Fee Tracking APIs (admin Fee Management pages)

Base `/v1/admin/student-fee`: `/{userId}/dues`, `/{userId}/allocate`, `/{userId}/allocate-selected`,
`/adjustment/{submit,review,retract,history,pending}`, `/search`, `/dashboard/collection`,
`/priority` (GET/PUT), `/{userId}/generate-invoice`, receipts.

### Learner fee APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/learner/v1/fee/my-dues`, `/my-receipts` | Authenticated learner's dues and receipts (no screen uses them) |
| POST | `/learner/v1/fee/pay-installments` | Authenticated learner pays installments (Razorpay `SCHOOL`; no screen uses it) |
| GET | `/open/v1/fee/cpo-schedule` | Template schedule for an invite's CPO (checkout) |
| GET | `/open/v1/fee/cpo-dues` | Unpaid installments for a plan (checkout) |
| POST | `/open/v1/fee/cpo-pay-installments` | Pay chosen installments (checkout) |

### Invoice APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/invoices/{id}` | Get invoice |
| GET | `/v1/invoices/user/{userId}` | User's invoices, merged with unpaid fee bills |
| GET | `/v1/invoices/{id}/download` | Download PDF |
| GET | `/v1/invoices/institute/{id}` | Institute invoices (paginated; no admin page uses it) |
| POST | `/v1/invoices/admin/create`, `/admin/preview` | Admin manual invoice with a `/pay/invoice/{id}` link |
| POST | `/v1/invoices/{id}/mark-paid-manual`, `/{id}/reject` | Settle or reject an admin invoice |

### Gateway and webhook APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET / POST / PUT / DELETE | `/v1/institute/payment-gateways` | Institute gateway credentials |
| POST | `/payments/webhook/callback/{stripe,razorpay,phonepe,cashfree}` | Gateway webhooks |
| POST | `/payments/webhook/reprocess/{id}` | Replay a stored webhook |

---

## Statuses & Enums

### UserPlan Statuses
| Status | Meaning |
|--------|---------|
| `ACTIVE` | Plan is live and usable |
| `PENDING` | Awaiting admin approval, or a stacked plan waiting for the current one to end |
| `PENDING_FOR_PAYMENT` | Awaiting payment |
| `PAYMENT_FAILED` | Payment attempt failed |
| `CANCELED` | User/admin canceled |
| `EXPIRED` | Past validity period |
| `TERMINATED` | Force-ended by admin |

### PaymentLog Statuses

`status` is the record lifecycle; `payment_status` is the money outcome. Read both.

| `status` | Meaning |
|----------|---------|
| `INITIATED` | Row created, no gateway order yet |
| `ACTIVE` | Gateway order created; also used for offline payments recorded as PAID |
| `SUCCESS` | Confirmed paid by a webhook |
| `FAILED` | Failed |

| `payment_status` | Meaning |
|------------------|---------|
| `PAYMENT_PENDING` | Waiting for the gateway |
| `PAID` | Money received (gateway or offline) |
| `FAILED` | Gateway reported failure |
| `ABANDONED` | Learner never completed checkout |
| `VOIDED` | Offline payment voided by an admin; its allocations and ledger credit are reversed |

### StudentFeePayment Statuses
| Status | Meaning |
|--------|---------|
| `PENDING` | Not yet paid |
| `PARTIAL_PAID` | Some amount paid |
| `PAID` | Fully paid |
| `WAIVED` | Concession covers full amount |
| `OVERDUE` | Display only. Screens compute it from `due_date`; no job writes it |

### CPO Statuses
| Status | Meaning |
|--------|---------|
| `ACTIVE` | Ready for use |
| `PENDING_APPROVAL` | Needs admin approval |
| `DELETED` | Soft deleted |

### Invoice Statuses
`GENERATED`, `PENDING_PAYMENT`, `PAID`, `REJECTED`

### PaymentOption Types
`SUBSCRIPTION`, `ONE_TIME`, `FREE`, `DONATION`, `CPO` (mirror of a ComplexPaymentOption)

### Allocation Scopes
`OVERDUE_ONLY`, `UPCOMING_ONLY`, `ALL_DUES`

### Adjustment Types
`CONCESSION` (reduces amount, needs review), `PENALTY` (increases amount, auto-approved)

### Allocation Types (Ledger)
`INSTALLMENT_PAYMENT`, `ADVANCE_ROLLOVER`, `REFUND`, `BOUNCE_REVERSAL`

### Payment Gateways
`RAZORPAY`, `STRIPE`, `CASHFREE`, `PHONEPE`, `EWAY` (configurable per institute), `PAYPAL` (enum
value only, no integration in the learner app), `MANUAL` (offline payments; no gateway strategy)

---

## Scheduled Jobs

All in `PackageSessionScheduler` unless noted.

| When | What | Gate |
|------|------|------|
| 04:00 | Renewal / expiry policy sweep | `PAYMENT_SETTING.packageSessionRenewalSchedulerEnabled` |
| 04:30 | Log paid plans with no enrollment (report only) | — |
| 09:00 | `MEMBERSHIP_EXPIRY` workflow reminder, 7 days before expiry | — |
| 15:00 IST | Autopay renewal charges (`RenewalChargeService`) | `autopayChargeSchedulerEnabled` |
| every 30 s | Eway payment polling (`EwayPoolingService`) | — |
| every 15 min | Workflow engine; fee reminders run as a workflow (7/3/0/−3 days around due date) | per-institute workflow |

There is no job that writes OVERDUE on fee bills and no gateway reconciliation job.

---

## Known gaps

Behaviour that differs from what a reader would assume. Checked on 2026-10-14.

1. **CPO installment payments are only allocated on Razorpay.** Only the Razorpay webhook routes
   `SCHOOL` payments. On other gateways the payment log is marked PAID but the fee bills stay
   unpaid.
2. **No refund flow.** Admin "void" only works on MANUAL/offline payments.
3. **Fee-type priority is ignored for gateway and offline payments** (see Flow 5).
4. **OVERDUE is never stored** on `student_fee_payment`.
5. **Learners have no post-enrollment dues screen.** The learner app calls the installment
   payment APIs only inside enrollment checkout.
6. **Admin enrollment is not transactional per learner.** A failure in CPO side effects leaves
   the UserPlan and any created bills in place while the row is reported FAILED.
7. **Paying an admin invoice does not settle fee bills.** An invoice raised for an installment
    amount marks the invoice PAID but leaves `student_fee_payment` unpaid.
8. **Parent portal "Pay Now" is broken for CPO installments.** Unpaid bills are listed with a
    placeholder id `sfp:<id>`, which `/pay/invoice/{id}` cannot load.
9. **Fee reminders have no pay link and nothing is seeded.** An institute must build the
    workflow itself (V162 is a no-op).

For the full picture of how a later installment can be paid today, see
[CPO_FLEXIBLE_INSTALLMENTS.md §8](./CPO_FLEXIBLE_INSTALLMENTS.md#8-paying-later-installments-what-exists-today).
