import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import type { DashbaordResponse } from "../../-types/dashboard-data-types";
import { ChevronIcon } from "./fun-icons";
import { foldCount } from "./home-state";

/**
 * The Continue Learning widget in the Fun skin. The hero offers one lesson, so the
 * list folds into one row for the others, reachable through the course list. The
 * hero's lesson is left out of the count only when the list has it (a lesson resumed
 * from this device may not be listed). Nothing to fold: nothing shown (the hero
 * already speaks for the first-run, caught-up and loading states). Saved widget
 * settings are untouched.
 */
export function FunContinueFold({
  data,
  isLoading,
  heroSlideId,
}: {
  data: DashbaordResponse | null;
  isLoading: boolean;
  /** The lesson the hero offers, or null when it offers none. */
  heroSlideId: string | null;
}) {
  const { t } = useTranslation("funHome");
  if (isLoading || !data?.slides?.length) return null;
  const others = foldCount(
    data.slides.map((slide) => slide.slide_id),
    heroSlideId,
  );
  if (others <= 0) return null;
  return (
    <Link to="/study-library/courses" className="fun-row fun-row--fold">
      <span className="fun-row__words">
        <span className="fun-row__title">
          {heroSlideId ? t("fold.more", { count: others }) : t("fold.inProgress", { count: others })}
        </span>
      </span>
      <span className="fun-link fun-row__link">{t("fold.seeAll")}</span>
      <ChevronIcon className="fun-row__chevron" />
    </Link>
  );
}
