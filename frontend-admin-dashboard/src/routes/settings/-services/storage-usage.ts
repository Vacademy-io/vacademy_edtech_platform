import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { useQuery } from '@tanstack/react-query';

export const STORAGE_USAGE_URL = `${BASE_URL}/admin-core-service/institute/v1/usage/storage-bandwidth`;

export interface CategoryUsage {
    /** RECORDING | VIDEO | AUDIO | DOCUMENT | IMAGE | OTHER */
    category: string;
    bytes: number;
    /** Files for storage, requests for bandwidth. */
    count: number;
}

export interface DailyPoint {
    date: string;
    bytes: number;
}

/** The institute's own storage (nightly snapshot) and bandwidth (summed per day). */
export interface InstituteStorageUsage {
    institute_id: string;
    storage_as_of: string | null;
    storage_bytes: number;
    storage_objects: number;
    storage_by_category: CategoryUsage[];
    storage_trend: DailyPoint[];
    bandwidth_tracking_since: string | null;
    bandwidth_month: string;
    bandwidth_month_bytes: number;
    bandwidth_month_requests: number;
    bandwidth_month_by_category: CategoryUsage[];
    bandwidth_daily: DailyPoint[];
    bandwidth_monthly: { month: string; bytes: number }[];
    /** This month against the institute's plan; null when it has no storage/bandwidth plan. */
    allowance?: AllowanceStatus | null;
    /** Last month against the plan; null when it has none. */
    allowance_previous_month?: AllowanceStatus | null;
}

/**
 * One month against the institute's storage and bandwidth plan. Storage is the month's
 * average stored (nightly snapshots), bandwidth the month's total. Charges in `currency`.
 */
export interface AllowanceStatus {
    month: string;
    included_storage_gb: number;
    included_bandwidth_gb: number;
    storage_rate_per_gb: number;
    bandwidth_rate_per_gb: number;
    currency: string;
    storage_snapshot_days: number;
    storage_average_bytes: number;
    storage_extra_bytes: number;
    bandwidth_bytes: number;
    bandwidth_extra_bytes: number;
    storage_charge: number;
    bandwidth_charge: number;
    total_charge: number;
}

export function useInstituteStorageUsage(instituteId: string | undefined) {
    return useQuery({
        queryKey: ['institute-storage-usage', instituteId],
        enabled: !!instituteId,
        staleTime: 10 * 60 * 1000, // the numbers change once a night
        queryFn: async () => {
            const { data } = await authenticatedAxiosInstance.get<InstituteStorageUsage>(STORAGE_USAGE_URL, {
                params: { instituteId },
            });
            return data;
        },
    });
}
