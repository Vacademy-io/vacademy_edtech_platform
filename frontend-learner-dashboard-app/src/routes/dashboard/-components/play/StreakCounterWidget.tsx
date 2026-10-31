import React from "react";
import { useTranslation } from "react-i18next";
import { Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import iconStreak from "@/assets/cleaner-play/icon-streak.webp";
import { streakCountdown, streakPrompt, useStreakState } from "./useDashboardHeroData";

/**
 * Play skin's streak card. Reads the one streak value every surface shares
 * (useStreakState: the server's, falling back to the browser estimate), so it
 * always agrees with the hero chip and the achievements dialog.
 *
 * States (D42): kept (warm card, number), at risk (number plus "Do 1 task to
 * keep your N-day streak", with a countdown in the last four hours) and zero
 * ("Start a streak today"). The dots are the last seven days, today last.
 */
export const StreakCounterWidget: React.FC = () => {
  const { t } = useTranslation("dashboard");
  const { t: tE } = useTranslation("dashboardEngagement");
  const streak = useStreakState();
  const hasStreak = streak.current > 0;
  const prompt = streakPrompt(streak, tE);
  const countdown = streakCountdown(streak, tE);

  if (streak.isLoading) {
    return (
      <div className="h-full min-h-36 animate-pulse rounded-play-card-sm border border-border bg-play-warn-soft/50 shadow-play-soft-card" />
    );
  }

  return (
    <div
      className={cn(
        "flex h-full flex-col gap-3 rounded-play-card-sm border border-border p-4 shadow-play-soft-card",
        // Inactive = quiet white (matches the pastel language) — the old
        // flat-gray --play-c-surface fallback clashed with the -soft cards.
        hasStreak ? "bg-play-warn-soft" : "bg-white"
      )}
    >
      <div className="flex items-center gap-3">
        <img src={iconStreak} alt="" aria-hidden="true" className="h-11 w-11 shrink-0 object-contain" />
        {hasStreak ? (
          <div className="min-w-0">
            <p className="text-h2 font-black leading-none tabular-nums text-play-warn-soft-ink">
              {streak.current}
            </p>
            <p className="text-caption font-bold uppercase tracking-wide text-play-ink/60">
              {t("streak.dayStreakLabel")}
            </p>
          </div>
        ) : (
          <p className="text-body font-black leading-tight text-play-ink">{prompt}</p>
        )}
      </div>

      {hasStreak && prompt && (
        <p className="text-caption font-bold text-play-warn-soft-ink">
          {prompt}
          {countdown && <span className="font-black"> · {countdown}</span>}
        </p>
      )}

      {/* Seven equal cells: round dots up to 28 px that shrink (never squash)
          when the card is half of a 390 px screen. */}
      <ol className="grid grid-cols-7 gap-1" aria-label={tE("streakStatus.lastSevenDays")}>
        {streak.days.map((day) => (
          <li
            key={day.key}
            className={cn(
              "relative flex aspect-square w-full max-w-7 items-center justify-center justify-self-center overflow-hidden rounded-full text-3xs font-black leading-none sm:text-caption",
              // play-ink/5 reads on both the peach active card and the white
              // inactive card (bg-white/70 was invisible on white).
              day.active ? "bg-play-warn text-white" : "bg-play-ink/5 text-play-ink/50",
              // Today is ringed with a gap in the card's own colour, so the
              // ring still reads around a filled (active) dot.
              day.isToday &&
                cn(
                  "ring-2 ring-play-warn ring-offset-2",
                  hasStreak ? "ring-offset-play-warn-soft" : "ring-offset-white"
                )
            )}
          >
            <span aria-hidden>
              {day.active ? <Check weight="bold" className="size-3 sm:size-3.5" /> : day.label}
            </span>
            <span className="sr-only">
              {tE(day.active ? "streakStatus.dayActive" : "streakStatus.dayInactive", {
                day: day.fullLabel || day.label,
              })}
            </span>
          </li>
        ))}
      </ol>

      {streak.longest > 0 && (
        <p className="mt-auto text-caption font-bold uppercase tracking-wide text-play-ink/60">
          {t("streak.best", { count: streak.longest })}
        </p>
      )}
    </div>
  );
};
