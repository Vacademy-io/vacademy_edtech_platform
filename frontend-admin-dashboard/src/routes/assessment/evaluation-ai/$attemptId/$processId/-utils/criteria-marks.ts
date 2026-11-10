/**
 * One grading-breakdown line's marks as "awarded / max".
 *
 * The copy-check pipeline stores each criterion's ceiling as `max`
 * (ai_service validator.attach_criteria_max, matched against the rubric the
 * question was graded with; CBE rubrics come from the marking scheme). The
 * question-slide grader returns it as `max_marks`. Both are read; a line
 * whose criterion matched no rubric criterion (max null) or an evaluation
 * from before the field existed shows the awarded marks alone.
 */

export interface CriterionMarksLike {
    marks?: number | string | null;
    max?: number | string | null;
    max_marks?: number | string | null;
}

const toNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

/** The criterion's maximum, or null when the evaluation does not carry one. */
export function criterionMax(criterion: CriterionMarksLike | null | undefined): number | null {
    return toNumber(criterion?.max) ?? toNumber(criterion?.max_marks);
}

/**
 * "1.5 / 2", or "1.5" without a known maximum (awarded marks to one decimal, as before).
 * The maximum is rounded to two decimals with trailing zeros dropped, so a scaled
 * ceiling such as 3.3333 reads "3.33" and stays short in its no-wrap cell.
 */
export function formatCriterionMarks(criterion: CriterionMarksLike | null | undefined): string {
    const awarded = (toNumber(criterion?.marks) ?? 0).toFixed(1);
    const max = criterionMax(criterion);
    return max === null ? awarded : `${awarded} / ${Number(max.toFixed(2))}`;
}
