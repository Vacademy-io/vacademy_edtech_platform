/**
 * Values the report screens turn into strings at run time (`reports.warnings.<CODE>`,
 * GSTR-1 tabs, audit kinds…). Kept apart from the components so the locales
 * test can check every one has its Hindi and English words.
 */

/** Warning codes of the reports (WP-50 contract §2), each with its own sentence. */
export const REPORT_WARNING_CODES = [
    'QTY_ROUNDED',
    'UQC_UNKNOWN',
    'HSN_MISSING',
    'HSN_SHORT',
    'SCALE_UNKNOWN',
    'ZERO_RATE_SPLIT_UNKNOWN',
    'NOT_A_TAX_INVOICE',
    'GSTR1_DOES_NOT_ADD_UP',
    'SERIES_GAP',
    'CANCELLED_AFTER_MONTH',
    'DUE_REDUCED_BY_RETURN',
] as const;

/** GSTR-1 sheets in the order of the GST offline tool (contract §2.5). */
export const GSTR1_TABS = ['b2b', 'b2cl', 'b2cs', 'cdnr', 'cdnur', 'exemp', 'hsn_b2b', 'hsn_b2c', 'docs'] as const;

/** Check lines the screen names; any other key prints as sent. */
export const GSTR1_CHECK_KEYS = ['taxable', 'cgst', 'sgst', 'igst', 'cess'] as const;

/** Totals the server may send beyond the table's columns, with words of their own. */
export const KNOWN_EXTRA_TOTALS = [
    'count',
    'cancelled_count',
    'cancelled_total',
    'customers',
    'orders',
    'invoices',
    'paid_not_invoiced',
    'round_off_line',
] as const;

/** Kinds the screen names in Hindi and English; any other kind prints as its code. */
export const AUDIT_KIND_LABELS = [
    'VARIANT_PRICE_CHANGED',
    'LINE_PRICE_OVERRIDE',
    'PRODUCT_CREATED',
    'PRODUCT_STATUS_CHANGED',
    'POS_VOID',
    'INVOICE_CANCELLED',
    'ORDER_CANCELLED',
    'LINE_CANCELLED',
    'CREDIT_NOTE_ISSUED',
    'POS_TENDER_CHANGED',
    'POS_BILL_BOOK_ENTRY',
    'POS_SESSION_OPENED',
    'POS_SESSION_CLOSED',
    'POS_CASH_MOVED',
    'RECEIPT_RECORDED',
    'COD_REMITTANCE',
    'REFUND_CREATED',
    'REFUND_PAYOUT_RECORDED',
    'RETURN_CREATED',
    'STOCK_COUNT_POSTED',
    'TAX_SETTING_CHANGED',
    'TAX_CLASS_SAVED',
    'REPORT_EXPORTED',
    'PIN_LOCKED',
] as const;

/** Approval actions (manager PIN) the screen names; others print as their code. */
export const APPROVAL_ACTION_LABELS = [
    'POS_DISCOUNT',
    'POS_VOID',
    'POS_TENDER_CHANGE',
    'POS_BILL_BOOK',
    'POS_CASH_REFUND',
    'POS_RETURN_OVERRIDE',
    'POS_VARIANCE',
    'POS_EXCHANGE',
    'STOCK_ADJUSTMENT',
] as const;

export const AUDIT_TABS = ['changes', 'approvals'] as const;
