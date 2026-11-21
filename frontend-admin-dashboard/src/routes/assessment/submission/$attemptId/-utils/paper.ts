/**
 * The paper text for the Submission page comes from the existing staff endpoint
 * `questions-of-sections` (contract §5.2 A1p, cut C2). Only the fields the cards read are
 * typed here.
 */
export interface PaperOption {
    id: string;
    text?: { content?: string | null } | null;
}

export interface PaperQuestion {
    question_id: string;
    question_type?: string | null;
    question?: { content?: string | null } | null;
    parent_rich_text?: { content?: string | null } | null;
    options_with_explanation?: PaperOption[] | null;
    explanation_text?: { content?: string | null } | null;
    evaluation_json?: string | null;
    auto_evaluation_json?: string | null;
    marking_json?: string | null;
}

export type Paper = Record<string, PaperQuestion[] | undefined>;

export const paperQuestion = (
    paper: Paper | null | undefined,
    sectionId: string,
    questionId: string
): PaperQuestion | null => {
    if (!paper) return null;
    const inSection = paper[sectionId]?.find((q) => q.question_id === questionId);
    if (inSection) return inSection;
    for (const list of Object.values(paper)) {
        const q = list?.find((x) => x.question_id === questionId);
        if (q) return q;
    }
    return null;
};

const parseJson = (raw: string | null | undefined): Record<string, unknown> | null => {
    if (!raw) return null;
    try {
        const v = JSON.parse(raw);
        return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    } catch {
        return null;
    }
};

/** The model answer of a long / one-word question ("data.answer.content" or "data.answer"). */
export const modelAnswerOf = (autoEvaluationJson: string | null | undefined): string | null => {
    const data = parseJson(autoEvaluationJson)?.data as Record<string, unknown> | undefined;
    const answer = data?.answer;
    if (typeof answer === 'string') return answer;
    if (answer && typeof answer === 'object') {
        const content = (answer as { content?: unknown }).content;
        return typeof content === 'string' ? content : null;
    }
    return null;
};

/** Correct option ids from the paper's evaluation JSON (fallback when A1d has none). */
export const correctOptionIdsOf = (q: PaperQuestion | null | undefined): string[] => {
    const data = parseJson(q?.evaluation_json ?? q?.auto_evaluation_json)?.data as
        | { correctOptionIds?: unknown }
        | undefined;
    return Array.isArray(data?.correctOptionIds)
        ? data!.correctOptionIds.filter((x): x is string => typeof x === 'string')
        : [];
};

/** "A", "B", … for option n. */
export const optionLetter = (index: number): string => String.fromCharCode(65 + (index % 26));
