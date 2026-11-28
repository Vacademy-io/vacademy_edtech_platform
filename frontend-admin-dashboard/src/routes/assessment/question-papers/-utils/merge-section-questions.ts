/**
 * Adding questions to an assessment section without destroying what is already there.
 *
 * Every "add questions" path in the wizard used to call
 *   setValue(`section.N.adaptive_marking_for_each_question`, incoming)
 * which REPLACES. So an admin who imported a saved paper and then ran an AI tool on the
 * same section silently lost the first set — no warning, no undo. Only the knowledge-base
 * dialog appended, and it carried a comment explaining why.
 *
 * This helper is that behaviour, shared. An empty section is unchanged (the incoming list
 * becomes the list). A populated one keeps both, minus anything already present.
 */

/**
 * Deliberately only `questionId` and no index signature: an index signature would force
 * every caller's concrete question shape to satisfy `[key: string]: unknown`, and the
 * four call sites all pass differently-shaped objects.
 */
interface SectionQuestion {
    questionId?: string;
}

export interface MergeResult<T> {
    merged: T[];
    /** How many of the incoming questions were actually new. */
    addedCount: number;
    /** How many were already in the section and were skipped. */
    duplicateCount: number;
    /** How many the section already held before this insert. */
    existingCount: number;
}

export const mergeSectionQuestions = <T extends SectionQuestion>(
    existing: T[] | undefined,
    incoming: T[]
): MergeResult<T> => {
    const current = existing ?? [];
    // Re-adding the same saved paper twice is a real thing an admin does by accident;
    // ids make it cheap to ignore rather than showing the question twice in the paper.
    const seen = new Set(current.map((question) => question.questionId).filter(Boolean));

    const fresh = incoming.filter((question) => {
        if (!question.questionId) return true;
        if (seen.has(question.questionId)) return false;
        seen.add(question.questionId);
        return true;
    });

    return {
        merged: [...current, ...fresh],
        addedCount: fresh.length,
        duplicateCount: incoming.length - fresh.length,
        existingCount: current.length,
    };
};

/** One line describing what an insert did, for the success toast. */
export const describeMerge = <T extends SectionQuestion>(
    result: MergeResult<T>,
    sectionName?: string
): string => {
    const where = sectionName ? ` to ${sectionName}` : '';
    if (result.existingCount === 0) {
        return `Added ${result.addedCount} question${result.addedCount === 1 ? '' : 's'}${where}`;
    }
    const skipped =
        result.duplicateCount > 0 ? `, skipped ${result.duplicateCount} already there` : '';
    return `Added ${result.addedCount} question${result.addedCount === 1 ? '' : 's'}${where}${skipped}. The section now has ${result.merged.length}.`;
};
