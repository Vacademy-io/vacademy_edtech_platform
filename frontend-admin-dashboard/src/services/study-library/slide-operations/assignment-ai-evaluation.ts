import {
    ASSIGNMENT_AI_EVALUATION_BULK,
    GET_ASSIGNMENT_AI_EVALUATION,
    TRIGGER_ASSIGNMENT_AI_EVALUATION,
} from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

export type AssignmentAiEvaluationStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

/** One AI check of an assignment copy. Marks here are a suggestion until the grade is saved. */
export interface AssignmentAiEvaluation {
    id: string;
    tracked_id: string;
    status: AssignmentAiEvaluationStatus;
    current_step: string | null;
    max_marks: number | null;
    marks_awarded: number | null;
    feedback: string | null;
    evaluated_file_id: string | null;
    error_message: string | null;
    created_at: string;
    updated_at: string;
}

/** "Check all with AI": what it would cover (each learner's latest submission) and the last batch. */
export interface AssignmentAiBulk {
    submissions: number;
    to_check: number;
    already_graded: number;
    already_ai_checked: number;
    in_progress: number;
    no_files: number;
    total_marks_set: boolean;
    latest_batch: {
        batch_id: string;
        total: number;
        pending: number;
        completed: number;
        failed: number;
        done: boolean;
        created_at: string;
    } | null;
}

/** Checks one submission with the grader's default model. */
export const triggerAssignmentAiEvaluation = async (
    trackedId: string
): Promise<AssignmentAiEvaluation> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: TRIGGER_ASSIGNMENT_AI_EVALUATION,
        params: { instituteId: getInstituteId() },
        data: { tracked_id: trackedId },
    });
    return response.data;
};

/** The latest check of a submission, or null when it was never checked. */
export const fetchAssignmentAiEvaluation = async (
    trackedId: string
): Promise<AssignmentAiEvaluation | null> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_ASSIGNMENT_AI_EVALUATION,
        params: { trackedId, instituteId: getInstituteId() },
    });
    return response.data || null;
};

export const fetchAssignmentAiBulk = async (
    slideId: string,
    packageSessionId: string | undefined,
    includeChecked: boolean
): Promise<AssignmentAiBulk> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: ASSIGNMENT_AI_EVALUATION_BULK,
        params: { slideId, packageSessionId, includeChecked, instituteId: getInstituteId() },
    });
    return response.data;
};

/** Queues every unchecked submitted copy; the teacher is notified once when all are done. */
export const triggerAssignmentAiBulk = async (
    slideId: string,
    packageSessionId: string | undefined,
    includeChecked: boolean
): Promise<AssignmentAiBulk> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: ASSIGNMENT_AI_EVALUATION_BULK,
        params: { instituteId: getInstituteId() },
        data: {
            slide_id: slideId,
            package_session_id: packageSessionId,
            include_checked: includeChecked,
        },
    });
    return response.data;
};
