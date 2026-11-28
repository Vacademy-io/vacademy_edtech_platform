/**
 * The panel's client for /auth-service/public/v1/panel/**. Bare axios, so these
 * calls never carry an Authorization header: on a public path an expired Bearer
 * would fail in the JWT filter before Spring Security decides, and session-limit
 * handling must not run for a panel. Credentials travel in POST bodies.
 *
 * Every failure becomes a PanelPublicError, sorted the same way everywhere:
 *   offline   network failure, 5xx, BUSY and any 429. Never ends a session.
 *   revoked   401 with exactly code DEVICE_REVOKED. The store is told here, once.
 *   api       any other answer with a body, read by the caller through `code`.
 */
import axios from 'axios';
import { BASE_URL } from '@/constants/urls';
import {
    PANEL_PUBLIC_BASE,
    isPanelApiError,
    type PanelApiError,
    type PanelErrorCode,
} from '@/classroom-shared/apiTypes';
import { markDeviceRevoked } from './store';

export type PanelFailureKind = 'offline' | 'revoked' | 'api';

export class PanelPublicError extends Error {
    kind: PanelFailureKind;
    status: number | null;
    code: PanelErrorCode | null;
    body: PanelApiError | null;
    retryAfterMs: number;
    constructor(
        kind: PanelFailureKind,
        status: number | null,
        body: PanelApiError | null,
        message?: string
    ) {
        super(message || body?.code || kind);
        this.name = 'PanelPublicError';
        this.kind = kind;
        this.status = status;
        this.body = body;
        this.code = body?.code ?? null;
        this.retryAfterMs = typeof body?.retry_after_ms === 'number' ? body.retry_after_ms : 0;
    }
}

export function isPublicError(error: unknown): error is PanelPublicError {
    return error instanceof PanelPublicError;
}

export function isOfflineFailure(error: unknown): boolean {
    return isPublicError(error) && error.kind === 'offline';
}

export function hasCode(error: unknown, code: PanelErrorCode): boolean {
    return isPublicError(error) && error.code === code;
}

function classify(status: number | undefined, data: unknown): PanelPublicError {
    if (status === undefined) return new PanelPublicError('offline', null, null, 'network');
    const body = isPanelApiError(data) ? data : null;
    if (status === 401 && body?.code === 'DEVICE_REVOKED') {
        return new PanelPublicError('revoked', status, body);
    }
    if (body?.code === 'PANEL_DISABLED') return new PanelPublicError('api', status, body);
    if (status >= 500 || status === 429 || body?.code === 'BUSY') {
        return new PanelPublicError('offline', status, body);
    }
    return new PanelPublicError('api', status, body);
}

// ----------------------------------------------------------- reachability ---

let reachable = true;
const reachabilityListeners = new Set<() => void>();

/** False from the first failed call until the next one that gets a real answer. */
export function isBackendReachable(): boolean {
    return reachable;
}

export function subscribeReachability(listener: () => void): () => void {
    reachabilityListeners.add(listener);
    return () => {
        reachabilityListeners.delete(listener);
    };
}

function setReachable(value: boolean): void {
    if (reachable === value) return;
    reachable = value;
    reachabilityListeners.forEach((listener) => listener());
}

// ------------------------------------------------------------------- call ---

export const PUBLIC_TIMEOUT_MS = 10000;

export async function postPublic<T>(
    path: string,
    body: object,
    options: { timeout?: number } = {}
): Promise<T> {
    try {
        const response = await axios.post<T>(`${BASE_URL}${PANEL_PUBLIC_BASE}${path}`, body, {
            timeout: options.timeout ?? PUBLIC_TIMEOUT_MS,
            headers: { 'Content-Type': 'application/json' },
        });
        setReachable(true);
        return response.data;
    } catch (error) {
        const failure = classify(
            axios.isAxiosError(error) ? error.response?.status : undefined,
            axios.isAxiosError(error) ? error.response?.data : undefined
        );
        setReachable(failure.kind !== 'offline');
        if (failure.kind === 'revoked') {
            const creds = body as { device_id?: unknown; device_secret?: unknown };
            markDeviceRevoked(creds.device_id, creds.device_secret);
        }
        throw failure;
    }
}
