import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import type {
    PanelFleetAlert,
    PanelFleetAlertKind,
    PanelFleetResponse,
    PanelFleetSeverity,
} from '@/classroom-shared/apiTypes';
import type { StatusType } from '@/components/design-system/status-chips';
import { PANEL_ADMIN_URL, featureProbeKey, type FeatureProbe } from '../featureProbe';

/** 5xx answers come back as responses so their code survives (see ../api.ts). */
const KEEP_5XX = { validateStatus: (status: number) => status < 300 || status >= 500 };

function body<T>(response: { status?: number; data: T }): T {
    if ((response.status ?? 200) >= 500) throw { response };
    return response.data;
}

/** The tab probe, the tab and the Panels list read the same answer: one request. */
export function alertsProbe(instituteId: string): FeatureProbe {
    return {
        queryKey: ['classroom-panels', 'alerts', 'probe', instituteId],
        path: '/fleet',
        params: { institute_id: instituteId },
    };
}

export const fleetQueryKey = (instituteId: string) => featureProbeKey(alertsProbe(instituteId));

/** Alerts are computed on read and change slowly, so a few minutes between reads is plenty. */
const FLEET_STALE_MS = 2 * 60_000;

export function useFleetQuery(instituteId: string, options: { enabled?: boolean } = {}) {
    return useQuery({
        queryKey: fleetQueryKey(instituteId),
        retry: false,
        staleTime: FLEET_STALE_MS,
        enabled: options.enabled ?? true,
        queryFn: async () =>
            body(
                await authenticatedAxiosInstance.get<PanelFleetResponse>(
                    `${PANEL_ADMIN_URL}/fleet`,
                    { ...KEEP_5XX, params: { institute_id: instituteId } }
                )
            ),
    });
}

export const SEVERITY_ORDER: readonly PanelFleetSeverity[] = ['bad', 'warn', 'info'];

export const SEVERITY_CHIP: Record<PanelFleetSeverity, StatusType> = {
    bad: 'DANGER',
    warn: 'WARNING',
    info: 'INFO',
};

/** Translation keys, kept literal so the catalogue test can find them. */
export const SEVERITY_LABEL: Record<PanelFleetSeverity, string> = {
    bad: 'alerts.severity.bad',
    warn: 'alerts.severity.warn',
    info: 'alerts.severity.info',
};

export const ALERT_KIND_LABEL: Record<PanelFleetAlertKind, string> = {
    OFFLINE: 'alerts.kind.OFFLINE',
    NOT_CONFIRMED: 'alerts.kind.NOT_CONFIRMED',
    AWAITING_APPROVAL: 'alerts.kind.AWAITING_APPROVAL',
    UPDATE_REQUIRED: 'alerts.kind.UPDATE_REQUIRED',
    APP_OUTDATED: 'alerts.kind.APP_OUTDATED',
    WEBVIEW_OLD: 'alerts.kind.WEBVIEW_OLD',
    UNUSED: 'alerts.kind.UNUSED',
    LICENCE_ROOM: 'alerts.kind.LICENCE_ROOM',
    LICENCE_ENDING: 'alerts.kind.LICENCE_ENDING',
};

export const ALERT_TODO: Record<PanelFleetAlertKind, string> = {
    OFFLINE: 'alerts.todo.OFFLINE',
    NOT_CONFIRMED: 'alerts.todo.NOT_CONFIRMED',
    AWAITING_APPROVAL: 'alerts.todo.AWAITING_APPROVAL',
    UPDATE_REQUIRED: 'alerts.todo.UPDATE_REQUIRED',
    APP_OUTDATED: 'alerts.todo.APP_OUTDATED',
    WEBVIEW_OLD: 'alerts.todo.WEBVIEW_OLD',
    UNUSED: 'alerts.todo.UNUSED',
    LICENCE_ROOM: 'alerts.todo.LICENCE_ROOM',
    LICENCE_ENDING: 'alerts.todo.LICENCE_ENDING',
};

/**
 * A kind this console does not know yet (a newer server) is still listed, with a generic
 * label and to-do text; a severity it does not know counts as info.
 */
const severityRank = (severity: PanelFleetSeverity): number => {
    const rank = SEVERITY_ORDER.indexOf(severity);
    return rank < 0 ? SEVERITY_ORDER.length : rank;
};

export const isKnownKind = (kind: string): kind is PanelFleetAlertKind => kind in ALERT_KIND_LABEL;

/** The chip text key of any kind, a generic one for a kind this console does not know. */
export const alertKindLabel = (kind: string): string =>
    isKnownKind(kind) ? ALERT_KIND_LABEL[kind] : 'alerts.kind.other';

/** The to-do text key of any kind, a generic one for a kind this console does not know. */
export const alertTodo = (kind: string): string =>
    isKnownKind(kind) ? ALERT_TODO[kind] : 'alerts.todo.other';

export const isKnownSeverity = (severity: string): severity is PanelFleetSeverity =>
    (SEVERITY_ORDER as readonly string[]).includes(severity);

/** Alerts grouped by severity, worst group first, each group by room name. */
export function groupBySeverity(
    alerts: PanelFleetAlert[],
    locale: string
): { severity: PanelFleetSeverity; alerts: PanelFleetAlert[] }[] {
    return SEVERITY_ORDER.map((severity) => ({
        severity,
        alerts: alerts
            .filter(
                (alert) => (isKnownSeverity(alert.severity) ? alert.severity : 'info') === severity
            )
            .sort((a, b) =>
                (a.room?.name ?? '').localeCompare(b.room?.name ?? '', locale, {
                    numeric: true,
                    sensitivity: 'base',
                })
            ),
    })).filter((group) => group.alerts.length > 0);
}

/** The worst alert of each panel with a known severity, for the chip on its row. */
export function worstAlertByDevice(alerts: PanelFleetAlert[]): Map<string, PanelFleetAlert> {
    const worst = new Map<string, PanelFleetAlert>();
    for (const alert of alerts) {
        if (!alert.device_id || !isKnownSeverity(alert.severity)) {
            continue;
        }
        const current = worst.get(alert.device_id);
        if (!current || severityRank(alert.severity) < severityRank(current.severity)) {
            worst.set(alert.device_id, alert);
        }
    }
    return worst;
}

// ------------------------------------------------- notification setting ---

/** Institute setting read by the daily alert job. Only these fields are edited here. */
export const CLASSROOM_NOTIFY_SETTING_KEY = 'CLASSROOM_NOTIFY_SETTING';
// The generic institute setting endpoints (the same ones GET_INSITITUTE_SETTINGS names). Built
// from BASE_URL so this module needs nothing else from the shared URL list.
const SETTING_BASE = `${BASE_URL}/admin-core-service/institute/setting/v1`;
const GET_SETTING_URL = `${SETTING_BASE}/get`;
const SAVE_SETTING_URL = `${SETTING_BASE}/save-setting`;

export interface ClassroomNotifySetting {
    alerts_email: boolean;
    hour: number;
    timezone: string;
    /** Every other stored field, written back untouched. */
    [key: string]: unknown;
}

export const DEFAULT_NOTIFY_HOUR = 9;

/** The admin's own zone; UTC when the browser cannot say. */
export function browserTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

export function defaultNotifySetting(): ClassroomNotifySetting {
    return {
        alerts_email: false,
        alerts_whatsapp: false,
        whatsapp_weekly: false,
        hour: DEFAULT_NOTIFY_HOUR,
        timezone: browserTimeZone(),
        recipient_roles: ['ADMIN'],
        recipient_user_ids: [],
    };
}

/** Never saved, or saved in an odd shape: the defaults, with any stored fields kept. */
export function parseNotifySetting(raw: unknown): ClassroomNotifySetting {
    const base = defaultNotifySetting();
    const data = raw && typeof raw === 'object' ? (raw as { data?: unknown }).data : undefined;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return base;
    const stored = data as Record<string, unknown>;
    const hour = Number(stored.hour);
    return {
        ...base,
        ...stored,
        alerts_email: stored.alerts_email === true,
        hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : base.hour,
        timezone:
            typeof stored.timezone === 'string' && stored.timezone
                ? stored.timezone
                : base.timezone,
    };
}

export const notifySettingKey = (instituteId: string) =>
    ['classroom-panels', 'alerts', 'notify-setting', instituteId] as const;

export function useNotifySettingQuery(instituteId: string) {
    return useQuery({
        queryKey: notifySettingKey(instituteId),
        retry: false,
        queryFn: async () =>
            parseNotifySetting(
                (
                    await authenticatedAxiosInstance.get<unknown>(GET_SETTING_URL, {
                        params: {
                            instituteId,
                            settingKey: CLASSROOM_NOTIFY_SETTING_KEY,
                        },
                    })
                ).data
            ),
    });
}

export async function saveNotifySetting(
    instituteId: string,
    setting: ClassroomNotifySetting
): Promise<void> {
    await authenticatedAxiosInstance.post(
        SAVE_SETTING_URL,
        { setting_name: 'Classroom panel alerts', setting_data: setting },
        { params: { instituteId, settingKey: CLASSROOM_NOTIFY_SETTING_KEY } }
    );
}
