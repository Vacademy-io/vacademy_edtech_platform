import { useState } from "react";
import { Crown, Trophy, Medal, ShieldCheck, CaretRight } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { BadgeVisual } from "@/routes/dashboard/-components/badge-icons";
import { isLibraryToken } from "@/services/badge-library";
import type {
  CourseLeaderboardData,
  LeaderboardEntry,
} from "@/services/course-leaderboard";

/** The learner's earned badge icons (up to 3) + an overflow count. */
function BadgeIcons({ entry, size = 20 }: { entry: LeaderboardEntry; size?: number }) {
  const shown = entry.badges?.slice(0, 3) ?? [];
  if (entry.badgeCount <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {shown.map((b, i) => (
        <span key={i} title={b.name} className="inline-flex">
          <BadgeVisual icon={b.icon} size={size} className="text-warning-600" noAuth />
        </span>
      ))}
      {entry.badgeCount > shown.length && (
        <span className="text-caption font-semibold text-warning-600">
          +{entry.badgeCount - shown.length}
        </span>
      )}
    </span>
  );
}

/** A single badge at a readable size — library art or icon, with its name. */
function BadgeCell({ badge }: { badge: { name: string; icon: string } }) {
  const isLib = isLibraryToken(badge.icon);
  return (
    <div className="flex w-24 flex-col items-center gap-1.5" title={badge.name}>
      <span
        className={cn(
          "flex items-center justify-center",
          isLib ? "h-24 w-24" : "h-20 w-20 rounded-full bg-primary-50"
        )}
      >
        <BadgeVisual
          icon={badge.icon}
          size={isLib ? 88 : 44}
          className={isLib ? undefined : "text-primary-500"}
          noAuth
        />
      </span>
      <span className="w-full text-center text-caption font-medium leading-tight text-neutral-700">
        {badge.name}
      </span>
    </div>
  );
}

/** Popup: a learner's earned badges at full size (opened by tapping a row). */
function EntryBadgesDialog({
  entry,
  onClose,
}: {
  entry: LeaderboardEntry | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("miscRoutesA");
  return (
    <Dialog open={Boolean(entry)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy weight="fill" className="size-5 text-warning-500" />
            {entry?.name
              ? t("leaderboard.badgesDialog.titleNamed", { name: entry.name })
              : t("leaderboard.badgesDialog.titleGeneric")}
          </DialogTitle>
        </DialogHeader>
        {entry && entry.badges?.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-3 py-2">
            {entry.badges.map((b, i) => (
              <BadgeCell key={i} badge={b} />
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-caption text-muted-foreground">
            {t("leaderboard.badgesDialog.none")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Per-place accent tones (gold / silver / bronze) using design tokens only. */
const PLACE = {
  1: { ring: "ring-warning-400", pedestal: "bg-warning-100 text-warning-600", height: "h-24" },
  2: { ring: "ring-neutral-300", pedestal: "bg-neutral-100 text-neutral-500", height: "h-16" },
  3: { ring: "ring-warning-600", pedestal: "bg-warning-50 text-warning-700", height: "h-12" },
} as const;

/** First character of a name (works for full names and anonymized initials alike). */
function firstChar(name: string): string {
  const c = name.trim().charAt(0);
  return c ? c.toUpperCase() : "?";
}

function InitialAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-primary-100 font-bold uppercase text-primary-600",
        className
      )}
    >
      {firstChar(name)}
    </div>
  );
}

function PodiumSpot({
  entry,
  place,
  onClick,
}: {
  entry?: LeaderboardEntry;
  place: 1 | 2 | 3;
  onClick?: () => void;
}) {
  const { t } = useTranslation("miscRoutesA");
  if (!entry) return <div className="flex-1" />;
  const first = place === 1;
  const tone = PLACE[place];
  const clickable = Boolean(onClick) && entry.badgeCount > 0;
  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      title={clickable ? t("leaderboard.viewBadges") : undefined}
      className={cn(
        "flex flex-1 flex-col items-center justify-end gap-2",
        clickable && "cursor-pointer"
      )}
    >
      {first ? (
        <Crown weight="fill" className="size-6 text-warning-500" />
      ) : (
        <Medal
          weight="fill"
          className={cn("size-5", place === 2 ? "text-neutral-400" : "text-warning-700")}
        />
      )}
      <div className="relative">
        <InitialAvatar
          name={entry.name}
          className={cn("ring-4", first ? "size-16 text-h3" : "size-12 text-body", tone.ring)}
        />
        <span
          className={cn(
            "absolute -bottom-1 start-1/2 grid size-5 -translate-x-1/2 place-items-center rounded-full text-caption font-black shadow-sm",
            tone.pedestal
          )}
        >
          {place}
        </span>
      </div>
      <div className="flex w-full flex-col items-center px-1 text-center">
        <p className="w-full truncate text-caption font-bold text-foreground">{entry.name}</p>
        <p className="text-caption font-semibold tabular-nums text-primary-500">
          {t("leaderboard.pointsSuffix", { points: entry.points })}
        </p>
        {entry.badgeCount > 0 && (
          <span className="mt-1 flex items-center justify-center rounded-full bg-warning-50 px-2 py-1 ring-1 ring-warning-100">
            <BadgeIcons entry={entry} size={first ? 30 : 26} />
          </span>
        )}
      </div>
      <div
        className={cn(
          "flex w-full items-start justify-center rounded-t-xl bg-gradient-to-b from-primary-50 to-card pt-1.5 text-h3 font-black text-primary-300",
          tone.height
        )}
      >
        {place}
      </div>
    </div>
  );
}

function ListRow({ entry, onClick }: { entry: LeaderboardEntry; onClick?: () => void }) {
  const { t } = useTranslation("miscRoutesA");
  const clickable = Boolean(onClick) && entry.badgeCount > 0;
  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      title={clickable ? t("leaderboard.viewBadges") : undefined}
      className={cn(
        "flex items-center gap-3 rounded-xl border border-neutral-100 bg-card px-3 py-2.5 transition-colors hover:border-primary-100",
        clickable && "cursor-pointer"
      )}
    >
      <span className="w-6 text-center text-body font-bold tabular-nums text-muted-foreground">
        {entry.rank ?? "–"}
      </span>
      <InitialAvatar name={entry.name} className="size-9 text-caption" />
      <span className="flex-1 truncate text-body font-medium text-neutral-700">{entry.name}</span>
      <BadgeIcons entry={entry} size={24} />
      <span className="w-16 text-end text-body font-bold tabular-nums text-foreground">
        {entry.points}
        <span className="ms-0.5 text-caption font-normal text-muted-foreground">
          {t("leaderboard.pts")}
        </span>
      </span>
      {clickable && <CaretRight className="size-3.5 shrink-0 text-neutral-300" />}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="flex items-end justify-center gap-3">
        <div className="h-20 w-1/4 rounded-xl bg-neutral-100" />
        <div className="h-28 w-1/3 rounded-xl bg-neutral-100" />
        <div className="h-16 w-1/4 rounded-xl bg-neutral-100" />
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-11 rounded-xl bg-neutral-100" />
      ))}
    </div>
  );
}

export interface PublicLeaderboardViewProps {
  logoUrl: string;
  instituteName: string | null;
  /** Small chip under the title — course name, or a label like "All courses". */
  subtitle?: string | null;
  data: CourseLeaderboardData | null;
  loading: boolean;
  error: boolean;
}

/** Branded, podium-style public leaderboard UI shared by the course + institute pages. */
export function PublicLeaderboardView({
  logoUrl,
  instituteName,
  subtitle,
  data,
  loading,
  error,
}: PublicLeaderboardViewProps) {
  const { t } = useTranslation("miscRoutesA");
  const entries = data?.entries ?? [];
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);
  const [selectedEntry, setSelectedEntry] = useState<LeaderboardEntry | null>(null);
  const openBadges = (entry?: LeaderboardEntry) => {
    if (entry && entry.badgeCount > 0) setSelectedEntry(entry);
  };

  return (
    <>
    <div className="flex min-h-screen w-full justify-center bg-gradient-to-b from-primary-50 via-background to-background px-4 py-8 sm:py-12">
      <div className="w-full max-w-xl">
        <div className="overflow-hidden rounded-2xl border border-primary-100 bg-card shadow-lg">
          {/* Branded gradient hero */}
          <div className="relative bg-gradient-to-br from-primary-500 to-primary-400 px-6 py-7 text-center text-white">
            <div className="mx-auto mb-3 flex items-center justify-center">
              {logoUrl ? (
                <div className="grid size-16 place-items-center rounded-2xl bg-white p-1.5 shadow-md">
                  <img src={logoUrl} alt="" className="size-full rounded-xl object-contain" />
                </div>
              ) : (
                <div className="grid size-16 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/30">
                  <Crown weight="fill" className="size-8 text-white" />
                </div>
              )}
            </div>
            {instituteName && (
              <p className="text-caption font-semibold uppercase tracking-wide text-white/80">
                {instituteName}
              </p>
            )}
            <h1 className="mt-1 text-h1 font-bold leading-tight">{t("leaderboard.title")}</h1>
            {subtitle && (
              <span className="mt-2 inline-flex max-w-full items-center truncate rounded-full bg-white/15 px-3 py-1 text-caption font-medium text-white ring-1 ring-white/20">
                {subtitle}
              </span>
            )}
          </div>

          {/* Body */}
          <div className="p-4 sm:p-6">
            {loading ? (
              <LoadingState />
            ) : error ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <Trophy weight="fill" className="size-9 text-neutral-300" />
                <p className="text-body font-medium text-foreground">
                  {t("leaderboard.error.title")}
                </p>
                <p className="text-caption text-muted-foreground">
                  {t("leaderboard.error.description")}
                </p>
              </div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <div className="grid size-14 place-items-center rounded-full bg-primary-50">
                  <Trophy weight="fill" className="size-7 text-primary-300" />
                </div>
                <p className="text-body font-semibold text-foreground">
                  {t("leaderboard.empty.title")}
                </p>
                <p className="max-w-xs text-caption text-muted-foreground">
                  {t("leaderboard.empty.description")}
                </p>
              </div>
            ) : (
              <>
                {/* Podium: 2 · 1 · 3 */}
                <div className="mb-5 flex items-end gap-2">
                  <PodiumSpot entry={top3[1]} place={2} onClick={() => openBadges(top3[1])} />
                  <PodiumSpot entry={top3[0]} place={1} onClick={() => openBadges(top3[0])} />
                  <PodiumSpot entry={top3[2]} place={3} onClick={() => openBadges(top3[2])} />
                </div>

                {rest.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {rest.map((entry, i) => (
                      <ListRow key={i} entry={entry} onClick={() => openBadges(entry)} />
                    ))}
                  </div>
                )}

                <p className="mt-5 text-center text-caption text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {data?.totalLearners ?? entries.length}
                  </span>{" "}
                  {t("leaderboard.footerSummary")}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 flex flex-col items-center gap-1 text-center">
          {data?.anonymized !== false && (
            <p className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
              <ShieldCheck weight="fill" className="size-3.5 text-neutral-400" />
              {t("leaderboard.namesAnonymized")}
            </p>
          )}
          {instituteName && (
            <p className="text-caption text-muted-foreground">
              {t("leaderboard.poweredBy", { instituteName })}
            </p>
          )}
        </div>
      </div>
    </div>
    <EntryBadgesDialog entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
    </>
  );
}
