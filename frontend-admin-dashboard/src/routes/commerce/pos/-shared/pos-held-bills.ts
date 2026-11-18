import type { CartState } from './pos-cart';

/**
 * Bills put aside at the counter ("Hold bill"), kept in this device's
 * `localStorage` only (contract §7.2; OPS §6 step 7: lost if the device
 * fails). At most {@link MAX_HELD} per register; holding one more drops the
 * oldest. Storage that throws reads as "nothing held".
 *
 * A held bill carries the buyer's phone and GSTIN on a shared till, so it does
 * not outlive its counter session: it is dropped when read after
 * {@link HELD_MAX_AGE_MS} or under another session of the register, and all of
 * a register's held bills go when its counter is closed. Logging out wipes
 * this device's storage (`removeCookiesAndLogout`). An exchange credit is never
 * held: it stays on the till.
 */

export const MAX_HELD = 10;
/** 12 hours. */
export const HELD_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface HeldBill {
    id: string;
    held_at: string;
    /** The counter session the bill was held in. */
    session_id?: string | null;
    cart: CartState;
}

export interface HeldReadOptions {
    /** The open session reading: bills held under another session are dropped. */
    sessionId?: string | null;
    now?: Date;
}

export const heldBillsKey = (instituteId: string, registerId: string) =>
    `commerce.pos.held.${instituteId}.${registerId}`;

function store(): Storage | null {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

function write(instituteId: string, registerId: string, bills: HeldBill[]): boolean {
    try {
        const s = store();
        if (!s) return false;
        s.setItem(heldBillsKey(instituteId, registerId), JSON.stringify(bills));
        return true;
    } catch {
        return false;
    }
}

const isFresh = (bill: HeldBill, options: HeldReadOptions): boolean => {
    const at = Date.parse(bill.held_at);
    const now = (options.now ?? new Date()).getTime();
    if (!Number.isFinite(at) || now - at > HELD_MAX_AGE_MS) return false;
    if (options.sessionId && bill.session_id && bill.session_id !== options.sessionId) return false;
    return true;
};

export function readHeld(instituteId: string, registerId: string, options: HeldReadOptions = {}): HeldBill[] {
    try {
        const raw = store()?.getItem(heldBillsKey(instituteId, registerId));
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        const valid = parsed.filter(
            (bill): bill is HeldBill =>
                !!bill &&
                typeof (bill as HeldBill).id === 'string' &&
                typeof (bill as HeldBill).held_at === 'string' &&
                Array.isArray((bill as HeldBill).cart?.lines)
        );
        const fresh = valid.filter((bill) => isFresh(bill, options));
        // Expired bills (and their buyers' details) leave the device as soon as they are seen.
        if (fresh.length !== parsed.length) write(instituteId, registerId, fresh);
        return fresh;
    } catch {
        return [];
    }
}

/** Drops every held bill of the register (its counter was closed). */
export function clearHeld(instituteId: string, registerId: string): void {
    try {
        store()?.removeItem(heldBillsKey(instituteId, registerId));
    } catch {
        // Nothing to do.
    }
}

/** Holds the bill; returns the list as stored (newest last), or null when storage refused. */
export function holdBill(
    instituteId: string,
    registerId: string,
    cart: CartState,
    now: Date = new Date(),
    sessionId: string | null = null
): HeldBill[] | null {
    const bills = readHeld(instituteId, registerId, { sessionId, now });
    const bill: HeldBill = {
        id: `h-${now.getTime().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
        held_at: now.toISOString(),
        session_id: sessionId,
        cart: { ...cart, exchange: null, lines: cart.lines.map((line) => ({ ...line, mark: null })) },
    };
    const next = [...bills, bill].slice(-MAX_HELD);
    return write(instituteId, registerId, next) ? next : null;
}

/** Takes one bill out (it is no longer held). */
export function takeHeld(
    instituteId: string,
    registerId: string,
    id: string,
    options: HeldReadOptions = {}
): HeldBill | null {
    const bills = readHeld(instituteId, registerId, options);
    const bill = bills.find((b) => b.id === id) ?? null;
    if (bill) write(instituteId, registerId, bills.filter((b) => b.id !== id));
    return bill;
}

export function dropHeld(
    instituteId: string,
    registerId: string,
    id: string,
    options: HeldReadOptions = {}
): HeldBill[] {
    const next = readHeld(instituteId, registerId, options).filter((b) => b.id !== id);
    write(instituteId, registerId, next);
    return next;
}
