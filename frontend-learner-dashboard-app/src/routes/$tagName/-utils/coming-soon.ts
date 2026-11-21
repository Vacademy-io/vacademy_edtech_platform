/**
 * "Coming Soon" courses on the public catalogue.
 *
 * The admin switches a course to Coming Soon from the course page; the open
 * search (`/open/packages/v2/search`) and `course-init` then carry a
 * `coming_soon` object for it (null for every other course). While it is on,
 * cards show a ribbon and the enrol/buy CTA becomes "Notify me", which opens
 * the course's own audience form so interested visitors land as leads.
 */

export interface ComingSoonInfo {
  enabled: true;
  /** yyyy-MM-dd, display only. */
  launchDate?: string;
  ribbonText?: string;
  buttonText?: string;
  audienceId?: string;
}

/** Normalises the API's snake_case `coming_soon` (or null) into ComingSoonInfo. */
export const readComingSoon = (raw: unknown): ComingSoonInfo | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.enabled !== true) return null;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return {
    enabled: true,
    launchDate: text(r.launch_date),
    ribbonText: text(r.ribbon_text),
    buttonText: text(r.button_text),
    audienceId: text(r.audience_id),
  };
};

/**
 * "15 Nov 2026" for a future launch date; undefined when unset, unparseable or
 * already past (a stale date reads worse than none).
 */
export const formatLaunchDate = (
  launchDate: string | undefined,
  locale?: string,
): string | undefined => {
  if (!launchDate) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(launchDate);
  if (!m) return undefined;
  // Local midnight, not UTC — `new Date("2026-11-15")` is the 14th west of GMT.
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(date.getTime())) return undefined;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date < today) return undefined;
  try {
    return date.toLocaleDateString(locale || undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return date.toDateString();
  }
};

/**
 * Opens the course's notify form through the page shell's AudienceFormModal
 * (CourseCataloguePage / CourseSubPage listen for this event). Returns false
 * when there is no form to open, so the caller can fall back to the details page.
 */
export const openComingSoonForm = (info: ComingSoonInfo | null, title: string): boolean => {
  if (!info?.audienceId) return false;
  window.dispatchEvent(
    new CustomEvent("openAudienceForm", { detail: { audienceId: info.audienceId, title } }),
  );
  return true;
};
