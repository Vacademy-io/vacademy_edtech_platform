import { gstinProblem, normalizeGstin } from '@/routes/commerce/-shared/gstin';
import {
    type LengthProblem,
    lengthInputText,
    parseLength,
    perUnitToBasePrice,
    readDecimal,
    toPaise,
} from '@/routes/commerce/-shared/units';
import { round2 } from './order-format';
import type {
    OrderAddress,
    RefundMethod,
    StaffOrderBody,
    TenderMode,
} from './order-types';

/**
 * The new staff order form (contract §5.8, §5.7.5) as plain data: what the
 * page holds, its checks and the `POST /orders` body. Pure, so the rules are
 * unit-tested without a browser.
 */

export const MAX_ORDER_LINES = 50;
export const MAX_TENDERS = 10;
export const NOTE_MAX = 500;

/** Indian mobile: 10 digits starting 6–9, with an optional +91 / 91 / 0 in front. */
const PHONE = /^(?:\+?91|0)?([6-9]\d{9})$/;
export const PINCODE = /^[1-9][0-9]{5}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The 10 digits of a typed mobile number, or null. */
export function mobileDigits(raw: string): string | null {
    const match = PHONE.exec(raw.replace(/[\s()-]/g, ''));
    return match ? (match[1] ?? null) : null;
}

export interface NewOrderLine {
    /** Stable key of the row in the form. */
    key: string;
    /** `package_session_id`; null when only a typed SKU is known. */
    variantId: string | null;
    sku: string | null;
    name: string;
    variantName: string | null;
    qtyScale: number;
    /** The sale step in base units (5 = 0.5 m at scale 10); 1 when unknown. */
    qtyStep?: number;
    unit: string | null;
    /** As typed, in display units (metres for measured goods). */
    quantity: string;
    /** The variant's price per base unit as the server keeps it (12.34 for ₹123.40 a metre), when known. */
    listPrice: number | null;
    /** "Price for this order", as typed per display unit (a metre; blank = list price). */
    priceOverride: string;
    /** Pieces scanned for "customer takes it now". */
    pieceCodes: string[];
}

export interface AddressForm {
    name: string;
    phone: string;
    line1: string;
    line2: string;
    landmark: string;
    city: string;
    state_code: string;
    pincode: string;
}

export const EMPTY_ADDRESS: AddressForm = {
    name: '',
    phone: '',
    line1: '',
    line2: '',
    landmark: '',
    city: '',
    state_code: '',
    pincode: '',
};

export interface TenderForm {
    key: string;
    mode: TenderMode;
    amount: string;
    reference: string;
}

export interface ExchangeForm {
    returnId: string;
    returnNumber: string | null;
    /** due_raised − refunded of the return. */
    credit: number;
}

export interface NewOrderForm {
    phone: string;
    name: string;
    email: string;
    lines: NewOrderLine[];
    handOverNow: boolean;
    shipping: AddressForm;
    billingSame: boolean;
    billing: AddressForm;
    chargeShipping: boolean;
    buyerGstin: string;
    couponCode: string;
    note: string;
    tenders: TenderForm[];
    restOnCredit: boolean;
    exchange: ExchangeForm | null;
    remainderMethod: RefundMethod | '';
    remainderReference: string;
}

export const emptyNewOrder = (): NewOrderForm => ({
    phone: '',
    name: '',
    email: '',
    lines: [],
    handOverNow: false,
    shipping: { ...EMPTY_ADDRESS },
    billingSame: true,
    billing: { ...EMPTY_ADDRESS },
    chargeShipping: true,
    buyerGstin: '',
    couponCode: '',
    note: '',
    tenders: [],
    restOnCredit: false,
    exchange: null,
    remainderMethod: '',
    remainderReference: '',
});

const parse = (value: string): number | null => {
    const text = value.trim().replace(/,/g, '');
    if (!text) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
};

/**
 * The quantity as the stored integer (25 for 2.5 m), or null when it is not
 * valid. Extra decimals are refused, never rounded ("2.55" at scale 10).
 */
export function lineStoredQuantity(line: Pick<NewOrderLine, 'quantity' | 'qtyScale' | 'pieceCodes'>): number | null {
    if (line.pieceCodes.length > 0) return line.pieceCodes.length;
    const parsed = parseLength(line.quantity, line.qtyScale);
    if (!('stored' in parsed) || parsed.stored < 1) return null;
    return parsed.stored;
}

/** The sale step of a line in base units (1 when unknown). */
export const lineStep = (line: Pick<NewOrderLine, 'qtyStep'>): number => Math.max(1, Math.floor(line.qtyStep ?? 1));

/**
 * Why a line's typed quantity is refused, in the words every length box uses
 * (WP-44 n2): extra decimals, a comma, too large… `blank` for nothing or 0.
 */
export function lineQuantityProblem(
    line: Pick<NewOrderLine, 'quantity' | 'qtyScale' | 'pieceCodes'>
): LengthProblem | 'blank' | null {
    if (line.pieceCodes.length > 0) return null;
    if (line.quantity.trim() === '') return 'blank';
    const parsed = parseLength(line.quantity, line.qtyScale);
    if ('problem' in parsed) return parsed.problem;
    return parsed.stored < 1 ? 'blank' : null;
}

/** A valid quantity that is not on the sale step (2.3 m at a 0.5 m step); the server answers `QUANTITY_STEP`. */
export function offStep(line: Pick<NewOrderLine, 'quantity' | 'qtyScale' | 'qtyStep' | 'pieceCodes'>): boolean {
    const stored = lineStoredQuantity(line);
    return stored !== null && line.pieceCodes.length === 0 && stored % lineStep(line) !== 0;
}

/**
 * "Price for this order" as the per-base-unit price the server takes (`unit_price_override`):
 * typed per metre, split into `qty_scale` equal paise (123.40 → 12.34). Null when blank;
 * 'invalid' when not a price; 'comma' for "123,40" (the length box beside it refuses a comma
 * too: never read as thousands, W4); 'notDivisible' when it does not split (123.45 at scale 10);
 * 'zero' below one paisa per base unit (the server refuses it, MO NIT-3).
 */
export function overrideBasePrice(
    line: Pick<NewOrderLine, 'priceOverride' | 'qtyScale'>
): number | null | 'invalid' | 'comma' | 'notDivisible' | 'zero' {
    if (line.priceOverride.trim() === '') return null;
    const read = readDecimal(line.priceOverride);
    if ('problem' in read) return read.problem === 'comma' ? 'comma' : 'invalid';
    // Rupees and paise only: a third decimal is refused, not rounded ("123.40" and "123.400" are fine).
    if (read.whole.length > 9 || read.fraction.length > 2) return 'invalid';
    const base = perUnitToBasePrice(Number(`${read.whole}.${read.fraction || '0'}`), line.qtyScale);
    if (base === null) return 'notDivisible';
    return base < 0.01 ? 'zero' : base;
}

/** The per-base-unit price this line is sold at: the override, else the list price. */
export const linePrice = (line: Pick<NewOrderLine, 'priceOverride' | 'listPrice' | 'qtyScale'>): number | null => {
    const override = overrideBasePrice(line);
    return typeof override === 'number' ? override : line.listPrice;
};

/**
 * Σ price × stored quantity in integer paise, before shipping, tax rounding and
 * coupons (the server sets the total): 2.5 m at ₹12.34 per 10 cm is ₹308.50.
 */
export function estimateTotal(lines: readonly NewOrderLine[]): number {
    const paise = lines.reduce((sum, line) => {
        const price = linePrice(line);
        const stored = lineStoredQuantity(line);
        if (price === null || stored === null) return sum;
        return sum + toPaise(price) * stored;
    }, 0);
    return paise / 100;
}

/** Lines whose price is not known on this screen (typed SKU): the estimate leaves them out. */
export const unpricedLines = (lines: readonly NewOrderLine[]) => lines.filter((line) => linePrice(line) === null);

/** An exchange whose credit is more than the new order needs a refund method for the rest. */
export const needsRemainderRefund = (form: Pick<NewOrderForm, 'exchange' | 'lines'>): boolean =>
    !!form.exchange && estimateTotal(form.lines) < form.exchange.credit;

/** Problems keyed by field; the value is the i18n key of the sentence. */
export type NewOrderProblems = Record<string, string>;

const addressProblems = (prefix: string, address: AddressForm, out: NewOrderProblems) => {
    (['name', 'line1', 'city', 'state_code'] as const).forEach((field) => {
        if (!address[field].trim()) out[`${prefix}.${field}`] = 'orders.new.problems.required';
    });
    if (!address.pincode.trim()) out[`${prefix}.pincode`] = 'orders.new.problems.required';
    else if (!PINCODE.test(address.pincode.trim())) out[`${prefix}.pincode`] = 'orders.new.problems.pincode';
    if (address.phone.trim() && !mobileDigits(address.phone)) out[`${prefix}.phone`] = 'orders.new.problems.phone';
};

export function validateNewOrder(form: NewOrderForm): NewOrderProblems {
    const out: NewOrderProblems = {};
    if (!form.phone.trim()) out.phone = 'orders.new.problems.required';
    else if (!mobileDigits(form.phone)) out.phone = 'orders.new.problems.phone';
    if (!form.name.trim()) out.name = 'orders.new.problems.required';
    if (form.email.trim() && !EMAIL.test(form.email.trim())) out.email = 'orders.new.problems.email';

    if (form.lines.length === 0) out.lines = 'orders.new.problems.noLines';
    if (form.lines.length > MAX_ORDER_LINES) out.lines = 'orders.new.problems.tooManyLines';
    form.lines.forEach((line) => {
        const quantity = lineQuantityProblem(line);
        // A refused length reads as every length box does ("Use at most 1 decimal place…"), n2.
        if (quantity === 'blank') out[`line.${line.key}.quantity`] = 'orders.new.problems.quantity';
        else if (quantity) out[`line.${line.key}.quantity`] = `units.problems.${quantity}`;
        else if (offStep(line)) out[`line.${line.key}.quantity`] = 'orders.new.problems.quantityStep';
        const override = overrideBasePrice(line);
        if (override === 'invalid') out[`line.${line.key}.price`] = 'orders.new.problems.price';
        if (override === 'comma') out[`line.${line.key}.price`] = 'units.problems.comma';
        if (override === 'zero') out[`line.${line.key}.price`] = 'orders.new.problems.priceZero';
        if (override === 'notDivisible') out[`line.${line.key}.price`] = 'orders.new.problems.priceNotDivisible';
    });

    if (!form.handOverNow) {
        addressProblems('shipping', form.shipping, out);
        if (!form.billingSame) addressProblems('billing', form.billing, out);
    }
    if (form.buyerGstin.trim() && gstinProblem(form.buyerGstin)) out.buyerGstin = 'orders.new.problems.gstin';
    if (form.note.length > NOTE_MAX) out.note = 'orders.new.problems.tooLong';

    if (form.tenders.length > MAX_TENDERS) out.tenders = 'orders.new.problems.tooManyPayments';
    form.tenders.forEach((tender) => {
        const amount = parse(tender.amount);
        if (amount === null || amount <= 0) out[`tender.${tender.key}.amount`] = 'orders.new.problems.amount';
    });

    if (needsRemainderRefund(form) && !form.remainderMethod) out.remainderMethod = 'orders.new.problems.remainderMethod';
    return out;
}

const trimOrNull = (value: string) => {
    const text = value.trim();
    return text ? text : undefined;
};

const toAddress = (form: AddressForm): OrderAddress => {
    const out: OrderAddress = {};
    (Object.keys(EMPTY_ADDRESS) as (keyof AddressForm)[]).forEach((key) => {
        const value = trimOrNull(form[key]);
        if (value) out[key] = value;
    });
    return out;
};

/** `POST /orders` without its `client_request_id` (the page adds the id for this body). */
export function buildStaffOrderBody(form: NewOrderForm): Omit<StaffOrderBody, 'client_request_id'> {
    const lines = form.lines.map((line) => {
        const out: StaffOrderBody['lines'][number] = { quantity: lineStoredQuantity(line) ?? 0 };
        if (line.variantId) out.variant_id = line.variantId;
        else if (line.sku) out.sku = line.sku;
        // Typed per metre; the server takes the per-base-unit price (fact 25).
        const override = overrideBasePrice(line);
        if (typeof override === 'number') out.unit_price_override = override;
        if (form.handOverNow && line.pieceCodes.length > 0) out.piece_codes = [...line.pieceCodes];
        return out;
    });

    const body: Omit<StaffOrderBody, 'client_request_id'> = {
        customer: {
            phone: form.phone.trim(),
            name: form.name.trim(),
            ...(trimOrNull(form.email) ? { email: form.email.trim() } : {}),
        },
        lines,
        hand_over_now: form.handOverNow,
        rest_on_credit: form.restOnCredit,
    };
    if (!form.handOverNow) {
        const shipping = toAddress(form.shipping);
        body.shipping_address = shipping;
        body.billing_address = form.billingSame ? shipping : toAddress(form.billing);
        body.charge_shipping = form.chargeShipping;
    }
    if (trimOrNull(form.buyerGstin)) body.buyer_gstin = normalizeGstin(form.buyerGstin);
    if (trimOrNull(form.couponCode)) body.coupon_code = form.couponCode.trim();
    if (trimOrNull(form.note)) body.customer_note = form.note.trim();
    if (form.tenders.length > 0) {
        body.tenders = form.tenders.map((tender) => ({
            mode: tender.mode,
            amount: round2(parse(tender.amount) ?? 0),
            ...(trimOrNull(tender.reference) ? { reference: tender.reference.trim() } : {}),
        }));
    }
    if (form.exchange) {
        body.exchange = { return_id: form.exchange.returnId };
        if (needsRemainderRefund(form) && form.remainderMethod) {
            body.exchange.remainder_refund = {
                method: form.remainderMethod,
                ...(trimOrNull(form.remainderReference) ? { reference: form.remainderReference.trim() } : {}),
            };
        }
    }
    return body;
}

/** Fills empty customer fields from another source; what was typed is never overwritten. */
export function prefillCustomer(
    form: NewOrderForm,
    from: { name?: string | null; phone?: string | null; email?: string | null; address?: OrderAddress | null }
): NewOrderForm {
    const next = { ...form };
    if (!next.name.trim() && from.name) next.name = from.name;
    if (!next.phone.trim() && from.phone) next.phone = from.phone;
    if (!next.email.trim() && from.email) next.email = from.email;
    const address = from.address;
    if (address && Object.values(form.shipping).every((value) => !value.trim())) {
        next.shipping = {
            name: address.name ?? '',
            phone: address.phone ?? '',
            line1: address.line1 ?? '',
            line2: address.line2 ?? '',
            landmark: address.landmark ?? '',
            city: address.city ?? '',
            state_code: address.state_code ?? '',
            pincode: address.pincode ?? '',
        };
        next.handOverNow = false;
    }
    return next;
}

export interface LineSource {
    variantId: string | null;
    sku: string | null;
    name: string;
    variantName: string | null;
    qtyScale: number;
    /** Sale step in base units (from the product); 1 when unknown. */
    qtyStep?: number;
    unit: string | null;
    listPrice: number | null;
}

let lineCounter = 0;
const nextKey = () => {
    lineCounter += 1;
    return `l${Date.now().toString(36)}${lineCounter}`;
};

const sameItem = (line: NewOrderLine, source: Pick<LineSource, 'variantId' | 'sku'>) =>
    source.variantId ? line.variantId === source.variantId : !!source.sku && !line.variantId && line.sku === source.sku;

/**
 * The first quantity of a new line: a measured line 1 m when 1 m is on the
 * sale step, else one step (0.3 m steps start at 0.3 m); a counted item one
 * step (a pack of 6 starts at 6, K N4).
 */
export function firstQuantity(source: Pick<LineSource, 'qtyScale' | 'qtyStep'>): string {
    const scale = Math.max(1, source.qtyScale);
    const step = Math.max(1, Math.floor(source.qtyStep ?? 1));
    if (scale === 1) return String(step);
    return lengthInputText(scale % step === 0 ? scale : step, scale);
}

/**
 * Adds one unit of an item (a scanned product label, a picked variant or a
 * typed SKU): a counted line goes up by its sale step (1, or a pack), a
 * measured line is added once with 1 m (or one step) for the person to
 * change. Null = the order already has 50 lines.
 */
export function addItem(lines: NewOrderLine[], source: LineSource): NewOrderLine[] | null {
    const index = lines.findIndex((line) => sameItem(line, source) && line.pieceCodes.length === 0);
    if (index >= 0) {
        const line = lines[index] as NewOrderLine;
        if (line.qtyScale > 1) return lines;
        const current = Number(line.quantity) || 0;
        return lines.map((l, i) => (i === index ? { ...l, quantity: String(current + lineStep(l)) } : l));
    }
    if (lines.length >= MAX_ORDER_LINES) return null;
    return [...lines, { key: nextKey(), ...source, quantity: firstQuantity(source), priceOverride: '', pieceCodes: [] }];
}

/**
 * Adds a scanned piece for "customer takes it now": the piece's line holds its
 * codes and its quantity is the number of codes. 'duplicate' when scanned
 * already; null when the order already has 50 lines.
 */
export function addPiece(
    lines: NewOrderLine[],
    source: LineSource,
    code: string
): NewOrderLine[] | 'duplicate' | null {
    const upper = code.toUpperCase();
    if (lines.some((line) => line.pieceCodes.some((c) => c.toUpperCase() === upper))) return 'duplicate';
    const index = lines.findIndex((line) => sameItem(line, source) && line.pieceCodes.length > 0);
    if (index >= 0) {
        return lines.map((line, i) =>
            i === index
                ? { ...line, pieceCodes: [...line.pieceCodes, code], quantity: String(line.pieceCodes.length + 1) }
                : line
        );
    }
    if (lines.length >= MAX_ORDER_LINES) return null;
    return [...lines, { key: nextKey(), ...source, quantity: '1', priceOverride: '', pieceCodes: [code] }];
}

/** Every sentence key `validateNewOrder` can answer (for the locales test). */
export const NEW_ORDER_PROBLEM_KEYS = [
    'required',
    'phone',
    'email',
    'noLines',
    'tooManyLines',
    'quantity',
    'quantityStep',
    'price',
    'priceZero',
    'priceNotDivisible',
    'pincode',
    'gstin',
    'tooLong',
    'tooManyPayments',
    'amount',
    'remainderMethod',
] as const;
