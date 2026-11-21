/** Errors from the Learner home admin API, with the server's codes and check issues. */
import { AxiosError } from 'axios';
import type { CheckIssue } from '../-types/learner-home-types';

// ─── Errors ──────────────────────────────────────────────────────────────────

/** Codes the server answers with (spec 5.1, 5.2). */
export type LearnerHomeErrorCode =
    | 'DRAFT_EXISTS'
    | 'STALE_DRAFT'
    | 'HOLISTIC_LAYOUT'
    | 'MODULE_OFF'
    | 'NO_DRAFT'
    | 'NO_PUBLISHED'
    | 'VERSION_NOT_FOUND'
    | 'PAYLOAD_TOO_LARGE'
    | 'VALIDATION'
    | 'NOT_FOUND'
    | 'FORBIDDEN'
    | 'UNKNOWN';

export class LearnerHomeApiError extends Error {
    readonly status: number;
    readonly code: LearnerHomeErrorCode;
    /** 422: the check errors, each tied to a block and field when the server says so. */
    readonly issues: CheckIssue[];
    readonly warnings: CheckIssue[];
    /** 409 STALE_DRAFT: who saved the newer draft, and when. */
    readonly updatedBy: string | null;
    readonly updatedAt: string | null;

    constructor(args: {
        status: number;
        code: LearnerHomeErrorCode;
        message: string;
        issues?: CheckIssue[];
        warnings?: CheckIssue[];
        updatedBy?: string | null;
        updatedAt?: string | null;
    }) {
        super(args.message);
        this.name = 'LearnerHomeApiError';
        this.status = args.status;
        this.code = args.code;
        this.issues = args.issues ?? [];
        this.warnings = args.warnings ?? [];
        this.updatedBy = args.updatedBy ?? null;
        this.updatedAt = args.updatedAt ?? null;
    }
}

const KNOWN_CODES: readonly LearnerHomeErrorCode[] = [
    'DRAFT_EXISTS',
    'STALE_DRAFT',
    'HOLISTIC_LAYOUT',
    'MODULE_OFF',
    'NO_DRAFT',
    'NO_PUBLISHED',
    'VERSION_NOT_FOUND',
    'PAYLOAD_TOO_LARGE',
];

/** 422 codes of the contract that carry field issues (VALIDATION_FAILED, PUBLISH_CHECKS_FAILED). */
const VALIDATION_CODES = ['VALIDATION_FAILED', 'PUBLISH_CHECKS_FAILED'];

const asString = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function readIssues(raw: unknown, severity: 'error' | 'warning'): CheckIssue[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map((r) => ({
            block_key: asString(r.block_key),
            path: asString(r.path),
            code: asString(r.code) ?? 'INVALID',
            severity: r.severity === 'warning' || r.severity === 'error' ? r.severity : severity,
            message: asString(r.message),
            params:
                r.params && typeof r.params === 'object'
                    ? (r.params as Record<string, string | number>)
                    : undefined,
        }));
}

/**
 * Turns any failed call into a LearnerHomeApiError. The code is read from a
 * `code` field, or from a message that starts with one ("STALE_DRAFT: …"),
 * which is how admin_core's shared error body carries codes today.
 */
export function toLearnerHomeError(error: unknown): LearnerHomeApiError {
    if (error instanceof LearnerHomeApiError) return error;
    const status = error instanceof AxiosError ? error.response?.status ?? 0 : 0;
    const body =
        error instanceof AxiosError &&
        error.response?.data &&
        typeof error.response.data === 'object'
            ? (error.response.data as Record<string, unknown>)
            : {};
    const text = asString(body.message) ?? asString(body.ex) ?? '';
    const prefixed = /^([A-Z_]+):\s*(.*)$/s.exec(text);
    const rawCode = asString(body.code) ?? asString(body.error_code) ?? prefixed?.[1] ?? null;
    let code: LearnerHomeErrorCode = 'UNKNOWN';
    if (rawCode && (KNOWN_CODES as readonly string[]).includes(rawCode)) {
        code = rawCode as LearnerHomeErrorCode;
    } else if (status === 422 || (rawCode && VALIDATION_CODES.includes(rawCode))) {
        code = 'VALIDATION';
    } else if (status === 403) {
        code = 'FORBIDDEN';
    } else if (status === 404) {
        code = 'NOT_FOUND';
    }
    const message =
        (prefixed ? prefixed[2] : text) ||
        (error instanceof Error ? error.message : '') ||
        'Request failed';
    return new LearnerHomeApiError({
        status,
        code,
        message,
        issues: readIssues(body.errors ?? body.issues, 'error'),
        warnings: readIssues(body.warnings, 'warning'),
        updatedBy: asString(body.updated_by) ?? asString(body.updated_by_name),
        updatedAt: asString(body.updated_at),
    });
}
