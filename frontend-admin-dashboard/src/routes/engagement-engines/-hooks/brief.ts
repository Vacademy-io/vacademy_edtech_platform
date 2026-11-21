import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getInstituteId } from '@/constants/helper';
import { generateBrief, getLeadAgentBriefs, type BriefDraftRequest } from '../-services/brief';

/** A VacademyException body carries its text in `ex`. */
const errMsg = (e: unknown, fallback: string): string => {
    const anyErr = e as { response?: { data?: { ex?: string; message?: string } }; message?: string };
    return anyErr?.response?.data?.ex || anyErr?.response?.data?.message || anyErr?.message || fallback;
};

/** The Lead Agents behind the picked lead lists (none for lists no agent fills). */
export const useLeadAgentBriefs = (audienceIds: string[], enabled = true) => {
    const instituteId = getInstituteId() || '';
    const ids = [...audienceIds].sort();
    return useQuery({
        queryKey: ['engagementLeadAgentBriefs', instituteId, ids],
        queryFn: () => getLeadAgentBriefs(instituteId, ids),
        enabled: enabled && ids.length > 0 && !!instituteId,
        staleTime: 60 * 1000,
    });
};

/** "Generate with AI" for the brief. */
export const useGenerateBrief = () => {
    const { t } = useTranslation('engagementEnginesCreateIndex');
    const instituteId = getInstituteId() || '';
    return useMutation({
        mutationFn: (body: BriefDraftRequest) => generateBrief(instituteId, body),
        onError: (e) => toast.error(errMsg(e, t('basics.ai.failed'))),
    });
};
