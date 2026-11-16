/**
 * Optional ± tolerance of a NUMERIC question (accounting papers accept rounding,
 * e.g. ±1). It is stored next to the answers in the question's auto evaluation JSON:
 * `data.tolerance` beside `data.validAnswers` (assessments, question and video slides)
 * or `tolerance` beside `correctAnswers` (quiz slides). Absent or 0 = exact match.
 */

/** A tolerance worth saving: a finite number above 0, otherwise undefined (exact match). */
export const normaliseNumericTolerance = (value: unknown): number | undefined => {
    if (value === null || value === undefined || value === '') return undefined;
    const parsed = typeof value === 'number' ? value : Number(String(value).trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/** The tolerance stored in an auto evaluation JSON string, or undefined when there is none. */
export const readNumericTolerance = (autoEvaluationJson?: string | null): number | undefined => {
    if (!autoEvaluationJson) return undefined;
    try {
        const parsed = JSON.parse(autoEvaluationJson);
        return normaliseNumericTolerance(parsed?.tolerance ?? parsed?.data?.tolerance);
    } catch {
        return undefined;
    }
};

/** `{ tolerance }` to spread into a key object, or nothing, so keys without one stay byte-identical. */
export const toleranceEntry = (value: unknown): { tolerance?: number } => {
    const tolerance = normaliseNumericTolerance(value);
    return tolerance === undefined ? {} : { tolerance };
};
