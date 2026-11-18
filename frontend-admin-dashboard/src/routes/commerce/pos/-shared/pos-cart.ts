import type {
    BillDiscountRequest,
    CatalogueItem,
    LocalText,
    QuoteRequest,
    SaleCustomerRequest,
    SaleRequest,
    ScanPiece,
    TenderRequest,
} from './pos-types';

/**
 * The bill on the counter, as a pure reducer (contract §7.4). One line per
 * variant (the server refuses a variant on two lines); quantities are stored
 * units (`qty_scale` 10 = tenths of a metre); piece lines carry the scanned
 * piece ids and codes; `line_ref` is `l1`, `l2`, … in the order lines were
 * added and never reused while the bill lives.
 *
 * `cartStep` returns the next state and, when the event is refused, the reason
 * (`pos.cart.<code>`) for the screen to say.
 */

export const MAX_LINES = 50;
export const MAX_QUANTITY = 100_000;

export const CART_REFUSALS = [
    'scanPieceLabel',
    'notHere',
    'alreadyOnBill',
    'quantityStep',
    'quantityRange',
    'tooManyLines',
    'discountTooHigh',
    'pieceLine',
] as const;
export type CartRefusal = (typeof CART_REFUSALS)[number];

/** Server refusals shown on a line until the next quote (§3.9 step 3). */
export interface LineMark {
    code: string;
    /** `HH:MM` for IN_ONLINE_CHECKOUT. */
    time?: string | null;
    /** `quote`: set from the last quote's `unavailable` and replaced by the next one. */
    source?: 'quote' | 'sale';
}

export interface CartLine {
    lineRef: string;
    variantId: string;
    sku: string | null;
    names: LocalText;
    variantLabel: LocalText;
    unit: string | null;
    qtyScale: number;
    qtyStep: number;
    stockMode: string;
    tracked: boolean;
    unitPrice: number;
    mrp: number | null;
    onHand: number | null;
    /** Stored units. */
    quantity: number;
    pieceIds: string[];
    pieceCodes: string[];
    /** Rupees off this line (0..gross). */
    lineDiscount: number;
    mark: LineMark | null;
}

export interface BillDiscount {
    kind: 'AMOUNT' | 'PERCENT';
    value: number;
}

export interface CartCustomer {
    phone: string;
    name: string;
    businessBill: boolean;
    gstin: string;
    legalName: string;
}

export interface CartExchange {
    returnId: string;
    number: string | null;
    credit: number;
}

export interface CartState {
    lines: CartLine[];
    billDiscount: BillDiscount | null;
    /** Why any discount (line or bill) was given; required with one. */
    discountReason: string;
    customer: CartCustomer;
    exchange: CartExchange | null;
    /** Next `l<n>`; never goes back while the bill lives. */
    nextLineNo: number;
}

export type CartEvent =
    | { type: 'ADD_VARIANT'; item: CatalogueItem }
    | { type: 'ADD_PIECE'; item: CatalogueItem; piece: ScanPiece }
    | { type: 'SET_QUANTITY'; lineRef: string; quantity: number }
    | { type: 'REMOVE_PIECE'; lineRef: string; pieceId: string }
    | { type: 'REMOVE_LINE'; lineRef: string }
    | { type: 'SET_LINE_DISCOUNT'; lineRef: string; amount: number }
    | { type: 'SET_BILL_DISCOUNT'; discount: BillDiscount | null; reason?: string }
    | { type: 'SET_DISCOUNT_REASON'; reason: string }
    | { type: 'SET_CUSTOMER'; customer: Partial<CartCustomer> }
    | { type: 'SET_EXCHANGE'; exchange: CartExchange | null }
    | { type: 'MARK_LINE'; lineRef: string; mark: LineMark | null }
    /** The server's price moved (quote `changes`): take it and say so on the line. */
    | { type: 'SET_PRICE'; lineRef: string; unitPrice: number }
    | { type: 'CLEAR_MARKS' }
    | { type: 'CLEAR' }
    | { type: 'RESTORE'; state: CartState };

export interface CartResult {
    state: CartState;
    refusal: CartRefusal | null;
    /** A measured line the screen should open the length box for. */
    openLengthFor: string | null;
}

export const EMPTY_CUSTOMER: CartCustomer = {
    phone: '',
    name: '',
    businessBill: false,
    gstin: '',
    legalName: '',
};

export const emptyCart = (): CartState => ({
    lines: [],
    billDiscount: null,
    discountReason: '',
    customer: { ...EMPTY_CUSTOMER },
    exchange: null,
    nextLineNo: 1,
});

export const isPieceItem = (item: Pick<CatalogueItem, 'stock_mode' | 'tracked'>): boolean =>
    item.stock_mode === 'PIECE' && item.tracked;

export const isMeasured = (line: Pick<CartLine, 'qtyScale'>): boolean => line.qtyScale > 1;

export const isPieceLine = (line: Pick<CartLine, 'stockMode' | 'tracked'>): boolean =>
    line.stockMode === 'PIECE' && line.tracked;

/** Gross of a line in paise: price × quantity in display units. */
export const lineGrossPaise = (line: Pick<CartLine, 'unitPrice' | 'quantity' | 'qtyScale'>): number =>
    Math.round((line.unitPrice * 100 * line.quantity) / (line.qtyScale > 1 ? line.qtyScale : 1));

export const lineGross = (line: Pick<CartLine, 'unitPrice' | 'quantity' | 'qtyScale'>): number =>
    lineGrossPaise(line) / 100;

/** Goods value before any discount (the base of the cashier's percent limit). */
export const cartGross = (state: CartState): number =>
    state.lines.reduce((sum, line) => sum + lineGrossPaise(line), 0) / 100;

export const hasDiscount = (state: CartState): boolean =>
    state.billDiscount !== null || state.lines.some((line) => line.lineDiscount > 0);

const newLine = (state: CartState, item: CatalogueItem, quantity: number): CartLine => ({
    lineRef: `l${state.nextLineNo}`,
    variantId: item.variant_id,
    sku: item.sku,
    names: item.names,
    variantLabel: item.variant_label,
    unit: item.unit,
    qtyScale: item.qty_scale > 0 ? item.qty_scale : 1,
    qtyStep: item.qty_step > 0 ? item.qty_step : 1,
    stockMode: item.stock_mode,
    tracked: item.tracked,
    unitPrice: item.unit_price,
    mrp: item.mrp,
    onHand: item.on_hand,
    quantity,
    pieceIds: [],
    pieceCodes: [],
    lineDiscount: 0,
    mark: null,
});

const done = (state: CartState): CartResult => ({ state, refusal: null, openLengthFor: null });
const refuse = (state: CartState, refusal: CartRefusal): CartResult => ({
    state,
    refusal,
    openLengthFor: null,
});

const mapLine = (state: CartState, lineRef: string, change: (line: CartLine) => CartLine): CartState => ({
    ...state,
    lines: state.lines.map((line) => (line.lineRef === lineRef ? change(line) : line)),
});

/** A line discount cannot exceed what the line is worth now. */
const clampDiscount = (line: CartLine): CartLine =>
    line.lineDiscount > lineGross(line) ? { ...line, lineDiscount: lineGross(line) } : line;

export function quantityProblem(line: Pick<CartLine, 'qtyStep'>, quantity: number): CartRefusal | null {
    if (!Number.isInteger(quantity) || quantity < line.qtyStep || quantity > MAX_QUANTITY) {
        return 'quantityRange';
    }
    if (quantity % line.qtyStep !== 0) return 'quantityStep';
    return null;
}

export function cartStep(state: CartState, event: CartEvent): CartResult {
    switch (event.type) {
        case 'ADD_VARIANT': {
            const { item } = event;
            if (isPieceItem(item)) return refuse(state, 'scanPieceLabel');
            const existing = state.lines.find((line) => line.variantId === item.variant_id);
            if (existing) {
                // A measured line is changed by typing a length, not by scanning again.
                if (isMeasured(existing)) {
                    return { state, refusal: null, openLengthFor: existing.lineRef };
                }
                const next = existing.quantity + existing.qtyStep;
                if (next > MAX_QUANTITY) return refuse(state, 'quantityRange');
                return done(mapLine(state, existing.lineRef, (line) => ({ ...line, quantity: next, mark: null })));
            }
            if (state.lines.length >= MAX_LINES) return refuse(state, 'tooManyLines');
            const line = newLine(state, item, item.qty_step > 0 ? item.qty_step : 1);
            const nextState = { ...state, lines: [...state.lines, line], nextLineNo: state.nextLineNo + 1 };
            return {
                state: nextState,
                refusal: null,
                openLengthFor: isMeasured(line) ? line.lineRef : null,
            };
        }
        case 'ADD_PIECE': {
            const { item, piece } = event;
            if (!piece.here) return refuse(state, 'notHere');
            const onBill = state.lines.some(
                (line) => line.pieceIds.includes(piece.id) || line.pieceCodes.includes(piece.code)
            );
            if (onBill) return refuse(state, 'alreadyOnBill');
            const existing = state.lines.find((line) => line.variantId === item.variant_id);
            if (existing) {
                if (existing.quantity + 1 > MAX_QUANTITY) return refuse(state, 'quantityRange');
                return done(
                    mapLine(state, existing.lineRef, (line) => ({
                        ...line,
                        quantity: line.pieceIds.length + 1,
                        pieceIds: [...line.pieceIds, piece.id],
                        pieceCodes: [...line.pieceCodes, piece.code],
                        mark: null,
                    }))
                );
            }
            if (state.lines.length >= MAX_LINES) return refuse(state, 'tooManyLines');
            const line = {
                ...newLine(state, item, 1),
                pieceIds: [piece.id],
                pieceCodes: [piece.code],
            };
            return done({ ...state, lines: [...state.lines, line], nextLineNo: state.nextLineNo + 1 });
        }
        case 'SET_QUANTITY': {
            const line = state.lines.find((l) => l.lineRef === event.lineRef);
            if (!line) return done(state);
            if (isPieceLine(line)) return refuse(state, 'pieceLine');
            const problem = quantityProblem(line, event.quantity);
            if (problem) return refuse(state, problem);
            return done(
                mapLine(state, event.lineRef, (l) => clampDiscount({ ...l, quantity: event.quantity, mark: null }))
            );
        }
        case 'REMOVE_PIECE': {
            const line = state.lines.find((l) => l.lineRef === event.lineRef);
            if (!line) return done(state);
            const index = line.pieceIds.indexOf(event.pieceId);
            if (index < 0) return done(state);
            if (line.pieceIds.length === 1) {
                return done({ ...state, lines: state.lines.filter((l) => l.lineRef !== event.lineRef) });
            }
            return done(
                mapLine(state, event.lineRef, (l) =>
                    clampDiscount({
                        ...l,
                        pieceIds: l.pieceIds.filter((_, i) => i !== index),
                        pieceCodes: l.pieceCodes.filter((_, i) => i !== index),
                        quantity: l.pieceIds.length - 1,
                        mark: null,
                    })
                )
            );
        }
        case 'REMOVE_LINE':
            return done({ ...state, lines: state.lines.filter((l) => l.lineRef !== event.lineRef) });
        case 'SET_LINE_DISCOUNT': {
            const line = state.lines.find((l) => l.lineRef === event.lineRef);
            if (!line) return done(state);
            const amount = Math.round(event.amount * 100) / 100;
            if (!Number.isFinite(amount) || amount < 0 || amount > lineGross(line)) {
                return refuse(state, 'discountTooHigh');
            }
            return done(mapLine(state, event.lineRef, (l) => ({ ...l, lineDiscount: amount })));
        }
        case 'SET_BILL_DISCOUNT': {
            const { discount } = event;
            if (discount) {
                const bad =
                    !Number.isFinite(discount.value) ||
                    discount.value <= 0 ||
                    (discount.kind === 'PERCENT' && discount.value > 100);
                if (bad) return refuse(state, 'discountTooHigh');
            }
            return done({
                ...state,
                billDiscount: discount,
                discountReason: event.reason ?? state.discountReason,
            });
        }
        case 'SET_DISCOUNT_REASON':
            return done({ ...state, discountReason: event.reason });
        case 'SET_CUSTOMER':
            return done({ ...state, customer: { ...state.customer, ...event.customer } });
        case 'SET_EXCHANGE':
            return done({ ...state, exchange: event.exchange });
        case 'MARK_LINE':
            return done(mapLine(state, event.lineRef, (l) => ({ ...l, mark: event.mark })));
        case 'SET_PRICE': {
            const line = state.lines.find((l) => l.lineRef === event.lineRef);
            if (!line || !Number.isFinite(event.unitPrice) || event.unitPrice < 0) return done(state);
            if (line.unitPrice === event.unitPrice) return done(state);
            return done(
                mapLine(state, event.lineRef, (l) =>
                    clampDiscount({ ...l, unitPrice: event.unitPrice, mark: { code: 'PRICE_CHANGED' } })
                )
            );
        }
        case 'CLEAR_MARKS':
            return done({ ...state, lines: state.lines.map((l) => (l.mark ? { ...l, mark: null } : l)) });
        case 'CLEAR':
            return done(emptyCart());
        case 'RESTORE':
            return done(event.state);
        default:
            return done(state);
    }
}

export const cartReducer = (state: CartState, event: CartEvent): CartState => cartStep(state, event).state;

const amount2 = (value: number): string => (Math.round(value * 100) / 100).toFixed(2);

function customerRequest(customer: CartCustomer): SaleCustomerRequest | undefined {
    const phone = customer.phone.replace(/\s+/g, '');
    const name = customer.name.trim();
    const gstin = customer.businessBill ? customer.gstin.replace(/\s+/g, '').toUpperCase() : '';
    const legal = customer.businessBill ? customer.legalName.trim() : '';
    if (!phone && !gstin) return undefined; // walk-in
    return {
        ...(phone ? { phone } : {}),
        ...(name ? { name } : {}),
        ...(gstin ? { buyer_gstin: gstin, buyer_legal_name: legal } : {}),
    };
}

function billDiscountRequest(state: CartState): BillDiscountRequest | undefined {
    if (!state.billDiscount) return undefined;
    return {
        kind: state.billDiscount.kind,
        value: amount2(state.billDiscount.value),
        reason: state.discountReason.trim(),
    };
}

/** What `POST /pos/quote` takes: the bill without money, tenders or approval. */
export function toQuoteRequest(state: CartState, sessionId: string): QuoteRequest {
    const customer = customerRequest(state.customer);
    const billDiscount = billDiscountRequest(state);
    return {
        session_id: sessionId,
        lines: state.lines.map((line) => ({
            line_ref: line.lineRef,
            variant_id: line.variantId,
            quantity: line.quantity,
            ...(isPieceLine(line) ? { piece_ids: [...line.pieceIds] } : {}),
            ...(line.lineDiscount > 0 ? { line_discount: amount2(line.lineDiscount) } : {}),
            unit_price: amount2(line.unitPrice),
        })),
        ...(billDiscount ? { bill_discount: billDiscount } : {}),
        // Contract gap: §3.9 needs a reason with ANY discount but only bill_discount has one.
        // Sent top level too, so a line-discount-only bill carries its reason.
        ...(hasDiscount(state) && state.discountReason.trim()
            ? { discount_reason: state.discountReason.trim() }
            : {}),
        ...(customer ? { customer } : {}),
        ...(state.exchange ? { exchange: { return_id: state.exchange.returnId } } : {}),
    };
}

/**
 * What `POST /pos/sales` takes, without `client_request_id` and `approval`
 * (the request id is derived from exactly this body, §3.9).
 */
export function toSaleRequest(
    state: CartState,
    sessionId: string,
    tenders: TenderRequest[],
    notify: boolean,
    remainder?: { method: string; reference: string | null } | null
): SaleRequest {
    const quote = toQuoteRequest(state, sessionId);
    const { exchange: _quoteExchange, ...rest } = quote;
    return {
        ...rest,
        tenders,
        ...(state.exchange
            ? {
                  exchange: {
                      return_id: state.exchange.returnId,
                      ...(remainder ? { remainder_refund: remainder } : {}),
                  },
              }
            : {}),
        notify,
    };
}

/** The product's name in the admin's language, else the other one. */
export const pickText = (value: LocalText | null | undefined, lang: 'hi' | 'en'): string =>
    (lang === 'hi' ? value?.hi || value?.en : value?.en || value?.hi) ?? '';
