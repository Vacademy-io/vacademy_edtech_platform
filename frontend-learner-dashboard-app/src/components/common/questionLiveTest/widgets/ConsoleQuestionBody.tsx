import { useTranslation } from "react-i18next";
import {
  displayedAnswerFor,
  useAssessmentStore,
} from "@/stores/assessment-store";
import { QUESTION_TYPES, type QuestionDto } from "@/types/assessment";
import { parseHtmlToString } from "@/lib/utils";
import { isUntimedPlayMode } from "@/lib/untimed-play-mode";
import type { OptionNumbering } from "@/types/exam-theme";
import { QuestionHtmlContent } from "../question-html-content";
import { QuestionPassage } from "../question-passage";
import { OneWordInput } from "../otherQuestionTypes/OneWordInput";
import { LongAnswerInput } from "../otherQuestionTypes/LongAnswerInput";
import { CodingQuestionDisplay } from "../otherQuestionTypes/CodingQuestionDisplay";
import { CbeQuestionDisplay } from "../otherQuestionTypes/CbeQuestionDisplay";
import { useLiveTestEngine } from "../engine/live-test-engine-context";
import { useConsole } from "../layouts/console-context";
import { TcsKeypad } from "./TcsKeypad";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NO_ANSWER: string[] = [];

/** "(A)", "(1)" or nothing, per the theme's option numbering. */
const optionPrefix = (numbering: OptionNumbering, index: number): string => {
  if (numbering === "(A)") return `(${LETTERS[index % LETTERS.length]})`;
  if (numbering === "(1)") return `(${index + 1})`;
  return "";
};

/** The option text already starts with its own label ("A.", "(1)", "b)"). */
const hasOwnPrefix = (html: string): boolean => {
  const text = parseHtmlToString(html).trim();
  return /^\(?[a-z]\)?[).:-]\s*/i.test(text) || /^\(?\d+\)?[).:-]\s*/.test(text);
};

function OptionList({ question }: { question: QuestionDto }) {
  const { theme } = useConsole();
  const { t } = useTranslation("questionTest");
  // Select the stored array itself (a fresh [] per call would re-render forever).
  const selected =
    useAssessmentStore((s) => displayedAnswerFor(s, question.question_id)) ??
    NO_ANSWER;
  const setAnswer = useAssessmentStore((s) => s.setAnswer);
  const isMulti = question.question_type === QUESTION_TYPES.MCQM;

  const pick = (optionId: string) => {
    if (isMulti) {
      setAnswer(
        question.question_id,
        selected.includes(optionId)
          ? selected.filter((id) => id !== optionId)
          : [...selected, optionId],
      );
      return;
    }
    // A radio cannot be unselected on the console: clicking the chosen option
    // again keeps it, and Clear Response is the only way to remove an answer.
    if (selected.length === 1 && selected[0] === optionId) return;
    setAnswer(question.question_id, [optionId]);
  };

  return (
    <div
      className="tcs-options"
      role={isMulti ? "group" : "radiogroup"}
      aria-label={t("questionDisplay.answerOptionsAriaLabel")}
    >
      {question.options?.map((option, index) => {
        const checked = selected.includes(option.id);
        const prefix = hasOwnPrefix(option.text.content)
          ? ""
          : optionPrefix(theme.options.numbering, index);
        return (
          <label key={option.id} className="tcs-option">
            <input
              type={isMulti ? "checkbox" : "radio"}
              name={`tcs-${question.question_id}`}
              checked={checked}
              onChange={() => undefined}
              onClick={() => pick(option.id)}
              className="tcs-option__input"
            />
            {prefix && <span className="tcs-option__prefix">{prefix}</span>}
            <span className="tcs-option__text">
              <QuestionHtmlContent html={option.text.content} inline />
            </span>
          </label>
        );
      })}
    </div>
  );
}

function CodingBody({ question }: { question: QuestionDto }) {
  const { t } = useTranslation("questionTest");
  const attemptId = useAssessmentStore((s) => s.assessment?.attempt_id);
  let config = null;
  try {
    config = JSON.parse(question.evaluation_json || "{}")?.data ?? null;
  } catch {
    config = null;
  }
  if (!config) {
    return <p className="tcs-note">{t("questionDisplay.codingMissingConfig")}</p>;
  }
  return (
    <CodingQuestionDisplay
      key={question.question_id}
      questionId={question.question_id}
      attemptId={attemptId}
      config={config}
    />
  );
}

/**
 * The question pane of the console: passage, stem and the answer area.
 * Options are radio rows (checkboxes for multiple correct) with no A/B
 * badges unless the preset numbers them. Numerical answers use the console
 * keypad. Other question types reuse the app's own inputs.
 */
export function ConsoleQuestionBody() {
  const { t } = useTranslation("questionTest");
  const { theme } = useConsole();
  const { playMode } = useLiveTestEngine();
  const question = useAssessmentStore((s) => s.currentQuestion);
  const sectionTimeUp = useAssessmentStore(
    (s) => s.sectionTimers[s.currentSection]?.timeLeft === 0,
  );

  if (!question) {
    return <p className="tcs-note">{t("questionDisplay.selectPrompt")}</p>;
  }
  if (sectionTimeUp && !isUntimedPlayMode(playMode)) {
    return <p className="tcs-note tcs-note--alert">{t("questionDisplay.sectionTimeUp")}</p>;
  }

  if (question.question_type === QUESTION_TYPES.CBE_RESPONSE) {
    return (
      <CbeQuestionDisplay key={question.question_id} question={question} header={null} />
    );
  }

  const answerArea = (() => {
    switch (question.question_type) {
      case QUESTION_TYPES.MCQS:
      case QUESTION_TYPES.MCQM:
      case QUESTION_TYPES.TRUE_FALSE:
        return <OptionList question={question} />;
      case QUESTION_TYPES.NUMERIC:
        return (
          <TcsKeypad
            key={question.question_id}
            questionId={question.question_id}
            allowTyping={!theme.strict}
          />
        );
      case QUESTION_TYPES.ONE_WORD:
        return <OneWordInput />;
      case QUESTION_TYPES.LONG_ANSWER:
        return <LongAnswerInput />;
      case QUESTION_TYPES.CODING:
        return <CodingBody question={question} />;
      default:
        return <p className="tcs-note">{t("questionDisplay.unsupportedType")}</p>;
    }
  })();

  return (
    <div className="tcs-question">
      <QuestionPassage html={question.parent_rich_text?.content} />
      <QuestionHtmlContent html={question.question.content} className="tcs-stem" />
      {answerArea}
    </div>
  );
}
