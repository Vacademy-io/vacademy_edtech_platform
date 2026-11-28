import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    createAudienceCampaign,
    AudienceCampaignPayload,
    getCampaignSaveErrorMessage,
} from '../-services/create-audience-campaign';
import { toast } from 'sonner';
import type { TFunction } from 'i18next';

export function useCreateAudienceCampaign(t: TFunction) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (payload: AudienceCampaignPayload) => createAudienceCampaign(payload),
        onSuccess: () => {
            // refresh relevant lists after creating a campaign
            queryClient.invalidateQueries({ queryKey: ['audienceList'] });
            queryClient.invalidateQueries({ queryKey: ['audiences'] });
            queryClient.invalidateQueries({ queryKey: ['campaignsList'] });
            queryClient.invalidateQueries({ queryKey: ['campaignTagSummary'] });
            toast.success(t('success.createCampaign'));
        },
        onError: (error: unknown) => {
            toast.error(getCampaignSaveErrorMessage(error, t('errors.createCampaign')));
            // optionally log for debugging
            console.error('useCreateAudienceCampaign error', error);
        },
    });
}