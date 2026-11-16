/**
 * "Show answer after each question" (quiz study mode): the verdict, the correct
 * answer and the explanation shown when a learner checks one question.
 *
 * Pure, so it can be tested without React. The quiz viewer marks from the answer
 * key it already holds when it has one, and asks the server
 * (POST /learner-tracking/quiz-attempt/v1/check-answer) only when the key was
 * withheld from the learner app.
 */

export type InstantVerdict = "correct" | "incorrect" | "compare";

export interface InstantFeedback {
  /** "compare": no automatic verdict (written answers); the learner compares with the model answer. */
  verdict: InstantVerdict;
  /** Option ids keyed correct, on choice questions. */
  correctOptionIds: string[];
  /** The expected answer as text, on typed questions (numeric value or model answer). */
  correctAnswerText: string | null;
  /** The author's explanation (HTML), when there is one. */
  explanationHtml: string | null;
}

export interface FeedbackQuestion {
  question_type?: string;
  auto_evaluation_json?: string;
  options?: Array<{ id: string }>;
  explanation_text?: { content?: string } | null;
}

export type FeedbackAnswer = string | number | string[] | undefined | null;

/** What the check-answer route returns (snake_case, as the server serialises it). */
export interface CheckAnswerResponse {
  correct?: boolean | null;
  correct_option_ids?: string[] | null;
  correct_answer_text?: string | null;
  explanation?: string | null;
}

const MULTI_SELECT = new Set(["MCQM", "CMCQM"]);
const NUMERIC = new Set(["NUMERIC", "CNUMERIC"]);
const SHORT_TEXT = new Set(["ONE_WORD", "TEXT"]);
const LONG_TEXT = new Set(["LONG_ANSWER"]);

export const isNumericQuestion = (type?: string) => NUMERIC.has(type ?? "");
const isTypedQuestion = (type?: string) =>
  NUMERIC.has(type ?? "") || SHORT_TEXT.has(type ?? "") || LONG_TEXT.has(type ?? "");

const isBlank = (answer: FeedbackAnswer): boolean =>
  answer == null ||
  (typeof answer === "string" && answer.trim() === "") ||
  (Array.isArray(answer) && answer.length === 0);

/**
 * Whether a typed number matches one of the keyed values. The one place the instant
 * check compares numbers, so a tolerance rule can be added here alone: 2.50 and 2.5 agree.
 */
export const numericAnswerMatches = (given: FeedbackAnswer, accepted: string[]): boolean => {
  if (isBlank(given) || Array.isArray(given)) return false;
  const value = Number(String(given).trim());
  if (!Number.isFinite(value)) return false;
  return accepted.some((candidate) => {
    const expected = Number(String(candidate).trim());
    return Number.isFinite(expected) && expected === value;
  });
};

const normaliseText = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

/** A one-word answer matches when it is the keyed answer, ignoring case and extra spaces. */
export const textAnswerMatches = (given: FeedbackAnswer, accepted: string[]): boolean => {
  if (isBlank(given) || Array.isArray(given)) return false;
  const typed = normaliseText(String(given));
  return accepted.some((candidate) => normaliseText(String(candidate)) === typed);
};

const explanationOf = (question: FeedbackQuestion): string | null => {
  const html = question.explanation_text?.content ?? "";
  return html.replace(/<[^>]*>/g, "").trim() === "" && !/<img/i.test(html) ? null : html;
};

interface ParsedKey {
  correctAnswers: string[];
  modelAnswer: string | null;
}

/** The key the learner app holds for this question, or null when it was withheld or is unreadable. */
const readKey = (question: FeedbackQuestion): ParsedKey | null => {
  if (!question.auto_evaluation_json) return null;
  try {
    const parsed = JSON.parse(question.auto_evaluation_json);
    const raw: unknown[] = Array.isArray(parsed?.correctAnswers)
      ? parsed.correctAnswers
      : typeof parsed?.correctAnswers === "string" || typeof parsed?.correctAnswers === "number"
        ? [parsed.correctAnswers]
        : [];
    // A positional key (option indices) on a choice question means option ids; a numeric
    // question's key is the value itself, never a position.
    const positional =
      !isTypedQuestion(question.question_type) &&
      typeof raw[0] === "number" &&
      (question.options?.length ?? 0) > 0;
    const correctAnswers = raw.map((entry) =>
      positional && typeof entry === "number"
        ? String(question.options?.[entry]?.id ?? entry)
        : String(entry)
    );
    const answer = parsed?.data?.answer;
    const modelAnswer =
      typeof answer === "string" || typeof answer === "number"
        ? String(answer)
        : typeof answer?.content === "string"
          ? answer.content
          : null;
    if (correctAnswers.length === 0 && modelAnswer == null) return null;
    return { correctAnswers, modelAnswer };
  } catch {
    return null;
  }
};

/** Whether this question can be checked without asking the server. */
export const hasLocalAnswerKey = (question: FeedbackQuestion): boolean => readKey(question) != null;

/**
 * Feedback from the key the app already holds. Null when the key is not here (withheld
 * from the learner app): the caller then asks the server.
 */
export const feedbackFromLocalKey = (
  question: FeedbackQuestion,
  answer: FeedbackAnswer
): InstantFeedback | null => {
  const key = readKey(question);
  if (!key) return null;
  const type = question.question_type;
  const explanationHtml = explanationOf(question);

  if (NUMERIC.has(type ?? "")) {
    const accepted = key.correctAnswers.length > 0 ? key.correctAnswers : key.modelAnswer ? [key.modelAnswer] : [];
    return {
      verdict: numericAnswerMatches(answer, accepted) ? "correct" : "incorrect",
      correctOptionIds: [],
      correctAnswerText: accepted.join(", ") || null,
      explanationHtml,
    };
  }
  if (SHORT_TEXT.has(type ?? "")) {
    const accepted = [...key.correctAnswers, ...(key.modelAnswer != null ? [key.modelAnswer] : [])];
    return {
      verdict: textAnswerMatches(answer, accepted) ? "correct" : "incorrect",
      correctOptionIds: [],
      correctAnswerText: key.modelAnswer ?? key.correctAnswers[0] ?? null,
      explanationHtml,
    };
  }
  if (LONG_TEXT.has(type ?? "")) {
    return {
      verdict: "compare",
      correctOptionIds: [],
      correctAnswerText: key.modelAnswer ?? key.correctAnswers[0] ?? null,
      explanationHtml,
    };
  }

  // Choice questions: MCQS, MCQM, TRUE_FALSE and their comprehension forms.
  const correct = key.correctAnswers;
  if (correct.length === 0) return null;
  let right: boolean;
  if (Array.isArray(answer)) {
    const picked = answer.map(String);
    right = picked.length === correct.length && correct.every((id) => picked.includes(id));
  } else if (isBlank(answer)) {
    right = false;
  } else {
    // A lone pick on a multiple-correct question must be the whole key; a single-choice
    // question accepts any keyed option (an author may key two as acceptable).
    right = MULTI_SELECT.has(type ?? "")
      ? correct.length === 1 && correct[0] === String(answer)
      : correct.includes(String(answer));
  }
  return { verdict: right ? "correct" : "incorrect", correctOptionIds: correct, correctAnswerText: null, explanationHtml };
};

/** Feedback from the server's check, for a quiz whose key the app does not hold. */
export const feedbackFromServer = (
  questionType: string | undefined,
  answer: FeedbackAnswer,
  response: CheckAnswerResponse
): InstantFeedback => {
  const ids = (response.correct_option_ids ?? []).map(String);
  const modelAnswer = response.correct_answer_text ?? null;
  const explanationHtml = response.explanation && response.explanation.trim() !== "" ? response.explanation : null;
  const typed = isTypedQuestion(questionType);
  let verdict: InstantVerdict;
  if (response.correct === true) verdict = "correct";
  else if (response.correct === false) verdict = "incorrect";
  else if (SHORT_TEXT.has(questionType ?? "") && modelAnswer)
    // The server does not mark one-word answers against the model answer; the app always has.
    verdict = textAnswerMatches(answer, [modelAnswer]) ? "correct" : "incorrect";
  else verdict = "compare";
  return {
    verdict,
    correctOptionIds: typed ? [] : ids,
    correctAnswerText: typed ? (modelAnswer ?? (ids.join(", ") || null)) : null,
    explanationHtml,
  };
};

/** The body the check-answer route reads. */
export interface CheckAnswerRequest {
  slide_id: string;
  question_id: string;
  selected_option_ids: string[];
  text_answer: string | null;
}

export const checkAnswerRequestBody = (
  slideId: string,
  questionId: string,
  questionType: string | undefined,
  answer: FeedbackAnswer
): CheckAnswerRequest => {
  if (Array.isArray(answer)) {
    return { slide_id: slideId, question_id: questionId, selected_option_ids: answer.map(String), text_answer: null };
  }
  if (!isTypedQuestion(questionType) && !isBlank(answer)) {
    return { slide_id: slideId, question_id: questionId, selected_option_ids: [String(answer)], text_answer: null };
  }
  return {
    slide_id: slideId,
    question_id: questionId,
    selected_option_ids: [],
    text_answer: isBlank(answer) ? null : String(answer),
  };
};

/**
 * Whether a choice question's option is shown as the correct one, the learner's wrong
 * pick, or neither, once the question has been checked.
 */
export const optionFeedbackState = (
  feedback: InstantFeedback | undefined,
  optionId: string,
  selected: boolean
): "correct" | "wrong" | "none" => {
  if (!feedback) return "none";
  if (feedback.correctOptionIds.includes(optionId)) return "correct";
  return selected ? "wrong" : "none";
};
