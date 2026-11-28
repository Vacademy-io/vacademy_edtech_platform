import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trophy, Crown, Buildings } from "@phosphor-icons/react";
import { BadgeVisual } from "@/routes/dashboard/-components/badge-icons";
import { AchievementsDialog } from "@/routes/dashboard/-components/AchievementsDialog";
import { getCachedGamification, type PlayGamificationData } from "@/services/play-gamification";
import { fetchLearnerSummary, fetchMyInstituteRank } from "@/services/course-leaderboard";
import { getBadgesEnabled } from "@/services/badge-config";
import { isLibraryToken } from "@/services/badge-library";
import { getInstituteId } from "@/constants/helper";
import { cn } from "@/lib/utils";

/**
 * Learner-profile "Badges & Rank" card. Shows the learner's earned badge
 * collection (reusing the dashboard-computed gamification cache — auto-unlocked
 * + admin-awarded) plus their best course rank (from the leaderboard summary).
 * "View all" opens the shared achievements popup (full badge wall + progress).
 */
export const BadgesRankCard: React.FC = () => {
  const { t } = useTranslation("userProfileExtra");
  const [badges, setBadges] = useState<{ name: string; icon: string }[]>([]);
  const [count, setCount] = useState(0);
  const [bestRank, setBestRank] = useState<number | null>(null);
  const [instituteRank, setInstituteRank] = useState<number | null>(null);
  const [gamData, setGamData] = useState<PlayGamificationData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      // Institute disabled the badges feature → don't render the card.
      if (!(await getBadgesEnabled())) {
        if (active) {
          setHidden(true);
          setLoaded(true);
        }
        return;
      }
      const instituteId = await getInstituteId();

      // Prefer the dashboard-computed badge collection (auto-unlocked + awarded).
      let list: { name: string; icon: string }[] = [];
      let total = 0;
      if (instituteId) {
        const cached = getCachedGamification(instituteId);
        if (cached && active) setGamData(cached);
        const unlocked = (cached?.badges ?? []).filter((b) => b.unlocked);
        if (unlocked.length) {
          list = unlocked.map((b) => ({ name: b.name, icon: b.icon }));
          total = unlocked.length;
        }
      }

      const [summary, instituteStanding] = await Promise.all([
        fetchLearnerSummary(),
        fetchMyInstituteRank(),
      ]);
      if (!active) return;

      // Fall back to the server's awarded badges if the dashboard cache is empty.
      if (!list.length && summary?.badges?.length) {
        list = summary.badges.map((b) => ({ name: b.name, icon: b.icon }));
        total = summary.totalBadges;
      }

      setBadges(list.slice(0, 12));
      setCount(total);
      setBestRank(summary?.bestRank ?? null);
      setInstituteRank(instituteStanding?.rank ?? null);
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Feature disabled, or nothing earned yet and no rank → hide the card entirely.
  if (hidden) return null;
  if (loaded && count === 0 && bestRank == null && instituteRank == null) return null;

  const canOpen = Boolean(gamData?.badges?.length);

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Trophy weight="fill" className="h-5 w-5 text-warning-500" />
          <h3 className="text-body font-semibold text-foreground">{t("badgesRank.title")}</h3>
        </div>
        {canOpen && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-caption font-medium text-primary-500 underline-offset-2 hover:underline"
          >
            {t("badgesRank.viewAll")}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-lg bg-primary-50 px-3 py-2">
          <p className="text-h2 font-bold text-primary-600">{count}</p>
          <p className="text-caption text-muted-foreground">
            {t("badgesRank.badgesEarned", { count })}
          </p>
        </div>
        {bestRank != null && (
          <div className="flex items-center gap-1.5 rounded-lg bg-secondary-50 px-3 py-2">
            <Crown weight="fill" className="h-4 w-4 text-warning-500" />
            <div>
              <p className="text-body font-bold text-secondary-500">#{bestRank}</p>
              <p className="text-caption text-muted-foreground">{t("badgesRank.bestRank")}</p>
            </div>
          </div>
        )}
        {instituteRank != null && (
          <div className="flex items-center gap-1.5 rounded-lg bg-tertiary-50 px-3 py-2">
            <Buildings weight="fill" className="h-4 w-4 text-tertiary-500" />
            <div>
              <p className="text-body font-bold text-tertiary-500">#{instituteRank}</p>
              <p className="text-caption text-muted-foreground">{t("badgesRank.instituteRank")}</p>
            </div>
          </div>
        )}
      </div>

      {badges.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2.5">
          {badges.map((b, i) => {
            const isLib = isLibraryToken(b.icon);
            return (
              <span
                key={i}
                title={b.name}
                className={cn(
                  "flex items-center justify-center",
                  isLib ? "h-12 w-12" : "h-10 w-10 rounded-full bg-primary-50"
                )}
              >
                <BadgeVisual
                  icon={b.icon}
                  fill
                  size={isLib ? 44 : 22}
                  className={isLib ? undefined : "text-primary-500"}
                />
              </span>
            );
          })}
        </div>
      )}

      {gamData && (
        <AchievementsDialog open={open} onOpenChange={setOpen} data={gamData} />
      )}
    </div>
  );
};
