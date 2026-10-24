import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Play, Sparkle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { usePlayTheme } from "@/hooks/use-play-theme";
import { listMyCompanions, type CompanionSummary } from "@/services/kb-companion-api";
import { accentAlpha, accentOf, companionKeys, masteryTone } from "@/routes/companion/-components/companion-utils";
import {
  CompanionAvatar,
  ProgressRingMini,
} from "@/routes/companion/-components/CompanionVisuals";

/**
 * "Your study companions" — one card per knowledge-base companion assigned to
 * the learner, with mastery and a Continue button into the study room.
 *
 * Renders nothing (no gap, no skeleton) while loading, on error, or when the
 * learner has no dashboard companions: most learners have none, and the home
 * page must look exactly as it did before for them.
 */
export function StudyCompanionsShelf() {
  const { t } = useTranslation("kbCompanion");
  const { data } = useQuery({
    queryKey: companionKeys.list,
    queryFn: listMyCompanions,
    staleTime: 60_000,
    retry: false,
  });

  const companions = (data ?? []).filter((c) => c.show_on_dashboard);
  if (companions.length === 0) return null;

  return (
    <section aria-labelledby="study-companions-heading" className="animate-fade-in-up space-y-3">
      <div className="flex items-center gap-2">
        <Sparkle className="size-5 text-primary-500" weight="fill" aria-hidden />
        <h2
          id="study-companions-heading"
          className="text-lg font-bold tracking-tight text-neutral-900 dark:text-neutral-50"
        >
          {t("shelf.title")}
        </h2>
      </div>
      <div
        className={cn(
          "flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2",
          "sm:grid sm:snap-none sm:overflow-visible sm:pb-0",
          companions.length > 1 ? "sm:grid-cols-2" : "sm:grid-cols-1",
        )}
      >
        {companions.map((companion) => (
          <CompanionShelfCard
            key={companion.id}
            companion={companion}
            single={companions.length === 1}
          />
        ))}
      </div>
    </section>
  );
}

function CompanionShelfCard({
  companion,
  single,
}: {
  companion: CompanionSummary;
  single: boolean;
}) {
  const { t } = useTranslation("kbCompanion");
  const navigate = useNavigate();
  const isPlay = usePlayTheme();
  const accent = accentOf(companion.accent_color);
  const { progress, resume } = companion;
  const total = progress.leaves_total;
  const allDone = total > 0 && progress.completed >= total;
  const started = progress.started > 0;

  const open = () =>
    navigate({ to: "/companion/$companionId", params: { companionId: companion.id } });

  const ctaLabel = allDone
    ? t("shelf.review")
    : resume?.title
      ? resume.reason === "continue"
        ? t("shelf.continueTopic", { title: resume.title })
        : started
          ? t("shelf.nextTopic", { title: resume.title })
          : t("shelf.startTopic", { title: resume.title })
      : t("shelf.start");

  return (
    <article
      className={cn(
        "group relative flex shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900",
        single ? "w-full" : "w-72 sm:w-auto",
      )}
    >
      {/* Accent wash: the companion's own colour, set by the admin. */}
      <div
        aria-hidden
        className={cn("absolute inset-x-0 top-0 h-20", !accent && "bg-app-gradient-x opacity-60")}
        style={
          accent
            ? { backgroundImage: `linear-gradient(135deg, ${accentAlpha(accent, "33")}, ${accentAlpha(accent, "08")})` }
            : undefined
        }
      />
      <button
        type="button"
        onClick={open}
        className="relative flex flex-1 flex-col gap-4 p-card text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2"
        aria-label={t("shelf.openAria", { name: companion.name })}
      >
        <div className="flex items-start gap-3">
          <CompanionAvatar emoji={companion.avatar_emoji} accent={companion.accent_color} size="lg" className="bg-white shadow-sm" />
          <div className="min-w-0 flex-1 pt-1">
            <h3 className="truncate text-base font-bold text-neutral-900 dark:text-neutral-50">
              {companion.name}
            </h3>
            <p className="truncate text-sm text-neutral-600 dark:text-neutral-400">{companion.kb_name}</p>
          </div>
          <ProgressRingMini
            percent={progress.mastery}
            size="md"
            tone={masteryTone(progress.mastery)}
            complete={allDone && progress.mastery >= 80}
          >
            <span className="text-xs font-bold tabular-nums text-neutral-800 dark:text-neutral-100">
              {progress.mastery}%
            </span>
          </ProgressRingMini>
        </div>

        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {total > 0
            ? t("shelf.stats", { done: progress.completed, total, mastery: progress.mastery })
            : t("shelf.statsEmpty")}
        </p>

        <span
          className={cn(
            "mt-auto inline-flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-semibold transition-transform active:translate-y-0.5",
            isPlay
              ? "rounded-play-btn bg-play-success font-black uppercase tracking-wide text-white shadow-play-2d-success"
              : "rounded-xl bg-primary-500 text-primary-foreground shadow-sm group-hover:shadow",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Play weight="fill" className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{ctaLabel}</span>
          </span>
          <ArrowRight
            weight="bold"
            className="size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-1 rtl:rotate-180"
            aria-hidden
          />
        </span>
      </button>
    </article>
  );
}
