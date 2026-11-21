import { AxiosError } from 'axios';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { OMR_BASE_URL } from '@/constants/urls';

/**
 * OMR sheets for pen-and-paper MCQ exams: the paper sets, the printable bubble
 * sheet per set, the roll-number pre-check, and the upload + review of filled
 * sheets. Bound to the caller's institute exactly like copy intake: every call
 * carries instituteId (the clientId header comes from the axios instance).
 */

export interface OmrConfig {
    set_count: number | null;
    shuffle_questions: boolean | null;
    shuffle_options: boolean | null;
    roll_digits: number | null;
    /** LARGE (<= 100 questions) or DENSE (101 - 200). */
    density: string | null;
    layout_version: number | null;
    locked_at: string | null;
}

export interface OmrSet {
    id: string;
    set_code: string;
    question_count: number;
    density: string | null;
    roll_digits: number | null;
    created_at: string | null;
}

export interface OmrOverview {
    omr_mode: boolean;
    config: OmrConfig | null;
    /** True once a scan was uploaded: sets and sheets can no longer change. */
    locked: boolean;
    question_count: number;
    /** Why this paper cannot be printed as an OMR sheet yet (empty = it can). */
    paper_issues: string[];
    sets: OmrSet[];
}

export interface OmrConfigRequest {
    set_count?: number;
    shuffle_questions?: boolean;
    shuffle_options?: boolean;
}

export interface OmrPaperItem {
    no: number;
    question_id: string;
    section_id: string;
    /** Option ids in printed order: [0] is A. */
    option_ids: string[];
    correct_letter: string | null;
}

export interface OmrSetPaper {
    set_id: string;
    set_code: string;
    roll_digits: number | null;
    items: OmrPaperItem[];
}

export type OmrRollProblem = 'MISSING' | 'NOT_NUMERIC' | 'TOO_LONG' | 'DUPLICATE' | 'CONFLICTING';

export interface OmrRollIssue {
    problem: OmrRollProblem;
    user_id: string | null;
    name: string | null;
    enrollment_number: string | null;
    detail: string | null;
}

export interface OmrRollCheck {
    participant_count: number;
    roll_digits: number | null;
    /** True when every participant has a usable number: the sheets can be downloaded. */
    ok: boolean;
    issues: OmrRollIssue[];
}

export interface OmrParticipant {
    user_id: string;
    name: string | null;
    enrollment_number: string | null;
    has_omr_sheet: boolean;
}

export type OmrBatchStatus = 'RUNNING' | 'NEEDS_REVIEW' | 'COMPLETED';
export type OmrSheetStatus =
    | 'PENDING'
    | 'READING'
    | 'GRADED'
    | 'NEEDS_REVIEW'
    | 'FAILED'
    | 'SKIPPED';
export type OmrFlag = 'MULTI' | 'LOW_CONFIDENCE';

export interface OmrSheet {
    id: string;
    file_name: string | null;
    /** null = a whole file that failed to open. */
    page_no: number | null;
    status: OmrSheetStatus;
    reason_code: string | null;
    reason: string | null;
    /** PDF of the scanned page. */
    sheet_file_id: string | null;
    /** JPEG overlay of the detected bubbles. */
    marked_file_id: string | null;
    /** JPEG crop of the handwritten name box. */
    name_crop_file_id: string | null;
    /** Digits read; '?' = blank, '*' = several bubbles. */
    read_roll: string | null;
    read_set: string | null;
    roll_low_confidence: boolean | null;
    /** question number -> letters read ("" = blank, "AC" = several bubbles). */
    answers: Record<string, string> | null;
    flags: Record<string, OmrFlag> | null;
    /** question number -> the letter the admin set ("" = not attempted). */
    fixes: Record<string, string> | null;
    matched_user_id: string | null;
    /** Also the suggestion on ROLL_LOW_CONFIDENCE. */
    matched_name: string | null;
    attempt_id: string | null;
    marks: number | null;
}

export interface OmrBatchCounts {
    files: number;
    sheets: number;
    reading: number;
    graded: number;
    needs_review: number;
    failed: number;
    skipped: number;
    /** Graded sheets with at least one flagged question. */
    flagged: number;
}

export interface OmrBatch {
    id: string;
    set_id: string;
    set_code: string | null;
    status: OmrBatchStatus;
    total_files: number;
    counts: OmrBatchCounts;
    created_by_name: string | null;
    error_message: string | null;
    created_at: string;
    completed_at: string | null;
    /** Only on the single-batch read. */
    sheets?: OmrSheet[];
}

export interface OmrUploadedFile {
    file_id: string;
    file_name: string;
}

/** Most uploads the server takes in one batch. */
export const OMR_MAX_FILES = 300;

/**
 * The admin-readable sentence of a failed call: `message` / `ex` from the
 * platform ErrorInfo body, a blob body parsed as JSON (the sheet download),
 * or the plain Error the axios interceptor rejects 511 blob errors with.
 */
export const omrErrorMessage = (error: unknown, fallback: string): string => {
    if (error instanceof AxiosError) {
        const data = error.response?.data as { message?: string; ex?: string } | undefined;
        if (data && typeof data === 'object' && !(data instanceof Blob)) {
            return data.message || data.ex || fallback;
        }
        return fallback;
    }
    if (error instanceof Error && error.message) return error.message;
    return fallback;
};

export const getOmrOverview = async (
    assessmentId: string,
    instituteId: string
): Promise<OmrOverview> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${OMR_BASE_URL}/overview`,
        params: { assessmentId, instituteId },
    });
    return response.data;
};

export const saveOmrConfig = async (
    assessmentId: string,
    instituteId: string,
    config: OmrConfigRequest
): Promise<OmrOverview> => {
    const response = await authenticatedAxiosInstance({
        method: 'PUT',
        url: `${OMR_BASE_URL}/config`,
        params: { assessmentId, instituteId },
        data: config,
    });
    return response.data;
};

export const generateOmrSets = async (
    assessmentId: string,
    instituteId: string
): Promise<OmrOverview> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${OMR_BASE_URL}/sets/generate`,
        params: { assessmentId, instituteId },
    });
    return response.data;
};

export const getOmrSetPaper = async (
    assessmentId: string,
    instituteId: string,
    setId: string
): Promise<OmrSetPaper> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${OMR_BASE_URL}/sets/${setId}/paper`,
        params: { assessmentId, instituteId },
    });
    return response.data;
};

/**
 * The printable OMR sheet of a set (one A4 page; print one per student), saved
 * straight to disk. A refusal comes back as a JSON blob; its message is thrown.
 */
export const downloadOmrSheetPdf = async (
    assessmentId: string,
    instituteId: string,
    setId: string,
    setCode: string
): Promise<void> => {
    let blob: Blob;
    try {
        const response = await authenticatedAxiosInstance({
            method: 'GET',
            url: `${OMR_BASE_URL}/sets/${setId}/sheet.pdf`,
            params: { assessmentId, instituteId },
            responseType: 'blob',
            headers: { Accept: 'application/pdf' },
        });
        blob = response.data;
    } catch (error) {
        const data = error instanceof AxiosError ? error.response?.data : undefined;
        if (data instanceof Blob) {
            let message: string | undefined;
            try {
                const json = JSON.parse(await data.text()) as { message?: string; ex?: string };
                message = json.message || json.ex;
            } catch {
                /* not JSON: fall through to the original error */
            }
            if (message) throw new Error(message);
        }
        throw error;
    }
    const url = window.URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `omr-sheet-set-${setCode}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
};

export const getOmrRollCheck = async (
    assessmentId: string,
    instituteId: string
): Promise<OmrRollCheck> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${OMR_BASE_URL}/roll-check`,
        params: { assessmentId, instituteId },
    });
    return response.data;
};

export const getOmrParticipants = async (
    assessmentId: string,
    instituteId: string
): Promise<OmrParticipant[]> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${OMR_BASE_URL}/participants`,
        params: { assessmentId, instituteId },
    });
    return response.data ?? [];
};

export const startOmrScan = async (
    assessmentId: string,
    instituteId: string,
    setId: string,
    files: OmrUploadedFile[]
): Promise<OmrBatch> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${OMR_BASE_URL}/scan/start`,
        params: { assessmentId, instituteId },
        data: { set_id: setId, files },
    });
    return response.data;
};

export const listOmrBatches = async (
    assessmentId: string,
    instituteId: string
): Promise<OmrBatch[]> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${OMR_BASE_URL}/scan/batches`,
        params: { assessmentId, instituteId },
    });
    return response.data ?? [];
};

export const getOmrBatch = async (batchId: string, instituteId: string): Promise<OmrBatch> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${OMR_BASE_URL}/scan/batch/${batchId}`,
        params: { instituteId },
    });
    return response.data;
};

export const resolveOmrSheet = async (
    itemId: string,
    instituteId: string,
    userId: string
): Promise<OmrSheet> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${OMR_BASE_URL}/scan/item/${itemId}/resolve`,
        params: { instituteId },
        data: { user_id: userId },
    });
    return response.data;
};

export const skipOmrSheet = async (itemId: string, instituteId: string): Promise<OmrSheet> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${OMR_BASE_URL}/scan/item/${itemId}/skip`,
        params: { instituteId },
    });
    return response.data;
};

/** Only FAILED sheets can be retried. */
export const retryOmrSheet = async (itemId: string, instituteId: string): Promise<OmrSheet> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${OMR_BASE_URL}/scan/item/${itemId}/retry`,
        params: { instituteId },
    });
    return response.data;
};

/**
 * Correct flagged questions on a graded sheet; the sheet is re-graded.
 * `answers` maps question number -> letter ("" = not attempted) and may only
 * carry keys present in the sheet's `flags`.
 */
export const fixOmrSheetAnswers = async (
    itemId: string,
    instituteId: string,
    answers: Record<string, string>
): Promise<OmrSheet> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${OMR_BASE_URL}/scan/item/${itemId}/fix-answers`,
        params: { instituteId },
        data: { answers },
    });
    return response.data;
};

/** Graded with at least one flagged question (two bubbles or a faint mark). */
export const isOmrSheetFlagged = (sheet: OmrSheet) =>
    sheet.status === 'GRADED' && Object.keys(sheet.flags ?? {}).length > 0;

/** Still being read on its own. */
export const isOmrSheetActive = (sheet: OmrSheet) =>
    sheet.status === 'PENDING' || sheet.status === 'READING';
