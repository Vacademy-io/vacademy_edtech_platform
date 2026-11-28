import { isAxiosError } from 'axios';

/** The server's own message for a failed call, else the fallback. */
export const apiErrorMessage = (e: unknown, fallback: string): string => {
    if (isAxiosError(e)) {
        const data = e.response?.data as { message?: unknown; ex?: unknown } | string | undefined;
        if (typeof data === 'string' && data.trim()) return data;
        if (data && typeof data === 'object') {
            if (typeof data.message === 'string' && data.message.trim()) return data.message;
            if (typeof data.ex === 'string' && data.ex.trim()) return data.ex;
        }
    }
    return fallback;
};

/** HTTP status of a failed call, if any. */
export const apiErrorStatus = (e: unknown): number | null =>
    isAxiosError(e) ? e.response?.status ?? null : null;

/**
 * The server refused an accept because what the clerk was shown has changed
 * since (409 with a message starting PLAN_CHANGED). Any other 409 is a session
 * that moved on in some other way (e.g. no longer OPEN).
 */
export const isPlanChanged = (e: unknown): boolean =>
    apiErrorStatus(e) === 409 && apiErrorMessage(e, '').trim().startsWith('PLAN_CHANGED');

/**
 * A scan-station route answered 404. Every route but GET /config is a 404
 * while the feature is off for the institute, so this is how the page learns
 * it was switched off mid-session (or that a session is gone).
 */
export const isScanNotFound = (e: unknown): boolean => apiErrorStatus(e) === 404;

/** Query retry: a 404 will not change on a retry, anything else gets the default 3. */
export const retryUnlessNotFound = (failureCount: number, e: unknown): boolean =>
    !isScanNotFound(e) && failureCount < 3;
