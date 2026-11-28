import type { Question, Section } from '../types/question';

/**
 * The printed order of one saved OMR paper set: which question is number `no`,
 * and its options in printed order (option_ids[0] is A). Mirrors the backend's
 * set paper (GET omr/v1/sets/{setId}/paper); only the fields the export needs.
 */
export interface OmrPaperOrder {
    set_code: string;
    items: Array<{
        no: number;
        question_id: string;
        section_id: string;
        option_ids: string[];
    }>;
}

/** Set code "B" -> the export's 0-based set number (1), which its header prints as "Set B". */
export const omrSetNumber = (setCode: string): number =>
    Math.max(0, (setCode || 'A').trim().toUpperCase().charCodeAt(0) - 65);

/**
 * Rebuild the export's sections in the saved order of one OMR set instead of a
 * random shuffle: questions ordered and numbered by the set's items, options
 * ordered by option_ids (so the answer key's letters match the bubble sheet).
 * Items are section-contiguous, so a new section starts whenever the item's
 * section changes. Questions the set does not list are left out.
 */
export const orderSectionsForOmrSet = (sections: Section[], paper: OmrPaperOrder): Section[] => {
    const questionById = new Map<string, Question>();
    const sectionById = new Map<string, Section>();
    for (const section of sections) {
        sectionById.set(section.id, section);
        for (const question of section.questions) questionById.set(question.question_id, question);
    }

    const out: Section[] = [];
    const items = [...paper.items].sort((a, b) => a.no - b.no);
    for (const item of items) {
        const question = questionById.get(item.question_id);
        if (!question) continue;

        const optionById = new Map(
            question.options_with_explanation.map((option) => [String(option.id), option])
        );
        const printed = item.option_ids
            .map((id) => optionById.get(String(id)))
            .filter((option): option is Question['options_with_explanation'][number] => !!option);
        const listed = new Set(item.option_ids.map(String));
        const unlisted = question.options_with_explanation.filter(
            (option) => !listed.has(String(option.id))
        );

        const ordered: Question = {
            ...question,
            question_order: item.no,
            options_with_explanation: [...printed, ...unlisted],
        };

        const sectionId = item.section_id || question.section_id;
        let current = out[out.length - 1];
        if (!current || current.id !== sectionId) {
            const meta = sectionById.get(sectionId);
            current = {
                id: sectionId,
                title: meta?.title ?? '',
                description: meta?.description ?? '',
                totalMarks: meta?.totalMarks ?? 0,
                duration: meta?.duration ?? 0,
                questions: [],
            };
            out.push(current);
        }
        current.questions.push(ordered);
    }
    return out;
};
