import type { NoticeConfig, ShelfCourse } from "@/types/learner-home";

/** "Free", a formatted price, or null when no chip applies. */
export function priceLabel(
  course: Pick<ShelfCourse, "price" | "currency" | "is_free">,
  locale: string | undefined,
  freeLabel: string
): string | null {
  if (course.is_free || course.price === 0) return freeLabel;
  if (course.price == null || !Number.isFinite(course.price)) return null;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: course.currency || "INR",
      maximumFractionDigits: course.price % 1 === 0 ? 0 : 2,
    }).format(course.price);
  } catch {
    return `${course.currency ?? ""} ${course.price}`.trim();
  }
}

/**
 * The plain notice (no image, no acknowledgement, neutral, not dismissible) is
 * today's custom card, drawn by the same component, so an imported card looks
 * exactly as it did (spec 7.4.4, section 11).
 */
export const isPlainNotice = (c: NoticeConfig): boolean =>
  !c.image?.url && !c.require_ack && (c.tone ?? "NEUTRAL") === "NEUTRAL" && !c.dismissible;
