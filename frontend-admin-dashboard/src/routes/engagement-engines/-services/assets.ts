import { ENGAGEMENT_ENGINES_BASE } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type { EngineAsset, AssetRequest } from '../-types/assets';

const assetsUrl = (engineId: string) => `${ENGAGEMENT_ENGINES_BASE}/${engineId}/assets`;

export const listAssets = async (engineId: string, instituteId: string): Promise<EngineAsset[]> => {
    const res = await authenticatedAxiosInstance.get(assetsUrl(engineId), {
        params: { instituteId },
    });
    return res.data;
};

export const addEngineAsset = async (
    engineId: string,
    instituteId: string,
    body: AssetRequest
): Promise<EngineAsset> => {
    const res = await authenticatedAxiosInstance.post(assetsUrl(engineId), body, {
        params: { instituteId },
    });
    return res.data;
};

export const updateEngineAsset = async (
    engineId: string,
    assetId: string,
    instituteId: string,
    body: AssetRequest
): Promise<EngineAsset> => {
    const res = await authenticatedAxiosInstance.put(`${assetsUrl(engineId)}/${assetId}`, body, {
        params: { instituteId },
    });
    return res.data;
};

export const deleteEngineAsset = async (
    engineId: string,
    assetId: string,
    instituteId: string
): Promise<void> => {
    await authenticatedAxiosInstance.delete(`${assetsUrl(engineId)}/${assetId}`, {
        params: { instituteId },
    });
};
