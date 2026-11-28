import React, { useEffect, useState } from "react";
import { Trophy, Medal, Crown, CaretRight, Copy, ShareNetwork } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { BadgeVisual } from "@/routes/dashboard/-components/badge-icons";
import {
  fetchCourseLeaderboard,
  type CourseLeaderboardData,
  type LeaderboardEntry,
} from "@/services/course-leaderboard";
import { getBadgesEnabled } from "@/services/badge-config";
import { usePlayGamificationStore } from "@/stores/play-gamification-store";
import { getCachedGamification } from "@/services/play-gamification";
import { isLibraryToken } from "@/services/badge-library";
import { getInstituteId } from "@/constants/helper";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";

/**
 * Course leaderboard as a trigger + dialog. Ranked by learning activity, names
 * anonymized (initials, own row "You"), showing each learner's badges. Rendered
 * as a full-width "card" trigger (course discussion) or a "compact" icon button
 * (chat header). Standard design tokens (not Play).
 */

const MEDAL_TONE: Record<number, string> = {
  1: "text-warning-500",
  2: "text-neutral-400",
  3: "text-warning-700",
};

function RankCell({ rank }: { rank: number | null }) {
  if (rank != null && rank >= 1 && rank <= 3) {
    return <Medal weight="fill" className={cn("h-5 w-5", MEDAL_TONE[rank])} />;
  }
  return (
    <span className="w-5 text-center text-caption font-bold text-muted-foreground">
      {rank ?? "–"}
    </span>
  );
}

function BadgeIcons({ entry }: { entry: LeaderboardEntry }) {
  const shown = entry.badges?.slice(0, 3) ?? [];
  if (entry.badgeCount <= 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5">
      {shown.map((b, i) => (
        <span key={i} title={b.name} className="inline-flex">
          <BadgeVisual icon={b.icon} size={14} className="text-warning-600" />
        </span>
      ))}
      {entry.badgeCount > shown.length && (
        <span className="text-3xs font-semibold text-warning-600">
          +{entry.badgeCount - shown.length}
        </span>
      )}
    </span>
  );
}

function Row({ entry, onClick }: { entry: LeaderboardEntry; onClick?: () => void }) {
  const { t } = useTranslation("courseDetailsA");
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
      title={clickable ? t("leaderboard.row.viewBadgesTitle") : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2",
        entry.currentUser && "bg-primary-50 ring-1 ring-primary-200",
        clickable && "cursor-pointer hover:bg-neutral-50"
      )}
    >
      <div className="flex w-6 shrink-0 justify-center">
        <RankCell rank={entry.rank} />
      </div>
      <span
        className={cn(
          "flex-1 truncate text-body",
          entry.currentUser
            ? "font-bold text-primary-600"
            : "font-medium text-neutral-700"
        )}
      >
        {entry.name}
      </span>
      <BadgeIcons entry={entry} />
      <span className="w-16 text-end text-caption font-semibold tabular-nums text-neutral-600">
        {entry.points} pts
      </span>
      {clickable && <CaretRight className="h-3.5 w-3.5 shrink-0 text-neutral-300" />}
    </div>
  );
}

/** A single badge shown at a readable size — art (library) or icon, with its name. */
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
          fill
          size={isLib ? 88 : 44}
          className={isLib ? undefined : "text-primary-500"}
        />
      </span>
      <span className="w-full text-center text-caption font-medium leading-tight text-neutral-600">
        {badge.name}
      </span>
    </div>
  );
}

/** Popup: a learner's earned badges shown at full size (opened by clicking a row). */
function EntryBadgesDialog({
  entry,
  onClose,
}: {
  entry: LeaderboardEntry | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("courseDetailsA");
  return (
    <Dialog open={Boolean(entry)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy weight="fill" className="h-5 w-5 text-warning-500" />
            {entry?.currentUser
              ? t("leaderboard.badgesDialog.yourBadges")
              : t("leaderboard.badgesDialog.othersBadges", {
                  name: entry?.name ?? t("leaderboard.badgesDialog.defaultName"),
                })}
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
            {t("leaderboard.badgesDialog.empty")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function YourStanding({ me, onOpenBadges }: { me: LeaderboardEntry; onOpenBadges?: () => void }) {
  const { t } = useTranslation("courseDetailsA");
  const clickable = Boolean(onOpenBadges) && me.badgeCount > 0;
  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onOpenBadges : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenBadges?.();
              }
            }
          : undefined
      }
      title={clickable ? t("leaderboard.standing.viewYourBadgesTitle") : undefined}
      className={cn(
        "mb-3 rounded-xl bg-primary-50 p-3 ring-1 ring-primary-200",
        clickable && "cursor-pointer transition-shadow hover:ring-primary-300"
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-caption font-semibold uppercase tracking-wide text-primary-600">
            {t("leaderboard.standing.label")}
          </p>
          <p className="text-h3 font-bold text-primary-600">
            {me.rank != null ? `#${me.rank}` : t("leaderboard.standing.unranked")}
          </p>
        </div>
        <div className="text-end">
          <div className="flex items-center justify-end gap-1">
            <Trophy weight="fill" className="h-4 w-4 text-warning-600" />
            <span className="text-body font-bold text-neutral-700">
              {me.badgeCount}
            </span>
          </div>
          <p className="text-caption text-neutral-500">
            {t("leaderboard.standing.badgesEarned", { count: me.badgeCount })}
          </p>
        </div>
      </div>
      {me.badges?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {me.badges.map((b, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-caption text-neutral-600 ring-1 ring-primary-100"
              title={b.name}
            >
              <BadgeVisual icon={b.icon} size={14} className="text-primary-500" />
              {b.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export const CourseLeaderboard: React.FC<{
  packageSessionId: string;
  variant?: "card" | "compact";
}> = ({ packageSessionId, variant = "card" }) => {
  const { t } = useTranslation("courseDetailsA");
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CourseLeaderboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // null = unknown yet; gates the whole leaderboard on the badges master toggle.
  const [enabled, setEnabled] = useState<boolean | null>(null);

  // The learner's OWN badges are auto-unlocked client-side and never persisted, so the
  // server leaderboard counts only manually-awarded badges. Merge the client's unlocked
  // set into the caller's own row so "You" reflects the badges they actually see.
  const storeData = usePlayGamificationStore((s) => s.data);
  const [myBadges, setMyBadges] = useState<{ name: string; icon: string }[]>([]);
  // Row clicked to inspect that learner's badges at full size.
  const [selectedEntry, setSelectedEntry] = useState<LeaderboardEntry | null>(null);

  useEffect(() => {
    let active = true;
    const apply = (gd: { badges?: { unlocked: boolean; name: string; icon: string }[] } | null) => {
      const unlocked = (gd?.badges ?? []).filter((b) => b.unlocked);
      if (active) setMyBadges(unlocked.map((b) => ({ name: b.name, icon: b.icon })));
    };
    if (storeData) {
      apply(storeData);
      return () => {
        active = false;
      };
    }
    getInstituteId().then((id) => {
      if (id && active) apply(getCachedGamification(id));
    });
    return () => {
      active = false;
    };
  }, [storeData]);

  useEffect(() => {
    let active = true;
    getBadgesEnabled().then((e) => {
      if (active) setEnabled(e);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setLoaded(false);
    setData(null);
  }, [packageSessionId]);

  // Card variant shows a rank teaser, so load eagerly; compact loads on open.
  const needData = enabled === true && (variant === "card" || open);
  useEffect(() => {
    if (!needData || loaded || !packageSessionId) return;
    let active = true;
    setLoading(true);
    fetchCourseLeaderboard(packageSessionId).then((d) => {
      if (!active) return;
      setData(d);
      setLoading(false);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [needData, loaded, packageSessionId]);

  // Institute disabled the badges + leaderboard feature → render nothing.
  if (enabled === false) return null;

  // Overlay the caller's real (client-computed) badges onto their own row only.
  const mergeMine = (entry: LeaderboardEntry): LeaderboardEntry =>
    entry.currentUser && myBadges.length > entry.badgeCount
      ? { ...entry, badgeCount: myBadges.length, badges: myBadges }
      : entry;
  const me = data?.currentUser ? mergeMine(data.currentUser) : null;
  const entries = (data?.entries ?? []).map(mergeMine);
  const openBadgesOf = (entry: LeaderboardEntry) =>
    entry.badgeCount > 0 ? setSelectedEntry(entry) : undefined;

  // Public, white-labelled shareable URL (origin IS the institute's white-label host).
  const shareUrl = `${window.location.origin}/leaderboard/${packageSessionId}`;
  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    toast.success(t("leaderboard.toast.linkCopied"));
  };
  const handleShare = () => {
    if (navigator.share) {
      navigator
        .share({ title: t("leaderboard.dialog.title", { course }), url: shareUrl })
        .catch(() => {});
    } else {
      handleCopy();
    }
  };

  const trigger =
    variant === "compact" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("leaderboard.trigger.compactAriaLabel", { course })}
        title={t("leaderboard.trigger.compactTitle")}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-50 text-primary-500 transition-colors hover:bg-primary-100"
      >
        <Crown weight="fill" className="h-5 w-5" />
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-card p-3 text-start transition-colors hover:bg-neutral-50"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50">
          <Crown weight="fill" className="h-5 w-5 text-warning-500" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-neutral-700">
            {t("leaderboard.trigger.cardTitle")}
          </p>
          <p className="truncate text-caption text-muted-foreground">
            {me
              ? t("leaderboard.trigger.cardSubtitleRanked", {
                  rank: me.rank != null ? `#${me.rank}` : t("leaderboard.trigger.unranked"),
                  count: me.badgeCount,
                })
              : t("leaderboard.trigger.cardSubtitleDefault", { course })}
          </p>
        </div>
        <CaretRight className="h-4 w-4 shrink-0 text-neutral-400" />
      </button>
    );

  return (
    <>
      {trigger}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2 pe-7">
              <DialogTitle className="flex items-center gap-2">
                <Crown weight="fill" className="h-5 w-5 text-warning-500" />
                {t("leaderboard.dialog.title", { course })}
              </DialogTitle>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleCopy}
                  title={t("leaderboard.dialog.copyLinkTitle")}
                  aria-label={t("leaderboard.dialog.copyLinkTitle")}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Copy className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={handleShare}
                  title={t("leaderboard.dialog.shareTitle")}
                  aria-label={t("leaderboard.dialog.shareAriaLabel")}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-primary-500 transition-colors hover:bg-primary-50"
                >
                  <ShareNetwork className="h-4 w-4" />
                </button>
              </div>
            </div>
          </DialogHeader>

          {loading && !data ? (
            <p className="py-6 text-center text-caption text-muted-foreground">
              {t("leaderboard.dialog.loading")}
            </p>
          ) : !data || data.entries.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <Trophy weight="fill" className="h-7 w-7 text-neutral-300" />
              <p className="text-caption text-muted-foreground">
                {t("leaderboard.dialog.emptyText")}
              </p>
            </div>
          ) : (
            <div>
              {me && (
                <YourStanding me={me} onOpenBadges={() => setSelectedEntry(me)} />
              )}
              <div className="mb-2 flex items-center justify-between">
                <span className="text-caption font-semibold text-neutral-500">
                  {t("leaderboard.dialog.rankingLabel")}
                </span>
                <span className="text-caption text-muted-foreground">
                  {t("leaderboard.dialog.learnersCount", {
                    count: data.totalLearners,
                    learners: getTerminologyPlural(
                      RoleTerms.Learner,
                      SystemTerms.Learner,
                    ).toLocaleLowerCase(),
                  })}
                </span>
              </div>
              <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
                {entries.map((entry, i) => (
                  <Row key={i} entry={entry} onClick={() => openBadgesOf(entry)} />
                ))}
              </div>
              <p className="mt-3 text-center text-caption text-muted-foreground">
                {t("leaderboard.dialog.footer")}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <EntryBadgesDialog entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
    </>
  );
};
