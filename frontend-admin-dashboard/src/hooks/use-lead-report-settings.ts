/**
 * useLeadReportSettings — reads the report-engine config subtree persisted at
 * LEAD_SETTING.data.reports:
 *
 *   { "timezone": "Asia/Kolkata",
 *     "connected_call_statuses": ["COMPLETED"],
 *     "interested_status_keys": ["INTERESTED"] }
 *
 * Mirrors the backend defaults in
 * admin_core_service/.../features/audience/service/LeadReportSettingService.java —
 * timezone Asia/Kolkata, connected = ["COMPLETED"], interested = ["INTERESTED"].
 *
 * Read-only: the Settings card (LeadReportSettings.tsx) owns the write path and
 * read-modify-writes the WHOLE LEAD_SETTING data object so sibling keys
 * (enabled, scoringWeights, workbench, …) are never clobbered.
 */
import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL, GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

// ── Telephony call statuses ──────────────────────────────────────────────────

/**
 * Hardcoded mirror of the backend enum at
 * admin_core_service/src/main/java/vacademy/io/admin_core_service/features/telephony/enums/CallStatus.java
 * — keep in sync when the enum changes (the FE has no endpoint exposing it).
 */
export const TELEPHONY_CALL_STATUSES = [
    'INITIATED',
    'QUEUED',
    'COUNSELLOR_RINGING',
    'COUNSELLOR_ANSWERED',
    'IN_PROGRESS',
    'COMPLETED',
    'NO_ANSWER',
    'BUSY',
    'FAILED',
    'CANCELLED',
] as const;
export type TelephonyCallStatus = (typeof TELEPHONY_CALL_STATUSES)[number];

/** "NO_ANSWER" → "No answer" — display labels for CALL_STATUS keys. */
export function humanizeCallStatus(status: string): string {
    const lower = status.toLowerCase().replace(/_/g, ' ');
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// ── Types ────────────────────────────────────────────────────────────────────

/** Raw snake_case subtree persisted at LEAD_SETTING.data.reports (backend contract). */
export interface LeadReportSettingsSubtree {
    timezone?: string;
    connected_call_statuses?: string[];
    interested_status_keys?: string[];
    /** Course tags in priority order (Admissions report main course). */
    course_group_order?: string[];
    /** Custom field the Admissions report breaks admissions down by. */
    admission_field_id?: string | null;
}

export interface LeadReportSettings {
    /** IANA timezone applied to all day/hour bucketing in report SQL. */
    timezone: string;
    /** CALL_STATUS values that count as a "connected" call. */
    connectedCallStatuses: string[];
    /** Lead-status keys that count as "interested" in funnel/source reports. */
    interestedStatusKeys: string[];
    /**
     * Course tags in priority order. A student who joined courses from several groups at once
     * is counted once in the Admissions report, under the group that comes first.
     */
    courseGroupOrder: string[];
    /** Custom field (e.g. Branch) the Admissions report breaks admissions down by. */
    admissionFieldId: string | null;
}

export const LEAD_REPORT_SETTINGS_DEFAULTS: LeadReportSettings = {
    timezone: 'Asia/Kolkata',
    connectedCallStatuses: ['COMPLETED'],
    interestedStatusKeys: ['INTERESTED'],
    courseGroupOrder: [],
    admissionFieldId: null,
};

// ── Fetchers ─────────────────────────────────────────────────────────────────

const SETTING_KEY = 'LEAD_SETTING';

export const LEAD_REPORT_SETTINGS_QUERY_KEY = ['lead-report-settings'];

/**
 * Fetches the FULL raw LEAD_SETTING data object (all sibling keys included).
 * Used by the settings card to read-modify-write without clobbering siblings.
 */
export async function fetchLeadSettingRawData(): Promise<Record<string, unknown>> {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) return {};
    const response = await authenticatedAxiosInstance.get(GET_INSITITUTE_SETTINGS, {
        params: { instituteId, settingKey: SETTING_KEY },
    });
    // GET returns the SettingDto itself ({key, name, data}), NOT a map keyed by
    // settingKey — response.data IS the SettingDto, so its content is one level
    // down at response.data.data (matches the working precedent in
    // services/user-identifier-setting.ts: `response.data?.data`). An extra
    // `?.[SETTING_KEY]` here always resolved to undefined, so every read
    // silently fell back to {} regardless of what was actually saved.
    return (response.data?.data ?? {}) as Record<string, unknown>;
}

function withDefaults(subtree: LeadReportSettingsSubtree | undefined): LeadReportSettings {
    return {
        timezone: subtree?.timezone || LEAD_REPORT_SETTINGS_DEFAULTS.timezone,
        connectedCallStatuses:
            subtree?.connected_call_statuses && subtree.connected_call_statuses.length > 0
                ? subtree.connected_call_statuses
                : LEAD_REPORT_SETTINGS_DEFAULTS.connectedCallStatuses,
        interestedStatusKeys:
            subtree?.interested_status_keys && subtree.interested_status_keys.length > 0
                ? subtree.interested_status_keys
                : LEAD_REPORT_SETTINGS_DEFAULTS.interestedStatusKeys,
        courseGroupOrder: subtree?.course_group_order ?? [],
        admissionFieldId: subtree?.admission_field_id || null,
    };
}

export async function fetchLeadReportSettings(): Promise<LeadReportSettings> {
    try {
        const raw = await fetchLeadSettingRawData();
        return withDefaults(raw['reports'] as LeadReportSettingsSubtree | undefined);
    } catch {
        return LEAD_REPORT_SETTINGS_DEFAULTS;
    }
}

/** Course tags and custom fields the Admissions settings can pick from. */
export interface AdmissionReportOptions {
    course_tags: string[];
    fields: { id: string; name: string; type: string }[];
}

export async function fetchAdmissionReportOptions(): Promise<AdmissionReportOptions> {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) return { course_tags: [], fields: [] };
    const { data } = await authenticatedAxiosInstance.get(
        `${BASE_URL}/admin-core-service/v1/reports/admissions/options`,
        { params: { instituteId } }
    );
    return data;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns the institute's report settings, falling back to the platform
 * defaults on error / missing config so callers never handle undefined.
 */
export function useLeadReportSettings(options?: { skip?: boolean }): {
    settings: LeadReportSettings;
    isLoading: boolean;
} {
    const { data, isLoading } = useQuery({
        queryKey: LEAD_REPORT_SETTINGS_QUERY_KEY,
        queryFn: fetchLeadReportSettings,
        staleTime: 5 * 60 * 1000, // settings change rarely
        gcTime: 10 * 60 * 1000,
        enabled: !options?.skip,
    });
    return { settings: data ?? LEAD_REPORT_SETTINGS_DEFAULTS, isLoading };
}
