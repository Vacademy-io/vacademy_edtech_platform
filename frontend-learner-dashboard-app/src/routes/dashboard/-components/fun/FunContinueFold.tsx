import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import type { DashbaordResponse } from "../../-types/dashboard-data-types";
import { ChevronIcon } from "./fun-icons";

/**
 * The Continue Learning widget in the Fun skin. Its first lesson is the hero's
 * offer, so the list folds into one row that keeps the rest reachable through the
 * course list. Nothing to fold: nothing shown (the hero already speaks for the
 * first-run, caught-up and loading states). Saved widget settings are untouched.
 */
export function FunContinueFold({
  data,
  isLoading,
  heroOffersResume,
}: {
  data: DashbaordResponse | null;
  isLoading: boolean;
  heroOffersResume: boolean;
}) {
  const { t } = useTranslation("funHome");
  if (isLoading || !data?.slides?.length) return null;
  const others = data.slides.length - (heroOffersResume ? 1 : 0);
  if (others <= 0) return null;
  return (
    <Link to="/study-library/courses" className="fun-row fun-row--fold">
      <span className="fun-row__words">
        <span className="fun-row__title">
          {heroOffersResume ? t("fold.more", { count: others }) : t("fold.inProgress", { count: others })}
        </span>
      </span>
      <span className="fun-link fun-row__link">{t("fold.seeAll")}</span>
      <ChevronIcon className="fun-row__chevron" />
    </Link>
  );
}
