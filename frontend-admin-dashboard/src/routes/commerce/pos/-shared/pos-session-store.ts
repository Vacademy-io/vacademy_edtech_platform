import { useCallback, useMemo, useRef, useState } from 'react';
import { newRequestId } from '@/routes/commerce/orders/-shared/request-id';
import type { CartExchange } from './pos-cart';
import type { PosError } from './pos-errors';

/**
 * What the counter keeps for one open session in this tab's `sessionStorage`
 * (so a reload keeps it, closing the tab or logging out drops it):
 *
 * - the last write attempt of each kind (sale, paper bill, a return of one
 *   order, cash in/out) whose answer never came back. Its
 *   `client_request_id` is reused by every later attempt until the server
 *   gives a definite answer, so a retry after a timeout or a gateway error can
 *   never make a second bill (the server replays the first, or answers
 *   IDEMPOTENCY_MISMATCH when it was saved with another body);
 * - the exchange credit of a return taken at this counter, until a bill uses
 *   it or the cashier removes it.
 *
 * Every storage access is in try/catch; the in-memory copy works without it.
 */

const PREFIX = 'commerce.pos';

export const attemptKey = (instituteId: string, sessionId: string, scope: string) =>
    `${PREFIX}.attempt.${instituteId}.${sessionId}.${scope}`;

export const exchangeKey = (instituteId: string, sessionId: string) =>
    `${PREFIX}.exchange.${instituteId}.${sessionId}`;

function store(): Storage | null {
    try {
        return globalThis.sessionStorage ?? null;
    } catch {
        return null;
    }
}

function readJson(key: string): unknown {
    try {
        const raw = store()?.getItem(key);
        return raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
        return null;
    }
}

function writeJson(key: string, value: unknown): void {
    try {
        store()?.setItem(key, JSON.stringify(value));
    } catch {
        // Full or blocked storage: the in-memory copy still holds it for this page.
    }
}

function remove(key: string): void {
    try {
        store()?.removeItem(key);
    } catch {
        // Nothing to do.
    }
}

// ───────────────────────── Write attempts ─────────────────────────

export interface Attempt {
    id: string;
    /** JSON of the body last sent with this id (without `client_request_id` and `approval`). */
    body: string;
    /** Sent and no definite answer yet: the server may have saved it. */
    uncertain: boolean;
}

/** How an answer settles an attempt. */
export type AttemptOutcome =
    /** 2xx: done, the next write gets a new id. */
    | 'saved'
    /** A definite refusal (4xx): nothing was saved; the same body may go again with the same id (PIN resend). */
    | 'refused'
    /** No answer, a timeout, 408, 429, 5xx or a request still in progress: keep the id. */
    | 'unknown'
    /** IDEMPOTENCY_MISMATCH: the id was saved with another body. */
    | 'mismatch';

export function outcomeOf(error: Pick<PosError, 'uncertain' | 'code'> | null): AttemptOutcome {
    if (!error) return 'saved';
    if (error.uncertain) return 'unknown';
    if (error.code === 'IDEMPOTENCY_MISMATCH') return 'mismatch';
    return 'refused';
}

const isAttempt = (value: unknown): value is Attempt =>
    !!value &&
    typeof (value as Attempt).id === 'string' &&
    typeof (value as Attempt).body === 'string' &&
    typeof (value as Attempt).uncertain === 'boolean';

export function readAttempt(instituteId: string, sessionId: string, scope: string): Attempt | null {
    const value = readJson(attemptKey(instituteId, sessionId, scope));
    return isAttempt(value) ? value : null;
}

/**
 * The id for the next send of `body`, pure: the previous attempt's id while
 * its answer is unknown (whatever the body is now), or while the body is the
 * same; otherwise a new one. `carried` says the id comes from an attempt whose
 * answer never came.
 */
export function nextAttempt(
    previous: Attempt | null,
    body: unknown,
    makeId: () => string
): { attempt: Attempt; carried: boolean } {
    const key = JSON.stringify(body ?? null);
    if (previous && (previous.uncertain || previous.body === key)) {
        return { attempt: { id: previous.id, body: key, uncertain: true }, carried: previous.uncertain };
    }
    return { attempt: { id: makeId(), body: key, uncertain: true }, carried: false };
}

export interface AttemptStore {
    /** Marks the send as on its way (kept across a reload) and gives its id. */
    begin: (scope: string, body: unknown) => { id: string; carried: boolean };
    /**
     * Records the answer. Returns true when the write was probably saved under
     * another body (a mismatch after an unknown answer): the screen says so and
     * keeps the id.
     */
    settle: (scope: string, error: Pick<PosError, 'uncertain' | 'code'> | null, carried: boolean) => boolean;
    /** Forgets the scope (the bill was cleared or the cashier checked the bills). */
    clear: (scope: string) => void;
    /** An earlier send of this scope has no answer yet. */
    isUncertain: (scope: string) => boolean;
    /** Changes whenever an attempt's state changes (for screens that show it). */
    version: number;
}

/**
 * The write attempts of one counter session. Without a session id (a dialog
 * outside the till) the attempts live in memory only.
 */
export function useAttemptStore(instituteId: string, sessionId: string | null, idPrefix = 'pos'): AttemptStore {
    const memory = useRef(new Map<string, Attempt>());
    const [version, setVersion] = useState(0);

    const read = useCallback(
        (scope: string): Attempt | null => {
            const held = memory.current.get(scope);
            if (held) return held;
            const stored = sessionId ? readAttempt(instituteId, sessionId, scope) : null;
            if (stored) memory.current.set(scope, stored);
            return stored;
        },
        [instituteId, sessionId]
    );

    const save = useCallback(
        (scope: string, attempt: Attempt | null) => {
            if (attempt) memory.current.set(scope, attempt);
            else memory.current.delete(scope);
            if (sessionId) {
                const key = attemptKey(instituteId, sessionId, scope);
                if (attempt?.uncertain) writeJson(key, attempt);
                else remove(key);
            }
            setVersion((v) => v + 1);
        },
        [instituteId, sessionId]
    );

    const begin = useCallback(
        (scope: string, body: unknown) => {
            const { attempt, carried } = nextAttempt(read(scope), body, () => newRequestId(idPrefix));
            save(scope, attempt);
            return { id: attempt.id, carried };
        },
        [read, save, idPrefix]
    );

    const settle = useCallback(
        (scope: string, error: Pick<PosError, 'uncertain' | 'code'> | null, carried: boolean): boolean => {
            const current = read(scope);
            const outcome = outcomeOf(error);
            if (outcome === 'saved') {
                save(scope, null);
                return false;
            }
            if (outcome === 'unknown') {
                if (current) save(scope, { ...current, uncertain: true });
                return false;
            }
            if (outcome === 'mismatch') {
                if (carried && current) {
                    save(scope, { ...current, uncertain: true });
                    return true;
                }
                save(scope, null);
                return false;
            }
            // Refused: nothing was saved; the same body keeps its id (a PIN resend), another gets a new one.
            if (current) save(scope, { ...current, uncertain: false });
            return false;
        },
        [read, save]
    );

    const clear = useCallback((scope: string) => save(scope, null), [save]);

    const isUncertain = useCallback((scope: string) => !!read(scope)?.uncertain, [read]);

    return useMemo(
        () => ({ begin, settle, clear, isUncertain, version }),
        [begin, settle, clear, isUncertain, version]
    );
}

// ───────────────────────── Exchange credit ─────────────────────────

const isExchange = (value: unknown): value is CartExchange =>
    !!value &&
    typeof (value as CartExchange).returnId === 'string' &&
    (value as CartExchange).returnId !== '' &&
    typeof (value as CartExchange).credit === 'number';

export function readExchange(instituteId: string, sessionId: string): CartExchange | null {
    const value = readJson(exchangeKey(instituteId, sessionId));
    if (!isExchange(value)) return null;
    return {
        returnId: value.returnId,
        number: typeof value.number === 'string' ? value.number : null,
        credit: Number.isFinite(value.credit) ? value.credit : 0,
    };
}

export function writeExchange(instituteId: string, sessionId: string, exchange: CartExchange | null): void {
    const key = exchangeKey(instituteId, sessionId);
    if (exchange) writeJson(key, exchange);
    else remove(key);
}
