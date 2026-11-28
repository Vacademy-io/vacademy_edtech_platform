import type { HeaderNavChild } from "../../../-types/course-catalogue-types";

/** Does any link in a header dropdown point at the current page? */
export const dropdownHasActive = (items: HeaderNavChild[] | undefined, isActive: (route: string) => boolean): boolean =>
  (Array.isArray(items) ? items : []).some(
    (c) => !!c && c.enabled !== false && (((c.route || "").trim() && isActive(c.route!)) || dropdownHasActive(c.children, isActive)),
  );
