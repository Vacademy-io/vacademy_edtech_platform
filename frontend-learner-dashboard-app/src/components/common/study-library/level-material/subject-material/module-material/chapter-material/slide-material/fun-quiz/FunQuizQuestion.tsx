import React, { useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CaretLeft, CaretRight, Check, ListChecks, WarningCircle, XCircle } from "@phosphor-icons/react";
import { FunButton } from "@/components/design-system/fun/FunButton";
import { formatNumber } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { useQuizPlace } from "./use-quiz-place";
import { joinPlace } from "./result-facts";

export type FunAnswer = string | number | string[] | undefined;

export interface FunQuizOption {
  id: string;
  /** Already rendered (math and all) by the quiz viewer. */
  html: string;
}

export interface FunQuizQuestionProps {
  title?: string;
  current: number;
  total: number;
  questionId: string;
  questionType: string;
  /** Already rendered by the quiz viewer. */
  questionHtml: string;
  passageHtml?: string;
  /** This question's marks, as the quiz is set up. */
  marks: number | null;
  options: FunQuizOption[];
  answer: FunAnswer;
  numericError?: string;
  incorrectNotice: boolean;
  answered: boolean;
  submitting: boolean;
  onSelect: (optionId: string) => void;
  onToggle: (optionId: string) => void;
  onText: (value: string) => void;
  onNumeric: (value: string) => void;
  onPrev: () => void;
  onNext: () => void;
  /** The running clock, drawn by the quiz's own timer; absent on an untimed quiz. */
  timer?: React.ReactNode;
}

const PASSAGE_LIMIT = 200;

const plainText = (html: string): string => {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || "";
};

const noClipboard = {
  onCopy: (e: React.ClipboardEvent) => e.preventDefault(),
  onCut: (e: React.ClipboardEvent) => e.preventDefault(),
  onPaste: (e: React.ClipboardEvent) => e.preventDefault(),
};

/**
 * The Fun skin's question screen (board A-Quiz): progress in the course colour,
 * lip option rows, Previous and Next with Next held until the question is
 * answered. Only drawn under html.ui-fun; every answer still goes through the
 * quiz viewer's own handlers.
 */
export function FunQuizQuestion(props: FunQuizQuestionProps) {
  const {
    title,
    current,
    total,
    questionId,
    questionType,
    questionHtml,
    passageHtml,
    marks,
    options,
    answer,
    numericError,
    incorrectNotice,
    answered,
    submitting,
    onSelect,
    onToggle,
    onText,
    onNumeric,
    onPrev,
    onNext,
    timer,
  } = props;
  const { t } = useTranslation("funQuiz");
  const { t: tq } = useTranslation("libraryCommonB");
  const place = useQuizPlace();
  const eyebrow = joinPlace(place.courseName, place.chapterName);
  const textId = useId();
  const errorId = useId();
  const [fullPassage, setFullPassage] = useState(false);
  const isLast = current === total - 1;
  const percent = total > 0 ? Math.round(((current + 1) / total) * 100) : 0;

  const multi = questionType === "MCQM" || questionType === "CMCQM";
  const numeric = questionType === "NUMERIC" || questionType === "CNUMERIC";
  const oneWord = questionType === "ONE_WORD" || questionType === "TEXT";
  const long = questionType === "LONG_ANSWER";
  const choice = !numeric && !oneWord && !long;

  const passagePlain = useMemo(() => (passageHtml ? plainText(passageHtml) : ""), [passageHtml]);
  const passageLong = passagePlain.length > PASSAGE_LIMIT;

  return (
    <div className={cn("fun-quiz", place.colourClass)}>
      <header className="fun-quiz__head">
        <div className="fun-quiz__head-text">
          {eyebrow && <p className="fun-quiz__eyebrow">{eyebrow}</p>}
          {title && <p className="fun-quiz__title">{title}</p>}
        </div>
        {timer && (
          <div role="timer" className="fun-quiz__timer">
            {timer}
          </div>
        )}
      </header>

      <div
        role="progressbar"
        aria-label={t("progressLabel")}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={current + 1}
        aria-valuetext={tq("quizViewer.questionOf", { current: current + 1, total })}
        className="fun-quiz__bar"
      >
        {/* SVG, so the width is an attribute rather than an inline style. */}
        <svg width="100%" height="100%" aria-hidden="true" focusable="false">
          <rect className="fun-quiz__bar-fill" x="0" y="0" height="100%" width={`${percent}%`} rx="8" />
        </svg>
      </div>

      <div className="fun-quiz__main">
        <div className="fun-quiz__meta">
          <p className="fun-quiz__count">{tq("quizViewer.questionOf", { current: current + 1, total })}</p>
          {marks != null && marks > 0 && (
            <span className="fun-quiz__marks">{t("marks", { count: marks, value: formatNumber(marks) })}</span>
          )}
        </div>

        {passageHtml && (
          <section className="fun-quiz__passage" aria-label={t("passage")}>
            <p className="fun-quiz__passage-label">{t("passage")}</p>
            {fullPassage || !passageLong ? (
              <div className="fun-quiz__passage-text rich-text-content" dangerouslySetInnerHTML={{ __html: passageHtml }} />
            ) : (
              <p className="fun-quiz__passage-text">{passagePlain.slice(0, PASSAGE_LIMIT)}…</p>
            )}
            {passageLong && (
              <button
                type="button"
                className="fun-quiz__link"
                aria-expanded={fullPassage}
                onClick={() => setFullPassage((v) => !v)}
              >
                {fullPassage ? tq("quizViewer.showLess") : tq("quizViewer.showMore")}
              </button>
            )}
          </section>
        )}

        <div
          id={textId}
          role="heading"
          aria-level={2}
          className="fun-quiz__question rich-text-content"
          dangerouslySetInnerHTML={{ __html: questionHtml || tq("quizViewer.questionTextUnavailable") }}
        />

        {multi && (
          <p className="fun-quiz__note">
            <ListChecks aria-hidden="true" weight="bold" />
            {t("selectAll")}
          </p>
        )}

        {choice && (
          <OptionList
            key={questionId}
            labelledBy={textId}
            options={options}
            multi={multi}
            answer={answer}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        )}

        {numeric && (
          <div className="fun-quiz__field">
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              className="fun-quiz__input"
              aria-labelledby={textId}
              aria-invalid={numericError ? true : undefined}
              aria-describedby={numericError ? errorId : undefined}
              placeholder={tq("quizViewer.placeholders.numeric")}
              value={String(answer || "")}
              onChange={(e) => onNumeric(e.target.value)}
              {...noClipboard}
            />
            {numericError && (
              <p id={errorId} className="fun-quiz__error" role="alert">
                <WarningCircle aria-hidden="true" weight="bold" />
                {numericError}
              </p>
            )}
          </div>
        )}

        {oneWord && (
          <div className="fun-quiz__field">
            <input
              type="text"
              autoComplete="off"
              className="fun-quiz__input"
              aria-labelledby={textId}
              placeholder={tq("quizViewer.placeholders.text")}
              value={String(answer || "")}
              onChange={(e) => onText(e.target.value)}
              {...noClipboard}
            />
          </div>
        )}

        {long && (
          <div className="fun-quiz__field">
            <textarea
              className="fun-quiz__input fun-quiz__input--long"
              aria-labelledby={textId}
              placeholder={tq("quizViewer.placeholders.longAnswer")}
              value={String(answer || "")}
              onChange={(e) => onText(e.target.value)}
              {...noClipboard}
            />
          </div>
        )}

        {incorrectNotice && (
          <p className="fun-quiz__wrong" role="alert">
            <XCircle aria-hidden="true" weight="fill" />
            {tq("quizViewer.incorrectTryAgain")}
          </p>
        )}
      </div>

      <div className="fun-quiz__nav">
        <FunButton variant="outline" className="fun-quiz__prev" disabled={current === 0} onClick={onPrev}>
          <CaretLeft aria-hidden="true" weight="bold" />
          {tq("quizViewer.buttons.previous")}
        </FunButton>
        <FunButton className="fun-quiz__next" disabled={!answered || submitting} onClick={onNext}>
          {submitting
            ? tq("quizViewer.buttons.submitting")
            : isLast
              ? tq("quizViewer.buttons.finish")
              : tq("quizViewer.buttons.next")}
          {!isLast && !submitting && <CaretRight aria-hidden="true" weight="bold" />}
        </FunButton>
      </div>
    </div>
  );
}

function OptionList({
  labelledBy,
  options,
  multi,
  answer,
  onSelect,
  onToggle,
}: {
  labelledBy: string;
  options: FunQuizOption[];
  multi: boolean;
  answer: FunAnswer;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const isOn = (id: string) => (multi ? Array.isArray(answer) && answer.includes(id) : answer === id);
  const selectedIndex = multi ? -1 : options.findIndex((o) => o.id === answer);
  // One tab stop for a pick-one group: the chosen option, else the first.
  const tabStop = selectedIndex >= 0 ? selectedIndex : 0;

  // Arrow keys move through a pick-one group and choose, as a radio group does.
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (multi) return;
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (index + step + options.length) % options.length;
    refs.current[next]?.focus();
    onSelect(options[next]!.id);
  };

  return (
    <div role={multi ? "group" : "radiogroup"} aria-labelledby={labelledBy} className="fun-quiz__options">
      {options.map((option, index) => {
        const on = isOn(option.id);
        return (
          <button
            key={option.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role={multi ? "checkbox" : "radio"}
            aria-checked={on}
            tabIndex={multi || index === tabStop ? 0 : -1}
            data-selected={on ? "true" : undefined}
            className="fun-quiz__option"
            onClick={() => (multi ? onToggle(option.id) : onSelect(option.id))}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            <span aria-hidden="true" className="fun-quiz__letter">
              {String.fromCharCode(65 + index)}
            </span>
            <span className="fun-quiz__option-text rich-text-content" dangerouslySetInnerHTML={{ __html: option.html }} />
            {multi && (
              <span aria-hidden="true" className="fun-quiz__check">
                {on && <Check weight="bold" />}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
