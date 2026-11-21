import { useTranslation } from "react-i18next";
import { X } from "@phosphor-icons/react";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import type { EngagementItem } from "@/services/engagement";
import { MustDoBadge, PointsChip, StateBadge } from "../EngagementBadge";
import { TimeLeft } from "../TimeLeft";
import {
  catchUpLine,
  durationLabel,
  isCompleted,
  pointsBreakdown,
  pointsLine,
  stateKindOf,
  typeLabel,
} from "../engagement-copy";
import { ecn, skinClasses, toneClasses, type EngagementTone } from "../engagement-tone";
import { visualFor } from "../engagement-visuals";

/**
 * The runner's sticky header (D13, D14, D26): icon tile, a two-line title, the
 * "type · length" line, the stakes (points, deadline, must-do, result time,
 * catch-up) and our own 44 px close button, shown on iOS too (the sheet's
 * built-in one is hidden there).
 *
 * Neutral in the standard skins (ink on the page colour, no gradients under
 * white text); the play skins get a soft band in the task's tone.
 */

/** Play / cleanerPlay header band per tone. Literal strings for the Tailwind scanner. */
const HEADER_BAND: Record<EngagementTone, string> = {
  info: "[.ui-play_&]:border-transparent [.ui-play_&]:bg-play-info-soft [.ui-cleaner-play_&]:bg-cp-sage-tint",
  accent: "[.ui-play_&]:border-transparent [.ui-play_&]:bg-play-accent-soft [.ui-cleaner-play_&]:bg-cp-terracotta-tint",
  warn: "[.ui-play_&]:border-transparent [.ui-play_&]:bg-play-warn-soft [.ui-cleaner-play_&]:bg-cp-gold-tint",
  success: "[.ui-play_&]:border-transparent [.ui-play_&]:bg-play-success-soft [.ui-cleaner-play_&]:bg-cp-sage-tint",
  danger: "[.ui-play_&]:border-transparent [.ui-play_&]:bg-play-danger-soft [.ui-cleaner-play_&]:bg-cp-terracotta-tint",
  navy: "[.ui-play_&]:border-transparent [.ui-play_&]:bg-play-navy-soft [.ui-cleaner-play_&]:bg-cp-sage-tint",
  neutral: "[.ui-play_&]:border-transparent [.ui-play_&]:bg-play-surface [.ui-cleaner-play_&]:bg-cp-bg-deep",
};

/** Title ink on the play band (the band's own soft-ink pair). */
const TITLE_INK: Record<EngagementTone, string> = {
  info: "[.ui-play_&]:text-play-info-soft-ink",
  accent: "[.ui-play_&]:text-play-accent-soft-ink",
  warn: "[.ui-play_&]:text-play-warn-soft-ink",
  success: "[.ui-play_&]:text-play-success-soft-ink",
  danger: "[.ui-play_&]:text-play-danger-soft-ink",
  navy: "[.ui-play_&]:text-play-navy-soft-ink",
  neutral: "[.ui-play_&]:text-play-ink",
};

export interface RunnerPosition {
  /** 0-based. */
  index: number;
  total: number;
}

export interface RunnerHeaderProps {
  /** The task (seed while the full item loads); null only before anything is known. */
  item: EngagementItem | null;
  position?: RunnerPosition | null;
  onClose: () => void;
  showPoints?: boolean;
  /** Server "now". */
  now: number;
}

export function RunnerHeader({ item, position, onClose, showPoints = true, now }: RunnerHeaderProps) {
  const { t } = useTranslation("dashboardEngagement");
  const visual = visualFor(item ?? "fallback");
  const TypeIcon = visual.icon;
  const tone = visual.tone;

  const done = item ? isCompleted(item) : false;
  const stateKind = item ? stateKindOf(item) : null;
  const isCatchUp = item?.state === "CATCH_UP";
  const revealMs = item?.revealAt ? Date.parse(item.revealAt) : NaN;
  const resultAhead = Boolean(item?.hideResultUntilReveal) && Number.isFinite(revealMs) && revealMs > now;
  const typeText = item ? typeLabel(item, t) : "";
  const duration = item ? durationLabel(item, t) : null;
  const reward = item && showPoints && !done ? pointsLine(item, t, now) : "";
  // Strike the full value only when this run pays less than it (a catch-up, or
  // the answer is already out); a full-rate question's bonus is not a loss.
  const breakdown = item ? pointsBreakdown(item) : null;
  const reduced = breakdown != null && (breakdown.percent < 100 || breakdown.answerOut);

  return (
    <header
      className={ecn(
        "shrink-0 border-b bg-background pt-safe",
        skinClasses("divider"),
        // Vibrant: the same primary accent strip and wash its cards carry (§3.8).
        "[.ui-vibrant_&]:border-t-4 [.ui-vibrant_&]:border-t-primary-300 [.ui-vibrant_&]:bg-primary-50/50",
        HEADER_BAND[tone]
      )}
    >
      <div className="flex min-w-0 flex-col gap-2 px-4 pb-3 pt-3 sm:px-6 sm:pt-4">
        {position && position.total > 1 && (
          <div className="flex items-center gap-2">
            <span className={ecn("text-caption font-medium tabular-nums", skinClasses("mutedInk"))}>
              {t("runner.position", { current: position.index + 1, total: position.total })}
            </span>
            <Progress
              aria-hidden
              value={((position.index + 1) / position.total) * 100}
              className="h-1 w-16 bg-muted rtl:-scale-x-100 [.ui-play_&]:bg-play-surface [.ui-cleaner-play_&]:bg-cp-bg-deep"
            />
          </div>
        )}

        <div className="flex min-w-0 items-start gap-3">
          {/* CleanerPlay draws its illustration; every other skin the tone tile. */}
          <span
            aria-hidden
            className={ecn(
              "flex size-10 shrink-0 items-center justify-center rounded-lg [.ui-cleaner-play_&]:hidden",
              toneClasses(tone, "tile")
            )}
          >
            <TypeIcon weight="duotone" className="size-5 [.ui-corporate_&]:hidden" />
            <TypeIcon weight="regular" className="hidden size-5 [.ui-corporate_&]:block" />
          </span>
          <img
            src={visual.art}
            alt=""
            aria-hidden
            className="hidden size-10 shrink-0 object-contain [.ui-cleaner-play_&]:block"
          />

          <div className="min-w-0 flex-1">
            {/* SheetTitle / SheetDescription merge with the stock cn(), which would
                read text-title / text-caption as colours and drop them, so the
                styling sits on inner spans. */}
            <SheetTitle className="min-w-0">
              <span
                dir="auto"
                className={ecn(
                  "line-clamp-2 break-words text-title font-semibold",
                  skinClasses("ink"),
                  TITLE_INK[tone]
                )}
              >
                {item?.title ?? t("runner.loadingTitle")}
              </span>
            </SheetTitle>
            <SheetDescription className="mt-0.5">
              <span dir="auto" className={ecn("text-caption", skinClasses("mutedInk"))}>
                {[typeText, duration].filter(Boolean).join(" · ")}
              </span>
              {reward && <span className="sr-only">{` · ${reward}`}</span>}
            </SheetDescription>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t("runner.close")}
            className={ecn(
              "-me-2 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-150",
              "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
              "[.ui-play_&]:hover:bg-play-surface [.ui-cleaner-play_&]:hover:bg-cp-bg-deep",
              skinClasses("ink")
            )}
          >
            <X aria-hidden weight="bold" className="size-5" />
          </button>
        </div>

        {item && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
            {showPoints && !done && <PointsChip item={item} struck={reduced} />}
            {done && stateKind && (
              <StateBadge kind={stateKind} percent={item.pointsPercent} now={now} />
            )}
            {item.isRequired && !done && <MustDoBadge />}
            {resultAhead && <StateBadge kind="resultAt" at={item.revealAt} now={now} />}
            {!done && !isCatchUp && item.state !== "UPCOMING" && (
              <TimeLeft closesAt={item.closesAt} whenPassed="closed" />
            )}
            {!done && isCatchUp && (
              <span className="text-caption font-medium text-warning-700 [.ui-play_&]:text-play-warn-soft-ink [.ui-cleaner-play_&]:text-cp-terracotta">
                {catchUpLine(item, t, now)}
              </span>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
