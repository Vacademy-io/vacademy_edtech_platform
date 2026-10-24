import { useEffect, useRef, useState } from "react";
import { Trophy, Star } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { usePlayGamificationStore } from "@/stores/play-gamification-store";
import {
  applyServerPoints,
  getCachedGamification,
  type PlayGamificationData,
} from "@/services/play-gamification";
import { getInstituteId } from "@/constants/helper";
import { AchievementsDialog } from "./AchievementsDialog";
import { useCorporateTheme } from "@/hooks/use-corporate-theme";
import { usePlayTheme } from "@/hooks/use-play-theme";
import { POINTS_ME_KEY, applyResultToPointsCache, usePointsSummary } from "@/services/points";
import { ENGAGEMENT_RESULT_EVENT, type EngagementSubmitResponse } from "@/services/engagement";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Compact header pill showing the learner's badge count + points. Clicking it
 * opens the achievements popup.
 *
 * Points come from the server summary (`['points','me']`), fetched here so every
 * page shows the same figure the dashboard does, and moved at once by a task
 * result (useSubmitEngagement patches that query). Badges come from the shared
 * gamification store (populated by the dashboard), falling back to the
 * localStorage cache on pages reached without passing through the dashboard.
 */
export function AchievementsPill({ className }: { className?: string }) {
  const { t } = useTranslation("dashboard");
  const storeData = usePlayGamificationStore((s) => s.data);
  const [fallback, setFallback] = useState<PlayGamificationData | null>(null);
  const [open, setOpen] = useState(false);
  // Corporate: monochrome line icons instead of a gold trophy + brand star.
  const isCorporate = useCorporateTheme();
  const isPlay = usePlayTheme();
  const visibleData = storeData ?? fallback;
  const { data: serverPoints } = usePointsSummary({
    enabled: Boolean(visibleData) && visibleData?.badgesEnabled !== false,
  });
  // Play skins pop the number when a task result lands (not on mount).
  const awardSeq = usePlayGamificationStore((s) => s.lastAward?.seq ?? 0);
  const mountSeq = useRef(awardSeq);
  const queryClient = useQueryClient();

  // Any task result (from whichever engagement UI) moves the figure at once, then
  // refreshes it from the server. applyResultToPointsCache applies a result once,
  // however many listeners (or the submit hook) see it.
  useEffect(() => {
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<EngagementSubmitResponse | undefined>).detail;
      applyResultToPointsCache(queryClient, detail);
      void queryClient.invalidateQueries({ queryKey: POINTS_ME_KEY });
    };
    window.addEventListener(ENGAGEMENT_RESULT_EVENT, onResult);
    return () => window.removeEventListener(ENGAGEMENT_RESULT_EVENT, onResult);
  }, [queryClient]);

  useEffect(() => {
    if (storeData) return;
    let active = true;
    (async () => {
      const id = await getInstituteId();
      if (!id || !active) return;
      const cached = getCachedGamification(id);
      if (cached && active) setFallback(cached);
    })();
    return () => {
      active = false;
    };
  }, [storeData]);

  // The server figures win wherever they exist, so the pill and its dialog show the
  // same total, level and (once the server sends it) streak as the dashboard.
  const data = visibleData ? applyServerPoints(visibleData, serverPoints) : null;
  // Hide until we have data and only when the institute has the feature on.
  if (!data || data.badgesEnabled === false) return null;

  const badgeCount = data.badges?.filter((b) => b.unlocked).length ?? 0;
  const xp = data.totalXp ?? 0;
  const popXp = isPlay && awardSeq > mountSeq.current;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("achievements.title")}
        title={t("achievements.title")}
        className={cn(
          "flex h-9 items-center gap-2 rounded-full border border-primary-200/50 bg-white px-2.5 transition-colors duration-200 hover:border-primary-300 hover:bg-primary-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700 [.ui-play_&]:rounded-full [.ui-play_&]:border-border",
          "[.ui-corporate_&]:rounded-md [.ui-corporate_&]:border-border [.ui-corporate_&]:hover:border-border [.ui-corporate_&]:hover:bg-muted",
          className
        )}
      >
        <span className="flex items-center gap-1">
          <Trophy weight={isCorporate ? "regular" : "fill"} className="h-4 w-4 text-warning-500 [.ui-corporate_&]:text-muted-foreground" />
          <span className="text-caption font-semibold text-foreground">{badgeCount}</span>
        </span>
        <span className="hidden items-center gap-1 border-s border-primary-200/50 ps-2 dark:border-neutral-700 sm:flex [.ui-corporate_&]:border-border">
          <Star weight={isCorporate ? "regular" : "fill"} className="h-4 w-4 text-primary-500 [.ui-corporate_&]:text-muted-foreground" />
          <span
            key={popXp ? awardSeq : "xp"}
            className={cn(
              "text-caption font-semibold tabular-nums text-foreground",
              popXp && "play-xp-pop"
            )}
          >
            {xp.toLocaleString()}
          </span>
        </span>
      </button>
      <AchievementsDialog open={open} onOpenChange={setOpen} data={data} />
    </>
  );
}
