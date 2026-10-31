import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';

/**
 * Evaluation API keys (vak_eval_…) — issued by an institute ADMIN from
 * Settings → Integrations, used by a partner (ERP / OSM vendor) against the
 * public AI Evaluation API (api.evalezy.com). Spec: docs/AI_EVALUATION_PUBLIC_API.md §6.3.
 *
 * admin_core, JWT + requireInstituteAdmin (no root bypass):
 *   POST   /admin-core-service/v1/api-keys                 → {id, name, key, key_prefix, scopes, expires_at}
 *   GET    /admin-core-service/v1/api-keys?instituteId=    → list (never the key)
 *   DELETE /admin-core-service/v1/api-keys/{id}?instituteId= → revoke
 *
 * The plaintext key exists only in the POST response: it is never cached in
 * react-query, never logged, and dropped from component state when the
 * "shown once" dialog closes.
 */
export const EVALUATION_API_KEYS_URL = `${BASE_URL}/admin-core-service/v1/api-keys`;

export const EVALUATION_API_KEYS_QUERY_KEY = 'EVALUATION_API_KEYS';

/** v1 scopes an institute admin can grant (§6.2). Phase-2 scopes are not offered yet. */
export const EVALUATION_API_SCOPES = [
    'evaluation:read',
    'evaluation:write',
    'evaluation:review',
    'evaluation:finalize',
] as const;

export type EvaluationApiScope = (typeof EVALUATION_API_SCOPES)[number];

/** Default for a new key (§6.2): read + write. The admin ticks the others explicitly. */
export const DEFAULT_EVALUATION_API_SCOPES: EvaluationApiScope[] = [
    'evaluation:read',
    'evaluation:write',
];

export const MAX_API_KEY_NAME_LENGTH = 120;

export interface EvaluationApiKey {
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    status: string;
    /** Display name when the server resolves it (created_by_name). */
    createdByName: string | null;
    /** Raw creator user id (created_by); shown only as "You" or a short id. */
    createdById: string | null;
    createdAt: string | null;
    lastUsedAt: string | null;
    expiresAt: string | null;
    dailyCopyCap: number | null;
}

export interface EvaluationApiKeyList {
    /**
     * false only when the server positively says the Evaluation API is not
     * enabled for this institute (super-admin switches it on, §6.3). A plain
     * array response carries no flag and is treated as enabled.
     */
    enabled: boolean;
    keys: EvaluationApiKey[];
}

export interface IssuedEvaluationApiKey {
    id: string;
    name: string;
    key: string;
    prefix: string;
    scopes: string[];
    expiresAt: string | null;
}

export interface IssueEvaluationApiKeyInput {
    name: string;
    scopes: string[];
    /** yyyy-mm-dd from a date input; empty = never expires. */
    expiryDate: string;
    /** Digits from a number input; empty = institute quota only. */
    dailyCopyCap: string;
}

type RawRecord = Record<string, unknown>;

const asRecord = (value: unknown): RawRecord | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as RawRecord) : null;

const firstString = (row: RawRecord, ...keys: string[]): string | null => {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === 'string' && value.trim() !== '') return value;
        if (typeof value === 'number') return String(value);
    }
    return null;
};

const firstNumber = (row: RawRecord, ...keys: string[]): number | null => {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
            return Number(value);
        }
    }
    return null;
};

const toScopes = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string') : [];

/** One list row → view model. snake_case per spec, camelCase tolerated. */
export function normalizeApiKey(raw: unknown): EvaluationApiKey | null {
    const row = asRecord(raw);
    if (!row) return null;
    const id = firstString(row, 'id', 'key_id', 'keyId');
    if (!id) return null;
    return {
        id,
        name: firstString(row, 'name', 'key_name', 'keyName') ?? '',
        prefix: firstString(row, 'key_prefix', 'prefix', 'keyPrefix') ?? '',
        scopes: toScopes(row.scopes),
        status: (firstString(row, 'status') ?? 'ACTIVE').toUpperCase(),
        createdByName: firstString(row, 'created_by_name', 'createdByName'),
        createdById: firstString(row, 'created_by', 'createdBy'),
        createdAt: firstString(row, 'created_at', 'createdAt'),
        lastUsedAt: firstString(row, 'last_used_at', 'lastUsedAt'),
        expiresAt: firstString(row, 'expires_at', 'expiresAt'),
        dailyCopyCap: firstNumber(row, 'daily_copy_cap', 'dailyCopyCap'),
    };
}

export type ApiKeyDisplayStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

/**
 * What the admin should see for a key. admin_core keeps status=ACTIVE after
 * expires_at passes (verify refuses it by the date), so an ACTIVE key whose
 * expiry is in the past reads "Expired": no Revoke, not counted as active.
 */
export function apiKeyDisplayStatus(
    key: Pick<EvaluationApiKey, 'status' | 'expiresAt'>,
    now: Date = new Date()
): ApiKeyDisplayStatus {
    if (key.status !== 'ACTIVE') return key.status === 'EXPIRED' ? 'EXPIRED' : 'REVOKED';
    if (key.expiresAt) {
        const at = Date.parse(key.expiresAt);
        if (Number.isFinite(at) && at <= now.getTime()) return 'EXPIRED';
    }
    return 'ACTIVE';
}

/**
 * "Created by" text. A resolved name wins; otherwise the current admin's own
 * id reads as `youLabel`, and any other id is shortened (a full UUID is noise).
 */
export function apiKeyCreatorLabel(
    key: Pick<EvaluationApiKey, 'createdByName' | 'createdById'>,
    currentUserId: string | null | undefined,
    youLabel: string
): string | null {
    if (key.createdByName) return key.createdByName;
    if (!key.createdById) return null;
    if (currentUserId && key.createdById === currentUserId) return youLabel;
    return key.createdById.length > 12 ? `${key.createdById.slice(0, 8)}…` : key.createdById;
}

/**
 * GET response → {enabled, keys}. Accepts a bare array (§6.3 "list") or an
 * object `{enabled | access_enabled, keys}` so the card can show the disabled
 * state without a separate call.
 */
export function normalizeApiKeyList(data: unknown): EvaluationApiKeyList {
    const toKeys = (rows: unknown): EvaluationApiKey[] =>
        Array.isArray(rows)
            ? rows.map(normalizeApiKey).filter((k): k is EvaluationApiKey => k !== null)
            : [];
    if (Array.isArray(data)) return { enabled: true, keys: toKeys(data) };
    const obj = asRecord(data);
    if (!obj) return { enabled: true, keys: [] };
    const flag = obj.access_enabled ?? obj.enabled ?? obj.accessEnabled;
    return {
        enabled: flag === false ? false : true,
        keys: toKeys(obj.keys ?? obj.content ?? obj.items),
    };
}

export function normalizeIssuedKey(data: unknown): IssuedEvaluationApiKey | null {
    const row = asRecord(data);
    if (!row) return null;
    const key = firstString(row, 'key', 'api_key', 'apiKey');
    const id = firstString(row, 'id', 'key_id', 'keyId');
    if (!key || !id) return null;
    return {
        id,
        key,
        name: firstString(row, 'name', 'key_name', 'keyName') ?? '',
        prefix: firstString(row, 'key_prefix', 'prefix', 'keyPrefix') ?? key.slice(0, 16),
        scopes: toScopes(row.scopes),
        expiresAt: firstString(row, 'expires_at', 'expiresAt'),
    };
}

const NOT_ENABLED_CODES = new Set([
    'product_not_enabled',
    'api_not_enabled',
    'evaluation_api_not_enabled',
    'api_access_disabled',
]);

const errorBody = (err: unknown): { status: number | null; body: RawRecord | null } => {
    const response = asRecord(asRecord(err)?.response);
    const status = typeof response?.status === 'number' ? response.status : null;
    return { status, body: asRecord(response?.data) };
};

/** Machine code + human message from the shared ErrorInfo {ex, responseCode} or the API envelope {error:{code,message}}. */
function errorCodeAndMessage(body: RawRecord | null): { code: string; message: string } {
    if (!body) return { code: '', message: '' };
    const nested = asRecord(body.error);
    const code =
        (nested ? firstString(nested, 'code') : null) ??
        firstString(body, 'code', 'error_code', 'responseCode') ??
        (typeof body.error === 'string' ? body.error : '');
    const message =
        (nested ? firstString(nested, 'message') : null) ??
        firstString(body, 'message', 'ex', 'detail') ??
        '';
    return { code, message };
}

/**
 * True when admin_core refuses because the Evaluation API is not switched on
 * for the institute. Decided by the machine code or the wording, not the
 * status: a plain 403 for a non-admin caller is NOT this (the card shows the
 * generic error), and a VacademyException without a status arrives as 510.
 */
export function isProductNotEnabledError(err: unknown): boolean {
    const { status, body } = errorBody(err);
    if (status === null || status < 400) return false;
    const { code, message } = errorCodeAndMessage(body);
    if (NOT_ENABLED_CODES.has(code.toLowerCase())) return true;
    return /not enabled/i.test(message);
}

/** Server message for a toast, or null so the caller uses its own fallback copy. */
export function apiKeyErrorMessage(err: unknown): string | null {
    const { message } = errorCodeAndMessage(errorBody(err).body);
    return message || null;
}

/**
 * Form → POST body. Expiry is the END of the picked local day, sent as an ISO
 * instant; the cap must be a positive whole number. Throws on input the form
 * should already have rejected, so a bad value never reaches the server.
 */
export function buildIssueKeyPayload(
    instituteId: string,
    input: IssueEvaluationApiKeyInput,
    now: Date = new Date()
): {
    institute_id: string;
    name: string;
    scopes: string[];
    expires_at: string | null;
    daily_copy_cap: number | null;
} {
    const name = input.name.trim();
    if (!name) throw new Error('name_required');
    if (name.length > MAX_API_KEY_NAME_LENGTH) throw new Error('name_too_long');
    const allowed = new Set<string>(EVALUATION_API_SCOPES);
    const scopes = EVALUATION_API_SCOPES.filter((s) => input.scopes.includes(s));
    if (scopes.length === 0 || input.scopes.some((s) => !allowed.has(s))) {
        throw new Error('scopes_invalid');
    }

    let expiresAt: string | null = null;
    if (input.expiryDate.trim()) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.expiryDate.trim());
        if (!m) throw new Error('expiry_invalid');
        const endOfDay = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
        if (Number.isNaN(endOfDay.getTime()) || endOfDay.getTime() <= now.getTime()) {
            throw new Error('expiry_in_past');
        }
        expiresAt = endOfDay.toISOString();
    }

    let dailyCopyCap: number | null = null;
    if (input.dailyCopyCap.trim()) {
        const cap = Number(input.dailyCopyCap.trim());
        if (!Number.isInteger(cap) || cap <= 0) throw new Error('cap_invalid');
        dailyCopyCap = cap;
    }

    return {
        institute_id: instituteId,
        name,
        scopes,
        expires_at: expiresAt,
        daily_copy_cap: dailyCopyCap,
    };
}

export const fetchEvaluationApiKeys = async (
    instituteId: string
): Promise<EvaluationApiKeyList> => {
    // product: the same table also holds login-links keys (Settings → Security).
    const response = await authenticatedAxiosInstance.get(EVALUATION_API_KEYS_URL, {
        params: { instituteId, product: 'evaluation' },
    });
    return normalizeApiKeyList(response.data);
};

export const issueEvaluationApiKey = async (
    instituteId: string,
    input: IssueEvaluationApiKeyInput
): Promise<IssuedEvaluationApiKey> => {
    const response = await authenticatedAxiosInstance.post(
        EVALUATION_API_KEYS_URL,
        buildIssueKeyPayload(instituteId, input),
        { params: { instituteId } }
    );
    const issued = normalizeIssuedKey(response.data);
    if (!issued) throw new Error('issue_response_invalid');
    return issued;
};

export const revokeEvaluationApiKey = async (instituteId: string, keyId: string) => {
    const response = await authenticatedAxiosInstance.delete(
        `${EVALUATION_API_KEYS_URL}/${encodeURIComponent(keyId)}`,
        { params: { instituteId } }
    );
    return response.data;
};
