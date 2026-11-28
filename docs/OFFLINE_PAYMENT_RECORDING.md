# Recording Offline Payments: Mode, Sub-mode and Reference

**Status:** Phases 1–3 built 2026-10-14; phase 4 proposed. See [§8](#8-phases).

When an admin marks a payment as received (cash at the counter, a UPI transfer to the
institute's PhonePe, a cheque), record **how** it was paid in a structured way, using options
the institute sets up once in Settings.

Related: [payment-system.md](./payment-system.md), [CPO_FLEXIBLE_INSTALLMENTS.md](./CPO_FLEXIBLE_INSTALLMENTS.md).

---

## 1. What happens today

There are eleven admin paths that record a payment by hand (vendor `MANUAL` or `OFFLINE`). None
stores a structured mode:

| # | Path | Collected today | Where the reference ends up |
|---|---|---|---|
| A | Enroll wizard, fee plan, "Record offline payment" | amount, reference | `payment_specific_data.transaction_id` |
| B | Enroll wizard, other plans, payment date / transaction id | date, reference | `payment_specific_data.transaction_id` |
| C | Student side view → Fee Plan → Record offline payment; sub-org "Record payment" | amount, date, reference | `payment_specific_data.transaction_id` |
| D | `POST /v1/admin/student-fee/{userId}/allocate` | amount only | nothing |
| E | Fee Management → Pay installments | **mode pills** (Cash/Online/UPI/Card/Cheque), transaction id, remarks | folded into `student_fee_allocation_ledger.remarks` as `"Mode: X \| Txn ID: Y"`; receipts parse that text back |
| F | Mark invoice paid manually (admin invoices, paid live classes) | transaction id, notes | `payment_specific_data.transaction_id`, `notes` |
| G | Sub-org add member with offline payment | amount, date, reference | `payment_specific_data.transaction_id` |
| H | Admissions fee assignment (school enroll) | proof file, transaction id | `payment_specific_data.manual.transaction_id` |
| I | Enroll manually (admin direct enroll) | proof file, transaction id | `payment_specific_data.manual.transaction_id` |
| J | Applicant manual payment | method cards (UI only), transaction id, proof | `payment_specific_data.transactionRef` |
| K | v2 enroll with enrollment type MANUAL | — | logged under the invite's gateway, not MANUAL |

Consequences:
- **The mode is lost.** Only path E asks for it, and stores it as text. Dashboards group by
  `vendor`, so every manual payment shows as "Cash" or "Offline", a cheque included.
- **The reference is invisible after saving.** `PaymentLog.mapToDTO()` does not return
  `payment_specific_data`, so Manage Payments, the CSV export and invoices never show the
  transaction id the admin typed; invoices print `MANUAL` as both method and transaction id.
- **Three different JSON keys** hold the same reference (`transaction_id`, `manual.transaction_id`,
  `transactionRef`).

## 2. What we want

```
Record payment                                   (all optional unless the institute requires a mode)
  Amount   ₹ 9,000
  Mode     ( Cash ) ( UPI ) ( Bank transfer ) ( Cheque ) ( Card / POS )
  Via      ( PhonePe ) ( Google Pay ) ( Paytm )             ← sub-options of the chosen mode
  UPI transaction ID  [ 4182 9921 7731 ]                    ← label set per mode
  Date     [ 14 Oct 2026 ]   Notes [ … ]   Proof [ upload ]
```

- The institute defines the modes and their sub-options once, in **Settings → Payment Settings →
  Offline payment modes**.
- Every admin "record payment / mark paid" dialog shows the same fields.
- The choice is stored in columns, shown in Manage Payments, the CSV export, dashboards,
  receipts and invoices, and can be filtered on.

## 3. Data

New nullable columns on `payment_log` (additive; existing rows stay as they are):

| Column | Type | Example |
|---|---|---|
| `payment_mode` | VARCHAR(40) | `UPI` |
| `payment_sub_mode` | VARCHAR(80) | `PHONEPE` |
| `payment_reference` | VARCHAR(255) | `418299217731` (UPI ref, UTR, cheque number) |
| `payment_details_json` | TEXT | `{"mode_label":"UPI","sub_mode_label":"PhonePe","cheque_date":null,"bank_name":null,"payer_name":"…","proof_file_id":"…","notes":"…"}` |
| `recorded_by_user_id` | VARCHAR(255) | admin who recorded it |

- Columns, not JSON keys, because dashboards and filters group by mode.
- Labels are **snapshotted** in `payment_details_json`, so renaming an option in Settings later
  does not rewrite history.
- `payment_reference` becomes the one place for the reference. The writer also keeps
  `payment_specific_data.transaction_id` for older readers.
- An index on `payment_mode` is added only if the dashboards need it.

## 4. Settings

Stored per institute in its own table, `institute_offline_payment_setting` (V577), **not** in
`institutes.setting_json`: parts of that blob are served to learners and the public, and these
options can name bank accounts. Read by institute staff, written by institute admins, through
`GET`/`PUT /admin-core-service/v1/institute/offline-payment-modes?instituteId=`. An institute
that has not saved its own gets the system defaults below.

```json
{
  "require_mode": false,
  "default_mode": "CASH",
  "modes": [
    { "code": "CASH", "label": "Cash", "active": true, "sub_modes": [] },
    { "code": "UPI", "label": "UPI", "active": true, "reference_label": "UPI transaction ID",
      "sub_modes": [
        { "code": "PHONEPE", "label": "PhonePe", "active": true },
        { "code": "GPAY", "label": "Google Pay", "active": true },
        { "code": "PAYTM", "label": "Paytm", "active": true }
      ] },
    { "code": "BANK_TRANSFER", "label": "Bank transfer (NEFT/IMPS/RTGS)", "active": true,
      "reference_label": "UTR number",
      "sub_modes": [ { "code": "HDFC_CURRENT", "label": "HDFC current ••4321", "active": true } ] },
    { "code": "CHEQUE", "label": "Cheque", "active": true, "reference_label": "Cheque number",
      "extra_fields": ["cheque_date", "bank_name"] },
    { "code": "DD", "label": "Demand draft", "active": true, "reference_label": "DD number",
      "extra_fields": ["bank_name"] },
    { "code": "CARD_POS", "label": "Card (POS machine)", "active": true, "reference_label": "Approval code" }
  ]
}
```

Rules:
- Codes are generated from the label when an option is added and never change; labels can be
  edited. An option that has been used is deactivated, not deleted, so old payments still
  resolve.
- Sub-options belong to one mode. Typical uses: which UPI app or merchant handle, which bank
  account received the transfer, which POS machine.
- `require_mode = true` makes the mode mandatory in every record-payment dialog; otherwise it
  is optional and defaults to `default_mode`.
- Per mode, `reference_required` and `proof_required` make the reference or a proof file
  mandatory for that mode.
- The PUT sends the whole object; codes left blank are derived from the label.

Per-mode fields and options (added after phase 3):
- `sub_mode_label` names the options in the dialogs ("Account", "App"); `sub_mode_required`
  makes picking one mandatory when the mode has an active option. Mode and options are
  dropdowns in every dialog.
- `required_extra_fields` marks built-in extras (`cheque_date`, `bank_name`, `payer_name`) as
  mandatory; it is a subset of `extra_fields`.
- `custom_fields` are the institute's own inputs for the mode:
  `{ "key", "label", "type": "TEXT|DATE|NUMBER|SELECT", "required", "active", "options" }`.
  The key is derived from the label on first save and never changes; a used field is switched
  off, not deleted. A `SELECT` needs at least one choice. At most 20 per mode.

```json
{ "code": "CHEQUE", "label": "Cheque", "reference_label": "Cheque/DD No.", "reference_required": true,
  "extra_fields": ["cheque_date", "bank_name"], "required_extra_fields": ["cheque_date", "bank_name"],
  "sub_mode_label": "Account", "sub_mode_required": true,
  "sub_modes": [ { "code": "CURRENT_ACCOUNT", "label": "Current account ••4321", "active": true } ],
  "custom_fields": [
    { "key": "bank_branch_name", "label": "Bank branch name", "type": "TEXT", "required": false, "active": true },
    { "key": "cheque_status", "label": "Cheque status", "type": "SELECT", "required": true, "active": true,
      "options": ["Pending", "Cleared", "Bounced"] } ] }
```

On a payment, values travel as `payment_details.custom` (`{ key: value }`) and are checked
(required, date `YYYY-MM-DD`, number, dropdown choice). They are stored in
`payment_details_json.custom_fields` as `[{ "key", "label", "value" }]`, so the label as it was
at recording time survives later edits, and no field key can shadow `mode_label` or `notes`.

## 5. API

One shared optional block, accepted by every admin record-payment request next to its current
fields:

```json
"payment_details": {
  "mode": "UPI",
  "sub_mode": "PHONEPE",
  "reference": "418299217731",
  "payment_date": "2026-10-14",
  "notes": "Paid by father",
  "proof_file_id": "…",
  "extra": { "cheque_date": null, "bank_name": null, "payer_name": "R. Sharma" }
}
```

- Validated on the server against the institute's setting: the mode must be an active code, the
  sub-mode must belong to it, and the mode must be present when `require_mode` is on.
- The existing fields (`payment_reference`, `transaction_id`, `reference`, `notes`, payment date)
  keep working. When both are sent, `payment_details` wins.
- One writer, `OfflinePaymentDetailsService.apply(paymentLogId, details, instituteId, adminUserId)`,
  called right after each path creates its PaymentLog, so the eleven paths cannot drift again.
- Wired into paths A, B, C, E, F and G: `cpo_config.payment_details` / `options.payment_details`
  (Enroll wizard), `payment_details` on record-offline-payment, allocate-selected and
  mark-paid-manual, `offline_payment_details` on sub-org add member. The bulk-assign and sub-org
  paths validate before anyone is enrolled.

## 6. Where it shows

| Surface | Change |
|---|---|
| Manage Payments table | "Method" shows `UPI · PhonePe` for manual payments (gateway badge otherwise); new filter by mode |
| Payment detail sheet | Mode, sub-mode, reference, notes, proof link, recorded by |
| CSV export | `Mode`, `Sub-mode`, `Reference`, `Recorded by` columns |
| Payment dashboard, Collection dashboard | Group by `payment_mode` when set, falling back to today's vendor mapping, so cheques stop showing as cash |
| Receipts (`{{payment_mode}}`) and invoices (`{{payment_method}}`, `{{transaction_id}}`) | Mode label (+ sub-mode) and the real reference instead of `MANUAL`; new `{{payment_reference}}` placeholder |
| Pay installments receipts | Read the columns instead of parsing `"Mode: …"` out of remarks text |

`PaymentLog.mapToDTO()` gains `payment_mode`, `payment_sub_mode`, `payment_reference`,
`payment_details` and `recorded_by_user_id`.

## 7. Admin UI

- **Settings → Payment Settings → Offline payment modes:** list of modes with label, active
  switch, reference label, extra fields, and their sub-options (add, rename, reorder,
  deactivate). Plus "Require a mode when recording a payment" and the default mode.
- **One shared component** `OfflinePaymentFields` (mode chips → sub-mode chips → reference with
  the mode's label → date → notes → optional proof upload), used in:
  - Enroll wizard: fee-plan offline payment (A) and payment date / transaction id (B)
  - Student side view: Fee Plan → Record offline payment (C), mark invoice paid (F)
  - Fee Management → Pay installments (E), replacing its local mode pills
  - Sub-org: mark paid, record payment, add member (C, F, G)
  - Admissions payment and fee assignment (H, J), Enroll manually (I)

## 8. Phases

| Phase | Scope |
|---|---|
| 1 ✅ | Migration V577; `institute_offline_payment_setting` + defaults + GET/PUT endpoint (`OfflinePaymentModeService`); `OfflinePaymentDetailsService`; `payment_details` on paths A, B, C, E, F, G; `mapToDTO` fields; Pay-installments receipts print the mode and reference |
| 2 ✅ | Settings UI (`OfflinePaymentModesSettings`); shared `OfflinePaymentFields`; dialogs for A, B, C, E, F, G wired (Pay installments' hard-coded mode buttons replaced) |
| 3 ✅ | Manage Payments: method column shows "UPI · PhonePe", detail sheet shows mode, reference, extras, notes and proof; CSV adds Paid Via and Payment Reference; collection dashboard groups by recorded mode (manual payments without one show as "Offline (mode not recorded)", no longer "Cash"); invoices print the mode and the admin's reference. Not yet: a filter by mode, and the payment dashboard |
| 4 | Remaining paths H, I, J, K (K logged as MANUAL) and path D |

## 9. Open points

- Should proof upload be required for some modes (e.g. bank transfer)? Proposed: an optional
  `proof_required` flag per mode.
- Backfill: path E's old remarks text could be parsed into `payment_mode` once. Proposed: skip;
  new payments only.
