import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { COPY_INTAKE_BASE_URL } from '@/constants/urls';
import type { CommentPlacement, CopyCheckConfig } from '@/types/assessment-settings';

/**
 * Bulk AI copy-check: many scanned copies uploaded at once, the student's
 * name read off each sheet, matched to the assessment's students, and the
 * checks queued. Copies the reader could not place wait for a person here.
 */

export type CopyIntakeBatchStatus = 'RUNNING' | 'NEEDS_REVIEW' | 'COMPLETED' | 'FAILED';
/**
 * UPLOAD = PDFs the admin uploaded, matched to students; SUBMITTED = the learners'
 * own uploads (nothing to match); CHECK_ONLY = uploaded only to be checked and
 * downloaded, never matched to a student or shown as a submission.
 */
export type CopyIntakeSource = 'UPLOAD' | 'SUBMITTED' | 'CHECK_ONLY';
export type CopyIntakeItemStatus =
    | 'PENDING'
    | 'IDENTIFYING'
    | 'MATCHED'
    | 'AMBIGUOUS'
    | 'UNMATCHED'
    | 'QUEUED'
    | 'EVALUATING'
    | 'COMPLETED'
    | 'FAILED'
    | 'SKIPPED';

export interface CopyIntakeCandidate {
    user_id: string | null;
    registration_id: string | null;
    name: string | null;
    roll_number: string | null;
    email: string | null;
    batch_id: string | null;
    score: number | null;
}

export interface CopyIntakeItem {
    id: string;
    file_id: string;
    file_name: string | null;
    page_count: number | null;
    status: CopyIntakeItemStatus;
    extracted_name: string | null;
    extracted_roll: string | null;
    extracted_class: string | null;
    extract_confidence: number | null;
    match_score: number | null;
    matched_user_id: string | null;
    matched_name: string | null;
    registration_id: string | null;
    attempt_id: string | null;
    process_id: string | null;
    error_message: string | null;
    candidates: CopyIntakeCandidate[];
    updated_at: string | null;
}

export interface CopyIntakeBatch {
    id: string;
    assessment_id: string;
    status: CopyIntakeBatchStatus;
    /** Absent on batches older than the field; treat as UPLOAD. */
    source?: CopyIntakeSource;
    total_items: number;
    /** Copies whose header has been read. */
    identified: number;
    matched: number;
    ambiguous: number;
    unmatched: number;
    /** Waiting for a slot with the AI service. */
    queued: number;
    /** With the AI service right now. */
    evaluating: number;
    evaluated: number;
    failed: number;
    skipped: number;
    /** Still moving on its own (read, match, queue, check). */
    in_progress: number;
    created_by: string | null;
    created_by_name: string | null;
    email_status: string | null;
    created_at: string;
    completed_at: string | null;
    error_message: string | null;
    items?: CopyIntakeItem[];
}

export interface CopyIntakeUploadedFile {
    file_id: string;
    file_name: string;
    page_count?: number;
}

export type { CommentPlacement };

export const startCopyIntake = async (
    assessmentId: string,
    instituteId: string,
    files: CopyIntakeUploadedFile[],
    preferredModel?: string,
    notifyEmail = true,
    /** null = leave the assessment's own choice as it is. */
    commentPlacement: CommentPlacement | null = 'INSIDE',
    copyCheckConfig?: CopyCheckConfig,
    /** false = only check the copies (no student matching); they come back in the zip. */
    mapStudents = true
): Promise<CopyIntakeBatch> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${COPY_INTAKE_BASE_URL}/start`,
        params: { assessmentId, instituteId },
        data: {
            files,
            preferred_model: preferredModel,
            notify_email: notifyEmail,
            comment_placement: commentPlacement ?? undefined,
            copy_check_config: copyCheckConfig,
            map_students: mapStudents,
        },
    });
    return response.data;
};

/** How the AI checks this assessment's copies, as last sent with a batch. */
export const getCopyCheckConfig = async (
    assessmentId: string,
    instituteId: string
): Promise<CopyCheckConfig> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${COPY_INTAKE_BASE_URL}/copy-check-config`,
        params: { assessmentId, instituteId },
    });
    return response.data ?? {};
};

/** What a check of the learners' own submissions would do, before any credit is spent. */
export interface SubmittedCheckPreview {
    considered: number;
    with_copy: number;
    already_checked: number;
    in_progress: number;
    no_copy: number;
    to_check: number;
    attempt_ids: string[];
}

export interface SubmittedCheckRequest {
    /** Checked rows; empty/undefined = every submitted copy on the assessment. */
    attempt_ids?: string[];
    /** Also re-check copies the AI has already checked. */
    include_checked?: boolean;
    preferred_model?: string;
    notify_email?: boolean;
    comment_placement?: CommentPlacement;
    /** Subject, marking instructions and language feedback for this check. */
    copy_check_config?: CopyCheckConfig;
}

export const previewSubmittedCheck = async (
    assessmentId: string,
    instituteId: string,
    request: SubmittedCheckRequest
): Promise<SubmittedCheckPreview> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${COPY_INTAKE_BASE_URL}/submitted/preview`,
        params: { assessmentId, instituteId },
        data: request,
    });
    return response.data;
};

/**
 * Queue the AI check for copies the learners submitted themselves, as one
 * batch: items start on their student, the poller paces the checks, and the
 * batch panel / one email announce the result.
 */
export const startSubmittedCheck = async (
    assessmentId: string,
    instituteId: string,
    request: SubmittedCheckRequest
): Promise<CopyIntakeBatch> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${COPY_INTAKE_BASE_URL}/submitted/start`,
        params: { assessmentId, instituteId },
        data: request,
    });
    return response.data;
};

export const listCopyIntakeBatches = async (
    assessmentId: string,
    instituteId: string
): Promise<CopyIntakeBatch[]> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${COPY_INTAKE_BASE_URL}/batches`,
        params: { assessmentId, instituteId },
    });
    return response.data ?? [];
};

// Every batch / item call carries instituteId: the server binds the upload to
// the caller's institute the way the single copy-check endpoints do.
export const getCopyIntakeBatch = async (
    batchId: string,
    instituteId: string
): Promise<CopyIntakeBatch> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${COPY_INTAKE_BASE_URL}/batch/${batchId}`,
        params: { instituteId },
    });
    return response.data;
};

/** One checked copy of a batch (AI check done, checked copy rendered). */
export interface CopyIntakeCheckedCopy {
    item_id: string;
    file_name: string | null;
    student_name: string | null;
    roll: string | null;
    evaluated_file_id: string;
}

/** Every checked copy of the batch, in upload order — for "Download checked copies". */
export const listCheckedCopies = async (
    batchId: string,
    instituteId: string
): Promise<CopyIntakeCheckedCopy[]> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${COPY_INTAKE_BASE_URL}/batch/${batchId}/checked-copies`,
        params: { instituteId },
    });
    return response.data ?? [];
};

export const resolveCopyIntakeItem = async (
    itemId: string,
    instituteId: string,
    pick: {
        registration_id?: string | null;
        user_id?: string | null;
        full_name?: string | null;
        email?: string | null;
        batch_id?: string | null;
    }
): Promise<CopyIntakeItem> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${COPY_INTAKE_BASE_URL}/item/${itemId}/resolve`,
        params: { instituteId },
        data: pick,
    });
    return response.data;
};

export const skipCopyIntakeItem = async (
    itemId: string,
    instituteId: string
): Promise<CopyIntakeItem> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${COPY_INTAKE_BASE_URL}/item/${itemId}/skip`,
        params: { instituteId },
    });
    return response.data;
};

/**
 * Try a failed copy again. `answerLanguage` (a code such as "hi") is the
 * teacher's "Check in <language>" for a copy that stopped because it is
 * written in another language than its question paper.
 */
export const retryCopyIntakeItem = async (
    itemId: string,
    instituteId: string,
    answerLanguage?: string
): Promise<CopyIntakeItem> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${COPY_INTAKE_BASE_URL}/item/${itemId}/retry`,
        params: answerLanguage ? { instituteId, answerLanguage } : { instituteId },
    });
    return response.data;
};

/** ai_service's code for a copy written in another language than its paper. */
export const LANGUAGE_CONFIRM_CODE = 'language_needs_confirmation';

export type LanguageConfirmation = { code: string; language: string; paper: string };

/**
 * The language a failed copy is waiting to be confirmed in, read from its
 * error ("language_needs_confirmation: This copy is written in Hindi [hi]
 * but the question paper is in English. ..."); null for any other copy.
 */
export const languageConfirmationOf = (item: {
    status: string;
    error_message?: string | null;
}): LanguageConfirmation | null => {
    if (item.status !== 'FAILED' || !item.error_message?.startsWith(LANGUAGE_CONFIRM_CODE))
        return null;
    const m = item.error_message.match(
        /written in (.+?) \[([a-z]{2,3})\] but the question paper is in (.+?)\./
    );
    if (!m) return null;
    return { language: m[1]!, code: m[2]!, paper: m[3]! };
};

/** Nothing in the batch moves on its own any more. */
export const isCopyIntakeSettled = (status: CopyIntakeBatchStatus) =>
    status === 'COMPLETED' || status === 'NEEDS_REVIEW' || status === 'FAILED';
