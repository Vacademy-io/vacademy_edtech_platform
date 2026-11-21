import { useTranslation } from "react-i18next";
import {
  CheckCircle,
  Clock,
  Hourglass,
  Lock,
  LockSimple,
  MinusCircle,
  Star,
  XCircle,
  type Icon,
} from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import iconPoints from "@/assets/cleaner-play/icon-points.webp";
import { ecn, skinClasses } from "./engagement-tone";
import {
  formatClock,
  pointsBreakdown,
  type EngagementCopyItem,
  type EngagementStateKind,
} from "./engagement-copy";

/**
 * The small marks every engagement surface shares (D33): one points chip, one
 * state badge, one "Must do" badge, all on the `Badge` component so they look
 * the same on the Today module, in the runner and on the `/engagement` page.
 *
 * Size comes from Badge's own `text-xs`: Badge merges with the stock `cn()`,
 * which would read a `text-caption` here as a colour and drop it anyway.
 */

const BADGE_BASE = "gap-1 rounded-full px-2 py-0.5 font-medium shadow-none";

// --- PointsChip ---------------------------------------------------------------------

export interface PointsChipProps {
  /** Derive value and the struck-through full value from the item. */
  item?: EngagementCopyItem;
  /** Explicit value (wins over `item`). */
  value?: number;
  /**
   * The full value, drawn struck through before `value` (catch-up: "+2 ~~5~~").
   * `true` derives it from `item`; a number sets it; omitted means none.
   */
  struck?: boolean | number;
  /** Earned (past tense) rather than on offer; only changes the screen-reader text. */
  earned?: boolean;
  className?: string;
}

/**
 * Renders nothing when the value is 0 (and nothing is struck through).
 *
 * "+10 pts" in standard skins, "+10 XP" with the points art in play and
 * cleanerPlay (XP vocabulary lives only there). Both labels are rendered and
 * the skin hides one, so the chip needs no skin hook and never flashes.
 */
export function PointsChip({ item, value, struck, earned, className }: PointsChipProps) {
  const { t } = useTranslation("dashboardEngagement");
  const breakdown = item ? pointsBreakdown(item) : null;
  const shown = value ?? breakdown?.total ?? 0;
  let full: number | null = null;
  if (typeof struck === "number") full = struck;
  else if (struck === true && breakdown && breakdown.full > shown) full = breakdown.full;
  if (full != null && full <= shown) full = null;
  // Never print "+0": a task that pays nothing shows no chip.
  if (shown <= 0 && full == null) return null;

  const srText =
    full != null
      ? t("badge.pointsStruckAria", { count: shown, full })
      : earned
        ? t("badge.pointsEarnedAria", { count: shown })
        : t("badge.pointsAria", { count: shown });

  return (
    <Badge
      variant="outline"
      className={ecn(BADGE_BASE, "tabular-nums", skinClasses("points"), className)}
    >
      <span className="sr-only">{srText}</span>
      <Star
        aria-hidden
        weight="fill"
        className="size-3.5 shrink-0 text-primary-500 [.ui-play_&]:hidden [.ui-cleaner-play_&]:hidden [.ui-corporate_&]:text-muted-foreground"
      />
      <img
        src={iconPoints}
        alt=""
        aria-hidden
        className="hidden size-4 shrink-0 [.ui-play_&]:inline-block [.ui-cleaner-play_&]:inline-block"
      />
      {full != null && (
        <s aria-hidden className="font-normal opacity-60">
          {full}
        </s>
      )}
      <span aria-hidden className="[.ui-play_&]:hidden [.ui-cleaner-play_&]:hidden">
        {t("badge.pts", { count: shown })}
      </span>
      <span aria-hidden className="hidden [.ui-play_&]:inline [.ui-cleaner-play_&]:inline">
        {t("badge.xp", { count: shown })}
      </span>
    </Badge>
  );
}

// --- StateBadge -----------------------------------------------------------------------

export type EngagementBadgeKind = EngagementStateKind | "correct" | "wrong" | "resultAt";
type BadgeKind = EngagementBadgeKind;

const STATE_ICON: Record<BadgeKind, Icon> = {
  done: CheckCircle,
  late: CheckCircle,
  correct: CheckCircle,
  wrong: XCircle,
  missed: MinusCircle,
  catchUp: Hourglass,
  closed: Lock,
  pending: LockSimple,
  resultAt: LockSimple,
  upcoming: Clock,
};

/** Literal classes per kind: semantic tokens, play pairs, clay tints. */
const STATE_CLASSES: Record<BadgeKind, string> = {
  done: "border-transparent bg-success-50 text-success-700 [.ui-play_&]:bg-play-success-soft [.ui-play_&]:text-play-success-soft-ink [.ui-cleaner-play_&]:bg-cp-sage-tint [.ui-cleaner-play_&]:text-cp-ink",
  correct:
    "border-transparent bg-success-50 text-success-700 [.ui-play_&]:bg-play-success-soft [.ui-play_&]:text-play-success-soft-ink [.ui-cleaner-play_&]:bg-cp-sage-tint [.ui-cleaner-play_&]:text-cp-ink",
  late: "border-transparent bg-warning-50 text-warning-700 [.ui-play_&]:bg-play-warn-soft [.ui-play_&]:text-play-warn-soft-ink [.ui-cleaner-play_&]:bg-cp-gold-tint [.ui-cleaner-play_&]:text-cp-ink",
  catchUp:
    "border-transparent bg-warning-50 text-warning-700 [.ui-play_&]:bg-play-warn-soft [.ui-play_&]:text-play-warn-soft-ink [.ui-cleaner-play_&]:bg-cp-gold-tint [.ui-cleaner-play_&]:text-cp-ink",
  wrong: "border-transparent bg-danger-50 text-danger-700 [.ui-play_&]:bg-play-danger-soft [.ui-play_&]:text-play-danger-soft-ink [.ui-cleaner-play_&]:bg-cp-terracotta-tint [.ui-cleaner-play_&]:text-cp-ink",
  missed:
    "border-border bg-transparent text-muted-foreground [.ui-play_&]:text-play-ink/60 [.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:text-cp-muted",
  closed:
    "border-border bg-transparent text-muted-foreground [.ui-play_&]:text-play-ink/60 [.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:text-cp-muted",
  pending:
    "border-border bg-muted text-foreground [.ui-play_&]:border-transparent [.ui-play_&]:bg-play-navy-soft [.ui-play_&]:text-play-navy-soft-ink [.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:bg-cp-bg-deep [.ui-cleaner-play_&]:text-cp-ink",
  resultAt:
    "border-border bg-muted text-foreground [.ui-play_&]:border-transparent [.ui-play_&]:bg-play-navy-soft [.ui-play_&]:text-play-navy-soft-ink [.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:bg-cp-bg-deep [.ui-cleaner-play_&]:text-cp-ink",
  upcoming:
    "border-border bg-transparent text-muted-foreground [.ui-play_&]:text-play-ink/60 [.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:text-cp-muted",
};

export interface StateBadgeProps {
  kind: BadgeKind;
  /** ISO time for `resultAt` ("Result at 8:00 PM") and `upcoming` ("Unlocks 7:00 AM"). */
  at?: string | null;
  /** Catch-up percent for `catchUp` ("Catch up · 50%"). */
  percent?: number | null;
  /** Server "now" for the time formatting (defaults to the device clock). */
  now?: number;
  className?: string;
}

/**
 * A task's state in one badge: Done, Done late, Missed, Catch up, Closed,
 * Result pending, Correct, Not quite, "Result at 8:00 PM", "Unlocks 7:00 AM".
 * Icon + words, so the state never depends on colour alone.
 */
export function StateBadge({ kind, at, percent, now, className }: StateBadgeProps) {
  const { t } = useTranslation("dashboardEngagement");
  const StateIcon = STATE_ICON[kind];
  const time = at ? formatClock(at, now) : "";
  let label: string;
  if ((kind === "resultAt" || kind === "upcoming") && time) {
    label = t(`badge.state.${kind}`, { time });
  } else if (kind === "resultAt") {
    label = t("badge.state.pending");
  } else if (kind === "upcoming") {
    label = t("badge.state.upcomingNoTime");
  } else if (kind === "catchUp" && typeof percent === "number" && percent < 100) {
    label = t("badge.state.catchUpPercent", { percent });
  } else {
    label = t(`badge.state.${kind}`);
  }
  return (
    <Badge variant="outline" className={ecn(BADGE_BASE, STATE_CLASSES[kind], className)}>
      <StateIcon aria-hidden weight="bold" className="size-3.5 shrink-0" />
      {label}
    </Badge>
  );
}

// --- MustDoBadge / BonusBadge ---------------------------------------------------------------

/**
 * "Must do": an outline badge, never a black pill (D43). It never claims that
 * must-dos keep the streak; that rule does not exist in the product.
 */
export function MustDoBadge({ className }: { className?: string }) {
  const { t } = useTranslation("dashboardEngagement");
  return (
    <Badge
      variant="outline"
      className={ecn(
        BADGE_BASE,
        "border-primary-300 bg-transparent text-foreground [.ui-play_&]:border-play-navy-deep [.ui-play_&]:text-play-navy-soft-ink [.ui-cleaner-play_&]:border-cp-terracotta [.ui-cleaner-play_&]:text-cp-ink",
        className
      )}
    >
      {t("badge.mustDo")}
    </Badge>
  );
}

/** "Bonus": the group label for tasks that are not must-dos. */
export function BonusBadge({ className }: { className?: string }) {
  const { t } = useTranslation("dashboardEngagement");
  return (
    <Badge
      variant="outline"
      className={ecn(
        BADGE_BASE,
        "border-border bg-transparent text-muted-foreground [.ui-play_&]:text-play-ink/60 [.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:text-cp-muted",
        className
      )}
    >
      {t("badge.bonus")}
    </Badge>
  );
}
