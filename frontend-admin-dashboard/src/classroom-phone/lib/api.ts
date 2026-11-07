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
    type RemoteNavResponse,
    type RemoteStateResponse,
    type RoomListResponse,
    type TodayResponse,
    type TodayScope,
} from '@/classroom-shared/apiTypes';
import { PhoneApiError, request } from './http';

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
