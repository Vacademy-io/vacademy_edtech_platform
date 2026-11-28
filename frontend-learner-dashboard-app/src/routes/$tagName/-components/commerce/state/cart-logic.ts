/**
 * The shop cart as data: held in the browser per site and per
 * device, repriced by /cart/price on every change. Pure functions; the store around them is
 * cart-store.ts. A line remembers what the shopper saw (name, picture, unit price) so the
 * drawer can draw before the server answers, but no total shown to a shopper is ever computed
 * from these numbers: totals, tax and delivery come from the server.
 */
import type { CartPrice, CartPriceRequest } from '../api/types';

export const CART_VERSION = 1;
export const CART_MAX_LINES = 50;

export interface CartLine {
    /** The variant id: one line per variant. */
    variantId: string;
    slug: string;
    name: string;
    variantLabel: string | null;
    imageUrl: string | null;
    /** Base units. */
    quantity: number;
    qtyScale: number;
    qtyStep: number;
    unit: string | null;
    /** A one-of-a-kind piece: quantity is always one step and there is no stepper. */
    piece: boolean;
    /** What one base unit cost when it was added or last priced. */
    unitPrice: number | null;
    addedAt: number;
}

export interface CartState {
    version: number;
    lines: CartLine[];
    pincode: string | null;
}

export const EMPTY_CART: CartState = { version: CART_VERSION, lines: [], pincode: null };

export type AddResult = { cart: CartState; outcome: 'added' | 'increased' | 'unchanged' | 'full' };

const step = (line: Pick<CartLine, 'qtyStep'>): number => Math.max(1, Math.floor(line.qtyStep || 1));

const onGrid = (quantity: number, line: Pick<CartLine, 'qtyStep' | 'piece'>): number => {
    const s = step(line);
    if (line.piece) return s;
    const q = Number.isFinite(quantity) ? quantity : s;
    return Math.max(s, Math.round(q / s) * s);
};

/** A whole positive number of base units as given, or null: never moved onto a step. */
const wholeUnits = (quantity: number): number | null =>
    Number.isFinite(quantity) && quantity >= 1 ? Math.min(Math.round(quantity), 1e7 - 1) : null;

/**
 * Adds a variant. A variant already in the cart grows by the added quantity (a piece stays at
 * one); a new one goes to the front. Past the line limit nothing is added.
 *
 * Lengths add up exactly (1 m + 2.5 m = 3.5 m) and the line takes the step the product has now.
 * The sum is never rounded, neither to the old step nor to the new one: a sum off the step stays
 * as it is, the server refuses it with QUANTITY_STEP, and the cart offers the valid length
 * ("Set to 3.5 m" for 3.8 m in steps of 0.5 m). Rounding it here would change what the shopper
 * asked for without telling them.
 */
export const addLine = (cart: CartState, line: Omit<CartLine, 'addedAt'>, now: number = Date.now()): AddResult => {
    const index = cart.lines.findIndex((l) => l.variantId === line.variantId);
    if (index >= 0) {
        const existing = cart.lines[index]!;
        const added = wholeUnits(line.quantity) ?? step(line);
        const quantity = existing.piece ? step(existing) : existing.quantity + added;
        if (quantity === existing.quantity) return { cart, outcome: 'unchanged' };
        const lines = cart.lines.slice();
        lines[index] = { ...existing, ...line, quantity, addedAt: existing.addedAt };
        return { cart: { ...cart, lines }, outcome: 'increased' };
    }
    if (cart.lines.length >= CART_MAX_LINES) return { cart, outcome: 'full' };
    const added: CartLine = { ...line, quantity: onGrid(line.quantity, line), addedAt: now };
    return { cart: { ...cart, lines: [added, ...cart.lines] }, outcome: 'added' };
};

/** Sets a line's quantity (on its step grid); zero or less removes the line. */
export const setQuantity = (cart: CartState, variantId: string, quantity: number): CartState => {
    if (!(quantity > 0)) return removeLine(cart, variantId);
    return {
        ...cart,
        lines: cart.lines.map((l) => (l.variantId === variantId ? { ...l, quantity: onGrid(quantity, l) } : l)),
    };
};

export const removeLine = (cart: CartState, variantId: string): CartState => ({
    ...cart,
    lines: cart.lines.filter((l) => l.variantId !== variantId),
});

export const setPincode = (cart: CartState, pincode: string | null): CartState => ({
    ...cart,
    pincode: pincode && /^[1-9]\d{5}$/.test(pincode) ? pincode : null,
});

/**
 * The number on the cart button: pieces for goods sold by the piece, and ONE for a line of
 * cloth however long it is (2.5 m of fabric is one thing in the bag, not 25).
 */
export const cartCount = (cart: CartState): number =>
    cart.lines.reduce((n, l) => n + (Math.floor(l.qtyScale || 1) > 1 ? 1 : Math.max(1, Math.round(l.quantity))), 0);

/** What /cart/price is sent: variant, quantity and the price the cart last showed. */
export const toPriceRequest = (cart: CartState): CartPriceRequest => ({
    lines: cart.lines.slice(0, CART_MAX_LINES).map((l) => ({
        line_ref: l.variantId,
        variant_id: l.variantId,
        quantity: l.quantity,
        ...(l.unitPrice !== null ? { unit_price: l.unitPrice } : {}),
    })),
    ...(cart.pincode ? { pincode: cart.pincode } : {}),
    payment_method: 'PREPAID',
});

/** A stable key of what was sent, so an answer for an older cart is never shown for a newer one. */
export const priceRequestKey = (cart: CartState, locale: string): string =>
    JSON.stringify([locale, cart.pincode, cart.lines.map((l) => [l.variantId, l.quantity])]);

/**
 * The server's answer folded back into the remembered lines: names, labels, scale, step, unit
 * and the new unit price of every priced line, so the next request reports no stale price. A
 * line the server could not price takes only the step its refusal names; the drawer shows why.
 * No quantity is ever changed here.
 */
export const applyPrice = (cart: CartState, price: CartPrice): CartState => {
    const priced = new Map((price.lines || []).map((l) => [l.line_ref, l]));
    const refused = new Map(
        (price.unavailable || [])
            .filter((u) => typeof u.qty_step === 'number' && Number.isInteger(u.qty_step) && u.qty_step > 0)
            .map((u) => [u.line_ref, u.qty_step as number])
    );
    let changed = false;
    const lines = cart.lines.map((line) => {
        const p = priced.get(line.variantId);
        if (!p) {
            // A refused line still names today's step: take it, so the stepper and the "Set to"
            // fix never work on a step the product no longer has. Its quantity is left as it is.
            // (Scale and unit are not in a refusal; the server locks both once a product is live.)
            const stepNow = refused.get(line.variantId);
            if (stepNow === undefined || stepNow === line.qtyStep) return line;
            changed = true;
            return { ...line, qtyStep: stepNow };
        }
        const next: CartLine = {
            ...line,
            name: p.name || line.name,
            slug: p.slug || line.slug,
            variantLabel: p.variant_label ?? line.variantLabel,
            qtyScale: p.qty_scale > 0 ? p.qty_scale : line.qtyScale,
            qtyStep: p.qty_step > 0 ? p.qty_step : line.qtyStep,
            unit: p.unit ?? line.unit,
            piece: !!p.piece,
            unitPrice: typeof p.unit_price === 'number' ? p.unit_price : line.unitPrice,
        };
        if (JSON.stringify(next) !== JSON.stringify(line)) changed = true;
        return next;
    });
    return changed ? { ...cart, lines } : cart;
};

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const posInt = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 1e7 ? v : fallback;

/** A cart read back from storage. Anything malformed is dropped instead of trusted. */
export const reviveCart = (raw: unknown): CartState => {
    if (!raw || typeof raw !== 'object') return EMPTY_CART;
    const data = raw as { version?: unknown; lines?: unknown; pincode?: unknown };
    if (data.version !== CART_VERSION || !Array.isArray(data.lines)) return EMPTY_CART;
    const seen = new Set<string>();
    const lines: CartLine[] = [];
    for (const item of data.lines) {
        if (!item || typeof item !== 'object' || lines.length >= CART_MAX_LINES) continue;
        const l = item as Record<string, unknown>;
        const variantId = str(l.variantId, 64);
        if (!variantId || seen.has(variantId)) continue;
        seen.add(variantId);
        const qtyStep = posInt(l.qtyStep, 1);
        const piece = l.piece === true;
        lines.push({
            variantId,
            slug: str(l.slug, 160),
            name: str(l.name, 300),
            variantLabel: str(l.variantLabel, 200) || null,
            imageUrl: /^https?:\/\//i.test(str(l.imageUrl, 2000)) ? str(l.imageUrl, 2000) : null,
            // As saved, not moved onto the step: a length off a step that changed since is kept
            // and the cart offers the fix (a piece is always one step).
            quantity: piece ? qtyStep : posInt(l.quantity, qtyStep),
            qtyScale: posInt(l.qtyScale, 1),
            qtyStep,
            unit: str(l.unit, 16) || null,
            piece,
            unitPrice: typeof l.unitPrice === 'number' && Number.isFinite(l.unitPrice) && l.unitPrice >= 0 ? l.unitPrice : null,
            addedAt: typeof l.addedAt === 'number' ? l.addedAt : 0,
        });
    }
    return setPincode({ version: CART_VERSION, lines, pincode: null }, str(data.pincode, 6) || null);
};

export const cartStorageKey = (instituteId: string, tagName: string): string =>
    `commerce-cart:${instituteId}:${(tagName || '').toLowerCase()}`;
