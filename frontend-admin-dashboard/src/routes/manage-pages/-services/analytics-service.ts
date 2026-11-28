import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { CATALOGUE_ANALYTICS_SUMMARY } from '@/constants/urls';

/** One point on the trend line. */
export interface DailyPoint {
    day: string;
    views: number;
    visitors: number;
}

export interface NamedCount {
    name: string;
    views: number;
    visitors: number;
}

export interface CatalogueAnalytics {
    views: number;
    visitors: number;
    sessions: number;
    leads: number;
    daily: DailyPoint[];
    pages: NamedCount[];
    sources: NamedCount[];
}

/**
 * First-party traffic for one institute's catalogue sites.
 *
 * The server scopes this to the caller's own institutes, so passing an
 * instituteId the admin does not belong to fails rather than leaking.
 */
export const getCatalogueAnalytics = async (
    instituteId: string,
    days = 30
): Promise<CatalogueAnalytics> => {
    const response = await authenticatedAxiosInstance.get<CatalogueAnalytics>(
        CATALOGUE_ANALYTICS_SUMMARY(instituteId, days)
    );
    return response.data;
};
