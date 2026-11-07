import { useCallback, useEffect, useRef, useState, type UIEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { GraduationCap, Prohibit, WarningCircle } from "@phosphor-icons/react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { MyButton } from "@/components/design-system/button";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePlayTheme } from "@/hooks/use-play-theme";
import { useCleanerPlayTheme } from "@/hooks/use-cleaner-play-theme";
import { celebrate, celebrationKindFor } from "@/lib/play-celebration";
import { cn } from "@/lib/utils";
import {
  engagementErrorMessage,
  engagementOutcome,
  engagementReasonAction,
  fetchEngagementItem,
  parseSlideTarget,
  type EngagementItem,
  type EngagementSubmitRequest,
  type EngagementSubmitResponse,
} from "@/services/engagement";
import type { SlideResult } from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/html-slide-iframe";
import { EngagementResult } from "../EngagementResult";
import {
  answerFormat,
  effectivePoints,
  isCompleted,
  outcomeOf,
  pointsLine,
  revealCopy,
} from "../engagement-copy";
import { useEngagementDraft } from "../engagement-draft-store";
import { ecn, skinClasses, toneClasses } from "../engagement-tone";
import { visualFor } from "../engagement-visuals";
import {
  ENGAGEMENT_FEED_KEY,
  resultPatch,
  useServerClockSkew,
  useSubmitEngagement,
} from "../use-engagement-feed";
import { FlashcardsBody } from "../flashcards/FlashcardsBody";
import { GameBody, gameScoreOf, type GameScore } from "./GameBody";
import { formatCountdown, type GateItem } from "./GateChecklist";
import { QuestionBody, type QuestionOutcome } from "./QuestionBody";
import { ReadingBody } from "./ReadingBody";
import { RunnerFooter, type RunnerCta } from "./RunnerFooter";
import { RunnerHeader, type RunnerPosition } from "./RunnerHeader";
import { TextBody } from "./TextBody";
import { UploadBody, useUploadQueue } from "./UploadBody";
import { openLessonTarget } from "./use-lesson-return";

/**
 * One runner for every task type (learner plan §3.5): a Sheet from the end
 * edge at sm and up, a full-height bottom sheet on phones, with a sticky header
 * (the stakes) and a sticky footer (the one action, its gates, the server's
 * refusal, then the result and "Next").
 *
 * Opening a task GETs item/{id}, which records the server-side start the
 * reading and game gates are measured from. Submits go through
 * `useSubmitEngagement` (optimistic in the feed, points moved once).
 */

/** Query key prefix of the full item (kept apart from the feed's keys). */
export const ENGAGEMENT_ITEM_KEY = ["engagement", "item"] as const;

/** Types whose body is the item's document, which the feed leaves off done rows. */
const DOCUMENT_TYPES = new Set<EngagementItem["itemType"]>(["READING_HTML", "VISUAL_NOTE", "GAME"]);

/** Server defaults, used when an older server sends no gate in the DTO. */
export const DEFAULT_MIN_READ_MS = 15_000;
export const DEFAULT_MIN_GAME_MS = 20_000;
/** The "Game not loading? Mark complete" hatch, measured from the server start. */
export const GAME_HATCH_MS = 60_000;

/** Fields the learner DTO carries that the shared client type doesn't list yet. */
type RunnerItem = EngagementItem & {
  minGameMs?: number | null;
  textAnswer?: string | null;
  fileIds?: string[] | null;
};

export type RunnerKind =
  | "reading"
  | "game"
  | "choice"
  | "poll"
  | "text"
  | "upload"
  | "lesson"
  | "flashcards"
  | "unsupported";

/** Which body and which action a task gets. */
export function runnerKind(item: Pick<EngagementItem, "itemType" | "payloadJson">): RunnerKind {
  switch (item.itemType) {
    case "READING_HTML":
    case "VISUAL_NOTE":
      return "reading";
    case "GAME":
      return "game";
    case "POLL":
      return "poll";
    case "COURSE_SLIDE":
      return "lesson";
    case "FLASHCARDS":
      return "flashcards";
    case "QUESTION_OF_DAY": {
      const format = answerFormat(item);
      return format === "TEXT" ? "text" : format === "UPLOAD" ? "upload" : "choice";
    }
    default:
      // QUIZ has no assessment behind it yet (D52): never offer a button that pays.
      return "unsupported";
  }
}

/** Device "now" that re-renders every second while `active` and the tab is visible. */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (!document.hidden) setNow(Date.now());
    };
    tick();
    const timer = window.setInterval(tick, 1_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active]);
  return now;
}

function parseMs(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

// ── Runner (the Sheet) ─────────────────────────────────────────────────────

export interface EngagementTaskRunnerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The task shown; the body remounts when it changes. */
  itemId: string | null;
  /** What the opener already knows (feed row): header while loading, read-only data. */
  seed?: EngagementItem | null;
  /** Show the task without its action (a Done row). */
  readOnly?: boolean;
  position?: RunnerPosition | null;
  /** The task "Next" moves to after this one is done. */
  nextItem?: EngagementItem | null;
  onNext?: () => void;
  /** Gamification on: points, rewards and celebrations. */
  showPoints?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
  /** A submit the server accepted. */
  onCompleted?: (itemId: string, response: EngagementSubmitResponse) => void;
}

export function EngagementTaskRunner({
  open,
  onOpenChange,
  itemId,
  seed,
  readOnly,
  position,
  nextItem,
  onNext,
  showPoints = true,
  onCloseAutoFocus,
  onCompleted,
}: EngagementTaskRunnerProps) {
  const wide = useMediaQuery("(min-width: 640px)");
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // "Next" swaps the task under the learner's focus: the button they pressed
  // unmounts with the old task, so focus goes back to the sheet itself (the
  // new title is the first thing read) instead of falling to <body>.
  useEffect(() => {
    if (!open || !itemId) return;
    const frame = window.requestAnimationFrame(() => {
      const el = contentRef.current;
      if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, itemId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={contentRef}
        side={wide ? "right" : "bottom"}
        hideCloseButton
        // Radix would focus the first control, our close button, and paint its
        // focus ring on every open. Focus the sheet instead; Tab reaches the X first.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={onCloseAutoFocus}
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0 focus:outline-none",
          wide ? "w-full sm:max-w-2xl" : "h-dvh max-h-dvh w-full border-t-0"
        )}
      >
        {itemId && (
          <RunnerSession
            key={itemId}
            itemId={itemId}
            seed={seed?.id === itemId ? seed : null}
            readOnly={Boolean(readOnly)}
            position={position ?? null}
            nextItem={nextItem && nextItem.id !== itemId ? nextItem : null}
            onNext={onNext}
            showPoints={showPoints}
            onClose={close}
            onCompleted={onCompleted}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Session (one task) ─────────────────────────────────────────────────────

interface RunnerSessionProps {
  itemId: string;
  seed: EngagementItem | null;
  readOnly: boolean;
  position: RunnerPosition | null;
  nextItem: EngagementItem | null;
  onNext?: () => void;
  showPoints: boolean;
  onClose: () => void;
  onCompleted?: (itemId: string, response: EngagementSubmitResponse) => void;
}

function RunnerSession({
  itemId,
  seed,
  readOnly,
  position,
  nextItem,
  onNext,
  showPoints,
  onClose,
  onCompleted,
}: RunnerSessionProps) {
  const { t } = useTranslation("dashboardEngagement");
  const navigate = useNavigate();
  const skew = useServerClockSkew();
  const isPlay = usePlayTheme();
  const isCleanerPlay = useCleanerPlayTheme();
  const submitTask = useSubmitEngagement();
  const [openedAt] = useState(() => Date.now());

  // A read-only Done row already has everything; GET would refuse a closed task.
  // Except the document: the feed drops contentHtml from done rows, so a reading or a
  // game still asks GET for it (a refusal falls back to the seed below).
  const seedHasDocument =
    seed != null && (!DOCUMENT_TYPES.has(seed.itemType) || Boolean(seed.contentHtml));
  const seedOnly = readOnly && seed != null && seedHasDocument;
  const query = useQuery({
    queryKey: [...ENGAGEMENT_ITEM_KEY, itemId],
    queryFn: () => fetchEngagementItem(itemId),
    enabled: !seedOnly,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  // D30: never show another task's data while this one loads.
  const detail = query.data && query.data.id === itemId ? (query.data as RunnerItem) : null;
  const fallback = query.isError && seed && isCompleted(seed) ? (seed as RunnerItem) : null;
  const item: RunnerItem | null = detail ?? (seedOnly ? (seed as RunnerItem) : fallback);
  const loading = !item && !query.isError;
  const loadError = !item && query.isError ? engagementErrorMessage(query.error, t) : null;
  const loadErrorCloses = loadError != null && engagementReasonAction(loadError.reasonCode) === "close";
  const queryClient = useQueryClient();

  // D8: a task that closed (or isn't open) since the row was drawn: say so, close
  // the runner and refresh the feed so the row catches up.
  const loadErrorMessage = loadError?.message;
  useEffect(() => {
    if (!loadErrorCloses || !loadErrorMessage) return;
    toast.error(loadErrorMessage);
    void queryClient.invalidateQueries({ queryKey: ENGAGEMENT_FEED_KEY });
    onClose();
  }, [loadErrorCloses, loadErrorMessage, onClose, queryClient]);

  // ── Per-task state ──
  const draft = useEngagementDraft(itemId);
  const uploads = useUploadQueue();
  const [result, setResult] = useState<EngagementSubmitResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedChoice, setSubmittedChoice] = useState<string | null>(null);
  const [submittedText, setSubmittedText] = useState<string | null>(null);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [maxScroll, setMaxScroll] = useState(0);
  const [game, setGame] = useState<{ finished: boolean; score: GameScore | null }>({
    finished: false,
    score: null,
  });
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    // Set here too: StrictMode runs the cleanup once before the real mount.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const kind = item ? runnerKind(item) : null;
  const done = item ? isCompleted(item) : false;
  const answered = result != null || done;
  const interactive = Boolean(item) && !readOnly && !answered;
  const gated = interactive && (kind === "reading" || kind === "game");
  const deviceNow = useTicker(gated);
  const now = (gated ? deviceNow : Date.now()) + skew;

  // Gates run on the server's clock from the server's start (D48); an older
  // server without startedAt falls back to when this runner opened.
  const startMs = parseMs(item?.startedAt) ?? openedAt + skew;
  const elapsed = Math.max(0, now - startMs);
  const minReadMs = item?.minReadMs ?? DEFAULT_MIN_READ_MS;
  const minScroll = item?.minScrollPercent ?? 100;
  const minGameMs = item?.minGameMs ?? DEFAULT_MIN_GAME_MS;
  const hatchMs = Math.max(GAME_HATCH_MS, minGameMs + 10_000);
  const points = item ? effectivePoints(item) : 0;

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (el.scrollHeight <= 0) return;
    const percent = Math.min(100, Math.round(((el.scrollTop + el.clientHeight) / el.scrollHeight) * 100));
    setMaxScroll((prev) => (percent > prev ? percent : prev));
  }, []);

  // ── Submit ──
  const send = useCallback(
    async (request: EngagementSubmitRequest) => {
      if (!item || submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const response = await submitTask(item.id, request);
        if (!mounted.current) return;
        setResult(response);
        if (showPoints) {
          const celebration = celebrationKindFor(response);
          if (celebration) {
            celebrate(celebration, { skin: isPlay ? "play" : isCleanerPlay ? "cleanerPlay" : "other" });
          }
        }
        onCompleted?.(item.id, response);
      } catch (e) {
        const { message, reasonCode } = engagementErrorMessage(e, t);
        const action = engagementReasonAction(reasonCode);
        if (action === "close") {
          // TASK_CLOSED / NOT_OPEN / UNSUPPORTED_TYPE: nothing left to do here.
          toast.error(message);
          onClose();
          return;
        }
        if (action === "reload") void query.refetch();
        if (mounted.current) setError(message);
      } finally {
        if (mounted.current) setSubmitting(false);
      }
    },
    [item, submitting, submitTask, showPoints, isPlay, isCleanerPlay, onCompleted, t, onClose, query]
  );

  const openLesson = useCallback(() => {
    if (!item) return;
    // Close first so the sheet's exit doesn't fight the route change.
    onClose();
    openLessonTarget(navigate, item);
  }, [item, navigate, onClose]);

  // ── Footer: the one action and its gates ──
  const timeSpentMs = () => Date.now() - openedAt;
  let cta: RunnerCta | null = null;
  let gate: GateItem[] | null = null;
  let secondary: { label: string; onClick: () => void } | null = null;
  let scoreChip: string | null = null;
  const busyLabel = t("runner.sending");

  if (item && interactive) {
    switch (kind) {
      case "choice":
      case "poll": {
        const selected = draft.selectedId;
        cta = {
          label: submitting ? busyLabel : kind === "poll" ? t("runner.vote") : t("runner.check"),
          disabled: !selected,
          busy: submitting,
          onClick: () => {
            if (!selected) return;
            setSubmittedChoice(selected);
            void send({ selectedOptionId: selected, timeSpentMs: timeSpentMs() });
          },
        };
        break;
      }
      case "text": {
        const text = (draft.text ?? "").trim();
        cta = {
          label: submitting ? busyLabel : t("runner.text.send"),
          disabled: text.length === 0,
          busy: submitting,
          onClick: () => {
            setSubmittedText(text);
            void send({ textAnswer: text, timeSpentMs: timeSpentMs() });
          },
        };
        break;
      }
      case "upload":
        cta = {
          label: submitting
            ? busyLabel
            : uploads.uploading
              ? t("runner.upload.uploading")
              : t("runner.upload.send"),
          disabled: uploads.fileIds.length === 0 || uploads.uploading,
          busy: submitting,
          onClick: () => void send({ fileIds: uploads.fileIds, timeSpentMs: timeSpentMs() }),
        };
        break;
      case "reading": {
        const scrollOk = minScroll <= 0 || reachedEnd || maxScroll >= minScroll;
        const dwellOk = elapsed >= minReadMs;
        gate = [];
        if (minScroll > 0) {
          gate.push({
            id: "scroll",
            done: scrollOk,
            label: scrollOk ? t("runner.gate.reachedEnd") : t("runner.gate.scrollToEnd"),
          });
        }
        gate.push({
          id: "time",
          done: dwellOk,
          label: dwellOk
            ? t("runner.gate.readFor", { time: formatCountdown(minReadMs) })
            : t("runner.gate.keepReading", { time: formatCountdown(minReadMs - elapsed) }),
          srLabel: dwellOk
            ? t("runner.gate.readFor", { time: formatCountdown(minReadMs) })
            : t("runner.gate.keepReadingSr"),
        });
        cta = {
          label: submitting ? busyLabel : t("runner.reading.markRead"),
          disabled: !(scrollOk && dwellOk),
          busy: submitting,
          onClick: () =>
            void send({
              timeSpentMs: timeSpentMs(),
              scrollPercent: reachedEnd ? 100 : maxScroll,
            }),
        };
        break;
      }
      case "game": {
        const timeOk = elapsed >= minGameMs;
        const claimLabel =
          showPoints && points > 0 ? t("runner.game.claim", { count: points }) : t("runner.game.complete");
        if (game.score) {
          scoreChip =
            game.score.maxScore != null
              ? t("runner.game.score", { score: game.score.score, max: game.score.maxScore })
              : t("runner.game.scoreOnly", { score: game.score.score });
        }
        if (game.finished && !timeOk) {
          gate = [
            {
              id: "time",
              done: false,
              label: t("runner.gate.keepPlaying", { time: formatCountdown(minGameMs - elapsed) }),
              srLabel: t("runner.gate.keepPlayingSr"),
            },
          ];
        }
        cta = {
          label: submitting
            ? busyLabel
            : game.finished
              ? claimLabel
              : showPoints && points > 0
                ? t("runner.game.finishToClaim", { count: points })
                : t("runner.game.finishFirst"),
          disabled: !game.finished || !timeOk,
          busy: submitting,
          onClick: () =>
            void send({
              score: game.score?.score,
              timeSpentMs: timeSpentMs(),
            }),
        };
        // "Not loading?" only makes sense after the learner has watched this
        // frame for a while, so the hatch also waits a minute of this visit
        // (a game first opened hours ago must not offer it on sight).
        if (!game.finished && elapsed >= hatchMs && deviceNow - openedAt >= GAME_HATCH_MS) {
          secondary = {
            label: t("runner.game.hatch"),
            onClick: () => void send({ timeSpentMs: timeSpentMs() }),
          };
        }
        break;
      }
      case "lesson": {
        const target = parseSlideTarget(item);
        if (item.claimable === true) {
          cta = {
            label: submitting
              ? busyLabel
              : showPoints && points > 0
                ? t("runner.lesson.claim", { count: points })
                : t("runner.lesson.claimNoPoints"),
            disabled: false,
            busy: submitting,
            onClick: () => void send({}),
          };
        } else {
          cta = {
            label: target ? t("runner.lesson.open") : t("runner.lesson.unavailable"),
            disabled: !target,
            onClick: openLesson,
          };
        }
        break;
      }
      default:
        cta = null;
    }
  }

  // ── Result (footer, after the task is done) ──
  const nowForCopy = Date.now() + skew;
  const resultNode = (() => {
    if (!item) return null;
    // The flashcards body draws its own summary (and its own Next).
    if (kind === "flashcards") return null;
    if (result) {
      const echoDetail = kind === "text" || kind === "upload" ? revealCopy(item, result, t, nowForCopy) : null;
      return (
        <EngagementResult
          variant="compact"
          outcome={engagementOutcome(result)}
          points={result.pointsAwarded}
          revealAt={item.revealAt}
          answerAlreadyOut={result.answerAlreadyOut}
          alreadyCompleted={result.alreadyCompleted}
          showPoints={showPoints}
          detail={echoDetail ?? undefined}
          now={nowForCopy}
        />
      );
    }
    if (done) {
      return (
        <EngagementResult
          variant="compact"
          outcome={outcomeOf(item)}
          points={item.pointsAwarded}
          revealAt={item.revealAt}
          showPoints={showPoints}
          now={nowForCopy}
        />
      );
    }
    return null;
  })();

  // ── Body ──
  const questionOutcome: QuestionOutcome | null = (() => {
    if (!item || (kind !== "choice" && kind !== "poll")) return null;
    if (result) {
      return {
        selectedId: submittedChoice,
        correctId: result.correctOptionId ?? null,
        isCorrect: result.resultPending ? null : (result.isCorrect ?? null),
        pollResults: result.pollResults ?? null,
        responseCount: result.responseCount ?? null,
        explanation: result.explanation ?? null,
      };
    }
    if (done || readOnly) {
      return {
        selectedId: item.selectedOptionId ?? null,
        correctId: item.correctOptionId ?? null,
        isCorrect: item.resultPending ? null : (item.isCorrect ?? null),
        pollResults: item.pollResults ?? null,
        responseCount: item.responseCount ?? null,
        explanation: item.explanation ?? null,
      };
    }
    return null;
  })();

  const body = (() => {
    if (loading) {
      return (
        <div aria-busy="true" className="flex flex-col gap-3 px-4 py-6 sm:px-6">
          <span className="sr-only">{t("runner.loading")}</span>
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-11 min-h-11 w-full" />
        </div>
      );
    }
    if (loadError) {
      const final = loadErrorCloses;
      return (
        <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <WarningCircle aria-hidden weight="duotone" className={ecn("size-10", skinClasses("mutedInk"))} />
          <p className={ecn("text-subtitle font-semibold", skinClasses("ink"))}>
            {final ? loadError.message : t("runner.openError")}
          </p>
          {!final && <p className={ecn("text-body", skinClasses("mutedInk"))}>{loadError.message}</p>}
          <div className="flex flex-wrap justify-center gap-2">
            {!final && (
              <MyButton type="button" buttonType="primary" scale="medium" className="h-11 min-h-11" onClick={() => void query.refetch()}>
                {t("runner.retry")}
              </MyButton>
            )}
            <MyButton type="button" buttonType="secondary" scale="medium" className="h-11 min-h-11" onClick={onClose}>
              {t("runner.close")}
            </MyButton>
          </div>
        </div>
      );
    }
    if (!item) return null;
    const visual = visualFor(item);
    switch (kind) {
      case "reading":
        return <ReadingBody item={item} scrollRoot={scrollEl} onReachedEnd={() => setReachedEnd(true)} />;
      case "game":
        return (
          <GameBody
            item={item}
            finished={game.finished}
            score={game.score}
            onComplete={(slideResult: SlideResult) =>
              setGame({ finished: true, score: gameScoreOf(slideResult, item.maxScore) })
            }
          />
        );
      case "choice":
      case "poll":
        return (
          <QuestionBody
            item={item}
            isPoll={kind === "poll"}
            selectedId={draft.selectedId}
            onSelect={(id) => {
              setError(null);
              draft.setSelected(id);
            }}
            outcome={questionOutcome}
            revealHint={interactive ? revealCopy(item, null, t, nowForCopy) : null}
            disabled={!interactive || submitting}
            tone={visual.tone}
            onBeforeAskTutor={onClose}
          />
        );
      case "text":
        return (
          <TextBody
            item={item}
            value={draft.text ?? ""}
            onChange={(text) => {
              setError(null);
              draft.setText(text);
            }}
            submitted={answered || readOnly ? (submittedText ?? item.textAnswer ?? "") : null}
            disabled={submitting}
          />
        );
      case "upload":
        return (
          <UploadBody
            item={item}
            queue={uploads}
            submitted={answered || readOnly}
            submittedCount={item.fileIds?.length ?? 0}
            disabled={submitting}
          />
        );
      case "lesson":
        return <LessonBody item={item} />;
      case "flashcards":
        // It owns its rating footer and its summary, including a deck finished
        // earlier (read-only). Its Next hands control back here.
        return (
          <FlashcardsBody
            item={item}
            showPoints={showPoints}
            onSubmitted={(response) => {
              setResult(response);
              onCompleted?.(item.id, response);
            }}
            onComplete={() => {
              if (nextItem && onNext) onNext();
              else onClose();
            }}
          />
        );
      default:
        return (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <Prohibit aria-hidden weight="duotone" className={ecn("size-10", skinClasses("mutedInk"))} />
            <p className={ecn("text-subtitle font-semibold", skinClasses("ink"))}>{t("runner.unsupported")}</p>
            <p className={ecn("text-body", skinClasses("mutedInk"))}>{t("runner.unsupportedHint")}</p>
          </div>
        );
    }
  })();

  // The header reads the task as done (outcome badge, no stakes) once answered.
  const headerItem: EngagementItem | null = item
    ? result
      ? { ...item, ...resultPatch(result) }
      : item
    : seed;

  // ── Footer phase ──
  const backLabel =
    typeof window !== "undefined" && window.location.pathname.startsWith("/dashboard")
      ? t("runner.backToDashboard")
      : t("runner.backToTasks");
  // FLASHCARDS: the body owns every action, down to Next.
  const showFooter = Boolean(item) && kind !== "flashcards";
  const phase: "answer" | "done" = interactive && cta ? "answer" : "done";

  return (
    <>
      <RunnerHeader
        item={headerItem}
        position={position}
        onClose={onClose}
        showPoints={showPoints}
        now={nowForCopy}
      />
      <div
        ref={setScrollEl}
        onScroll={kind === "reading" ? onScroll : undefined}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="min-w-0">{body}</div>
      </div>
      {showFooter && (
        <RunnerFooter
          phase={phase}
          gate={gate}
          error={error}
          rewardLine={showPoints && item ? pointsLine(item, t, nowForCopy) : ""}
          scoreChip={scoreChip}
          cta={cta}
          secondary={secondary}
          result={resultNode}
          next={nextItem && onNext ? { title: nextItem.title, onClick: onNext } : null}
          onBack={onClose}
          backLabel={backLabel}
          nextLabel={(title) => t("runner.next", { title })}
          focusOnDone={result != null}
        />
      )}
    </>
  );
}

// ── Small bodies ─────────────────────────────────────────────────────────

function LessonBody({ item }: { item: EngagementItem }) {
  const { t } = useTranslation("dashboardEngagement");
  const target = parseSlideTarget(item);
  const visual = visualFor(item);
  const hint = isCompleted(item)
    ? null
    : item.claimable === true
      ? t("runner.lesson.claimableHint")
      : target
        ? t("runner.lesson.hint")
        : t("runner.lesson.brokenHint");
  return (
    <div className="px-4 py-6 sm:px-6">
      <div
        className={ecn(
          "flex flex-col items-center gap-3 rounded-lg border p-card-lg text-center",
          skinClasses("divider"),
          toneClasses(visual.tone, "surface")
        )}
      >
        <span
          aria-hidden
          className={ecn("flex size-12 items-center justify-center rounded-lg", toneClasses(visual.tone, "tile"))}
        >
          <GraduationCap weight="duotone" className="size-6" />
        </span>
        <p dir="auto" className={ecn("text-subtitle font-semibold", skinClasses("ink"))}>
          {target?.slideTitle ?? item.title}
        </p>
        {hint && (
          <p
            className={ecn(
              "max-w-md text-body",
              target || item.claimable ? skinClasses("mutedInk") : "text-danger-700 [.ui-play_&]:text-play-danger-soft-ink"
            )}
          >
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
