import { COPY_ASSESSMENT_URL } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type { DuplicateAssessmentPayload } from '../-components/duplicate/duplicate-assessment-form';

/** The draft the copy created. */
export interface DuplicateAssessmentResult {
    assessment_id: string;
    name: string;
    play_mode: string;
    status: string;
    section_count: number;
    question_count: number;
    batch_count: number;
    participant_count: number;
}

export const duplicateAssessment = async (
    assessmentId: string,
    instituteId: string | undefined,
    payload: DuplicateAssessmentPayload
): Promise<DuplicateAssessmentResult> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: COPY_ASSESSMENT_URL,
        params: { assessmentId, instituteId },
        data: payload,
    });
    return response.data;
};
