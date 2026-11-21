/**
 * What a choice / text question slide shows after the learner submits, when the
 * slide's author left "Show correct answer after submit" on (the default).
 *
 * Server: admin_core `QuestionSlideResultDTO` (snake_case), returned by
 * GET .../question-slide/my-result?slide_id=. The verdict and the answer key are
 * only filled after a submission and only when the setting is on, so the key is
 * never on the device before the learner has answered.
 */
import type { InstantVerdict } from "./quiz-instant-feedback";

export interface QuestionSlideResult {
  slide_id?: string;
  submitted: boolean;
  /** The author's setting. Off: the slide behaves as before (explanation only). */
  show_answer: boolean;
  /** CORRECT | WRONG | SKIPPED, or null (hidden, not submitted, or a long answer). */
  verdict?: string | null;
  attempt_number?: number | null;
  attempts?: number;
  correct_option_ids?: string[];
  /** Numeric: accepted values. One word / long answer: the model answer. */
  correct_answers?: string[];
  explanation_html?: string | null;
  /** The learner's own latest answer as submitted: `{questionName, selectedOptions}`. */
  response_json?: string | null;
}

export type OptionReview = "correct" | "wrong" | null;

interface OptionLike {
  id: string;
  text?: { content?: string | null } | null;
}

const CHOICE_TYPES = new Set(["MCQS", "MCQM", "TRUE_FALSE", "CMCQS", "CMCQM"]);

export const isChoiceQuestion = (type?: string) => CHOICE_TYPES.has(type ?? "");

/**
 * The panel to show for this result, or null to keep the slide as before: the
 * setting is off, nothing was submitted, or there is nothing to tell (a choice
 * question with no answer key).
 */
export function instantVerdictOf(result: QuestionSlideResult | null | undefined): InstantVerdict | null {
  if (!result?.submitted || !result.show_answer) return null;
  if (result.verdict === "CORRECT") return "correct";
  if (result.verdict === "WRONG") return "incorrect";
  if (!result.verdict && (result.correct_answers?.length ?? 0) > 0) return "compare";
  return null;
}

/** Colour of one option once the answer is checked: the right ones green, a wrong pick red. */
export function optionReview(
  optionId: string,
  selectedIds: string[],
  result: QuestionSlideResult | null | undefined,
): OptionReview {
  if (result?.correct_option_ids?.includes(optionId)) return "correct";
  if (selectedIds.includes(optionId)) return "wrong";
  return null;
}

/** The correct answer as the panel renders it: option HTML for choice questions, else the key. */
export function correctAnswerHtml(
  questionType: string | undefined,
  result: QuestionSlideResult | null | undefined,
  options: OptionLike[] | undefined,
): string[] {
  if (!result) return [];
  if (isChoiceQuestion(questionType)) {
    return (result.correct_option_ids ?? [])
      .map((id) => options?.find((option) => option.id === id)?.text?.content ?? "")
      .filter((html) => html.trim() !== "");
  }
  return (result.correct_answers ?? []).filter((answer) => answer.trim() !== "");
}

/** A long answer has a model answer to compare with, not a key. */
export const answerKindOf = (questionType?: string): "key" | "model" =>
  questionType === "LONG_ANSWER" ? "model" : "key";

/** The options of the learner's own latest answer, to tell whether it is the one on screen. */
export function submittedOptionsOf(
  result: QuestionSlideResult | null | undefined,
): { id: string; name: string }[] {
  if (!result?.response_json) return [];
  try {
    const parsed = JSON.parse(result.response_json) as { selectedOptions?: unknown };
    if (!Array.isArray(parsed?.selectedOptions)) return [];
    return parsed.selectedOptions
      .filter((o): o is { id?: unknown; name?: unknown } => !!o && typeof o === "object")
      .map((o) => ({ id: String(o.id ?? ""), name: String(o.name ?? "") }));
  } catch {
    return [];
  }
}
