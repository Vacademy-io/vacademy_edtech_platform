/**
 * Journey status: where a learner stands in each batch (Learning, Temporary Break, At Risk, ...).
 *
 * The institute's status list and rules are JOURNEY_STATUS_SETTING (Settings → Journey status,
 * off by default). Every rule works on a status's `kind`, never its name, so labels can change.
 * While the setting is off no journey UI appears anywhere: `useJourneyStatusSettings` is the gate.
 * Nothing here sends a message; statuses are for staff.
 */
import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    GET_INSITITUTE_SETTINGS,
    JOURNEY_STATUS_COUNTS,
    JOURNEY_STATUS_FOR_LEARNER,
    JOURNEY_STATUS_FOR_USERS,
    JOURNEY_STATUS_REENTRY,
    JOURNEY_STATUS_SET,
    JOURNEY_STATUS_SETTINGS,
} from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

export type JourneyKind = 'ACTIVE' | 'BREAK' | 'RISK' | 'STOPPED' | 'REENTRY';

export const JOURNEY_KINDS: JourneyKind[] = ['ACTIVE', 'BREAK', 'RISK', 'STOPPED', 'REENTRY'];

/** Most severe first: which of a learner's batches the list badge shows. */
export const JOURNEY_SEVERITY: JourneyKind[] = ['STOPPED', 'RISK', 'BREAK', 'REENTRY', 'ACTIVE'];

export interface JourneyStatusDef {
    key: string;
    label: string;
    color: string;
    kind: JourneyKind;
}

export interface JourneyAutoRisk {
    enabled: boolean;
    status: string | null;
    /** Missed each of the batch's last N held classes. 0 = rule off. */
    missed_classes: number;
    /** Membership due date more than X days past. 0 = rule off. */
    fee_overdue_days: number;
    /** Back to the default status once neither rule holds (only for statuses the check set). */
    auto_return: boolean;
}

export interface JourneyStatusSettings {
    enabled: boolean;
    statuses: JourneyStatusDef[];
    default_status: string;
    status_on_pause: string | null;
    status_on_resume: string | null;
    auto_risk: JourneyAutoRisk;
    /** A learner the re-entry flow put on Re-entry goes back to the default status after its date. */
    reentry_auto_return: boolean;
    /** Not saved: true when the institute has ever saved this setting (on or off). */
    configured?: boolean;
}

export const JOURNEY_STATUS_SETTING_KEY = 'JOURNEY_STATUS_SETTING';
export const JOURNEY_STATUS_SETTINGS_QUERY_KEY = 'journey-status-settings';
export const JOURNEY_STATUS_QUERY_KEY = 'journey-status';
const SAVE_SETTING_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

/** Same list the server falls back to (JourneyStatusConfig.defaultStatuses). */
export const DEFAULT_JOURNEY_STATUSES: JourneyStatusDef[] = [
    { key: 'learning', label: 'Learning', color: '#16a34a', kind: 'ACTIVE' }, // design-lint-ignore: user-editable status colour
    { key: 'break_plan', label: 'Break Plan', color: '#0ea5e9', kind: 'BREAK' }, // design-lint-ignore: user-editable status colour
    { key: 'temporary_break', label: 'Temporary Break', color: '#f59e0b', kind: 'BREAK' }, // design-lint-ignore: user-editable status colour
    { key: 'at_risk', label: 'At Risk', color: '#dc2626', kind: 'RISK' }, // design-lint-ignore: user-editable status colour
    { key: 'suspended', label: 'Suspended', color: '#6b7280', kind: 'STOPPED' }, // design-lint-ignore: user-editable status colour
    { key: 'journey_pause', label: 'Journey Pause', color: '#8b5cf6', kind: 'BREAK' }, // design-lint-ignore: user-editable status colour
    { key: 're_entry', label: 'Re-entry', color: '#14b8a6', kind: 'REENTRY' }, // design-lint-ignore: user-editable status colour
];

export const JOURNEY_STATUS_SETTINGS_DEFAULTS: JourneyStatusSettings = {
    enabled: false,
    statuses: DEFAULT_JOURNEY_STATUSES,
    default_status: 'learning',
    status_on_pause: 'temporary_break',
    status_on_resume: 'learning',
    auto_risk: {
        enabled: false,
        status: 'at_risk',
        missed_classes: 3,
        fee_overdue_days: 15,
        auto_return: true,
    },
    reentry_auto_return: true,
};

/** "Temporary Break" → "temporary_break" (the server normalises keys the same way). */
export const toJourneyKey = (label: string): string =>
    label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64);

const withDefaults = (data?: Partial<JourneyStatusSettings> | null): JourneyStatusSettings => {
    const d = JOURNEY_STATUS_SETTINGS_DEFAULTS;
    const statuses = data?.statuses?.length ? data.statuses : d.statuses;
    return {
        ...d,
        ...(data ?? {}),
        statuses,
        auto_risk: { ...d.auto_risk, ...(data?.auto_risk ?? {}) },
    };
};

/** Throws on failure: the Settings page must show an error, not a false "off". */
export const fetchJourneyStatusSettingsStrict = async (): Promise<JourneyStatusSettings> => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) return JOURNEY_STATUS_SETTINGS_DEFAULTS;
    const res = await authenticatedAxiosInstance.get(GET_INSITITUTE_SETTINGS, {
        params: { instituteId, settingKey: JOURNEY_STATUS_SETTING_KEY },
    });
    const data = res.data?.data as Partial<JourneyStatusSettings> | undefined;
    return { ...withDefaults(data), configured: Boolean(data) };
};

export const saveJourneyStatusSettings = async (data: JourneyStatusSettings): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_SETTING_URL,
        {
            setting_name: 'Journey status',
            setting_data: {
                enabled: data.enabled,
                statuses: data.statuses,
                default_status: data.default_status,
                status_on_pause: data.status_on_pause,
                status_on_resume: data.status_on_resume,
                auto_risk: data.auto_risk,
                reentry_auto_return: data.reentry_auto_return,
            },
        },
        { params: { instituteId, settingKey: JOURNEY_STATUS_SETTING_KEY } }
    );
};

/**
 * The gate, read from the server (defaults and invalid entries already resolved there). Any
 * failure reads as "off", so a broken lookup never shows the feature.
 */
export const useJourneyStatusSettings = () => {
    const instituteId = getCurrentInstituteId() || '';
    const query = useQuery({
        queryKey: [JOURNEY_STATUS_SETTINGS_QUERY_KEY, 'gate', instituteId],
        queryFn: async (): Promise<JourneyStatusSettings> => {
            try {
                const res = await authenticatedAxiosInstance.get(JOURNEY_STATUS_SETTINGS, {
                    params: { instituteId },
                });
                return withDefaults(res.data);
            } catch {
                return JOURNEY_STATUS_SETTINGS_DEFAULTS;
            }
        },
        enabled: Boolean(instituteId),
        staleTime: 5 * 60_000,
    });
    const settings = query.data ?? JOURNEY_STATUS_SETTINGS_DEFAULTS;
    return { enabled: Boolean(query.data?.enabled), settings, isLoading: query.isLoading };
};

export const findJourneyStatus = (
    settings: JourneyStatusSettings,
    key?: string | null
): JourneyStatusDef | undefined => settings.statuses.find((s) => s.key === key);

// ── One learner ──────────────────────────────────────────────────────────────

export interface JourneyEnrolment {
    package_session_id: string;
    course_label: string | null;
    access_status: string;
    status_key: string;
    is_default: boolean;
    reason: string | null;
    next_action_date: string | null;
    since: string | null;
    source: string | null;
    updated_by_name: string | null;
    /** A running pause covers this batch (Breaks and holds). */
    on_pause?: boolean;
    /** This row is a temporary extra-class link, not an enrolment of its own. */
    extra_class?: boolean;
}

export interface JourneyHistoryEntry {
    id: string;
    action_type: string;
    actor_name: string | null;
    title: string;
    description: string | null;
    created_at: string;
    from_status: string | null;
    to_status: string | null;
    reason: string | null;
    next_action_date: string | null;
    case_status: string | null;
    source: string;
    package_session_id: string | null;
}

export interface LearnerJourney {
    enabled: boolean;
    enrolments: JourneyEnrolment[];
    history: JourneyHistoryEntry[];
}

export const useLearnerJourney = (userId: string, instituteId: string, enabled: boolean) =>
    useQuery({
        queryKey: [JOURNEY_STATUS_QUERY_KEY, 'learner', userId, instituteId],
        queryFn: async (): Promise<LearnerJourney> => {
            const res = await authenticatedAxiosInstance.get(JOURNEY_STATUS_FOR_LEARNER(userId), {
                params: { instituteId },
            });
            return res.data;
        },
        enabled: enabled && Boolean(userId) && Boolean(instituteId),
        staleTime: 30_000,
    });

export interface SetJourneyStatusRequest {
    /** Learner + batch pairs. A pair without a batch changes every current batch of that learner. */
    items?: { user_id: string; package_session_id?: string | null }[];
    /** Learners: every current batch, or only those in package_session_ids when given. */
    user_ids?: string[];
    package_session_ids?: string[];
    status_key: string;
    reason?: string | null;
    next_action_date?: string | null;
}

export const setJourneyStatus = async (
    instituteId: string,
    body: SetJourneyStatusRequest
): Promise<{ updated: number }> => {
    const res = await authenticatedAxiosInstance.post(JOURNEY_STATUS_SET, body, {
        params: { instituteId },
    });
    return res.data;
};

/** The first status of kind REENTRY: what the re-entry flow sets. */
export const findReentryStatus = (settings: JourneyStatusSettings): JourneyStatusDef | undefined =>
    settings.statuses.find((s) => s.kind === 'REENTRY');

export interface ReentryLink {
    package_session_id: string;
    from: string;
    to: string;
}

export interface StartReentryRequest {
    user_id: string;
    /** The enrolment the learner is coming back to. */
    package_session_id: string;
    reason: string;
    /** Sit in another batch for a while to catch up. */
    extra_class?: ReentryLink | null;
    /** A short catch-up batch. */
    bridge_course?: ReentryLink | null;
    /** Back to the default status after this date. Default: the later last day of the two links. */
    return_on?: string | null;
    /** Resume a running pause on that batch in the same step (else the server refuses). */
    resume_pause?: boolean;
}

export interface StartReentryResponse {
    status_key: string;
    return_on: string | null;
    links: { kind: 'EXTRA_CLASS' | 'BRIDGE_COURSE'; access_id: string; batch: string | null }[];
    resumed_pauses: number;
}

/** Re-entry in one step: status, extra class and bridge course. No fee, no message. */
export const startReentry = async (
    instituteId: string,
    body: StartReentryRequest
): Promise<StartReentryResponse> => {
    const res = await authenticatedAxiosInstance.post(JOURNEY_STATUS_REENTRY, body, {
        params: { instituteId },
    });
    return res.data;
};

// ── Student list ─────────────────────────────────────────────────────────────

export interface JourneyListEntry {
    package_session_id: string;
    status_key: string;
    since: string | null;
    source: string | null;
    reason: string | null;
}

/** Statuses for the learners on the current page: one small query by their user ids. */
export const useJourneyStatusesForUsers = (userIds: string[], enabled: boolean) => {
    const instituteId = getCurrentInstituteId() || '';
    return useQuery({
        queryKey: [JOURNEY_STATUS_QUERY_KEY, 'users', instituteId, userIds],
        queryFn: async (): Promise<Record<string, JourneyListEntry[]>> => {
            const res = await authenticatedAxiosInstance.post(
                JOURNEY_STATUS_FOR_USERS,
                { user_ids: userIds },
                { params: { instituteId } }
            );
            return res.data?.statuses ?? {};
        },
        enabled: enabled && Boolean(instituteId) && userIds.length > 0,
        staleTime: 30_000,
    });
};

/** Current enrolments per status, for the filter chip. */
export const useJourneyStatusCounts = (enabled: boolean) => {
    const instituteId = getCurrentInstituteId() || '';
    return useQuery({
        queryKey: [JOURNEY_STATUS_QUERY_KEY, 'counts', instituteId],
        queryFn: async (): Promise<Record<string, number>> => {
            const res = await authenticatedAxiosInstance.get(JOURNEY_STATUS_COUNTS, {
                params: { instituteId },
            });
            return res.data?.counts ?? {};
        },
        enabled: enabled && Boolean(instituteId),
        staleTime: 60_000,
    });
};

/**
 * The one status the list shows for a learner: the filtered batch's when the list is filtered by
 * batch, else the most severe of their batches. `others` counts the rest, for the tooltip.
 */
export const pickListStatus = (
    entries: JourneyListEntry[] | undefined,
    settings: JourneyStatusSettings,
    filteredBatchIds?: string[]
): { entry: JourneyListEntry; def: JourneyStatusDef | undefined; all: JourneyListEntry[] } | null => {
    if (!entries || entries.length === 0) return null;
    const scoped =
        filteredBatchIds && filteredBatchIds.length > 0
            ? entries.filter((e) => filteredBatchIds.includes(e.package_session_id))
            : entries;
    const pool = scoped.length > 0 ? scoped : entries;
    const rank = (e: JourneyListEntry) => {
        const kind = findJourneyStatus(settings, e.status_key)?.kind ?? 'ACTIVE';
        return JOURNEY_SEVERITY.indexOf(kind);
    };
    const entry = [...pool].sort((a, b) => rank(a) - rank(b))[0]!;
    return { entry, def: findJourneyStatus(settings, entry.status_key), all: entries };
};
