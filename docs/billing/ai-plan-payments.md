# AI plan payments: operator runbook

Covers paid AI plan subscriptions (Razorpay Payment Links, UPI Autopay and card e-mandates on the **platform** Razorpay account), GST tax invoices and credit notes, and the self-serve "Plan & billing" storefront in the institute admin. AI credit packs share the same webhook, invoice and refund pipeline, so this runbook covers them where the shared parts changed.

Everything is **dark by default**. With every flag at its default, credit-pack purchase, webhook, invoice and email behaviour is the same as before, apart from the pure safety fixes listed in section 1.3. MANUAL and COMPLIMENTARY subscriptions behave exactly as in V588.

Last written 2026-10-16 against migration `V590__ai_plan_payments_storefront.sql` and the build contracts M/A/B/W/I. If an endpoint path, flag key or column name here doesn't match the shipped code, the code wins; fix this page in the same PR.

Contents

1. [How it fits together](#1-how-it-fits-together)
2. [Flags and per-institute switches](#2-flags-and-per-institute-switches)
3. [Brand modes: what each mode shows](#3-brand-modes-what-each-mode-shows)
4. [Prerequisites before any flag is turned on](#4-prerequisites-before-any-flag-is-turned-on)
5. [Razorpay dashboard setup (platform account)](#5-razorpay-dashboard-setup-platform-account)
6. [Rollout order](#6-rollout-order)
7. [Test-mode probe](#7-test-mode-probe)
8. [The renewal lifecycle (what happens when)](#8-the-renewal-lifecycle-what-happens-when)
9. [Reconciliation](#9-reconciliation)
10. [Refunds, credit notes, waivers, offline payments](#10-refunds-credit-notes-waivers-offline-payments)
11. [Incident playbooks](#11-incident-playbooks)
12. [Accepted risks and things not yet verified](#12-accepted-risks-and-things-not-yet-verified)

---

## 1. How it fits together

| Piece | Owns | Where |
|---|---|---|
| ai_service | Plan catalogue and eligibility, subscription state, charges (`ai_subscription_charge`), mandates (`ai_subscription_mandate`) state, the engine gate (benefits only for a PAID period), the hourly roll (`_roll_payment()` for `source=PAYMENT`) | `/ai-service/internal/plans/v1/**` (internal token only) |
| admin_core | The only tenant entry point (`requireInstituteAdmin`, no root bypass), Razorpay calls on the platform account, the platform webhook, `platform_payment`, tax, GST invoices and credit notes, billing emails, the billing/reconcile jobs | `/admin-core-service/ai-plans/v1/**` (tenant), `/admin-core-service/super-admin/v1/ai-plans-billing/institutes/{iid}/**` (staff money actions and documents; `/super-admin/v1/platform-billing/**` keeps the existing config endpoints), `/admin-core-service/payments/webhook/callback/razorpay-platform` (webhook) |
| Super-admin portal (vacademy-health-check) | Plans, versions, listing, audience, PAYMENT assignment, billing timeline, mark paid / waive / refund / resend link / cancel mandate, platform settings | Plans pages + Platform settings |
| Admin dashboard | AI Settings → "Plan & billing" (catalogue, checkout, manage, invoices) | Shown only when the server says the storefront is on for this institute |

Money path for one charge:

```
ai_service: charge DUE  ──(admin_core creates link or schedules a mandate debit)──>  LINK_SENT | DEBIT_SCHEDULED
Razorpay:   payment.captured  ──webhook──>  admin_core
admin_core: lock platform_payment FOR UPDATE ─> amount == server-side total snapshot?
            ─> POST ai_service /charges/{id}/paid   (locks charge FOR UPDATE + xact lock; amount must equal total_minor)
            ─> only after that succeeds: platform_payment = PAID
            ─> GST invoice (series v2, tax from the payment snapshot) ─> email (brand by brand_mode)
```

Every webhook path is idempotent. A failed downstream call returns 500 so Razorpay retries; nothing is marked PAID before the downstream step succeeds. Duplicate and late payments are not 500s: they get a `disposition` (DUPLICATE or LATE) and an automatic refund (section 10.3). Two refusals are neither retried nor refunded: `VENDOR_PAYMENT_REUSED` (the Razorpay payment already settled another charge) and `TOTAL_NOT_SET` (the charge lost its tax snapshot). The webhook answers 200, the payment stays unpaid with a `subscriptionHeld` note, and Sentry alerts ("payment held"); staff resolve it by hand. A 500 loop there would get the shared platform webhook disabled, packs included.

### 1.1 Data you will look at

| Table | What it is |
|---|---|
| `platform_payment` | One per Razorpay order or link on the platform account. New in V590: buyer snapshot (`buyer_legal_name`, `buyer_gstin`, `buyer_state_code`, `buyer_address`, `place_of_supply`, `tax_head`), `brand_mode`, `disposition` (NORMAL/DUPLICATE/LATE), `refund_requested_at`, `refunded_amount_minor` (cumulative) and `link_expires_at`. The existing `base_amount_minor` / `tax_amount_minor` / `total_amount_minor` are the server-side amount snapshot. Partial UNIQUE index `ux_platform_payment_vendor_payment` on `vendor_payment_id`. |
| `platform_payment_item` | `item_kind` CREDIT_PACK or AI_SUBSCRIPTION; `pack_id` is now nullable (required for CREDIT_PACK by a CHECK), `subscription_charge_id`, `description_snapshot`. |
| `platform_billing_profile` | The buyer's GST identity per institute (legal name, GSTIN, state, address, billing email). `institutes.gstin` / `institutes.state_code` are no longer written by billing. |
| `platform_invoice`, `platform_credit_note` | Tax invoices (new columns `source_kind`, `series_key`, `fy`, `service_period_start/end`, `issued_at_tz`, `brand_mode`) and credit notes (`credit_note_number` ≤ 16 characters, `invoice_id`, `vendor_refund_id` unique, `total_amount_minor`). Numbers `VT/{FY}/I#####` and `VT/{FY}/C#####` from `platform_document_sequence(series_key, fy, next_no)`, FY in Asia/Kolkata (`2627` = Apr 2026 to Mar 2027). Legacy invoices keep `INV-AICRED-yyyymm-nnnn`. |
| `ai_subscription_charge` | Every amount owed: `kind` PERIOD or UPGRADE, service window, `base_minor` / `tax_minor` / `total_minor`, `place_of_supply` and `tax_head` frozen when admin_core prices it, status DUE → LINK_SENT / DEBIT_SCHEDULED → PAID (or FAILED / VOID / REFUNDED / PARTIALLY_REFUNDED). `period_id` stays NULL until paid. |
| `ai_subscription_mandate` | One autopay mandate: Razorpay customer + token, method UPI / CARD / EMANDATE, `max_amount_minor`, status PENDING → ACTIVE (or REJECTED / PAUSED / CANCELLED / EXPIRED). |
| `ai_storefront_institute` | Per-institute: `storefront_enabled` (NULL = the mode decides, TRUE = allow-listed, FALSE = never), `brand_mode_override` (VACADEMY / NEUTRAL / NULL = auto), `reason`. Super-admin written only. |
| `ai_storefront_audience` | INCLUDE / EXCLUDE rows for an institute or a `segment_key`, optionally for one plan (`plan_id` NULL = access to the storefront). EXCLUDE wins. |
| `ai_institute_segment` | Hand-filled institute → segment keys used by SEGMENTS mode and `audience_mode = SEGMENT`. |
| `ai_platform_settings` | The global flags in section 2. |

### 1.2 Subscription states (source PAYMENT)

```
checkout ─> PENDING ──(first charge PAID)──> ACTIVE ──(renewal PAID)──> ACTIVE
                │                              │
                └─(link expired, unpaid)─> EXPIRED (never live)
                                               ├─(period start reached, renewal unpaid)─> GRACE ──(paid)──> ACTIVE
                                               │                                           └─(7 days, unpaid)─> EXPIRED
                                               └─(cancel at period end)─> CANCELLED
```

- A PAYMENT subscription gives plan benefits **only for a PAID period**. Anything else is billed from credits as if there were no plan (grace behaviour CHARGED).
- Periods are created when paid, never in advance. The roll creates charges, not periods.
- `billing.plans.enabled = false` does **not** strip benefits from live PAYMENT subscriptions: paying customers keep what they paid for.

### 1.3 What changed for credit packs even with every flag off

These are bug fixes, each covered by tests showing the happy path is unchanged:

- Credits are granted **before** the payment is marked PAID, with retry (a failed grant used to leave PAID with no credits).
- Row lock on `platform_payment` during fulfilment, so `payment.captured` and `order.paid` arriving together can't fulfil twice.
- Invoice list no longer 500s on a pack-less item.
- The PDF PAID badge follows the real payment status.
- Pack payment links now have `expire_by` = 48 h.
- `return_url` must be a Vacademy-owned host or one of the institute's own `institute_domain_routing` domains.
- Partial refunds are compared cumulatively.
- Refunds of duplicate or late payments can't touch the wrong charge or invoice.
- `vendor_payment_id` is unique.

---

## 2. Flags and per-institute switches

Global flags live in `ai_platform_settings` and are edited in the super-admin portal under Platform settings. Admin_core reads the same table directly. ai_service caches settings for 30 s per replica (`CACHE_TTL_SECONDS`), and admin_core's `PlatformBillingFlags` caches them for 30 s too. Allow a minute for a change to apply everywhere. No deploy is needed.

| Key | Default | What it does | Turning it on | Turning it off |
|---|---|---|---|---|
| `billing.plans.enabled` | `false` | The plan engine switch (V588). | Required before any PAYMENT plan is sold. | Does **not** remove benefits from live PAYMENT subscriptions (critique #9). It still hides the storefront and stops new checkouts. |
| `billing.plans.roll.enabled` | `true` | The hourly `AiPlansRollJob`: renewals, charges, GRACE and EXPIRED. Now also selects PENDING rows. | Leave on. | Renewals, grace and expiry stop moving. The engine gate still blocks unpaid benefits. Use only in an incident. |
| `billing.subscriptions.payments.enabled` | `false` | Master switch for `source=PAYMENT`: portal PAYMENT assignment, checkout, links, debits, the webhook's AI_SUBSCRIPTION branch acting on new money. | Section 6 step 3. | No new links or debits are created. Webhooks for payments already in flight are still honoured: a captured payment is always fulfilled or refunded, never dropped. |
| `billing.autopay.enabled` | `false` | Offer UPI Autopay / card e-mandate at checkout (opt-in, default ON when the method supports it and the price is within ₹15,000 per debit), and let the renewal job charge active tokens. | Section 6 step 5, after Recurring Payments is live on the Razorpay account. | No new mandates and no new debits. Existing mandates stay registered, and renewals fall back to payment links. Already scheduled debits that Razorpay has notified may still go through; they are fulfilled normally. |
| `billing.storefront.mode` | `OFF` | `OFF` / `ALLOWLIST` / `SEGMENTS` / `ALL`. Whether the tenant storefront exists for an institute. Every tenant endpoint returns 404 `STOREFRONT_OFF` otherwise. Sub-org institutes always get `STOREFRONT_OFF` (the parent buys). | Section 6 step 4. | Hides the storefront. It does not cancel subscriptions or stop renewals; those still go out by email. |
| `billing.invoice.series_v2.enabled` | `false` | New 14-character numbers `VT/{FY}/I#####` for **all** new invoices (packs too) and `VT/{FY}/C#####` for credit notes. Subscriptions always use v2 and refuse to invoice without it. | Before the first subscription is sold, after the CA confirms the series (CA question 3). | New pack invoices go back to `INV-AICRED-*`. Don't flip back and forth inside a financial year: GSTR-1 Table 13 reports each series as a range. |
| `billing.buyer_state.required` | `false` | Credit packs: require the buyer's state at checkout (Circular 242/2024). Subscriptions **always** require it, whatever this flag says. | When the top-up modal change is live; CA question 2. | Packs can be bought without a state again. The old place of supply rule applies; see CA question 2. |
| `billing.packs.reconcile.enabled` | `false` | The hourly `CreditPackReconcileJob` (minute 47 UTC): reconciles credit-pack payment links whose webhook was lost. | When pack links are in use. | Lost pack webhooks are not picked up until a manual fulfil. |

Per-institute switches (super-admin only; not in `setting_json`, which tenants can write):

| Where | Field | Meaning |
|---|---|---|
| `ai_storefront_institute` | `storefront_enabled` | NULL = the rollout mode decides. `true` = on the allow-list in `ALLOWLIST` mode. `false` = never show the storefront here, whatever the mode. |
| `ai_storefront_institute` | `brand_mode_override` | `VACADEMY` / `NEUTRAL` / NULL. NULL = automatic (section 3.1). |
| `ai_storefront_audience` + `ai_institute_segment` | rows | Which institutes or segments see the storefront (`plan_id` NULL) or a specific plan. EXCLUDE rows win. Plans also need `ai_plan.listed = true` and an `audience_mode` of ALL, ALLOWLIST (the default) or SEGMENT. |
| `ai_plan` | `listed`, `tagline`, `highlights`, `badge`, `sort_order`, `audience_mode` | Listing fields. Prices, allowances and periods come from the frozen published version. |
| `ai_billing_feature` | `tenant_label` | The name tenants see for a billable feature (replaces "Vacademy Assistant"). |

Platform document identity (singleton `platform_payment_config`; set it in the portal or by SQL before step 3):

| Column | Default | Used for |
|---|---|---|
| `supplier_legal_name`, `supplier_gstin`, `supplier_state_code`, `supplier_address` | Vidyayatan Technologies LLP, 23AAYFV8247N1Z3, 23, (existing) | Every invoice and credit note, in every brand mode. Legally required. |
| `trade_name` | `Vacademy` | VACADEMY mode: trade name shown next to the legal supplier on the PDF, and in emails and Razorpay checkout. |
| `brand_logo_url` | NULL | VACADEMY mode: logo on the PDF and the Razorpay checkout where it can be controlled. |
| `neutral_display_name` | `Vidyayatan Technologies` | NEUTRAL mode: the name shown on Razorpay checkout (`options.checkout.name`) and as the email sender name if `billing_from_name` is empty. |
| `billing_support_email` | NULL | "Questions about this invoice" address in emails and the storefront. Must be a non-Vacademy address for NEUTRAL institutes to see it. Left out when NULL. |
| `billing_from_name`, `billing_from_email` | NULL | Display name and address of the billing email sender, used for NEUTRAL institutes too. Owner decision 2026-10-16: this platform sender **may** carry the Vacademy name and domain (for example "Billing · Vacademy"); only the subject and body of a NEUTRAL email must be brand-free. **With both NULL, a NEUTRAL institute gets billing emails only if it has its own brand-free `UTILITY_EMAIL` sender**; otherwise every NEUTRAL invoice, credit-note, link, reminder and pre-debit email is **withheld** (Sentry warning "no neutral sender"). Documents stay in Plan & billing. |

---

## 3. Brand modes: what each mode shows

### 3.1 How the mode is resolved

Server-side, per institute, cached:

1. `ai_storefront_institute.brand_mode_override` if set.
2. Otherwise **NEUTRAL** if the institute has an `institute_domain_routing` row whose role list contains `ADMIN` on a host that is not Vacademy-owned. Vacademy-owned means `*.vacademy.io`, the same rule as `isVacademyOwnedDomain()` in the admin app.
3. Otherwise **VACADEMY**.

The mode is snapshotted on `platform_payment.brand_mode` at order time. The invoice, credit note and emails for that payment use the snapshot, so a later domain change doesn't re-brand an issued document.

Independently of the API, the admin app never shows "Vacademy" when the current host is not Vacademy-owned.

Check before rollout: the preflight (`03_preflight.sql` A4) lists the institutes that resolve to NEUTRAL. On 2026-10-16 it returned 26 rows (25 institutes plus one row with no institute). Review the list:

- `explore.vacademy.ai` (no institute) is a Vacademy-owned `.ai` mirror. The `*.vacademy.io` rule doesn't recognise it, so it counts as a custom host.
- `app.voomsales.com` ("CRM") is our own VoomSales brand. NEUTRAL is probably right there: VoomSales customers should not see "Vacademy".
- Shiksha Nation (the QA account) is NEUTRAL because of `admin.shikshanation.com`. It also has a `*.pages.dev` preview host.
- Enark also has an `admin-enark.localhost` row.

Set `brand_mode_override` wherever the automatic answer is wrong.

### 3.2 Per surface

| Surface | VACADEMY (no custom admin domain) | NEUTRAL (white-labelled) |
|---|---|---|
| Storefront copy (admin app) | May say "Vacademy" | Never "Vacademy". Says "your platform team". Prices "₹X / month + GST" with the inclusive total. |
| Razorpay hosted page (Payment Link) | `options.checkout.name` = `trade_name`. The logo is the account's dashboard logo. | `options.checkout.name` = `neutral_display_name`. The logo is still the account's dashboard logo: there is no per-link logo field (section 5.4). |
| Razorpay registration link (mandate) / UPI app mandate name | The account's business name (no per-link override documented) | Same. See section 12. |
| Bank / UPI statement descriptor | The account's descriptor | Same. Not controllable per link. |
| Razorpay's own SMS and email | Off (`notify` false, reminders off) | Off |
| Tax invoice / credit note PDF | Trade name "Vacademy" + logo **alongside** the legal supplier "Vidyayatan Technologies LLP", its GSTIN, address and state | Legal supplier only. No trade name, no logo, no brand word in the footer or in PDF metadata. |
| Invoice footer | Per `item_kind` (subscription vs credits), no brand needed | Per `item_kind`, with no brand word |
| Billing emails (link, receipt, renewal due, overdue, ended, credit note) | Subject, body and sender may say Vacademy. Links go to the Vacademy admin host. | Neutral subject, body and sender name. Links go to the institute's own `admin_portal_base_url`. If it isn't set, the link is **left out**; it never falls back to `dash.vacademy.io`. |
| Plan and feature names | Super-admin written, brand-linted at publish | Same lint. `tenant_label` replaces internal names. |

The supplier GSTIN is public. Anyone can look up `23AAYFV8247N1Z3` on the GST portal and see the trade name registered there. If that registered trade name is "Vacademy", a white-labelled buyer can find it, and nothing in code can hide it (CA question 11).

---

## 4. Prerequisites before any flag is turned on

1. **V590 applied** cleanly on prod (Flyway history shows success). The tables are owned by `vacademy` (checked 2026-10-16), so the ALTERs will not hit the 42501 ownership error.
2. **Preflight run** (`scratchpad/sql/03_preflight.sql`, read-only) and its findings handled:
   - A1: old INITIATED links that can still be paid. On 2026-10-16 there were 24 links, all inside Razorpay's 6-month default expiry. A late payment is still fulfilled, but you may want to cancel them in the Razorpay dashboard first.
   - A2: duplicate `vendor_payment_id` (must be 0; the unique index needs it).
   - A3, and B5 after V590: buyer state and billing profile coverage.
   - A4: brand-mode preview.
   - A5: the 7 legacy invoices for the CA.
   - A8: plan versions (SAC, currency, tax-exclusive).
3. **CA answers** on the questions marked "blocks" in `03_ca_questions.md`: SAC, series, unsigned PDF, netted upgrade invoice, the legacy invoices, and the brand on the invoice.
4. **`platform_payment_config`** document fields filled (section 2), at least `neutral_display_name` and `billing_support_email`.
5. **Email sender** for billing mail decided. Until a platform billing sender exists, NEUTRAL institutes without their own `UTILITY_EMAIL` sender would get the "Vacademy Support" fallback. Either configure the sender or keep NEUTRAL pilots to institutes that have their own sender (the email is skipped, and the invoice stays in the Billing tab, when no acceptable sender exists).
6. **Razorpay** set up as in section 5, and the test-mode probe (section 7) passes.
7. **Live ₹1 canary plan** created (section 6 step 3).

---

## 5. Razorpay dashboard setup (platform account)

All of this is on the **platform** Razorpay account (the one whose keys are in `platform_payment_config`), never an institute's account.

### 5.1 Products to enable

| Product | Needed for | How |
|---|---|---|
| Payment Links | Packs (already live) and every non-autopay subscription charge | Enabled by default on Indian accounts. Check under Payment Links. |
| Recurring Payments: UPI Autopay | Autopay with UPI | Request activation from Razorpay support or the account manager. Activation is per account and needs a KYC review. Ask them to confirm the account's MCC, because the per-debit `max_amount` ceiling depends on it (₹99,999 for most MCCs; ₹2,00,000 for 6211, 6300, 7322, 6529 and 5960). Docs: https://razorpay.com/docs/api/payments/recurring-payments/upi/create-authorization-transaction/ |
| Recurring Payments: Cards (e-mandate) | Autopay with cards | Same request. Card debits above ₹15,000 need the cardholder's additional authentication (AFA) each time, so plans priced above ₹15,000 per debit are link-only by design. Docs: https://razorpay.com/docs/api/payments/recurring-payments/cards/create-authorization-transaction/ |
| Emandate (netbanking / NACH) | Only if `method=EMANDATE` mandates are offered | Optional; same request. Debits take T+2 to T+3 to confirm. |

Do the same in **Test mode** (most products are on by default there) before live.

### 5.2 Webhook

There is one platform webhook. Keep the existing one; don't create a second URL with a different secret.

- URL: `https://backend-stage.vacademy.io/admin-core-service/payments/webhook/callback/razorpay-platform`. `backend-stage` **is** prod.
- Secret: the value stored encrypted as `platform_payment_config.webhook_secret_encrypted`. If you rotate it in Razorpay, update the config in the same minute. Every event in between fails signature and is stored as FAILED "Invalid signature". That message has 244 rows up to 2026-08-03, from before the secret was fixed.
- Events: the table below shows what to subscribe, compared with what prod has received so far. Prod received only `payment.authorized`, `payment.captured`, `order.paid`, `payment.failed`, `refund.created`, `refund.processed` and `invoice.paid` up to 2026-10-16 (`web_hook` table).

| Event | Subscribe | Why |
|---|---|---|
| `payment.captured` | yes (already) | Fulfilment for packs, link payments and mandate debits. |
| `order.paid` | yes (already) | Second fulfilment trigger; handled under the same row lock. |
| `payment.failed` | yes (already) | Marks the payment FAILED. A failed **mandate debit** makes the charge send a payment link immediately. |
| `refund.processed` | **yes** | Credit note + charge REFUNDED / PARTIALLY_REFUNDED (cumulative). For AI-plan payments this is the ONLY event that issues the credit note, tells ai_service and cancels / reverts the plan. |
| `refund.created` | yes (already) | Packs: unchanged (deduplicated with `refund.processed` on the refund id). AI plans: recorded as a pending refund only (`refundsPending`); nothing is credited or cancelled until it is processed. |
| `refund.failed` | **add** | Clears the pending refund, alerts staff (Sentry "Platform refund FAILED"); no credit note was issued, the plan is untouched. Packs: alert only. |
| `token.confirmed` | **add** | Mandate → ACTIVE. |
| `token.rejected` | **add** | Mandate → REJECTED; the charge falls back to a payment link. |
| `token.paused` | **add** | Mandate → PAUSED (UPI only); no debits are scheduled while paused. |
| `token.cancelled` | **add** | Mandate → CANCELLED; renewals fall back to links. Sent only after NPCI confirms the cancellation. |
| `payment_link.paid` | **add** | Link-level confirmation. The handler only acknowledges it (no action); fulfilment keys off `payment.captured` / `order.paid`, and lost webhooks are caught by the billing job's reconcile pass. |
| `payment.authorized` | already on, harmless | Acked. |
| `invoice.paid` / `invoice.expired` | keep `invoice.paid`; **add** `invoice.expired` | A **registration link is a Razorpay invoice** (`POST /subscription_registration/auth_links`). Its authorisation payment can also pay the period's first charge, so a paid registration fires `invoice.paid` **and** `payment.captured`. Fulfilment keys off `payment.captured` (under the row lock), and `invoice.paid` must never be treated as a pack. `invoice.expired` = an unused registration link expired. The handler only acknowledges it; the billing job's reconcile pass marks the lapsed mandate and the charge falls back to a payment link. |

Token events carry **only** the token entity (`contains: ["token"]`), with no `notes` and no `payment_type`. The handler routes them by `payload.token.entity.id` to `ai_subscription_mandate.token_id`. A token event that matches no mandate is acked and ignored, which happens to tokens created by the probe. Payload reference: https://razorpay.com/docs/payments/payment-gateway/s2s-integration/recurring-payments/upi/webhooks/

### 5.3 Notifications and reminders

- Payment Links are created with `notify.sms=false`, `notify.email=false` and `reminder_enable=false`. We send our own brand-correct emails. Don't enable account-level "send payment link reminders" in the dashboard.
- Registration links are created with `sms_notify=0` and `email_notify=0` for the same reason.
- **Pre-debit notice for autopay.** Our renewal job sends our own notice email from 72 h before the period start, and records `pre_debit_notice_sent_at` (and schedules the debit) **only when the email was handed over**; an undelivered notice (no recipient, NEUTRAL without a neutral sender) sends the charge down the payment-link path instead. Razorpay and the bank also notify the customer. We send no `notification` object, so Razorpay debits UPI about 25 h after its notification ("may take between 24-36 hours") and cards "after 36 hours and 5 minutes". The job therefore raises every debit **40 h before the period start** (the notice tells the customer the expected debit time: +25 h UPI, +36 h 5 min card). Docs: https://razorpay.com/docs/api/payments/recurring-payments/upi/create-subsequent-payments/ and https://razorpay.com/docs/api/payments/recurring-payments/cards/create-subsequent-payments/
  - Don't create a debit on the last day of a UPI mandate cycle.
  - Don't create a second debit until the first has a final status. Razorpay does not retry a failed debit when the order carries a `notification` object, so our job falls straight back to a payment link.

### 5.4 Business name, logo and branding

- **Per link:** Payment Links accept `options.checkout.name`, which changes the business name in the checkout section of the hosted page. Docs: https://razorpay.com/docs/api/payments/payment-links/change-business-name/
  - The code sets it to `trade_name` (VACADEMY) or `neutral_display_name` (NEUTRAL).
  - No per-link **logo** field is documented. The logo is the account logo.
- **Account level (Settings → Business / Branding):** logo, brand colour, website, support email and phone, and policy links come from the account's KYC profile. These show on every hosted page and receipt, in both modes. For NEUTRAL to really be neutral on Razorpay's page:
  - set the account logo to a neutral mark, or none;
  - set the support email to a non-Vacademy address;
  - check the policy links.

  Renaming the account may trigger Razorpay re-verification.
- **Test mode can render differently from live.** Take the brand screenshot from the **live ₹1 canary** (section 6 step 3), not from test mode.

### 5.5 Settlement and reports

- Settlements go to the platform bank account as today.
- For reconciliation (section 9), download the Payments, Refunds and Settlements reports. The `notes` columns carry `orderId` (= `platform_payment.id`), `instituteId`, `payment_type` and, for subscriptions, `charge_id`.

---

## 6. Rollout order

Do one step at a time. Each step has a check, and each can be rolled back by setting the flag back.

**Step 0: deploy dark.**
- Deploy V590 and all services with every flag at its default.
- Checks:
  - one real credit-pack top-up on an internal institute works end to end: link → pay → credits → PAID → invoice → email;
  - its link has an `expire_by` 48 h out (Razorpay dashboard → the link);
  - `03_preflight.sql` part B runs clean: B1 all present; B2 shows only CREDIT_PACK items with packs; B7 shows 0 rows.
- Rollback: redeploy the previous image. V590 is additive, so the old code ignores the new columns.

**Step 1: invoice series v2** (after CA question 3).
- `billing.invoice.series_v2.enabled = true`.
- Check: the next pack invoice is `VT/2627/I00001`, ≤ 16 characters, with the date and FY in IST. Prod invariant 5 in section 9.2 returns 0.
- Note for the accountant: GSTR-1 Table 13 for this FY now has two series, `INV-AICRED-*` (up to switch-on) and `VT/2627/I*`.

**Step 2 (optional): buyer state for packs.**
- `billing.buyer_state.required = true`, once the top-up modal shows the state field.
- Check: a pack checkout with no state gets 422 `BUYER_STATE_REQUIRED`; one with state 23 gets CGST + SGST.

**Step 3: sales-led payments + live ₹1 canary.**
1. `billing.plans.enabled = true` (if not already), `billing.subscriptions.payments.enabled = true`. Storefront stays OFF.
2. In the portal, create a hidden plan `ai_canary` and publish a version:
   - ₹1 + GST, INR;
   - SAC per CA (default 998315 for every new version, also when copied; the V588 seed "AI Pro v1" keeps 998313 because published terms are frozen, so sell a new version, not v1);
   - grace 7 days, `grace_behaviour = CHARGED`.
3. Assign it with source PAYMENT to **one dedicated internal institute**. Don't use Shiksha Nation, which is the QA account. Then:
   - pay the link from a real UPI or card;
   - screenshot the hosted page for the brand check, in both a VACADEMY and a NEUTRAL institute if possible.
4. Check:
   - subscription ACTIVE, with a PAID period starting at the payment time;
   - engine LIVE: the plan's features are billed from the allowance;
   - invoice `VT/2627/I…` with the correct tax head and place of supply, the brand per mode, and the email.
5. Refund in full from the portal. Check:
   - credit note `VT/2627/C…`;
   - charge REFUNDED;
   - benefits stop immediately;
   - subscription CANCELLED with `end_at` = the refund time.
6. RETIRE the canary version.
- Rollback: `billing.subscriptions.payments.enabled = false`.

**Step 4: storefront pilot.**
- Populate `ai_storefront_audience` (or set `ai_storefront_institute.storefront_enabled = true`) for 3 to 5 pilot institutes, **including at least one white-labelled institute with a custom admin domain**. Mark the plans `listed = true`.
- Then `billing.storefront.mode = ALLOWLIST`.
- Checks:
  - a pilot admin sees "Plan & billing", and a teacher in the same institute does not (403);
  - a non-pilot institute gets 404 `STOREFRONT_OFF`, and so does a sub-org;
  - on the white-labelled host, no "Vacademy" appears in the storefront, on the Razorpay page (where controllable), in the PDF (text **and** metadata) or in the emails;
  - the email links go to the institute's own admin host.

**Step 5: autopay.**
- After Recurring Payments is live on the account and the probe's registration and token checks pass in test mode: `billing.autopay.enabled = true`.
- Canary:
  - register a UPI mandate on the internal institute with a ₹1 plan;
  - check that `token.confirmed` makes the mandate ACTIVE;
  - let the renewal job schedule a debit, and check the pre-debit email (sent from 72 h before the period start, at least 24 h before the debit), the debit, the invoice, and that the period is PAID;
  - cancel the mandate from the portal and check `token.cancelled` → CANCELLED.
- Then force a debit failure with a test mandate in test mode and check that the payment link goes out immediately and GRACE follows if it stays unpaid.

**Step 6: widen.**
- Fill `ai_institute_segment` and add INCLUDE `segment_key` rows to `ai_storefront_audience`, then set `billing.storefront.mode = SEGMENTS`, then `ALL`.
- Run the section 9.2 invariants daily for the first two weeks of each widening.

---

## 7. Test-mode probe

`scratchpad/probes/razorpay_test_mode_probe.py` checks, against a Razorpay **test** account, the three Razorpay behaviours the design depends on and could not verify from docs alone.

- It uses only the Python standard library.
- It refuses `rzp_live_` keys.
- Without `RAZORPAY_TEST_KEY_ID` / `RAZORPAY_TEST_KEY_SECRET`, it only prints what it would send.

```bash
PY=/path/to/python3
# 0. See every request it would make, without calling anything
$PY razorpay_test_mode_probe.py plan
# 0b. Offline self-test of the probe itself (mocked Razorpay): prints self_test PASS
$PY razorpay_test_mode_probe.py self-test

export RAZORPAY_TEST_KEY_ID=rzp_test_xxx RAZORPAY_TEST_KEY_SECRET=yyy

# 1. Payment Link: is options.checkout.name honoured? Do notes and expire_by round-trip?
$PY razorpay_test_mode_probe.py link --name "Vidyayatan Technologies"
#    -> open short_url, screenshot the page, pay with a test card or success@razorpay
#    -> run again with --name Vacademy and compare the screenshots
#    -> afterwards: $PY razorpay_test_mode_probe.py link-status --id plink_xxx [--cancel]

# 2. Mandate registration link (UPI Autopay / card)
$PY razorpay_test_mode_probe.py registration --method upi --max-amount 1500000
$PY razorpay_test_mode_probe.py registration --method card --max-amount 1500000
#    -> open short_url and authorise (UPI test VPA success@razorpay; for cards use a
#       recurring-enabled test card from Razorpay's test card list)

# 3. Token state after authorisation
$PY razorpay_test_mode_probe.py tokens --customer cust_xxx [--cancel-token token_xxx]

# 4. Webhook payloads: copy a delivered payload from Dashboard -> Webhooks -> the
#    test webhook -> event log (or capture it at a request bin) and check that it
#    has the fields our handler uses, plus the signature
export RAZORPAY_TEST_WEBHOOK_SECRET=whsec
$PY razorpay_test_mode_probe.py verify-webhook --payload token_confirmed.json --signature <X-Razorpay-Signature>
```

What to record in the PR or launch checklist (the probe prints a JSON report; keep it):

| Check | Pass condition |
|---|---|
| `checkout_name_echoed` | The fetched link has `options.checkout.name`, and the screenshot shows that name. |
| `expire_by_roundtrip` | The fetched `expire_by` equals what was sent. |
| `notes_roundtrip` | `notes.orderId`, `notes.payment_type` and `notes.charge_id` come back. After paying, the `payment.captured` payload carries the same notes. |
| Registration link | It returns `inv_…` and `customer_id`. After authorising, `GET /customers/{id}/tokens` shows the token with `recurring_details.status = confirmed`, and its `max_amount` and `expired_at`. |
| Token webhooks | `token.confirmed` payload has `payload.token.entity.id` and `recurring_details.status`. `token.cancelled` arrives after a cancel (it may take a while, because NPCI confirms first). |
| Refund | A partial refund twice on one test payment produces two `refund.processed` events with distinct refund ids. |

The probe's links use `notes.payment_type = "PROBE_AI_SUBSCRIPTION"`. If the test webhook points at a real environment, admin_core ignores them, because that is not a payment type it fulfils.

---

## 8. The renewal lifecycle (what happens when)

Times are relative to the period end `E` (= the next period start). The grace length is the version's `grace_days` (default 7).

| When | Link-only subscription | Autopay (ACTIVE mandate, amount ≤ ₹15,000 and ≤ `max_amount_minor`) |
|---|---|---|
| T−7 | Roll creates the next PERIOD charge (DUE). The billing job creates the link and emails it → LINK_SENT. The link expires at `E + grace_days`. | Roll creates the charge. The billing job schedules the debit → DEBIT_SCHEDULED. |
| From E − 72 h (≥ 24 h before the debit) | — | Our pre-debit notice email (`pre_debit_notice_sent_at`); Razorpay and the bank notify the customer too. Not delivered → payment link instead. |
| E − 40 h | — | The debit is **claimed on the charge first** (`platform_payment_id`, DEBIT_SCHEDULED, `debit_attempts` + 1), then raised at Razorpay. From the claim on, plan changes (upgrade, downgrade, cancel) answer 409 DEBIT_IN_PROGRESS, and Pay now / Mark paid / Waive / Resend link are refused until the debit settles. A Razorpay timeout or 5xx after the order is "outcome unknown": no link, no second debit; the webhook or the order reconcile decides. |
| Around T−1 / T−0 | Reminder emails | Razorpay debits (UPI ~E − 15 h, cards ~E − 4 h). |
| Debit succeeds | — | `payment.captured` → period PAID → invoice → email. |
| Debit fails, or mandate paused, cancelled or rejected | — | Charge FAILED for the debit, and a **payment link goes out immediately**. From here it behaves like link-only. |
| `E`, unpaid | Subscription → GRACE. Benefits pause and AI use is charged from credits (grace_behaviour CHARGED). | Same |
| Paid during grace | → ACTIVE. The period still ends where it would have ("paying late does not move your renewal date"). | Same |
| `E + grace_days`, unpaid | → EXPIRED. The charge is VOIDed and the link cancelled. | Same |

- **Plan changes:**
  - Upgrade is immediate, with a day-based pro-rata **net** charge (kind UPGRADE) on its own tax invoice. The plan switches when that charge is paid.
  - Downgrade and cancel take effect at the period end.
  - There are no self-serve refunds.
- A first checkout creates a PENDING subscription and a DUE PERIOD charge. The subscription becomes ACTIVE when paid, with the anchor = payment time. A pending checkout whose link expires unpaid goes to EXPIRED and never becomes live.

---

## 9. Reconciliation

### 9.1 Automatic

The billing job (admin_core, ShedLock) reads its work from charge **state**, not from the roll's report:

- `GET /internal/plans/v1/charges?status=DUE&needs_collection=true` → create or reuse the link, or schedule the debit.
- INITIATED payments whose link has expired or hasn't been checked for 6 h → `fetchPaymentLink`:
  - `paid` → fulfil (covers lost webhooks);
  - `expired` / `cancelled` → EXPIRED.
- PAID AI_SUBSCRIPTION payments whose charge is not PAID → re-call `/paid`.
- PAID payments with no invoice after 15 min → invoice + email. Invoices are never created on a page read.

### 9.2 Daily invariants (read-only; run on the standby during the pilot)

Each should return 0 rows.

```sql
-- 1. platform payment PAID, subscription item, charge not PAID
SELECT pp.id FROM platform_payment pp JOIN platform_payment_item i ON i.platform_payment_id = pp.id
JOIN ai_subscription_charge c ON c.id::text = i.subscription_charge_id
WHERE pp.payment_status = 'PAID' AND pp.disposition = 'NORMAL' AND i.item_kind = 'AI_SUBSCRIPTION'
  AND c.status NOT IN ('PAID', 'REFUNDED', 'PARTIALLY_REFUNDED');
-- 2. PAID + NORMAL payments with no invoice after 1 h
SELECT pp.id FROM platform_payment pp LEFT JOIN platform_invoice inv ON inv.platform_payment_id = pp.id
WHERE pp.payment_status = 'PAID' AND pp.disposition = 'NORMAL' AND inv.id IS NULL
  AND pp.updated_at < now() - interval '1 hour';
-- 3. PAYMENT subscriptions ACTIVE without a PAID period covering now
SELECT s.id FROM institute_ai_subscription s
WHERE s.source = 'PAYMENT' AND s.status = 'ACTIVE' AND NOT EXISTS (
  SELECT 1 FROM ai_subscription_period p WHERE p.subscription_id = s.id
   AND p.period_start <= now() AND p.period_end > now() AND p.payment_status IN ('PAID','WAIVED','COMPLIMENTARY'));
-- 4. More than one open (DUE/LINK_SENT/DEBIT_SCHEDULED) PERIOD charge per subscription and service_start
SELECT subscription_id, service_start FROM ai_subscription_charge
WHERE kind = 'PERIOD' AND status IN ('DUE','LINK_SENT','DEBIT_SCHEDULED') GROUP BY 1, 2 HAVING count(*) > 1;
-- 5. v2 document numbers longer than 16 characters
SELECT invoice_number FROM platform_invoice WHERE invoice_number LIKE 'VT/%' AND length(invoice_number) > 16
UNION ALL SELECT credit_note_number FROM platform_credit_note WHERE length(credit_note_number) > 16;
-- 6. Credit notes exceeding their invoice
SELECT inv.id FROM platform_invoice inv JOIN platform_credit_note cn ON cn.invoice_id = inv.id
GROUP BY inv.id, inv.total_amount_minor HAVING sum(cn.total_amount_minor) > inv.total_amount_minor;
-- 7. Refund requested but not reflected after 1 day (Razorpay refund failed?)
SELECT id FROM platform_payment WHERE refund_requested_at < now() - interval '1 day'
  AND payment_status NOT IN ('REFUNDED', 'PARTIALLY_REFUNDED');
```

Column names match `V590__ai_plan_payments_storefront.sql` as of 2026-10-16. If the migration changes, update these queries.

### 9.3 Monthly (with the accountant)

- Razorpay Payments report (captured, platform account) against `platform_payment` PAID by `vendor_payment_id`. Every captured payment is exactly one of:
  - PAID + NORMAL with an invoice;
  - DUPLICATE or LATE with a refund.
- Razorpay Refunds report against credit notes and `refund_requested_at` rows.
- The invoice and credit-note registers for GSTR-1:
  - each series as a continuous range per FY (`max(n) = count`);
  - B2B vs B2C split;
  - inter-state B2C above ₹1 lakh listed invoice by invoice.

---

## 10. Refunds, credit notes, waivers, offline payments

There are no self-serve refunds. Every money action below is a super-admin action in the portal, needs a written `reason`, and is audited. The endpoints follow design §7.3; check the final paths in the PR.

### 10.1 Refund (credit note)

Portal → institute → Subscription → Billing timeline → payment → Refund (full or partial). This calls admin_core `POST /admin-core-service/super-admin/v1/ai-plans-billing/institutes/{iid}/payments/{platform_payment_id}/refund {amount_minor, reason}`.

1. admin_core writes `refund_requested_at`, checks the cumulative refunded amount, then calls Razorpay `POST /payments/{id}/refund` with an `amount` and a `receipt` = our refund request id. Razorpay rejects a duplicate `receipt`, so a retry can't refund twice. Docs: https://razorpay.com/docs/api/refunds/create-normal/
2. On `refund.processed`:
   - a credit note `VT/{FY}/C#####` against the original invoice, with base and tax split in the invoice's ratio; the sum of credit notes is never more than the invoice;
   - `/charges/{id}/refunded` (it must match the charge's `vendor_payment_id`);
   - a full refund of the current period cancels the subscription with `end_at` = the refund time, and benefits stop at once.
3. Payment status: PARTIALLY_REFUNDED or REFUNDED by the cumulative amount.
4. B2B buyers: under the Finance Act 2025 change to Section 34(2), the output tax is reduced only once the buyer reverses the input tax credit. That is a GSTR-1 task for the accountant, not code.

Credit packs: refunds made in the Razorpay dashboard keep working as before (wallet reversal), with cumulative comparison. Whether pack refunds also get credit notes depends on the build. If not, the accountant issues them manually from the refund report.

Timing for AI plans: the credit note, the `/refunded` call and any cancellation happen on `refund.processed` only. `refund.created` shows the refund as pending (staff cannot refund the same money twice meanwhile); `refund.failed` clears it and alerts. A payment refunded before its invoice existed (invoice step failed) is invoiced by the reconcile job, which then issues the missing credit notes from the recorded refunds.

### 10.1a Staff credit note (no Razorpay refund)

Portal → institute → Invoices and credit notes → AI-plan invoice → **Credit note** (type CREDIT to confirm). This calls admin_core `POST /admin-core-service/super-admin/v1/ai-plans-billing/institutes/{iid}/invoices/{invoiceId}/credit-note {amount_minor, reason}` (GST-inclusive amount; never more than what is left on the invoice). Use it for an offline payment refunded by bank transfer, or a waiver after invoicing. It moves no money and does not change the plan. AI-plan invoices only.

### 10.2 Waive

Portal → charge → Waive. This calls admin_core `POST /admin-core-service/super-admin/v1/ai-plans-billing/institutes/{iid}/charges/{cid}/waive {reason}`, which closes the open link and asks ai_service to mark the charge waived.

- Before invoicing: no consideration means no supply, so there is no invoice.
- After invoicing: a credit note with no Razorpay refund.

### 10.3 Duplicate and late payments (automatic)

**What counts:**
- Duplicate: a second payment for a charge that is already PAID.
- Late: a payment after EXPIRED or CANCELLED, after the service window, or blocked by another live plan.

**What happens:**
- The payment gets `disposition = DUPLICATE | LATE`.
- It is refunded automatically, once:
  - `refund_requested_at` is written before the Razorpay call;
  - `amount_refunded` is checked first.
- It gets **no invoice and no credit note**. CA question 9 asks about receipt and refund vouchers.
- A failed auto-refund raises an alert and returns 200 to Razorpay; it never loops on 500. Finish it by hand in the Razorpay dashboard, then check that invariant 7 clears.

One exception: a late card payment on a pending first checkout where nothing else is live is **activated** rather than refunded.

### 10.4 Offline payment (bank transfer)

Portal → charge → Mark paid. This calls admin_core `POST /admin-core-service/super-admin/v1/ai-plans-billing/institutes/{iid}/charges/{cid}/mark-paid {reference, paid_at, amount_minor, reason}` (reference: 3-50 letters, digits or `/ _ . -`). `paid_at` is recorded in the audit log line only; the period starts when it is marked paid.

- `vendor_payment_id = 'MANUAL:' + reference`.
- `platform_payment` vendor MANUAL, PAID.
- Invoice badge "PAID (offline)".
- Email.

The amount must equal the charge total.

### 10.5 Resend link and cancel mandate

- **Send / resend link:** the portal records the request and reason on ai_service (`POST /super-admin/v1/plans/subscriptions/{sid}/charges/{cid}/send-link`, which also queues the charge for the hourly billing job), then calls admin_core `POST .../ai-plans-billing/institutes/{iid}/charges/{cid}/resend-link`, which creates the link at once, emails it and returns the URL to copy. The billing job also creates and emails links for staff-queued first charges. Either way it reuses the open link if it expires more than 1 h from now. Otherwise it cancels the old link and creates a new one, so there is only one payable link per charge.
- **Cancel mandate:** portal → `POST .../ai-plans-billing/institutes/{iid}/mandates/{mid}/cancel {reason}`. admin_core calls Razorpay `PUT /customers/{cust}/tokens/{token}/cancel` for UPI, and `DELETE /customers/{cust}/tokens/{token}` for cards. The mandate is CANCELLED when `token.cancelled` arrives, and later renewals go by payment link. The tenant can do the same from Plan & billing → Autopay → Cancel. Docs: https://razorpay.com/docs/api/payments/recurring-payments/upi/tokens/

---

## 11. Incident playbooks

| Symptom | Check | Fix |
|---|---|---|
| Paid, but the plan didn't activate | `web_hook` rows for the `pay_…` id (vendor `RAZORPAY_PLATFORM`); `platform_payment.payment_status`; the charge status | If the webhook never arrived or failed: portal "fulfil payment", or wait for the reconcile pass. It is idempotent. `fulfill-payment` checks the payment with Razorpay (captured, amount, `notes.orderId`) before acting. |
| Webhook rows FAILED "Invalid signature" | Secret mismatch, or a foreign account's event | Fix `platform_payment_config.webhook_secret_encrypted`. Razorpay retries non-2xx deliveries with exponential backoff for 24 h from the event time; after that, use fulfil-payment or let reconcile catch it. |
| Webhook keeps returning 500 | admin_core logs: a downstream ai_service error | Expected while ai_service is down. Razorpay retries, and nothing is marked PAID meanwhile. If it is a code bug, roll back. **Razorpay disables a webhook that keeps failing for 24 h** and emails the alert address. Re-enable it in Dashboard → Webhooks once fixed, then run reconcile, because events from the disabled window are not redelivered. The handler must also answer within **5 s**, or Razorpay counts a timeout and resends. Docs: https://razorpay.com/docs/webhooks/best-practices/ |
| `AMOUNT_MISMATCH` alert | The paid amount ≠ the total snapshot on the payment or the charge | Don't activate by hand. Refund the payment and resend the link. Find out how the amount changed. |
| A customer was debited twice | Two `pay_…` ids for one charge | The second one should be DUPLICATE and auto-refunded. If the refund failed (invariant 7), refund it in the dashboard. |
| Mandate debit failed | Charge FAILED, `debit_attempts` | Automatic: a payment link goes out immediately and GRACE starts at the period start if it stays unpaid. Tell the customer to re-authorise autopay if the token is CANCELLED or PAUSED. |
| Someone wants `billing.plans.enabled` off | Live PAYMENT subscriptions exist | Allowed. Paying customers keep their benefits (the engine ignores the switch for `source=PAYMENT`). To stop selling, use `billing.subscriptions.payments.enabled` and `billing.storefront.mode = OFF`. |
| A white-labelled tenant saw "Vacademy" | Which surface (section 3.2) | Code surfaces: a bug (the brand-leak tests should have caught it). Razorpay surfaces: the account-level branding (section 5.4). Email sender: section 4 item 5. |
| Invoice has the wrong buyer state or GSTIN | `platform_payment` buyer snapshot | Invoices are immutable. Issue a credit note and a fresh invoice with the accountant. Fix `platform_billing_profile` for next time. |

---

## 12. Accepted risks and things not yet verified

- **Shared internal token.** `/charges/{id}/paid` is protected only by `X-Internal-Service-Token`, the same as the existing grant endpoint. Anyone holding the token can activate a plan. This is accepted; rotate the token if it is exposed.
- **Mandate name and logo.** The name and logo on the registration link, and the name in the customer's UPI app ("mandate created by …"), come from the account. No per-link override is documented. A white-labelled tenant may see the account's business name there.
- **Supplier trade name** on the public GST portal (section 3.2).
- **Pre-debit timing.** Debits are raised 40 h before the period start for UPI and cards (Razorpay: UPI 24-36 h, cards 36 h 5 min after the notification). A debit raised later than that (a notice sent late, e.g. a charge re-created close to the start) can land after the start, when the plan is in GRACE until it settles. Confirm the timing with the live canary.
- **Card autopay at checkout.** A card authorisation is Rs 1 (Razorpay: "For cards, the amount should be 100"), so a CARD registration never pays the first charge: a checkout with autopay + CARD pays by link, and card autopay is set up afterwards from Plan & billing (Rs 1, refunded). UPI registration still pays the first charge; confirm in test mode (section 7) that the full-amount UPI registration is accepted.
- **Card `max_amount`.** The card registration docs give conflicting maxima (₹15,000 in the Orders API section, ₹10,00,000 in the registration link section). We cap autopay at ₹15,000 per debit anyway.
- **GST.** Every item in `03_ca_questions.md` is open until the CA answers.
