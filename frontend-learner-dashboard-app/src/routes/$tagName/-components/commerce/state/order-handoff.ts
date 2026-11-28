/**
 * How the storefront opens the order page in this tab (contract P2 §9). The order token is never
 * put in an address or in history.state, which page scripts and tag managers can read: the
 * history entry carries only a random key, and the token sits in sessionStorage under
 * "cmx.order.v1.<instituteId>" with that key. A reload, Back, or a language switch (which
 * replaces history.state) still finds it in this tab; closing the tab ends it.
 *
 * Each record also says when this tab's payment window said "paid" (the order page then waits
 * for the capture instead of offering "Pay now"), whether this tab placed or paid the order (only
 * then does the page send `purchase`), and whether the phone was proved for it (only then does
 * the page promise the details under "Your orders").
 *
 * Every storage read and write is wrapped: with storage blocked or full, records live in memory
 * for the life of the page.
 */
import { browserSessionStorage, type KeyValueStorage } from './session';

export const ORDER_HANDOFF_PREFIX = 'cmx.order.v1.';
/** The one history-state key the order page uses: a random key, never the token. */
export const ORDER_KEY_STATE = 'cmxOrder';

export interface OrderHandoff {
    token: string;
    /** Epoch ms when this tab's payment window said the payment went through, else null. */
    paidAt: number | null;
    /** This tab placed the order at checkout or paid it on the order page. */
    placedHere: boolean;
    /** The phone was proved for this order (its details show under "Your orders" and Track). */
    phoneProved: boolean;
}

interface Stored {
    last: string;
    entries: Record<string, OrderHandoff & { at: number }>;
}

const MAX_ENTRIES = 10;
const KEY_SHAPE = /^[a-z0-9]{8,40}$/;
const memory = new Map<string, Stored>();
/** Shops whose last write to storage failed: their records are read from memory. */
const memoryOnly = new Set<string>();

export const orderHandoffKey = (instituteId: string): string => `${ORDER_HANDOFF_PREFIX}${instituteId}`;

const isToken = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= 512 && /^[A-Za-z0-9._~-]+$/.test(value);

const newKey = (): string => {
    try {
        const bytes = new Uint8Array(12);
        globalThis.crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
        return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    }
};

const clean = (raw: unknown): Stored | null => {
    if (!raw || typeof raw !== 'object') return null;
    const { last, entries } = raw as { last?: unknown; entries?: unknown };
    if (!entries || typeof entries !== 'object') return null;
    const out: Stored['entries'] = {};
    for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
        if (!KEY_SHAPE.test(key) || !value || typeof value !== 'object') continue;
        const v = value as Record<string, unknown>;
        if (!isToken(v.token)) continue;
        out[key] = {
            token: v.token,
            paidAt: typeof v.paidAt === 'number' && Number.isFinite(v.paidAt) ? v.paidAt : null,
            placedHere: v.placedHere === true,
            phoneProved: v.phoneProved === true,
            at: typeof v.at === 'number' && Number.isFinite(v.at) ? v.at : 0,
        };
    }
    return { last: typeof last === 'string' && out[last] ? last : '', entries: out };
};

const read = (instituteId: string, storage: KeyValueStorage | null): Stored => {
    if (storage && !memoryOnly.has(instituteId)) {
        try {
            const raw = storage.getItem(orderHandoffKey(instituteId));
            return (raw ? clean(JSON.parse(raw)) : null) || { last: '', entries: {} };
        } catch {
            // Blocked or malformed: the copy in memory, if any.
        }
    }
    return memory.get(instituteId) || { last: '', entries: {} };
};

const write = (instituteId: string, stored: Stored, storage: KeyValueStorage | null): void => {
    const keys = Object.keys(stored.entries).sort((a, b) => stored.entries[b]!.at - stored.entries[a]!.at);
    for (const key of keys.slice(MAX_ENTRIES)) if (key !== stored.last) delete stored.entries[key];
    memory.set(instituteId, stored);
    try {
        storage?.setItem(orderHandoffKey(instituteId), JSON.stringify(stored));
    } catch {
        // Full or blocked: the copy in memory serves this page from now on.
        memoryOnly.add(instituteId);
    }
};

/** The random key in a history state, else null. */
export const orderKeyFromState = (state: unknown): string | null => {
    const value = state && typeof state === 'object' ? (state as Record<string, unknown>)[ORDER_KEY_STATE] : null;
    return typeof value === 'string' && KEY_SHAPE.test(value) ? value : null;
};

/**
 * Keeps the order's token for the order page and answers the history state to open it with
 * ({ cmxOrder: <random key> }), or {} when there is no usable token. What an earlier record of
 * the same order said (placed or paid here, phone proved) is kept.
 */
export const handOffOrder = (
    instituteId: string,
    token: string | null | undefined,
    opts: { paidAt?: number | null; placedHere?: boolean; phoneProved?: boolean } = {},
    storage: KeyValueStorage | null = browserSessionStorage()
): Record<string, unknown> => {
    if (!isToken(token)) return {};
    const stored = read(instituteId, storage);
    const earlier = Object.values(stored.entries).filter((e) => e.token === token);
    const paidAt = typeof opts.paidAt === 'number' && Number.isFinite(opts.paidAt) ? opts.paidAt : null;
    const key = newKey();
    // Strictly newer than every kept record, so the oldest go first when the list is trimmed.
    const at = Object.values(stored.entries).reduce((max, e) => Math.max(max, e.at + 1), Date.now());
    stored.entries[key] = {
        token,
        paidAt: paidAt ?? earlier.reduce<number | null>((max, e) => (e.paidAt !== null && (max === null || e.paidAt > max) ? e.paidAt : max), null),
        placedHere: opts.placedHere === true || earlier.some((e) => e.placedHere),
        phoneProved: opts.phoneProved === true || earlier.some((e) => e.phoneProved),
        at,
    };
    stored.last = key;
    write(instituteId, stored, storage);
    return { [ORDER_KEY_STATE]: key };
};

/**
 * The order this history entry opens: the record its key names; without a key (a language switch
 * replaced the state), the record this tab used last. Null when there is none.
 */
export const readOrderHandoff = (
    instituteId: string,
    state: unknown,
    storage: KeyValueStorage | null = browserSessionStorage()
): (OrderHandoff & { key: string }) | null => {
    const stored = read(instituteId, storage);
    const fromState = orderKeyFromState(state);
    const key = fromState ?? stored.last;
    const entry = key ? stored.entries[key] : undefined;
    if (!entry) return null;
    if (stored.last !== key) {
        // The page in view is the one a later language switch must fall back to.
        stored.last = key;
        write(instituteId, stored, storage);
    }
    return { key, token: entry.token, paidAt: entry.paidAt, placedHere: entry.placedHere, phoneProved: entry.phoneProved };
};

/** Records that this tab's payment window said "paid" for the order under `key`. */
export const markOrderPaid = (
    instituteId: string,
    key: string,
    paidAt: number,
    storage: KeyValueStorage | null = browserSessionStorage()
): void => {
    const stored = read(instituteId, storage);
    const entry = stored.entries[key];
    if (!entry) return;
    stored.entries[key] = { ...entry, paidAt, placedHere: true };
    write(instituteId, stored, storage);
};

/** Test hook: forgets the in-memory copies. */
export const resetOrderHandoffMemory = (): void => {
    memory.clear();
    memoryOnly.clear();
};
