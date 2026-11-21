import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { firstGrapheme } from "@/components/design-system/fun/CourseArt";
import { FinishedTick } from "@/components/design-system/fun/FinishedTick";
import { FunProgress } from "@/components/design-system/fun/FunProgress";
import { courseColourClass } from "@/components/design-system/fun/course-palette";
import { useHideProgress } from "@/hooks/use-hide-progress";
import { listMyCompanions, type CompanionSummary } from "@/services/kb-companion-api";
import { companionKeys } from "@/routes/companion/-components/companion-utils";
import { companionCta, companionFinished, homeCompanions } from "./companions";
import { PlayIcon } from "./fun-icons";

/**
 * "Your study companions" on the Fun home: the classic shelf's companions, words and
 * actions (the same query, the same "Continue: <topic>" button, the same study room),
 * drawn as Fun tiles. A companion has no course, so its colour comes from its own id
 * through the course palette rule (FNV-1a % 8), the same on every device.
 *
 * Draws nothing while loading, on error or when the learner has none, as the classic
 * shelf does. With progress hidden, the mastery bar and figures stay off.
 */
export function FunCompanionsShelf() {
  const { t } = useTranslation("kbCompanion");
  const { data } = useQuery({
    queryKey: companionKeys.list,
    queryFn: listMyCompanions,
    staleTime: 60_000,
    retry: false,
  });
  const companions = homeCompanions(data);
  if (companions.length === 0) return null;

  return (
    <section aria-labelledby="fun-companions-title" className={cn("fun-companions", companions.length === 1 && "fun-companions--single")}>
      <h2 id="fun-companions-title" className="fun-section-title">
        {t("shelf.title")}
      </h2>
      <ul className="fun-companions__list">
        {companions.map((companion) => (
          <li key={companion.id} className="fun-companions__item">
            <FunCompanionTile companion={companion} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function FunCompanionTile({ companion }: { companion: CompanionSummary }) {
  const { t } = useTranslation("kbCompanion");
  const navigate = useNavigate();
  const hideProgress = useHideProgress();
  const { progress } = companion;
  const finished = companionFinished(companion);
  const cta = companionCta(companion);
  const ctaLabel = cta.title ? t(cta.key, { title: cta.title }) : t(cta.key);
  const showProgress = hideProgress === false && progress.leaves_total > 0;
  const mark = companion.avatar_emoji?.trim() || firstGrapheme(companion.name);

  return (
    <button
      type="button"
      className={cn("fun-companion", courseColourClass(companion.id))}
      onClick={() => navigate({ to: "/companion/$companionId", params: { companionId: companion.id } })}
      aria-label={t("shelf.openAria", { name: companion.name })}
    >
      <span className="fun-course-art fun-companion__art" aria-hidden="true">
        <span className="fun-course-art__deco" />
        <span className="fun-course-art__mark">{mark}</span>
        {finished && hideProgress === false ? <FinishedTick decorative /> : null}
      </span>
      <span className="fun-companion__body">
        <span className="fun-companion__name fun-clamp-2">
          <bdi>{companion.name}</bdi>
        </span>
        {companion.kb_name ? (
          <span className="fun-companion__kb">
            <bdi>{companion.kb_name}</bdi>
          </span>
        ) : null}
        {showProgress ? (
          <span className="fun-companion__progress">
            <FunProgress percent={progress.mastery} label={companion.name} className="fun-companion__bar" />
            <span className="fun-companion__stats">
              {t("shelf.stats", { done: progress.completed, total: progress.leaves_total, mastery: progress.mastery })}
            </span>
          </span>
        ) : progress.leaves_total === 0 ? (
          <span className="fun-companion__stats">{t("shelf.statsEmpty")}</span>
        ) : null}
        <span className="fun-btn fun-btn--compact fun-companion__cta">
          <PlayIcon />
          <span className="fun-companion__cta-label">{ctaLabel}</span>
        </span>
      </span>
    </button>
  );
}
