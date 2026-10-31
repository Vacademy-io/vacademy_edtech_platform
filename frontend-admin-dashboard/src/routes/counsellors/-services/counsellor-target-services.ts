import type { TFunction } from 'i18next';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    COUNSELLOR_TARGET_BULK,
    COUNSELLOR_TARGET_DELETE,
    COUNSELLOR_TARGET_LIST,
    COUNSELLOR_TARGET_PROGRESS,
    COUNSELLOR_TARGET_UPSERT,
} from '@/constants/urls';

// Admin-set counsellor targets. "Completed" is computed live on the backend, so
// the numbers always agree with the Reports Center.

export type TargetMetric = 'CONVERSIONS' | 'LEADS_ASSIGNED' | 'CALLS_MADE';
export type TargetPeriodType = 'WEEK' | 'MONTH' | 'CUSTOM';

export const TARGET_METRIC_LABEL: Record<TargetMetric, string> = {
    CONVERSIONS: 'Conversions',
    LEADS_ASSIGNED: 'Leads assigned',
    CALLS_MADE: 'Calls made',
};

/** Translated equivalent of {@link TARGET_METRIC_LABEL}, for components rendering these labels to users. */
export function buildTargetMetricLabel(t: TFunction): Record<TargetMetric, string> {
    return {
        CONVERSIONS: t('counsellorsTargetMetrics:conversions'),
        LEADS_ASSIGNED: t('counsellorsTargetMetrics:leadsAssigned'),
        CALLS_MADE: t('counsellorsTargetMetrics:callsMade'),
    };
}

export const TARGET_METRICS: TargetMetric[] = ['CONVERSIONS', 'LEADS_ASSIGNED', 'CALLS_MADE'];

/** One configured target. period_start/period_end are yyyy-MM-dd (CUSTOM only). */
export interface CounsellorTarget {
    id: string;
    counsellor_user_id: string;
    metric: TargetMetric;
    period_type: TargetPeriodType;
    target_value: number;
    period_start?: string | null;
    period_end?: string | null;
}

export interface UpsertTargetPayload {
    institute_id: string;
    counsellor_user_id: string;
    metric: TargetMetric;
    period_type: TargetPeriodType;
    target_value: number;
    period_start?: string;
    period_end?: string;
}

export interface BulkTargetPayload {
    institute_id: string;
    counsellor_user_ids: string[];
    metric: TargetMetric;
    period_type: TargetPeriodType;
    target_value: number;
    period_start?: string;
    period_end?: string;
}

export interface TargetProgressPayload {
    institute_id: string;
    counsellor_user_ids: string[];
    period_type: TargetPeriodType;
    /** Optional for WEEK/MONTH (backend derives current period); required for CUSTOM. */
    from_date?: string;
    to_date?: string;
}

export interface TargetProgressItem {
    metric: TargetMetric;
    /** null when no target set for this metric+period. */
    target_value: number | null;
    completed: number;
    attainment_pct: number | null;
}

export interface TargetProgressRow {
    counsellor_user_id: string;
    items: TargetProgressItem[];
}

export interface TargetProgress {
    period_type: TargetPeriodType;
    from_date: string;
    to_date: string;
    rows: TargetProgressRow[];
}

export async function fetchTargetProgress(payload: TargetProgressPayload) {
    const res = await authenticatedAxiosInstance.post<TargetProgress>(
        COUNSELLOR_TARGET_PROGRESS,
        payload
    );
    return res.data;
}

export async function fetchCounsellorTargets(instituteId: string, counsellorUserId: string) {
    const res = await authenticatedAxiosInstance.get<CounsellorTarget[]>(
        COUNSELLOR_TARGET_LIST(instituteId, counsellorUserId)
    );
    return res.data;
}

export async function upsertCounsellorTarget(payload: UpsertTargetPayload) {
    const res = await authenticatedAxiosInstance.put<CounsellorTarget>(
        COUNSELLOR_TARGET_UPSERT,
        payload
    );
    return res.data;
}

export async function bulkApplyTargets(payload: BulkTargetPayload) {
    await authenticatedAxiosInstance.post(COUNSELLOR_TARGET_BULK, payload);
}

export async function deleteCounsellorTarget(
    targetId: string,
    instituteId: string,
    counsellorUserId: string
) {
    await authenticatedAxiosInstance.delete(
        COUNSELLOR_TARGET_DELETE(targetId, instituteId, counsellorUserId)
    );
}
