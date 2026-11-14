/**
 * Sample invoice template generator (the "sparkle" action).
 *
 * Produces a ready-to-edit INVOICE (PDF layout) or INVOICE_EMAIL template that is
 * saved EXACTLY the way the easy-email editor saves it:
 *   - `mjml`    = JSON.stringify(easy-email IBlockData)  → re-opens in the editor
 *   - `content` = MJML compiled to HTML                  → used for PDF/email render
 *
 * easy-email-core + mjml-browser are heavy, so this module is dynamically
 * imported only when the sparkle is clicked (keeps the settings bundle small).
 */
import { BlockManager, BasicType, JsonToMjml } from 'easy-email-core';
import type { IBlockData } from 'easy-email-core';
import mjml2html from 'mjml-browser';

export type SampleTemplateType = 'INVOICE' | 'INVOICE_EMAIL';

export interface SampleTemplate {
    name: string;
    subject: string;
    previewText: string;
    /** JSON string of the easy-email IBlockData (stored in settingJson.mjml). */
    mjml: string;
    /** MJML compiled to HTML (stored in `content`). */
    content: string;
    variables: string[];
}

// ─── easy-email block helpers ─────────────────────────────────────────────────

const text = (html: string): IBlockData =>
    BlockManager.getBlockByType(BasicType.TEXT)!.create({
        data: { value: { content: html } },
        attributes: { padding: '4px 0px', 'line-height': '1.6' },
    });

const section = (children: IBlockData[]): IBlockData =>
    BlockManager.getBlockByType(BasicType.SECTION)!.create({
        attributes: { padding: '8px 24px' },
        children: [
            BlockManager.getBlockByType(BasicType.COLUMN)!.create({ children }),
        ],
    });

const page = (children: IBlockData[]): IBlockData =>
    BlockManager.getBlockByType(BasicType.PAGE)!.create({ children });

/** Compile an easy-email page block to HTML, mirroring EmailBuilder.onSubmit. */
const compile = (content: IBlockData): string => {
    const mjml = JsonToMjml({ data: content, mode: 'production', context: content });
    const { html } = mjml2html(mjml);
    return html;
};

// ─── Sample content ────────────────────────────────────────────────────────────

const PDF_VARIABLES = [
    '{{invoice_number}}', '{{invoice_date}}', '{{due_date}}',
    '{{institute_name}}', '{{institute_address}}', '{{institute_contact}}', '{{institute_logo}}',
    '{{user_name}}', '{{user_email}}', '{{user_address}}',
    '{{line_items}}', '{{subtotal}}', '{{discount_amount}}', '{{tax_amount}}', '{{total_amount}}',
    '{{currency_symbol}}', '{{tax_components}}', '{{tax_registration_number}}', '{{hsn_code}}',
    '{{country}}', '{{tax_label}}', '{{tax_rate}}', '{{terms_and_conditions}}',
    '{{institute_tagline}}',
    // Fee-receipt fields. A receipt has to say where a payment leaves the learner, which an
    // invoice does not: the course price, what was already paid, what is still owed and the
    // next installment. Amounts are rendered from the learner fee schedule and are read-only.
    '{{course_name}}', '{{course_code}}', '{{course_code_bracketed}}', '{{user_mobile}}',
    '{{course_fees}}', '{{total_fees}}', '{{previous_paid}}', '{{fees_paid_now}}',
    '{{total_fees_due}}', '{{total_amount_paid}}',
    '{{next_installment_amount}}', '{{next_installment_date}}', '{{amount_in_words}}',
    // Monthly fee invoices: the month billed (from the due date), who the invoice is addressed
    // to when the learner is a child, and the institute's email for the contact block.
    '{{billing_month}}', '{{billing_year}}', '{{billing_period}}',
    '{{parent_name}}', '{{year_group}}', '{{institute_email}}',
    // One row per class (Session N | Date | Subject | Day | Fee) from line items written as
    // "date | subject". Goes inside a 5-column <table><tbody>, like {{line_items}}.
    '{{session_rows}}',
];

const EMAIL_VARIABLES = [
    '{{user_name}}', '{{learner_name}}', '{{invoice_number}}', '{{total_amount}}',
    '{{invoice_pdf_link}}', '{{institute_name}}',
];

const buildInvoicePdfSample = (): SampleTemplate => {
    const content = page([
        // Header: logo + institute + TAX INVOICE meta
        section([
            text('{{institute_logo}}'),
            text(
                '<h2 style="margin:0;color:#124a34;">{{institute_name}}</h2>' +
                '<div style="font-size:12px;color:#555;">{{institute_address}}<br/>{{institute_contact}}</div>'
            ),
            text(
                '<h1 style="margin:8px 0 0;color:#124a34;letter-spacing:1px;">TAX INVOICE</h1>' +
                '<div style="font-size:13px;color:#333;">Invoice No: <strong>{{invoice_number}}</strong><br/>' +
                'Date: {{invoice_date}} &nbsp;&nbsp; Due: {{due_date}}</div>'
            ),
        ]),
        // Supplier tax identity
        section([
            text(
                '<div style="font-size:12px;color:#333;">' +
                'Country: {{country}} &nbsp;|&nbsp; GSTIN/Tax Reg. No: <strong>{{tax_registration_number}}</strong>' +
                ' &nbsp;|&nbsp; HSN/SAC: <strong>{{hsn_code}}</strong></div>'
            ),
        ]),
        // Bill to
        section([
            text(
                '<div style="font-size:12px;color:#888;text-transform:uppercase;">Bill To</div>' +
                '<div style="font-size:13px;color:#222;"><strong>{{user_name}}</strong><br/>' +
                '{{user_email}}<br/>{{user_address}}</div>'
            ),
        ]),
        // Line items: {{line_items}} is replaced with <tr> rows, so it MUST sit inside
        // a <table><tbody> (orphan <tr> rows are dropped by the PDF renderer).
        section([
            text(
                '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
                    '<thead>' +
                    '<tr style="background:#124a34;color:#ffffff;">' +
                    '<th style="padding:8px;text-align:left;border:1px solid #e0e0e0;">Item</th>' +
                    '<th style="padding:8px;text-align:center;border:1px solid #e0e0e0;">Qty</th>' +
                    '<th style="padding:8px;text-align:right;border:1px solid #e0e0e0;">Unit Price</th>' +
                    '<th style="padding:8px;text-align:right;border:1px solid #e0e0e0;">Amount</th>' +
                    '</tr>' +
                    '</thead>' +
                    '<tbody>{{line_items}}</tbody>' +
                    '</table>'
            ),
        ]),
        // Totals
        section([
            text(
                '<div style="font-size:13px;color:#222;text-align:right;">' +
                'Subtotal: {{subtotal}}<br/>' +
                'Discount: {{discount_amount}}<br/>' +
                '{{tax_label}}: {{tax_amount}}<br/>' +
                '<strong style="font-size:15px;color:#124a34;">Total: {{total_amount}}</strong></div>'
            ),
        ]),
        // Tax components breakdown (backend injects label / rate / amount rows)
        section([
            text(
                '<div style="font-size:12px;color:#888;text-transform:uppercase;">Tax Breakdown</div>' +
                '{{tax_components}}'
            ),
        ]),
        // Terms + footer
        section([
            text('{{terms_and_conditions}}'),
            text(
                '<div style="font-size:12px;color:#666;text-align:center;margin-top:8px;">' +
                'Thank you for choosing {{institute_name}}.</div>'
            ),
        ]),
    ]);

    return {
        name: 'Sample Invoice (PDF Layout)',
        subject: 'Invoice {{invoice_number}}',
        previewText: '',
        mjml: JSON.stringify(content),
        content: compile(content),
        variables: PDF_VARIABLES,
    };
};

const buildInvoiceEmailSample = (): SampleTemplate => {
    // Mirrors InvoiceService.buildDefaultInvoiceEmailBody, with merge variables left
    // unresolved so the backend fills them at send time.
    const content = page([
        section([
            text('<p style="font-size:14px;color:#222;">Dear {{user_name}},</p>'),
            text(
                '<p style="font-size:14px;color:#222;">Please find your invoice ' +
                '<strong>{{invoice_number}}</strong> for an amount of <strong>{{total_amount}}</strong>.</p>'
            ),
            text(
                '<p style="font-size:14px;color:#222;">Download your invoice: ' +
                '<a href="{{invoice_pdf_link}}" style="color:#124a34;">{{invoice_pdf_link}}</a></p>'
            ),
            text(
                '<p style="font-size:14px;color:#222;">Thank you,<br/>{{institute_name}}</p>'
            ),
        ]),
    ]);

    return {
        name: 'Sample Invoice Email',
        subject: 'Your Invoice {{invoice_number}}',
        previewText: 'Your invoice {{invoice_number}} is ready',
        mjml: JSON.stringify(content),
        content: compile(content),
        variables: EMAIL_VARIABLES,
    };
};

export const buildSampleInvoiceTemplate = (type: SampleTemplateType): SampleTemplate =>
    type === 'INVOICE' ? buildInvoicePdfSample() : buildInvoiceEmailSample();
