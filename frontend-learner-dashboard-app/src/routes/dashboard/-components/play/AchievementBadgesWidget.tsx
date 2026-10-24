import React from "react";
import { Lock, Star } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { usePlayGamificationStore } from "@/stores/play-gamification-store";
import type { PlayBadge } from "@/services/play-gamification";
import iconBadges from "@/assets/cleaner-play/icon-badges.webp";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { BadgeVisual } from "../badge-icons";
import { isManualTrigger } from "@/services/badge-config";

const BadgeItem: React.FC<{ badge: PlayBadge }> = ({ badge }) => {
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
    : !unlocked && isManualTrigger(badge.trigger)
      ? t("badges.manualLockedTooltip", { name: badge.name })
      : t("badges.tooltip", { name: badge.name, description: badge.description });
  return (
    <div className="flex w-16 flex-col items-center gap-1" title={tooltip}>
      <div
        className={cn(
          "relative flex h-11 w-11 items-center justify-center rounded-full transition-all",
          unlocked ? "bg-white shadow-play-badge" : "bg-white/60 grayscale"
        )}
      >
        <BadgeVisual
          icon={badge.icon}
          fill
          weight={unlocked ? "fill" : "regular"}
          size={22}
          className={unlocked ? "text-play-accent-deep" : "text-play-ink/50"}
        />
        {!unlocked && (
          <Lock
            weight="fill"
            size={10}
            className="absolute -bottom-0.5 -end-0.5 rounded-full bg-white p-0.5 text-play-ink"
          />
        )}
        {awarded ? (
          <span className="absolute -top-1 -end-1 flex h-4 w-4 items-center justify-center rounded-full bg-play-gold ring-2 ring-white">
            <Star weight="fill" size={10} className="text-play-ink" />
          </span>
        ) : (
          unlocked && badge.unlockedAt && isRecent(badge.unlockedAt) && (
            <span className="absolute -top-1 -end-1 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-play-gold opacity-75" />
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-play-gold text-play-badge text-play-ink font-black items-center justify-center">!</span>
            </span>
          )
        )}
      </div>
      <span className="w-full text-center text-3xs font-bold leading-tight text-play-ink/70">
        {badge.name}
      </span>
    </div>
  );
};

function isRecent(dateStr: string): boolean {
  try { return Date.now() - new Date(dateStr).getTime() < 86400000; } catch { return false; }
}

export const AchievementBadgesWidget: React.FC = () => {
  const { t } = useTranslation("dashboard");
  const data = usePlayGamificationStore((s) => s.data);
  const isLoading = usePlayGamificationStore((s) => s.isLoading);
  // Master toggle off → the institute disabled badges; render nothing.
  if (data?.badgesEnabled === false) return null;
  const badges = data?.badges ?? [];
  const unlockedCount = badges.filter((b) => b.unlocked).length;

  if (isLoading) {
    return (
      <div className="h-full min-h-36 animate-pulse rounded-play-card-sm border border-border bg-play-accent-soft/50 shadow-play-soft-card" />
    );
  }

  return (
    <div className="flex h-full flex-col gap-stack rounded-play-card-sm border border-border bg-play-accent-soft p-4 shadow-play-soft-card">
      <div className="flex items-center gap-3">
        <img src={iconBadges} alt="" aria-hidden="true" className="h-11 w-11 shrink-0 object-contain" />
        <div>
          <p className="text-body font-black uppercase tracking-wide text-play-accent-soft-ink">
            {t("badges.title")}
          </p>
          <p className="text-caption font-bold text-play-ink/60">
            {unlockedCount > 0
              ? t("badges.unlockedCount", { unlocked: unlockedCount, total: badges.length })
              : t("badges.emptyPrompt", {
                  slide: getTerminology(ContentTerms.Slides, SystemTerms.Slides).toLocaleLowerCase(),
                })}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {badges.map((badge) => <BadgeItem key={badge.id} badge={badge} />)}
      </div>
    </div>
  );
};
