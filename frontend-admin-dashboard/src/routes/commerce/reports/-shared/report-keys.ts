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
    // Report fixes round (R4, names from the fix plan): documents without a seller GSTIN,
    // COD remittances shown gross because the courier's deductions are not recorded.
    'NO_GSTIN',
    'COD_GROSS',
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
    // Sales register (B1); R2 moves the money of cancelled bills to `cancelled_value`.
    'cancelled_total',
    'cancelled_value',
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
    // Products (R8): bills counted once each, not a sum of the rows.
    'distinct_invoices',
] as const;

/**
 * Text columns whose cells are codes (`SALE_PAYMENT`, `ACTIVE`, `POS`,
 * `CASH+UPI`): the screen prints `reports.values.<CODE>` for a code it knows,
 * anything else as sent (the GST offline tool's own codes, `OE`, stay as they are).
 */
export const REPORT_VALUE_COLUMNS = ['type', 'document_type', 'status', 'channel', 'payment_mode', 'payment_method'] as const;

/** Codes those columns carry (DayBookService, GstReportService, PaymentModesService, CodDuesReportService…). */
export const REPORT_VALUE_CODES = [
    // Documents.
    'TAX_INVOICE',
    'BILL_OF_SUPPLY',
    'INVOICE',
    'EXTERNAL_INVOICE',
    'CREDIT_NOTE',
    'DELIVERY_CHALLAN',
    'PAPER_BILL',
    // Money rows of the day book.
    'SALE_PAYMENT',
    'RECEIPT_ON_CREDIT',
    'COD_COLLECTED',
    'CREDIT_NOTE_USED',
    'EXCHANGE_CREDIT',
    'REFUND_PAID',
    'CASH_IN',
    'CASH_OUT',
    // Bill, session and order statuses.
    'ACTIVE',
    'CANCELLED',
    'VOID',
    'OPEN',
    'CLOSED',
    'PENDING_PAYMENT',
    'COD_PENDING_CONFIRMATION',
    'CONFIRMED',
    'PACKED',
    'SHIPPED',
    'DELIVERED',
    'RTO',
    // Channels.
    'ONLINE',
    'ADMIN',
    'POS',
    // Payment modes and methods.
    'CASH',
    'UPI',
    'CARD',
    'BANK_TRANSFER',
    'CHEQUE',
    'GATEWAY',
    'COD',
    'CREDIT',
    'PREPAID',
    'OFFLINE',
] as const;

/**
 * Statuses that mark a bill as cancelled: its row is struck through, its money is in `cancelled_value` (R2).
 * The server writes CANCELLED only (a voided counter bill is a cancelled invoice); there is no VOID bill status.
 */
export const CANCELLED_STATUSES = ['CANCELLED'] as const;

/** Figures of the flat report checks that are no column of the report, with words of their own. */
export const CHECK_FIGURES = [
    'taxable_value',
    'tax',
    'round_off',
    'invoice_total',
    'amount',
    'note_total',
    'total_value',
    'documents_total',
    'bills_value',
    'invoices_total',
    'sections',
    'documents',
] as const;

/** Reports that send a check, each with the rule in Hindi and English (`reports.check.rules.<api>`). */
export const CHECK_RULE_REPORTS = ['sales-register', 'credit-notes', 'hsn-summary', 'gstr1', 'pos-sessions'] as const;

/**
 * `VALIDATION` refusals the screen words itself (R5): the server's English
 * sentence is matched to one of these; anything else gets the general sentence.
 */
export const VALIDATION_REASONS = [
    'b2clLimit',
    'size',
    'cursor',
    'tooOld',
    'future',
    'tooLong',
    'order',
    'month',
    'status',
    'gstin',
    'groupBy',
    'channel',
] as const;

/**
 * Kinds the screen names in Hindi and English (every kind the server records,
 * `CommerceAuditService.record` callers); any other kind is printed with its
 * underscores as spaces ("Tracking edited") until it is named here.
 */
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
    // The rest the server records (M9).
    'ATTRIBUTE_SAVED',
    'ATTRIBUTE_DELETED',
    'ATTRIBUTE_VALUE_SAVED',
    'ATTRIBUTE_VALUE_DELETED',
    'CATALOGUE_EXPORTED',
    'COD_REMITTANCE_RECORDED',
    'COLLECTION_SAVED',
    'COLLECTION_PRODUCTS_SET',
    'DELIVERY_UNDONE',
    'DISCOUNT',
    'DOCUMENT_SERIES_CREATED',
    'DOCUMENT_SERIES_STATUS',
    'EXCHANGE_APPLIED',
    'IMPORT_STARTED',
    'IMPORT_FINISHED',
    'INVOICE_REISSUED_B2B',
    'LABEL_PART_PRINTED',
    'LABEL_REPRINT',
    'LOCATION_CREATE',
    'LOCATION_UPDATE',
    'LOCATION_SELLS_ONLINE',
    'MEDIA_ATTACHED',
    'MEDIA_REMOVED',
    'MEDIA_UPDATED',
    'MEDIA_REORDERED',
    'MEDIA_RENDITIONS_REQUEUED',
    'MEDIA_RENDITIONS_RETRY',
    'NOTIFY_SETTING_CHANGED',
    'NOTIFY_SHOP_CHANGED',
    'NOTIFY_TEMPLATES_SUBMITTED',
    'NOTIFY_TEST_SENT',
    'ORDER_LINKS_REVOKED',
    'ORDER_UNPACKED',
    'PAYMENT_EXCEPTION_RESOLVED',
    'POS_LIMITS_CHANGED',
    'POS_REGISTER_SAVED',
    'POS_RETURN',
    'POS_SALE',
    'PRODUCT_QUICK_ADDED',
    'PRODUCT_UPDATED',
    'REFUND_CANCELLED',
    'REFUND_CHECKED',
    'RETURN_APPROVED',
    'RETURN_POLICY_OVERRIDE',
    'RETURN_RECEIVED',
    'RETURN_REJECTED',
    'RTO_RECEIVED',
    'SHIPPING_RULE_SAVED',
    'SHIP_UNDONE',
    'STAFF_LOCATION_ASSIGN',
    'STAFF_PIN_SET',
    'STOCK_ADJUSTMENT',
    'STOCK_DAMAGE',
    'STOCK_COUNT_OPENED',
    'STOCK_COUNT_CANCELLED',
    'STOCK_COUNT_LINE_ACCEPTED',
    'STOCK_RECEIPT_POST',
    'STOCK_RECEIPT_REVERSE',
    'STOCK_RECEIPT_COST',
    'STOCK_RECEIPT_NO_BILL',
    'STOCK_SHORT_CLEARED',
    'TAX_RATE_RULE_SAVED',
    'TAX_RATE_RULE_DELETED',
    'TRACKING_EDITED',
    'TRANSFER_CREATED',
    'TRANSFER_UPDATED',
    'TRANSFER_DISPATCHED',
    'TRANSFER_RECEIVED',
    'TRANSFER_CANCELLED',
] as const;

/**
 * Keys of the stored old/new values the screen names in Hindi and English
 * (the common ones); any other key is printed with its underscores as spaces.
 */
export const AUDIT_CHANGE_KEYS = [
    'status',
    'price',
    'mrp',
    'unit_price',
    'old_price',
    'new_price',
    'old_mrp',
    'new_mrp',
    'amount',
    'quantity',
    'reason',
    'note',
    'mode',
    'old_mode',
    'new_mode',
    'method',
    'name',
    'sku',
    'code',
    'total',
    'reference',
    'invoice_number',
    'order_number',
    'return_number',
    'transfer_number',
    'credit_note_number',
    'document_number',
    'document_date',
    'tracking_number',
    'carrier_name',
    'location_id',
    'from_status',
    'to_status',
    'cancel_reason',
    'counted_cash',
    'expected_cash',
    'opening_cash',
    'variance',
    'gstin',
    'hsn_code',
    'rate_percent',
    'received_on',
    'net_amount',
    'gross_amount',
    'deductions',
    'unit',
    'channel',
    'format',
    'rows',
    'filters',
    'from',
    'to',
    'credit_on_due',
    'amount_due',
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
