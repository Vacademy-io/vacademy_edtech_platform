import { isAxiosError } from 'axios';
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
 * AI calling API (Telleo API v1): a client's CRM or website starts AI calls and gets the
 * outcome back on a webhook. Spec: docs/AI_CALLING_PUBLIC_API.md.
 *
 * Keys (vak_call_…) live in the shared admin_core key table under product `ai_calling`
 * and are self-serve (no platform switch):
 *   POST   /admin-core-service/v1/api-keys {product: 'ai_calling', name, expires_at}
 *   GET    /admin-core-service/v1/api-keys?instituteId=&product=ai_calling
 *   DELETE /admin-core-service/v1/api-keys/{id}?instituteId=
 *
 * Webhook (one endpoint per institute), ACTIVE ADMIN of the institute:
 *   GET/PUT/DELETE /admin-core-service/v1/telephony/ai-call/webhook?instituteId=   {url}
 *   POST           …/webhook/rotate-secret   → {secret} shown once
 *   POST           …/webhook/test            → {delivered, status_code, error?}
 */
export const AI_CALLING_KEYS_QUERY_KEY = 'AI_CALLING_API_KEYS';
export const AI_CALLING_WEBHOOK_QUERY_KEY = 'AI_CALLING_WEBHOOK';
export const AI_CALLING_PRODUCT = 'ai_calling';

export const AI_CALLING_API_BASE = 'https://api.telleo.ai/v1';
export const AI_CALLING_DOCS_URL = 'https://docs.telleo.ai';

const WEBHOOK_URL = `${BASE_URL}/admin-core-service/v1/telephony/ai-call/webhook`;

export type AiCallingKey = EvaluationApiKey;
export type IssuedAiCallingKey = IssuedEvaluationApiKey;

export interface IssueAiCallingKeyInput {
    name: string;
    /** yyyy-mm-dd from a date input; empty = never expires. */
    expiryDate: string;
    /**
     * Also grant human_calls:read + human_calls:write (ring counsellors, list staff names).
     * Off by default: a key only rings staff phones when an admin chose that. Keys cannot
     * be edited after creation, so this is decided here.
     */
    humanCalls?: boolean;
    /**
     * Also grant counsellors:manage (add counsellors with a dashboard login, edit and
     * deactivate them). Opt-in, like humanCalls.
     */
    manageCounsellors?: boolean;
    /**
     * Also grant agents:manage (create, edit, switch and delete AI agents; set the default
     * agent and which agent answers an inbound number). Opt-in, like humanCalls.
     */
    manageAgents?: boolean;
}

/** The AI calling key's default scopes (what the server grants when none are sent). */
export const AI_CALLING_DEFAULT_SCOPES = ['calls:read', 'calls:write', 'webhooks:manage'];
export const HUMAN_CALL_SCOPES = ['human_calls:read', 'human_calls:write'];
export const MANAGE_COUNSELLORS_SCOPE = 'counsellors:manage';
export const MANAGE_AGENTS_SCOPE = 'agents:manage';

/** A key that can place human (counsellor) calls through the API. */
export const canPlaceHumanCalls = (key: { scopes?: string[] }) =>
    Boolean(key.scopes?.includes('human_calls:write'));

/** A key that can add, edit and deactivate counsellors through the API. */
export const canManageCounsellors = (key: { scopes?: string[] }) =>
    Boolean(key.scopes?.includes(MANAGE_COUNSELLORS_SCOPE));

/** A key that can create, edit, switch and delete AI agents through the API. */
export const canManageAgents = (key: { scopes?: string[] }) =>
    Boolean(key.scopes?.includes(MANAGE_AGENTS_SCOPE));

export interface AiCallingWebhook {
    url: string;
    enabled: boolean;
    events: string[];
    /** Present only right after the endpoint is created or the secret rotated. */
    secret: string | null;
    secretHint: string | null;
    updatedAt: string | null;
}

export interface WebhookTestResult {
    delivered: boolean;
    statusCode: number | null;
    error: string | null;
}

/** Form → POST body. Throws the same error codes as the evaluation form. */
export function buildIssueAiCallingKeyPayload(
    instituteId: string,
    input: IssueAiCallingKeyInput,
    now: Date = new Date()
): {
    institute_id: string;
    product: string;
    name: string;
    expires_at: string | null;
    scopes?: string[];
} {
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
    const payload = {
        institute_id: instituteId,
        product: AI_CALLING_PRODUCT,
        name,
        expires_at: expiresAt,
    };
    // No scopes = the server's default three; human-call and management scopes are only
    // ever opt-in.
    const extra = [
        ...(input.humanCalls ? HUMAN_CALL_SCOPES : []),
        ...(input.manageCounsellors ? [MANAGE_COUNSELLORS_SCOPE] : []),
        ...(input.manageAgents ? [MANAGE_AGENTS_SCOPE] : []),
    ];
    return extra.length > 0
        ? { ...payload, scopes: [...AI_CALLING_DEFAULT_SCOPES, ...extra] }
        : payload;
}

/** The webhook URL rules the server applies, checked before the request. */
export function webhookUrlError(raw: string): 'url_required' | 'url_not_https' | null {
    const url = raw.trim();
    if (!url) return 'url_required';
    try {
        if (new URL(url).protocol !== 'https:') return 'url_not_https';
    } catch {
        return 'url_not_https';
    }
    return null;
}

export const fetchAiCallingKeys = async (instituteId: string): Promise<AiCallingKey[]> => {
    const response = await authenticatedAxiosInstance.get(EVALUATION_API_KEYS_URL, {
        params: { instituteId, product: AI_CALLING_PRODUCT },
    });
    return normalizeApiKeyList(response.data).keys;
};

export const issueAiCallingKey = async (
    instituteId: string,
    input: IssueAiCallingKeyInput
): Promise<IssuedAiCallingKey> => {
    const response = await authenticatedAxiosInstance.post(
        EVALUATION_API_KEYS_URL,
        buildIssueAiCallingKeyPayload(instituteId, input),
        { params: { instituteId } }
    );
    const issued = normalizeIssuedKey(response.data);
    if (!issued) throw new Error('issue_response_invalid');
    return issued;
};

export function normalizeWebhook(data: unknown): AiCallingWebhook | null {
    const row = (data && typeof data === 'object' ? data : null) as Record<string, unknown> | null;
    if (!row || typeof row.url !== 'string') return null;
    return {
        url: row.url,
        enabled: row.enabled !== false,
        events: Array.isArray(row.events)
            ? row.events.filter((e): e is string => typeof e === 'string')
            : [],
        secret: typeof row.secret === 'string' ? row.secret : null,
        secretHint: typeof row.secret_hint === 'string' ? row.secret_hint : null,
        updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    };
}

/** The configured webhook, or null when none is set (the server answers 404). */
export const fetchAiCallingWebhook = async (
    instituteId: string
): Promise<AiCallingWebhook | null> => {
    try {
        const response = await authenticatedAxiosInstance.get(WEBHOOK_URL, {
            params: { instituteId },
        });
        return normalizeWebhook(response.data);
    } catch (err) {
        if (isAxiosError(err) && err.response?.status === 404) return null;
        throw err;
    }
};

export const saveAiCallingWebhook = async (
    instituteId: string,
    url: string
): Promise<AiCallingWebhook> => {
    const response = await authenticatedAxiosInstance.put(
        WEBHOOK_URL,
        { url: url.trim() },
        { params: { instituteId } }
    );
    const hook = normalizeWebhook(response.data);
    if (!hook) throw new Error('webhook_response_invalid');
    return hook;
};

export const rotateAiCallingWebhookSecret = async (
    instituteId: string
): Promise<AiCallingWebhook> => {
    const response = await authenticatedAxiosInstance.post(`${WEBHOOK_URL}/rotate-secret`, null, {
        params: { instituteId },
    });
    const hook = normalizeWebhook(response.data);
    if (!hook) throw new Error('webhook_response_invalid');
    return hook;
};

export const deleteAiCallingWebhook = async (instituteId: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(WEBHOOK_URL, { params: { instituteId } });
};

export const testAiCallingWebhook = async (instituteId: string): Promise<WebhookTestResult> => {
    const response = await authenticatedAxiosInstance.post(`${WEBHOOK_URL}/test`, null, {
        params: { instituteId },
    });
    const row = (response.data ?? {}) as Record<string, unknown>;
    return {
        delivered: row.delivered === true,
        statusCode: typeof row.status_code === 'number' ? row.status_code : null,
        error: typeof row.error === 'string' ? row.error : null,
    };
};

/** The first request a client's server makes, shown in the card and the shown-once dialog. */
export const startCallCurlExample = (apiKey: string) =>
    [
        `curl -X POST ${AI_CALLING_API_BASE}/calls \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -H "X-API-Key: ${apiKey}" \\`,
        `  -H "Idempotency-Key: <your lead id>" \\`,
        `  -d '{"agent_id": "<agent id>", "phone_number": "+919876543210",`,
        `       "contact": {"name": "Asha"}, "variables": {"course": "NEET"}}'`,
    ].join('\n');

export interface CallableAgent {
    id: string;
    name: string;
    enabled: boolean;
}

/**
 * Agents a client can name as agent_id: every agent that can call out (not INBOUND-only).
 * Same request as the agents card but its own query key: the agents card caches the full
 * agent objects under ['ai-agents', …], and this list is a narrower shape.
 */
export const AI_CALLING_AGENTS_QUERY_KEY = 'AI_CALLING_API_AGENTS';

export const fetchAgentsForApi = async (instituteId: string): Promise<CallableAgent[]> => {
    const { data } = await authenticatedAxiosInstance.get<unknown[]>(
        `${BASE_URL}/admin-core-service/v1/telephony/ai-agents`,
        { params: { instituteId } }
    );
    return (Array.isArray(data) ? data : [])
        .map((raw) => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}))
        .filter((a) => typeof a.id === 'string' && a.direction !== 'INBOUND')
        .map((a) => ({
            id: a.id as string,
            name: typeof a.name === 'string' ? a.name : (a.id as string),
            enabled: a.enabled !== false,
        }));
};
