/**
 * Small fetch wrapper. No axios: the whole page has a size budget.
 *
 * Auth rules:
 *   /auth-service/v1/panel/**   Bearer, no clientId
 *   /admin-core-service/**      Bearer and clientId = the institute id
 *   public paths                nothing
 */
import { BACKEND_BASE_URL } from '@/config/baseUrl';
import { isPanelApiError, PANEL_BEARER_BASE } from '@/classroom-shared/apiTypes';
import { decodeClaims, expireSignIn, getAccessToken, looksExpired } from './auth';

const DEFAULT_TIMEOUT_MS = 15000;
/** A token this new cannot be stale, so a bare refusal must not loop back to the sign-in form. */
const FRESH_TOKEN_MS = 60 * 1000;
const SIGN_IN_STATUSES = new Set([401, 403, 510, 511]);

export type PhoneErrorKind = 'network' | 'busy' | 'sign-in' | 'api';

export class PhoneApiError extends Error {
    constructor(
        public readonly kind: PhoneErrorKind,
        /** Null when nothing came back. hostActions reads this field. */
        public readonly status: number | null,
        public readonly code: string | null,
        public readonly body: unknown
    ) {
        super(code ?? kind);
        this.name = 'PhoneApiError';
    }
}

export function errorKind(error: unknown): PhoneErrorKind {
    return error instanceof PhoneApiError ? error.kind : 'network';
}

export function errorCode(error: unknown): string | null {
    return error instanceof PhoneApiError ? error.code : null;
}

const bodyCode = (body: unknown): string | null => (isPanelApiError(body) ? body.code : null);

const bodySaysExpired = (body: unknown): boolean => {
    let text: string;
    try {
        text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
    } catch {
        return false;
    }
    return /expired token|token (is |has )?expired|jwt expired/i.test(text);
};

/**
 * Decides whether a Bearer failure means "sign in again". A panel error code is an
 * answer about the action, such as NOT_STAFF, and never means the JWT is bad.
 */
/** Issued over FRESH_TOKEN_MS ago, or with no readable issue time. */
const issuedLongAgo = (token: string | null, nowMs: number): boolean => {
    const issued = decodeClaims(token)?.iat;
    return typeof issued !== 'number' || nowMs - issued * 1000 > FRESH_TOKEN_MS;
};

export function isSignInFailure(
    status: number,
    body: unknown,
    token: string | null,
    panelPath: boolean,
    nowMs = Date.now()
): boolean {
    if (bodySaysExpired(body)) return true;
    // An expired JWT is refused from the error dispatch. So is a missing route or a missing
    // parameter, so a token issued moments ago is not taken for an expired one.
    const refusal = body as { error?: unknown; path?: unknown } | null;
    if (status === 403 && refusal?.error === 'ACCESS_DENIED' && refusal.path === '/error') {
        return looksExpired(token, nowMs) || issuedLongAgo(token, nowMs);
    }
    const code = bodyCode(body);
    if (code && code !== 'UNAUTHORIZED') return false;
    // An exception raised in the auth filter can surface as a plain 500.
    if (status === 500 && !code) return looksExpired(token, nowMs);
    if (!SIGN_IN_STATUSES.has(status)) return false;
    if (code === 'UNAUTHORIZED') return true;
    if (looksExpired(token, nowMs)) return true;
    // Panel controllers always send a code, so a bare refusal came from the auth filter.
    if (panelPath) return issuedLongAgo(token, nowMs);
    return false;
}

export interface PhoneRequest {
    method?: 'GET' | 'POST';
    body?: unknown;
    query?: Record<string, string | boolean | undefined>;
    bearer?: boolean;
    clientId?: string;
    timeoutMs?: number;
}

export interface PhoneResponse<T> {
    status: number;
    data: T;
}

export async function request<T>(
    path: string,
    options: PhoneRequest = {}
): Promise<PhoneResponse<T>> {
    const { method = 'GET', body, query, bearer, clientId, timeoutMs } = options;

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = bearer ? getAccessToken() : null;
    if (bearer) {
        if (!token) {
            expireSignIn();
            throw new PhoneApiError('sign-in', null, null, null);
        }
        headers.Authorization = `Bearer ${token}`;
    }
    if (clientId) headers.clientId = clientId;

    const url = new URL(`${BACKEND_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response: Response;
    let parsed: unknown = null;
    try {
        response = await fetch(url.toString(), {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            cache: 'no-store',
            signal: abort.signal,
        });
        const text = await response.text();
        if (text) {
            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = text;
            }
        }
    } catch {
        throw new PhoneApiError('network', null, null, null);
    } finally {
        clearTimeout(timer);
    }

    if (response.ok) return { status: response.status, data: parsed as T };

    const code = bodyCode(parsed);
    if (
        bearer &&
        isSignInFailure(response.status, parsed, token, path.startsWith(PANEL_BEARER_BASE))
    ) {
        expireSignIn();
        throw new PhoneApiError('sign-in', response.status, code, parsed);
    }
    if (response.status === 429 || code === 'BUSY') {
        throw new PhoneApiError('busy', response.status, code, parsed);
    }
    throw new PhoneApiError('api', response.status, code, parsed);
}
