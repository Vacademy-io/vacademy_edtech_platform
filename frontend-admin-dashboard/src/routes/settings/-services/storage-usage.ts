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
