import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Icon } from "@phosphor-icons/react";
import { Skeleton } from "@/components/ui/skeleton";
import type { PointsStreakDay } from "@/services/points";
import {
  ecn,
  skinClasses,
  toneClasses,
  type EngagementTone,
} from "@/routes/dashboard/-components/engagement/engagement-tone";
import { isoDayShort } from "./DayStrip";

/**
 * The number tiles on the `/engagement` page: the header's Today · Streak · This
 * week, and the Past tab's Done · Missed · Can still catch up · Points.
 *
 * One layout for every skin. Default is a hairline card with the tone on the
 * icon only; play gets the soft tinted tile (`bg-play-*-soft`); cleanerPlay and
 * corporate style `cp-card` in their own stylesheets.
 */

export interface StatTileData {
  id: string;
  label: string;
  /** The big figure. */
  value: ReactNode;
  /** One short line under the figure. */
  caption?: ReactNode;
  icon: Icon;
  tone: EngagementTone;
  /** Draw a skeleton in place of the figure. */
  loading?: boolean;
  /** Extra content under the caption: a progress bar, the week's dots. */
  footer?: ReactNode;
}

/** Play skin: the soft tint behind a tile (literal classes for the Tailwind scanner). */
const PLAY_TILE: Record<EngagementTone, string> = {
  info: "[.ui-play_&]:border-transparent [.ui-play_&]:bg-play-info-soft",
  accent: "[.ui-play_&]:border-transparent [.ui-play_&]:bg-play-accent-soft",
  warn: "[.ui-play_&]:border-transparent [.ui-play_&]:bg-play-warn-soft",
  success: "[.ui-play_&]:border-transparent [.ui-play_&]:bg-play-success-soft",
  danger: "[.ui-play_&]:border-transparent [.ui-play_&]:bg-play-danger-soft",
  navy: "[.ui-play_&]:border-transparent [.ui-play_&]:bg-play-navy-soft",
  neutral: "[.ui-play_&]:border-transparent [.ui-play_&]:bg-play-surface",
};

const GRID_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
};

export function StatTile({ tile }: { tile: StatTileData }) {
  const TileIcon = tile.icon;
  return (
    <div
      className={ecn(
        skinClasses("card"),
        "flex min-w-0 flex-col gap-1.5 p-3 sm:gap-2 sm:p-card",
        PLAY_TILE[tile.tone]
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className={ecn(
            "flex size-7 shrink-0 items-center justify-center rounded-md sm:size-8",
            toneClasses(tile.tone, "tile")
          )}
        >
          <TileIcon weight="duotone" className="size-4 sm:size-5" />
        </span>
        <p className={ecn("line-clamp-2 min-w-0 break-words text-caption font-medium", skinClasses("mutedInk"))}>
          {tile.label}
        </p>
      </div>
      {tile.loading ? (
        <div className="flex flex-col gap-1.5" aria-hidden>
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
      ) : (
        <>
          <p
            className={ecn(
              "min-w-0 break-words text-subtitle font-semibold tabular-nums sm:text-h3",
              // A bare figure sits on the tile's floor, so a row of tiles lines up
              // even when one label wraps to two lines.
              tile.caption == null && tile.footer == null && "mt-auto",
              skinClasses("ink")
            )}
          >
            {tile.value}
          </p>
          {tile.caption != null && (
            <p className={ecn("min-w-0 text-caption", skinClasses("mutedInk"))}>{tile.caption}</p>
          )}
          {tile.footer}
        </>
      )}
    </div>
  );
}

export function StatTiles({
  tiles,
  label,
  className,
}: {
  tiles: StatTileData[];
  /** Accessible name of the group, e.g. "Your progress". */
  label?: string;
  className?: string;
}) {
  if (tiles.length === 0) return null;
  const columns = GRID_COLUMNS[Math.min(tiles.length, 4)] ?? GRID_COLUMNS[4];
  return (
    <section
      aria-label={label}
      aria-busy={tiles.some((tile) => tile.loading) || undefined}
      className={ecn("grid gap-2 sm:gap-3", columns, className)}
    >
      {tiles.map((tile) => (
        <StatTile key={tile.id} tile={tile} />
      ))}
    </section>
  );
}

/**
 * A small segmented bar: `done` of `total`. Segments stand for tasks up to 12;
 * beyond that each segment is a share, so a big day never becomes a hairline.
 */
export function TileProgress({ done, total, label }: { done: number; total: number; label: string }) {
  if (total <= 0) return null;
  const segments = Math.min(total, 12);
  const filled = total <= 12 ? Math.min(done, total) : Math.round((Math.min(done, total) / total) * 12);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.min(done, total)}
      className="flex w-full gap-0.5"
    >
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={ecn(
            "min-w-0 flex-1",
            skinClasses("segmentTrack"),
            i < filled && skinClasses("segment")
          )}
        />
      ))}
    </div>
  );
}

/**
 * The last seven days as dots, oldest first, today last (the server's
 * `last7Days`). Each dot carries its day for screen readers.
 */
export function WeekDots({ days }: { days: PointsStreakDay[] | null | undefined }) {
  const { t } = useTranslation("dashboardEngagement");
  if (!days || days.length === 0) return null;
  const active = days.filter((d) => d.active).length;
  return (
    <ol
      aria-label={t("page.stats.last7Aria", { count: active })}
      className="flex items-center gap-1"
    >
      {days.map((day, i) => {
        const date = isoDayShort(day.date);
        return (
          <li
            key={day.date ?? i}
            className={ecn(
              "size-2 shrink-0 rounded-full sm:size-2.5",
              day.active
                ? "bg-warning-500 [.ui-play_&]:bg-play-warn [.ui-cleaner-play_&]:bg-cp-gold"
                : "bg-muted [.ui-play_&]:bg-play-surface [.ui-cleaner-play_&]:bg-cp-bg-deep",
              i === days.length - 1 && "ring-1 ring-border ring-offset-1 ring-offset-card"
            )}
          >
            <span className="sr-only">
              {date
                ? t(day.active ? "page.stats.dayActive" : "page.stats.dayInactive", { date })
                : t(day.active ? "page.stats.dayActiveNoDate" : "page.stats.dayInactiveNoDate")}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
