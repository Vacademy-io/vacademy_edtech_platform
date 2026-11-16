/**
 * Optional ± tolerance of a NUMERIC question (accounting papers accept rounding,
 * e.g. ±1). The admin stores it beside the answers in auto_evaluation_json:
 * `tolerance` beside a quiz slide's `correctAnswers`, or `data.tolerance` beside
 * `data.validAnswers`. Absent or 0 = exact match, judged exactly as before.
 *
 * Mirrors AutoEvaluationScorer.numericMatch on admin_core and
 * NumericAnswerMatcher on assessment_service, so the learner's instant verdict
 * agrees with the stored one.
 */

const isNumericType = (questionType: string | undefined): boolean =>
  questionType === "NUMERIC" || questionType === "CNUMERIC";

/** A number from a typed or stored answer, ignoring spaces and thousands separators. */
export const parseNumericAnswer = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.replace(/[\s,]/g, "");
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

interface NumericKey {
  answers: number[];
  tolerance: number;
}

/** The numeric answers and their tolerance, or null when the key has no tolerance. */
export const readNumericToleranceKey = (
  autoEvaluationJson: string | undefined | null,
): NumericKey | null => {
  if (!autoEvaluationJson) return null;
  try {
    const parsed = JSON.parse(autoEvaluationJson);
    const tolerance = parseNumericAnswer(parsed?.tolerance ?? parsed?.data?.tolerance);
    if (tolerance === null || tolerance <= 0) return null;
    const raw = parsed?.correctAnswers ?? parsed?.data?.validAnswers ?? parsed?.data?.correctAnswer;
    const list: unknown[] = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    const answers = list.map(parseNumericAnswer).filter((n): n is number => n !== null);
    return answers.length > 0 ? { answers, tolerance } : null;
  } catch {
    return null;
  }
};

/**
 * |given - answer| <= tolerance for any answer. The slack covers binary floating point
 * only (1.1 - 0.1 is 1.0000000000000002): a few units in the last place, so it never
 * accepts an answer the server (which compares exact decimals) would mark wrong.
 */
export const isWithinTolerance = (given: number, answers: number[], tolerance: number): boolean =>
  answers.some((answer) => {
    const slack = 8 * Number.EPSILON * Math.max(1, Math.abs(answer), Math.abs(given), tolerance);
    return Math.abs(given - answer) <= tolerance + slack;
  });

/**
 * The verdict for a numeric question with a tolerance, or null when the question is
 * not numeric or has no tolerance, in which case the caller keeps its existing rule.
 */
export const numericToleranceVerdict = (
  questionType: string | undefined,
  autoEvaluationJson: string | undefined | null,
  answer: unknown,
): boolean | null => {
  if (!isNumericType(questionType)) return null;
  const key = readNumericToleranceKey(autoEvaluationJson);
  if (!key) return null;
  const given = parseNumericAnswer(Array.isArray(answer) ? answer[0] : answer);
  return given !== null && isWithinTolerance(given, key.answers, key.tolerance);
};
