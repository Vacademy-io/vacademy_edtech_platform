import { ENGAGEMENT_ENGINES_BASE } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

export interface EngineUpdate {
    id: string;
    engineId: string;
    message: string;
    templateName?: string | null;
    startsAt: string;
    endsAt: string;
    status: 'ACTIVE' | 'ENDED';
}

export interface EngineUpdateRequest {
    message: string;
    templateName?: string;
    startsAt?: string;
    endsAt: string;
}

const updatesUrl = (engineId: string) => `${ENGAGEMENT_ENGINES_BASE}/${engineId}/updates`;

export const listEngineUpdates = async (
    engineId: string,
    instituteId: string
): Promise<EngineUpdate[]> => {
    const res = await authenticatedAxiosInstance.get(updatesUrl(engineId), {
        params: { instituteId },
    });
    return res.data;
};

export const createEngineUpdate = async (
    engineId: string,
    instituteId: string,
    body: EngineUpdateRequest
): Promise<EngineUpdate> => {
    const res = await authenticatedAxiosInstance.post(updatesUrl(engineId), body, {
        params: { instituteId },
    });
    return res.data;
};

export const endEngineUpdate = async (
    engineId: string,
    updateId: string,
    instituteId: string
): Promise<EngineUpdate> => {
    const res = await authenticatedAxiosInstance.post(
        `${updatesUrl(engineId)}/${updateId}/end`,
        null,
        { params: { instituteId } }
    );
    return res.data;
};

export type EngineUpdateState = 'live' | 'scheduled' | 'ended';

/** Ended by hand or by its date, whichever the sweep has not caught up with yet. */
export const engineUpdateState = (u: EngineUpdate, now: number = Date.now()): EngineUpdateState => {
    if (u.status !== 'ACTIVE' || new Date(u.endsAt).getTime() <= now) return 'ended';
    return new Date(u.startsAt).getTime() > now ? 'scheduled' : 'live';
};
