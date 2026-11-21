/** Question types the quiz viewer renders as tick-any-number checkboxes. */
export const isMultiSelectQuestion = (questionType: string | undefined): boolean =>
  questionType === "MCQM" || questionType === "CMCQM";

/**
 * Share of a question's marks a partial-marking quiz awards for a not-fully-correct
 * answer: picked / key-size when the learner chose only correct options but not all of
 * them (a 1-mark question with two correct options gives 0.5 per option), and 0 as soon
 * as any wrong option is picked. Mirrors the server's
 * AutoEvaluationScorer.partialCreditFraction so the Quiz Results tab agrees.
 */
export const partialCreditFraction = (
  answer: string | number | (string | number)[] | null | undefined,
  correctIds: (string | number)[],
): number => {
  if (answer == null || correctIds.length < 2) return 0;
  const selected = new Set((Array.isArray(answer) ? answer : [answer]).map(String));
  const correct = new Set(correctIds.map(String));
  if (selected.size === 0) return 0;
  for (const id of selected) if (!correct.has(id)) return 0;
  return selected.size / correct.size;
};
