import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import {
    EVALUATION_API_KEYS_URL,
    MAX_API_KEY_NAME_LENGTH,
    normalizeApiKeyList,
    normalizeIssuedKey,
    type EvaluationApiKey,
    type IssuedEvaluationApiKey,
} from './evaluation-api-keys';

/**
 * Login links: signed learner-portal links (`?lc=<code>`) instead of username-only ones.
 *
 * Keys (vak_login_…) live in the same admin_core table as Evaluation API keys, under
 * product `login_links`, and are self-serve (no platform switch needed):
 *   POST   /admin-core-service/v1/api-keys {product: 'login_links', name, expires_at}
 *   GET    /admin-core-service/v1/api-keys?instituteId=&product=login_links
 *   DELETE /admin-core-service/v1/api-keys/{id}?instituteId=
 *
 * The institute's own server sends the key to auth_service to mint a code per learner:
 *   POST /auth-service/open/v1/login-codes  (X-API-Key)  {username, expires_in_days}
 *
 * The switch, auth_service, ACTIVE ADMIN of the institute:
 *   GET/PUT /auth-service/v1/institutes/{id}/login-link-policy  {require_login_code, code_free_routes}
 */
export const LOGIN_LINK_KEYS_QUERY_KEY = 'LOGIN_LINK_KEYS';
export const LOGIN_LINK_POLICY_QUERY_KEY = 'LOGIN_LINK_POLICY';
export const LOGIN_LINKS_PRODUCT = 'login_links';

export const LOGIN_CODES_URL = `${BASE_URL}/auth-service/open/v1/login-codes`;

export const loginLinkPolicyUrl = (instituteId: string) =>
    `${BASE_URL}/auth-service/v1/institutes/${encodeURIComponent(instituteId)}/login-link-policy`;

export type LoginLinkKey = EvaluationApiKey;
export type IssuedLoginLinkKey = IssuedEvaluationApiKey;

export interface LoginLinkPolicy {
    requireLoginCode: boolean;
    /** Landing routes that still sign in from the username alone while codes are required. */
    codeFreeRoutes: string[];
    /** Every route the switch can exempt (GO, LIVE_CLASS, SUBSCRIPTIONS, ...). */
    availableRoutes: string[];
    updatedAt: string | null;
    maxExpiresInDays: number;
}

export interface IssueLoginLinkKeyInput {
    name: string;
    /** yyyy-mm-dd from a date input; empty = never expires. */
    expiryDate: string;
}

/** Form → POST body. Throws the same error codes as the evaluation form. */
export function buildIssueLoginLinkKeyPayload(
    instituteId: string,
    input: IssueLoginLinkKeyInput,
    now: Date = new Date()
): { institute_id: string; product: string; name: string; expires_at: string | null } {
    const name = input.name.trim();
    if (!name) throw new Error('name_required');
    if (name.length > MAX_API_KEY_NAME_LENGTH) throw new Error('name_too_long');
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
    return { institute_id: instituteId, product: LOGIN_LINKS_PRODUCT, name, expires_at: expiresAt };
}

export const fetchLoginLinkKeys = async (instituteId: string): Promise<LoginLinkKey[]> => {
    const response = await authenticatedAxiosInstance.get(EVALUATION_API_KEYS_URL, {
        params: { instituteId, product: LOGIN_LINKS_PRODUCT },
    });
    return normalizeApiKeyList(response.data).keys;
};

export const issueLoginLinkKey = async (
    instituteId: string,
    input: IssueLoginLinkKeyInput
): Promise<IssuedLoginLinkKey> => {
    const response = await authenticatedAxiosInstance.post(
        EVALUATION_API_KEYS_URL,
        buildIssueLoginLinkKeyPayload(instituteId, input),
        { params: { instituteId } }
    );
    const issued = normalizeIssuedKey(response.data);
    if (!issued) throw new Error('issue_response_invalid');
    return issued;
};

const toPolicy = (data: unknown): LoginLinkPolicy => {
    const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
        requireLoginCode: row.require_login_code === true,
        codeFreeRoutes: Array.isArray(row.code_free_routes)
            ? row.code_free_routes.filter((v): v is string => typeof v === 'string')
            : [],
        availableRoutes: Array.isArray(row.available_routes)
            ? row.available_routes.filter((v): v is string => typeof v === 'string')
            : [],
        updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
        maxExpiresInDays:
            typeof row.max_expires_in_days === 'number' ? row.max_expires_in_days : 30,
    };
};

export const fetchLoginLinkPolicy = async (instituteId: string): Promise<LoginLinkPolicy> => {
    const response = await authenticatedAxiosInstance.get(loginLinkPolicyUrl(instituteId));
    return toPolicy(response.data);
};

export const saveLoginLinkPolicy = async (
    instituteId: string,
    requireLoginCode: boolean
): Promise<LoginLinkPolicy> => {
    const response = await authenticatedAxiosInstance.put(loginLinkPolicyUrl(instituteId), {
        require_login_code: requireLoginCode,
    });
    return toPolicy(response.data);
};

/** Replaces the routes that keep working without a code. Leaves the switch as it is. */
export const saveLoginLinkCodeFreeRoutes = async (
    instituteId: string,
    codeFreeRoutes: string[]
): Promise<LoginLinkPolicy> => {
    const response = await authenticatedAxiosInstance.put(loginLinkPolicyUrl(instituteId), {
        code_free_routes: codeFreeRoutes,
    });
    return toPolicy(response.data);
};

/** The request an institute's server makes, shown in the card and the shown-once dialog. */
export const loginCodeCurlExample = (apiKey: string) =>
    [
        `curl -X POST ${LOGIN_CODES_URL} \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -H "X-API-Key: ${apiKey}" \\`,
        `  -d '{"username": "<learner username>", "expires_in_days": 7}'`,
    ].join('\n');
