/**
 * The shopper session of one shop on this device (contract P2 §4, §9): the 7-day token that
 * /otp/verify issues for CHECKOUT and ACCOUNT, kept in localStorage under its own key per
 * institute ("cmx.session.v1.<instituteId>"). It is not a learner login: it is never written
 * to the learner app's token keys and never sent as Authorization, only as X-Commerce-Session.
 *
 * Every storage read and write is wrapped: a private window, blocked site data or a full quota
 * means "no session", never an error on the page.
 */
import type { OtpVerified } from '../api/types';

export const SESSION_KEY_PREFIX = 'cmx.session.v1.';

export interface ShopperSession {
    token: string;
    /** Epoch milliseconds. */
    expiresAt: number;
    /** "••••••3210", as the server masked it. The full number is never stored: /me answers it. */
    phoneMasked: string | null;
}

export interface KeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** The page's own storage (window first: some runtimes shadow the bare global). */
export const browserLocalStorage = (): KeyValueStorage | null => {
    try {
        if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
};

export const browserSessionStorage = (): KeyValueStorage | null => {
    try {
        if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage;
        return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
        return null;
    }
};

export const sessionKey = (instituteId: string): string => `${SESSION_KEY_PREFIX}${instituteId}`;

const TOKEN_SHAPE = /^s1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_TOKEN = 512;

const listeners = new Set<() => void>();

/** Called when this tab saves or clears a session (other tabs hear the storage event). */
export const onSessionChange = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

const notify = () => {
    for (const listener of Array.from(listeners)) {
        try {
            listener();
        } catch {
            // A listener's fault is its own.
        }
    }
};

export const clearSession = (instituteId: string, storage: KeyValueStorage | null = browserLocalStorage()): void => {
    try {
        storage?.removeItem(sessionKey(instituteId));
    } catch {
        // Nothing stored, or storage blocked: there is nothing to clear.
    }
    notify();
};

/** The stored session of this shop, or null (none, malformed, expired: an expired one is removed). */
export const readSession = (
    instituteId: string,
    storage: KeyValueStorage | null = browserLocalStorage(),
    now: number = Date.now()
): ShopperSession | null => {
    if (!instituteId || !storage) return null;
    let raw: string | null = null;
    try {
        raw = storage.getItem(sessionKey(instituteId));
    } catch {
        return null;
    }
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<ShopperSession> | null;
        const token = typeof parsed?.token === 'string' ? parsed.token : '';
        const expiresAt = Number(parsed?.expiresAt);
        if (!TOKEN_SHAPE.test(token) || token.length > MAX_TOKEN || !Number.isFinite(expiresAt)) throw new Error('shape');
        if (expiresAt <= now) {
            try {
                storage.removeItem(sessionKey(instituteId));
            } catch {
                // Blocked storage: it is ignored all the same.
            }
            return null;
        }
        const session: ShopperSession = {
            token,
            expiresAt,
            phoneMasked: typeof parsed?.phoneMasked === 'string' ? parsed.phoneMasked.slice(0, 32) : null,
        };
        // A record with more than these fields (an older shape) is written back without them.
        if (Object.keys(parsed as object).some((k) => k !== 'token' && k !== 'expiresAt' && k !== 'phoneMasked')) {
            try {
                storage.setItem(sessionKey(instituteId), JSON.stringify(session));
            } catch {
                // Blocked storage: the extra fields are ignored all the same.
            }
        }
        return session;
    } catch {
        try {
            storage.removeItem(sessionKey(instituteId));
        } catch {
            // As above.
        }
        return null;
    }
};

/**
 * Keeps the session an OTP verification issued. Returns it, or null when the answer carried no
 * session (purpose TRACK_ORDER, or the shop cannot issue one) or storage refused it.
 */
export const saveSession = (
    instituteId: string,
    verified: Pick<OtpVerified, 'shopper_session_token' | 'shopper_session_expires_at' | 'shopper_session_expires_in' | 'phone_masked'>,
    storage: KeyValueStorage | null = browserLocalStorage(),
    now: number = Date.now()
): ShopperSession | null => {
    const token = verified.shopper_session_token || '';
    if (!instituteId || !TOKEN_SHAPE.test(token) || token.length > MAX_TOKEN) return null;
    const fromSeconds = Number(verified.shopper_session_expires_in);
    const fromDate = verified.shopper_session_expires_at ? Date.parse(verified.shopper_session_expires_at) : NaN;
    const expiresAt = Number.isFinite(fromSeconds) && fromSeconds > 0 ? now + fromSeconds * 1000 : fromDate;
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
    const session: ShopperSession = {
        token,
        expiresAt,
        phoneMasked: verified.phone_masked || null,
    };
    if (!storage) return null;
    try {
        storage.setItem(sessionKey(instituteId), JSON.stringify(session));
    } catch {
        return null;
    }
    notify();
    return session;
};

/**
 * True when the session's phone is this ten-digit number (pre-filled checkout, PREPAID only).
 * `sessionPhone` is what /me answered for the session, held in memory: the masked digits alone
 * are never enough to call a typed number proved.
 */
export const sessionMatchesPhone = (session: ShopperSession | null, sessionPhone: string | null, phone: string): boolean => {
    if (!session || !sessionPhone || !/^\d{10}$/.test(phone)) return false;
    return sessionPhone === phone;
};
