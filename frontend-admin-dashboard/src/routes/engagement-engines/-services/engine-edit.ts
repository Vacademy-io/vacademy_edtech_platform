import { ENGAGEMENT_ENGINES_BASE } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type { CreateEngineRequest, EngagementEngine } from '../-types';

/** Edit an engine's settings. The brief is not part of this — it grows by amendments. */
export const updateEngine = async (
    engineId: string,
    instituteId: string,
    payload: Omit<CreateEngineRequest, 'brief'>
): Promise<EngagementEngine> => {
    const res = await authenticatedAxiosInstance.put(`${ENGAGEMENT_ENGINES_BASE}/${engineId}`, payload, {
        params: { instituteId },
    });
    return res.data;
};

/** Archive (default) from any state, or delete permanently an engine that never reached anyone. */
export const deleteEngine = async (engineId: string, instituteId: string, permanent: boolean): Promise<void> => {
    await authenticatedAxiosInstance.delete(`${ENGAGEMENT_ENGINES_BASE}/${engineId}`, {
        params: { instituteId, permanent },
    });
};
