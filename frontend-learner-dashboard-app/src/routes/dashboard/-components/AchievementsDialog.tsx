import { Star, Fire, Trophy, Lock, CheckCircle } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { PlayBadge, PlayGamificationData } from "@/services/play-gamification";
import { isLibraryToken } from "@/services/badge-library";
import { isManualTrigger } from "@/services/badge-config";
import { BadgeVisual } from "./badge-icons";
import { useStreakState } from "./play/useDashboardHeroData";

const XP_PER_LEVEL = 500;

/**
 * "Your achievements" popup — a single overview of the learner's gamification
 * state: level + points progress, how points are earned, and the full badge wall
 * with per-badge progress toward the ones still locked. Shared by the header
 * achievements pill, the dashboard badges card and the profile Badges & Rank card.
 */
export function AchievementsDialog({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: PlayGamificationData | null;
}) {
  const { t } = useTranslation("dashboard");
  const badges = data?.badges ?? [];
  const unlockedCount = badges.filter((b) => b.unlocked).length;
  const totalXp = data?.totalXp ?? 0;
  const level = data?.level ?? 1;
  const xpToNext = data?.xpToNextLevel ?? XP_PER_LEVEL;
  const progress = Math.min(
    100,
    Math.max(0, Math.round(((XP_PER_LEVEL - xpToNext) / XP_PER_LEVEL) * 100))
  );
  const breakdown = data?.xpBreakdown ?? [];
  // The one streak value every surface shows (server first, then the browser
  // estimate), read only while the dialog is open.
  const streakState = useStreakState({ enabled: open });
  const streak = streakState.source === "server" ? streakState.current : data?.currentStreak ?? 0;
  const streakKept = streakState.source === "server" ? streakState.status === "kept" : true;

  // Unlocked first, then locked badges by closeness to unlocking (so the "almost
  // there" badges bubble up); locked staff-awarded badges (no progress to make) last.
  const ordered = [...badges].sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    const aManual = isManualTrigger(a.trigger);
    const bManual = isManualTrigger(b.trigger);
    if (aManual !== bManual) return aManual ? 1 : -1;
    return pctFor(b) - pctFor(a);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="border-b border-border p-4">
          <DialogTitle className="flex items-center gap-2">
            <Trophy weight="fill" className="h-5 w-5 text-warning-500" />
            {t("achievements.title")}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-96">
          <div className="space-y-4 p-4">
            {/* Level + points */}
            <div className="rounded-xl border border-primary-100 bg-primary-50 p-4 [.ui-play_&]:rounded-play-card [.ui-play_&]:border-transparent [.ui-play_&]:bg-play-gold-soft [.ui-play_&]:shadow-play-soft-card [.ui-cleaner-play_&]:border-transparent [.ui-cleaner-play_&]:bg-cp-gold-tint">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-100 [.ui-play_&]:bg-play-gold [.ui-cleaner-play_&]:bg-cp-gold">
                  <Star weight="fill" size={22} className="text-primary-500 [.ui-play_&]:text-white [.ui-cleaner-play_&]:text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1">
                    <span className="text-h2 font-bold text-foreground">
                      {totalXp.toLocaleString()}
                    </span>
                    <span className="text-caption font-semibold text-muted-foreground">
                      {t("xp.xpUnit")}
                    </span>
                  </div>
                  <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
                    {t("xp.levelLong", { level })}
                  </p>
                </div>
                {streak > 0 && (
                  <div
                    className="flex items-center gap-1 rounded-full bg-warning-50 px-2.5 py-1"
                    title={t("streak.dayStreakLabel")}
                  >
                    <Fire
                      weight={streakKept ? "fill" : "regular"}
                      size={14}
                      className="text-warning-500"
                    />
                    <span className="text-caption font-semibold tabular-nums text-warning-600">
                      {streak}
                    </span>
                  </div>
                )}
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-primary-100 [.ui-play_&]:h-2.5 [.ui-play_&]:bg-play-surface">
                <div
                  className="h-full rounded-full bg-primary-500 transition-all duration-700 [.ui-play_&]:bg-play-success"
                  style={{ width: `${progress}%` }} // design-lint-ignore: dynamic XP progress within the current level
                />
              </div>
              <p className="mt-1 text-caption text-muted-foreground">
                {t("achievements.xpToNextLevel", { xp: xpToNext, level: level + 1 })}
              </p>
            </div>

            {/* How points are earned */}
            {breakdown.length > 0 && (
              <div className="rounded-xl border border-border p-3 space-y-1.5">
                <p className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("xp.howYouEarnPoints")}
                </p>
                <div className="space-y-1">
                  {breakdown.map((b) => (
                    <div
                      key={b.key}
                      className="flex items-center justify-between text-caption"
                    >
                      <span className="text-muted-foreground">{b.label}</span>
                      <span className="font-semibold text-foreground">{b.points}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Badge wall */}
            {badges.length > 0 && (
              <div className="space-y-2">
                <p className="text-caption font-semibold text-foreground">
                  {t("achievements.badgesUnlocked", { unlocked: unlockedCount, total: badges.length })}
                </p>
                <div className="space-y-2">
                  {ordered.map((badge) => (
                    <BadgeRow key={badge.id} badge={badge} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function pctFor(badge: PlayBadge): number {
  if (badge.unlocked) return 100;
  const target = badge.threshold ?? 0;
  if (target <= 0) return 0;
  return Math.min(100, Math.round(((badge.progressCurrent ?? 0) / target) * 100));
}

function BadgeRow({ badge }: { badge: PlayBadge }) {
  const { t } = useTranslation("dashboard");
  const unlocked = badge.unlocked;
  const isLib = isLibraryToken(badge.icon);
  const manual = isManualTrigger(badge.trigger);
  // Staff-awarded badges have no automatic condition — never draw a progress bar.
  const target = manual ? 0 : badge.threshold ?? 0;
  const current = Math.min(badge.progressCurrent ?? 0, target > 0 ? target : Number.MAX_SAFE_INTEGER);
  const pct = pctFor(badge);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3",
        "[.ui-play_&]:rounded-play-card-sm",
        unlocked
          ? "border-primary-100 bg-primary-50 [.ui-play_&]:border-transparent [.ui-play_&]:bg-play-gold-soft [.ui-cleaner-play_&]:border-transparent [.ui-cleaner-play_&]:bg-cp-gold-tint"
          : "border-border bg-card"
      )}
    >
      <div
        className={cn(
          "relative flex h-14 w-14 shrink-0 items-center justify-center rounded-xl",
          "[.ui-play_&]:rounded-play-card-sm",
          !isLib &&
            (unlocked
              ? "bg-primary-100 [.ui-play_&]:bg-play-gold [.ui-cleaner-play_&]:bg-cp-gold"
              : "bg-muted")
        )}
      >
        <BadgeVisual
          icon={badge.icon}
          fill
          weight={unlocked ? "fill" : "regular"}
          size={44}
          className={cn(
            unlocked
              ? "text-primary-500 [.ui-play_&]:text-white [.ui-cleaner-play_&]:text-white"
              : "text-muted-foreground opacity-40 grayscale"
          )}
        />
        {!unlocked && (
          <span className="absolute -bottom-1 -end-1 flex h-5 w-5 items-center justify-center rounded-full bg-background">
            <Lock weight="fill" size={11} className="text-muted-foreground" />
          </span>
        )}
        {unlocked && badge.isAdminAwarded && (
          <span className="absolute -end-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-warning-500 ring-2 ring-card">
            <Star weight="fill" size={10} className="text-white" />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-body font-semibold text-foreground">{badge.name}</p>
          {unlocked && (
            <CheckCircle weight="fill" size={16} className="shrink-0 text-primary-500" />
          )}
        </div>
        <p className="truncate text-caption text-muted-foreground">{badge.description}</p>

        {unlocked && badge.isAdminAwarded && badge.awardReason ? (
          <p className="truncate text-3xs font-medium text-warning-600">
            ★ {badge.awardReason}
          </p>
        ) : !unlocked && manual ? (
          <p className="mt-0.5 text-3xs font-medium text-muted-foreground">
            {t("badges.manualLockedHint")}
          </p>
        ) : (
          !unlocked &&
          target > 0 && (
            <div className="mt-1.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary-400 transition-all"
                  style={{ width: `${pct}%` }} // design-lint-ignore: dynamic badge progress
                />
              </div>
              <p className="mt-0.5 text-3xs text-muted-foreground">
                {current.toLocaleString()} / {target.toLocaleString()}
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
