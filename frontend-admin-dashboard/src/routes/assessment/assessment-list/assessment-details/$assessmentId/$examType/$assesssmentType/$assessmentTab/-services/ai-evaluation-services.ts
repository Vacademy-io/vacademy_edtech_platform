import {
    BASE_URL,
    GET_COMPLETED_QUESTIONS_URL,
    GET_EVALUATION_PROCESSES_URL,
    GET_EVALUATION_PROGRESS_URL,
    REVIEW_EVALUATION_URL,
    STOP_EVALUATION_URL,
    TRIGGER_EVALUATION_URL,
} from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

// Types
export interface TriggerEvaluationRequest {
    attempt_ids: string[];
    preferred_model?: string;
}

export interface TriggerEvaluationResponse {
    processIds: string[];
}

export interface CriteriaBreakdown {
    criteria_name: string;
    marks: number;
    reason: string;
}

export type AnnotationStyle =
    | 'tick'
    | 'cross'
    | 'circle'
    | 'strike'
    | 'underline'
    | 'margin_note'
    | 'region_note';

export interface QuestionAnnotation {
    target: string;
    page_id: string;
    style: AnnotationStyle;
    text?: string;
}

export interface EvaluationDetailsJson {
    marks_awarded: number;
    feedback: string;
    extracted_answer: string;
    criteria_breakdown: CriteriaBreakdown[];
    annotations?: QuestionAnnotation[];
    confidence?: number;
}

export interface QuestionProgress {
    question_id: string;
    question_number: number;
    status: 'PENDING' | 'COMPLETED' | 'FAILED';
    marks_awarded?: number;
    max_marks?: number | null;
    feedback?: string;
    extracted_answer?: string;
    evaluation_details_json?: EvaluationDetailsJson;
    annotations?: QuestionAnnotation[];
    rubric_version?: number;
    /** Why automatic grading failed (exception class + message) — set only on
     *  FAILED questions, admin-facing. */
    error_detail?: string | null;
    is_edited?: boolean;
    started_at?: string;
    completed_at?: string;
}

export interface ParticipantDetails {
    name: string;
    username: string;
    email: string;
    institute_id: string;
    user_id: string;
}

export interface EvaluationProgress {
    attempt_id: string;
    evaluation_process_id: string;
    participant_details: ParticipantDetails;
    assessment_id: string;
    overall_status:
        | 'STARTED'
        | 'PROCESSING'
        | 'EXTRACTING'
        | 'EVALUATING'
        | 'COMPLETED'
        | 'FAILED'
        | 'CANCELLED';
    current_step: 'PROCESSING' | 'EXTRACTION' | 'GRADING';
    progress: {
        completed: number;
        total: number;
        percentage: number;
    };
    completed_questions: QuestionProgress[];
    pending_questions: QuestionProgress[];
    /** The checked copy THIS run rendered (marks drawn into the PDF), from the
     *  run's own complete payload — null while in flight, or when the run produced
     *  no copy. Not the attempt's latest evaluated_file_id. */
    file_id?: string | null;
    layout_map_url?: string | null;
    rubric_version?: number | null;
    ai_service_job_id?: string | null;
}

/**
 * Trigger AI evaluation for one or more student attempts
 * @param attempt_ids - Array of student attempt IDs
 * @param preferred_model - AI model the teacher explicitly picked. Omit it and no
 *   `preferred_model` is sent: the platform's "evaluation" use-case default applies.
 * @returns Array of process IDs for tracking evaluation progress
 */
export const triggerAIEvaluation = async (
    attempt_ids: string[],
    preferred_model?: string
): Promise<string[]> => {
    const data: TriggerEvaluationRequest = { attempt_ids };
    if (preferred_model) data.preferred_model = preferred_model;
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: TRIGGER_EVALUATION_URL,
        data,
    });

    return response?.data || [];
};

/**
 * Get evaluation progress for a specific process
 * @param processId - Process ID returned from trigger evaluation
 * @returns Evaluation progress with completed and pending questions
 */
export const getEvaluationProgress = async (processId: string): Promise<EvaluationProgress> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${GET_EVALUATION_PROGRESS_URL}/${processId}`,
    });

    return response?.data;
};

/**
 * Get only completed questions for a process (lighter payload)
 * @param processId - Process ID returned from trigger evaluation
 * @returns Array of completed questions
 */
export const getCompletedQuestions = async (processId: string): Promise<QuestionProgress[]> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${GET_COMPLETED_QUESTIONS_URL}/${processId}`,
    });

    return response?.data || [];
};

/**
 * Fetch the persisted LayoutMap JSON for an evaluation. URL comes from
 * EvaluationProgress.layout_map_url, which the backend returns as a relative
 * path (e.g. "/assessment-service/copy-check/layout/<id>"). Prefix BASE_URL
 * so the request hits the backend origin in production rather than the FE
 * origin (which would 404).
 */
export const getLayoutMap = async (layoutMapUrl: string): Promise<unknown> => {
    const fullUrl = layoutMapUrl.startsWith('http')
        ? layoutMapUrl
        : `${BASE_URL}${layoutMapUrl}`;
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: fullUrl,
    });
    return response?.data;
};

/**
 * Stop an ongoing evaluation process
 * @param processId - Process ID to stop
 * @returns Success response
 */
export const stopEvaluation = async (processId: string): Promise<void> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${STOP_EVALUATION_URL}/${processId}`,
    });

    return response?.data;
};

/**
 * React Query hook for triggering AI evaluation
 */
export const useTriggerAIEvaluation = () => {
    return {
        mutationKey: ['TRIGGER_AI_EVALUATION'],
        mutationFn: ({
            attempt_ids,
            preferred_model,
        }: {
            attempt_ids: string[];
            preferred_model?: string;
        }) => triggerAIEvaluation(attempt_ids, preferred_model),
    };
};

/**
 * React Query hook for getting evaluation progress
 */
export const useGetEvaluationProgress = (processId: string, enabled: boolean = true) => {
    return {
        queryKey: ['EVALUATION_PROGRESS', processId],
        queryFn: () => getEvaluationProgress(processId),
        enabled: !!processId && enabled,
        refetchInterval: 2000, // Poll every 2 seconds while evaluating
        staleTime: 0, // Always consider stale to get fresh data
    };
};

/**
 * React Query hook for getting completed questions
 */
export const useGetCompletedQuestions = (processId: string, enabled: boolean = true) => {
    return {
        queryKey: ['COMPLETED_QUESTIONS', processId],
        queryFn: () => getCompletedQuestions(processId),
        enabled: !!processId && enabled,
        refetchInterval: 2000, // Poll every 2 seconds
        staleTime: 0,
    };
};

/**
 * React Query mutation for stopping evaluation
 */
export const useStopEvaluation = () => {
    return {
        mutationKey: ['STOP_EVALUATION'],
        mutationFn: (processId: string) => stopEvaluation(processId),
    };
};

export interface EvaluationProcessSummary {
    process_id: string;
    attempt_id: string;
    participant_name?: string | null;
    status: string;
    questions_completed?: number | null;
    questions_total?: number | null;
    needs_review_count?: number | null;
    started_at?: string | null;
    completed_at?: string | null;
}

/**
 * List every AI-evaluation run for an assessment (evaluations dashboard). Lets a
 * teacher find a running/failed run again after navigating away — no longer
 * dependent on localStorage.
 */
export const getEvaluationProcesses = async (
    assessmentId: string
): Promise<EvaluationProcessSummary[]> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: GET_EVALUATION_PROCESSES_URL,
        params: { assessmentId },
    });
    return response?.data ?? [];
};

/**
 * Teacher review: override a single question's marks and/or feedback before the
 * result is released. Turns the AI verdict into a draft the teacher approves.
 */
export const overrideQuestionEvaluation = async (
    processId: string,
    questionId: string,
    payload: { marks_awarded: number; feedback?: string }
): Promise<void> => {
    const response = await authenticatedAxiosInstance({
        method: 'PUT',
        url: `${REVIEW_EVALUATION_URL}/${processId}/question/${questionId}`,
        data: payload,
    });
    return response?.data;
};

export interface EvaluationData {
    processId: string;
    attemptId: string;
    assessmentId: string;
    sectionIds: string[];
}

export const storeEvaluationDataInStorage = (data: EvaluationData) => {
    const stored = localStorage.getItem('TRIGGERED_EVALUATIONS');
    const triggeredEvaluations: EvaluationData[] = stored ? JSON.parse(stored) : [];
    triggeredEvaluations.push(data);
    localStorage.setItem('TRIGGERED_EVALUATIONS', JSON.stringify(triggeredEvaluations));
};

export const getEvaluationDataFromStorage = () => {
    const stored = localStorage.getItem('TRIGGERED_EVALUATIONS');
    return stored ? JSON.parse(stored) : [];
};

export const removeEvaluationDataFromStorage = (processId: string) => {
    const stored = localStorage.getItem('TRIGGERED_EVALUATIONS');
    const triggeredEvaluations: EvaluationData[] = stored ? JSON.parse(stored) : [];
    const updatedProcessIds = triggeredEvaluations.filter((data) => data.processId !== processId);
    localStorage.setItem('TRIGGERED_EVALUATIONS', JSON.stringify(updatedProcessIds));
};
