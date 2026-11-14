import { useQuery } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import { getAssessmentSettings } from '@/services/assessment-settings';
import { DEFAULT_EVALEZY_SETTINGS, mergeEvalezySettings } from '@/types/assessment-settings';

/**
 * The institute's Evalezy switches (Settings → Assessment → Evalezy app), read
 * fresh when the shell opens so turning Evalezy off takes effect on next open.
 * A failed read falls back to the defaults (getAssessmentSettings never throws).
 */
export const useEvalezySettings = () => {
    const instituteId = getInstituteId() ?? '';
    const query = useQuery({
        queryKey: ['EVALEZY_SETTINGS', instituteId],
        queryFn: async () => mergeEvalezySettings((await getAssessmentSettings(true)).evalezy),
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
    });
    return {
        settings: query.data ?? DEFAULT_EVALEZY_SETTINGS,
        isLoading: query.isLoading,
    };
};
