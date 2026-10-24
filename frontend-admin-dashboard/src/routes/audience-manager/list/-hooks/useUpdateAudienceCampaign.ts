import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { TFunction } from 'i18next';
import {
    AudienceCampaignPayload,
    getCampaignSaveErrorMessage,
    updateAudienceCampaign,
} from '../-services/create-audience-campaign';

interface UpdateAudienceCampaignParams {
    audienceId: string;
    payload: AudienceCampaignPayload;
}

export function useUpdateAudienceCampaign(t: TFunction) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ audienceId, payload }: UpdateAudienceCampaignParams) =>
            updateAudienceCampaign(audienceId, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['campaignsList'] });
            // Saved tags of the list + the institute's tag autocomplete.
            queryClient.invalidateQueries({ queryKey: ['campaignTags'] });
            queryClient.invalidateQueries({ queryKey: ['campaignTagSummary'] });
            toast.success(t('success.updateCampaign'));
        },
        onError: (error: unknown) => {
            toast.error(getCampaignSaveErrorMessage(error, t('errors.updateCampaign')));
            console.error('useUpdateAudienceCampaign error', error);
        },
    });
}

