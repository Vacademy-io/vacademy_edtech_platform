import {
    SUBMIT_MARKS,
    GET_RELEASE_STUDENT_RESULT,
    SAVE_EVALUATION_DRAFT,
    GET_EVALUATION_DRAFT,
    DELETE_EVALUATION_DRAFT,
} from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';

interface SubimtRequest {
    set_id: string;
    file_id: string;
    data_json: string;
    request: {
        section_id: string;
        question_id: string;
        status: string;
        marks: number;
        evaluator_feedback?: string;
    }[];
}

export const submitEvlauationMarks = async (
    assessmentId: string,
    instituteId: string,
    attemptId: string,
    data: SubimtRequest
) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${SUBMIT_MARKS}`,
        params: {
            assessmentId,
            instituteId,
            attemptId,
        },
        data,
    });
    return response?.data;
};

// The full editable evaluator state persisted as a draft. `annotations` is the
// per-page Fabric.js JSON (kept raw so ticks stay editable on resume — never a
// flattened PDF); the rest mirrors the marks/timer stores + viewer position.
export interface EvaluationDraftState {
    version: 1;
    annotations: Record<number, unknown>;
    marksData: {
        section_id: string;
        question_id: string;
        status: string;
        marks: number;
    }[];
    feedbackByQuestion: Record<string, string>;
    elapsedSeconds: number;
    pageNumber: number;
    pagesVisited: number[];
    savedAt: string;
    // Per-page view rotation (0/90/180/270) the evaluator applied to read a
    // sideways/upside-down scan, plus the annotation canvas size that was in
    // effect when each page's marks were captured — both optional so drafts
    // saved before this existed still restore cleanly.
    pageRotations?: Record<number, number>;
    pageCanvasDims?: Record<number, { width: number; height: number }>;
}

export interface EvaluationDraftDto {
    draft_json: string;
    updated_at: string;
    attempt_id?: string;
}

// Upsert the current in-progress evaluation for this attempt (per evaluator).
export const saveEvaluationDraft = async (
    assessmentId: string,
    instituteId: string | undefined,
    attemptId: string,
    draft: EvaluationDraftState
) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${SAVE_EVALUATION_DRAFT}`,
        params: { assessmentId, instituteId, attemptId },
        data: { draft_json: JSON.stringify(draft) },
    });
    return response?.data;
};

// Fetch this evaluator's saved draft for an attempt. Returns null when none exists.
export const getEvaluationDraft = async (
    attemptId: string
): Promise<EvaluationDraftState | null> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${GET_EVALUATION_DRAFT}`,
        params: { attemptId },
    });
    const dto = response?.data as EvaluationDraftDto | null;
    if (!dto?.draft_json) return null;
    try {
        const state = JSON.parse(dto.draft_json) as EvaluationDraftState;
        // Prefer the server's authoritative save time for the "restored from" hint.
        if (dto.updated_at) state.savedAt = dto.updated_at;
        return state;
    } catch {
        return null;
    }
};

// Discard the draft (e.g. when the evaluator chooses "start fresh").
export const deleteEvaluationDraft = async (attemptId: string) => {
    const response = await authenticatedAxiosInstance({
        method: 'DELETE',
        url: `${DELETE_EVALUATION_DRAFT}`,
        params: { attemptId },
    });
    return response?.data;
};

// Release the result for a single attempt so the learner sees it immediately
// after the admin submits a manual evaluation.
export const releaseEvaluationResult = async (
    assessmentId: string,
    instituteId: string | undefined,
    attemptId: string
) => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${GET_RELEASE_STUDENT_RESULT}`,
        params: {
            assessmentId,
            instituteId,
            methodType: 'ENTIRE_ASSESSMENT_PARTICIPANTS',
        },
        data: { attempt_ids: [attemptId] },
    });
    return response?.data;
};
