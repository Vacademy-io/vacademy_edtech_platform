import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getInstituteId } from '@/constants/helper';
import { deleteEngine, updateEngine } from '../-services/engine-edit';
import type { CreateEngineRequest } from '../-types';

/** A VacademyException body carries its text in `ex`. */
const errMsg = (e: unknown, fallback: string): string => {
    const anyErr = e as { response?: { data?: { ex?: string; message?: string } }; message?: string };
    return anyErr?.response?.data?.ex || anyErr?.response?.data?.message || anyErr?.message || fallback;
};

export const useUpdateEngine = () => {
    const { t } = useTranslation('engagementEnginesEdit');
    const qc = useQueryClient();
    const instituteId = getInstituteId() || '';
    return useMutation({
        mutationFn: ({ engineId, payload }: { engineId: string; payload: Omit<CreateEngineRequest, 'brief'> }) =>
            updateEngine(engineId, instituteId, payload),
        onSuccess: (_d, v) => {
            qc.invalidateQueries({ queryKey: ['engagementEngine', instituteId, v.engineId] });
            qc.invalidateQueries({ queryKey: ['engagementEngines', instituteId] });
            toast.success(t('toast.saved'));
        },
        onError: (e) => toast.error(errMsg(e, t('toast.saveFailed'))),
    });
};

export const useDeleteEngine = () => {
    const { t } = useTranslation('engagementEnginesEdit');
    const qc = useQueryClient();
    const instituteId = getInstituteId() || '';
    return useMutation({
        mutationFn: ({ engineId, permanent }: { engineId: string; permanent: boolean }) =>
            deleteEngine(engineId, instituteId, permanent),
        onSuccess: (_d, v) => {
            qc.invalidateQueries({ queryKey: ['engagementEngines', instituteId] });
            qc.invalidateQueries({ queryKey: ['engagementEngine', instituteId, v.engineId] });
            toast.success(v.permanent ? t('toast.deleted') : t('toast.archived'));
        },
        onError: (e) => toast.error(errMsg(e, t('toast.deleteFailed'))),
    });
};
