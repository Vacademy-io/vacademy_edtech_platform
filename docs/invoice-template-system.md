# Invoice Template System & Email Sending Documentation

## Overview

The invoice system supports two customizable templates per institute, both created via the **easy-email editor** at `/templates/create`:

| Template Type | DB `type` column | Purpose |
|---------------|-----------------|---------|
| **Invoice (PDF Layout)** | `INVOICE` | Defines how the invoice PDF looks — layout, branding, line items table |
| **Invoice Email** | `INVOICE_EMAIL` | Defines the email body sent to the learner with the PDF attached |

Both are stored in the `templates` table in **admin_core_service**.

---

## 1. Template Creation (Frontend)

### How to Create

1. Navigate to **Settings → Templates → Create Template**
2. The easy-email MJML editor opens
3. In the toolbar, set:
   - **Template Name**: e.g., "My Institute Invoice"
   - **Subject**: e.g., "Your Invoice {{invoice_number}}"
   - **Category**: Select **"Invoice (PDF Layout)"** or **"Invoice Email"**
   - **Preview Text** (optional, for Invoice Email): Text shown in inbox before opening

### Available Placeholders

When Category is set to INVOICE or INVOICE_EMAIL, these merge tags appear in the editor's **Dynamic Values** panel:

| Placeholder | Description | Available In |
|-------------|-------------|-------------|
| `{{invoice_number}}` | Invoice number (e.g., INV-INST-20260401-001) | PDF + Email |
| `{{user_name}}` | Learner's full name | PDF + Email |
| `{{line_items}}` | HTML table of invoice line items (plans, discounts, taxes) | PDF only |
| `{{total_amount}}` | Total amount (e.g., 5000.00) | PDF + Email |

**Additional placeholders resolved automatically in the PDF layout** (from the existing `replaceTemplatePlaceholders` method):

| Placeholder | Description |
|-------------|-------------|
| `{{invoice_date}}` | Invoice date (dd MMM yyyy) |
| `{{due_date}}` | Payment due date |
| `{{institute_name}}` | Institute name |
| `{{institute_address}}` | Institute address |
| `{{institute_contact}}` | Institute phone/email |
| `{{institute_logo}}` | Base64-encoded logo HTML |
| `{{theme_color}}` | Brand color (default: #124a34) |
| `{{user_email}}` | Learner email |
| `{{user_address}}` | Learner address |
| `{{currency_symbol}}` | ₹, $, € etc. |
| `{{subtotal}}` | Subtotal before tax/discount |
| `{{discount_amount}}` | Discount amount |
| `{{tax_amount}}` | Tax amount |
| `{{payment_method}}` | Payment method used |
| `{{transaction_id}}` | Transaction ID |
| `{{payment_date}}` | Payment date |
| `{{country}}` | Operating country name (from `INVOICE_SETTING.country`) |
| `{{country_code}}` | ISO country code, uppercased (e.g. `IN`) |
| `{{tax_registration_number}}` | Institute's tax registration number (GSTIN / VAT no.) |
| `{{hsn_code}}` | HSN/SAC code (SAC for services such as courses) |
| `{{tax_components}}` | HTML table of tax components (label, rate %, computed amount). Computed **per line item by package type** and summed across the invoice — see "Per-package-type tax" below |
| `{{tax_label}}` | Tax line label from settings (e.g. `GST`) |
| `{{tax_rate}}` | Default tax rate % from settings |

> These country/tax values are configured in **Settings → Invoice Settings → Country & Tax Details** and resolved in `InvoiceService.replaceTemplatePlaceholders`.

**Additional placeholders in the Invoice Email body:**

| Placeholder | Description |
|-------------|-------------|
| `{{learner_name}}` | Alias for `{{user_name}}` |
| `{{invoice_pdf_link}}` | PDF download link or "PDF attached" message |

### What Gets Saved

When you click **Save Template**, the following is stored in the `templates` table:

```
┌─────────────┬────────────────────────────────────────────┐
│ Column      │ Value                                      │
├─────────────┼────────────────────────────────────────────┤
│ type        │ "INVOICE" or "INVOICE_EMAIL"               │
│ name        │ Template name from toolbar                 │
│ subject     │ Email subject from toolbar                 │
│ content     │ Full HTML (MJML compiled to HTML)          │
│ setting_json│ JSON with: mjml, templateType, previewText │
│ institute_id│ Current institute ID                       │
└─────────────┴────────────────────────────────────────────┘
```

The `setting_json` stores the MJML editor state so the template can be re-opened and edited later.

---

## 2. Invoice PDF Generation Flow

### Trigger

Invoice generation is triggered automatically when a payment status is set to **PAID**:

```
Payment Confirmed (status = PAID)
  → PaymentLogService.handlePostPaymentLogic()
    → InvoiceService.generateInvoice(UserPlan, PaymentLog, instituteId)
```

### Steps

```
1. Check if payment log is already invoiced (prevent duplicates)
        │
2. Detect multi-package enrollment (orderId prefix "MP")
        │
3. Aggregate data from related payment logs
        │
4. Generate invoice number: INV-{instituteId}-{YYYYMMDD}-{sequence}
        │
5. Load PDF template:
   ┌──────────────────────────────────────────────────────┐
   │ Query: templates WHERE institute_id = ? AND type = 'INVOICE'  │
   │        ORDER BY created_at DESC                      │
   │ Pick: INVOICE_SETTING.defaultInvoiceTemplateId if it │
   │       is in the list, else the newest                │
   │                                                      │
   │ Found? → Use template content (HTML)                 │
   │ Not found? → Use default_invoice.html from resources │
   └──────────────────────────────────────────────────────┘
        │
6. Replace all {{placeholders}} with actual values
   (invoice_number, user_name, line_items, totals, institute info, etc.)
        │
7. Generate PDF from HTML using OpenHTML2PDF
        │
8. Upload PDF to S3 → get pdf_file_id
        │
9. Save Invoice entity + InvoiceLineItems + InvoicePaymentLogMappings
        │
10. Send invoice email (if enabled)
```

### Key Code Location

- **Template loading**: `InvoiceService.loadInvoiceTemplate()` (line ~871)
- **Placeholder replacement**: `InvoiceService.replaceTemplatePlaceholders()` (line ~926)
- **PDF generation**: `InvoiceService.generatePdfFromHtml()` (uses OpenHTML2PDF)
- **Default template**: `resources/templates/invoice/default_invoice.html`

---

## 3. Invoice Email Sending Flow

### Prerequisite: Institute Setting

The email is only sent if the institute has enabled it:

```json
// Institute settings JSON → INVOICE_SETTING object
{
  "sendInvoiceEmail": true,    // Must be true (default: false)
  "generateInvoiceOnManualEnroll": false, // invoice on manual/bulk enroll
  "taxIncluded": false,
  "taxRate": 18.0,
  "taxLabel": "GST",
  "currency": "INR",
  "country": {
    "code": "in",
    "name": "India",
    "taxRegistrationNumber": "22AAAAA0000A1Z5",
    "hsnSacCode": "999293",   // SAC for education services
    "taxComponents": [        // default components (fallback)
      { "label": "CGST", "rate": 9 },
      { "label": "SGST", "rate": 9 }
    ],
    "taxComponentsByPackageType": {   // optional per-package-type overrides
      "PRODUCT": [ { "label": "GST", "rate": 18 } ],
      "COURSE":  []                   // empty -> falls back to default
    }
  }
}
```

### Per-package-type tax

When `taxComponents` or `taxComponentsByPackageType` is configured, invoice tax is
computed **per line item by the line's package type** (`COURSE`, `PRODUCT`, `SERVICE`,
`MEMBERSHIP`, `DELIVERY_CHARGE`, `SECURITY_DEPOSIT`), each line using its type's
components or the default set, then summed across the invoice. `{{tax_components}}`
renders the aggregated breakdown. The package type is resolved via
UserPlan → EnrollInvite → PackageSession → PackageEntity.packageType. When **no**
components are configured, the legacy single-`taxRate` computation runs unchanged.

This is configured in **Settings → Invoice Settings** (admin dashboard), which also lists
the INVOICE / INVOICE_EMAIL templates with shortcuts to create one of each type. Each list
marks the template in use with a "Default" badge and lets the admin pick another one with
"Set as default" (stored as `defaultInvoiceTemplateId` / `defaultInvoiceEmailTemplateId`
in INVOICE_SETTING). With no default picked, or once the default is deleted, the newest
template is used, as before.

### Template Lookup Priority

```
1. First: Query templates WHERE type = 'INVOICE_EMAIL' AND institute_id = ?
         ORDER BY created_at DESC → use INVOICE_SETTING.defaultInvoiceEmailTemplateId
         if it is in the list, else the most recent
         
2. Fallback: Query templates WHERE type = 'EMAIL' AND name = 'Invoice Email'
             AND institute_id = ? → legacy support
             
3. Default: Built-in email body (hardcoded in buildDefaultInvoiceEmailBody())
```

### Email Sending Steps

```
1. Check: Is user email valid? Is institute found?
        │
2. Check: Is sendInvoiceEmail = true in INVOICE_SETTING?
   │     (If false → skip, log "Invoice email disabled")
   │
3. Load email template (priority above)
        │
4. Replace placeholders:
   {{invoice_number}} → actual invoice number
   {{user_name}}      → learner full name
   {{learner_name}}   → learner full name (alias)
   {{total_amount}}   → total amount
   {{invoice_pdf_link}}→ PDF download URL or "attached" message
        │
5. Attach PDF (if pdfBytes available):
   ┌─ Mode A: PDF attached ─────────────────────────┐
   │ Create Base64-encoded attachment                │
   │ Send via notificationService                    │
   │   .sendAttachmentEmailViaUnified()              │
   └─────────────────────────────────────────────────┘
   ┌─ Mode B: Download link ────────────────────────┐
   │ Include PDF download URL in email body          │
   │ Send via notificationService                    │
   │   .sendEmailViaUnified()                        │
   └─────────────────────────────────────────────────┘
        │
6. Log success/failure (email failure does NOT fail invoice generation)
```

### Key Code Location

- **Email sending**: `InvoiceService.sendInvoiceEmail()` (line ~1492)
- **Settings check**: `InvoiceService.getInvoiceSettings()` (line ~805)
- **Default email body**: `InvoiceService.buildDefaultInvoiceEmailBody()`

---

## 4. Invoice API Endpoints

### Existing Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin-core-service/v1/invoices/{invoiceId}` | Get invoice by ID |
| `GET` | `/admin-core-service/v1/invoices/user/{userId}` | List user's invoices |
| `GET` | `/admin-core-service/v1/invoices/{invoiceId}/download` | Download invoice PDF (redirect to S3) |

### New Endpoint

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin-core-service/v1/invoices/institute/{instituteId}` | List invoices for institute (paginated) |

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `page` | int | No | 0 | Page number (zero-based) |
| `size` | int | No | 20 | Page size |
| `userId` | string | No | — | Filter by user ID |
| `status` | string | No | — | Filter by status (GENERATED, SENT, VIEWED) |
| `startDate` | ISO DateTime | No | — | Filter invoices from this date |
| `endDate` | ISO DateTime | No | — | Filter invoices until this date |

**Example:**
```
GET /admin-core-service/v1/invoices/institute/3e535c8e-5566-43b9-8297-7418c4f38feb?page=0&size=20&status=GENERATED
```

**Response:** Spring `Page<InvoiceDTO>` with `content`, `totalElements`, `totalPages`, `first`, `last`.

---

## 5. Invoice Display in Admin Dashboard

### Where Invoices Appear

Invoices are shown in the **Payment History** tab of the student side-view panel. This panel appears in:

1. **Manage Students** → click a student → side panel → Payment History tab
2. **Manage Contacts** → click a contact → side panel → Payment History tab

Both locations use the same `StudentPaymentHistory` component.

### What Admin Sees

```
┌─────────────────────────────────────────────────────┐
│ 📄 Invoices (3)                                     │
├──────────┬────────────┬──────────┬────────┬─────────┤
│ Invoice #│ Date       │ Amount   │ Status │ Action  │
├──────────┼────────────┼──────────┼────────┼─────────┤
│ INV-001  │ 01 Apr 2026│ ₹5,000.00│ SENT   │[Download]│
│ INV-002  │ 15 Mar 2026│ ₹3,500.00│GENERATED│[Download]│
│ INV-003  │ 01 Mar 2026│ ₹7,200.00│ VIEWED │[Download]│
└──────────┴────────────┴──────────┴────────┴─────────┘
│ 1-3 of 3                              [< ] [> ]    │
└─────────────────────────────────────────────────────┘

Payment History for John Doe
┌─ Payment Logs Table ────────────────────────────────┐
│ (existing payment logs table)                       │
└─────────────────────────────────────────────────────┘
```

### Download

Clicking **Download** either:
- Opens the `pdf_url` directly (S3 public URL), or
- Redirects via `GET /invoices/{invoiceId}/download` endpoint

---

## 6. Database Schema

### `templates` table (admin_core_service)

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| type | VARCHAR(255) | `INVOICE`, `INVOICE_EMAIL`, `EMAIL`, `WHATSAPP` |
| institute_id | UUID | Institute that owns this template |
| name | VARCHAR(255) | Template name |
| subject | VARCHAR(500) | Email subject line |
| content | TEXT | HTML content (compiled from MJML) |
| setting_json | TEXT | JSON: `{ mjml, templateType, previewText, variables }` |
| content_type | VARCHAR(50) | `text/html` |
| created_at | TIMESTAMP | Creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |

### `invoice` table (admin_core_service)

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| invoice_number | VARCHAR (unique) | e.g., INV-INST-20260401-001 |
| user_id | UUID | Learner |
| institute_id | UUID | Institute |
| invoice_date | TIMESTAMP | Invoice date |
| due_date | TIMESTAMP | Payment due date |
| subtotal | DECIMAL(10,2) | Subtotal |
| discount_amount | DECIMAL(10,2) | Discount |
| tax_amount | DECIMAL(10,2) | Tax |
| total_amount | DECIMAL(10,2) | Total |
| currency | VARCHAR | INR, USD, EUR |
| status | VARCHAR | GENERATED, SENT, VIEWED |
| pdf_file_id | VARCHAR | S3 file reference |
| invoice_data_json | TEXT | Full invoice data JSON |

### `invoice_line_item` table

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| invoice_id | UUID | FK to invoice |
| item_type | VARCHAR | PLAN, DISCOUNT, TAX, COUPON, REFERRAL |
| description | TEXT | Line item description |
| quantity | INT | Quantity |
| unit_price | DECIMAL(10,2) | Unit price |
| amount | DECIMAL(10,2) | Total line amount |

---

## 7. End-to-End Example

### Setup (One-time per institute)

1. **Create Invoice PDF template**: `/templates/create` → Category: "Invoice (PDF Layout)" → design layout with `{{invoice_number}}`, `{{user_name}}`, `{{line_items}}`, `{{total_amount}}` → Save

2. **Create Invoice Email template**: `/templates/create` → Category: "Invoice Email" → design email body with `{{invoice_number}}`, `{{user_name}}`, `{{total_amount}}` → Save

3. **Enable invoice emails**: Institute Settings → `INVOICE_SETTING` → set `sendInvoiceEmail: true`

### Runtime (Automatic on each enrollment payment)

```
Learner pays for course enrollment
  → Payment status = PAID
    → InvoiceService.generateInvoice()
      → Loads INVOICE template from DB (the one you created in step 1)
      → Replaces {{invoice_number}}, {{user_name}}, {{line_items}}, {{total_amount}}, etc.
      → Generates PDF → uploads to S3
      → Saves Invoice record in DB
      → Loads INVOICE_EMAIL template (the one you created in step 2)
      → Replaces {{invoice_number}}, {{user_name}}, {{total_amount}}
      → Attaches PDF to email
      → Sends to learner's email via notification_service
```

### Viewing (Admin)

- Navigate to **Manage Students** or **Manage Contacts**
- Click on a learner → side panel → **Payment History** tab
- Invoice table shows at the top with Download button
- Clicking Download opens the PDF
