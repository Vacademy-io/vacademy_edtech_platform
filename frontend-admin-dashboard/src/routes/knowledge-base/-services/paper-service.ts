import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { AI_SERVICE_BASE_URL, ADD_QUESTION_PAPER } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import { renderLatexDelimiters } from '@/lib/latex-delimiters';
import type {
    Blueprint,
    KbTopic,
    BlueprintResponse,
    BlueprintRow,
    PaperIssue,
    PaperDifficulty,
    PaperJob,
    PaperQuestion,
    PaperQuestionType,
    PaperSpec,
    RawPaperQuestion,
    KbGeneration,
    KbGenerationDetail,
    PublishedPaperLink,
} from '../-types/paper';

const BASE = `${AI_SERVICE_BASE_URL}/knowledge-base/v1`;

/**
 * The knowledge base's topic tree — what it is ABOUT, merged across sources.
 *
 * Distinct from getOutline(), which returns the per-source page-ordered summary
 * tree. That one is right for provenance and wrong for a picker: on a set of
 * past papers it offers page windows like "Answer Keys, p. 13" as if they were
 * subjects.
 */
export const getTopics = async (kbId: string): Promise<KbTopic[]> => {
    const { data } = await authenticatedAxiosInstance.get<{ topics: KbTopic[] }>(
        `${BASE}/bases/${kbId}/topics`
    );
    return data.topics ?? [];
};

/** Re-derive the topic tree (for KBs ingested before topics existed). */
export const rebuildTopics = async (kbId: string): Promise<KbTopic[]> => {
    const { data } = await authenticatedAxiosInstance.post<{ topics: KbTopic[] }>(
        `${BASE}/bases/${kbId}/topics/rebuild`
    );
    return data.topics ?? [];
};

/**
 * Plan a paper, or revise the current plan.
 *
 * The same call serves the first build and every chat refinement — a refinement
 * carries the blueprint currently on screen plus what to change, and the planner
 * returns the FULL updated plan so the teacher's own edits survive.
 */
export const buildBlueprint = async (
    kbId: string,
    payload: {
        spec: PaperSpec;
        selected_node_ids?: string[];
        current_blueprint?: Blueprint;
        instruction?: string;
    }
): Promise<BlueprintResponse> => {
    const { data } = await authenticatedAxiosInstance.post<BlueprintResponse>(
        `${BASE}/bases/${kbId}/paper/blueprint`,
        payload
    );
    return data;
};

export const startGeneration = async (
    kbId: string,
    payload: { blueprint: Blueprint; grade?: string; generate_diagrams?: boolean }
): Promise<{ task_id: string; planned: number; generation_id: string | null }> => {
    const { data } = await authenticatedAxiosInstance.post<{
        task_id: string;
        planned: number;
        generation_id: string | null;
    }>(`${BASE}/bases/${kbId}/paper/generate`, payload);
    return data;
};

/**
 * Fill ONE assessment section from a knowledge base.
 *
 * Separate from `startGeneration` because an assessment section already has its
 * own marks and duration — planning sections inside one would fight the
 * assessment builder. The teacher states the count and type directly, which
 * also skips the planning step entirely. Poll with `getPaperJob`.
 */
export const generateSectionFromKb = async (
    kbId: string,
    payload: {
        selected_node_ids: string[];
        count: number;
        question_type: PaperQuestionType;
        difficulty: PaperDifficulty;
        marks_each?: number;
        section_title?: string;
        grade?: string;
    }
): Promise<{ task_id: string; planned: number; generation_id: string | null }> => {
    const { data } = await authenticatedAxiosInstance.post<{
        task_id: string;
        planned: number;
        generation_id: string | null;
    }>(`${BASE}/bases/${kbId}/paper/section`, payload);
    return data;
};

export const getPaperJob = async (taskId: string): Promise<PaperJob> => {
    const { data } = await authenticatedAxiosInstance.get<PaperJob>(`${BASE}/paper-jobs/${taskId}`);
    return data;
};

export const regenerateQuestion = async (
    kbId: string,
    payload: { blueprint_row: BlueprintRow; instruction?: string; grade?: string }
): Promise<{ question: PaperQuestion; raw_question: RawPaperQuestion }> => {
    const { data } = await authenticatedAxiosInstance.post<{
        question: PaperQuestion;
        raw_question: RawPaperQuestion;
    }>(`${BASE}/bases/${kbId}/paper/regenerate`, payload);
    return data;
};

export const validatePaper = async (
    kbId: string,
    payload: { blueprint: Blueprint; questions: RawPaperQuestion[] }
): Promise<{ issues: PaperIssue[]; error_count: number; warning_count: number }> => {
    const { data } = await authenticatedAxiosInstance.post<{
        issues: PaperIssue[];
        error_count: number;
        warning_count: number;
    }>(`${BASE}/bases/${kbId}/paper/validate`, payload);
    return data;
};

/**
 * A hand-edited question, run through the same formatter as generated ones so
 * the QuestionDTO the bank stores follows the edit. Not metered.
 */
export const formatEditedQuestion = async (
    kbId: string,
    rawQuestion: RawPaperQuestion,
    generationId?: string | null
): Promise<{ question: PaperQuestion; raw_question: RawPaperQuestion }> => {
    const { data } = await authenticatedAxiosInstance.post<{
        question: PaperQuestion;
        raw_question: RawPaperQuestion;
    }>(`${BASE}/bases/${kbId}/paper/format`, {
        raw_question: rawQuestion,
        generation_id: generationId ?? null,
    });
    return data;
};

// ---- PDF: the paper as a sheet ---------------------------------------------

export type PaperTheme = 'classic' | 'compact' | 'coaching';
export const PAPER_THEMES: PaperTheme[] = ['classic', 'compact', 'coaching'];
const THEME_STORAGE_KEY = 'kb-paper-theme';

/** The layout last chosen in this browser; institutes tend to have one house style. */
export const loadPaperTheme = (): PaperTheme => {
    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        return PAPER_THEMES.includes(stored as PaperTheme) ? (stored as PaperTheme) : 'classic';
    } catch {
        return 'classic';
    }
};
export const savePaperTheme = (theme: PaperTheme): void => {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
        /* private mode — the choice just does not persist */
    }
};

export interface PaperPdfOptions {
    /** Answer key + marking scheme: own pages (classic/compact) or inline (coaching). */
    includeAnswerKey?: boolean;
    /** Marks in the right margin and per-section totals. */
    showMarks?: boolean;
    /** "A", "B"… printed in a box at the top right for parallel sets. */
    setLabel?: string;
    /** Print layout; see paper_themes.py. Default classic. */
    theme?: PaperTheme;
    /** Printed in the header's Date field where the layout has one. */
    examDate?: string;
    /** "Class - 10th" line for the coaching layout; defaults from the book. */
    gradeLine?: string;
}

const layoutFields = (options: PaperPdfOptions) => ({
    theme: options.theme ?? 'classic',
    exam_date: options.examDate || null,
    grade_line: options.gradeLine || null,
});

const pdfFileName = (headers: Record<string, unknown>, fallback: string): string => {
    const disposition = String(headers['content-disposition'] ?? '');
    const match = /filename="?([^";]+)"?/.exec(disposition);
    return match?.[1] ?? fallback;
};

/** A rendered PDF plus the name the server chose for it. */
export interface PdfFile {
    blob: Blob;
    fileName: string;
}

export const saveBlob = (blob: Blob, fileName: string): void => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
};

/**
 * Render the paper on the review board as a print-ready PDF.
 *
 * Sends the client's copy of the questions: a rewritten question exists only
 * here until the paper is saved, and the printout must match what the teacher
 * just reviewed. Not metered — the server lays out, it does not generate.
 * The same bytes back the preview and the download, so what is shown is what
 * is saved.
 */
export const fetchPaperPdf = async (
    kbId: string,
    payload: { blueprint: Blueprint; questions: RawPaperQuestion[] },
    options: PaperPdfOptions = {}
): Promise<PdfFile> => {
    const response = await authenticatedAxiosInstance.post<Blob>(
        `${BASE}/bases/${kbId}/paper/pdf`,
        {
            blueprint: payload.blueprint,
            questions: payload.questions,
            include_answer_key: Boolean(options.includeAnswerKey),
            show_marks: options.showMarks ?? true,
            set_label: options.setLabel || null,
            ...layoutFields(options),
        },
        { responseType: 'blob' }
    );
    return {
        blob: response.data,
        fileName: pdfFileName(response.headers as Record<string, unknown>, 'question-paper.pdf'),
    };
};

/** The same PDF for a finished paper in the history, without reopening it. */
export const fetchGenerationPdf = async (
    generationId: string,
    options: PaperPdfOptions = {}
): Promise<PdfFile> => {
    const response = await authenticatedAxiosInstance.get<Blob>(
        `${BASE}/generations/${generationId}/paper.pdf`,
        {
            params: {
                include_answer_key: Boolean(options.includeAnswerKey),
                show_marks: options.showMarks ?? true,
                ...(options.setLabel ? { set_label: options.setLabel } : {}),
                theme: options.theme ?? 'classic',
                ...(options.examDate ? { exam_date: options.examDate } : {}),
                ...(options.gradeLine ? { grade_line: options.gradeLine } : {}),
            },
            responseType: 'blob',
        }
    );
    return {
        blob: response.data,
        fileName: pdfFileName(response.headers as Record<string, unknown>, 'question-paper.pdf'),
    };
};

/**
 * Publish the paper behind a link anyone can open (public bucket + short
 * link) so it can be sent on WhatsApp instead of attached everywhere. The
 * answer-key variant is its own link. Remembered on the history row when
 * `generationId` is given.
 */
export const publishPaperLink = async (
    kbId: string,
    payload: { blueprint: Blueprint; questions: RawPaperQuestion[] },
    options: PaperPdfOptions = {},
    generationId?: string
): Promise<PublishedPaperLink> => {
    const { data } = await authenticatedAxiosInstance.post<PublishedPaperLink>(
        `${BASE}/bases/${kbId}/paper/publish`,
        {
            blueprint: payload.blueprint,
            questions: payload.questions,
            include_answer_key: Boolean(options.includeAnswerKey),
            show_marks: options.showMarks ?? true,
            set_label: options.setLabel || null,
            generation_id: generationId ?? null,
            ...layoutFields(options),
        }
    );
    return data;
};

/** Publish a finished paper straight from the history. */
export const publishGenerationLink = async (
    generationId: string,
    options: PaperPdfOptions = {}
): Promise<PublishedPaperLink> => {
    const { data } = await authenticatedAxiosInstance.post<PublishedPaperLink>(
        `${BASE}/generations/${generationId}/paper/publish`,
        {
            include_answer_key: Boolean(options.includeAnswerKey),
            show_marks: options.showMarks ?? true,
            set_label: options.setLabel || null,
            ...layoutFields(options),
        }
    );
    return data;
};

/**
 * Make `auto_evaluation_json` acceptable to assessment_service.
 *
 * The two casings are BOTH correct, for different consumers:
 *   • Java `MCQEvaluationDTO.MCQData` expects `correctOptionIds`. The nested
 *     static class carries NO @JsonNaming annotation — Jackson does not inherit
 *     the outer class's SnakeCaseStrategy — and unknown properties are ignored,
 *     so a snake_case key does not error: it leaves the list NULL and the server
 *     later dies with
 *     `Cannot invoke "java.util.List.contains(Object)" because
 *      getCorrectOptionIds() is null`.
 *   • The AI-center preview reader (ai-center/-utils/helper.ts) reads
 *     `correct_option_ids`, which is what question_format emits.
 *
 * So we emit BOTH keys rather than converting the shared formatter, which would
 * break that reader. Only MCQ is affected — ONE_WORD and LONG_ANSWER store their
 * value under `answer`, a single word that is identical in either convention.
 */
const withJavaEvaluationKeys = (questions: PaperQuestion[]): PaperQuestion[] =>
    questions.map((q) => {
        const raw = q.auto_evaluation_json;
        if (!raw || typeof raw !== 'string') return q;
        try {
            const parsed = JSON.parse(raw) as {
                type?: string;
                data?: Record<string, unknown>;
            };
            const data = parsed?.data;
            if (!data) return q;
            const snake = data['correct_option_ids'];
            if (Array.isArray(snake) && data['correctOptionIds'] === undefined) {
                data['correctOptionIds'] = snake;
                return { ...q, auto_evaluation_json: JSON.stringify(parsed) };
            }
            return q;
        } catch {
            // Malformed evaluation JSON is the validator's problem, not this
            // function's — pass it through unchanged rather than dropping it.
            return q;
        }
    });

/**
 * Generated question HTML carries its maths as `$…$` / `\(…\)` source — the
 * reader (MathPix, the model) writes it that way. The bank's own convention,
 * and what the editor, the question-bank views and the AI evaluator
 * (`[data-latex]`) all understand, is the `.math-inline` node with the source
 * on `data-latex`, the way Vsmart Extract stores it. Rendered here for every
 * caller so a digitised paper does not show `$2 \mathrm{x}-5 \mathrm{y}=7$`
 * verbatim in the assessment (2026-09-22). Text without delimiters is
 * returned untouched.
 */
const withRenderedMath = (questions: PaperQuestion[]): PaperQuestion[] => {
    const rich = <T extends { content?: string | null } | null | undefined>(text: T): T =>
        text && typeof text.content === 'string' && text.content
            ? { ...text, content: renderLatexDelimiters(text.content) }
            : text;
    return questions.map((q) => ({
        ...q,
        text: rich(q.text),
        explanation_text: rich(q.explanation_text),
        options: q.options?.map((o) => ({
            ...o,
            text: rich(o.text),
            explanation_text: rich(o.explanation_text),
        })),
    }));
};

/**
 * The bank stores each explanation as its own row with `content NOT NULL`; the
 * question builder sends `""` for "no explanation". A generator that emits
 * `null` (a digitised paper has none — 2026-09-20, all 64 questions refused)
 * must not sink the whole paper, so the empty string is applied here for every
 * caller rather than in each of them.
 */
const withBankSafeExplanation = (questions: PaperQuestion[]): PaperQuestion[] =>
    questions.map((q) =>
        q.explanation_text && q.explanation_text.content == null
            ? { ...q, explanation_text: { ...q.explanation_text, content: '' } }
            : q
    );

/**
 * Save to the institute's question bank.
 *
 * Posts AddQuestionPaperDTO directly rather than going through
 * `addQuestionPaper()` in assessment/question-papers/-utils. That helper takes
 * the FE's own MyQuestionPaperFormInterface and re-derives the DTO from it —
 * round-tripping through that form shape would drop the <img> markup and the
 * auto_evaluation_json the generator already produced. ai_service returns the
 * exact QuestionDTO array this endpoint expects, so it is passed through intact
 * apart from the evaluation-key fix above.
 */
export const savePaperToQuestionBank = async (payload: {
    title: string;
    questions: PaperQuestion[];
    levelId?: string;
    subjectId?: string;
    // The endpoint answers with `saved_question_paper_id` — NOT `id`. Naming it
    // here keeps callers from reading a field that is always undefined.
}): Promise<{ saved_question_paper_id?: string } | undefined> => {
    const instituteId = getInstituteId();
    const { data } = await authenticatedAxiosInstance.post(ADD_QUESTION_PAPER, {
        title: payload.title,
        institute_id: instituteId,
        level_id: payload.levelId ?? null,
        subject_id: payload.subjectId ?? null,
        questions: withBankSafeExplanation(
            withJavaEvaluationKeys(withRenderedMath(payload.questions))
        ),
    });
    return data;
};

// ---- History: what this knowledge base has produced -------------------------

/** Newest first. Payloads omitted — fetch one record for the blueprint/result. */
export const listGenerations = async (
    kbId: string,
    artifactType?: string
): Promise<KbGeneration[]> => {
    const { data } = await authenticatedAxiosInstance.get<{ generations: KbGeneration[] }>(
        `${BASE}/bases/${kbId}/generations`,
        { params: artifactType ? { artifact_type: artifactType } : undefined }
    );
    return data.generations ?? [];
};

/** The full record, including the plan Resume restores. */
export const getGeneration = async (generationId: string): Promise<KbGenerationDetail> => {
    const { data } = await authenticatedAxiosInstance.get<KbGenerationDetail>(
        `${BASE}/generations/${generationId}`
    );
    return data;
};

/** Record where an artifact ended up once saved, so history can link to it. */
export const markGenerationSaved = async (
    generationId: string,
    externalId?: string
): Promise<void> => {
    await authenticatedAxiosInstance.patch(`${BASE}/generations/${generationId}`, {
        status: 'SAVED',
        external_id: externalId ?? null,
        external_type: 'QUESTION_PAPER',
    });
};

export const deleteGeneration = async (generationId: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(`${BASE}/generations/${generationId}`);
};
