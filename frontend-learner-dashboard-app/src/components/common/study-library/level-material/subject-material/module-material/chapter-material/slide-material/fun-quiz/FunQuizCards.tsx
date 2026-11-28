import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alarm, ClockCountdown, Lightning, Question, Timer } from "@phosphor-icons/react";
import { FunButton } from "@/components/design-system/fun/FunButton";
import { formatNumber } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { useQuizPlace } from "./use-quiz-place";
import { joinPlace } from "./result-facts";

export interface FunQuizStartCardProps {
  title?: string;
  /** Plain text, already cleaned by the start card. */
  about?: string;
  questionCount: number;
  timeLimitMinutes?: number | null;
  maxAttempts?: number | null;
  usedAttempts?: number;
  attemptsPending: boolean;
  passPercentage?: number | null;
  negativeMarking: number;
  canStart: boolean;
  onStart: () => void;
  /** The quiz's double-tap guard, mounted with the card. */
  guard: React.ReactNode;
}

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="fun-quiz-start__fact">
    <dt className="fun-quiz-start__fact-label">{label}</dt>
    <dd className="fun-quiz-start__fact-value">{children}</dd>
  </div>
);

/** The Fun skin's quiz start card: the same facts as the standard card, as tiles. */
export function FunQuizStartCard({
  title,
  about,
  questionCount,
  timeLimitMinutes,
  maxAttempts,
  usedAttempts,
  attemptsPending,
  passPercentage,
  negativeMarking,
  canStart,
  onStart,
  guard,
}: FunQuizStartCardProps) {
  const { t } = useTranslation("libraryCommonB");
  const place = useQuizPlace();
  const where = joinPlace(place.courseName, place.chapterName);
  const timed = timeLimitMinutes != null && timeLimitMinutes > 0;
  const limited = maxAttempts != null;

  return (
    <div className={cn("fun-quiz fun-quiz-start", place.colourClass)}>
      {guard}
      <div className="fun-quiz-start__body">
        <p className="fun-quiz-start__kind">
          <span aria-hidden="true" className="fun-quiz-start__kind-icon">
            <Lightning weight="fill" />
          </span>
          {t("quizViewer.start.eyebrow")}
        </p>
        {title && <h2 className="fun-quiz-start__title">{title}</h2>}
        {where && <p className="fun-quiz-start__where">{where}</p>}
        {about && <p className="fun-quiz-start__about">{about}</p>}

        <dl className="fun-quiz-start__facts">
          <Fact label={t("quizViewer.start.questionsLabel")}>{formatNumber(questionCount)}</Fact>
          <Fact label={t("quizViewer.start.timeLabel")}>
            {timed
              ? t("quizViewer.start.timeValue", { count: timeLimitMinutes as number })
              : t("quizViewer.start.noTimeLimit")}
          </Fact>
          <Fact label={t("quizViewer.start.attemptsLabel")}>
            {!limited ? (
              t("quizViewer.start.unlimitedAttempts")
            ) : attemptsPending ? (
              <span className="fun-skeleton fun-quiz-start__pending" />
            ) : usedAttempts === undefined ? (
              t("quizViewer.start.attemptsAllowed", { total: maxAttempts })
            ) : (
              t("quizViewer.start.attemptsLeft", {
                left: Math.max((maxAttempts as number) - usedAttempts, 0),
                total: maxAttempts,
              })
            )}
          </Fact>
          {passPercentage != null && (
            <Fact label={t("quizViewer.start.passLabel")}>
              {t("quizViewer.start.passValue", { percent: formatNumber(passPercentage) })}
            </Fact>
          )}
          {negativeMarking > 0 && (
            <Fact label={t("quizViewer.start.negativeLabel")}>
              {t("quizViewer.start.negativeValue", {
                count: negativeMarking,
                marks: formatNumber(negativeMarking),
              })}
            </Fact>
          )}
        </dl>

        <FunButton block disabled={!canStart} onClick={onStart} className="fun-quiz-start__go">
          {usedAttempts
            ? t("quizViewer.start.startAttemptButton", { number: usedAttempts + 1 })
            : t("quizViewer.start.startButton")}
        </FunButton>

        {(timed || limited) && (
          <ul className="fun-quiz-start__notes">
            {timed && (
              <li>
                <Timer aria-hidden="true" weight="bold" />
                <span>{t("quizViewer.start.timedNote")}</span>
              </li>
            )}
            {limited && (
              <li>
                <ClockCountdown aria-hidden="true" weight="bold" />
                <span>{t("quizViewer.start.attemptNote")}</span>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Time is up: held until the attempt is submitted, with a retry when sending failed. */
export function FunQuizTimeUpCard({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  const { t } = useTranslation("libraryCommonB");
  const place = useQuizPlace();
  return (
    <div className={cn("fun-quiz fun-quiz-state", place.colourClass)}>
      <span aria-hidden="true" className="fun-quiz-state__icon fun-quiz-state__icon--time">
        <Alarm weight="bold" />
      </span>
      <h2 className="fun-quiz-state__title">{t("quizViewer.start.timeUpTitle")}</h2>
      <p className="fun-quiz-state__body" role="status">
        {failed ? t("quizViewer.start.timeUpFailedBody") : t("quizViewer.start.timeUpBody")}
      </p>
      {failed && (
        <FunButton block onClick={onRetry} className="fun-quiz-state__action">
          {t("quizViewer.start.timeUpRetry")}
        </FunButton>
      )}
    </div>
  );
}

/** A quiz with no questions. */
export function FunQuizEmpty() {
  const { t } = useTranslation("libraryCommonB");
  return (
    <div className="fun-quiz fun-quiz-state">
      <span aria-hidden="true" className="fun-quiz-state__icon">
        <Question weight="bold" />
      </span>
      <p className="fun-quiz-state__body">{t("quizViewer.noQuestionsAvailable")}</p>
    </div>
  );
}

/**
 * Thirty seconds left. The same message and five-second auto-dismiss as the
 * standard warning; the quiz's clock and auto-submit are untouched by it.
 */
export function FunQuizTimeWarning({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation("libraryCommonA");
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (countdown <= 0) {
      onDismiss();
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, onDismiss]);

  return (
    <div className="fun-quiz-warning" role="alertdialog" aria-modal="true" aria-labelledby="fun-quiz-warning-title">
      <div className="fun-quiz-warning__card">
        <span aria-hidden="true" className="fun-quiz-state__icon fun-quiz-state__icon--warn">
          <Alarm weight="bold" />
        </span>
        <h2 id="fun-quiz-warning-title" className="fun-quiz-state__title">
          {t("quizTimeWarning.title")}
        </h2>
        <p className="fun-quiz-state__body">{t("quizTimeWarning.message")}</p>
        <FunButton block autoFocus onClick={onDismiss} className="fun-quiz-state__action">
          {t("quizTimeWarning.gotIt", { countdown })}
        </FunButton>
      </div>
    </div>
  );
}
