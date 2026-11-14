import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ZOOM_ACCOUNTS_BASE, ZOOM_OAUTH_INITIATE } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

/**
 * Service module for managing per-institute Zoom account credentials.
 *
 * Backend never returns secret fields — only masked identifiers. To rotate a
 * secret the admin must re-enter it on edit; leaving it blank preserves the
 * existing encrypted value.
 */

export interface ZoomAccountSummary {
    id: string;
    label: string;
    zoomAccountIdMasked: string;
    s2sClientIdMasked: string;
    /** Null when the account uses the platform-owned Meeting SDK app (no per-account SDK key). */
    sdkClientKeyMasked: string | null;
    webhookConfigured: boolean;
    status: 'ACTIVE' | 'INVALID_CREDENTIALS' | 'DISABLED' | string;
    isDefault: boolean;
    lastVerifiedAt?: string | null;
    createdAt?: string | null;
}

export interface ZoomAccountRequest {
    label: string;
    zoomAccountId: string;
    s2sClientId: string;
    /** Required on create; omit on edit to keep the existing secret. */
    s2sClientSecret?: string;
    /** Optional — omit to use the platform-owned Meeting SDK app (host-only / same-account). */
    sdkClientKey?: string;
    sdkClientSecret?: string;
    webhookVerificationToken?: string | null;
    setAsDefault?: boolean;
}

export interface ZoomTestConnectionResponse {
    ok: boolean;
    accountEmail?: string;
    planType?: string;
    error?: string;
}

// The institute being worked in (selected; the token's first only when none is selected) —
// not always the token's first, which put a multi-institute admin's accounts on the wrong
// institute.
const getInstituteId = (): string => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) throw new Error('No institute ID found in token');
    return instituteId;
};

export const listZoomAccounts = async (): Promise<ZoomAccountSummary[]> => {
    const instituteId = getInstituteId();
    const { data } = await authenticatedAxiosInstance.get<ZoomAccountSummary[]>(
        ZOOM_ACCOUNTS_BASE,
        { params: { instituteId } }
    );
    return data ?? [];
};

/**
 * Start "Connect with Zoom": returns the Zoom consent URL. The caller redirects the browser
 * there; Zoom then bounces back to the server callback, which creates the account and lands
 * the admin back on Settings (?zoom_connected=1 or ?zoom_error=...).
 */
export const initiateZoomOAuth = async (): Promise<{ oauth_url: string; session_key: string }> => {
    const instituteId = getInstituteId();
    const { data } = await authenticatedAxiosInstance.post<{ oauth_url: string; session_key: string }>(
        ZOOM_OAUTH_INITIATE,
        null,
        { params: { instituteId } }
    );
    return data;
};

export const createZoomAccount = async (
    payload: ZoomAccountRequest
): Promise<ZoomAccountSummary> => {
    const instituteId = getInstituteId();
    const { data } = await authenticatedAxiosInstance.post<ZoomAccountSummary>(
        ZOOM_ACCOUNTS_BASE,
        payload,
        { params: { instituteId } }
    );
    return data;
};

export const updateZoomAccount = async (
    id: string,
    payload: ZoomAccountRequest
): Promise<ZoomAccountSummary> => {
    const instituteId = getInstituteId();
    const { data } = await authenticatedAxiosInstance.put<ZoomAccountSummary>(
        `${ZOOM_ACCOUNTS_BASE}/${id}`,
        payload,
        { params: { instituteId } }
    );
    return data;
};

export const deleteZoomAccount = async (id: string): Promise<void> => {
    const instituteId = getInstituteId();
    await authenticatedAxiosInstance.delete(`${ZOOM_ACCOUNTS_BASE}/${id}`, {
        params: { instituteId },
    });
};

export const setDefaultZoomAccount = async (id: string): Promise<ZoomAccountSummary> => {
    const instituteId = getInstituteId();
    const { data } = await authenticatedAxiosInstance.post<ZoomAccountSummary>(
        `${ZOOM_ACCOUNTS_BASE}/${id}/set-default`,
        null,
        { params: { instituteId } }
    );
    return data;
};

export const testZoomConnection = async (
    id: string
): Promise<ZoomTestConnectionResponse> => {
    const instituteId = getInstituteId();
    const { data } = await authenticatedAxiosInstance.post<ZoomTestConnectionResponse>(
        `${ZOOM_ACCOUNTS_BASE}/${id}/test-connection`,
        null,
        { params: { instituteId } }
    );
    return data;
};
