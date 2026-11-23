import type { TFunction } from 'i18next';
import { formatMoney } from '@/components/design-system/money-cell';
import { formatDateTime } from '@/lib/formatters';
import { formatRate } from '@/routes/commerce/-shared/units';
import { formatQuantity } from '@/routes/commerce/orders/-shared/order-format';
import type { Receipt } from './pos-types';

/**
 * The 80 mm bill as rows (contract §7.3 Receipt), pure: the component only
 * lays them out. Amounts are formatted here so the printed bill and the
 * on-screen preview read the same.
 */

export const RECEIPT_DOCUMENT_TYPES = ['TAX_INVOICE', 'BILL_OF_SUPPLY', 'INVOICE'] as const;

export interface ReceiptItemRow {
    name: string;
    detail: string;
    quantity: string;
    rate: string;
    amount: string;
    discount: string | null;
    hsn: string | null;
}

export interface ReceiptPair {
    label: string;
    value: string;
    strong?: boolean;
}

export interface ReceiptModel {
    shopName: string;
    shopLines: string[];
    title: string;
    number: string;
    when: string;
    register: string;
    customer: string[];
    items: ReceiptItemRow[];
    taxRows: ReceiptPair[];
    totals: ReceiptPair[];
    tenders: ReceiptPair[];
    words: string | null;
    qr: string | null;
    void: boolean;
    paper: boolean;
}

const RS = (value: number | null | undefined) => formatMoney(value ?? 0, 'INR');

export function receiptRows(receipt: Receipt, t: TFunction, _lang: 'hi' | 'en'): ReceiptModel {
    const docType = (receipt.document.type ?? '').toUpperCase();
    const known = (RECEIPT_DOCUMENT_TYPES as readonly string[]).includes(docType);
    const regular = docType === 'TAX_INVOICE';
    const shopLines = [
        receipt.shop.legal_name && receipt.shop.legal_name !== receipt.shop.trade_name
            ? receipt.shop.legal_name
            : null,
        ...receipt.shop.address_lines,
        receipt.shop.phone ? t('pos.receipt.phone', { phone: receipt.shop.phone }) : null,
        receipt.shop.gstin ? t('pos.receipt.gstin', { gstin: receipt.shop.gstin }) : null,
    ].filter((line): line is string => !!line);

    const c = receipt.customer;
    const customer = c.name || c.phone_last4 || c.buyer_gstin
        ? [
              c.buyer_legal_name || c.name,
              c.phone_last4 ? t('pos.receipt.phoneLast4', { last4: c.phone_last4 }) : null,
              c.buyer_gstin ? t('pos.receipt.gstin', { gstin: c.buyer_gstin }) : null,
          ].filter((line): line is string => !!line)
        : [t('pos.sell.walkIn')];

    const items: ReceiptItemRow[] = receipt.lines.map((line) => ({
        name: line.name,
        detail: line.variant_label ?? '',
        quantity: formatQuantity(line.quantity, line.qty_scale, line.unit, t),
        // "₹123.40 / m" for a measured line (the wire price is per base unit); pieces as before.
        rate: formatRate(line.unit_price, line.qty_scale, line.unit, 'INR', t),
        amount: RS(line.net),
        discount: line.discount > 0 ? RS(line.discount) : null,
        hsn:
            regular && (line.hsn_code || line.tax_rate !== null)
                ? t('pos.receipt.hsnRate', { hsn: line.hsn_code ?? '—', rate: line.tax_rate ?? 0 })
                : null,
    }));

    const taxRows: ReceiptPair[] = receipt.tax_rows.flatMap((row) => {
        const out: ReceiptPair[] = [];
        if (row.cgst || row.sgst) {
            out.push({ label: t('pos.receipt.cgst', { rate: row.rate / 2 }), value: RS(row.cgst) });
            out.push({ label: t('pos.receipt.sgst', { rate: row.rate / 2 }), value: RS(row.sgst) });
        }
        if (row.igst) out.push({ label: t('pos.receipt.igst', { rate: row.rate }), value: RS(row.igst) });
        if (row.cess) out.push({ label: t('pos.receipt.cess'), value: RS(row.cess) });
        return out;
    });

    const totals: ReceiptPair[] = [
        { label: t('pos.totals.subtotal'), value: RS(receipt.totals.subtotal) },
        ...(receipt.totals.discount
            ? [{ label: t('pos.totals.discount'), value: `− ${RS(receipt.totals.discount)}` }]
            : []),
        ...(receipt.totals.tax ? [{ label: t('pos.totals.tax'), value: RS(receipt.totals.tax) }] : []),
        ...(receipt.totals.round_off
            ? [{ label: t('pos.totals.roundOff'), value: RS(receipt.totals.round_off) }]
            : []),
        { label: t('pos.totals.total'), value: RS(receipt.totals.total), strong: true },
    ];

    const tenders: ReceiptPair[] = [
        ...receipt.tenders.map((tender) => ({
            label: tender.reference
                ? `${modeLabel(tender.mode, t)} · ${tender.reference}`
                : modeLabel(tender.mode, t),
            value: RS(tender.amount),
        })),
        ...(receipt.cash_tendered !== null
            ? [{ label: t('pos.tender.cashReceived'), value: RS(receipt.cash_tendered) }]
            : []),
        ...(receipt.change ? [{ label: t('pos.receipt.change'), value: RS(receipt.change) }] : []),
    ];

    const when = receipt.document.issued_at ?? receipt.document.date;
    return {
        shopName: receipt.shop.trade_name ?? receipt.shop.legal_name ?? '',
        shopLines,
        title: known ? t(`pos.receipt.types.${docType}`) : t('pos.receipt.types.INVOICE'),
        number: receipt.document.number ?? receipt.order_number ?? '',
        when: when ? formatDateTime(when) : '',
        register: [receipt.register.code, receipt.register.name].filter(Boolean).join(' · '),
        customer,
        items,
        taxRows,
        totals,
        tenders,
        words: receipt.amount_in_words,
        qr: receipt.qr_text,
        void: receipt.document.cancelled,
        paper: receipt.document.paper,
    };
}

/** Tender mode label: the order desk's names, with the counter's "Other" for the rest. */
export function modeLabel(mode: string, t: TFunction): string {
    const m = (mode ?? '').toUpperCase();
    if (['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE'].includes(m)) return t(`orders.tender.${m}`);
    if (m === 'CREDIT_NOTE') return t('pos.tender.CREDIT_NOTE');
    return m || t('pos.tender.OTHER');
}

export const PRINTING_CLASS = 'pos-printing';
/** If `afterprint` never fires (some tablet browsers), the class is removed after this. */
export const PRINT_CLEANUP_MS = 60_000;

export const PAGE_STYLE_ID = 'pos-receipt-page';
/**
 * The roll's page margin; global while present, so it exists only for this print. No `size`: a
 * length cannot pair with `auto` (the whole declaration would be dropped) and the roll printer's
 * driver knows its paper.
 */
export const PAGE_RULE = '@media print { @page { margin: 2mm; } }';

/**
 * Ends a counter print now: the body class and the page rule go. Called after `afterprint`, by the
 * fallback timer, and when the printing screen goes away (a later packing-slip print in this tab
 * must never print blank).
 */
export function endReceiptPrint(doc: Document = document): void {
    doc.body?.classList.remove(PRINTING_CLASS);
    doc.getElementById(PAGE_STYLE_ID)?.remove();
}

/**
 * Prints the `.pos-receipt-print` block only: `body.pos-printing` scopes the
 * 80 mm print rules (pos-receipt.css) and the page-size rule lives only for
 * this print, so other print pages (packing slips) keep their own layout even
 * after this chunk has loaded.
 */
export function printReceipt(win: Window = window): void {
    const doc = win.document;
    const body = doc.body;
    body.classList.add(PRINTING_CLASS);
    doc.getElementById(PAGE_STYLE_ID)?.remove();
    const pageStyle = doc.createElement('style');
    pageStyle.id = PAGE_STYLE_ID;
    pageStyle.textContent = PAGE_RULE;
    doc.head.appendChild(pageStyle);
    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        // Only this print's own rule; a newer print may have replaced it.
        if (doc.getElementById(PAGE_STYLE_ID) === pageStyle || !doc.getElementById(PAGE_STYLE_ID)) {
            body.classList.remove(PRINTING_CLASS);
        }
        pageStyle.remove();
        win.removeEventListener('afterprint', cleanup);
    };
    win.addEventListener('afterprint', cleanup);
    try {
        win.print();
    } finally {
        win.setTimeout(cleanup, PRINT_CLEANUP_MS);
    }
}
