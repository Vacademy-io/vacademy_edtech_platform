# Invoice Configuration, Numbering & Tax

The reference for **how an invoice gets its number, how its tax is computed, and every setting that drives either**. It covers what the other two invoice docs leave out:

- [`invoices.md`](./invoices.md) covers the payment and invoice *flows*: sources, status machine, ledger, CPO, admin invoices, gateways, API.
- [`invoice-template-system.md`](./invoice-template-system.md) covers the *template engine*: template types, MJML editor, PDF render and email send.

Read this one before changing `INVOICE_SETTING`, the numbering engine, proforma handling, the tax math, or platform (AI-credit) invoices.

> **Stale statements in the older docs.** `invoices.md` gives the number as `INV-20250715-0042`. `invoice-template-system.md` gives it as `INV-{instituteId}-{YYYYMMDD}-{sequence}` and says the number is globally unique. Since V432 the format is admin-configurable, the default is `INV-{{YYYYMMDD}}-{{seq}}` (no institute id), and uniqueness is **per institute**. Where they disagree with this document, this document is correct.

---

## Table of contents

1. [System map](#1-system-map)
2. [Configuration: `INVOICE_SETTING`](#2-configuration-invoice_setting)
3. [Invoice numbering](#3-invoice-numbering)
4. [Proforma invoices](#4-proforma-invoices)
5. [Fee receipts and other numbered documents](#5-fee-receipts-and-other-numbered-documents)
6. [Tax: institute → learner invoices](#6-tax-institute--learner-invoices)
7. [Tax: platform → institute invoices (AI credits)](#7-tax-platform--institute-invoices-ai-credits)
8. [Bill-To and institute identity defaults](#8-bill-to-and-institute-identity-defaults)
9. [Tax and numbering placeholders](#9-tax-and-numbering-placeholders)
10. [Data model and migrations](#10-data-model-and-migrations)
11. [API reference](#11-api-reference)
12. [Admin UI](#12-admin-ui)
13. [Known limitations and gotchas](#13-known-limitations-and-gotchas)
14. [Code map](#14-code-map)

---

## 1. System map

There are **two independent invoicing systems**. They share no tables, no numbering and no tax code.

| | Institute → learner | Platform → institute |
|---|---|---|
| What is billed | Course enrolments, fee installments, admin-raised invoices, live-session registrations | AI credit packs bought by an institute |
| Supplier | The institute | Vacademy (`platform_payment_config`) |
| Tables | `invoice`, `invoice_line_item`, `invoice_payment_log_mapping`, `invoice_released_number`, `invoice_billing_profile` | `platform_invoice`, `platform_invoice_line_item`, `ai_credit_invoice_sequence` |
| Numbering | Admin-configurable token format (`INVOICE_SETTING.numbering`) | Fixed `INV-AICRED-YYYYMM-NNNN` |
| Tax | Admin-configured rate or per-package-type components | Hardcoded Indian GST: CGST+SGST / IGST / zero-rated export |
| Main service | `InvoiceService` | `PlatformInvoiceService` |

Everything below is about the institute → learner system unless a section says otherwise. Section 7 covers the platform system.

### Documents the institute → learner system issues

| Document | `{{doc_type}}` value | Created by | Numbered out of |
|---|---|---|---|
| Enrolment invoice (gateway or offline payment) | `INV` | `InvoiceService.generateInvoiceWithResult` | Main series |
| Admin-raised invoice | `ADM` | `InvoiceService.createAdminInvoices` | Main series, or `PRO:` series when proformas are on |
| Live-session invoice | `LS` | `InvoiceService.createLiveSessionInvoice` | Main series, or `PRO:` series when proformas are on |
| Proforma invoice | `PRO` | Same as the two above, with `proformaEnabled=true` | `PRO:` series until paid |
| School fee receipt | `RCT` | `SchoolFeeReceiptService` | Main series (see §5) |
| Application fee receipt | `APP-FEE` | `ApplicationFeeReceiptService` | Main series (see §5) |
| Synthetic installment row (list view only) | n/a | `InvoiceService.buildSfpInvoiceDTOs` | Not numbered or persisted (see §5) |

---

## 2. Configuration: `INVOICE_SETTING`

All institute-level invoice configuration lives in one JSON object: the `INVOICE_SETTING` key of the institute's settings, read through `InstituteSettingService.getSettingData(institute, "INVOICE_SETTING")`.

> **Writes are a full overwrite, not a merge.** `GenericSettingStrategy.rebuildInstituteSetting` replaces the whole stored JSON. Any writer must start from the complete current map and change only its own keys. Both the Settings page (`invoice-settings-service.ts`) and `InvoiceInstituteProfileService.upsert` do this. A writer that sends a partial map silently wipes every other key, including tax and numbering.

### Full shape with defaults

```jsonc
{
  // ── Tax (legacy single-rate path, also used by admin + live-session invoices) ──
  "taxIncluded": false,            // do listed prices already contain tax?
  "taxRate": 0,                    // PERCENT, e.g. 18 (not 0.18)
  "taxLabel": "Tax",               // e.g. "GST", "VAT"
  "currency": "INR",               // default currency for admin invoices

  // ── Email / delivery ──
  "sendInvoiceEmail": false,       // send the invoice email at all
  "invoicePdfPlacement": "INVOICE_EMAIL",   // or "PAYMENT_CONFIRMATION_EMAIL"
  "sendAdminCopy": false,          // cc selected admins on invoice / confirmation mails
  "adminCopyUserIds": [],          // auth-service user ids

  // ── Behaviour toggles ──
  "proformaEnabled": false,        // unpaid invoices are proformas (§4)
  "generateInvoiceOnManualEnroll": false,   // read by BulkAssignmentService

  // ── Country / tax registration / component tax ──
  "country": {
    "code": "in",                  // lowercase ISO-3166 alpha-2
    "name": "India",
    "taxRegistrationNumber": "",   // institute GSTIN / VAT no. -> {{tax_registration_number}}
    "hsnSacCode": "",              // e.g. "999293" -> {{hsn_code}}
    "taxComponents": [             // default components; empty = use taxRate
      { "label": "CGST", "rate": 9 },
      { "label": "SGST", "rate": 9 }
    ],
    "taxComponentsByPackageType": {          // optional per-package-type override
      "PRODUCT": [ { "label": "GST", "rate": 18 } ]
    }
  },

  // ── Numbering (§3) ──
  "numbering": {
    "format": "INV-{{YYYYMMDD}}-{{seq}}",
    "seqPadding": 4,
    "seqScope": "DAILY",           // NEVER | YEARLY | MONTHLY | DAILY
    "instituteCode": "",
    "fyStartMonth": 4,
    "sanitizeTokens": true,
    "startFrom": 0
  },

  // ── Terms & conditions (rendered into {{terms_and_conditions}}) ──
  "termsAndConditions": {
    "default":   "<p>…</p>",
    "byPackage": { "<packageId>": "<p>…</p>" },
    "bySession": { "<sessionId>": "<p>…</p>" },
    "byLevel":   { "<levelId>":   "<p>…</p>" }
  },

  // ── Institute identity overrides (written from the Create-Invoice dialog, §8) ──
  "instituteNameOverride": "",
  "instituteAddressOverride": "",
  "instituteContactOverride": "",
  "defaultNotes": ""
}
```

### Key reference

| Key | Type | Default | Read by | Effect |
|---|---|---|---|---|
| `taxIncluded` | bool | `false` | `InvoiceService` (all paths) | Whether prices already contain tax. See §6 for what it changes on each path. |
| `taxRate` | number (%) | `0` | `InvoiceService` | Single tax rate. Used when no `country.taxComponents*` are configured, and **always** for admin and live-session invoices. |
| `taxLabel` | string | `"Tax"` | `InvoiceService` | Label for the tax row and `{{tax_label}}`. |
| `currency` | ISO code | `"INR"` | Admin invoice create, school receipts | Default currency. Enrolment invoices use the payment log's currency, falling back to the plan's. |
| `sendInvoiceEmail` | bool | `false` | `InvoiceService.sendInvoiceEmail` | Master switch for the invoice email. A missing key is treated as `false`. |
| `invoicePdfPlacement` | enum | `INVOICE_EMAIL` | `InvoicePdfPlacement.fromSetting` | `PAYMENT_CONFIRMATION_EMAIL` attaches the PDF to the confirmation mail and suppresses the separate invoice mail. Unknown values fall back to the default. |
| `sendAdminCopy` / `adminCopyUserIds` | bool / string[] | `false` / `[]` | `InvoiceAdminCopyRecipientResolver` | Copies payment emails to selected admins, skipping addresses already on the mail. Lookup failures send no copies; they never fail the payment. |
| `proformaEnabled` | bool | `false` | `InvoiceService.isProformaEnabled` | See §4. |
| `generateInvoiceOnManualEnroll` | bool | `false` | `BulkAssignmentService` | Generate an invoice when an admin enrols learners manually or in bulk. |
| `country.*` | object | empty | `InvoiceService` | Tax registration, HSN/SAC, per-package-type tax components. See §6. |
| `numbering.*` | object | legacy default | `InvoiceNumberConfig.fromInvoiceSettings` | See §3. |
| `termsAndConditions.*` | object | none | `buildTermsAndConditionsHtml` | Resolved per package, then session, then level, then `default`. Empty strips the `<!-- TERMS_AND_CONDITIONS_BLOCK -->` wrapper. |
| `instituteNameOverride`, `instituteAddressOverride`, `instituteContactOverride`, `defaultNotes` | string | none | `InvoiceInstituteProfileService` | See §8. The Settings page passes these through untouched. |

If `INVOICE_SETTING` is missing or unreadable, `getInvoiceSettings` returns `taxIncluded=false, taxRate=0, taxLabel="Tax", currency="INR", sendInvoiceEmail=false, invoicePdfPlacement=INVOICE_EMAIL`. Invoices are still issued; they carry no tax and send no email.

---

## 3. Invoice numbering

Since V432, invoice numbers are built from an **admin-defined token format**. The design goals, which explain most of the code:

1. **Gapless.** A number is consumed only when an invoice row actually exists.
2. **No drift.** The counter is the invoice data itself, so it cannot disagree with the invoice list.
3. **Never blocks a payment.** A bad format, a lookup failure or a collision degrades to a valid number. It never throws inside a webhook.
4. **Backward compatible.** An institute with no `numbering` block gets exactly the old `INV-yyyyMMdd-NNNN`.

### 3.1 Configuration: `INVOICE_SETTING.numbering`

Parsed by `InvoiceNumberConfig.fromInvoiceSettings`. Every field is lenient: a missing, null or unparseable value falls back to the legacy default.

| Field | Default | Range / values | Meaning |
|---|---|---|---|
| `format` | `INV-{{YYYYMMDD}}-{{seq}}` | Token string, at most 100 rendered chars | The number's shape. Must contain `{{seq}}` **exactly once**. |
| `seqPadding` | `4` | 1–12 (clamped) | Zero-padding for `{{seq}}` when it has no `:N` modifier. |
| `seqScope` | `DAILY` | `NEVER`, `YEARLY`, `MONTHLY`, `DAILY` | When the counter resets to 1. Unknown values become `DAILY`. |
| `instituteCode` | `""` | free text | Value for `{{institute_code}}`. Blank derives it from the institute name (first 2 alphanumerics, uppercased; `INV` if the name has none). |
| `fyStartMonth` | `4` | 1–12 (clamped) | First month of the financial year, for `{{FY}}`, `{{FYY}}` and `{{FQ}}`. Use 4 for India/UK, 7 for Australia, 1 for calendar-year regimes. |
| `sanitizeTokens` | `true` | bool | Uppercase, strip accents and non-alphanumerics, and truncate free-text tokens to 12 chars by default. |
| `startFrom` | `0` | ≥ 0 | **Floor** for the sequence: the next number is never lower than this. Lets an institute continue a series from another system. A floor below what has already been issued is ignored; numbers are never reused this way. |

### 3.2 Format grammar

```
{{token}}            e.g. {{seq}}, {{FY}}
{{token:N}}          width modifier: seq is zero-padded to N; text is truncated to N (1–20)
{{token:initials}}   free-text tokens only: "Rahul Sharma" -> "RS"
```

- Tokens are **case-sensitive**: `{{MM}}` is the month, `{{mm}}` is an error. The validator suggests the right casing.
- Whitespace inside braces is tolerated (`{{ seq }}`).
- Literal text outside tokens may only contain `A-Z a-z 0-9 - / _ .` and space, so numbers stay URL- and filename-safe.
- Substitution is single-pass. A learner name containing `{{…}}` is never re-expanded.
- A token that resolves empty collapses the separators around it, and leading or trailing separators are trimmed. For example, `ACME-{{enrollment_no}}-{{seq}}` becomes `ACME-0001` on an admin invoice, never `ACME--0001`.
- The rendered value is hard-capped at 100 characters (`invoice.invoice_number` is `VARCHAR(100)`).

### 3.3 Token catalogue

The single source of truth is the `InvoiceNumberToken` enum, served to the UI by `GET /v1/invoices/numbering/tokens`. ⚠ marks tokens flagged `riskyForTax`. They make numbering non-sequential across the institute, so the UI badges them and the change dialog requires type-to-confirm.

| Group | Token | Example | Notes |
|---|---|---|---|
| Sequence | `seq` | `0042` | Required, exactly once. |
| Institute | `institute_code` | `ACME` | `numbering.instituteCode`, or derived from the name. |
| | `institute_name` | `ACMEACADEMY` | |
| | `state_code` | `27` | `institutes.state_code` (V239). |
| | `institute_city` / `institute_state` / `institute_country` | `MUMBAI` | |
| | `subdomain` | `ACME` | |
| Learner ⚠ | `learner_name` | `RAHULSHARMA` | ⚠ |
| | `learner_initials` | `RS` | ⚠ |
| | `learner_state` | `MAHARASHTRA` | ⚠ From the user's `region`. |
| | `enrollment_no` | `482910` | ⚠ Lazy: `ssigm.institute_enrollment_number`. Empty on admin invoices. |
| Date | `YYYY` / `YY` | `2026` / `26` | Invoice date. |
| | `MM` / `MMM` / `DD` | `08` / `Aug` / `05` | `MMM` renders title case (`Aug`). It is not a free-text token, so it is not uppercased. |
| | `YYYYMM` / `YYYYMMDD` | `202608` / `20260805` | |
| | `FY` / `FYY` | `2026-27` / `26-27` | Uses `fyStartMonth`. With `fyStartMonth=1` it is just the year (`2026` / `26`). |
| | `Q` / `FQ` | `3` / `2` | Calendar quarter / fiscal quarter. |
| Transaction | `currency` | `INR` | |
| | `payment_vendor` | `RAZORPAY` | Empty on admin invoices. |
| | `plan_name` | `ANNUALPLAN` | ⚠ |
| | `doc_type` | `INV` | `INV` / `ADM` / `LS` / `PRO` / `RCT` / `APP-FEE`. See §1. |
| | `course_name` / `level_name` / `session_name` | `PHYSICS101` | ⚠ Lazy: resolved from the learner's package session. |

**Lazy tokens** (`enrollment_no`, `course_name`, `level_name`, `session_name`) need a database read that no other invoice code performs. They are passed to the formatter as suppliers and called only when the format contains them. The result is memoised, so a format using two package tokens issues one query. A lookup failure renders empty; it never blocks the invoice.

### 3.4 Validation

`InvoiceNumberFormatter.validate` returns every problem at once. **Errors** block a save:

- empty format
- `{{seq}}` missing, or present more than once
- unknown token (with a casing hint when it is only a case mismatch)
- illegal literal characters
- bad modifier (width outside 1–20, or `:initials` on a non-text token)
- worst-case rendered length over 100. Each token has a `maxWidth`; free text counts as 12 unless a `:N` modifier says otherwise.

**Warnings** do not block a save:

- any ⚠ token is used ("not strictly sequential")
- `startFrom` is at or below the highest number already issued in the current window (it would be ignored)

At issue time `InvoiceNumberService.resolveUsableConfig` re-validates the stored format. If it no longer validates (edited directly in the database, or a retired token), it logs an ERROR and falls back to `INV-{{YYYYMMDD}}-{{seq}}`, **keeping the admin's `seqScope`** so the counter they have been using stays the one that is read.

### 3.5 The counter: how a sequence number is allocated

There is **no sequence table** for institute invoices. The counter lives on the invoice rows:

```
invoice.seq_no         BIGINT       position within the window
invoice.seq_scope_key  VARCHAR(32)  the window: 'ALL' | 'YYYY' | 'YYYYMM' | 'YYYYMMDD'
                                    (prefixed 'PRO:' for proformas, §4)
```

The scope key is self-distinguishing by length, so one column serves every scope. Switching scope cannot collide with another scope's counter.

| `seqScope` | Key for 5 Aug 2026 | Resets |
|---|---|---|
| `NEVER` | `ALL` | never |
| `YEARLY` | `2026` | 1 Jan |
| `MONTHLY` | `202608` | 1st of the month |
| `DAILY` (legacy) | `20260805` | daily |

> `YEARLY` resets on the **calendar** year. A format such as `{{FY}}/{{seq}}` with `seqScope=YEARLY` restarts at 1 on 1 January, mid financial year. For a sequence that resets each financial year, use `NEVER` with `{{FY}}` in the format and accept a counter that never resets, or keep `YEARLY` with `fyStartMonth=1`. There is no FY-aligned scope today.

**Allocation algorithm** (`InvoiceNumberService.generate`):

```
scopeKey = [namespace + ":"] + seqScope.scopeKey(invoiceDate)

1. Reuse a released number, if any:
     SELECT lowest r.seq_no FROM invoice_released_number r
      WHERE institute + scopeKey match AND r.seq_no >= startFrom
        AND no live invoice holds that position again
   -> render it; use it if the rendered number is free.

2. Otherwise next = max( MAX(invoice.seq_no in institute+scopeKey) + 1 , startFrom )

3. Probe forward up to 25 candidates (next, next+1, …), rendering each and
   checking existsByInstituteIdAndInvoiceNumber. Take the first free one.
   This absorbs clashes with pre-V432 numbers, which have seq_no = NULL and are
   invisible to MAX.

4. If 25 in a row are taken: log ERROR and issue
   "INV-<scopeKey>-<8 random hex>" with seq_no = NULL so it never moves the counter.
```

**Concurrency.** Two webhooks for the same institute can compute the same `MAX+1` at the same instant. Nothing is reserved up front. The unique constraint `uq_invoice_institute_number (institute_id, invoice_number)` is the arbiter:

```
renderAndSaveWithCollisionRetry (up to 4 attempts):
  render HTML -> PDF -> upload to S3 -> INSERT (REQUIRES_NEW, via the self proxy)
  on DataIntegrityViolationException:
      allocation = nextAfterCollision(config, ctx, attempt)   // MAX+1+attempt
      re-render (the number is baked into the PDF and the S3 object name)
```

`nextAfterCollision` must be used instead of calling `generate` again. A clash against a legacy row leaves `MAX(seq_no)` unchanged, so recomputing would return the same candidate forever. The `attempt` offset guarantees progress.

The save runs in `REQUIRES_NEW` through the Spring proxy (`self`). A unique violation aborts the transaction it happens in, so running it inline would leave the caller with a dead transaction and nothing to retry into.

**Previews never consume a number.** `InvoiceNumberService.preview` (the Create-Invoice dialog, which re-renders on every keystroke) and `previewSamples` (the Settings page) compute the next number without writing anything.

### 3.6 Deleting an invoice: number reuse (V531)

`MAX+1` already re-issues the number of the *newest* invoice if it is deleted. Deleting one from the middle leaves a gap MAX cannot see, so:

- `PaymentDeletionService.removeInvoiceRows` copies `(institute_id, seq_scope_key, seq_no, invoice_number)` into `invoice_released_number` before the hard delete.
- Step 1 of the allocator hands out the **lowest** released position in the current series first.
- Only positions freed by a delete are reused. Arbitrary gaps (for example an admin who set `startFrom=100` after issuing 1–5) are never filled.
- Released positions below `startFrom` are skipped.
- Because `seq_scope_key` carries the namespace, a released proforma number can never come back as a tax-invoice number.
- Legacy rows (`seq_no IS NULL`) have nothing to release.

Hard delete is permission-gated: role setting *Display Settings → Learner Management → "delete payments & invoices"*. It is refused while a live payment is recorded against the invoice, and for live-class invoices. **Rejecting** an invoice (§ status `REJECTED`) is not a delete. The number stays consumed and the row stays for audit.

### 3.7 Changing the format on a live institute

- The new format applies only to **future** invoices. Issued numbers are never rewritten.
- The counter is per `(institute, scopeKey)`, not per format. Changing `ACME/{{seq}}` to `ACME-2026/{{seq}}` within the same window continues the count. Changing `seqScope` starts reading a different key, which may start at 1.
- If a new format renders numbers that already exist (for example, switching back to a format used years ago), the allocator skips past them, up to 25, and then falls back to a random suffix. Check the ERROR log after any format change on an institute with history.
- `GET /numbering/state` returns `existingInvoiceCount`, `lastIssuedNumber` and `nextSequence`. The change dialog shows these so the admin sees how much history the change sits on.

### 3.8 Migration from the old numbering (V432)

Before V432:

- `invoice_number` was globally unique, but the counter was `COUNT(*)+1` per institute per day, computed over a non-indexable `DATE(invoice_date)`. Two institutes issuing on the same day both computed `-0001`.
- A read-then-write retry loop silently bumped the loser.

V432:

1. Added `seq_no` and `seq_scope_key`, plus the index `idx_invoice_seq_allocation (institute_id, seq_scope_key, seq_no DESC)`.
2. **Backfilled** every existing invoice as `DAILY` positions (`ROW_NUMBER() OVER (PARTITION BY institute_id, YYYYMMDD ORDER BY created_at, id)`), so the counter continued from real history instead of restarting at 1.
3. Replaced the global unique constraint `invoice_invoice_number_key` with `uq_invoice_institute_number (institute_id, invoice_number)`.

> **Consequence for code:** a bare `invoice_number` can now match several rows (different institutes). Never look an invoice up by number alone; always include `institute_id`. Lookups that did so were removed from `InvoiceRepository` in V432.

### 3.9 Format recipes

| Goal | `format` | `seqScope` | Example |
|---|---|---|---|
| Legacy (default) | `INV-{{YYYYMMDD}}-{{seq}}` | `DAILY` | `INV-20260805-0001` |
| Indian GST, per FY, ≤16 chars | `{{institute_code}}/{{FYY}}/{{seq}}` | `NEVER` + FY in prefix, see §3.5 note | `AC/26-27/0042` |
| Monthly series | `INV-{{YYYYMM}}-{{seq:5}}` | `MONTHLY` | `INV-202608-00042` |
| One running counter | `{{institute_code}}-{{seq:6}}` | `NEVER` | `ACME-000042` |
| Distinguish doc kinds | `{{doc_type}}/{{FY}}/{{seq}}` | `NEVER` | `ADM/2026-27/0007`, `RCT/2026-27/0008` |
| Continue another system's series | any, with `startFrom: 1500` | any | `…/1500` |

> **Indian GST note:** CGST Rule 46 caps an invoice serial number at **16 characters**, unique per financial year. The validator only enforces the platform's 100-character limit. Institutes that need GST compliance must pick a format that fits in 16, such as `AC/26-27/0042` (13 chars).

### 3.10 Series by a learner field (e.g. one per branch)

Off for every institute until it is set up in **Settings → Invoice → Receipt series by field**.

```json
"numberingSeries": [
  { "key": "B", "format": "RCPT-B-{{seq}}", "startFrom": 2318,
    "learnerFieldId": "<custom field id>", "values": ["Branch B", "Branch B East"] }
],
"numberingSeriesPolicy": { "askOnFirstPayment": true, "required": true, "fieldId": "<custom field id>" }
```

Both keys are top-level in `INVOICE_SETTING`, not inside `numbering`. The settings screen rebuilds `numbering` from a fixed key list on load, so an unknown key inside it would be lost on the next save.

**Which series.** The first series whose `values` contain the learner's field value numbers the document. Each series counts in its own scope key, `SERIES_<key>:<scope>`, so it never moves the main counter. `key` is at most 16 characters because `seq_scope_key` is VARCHAR(32).

No match, no value or a failed lookup all fall back to the main `numbering` series. A receipt is never blocked by this lookup.

**Where the value comes from**, first match wins:

1. The value pinned on the **enrolment**: a custom field value on the user plan's student-session mappings.
2. The learner's **profile**.
3. The learner's **latest lead**.

**Pinning.** When the policy asks, the record-payment dialogs show the field on the first payment of an enrolment only, preselecting the profile or lead value. The paths are:

- the student side-view record payment
- Pay Installments
- the enroll wizard (fee panel and shared payment fields)

The picked value travels as `payment_details.numbering_value`. `NumberingFieldService.pin` validates it against the field's options and writes it on the enrolment, and on the profile when that is empty, before the payment is written. An enrolment that already has a value is never asked again and is never overwritten. Every later installment of that course, whoever records it, and online payments, numbers from the same series.

`GET /admin-core-service/v1/invoice/numbering-field?instituteId=&userPlanId=&userId=` tells a dialog whether to ask. Any institute staff member can read it.

`required` is enforced by the dialogs. The server validates a value it is given but never blocks a payment for a missing one. Flows that cannot ask (sub-org billing, API callers) keep working and fall back to the profile or lead value, else the main series.

---

## 4. Proforma invoices

Enabled per institute with `INVOICE_SETTING.proformaEnabled = true`. Off by default.

**Problem it solves.** An admin invoice or live-session invoice is raised *before* payment. Numbered out of the real series, every cancelled or never-paid invoice leaves a permanent hole in a series tax authorities expect to be gapless.

**Behaviour when on:**

| | Before payment | After payment |
|---|---|---|
| Document | **Proforma**: a request for payment, not a tax document | Tax invoice |
| Number | From the separate `PRO:<window>` counter | A real number allocated **at payment time** from the main series |
| Format | Institute format prefixed with `PRO-` (`PRO-ACME/2026-27/0007`). If the format uses `{{doc_type}}`, it renders `PRO` there and is not prefixed. | Institute format, `doc_type` = `ADM` or `LS` (stored as `proformaDocType`) |
| PDF title | `PROFORMA INVOICE` / "Proforma Number" | `INVOICE` / "Invoice Number" |
| Emails | Say "proforma invoice" | Say "invoice" |

Which documents can be proformas:

- Admin-raised invoices and live-session invoices.
- **Not** enrolment invoices: those are created after the payment has already happened.

**State lives in `invoice_data_json`:**

| Key | Meaning |
|---|---|
| `proforma` | `true` while unpaid; `false` after finalisation |
| `proformaDocType` | `ADM` or `LS`: which doc type the real number uses |
| `proformaNumber` | After finalisation: the `PRO-…` number the document used to carry |
| `finalizedAt` | Timestamp of finalisation |

**Finalisation** (`InvoiceService.finalizeProformaOnPayment`) runs from both settlement paths, `markInvoicePaidManually` and `markAdminInvoicePaidByPaymentLog`, **before** the status flips to `PAID`:

1. Allocate a real number with `allocateInvoiceNumber(…, proformaDocType)`.
2. `saveFinalizedProformaNumber` writes the number, `seq_no`, `seq_scope_key` and the audit keys in `REQUIRES_NEW` with `saveAndFlush`. It retries up to 4 times via `nextAfterCollision`.
3. Copy the fields onto the caller's in-memory entity. Without this, the caller's later save would write the stale proforma number back.
4. Re-render the PDF under the real number. This step is best-effort: if it fails, the next download regenerates the PDF.

It is idempotent. A non-proforma, or one already finalised by an earlier delivery of the same webhook, is returned untouched. If the outer transaction rolls back after step 2, the invoice keeps its real number with `proforma=false`, and the retry just flips the status. No number is allocated twice.

**Templates.**

- `{{document_title}}` and `{{document_number_label}}` render the right noun.
- `{{proforma_reference}}` prints "Ref. Proforma: …" on a finalised invoice.
- A custom template that uses **none** of these still gets marked:
  - a proforma gets an inline amber "PROFORMA INVOICE — not a tax invoice; number is provisional" banner injected after `<body>`;
  - a finalised invoice gets a one-line "Ref. Proforma: …" note.

  (`applyProformaFallbackMarkup`.)

**Scope of the guarantee.** Proforma numbers are unique among **outstanding** proformas, not for all time. Finalisation moves the row's `(seq_no, seq_scope_key)` into the real series, so the `PRO:` counter only sees unpaid proformas and can hand a number out again once its earlier holder has been paid. This is deliberate: nothing requires a proforma series to be permanent, and the old number is preserved on the paid invoice as `proformaNumber`.

---

## 5. Fee receipts and other numbered documents

**School fee receipts** (`SchoolFeeReceiptService`) and **application fee receipts** (`ApplicationFeeReceiptService`) use the same `InvoiceNumberService` and the **same main counter** as invoices, with `doc_type` = `RCT` / `APP-FEE`.

- If the institute's format contains `{{doc_type}}`, receipts use it as-is.
- If not, the format is replaced with `RCT-{{YYYYMMDD}}-{{seq}}` / `APP-FEE-{{YYYYMMDD}}-{{seq}}` (`InvoiceNumberConfig.withFormat`), keeping every other setting. Otherwise a receipt would silently be numbered `INV-…`.
- Because the counter is shared per `(institute, scopeKey)`, invoices and receipts interleave positions in one window. For example, `INV-20260805-0001` might be followed by `RCT-20260805-0002`.

This replaced a prefix-based `countByInvoiceNumberStartingWith` counter that silently restarted at 1 whenever the prefix changed.

**Synthetic installment rows.** `GET /v1/invoices/user/{userId}` returns one pseudo-invoice per unpaid `student_fee_payment` row. These are not persisted and consume no number. Their "number" is a display label built from the bill status: `DUE`, `PAID`, `PARTIAL`, `OVERDUE` or `WAIVED`.

---

## 6. Tax: institute → learner invoices

There are two tax models, and which one runs depends on **the invoice path**, not only on settings.

| Path | Model | Per-package-type components | `{{tax_components}}` |
|---|---|---|---|
| Enrolment invoice (`generateInvoiceWithResult` → `buildInvoiceDataFromMultiplePaymentLogs`) | Components when configured, else single rate | ✅ | ✅ when components are configured |
| Admin-raised invoice (`createAdminInvoices`, `updateAdminInvoice`, `previewAdminInvoice`) | Single rate (`computeEffectiveTax`) with a per-invoice override | ❌ | ❌ always empty |
| Live-session invoice (`createLiveSessionInvoice`) | Single rate (`computeEffectiveTax`, no override) | ❌ | ❌ always empty |

> Admin and live-session invoices **cannot print a CGST/SGST split** today: they never populate `aggregatedTaxComponents`. A template that needs the split on those documents must hardcode it from `{{tax_amount}}`.

All money is `BigDecimal`, rounded `HALF_UP` to 2 decimals. `taxRate` is stored as a **percentage** and divided by 100 before any arithmetic. (Older code that skipped the `/100` produced `1 + 18 = 19` divisors.)

### 6.1 Enrolment invoices: single-rate path

Used when `country.taxComponents` **and** `country.taxComponentsByPackageType` are both empty.

The amount the learner paid is the invoice total, and tax is **always backed out of it**:

```
total    = Σ payment amounts   (the gateway charge)
subtotal = round(total / (1 + taxRate/100), 2)
tax      = total − subtotal
```

`taxIncluded` changes only **presentation**:

- **`taxIncluded = true`**: each line is restated at its taxable (net) value (`restateLineItemsNetOfTax`). The line column sums to the subtotal, and tax appears once, in the totals block.
- **`taxIncluded = false`** (default): line prices are left as they are and a separate `TAX` line `"<taxLabel> @ <rate>%"` is appended.

### 6.2 Enrolment invoices: per-package-type components

Used when **either** `country.taxComponents` or `country.taxComponentsByPackageType` is non-empty. In that case `taxRate` is ignored for these invoices.

For each payment log (one per package in a multi-package `MP-` order):

```
packageType = UserPlan → EnrollInvite → PackageSessionLearnerInvitationToPaymentOption
              → PackageSession → PackageEntity.packageType           (resolvePackageType)
comps       = taxComponentsByPackageType[packageType]  if non-empty
              else taxComponents                        (effectiveTaxComponents)
rate        = Σ comps.rate / 100                        e.g. CGST 9 + SGST 9 → 0.18

lineSubtotal = round(lineAmount / (1 + rate), 2)
lineTax      = lineAmount − lineSubtotal
component_i  = round(lineSubtotal × rate_i / 100, 2)   for all but the last
component_n  = lineTax − Σ previous components          (last takes the remainder)
```

Per-line results are summed into invoice `subtotal` and `tax`, and per-label components are accumulated in order into `aggregatedTaxComponents`. `{{tax_components}}` renders this as a table of label, rate % and amount.

**The last component takes the remainder** so that the components add up to the tax charged *exactly*. Computing each independently rounds both up. For example, 4,571.43 × 2.5% = 114.29 twice gives 228.58 against a tax line of 228.57, which is wrong on the face of a GST invoice.

Package types with their own components: `COURSE`, `PRODUCT`, `SERVICE`, `MEMBERSHIP`, `DELIVERY_CHARGE`, `SECURITY_DEPOSIT`. An unresolvable type uses the default list. A configured but empty list for a type also falls back to the default. To make a type tax-free while a default list exists, give it an explicit `[{ "label": "GST", "rate": 0 }]`.

`taxIncluded` affects presentation exactly as in §6.1.

### 6.3 Admin-raised and live-session invoices

`computeEffectiveTax(settings, subtotal, requestTaxEnabled, requestTaxRatePercent)`. `subtotal` is Σ (unit price × quantity) of the admin's line items, after any admin discount line (see below).

| Request | Result |
|---|---|
| `tax_enabled = false` | No tax. `taxAmount=0`, `total=subtotal`, `taxRate=null`, `taxLabel=""`, so `{{tax_rate}}` renders blank and a template's "Tax ({{tax_rate}}%)" row does not print "Tax (0%)". |
| `tax_rate_percent` given | Replaces the institute's `taxRate` **for this invoice only**. |
| otherwise | Institute `taxRate`. |

Then:

```
taxIncluded = true :  tax = subtotal − round(subtotal / (1 + r), 2);  total = subtotal
taxIncluded = false:  tax = round(subtotal × r, 2);                   total = subtotal + tax
```

- For `taxIncluded=false` a `TAX` line `"<label> @ <rate>%"` is appended. `formatRate` keeps decimals: `12.5%` stays `12.5`, not `13`.
- Create, preview and update all call the same function, so the preview and the saved invoice cannot disagree.
- The effective label and rate are stored on the invoice data, so the PDF shows the rate actually used, not a fresh settings lookup.

**Admin discounts** (`request.adminDiscount`, V552) are turned into a negative `DISCOUNT` line ("Coupon CODE" or "Discount") on the **pre-discount** gross before tax is computed. Tax is therefore charged on the discounted amount. The grant's reason, mode and approver are stored in `invoice_data_json` but never printed.

Live-session invoices call `computeEffectiveTax(settings, price, null, null)`: institute `taxRate` and `taxIncluded`, no override.

### 6.4 Discounts and the totals block

- `discount_amount` comes from negative `payment_log_line_item` rows (coupon, referral, admin discount). If there are none, it comes from the CPO fee schedule (`student_fee_payment.original_amount − amount_expected`), **apportioned** to the share of the plan this payment covers (`feeScheduleDiscount`).
- `{{subtotal}}` means **pre-tax**, not pre-discount. Its meaning was deliberately left alone in V491, because most live templates pair it with `{{tax_amount}}`.
- Use `{{totals_rows}}` for a self-consistent block. It drops rows that do not apply:

  ```
  Amount        ₹1,396.00    (only when discounted)
  Discount     -₹  497.00    (only when discounted)
  GST           ₹  137.14    (only when tax > 0)
  Total Paid    ₹  899.00
  ```

- `{{plan_price}}` is the gross price. `{{discount_row}}` is a discount line that disappears when there is no discount.

### 6.5 Currency

- **Enrolment invoices:** `payment_log.currency`, else the plan's currency. Values are normalised and validated by `normalizeAndValidateCurrency`, which rejects junk like `#`.
- **Admin invoices:** the request's currency, else `INVOICE_SETTING.currency`.
- **Symbols:** from the currency code. `₹` and similar glyphs need a Unicode font on the classpath (`/fonts/NotoSans-Regular.ttf` or `/fonts/DejaVuSans.ttf`). Without one, the PDF falls back to ASCII symbols.

### 6.6 Amount in words

`{{amount_in_words}}` (receipt templates) uses Indian scale (lakh / crore) via `indianScale`.

---

## 7. Tax: platform → institute invoices (AI credits)

A separate, **Indian-GST-specific** system for credit packs Vacademy sells to institutes (V242).

### Supplier and buyer identity

- **Supplier:** the singleton active `platform_payment_config` row: legal name, address, `supplier_gstin`, `supplier_state_code`. V505 set GSTIN `23AAYFV8247N1Z3` with state code `23` (Madhya Pradesh). **The state code must match the first two digits of the GSTIN.**
- **Buyer:** the institute's `institutes.gstin` (15 chars) and `institutes.state_code` (2-digit numeric GST state code), both added in V239. The free-text `institutes.state` is **not** used for tax routing. The legacy `gst_details` column (V91) is ignored by this flow.

### Tax rule (`TaxResolver`, rates in basis points)

| Condition | Split | `place_of_supply` |
|---|---|---|
| Currency ≠ INR | 0% (export, zero-rated), `is_export=true` | `96` |
| INR and buyer state = supplier state | CGST 9% + SGST 9% (900 + 900 bps) | buyer state code |
| INR and buyer state ≠ supplier state | IGST 18% (1800 bps) | buyer state code |
| INR and buyer `state_code` is NULL | IGST 18%, conservatively treated as inter-state | supplier state code |

- All amounts are **minor units** (paise or cents) as `BIGINT`; rounding is `(amount × bps + 5000) / 10000`.
- On the invoice, an intra-state line's tax is split `cgst = tax/2`, `sgst = tax − cgst`, so the halves always sum to the line tax.

### Numbering

`INV-AICRED-YYYYMM-NNNN`, monthly, allocated atomically:

```sql
INSERT INTO ai_credit_invoice_sequence (yyyymm, last_no) VALUES (:m, 1)
ON CONFLICT (yyyymm) DO UPDATE SET last_no = ai_credit_invoice_sequence.last_no + 1
RETURNING last_no
```

The number is globally unique (`platform_invoice.invoice_number UNIQUE`).

Unlike institute invoices, this is a **side-table counter**. If the transaction rolls back after allocation, the upsert rolls back too, so there is no gap. A number is consumed for good only once the invoice commits.

### Immutability

Every supplier and buyer field is **snapshotted** on `platform_invoice` at issue time. Indian GST requires immutable invoices, so editing `institutes.gstin` later must not change history.

The one sanctioned exception is V505. It stamped the supplier GSTIN onto invoices issued while it was still NULL.

### Lifecycle

- Generated idempotently per `platform_payment_id` (DB `UNIQUE`) after a successful `razorpay-platform` webhook.
- The PDF is rendered **on demand** by `PlatformInvoicePdfService` (A4, DejaVuSans for `₹`). It is not stored in S3; `pdf_s3_url` stays NULL. The same bytes are attached to the purchase confirmation email.
- The line HSN/SAC comes from the pack snapshot (`hsn_sac_snapshot`).

---

## 8. Bill-To and institute identity defaults

The admin Create-Invoice dialog lets the admin edit text placeholders before issuing. Whatever they change is remembered for the next invoice.

**Per user: `invoice_billing_profile`** (V363, unique on `(user_id, institute_id)`). Holds `billing_name`, `billing_email`, `billing_address`, `tax_info` (the learner's GSTIN or VAT number) and `place_of_supply`.

- Only fields the admin **changed** from the live user record are upserted (`billingEditsFromOverrides`).
- The upsert runs in its own transaction; a failure never breaks invoice creation.
- `{{user_tax_info}}` comes **only** from here, since there is no user-record source for it.
- `{{place_of_supply}}` comes from here, falling back to the user's `region`.

**Institute-wide: `INVOICE_SETTING` overrides** (`InvoiceInstituteProfileService`). Holds `instituteNameOverride`, `instituteAddressOverride`, `instituteContactOverride` and `defaultNotes`.

- These are shared by every admin.
- An empty string clears a pinned value.

**Override whitelist.** Only these keys can carry admin text into the template (`EDITABLE_OVERRIDE_KEYS`):

```
invoice_number, user_name, user_email, user_address, user_tax_info, place_of_supply,
institute_name, institute_address, institute_contact, institute_email, institute_tagline,
tax_label, tax_rate, country, country_code, tax_registration_number, hsn_code, notes,
course_name, course_code, user_mobile, parent_name, year_group, billing_month, billing_year
```

- **Amounts, currency and HTML blocks can never be overridden.** Overriding `tax_rate` or `tax_label` changes only the *printed text*. To change the actual math, use the request's `tax_enabled` / `tax_rate_percent` fields (§6.3).
- In **bulk** creation (several users in one request) the user-scoped keys are stripped: `invoice_number, user_name, user_email, user_address, user_tax_info, place_of_supply, parent_name, year_group`. This stops one person's identity or invoice number leaking onto everyone's invoice.
- An `invoice_number` override is stored **unsequenced** (`seq_no = NULL`), so it never moves the counter. It must still be unique within the institute.

**Organisation Bill-To.** For a channel-partner (`SUB_ORG`) subscription, Bill-To is the **organisation** (the spawned sub-org institute's name and address), not the admin who paid (`organisationBillTo`). Learners enrolled under a partner are still billed personally.

---

## 9. Tax and numbering placeholders

These are the placeholders relevant to this document. The full list is in [`invoice-template-system.md`](./invoice-template-system.md). All are resolved in `InvoiceService.replaceTemplatePlaceholders`.

| Placeholder | Source |
|---|---|
| `{{invoice_number}}` | Allocated number (§3) or proforma number (§4) |
| `{{document_title}}` / `{{document_number_label}}` | `INVOICE` / `PROFORMA INVOICE`; "Invoice Number" / "Proforma Number" |
| `{{proforma_reference}}` | The former proforma number, on a finalised invoice |
| `{{subtotal}}` | Pre-tax amount |
| `{{tax_amount}}` | Total tax |
| `{{total_amount}}` | Invoice total |
| `{{plan_price}}` / `{{discount_amount}}` / `{{discount_row}}` | Gross price / discount / discount row hidden when zero |
| `{{totals_rows}}` | Self-consistent totals block (§6.4) |
| `{{tax_label}}` / `{{tax_rate}}` | **Effective** label and rate for this invoice; blank when tax is disabled |
| `{{tax_components}}` | Component table. Enrolment invoices with components configured only (§6). |
| `{{tax_registration_number}}` | `country.taxRegistrationNumber` (institute GSTIN / VAT) |
| `{{hsn_code}}` | `country.hsnSacCode` |
| `{{country}}` / `{{country_code}}` | `country.name` / `country.code` uppercased |
| `{{user_tax_info}}` | Buyer GSTIN / VAT from the billing profile |
| `{{place_of_supply}}` | Billing profile, else the user's region |
| `{{currency}}` / `{{currency_symbol}}` | Invoice currency |
| `{{amount_in_words}}` | Total in words, Indian scale |
| `{{terms_and_conditions}}` | Per package → session → level → default |

The Create-Invoice review panel shows only the placeholders that **appear in the institute's template**, grouped as `INVOICE`, `BILL TO`, `INSTITUTE`, `TAX`, `AMOUNTS`, `NOTES` and `RECEIPT` (`PLACEHOLDER_META`).

---

## 10. Data model and migrations

### Columns added to `invoice` after V64

| Column | Migration | Purpose |
|---|---|---|
| `source`, `source_id` | V375 | `USER_PLAN` / `STUDENT_FEE_PAYMENT` / `ADMIN_MANUAL` / `LIVE_SESSION` + originating id |
| `seq_no`, `seq_scope_key` | V432 | The numbering counter (§3.5). NULL for unsequenced numbers. |

### Constraints and indexes that matter

| Object | Migration | Notes |
|---|---|---|
| `uq_invoice_institute_number (institute_id, invoice_number)` | V432 | Load-bearing: serialises concurrent allocation. Replaced the global `invoice_invoice_number_key`. |
| `idx_invoice_seq_allocation (institute_id, seq_scope_key, seq_no DESC)` | V432 | Makes `MAX(seq_no)` a single backward index scan. |
| `idx_invoice_invoice_number` | V64 | Kept on purpose: some bare-number lookups remain. |
| `uq_invoice_released_number (institute_id, seq_scope_key, seq_no)` | V531 | One released row per position. |
| `uq_invoice_billing_profile_user_institute` | V363 | One Bill-To profile per user per institute. |

### Migration timeline

| Version | Change |
|---|---|
| V64 | `invoice`, `invoice_line_item`, `invoice_payment_log_mapping`. Global unique invoice number. |
| V239 | `institutes.currency`, `institutes.gstin`, `institutes.state_code` |
| V242 | `platform_invoice`, `platform_invoice_line_item`, `ai_credit_invoice_sequence` |
| V363 | `invoice_billing_profile` |
| V375 | `invoice.source/source_id`, `user_account_ledger` |
| V432 | Configurable numbering: `seq_no`, `seq_scope_key`, backfill, per-institute uniqueness |
| V491 | Seeded sample template: `Subtotal/Discount/Total` → `{{totals_rows}}` |
| V505 | Supplier GSTIN / state code on `platform_payment_config`, stamped onto existing platform invoices |
| V531 | `invoice_released_number` |

---

## 11. API reference

Only numbering, tax and configuration endpoints are listed here. Invoice CRUD and payment endpoints are in [`invoices.md` § API Reference](./invoices.md#api-reference).

### Numbering settings: `/admin-core-service/v1/invoices/numbering`

| Method | Path | Body / params | Returns |
|---|---|---|---|
| `GET` | `/tokens` | none | `TokenInfo[]`: `key`, `label`, `group`, `example`, `lazy`, `riskyForTax` |
| `GET` | `/state?instituteId=` | none | `NumberingState`: `currentFormat`, `seqScope`, `currentExample`, `lastIssuedNumber`, `nextSequence`, `existingInvoiceCount` |
| `POST` | `/preview` | `{ instituteId, format, seqPadding, seqScope, instituteCode, fyStartMonth, sanitizeTokens, startFrom }` | `PreviewResponse`: `valid`, `samples[3]`, `errors[]`, `warnings[]`, `nextSequence`, `highestIssuedSequence`, `maxLength` |

- Nothing here consumes a number.
- There is **no write endpoint**. The `numbering` block is saved with the rest of `INVOICE_SETTING` through the generic institute-settings save, because splitting the write would allow two round-trips to overwrite each other.

### Settings

`INVOICE_SETTING` is read and written through the generic institute settings endpoints (`GET_INSITITUTE_SETTINGS` / `SAVE_INSTITUTE_SETTING` in the frontend), with key `INVOICE_SETTING` and setting name `"Invoice Setting"`.

### Tax-relevant fields on `POST /v1/invoices/admin/create` and `/admin/preview`

```jsonc
{
  "user_ids": ["…"],
  "institute_id": "…",
  "line_items": [{ "description": "…", "quantity": 1, "unit_price": 5000, "item_type": "SERVICE" }],
  "currency": "INR",
  "due_date": "…",
  "invoice_date": "…",     // optional
  "notes": "…",
  "tax_enabled": true,     // false = no tax on this invoice
  "tax_rate_percent": 12.5, // percent; overrides INVOICE_SETTING.taxRate for this invoice
  "admin_discount": { … }, // optional, V552
  "overrides": { "user_tax_info": "27ABCDE1234F1Z5", "place_of_supply": "Maharashtra" }
}
```

`PUT /v1/invoices/{id}` (edit) accepts the same line-item and tax fields. It is only allowed while the invoice is `PENDING_PAYMENT`.

### Platform billing (super-admin)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/admin-core-service/super-admin/v1/platform-billing/bootstrap-config` | Create the supplier config row |
| `GET` | `/admin-core-service/super-admin/v1/platform-billing/config` | Read supplier config |
| `POST` | `/admin-core-service/super-admin/v1/platform-billing/fulfill-payment/{platformPaymentId}` | Manually fulfil a payment (credits + invoice) |
| `POST` | `/admin-core-service/payments/webhook/callback/razorpay-platform` | Razorpay webhook for credit purchases |

---

## 12. Admin UI

**Settings → Invoice Settings** (`frontend-admin-dashboard/src/routes/settings/-components/Invoice/`):

| Section | File | Controls |
|---|---|---|
| General | `InvoiceSettings.tsx` | `taxIncluded`, `taxRate`, `taxLabel`, `currency`, `sendInvoiceEmail`, `invoicePdfPlacement`, `sendAdminCopy` + admin picker, `proformaEnabled` (warns that the `PRO-` prefix is added unless the format uses `{{doc_type}}`), `generateInvoiceOnManualEnroll` |
| Country & Tax Details | `InvoiceSettings.tsx` | Country picker, which applies a tax preset and currency (below), `taxRegistrationNumber`, `hsnSacCode`, default components, per-package-type components |
| Numbering | `InvoiceNumberingSection.tsx`, `InvoiceNumberingChangeDialog.tsx` | Format builder with a click-to-insert token palette, live 3-sample preview, scope, padding, FY start month, institute code, start-from. The change dialog shows existing history and escalates to type-to-confirm for ⚠ tokens. |
| Templates | `InvoiceTemplatesSection.tsx`, `sample-invoice-templates.ts` | INVOICE / INVOICE_EMAIL templates |

**Country presets** (`COUNTRY_TAX_PRESETS`). These are only *suggestions*, applied when a country is picked and no components exist yet:

| Country | Components | Currency |
|---|---|---|
| India `in` | CGST 9 + SGST 9 | INR |
| UK `gb` | VAT 20 | GBP |
| UAE `ae` | VAT 5 | AED |
| Australia `au` | GST 10 | AUD |
| Singapore `sg` | GST 9 | SGD |
| US `us` | Sales Tax 0 | USD |
| Canada `ca` | GST 5 | CAD |
| Germany `de` | VAT 19 | EUR |
| France `fr` | VAT 20 | EUR |

**Create Invoice dialog** (`student-payment-history/create-invoice-dialog.tsx`): per-invoice tax toggle and rate override, admin discount, editable placeholders, and a live preview including the number it will issue.

---

## 13. Known limitations and gotchas

1. **No CGST/SGST vs IGST routing for institute invoices.** Components are whatever the admin configured. The learner's state is never compared with the institute's, so an inter-state sale configured as CGST+SGST is printed that way. Only platform invoices (§7) route automatically.
2. **Admin and live-session invoices ignore components.** They use only `taxRate`, and `{{tax_components}}` is empty for them (§6).
3. **Enrolment-invoice tax is always backed out of the amount paid**, whatever `taxIncluded` says (§6.1). If the checkout charged a pre-tax price, the invoice will under-state the taxable value rather than add tax on top.
4. **`YEARLY` scope is the calendar year**, not the financial year (§3.5).
5. **The 16-character GST serial limit is not validated**, only the 100-character limit (§3.9).
6. **Tax rate is a percentage.** Any new code reading `taxRate` must divide by 100.
7. **Never look up by bare `invoice_number`.** Since V432 it is unique only per institute.
8. **Always persist `seq_no` and `seq_scope_key`.** A row saved without them is invisible to the counter, and its number will be handed out again. The unique constraint catches that, but only after a wasted PDF render.
9. **Never write a partial `INVOICE_SETTING`.** It is a full overwrite (§2).
10. **Fallback numbers** `INV-<scopeKey>-<HEX>` in the data mean the allocator hit 25 consecutive taken numbers. Look for the ERROR log "Could not find a free invoice number" and fix the institute's format.
11. **Platform-invoice supplier state code must match the GSTIN prefix**, or the CGST+SGST vs IGST decision is wrong.

---

## 14. Code map

All backend paths are under `admin_core_service/src/main/java/vacademy/io/admin_core_service/features/`.

| Concern | File |
|---|---|
| Settings parse (numbering) | `invoice/dto/InvoiceNumberConfig.java` |
| Token catalogue | `invoice/enums/InvoiceNumberToken.java` |
| Reset windows | `invoice/enums/InvoiceSeqScope.java` |
| Format validate + render (pure) | `invoice/util/InvoiceNumberFormatter.java` |
| Allocation, reuse, collision retry | `invoice/service/InvoiceNumberService.java` |
| Token values | `invoice/dto/InvoiceNumberContext.java` |
| Settings preview / state | `invoice/service/InvoiceNumberingSettingsService.java`, `invoice/controller/InvoiceNumberingController.java` |
| Invoice build, tax math, proforma, placeholders | `invoice/service/InvoiceService.java`: `buildInvoiceDataFromMultiplePaymentLogs`, `computeEffectiveTax`, `allocateInvoiceNumber`, `renderAndSaveWithCollisionRetry`, `allocateProformaNumber`, `finalizeProformaOnPayment`, `replaceTemplatePlaceholders`, `buildTotalsRowsHtml` |
| PDF placement enum | `invoice/enums/InvoicePdfPlacement.java` |
| Bill-To memory | `invoice/service/InvoiceBillingProfileService.java` |
| Institute identity memory | `invoice/service/InvoiceInstituteProfileService.java` |
| Admin copies | `notification_service/service/InvoiceAdminCopyRecipientResolver.java` |
| Receipt numbering | `fee_management/service/SchoolFeeReceiptService.java`, `fee_management/service/ApplicationFeeReceiptService.java` |
| Number release on delete | `user_subscription/service/PaymentDeletionService.java` (`removeInvoiceRows`) |
| Platform GST | `credits/util/TaxResolver.java`, `platform_billing/service/PlatformInvoiceService.java`, `platform_billing/service/PlatformInvoicePdfService.java` |
| Tests | `src/test/.../invoice/util/InvoiceNumberFormatterTest.java`, `invoice/service/InvoiceNumberReuseTest.java`, `InvoiceTotalsRowsTest.java`, `MultiCourseOrderInvoiceGroupingTest.java`, `PlaceholderSubstitutionCoverageTest.java`, `ReceiptAmountInWordsTest.java` |
| Frontend settings | `frontend-admin-dashboard/src/routes/settings/-components/Invoice/*` |
