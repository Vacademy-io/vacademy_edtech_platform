import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { MyButton } from "@/components/design-system/button";
import { formatNumber } from "@/lib/formatters";
import { useQuizActiveStore } from "@/stores/study-library/quiz-active-store";
import { createPressTracker, TAP_SETTLE_MS, waitForPressesToSettle } from "./press-settle";
import { quizDescriptionText } from "./quiz-session";
import { useFunTheme } from "@/hooks/use-fun-theme";
import { FunQuizStartCard, FunQuizTimeUpCard } from "./fun-quiz/FunQuizCards";

// Listens from page load: a press can begin before the screen it ends on exists.
const presses = createPressTracker(window);

/**
 * Mounted with the start screen and with the questions. Screens swap in place, so
 * for a moment it takes the follow-up tap of a double tap, which would otherwise
 * land on whatever just appeared under the finger: an answer, Next or Start. It
 * stays until a finger from that moment has lifted, because a click goes to
 * whatever is on top at the end of the press, not at the start.
 * Scrolling still works underneath.
 */
export const QuizAttemptScreenGuard: React.FC<{ settleMs?: number }> = ({
  settleMs = TAP_SETTLE_MS,
}) => {
  const setAttemptScreen = useQuizActiveStore((state) => state.setAttemptScreen);
  const [settling, setSettling] = useState(true);

  useEffect(() => {
    setAttemptScreen(true);
    return () => setAttemptScreen(false);
  }, [setAttemptScreen]);

  useEffect(
    () => waitForPressesToSettle(presses, () => setSettling(false), settleMs),
    [settleMs],
  );

  return settling
    ? createPortal(<div aria-hidden="true" className="fixed inset-0 z-70" />, document.body)
    : null;
};

interface QuizStartCardProps {
  title?: string;
  description?: string | null;
  questionCount: number;
  timeLimitMinutes?: number | null;
  /** Total attempts allowed. Null means unlimited. */
  maxAttempts?: number | null;
  /** Attempts already submitted. Undefined until known. */
  usedAttempts?: number;
  /** The attempt count is on its way, so it cannot be shown or acted on yet. */
  attemptsPending: boolean;
  passPercentage?: number | null;
  negativeMarking?: number;
  canStart: boolean;
  onStart: () => void;
}

const FactRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 py-3 [@media(max-height:700px)]:py-2">
    <dt className="text-sm text-neutral-500">{label}</dt>
    <dd className="text-sm font-semibold tabular-nums text-neutral-800 text-end">{children}</dd>
  </div>
);

export const QuizStartCard: React.FC<QuizStartCardProps> = ({
  title,
  description,
  questionCount,
  timeLimitMinutes,
  maxAttempts,
  usedAttempts,
  attemptsPending,
  passPercentage,
  negativeMarking = 0,
  canStart,
  onStart,
}) => {
  const { t } = useTranslation("libraryCommonB");
  const isFun = useFunTheme();
  const timed = timeLimitMinutes != null && timeLimitMinutes > 0;
  const limited = maxAttempts != null;
  const about = quizDescriptionText(description);
  const nextAttempt = (usedAttempts ?? 0) + 1;

  if (isFun) {
    return (
      <FunQuizStartCard
        guard={<QuizAttemptScreenGuard />}
        title={title}
        about={about || undefined}
        questionCount={questionCount}
        timeLimitMinutes={timeLimitMinutes}
        maxAttempts={maxAttempts}
        usedAttempts={usedAttempts}
        attemptsPending={attemptsPending}
        passPercentage={passPercentage}
        negativeMarking={negativeMarking}
        canStart={canStart}
        onStart={onStart}
      />
    );
  }

  return (
    <div className="flex min-h-full w-full items-center justify-center overflow-y-auto bg-white p-4 sm:p-8">
      <QuizAttemptScreenGuard />
      <div className="w-full max-w-md">
        <p className="text-xs font-medium text-neutral-500">{t("quizViewer.start.eyebrow")}</p>
        {title && <h2 className="mt-1 text-xl font-semibold leading-snug text-neutral-900">{title}</h2>}
        {about && <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-neutral-600">{about}</p>}

        <dl className="mt-5 divide-y divide-neutral-100 border-y border-neutral-100 [@media(max-height:700px)]:mt-3">
          <FactRow label={t("quizViewer.start.questionsLabel")}>{questionCount}</FactRow>
          <FactRow label={t("quizViewer.start.timeLabel")}>
            {timed
              ? t("quizViewer.start.timeValue", { count: timeLimitMinutes as number })
              : t("quizViewer.start.noTimeLimit")}
          </FactRow>
          <FactRow label={t("quizViewer.start.attemptsLabel")}>
            {!limited ? (
              t("quizViewer.start.unlimitedAttempts")
            ) : attemptsPending ? (
              <span className="inline-block h-4 w-16 animate-pulse rounded bg-neutral-100 align-middle" />
            ) : usedAttempts === undefined ? (
              t("quizViewer.start.attemptsAllowed", { total: maxAttempts })
            ) : (
              t("quizViewer.start.attemptsLeft", {
                left: Math.max(maxAttempts - usedAttempts, 0),
                total: maxAttempts,
              })
            )}
          </FactRow>
          {passPercentage != null && (
            <FactRow label={t("quizViewer.start.passLabel")}>
              {t("quizViewer.start.passValue", { percent: formatNumber(passPercentage) })}
            </FactRow>
          )}
          {negativeMarking > 0 && (
            <FactRow label={t("quizViewer.start.negativeLabel")}>
              {t("quizViewer.start.negativeValue", {
                count: negativeMarking,
                marks: formatNumber(negativeMarking),
              })}
            </FactRow>
          )}
        </dl>

        <MyButton
          buttonType="primary"
          scale="large"
          disable={!canStart}
          onClick={onStart}
          className="mt-5 w-full [@media(max-height:700px)]:mt-3"
        >
          {usedAttempts
            ? t("quizViewer.start.startAttemptButton", { number: nextAttempt })
            : t("quizViewer.start.startButton")}
        </MyButton>

        {(timed || limited) && (
          <ul className="mt-4 space-y-1.5 text-sm leading-relaxed text-neutral-500">
            {timed && <li>{t("quizViewer.start.timedNote")}</li>}
            {limited && <li>{t("quizViewer.start.attemptNote")}</li>}
          </ul>
        )}
      </div>
    </div>
  );
};

/** Holds the screen from the moment time is up until the attempt is submitted. */
export const QuizTimeUpCard: React.FC<{ failed: boolean; onRetry: () => void }> = ({
  failed,
  onRetry,
}) => {
  const { t } = useTranslation("libraryCommonB");
  const isFun = useFunTheme();
  if (isFun) return <FunQuizTimeUpCard failed={failed} onRetry={onRetry} />;
  return (
    <div className="flex min-h-full w-full items-center justify-center bg-white p-4 sm:p-8">
      <div className="w-full max-w-md text-center">
        <h2 className="text-xl font-semibold text-neutral-900">{t("quizViewer.start.timeUpTitle")}</h2>
        <p className="mt-2 text-sm text-neutral-600" role="status">
          {failed ? t("quizViewer.start.timeUpFailedBody") : t("quizViewer.start.timeUpBody")}
        </p>
        {failed && (
          <MyButton buttonType="primary" scale="large" onClick={onRetry} className="mt-5 w-full">
            {t("quizViewer.start.timeUpRetry")}
          </MyButton>
        )}
      </div>
    </div>
  );
};
