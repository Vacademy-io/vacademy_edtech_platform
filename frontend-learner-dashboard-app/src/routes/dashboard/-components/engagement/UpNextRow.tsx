import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { toast } from "sonner";
import type { IconWeight } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import {
  engagementErrorMessage,
  engagementReasonAction,
  parseQuestionPayload,
  parseSlideTarget,
  type EngagementItem,
  type EngagementSubmitResponse,
} from "@/services/engagement";
import {
  celebrate,
  celebrationKindFor,
  type CelebrationSkin,
} from "@/lib/play-celebration";
import { visualFor } from "./engagement-visuals";
import { ecn, skinClasses, toneClasses } from "./engagement-tone";
import {
  answerFormat,
  catchUpLine,
  durationLabel,
  formatClock,
  isCompleted,
  outcomeOf,
  pointsBreakdown,
  pointsLine,
  revealCopy,
  showsOwnDeadline,
  typeLabel,
  type EngagementResultLike,
} from "./engagement-copy";
import {
  estimateReadMinutes,
  flashcardCount,
  glimpseFor,
  promptTextFor,
} from "./engagement-preview";
import { useEngagementDraft, usePinnedUpNext, useEngagementDraftStore } from "./engagement-draft-store";
import { useSubmitEngagement } from "./use-engagement-feed";
import { ChoiceOptions } from "./ChoiceOptions";
import { EngagementResult } from "./EngagementResult";
import { MustDoBadge, PointsChip } from "./EngagementBadge";
import { TimeLeft } from "./TimeLeft";
import { BatchMark, STRETCHED_TITLE, TypeTile, type TaskBatch } from "./TaskRow";

/**
 * The one task the Today module puts first (D3, D7, D11, D12, D18, D34, D47, D53).
 *
 * - Main slot: a multiple-choice question or poll is answered right here:
 *   select, then Check / Vote (never on tap). The result stays, pinned, with a
 *   primary "Next task", until the learner moves on (D7). Every other type opens
 *   the runner.
 * - Rail slot: no inline options fit; the prompt plus "Answer" opens the runner.
 * - The in-flight / answered state lives in a small store keyed by task, so a
 *   resize that moves the module between slots keeps the result on screen.
 */

// --- Session store of inline answers --------------------------------------------------

export interface UpNextOutcome {
  status: "submitting" | "done";
  selectedOptionId?: string;
  response?: EngagementSubmitResponse;
}

interface UpNextOutcomeState {
  byId: Record<string, UpNextOutcome>;
  set: (itemId: string, outcome: UpNextOutcome) => void;
  clear: (itemId: string) => void;
}

export const useUpNextOutcomeStore = create<UpNextOutcomeState>((set) => ({
  byId: {},
  set: (itemId, outcome) => set((s) => ({ byId: { ...s.byId, [itemId]: outcome } })),
  clear: (itemId) =>
    set((s) => {
      if (!(itemId in s.byId)) return s;
      const next = { ...s.byId };
      delete next[itemId];
      return { byId: next };
    }),
}));

// --- The primary action ----------------------------------------------------------------

export type UpNextActionKind =
  | "answer"
  | "vote"
  | "write"
  | "attach"
  | "read"
  | "play"
  | "openLesson"
  | "claim"
  | "lessonUnavailable"
  | "study"
  | "open";

/** Which primary action a task offers when it is not answered inline. Pure. */
export function upNextActionKind(item: EngagementItem): UpNextActionKind {
  switch (item.itemType) {
    case "QUESTION_OF_DAY": {
      const format = answerFormat(item);
      if (format === "TEXT") return "write";
      if (format === "UPLOAD") return "attach";
      return "answer";
    }
    case "POLL":
      return "vote";
    case "READING_HTML":
    case "VISUAL_NOTE":
      return "read";
    case "GAME":
      return "play";
    case "COURSE_SLIDE":
      if (!parseSlideTarget(item)) return "lessonUnavailable";
      return item.claimable ? "claim" : "openLesson";
    case "FLASHCARDS":
      return "study";
    default:
      return "open";
  }
}

function actionLabel(kind: UpNextActionKind, item: EngagementItem, t: TFunction, showPoints: boolean): string {
  switch (kind) {
    case "read": {
      const minutes = estimateReadMinutes(item);
      return minutes ? t("today.cta.readMinutes", { count: minutes }) : t("today.cta.read");
    }
    case "claim": {
      const points = pointsBreakdown(item).total;
      return showPoints && points > 0 ? t("today.cta.claimPoints", { count: points }) : t("today.cta.claim");
    }
    case "study": {
      const count = flashcardCount(item);
      return count > 0 ? t("today.cta.studyCards", { count }) : t("today.cta.study");
    }
    default:
      return t(`today.cta.${kind}`);
  }
}

/** A multiple-choice question or poll with options the row can show. */
export function inlineOptions(item: EngagementItem): { id: string; text: string }[] | null {
  const isMcq = item.itemType === "QUESTION_OF_DAY" && answerFormat(item) === "MCQ";
  if (!isMcq && item.itemType !== "POLL") return null;
  const options = (parseQuestionPayload(item)?.options ?? []).filter(
    (o) => o && typeof o.id === "string" && typeof o.text === "string"
  );
  return options.length >= 2 ? options : null;
}

/** Vibrant greets the first Up next of the session with one pulse (§3.8). */
let vibrantPulseShown = false;

// --- Component ---------------------------------------------------------------------------

export interface UpNextRowProps {
  item: EngagementItem;
  slot: "main" | "rail";
  /** Pinned: the task was answered here and stays until "Next task". */
  pinned: boolean;
  /** Whether another open task follows (labels the button "Next task" or "Finish"). */
  hasNext: boolean;
  onOpen: (item: EngagementItem) => void;
  onNext: () => void;
  showPoints?: boolean;
  sharedDeadline?: string | null;
  now: number;
  batch?: TaskBatch | null;
  iconWeight?: IconWeight;
  celebrationSkin?: CelebrationSkin;
  /** Move focus to the title once mounted (after "Next task"). */
  autoFocusTitle?: boolean;
  onAutoFocused?: () => void;
  className?: string;
}

export function UpNextRow({
  item,
  slot,
  pinned,
  hasNext,
  onOpen,
  onNext,
  showPoints = true,
  sharedDeadline = null,
  now,
  batch,
  iconWeight = "duotone",
  celebrationSkin = "other",
  autoFocusTitle,
  onAutoFocused,
  className,
}: UpNextRowProps) {
  const { t } = useTranslation("dashboardEngagement");
  const promptId = useId();
  const titleRef = useRef<HTMLButtonElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const submit = useSubmitEngagement();
  const draft = useEngagementDraft(item.id);
  const { pin, release } = usePinnedUpNext();
  const entry = useUpNextOutcomeStore((s) => s.byId[item.id]);
  const [error, setError] = useState<string | null>(null);
  const [pulse] = useState(() => {
    if (vibrantPulseShown) return false;
    vibrantPulseShown = true;
    return true;
  });

  const visual = visualFor(item);
  const options = inlineOptions(item);
  const isPoll = item.itemType === "POLL";
  const inline = slot === "main" && options != null;
  const submitting = entry?.status === "submitting";
  const answered = pinned && !submitting && (entry?.status === "done" || isCompleted(item));
  const isCatchUp = item.state === "CATCH_UP";

  // After "Next task" the new Up next takes focus (D7). Keyed on the flag too:
  // when the same task stays Up next (the server still has it open) the row
  // doesn't remount, and focus must not fall back to <body>.
  useEffect(() => {
    if (!autoFocusTitle || pinned) return;
    titleRef.current?.focus();
    onAutoFocused?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, autoFocusTitle, pinned]);

  // Once the result shows, "Next task" takes focus: the options that had it are gone.
  const answeredOnce = useRef(answered);
  useEffect(() => {
    if (answered && !answeredOnce.current) {
      answerRef.current?.querySelector<HTMLButtonElement>("[data-up-next-action]")?.focus();
    }
    answeredOnce.current = answered;
  }, [answered]);

  const confirm = async () => {
    const chosen = draft.selectedId;
    if (!chosen || submitting) return;
    setError(null);
    const store = useUpNextOutcomeStore.getState();
    // Pin first: the optimistic update marks the task done at once, and the
    // module must not move on to another task under the learner's cursor.
    store.set(item.id, { status: "submitting", selectedOptionId: chosen });
    pin(item.id);
    try {
      const response = await submit(item.id, { selectedOptionId: chosen });
      useUpNextOutcomeStore.getState().set(item.id, {
        status: "done",
        selectedOptionId: chosen,
        response,
      });
      if (showPoints) {
        // Never for a wrong answer, a hidden result or a repeat submit (D23).
        const kind = celebrationKindFor(response);
        if (kind) celebrate(kind, { skin: celebrationSkin });
      }
    } catch (e) {
      useUpNextOutcomeStore.getState().clear(item.id);
      if (useEngagementDraftStore.getState().pinnedUpNextId === item.id) release();
      const { message, reasonCode } = engagementErrorMessage(e, t);
      if (engagementReasonAction(reasonCode) === "close") {
        // The task is gone from the feed after the refetch; say why where it stays visible.
        toast.error(message);
      } else {
        setError(message);
      }
    }
  };

  // --- Result data (this session's response wins over the cached row) ---
  const response = entry?.response;
  const result: EngagementResultLike = {
    isCorrect: response ? response.isCorrect : item.isCorrect,
    resultPending: response ? response.resultPending : item.resultPending,
    pointsAwarded: response ? response.pointsAwarded : item.pointsAwarded,
    isRevealed: response ? response.isRevealed : item.isRevealed,
    correctOptionId: response?.correctOptionId ?? item.correctOptionId,
    answerAlreadyOut: response?.answerAlreadyOut ?? item.answerAlreadyOut,
    alreadyCompleted: response?.alreadyCompleted ?? null,
  };
  const selectedId = entry?.selectedOptionId ?? item.selectedOptionId ?? undefined;
  const outcome = outcomeOf(result);

  // --- Meta: points, deadline, must-do ---
  const breakdown = pointsBreakdown(item);
  const explainsPoints = breakdown.bonus > 0 || breakdown.upTo || breakdown.answerOut;
  const ownDeadline = !isCatchUp && showsOwnDeadline(item, sharedDeadline, now) ? item.closesAt : null;
  const kind = upNextActionKind(item);
  const actionDisabled = kind === "lessonUnavailable";
  // The reading CTA already says "Read · 3 min"; the meta line doesn't repeat it.
  const duration = kind === "read" && !inline ? null : durationLabel(item, t);
  const typeLine = [typeLabel(item, t), duration].filter(Boolean).join(" · ");

  let pointsNode: ReactNode = null;
  if (showPoints && !answered) {
    if (isCatchUp) pointsNode = <PointsChip item={item} struck />;
    else if (explainsPoints) pointsNode = <span className="tabular-nums">{pointsLine(item, t, now)}</span>;
    else pointsNode = <PointsChip item={item} />;
  }

  // --- Body copy ---
  const prompt = promptTextFor(item);
  // A deck's glimpse ("12 cards · ~3 min") is the main slot's meta line already.
  const glimpse =
    item.itemType === "QUESTION_OF_DAY" || item.itemType === "POLL"
      ? prompt
      : item.itemType === "FLASHCARDS" && slot === "main"
        ? ""
        : glimpseFor(item, t);
  const revealMs = item.revealAt ? Date.parse(item.revealAt) : NaN;
  const hiddenAhead =
    item.hideResultUntilReveal === true &&
    Number.isFinite(revealMs) &&
    revealMs > now &&
    item.isRevealed !== true;

  const eyebrow = (
    <span
      className={ecn(
        "whitespace-nowrap text-caption font-semibold uppercase tracking-wide [.ui-corporate_&]:normal-case [.ui-corporate_&]:tracking-normal",
        skinClasses("mutedInk")
      )}
    >
      {t("today.upNext")}
    </span>
  );
  const titleNode = (
    <h3 className="min-w-0">
      <button
        ref={titleRef}
        type="button"
        dir="auto"
        onClick={() => onOpen(item)}
        className={ecn(
          "line-clamp-2 break-words font-semibold",
          slot === "rail" ? "text-body" : "text-subtitle",
          skinClasses("ink"),
          // Stretch only when nothing else in the block is interactive.
          inline || answered
            ? "text-start rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            : STRETCHED_TITLE
        )}
      >
        {item.title}
      </button>
    </h3>
  );
  // The rail drops the type line (the icon and the button say it); it keeps
  // only what changes the decision: a catch-up, an own deadline, the batch.
  // The batch dot rides in the top row, so it never gets a line of its own.
  const railMeta =
    !answered && (isCatchUp || ownDeadline) ? (
      <>
        {isCatchUp && <span>{catchUpLine(item, t, now)}</span>}
        {ownDeadline && <TimeLeft closesAt={ownDeadline} whenPassed="hide" />}
      </>
    ) : null;

  return (
    <div
      className={ecn(
        "relative flex min-w-0 flex-col gap-2 rounded-lg p-3",
        toneClasses(visual.tone, "surface"),
        "[.ui-play_&]:rounded-play-card-sm [.ui-corporate_&]:border [.ui-corporate_&]:border-border",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
        pulse && "[.ui-vibrant_&]:motion-safe:zoom-in-95 [.ui-vibrant_&]:motion-safe:duration-500",
        className
      )}
    >
      {/* Title block */}
      {slot === "rail" ? (
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <TypeTile item={item} size="xs" weight={iconWeight} />
            {/* Narrow: "Must do" stands in for the eyebrow, which stays for screen readers. */}
            {item.isRequired && !answered ? (
              <>
                <span className="sr-only">{t("today.upNext")}</span>
                <MustDoBadge />
              </>
            ) : (
              eyebrow
            )}
            {batch && <BatchMark batch={batch} />}
            {showPoints && !answered && (
              <PointsChip item={item} struck={isCatchUp} className="ms-auto shrink-0" />
            )}
          </div>
          {titleNode}
          {railMeta && (
            <div
              className={ecn(
                "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption",
                skinClasses("mutedInk")
              )}
            >
              {railMeta}
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-w-0 items-start gap-3">
          {/* From sm the tile sits beside the title; below sm it shrinks into the
              eyebrow row so the title and options get the full width. */}
          <TypeTile item={item} weight={iconWeight} className="hidden sm:flex" />
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:gap-0.5">
            <div className="flex min-w-0 items-center gap-2 sm:hidden">
              <TypeTile item={item} size="xs" weight={iconWeight} />
              {eyebrow}
              {item.isRequired && !answered && <MustDoBadge />}
            </div>
            {titleNode}
            <div
              className={ecn(
                "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption",
                skinClasses("mutedInk")
              )}
            >
              <span className="hidden items-center gap-2 sm:inline-flex">
                {eyebrow}
                {item.isRequired && !answered && <MustDoBadge />}
              </span>
              <span>{typeLine}</span>
              {pointsNode}
              {ownDeadline && !answered && <TimeLeft closesAt={ownDeadline} whenPassed="hide" />}
              {batch && <BatchMark batch={batch} />}
            </div>
            {isCatchUp && !answered && (
              <p className={ecn("text-caption", skinClasses("mutedInk"))}>{catchUpLine(item, t, now)}</p>
            )}
          </div>
        </div>
      )}

      {/* Answered: the result stays until "Next task" */}
      {answered ? (
        <div ref={answerRef} className="relative z-10 flex min-w-0 flex-col gap-2">
          {slot === "main" && options && (
            <ChoiceOptions
              options={options}
              mode={isPoll ? "pollResults" : "result"}
              selectedId={selectedId}
              correctId={result.correctOptionId}
              selectedCorrect={result.resultPending ? null : result.isCorrect}
              pollResults={response?.pollResults ?? item.pollResults}
              responseCount={response?.responseCount ?? item.responseCount}
              promptId={promptId}
              size="main"
              tone={visual.tone}
            />
          )}
          <EngagementResult
            variant="compact"
            outcome={outcome}
            points={result.pointsAwarded}
            revealAt={item.revealAt}
            answerAlreadyOut={result.answerAlreadyOut}
            alreadyCompleted={result.alreadyCompleted}
            showPoints={showPoints}
            detail={isPoll ? (revealCopy(item, result, t, now) ?? undefined) : undefined}
            now={now}
          />
          <MyButton
            data-up-next-action=""
            type="button"
            buttonType="primary"
            scale="medium"
            className={ecn("w-full", slot === "main" ? "min-h-11 sm:w-auto sm:self-start" : "min-h-9")}
            onClick={onNext}
          >
            {hasNext ? t("today.nextTask") : t("today.finish")}
          </MyButton>
        </div>
      ) : (
        <>
          {glimpse && (
            <p
              id={promptId}
              dir="auto"
              className={ecn(
                "break-words",
                inline ? "text-body font-medium" : "line-clamp-2 text-body",
                inline ? skinClasses("ink") : skinClasses("mutedInk")
              )}
            >
              {glimpse}
            </p>
          )}

          {inline && options ? (
            <div className="relative z-10 flex min-w-0 flex-col gap-2">
              <ChoiceOptions
                options={options}
                mode={isPoll ? "vote" : "answer"}
                selectedId={draft.selectedId ?? (submitting ? entry?.selectedOptionId : undefined)}
                promptId={glimpse ? promptId : undefined}
                onSelect={(id) => {
                  setError(null);
                  draft.setSelected(id);
                }}
                onConfirm={() => void confirm()}
                confirming={submitting}
                disabled={submitting}
                size="main"
                tone={visual.tone}
              />
              {hiddenAhead && (
                <p className={ecn("text-caption", skinClasses("mutedInk"))}>
                  {t("reveal.findOut", { time: formatClock(item.revealAt, now) })}
                </p>
              )}
            </div>
          ) : (
            <div className="relative z-10">
              <MyButton
                type="button"
                buttonType="primary"
                scale="medium"
                className={ecn("w-full", slot === "main" ? "min-h-11 sm:w-auto" : "min-h-9")}
                disable={actionDisabled}
                onClick={() => onOpen(item)}
              >
                {actionLabel(kind, item, t, showPoints)}
              </MyButton>
            </div>
          )}

          {error && (
            <p role="alert" className="relative z-10 text-caption text-danger-700">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
