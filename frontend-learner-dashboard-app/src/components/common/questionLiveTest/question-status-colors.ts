import type { TFunction } from "i18next";
import type { QuestionState } from "@/types/assessment";

export type QuestionStatus =
  | "answered"
  | "answered-marked"
  | "marked"
  | "not-answered"
  | "not-visited";

export const getQuestionStatus = (state?: QuestionState): QuestionStatus => {
  // Answered is checked before visited on purpose. `isVisited` is set by
  // navigation and `isAnswered` by the answer itself, and a restored attempt
  // can carry the second without the first — reporting such a question as
  // "not visited" would tell a learner their saved answer was lost.
  if (state?.isAnswered) {
    return state.isMarkedForReview ? "answered-marked" : "answered";
  }
  if (!state || !state.isVisited) return "not-visited";
  if (state.isMarkedForReview) return "marked";
  return "not-answered";
};

/**
 * Status colours are deliberately semantic rather than brand-tinted: the
 * primary scale is institute-themed (it can be green, blue, orange…), so
 * "answered" must not read as primary or a learner on a green-themed institute
 * cannot tell an answered question from the selected one.
 */
export const QUESTION_STATUS_GRID_CLASS: Record<QuestionStatus, string> = {
  answered: "bg-success-50 hover:bg-success-100 text-success-700 border-success-200",
  "answered-marked":
    "bg-violet-50 hover:bg-violet-100 text-violet-700 border-violet-200",
  marked: "bg-violet-50 hover:bg-violet-100 text-violet-700 border-violet-200",
  "not-answered": "bg-danger-50 hover:bg-danger-100 text-danger-600 border-danger-200",
  "not-visited": "bg-white hover:bg-neutral-100 text-neutral-600 border-neutral-200",
};

export const QUESTION_STATUS_LIST_CLASS: Record<QuestionStatus, string> = {
  answered: "border-success-200 bg-success-50",
  "answered-marked": "border-violet-200 bg-violet-50",
  marked: "border-violet-200 bg-violet-50",
  "not-answered": "border-danger-200 bg-danger-50",
  "not-visited": "border-neutral-200 bg-white",
};

/** Localized label for a question status — pass the `t` from `useTranslation("questionTest")`. */
export const getQuestionStatusLabel = (
  status: QuestionStatus,
  t: TFunction,
): string => {
  switch (status) {
    case "answered":
      return t("questionStatus.answered");
    case "answered-marked":
      return t("questionStatus.answeredMarked");
    case "marked":
      return t("questionStatus.marked");
    case "not-answered":
      return t("questionStatus.notAnswered");
    case "not-visited":
      return t("questionStatus.notVisited");
  }
};

export const QUESTION_LEGEND_ORDER: QuestionStatus[] = [
  "answered",
  "not-answered",
  "not-visited",
  "marked",
  "answered-marked",
];

/** Statuses that carry the "marked for review" dot in the corner of a chip. */
export const isMarkedStatus = (status: QuestionStatus): boolean =>
  status === "marked" || status === "answered-marked";
