import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { FILTER_QUESTION_BANK_QUESTIONS } from '@/constants/urls';

/**
 * Browsing individual questions, rather than whole question papers.
 *
 * The paper-level equivalent is `getQuestionPaperDataWithFilters`. That one can only
 * answer "which papers exist"; a teacher wanting "the medium-difficulty numericals this
 * book produced" had no way to ask, which is why every AI generation was a one-shot
 * artifact instead of something an institute accumulates.
 */

export interface QuestionBankFilters {
    name?: string;
    /** Knowledge bases the question was generated from. */
    kb_ids?: string[];
    /** Topic / subtopic nodes within those knowledge bases. */
    kb_node_ids?: string[];
    /** MANUAL | UPLOAD | AI | KNOWLEDGE_BASE */
    source_types?: string[];
    question_types?: string[];
    difficulties?: string[];
    tag_ids?: string[];
    statuses?: string[];
    /** Already in the section being filled — hidden from the picker. */
    exclude_question_ids?: string[];
}

/** Mirrors assessment_service QuestionDTO for the fields the picker needs. */
export interface QuestionBankQuestion {
    id: string;
    question_type?: string | null;
    question_response_type?: string | null;
    text?: { id?: string | null; type?: string | null; content?: string | null } | null;
    explanation_text?: { content?: string | null } | null;
    auto_evaluation_json?: string | null;
    ai_difficulty_level?: string | null;
    source_type?: string | null;
    /** JSON string: kb_id, topic, node_ids, source_page, generation_id. */
    source_meta?: string | null;
    options?: Array<{
        id?: string | null;
        preview_id?: string | null;
        text?: { content?: string | null } | null;
    }>;
    [key: string]: unknown;
}

export interface QuestionBankPage {
    content: QuestionBankQuestion[];
    total_elements?: number;
    total_pages?: number;
    number?: number;
    last?: boolean;
}

export const filterQuestionBank = async (
    instituteId: string,
    filters: QuestionBankFilters,
    pageNo = 0,
    pageSize = 20
): Promise<QuestionBankPage> => {
    const { data } = await authenticatedAxiosInstance.post<QuestionBankPage>(
        FILTER_QUESTION_BANK_QUESTIONS,
        filters,
        { params: { instituteId, pageNo, pageSize } }
    );
    return data;
};

/** The provenance blob, parsed. Returns null for hand-written questions. */
export const parseSourceMeta = (
    question: QuestionBankQuestion
): {
    kb_id?: string;
    topic?: string;
    section?: string;
    source_page?: number | null;
    node_ids?: string[];
} | null => {
    if (!question.source_meta) return null;
    try {
        return JSON.parse(question.source_meta);
    } catch {
        // Malformed provenance is not worth failing a picker over — the question is
        // still perfectly usable, it just cannot show where it came from.
        return null;
    }
};
