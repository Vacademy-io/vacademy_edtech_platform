/**
 * One-off charges.
 *
 * Staff add a single extra charge (title, amount, due date, optional batch, staff note) to one
 * learner. Each charge is an ordinary admin invoice, so the learner pays it online on the invoice
 * page and it shows in the learner's invoices and account summary. Adding or cancelling one sends
 * the learner no message.
 *
 * Hidden unless the institute switches on Settings → One-off charges (ONE_OFF_DUE_SETTING.enabled).
 */
import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    GET_INSITITUTE_SETTINGS,
    ONE_OFF_DUES_BASE,
    ONE_OFF_DUES_FOR_LEARNER,
    ONE_OFF_DUE_CANCEL,
} from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

export type OneOffDueStatus = 'DUE' | 'PAID' | 'CANCELLED';

export interface OneOffDue {
    id: string;
    user_id: string;
    title: string;
    amount: number;
    currency: string | null;
    due_date: string;
    status: OneOffDueStatus;
    invoice_id: string | null;
    invoice_number: string | null;
    package_session_id: string | null;
    course_label: string | null;
    note: string | null;
    source_type: string | null;
    source_id: string | null;
    created_by: string | null;
    created_at: string | null;
    cancelled_at: string | null;
    cancel_reason: string | null;
}

export interface LearnerOneOffDues {
    enabled: boolean;
    default_currency: string | null;
    courses: { package_session_id: string; course_label: string }[];
    dues: OneOffDue[];
}

export interface OneOffDueRequest {
    user_id: string;
    package_session_id: string | null;
    amount: number;
    due_date: string;
    title: string;
    note: string | null;
}

export const ONE_OFF_DUES_QUERY_KEY = 'one-off-dues';

export const useLearnerOneOffDues = (userId: string, instituteId: string, enabled: boolean) =>
    useQuery({
        queryKey: [ONE_OFF_DUES_QUERY_KEY, 'learner', userId, instituteId],
        queryFn: async (): Promise<LearnerOneOffDues> => {
            const res = await authenticatedAxiosInstance.get(ONE_OFF_DUES_FOR_LEARNER(userId), {
                params: { instituteId },
            });
            return res.data;
        },
        enabled: enabled && Boolean(userId) && Boolean(instituteId),
        staleTime: 30_000,
    });

export const createOneOffDue = async (
    instituteId: string,
    body: OneOffDueRequest
): Promise<OneOffDue> => {
    const res = await authenticatedAxiosInstance.post(ONE_OFF_DUES_BASE, body, {
        params: { instituteId },
    });
    return res.data;
};

export const cancelOneOffDue = async (
    instituteId: string,
    dueId: string,
    reason: string | null
): Promise<OneOffDue> => {
    const res = await authenticatedAxiosInstance.post(
        ONE_OFF_DUE_CANCEL(dueId),
        { reason },
        { params: { instituteId } }
    );
    return res.data;
};

// ── Institute switch ─────────────────────────────────────────────────────────

export const ONE_OFF_DUE_SETTING_KEY = 'ONE_OFF_DUE_SETTING';
export const ONE_OFF_DUE_SETTINGS_QUERY_KEY = 'one-off-due-settings';
const SAVE_SETTING_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

export interface OneOffDueSettings {
    enabled: boolean;
    /** Not saved: true when the institute has ever saved this setting (on or off). */
    configured?: boolean;
}

export const ONE_OFF_DUE_SETTINGS_DEFAULTS: OneOffDueSettings = { enabled: false };

/** Throws on failure: the Settings page must show an error, not a false "off". */
export const fetchOneOffDueSettingsStrict = async (): Promise<OneOffDueSettings> => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) return ONE_OFF_DUE_SETTINGS_DEFAULTS;
    const res = await authenticatedAxiosInstance.get(GET_INSITITUTE_SETTINGS, {
        params: { instituteId, settingKey: ONE_OFF_DUE_SETTING_KEY },
    });
    const data = res.data?.data as Partial<OneOffDueSettings> | undefined;
    return { ...ONE_OFF_DUE_SETTINGS_DEFAULTS, ...(data ?? {}), configured: Boolean(data) };
};

/** For the gate only: any failure reads as "off", so a broken lookup never shows the feature. */
export const fetchOneOffDueSettings = async (): Promise<OneOffDueSettings> => {
    try {
        return await fetchOneOffDueSettingsStrict();
    } catch {
        return ONE_OFF_DUE_SETTINGS_DEFAULTS;
    }
};

export const saveOneOffDueSettings = async (data: OneOffDueSettings): Promise<void> => {
    const instituteId = getCurrentInstituteId();
    await authenticatedAxiosInstance.post(
        SAVE_SETTING_URL,
        { setting_name: 'One-off charges', setting_data: { enabled: data.enabled } },
        { params: { instituteId, settingKey: ONE_OFF_DUE_SETTING_KEY } }
    );
};

/** The gate: the one-off charges card renders nothing unless the institute has saved the setting. */
export const useOneOffDueSettings = () => {
    const query = useQuery({
        queryKey: [ONE_OFF_DUE_SETTINGS_QUERY_KEY, 'gate'],
        queryFn: fetchOneOffDueSettings,
        staleTime: 5 * 60_000,
    });
    return {
        enabled: Boolean(query.data?.enabled),
        configured: Boolean(query.data?.configured),
        isLoading: query.isLoading,
    };
};
