import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { TFunction } from 'i18next';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import {
    PANEL_BEARER_BASE,
    isPanelApiError,
    type ClassroomRoom,
    type DevicePatchRequest,
    type DeviceClaimRequest,
    type DeviceClaimResponse,
    type DeviceRevokeResponse,
    type EndedResponse,
    type PairPreviewResponse,
    type PanelApiError,
    type PanelDeviceRow,
    type RoomBulkCreateResponse,
    type RoomListResponse,
    type RoomPatchRequest,
} from '@/classroom-shared/apiTypes';

const BEARER = `${BASE_URL}${PANEL_BEARER_BASE}`;
const ADMIN = `${BEARER}/admin`;

/**
 * The shared client turns a 5xx with no legacy error fields into a bare Error, which would lose
 * BUSY and TRY_AGAIN. So 5xx responses come back here as responses, and `body` rethrows them in
 * the same shape as any other failed call.
 */
const KEEP_5XX = { validateStatus: (status: number) => status < 300 || status >= 500 };

function body<T>(response: { status?: number; data: T }): T {
    if ((response.status ?? 200) >= 500) throw { response };
    return response.data;
}

export const classroomPanelKeys = {
    rooms: (instituteId: string) => ['classroom-panels', 'rooms', instituteId] as const,
    devices: (instituteId: string) => ['classroom-panels', 'devices', instituteId] as const,
};

/** Online state is only worth refreshing while someone is looking at the table. */
const DEVICES_POLL_MS = 30_000;

export function useRoomsQuery(instituteId: string) {
    return useQuery({
        queryKey: classroomPanelKeys.rooms(instituteId),
        retry: false,
        queryFn: async () => {
            return body(
                await authenticatedAxiosInstance.get<RoomListResponse>(`${ADMIN}/rooms`, {
                    ...KEEP_5XX,
                    params: { institute_id: instituteId },
                })
            );
        },
    });
}

export function useDevicesQuery(instituteId: string, pollMs: number = DEVICES_POLL_MS) {
    return useQuery({
        queryKey: classroomPanelKeys.devices(instituteId),
        retry: false,
        refetchInterval: pollMs,
        queryFn: async () => {
            return body(
                await authenticatedAxiosInstance.get<PanelDeviceRow[]>(`${ADMIN}/devices`, {
                    ...KEEP_5XX,
                    params: { institute_id: instituteId },
                })
            );
        },
    });
}

/** Any change here can move a panel or a room, so both lists are refetched together. */
export function useRefreshPanels(instituteId: string) {
    const queryClient = useQueryClient();
    return useCallback(
        () =>
            Promise.all([
                queryClient.invalidateQueries({ queryKey: classroomPanelKeys.rooms(instituteId) }),
                queryClient.invalidateQueries({
                    queryKey: classroomPanelKeys.devices(instituteId),
                }),
            ]),
        [queryClient, instituteId]
    );
}

export async function previewPair(code: string): Promise<PairPreviewResponse> {
    return body(
        await authenticatedAxiosInstance.post<PairPreviewResponse>(
            `${BEARER}/pair/preview`,
            { code },
            KEEP_5XX
        )
    );
}

export async function claimDevice(request: DeviceClaimRequest): Promise<DeviceClaimResponse> {
    return body(
        await authenticatedAxiosInstance.post<DeviceClaimResponse>(
            `${ADMIN}/devices/claim`,
            request,
            KEEP_5XX
        )
    );
}

export async function createRoom(instituteId: string, name: string): Promise<ClassroomRoom> {
    return body(
        await authenticatedAxiosInstance.post<ClassroomRoom>(
            `${ADMIN}/rooms`,
            { institute_id: instituteId, name },
            KEEP_5XX
        )
    );
}

export async function createRoomsBulk(
    instituteId: string,
    names: string[]
): Promise<RoomBulkCreateResponse> {
    return body(
        await authenticatedAxiosInstance.post<RoomBulkCreateResponse>(
            `${ADMIN}/rooms/bulk`,
            { institute_id: instituteId, names },
            KEEP_5XX
        )
    );
}

export async function patchRoom(id: string, request: RoomPatchRequest): Promise<ClassroomRoom> {
    return body(
        await authenticatedAxiosInstance.patch<ClassroomRoom>(
            `${ADMIN}/rooms/${encodeURIComponent(id)}`,
            request,
            KEEP_5XX
        )
    );
}

export async function patchDevice(
    id: string,
    request: DevicePatchRequest
): Promise<PanelDeviceRow> {
    return body(
        await authenticatedAxiosInstance.patch<PanelDeviceRow>(
            `${ADMIN}/devices/${encodeURIComponent(id)}`,
            request,
            KEEP_5XX
        )
    );
}

export async function revokeDevice(id: string): Promise<DeviceRevokeResponse> {
    return body(
        await authenticatedAxiosInstance.post<DeviceRevokeResponse>(
            `${ADMIN}/devices/${encodeURIComponent(id)}/revoke`,
            {},
            KEEP_5XX
        )
    );
}

export async function endSession(id: string): Promise<EndedResponse> {
    return body(
        await authenticatedAxiosInstance.post<EndedResponse>(
            `${ADMIN}/sessions/${encodeURIComponent(id)}/end`,
            {},
            KEEP_5XX
        )
    );
}

/** The structured `{ code, ... }` body of a panel API failure, or null for anything else. */
export function panelApiError(error: unknown): PanelApiError | null {
    const data = (error as { response?: { data?: unknown } } | null)?.response?.data;
    return isPanelApiError(data) ? data : null;
}

const CODES_WITH_COPY = new Set<string>([
    'FORBIDDEN',
    'BUSY',
    'RATE_LIMITED',
    'TRY_AGAIN',
    'NOT_FOUND',
    'WRONG_NUMBER',
    'ROOM_OCCUPIED',
    'ROOM_OTHER_INSTITUTE',
    'ROOM_NAME_TAKEN',
    'ROOM_HAS_DEVICE',
    'DEVICE_NOT_ACTIVE',
]);

/** Text for a failure. Switches on `code` and never shows the server's own message. */
export function panelErrorMessage(t: TFunction, error: unknown): string {
    const code = panelApiError(error)?.code;
    if (code && CODES_WITH_COPY.has(code)) return t(`errors.${code}`);
    const hasResponse = !!(error as { response?: unknown } | null)?.response;
    return t(hasResponse ? 'errors.generic' : 'errors.network');
}

/** Accepts K7QF-2M9X, lower case and spaces. The server also folds look-alike characters. */
export const normaliseSetupCode = (value: string): string =>
    value.toUpperCase().replace(/[^0-9A-Z]/g, '');

export const SETUP_CODE_LENGTH = 8;
export const ROOM_NAME_MAX = 120;
export const BULK_ROOM_MAX = 200;

/** One room per line. Blank lines go, and a name repeated in the paste is sent once. */
export function parseRoomList(text: string): string[] {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const line of text.split(/\r?\n/)) {
        const name = line.trim();
        const key = name.toLowerCase();
        if (!name || seen.has(key)) continue;
        seen.add(key);
        names.push(name);
    }
    return names;
}

/**
 * The server's default for `flags.bbb_in_app_min_webview`. That flag only reaches panels through
 * /sync, so the console compares against the default until the device list carries it.
 */
export const IN_APP_LIVE_CLASS_MIN_WEBVIEW = 9999;

/** Rooms in reading order, so Room 2 comes before Room 10. */
export function compareNames(a: string, b: string, locale: string): number {
    return a.localeCompare(b, locale, { numeric: true, sensitivity: 'base' });
}
