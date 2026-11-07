import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Star, Fire, Trophy, Lock, Check } from "@phosphor-icons/react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { usePlayGamificationStore } from "@/stores/play-gamification-store";
import type { PlayBadge, PlayGamificationData } from "@/services/play-gamification";
import { isLibraryToken } from "@/services/badge-library";
import { BadgeVisual } from "./badge-icons";
import { AchievementsDialog } from "./AchievementsDialog";
import { useCleanerPlayTheme } from "@/hooks/use-cleaner-play-theme";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import iconPoints from "@/assets/cleaner-play/icon-points.webp";
import iconStreak from "@/assets/cleaner-play/icon-streak.webp";
import iconBadges from "@/assets/cleaner-play/icon-badges.webp";
import { streakCountdown, streakPrompt, useStreakState } from "./play/useDashboardHeroData";

/**
 * Standard-theme gamification panel.
 *
 * Mirrors the Play widgets (XP / streak / badges) but is built entirely from the
 * shared design-system tokens (primary / warning / muted) so it fits the default
 * and vibrant dashboards. The Play theme keeps its own `play-*` widgets — those
 * tokens are not allowed to leak onto standard screens (see design-system
 * `09-learner-app.md`).
 */

const XP_PER_LEVEL = 500;

function XpCard({ data }: { data: PlayGamificationData | null }) {
  const { t } = useTranslation("dashboard");
  const isCleanerPlay = useCleanerPlayTheme();
  const totalXp = data?.totalXp ?? 0;
  const level = data?.level ?? 1;
  const xpToNext = data?.xpToNextLevel ?? XP_PER_LEVEL;
  const xpInLevel = XP_PER_LEVEL - xpToNext;
  const progress = Math.min(100, Math.max(0, Math.round((xpInLevel / XP_PER_LEVEL) * 100)));
  const hasXp = totalXp > 0;
  const breakdown = data?.xpBreakdown ?? [];

  if (isCleanerPlay) {
    return (
      <div className="cp-card flex h-full flex-col gap-stack p-4">
        <div className="flex items-center gap-3">
          <img src={iconPoints} alt="" aria-hidden="true" className="h-11 w-11 shrink-0 object-contain" />
          <div>
            <div className="flex items-baseline gap-1">
              <span className="cp-heading text-h2">{totalXp.toLocaleString()}</span>
              <span className="cp-muted text-caption font-semibold">{t("gamification.points")}</span>
            </div>
            <p className="cp-muted text-caption font-medium uppercase tracking-wide">
              {t("xp.levelLong", { level })}
            </p>
          </div>
        </div>

        {breakdown.length > 0 && (
          <div className="space-y-1 rounded-lg bg-cp-bg-deep p-2">
            <p className="cp-muted text-3xs font-semibold uppercase tracking-wide">
              {t("xp.howYouEarnPoints")}
            </p>
            {breakdown.map((b) => (
              <div key={b.key} className="flex items-center justify-between text-caption">
                <span className="cp-muted">{b.label}</span>
                <span className="cp-heading">{b.points}</span>
              </div>
            ))}
          </div>
        )}

        {hasXp ? (
          <div className="mt-auto space-y-1">
            <div className="h-2 overflow-hidden rounded-full bg-cp-bg-deep">
              <div
                className="h-full rounded-full bg-primary transition-all duration-700"
                style={{ width: `${progress}%` }} // design-lint-ignore: dynamic XP progress within the current level
              />
            </div>
            <p className="cp-muted text-caption">
              {t("gamification.pointsToLevel", { count: xpToNext, level: level + 1 })}
            </p>
          </div>
        ) : (
          <p className="cp-muted mt-auto text-caption">
            {t("gamification.startLearningPrompt")}
          </p>
        )}
      </div>
    );
  }

  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-stack p-card">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50">
            <Star weight="fill" size={20} className="text-primary-500" />
          </div>
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-h2 font-bold text-foreground">{totalXp.toLocaleString()}</span>
              <span className="text-caption font-semibold text-muted-foreground">
                {t("gamification.points")}
              </span>
            </div>
            <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
              {t("xp.levelLong", { level })}
            </p>
          </div>
        </div>

        {breakdown.length > 0 && (
          <div className="space-y-1 rounded-lg bg-neutral-50 p-2">
            <p className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("xp.howYouEarnPoints")}
            </p>
            {breakdown.map((b) => (
              <div key={b.key} className="flex items-center justify-between text-caption">
                <span className="text-muted-foreground">{b.label}</span>
                <span className="font-semibold text-foreground">{b.points}</span>
              </div>
            ))}
          </div>
        )}

        {hasXp ? (
          <div className="mt-auto space-y-1">
            <div className="h-2 overflow-hidden rounded-full bg-primary-100">
              <div
                className="h-full rounded-full bg-primary-500 transition-all duration-700"
                style={{ width: `${progress}%` }} // design-lint-ignore: dynamic XP progress within the current level
              />
            </div>
            <p className="text-caption text-muted-foreground">
              {t("gamification.pointsToLevel", { count: xpToNext, level: level + 1 })}
            </p>
          </div>
        ) : (
          <p className="mt-auto text-caption text-muted-foreground">
            {t("gamification.startLearningPrompt")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StreakCard() {
  const { t } = useTranslation("dashboard");
  const { t: tE } = useTranslation("dashboardEngagement");
  const isCleanerPlay = useCleanerPlayTheme();
  // The one streak value (server first) every surface shares — see useStreakState.
  const streak = useStreakState();
  const hasStreak = streak.current > 0;
  const prompt = streakPrompt(streak, tE);
  const countdown = streakCountdown(streak, tE);
  const flameWeight = streak.status === "kept" ? "fill" : "regular";

  const dayDots = (activeClass: string, idleClass: string, todayRing: string) => (
    <ol className="grid grid-cols-7 gap-1" aria-label={tE("streakStatus.lastSevenDays")}>
      {streak.days.map((day) => (
        <li
          key={day.key}
          className={cn(
            "relative flex aspect-square w-full max-w-7 items-center justify-center justify-self-center overflow-hidden rounded-full text-3xs font-semibold leading-none sm:text-caption",
            day.active ? activeClass : idleClass,
            day.isToday && todayRing
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
  );

  if (isCleanerPlay) {
    return (
      <div className="cp-card flex h-full flex-col gap-stack p-4">
        <div className="flex items-center gap-3">
          <img src={iconStreak} alt="" aria-hidden="true" className="h-11 w-11 shrink-0 object-contain" />
          {hasStreak ? (
            <div>
              <span className="cp-heading text-h2 tabular-nums">{streak.current}</span>
              <p className="cp-muted text-caption font-medium uppercase tracking-wide">
                {t("streak.dayStreakLabel")}
              </p>
            </div>
          ) : (
            <p className="cp-heading text-body">{prompt}</p>
          )}
        </div>
        {hasStreak && prompt && (
          <p className="cp-muted text-caption">
            {prompt}
            {countdown && <span className="cp-heading"> · {countdown}</span>}
          </p>
        )}
        {dayDots("bg-cp-gold text-white", "bg-cp-bg-deep cp-muted", "ring-2 ring-cp-gold ring-offset-2 ring-offset-cp-surface")}
        {streak.longest > 0 && (
          <p className="cp-muted mt-auto text-caption">{t("streak.best", { count: streak.longest })}</p>
        )}
      </div>
    );
  }

  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-stack p-card">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning-50">
            <Fire
              weight={flameWeight}
              size={20}
              className={hasStreak ? "text-warning-500" : "text-muted-foreground"}
            />
          </div>
          {hasStreak ? (
            <div>
              <span className="text-h2 font-bold tabular-nums text-foreground">{streak.current}</span>
              <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
                {t("streak.dayStreakLabel")}
              </p>
            </div>
          ) : (
            <p className="text-body font-semibold text-foreground">{prompt}</p>
          )}
        </div>
        {hasStreak && prompt && (
          <p className="text-caption text-warning-600">
            {prompt}
            {countdown && <span className="font-semibold"> · {countdown}</span>}
          </p>
        )}
        {dayDots("bg-warning-500 text-white", "bg-muted text-muted-foreground", "ring-2 ring-warning-500 ring-offset-2 ring-offset-card")}
        {streak.longest > 0 && (
          <p className="mt-auto text-caption text-muted-foreground">
            {t("streak.best", { count: streak.longest })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BadgeChip({ badge, isCleanerPlay }: { badge: PlayBadge; isCleanerPlay?: boolean }) {
  const { t } = useTranslation("dashboard");
  const unlocked = badge.unlocked;
  const awarded = badge.isAdminAwarded;
  const tooltip = awarded
    ? badge.awardReason
      ? t("badges.awardedTooltipWithReason", {
          name: badge.name,
          reason: badge.awardReason,
        })
      : t("badges.awardedTooltip", { name: badge.name })
    : t("badges.tooltip", { name: badge.name, description: badge.description });
  const isLib = isLibraryToken(badge.icon);
  return (
    <div className="flex w-16 flex-col items-center gap-1.5" title={tooltip}>
      <div
        className={cn(
          "relative flex items-center justify-center",
          isLib ? "h-14 w-14" : "h-11 w-11 rounded-full",
          !isLib &&
            (unlocked
              ? isCleanerPlay ? "bg-cp-sage-tint" : "bg-primary-50"
              : isCleanerPlay ? "bg-cp-bg-deep" : "bg-muted")
        )}
      >
        <BadgeVisual
          icon={badge.icon}
          fill
          weight={unlocked ? "fill" : "regular"}
          size={isLib ? 52 : 24}
          className={cn(
            isLib
              ? !unlocked && "opacity-45 grayscale"
              : unlocked
                ? isCleanerPlay ? "text-cp-sage" : "text-primary-500"
                : isCleanerPlay ? "cp-muted" : "text-muted-foreground"
          )}
        />
        {!unlocked && (
          <span className={cn(
            "absolute -bottom-0.5 -end-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full",
            isCleanerPlay ? "bg-cp-surface" : "bg-background"
          )}>
            <Lock weight="fill" size={9} className={isCleanerPlay ? "cp-muted" : "text-muted-foreground"} />
          </span>
        )}
        {awarded && (
          <span className={cn(
            "absolute -end-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full ring-2",
            isCleanerPlay ? "bg-cp-gold ring-cp-surface" : "bg-warning-500 ring-card"
          )}>
            <Star weight="fill" size={9} className="text-white" />
          </span>
        )}
      </div>
      <span className={cn(
        "w-full text-center text-3xs font-medium leading-tight",
        isCleanerPlay ? "cp-muted" : "text-muted-foreground"
      )}>
        {badge.name}
      </span>
    </div>
  );
}

function BadgesCard({
  data,
  onOpenDetails,
}: {
  data: PlayGamificationData | null;
  onOpenDetails?: () => void;
}) {
  const { t } = useTranslation("dashboard");
  const isCleanerPlay = useCleanerPlayTheme();
  const badges = data?.badges ?? [];
  const unlockedCount = badges.filter((b) => b.unlocked).length;
  const showViewAll = Boolean(onOpenDetails) && badges.length > 0;

  if (isCleanerPlay) {
    return (
      <div className="cp-card flex h-full flex-col gap-stack p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src={iconBadges} alt="" aria-hidden="true" className="h-11 w-11 shrink-0 object-contain" />
            <div>
              <p className="cp-heading text-subtitle">{t("badges.title")}</p>
              <p className="cp-muted text-caption">
                {unlockedCount > 0
                  ? t("badges.unlockedCount", { unlocked: unlockedCount, total: badges.length })
                  : t("gamification.badgesEmptyPrompt", {
                      slide: getTerminology(ContentTerms.Slides, SystemTerms.Slides).toLocaleLowerCase(),
                    })}
              </p>
            </div>
          </div>
          {showViewAll && (
            <button
              type="button"
              onClick={onOpenDetails}
              className="cp-muted shrink-0 text-caption font-medium underline-offset-2 hover:underline"
            >
              View all
            </button>
          )}
        </div>
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-2.5">
            {badges.map((badge) => (
              <BadgeChip key={badge.id} badge={badge} isCleanerPlay />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-stack p-card">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50">
              <Trophy weight="fill" size={20} className="text-primary-500" />
            </div>
            <div>
              <p className="text-subtitle font-bold text-foreground">{t("badges.title")}</p>
              <p className="text-caption text-muted-foreground">
                {unlockedCount > 0
                  ? t("badges.unlockedCount", { unlocked: unlockedCount, total: badges.length })
                  : t("gamification.badgesEmptyPrompt", {
                      slide: getTerminology(ContentTerms.Slides, SystemTerms.Slides).toLocaleLowerCase(),
                    })}
              </p>
            </div>
          </div>
          {showViewAll && (
            <button
              type="button"
              onClick={onOpenDetails}
              className="shrink-0 text-caption font-medium text-primary-500 underline-offset-2 hover:underline"
            >
              View all
            </button>
          )}
        </div>
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-2.5">
            {badges.map((badge) => (
              <BadgeChip key={badge.id} badge={badge} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const DashboardGamificationPanel: React.FC = () => {
  const data = usePlayGamificationStore((s) => s.data);
  const isLoading = usePlayGamificationStore((s) => s.isLoading);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Master toggle off → hide the badges card (XP + streak stay).
  const showBadges = data?.badgesEnabled !== false;

  // No empty-state flash: skeletons until the store resolves (cache or fetch).
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              "h-36 animate-pulse rounded-xl border border-border bg-muted/50",
              "cp-card [.ui-cleaner-play_&]:bg-cp-bg-deep"
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <XpCard data={data} />
        <StreakCard />
        {showBadges && (
          <BadgesCard data={data} onOpenDetails={() => setDetailsOpen(true)} />
        )}
      </div>
      {showBadges && (
        <AchievementsDialog open={detailsOpen} onOpenChange={setDetailsOpen} data={data} />
      )}
    </>
  );
};
