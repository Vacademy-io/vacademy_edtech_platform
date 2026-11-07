import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getInstituteId } from '@/constants/helper';
import {
    addEngineAsset,
    deleteEngineAsset,
    listAssets,
    updateEngineAsset,
} from '../-services/assets';
import type { AssetRequest } from '../-types/assets';

const errMsg = (e: unknown, fallback: string): string => {
    const anyErr = e as {
        response?: { data?: { ex?: string; message?: string } };
        message?: string;
    };
    return (
        anyErr?.response?.data?.ex || anyErr?.response?.data?.message || anyErr?.message || fallback
    );
};

export const useAssets = (engineId: string | undefined) => {
    const instituteId = getInstituteId() || '';
    return useQuery({
        queryKey: ['engagementAssets', instituteId, engineId],
        queryFn: () => listAssets(engineId as string, instituteId),
        enabled: !!engineId && !!instituteId,
    });
};

export const useAssetsMutations = (engineId: string) => {
    const { t } = useTranslation('engagementEnginesAssets');
    const qc = useQueryClient();
    const instituteId = getInstituteId() || '';
    const refresh = () =>
        qc.invalidateQueries({ queryKey: ['engagementAssets', instituteId, engineId] });

    const add = useMutation({
        mutationFn: (body: AssetRequest) => addEngineAsset(engineId, instituteId, body),
        onSuccess: () => {
            refresh();
            toast.success(t('toast.added'));
        },
        onError: (e) => toast.error(errMsg(e, t('toast.addFailed'))),
    });
    const update = useMutation({
        mutationFn: ({ assetId, body }: { assetId: string; body: AssetRequest }) =>
            updateEngineAsset(engineId, assetId, instituteId, body),
        onSuccess: () => {
            refresh();
            toast.success(t('toast.updated'));
        },
        onError: (e) => toast.error(errMsg(e, t('toast.updateFailed'))),
    });
    const remove = useMutation({
        mutationFn: (assetId: string) => deleteEngineAsset(engineId, assetId, instituteId),
        onSuccess: () => {
            refresh();
            toast.success(t('toast.removed'));
        },
        onError: (e) => toast.error(errMsg(e, t('toast.removeFailed'))),
    });
    return { add, update, remove };
};
