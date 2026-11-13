/**
 * negativeMarkingPercentage values for a question's marking_json.
 *
 * The assessment service grades a wrong answer as:
 *   - NUMERIC: -(negativeMark * negativeMarkingPercentage / 100)
 *   - MCQS / MCQM: -negativeMark (the percentage is not read)
 *
 * So a NUMERIC question needs 100 whenever a penalty is set, or "+4 / -1" costs
 * 0.25 instead of 1. Questions saved before this fix keep their stored value
 * until an admin saves the question's marking again.
 */

/** 100 when a penalty is set, else 0. Only the penalty matters, not the question's mark. */
export const numericNegativeMarkingPercentage = (penalty: unknown): number => {
    const value = Number(penalty);
    return Number.isFinite(value) && value > 0 ? 100 : 0;
};

/**
 * The negativeMarkingPercentage the step-2 marking writers store for a question.
 * NUMERIC gets the value its grader needs; every other type keeps the value the
 * app has always written (penalty as a percentage of the mark, '' when unset).
 */
export const negativeMarkingPercentageFor = (
    questionType: string | null | undefined,
    mark: string | number | null | undefined,
    penalty: string | number | null | undefined
): number | '' => {
    if (questionType === 'NUMERIC') return numericNegativeMarkingPercentage(penalty);
    return mark && penalty ? (Number(penalty) / Number(mark)) * 100 : '';
};
