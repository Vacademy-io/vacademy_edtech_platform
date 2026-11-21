import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  displayedAnswerFor,
  useAssessmentStore,
} from "@/stores/assessment-store";
import {
  applyKeypadKey,
  isValidTypedNumber,
  type KeypadKey,
} from "./keypad-logic";

// An emptied box is stored as no answer: in practice-friendly (auto) mode the
// store marks a question answered whenever the array is non-empty.
const toAnswer = (value: string): string[] => (value === "" ? [] : [value]);

const ROWS: KeypadKey[][] = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
  ["0", ".", "-"],
];

/**
 * Numerical answer box with the console keypad: Backspace, digits, point,
 * minus, caret left/right and Clear All. In strict themes the physical
 * keyboard is blocked, as on the real console; practice-friendly themes also
 * accept typing. Every change goes through `setAnswer`, so in strict themes
 * it stays a draft until a save action.
 */
export function TcsKeypad({
  questionId,
  allowTyping,
}: {
  questionId: string;
  allowTyping: boolean;
}) {
  const { t } = useTranslation("questionTest");
  const value = useAssessmentStore(
    (s) => displayedAnswerFor(s, questionId)?.[0] ?? "",
  );
  const setAnswer = useAssessmentStore((s) => s.setAnswer);
  const [caret, setCaret] = useState(value.length);
  const inputRef = useRef<HTMLInputElement>(null);

  // A cleared or restored answer moves the caret to the end.
  useEffect(() => {
    setCaret((previous) => Math.min(previous, value.length));
  }, [value]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input || document.activeElement !== input) return;
    input.setSelectionRange(caret, caret);
  }, [caret, value]);

  const press = (key: KeypadKey) => {
    const next = applyKeypadKey({ value, caret }, key);
    if (next.value !== value) setAnswer(questionId, toAnswer(next.value));
    setCaret(next.caret);
    // Show the caret on pointer devices; a phone would raise its keyboard.
    if (window.matchMedia?.("(pointer: fine)").matches) {
      inputRef.current?.focus({ preventScroll: true });
    }
  };

  const keyLabel = (key: KeypadKey) =>
    key === "-" ? "−" : key;

  return (
    <div className="tcs-numeric">
      <input
        ref={inputRef}
        className="tcs-numeric__input"
        type="text"
        inputMode={allowTyping ? "decimal" : "none"}
        readOnly={!allowTyping}
        value={value}
        aria-label={t("examThemes.tcs.keypad.answer")}
        onKeyDown={(event) => {
          if (!allowTyping && event.key !== "Tab") event.preventDefault();
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? value.length)}
        onChange={(event) => {
          if (!allowTyping) return;
          const typed = event.target.value;
          if (!isValidTypedNumber(typed)) return;
          setAnswer(questionId, toAnswer(typed));
          setCaret(event.target.selectionStart ?? typed.length);
        }}
        onPaste={(event) => event.preventDefault()}
        onCopy={(event) => event.preventDefault()}
        onCut={(event) => event.preventDefault()}
      />
      <div className="tcs-keypad" role="group" aria-label={t("examThemes.tcs.keypad.ariaLabel")}>
        <button type="button" className="tcs-key tcs-key--wide" onClick={() => press("backspace")}>
          {t("examThemes.tcs.keypad.backspace")}
        </button>
        {ROWS.map((row) => (
          <div key={row.join("")} className="tcs-keypad__row">
            {row.map((key) => (
              <button
                key={key}
                type="button"
                className="tcs-key"
                aria-label={key === "-" ? t("examThemes.tcs.keypad.minus") : undefined}
                onClick={() => press(key)}
              >
                {keyLabel(key)}
              </button>
            ))}
          </div>
        ))}
        <div className="tcs-keypad__row tcs-keypad__row--two">
          <button
            type="button"
            className="tcs-key"
            aria-label={t("examThemes.tcs.keypad.left")}
            onClick={() => press("left")}
          >
            ←
          </button>
          <button
            type="button"
            className="tcs-key"
            aria-label={t("examThemes.tcs.keypad.right")}
            onClick={() => press("right")}
          >
            →
          </button>
        </div>
        <button type="button" className="tcs-key tcs-key--wide" onClick={() => press("clear")}>
          {t("examThemes.tcs.keypad.clearAll")}
        </button>
      </div>
    </div>
  );
}
