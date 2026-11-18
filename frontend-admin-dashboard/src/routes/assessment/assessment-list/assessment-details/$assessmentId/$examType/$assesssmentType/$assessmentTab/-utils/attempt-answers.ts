/**
 * Pure helpers for the submission view (Submissions → ⋮ → View Submission):
 * read the learner's saved answer and the answer key out of the raw JSON the
 * report-detail and questions-of-sections endpoints return, for every question type.
 */

/** One question of one attempt as get-report-detail returns it (snake_case). */
export interface AttemptAnswerRow {
    question_id: string;
    question_type?: string | null;
    question_name?: string | null;
    /** question_wise_marks.response_json: `{ ..., responseData: { optionIds | answer | validAnswer } }`. */
    student_response_options?: unknown;
    /** auto_evaluation_json of the question (the key). */
    correct_options?: unknown;
    mark: number;
    answer_status?: string | null;
    time_taken_in_seconds?: number | null;
    evaluator_feedback?: string | null;
    ai_feedback?: string | null;
    /** JSON array of the AI's line-by-line marks: [{criteria_name, marks, max_marks?, reason}]. */
    ai_criteria_breakdown?: string | null;
    /** AUTO (null) / AI / AI_REVIEWED / TEACHER. */
    evaluation_source?: string | null;
    question_order?: number | null;
}

export interface SavedAnswer {
    optionIds: string[];
    /** ONE_WORD / LONG_ANSWER text. */
    text: string | null;
    /** NUMERIC value. */
    numeric: number | null;
}

const parseJson = (value: unknown): Record<string, unknown> | null => {
    if (value == null || value === '') return null;
    if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value !== 'string') return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

/** The learner's answer, whatever the question type. Missing pieces come back empty. */
export const parseSavedAnswer = (raw: unknown): SavedAnswer => {
    const root = parseJson(raw);
    const data = asRecord(root?.responseData) ?? root;
    const ids = data?.optionIds;
    const answer = data?.answer;
    const valid = data?.validAnswer;
    const numeric =
        typeof valid === 'number'
            ? valid
            : typeof valid === 'string' && valid.trim() !== '' && !isNaN(Number(valid))
              ? Number(valid)
              : null;
    return {
        optionIds: Array.isArray(ids) ? ids.map(String) : [],
        text: typeof answer === 'string' && answer.trim() !== '' ? answer : null,
        numeric,
    };
};

/** The key for a question that has no options: numeric values, the one word, the model answer. */
export const parseKeyText = (evaluationJson: unknown): string | null => {
    const data = asRecord(parseJson(evaluationJson)?.data);
    if (!data) return null;
    const valid = data.validAnswers;
    if (Array.isArray(valid) && valid.length > 0) return valid.map(String).join(' / ');
    const answer = data.answer;
    if (typeof answer === 'string' && answer.trim() !== '') return answer;
    const content = asRecord(answer)?.content;
    if (typeof content === 'string' && content.trim() !== '') return content;
    return null;
};

/** data.totalMark of a marking JSON (number or numeric text); null when absent. */
export const fullMarksOf = (markingJson?: string | null): number | null => {
    const total = asRecord(parseJson(markingJson)?.data)?.totalMark;
    const value = typeof total === 'number' ? total : Number(total);
    return total != null && total !== '' && Number.isFinite(value) ? value : null;
};

export const isChoiceQuestion = (questionType?: string | null) =>
    ['MCQS', 'MCQM', 'TRUE_FALSE', 'CMCQS', 'CMCQM'].includes((questionType ?? '').toUpperCase());

/** Marks a teacher may enter: 0 up to the question's full marks (when known). */
export const clampMarks = (marks: number, fullMarks: number | null): number => {
    const floor = Math.max(0, marks);
    return fullMarks != null && fullMarks > 0 ? Math.min(floor, fullMarks) : floor;
};

export type MarksSourceKind = 'auto' | 'ai' | 'aiReviewed' | 'teacher' | 'manual';

export const marksSourceKind = (source?: string | null): MarksSourceKind => {
    switch ((source ?? '').toUpperCase()) {
        case 'AI':
            return 'ai';
        case 'AI_REVIEWED':
            return 'aiReviewed';
        case 'TEACHER':
            return 'teacher';
        case 'MANUAL':
            return 'manual';
        default:
            return 'auto';
    }
};

/** Report rows of a section in paper order. */
export const sortByPaperOrder = <T extends { question_order?: number | null }>(rows: T[]): T[] =>
    [...rows].sort(
        (a, b) =>
            (a.question_order ?? Number.MAX_SAFE_INTEGER) -
            (b.question_order ?? Number.MAX_SAFE_INTEGER)
    );

export interface CriteriaLine {
    criteria_name?: string;
    marks?: number;
    max_marks?: number;
    reason?: string;
}

/** The AI's line-by-line marks for a written / CBT answer; empty when absent or unreadable. */
export const parseCriteria = (raw: unknown): CriteriaLine[] => {
    let value: unknown = raw;
    if (typeof raw === 'string') {
        try {
            value = JSON.parse(raw);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(value)) return [];
    return value
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map((c) => ({
            criteria_name: typeof c.criteria_name === 'string' ? c.criteria_name : undefined,
            marks: typeof c.marks === 'number' ? c.marks : Number(c.marks) || 0,
            max_marks: typeof c.max_marks === 'number' ? c.max_marks : undefined,
            reason: typeof c.reason === 'string' ? c.reason : undefined,
        }));
};
