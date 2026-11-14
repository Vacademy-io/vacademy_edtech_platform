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

/* ── the form: an ordered list of fields ────────────────────────────── */

/**
 * Built-in fields fill the review's own columns (the testimonials section
 * reads them); each appears at most once. Stars and name are always on the
 * form and always required. Custom fields are the admin's own questions; their
 * answers are stored with the review as {key, label, value}.
 */
export const BUILTIN_FIELD_KINDS = ["rating", "reviewerName", "reviewText", "courseName", "city", "designation"] as const;
export const CUSTOM_FIELD_KINDS = ["text", "textarea", "select", "number", "email", "phone"] as const;
export type BuiltinFieldKind = (typeof BUILTIN_FIELD_KINDS)[number];
export type CustomFieldKind = (typeof CUSTOM_FIELD_KINDS)[number];
export type ReviewFieldKind = BuiltinFieldKind | CustomFieldKind;
/** Always on the form, always required: a review needs stars and a name to be a testimonial. */
export const LOCKED_FIELD_KINDS: readonly ReviewFieldKind[] = ["rating", "reviewerName"];
export const MAX_CUSTOM_FIELDS = 10;

export interface ReviewField {
  /** Built-ins use their kind as id; custom fields a generated key. */
  id: string;
  kind: ReviewFieldKind;
  /** '' = the built-in wording in the visitor's language. */
  label?: string;
  placeholder?: string;
  required?: boolean;
  /** Dropdown choices (select, and courseName when given). */
  options?: string[];
  /** half = shares a row with the next half-width field on wider screens. */
  width?: "full" | "half";
}

const isBuiltin = (k: ReviewFieldKind): k is BuiltinFieldKind => (BUILTIN_FIELD_KINDS as readonly string[]).includes(k);
const isKind = (k: unknown): k is ReviewFieldKind =>
  typeof k === "string" && ((BUILTIN_FIELD_KINDS as readonly string[]).includes(k) || (CUSTOM_FIELD_KINDS as readonly string[]).includes(k));
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Same limits the server applies to the built-in columns; custom answers are capped at 1000. */
export const REVIEW_TEXT_MAX = 2000;
export const REVIEW_NAME_MAX = 120;
export const fieldMaxLength = (kind: ReviewFieldKind): number =>
  kind === "reviewerName" || kind === "city" ? 120 : kind === "reviewText" ? REVIEW_TEXT_MAX : kind === "textarea" ? 1000 : 255;

/** A form saved before formFields existed: the old per-field modes and labels, in the old order. */
const legacyFields = (props: Record<string, unknown>): ReviewField[] => {
  const modes = normalizeFields(props.fields);
  const options = normalizeCourseOptions(props.courseOptions);
  const out: ReviewField[] = [
    { id: "rating", kind: "rating", required: true },
  ];
  if (modes.reviewText !== "off")
    out.push({ id: "reviewText", kind: "reviewText", label: str(props.textLabel), placeholder: str(props.textPlaceholder), required: modes.reviewText === "required" });
  out.push({ id: "reviewerName", kind: "reviewerName", label: str(props.nameLabel), required: true });
  const pair = modes.course !== "off" && modes.city !== "off";
  if (modes.course !== "off")
    out.push({ id: "courseName", kind: "courseName", label: str(props.courseLabel), required: modes.course === "required", options, width: pair ? "half" : "full" });
  if (modes.city !== "off")
    out.push({ id: "city", kind: "city", label: str(props.cityLabel), required: modes.city === "required", width: pair ? "half" : "full" });
  if (modes.designation !== "off")
    out.push({ id: "designation", kind: "designation", label: str(props.designationLabel), required: modes.designation === "required" });
  return out;
};

/**
 * The fields a block asks, in order. `formFields` when the block has them
 * (cleaned: unknown kinds dropped, built-ins once, custom fields capped,
 * stars and name forced in and required), else the older per-field settings.
 */
export const normalizeFormFields = (props: Record<string, unknown>): ReviewField[] => {
  const raw = props.formFields;
  if (!Array.isArray(raw) || raw.length === 0) return legacyFields(props);
  const out: ReviewField[] = [];
  const ids = new Set<string>();
  let custom = 0;
  raw.forEach((r, i) => {
    if (!r || typeof r !== "object") return;
    const f = r as Record<string, unknown>;
    if (!isKind(f.kind)) return;
    const kind = f.kind;
    let id = isBuiltin(kind) ? kind : str(f.id).trim() || `f_${i}`;
    if (isBuiltin(kind) && ids.has(id)) return;
    if (!isBuiltin(kind)) {
      if (custom >= MAX_CUSTOM_FIELDS) return;
      while (ids.has(id)) id = `${id}_`;
      custom += 1;
    }
    ids.add(id);
    out.push({
      id,
      kind,
      label: str(f.label),
      placeholder: str(f.placeholder),
      required: LOCKED_FIELD_KINDS.includes(kind) ? true : f.required === true,
      options: kind === "select" || kind === "courseName" ? normalizeCourseOptions(f.options) : undefined,
      width: f.width === "half" && kind !== "rating" && kind !== "reviewText" && kind !== "textarea" ? "half" : "full",
    });
  });
  if (!ids.has("reviewerName")) out.unshift({ id: "reviewerName", kind: "reviewerName", required: true, width: "full" });
  if (!ids.has("rating")) out.unshift({ id: "rating", kind: "rating", required: true, width: "full" });
  return out;
};

export type ReviewFormValues = Record<string, string | number>;
export type ReviewFieldError = "required" | "tooLong" | "invalidEmail" | "invalidNumber" | "invalidPhone";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ()-]{7,20}$/;

/** Field id → error code; empty when the review can be sent. */
export const validateReviewForm = (fields: ReviewField[], values: ReviewFormValues): Record<string, ReviewFieldError> => {
  const errors: Record<string, ReviewFieldError> = {};
  fields.forEach((f) => {
    if (f.kind === "rating") {
      const n = Number(values[f.id]);
      if (!(n >= 1 && n <= 5)) errors[f.id] = "required";
      return;
    }
    const v = String(values[f.id] ?? "").trim();
    if (!v) {
      if (f.required) errors[f.id] = "required";
      return;
    }
    if (v.length > fieldMaxLength(f.kind)) errors[f.id] = "tooLong";
    else if (f.kind === "email" && !EMAIL.test(v)) errors[f.id] = "invalidEmail";
    else if (f.kind === "number" && Number.isNaN(Number(v))) errors[f.id] = "invalidNumber";
    else if (f.kind === "phone" && !PHONE.test(v)) errors[f.id] = "invalidPhone";
  });
  return errors;
};

export interface ReviewSubmissionParts {
  rating: number;
  reviewerName: string;
  reviewText?: string;
  courseName?: string;
  city?: string;
  designation?: string;
  answers?: { key: string; label: string; value: string }[];
}

/**
 * What goes to the server: built-in fields to their columns, custom ones as
 * answers with the label the visitor saw (`labelOf` resolves the default
 * wording). Only fields on the form are sent; blanks are left out.
 */
export const buildReviewSubmission = (
  fields: ReviewField[],
  values: ReviewFormValues,
  labelOf: (f: ReviewField) => string
): ReviewSubmissionParts => {
  const text = (id: string) => String(values[id] ?? "").trim() || undefined;
  const out: ReviewSubmissionParts = { rating: Number(values.rating) || 0, reviewerName: text("reviewerName") || "" };
  const answers: NonNullable<ReviewSubmissionParts["answers"]> = [];
  fields.forEach((f) => {
    const v = text(f.id);
    if (f.kind === "reviewText") out.reviewText = v;
    else if (f.kind === "courseName") out.courseName = v;
    else if (f.kind === "city") out.city = v;
    else if (f.kind === "designation") out.designation = v;
    else if (!isBuiltin(f.kind) && v) answers.push({ key: f.id, label: labelOf(f), value: v });
  });
  if (answers.length) out.answers = answers;
  return out;
};

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
