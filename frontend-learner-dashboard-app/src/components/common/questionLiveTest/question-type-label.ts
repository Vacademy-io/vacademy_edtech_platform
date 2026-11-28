import type { TFunction } from "i18next";
import { QUESTION_TYPES } from "@/types/assessment";

/** i18n key (questionTest namespace) of each question type's friendly name. */
const QUESTION_TYPE_LABEL_KEYS: Partial<Record<string, string>> = {
  [QUESTION_TYPES.MCQS]: "questionDisplay.types.MCQS",
  [QUESTION_TYPES.MCQM]: "questionDisplay.types.MCQM",
  [QUESTION_TYPES.TRUE_FALSE]: "questionDisplay.types.TRUE_FALSE",
  [QUESTION_TYPES.ONE_WORD]: "questionDisplay.types.ONE_WORD",
  [QUESTION_TYPES.LONG_ANSWER]: "questionDisplay.types.LONG_ANSWER",
  [QUESTION_TYPES.NUMERIC]: "questionDisplay.types.NUMERIC",
  [QUESTION_TYPES.CODING]: "questionDisplay.types.CODING",
  [QUESTION_TYPES.CBE_RESPONSE]: "questionDisplay.types.CBE_RESPONSE",
};

/** The learner-facing name of a question type — never the raw enum. */
export function questionTypeLabel(type: string | null | undefined, t: TFunction): string {
  const key = type ? QUESTION_TYPE_LABEL_KEYS[type] : undefined;
  return key ? t(key) : String(type ?? "").replace(/_/g, " ");
}
