import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { PROCTORING_ATTEMPT_REVIEW_URL, PROCTORING_SUMMARIES_URL } from '@/constants/urls';
import type { ProctoringConfigWire } from '@/types/assessments/proctoring';

export type ProctorEventSeverity = 'INFO' | 'WARN' | 'FLAG';

export interface ProctorEvent {
    id: string;
    event_type: string;
    severity: ProctorEventSeverity | string;
    occurred_at: string;
    received_at?: string | null;
    evidence_file_id?: string | null;
    meta?: Record<string, unknown> | null;
}

export interface AttemptProctorReview {
    attempt_id: string;
    config: ProctoringConfigWire;
    flag_count: number;
    warn_count: number;
    snapshot_count: number;
    counts_by_type: Record<string, number>;
    events: ProctorEvent[];
}

export interface AttemptProctorSummary {
    attempt_id: string;
    flag_count: number;
    warn_count: number;
}

export const getAttemptProctorReview = async (
    attemptId: string,
    instituteId: string | undefined
): Promise<AttemptProctorReview> => {
    const response = await authenticatedAxiosInstance.get(
        `${PROCTORING_ATTEMPT_REVIEW_URL}/${attemptId}`,
        { params: { instituteId } }
    );
    return response.data;
};

export const getAttemptProctorSummaries = async (
    assessmentId: string,
    instituteId: string | undefined,
    attemptIds: string[]
): Promise<AttemptProctorSummary[]> => {
    if (attemptIds.length === 0) return [];
    const response = await authenticatedAxiosInstance.post(PROCTORING_SUMMARIES_URL, attemptIds, {
        params: { assessmentId, instituteId },
    });
    return response.data ?? [];
};
