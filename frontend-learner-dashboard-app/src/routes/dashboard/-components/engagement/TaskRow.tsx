import { useTranslation } from "react-i18next";
import {
  CaretRight,
  CheckCircle,
  LockSimple,
  XCircle,
  type Icon,
  type IconWeight,
} from "@phosphor-icons/react";
import type { EngagementItem } from "@/services/engagement";
import { visualFor } from "./engagement-visuals";
import { ecn, outcomeClasses, skinClasses, toneClasses } from "./engagement-tone";
import {
  durationLabel,
  metaLine,
  outcomeOf,
  showsOwnDeadline,
  typeLabel,
  type EngagementOutcome,
} from "./engagement-copy";
import { MustDoBadge, PointsChip, StateBadge } from "./EngagementBadge";
import { TimeLeft } from "./TimeLeft";

/**
 * One compact task row in the Today module (D3, D11, D12, D18, D34, D35, D43, D53).
 *
 * - About 52 px: a 36 px icon tile, a two-line title and one caption line.
 * - The `<li>` is a plain container. The title is a real `<button>` whose
 *   `::after` stretches over the whole row, so the row is one big target but
 *   there is never a button wrapping buttons, and the focus ring draws round
 *   the row.
 * - The deadline shows only when it differs from the header's shared one or is
 *   under 2 h (D53). A batch dot shows only when the learner has 2+ batches (D35).
 * - `done` rows swap the type tile for the outcome and open the runner read-only.
 */

export type TaskRowVariant = "open" | "catchUp" | "done";

/** A batch marker, only passed when the learner has tasks from 2+ batches. */
export interface TaskBatch {
  name: string;
  /** Literal background class for the dot (see `BATCH_DOTS` in TodayModule). */
  dotClass: string;
}

// --- Type tile (shared with UpNextRow) ----------------------------------------------

export interface TypeTileProps {
  item: Pick<EngagementItem, "itemType" | "payloadJson">;
  size?: "xs" | "sm" | "md";
  weight?: IconWeight;
  className?: string;
}

const TILE_SIZE = { xs: "size-6 rounded-md", sm: "size-9 rounded-lg", md: "size-10 rounded-lg" } as const;
const TILE_ICON = { xs: "size-4", sm: "size-5", md: "size-6" } as const;

/**
 * The task type's icon tile. CleanerPlay swaps it for the type's clay art;
 * corporate keeps one neutral tile (via `toneClasses`).
 */
export function TypeTile({ item, size = "md", weight = "duotone", className }: TypeTileProps) {
  const visual = visualFor(item);
  const VisualIcon = visual.icon;
  return (
    <span
      aria-hidden
      className={ecn(
        "flex shrink-0 items-center justify-center",
        TILE_SIZE[size],
        toneClasses(visual.tone, "tile"),
        "[.ui-play_&]:rounded-xl [.ui-cleaner-play_&]:bg-transparent",
        className
      )}
    >
      <VisualIcon
        weight={weight}
        className={ecn(TILE_ICON[size], "[.ui-cleaner-play_&]:hidden")}
      />
      <img
        src={visual.art}
        alt=""
        loading="lazy"
        className="hidden size-full object-contain [.ui-cleaner-play_&]:block"
      />
    </span>
  );
}

const OUTCOME_ICON: Record<EngagementOutcome, Icon> = {
  correct: CheckCircle,
  wrong: XCircle,
  pending: LockSimple,
  done: CheckCircle,
};

/** The outcome in place of the type tile on a finished row. */
export function OutcomeTile({
  outcome,
  size = "md",
  className,
}: {
  outcome: EngagementOutcome;
  size?: "sm" | "md";
  className?: string;
}) {
  const OutcomeIcon = OUTCOME_ICON[outcome];
  return (
    <span
      aria-hidden
      className={ecn(
        "flex shrink-0 items-center justify-center rounded-full",
        size === "sm" ? "size-9" : "size-10",
        outcomeClasses(outcome, "circle"),
        className
      )}
    >
      <OutcomeIcon weight="fill" className={size === "sm" ? "size-5" : "size-6"} />
    </span>
  );
}

/**
 * The dot marking which batch a task belongs to (D35). The names are listed
 * once in the module's batch legend, so a row carries only the dot; the name
 * stays for screen readers and on hover.
 */
export function BatchMark({ batch }: { batch: TaskBatch }) {
  return (
    <span title={batch.name} className="inline-flex shrink-0 items-center">
      <span aria-hidden className={ecn("size-2 shrink-0 rounded-full", batch.dotClass)} />
      <span className="sr-only">{batch.name}</span>
    </span>
  );
}

/** The one-line key for the batch dots: "● Batch A  ● Batch B". */
export function BatchLegend({
  batches,
  label,
  className,
}: {
  batches: TaskBatch[];
  label: string;
  className?: string;
}) {
  if (batches.length < 2) return null;
  return (
    <ul
      aria-label={label}
      className={ecn(
        "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-caption",
        skinClasses("mutedInk"),
        className
      )}
    >
      {batches.map((batch) => (
        <li key={`${batch.dotClass}:${batch.name}`} className="inline-flex min-w-0 max-w-full items-center gap-1.5">
          <span aria-hidden className={ecn("size-2 shrink-0 rounded-full", batch.dotClass)} />
          <bdi className="truncate">{batch.name}</bdi>
        </li>
      ))}
    </ul>
  );
}

/**
 * Classes that make a `<button>` title stretch over its whole row (the row is
 * `relative`). The ring draws on the stretched box, so focus shows the row.
 */
export const STRETCHED_TITLE =
  "text-start after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-primary-400";

// --- Row ----------------------------------------------------------------------------

export interface TaskRowProps {
  item: EngagementItem;
  variant?: TaskRowVariant;
  onOpen: (item: EngagementItem) => void;
  /** False when gamification is off: no points anywhere. */
  showPoints?: boolean;
  /** The deadline the header already shows once (D53). */
  sharedDeadline?: string | null;
  /** Server "now". */
  now: number;
  batch?: TaskBatch | null;
  iconWeight?: IconWeight;
  /** `done` rows: this session's outcome, when fresher than the item's fields. */
  outcome?: EngagementOutcome;
  className?: string;
}

export function TaskRow({
  item,
  variant = "open",
  onOpen,
  showPoints = true,
  sharedDeadline = null,
  now,
  batch,
  iconWeight = "duotone",
  outcome,
  className,
}: TaskRowProps) {
  const { t } = useTranslation("dashboardEngagement");
  const done = variant === "done";
  const rowOutcome = outcome ?? outcomeOf(item);

  const revealMs = item.revealAt ? Date.parse(item.revealAt) : NaN;
  const revealAhead = Number.isFinite(revealMs) && revealMs > now && item.isRevealed !== true;
  const hiddenResultAhead = !done && item.hideResultUntilReveal === true && revealAhead;
  const deadline =
    variant === "open" && showsOwnDeadline(item, sharedDeadline, now) ? item.closesAt : null;

  let caption: string;
  if (variant === "open") {
    caption = metaLine(item, t, { showPoints });
  } else {
    const duration = variant === "catchUp" ? durationLabel(item, t) : null;
    caption = [typeLabel(item, t), duration].filter(Boolean).join(" · ");
  }

  return (
    <li
      className={ecn(
        "relative flex min-w-0 items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-muted/40",
        "[.ui-corporate_&]:py-2.5 [.ui-play_&]:hover:bg-play-surface [.ui-cleaner-play_&]:hover:bg-cp-bg-deep",
        className
      )}
    >
      {done ? (
        <OutcomeTile outcome={rowOutcome} size="sm" />
      ) : (
        <TypeTile item={item} size="sm" weight={iconWeight} />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <button
          type="button"
          onClick={() => onOpen(item)}
          dir="auto"
          className={ecn(
            "line-clamp-2 break-words text-body font-medium",
            skinClasses("ink"),
            STRETCHED_TITLE
          )}
        >
          {item.title}
        </button>
        <div
          className={ecn(
            "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption",
            skinClasses("mutedInk")
          )}
        >
          <span className="min-w-0">{caption}</span>
          {variant === "catchUp" && showPoints && <PointsChip item={item} struck />}
          {done && showPoints && (
            <PointsChip value={item.pointsAwarded ?? 0} earned />
          )}
          {done && rowOutcome === "pending" && (
            <StateBadge kind="resultAt" at={item.revealAt} now={now} />
          )}
          {!done && item.isRequired && <MustDoBadge />}
          {hiddenResultAhead && <StateBadge kind="resultAt" at={item.revealAt} now={now} />}
          {deadline && <TimeLeft closesAt={deadline} whenPassed="hide" />}
          {batch && <BatchMark batch={batch} />}
        </div>
      </div>

      <CaretRight
        aria-hidden
        className={ecn("hidden size-4 shrink-0 sm:block rtl:-scale-x-100", skinClasses("mutedInk"))}
      />
    </li>
  );
}
