import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, ArrowsClockwise, BookOpen, Trophy } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { celebrateCompletion, celebrateMilestone } from "@/lib/play-celebration";
import {
  openPractice,
  pollPractice,
  recordProgress,
  type CompanionLeaf,
  type PracticeQuestion,
  type ProgressUpdateResponse,
} from "@/services/kb-companion-api";
import { usePolledArtifact } from "./usePolledArtifact";
import { ProgressBar, ProgressRingMini } from "./CompanionVisuals";
import { ErrorPanel, McqBlock, PreparingState } from "./CompanionParts";
import { companionErrorText, masteryTone, shuffled } from "./companion-utils";

interface RoundQuestion extends PracticeQuestion {
  /** Answer index after this round's option shuffle. */
  roundAnswer: number;
}

/** A new round: questions in a new order, options shuffled within each. */
function makeRound(questions: PracticeQuestion[], shuffleOptions: boolean): RoundQuestion[] {
  return shuffled(questions).map((q) => {
    if (!shuffleOptions) return { ...q, roundAnswer: q.answer_index };
    const order = shuffled(q.options.map((_, i) => i));
    return {
      ...q,
      options: order.map((i) => q.options[i]),
      roundAnswer: order.indexOf(q.answer_index),
    };
  });
}

const DIFFICULTY_CLASS: Record<string, string> = {
  easy: "bg-success-50 text-success-700 dark:bg-success-700/20 dark:text-success-200",
  medium: "bg-warning-50 text-warning-700 dark:bg-warning-700/20 dark:text-warning-200",
  hard: "bg-danger-50 text-danger-700 dark:bg-danger-700/20 dark:text-danger-200",
};

/**
 * Practice: the topic's question set (compiled once, shared), one question at
 * a time with instant feedback, a score at the end, and the result recorded
 * once per round so it feeds mastery.
 */
export function PracticeRunner({
  companionId,
  leaf,
  isPlay,
  onProgress,
  onLearn,
}: {
  companionId: string;
  leaf: CompanionLeaf;
  isPlay: boolean;
  onProgress: (nodeId: string, response: ProgressUpdateResponse) => void;
  onLearn: (() => void) | null;
}) {
  const { t } = useTranslation("kbCompanion");
  const nodeId = leaf.id;
  const { data, error, loading, retry } = usePolledArtifact(
    nodeId,
    () => openPractice(companionId, nodeId),
    () => pollPractice(companionId, nodeId),
  );

  const questions = useMemo(
    () => (data?.status === "READY" ? data.questions : []),
    [data],
  );
  const [round, setRound] = useState<RoundQuestion[]>([]);
  const [roundNo, setRoundNo] = useState(0);
  const [position, setPosition] = useState(0);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [finished, setFinished] = useState(false);
  const recorded = useRef(-1);

  useEffect(() => {
    if (questions.length > 0 && round.length === 0) setRound(makeRound(questions, false));
  }, [questions, round.length]);

  const correctCount = round.filter((q) => picks[q.id] === q.roundAnswer).length;

  const leafProgressRef = useRef(leaf.progress);
  leafProgressRef.current = leaf.progress;
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  const finish = useCallback(() => {
    setFinished(true);
    if (recorded.current === roundNo || round.length === 0) return;
    recorded.current = roundNo;
    if (correctCount / round.length >= 0.75) celebrateMilestone();
    // Keep the learner's lesson position: the server reads card_index as-is.
    const saved = leafProgressRef.current;
    recordProgress(companionId, {
      node_id: nodeId,
      card_index: saved?.card_index ?? 0,
      cards_total: saved?.cards_total ?? 0,
      practice: { correct: correctCount, total: round.length },
    })
      .then((res) => onProgressRef.current(nodeId, res))
      .catch(() => undefined);
  }, [companionId, nodeId, correctCount, round.length, roundNo]);

  const tryAgain = () => {
    setRound(makeRound(questions, true));
    setRoundNo((n) => n + 1);
    setPicks({});
    setPosition(0);
    setFinished(false);
  };

  if (error) {
    return <ErrorPanel message={companionErrorText(t, error, "errors.practice")} onRetry={retry} />;
  }
  if (loading && !data) {
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-8 w-3/4 rounded-lg" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (!data) return null;
  if (data.status === "FAILED") {
    return <ErrorPanel message={data.error || t("errors.practice")} onRetry={retry} />;
  }
  if (data.status !== "READY") {
    return <PreparingState headline={t("practice.preparing")} title={data.title || leaf.title} />;
  }
  if (round.length === 0) {
    return <ErrorPanel message={t("errors.emptyPractice")} onRetry={retry} />;
  }

  if (finished) {
    const percent = Math.round((correctCount / round.length) * 100);
    const tier = percent >= 90 ? "great" : percent >= 60 ? "good" : "keepGoing";
    return (
      <div className="animate-in fade-in zoom-in-95 flex flex-col items-center gap-6 rounded-2xl border border-neutral-200 bg-white px-6 py-10 text-center shadow-sm duration-500 dark:border-neutral-800 dark:bg-neutral-900">
        <Trophy className="play-bounce-in size-14 text-warning-500" weight="duotone" aria-hidden />
        <div className="space-y-1">
          <h3 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t(`practice.tier.${tier}`)}</h3>
          <p className="text-base text-neutral-600 dark:text-neutral-400">
            {t("practice.score", { correct: correctCount, total: round.length })}
          </p>
        </div>
        <ProgressRingMini percent={percent} size="lg" tone={masteryTone(percent)}>
          <span className="text-lg font-bold tabular-nums text-neutral-900 dark:text-neutral-50">{percent}%</span>
        </ProgressRingMini>
        <div className="flex w-full max-w-md flex-col gap-2.5 sm:flex-row sm:justify-center">
          {onLearn && (
            <Button variant="outline" onClick={onLearn} className="h-11 gap-2 rounded-xl">
              <BookOpen className="size-5" weight="duotone" aria-hidden />
              {t("practice.backToLesson")}
            </Button>
          )}
          <Button
            onClick={tryAgain}
            className={cn(
              "h-11 gap-2",
              isPlay
                ? "rounded-play-btn bg-play-success font-black uppercase text-white shadow-play-2d-success hover:bg-play-success"
                : "rounded-xl",
            )}
          >
            <ArrowsClockwise className="size-5" weight="bold" aria-hidden />
            {t("practice.tryAgain")}
          </Button>
        </div>
      </div>
    );
  }

  const q = round[Math.min(position, round.length - 1)];
  const picked = picks[q.id] ?? null;
  const isLast = position >= round.length - 1;
  const answeredCount = Object.keys(picks).length;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          <span className="tabular-nums">
            {t("practice.questionOf", { current: position + 1, total: round.length })}
          </span>
          <span className="tabular-nums">{t("practice.runningScore", { correct: correctCount })}</span>
        </div>
        <ProgressBar percent={(answeredCount / round.length) * 100} />
      </div>

      <div
        key={`${roundNo}-${q.id}`}
        className="animate-in fade-in slide-in-from-bottom-2 rounded-2xl border border-neutral-200 bg-white p-card-lg shadow-sm duration-300 dark:border-neutral-800 dark:bg-neutral-900"
      >
        {q.difficulty && (
          <span
            className={cn(
              "mb-3 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold",
              DIFFICULTY_CLASS[q.difficulty] ?? DIFFICULTY_CLASS.medium,
            )}
          >
            {t(`practice.difficulty.${q.difficulty}`)}
          </span>
        )}
        <McqBlock
          question={q.question}
          options={q.options}
          answerIndex={q.roundAnswer}
          explanation={q.explanation}
          citation={q.citation}
          picked={picked}
          onPick={(i, correct) => {
            setPicks((prev) => (prev[q.id] !== undefined ? prev : { ...prev, [q.id]: i }));
            if (correct) celebrateCompletion();
          }}
          isPlay={isPlay}
        />
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => (isLast ? finish() : setPosition((p) => p + 1))}
          disabled={picked === null}
          className={cn(
            "h-11 gap-2 px-5",
            isPlay
              ? "rounded-play-btn bg-play-success font-black uppercase text-white shadow-play-2d-success hover:bg-play-success"
              : "rounded-xl",
          )}
        >
          {isLast ? t("practice.seeScore") : t("practice.nextQuestion")}
          <ArrowRight className="size-4 rtl:rotate-180" weight="bold" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
