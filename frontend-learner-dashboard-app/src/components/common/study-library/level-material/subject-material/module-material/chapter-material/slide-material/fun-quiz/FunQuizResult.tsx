import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowCounterClockwise, CaretDown, CaretRight, ChatCircleText, Paperclip } from "@phosphor-icons/react";
import { FunButton } from "@/components/design-system/fun/FunButton";
import { WhyWrongButton } from "@/components/chatbot/moments/WhyWrongButton";
import { SelectionAskZone } from "@/components/chatbot/moments/SelectionAskPill";
import { readWhyWrongPart } from "@/components/chatbot/moments/tutor-moments";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { getPublicUrl } from "@/services/upload_file";
import { formatDateTime, formatNumber } from "@/lib/formatters";
import { cn, isRichTextEmpty, parseHtmlToString } from "@/lib/utils";
import { RoleTerms, SystemTerms } from "@/types/naming-settings";
import { useLessonNext } from "../lesson-next-context";
import { useQuizPlace } from "./use-quiz-place";
import { useFootPin } from "./foot-pin";
import { FunQuizClose } from "./FunQuizClose";
import { useOwnLessonScreen } from "../lesson-screen-context";
import {
  joinPlace,
  marksText,
  passTick,
  resultActions,
  resultTiles,
  ringDash,
  RING_BOX,
  RING_CENTRE,
  RING_RADIUS,
  RING_STROKE,
  scorePercent,
  triesLeft,
  verdictOf,
  type ResultAction,
  type ResultScore,
  type TileKind,
} from "./result-facts";

export type RowStatus = "correct" | "partial" | "wrong" | "skipped";

export interface FunAnswerPart {
  /** "A", "B"... for a choice; absent for a typed answer. */
  letter?: string;
  html: string;
}

export interface FunReviewRow {
  id: string;
  number: number;
  questionHtml: string;
  status: RowStatus;
  marks: { earned: number; max: number };
  partialShare: number;
  yourAnswer: FunAnswerPart[];
  correctAnswer: FunAnswerPart[];
  explanationHtml: string;
  feedback: { text: string; fileId: string } | null;
}

export interface FunPastAttempt {
  id: string;
  number: number;
  score: { earned: number; total: number; pct: number } | null;
  notes: number;
  endTime: string | null | undefined;
  active: boolean;
}

export interface FunQuizResultProps {
  title?: string;
  score: ResultScore | undefined;
  passed: boolean | null | undefined;
  passPercentage?: number | null;
  attemptNumber?: number;
  maxAttempts?: number | null;
  canReattempt: boolean;
  onRestart: () => void;
  rows: FunReviewRow[];
  showCorrectAnswers: boolean;
  pastAttempts: FunPastAttempt[];
  onSelectAttempt: (id: string) => void;
  viewingPast: boolean;
  viewingPastHasData: boolean;
  viewingPastEnd?: string | null;
  onBackToLatest: () => void;
}

/**
 * The Fun skin's quiz result (boards A-Result, A-ResultFail): a marks ring, the
 * verdict only when the quiz has a pass mark, tiles, the attempt count, review
 * rows with See why, teacher notes and past attempts. Everything shown comes
 * from QuizReview's own numbers; nothing is re-scored here.
 */
export function FunQuizResult(props: FunQuizResultProps) {
  const {
    title,
    score,
    passed,
    passPercentage,
    attemptNumber,
    maxAttempts,
    canReattempt,
    onRestart,
    rows,
    showCorrectAnswers,
    pastAttempts,
    onSelectAttempt,
    viewingPast,
    viewingPastHasData,
    viewingPastEnd,
    onBackToLatest,
  } = props;
  const { t } = useTranslation("funQuiz");
  const place = useQuizPlace();
  // The lesson viewer's Next while it is open; otherwise the way out is the course page.
  const onNext = useLessonNext();
  const reviewId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  useOwnLessonScreen();
  useFootPin(rootRef, actionsRef);
  const verdict = verdictOf(passed, passPercentage);
  const hasScore = !!score && score.totalMarks > 0;
  const percent = scorePercent(score);
  const left = triesLeft(attemptNumber, maxAttempts);
  const actions = resultActions({ verdict, canRetry: canReattempt, hasNext: !!onNext });
  const courseWord = place.courseTerm.toLocaleLowerCase();
  const heading = joinPlace(title, place.chapterName);
  // An earlier attempt on screen shows its own number; tries left belong to the latest.
  const shownAttempt = viewingPast ? pastAttempts.find((a) => a.active)?.number : attemptNumber;
  const attemptLabel =
    shownAttempt != null && shownAttempt > 0
      ? maxAttempts != null
        ? t("result.attemptOf", { number: shownAttempt, total: maxAttempts })
        : t("result.attempt", { number: shownAttempt })
      : null;

  const headline = viewingPast
    ? verdict === "passed"
      ? t("result.pastPassed")
      : verdict === "notPassed"
        ? t("result.pastNotPassed")
        : t("result.pastDone")
    : verdict === "passed"
      ? t("result.passed")
      : verdict === "notPassed"
        ? t("result.notPassed")
        : t("result.done");

  const marksLine = hasScore
    ? [
        t("result.marks", { count: score!.totalMarks, earned: marksText(score!.earned), total: marksText(score!.totalMarks) }),
        passPercentage != null ? t("result.passMark", { percent: formatNumber(passPercentage) }) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const runAction = (action: ResultAction) =>
    action === "retry" ? onRestart() : action === "next" ? onNext?.() : place.toCourse();

  const actionLabel = (action: ResultAction) =>
    action === "retry"
      ? t("result.tryAgain")
      : action === "next"
        ? t("result.next")
        : t("result.backToCourse", { course: courseWord });

  const tiles = hasScore ? resultTiles(score!) : [];
  const stacked = verdict !== "notPassed";

  return (
    <div ref={rootRef} className={cn("fun-quiz fun-quiz-result", place.colourClass)} data-verdict={verdict}>
      <header className="fun-quiz-result__head">
        <FunQuizClose onClose={place.toCourse} />
        {heading && <p className="fun-quiz-result__where">{heading}</p>}
      </header>

      {viewingPast && (
        <div className="fun-quiz-result__past-note" role="status">
          <p>
            {viewingPastHasData ? t("result.viewingPast") : t("result.noRecorded")}
            {viewingPastEnd && <span className="fun-quiz-result__past-date"> {formatDateTime(viewingPastEnd)}</span>}
          </p>
          <FunButton variant="outline" compact onClick={onBackToLatest}>
            {t("result.backToLatest")}
          </FunButton>
        </div>
      )}

      <section aria-label={t("result.yourResult")} className="fun-quiz-result__card" data-verdict={verdict}>
        {verdict === "passed" && <Sprinkles />}
        {hasScore && (
          <ScoreRing
            percent={percent}
            passPercentage={verdict === "notPassed" ? passPercentage ?? null : null}
            small={verdict === "notPassed"}
            label={
              passPercentage != null
                ? t("result.ringLabelWithPass", { percent, pass: formatNumber(passPercentage) })
                : t("result.ringLabel", { percent })
            }
          />
        )}
        {/* The screen's one h1, as on A-Result. */}
        <h1 className="fun-quiz-result__headline">{headline}</h1>
        {marksLine && <p className="fun-quiz-result__marks">{marksLine}</p>}
        {!stacked && attemptLabel && (
          <p className="fun-quiz-result__attempt-chip">
            <ArrowCounterClockwise aria-hidden="true" weight="bold" />
            {left == null || viewingPast
              ? attemptLabel
              : `${attemptLabel} · ${left > 0 ? t("result.triesLeft", { count: left }) : t("result.noTriesLeft")}`}
          </p>
        )}
      </section>

      {hasScore && (
        <section
          aria-label={t("result.breakdown")}
          className={cn("fun-quiz-result__tiles", stacked ? "fun-quiz-result__tiles--stacked" : "fun-quiz-result__tiles--row")}
        >
          {tiles.map((tile) => (
            <Tile key={tile.kind} kind={tile.kind} count={tile.count} />
          ))}
          {stacked && attemptLabel && (
            <div className="fun-quiz-result__tile" data-kind="attempt">
              <p className="fun-quiz-result__tile-value">
                {maxAttempts != null
                  ? t("result.attemptValueOf", { number: shownAttempt, total: maxAttempts })
                  : formatNumber(shownAttempt as number)}
              </p>
              <p className="fun-quiz-result__tile-label">{t("result.tileAttempt")}</p>
            </div>
          )}
        </section>
      )}

      {rows.length > 0 && (
        <section aria-labelledby={reviewId} className="fun-quiz-result__review">
          <h3 id={reviewId} className="fun-quiz-result__section-title">
            {verdict === "notPassed" ? t("result.yourAnswers") : t("result.reviewHeading")}
          </h3>
          <ul className="fun-quiz-result__rows">
            {rows.map((row) => (
              <ReviewRow key={row.id} row={row} showCorrectAnswers={showCorrectAnswers} />
            ))}
          </ul>
        </section>
      )}

      {pastAttempts.length > 1 && <PastAttempts attempts={pastAttempts} onSelect={onSelectAttempt} />}

      <div ref={actionsRef} className="fun-quiz-result__actions">
        {actions.secondary && (
          <FunButton variant="outline" className="fun-quiz-result__secondary" onClick={() => runAction(actions.secondary!)}>
            {actionLabel(actions.secondary)}
          </FunButton>
        )}
        <FunButton className="fun-quiz-result__primary" onClick={() => runAction(actions.primary)}>
          {actions.primary === "retry" && maxAttempts != null && attemptNumber != null ? (
            <span className="fun-quiz-result__primary-stack">
              <span>{actionLabel("retry")}</span>
              <span className="fun-quiz-result__primary-sub">
                {t("result.attemptOf", { number: attemptNumber + 1, total: maxAttempts })}
              </span>
            </span>
          ) : (
            <>
              {actionLabel(actions.primary)}
              {actions.primary === "next" && <CaretRight aria-hidden="true" weight="bold" />}
            </>
          )}
        </FunButton>
      </div>
    </div>
  );
}

function ScoreRing({
  percent,
  passPercentage,
  small,
  label,
}: {
  percent: number;
  passPercentage: number | null;
  small: boolean;
  label: string;
}) {
  const tick = passPercentage != null ? passTick(passPercentage) : null;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${RING_BOX} ${RING_BOX}`}
      className={cn("fun-quiz-ring", small && "fun-quiz-ring--small")}
    >
      <circle className="fun-quiz-ring__disc" cx={RING_CENTRE} cy={RING_CENTRE} r={RING_RADIUS} />
      <circle className="fun-quiz-ring__track" cx={RING_CENTRE} cy={RING_CENTRE} r={RING_RADIUS} fill="none" strokeWidth={RING_STROKE} />
      {percent > 0 && (
        <circle
          className="fun-quiz-ring__arc"
          cx={RING_CENTRE}
          cy={RING_CENTRE}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={ringDash(percent)}
          transform={`rotate(-90 ${RING_CENTRE} ${RING_CENTRE})`}
        />
      )}
      {tick && <path className="fun-quiz-ring__tick" d={`M${tick.x1} ${tick.y1} L${tick.x2} ${tick.y2}`} strokeWidth={5} strokeLinecap="round" />}
      <text className="fun-quiz-ring__text" x={RING_CENTRE} y={small ? 86 : 84} textAnchor="middle">
        {formatNumber(percent)}%
      </text>
    </svg>
  );
}

/** The passed card's scattered shapes. Decoration only. */
function Sprinkles() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 350 120" preserveAspectRatio="xMidYMin slice" className="fun-quiz-result__sprinkles">
      <rect className="fun-quiz-sprinkle--pink" x="28" y="22" width="14" height="14" rx="3" transform="rotate(20 35 29)" />
      <circle className="fun-quiz-sprinkle--blue" cx="300" cy="30" r="8" />
      <path className="fun-quiz-sprinkle--green" d="M60 80 L72 70 L76 86 Z" />
      <rect className="fun-quiz-sprinkle--violet" x="282" y="78" width="16" height="8" rx="4" transform="rotate(-25 290 82)" />
      <circle className="fun-quiz-sprinkle--orange" cx="320" cy="96" r="5" />
      <circle className="fun-quiz-sprinkle--blue" cx="22" cy="104" r="5" />
    </svg>
  );
}

function Tile({ kind, count }: { kind: TileKind; count: number }) {
  const { t } = useTranslation("funQuiz");
  // Counted, so a language can agree with the number ("1 Juste", "4 Fausses").
  const label = {
    correct: t("result.tileCorrect", { count }),
    wrong: t("result.tileWrong", { count }),
    partial: t("result.tilePartial", { count }),
    skipped: t("result.tileSkipped", { count }),
  }[kind];
  return (
    <div className="fun-quiz-result__tile" data-kind={kind}>
      <p className="fun-quiz-result__tile-value">{formatNumber(count)}</p>
      <p className="fun-quiz-result__tile-label">{label}</p>
    </div>
  );
}

function StatusIcon({ status }: { status: RowStatus }) {
  const { t } = useTranslation("funQuiz");
  const label = {
    correct: t("result.statusCorrect"),
    wrong: t("result.statusWrong"),
    partial: t("result.statusPartial"),
    skipped: t("result.statusSkipped"),
  }[status];
  return (
    <svg role="img" aria-label={label} viewBox="0 0 28 28" className="fun-quiz-status" data-status={status}>
      <circle className="fun-quiz-status__disc" cx="14" cy="14" r="14" />
      {status === "correct" && <path className="fun-quiz-status__mark" d="M8 14.5 L12 18 L20 10" />}
      {status === "wrong" && <path className="fun-quiz-status__mark" d="M9.5 9.5 L18.5 18.5 M18.5 9.5 L9.5 18.5" />}
      {status === "partial" && <path className="fun-quiz-status__half" d="M14 4 A10 10 0 0 1 14 24 Z" />}
      {status === "skipped" && <path className="fun-quiz-status__mark" d="M9 14 H19" />}
    </svg>
  );
}

function AnswerParts({ parts, emptyLabel }: { parts: FunAnswerPart[]; emptyLabel: string }) {
  if (parts.length === 0) return <span className="fun-quiz-why__empty">{emptyLabel}</span>;
  return (
    <>
      {parts.map((part, i) => (
        <span key={i} className="fun-quiz-why__part">
          {part.letter && <span className="fun-quiz-why__letter">{part.letter}</span>}
          <span className="rich-text-content" dangerouslySetInnerHTML={{ __html: part.html }} />
        </span>
      ))}
    </>
  );
}

function ReviewRow({ row, showCorrectAnswers }: { row: FunReviewRow; showCorrectAnswers: boolean }) {
  const { t } = useTranslation("funQuiz");
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const plain = parseHtmlToString(row.questionHtml).trim();
  const hasExplanation = !isRichTextEmpty(row.explanationHtml);
  const canSeeWhy =
    showCorrectAnswers && row.status !== "correct" && (row.correctAnswer.length > 0 || hasExplanation);
  const tutorAllowed = showCorrectAnswers && row.correctAnswer.length > 0 && (row.status === "wrong" || row.status === "partial");

  return (
    <li className="fun-quiz-row" data-status={row.status} data-why-wrong-scope>
      <div className="fun-quiz-row__line">
        <StatusIcon status={row.status} />
        <span className="fun-quiz-row__text">
          <span className="fun-quiz-row__question">{plain || t("result.questionNumber", { number: row.number })}</span>
          {row.status === "partial" && (
            <span className="fun-quiz-row__meta">
              {t("result.partialMarks", {
                count: row.marks.max,
                earned: marksText(row.marks.earned),
                max: marksText(row.marks.max),
              })}
            </span>
          )}
        </span>
        {canSeeWhy && (
          <button
            type="button"
            className="fun-quiz-row__why"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={t("result.seeWhyLabel", { question: plain.slice(0, 80) || row.number })}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? t("result.hideWhy") : t("result.seeWhy")}
          </button>
        )}
      </div>

      {canSeeWhy && open && (
        <div id={panelId} className="fun-quiz-why">
          <div className="fun-quiz-why__block">
            <p className="fun-quiz-why__label">{t("result.yourAnswer")}</p>
            <div data-why-wrong="yours" className="fun-quiz-why__value">
              <AnswerParts parts={row.yourAnswer} emptyLabel={t("result.noAnswer")} />
            </div>
          </div>
          {row.correctAnswer.length > 0 && (
            <div className="fun-quiz-why__block" data-kind="correct">
              <p className="fun-quiz-why__label">{t("result.correctAnswer")}</p>
              <div data-why-wrong="correct" className="fun-quiz-why__value">
                <AnswerParts parts={row.correctAnswer} emptyLabel={t("result.noAnswer")} />
              </div>
            </div>
          )}
          {hasExplanation && (
            <SelectionAskZone className="fun-quiz-why__block fun-quiz-why__explain">
              <p className="fun-quiz-why__label">{t("result.explanation")}</p>
              <div className="fun-quiz-why__value rich-text-content" dangerouslySetInnerHTML={{ __html: row.explanationHtml }} />
            </SelectionAskZone>
          )}
          {tutorAllowed && (
            <WhyWrongButton
              className="fun-quiz-why__tutor"
              getDetails={(button) => ({
                question: plain,
                yourAnswer: readWhyWrongPart(button, "yours"),
                correctAnswer: readWhyWrongPart(button, "correct"),
                explanation: hasExplanation ? parseHtmlToString(row.explanationHtml) : null,
              })}
            />
          )}
        </div>
      )}

      {row.feedback && <TeacherNote text={row.feedback.text} fileId={row.feedback.fileId} />}
    </li>
  );
}

function TeacherNote({ text, fileId }: { text: string; fileId: string }) {
  const { t } = useTranslation("funQuiz");
  const teacher = getTerminology(RoleTerms.Teacher, SystemTerms.Teacher);
  const [fileUrl, setFileUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (fileId) {
      getPublicUrl(fileId)
        .then((url) => {
          if (!cancelled) setFileUrl(url);
        })
        .catch(() => {
          if (!cancelled) setFileUrl("");
        });
    } else {
      setFileUrl("");
    }
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  if (!text && !fileId) return null;
  return (
    <div className="fun-quiz-note">
      <p className="fun-quiz-note__label">
        <ChatCircleText aria-hidden="true" weight="fill" />
        {t("result.teacherNote", { teacher })}
      </p>
      {text && <p className="fun-quiz-note__text">{text}</p>}
      {fileId && fileUrl && (
        <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="fun-quiz-note__file">
          <Paperclip aria-hidden="true" weight="bold" />
          {t("result.viewAttachment")}
        </a>
      )}
    </div>
  );
}

function PastAttempts({ attempts, onSelect }: { attempts: FunPastAttempt[]; onSelect: (id: string) => void }) {
  const { t } = useTranslation("funQuiz");
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <section className="fun-quiz-result__past">
      <button
        type="button"
        className="fun-quiz-result__past-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="fun-quiz-result__section-title">{t("result.pastAttempts", { count: attempts.length })}</span>
        <CaretDown aria-hidden="true" weight="bold" className={cn("fun-quiz-result__past-caret", open && "fun-quiz-result__past-caret--open")} />
      </button>
      {open && (
        <ul id={listId} className="fun-quiz-result__past-list">
          {attempts.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="fun-quiz-result__past-row"
                aria-current={a.active ? "true" : undefined}
                onClick={() => onSelect(a.id)}
              >
                <span className="fun-quiz-result__past-name">{t("result.attempt", { number: a.number })}</span>
                {a.score && a.score.total > 0 && (
                  <span className="fun-quiz-result__past-score">
                    {t("result.pastScore", {
                      earned: marksText(a.score.earned),
                      total: marksText(a.score.total),
                      percent: formatNumber(a.score.pct),
                    })}
                  </span>
                )}
                {a.notes > 0 && <span className="fun-quiz-result__past-notes">{t("result.notes", { count: a.notes })}</span>}
                {a.endTime && <span className="fun-quiz-result__past-date">{formatDateTime(a.endTime)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default FunQuizResult;
