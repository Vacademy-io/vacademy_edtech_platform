import { createFileRoute, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Medal, Star, Certificate, Trophy } from "@phosphor-icons/react";
import { ModuleScaffold } from "../../-components/ModuleScaffold";
// Same renderer the student app uses — built-in medallion icons or the
// admin-uploaded badge artwork, so parent and student see identical badges.
import { BadgeVisual } from "@/routes/dashboard/-components/badge-icons";
import { cn } from "@/lib/utils";
import {
  useChildBadges,
  useChildCertificates,
  useChildPoints,
  useChildOverview,
} from "../../-hooks/use-parent-child";

export const Route = createFileRoute("/parent/child/$childId/rewards/")({
  component: RewardsScreen,
});

function formatDate(raw?: string | null): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function RewardsScreen() {
  const { childId } = useParams({ from: "/parent/child/$childId/rewards/" });
  const { t } = useTranslation("parent");
  const overview = useChildOverview(childId);
  const { data: badges, isLoading, isError, refetch } = useChildBadges(childId);
  const { data: certificates } = useChildCertificates(childId);
  const { data: points } = useChildPoints(childId);

  const childName = overview.data?.child?.fullName || t("common.yourChild");
  const badgeCount = badges?.length ?? 0;
  const certCount = certificates?.length ?? 0;
  const pointsValue = points?.points ?? 0;

  return (
    <ModuleScaffold
      childId={childId}
      title={t("tiles.rewards")}
      icon="rewards"
      summary={t("rewards.summary", { name: childName, count: badgeCount })}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => refetch()}
      isEmpty={badgeCount === 0 && certCount === 0 && pointsValue === 0}
      emptyIcon={Medal}
      emptyTitle={t("rewards.emptyTitle")}
      emptyBody={t("rewards.emptyBody")}
    >
      <div className="flex flex-col gap-5">
        {/* ── Gold hero: points + rank ── */}
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-cp-gold-tint to-card px-5 py-5 shadow-sm">
          <div className="flex items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-cp-gold-tint shadow-sm">
              <Star weight="fill" className="size-8 text-cp-gold" aria-hidden />
            </span>
            <div className="flex flex-col">
              <span className="text-h1 font-bold tabular-nums text-foreground">{pointsValue}</span>
              <span className="text-caption text-muted-foreground">{t("rewards.points")}</span>
            </div>
          </div>
          {points?.rank != null ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-caption font-semibold text-foreground shadow-sm">
              <Trophy weight="fill" className="size-4 text-cp-gold" aria-hidden />
              {t("rewards.rank", { value: points.rank })}
            </span>
          ) : null}
        </div>

        {/* ── At-a-glance tiles ── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col items-center gap-1 rounded-2xl bg-card px-3 py-4 text-center shadow-sm">
            <Medal weight="fill" className="size-6 text-cp-gold" aria-hidden />
            <span className="text-h2 font-bold tabular-nums text-foreground">{badgeCount}</span>
            <span className="text-caption text-muted-foreground">{t("rewards.badgesTitle")}</span>
          </div>
          <div className="flex flex-col items-center gap-1 rounded-2xl bg-card px-3 py-4 text-center shadow-sm">
            <Certificate weight="fill" className="size-6 text-primary-500" aria-hidden />
            <span className="text-h2 font-bold tabular-nums text-foreground">{certCount}</span>
            <span className="text-caption text-muted-foreground">{t("rewards.certificatesTitle")}</span>
          </div>
        </div>

        {/* ── Badges ── */}
        {badgeCount > 0 ? (
          <div className="flex flex-col gap-stack">
            <h2 className="text-body font-semibold text-foreground">{t("rewards.badgesTitle")}</h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {badges?.map((b, i) => {
                const awarded = formatDate(typeof b.awardedAt === "string" ? b.awardedAt : null);
                // Missing source = older server, where every row was a staff award.
                const isStaffAward = (b.source ?? "MANUAL").toUpperCase() !== "AUTO";
                const reason = isStaffAward && typeof b.reason === "string" ? b.reason.trim() : "";
                return (
                  <li
                    key={String(b.id ?? b.badgeId ?? i)}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-2xl bg-card p-4 text-center shadow-sm",
                      "transition-transform hover:-translate-y-0.5",
                    )}
                  >
                    <span className="relative flex size-14 items-center justify-center overflow-visible rounded-full bg-cp-gold-tint">
                      <span className="flex size-14 items-center justify-center overflow-hidden rounded-full">
                        <BadgeVisual
                          icon={String(b.badgeIcon ?? b.iconFileId ?? b.icon ?? "Medal")}
                          fill
                          weight="fill"
                          size={30}
                          className="text-cp-gold"
                        />
                      </span>
                      {isStaffAward ? (
                        <span
                          className="absolute -end-1 -top-1 flex size-5 items-center justify-center rounded-full bg-warning-500 ring-2 ring-card"
                          aria-hidden
                        >
                          <Star weight="fill" className="size-2.5 text-white" />
                        </span>
                      ) : null}
                    </span>
                    <span className="text-caption font-semibold text-foreground">
                      {String(b.badgeName ?? b.name ?? t("rewards.badge"))}
                    </span>
                    {isStaffAward ? (
                      <span className="text-3xs font-medium uppercase tracking-wide text-warning-600">
                        {t("rewards.awardedByInstitute")}
                      </span>
                    ) : null}
                    {reason ? (
                      <span className="line-clamp-2 text-caption italic text-muted-foreground">
                        {t("rewards.awardReason", { reason })}
                      </span>
                    ) : null}
                    {awarded ? (
                      <span className="text-caption text-muted-foreground">
                        {t("rewards.earnedOn", { date: awarded })}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {/* ── Certificates ── */}
        {certCount > 0 ? (
          <div className="flex flex-col gap-stack">
            <h2 className="text-body font-semibold text-foreground">
              {t("rewards.certificatesTitle")}
            </h2>
            <ul className="flex flex-col gap-2">
              {certificates?.map((c) => {
                const issued = formatDate(c.issuedAt);
                return (
                  <li
                    key={c.certificateId}
                    className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3.5 shadow-sm"
                  >
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-50">
                      <Certificate weight="fill" className="size-6 text-primary-500" aria-hidden />
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-body font-medium text-foreground">
                        {c.courseName || t("rewards.certificate")}
                      </span>
                      <span className="text-caption text-muted-foreground">
                        {[
                          issued ? t("rewards.earnedOn", { date: issued }) : null,
                          c.completionPercentage != null
                            ? t("rewards.completed", { percent: Math.round(c.completionPercentage) })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </ModuleScaffold>
  );
}
