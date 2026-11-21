import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type {
    DeviceRevokeResponse,
    PanelDeviceApproveResponse,
    PanelDeviceRow,
    PanelPartnerInviteResponse,
    PanelPartnerLinkRow,
    PanelStatusResponse,
} from '@/classroom-shared/apiTypes';
import { PANEL_ADMIN_URL, featureProbeKey, type FeatureProbe } from '../featureProbe';

/** 5xx answers come back as responses so their code survives (see ../api.ts). */
const KEEP_5XX = { validateStatus: (status: number) => status < 300 || status >= 500 };

function body<T>(response: { status?: number; data: T }): T {
    if ((response.status ?? 200) >= 500) throw { response };
    return response.data;
}

/** The tab probe and the tab read the same answer: one request, not two. */
export function installersProbe(instituteId: string): FeatureProbe {
    return {
        queryKey: ['classroom-panels', 'installers', 'probe', instituteId],
        path: '/partners',
        params: { institute_id: instituteId },
    };
}

export const partnersQueryKey = (instituteId: string) =>
    featureProbeKey(installersProbe(instituteId));

/** Opening the tab right after the probe reuses its answer instead of asking again. */
const PARTNERS_STALE_MS = 30_000;

export function usePartnersQuery(instituteId: string) {
    return useQuery({
        staleTime: PARTNERS_STALE_MS,
        queryKey: partnersQueryKey(instituteId),
        retry: false,
        queryFn: async () =>
            body(
                await authenticatedAxiosInstance.get<PanelPartnerLinkRow[]>(
                    `${PANEL_ADMIN_URL}/partners`,
                    { ...KEEP_5XX, params: { institute_id: instituteId } }
                )
            ),
    });
}

/** How long an installer may set up panels after redeeming the code. The server allows 1 to 90. */
export const INSTALL_DAY_OPTIONS = [7, 14, 30, 60, 90] as const;
export const DEFAULT_INSTALL_DAYS = 30;

export async function createPartnerInvite(
    instituteId: string,
    installDays: number
): Promise<PanelPartnerInviteResponse> {
    return body(
        await authenticatedAxiosInstance.post<PanelPartnerInviteResponse>(
            `${PANEL_ADMIN_URL}/partner-invites`,
            { institute_id: instituteId, install_days: installDays },
            KEEP_5XX
        )
    );
}

export async function cancelPartnerInvite(id: string): Promise<PanelStatusResponse<'CANCELLED'>> {
    return body(
        await authenticatedAxiosInstance.post<PanelStatusResponse<'CANCELLED'>>(
            `${PANEL_ADMIN_URL}/partner-invites/${encodeURIComponent(id)}/cancel`,
            {},
            KEEP_5XX
        )
    );
}

export async function revokePartnerLink(linkId: string): Promise<PanelStatusResponse<'REVOKED'>> {
    return body(
        await authenticatedAxiosInstance.post<PanelStatusResponse<'REVOKED'>>(
            `${PANEL_ADMIN_URL}/partners/${encodeURIComponent(linkId)}/revoke`,
            {},
            KEEP_5XX
        )
    );
}

export async function approveDevice(id: string): Promise<PanelDeviceApproveResponse> {
    return body(
        await authenticatedAxiosInstance.post<PanelDeviceApproveResponse>(
            `${PANEL_ADMIN_URL}/devices/${encodeURIComponent(id)}/approve`,
            {},
            KEEP_5XX
        )
    );
}

export async function rejectDevice(id: string): Promise<DeviceRevokeResponse> {
    return body(
        await authenticatedAxiosInstance.post<DeviceRevokeResponse>(
            `${PANEL_ADMIN_URL}/devices/${encodeURIComponent(id)}/reject`,
            {},
            KEEP_5XX
        )
    );
}

/** A panel set up by an installer that the school has not approved or rejected yet. */
export const isPendingApproval = (row: PanelDeviceRow): boolean =>
    row.status !== 'REVOKED' && row.approval_state === 'PENDING';

/** The pending panels, grouped for one banner line: a single installer is named. */
export function pendingSummary(rows: PanelDeviceRow[]): {
    count: number;
    installer: string | null;
} {
    const pending = rows.filter(isPendingApproval);
    const names = new Set(pending.map((row) => row.installed_by ?? ''));
    const only = names.size === 1 ? [...names][0] : '';
    return { count: pending.length, installer: only ? only : null };
}

/** The code as the installer types it: two groups of four, like a panel's setup code. */
export const formatInviteCode = (code: string): string =>
    code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
