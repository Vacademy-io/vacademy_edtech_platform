/**
 * Values the report screens turn into strings at run time (`reports.warnings.<CODE>`,
 * GSTR-1 tabs, audit kinds…). Kept apart from the components so the locales
 * test can check every one has its Hindi and English words.
 */

/** Warning codes the server sends (`ReportWarnings` and the B2 services), each with its own sentence. */
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
    'REGISTER_DOES_NOT_ADD_UP',
    'HSN_DOES_NOT_ADD_UP',
    'NUMBER_NOT_PARSED',
    'DUE_REDUCED_BY_RETURN',
    'REMITTANCE_HAS_NO_LOCATION',
    'SESSIONS_DO_NOT_ADD_UP',
    'Z_REPORT_MISSING',
    'NO_GRAND_TOTAL',
    'ROWS_CUT',
] as const;

/** Warnings that mean the figures cannot be filed or trusted as they are: error colour. */
export const SERIOUS_WARNING_CODES = [
    'GSTR1_DOES_NOT_ADD_UP',
    'SERIES_GAP',
    'REGISTER_DOES_NOT_ADD_UP',
    'HSN_DOES_NOT_ADD_UP',
    'SESSIONS_DO_NOT_ADD_UP',
] as const;

/** GSTR-1 sheets in the order of the GST offline tool (contract §2.5); section keys of `GstReportService.gstr1`. */
export const GSTR1_TABS = ['b2b', 'b2cl', 'b2cs', 'cdnr', 'cdnur', 'exemp', 'hsn_b2b', 'hsn_b2c', 'docs'] as const;

/**
 * GSTR-1 sections shown under another tab rather than as a tab of their own:
 * the credit notes netted into B2C small, and the paper bill books under documents.
 */
export const GSTR1_SUB_SECTIONS: Readonly<Record<string, string>> = {
    b2cs: 'b2cs_credit_notes',
    docs: 'docs_bill_books',
};

/**
 * Totals keys that are not a column of any table and are money (the server
 * names them): everything else that is not a column is a count (lead decision 2).
 */
export const MONEY_TOTALS = [
    // Sales register (B1).
    'cancelled_total',
    // GSTR-1 sections and HSN summary (B1).
    'documents_value',
    'documents_total',
    'round_off',
    // Day book (B2): top level and the documents, money and sessions blocks.
    'invoices_value',
    'credit_notes_value',
    'documents_net',
    'net',
    'net_money',
    'cash_at_tills',
    // Payment modes (B2).
    'paid_not_invoiced',
    // COD outstanding (B2).
    'outstanding_amount',
    'in_transit_amount',
] as const;

/** Count totals the server sends beyond the columns, with words of their own. */
export const COUNT_TOTALS = [
    'invoices',
    'cancelled_invoices',
    'cancelled_count',
    'notes',
    'documents',
    'credit_notes',
    'sessions',
    'orders',
    'customers',
    'outstanding_count',
    'red_flag_count',
    'in_transit_count',
    'red_flag_orders',
    'remittances',
    'closed_sessions',
    'open_sessions',
    'products',
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
