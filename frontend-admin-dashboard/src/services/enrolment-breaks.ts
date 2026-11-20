/**
 * Breaks and holds (docs/ENROLMENT_BREAKS.md).
 *
 * A HOLD stops class and/or fee reminders for a learner until a date; nothing else changes.
 * A PAUSE also stops charging, renewal and expiry, can switch the course off, and moves the
 * membership dates forward when the learner comes back.
 *
 * The whole feature is hidden unless the institute switches on Settings → Breaks and holds
 * (ENROLMENT_BREAK_SETTING.enabled); `useEnrolmentBreakSettings` is the gate.
 */
import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    ENROLMENT_BREAKS_FOR_LEARNER,
    ENROLMENT_BREAK_BY_ID,
    ENROLMENT_BREAK_CANCEL,
    ENROLMENT_BREAK_END,
    ENROLMENT_BREAK_END_PREVIEW,
    ENROLMENT_BREAK_PREVIEW,
    ENROLMENT_BREAKS_BASE,
    GET_INSITITUTE_SETTINGS,
} from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

export type BreakKind = 'HOLD' | 'PAUSE';
export type BreakStatus = 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';
export type ResumeMode = 'SHIFT_BY_PAUSED_DAYS' | 'KEEP_DATES' | 'NEW_DATE';

export interface BreakCourse {
    package_session_id: string;
    course_label: string;
    access_status: string;
    access_expiry: string | null;
    user_plan_id: string | null;
    plan_status: string | null;
    plan_end_date: string | null;
    next_charge_at: string | null;
    autopay: boolean;
    payment_type: string | null;
    unpaid_instalments: number;
}

export interface EnrolmentBreak {
    id: string;
    user_id: string;
    kind: BreakKind;
    status: BreakStatus;
    package_session_id: string | null;
    course_label: string | null;
    user_plan_id: string | null;
    stop_class_reminders: boolean;
    stop_fee_reminders: boolean;
    remove_access: boolean;
    starts_on: string;
    ends_on: string | null;
    reason: string | null;
    note: string | null;
    days_so_far: number | null;
    end_kind: string | null;
    resume_mode: ResumeMode | null;
    shifted_days: number | null;
    plan_end_before: string | null;
    plan_end_after: string | null;
    started_at: string | null;
    ended_at: string | null;
    created_at: string | null;
}

export interface LearnerBreaks {
    enabled: boolean;
    today: string;
    courses: BreakCourse[];
    breaks: EnrolmentBreak[];
}

export interface BreakRequest {
    user_id: string;
    kind: BreakKind;
    package_session_id: string | null;
    stop_class_reminders: boolean;
    stop_fee_reminders: boolean;
    remove_access: boolean;
    starts_on: string;
    ends_on: string | null;
    reason: string | null;
    note: string | null;
}

export interface BreakPreview {
    kind: BreakKind;
    course_label: string | null;
    starts_on: string;
    ends_on: string | null;
    starts_today: boolean;
    days: number | null;
    paused_days: number | null;
    stop_class_reminders: boolean;
    stop_fee_reminders: boolean;
    remove_access: boolean;
    stop_billing: boolean;
    plan_end_now: string | null;
    plan_end_after: string | null;
    next_charge_now: string | null;
    next_charge_after: string | null;
    unpaid_instalments_moved: number;
    blockers: string[];
    warnings: string[];
}

export interface EndBreakRequest {
    resume_mode: ResumeMode;
    new_end_date?: string | null;
    move_unpaid_instalments?: boolean;
    note?: string | null;
}

export const ENROLMENT_BREAKS_QUERY_KEY = 'enrolment-breaks';

/** Everything the learner panel shows; refetch after any change. */
export const useLearnerBreaks = (userId: string, instituteId: string, enabled: boolean) =>
    useQuery({
        queryKey: [ENROLMENT_BREAKS_QUERY_KEY, 'learner', userId, instituteId],
        queryFn: async (): Promise<LearnerBreaks> => {
            const res = await authenticatedAxiosInstance.get(ENROLMENT_BREAKS_FOR_LEARNER(userId), {
                params: { instituteId },
            });
            return res.data;
        },
        enabled: enabled && Boolean(userId) && Boolean(instituteId),
        staleTime: 30_000,
    });

export const previewBreak = async (
    instituteId: string,
    body: BreakRequest
): Promise<BreakPreview> => {
    const res = await authenticatedAxiosInstance.post(ENROLMENT_BREAK_PREVIEW, body, {
        params: { instituteId },
    });
    return res.data;
};

export const createBreak = async (
    instituteId: string,
    body: BreakRequest
): Promise<EnrolmentBreak> => {
    const res = await authenticatedAxiosInstance.post(ENROLMENT_BREAKS_BASE, body, {
        params: { instituteId },
    });
    return res.data;
};

export const updateBreak = async (
    instituteId: string,
    breakId: string,
    body: { ends_on: string | null; open_ended: boolean; note: string | null }
): Promise<EnrolmentBreak> => {
    const res = await authenticatedAxiosInstance.put(ENROLMENT_BREAK_BY_ID(breakId), body, {
        params: { instituteId },
    });
    return res.data;
};

export const previewEndBreak = async (
    instituteId: string,
    breakId: string,
    body: EndBreakRequest
): Promise<BreakPreview> => {
    const res = await authenticatedAxiosInstance.post(ENROLMENT_BREAK_END_PREVIEW(breakId), body, {
        params: { instituteId },
    });
    return res.data;
};

export const endBreak = async (
    instituteId: string,
    breakId: string,
    body: EndBreakRequest
): Promise<EnrolmentBreak> => {
    const res = await authenticatedAxiosInstance.post(ENROLMENT_BREAK_END(breakId), body, {
        params: { instituteId },
    });
    return res.data;
};

export const cancelBreak = async (
    instituteId: string,
    breakId: string
): Promise<EnrolmentBreak> => {
    const res = await authenticatedAxiosInstance.post(ENROLMENT_BREAK_CANCEL(breakId), null, {
        params: { instituteId },
    });
    return res.data;
};

// ── Institute switch ─────────────────────────────────────────────────────────

export const ENROLMENT_BREAK_SETTING_KEY = 'ENROLMENT_BREAK_SETTING';
export const ENROLMENT_BREAK_SETTINGS_QUERY_KEY = 'enrolment-break-settings';
const SAVE_SETTING_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

export interface EnrolmentBreakSettings {
    enabled: boolean;
    /** Not saved: true when the institute has ever saved this setting (on or off). */
    configured?: boolean;
}

export const ENROLMENT_BREAK_SETTINGS_DEFAULTS: EnrolmentBreakSettings = { enabled: false };

/** Throws on failure: the Settings page must show an error, not a false "off". */
export const fetchEnrolmentBreakSettingsStrict = async (): Promise<EnrolmentBreakSettings> => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) return ENROLMENT_BREAK_SETTINGS_DEFAULTS;
    const res = await authenticatedAxiosInstance.get(GET_INSITITUTE_SETTINGS, {
        params: { instituteId, settingKey: ENROLMENT_BREAK_SETTING_KEY },
    });
    // GET returns the SettingDto ({key, name, data}); the content is at .data.
    const data = res.data?.data as Partial<EnrolmentBreakSettings> | undefined;
    return { ...ENROLMENT_BREAK_SETTINGS_DEFAULTS, ...(data ?? {}), configured: Boolean(data) };
};

/** For the gate only: any failure reads as "off", so a broken lookup never shows the feature. */
export const fetchEnrolmentBreakSettings = async (): Promise<EnrolmentBreakSettings> => {
    try {
        return await fetchEnrolmentBreakSettingsStrict();
    } catch {
        return ENROLMENT_BREAK_SETTINGS_DEFAULTS;
    }
};

export const saveEnrolmentBreakSettings = async (data: EnrolmentBreakSettings): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_SETTING_URL,
        { setting_name: 'Breaks and holds', setting_data: { enabled: data.enabled } },
        { params: { instituteId, settingKey: ENROLMENT_BREAK_SETTING_KEY } }
    );
};

/** The gate: every breaks-and-holds UI renders nothing unless this says enabled. */
export const useEnrolmentBreakSettings = () => {
    const query = useQuery({
        queryKey: [ENROLMENT_BREAK_SETTINGS_QUERY_KEY, 'gate'],
        queryFn: fetchEnrolmentBreakSettings,
        staleTime: 5 * 60_000,
    });
    return {
        enabled: Boolean(query.data?.enabled),
        /** Ever saved (on or off): only then can breaks exist, so only then is the card loaded. */
        configured: Boolean(query.data?.configured),
        isLoading: query.isLoading,
    };
};
