import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import type { CampaignItem, CampaignListResponse } from '../-services/get-campaigns-list';
import { getCampaignById } from '../-services/get-campaign-by-id';

const idOf = (c: CampaignItem) => c.campaign_id || c.id || c.audience_id || '';

export const listCampaignKey = (instituteId: string, campaignId: string) =>
    ['list-share-campaign', instituteId, campaignId] as const;

/**
 * One lead list's own record (name, status, type, dates, form fields) for the
 * list page. Seeded from the Lead Lists cache when the page was opened from
 * there, so it is fetched only when that cache is missing or old.
 */
export function useListCampaign(campaignId: string) {
    const queryClient = useQueryClient();
    const instituteId = getCurrentInstituteId() || '';

    const fromListCache = (): { item: CampaignItem; updatedAt: number } | undefined => {
        const queries = queryClient.getQueryCache().findAll({ queryKey: ['campaignsList'] });
        for (const q of queries) {
            const data = q.state.data as CampaignListResponse | undefined;
            const hit = data?.content?.find((c) => idOf(c) === campaignId);
            if (hit) return { item: hit, updatedAt: q.state.dataUpdatedAt };
        }
        return undefined;
    };

    return useQuery({
        queryKey: listCampaignKey(instituteId, campaignId),
        queryFn: () => getCampaignById(instituteId, campaignId),
        enabled: !!instituteId && !!campaignId,
        staleTime: 5 * 60 * 1000,
        initialData: () => fromListCache()?.item,
        initialDataUpdatedAt: () => fromListCache()?.updatedAt,
    });
}
