/**
 * Report answers exactly as the server sends them (`report/dto/ReportDtos.java`,
 * snake_case): columns `{key, label, label_hi, type}` copied from the
 * server's column tables (`GstColumns`, `DayBookService`, `CodDuesReportService`,
 * `SalesReportService.productsTable`), sections `{key, label, label_hi, columns,
 * rows, totals}`, the GSTR-1 `check.columns`, warnings `{code, message, ref}`.
 * Figures follow the backend unit tests (cloth 5.9 m sold, "₹123.40 / m",
 * bill book 100–199 with page 102 not entered, a ₹500 COD order 16 days out).
 *
 * Neutral data only: no real shop, place or person. Screens are tested on
 * `normalizeReport(<these>)`, so a test fails if a screen reads a key the
 * server does not send.
 */

type Json = Record<string, unknown>;

const col = (key: string, label: string, labelHi: string, type: string): Json => ({
    key,
    label,
    label_hi: labelHi,
    type,
});

/** `GstColumns` shared cells. */
const RATE = col('rate', 'Rate %', 'दर %', 'PERCENT');
const TAXABLE = col('taxable_value', 'Taxable value', 'कर योग्य मूल्य', 'MONEY');
const CGST = col('cgst', 'CGST', 'CGST', 'MONEY');
const SGST = col('sgst', 'SGST', 'SGST', 'MONEY');
const IGST = col('igst', 'IGST', 'IGST', 'MONEY');
const CESS = col('cess', 'Cess', 'सेस', 'MONEY');
const ROUND_OFF = col('round_off', 'Round-off', 'राउंड-ऑफ़', 'MONEY');
const LOCATION = col('location', 'Location', 'जगह', 'TEXT');

const frame = (report: string, extra: Json): Json => ({
    report,
    from: '2026-11-01',
    to: '2026-11-19',
    filters: {},
    columns: [],
    rows: [],
    totals: {},
    sections: [],
    check: null,
    warnings: [],
    next_cursor: null,
    as_of: '2026-11-19T14:00:00+05:30',
    ...extra,
});

/** `sales-register` (GstColumns.SALES_REGISTER, GstReportService.salesTotals). */
export const SALES_REGISTER_JSON = frame('sales-register', {
    columns: [
        col('invoice_number', 'Invoice number', 'इनवॉइस नंबर', 'TEXT'),
        col('paper_bill_number', 'Paper bill number', 'काग़ज़ी बिल नंबर', 'TEXT'),
        col('date', 'Date', 'तारीख़', 'DATE'),
        col('document_type', 'Document type', 'दस्तावेज़ का प्रकार', 'TEXT'),
        col('channel', 'Channel', 'चैनल', 'TEXT'),
        LOCATION,
        col('order_number', 'Order number', 'ऑर्डर नंबर', 'TEXT'),
        col('customer', 'Customer', 'ग्राहक', 'TEXT'),
        col('buyer_gstin', 'Buyer GSTIN', 'ख़रीदार का GSTIN', 'TEXT'),
        col('place_of_supply', 'Place of supply', 'आपूर्ति का स्थान', 'TEXT'),
        col('hsn', 'HSN', 'HSN', 'TEXT'),
        RATE,
        TAXABLE,
        CGST,
        SGST,
        IGST,
        CESS,
        ROUND_OFF,
        col('invoice_total', 'Invoice total', 'इनवॉइस की कुल राशि', 'MONEY'),
        col('payment_mode', 'Payment mode', 'भुगतान का तरीका', 'TEXT'),
        col('status', 'Status', 'स्थिति', 'TEXT'),
        col('seller_gstin', 'Seller GSTIN', 'विक्रेता का GSTIN', 'TEXT'),
    ],
    rows: [
        {
            invoice_number: 'INV/2627-00001',
            date: '2026-11-05',
            document_type: 'TAX_INVOICE',
            channel: 'POS',
            customer: 'Test Customer',
            place_of_supply: '23-Test State',
            hsn: '5208',
            rate: 5,
            taxable_value: 100.0,
            cgst: 2.5,
            sgst: 2.5,
            igst: 0.0,
            cess: 0.0,
            round_off: 0.0,
            invoice_total: 105.0,
            payment_mode: 'CASH',
            status: 'ACTIVE',
        },
        {
            invoice_number: 'INV/2627-00002',
            date: '2026-11-06',
            document_type: 'TAX_INVOICE',
            channel: 'ONLINE',
            hsn: '5208',
            rate: 5,
            taxable_value: 50.0,
            cgst: 1.25,
            sgst: 1.25,
            igst: 0.0,
            cess: 0.0,
            round_off: 0.0,
            invoice_total: 52.5,
            payment_mode: 'UPI',
            status: 'ACTIVE',
        },
    ],
    // Deliberately not the sum of the two rows: the screen must print the server's figure.
    totals: {
        taxable_value: 999.99,
        cgst: 25.0,
        sgst: 25.0,
        igst: 0.0,
        cess: 0.0,
        round_off: -0.15,
        invoice_total: 1049.99,
        invoices: 12,
        cancelled_invoices: 1,
        cancelled_total: 40.0,
    },
    check: {
        rule: 'taxable value + tax + round-off = invoice totals (live invoices)',
        taxable_value: 999.99,
        tax: 50.0,
        round_off: -0.15,
        invoice_total: 1049.99,
        difference: 0.0,
    },
    warnings: [
        { code: 'HSN_MISSING', message: 'line without HSN', ref: 'INV/2627-00001' },
        { code: 'HSN_MISSING', message: 'line without HSN', ref: 'INV/2627-00002' },
        { code: 'HSN_MISSING', message: 'and 3 more', ref: null },
    ],
    next_cursor: 'c-2',
});

/** `credit-notes` (GstColumns.CREDIT_NOTES): a measured line "1.2 m" at "₹123.40 / m". */
export const CREDIT_NOTES_JSON = frame('credit-notes', {
    columns: [
        col('note_number', 'Credit note number', 'क्रेडिट नोट नंबर', 'TEXT'),
        col('note_date', 'Note date', 'नोट की तारीख़', 'DATE'),
        RATE,
        col('quantity', 'Quantity', 'मात्रा', 'QTY'),
        col('unit', 'Unit', 'इकाई', 'TEXT'),
        col('quantity_text', 'Quantity with unit', 'इकाई सहित मात्रा', 'TEXT'),
        col('rate_per_unit', 'Rate per unit', 'प्रति इकाई दर', 'MONEY'),
        col('rate_text', 'Rate per unit (as printed)', 'प्रति इकाई दर (छपी हुई)', 'TEXT'),
        TAXABLE,
        col('note_total', 'Note total', 'नोट की कुल राशि', 'MONEY'),
    ],
    rows: [
        {
            note_number: 'CN/2627-00001',
            note_date: '2026-11-07',
            rate: 5,
            quantity: 1.2,
            unit: 'MTR',
            quantity_text: '1.2 m',
            rate_per_unit: 123.4,
            rate_text: '₹123.40 / m',
            taxable_value: 148.08,
            note_total: 155.48,
        },
    ],
    totals: { taxable_value: 148.08, note_total: 155.48, notes: 1 },
});

/** `GstColumns.B2B` (abridged to the cells the screen shows; keys, labels and types as sent). */
const B2B_COLUMNS = [
    col('gstin_of_recipient', 'GSTIN/UIN of Recipient', 'प्राप्तकर्ता का GSTIN/UIN', 'TEXT'),
    col('invoice_number', 'Invoice Number', 'इनवॉइस नंबर', 'TEXT'),
    col('invoice_value', 'Invoice Value', 'इनवॉइस मूल्य', 'MONEY'),
    col('rate', 'Rate', 'दर', 'PERCENT'),
    col('taxable_value', 'Taxable Value', 'कर योग्य मूल्य', 'MONEY'),
    col('cess', 'Cess Amount', 'सेस राशि', 'MONEY'),
    CGST,
    SGST,
    IGST,
];

const DOCS_COLUMNS = [
    col('nature', 'Nature of Document', 'दस्तावेज़ की प्रकृति', 'TEXT'),
    col('prefix', 'Prefix', 'प्रीफ़िक्स', 'TEXT'),
    col('from_number', 'Sr. No. From', 'क्रम संख्या से', 'TEXT'),
    col('to_number', 'Sr. No. To', 'क्रम संख्या तक', 'TEXT'),
    col('total', 'Total Number', 'कुल संख्या', 'INT'),
    col('cancelled', 'Cancelled', 'रद्द', 'INT'),
    col('net_issued', 'Net issued', 'कुल जारी', 'INT'),
    col('gap', 'Gap check', 'छूटे नंबर', 'TEXT'),
    col('dated_in_other_period', 'Dated in another period', 'दूसरी अवधि की तारीख़', 'TEXT'),
];

const BILL_BOOK_COLUMNS = [
    col('prefix', 'Book prefix', 'किताब का प्रीफ़िक्स', 'TEXT'),
    col('book_range', 'Book pages', 'किताब के पन्ने', 'TEXT'),
    col('from_page', 'First page entered', 'पहला दर्ज पन्ना', 'TEXT'),
    col('to_page', 'Last page entered', 'आख़िरी दर्ज पन्ना', 'TEXT'),
    col('total', 'Total Number', 'कुल संख्या', 'INT'),
    col('not_entered_count', 'Pages not entered (count)', 'दर्ज न हुए पन्ने (गिनती)', 'INT'),
    col('not_entered', 'Pages not entered', 'दर्ज न हुए पन्ने', 'TEXT'),
];

const SYSTEM_ROWS = [
    {
        nature: 'Invoices for outward supply',
        prefix: 'INV/',
        from_number: 'INV/2627-00001',
        to_number: 'INV/2627-00009',
        total: 9,
        cancelled: 1,
        net_issued: 8,
        gap: 'none',
        dated_in_other_period: '',
    },
    {
        nature: 'Credit Note',
        prefix: 'CN/',
        from_number: 'CN/2627-00001',
        to_number: 'CN/2627-00004',
        total: 3,
        cancelled: 0,
        net_issued: 3,
        gap: 'CN/2627-00003',
        dated_in_other_period: 'CN/2627-00004',
    },
];

const BOOK_ROWS = [
    { prefix: 'BK', book_range: '100–199', from_page: '101', to_page: '103', total: 2, not_entered_count: 1, not_entered: '102' },
];

const section = (key: string, label: string, labelHi: string, columns: Json[], rows: Json[], totals: Json = {}): Json => ({
    key,
    label,
    label_hi: labelHi,
    columns,
    rows,
    totals,
});

/** `gstr1` (GstReportService.gstr1): sections in the server's order, `check.columns`. */
export const GSTR1_JSON = frame('gstr1', {
    sections: [
        section('b2b', 'B2B', 'B2B', B2B_COLUMNS, [
            { gstin_of_recipient: '23ABCDE1234F1Z5', invoice_number: 'DOC-b2b', invoice_value: 105.0, rate: 5, taxable_value: 100.0, cess: 0.0, cgst: 2.5, sgst: 2.5, igst: 0.0 },
        ], { taxable_value: 100.0, cess: 0.0, cgst: 2.5, sgst: 2.5, igst: 0.0, documents: 1, documents_value: 105.0 }),
        section('b2cl', 'B2C large', 'B2C बड़े', B2B_COLUMNS.slice(1), [{ invoice_number: 'DOC-b2cl', rate: 5, taxable_value: 100.0 }]),
        section('b2cs', 'B2C small', 'B2C छोटे', [col('type', 'Type', 'प्रकार', 'TEXT'), col('place_of_supply', 'Place Of Supply', 'आपूर्ति का स्थान', 'TEXT'), col('rate', 'Rate', 'दर', 'PERCENT'), col('taxable_value', 'Taxable Value', 'कर योग्य मूल्य', 'MONEY')], [
            { type: 'OE', place_of_supply: 'DOC-b2cs', rate: 5, taxable_value: 100.0 },
        ]),
        section('b2cs_credit_notes', 'Credit notes netted in B2C small', 'B2C छोटे में घटाए क्रेडिट नोट', [col('note_number', 'Note Number', 'नोट नंबर', 'TEXT')], [{ note_number: 'CN-netted' }]),
        section('cdnr', 'Credit notes (registered)', 'क्रेडिट नोट (पंजीकृत)', [col('note_number', 'Note Number', 'नोट नंबर', 'TEXT')], [{ note_number: 'DOC-cdnr' }]),
        section('cdnur', 'Credit notes (unregistered)', 'क्रेडिट नोट (अपंजीकृत)', [col('note_number', 'Note Number', 'नोट नंबर', 'TEXT')], [{ note_number: 'DOC-cdnur' }]),
        section('exemp', '0% supplies', '0% आपूर्ति', [col('description', 'Description', 'विवरण', 'TEXT'), col('nil_or_exempt', '0% (nil or exempt)', '0% (शून्य दर या छूट)', 'MONEY'), col('non_gst', 'Non-GST supplies', 'GST से बाहर की आपूर्ति', 'MONEY')], [
            { description: 'DOC-exemp', nil_or_exempt: 0.0, non_gst: 0.0 },
        ], { nil_or_exempt: 0.0, non_gst: 0.0 }),
        section('hsn_b2b', 'HSN B2B', 'HSN B2B', [col('hsn', 'HSN', 'HSN', 'TEXT')], [{ hsn: 'DOC-hsn_b2b' }]),
        section('hsn_b2c', 'HSN B2C', 'HSN B2C', [col('hsn', 'HSN', 'HSN', 'TEXT')], [{ hsn: 'DOC-hsn_b2c' }]),
        section('docs', 'Documents', 'दस्तावेज़', DOCS_COLUMNS, SYSTEM_ROWS.map((row, i) => (i === 0 ? { ...row, from_number: 'DOC-docs' } : row))),
        section('docs_bill_books', 'Paper bill books', 'काग़ज़ी बिल बुक', BILL_BOOK_COLUMNS, BOOK_ROWS),
    ],
    check: {
        rule: 'b2b + b2cl + b2cs + exemp - cdnr - cdnur = invoices - credit notes',
        columns: [
            { key: 'taxable_value', sections: 900.0, documents: 900.0, difference: 0.0 },
            { key: 'cgst', sections: 22.5, documents: 22.5, difference: 0.0 },
            { key: 'sgst', sections: 22.5, documents: 22.5, difference: 0.0 },
            { key: 'igst', sections: 0.0, documents: 0.0, difference: 0.0 },
            { key: 'cess', sections: 0.0, documents: 0.0, difference: 0.0 },
        ],
        difference: 0.0,
    },
});

/** `documents-issued` (GstReportService.documentsIssued): `system` and `bill_books` only. */
export const DOCUMENTS_ISSUED_JSON = frame('documents-issued', {
    sections: [
        section('system', 'System numbers', 'सिस्टम नंबर', DOCS_COLUMNS, SYSTEM_ROWS, { total: 12, cancelled: 1, net_issued: 11 }),
        section('bill_books', 'Paper bill books', 'काग़ज़ी बिल बुक', BILL_BOOK_COLUMNS, BOOK_ROWS, {
            total: 2,
            cancelled: 0,
            net_issued: 2,
            not_entered_count: 1,
        }),
    ],
    warnings: [{ code: 'SERIES_GAP', message: 'missing numbers in CN/2627', ref: 'CN/2627' }],
});

const DATE = col('date', 'Date', 'तारीख़', 'DATE');
const TIME = col('time', 'Time', 'समय', 'TIME');

/** `day-book` (DayBookService.build): four sections, TIME as India wall text, "—" for a date-only event. */
export const DAY_BOOK_JSON = frame('day-book', {
    from: '2026-11-19',
    to: '2026-11-19',
    sections: [
        section('documents', 'Documents', 'दस्तावेज़', [
            DATE,
            TIME,
            col('type', 'Type', 'प्रकार', 'TEXT'),
            col('number', 'Number', 'नंबर', 'TEXT'),
            col('party', 'Party', 'पार्टी', 'TEXT'),
            col('value', 'Value', 'मूल्य', 'MONEY'),
            col('status', 'Status', 'स्थिति', 'TEXT'),
            LOCATION,
        ], [
            { date: '2026-11-19', time: '2026-11-19 10:30', type: 'TAX_INVOICE', number: 'INV/2627-00001', value: 105.0, status: 'ACTIVE', location: 'Shop 1', row_kind: 'DOCUMENT' },
            { date: '2026-11-19', time: '—', type: 'PAPER_BILL', number: '101', value: 50.0, status: 'ACTIVE', location: 'Shop 1', row_kind: 'DOCUMENT' },
        ], { invoices: 2, invoices_value: 155.0, cancelled_count: 0, credit_notes: 1, credit_notes_value: 30.0, net: 125.0 }),
        section('money', 'Money', 'पैसा', [
            DATE,
            TIME,
            col('type', 'Type', 'प्रकार', 'TEXT'),
            col('payment_mode', 'Payment mode', 'भुगतान का तरीका', 'TEXT'),
            col('value', 'Value (not money)', 'मूल्य (पैसा नहीं)', 'MONEY'),
            col('amount_in', 'Amount in', 'आई रकम', 'MONEY'),
            col('amount_out', 'Amount out', 'गई रकम', 'MONEY'),
        ], [
            { date: '2026-11-19', time: '2026-11-19 10:31', type: 'SALE_PAYMENT', payment_mode: 'UPI', value: null, amount_in: 105.0, amount_out: null, row_kind: 'MONEY' },
        ], { value: 0.0, amount_in: 105.0, amount_out: 0.0, net_money: 105.0 }),
        section('by_mode', 'By payment mode', 'भुगतान के तरीके से', [
            col('payment_mode', 'Payment mode', 'भुगतान का तरीका', 'TEXT'),
            col('amount_in', 'Amount in', 'आई रकम', 'MONEY'),
            col('amount_out', 'Amount out', 'गई रकम', 'MONEY'),
            col('net', 'Net', 'शुद्ध', 'MONEY'),
        ], [{ payment_mode: 'UPI', amount_in: 105.0, amount_out: 0.0, net: 105.0 }], { amount_in: 105.0, amount_out: 0.0, net: 105.0 }),
        section('sessions', 'Counter sessions', 'काउंटर सत्र', [
            col('register', 'Register', 'काउंटर', 'TEXT'),
            col('status', 'Status', 'स्थिति', 'TEXT'),
            col('opened', 'Opened', 'खुला', 'TIME'),
            col('counted', 'Counted cash', 'गिना गया नकद', 'MONEY'),
            col('cash_at_till', 'Cash at the till', 'काउंटर पर नकद', 'MONEY'),
        ], [{ register: 'R1', status: 'CLOSED', opened: '2026-11-19 09:00', counted: 500.0, cash_at_till: 500.0 }], {
            cash_at_till: 500.0,
            cash_at_tills: 500.0,
            sessions: 1,
        }),
    ],
    totals: {
        invoices: 2,
        invoices_value: 155.0,
        credit_notes: 1,
        credit_notes_value: 30.0,
        documents_net: 125.0,
        amount_in: 105.0,
        amount_out: 0.0,
        net_money: 105.0,
        cash_at_tills: 500.0,
    },
});

const COD_ORDER_COLUMNS = [
    col('order_number', 'Order number', 'ऑर्डर नंबर', 'TEXT'),
    col('order_date', 'Order date', 'ऑर्डर की तारीख़', 'DATE'),
    col('cod_amount', 'COD amount', 'COD रकम', 'MONEY'),
    col('days_outstanding', 'Days outstanding', 'कितने दिन से बकाया', 'INT'),
];

/** `cod-outstanding` (CodDuesReportService): blocks only, `red_flag` on a row, counts and amounts in totals. */
export const COD_OUTSTANDING_JSON = frame('cod-outstanding', {
    filters: { as_of: '2026-11-19', red_flag_days: 10 },
    sections: [
        section('outstanding', 'Outstanding', 'बकाया', COD_ORDER_COLUMNS, [
            { order_number: 'ORD-1', order_date: '2026-11-01', cod_amount: 500.0, days_outstanding: 16, red_flag: true },
            { order_number: 'ORD-2', order_date: '2026-11-15', cod_amount: 200.0, days_outstanding: 3, red_flag: false },
        ], { cod_amount: 700.0, orders: 2, red_flag_orders: 1 }),
        section('remittances', 'Remittances received', 'कूरियर से आई रकम', [
            col('received_on', 'Received on', 'मिलने की तारीख़', 'DATE'),
            col('orders', 'Orders', 'ऑर्डर', 'INT'),
            col('gross', 'Gross', 'कुल रकम', 'MONEY'),
            col('deductions', 'Deductions', 'कटौती', 'MONEY'),
            col('net', 'Net received', 'शुद्ध मिली रकम', 'MONEY'),
        ], [{ received_on: '2026-11-12', orders: 1, gross: 500.0, deductions: 25.0, net: 475.0 }], {
            orders: 1,
            gross: 500.0,
            deductions: 25.0,
            net: 475.0,
            remittances: 1,
        }),
    ],
    totals: {
        outstanding_count: 2,
        outstanding_amount: 700.0,
        red_flag_count: 1,
        in_transit_count: 1,
        in_transit_amount: 300.0,
        gross: 500.0,
        deductions: 25.0,
        net: 475.0,
    },
});

/** `products` (SalesReportService, groupBy variant): `*_text` beside the raw quantities and rate. */
export const PRODUCTS_JSON = frame('products', {
    filters: { group_by: 'variant' },
    columns: [
        col('product', 'Product', 'सामान', 'TEXT'),
        col('unit', 'Unit', 'इकाई', 'TEXT'),
        col('sold', 'Sold', 'बिका', 'QTY'),
        col('sold_text', 'Sold (with unit)', 'बिका (इकाई सहित)', 'TEXT'),
        col('returned', 'Returned', 'वापस आया', 'QTY'),
        col('returned_text', 'Returned (with unit)', 'वापस आया (इकाई सहित)', 'TEXT'),
        col('net_units', 'Net units', 'शुद्ध मात्रा', 'QTY'),
        col('net_text', 'Net (with unit)', 'शुद्ध (इकाई सहित)', 'TEXT'),
        col('net_value', 'Net value', 'शुद्ध मूल्य', 'MONEY'),
        col('average_rate', 'Average rate per unit', 'प्रति इकाई औसत दर', 'MONEY'),
        col('average_rate_text', 'Average rate', 'औसत दर', 'TEXT'),
        col('invoices', 'Invoices', 'इनवॉइस', 'INT'),
    ],
    rows: [
        {
            product: 'Cotton cloth',
            unit: 'MTR',
            sold: 5.9,
            sold_text: '5.9 m',
            returned: 1.2,
            returned_text: '1.2 m',
            net_units: 4.7,
            net_text: '4.7 m',
            net_value: 579.98,
            average_rate: 123.4,
            average_rate_text: '₹123.40 / m',
            invoices: 2,
        },
    ],
    totals: { net_value: 579.98, invoices: 2, sold_text: '5.9 m', returned_text: '1.2 m', net_text: '4.7 m' },
    sections: [
        section('never_sold', 'Never sold in these dates', 'इन तारीख़ों में कभी नहीं बिका', [
            col('product', 'Product', 'सामान', 'TEXT'),
            col('sku', 'SKU', 'SKU', 'TEXT'),
            col('unit', 'Unit', 'इकाई', 'TEXT'),
        ], [{ product: 'Water bottle', sku: 'BOTTLE-1', unit: 'PCS' }], { products: 1 }),
    ],
});

/** `hsn-summary`: a block report; its top totals are keyed by the section columns, plus `round_off`, `documents_total`. */
export const HSN_SUMMARY_JSON = frame('hsn-summary', {
    sections: [
        section('hsn_b2c', 'HSN B2C', 'HSN B2C', [
            col('hsn', 'HSN', 'HSN', 'TEXT'),
            col('uqc', 'UQC', 'UQC', 'TEXT'),
            col('quantity', 'Total quantity', 'कुल मात्रा', 'QTY'),
            col('total_value', 'Total value', 'कुल मूल्य', 'MONEY'),
            TAXABLE,
        ], [{ hsn: '5208', uqc: 'MTR', quantity: 4.7, total_value: 579.98, taxable_value: 552.36 }], {
            total_value: 579.98,
            taxable_value: 552.36,
        }),
    ],
    totals: { total_value: 579.98, taxable_value: 552.36, round_off: 0.02, documents_total: 580.0 },
});
