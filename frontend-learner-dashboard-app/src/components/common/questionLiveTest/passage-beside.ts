/**
 * "Show passage beside the question": a per-test option of the default exam
 * screen, stored in the assessment's `exam_interface` as
 * `passage_beside_question: true` (assessment_service ExamInterfaceService).
 * Absent, null or anything but `true` = today's layout (passage above the
 * question). Pure helpers, no React: unit-tested on their own.
 */
import { htmlToPlainText } from "../../cbe/types";

export const PASSAGE_BESIDE_QUESTION_KEY = "passage_beside_question";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** True only when the test turned the option on. */
export const passageBesideQuestion = (examInterface: unknown): boolean =>
  isPlainObject(examInterface) && examInterface[PASSAGE_BESIDE_QUESTION_KEY] === true;

/** True when `exam_interface` names a theme (a preset other than the default screen). */
export const hasExamTheme = (examInterface: unknown): boolean => {
  if (!isPlainObject(examInterface)) return false;
  const preset = examInterface.preset;
  return typeof preset === "string" && preset !== "" && preset !== "default";
};

/**
 * `exam_interface` with any theme dropped (the default screen), keeping the
 * default screen's own display option. null when nothing is left.
 */
export const withoutExamTheme = (
  examInterface: unknown,
): { [PASSAGE_BESIDE_QUESTION_KEY]: true } | null =>
  passageBesideQuestion(examInterface) ? { [PASSAGE_BESIDE_QUESTION_KEY]: true } : null;

/** A passage worth a pane of its own: visible text, an image, a table or an svg. */
export const hasVisiblePassage = (html: string | null | undefined): boolean =>
  !!html && (htmlToPlainText(html) !== "" || /<(img|table|svg)\b/i.test(html));

/**
 * Whether the current question is drawn as passage | question. Only on the
 * default screen at md and wider, never for a Spreadsheet & Written Response
 * question (it has its own split), and only when the passage has content.
 */
export const shouldSplitPassage = ({
  examInterface,
  isCompact,
  isCbe,
  passageHtml,
}: {
  examInterface: unknown;
  isCompact: boolean;
  isCbe: boolean;
  passageHtml: string | null | undefined;
}): boolean =>
  !isCompact && !isCbe && passageBesideQuestion(examInterface) && hasVisiblePassage(passageHtml);
