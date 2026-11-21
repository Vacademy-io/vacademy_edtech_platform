import React from "react";
import { Lightning } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { usePlayGamificationStore } from "@/stores/play-gamification-store";
import iconPoints from "@/assets/cleaner-play/icon-points.webp";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

export const XpDisplayWidget: React.FC = () => {
  const { t } = useTranslation("dashboard");
  const data = usePlayGamificationStore((s) => s.data);
  const isLoading = usePlayGamificationStore((s) => s.isLoading);
  const totalXp = data?.totalXp ?? 0;
  const level = data?.level ?? 1;
  const xpToNext = data?.xpToNextLevel ?? 500;
  const todayXp = data?.todayXp ?? 0;
  const breakdown = data?.xpBreakdown ?? [];

  const xpPerLevel = 500;
  const xpInLevel = xpPerLevel - xpToNext;
  // Clamp like DashboardGamificationPanel: xpToNext > 500 would otherwise
  // yield a negative width, which the browser drops → full-width gold bar.
  const progress = Math.min(100, Math.max(0, Math.round((xpInLevel / xpPerLevel) * 100)));
  const hasXp = totalXp > 0;

  if (isLoading) {
    return (
      <div className="h-full min-h-36 animate-pulse rounded-play-card-sm border border-border bg-play-gold-soft/50 shadow-play-soft-card" />
    );
  }

  return (
    <div className="flex h-full flex-col gap-stack rounded-play-card-sm border border-border bg-play-gold-soft p-4 shadow-play-soft-card">
      {hasXp ? (
        <>
          <div className="flex items-center gap-3">
            <img src={iconPoints} alt="" aria-hidden="true" className="h-11 w-11 shrink-0 object-contain" />
            <div>
              <div className="flex items-baseline gap-1.5">
                <p className="text-h2 font-black leading-none text-play-gold-soft-ink">{totalXp.toLocaleString()}</p>
                <span className="text-caption font-black text-play-ink/60">{t("xp.xpUnit")}</span>
              </div>
              <p className="text-caption font-bold uppercase tracking-wide text-play-ink/60">
                {t("xp.levelLong", { level })}
              </p>
            </div>
          </div>

          {breakdown.length > 0 && (
            <div className="space-y-1 rounded-xl bg-white/60 p-2">
              <p className="text-3xs font-bold uppercase tracking-wide text-play-ink/60">
                {t("xp.howYouEarnPoints")}
              </p>
              {breakdown.map((b) => (
                <div key={b.key} className="flex items-center justify-between text-caption">
                  <span className="text-play-ink/60">{b.label}</span>
                  <span className="font-bold text-play-ink">{b.points}</span>
                </div>
              ))}
            </div>
          )}

          <div>
            <div className="mb-1 flex justify-between text-3xs font-bold uppercase tracking-wide text-play-ink/60">
              <span>{t("xp.levelShort", { level })}</span>
              <span>{t("xp.levelShort", { level: level + 1 })}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-white/70">
              <div className="h-full rounded-full bg-play-gold transition-all duration-700" style={{ width: `${progress}%` }} /* design-lint-ignore: dynamic progress percentage */ />
            </div>
            <p className="mt-1 text-end text-3xs font-bold uppercase text-play-ink/60">
              {t("xp.xpToGo", { amount: xpToNext })}
            </p>
          </div>

          {todayXp > 0 && (
            <div className="inline-flex w-fit items-center gap-1 rounded-full bg-white px-2.5 py-0.5 shadow-sm">
              <Lightning weight="fill" size={14} className="text-play-gold-soft-ink" />
              <span className="text-3xs font-black text-play-ink">
                {t("xp.xpToday", { amount: todayXp })}
              </span>
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center gap-3">
          <img src={iconPoints} alt="" aria-hidden="true" className="h-11 w-11 shrink-0 object-contain" />
          <p className="text-body font-black leading-tight text-play-ink">
            {t("xp.emptyPrompt", {
              slide: getTerminology(ContentTerms.Slides, SystemTerms.Slides).toLocaleLowerCase(),
            })}
          </p>
        </div>
      )}
    </div>
  );
};
