# Payment Management

A professional payment management page for tracking and managing institute payment logs.

## Features

### 📊 KPI cards (`PaymentKpiCards`)

Five tiles, amount-first, shared verbatim with the Payment Dashboard so both screens report the
same numbers. They answer two different questions and are deliberately kept apart:

**Balances — "how much are we owed?"** (server: `/payment-logs/billing-summary`)

-   **Collected**: PAID payment logs in the window (enrolment and invoice payments).
-   **Due**: overdue right now. A learner owes money only when they have been **granted access**
    and an obligation on it is unpaid — a CPO instalment past its due date, a subscription whose
    period ended and whose renewal failed, an unpaid admin invoice.
-   **Upcoming**: the same obligations falling due within the next 30 days
    (`payments.due.upcoming-days`). Expected, not yet owed. Informational — not a filter.

What is _never_ due: a `PENDING_FOR_PAYMENT` plan (a checkout the learner never finished — no
access, no debt), a one-time purchase (paid, or not enrolled — there is nothing to bill), the
coupon discount on a paid plan, and anything on a cancelled / terminated / expired enrolment. The
previous model (plan list price minus payments) counted all four; on ShikshaNation it reported
₹11 lakh due of which ₹5.9 lakh was abandoned carts and ₹2.5 lakh was coupon discounts.

A live, priced one-time plan with **no payment recorded** (an admin activated it by hand) is
reported as a hygiene count under the Due tile rather than billed — it may be an offline payment
nobody recorded or a free grant.

**Transactions — "which checkouts didn't complete?"** (client-side, from the rows in view)

-   **Payment pending**: `PAYMENT_PENDING` / `NOT_INITIATED` rows young enough to still complete.
-   **Failed**: attempts the gateway declined.
-   **Abandoned** (segment only): `PAYMENT_PENDING` rows older than
    `payments.pending.abandoned-after-hours` (24 h). The server reports them as `ABANDONED`;
    gateway orders expire long before that, so nothing can still complete. Not money in flight,
    not money owed — a warm-lead list for counsellors.

The one intended overlap: a failed subscription renewal is both a Failed transaction and a Due
balance. That is correct — the attempt bounced, and the learner still has access and still owes.

Each record tile is also the status filter for the table below. The filtering happens client-side
(`classifyEntry`), because the API's `payment_status IN (…)` can never return the NULL-status rows
that make up part of "Pending". Due opens the Due learners list instead.

### 🔍 Filtering

#### Date range (`DateRangeDropdown`, toolbar)

A single dropdown at the top of the page — Today / Yesterday / Last 7·30·90 days / This month /
Last month / All time, plus a custom two-date calendar. Presets are cut on local day boundaries and
sent to the API as UTC instants (`-utils/dateRange.ts`). The Payment Dashboard uses the same
control, so a window means the same thing on both screens.

#### Free-text search (toolbar)

Matches a payment when ANY of these hit: the payer (name / email / phone, resolved to user ids via
the auth service), the amount, the **invoice number** of an invoice covering the payment, or the
**payment plan** name. Debounced 400ms and resolved entirely server-side, so it works across the
whole result set rather than the loaded page.

The two subquery predicates are guarded by `:noSearchFilter = false`, so Postgres constant-folds
them away when nobody is searching — an unsearched listing plans and costs exactly what it did
before (verified with EXPLAIN: neither `invoice` nor `payment_plan` appears in the plan). While
searching, both are index-driven (`idx_invoice_payment_log_mapping_payment_log_id`, and the
`payment_plan` primary key) and evaluated only over rows that already passed the institute, date
and status filters.

#### Slide-over filters

-   **Payment Type**, **Plan Status**, **Payment Source**, **Course / Session**
-   Payment status and the date window are deliberately _not_ here — they live in the toolbar

### 📋 Payment Logs Table

Displays detailed payment information with the following columns:

-   **Date & Time**: Transaction date with relative time display
-   **User**: Full name and email of the user
-   **Amount**: Formatted currency amount
-   **Payment Status**: Current status with color-coded badges
-   **Payment Method**: Payment vendor information
-   **Plan Status**: User plan status
-   **Course/Membership**: Enroll invite name and code
-   **Invoice**: Invoice number issued for the payment, with an inline PDF preview
-   **Transaction ID**: Payment transaction reference
-   **Tracking ID / Tracking Source / Order Status / Actions**: physical-order tracking (hidden by default)
-   **Payment Plan**: Plan name and validity period

#### Column layout (`ManageColumnsPopover`)

Every column except **Date & Time** and **Amount** can be switched off — those two are the row,
so their checkbox is ticked and disabled. Columns can also be **dragged into a different order**,
either by the grip in the Manage Column popover or by the grip on the column header itself
(`MyTable`'s opt-in `enableColumnReorder`).

Both choices are per-browser localStorage (`manage-payments:hidden-columns`,
`manage-payments:column-order`) and are reconciled against the columns that actually exist, so a
newly shipped column lands in its natural place rather than at the end of a saved layout, and a
column that only some institutes have (Organization Name) doesn't disturb the rest.

#### Invoice column

The invoice number is **not** part of the payment-logs response. It is resolved for the ~20 rows
on screen via `POST /v1/invoices/by-payment-logs?instituteId=…`, which reads the
`invoice_payment_log_mapping` table the invoice itself was built from — so the number shown is the
one the learner was actually issued, never inferred from amounts or dates. Payment logs with no
invoice render a dash; a voided (REJECTED) invoice renders struck through.

The lookup deliberately returns no PDF URL: presigning is one media-service round trip per file,
so it happens lazily when someone clicks preview (`InvoicePreviewByIdDialog` → the invoice detail
endpoint → the shared `InvoicePreviewDialog`, which renders the real stored PDF). The query is
skipped entirely while the column is hidden, and a failed lookup degrades to dashes rather than
taking the table down.

**Backend-version fallback.** The dashboard and admin_core_service deploy separately, and a local
dev server points at stage by default — so a build routinely runs against a backend that predates
the bulk endpoint. `resolvePaymentLogInvoices` therefore tries the bulk lookup first and, on any
failure, falls back to the long-standing `GET /v1/invoices/user/{userId}?instituteId=…` (one
request per distinct learner on the page), joining on the same `payment_log_ids` the invoice
carries. The number rendered is identical either way; only the request count differs, and the fast
path resumes automatically once the backend ships.

**Raised-but-unpaid invoices are rows too.** Creating an invoice does NOT create a payment log —
one only appears when the learner initiates payment — so an invoice an admin raised used to be
invisible on this screen entirely. The combined listing query therefore has a third UNION arm that
emits such invoices by invoice id, discriminated by a `row_type` column
(`CombinedPaymentRowProjection`). The service loads both kinds, resolves users for both in one
call, and re-emits them in the query's `created_at DESC` order.

These rows carry their invoice inline (`invoice` on the entry), so the Invoice column renders
without any lookup — and the bulk lookup deliberately skips them. They have no `user_plan`, so
every consumer must stay optional-chained (`PaymentDetailSheet` and `resolveEntryCurrency` already
are).

A voided (`REJECTED`) invoice is shown struck through with a `CANCELLED` status and is excluded
from every total by `isCancelledEntry` — cancelled money is neither collected nor owed.

**KPI impact.** Unpaid (non-voided) invoices are also added to the billed side of the billing
summary via a `billed_invoices` CTE, so Total and Due finally include invoice obligations, which
carry no `user_plan` and were previously owed by nobody. Measured on HCCA: Due ₹69,840 → ₹146,440,
Total ₹133,840 → ₹210,440. The rise is smaller than the ₹103,600 raw invoice total because due is
netted per learner — an over-payment elsewhere absorbs part of a new obligation, which is this
query's long-standing (documented) behaviour.

**Still not counted:** an invoice that is only PARTIALLY paid. Its payment logs make it visible as
rows, but its obligation is in neither `billed_plans` (no user_plan) nor `billed_invoices` (it has
payment logs). Widening that would risk double-counting against the `paid` CTE, so it was left
alone deliberately.

### ⬇️ Export (toolbar dropdown)

-   **Payments (CSV)** — the payment records matching the current tile and filters.
-   **Invoices (ZIP)** — every invoice PDF issued in the toolbar's date window (by invoice date;
    the other filters don't apply), plus an `invoices.csv` manifest
    (`GET /v1/invoices/institute/{id}/bulk-download`, `InvoiceBulkExportService`).
    -   Voided (`REJECTED`) invoices are left out.
    -   One invoice per payment: where a payment was invoiced more than once (concurrent
        generation), the **first-issued** invoice is kept and the extras are listed in the
        manifest as "duplicate of …", not packed.
    -   A missing PDF is regenerated on the fly; one that still can't be produced is listed in the
        manifest instead of failing the whole archive.
    -   Capped at 1,000 invoices per download — a longer period is refused with a message to pick
        a shorter range.

### 🔄 Pagination

-   Configurable page size (default: 20 records per page)
-   Page navigation controls
-   Record count display

## API Integration

### Endpoint

```
POST /admin-core-service/v1/user-plan/payment-logs?pageNo={page}&pageSize={size}
```

### Request Payload

```typescript
{
  institute_id: string;
  start_date_in_utc?: string;
  end_date_in_utc?: string;
  payment_statuses?: string[];
  user_plan_statuses?: string[];
  enroll_invite_ids?: string[];
  package_session_ids?: string[];
  sort_columns?: Record<string, string>;
}
```

### Response

-   Paginated list of payment logs with comprehensive data:
    -   `payment_log`: Core payment transaction details
    -   `user_plan`: Associated user plan with nested `enroll_invite`, `payment_option`, and `payment_plan_dto`
    -   `user`: Complete user profile information
    -   `current_payment_status`: Derived payment status from reconciliation logic

## Components

### Main Page: `index.tsx`

-   State management for filters and pagination
-   API data fetching with React Query
-   Statistics calculation
-   Layout and composition

### `PaymentFilters.tsx`

-   Filter controls UI
-   Quick filter buttons
-   Date range inputs
-   Status multi-select dropdowns

### `PaymentLogsTable.tsx`

-   Table rendering with TanStack Table
-   Column definitions
-   Empty states and error handling
-   Pagination controls

## Services

### `payment-logs.ts`

-   API call wrapper
-   React Query integration
-   Request/response type safety

## Types

### `payment-logs.ts`

-   `PaymentLog`: Payment record structure with transaction details
-   `UserPlan`: Associated user plan data with nested objects
-   `EnrollInvite`: Course/membership enrollment details
-   `PaymentOption`: Payment option configuration
-   `PaymentPlanDto`: Payment plan details with pricing
-   `User`: Complete user profile information
-   `PaymentLogEntry`: Combined log entry with all related data
-   `PaymentLogsRequest`: API request payload with filters
-   `PaymentLogsResponse`: Paginated API response

## Usage

Navigate to `/manage-payments` to access the payment management interface.

The page automatically:

1. Fetches institute details for package session mapping
2. Loads payment logs with default sorting (createdAt DESC)
3. Calculates real-time statistics from filtered data
4. Updates on filter changes with automatic pagination reset

## Future Enhancements

Potential improvements:

-   Payment receipt generation
-   Refund processing
-   Advanced analytics and charts
-   Bulk operations
-   Email notifications for failed payments
-   Payment reconciliation reports
