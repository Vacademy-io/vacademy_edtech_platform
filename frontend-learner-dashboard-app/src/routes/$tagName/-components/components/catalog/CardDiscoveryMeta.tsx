import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { CourseBadge } from "../../../-utils/course-badges";
import type { CourseLanguageOption } from "../../../-utils/course-variants";
import { badgeLabel } from "./catalog-labels";

const BADGE_CLASS: Record<CourseBadge, string> = {
  bestseller: "catalogue-badge-warning",
  popular: "catalogue-badge-primary",
  new: "border-info-200 bg-info-50 text-info-600",
  free: "catalogue-badge-success",
};

/** Bestseller / Popular / New / Free pills on a course card. */
export const CourseBadgePills: React.FC<{ badges: CourseBadge[] | undefined; className?: string }> = ({
  badges,
  className,
}) => {
  const { t } = useTranslation("coursePlayerB");
  if (!badges?.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {badges.map((badge) => (
        <span key={badge} className={cn("catalogue-badge rounded-catalogue-full font-semibold", BADGE_CLASS[badge])}>
          {badgeLabel(t, badge)}
        </span>
      ))}
    </div>
  );
};

/** EN / हिं chips: the languages a grouped course card is available in. */
export const LanguageChips: React.FC<{
  languages: CourseLanguageOption[];
  translate: (s: string) => string;
  className?: string;
}> = ({ languages, translate, className }) => {
  const { t } = useTranslation("coursePlayerB");
  if (!languages.length) return null;
  const names = languages.map((l) => translate(l.label || l.code)).join(", ");
  return (
    <div
      className={cn("flex flex-wrap items-center gap-1", className)}
      aria-label={t("courseCatalog.availableIn", { languages: names, defaultValue: "Available in {{languages}}" })}
      role="note"
    >
      {languages.map((l) => (
        <span
          key={l.code}
          aria-hidden="true"
          className="rounded-catalogue-sm border border-catalogue-border px-1.5 py-0.5 text-3xs font-semibold leading-none text-catalogue-text-secondary"
        >
          {l.chip || l.label || l.code.toUpperCase()}
        </span>
      ))}
    </div>
  );
};
