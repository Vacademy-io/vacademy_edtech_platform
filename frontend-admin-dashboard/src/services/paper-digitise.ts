/**
 * Question-paper PDF → gradable questions (ai_service `paper-digitise/v1`).
 *
 * Offline tests carry the paper as a PDF attachment in the description; the
 * learner downloads it, solves on paper and uploads a scan. For the AI checker
 * to mark that scan question by question, the assessment needs the paper's
 * questions with their marks — this reads them out of that same attachment.
 *
 * Credits: `estimate` prices the read (per page + base) before anything is
 * charged; `start` refuses with 402 when the balance is short; the job result
 * carries `credits_charged` / `balance_after` so the UI can show exactly what
 * was deducted. Nothing is charged when no questions come back.
 */
import { AI_SERVICE_BASE_URL, BASE_URL } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type { PaperQuestion } from '@/routes/knowledge-base/-types/paper';

const BASE = `${AI_SERVICE_BASE_URL}/paper-digitise/v1`;

export interface CreditEstimate {
    tool_key: string;
    estimated_credits: number;
    current_balance: number | null;
    balance_after: number | null;
    /** null when the balance is unknown — treat as allowed. */
    sufficient: boolean | null;
    breakdown: Array<{ component: string; detail: string; credits: number }>;
}

export interface PaperDigitiseEstimate {
    file_name: string;
    pages: number;
    size_bytes: number;
    estimate: CreditEstimate;
}

export interface PaperDigitiseStart extends PaperDigitiseEstimate {
    task_id: string;
}

/** One question as the model read it — the marks/section/answer provenance the review needs. */
export interface DigitisedRawQuestion {
    question_number?: string | number | null;
    section?: string | null;
    marks?: number | null;
    marks_source?: 'printed' | 'section' | 'split' | 'default' | 'none' | null;
    answer_source?: 'paper' | 'model' | 'none' | null;
    question_type?: string | null;
    question?: { type?: string; content?: string } | null;
    marking_points?: string[];
}

export type ChoicePolicy = 'best' | 'first';

export interface PaperChoiceGroup {
    label: string;
    question_indexes: number[];
    question_numbers?: string[];
    attempt: number;
    policy: ChoicePolicy;
}

/** A choice as sent with the adopted questions, by question id. */
export interface AdoptedChoiceGroup {
    label: string;
    question_ids: string[];
    attempt: number;
    policy: ChoicePolicy;
}

export interface DigitisedPaper {
    title: string;
    total_marks: number | null;
    duration_minutes: number | null;
    sections: Array<{
        name: string;
        instruction: string;
        marks_each: number | null;
        /** "Answer any FOUR" → 4; null when every question of the section is answered. */
        attempt?: number | null;
    }>;
    /** Assessment-builder DTOs, paired by index with `raw_questions`. */
    questions: PaperQuestion[];
    raw_questions: DigitisedRawQuestion[];
    warnings: string[];
    /**
     * Internal choice read off the paper ("Answer any FOUR of these five"): positions
     * in `questions`. Absent on reads made before this existed.
     */
    choice_groups?: PaperChoiceGroup[];
    /** What the paper is out of under its choices (= every question added up without any). */
    paper_total?: number;
    pages: number;
    file_name: string;
    estimate: CreditEstimate;
    /** What was actually deducted; null when billing itself failed (billed=false). */
    credits_charged: number | null;
    balance_after: number | null;
    billed: boolean;
}

export interface PaperDigitiseJob {
    task_id: string;
    status: 'PROGRESS' | 'COMPLETED' | 'FAILED' | string;
    status_message: string | null;
    /** ISO time the read was started; null on older jobs. */
    created_at?: string | null;
    result: DigitisedPaper | null;
}

export const isJobRunning = (job: PaperDigitiseJob | null | undefined): boolean =>
    Boolean(job) && job!.status !== 'COMPLETED' && job!.status !== 'FAILED' && job!.status !== 'CANCELLED';

export const estimatePaperDigitise = async (pdfUrl: string): Promise<PaperDigitiseEstimate> => {
    const { data } = await authenticatedAxiosInstance.post<PaperDigitiseEstimate>(`${BASE}/estimate`, {
        pdf_url: pdfUrl,
    });
    return data;
};

export const startPaperDigitise = async (input: {
    pdfUrl: string;
    expectedTotalMarks?: number;
    title?: string;
    /** The test the paper belongs to — lets its page find the read later and the alert point at it. */
    assessmentId?: string;
    /** Dashboard path to return to from the alert / toast. */
    returnPath?: string;
}): Promise<PaperDigitiseStart> => {
    const { data } = await authenticatedAxiosInstance.post<PaperDigitiseStart>(`${BASE}/start`, {
        pdf_url: input.pdfUrl,
        expected_total_marks: input.expectedTotalMarks ?? null,
        title: input.title || null,
        assessment_id: input.assessmentId || null,
        return_path: input.returnPath || null,
    });
    return data;
};

export const getPaperDigitiseJob = async (taskId: string): Promise<PaperDigitiseJob> => {
    const { data } = await authenticatedAxiosInstance.get<PaperDigitiseJob>(`${BASE}/jobs/${taskId}`);
    return data;
};

/** The newest read started for a test; null when none was. */
export const getPaperDigitiseJobForAssessment = async (
    assessmentId: string
): Promise<PaperDigitiseJob | null> => {
    try {
        const { data } = await authenticatedAxiosInstance.get<PaperDigitiseJob>(
            `${BASE}/jobs/for-assessment/${assessmentId}`
        );
        return data;
    } catch (error: unknown) {
        if ((error as { response?: { status?: number } })?.response?.status === 404) return null;
        throw error;
    }
};

// ---- Reads started in this browser: one toast each when they settle ----------

export interface PendingPaperRead {
    taskId: string;
    assessmentId: string;
    /** What to call the test in the toast. */
    name: string;
    /** Where "Review" takes the teacher. */
    path: string;
    startedAt: number;
}

const PENDING_KEY = 'paper-reads.pending';
/** A read older than this is not worth a toast any more (the bell has it). */
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

const readPending = (): PendingPaperRead[] => {
    try {
        const raw = localStorage.getItem(PENDING_KEY);
        const list = raw ? (JSON.parse(raw) as PendingPaperRead[]) : [];
        return Array.isArray(list)
            ? list.filter((p) => p && p.taskId && Date.now() - Number(p.startedAt || 0) < PENDING_TTL_MS)
            : [];
    } catch {
        return [];
    }
};

const writePending = (list: PendingPaperRead[]): void => {
    try {
        localStorage.setItem(PENDING_KEY, JSON.stringify(list));
    } catch {
        /* private mode — the bell still tells them */
    }
};

export const listPendingPaperReads = (): PendingPaperRead[] => readPending();

export const rememberPendingPaperRead = (read: Omit<PendingPaperRead, 'startedAt'>): void => {
    const rest = readPending().filter((p) => p.taskId !== read.taskId);
    writePending([...rest, { ...read, startedAt: Date.now() }]);
};

/**
 * Drop a read from the list and say whether it was there — the caller toasts
 * only on true, so two ticks (or two tabs) cannot both announce the same read.
 */
export const forgetPendingPaperRead = (taskId: string): boolean => {
    const before = readPending();
    const after = before.filter((p) => p.taskId !== taskId);
    if (after.length === before.length) return false;
    writePending(after);
    return true;
};

/**
 * The server's own sentence for a failed call, when it wrote one. The 402 body
 * nests it under `detail.message`; 400s put it straight in `detail`.
 */
export const paperDigitiseErrorMessage = (error: unknown, fallback: string): string => {
    const data = (error as { response?: { data?: { detail?: unknown; ex?: unknown; message?: unknown } } })
        ?.response?.data;
    const detail = data?.detail;
    if (typeof detail === 'string' && detail) return detail;
    const message = (detail as { message?: unknown } | undefined)?.message;
    if (typeof message === 'string' && message) return message;
    // assessment_service (Java) puts its sentence under `ex`.
    if (typeof data?.ex === 'string' && data.ex) return data.ex;
    if (typeof data?.message === 'string' && data.message) return data.message;
    return fallback;
};

export const isInsufficientCreditsError = (error: unknown): boolean =>
    (error as { response?: { status?: number } })?.response?.status === 402;

// ---- Finding the paper in the description --------------------------------

export interface PdfAttachment {
    url: string;
    name: string;
}

const PDF_URL = /\.pdf(\?|#|$)/i;

/**
 * Every PDF the description links to. The editor's attachment node emits
 * `<a data-attachment href>`; a pasted link is a plain `<a href>` — both count
 * when they point at a PDF (by href or by the attachment's `name`). Same rule
 * the learner's instruction page uses to lift the paper into a viewer.
 */
export const findPdfAttachments = (html: string): PdfAttachment[] => {
    if (!html || typeof DOMParser === 'undefined') return [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const seen = new Set<string>();
    const found: PdfAttachment[] = [];
    doc.querySelectorAll('a[href]').forEach((node) => {
        const anchor = node as HTMLAnchorElement;
        const href = anchor.getAttribute('href') || '';
        const name = anchor.getAttribute('name') || anchor.textContent?.trim() || '';
        const type = (anchor.getAttribute('type') || '').toLowerCase();
        const isPdf = PDF_URL.test(href) || PDF_URL.test(name) || type.includes('pdf');
        if (!href || href === '#' || !isPdf || seen.has(href)) return;
        seen.add(href);
        found.push({ url: href, name: name || decodeURIComponent(href.split('/').pop() || 'paper.pdf') });
    });
    return found;
};

/** Every non-PDF file the description links to — so the UI can say why AI checking is off. */
export const hasNonPdfAttachment = (html: string): boolean => {
    if (!html || typeof DOMParser === 'undefined') return false;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return Array.from(doc.querySelectorAll('a[data-attachment][href]')).some((node) => {
        const href = node.getAttribute('href') || '';
        const name = node.getAttribute('name') || '';
        const type = (node.getAttribute('type') || '').toLowerCase();
        return !(PDF_URL.test(href) || PDF_URL.test(name) || type.includes('pdf'));
    });
};

// ---- Existing tests: from placeholder to AI-checkable -----------------------

const EVALUATION_AI = `${BASE_URL}/assessment-service/assessment/evaluation-ai`;

export interface AiGradability {
    assessment_id: string;
    /** True when the test's only question is the manual-upload placeholder. */
    placeholder_only: boolean;
    message: string;
}

/** Can the AI check this test at all, or does it only hold "Upload your answer sheet."? */
export const getAiGradability = async (assessmentId: string): Promise<AiGradability> => {
    const { data } = await authenticatedAxiosInstance.get<AiGradability>(`${EVALUATION_AI}/gradable`, {
        params: { assessmentId },
    });
    return data;
};

export interface AdoptedQuestion {
    question_id: string;
    question_type: string;
    marks: number;
}

export interface AdoptQuestionsResult {
    assessment_id: string;
    questions_mapped: number;
    total_marks: number;
    /** Uploaded sheets that now carry a row per question and can be AI-checked. */
    attempt_ids_ready: string[];
    /** Sheets a teacher had already graded by hand; left exactly as they were. */
    attempts_left_as_graded: number;
    attempts_in_progress: number;
}

/**
 * Replace an existing test's placeholder with real questions (already saved to
 * the bank), switch AI checking on, and prepare every uploaded sheet for it.
 */
export const adoptDigitisedQuestions = async (
    assessmentId: string,
    questions: AdoptedQuestion[],
    choiceGroups?: AdoptedChoiceGroup[]
): Promise<AdoptQuestionsResult> => {
    const { data } = await authenticatedAxiosInstance.post<AdoptQuestionsResult>(
        `${EVALUATION_AI}/adopt-questions`,
        // Sent only when the paper has an internal choice: the request is otherwise as before.
        choiceGroups && choiceGroups.length > 0
            ? { questions, choice_groups: choiceGroups }
            : { questions },
        { params: { assessmentId } }
    );
    return data;
};
