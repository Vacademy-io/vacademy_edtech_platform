import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type {
    PanelInstituteLicenceState,
    PanelLicenceResponse,
    PanelLicenceRoomActionResponse,
    PanelRoomLicenceState,
} from '@/classroom-shared/apiTypes';
import type { StatusType } from '@/components/design-system/status-chips';
import { panelApiError, panelErrorMessage } from '../api';
import { PANEL_ADMIN_URL, featureProbeKey, type FeatureProbe } from '../featureProbe';

/** 5xx answers come back as responses so their code survives (see ../api.ts). */
const KEEP_5XX = { validateStatus: (status: number) => status < 300 || status >= 500 };

function body<T>(response: { status?: number; data: T }): T {
    if ((response.status ?? 200) >= 500) throw { response };
    return response.data;
}

/** The tab probe and the tab read the same answer: one request, not two. */
export function licenceProbe(instituteId: string): FeatureProbe {
    return {
        queryKey: ['classroom-panels', 'licence', 'probe', instituteId],
        path: '/licence',
        params: { institute_id: instituteId },
    };
}

export const licenceQueryKey = (instituteId: string) => featureProbeKey(licenceProbe(instituteId));

/** The server caches licence state for about a minute, so reading more often gains nothing. */
const LICENCE_STALE_MS = 60_000;

export function useLicenceQuery(instituteId: string) {
    return useQuery({
        staleTime: LICENCE_STALE_MS,
        queryKey: licenceQueryKey(instituteId),
        retry: false,
        queryFn: async () =>
            body(
                await authenticatedAxiosInstance.get<PanelLicenceResponse>(
                    `${PANEL_ADMIN_URL}/licence`,
                    { ...KEEP_5XX, params: { institute_id: instituteId } }
                )
            ),
    });
}

export async function assignSeat(roomId: string): Promise<PanelLicenceRoomActionResponse> {
    return body(
        await authenticatedAxiosInstance.post<PanelLicenceRoomActionResponse>(
            `${PANEL_ADMIN_URL}/licence/rooms/${encodeURIComponent(roomId)}/assign`,
            {},
            KEEP_5XX
        )
    );
}

export async function releaseSeat(roomId: string): Promise<PanelLicenceRoomActionResponse> {
    return body(
        await authenticatedAxiosInstance.post<PanelLicenceRoomActionResponse>(
            `${PANEL_ADMIN_URL}/licence/rooms/${encodeURIComponent(roomId)}/release`,
            {},
            KEEP_5XX
        )
    );
}

/** NO_SEAT has its own words; everything else reads like the rest of the console. */
export function licenceErrorMessage(t: TFunction, error: unknown): string {
    if (panelApiError(error)?.code === 'NO_SEAT') return t('licence.errors.NO_SEAT');
    return panelErrorMessage(t, error);
}

export const ROOM_LICENCE_CHIP: Record<PanelRoomLicenceState, StatusType> = {
    LICENSED: 'SUCCESS',
    GRACE: 'WARNING',
    OVER_LIMIT: 'DANGER',
    UNLICENSED: 'INFO',
    EXPIRED: 'DANGER',
    UNMANAGED: 'INFO',
};

export const INSTITUTE_LICENCE_CHIP: Record<PanelInstituteLicenceState, StatusType> = {
    UNMANAGED: 'INFO',
    ACTIVE: 'SUCCESS',
    TRIAL: 'SUCCESS',
    GRACE: 'WARNING',
    EXPIRED: 'DANGER',
    NONE: 'INFO',
};

/** Translation keys, kept literal so the catalogue test can find them. */
export const ROOM_LICENCE_LABEL: Record<PanelRoomLicenceState, string> = {
    LICENSED: 'licence.roomState.LICENSED',
    GRACE: 'licence.roomState.GRACE',
    OVER_LIMIT: 'licence.roomState.OVER_LIMIT',
    UNLICENSED: 'licence.roomState.UNLICENSED',
    EXPIRED: 'licence.roomState.EXPIRED',
    UNMANAGED: 'licence.roomState.UNMANAGED',
};

export const INSTITUTE_LICENCE_LABEL: Record<PanelInstituteLicenceState, string> = {
    UNMANAGED: 'licence.state.UNMANAGED',
    ACTIVE: 'licence.state.ACTIVE',
    TRIAL: 'licence.state.TRIAL',
    GRACE: 'licence.state.GRACE',
    EXPIRED: 'licence.state.EXPIRED',
    NONE: 'licence.state.NONE',
};

/** A seat can be given only to a room without one. */
export const canAssign = (state: PanelRoomLicenceState): boolean => state === 'UNLICENSED';

/** A room that holds a seat, in any state, can give it back. */
export const canRelease = (state: PanelRoomLicenceState, licensedAt: string | null): boolean =>
    state === 'LICENSED' ||
    state === 'GRACE' ||
    state === 'OVER_LIMIT' ||
    (state === 'EXPIRED' && licensedAt !== null);
