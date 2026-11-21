/**
 * Submission review client (phase 1a, contract §5 / §9.1). One function per endpoint;
 * every call goes through the authenticated instance, which adds the `clientId` header.
 * The JSON is snake_case on the wire and is used as-is (see ./types).
 */
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_RELEASE_STUDENT_RESULT, SUBMISSION_REVIEW_BASE } from '@/constants/urls';
import type {
    ApiErrorBody,
    EditMarksRequest,
    EditMarksResponse,
    HistoryResponse,
    MarkingSummary,
    QuestionDetail,
    QuestionRow,
    QuickMarksItem,
    QuickMarksResponse,
    ReleaseCheck,
    ReleaseInfo,
    SubmissionOutline,
} from './types';

const enc = encodeURIComponent;
const submissionUrl = (attemptId: string) => `${SUBMISSION_REVIEW_BASE}/submissions/${enc(attemptId)}`;
const questionUrl = (attemptId: string, sectionId: string, questionId: string) =>
    `${submissionUrl(attemptId)}/questions/${enc(sectionId)}/${enc(questionId)}`;

/** A1: the whole submission, without question text. */
export const getSubmission = async (attemptId: string): Promise<SubmissionOutline> => {
    const response = await authenticatedAxiosInstance({ method: 'GET', url: submissionUrl(attemptId) });
    return response.data as SubmissionOutline;
};

/** A1d: one question's answer, AI verdict and part marks (loaded when a card opens). */
export const getQuestionDetail = async (
    attemptId: string,
    sectionId: string,
    questionId: string
): Promise<QuestionDetail> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: questionUrl(attemptId, sectionId, questionId),
    });
    return response.data as QuestionDetail;
};

/** A2: history, newest first. With a key: that question plus submission-level events. */
export const getHistory = async (
    attemptId: string,
    sectionId?: string,
    questionId?: string,
    limit = 100
): Promise<HistoryResponse> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${submissionUrl(attemptId)}/history`,
        params: {
            ...(sectionId && questionId ? { section_id: sectionId, question_id: questionId } : {}),
            limit,
        },
    });
    return response.data as HistoryResponse;
};

/** A3: set one question's marks (or preview the result with `preview: true`). */
export const editMarks = async (
    attemptId: string,
    sectionId: string,
    questionId: string,
    body: EditMarksRequest
): Promise<EditMarksResponse> => {
    const response = await authenticatedAxiosInstance({
        method: 'PATCH',
        url: questionUrl(attemptId, sectionId, questionId),
        data: body,
    });
    return response.data as EditMarksResponse;
};

/** A3b: Quick marks, many questions in one request (one recompute). */
export const saveQuickMarks = async (
    attemptId: string,
    body: {
        items: QuickMarksItem[];
        reason?: string | null;
        notify_learner?: boolean;
        expected_release: string;
    }
): Promise<QuickMarksResponse> => {
    const response = await authenticatedAxiosInstance({
        method: 'PATCH',
        url: `${submissionUrl(attemptId)}/questions`,
        data: body,
    });
    return response.data as QuickMarksResponse;
};

/** A3p: "This answer is on page 3,4" for a handwritten copy. */
export const setAnswerPages = async (
    attemptId: string,
    sectionId: string,
    questionId: string,
    answerPages: string
): Promise<{ row: QuestionRow }> => {
    const response = await authenticatedAxiosInstance({
        method: 'PUT',
        url: `${questionUrl(attemptId, sectionId, questionId)}/pages`,
        data: { answer_pages: answerPages },
    });
    return response.data as { row: QuestionRow };
};

/**
 * A4: accept AI drafts. An empty key list accepts every draft on the submission.
 * `expectedRevisions` ("sid:qid" → the revision on screen): an AI mark that changed since
 * (a re-check stored a new value) comes back as 409 STALE_REVISION instead of being accepted unseen.
 */
export const acceptAiMarks = async (
    attemptId: string,
    questionKeys: string[],
    expectedRelease: string,
    expectedRevisions?: Record<string, number>
): Promise<{ accepted: number; rows: QuestionRow[]; release: ReleaseInfo }> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${submissionUrl(attemptId)}/accept-ai`,
        data: {
            question_keys: questionKeys,
            expected_release: expectedRelease,
            ...(expectedRevisions ? { expected_revisions: expectedRevisions } : {}),
        },
    });
    return response.data as { accepted: number; rows: QuestionRow[]; release: ReleaseInfo };
};

/** A6: re-mark one objective answer with the answer key. */
export const reapplyAnswerKey = async (
    attemptId: string,
    sectionId: string,
    questionId: string,
    body: { force?: boolean; reason?: string | null; expected_release: string }
): Promise<{
    row: QuestionRow;
    total_before: number;
    total_after: number;
    max_total: number | null;
    release: ReleaseInfo;
}> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${questionUrl(attemptId, sectionId, questionId)}/reapply-key`,
        data: { force: false, reason: null, ...body },
    });
    return response.data;
};

export interface ReleaseSubmissionResponse {
    released: boolean;
    release: ReleaseInfo;
    release_when_marked?: boolean;
    accepted_ai_drafts?: number;
    notified?: boolean;
}

/** A8: release one learner's result (409 BLOCKERS lists unmarked answers). */
export const releaseSubmission = async (
    attemptId: string,
    body: {
        notify?: boolean;
        allow_unmarked?: boolean;
        release_when_marked?: boolean;
        expected_release?: string | null;
    }
): Promise<ReleaseSubmissionResponse> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${submissionUrl(attemptId)}/release`,
        data: { notify: true, allow_unmarked: false, release_when_marked: false, ...body },
    });
    return response.data as ReleaseSubmissionResponse;
};

/** A9: hide a released result again. */
export const withdrawResult = async (
    attemptId: string,
    reason?: string | null
): Promise<{ release: ReleaseInfo }> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${submissionUrl(attemptId)}/withdraw`,
        data: { reason: reason ?? null },
    });
    return response.data as { release: ReleaseInfo };
};

/** A9b: send the learner the updated result (one email). */
export const sendUpdatedResult = async (
    attemptId: string
): Promise<{ release: ReleaseInfo; queued: boolean }> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${submissionUrl(attemptId)}/send-update`,
        data: {},
    });
    return response.data as { release: ReleaseInfo; queued: boolean };
};

/** A10: counts for the Submissions list (summary, plus one entry per listed attempt). */
export const getMarkingSummary = async (
    assessmentId: string,
    attemptIds?: string[]
): Promise<MarkingSummary> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${SUBMISSION_REVIEW_BASE}/assessments/${enc(assessmentId)}/marking-summary`,
        params: attemptIds && attemptIds.length > 0 ? { attempt_ids: attemptIds.join(',') } : {},
    });
    return response.data as MarkingSummary;
};

/** A11: classify a release selection (ready / unmarked / AI checking / drafts / released). */
export const getReleaseCheck = async (
    assessmentId: string,
    attemptIds: string[] | 'ALL'
): Promise<ReleaseCheck> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${SUBMISSION_REVIEW_BASE}/assessments/${enc(assessmentId)}/release-check`,
        data:
            attemptIds === 'ALL'
                ? { attempt_ids: [], all: true }
                : { attempt_ids: attemptIds, all: false },
    });
    return response.data as ReleaseCheck;
};

export interface ReleaseW9Options {
    skip_unready: boolean;
    skip_already_released: boolean;
    allow_unmarked: boolean;
    release_when_marked: boolean;
}

/**
 * W9: the existing release-result endpoint with the opt-in flags (contract §6.1). A list of
 * ids goes as ENTIRE_ASSESSMENT_PARTICIPANTS; the whole test ('ALL') as ASSESSMENT_ALL,
 * which is what the toolbar sent before, so not-submitted attempts keep today's handling.
 */
export const releaseResultW9 = async (
    assessmentId: string,
    instituteId: string | undefined,
    attemptIds: string[] | 'ALL',
    opts: ReleaseW9Options
): Promise<unknown> => {
    const all = attemptIds === 'ALL';
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: GET_RELEASE_STUDENT_RESULT,
        params: {
            assessmentId,
            instituteId,
            methodType: all ? 'ASSESSMENT_ALL' : 'ENTIRE_ASSESSMENT_PARTICIPANTS',
        },
        data: { attempt_ids: all ? [] : attemptIds, ...opts },
    });
    return response?.data;
};

/** The `{code, message, details}` body of a submission-review 4xx, or null. */
export const parseApiError = (e: unknown): ApiErrorBody | null => {
    const data = (e as { response?: { data?: unknown } } | null)?.response?.data;
    if (!data || typeof data !== 'object') return null;
    const body = data as Partial<ApiErrorBody>;
    if (typeof body.code !== 'string') return null;
    return {
        code: body.code,
        message: typeof body.message === 'string' ? body.message : '',
        details:
            body.details && typeof body.details === 'object'
                ? (body.details as Record<string, unknown>)
                : undefined,
    };
};

/** HTTP status of a failed request (for 403s, which keep the global body). */
export const httpStatusOf = (e: unknown): number | null =>
    (e as { response?: { status?: number } } | null)?.response?.status ?? null;
