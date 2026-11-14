import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  ArrowCounterClockwise,
  ChatCircleDots,
  Exam,
  FlagCheckered,
  Target,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HtmlSlideIframe } from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/html-slide-iframe";
import { celebrateCompletion, celebrateMilestone } from "@/lib/play-celebration";
import {
  getCompanionSpeech,
  openLesson,
  pollLesson,
  recordProgress,
  type CompanionLeaf,
  type CompanionPublic,
  type LessonCard,
  type LessonCardKind,
  type ProgressUpdate,
  type ProgressUpdateResponse,
} from "@/services/kb-companion-api";
import { usePolledArtifact } from "./usePolledArtifact";
import type { ReadAloud } from "./useReadAloud";
import { CitationChip, ProgressRingMini } from "./CompanionVisuals";
import {
  ErrorPanel,
  McqBlock,
  PreparingState,
  ReadAloudButton,
} from "./CompanionParts";
import { companionErrorText, masteryTone } from "./companion-utils";

const SAVE_DEBOUNCE_MS = 800;
const SWIPE_PX = 60;

const KIND_GLYPH: Record<LessonCardKind, string> = {
  hook: "💡",
  concept: "🧠",
  figure: "🔍",
  compare: "⚖️",
  process: "🔁",
  example: "✏️",
  flashcards: "🃏",
  check: "✅",
  recap: "📌",
};

/**
 * The lesson player: one visual card at a time, big and central.
 *
 * The lesson is compiled once per topic and shared by every learner, so the
 * first learner of a topic watches it being built (cards appear as they are
 * ready); everyone after opens it instantly. Position is saved on every move
 * (debounced) and a reopened topic resumes at the saved card.
 */
export function LessonPlayer({
  companionId,
  companion,
  leaf,
  nextLeaf,
  readAloud,
  isPlay,
  onProgress,
  onPractice,
  onOpenLeaf,
  onAskAboutCard,
}: {
  companionId: string;
  companion: CompanionPublic;
  leaf: CompanionLeaf;
  nextLeaf: CompanionLeaf | null;
  readAloud: ReadAloud;
  isPlay: boolean;
  onProgress: (nodeId: string, response: ProgressUpdateResponse) => void;
  onPractice: (() => void) | null;
  onOpenLeaf: (leafId: string) => void;
  onAskAboutCard: ((card: LessonCard) => void) | null;
}) {
  const { t } = useTranslation("kbCompanion");
  const nodeId = leaf.id;
  const { data, error, loading, retry } = usePolledArtifact(
    nodeId,
    () => openLesson(companionId, nodeId),
    () => pollLesson(companionId, nodeId),
  );

  const cards = useMemo(() => data?.cards ?? [], [data]);
  const total = Math.max(data?.cards_planned ?? 0, cards.length);
  const readyCount = cards.filter((c) => c.status === "ready").length;
  const lessonReady = data?.status === "READY";

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [finalMastery, setFinalMastery] = useState<number | null>(null);
  const startedFor = useRef<string | null>(null);

  // Resume where the learner left off, once, when this topic's cards arrive.
  useEffect(() => {
    if (!data || cards.length === 0 || startedFor.current === nodeId) return;
    startedFor.current = nodeId;
    const saved = leaf.progress;
    const start =
      saved && saved.status !== "COMPLETED"
        ? Math.max(0, Math.min(saved.card_index, cards.length - 1))
        : 0;
    setIndex(start);
    setAnswers({});
    setFinalMastery(null);
  }, [data, cards.length, nodeId, leaf.progress]);

  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const save = useCallback(
    async (body: Omit<ProgressUpdate, "node_id">) => {
      try {
        const res = await recordProgress(companionId, { node_id: nodeId, ...body });
        onProgressRef.current(nodeId, res);
        return res;
      } catch {
        return null;
      }
    },
    [companionId, nodeId],
  );

  const onCompletionScreen = cards.length > 0 && index >= cards.length;

  // Auto-save the position on every card change (debounced).
  useEffect(() => {
    if (startedFor.current !== nodeId || cards.length === 0 || onCompletionScreen) return;
    const timer = window.setTimeout(() => {
      void save({ card_index: index, cards_total: total || cards.length });
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [index, nodeId, cards.length, total, onCompletionScreen, save]);

  // A new card silences the previous narration.
  const stopVoice = readAloud.stop;
  useEffect(() => {
    stopVoice();
  }, [index, nodeId, stopVoice]);

  const finish = useCallback(async () => {
    setIndex(cards.length);
    celebrateMilestone();
    const res = await save({
      card_index: Math.max(0, cards.length - 1),
      cards_total: total || cards.length,
      completed: true,
    });
    const mastery = res?.node?.mastery;
    setFinalMastery(typeof mastery === "number" ? mastery : null);
  }, [cards.length, total, save]);

  const goNext = useCallback(() => {
    if (index >= cards.length) return;
    if (index === cards.length - 1) {
      if (lessonReady) void finish();
      return;
    }
    setIndex((i) => Math.min(i + 1, cards.length - 1));
  }, [index, cards.length, lessonReady, finish]);

  const goPrev = useCallback(() => setIndex((i) => Math.max(0, Math.min(i, cards.length) - 1)), [cards.length]);

  // Keyboard arrows (ignored while typing somewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const rtl = document.documentElement.dir === "rtl";
      if (e.key === (rtl ? "ArrowLeft" : "ArrowRight")) goNext();
      else if (e.key === (rtl ? "ArrowRight" : "ArrowLeft")) goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev]);

  // Swipe on touch screens (the card chrome; the iframe keeps its own touches).
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const touch = e.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    const touch = e.changedTouches[0];
    touchStart.current = null;
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const rtl = document.documentElement.dir === "rtl";
    if ((dx < 0) !== rtl) goNext();
    else goPrev();
  };

  const pickAnswer = (card: LessonCard, picked: number, correct: boolean) => {
    if (answers[card.id] !== undefined) return;
    setAnswers((prev) => ({ ...prev, [card.id]: picked }));
    if (correct) celebrateCompletion();
    void save({
      card_index: index,
      cards_total: total || cards.length,
      check: { card_id: card.id, correct },
    });
  };

  // ── states ──────────────────────────────────────────────────────────────
  if (error) {
    return <ErrorPanel message={companionErrorText(t, error, "errors.lesson")} onRetry={retry} />;
  }
  if (loading && !data) {
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-7 w-2/3 rounded-lg" />
        <Skeleton className="h-96 w-full rounded-2xl" />
        <div className="flex justify-between">
          <Skeleton className="h-10 w-24 rounded-xl" />
          <Skeleton className="h-10 w-24 rounded-xl" />
        </div>
      </div>
    );
  }
  if (!data) return null;
  if (data.status === "FAILED") {
    return <ErrorPanel message={data.error || t("errors.lesson")} onRetry={retry} />;
  }
  if (cards.length === 0 || readyCount === 0) {
    if (data.status === "READY") {
      return <ErrorPanel message={t("errors.emptyLesson")} onRetry={retry} />;
    }
    return (
      <PreparingState
        headline={t("lesson.preparing")}
        title={data.title || leaf.title}
        ready={readyCount}
        total={total}
      />
    );
  }

  // ── completion ──────────────────────────────────────────────────────────
  if (onCompletionScreen) {
    const checks = cards.filter((c) => c.kind === "check");
    const right = checks.filter((c) => c.check && answers[c.id] === c.check.answer_index).length;
    const mastery = finalMastery ?? leaf.progress?.mastery ?? null;
    return (
      <div className="animate-in fade-in zoom-in-95 flex flex-col items-center gap-6 rounded-2xl border border-neutral-200 bg-white px-6 py-10 text-center shadow-sm duration-500 dark:border-neutral-800 dark:bg-neutral-900">
        <span className="play-bounce-in text-6xl" aria-hidden>
          🎉
        </span>
        <div className="space-y-1">
          <h3 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("lesson.completeTitle")}</h3>
          <p className="text-base text-neutral-600 dark:text-neutral-400">{data.title || leaf.title}</p>
        </div>
        {mastery !== null && (
          <div className="flex flex-col items-center gap-2">
            <ProgressRingMini percent={mastery} size="lg" tone={masteryTone(mastery)}>
              <span className="text-lg font-bold tabular-nums text-neutral-900 dark:text-neutral-50">{mastery}%</span>
            </ProgressRingMini>
            <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400">{t("lesson.mastery")}</p>
          </div>
        )}
        {checks.length > 0 && (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {t("lesson.checksScore", { right, total: checks.length })}
          </p>
        )}
        <div className="flex w-full max-w-md flex-col gap-2.5 sm:flex-row sm:justify-center">
          {onPractice && (
            <Button onClick={onPractice} variant="outline" className="h-11 gap-2 rounded-xl">
              <Exam className="size-5" weight="duotone" aria-hidden />
              {t("lesson.practiceThis")}
            </Button>
          )}
          {nextLeaf ? (
            <Button
              onClick={() => onOpenLeaf(nextLeaf.id)}
              className={cn(
                "h-11 gap-2",
                isPlay
                  ? "rounded-play-btn bg-play-success font-black uppercase text-white shadow-play-2d-success hover:bg-play-success"
                  : "rounded-xl",
              )}
            >
              <span className="truncate">{t("lesson.nextTopic", { title: nextLeaf.title })}</span>
              <ArrowRight className="size-4 rtl:rotate-180" weight="bold" aria-hidden />
            </Button>
          ) : (
            <p className="text-sm font-semibold text-success-600">{t("lesson.allTopicsDone")}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIndex(0)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-primary-500"
        >
          <ArrowCounterClockwise className="size-4" aria-hidden />
          {t("lesson.reviewAgain")}
        </button>
      </div>
    );
  }

  // ── the card ────────────────────────────────────────────────────────────
  const card = cards[Math.min(index, cards.length - 1)];
  const isLast = index === cards.length - 1;
  const voiceKey = `card:${nodeId}:${card.id}`;
  const canSpeak = companion.voice_enabled && card.status === "ready" && !!(card.say || card.title);
  const nextBlocked = isLast && !lessonReady;

  return (
    <div className="space-y-4" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* Card meta */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-bold text-primary-500 dark:bg-primary-500/10">
          <span aria-hidden>{KIND_GLYPH[card.kind] ?? "📘"}</span>
          {t(`kinds.${card.kind}`, { defaultValue: t("kinds.concept") })}
        </span>
        <span className="text-xs font-medium tabular-nums text-neutral-500 dark:text-neutral-400">
          {t("lesson.cardOf", { current: index + 1, total: total || cards.length })}
        </span>
        <span className="ms-auto flex items-center gap-2">
          {canSpeak && (
            <ReadAloudButton
              active={readAloud.activeKey === voiceKey}
              loading={readAloud.activeKey === voiceKey && readAloud.phase === "loading"}
              onClick={() =>
                void readAloud.play(
                  voiceKey,
                  async () => (await getCompanionSpeech(companionId, { node_id: nodeId, card_id: card.id })).url,
                  card.say || card.title,
                )
              }
            />
          )}
        </span>
      </div>

      <div key={card.id} className="animate-in fade-in slide-in-from-bottom-2 space-y-3 duration-300">
        <h3 className="text-xl font-bold leading-tight text-neutral-900 sm:text-2xl dark:text-neutral-50">
          {card.title}
        </h3>
        {card.objective && (
          <p className="flex items-start gap-1.5 text-sm text-neutral-600 dark:text-neutral-400">
            <Target className="mt-0.5 size-4 shrink-0 text-primary-500" weight="duotone" aria-hidden />
            <span>{card.objective}</span>
          </p>
        )}

        {card.status !== "ready" ? (
          <PreparingState
            headline={t("lesson.cardPreparing")}
            ready={readyCount}
            total={total}
          />
        ) : card.kind === "check" && card.check ? (
          <div className="rounded-2xl border border-neutral-200 bg-white p-card-lg shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            <McqBlock
              question={card.check.question}
              options={card.check.options}
              answerIndex={card.check.answer_index}
              explanation={card.check.explanation}
              picked={answers[card.id] ?? null}
              onPick={(i, correct) => pickAnswer(card, i, correct)}
              isPlay={isPlay}
            />
          </div>
        ) : card.html_doc ? (
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800">
            <HtmlSlideIframe key={card.id} html={card.html_doc} />
          </div>
        ) : (
          <div className="rounded-2xl border border-neutral-200 bg-white p-card-lg text-base leading-relaxed text-neutral-800 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100">
            {card.say || card.title}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {card.citation && <CitationChip label={card.citation} />}
          {onAskAboutCard && card.status === "ready" && (
            <button
              type="button"
              onClick={() => onAskAboutCard(card)}
              className="ms-auto inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10"
            >
              <ChatCircleDots className="size-4" weight="duotone" aria-hidden />
              {t("lesson.askAboutCard")}
            </button>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-3 border-t border-neutral-100 pt-4 dark:border-neutral-800">
        <Button
          variant="outline"
          onClick={goPrev}
          disabled={index === 0}
          className="h-11 gap-1.5 rounded-xl px-3 sm:px-4"
          aria-label={t("lesson.prev")}
        >
          <ArrowLeft className="size-4 rtl:rotate-180" weight="bold" aria-hidden />
          <span className="hidden sm:inline">{t("lesson.prev")}</span>
        </Button>

        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-1.5">
          {cards.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={t("lesson.goToCard", { number: i + 1 })}
              aria-current={i === index ? "step" : undefined}
              className={cn(
                "h-2 rounded-full transition-all duration-300",
                i === index
                  ? "w-6 bg-primary-500"
                  : c.status !== "ready"
                    ? "w-2 animate-pulse bg-neutral-200 dark:bg-neutral-700"
                    : c.kind === "check" && answers[c.id] !== undefined
                      ? c.check && answers[c.id] === c.check.answer_index
                        ? "w-2 bg-success-500"
                        : "w-2 bg-warning-500"
                      : i < index
                        ? "w-2 bg-primary-300"
                        : "w-2 bg-neutral-300 dark:bg-neutral-600",
              )}
            />
          ))}
        </div>

        <Button
          onClick={goNext}
          disabled={nextBlocked}
          className={cn(
            "h-11 gap-1.5 px-4",
            isPlay
              ? "rounded-play-btn bg-play-success font-black uppercase text-white shadow-play-2d-success hover:bg-play-success"
              : "rounded-xl",
          )}
        >
          {isLast ? (
            <>
              <FlagCheckered className="size-4" weight="bold" aria-hidden />
              {t("lesson.finish")}
            </>
          ) : (
            <>
              {t("lesson.next")}
              <ArrowRight className="size-4 rtl:rotate-180" weight="bold" aria-hidden />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
