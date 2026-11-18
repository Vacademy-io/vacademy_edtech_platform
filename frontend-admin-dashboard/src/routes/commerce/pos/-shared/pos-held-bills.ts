import type { CartState } from './pos-cart';

/**
 * Bills put aside at the counter ("Hold bill"), kept in this device's
 * `localStorage` only (contract §7.2; OPS §6 step 7: lost if the device
 * fails). At most {@link MAX_HELD} per register; holding one more drops the
 * oldest. Storage that throws reads as "nothing held".
 */

export const MAX_HELD = 10;

export interface HeldBill {
    id: string;
    held_at: string;
    cart: CartState;
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

export function readHeld(instituteId: string, registerId: string): HeldBill[] {
    try {
        const raw = store()?.getItem(heldBillsKey(instituteId, registerId));
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (bill): bill is HeldBill =>
                !!bill &&
                typeof (bill as HeldBill).id === 'string' &&
                typeof (bill as HeldBill).held_at === 'string' &&
                Array.isArray((bill as HeldBill).cart?.lines)
        );
    } catch {
        return [];
    }
}

/** Holds the bill; returns the list as stored (newest last), or null when storage refused. */
export function holdBill(
    instituteId: string,
    registerId: string,
    cart: CartState,
    now: Date = new Date()
): HeldBill[] | null {
    const bills = readHeld(instituteId, registerId);
    const bill: HeldBill = {
        id: `h-${now.getTime().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
        held_at: now.toISOString(),
        cart: { ...cart, lines: cart.lines.map((line) => ({ ...line, mark: null })) },
    };
    const next = [...bills, bill].slice(-MAX_HELD);
    return write(instituteId, registerId, next) ? next : null;
}

/** Takes one bill out (it is no longer held). */
export function takeHeld(instituteId: string, registerId: string, id: string): HeldBill | null {
    const bills = readHeld(instituteId, registerId);
    const bill = bills.find((b) => b.id === id) ?? null;
    if (bill) write(instituteId, registerId, bills.filter((b) => b.id !== id));
    return bill;
}

export function dropHeld(instituteId: string, registerId: string, id: string): HeldBill[] {
    const next = readHeld(instituteId, registerId).filter((b) => b.id !== id);
    write(instituteId, registerId, next);
    return next;
}
