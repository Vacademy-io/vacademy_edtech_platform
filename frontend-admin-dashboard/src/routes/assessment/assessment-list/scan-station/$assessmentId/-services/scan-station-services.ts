import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { SCAN_STATION_BASE_URL } from '@/constants/urls';
import type { CommentPlacement, CopyCheckConfig } from '@/types/assessment-settings';
import type { CopyIntakeBatch } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/copy-intake-services';

/**
 * Scan station (contract C3): a pile of answer sheets scanned in two passes
 * (fronts, then the pile turned over for the backs), one load at a time. The
 * server reads every load, pairs fronts with backs, groups sheets into copies
 * and, once a person has looked at what needs a look, builds one PDF per copy
 * and hands them to the existing copy-intake batch.
 *
 * Every route takes ?instituteId=. Only GET /config answers while the feature
 * is off (200 {enabled:false}); every other route is a 404 then.
 */

// ---- enums ----------------------------------------------------------------

export type ScanSessionStatus = 'OPEN' | 'BUILDING' | 'BUILT' | 'STARTING' | 'STARTED' | 'FAILED';
export type ScanVerdict = 'EMPTY' | 'ANALYSING' | 'READY' | 'NEEDS_REVIEW' | 'BLOCKED';
export type ScanFlagSeverity = 'BLOCK' | 'REVIEW' | 'INFO';
export type ScanLoadStatus = 'PENDING' | 'ANALYSING' | 'DONE' | 'FAILED';
export type ScanFileKind = 'IMAGE' | 'PDF';
export type ScanBlankClass = 'BLANK' | 'UNSURE' | 'WRITTEN';
export type ScanDpiSource = 'JFIF' | 'EXIF' | 'PDF' | 'ASSUMED';
export type ScanLabelKind = 'PRINTED_FIELD' | 'QUESTION_TEXT' | 'NONE';
export type ScanRotation = 0 | 90 | 180 | 270;
export type ScanPageSide = 'FRONT' | 'BACK';
export type ScanCopyDecision = 'NONE' | 'ACCEPTED' | 'EXCLUDED';
export type FrontsDirection = 'FORWARD' | 'REVERSED';
export type FrontsDirectionSource = 'CLERK' | 'LOAD1' | 'AGGREGATE' | 'DEFAULT';
export type ScanIntakeMode = 'TWO_PASSES' | 'ONE_FOLDER' | 'DUPLEX';
export type ScanOrderSource = 'IMAGE_CAPTURE_SUFFIX' | 'NUMERIC_SUFFIX' | 'MODIFIED_TIME' | 'NAME';
export type ScanClientWarning = 'MTIME_DISAGREES';
export type ScanDecisionAction =
    | 'ACCEPT_COPY'
    | 'EXCLUDE_COPY'
    | 'INCLUDE_COPY'
    | 'MERGE_WITH_PREVIOUS'
    | 'SPLIT_BEFORE_SHEET'
    | 'CLEAR_SHEET'
    | 'KEEP_PAGE'
    | 'DROP_PAGE'
    | 'ACCEPT_LOAD_FLAG'
    | 'SET_FRONTS_DIRECTION';

/** Flag codes ai_service reports per load (C1). */
export const AI_SCAN_FLAG_CODES = [
    'COUNT_MISMATCH',
    'FILE_UNREADABLE',
    'NO_NAME_BOX_FOUND',
    'LOAD_TOO_LARGE',
    'PAIR_SHIFT_DETECTED',
    'BACK_HAS_LABEL',
    'LABEL_NO_VALUE',
    'LABEL_UNUSUAL',
    'PAIR_NOT_ROW_MAX',
    'ORDER_UNCERTAIN',
    'FRONT_BLANK',
    'DPI_LOW',
    'BLANK_RULE_SUSPECT',
    'DPI_ASSUMED',
    'UNSURE_KEPT',
] as const;

/** Flag codes the server's planner adds on top of C1's (C3). */
export const PLANNER_SCAN_FLAG_CODES = [
    'ANALYSIS_FAILED',
    'FIRST_SHEET_NO_LABEL',
    'TOO_MANY_COPIES',
    'FRONT_ORDER_UNCERTAIN',
    'LOAD_STARTS_MID_COPY',
    'SAME_NAME',
    'COPY_UNUSUALLY_LONG',
    'TOO_MANY_PAGES',
    'BLANKS_TO_CONFIRM',
    'MTIME_DISAGREES',
] as const;

/**
 * Codes the server's planner sends only in verdict_reasons, never as a flag:
 * NO_COPIES is the BLOCKED reason when every copy is left out.
 */
export const VERDICT_REASON_CODES = ['NO_COPIES'] as const;

export type ScanFlagCode =
    | (typeof AI_SCAN_FLAG_CODES)[number]
    | (typeof PLANNER_SCAN_FLAG_CODES)[number]
    | (typeof VERDICT_REASON_CODES)[number];

// ---- C1 shapes, as the session returns them --------------------------------

export interface ScanLayout {
    fronts_pass: number;
    fronts_rotation: 0 | 180;
    backs_order: 'SAME' | 'REVERSED';
    backs_rotation: 0 | 180;
    order_margin: number;
    shift: { from_sheet: number; offset: number } | null;
    blank_rule_suspect: boolean;
}

export interface ScanPage {
    /** "p{pass_no}.{index within pass}". */
    ref: string;
    pass_no: number;
    file_id: string;
    page_index: number;
    kind: ScanFileKind;
    dpi: number;
    dpi_source: ScanDpiSource;
    width_px: number;
    height_px: number;
    ink_per_10k: number;
    blank_class: ScanBlankClass;
    error: string | null;
    /** The class after the clerk's keep/drop and the blank-rule guard. */
    blank_effective: ScanBlankClass;
}

export interface ScanSheet {
    /** Index in the FRONTS pass scan order. */
    sheet_no: number;
    front: string;
    /** The paired page in the other pass. */
    back: string;
    pair_score: number;
    /** Null for a one-sheet load. */
    pair_runner_up: number | null;
    pair_is_row_max: boolean;
    label_kind: ScanLabelKind;
    /** label_kind === 'PRINTED_FIELD'. */
    label_present: boolean;
    name_text: string | null;
    name_readable: boolean;
    roll_text: string | null;
    /** Null when the load has no labelled front. */
    label_template_sim: number | null;
    back_label_like: boolean;
    front_blank_class: ScanBlankClass;
    back_blank_class: ScanBlankClass;
}

// ---- C3 SessionDto --------------------------------------------------------

export interface ScanVerdictReason {
    code: string;
    severity: ScanFlagSeverity;
    load_no: number | null;
    copy_key: string | null;
}

export interface ScanSessionFlag {
    code: string;
    severity: ScanFlagSeverity;
    detail: string | null;
    accepted: boolean;
}

export interface ScanLoadFlag {
    code: string;
    severity: ScanFlagSeverity;
    sheet_no: number | null;
    detail: string | null;
    accepted: boolean;
    /**
     * What ACCEPT_LOAD_FLAG stores; sent back as expected_fingerprint. Optional:
     * a server from before this field sends none, and then no check is asked for.
     */
    fingerprint?: string | null;
}

export interface ScanCopyFlag {
    code: string;
    severity: ScanFlagSeverity;
    sheet_no: number | null;
    detail: string | null;
}

export interface ScanLoadPass {
    pass_no: number;
    page_count: number;
    files: { file_id: string; file_name: string; kind: ScanFileKind }[];
}

export interface ScanLoad {
    load_no: number;
    status: ScanLoadStatus;
    attempts: number;
    error_message: string | null;
    passes: ScanLoadPass[];
    layout: ScanLayout | null;
    pages: ScanPage[];
    sheets: ScanSheet[];
    flags: ScanLoadFlag[];
}

export interface ScanCopyPage {
    load_no: number;
    ref: string;
    file_id: string;
    page_index: number;
    kind: ScanFileKind;
    rotation: ScanRotation;
    side: ScanPageSide;
}

export interface ScanLeftOutPage {
    load_no: number;
    ref: string;
    file_id: string;
    page_index: number;
    kind: ScanFileKind;
}

export interface ScanCopy {
    copy_key: string;
    load_no: number;
    first_sheet_no: number;
    sheets: { load_no: number; sheet_no: number }[];
    pages: ScanCopyPage[];
    left_out: ScanLeftOutPage[];
    page_count: number;
    name_text: string | null;
    flags: ScanCopyFlag[];
    decision: ScanCopyDecision;
    needs_review: boolean;
    /** What ACCEPT_COPY stores; sent back as expected_fingerprint (optional, as above). */
    fingerprint?: string | null;
}

export interface ScanBuiltCopy {
    copy_key: string;
    file_id: string;
    page_count: number;
}

export interface ScanTotals {
    loads: number;
    sheets: number;
    pages: number;
    copies: number;
    blank_left_out: number;
    excluded: number;
}

export interface ScanSession {
    id: string;
    assessment_id: string;
    status: ScanSessionStatus;
    verdict: ScanVerdict;
    verdict_reasons: ScanVerdictReason[];
    fronts_direction: FrontsDirection;
    fronts_direction_source: FrontsDirectionSource;
    session_flags: ScanSessionFlag[];
    loads: ScanLoad[];
    copies: ScanCopy[];
    /**
     * The copies made so far. While BUILDING this grows as the copies are made
     * (a build that waited for a busy AI service keeps the ones it made).
     */
    built: ScanBuiltCopy[] | null;
    intake_batch_id: string | null;
    /**
     * Why a build FAILED. While BUILDING it is the note that the AI service is
     * busy and the build is waiting for it: a wait, not a failure.
     */
    error_message: string | null;
    totals: ScanTotals;
}

export interface ScanSessionSummary {
    id: string;
    status: ScanSessionStatus;
    verdict: ScanVerdict;
    created_at: string;
    loads: number;
    copies: number;
    intake_batch_id: string | null;
}

export interface ScanConfig {
    enabled: boolean;
    max_loads: number;
    max_pages_per_pass: number;
    max_copies: number;
}

// ---- request bodies -------------------------------------------------------

export interface ScanLoadFile {
    file_id: string;
    file_name: string;
    kind: ScanFileKind;
    order_index: number;
    /** File.lastModified, epoch ms. */
    last_modified: number;
    page_count: number;
}

export interface ScanLoadBody {
    passes: { pass_no: number; files: ScanLoadFile[] }[];
    intake_mode: ScanIntakeMode;
    order_source: ScanOrderSource;
    client_warnings: ScanClientWarning[];
}

export interface ScanDecisionBody {
    action: ScanDecisionAction;
    load_no: number | null;
    sheet_no: number | null;
    ref: string | null;
    /** The load or session flag being accepted, e.g. BLANKS_TO_CONFIRM. */
    code: string | null;
    value: FrontsDirection | null;
    /**
     * For ACCEPT_COPY and ACCEPT_LOAD_FLAG: the fingerprint of the copy or flag
     * the clerk was shown. When the plan has moved on since, the server refuses
     * with 409 PLAN_CHANGED instead of accepting something nobody saw.
     */
    expected_fingerprint: string | null;
}

export interface ScanStartBody {
    preferred_model: string | null;
    notify_email: boolean;
    comment_placement: CommentPlacement | null;
    copy_check_config: CopyCheckConfig;
    map_students: boolean;
}

export interface ScanStartResponse {
    session: ScanSession;
    batch: CopyIntakeBatch;
}

// ---- query keys -----------------------------------------------------------

export const SCAN_CONFIG_KEY = 'SCAN_STATION_CONFIG';
export const SCAN_SESSIONS_KEY = 'SCAN_STATION_SESSIONS';
export const SCAN_SESSION_KEY = 'SCAN_STATION_SESSION';

/** The source_id raw pass files are uploaded under (media file_metadata). */
export const SCAN_UPLOAD_SOURCE_ID = 'ASSESSMENT_SCAN_STATION';

// ---- calls ----------------------------------------------------------------

export const getScanConfig = async (instituteId: string): Promise<ScanConfig> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${SCAN_STATION_BASE_URL}/config`,
        params: { instituteId },
    });
    return response.data;
};

/** Newest first, at most 10. */
export const listScanSessions = async (
    assessmentId: string,
    instituteId: string
): Promise<ScanSessionSummary[]> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${SCAN_STATION_BASE_URL}/sessions`,
        params: { assessmentId, instituteId },
    });
    return response.data ?? [];
};

export const createScanSession = async (
    assessmentId: string,
    instituteId: string
): Promise<ScanSession> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${SCAN_STATION_BASE_URL}/session`,
        params: { assessmentId, instituteId },
    });
    return response.data;
};

export const getScanSession = async (
    sessionId: string,
    instituteId: string
): Promise<ScanSession> => {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${SCAN_STATION_BASE_URL}/session/${sessionId}`,
        params: { instituteId },
    });
    return response.data;
};

/** 409 unless the session is OPEN; 422 COUNT_MISMATCH; 403 for a file of another institute. */
export const addScanLoad = async (
    sessionId: string,
    instituteId: string,
    body: ScanLoadBody
): Promise<ScanSession> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${SCAN_STATION_BASE_URL}/session/${sessionId}/load`,
        params: { instituteId },
        data: body,
    });
    return response.data;
};

/** "Rescan this load": the load goes back to PENDING and loses its decisions. */
export const replaceScanLoad = async (
    sessionId: string,
    loadNo: number,
    instituteId: string,
    body: ScanLoadBody
): Promise<ScanSession> => {
    const response = await authenticatedAxiosInstance({
        method: 'PUT',
        url: `${SCAN_STATION_BASE_URL}/session/${sessionId}/load/${loadNo}`,
        params: { instituteId },
        data: body,
    });
    return response.data;
};

export const removeScanLoad = async (
    sessionId: string,
    loadNo: number,
    instituteId: string
): Promise<ScanSession> => {
    const response = await authenticatedAxiosInstance({
        method: 'DELETE',
        url: `${SCAN_STATION_BASE_URL}/session/${sessionId}/load/${loadNo}`,
        params: { instituteId },
    });
    return response.data;
};

/**
 * One clerk decision; the server re-plans and returns the new session. 409
 * PLAN_CHANGED when an accept's expected_fingerprint no longer matches.
 */
export const decideScan = async (
    sessionId: string,
    instituteId: string,
    body: ScanDecisionBody
): Promise<ScanSession> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${SCAN_STATION_BASE_URL}/session/${sessionId}/decision`,
        params: { instituteId },
        data: body,
    });
    return response.data;
};

/** 409 unless the verdict is READY. */
export const buildScanSession = async (
    sessionId: string,
    instituteId: string
): Promise<ScanSession> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${SCAN_STATION_BASE_URL}/session/${sessionId}/build`,
        params: { instituteId },
    });
    return response.data;
};

/** BUILT or FAILED back to OPEN; the built copies are dropped. */
export const reopenScanSession = async (
    sessionId: string,
    instituteId: string
): Promise<ScanSession> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${SCAN_STATION_BASE_URL}/session/${sessionId}/reopen`,
        params: { instituteId },
    });
    return response.data;
};

/** Hands the built copies to copy intake. Idempotent once STARTED. */
export const startScanSession = async (
    sessionId: string,
    instituteId: string,
    body: ScanStartBody
): Promise<ScanStartResponse> => {
    const response = await authenticatedAxiosInstance({
        method: 'POST',
        url: `${SCAN_STATION_BASE_URL}/session/${sessionId}/start`,
        params: { instituteId },
        data: body,
    });
    return response.data;
};

/** A decision body with every unused field null, as the server expects. */
export const scanDecision = (
    action: ScanDecisionAction,
    fields: Partial<Omit<ScanDecisionBody, 'action'>> = {}
): ScanDecisionBody => ({
    action,
    load_no: fields.load_no ?? null,
    sheet_no: fields.sheet_no ?? null,
    ref: fields.ref ?? null,
    code: fields.code ?? null,
    value: fields.value ?? null,
    expected_fingerprint: fields.expected_fingerprint ?? null,
});
