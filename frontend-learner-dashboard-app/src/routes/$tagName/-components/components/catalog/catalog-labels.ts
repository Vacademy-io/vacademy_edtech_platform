import type { TFunction } from "i18next";
import type { CourseBadge } from "../../../-utils/course-badges";

/** Visitor-facing badge name (react-i18next chrome, follows the site language). */
export const badgeLabel = (t: TFunction, badge: CourseBadge): string => {
  switch (badge) {
    case "bestseller":
      return t("courseCatalog.badgeBestseller", "Bestseller");
    case "popular":
      return t("courseCatalog.badgePopular", "Popular");
    case "new":
      return t("courseCatalog.badgeNew", "New");
    case "free":
      return t("courseCatalog.badgeFree", "Free");
  }
};
