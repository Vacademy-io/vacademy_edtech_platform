/**
 * Marketing API (admin_core_service, /admin-core-service/v1/marketing/*): OAuth connect
 * for Meta / Google ad accounts and social profiles, the ad performance report, and
 * social post scheduling. One function per endpoint; every call carries the current
 * institute as `instituteId` and the server checks the caller's role for it.
 */
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { BASE_URL } from '@/constants/urls';
import type {
    AdAccount,
    AdPerformance,
    AiDraftRequest,
    AiDraftResponse,
    ConnectOptionsResponse,
    InitiateOAuthResponse,
    ListSocialPostsParams,
    MarketingProvider,
    SelectConnectOptionsResponse,
    SocialAccount,
    SocialPost,
    SocialPostRequest,
    SyncAllResponse,
} from './types';

export const MARKETING_BASE = `${BASE_URL}/admin-core-service/v1/marketing`;
const OAUTH_BASE = `${MARKETING_BASE}/oauth`;
const ADS_BASE = `${MARKETING_BASE}/ads`;
const SOCIAL_BASE = `${MARKETING_BASE}/social`;

/** A single-account sync runs synchronously on the server for up to 60 s. */
const SYNC_TIMEOUT_MS = 75_000;
/** AI drafting is one LLM round trip; give it room beyond the axios default. */
const AI_DRAFT_TIMEOUT_MS = 90_000;

function instituteParams(extra?: Record<string, unknown>) {
    return { instituteId: getCurrentInstituteId() ?? '', ...extra };
}

const enc = encodeURIComponent;

/**
 * The backend's error text, verbatim when it sent one (VacademyException → `ex`,
 * ResponseStatusException → `message`/`detail`/`error`, or a plain string body).
 * The connect dialog shows it as-is, e.g. "Google Ads developer token is not configured".
 */
export function marketingErrorMessage(error: unknown, fallback: string): string {
    const e = error as { response?: { data?: unknown }; message?: string };
    const data = e?.response?.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        const d = data as Record<string, unknown>;
        for (const key of ['ex', 'message', 'detail', 'error']) {
            const value = d[key];
            if (typeof value === 'string' && value.trim()) return value;
        }
    }
    if (typeof data === 'string' && data.trim() && data.length < 500 && !data.includes('<'))
        return data;
    return fallback;
}

// ── OAuth + account selection ───────────────────────────────────────────────

/** Starts an OAuth grant; the caller sends the browser to `oauth_url`. */
export async function initiateMarketingOAuth(
    provider: MarketingProvider
): Promise<InitiateOAuthResponse> {
    const res = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${OAUTH_BASE}/initiate`,
        params: instituteParams({ provider, frontendOrigin: window.location.origin }),
    });
    return res.data;
}

/** Accounts / pages / locations the just-authorised grant can reach. */
export async function getConnectOptions(sessionKey: string): Promise<ConnectOptionsResponse> {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${OAUTH_BASE}/session/${enc(sessionKey)}/options`,
        params: instituteParams(),
    });
    return res.data;
}

export async function selectConnectOptions(
    sessionKey: string,
    externalIds: string[]
): Promise<SelectConnectOptionsResponse> {
    const res = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${OAUTH_BASE}/session/${enc(sessionKey)}/select`,
        params: instituteParams(),
        data: { external_ids: externalIds },
    });
    return res.data;
}

// ── Ads ─────────────────────────────────────────────────────────────────────

export async function listAdAccounts(): Promise<AdAccount[]> {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${ADS_BASE}/accounts`,
        params: instituteParams(),
    });
    return Array.isArray(res.data) ? res.data : [];
}

export async function disconnectAdAccount(id: string): Promise<void> {
    await authenticatedAxiosInstance({
        method: 'DELETE',
        url: `${ADS_BASE}/accounts/${enc(id)}`,
        params: instituteParams(),
    });
}

export async function syncAdAccount(id: string): Promise<AdAccount> {
    const res = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${ADS_BASE}/accounts/${enc(id)}/sync`,
        params: instituteParams(),
        timeout: SYNC_TIMEOUT_MS,
    });
    return res.data;
}

export async function syncAllAdAccounts(): Promise<SyncAllResponse> {
    const res = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${ADS_BASE}/sync`,
        params: instituteParams(),
    });
    return res.data;
}

/** `from` / `to` are yyyy-MM-dd, both inclusive, in the institute's time zone. */
export async function getAdPerformance(from: string, to: string): Promise<AdPerformance> {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${ADS_BASE}/performance`,
        params: instituteParams({ from, to }),
    });
    return res.data;
}

// ── Social ──────────────────────────────────────────────────────────────────

export async function listSocialAccounts(): Promise<SocialAccount[]> {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${SOCIAL_BASE}/accounts`,
        params: instituteParams(),
    });
    return Array.isArray(res.data) ? res.data : [];
}

export async function disconnectSocialAccount(id: string): Promise<void> {
    await authenticatedAxiosInstance({
        method: 'DELETE',
        url: `${SOCIAL_BASE}/accounts/${enc(id)}`,
        params: instituteParams(),
    });
}

export async function listSocialPosts(params: ListSocialPostsParams = {}): Promise<SocialPost[]> {
    const res = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${SOCIAL_BASE}/posts`,
        params: instituteParams({
            from: params.from || undefined,
            to: params.to || undefined,
            status: params.status || undefined,
        }),
    });
    return Array.isArray(res.data) ? res.data : [];
}

export async function createSocialPost(req: SocialPostRequest): Promise<SocialPost> {
    const res = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${SOCIAL_BASE}/posts`,
        params: instituteParams(),
        data: req,
    });
    return res.data;
}

export async function updateSocialPost(id: string, req: SocialPostRequest): Promise<SocialPost> {
    const res = await authenticatedAxiosInstance({
        method: 'PUT',
        url: `${SOCIAL_BASE}/posts/${enc(id)}`,
        params: instituteParams(),
        data: req,
    });
    return res.data;
}

async function postAction(id: string, action: string): Promise<SocialPost> {
    const res = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${SOCIAL_BASE}/posts/${enc(id)}/${action}`,
        params: instituteParams(),
    });
    return res.data;
}

export const approveSocialPost = (id: string) => postAction(id, 'approve');
export const postSocialPostNow = (id: string) => postAction(id, 'post-now');
export const cancelSocialPost = (id: string) => postAction(id, 'cancel');
export const retrySocialPost = (id: string) => postAction(id, 'retry');

export async function deleteSocialPost(id: string): Promise<void> {
    await authenticatedAxiosInstance({
        method: 'DELETE',
        url: `${SOCIAL_BASE}/posts/${enc(id)}`,
        params: instituteParams(),
    });
}

/** Drafts copy with AI; nothing is saved. */
export async function aiDraftSocialPost(req: AiDraftRequest): Promise<AiDraftResponse> {
    const res = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${SOCIAL_BASE}/posts/ai-draft`,
        params: instituteParams(),
        data: req,
        timeout: AI_DRAFT_TIMEOUT_MS,
    });
    return res.data;
}
