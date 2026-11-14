import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { CaretRight } from "@phosphor-icons/react";
import {
  parseFlashcards,
  parseQuestionPayload,
  type EngagementItem,
} from "@/services/engagement";
import { visualFor } from "@/routes/dashboard/-components/engagement/engagement-visuals";
import {
  ecn,
  skinClasses,
  toneClasses,
} from "@/routes/dashboard/-components/engagement/engagement-tone";
import {
  answerFormat,
  catchUpLine,
  earnedLine,
  typeLabel,
} from "@/routes/dashboard/-components/engagement/engagement-copy";
import { PointsChip, StateBadge, type EngagementBadgeKind } from "@/routes/dashboard/-components/engagement/EngagementBadge";
import { formatInstantIn } from "./DayStrip";

/**
 * One row of the Past tab (D37): what happened to a task on a past day.
 *
 * - DONE: "Done Fri 25 Sep, 7:51 PM (late)", the outcome, what it earned. A
 *   flashcards task reads "Knew 9 of 12" from the stored result; it never calls
 *   GET item, which refuses a closed task.
 * - CATCH_UP: the whole row is a button that opens the runner, with the
 *   reduced points and the catch-up countdown.
 * - MISSED: muted, with when it closed. Nothing to earn, so no points.
 */

export interface PastRowProps {
  item: EngagementItem;
  /** The plan's IANA zone, for formatting instants. */
  timeZone?: string | null;
  showPoints: boolean;
  /** Server "now" (ms) for countdowns. */
  now: number;
  /** Show the batch name (only when the learner is in more than one batch). */
  showBatch?: boolean;
  /** Open a catch-up task in the runner. */
  onOpen?: (item: EngagementItem) => void;
}

const MAX_LEARNING_FRONTS = 2;

/** "Still learning: Mitosis, Meiosis +1 more" from the deck and the stored result. */
function stillLearningLine(item: EngagementItem, t: TFunction): string | null {
  const ids = item.flashcardsResult?.learningCardIds ?? [];
  if (ids.length === 0) return null;
  const deck = parseFlashcards(item);
  const fronts = ids
    .map((id) => deck?.cards.find((c) => c.id === id)?.front)
    .filter((front): front is string => Boolean(front && front.trim()));
  if (fronts.length === 0) return t("page.past.stillLearningCount", { count: ids.length });
  const shown = fronts.slice(0, MAX_LEARNING_FRONTS).join(", ");
  const rest = ids.length - Math.min(fronts.length, MAX_LEARNING_FRONTS);
  return rest > 0
    ? t("page.past.stillLearningMore", { cards: shown, count: rest })
    : t("page.past.stillLearning", { cards: shown });
}

function badgeKindOf(item: EngagementItem): EngagementBadgeKind {
  const status = item.historyStatus ?? "MISSED";
  if (status === "CATCH_UP") return "catchUp";
  if (status !== "DONE") return "missed";
  if (item.resultPending === true) return "pending";
  if (answerFormat(item) === "MCQ" && item.isCorrect === true) return "correct";
  if (answerFormat(item) === "MCQ" && item.isCorrect === false) return "wrong";
  return item.isLate ? "late" : "done";
}

/**
 * What a finished task earned. A plain amount is the skin's points chip ("+10 pts",
 * "+10 XP" in play); a line with a pending or on-its-way bonus stays as text (D22).
 */
export function EarnedPoints({ item, className }: { item: EngagementItem; className?: string }) {
  const { t } = useTranslation("dashboardEngagement");
  const awarded = item.pointsAwarded ?? 0;
  if (awarded <= 0) return null;
  const line = earnedLine(item, t);
  if (line === t("earned.plain", { count: awarded })) {
    return <PointsChip value={awarded} earned className={className} />;
  }
  return (
    <span className={ecn("text-caption font-medium tabular-nums", skinClasses("ink"), className)}>{line}</span>
  );
}

export function PastRow({ item, timeZone, showPoints, now, showBatch, onOpen }: PastRowProps) {
  const { t } = useTranslation("dashboardEngagement");
  const visual = visualFor(item);
  const TypeIcon = visual.icon;
  const status = item.historyStatus ?? "MISSED";
  const done = status === "DONE";
  const catchable = status === "CATCH_UP" && Boolean(onOpen);
  const missed = status === "MISSED";
  // "(late)" already sits in the "Done …" line; the badge then just says done.
  const rawKind = badgeKindOf(item);
  const kind: EngagementBadgeKind = rawKind === "late" && done && item.completedAt ? "done" : rawKind;

  // --- Detail lines ---------------------------------------------------------------
  const details: string[] = [];
  if (done && item.completedAt) {
    const date = formatInstantIn(item.completedAt, timeZone);
    details.push(item.isLate ? t("page.past.doneAtLate", { date }) : t("page.past.doneAt", { date }));
  }
  if (done && item.itemType === "FLASHCARDS" && item.flashcardsResult) {
    const { known, total } = item.flashcardsResult;
    details.push(t("page.past.knewOf", { known, total }));
    const learning = stillLearningLine(item, t);
    if (learning) details.push(learning);
  }
  if (done && answerFormat(item) === "MCQ" && item.correctOptionId) {
    const options = parseQuestionPayload(item)?.options ?? [];
    const correct = options.find((o) => o.id === item.correctOptionId);
    const mine = options.find((o) => o.id === item.selectedOptionId);
    if (correct) {
      details.push(
        mine && mine.id !== correct.id
          ? t("page.past.answerAndPick", { answer: correct.text, pick: mine.text })
          : t("page.past.answer", { answer: correct.text })
      );
    }
  }
  if (missed && item.closesAt) {
    details.push(t("page.past.closedAt", { date: formatInstantIn(item.closesAt, timeZone) }));
  }
  if (status === "CATCH_UP") {
    details.push(catchUpLine(item, t, now));
  }

  const earned = done && showPoints && (item.pointsAwarded ?? 0) > 0;

  const body = (
    <>
      <span className="relative shrink-0" aria-hidden>
        <span
          className={ecn(
            "flex size-10 items-center justify-center rounded-lg [.ui-cleaner-play_&]:hidden",
            toneClasses(visual.tone, "tile"),
            missed && "opacity-60"
          )}
        >
          <TypeIcon weight="duotone" className="size-5" />
        </span>
        <img
          src={visual.art}
          alt=""
          className={ecn("hidden size-10 object-contain [.ui-cleaner-play_&]:block", missed && "opacity-60")}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={ecn("text-caption", skinClasses("mutedInk"))}>{typeLabel(item, t)}</span>
          {showBatch && item.packageSessionName && (
            <span dir="auto" className={ecn("min-w-0 truncate text-caption", skinClasses("mutedInk"))}>
              {item.packageSessionName}
            </span>
          )}
        </span>
        <span
          dir="auto"
          className={ecn(
            "line-clamp-2 break-words text-body font-semibold",
            missed ? skinClasses("mutedInk") : skinClasses("ink")
          )}
        >
          {item.title}
        </span>
        {details.map((line, i) => (
          <span
            key={i}
            dir="auto"
            className={ecn("break-words text-caption", skinClasses("mutedInk"))}
          >
            {line}
          </span>
        ))}
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <StateBadge kind={kind} percent={item.pointsPercent} now={now} />
          {status === "CATCH_UP" && showPoints && <PointsChip item={item} struck />}
          {earned && <EarnedPoints item={item} />}
        </span>
      </span>
      {catchable && (
        <CaretRight
          aria-hidden
          weight="bold"
          className={ecn(
            "mt-3 size-4 shrink-0 transition-transform duration-150 rtl:-scale-x-100 motion-safe:group-hover:translate-x-0.5 motion-safe:rtl:group-hover:-translate-x-0.5",
            skinClasses("mutedInk")
          )}
        />
      )}
    </>
  );

  if (catchable) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onOpen?.(item)}
          className={ecn(
            "group flex w-full min-w-0 items-start gap-3 px-3 py-3 text-start transition-colors duration-150 sm:px-card",
            "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400",
            "[.ui-play_&]:hover:bg-play-warn-soft [.ui-cleaner-play_&]:hover:bg-cp-gold-tint"
          )}
        >
          {body}
        </button>
      </li>
    );
  }
  return <li className="flex min-w-0 items-start gap-3 px-3 py-3 sm:px-card">{body}</li>;
}
