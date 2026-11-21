import { useQuery, type QueryKey } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { PANEL_BEARER_BASE, isPanelApiError } from '@/classroom-shared/apiTypes';

/** Base URL of the institute-admin panel endpoints. */
export const PANEL_ADMIN_URL = `${BASE_URL}${PANEL_BEARER_BASE}/admin`;

/**
 * Whether a phase 2 tab is shown. 'loading' and 'off' both keep the tab out of the list,
 * so nothing flickers in and out while the first answer is on its way.
 */
export type TabAvailability = 'loading' | 'on' | 'off';

/**
 * A switched-off feature: FEATURE_OFF (Bearer), PANEL_DISABLED, or a bare 404 from a
 * server that predates the endpoint. Any other failure leaves the tab on, so the tab can
 * show its own error state with a retry.
 */
export function isFeatureOff(error: unknown): boolean {
    const response = (error as { response?: { status?: number; data?: unknown } } | null)?.response;
    if (!response) return false;
    const data = response.data;
    if (isPanelApiError(data) && (data.code === 'FEATURE_OFF' || data.code === 'PANEL_DISABLED')) {
        return true;
    }
    return response.status === 404 && !(isPanelApiError(data) && data.code !== 'NOT_FOUND');
}

export interface FeatureProbe {
    /** A stable prefix, such as ['classroom-panels', 'usage', 'probe', instituteId]. */
    queryKey: QueryKey;
    /** Path under PANEL_ADMIN_URL, e.g. '/licence'. */
    path: string;
    params: Record<string, string>;
}

/** The full React Query key of a probe. A tab that reads the same endpoint can reuse it. */
export function featureProbeKey(probe: FeatureProbe): QueryKey {
    return [...probe.queryKey, probe.path, probe.params];
}

/** One GET, never retried, kept for the session. Off answers are never asked again. */
export function useFeatureProbe(probe: FeatureProbe): TabAvailability {
    const query = useQuery({
        queryKey: [...probe.queryKey, probe.path, probe.params],
        retry: false,
        staleTime: Infinity,
        queryFn: async () =>
            (
                await authenticatedAxiosInstance.get<unknown>(`${PANEL_ADMIN_URL}${probe.path}`, {
                    params: probe.params,
                })
            ).data,
    });
    if (query.isPending) return 'loading';
    if (query.isError) return isFeatureOff(query.error) ? 'off' : 'on';
    return 'on';
}
