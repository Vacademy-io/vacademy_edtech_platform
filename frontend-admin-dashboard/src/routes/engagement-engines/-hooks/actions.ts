import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getInstituteId } from '@/constants/helper';
import {
    approveCrmTask,
    getEngineActions,
    getLeadAutomation,
    saveEngineActions,
    setLeadAutomation,
    undoCrmTask,
} from '../-services/actions';
import type { CrmActionSetting } from '../-types/actions';

/** A VacademyException body carries its text in `ex`. */
const errMsg = (e: unknown, fallback: string): string => {
    const anyErr = e as { response?: { data?: { ex?: string; message?: string } }; message?: string };
    return anyErr?.response?.data?.ex || anyErr?.response?.data?.message || anyErr?.message || fallback;
};

/** Approve or undo a CRM action task in the inbox. */
export const useCrmTaskAction = () => {
    const { t } = useTranslation('engagementEnginesActions');
    const qc = useQueryClient();
    const instituteId = getInstituteId() || '';
    return useMutation({
        mutationFn: ({ taskId, verb }: { taskId: string; verb: 'approve' | 'undo' }) =>
            verb === 'approve' ? approveCrmTask(taskId, instituteId) : undoCrmTask(taskId, instituteId),
        onSuccess: (data, vars) => {
            qc.invalidateQueries({ queryKey: ['engagementTasks'] });
            // Graduation per action type moves with every approval.
            qc.invalidateQueries({ queryKey: ['engagementEngineActions'] });
            if (vars.verb === 'undo') {
                toast.success(t('inbox.undoneToast'));
            } else if (data?.kind === 'SEND' && data?.status === 'OPEN') {
                toast.success(t('inbox.scheduledToast'));
            } else {
                toast.success(t('inbox.approvedToast'));
            }
        },
        onError: (e, vars) => {
            // A refused action is back in the inbox with its reason; refresh so it shows.
            qc.invalidateQueries({ queryKey: ['engagementTasks'] });
            toast.error(errMsg(e, vars.verb === 'undo' ? t('inbox.undoFailed') : t('inbox.approveFailed')));
        },
    });
};

export const useEngineActions = (engineId: string) => {
    const instituteId = getInstituteId() || '';
    return useQuery({
        queryKey: ['engagementEngineActions', instituteId, engineId],
        queryFn: () => getEngineActions(engineId, instituteId),
        enabled: !!instituteId && !!engineId,
    });
};

export const useSaveEngineActions = (engineId: string) => {
    const { t } = useTranslation('engagementEnginesActions');
    const qc = useQueryClient();
    const instituteId = getInstituteId() || '';
    return useMutation({
        mutationFn: (actions: CrmActionSetting[]) => saveEngineActions(engineId, instituteId, actions),
        onSuccess: (data) => {
            qc.setQueryData(['engagementEngineActions', instituteId, engineId], data);
            // channels changed: the engine detail reads them too.
            qc.invalidateQueries({ queryKey: ['engagementEngine'] });
            toast.success(t('panel.saved'));
        },
        onError: (e) => toast.error(errMsg(e, t('panel.saveFailed'))),
    });
};

export const useLeadAutomation = (leadId?: string | null) => {
    const instituteId = getInstituteId() || '';
    return useQuery({
        queryKey: ['engagementLeadAutomation', instituteId, leadId],
        queryFn: () => getLeadAutomation(leadId as string, instituteId),
        enabled: !!instituteId && !!leadId,
    });
};

export const useSetLeadAutomation = (leadId: string) => {
    const { t } = useTranslation('engagementEnginesActions');
    const qc = useQueryClient();
    const instituteId = getInstituteId() || '';
    return useMutation({
        mutationFn: (doNotAutomate: boolean) => setLeadAutomation(leadId, instituteId, doNotAutomate),
        onSuccess: (data) => {
            qc.setQueryData(['engagementLeadAutomation', instituteId, leadId], data);
            toast.success(data.doNotAutomate ? t('lead.onToast') : t('lead.offToast'));
        },
        onError: (e) => toast.error(errMsg(e, t('lead.saveFailed'))),
    });
};
