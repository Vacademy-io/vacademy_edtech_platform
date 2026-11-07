import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CaretDown, CaretUp, Backspace } from "@phosphor-icons/react";
import { QUESTION_TYPES } from "@/types/assessment";
import { useAssessmentStore } from "@/stores/assessment-store";
import { cn } from "@/lib/utils";

// The learner payload carries no options_json, so a question's numeric type is not
// known here. It used to be hardcoded to INTEGER, which made "." untypeable and every
// decimal answer key (0.287, 2.05) unreachable. Decimals are always accepted now: a
// decimal typed for a whole-number answer key is simply graded wrong.
const isDecimal = true;
const maxDecimals = Number.POSITIVE_INFINITY;

export function NumericInputWithKeypad() {
  const { t } = useTranslation("questionTest");
  const { currentQuestion, answers, setAnswer, setQuestionState } =
    useAssessmentStore();
  const [numericValue, setNumericValue] = useState("");
  // The pad is a fallback for devices where the OS keyboard covers the
  // question; a learner who prefers the system keyboard can fold it away and
  // get the screen back.
  const [isPadOpen, setIsPadOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize component state based on question settings
  useEffect(() => {
    if (
      !currentQuestion ||
      currentQuestion.question_type !== QUESTION_TYPES.NUMERIC
    ) {
      return;
    }

    // Load existing answer
    if (answers[currentQuestion.question_id]?.[0]) {
      setNumericValue(answers[currentQuestion.question_id][0]);
    } else {
      setNumericValue("");
    }
  }, [currentQuestion, answers]);

  // Auto-focus on pointer devices only. On a phone, focusing raises the OS
  // keyboard over the question the moment it loads — the learner has not read
  // it yet, and the on-screen pad below covers the same need.
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [currentQuestion]);

  // Handle keypad button press
  const handleKeyPress = (key: string) => {
    if (!currentQuestion) return;

    let updated = numericValue;

    if (key === "backspace") {
      updated = numericValue.slice(0, -1);
    } else if (key === "." && isDecimal && !numericValue.includes(".")) {
      updated = numericValue + ".";
    } else if (/[0-9]/.test(key)) {
      if (numericValue.includes(".")) {
        const parts = numericValue.split(".");
        if (parts[1].length >= maxDecimals) {
          return;
        }
      }
      updated = numericValue + key;
    }

    setNumericValue(updated);
    setAnswer(currentQuestion.question_id, [updated]);

    // Update question state
    setQuestionState(currentQuestion.question_id, {
      isVisited: true,
      isAnswered: updated.trim() !== "",
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    if (isDecimal) {
      if (/^-?\d*\.?\d*$/.test(value)) {
        if (value.includes(".")) {
          const parts = value.split(".");
          if (parts[1].length > maxDecimals) return;
        }
        setNumericValue(value);
        if (currentQuestion) {
          setAnswer(currentQuestion.question_id, [value]);
          setQuestionState(currentQuestion.question_id, {
            isVisited: true,
            isAnswered: value.trim() !== "",
          });
        }
      }
    } else {
      if (/^-?\d*$/.test(value)) {
        setNumericValue(value);
        if (currentQuestion) {
          setAnswer(currentQuestion.question_id, [value]);
          setQuestionState(currentQuestion.question_id, {
            isVisited: true,
            isAnswered: value.trim() !== "",
          });
        }
      }
    }
  };

  if (
    !currentQuestion ||
    currentQuestion.question_type !== QUESTION_TYPES.NUMERIC
  ) {
    return null;
  }

  const padKeys = ["7", "8", "9", "4", "5", "6", "1", "2", "3"];

  const hasNegativeMarking = (() => {
    try {
      return Number(JSON.parse(currentQuestion.marking_json)?.data?.negativeMark) > 0;
    } catch {
      return false;
    }
  })();

  return (
    <div className="md:max-w-reg-450">
      <p className="mb-2 text-3xs font-bold uppercase tracking-wide text-neutral-400">
        {t("common.yourAnswer")}
      </p>

      <input
        ref={inputRef}
        type="text"
        inputMode={isDecimal ? "decimal" : "numeric"}
        value={numericValue}
        onChange={handleInputChange}
        placeholder={isDecimal ? "0.00" : "0"}
        aria-label={t("numeric.ariaLabel")}
        onCopy={(e) => e.preventDefault()}
        onCut={(e) => e.preventDefault()}
        onPaste={(e) => e.preventDefault()}
        className={cn(
          "h-14 w-full rounded-xl border-2 px-4 font-mono text-h3 font-semibold tabular-nums text-neutral-900 outline-none transition-colors placeholder:text-neutral-300",
          numericValue ? "border-primary-500" : "border-neutral-200",
        )}
      />

      {/* Read from this question's own marking scheme rather than assuming
          numericals never carry a penalty — some papers do set one, and the
          chip beside the question already shows it. */}
      {!hasNegativeMarking && (
        <p className="mt-2 text-caption text-neutral-400">
          {t("numeric.noNegativeMarking")}
        </p>
      )}

      <button
        type="button"
        onClick={() => setIsPadOpen((prev) => !prev)}
        aria-expanded={isPadOpen}
        className="mt-3 flex items-center gap-1.5 text-caption font-semibold text-neutral-500 transition-colors hover:text-neutral-800"
      >
        {isPadOpen ? t("numeric.pad.hide") : t("numeric.pad.show")}
        {isPadOpen ? <CaretUp size={14} /> : <CaretDown size={14} />}
      </button>

      {isPadOpen && (
        <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-2">
          {padKeys.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => handleKeyPress(key)}
              className="h-12 rounded-lg border border-neutral-200 bg-white text-title font-semibold text-neutral-800 transition-colors hover:bg-neutral-100"
            >
              {key}
            </button>
          ))}
          {isDecimal ? (
            <button
              type="button"
              onClick={() => handleKeyPress(".")}
              disabled={numericValue.includes(".")}
              aria-label={t("numeric.pad.decimalPointAriaLabel")}
              className="h-12 rounded-lg border border-neutral-200 bg-white text-title font-semibold text-neutral-800 transition-colors hover:bg-neutral-100 disabled:opacity-40"
            >
              .
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => handleKeyPress("0")}
            className="h-12 rounded-lg border border-neutral-200 bg-white text-title font-semibold text-neutral-800 transition-colors hover:bg-neutral-100"
          >
            0
          </button>
          <button
            type="button"
            onClick={() => handleKeyPress("backspace")}
            aria-label={t("numeric.pad.backspaceAriaLabel")}
            className="grid h-12 place-items-center rounded-lg border border-neutral-200 bg-neutral-100 text-neutral-700 transition-colors hover:bg-neutral-200"
          >
            <Backspace size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
