import { useQuery } from '@tanstack/react-query';
import {
    CampaignLeadsRequest,
    CampaignLeadsResponse,
    handleFetchCampaignUsers,
} from '../-services/get-campaign-users';

export const useCampaignUsers = (
    payload: CampaignLeadsRequest,
    options?: { enabled?: boolean }
) => {
    return useQuery<CampaignLeadsResponse>({
        ...handleFetchCampaignUsers(payload),
        enabled: !!payload.audience_id && (options?.enabled ?? true),
    });
};
