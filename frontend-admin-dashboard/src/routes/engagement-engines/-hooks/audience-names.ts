import { useQueries } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import { getCampaignById } from '@/routes/audience-manager/list/-services/get-campaign-by-id';

/**
 * The names of the audience lists an engine is built on, by list id. A list that cannot be read
 * (deleted, no access) has no entry, so callers fall back to a count for it.
 */
export function useAudienceListNames(ids: string[]) {
    const instituteId = getInstituteId() ?? '';
    const results = useQueries({
        queries: ids.map((id) => ({
            queryKey: ['engagementAudienceListName', instituteId, id],
            queryFn: () => getCampaignById(instituteId, id),
            enabled: !!instituteId && !!id,
            staleTime: 5 * 60 * 1000,
            retry: false,
        })),
    });
    const names: Record<string, string> = {};
    ids.forEach((id, i) => {
        const name = results[i]?.data?.campaign_name;
        if (name) names[id] = name;
    });
    return { names, loading: results.some((r) => r.isLoading) };
}
