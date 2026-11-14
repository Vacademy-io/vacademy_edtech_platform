import { BACKEND_BASE_URL } from '@/config/baseUrl';
import {
    PANEL_BEARER_BASE,
    PANEL_PUBLIC_BASE,
    CLASSROOM_TODAY_PATH,
    type AdminInstituteRow,
    type ChallengeApproveRequest,
    type ChallengeApproveResponse,
    type ChallengeDescribeRequest,
    type ChallengeDescribeResponse,
    type ChallengeInfoResponse,
    type DeviceClaimRequest,
    type DeviceClaimResponse,
    type EndedResponse,
    type MySessionResponse,
    type PairPreviewResponse,
    type PanelPartnerClaimRequest,
    type PanelPartnerCustomerRow,
    type PanelPartnerLinkRedeemResponse,
    type PanelPartnerMeResponse,
    type PanelPartnerRef,
    type PanelPartnerRoomRow,
    type RemoteNavResponse,
    type RemoteStateResponse,
    type RoomListResponse,
    type TodayResponse,
    type TodayScope,
    isPanelApiError,
} from '@/classroom-shared/apiTypes';
import { expireSignIn, getAccessToken } from './auth';
import { isSignInFailure, PhoneApiError, request } from './http';

const NAV_TIMEOUT_MS = 6000;
const STATE_TIMEOUT_MS = 8000;

const data = <T>(promise: Promise<{ data: T }>) => promise.then((response) => response.data);

// ------------------------------------------------------------ public, QR ---

export const challengeInfo = (t: string) =>
    data(
        request<ChallengeInfoResponse>(`${PANEL_PUBLIC_BASE}/challenge/info`, {
            method: 'POST',
            body: { t },
        })
    );

// --------------------------------------------------------- public, remote ---

export const remoteState = (remoteToken: string) =>
    data(
        request<RemoteStateResponse>(`${PANEL_PUBLIC_BASE}/remote/state`, {
            method: 'POST',
            body: { remote_token: remoteToken },
            timeoutMs: STATE_TIMEOUT_MS,
        })
    );

export const remoteNav = (remoteToken: string, delta: 1 | -1, clientSeq: number) =>
    data(
        request<RemoteNavResponse>(`${PANEL_PUBLIC_BASE}/remote/nav`, {
            method: 'POST',
            body: { remote_token: remoteToken, delta, client_seq: clientSeq },
            timeoutMs: NAV_TIMEOUT_MS,
        })
    );

export const remoteEnd = (remoteToken: string) =>
    data(
        request<EndedResponse>(`${PANEL_PUBLIC_BASE}/remote/end`, {
            method: 'POST',
            body: { remote_token: remoteToken },
        })
    );

// ------------------------------------------------- Bearer with no clientId ---

export const challengeDescribe = (handle: ChallengeDescribeRequest) =>
    data(
        request<ChallengeDescribeResponse>(`${PANEL_BEARER_BASE}/challenge/describe`, {
            method: 'POST',
            body: handle,
            bearer: true,
        })
    );

export const challengeApprove = (body: ChallengeApproveRequest) =>
    data(
        request<ChallengeApproveResponse>(`${PANEL_BEARER_BASE}/challenge/approve`, {
            method: 'POST',
            body,
            bearer: true,
        })
    );

/** Null when this user has no running panel session (204). */
export const mySession = () =>
    data(request<MySessionResponse | null>(`${PANEL_BEARER_BASE}/my-session`, { bearer: true }));

export const mySessionEnd = () =>
    data(
        request<EndedResponse>(`${PANEL_BEARER_BASE}/my-session/end`, {
            method: 'POST',
            body: {},
            bearer: true,
        })
    );

export const pairPreview = (code: string) =>
    data(
        request<PairPreviewResponse>(`${PANEL_BEARER_BASE}/pair/preview`, {
            method: 'POST',
            body: { code },
            bearer: true,
        })
    );

export const adminInstitutes = () =>
    data(request<AdminInstituteRow[]>(`${PANEL_BEARER_BASE}/admin/institutes`, { bearer: true }));

export const adminRooms = (instituteId: string) =>
    data(
        request<RoomListResponse>(`${PANEL_BEARER_BASE}/admin/rooms`, {
            query: { institute_id: instituteId },
            bearer: true,
        })
    );

export const deviceClaim = (body: DeviceClaimRequest) =>
    data(
        request<DeviceClaimResponse>(`${PANEL_BEARER_BASE}/admin/devices/claim`, {
            method: 'POST',
            body,
            bearer: true,
        })
    );

// -------------------------------------------------------------- installer ---

const PROBE_TIMEOUT_MS = 8000;

/**
 * The installer org this account sets up panels for, or null for everyone else.
 *
 * Not sent through request(): this asks a question of every account that pairs a
 * panel, so an answer about the account (not an installer, the feature switched off,
 * a server without this route) must never sign the phone out: those mean null. A
 * refused sign-in (the rules of request(), for a panel path) does end it, as any other
 * Bearer call would, and throws kind 'sign-in'. It throws too when there is no answer
 * at all, so the screen can offer a retry.
 */
export async function installerProbe(): Promise<PanelPartnerRef | null> {
    const token = getAccessToken();
    if (!token) return null;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS);
    let response: Response;
    let body: Partial<PanelPartnerMeResponse> | null = null;
    try {
        response = await fetch(`${BACKEND_BASE_URL}${PANEL_BEARER_BASE}/partner/me`, {
            headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
            cache: 'no-store',
            signal: abort.signal,
        });
        const text = await response.text();
        try {
            body = text ? JSON.parse(text) : null;
        } catch {
            body = null;
        }
    } catch {
        throw new PhoneApiError('network', null, null, null);
    } finally {
        clearTimeout(timer);
    }
    if (response.ok) return body?.partner?.id ? body.partner : null;
    const status = response.status;
    if (status === 429 || status === 503) throw new PhoneApiError('busy', status, null, null);
    const code = isPanelApiError(body) ? body.code : null;
    const refusal = body as { error?: unknown; path?: unknown } | null;
    // A server without this route: an answer about the server, never about the sign-in.
    const noRoute =
        status === 404 ||
        (status === 403 && refusal?.error === 'ACCESS_DENIED' && refusal.path === '/error');
    if (!noRoute && isSignInFailure(status, body, token, true)) {
        expireSignIn();
        throw new PhoneApiError('sign-in', status, code, body);
    }
    if (status >= 500) throw new PhoneApiError('api', status, code, null);
    return null;
}

export const redeemPartnerCode = (code: string) =>
    data(
        request<PanelPartnerLinkRedeemResponse>(`${PANEL_BEARER_BASE}/partner/links/redeem`, {
            method: 'POST',
            body: { code },
            bearer: true,
        })
    );

export const partnerCustomers = () =>
    data(
        request<PanelPartnerCustomerRow[]>(`${PANEL_BEARER_BASE}/partner/customers`, {
            bearer: true,
        })
    );

export const partnerRooms = (instituteId: string) =>
    data(
        request<PanelPartnerRoomRow[]>(`${PANEL_BEARER_BASE}/partner/rooms`, {
            query: { institute_id: instituteId },
            bearer: true,
        })
    );

/** The panel lands waiting for the school's approval. There is no replace. */
export const partnerClaim = (body: PanelPartnerClaimRequest) =>
    data(
        request<DeviceClaimResponse>(`${PANEL_BEARER_BASE}/partner/devices/claim`, {
            method: 'POST',
            body,
            bearer: true,
        })
    );

// ------------------------------------------------------------- admin_core ---

export const classroomToday = (instituteId: string, scope: TodayScope) =>
    data(
        request<TodayResponse>(CLASSROOM_TODAY_PATH, {
            query: { instituteId, scope },
            bearer: true,
            clientId: instituteId,
        })
    );

export interface InstituteBranding {
    instituteId?: string;
    instituteName?: string | null;
    instituteThemeCode?: string | null;
}

/** Public. Often 404 when an institute has no routing row, so this never throws. */
export async function resolveInstitute(instituteId: string): Promise<InstituteBranding | null> {
    try {
        return await data(
            request<InstituteBranding>(
                '/admin-core-service/public/domain-routing/v1/resolve-by-institute',
                { query: { instituteId }, timeoutMs: 5000 }
            )
        );
    } catch {
        return null;
    }
}

// ----------------------------------------------------------------- logins ---

export interface LoginResponse {
    accessToken?: string | null;
    refreshToken?: string | null;
    session_limit_exceeded?: boolean;
}

export const loginPassword = (username: string, password: string, instituteId?: string | null) =>
    data(
        request<LoginResponse>('/auth-service/v1/login-root', {
            method: 'POST',
            body: {
                user_name: username,
                password,
                client_name: 'ADMIN_PORTAL',
                ...(instituteId ? { institute_id: instituteId } : {}),
            },
        })
    );

export const requestOtp = (email: string, instituteId?: string | null) =>
    data(
        request<unknown>('/auth-service/v1/request-otp', {
            method: 'POST',
            body: {
                email,
                client_name: 'ADMIN',
                ...(instituteId ? { institute_id: instituteId } : {}),
            },
        })
    );

export const loginOtp = (email: string, otp: string, instituteId?: string | null) =>
    data(
        request<LoginResponse>('/auth-service/v1/login-otp', {
            method: 'POST',
            body: {
                user_name: email,
                password: '',
                client_name: 'ADMIN',
                institute_id: instituteId ?? '',
                email,
                otp,
            },
        })
    );

export { PhoneApiError };
