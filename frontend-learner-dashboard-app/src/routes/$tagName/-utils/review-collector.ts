import type { ApprovedReview } from "../-services/review-service";

/**
 * Settings of the `reviewCollector` block (how a site asks visitors for a
 * review) and of a testimonials section that shows approved reviews.
 * Everything here is pure, so the block and its tests share one reading of
 * the stored props.
 */

/**
 * floatingPopup  a launcher button that stays, and the form also opens by itself once
 * floating       the launcher only: the form opens when the visitor clicks it
 * popup          the form opens by itself (delay / scroll / exit), no launcher
 * inline         the form sits in the page like any other section
 */
export const REVIEW_DISPLAYS = ["floatingPopup", "floating", "popup", "inline"] as const;
export type ReviewDisplay = (typeof REVIEW_DISPLAYS)[number];

/** Where the launcher (and the corner card) sits. */
export const REVIEW_POSITIONS = ["bottom-right", "bottom-left", "middle-right", "middle-left"] as const;
export type ReviewPosition = (typeof REVIEW_POSITIONS)[number];

/** pill = icon + label, icon = round star button, tab = vertical tab on the screen edge. */
export const REVIEW_BUTTON_STYLES = ["pill", "icon", "tab"] as const;
export type ReviewButtonStyle = (typeof REVIEW_BUTTON_STYLES)[number];

/** modal = centred dialog that dims the page, corner = card at the launcher's side. */
export const REVIEW_POPUP_STYLES = ["modal", "corner"] as const;
export type ReviewPopupStyle = (typeof REVIEW_POPUP_STYLES)[number];

export type ReviewFieldMode = "off" | "optional" | "required";
const FIELD_MODES: readonly ReviewFieldMode[] = ["off", "optional", "required"];

/** The fields besides stars and name (those two are always asked and required). */
export interface ReviewFields {
  reviewText: ReviewFieldMode;
  city: ReviewFieldMode;
  course: ReviewFieldMode;
  designation: ReviewFieldMode;
}

export const DEFAULT_REVIEW_FIELDS: ReviewFields = {
  reviewText: "optional",
  city: "optional",
  course: "optional",
  designation: "optional",
};

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

export const normalizeDisplay = (v: unknown): ReviewDisplay => pick(v, REVIEW_DISPLAYS, "floatingPopup");
export const normalizePosition = (v: unknown): ReviewPosition => pick(v, REVIEW_POSITIONS, "bottom-right");
export const normalizeButtonStyle = (v: unknown): ReviewButtonStyle => pick(v, REVIEW_BUTTON_STYLES, "pill");
export const normalizePopupStyle = (v: unknown): ReviewPopupStyle => pick(v, REVIEW_POPUP_STYLES, "modal");

export const normalizeFields = (v: unknown): ReviewFields => {
  const raw = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    reviewText: pick(raw.reviewText, FIELD_MODES, DEFAULT_REVIEW_FIELDS.reviewText),
    city: pick(raw.city, FIELD_MODES, DEFAULT_REVIEW_FIELDS.city),
    course: pick(raw.course, FIELD_MODES, DEFAULT_REVIEW_FIELDS.course),
    designation: pick(raw.designation, FIELD_MODES, DEFAULT_REVIEW_FIELDS.designation),
  };
};

/** Non-empty, trimmed, de-duplicated course names for the course dropdown. */
export const normalizeCourseOptions = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  v.forEach((x) => {
    const s = typeof x === "string" ? x.trim() : "";
    if (s && !out.includes(s)) out.push(s);
  });
  return out;
};

export const showsLauncher = (d: ReviewDisplay): boolean => d === "floating" || d === "floatingPopup";
export const opensByItself = (d: ReviewDisplay): boolean => d === "popup" || d === "floatingPopup";

/* ── the form ────────────────────────────────────────────────────────── */

export interface ReviewValues {
  rating: number;
  reviewerName: string;
  reviewText: string;
  city: string;
  courseName: string;
  designation: string;
}

export const EMPTY_REVIEW: ReviewValues = {
  rating: 0,
  reviewerName: "",
  reviewText: "",
  city: "",
  courseName: "",
  designation: "",
};

export type ReviewErrorKey = "rating" | "reviewerName" | "reviewText" | "city" | "courseName" | "designation";
/** Same limits the server applies. */
export const REVIEW_TEXT_MAX = 2000;
export const REVIEW_NAME_MAX = 120;

/** Field → i18n error code; empty when the review can be sent. */
export const validateReview = (
  v: ReviewValues,
  fields: ReviewFields
): Partial<Record<ReviewErrorKey, "required" | "tooLong">> => {
  const errors: Partial<Record<ReviewErrorKey, "required" | "tooLong">> = {};
  if (!(v.rating >= 1 && v.rating <= 5)) errors.rating = "required";
  if (!v.reviewerName.trim()) errors.reviewerName = "required";
  else if (v.reviewerName.trim().length > REVIEW_NAME_MAX) errors.reviewerName = "tooLong";
  if (fields.reviewText === "required" && !v.reviewText.trim()) errors.reviewText = "required";
  if (fields.reviewText !== "off" && v.reviewText.trim().length > REVIEW_TEXT_MAX) errors.reviewText = "tooLong";
  if (fields.city === "required" && !v.city.trim()) errors.city = "required";
  if (fields.course === "required" && !v.courseName.trim()) errors.courseName = "required";
  if (fields.designation === "required" && !v.designation.trim()) errors.designation = "required";
  return errors;
};

/** Only the asked fields go to the server; a hidden field never sends a stale value. */
export const reviewPayload = (v: ReviewValues, fields: ReviewFields) => ({
  rating: v.rating,
  reviewerName: v.reviewerName.trim(),
  reviewText: fields.reviewText === "off" ? undefined : v.reviewText.trim() || undefined,
  city: fields.city === "off" ? undefined : v.city.trim() || undefined,
  courseName: fields.course === "off" ? undefined : v.courseName.trim() || undefined,
  designation: fields.designation === "off" ? undefined : v.designation.trim() || undefined,
});

/* ── once a visitor has reviewed ─────────────────────────────────────── */

const submittedKey = (instituteId: string) => `catalogue-review-submitted:${instituteId}`;

export const hasSubmittedReview = (instituteId: string): boolean => {
  try {
    return window.localStorage.getItem(submittedKey(instituteId)) === "1";
  } catch {
    return false;
  }
};

export const markReviewSubmitted = (instituteId: string): void => {
  try {
    window.localStorage.setItem(submittedKey(instituteId), "1");
  } catch {
    // Private mode: the popup may ask again on the next visit, nothing worse.
  }
};

/* ── testimonials ────────────────────────────────────────────────────── */

/** manual = the hand-written quotes only (every section saved before reviews existed). */
export const TESTIMONIAL_SOURCES = ["manual", "reviews", "both"] as const;
export type TestimonialSource = (typeof TESTIMONIAL_SOURCES)[number];
export const normalizeTestimonialSource = (v: unknown): TestimonialSource => pick(v, TESTIMONIAL_SOURCES, "manual");

export interface ReviewTestimonial {
  name: string;
  role: string;
  feedback: string;
  avatar: string;
  rating?: number;
}

/** "Designation · Course · City", whichever the reviewer gave. */
export const reviewRoleLine = (r: Pick<ApprovedReview, "designation" | "course_name" | "city">): string =>
  [r.designation, r.course_name, r.city].map((x) => (x || "").trim()).filter(Boolean).join(" · ");

export const reviewToTestimonial = (r: ApprovedReview): ReviewTestimonial => ({
  name: r.reviewer_name,
  role: reviewRoleLine(r),
  feedback: (r.review_text || "").trim(),
  avatar: "",
  rating: r.rating,
});

/**
 * What a testimonials section shows: its own quotes, approved reviews, or the
 * quotes first and then the reviews. A review without text still shows (its
 * stars and name are the testimonial).
 */
export const mergeTestimonials = <T>(manual: T[], reviews: ReviewTestimonial[], source: TestimonialSource): (T | ReviewTestimonial)[] => {
  if (source === "manual") return manual;
  if (source === "reviews") return reviews;
  return [...manual, ...reviews];
};
