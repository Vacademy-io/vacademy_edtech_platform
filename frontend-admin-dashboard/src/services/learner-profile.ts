import { LEARNER_PROFILE_BASE } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

export type LearnerSignalKind =
    | 'STRENGTH'
    | 'WEAKNESS'
    | 'MISCONCEPTION'
    | 'GOAL'
    | 'PREFERENCE'
    | 'INTEREST';

/** One observation the Student AI made about a learner (learner_profile_signal). */
export interface LearnerProfileSignal {
    id: number;
    source: string;
    kind: LearnerSignalKind;
    topic: string | null;
    detail: string;
    confidence: number | null;
    stated: boolean;
    evidenceQuote: string | null;
    evidenceSessionId: string | null;
    status: string;
    /** Epoch millis. */
    observedAt: number | null;
}

/** Institute comes from the clientId header the axios instance attaches. */
export const getLearnerProfileSignals = async (userId: string): Promise<LearnerProfileSignal[]> => {
    const response = await authenticatedAxiosInstance.get<LearnerProfileSignal[]>(
        `${LEARNER_PROFILE_BASE}/users/${encodeURIComponent(userId)}/signals`
    );
    return response.data ?? [];
};

export const dismissLearnerProfileSignal = async (signalId: number): Promise<void> => {
    await authenticatedAxiosInstance.post(`${LEARNER_PROFILE_BASE}/signals/${signalId}/dismiss`);
};
