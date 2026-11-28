/**
 * Every course has its own colour in the Fun skin. Courses carry no colour,
 * subject or icon field, so the colour comes from the course (package) id:
 * the same on every device, in every sort order and language, and for the same
 * course in two batches. Two courses may share a colour; a list is never
 * de-duplicated, because that would make a course's colour depend on the list.
 *
 * Red and green are left out on purpose: they read as wrong/live and as done.
 * Every colour carries white text at 4.5:1 or better; text on white or on the
 * tint uses the `text` shade. The CSS custom properties in styles/fun/base.css
 * (.fun-course-0 .. .fun-course-7) hold the same values, and a test keeps the
 * two in step.
 *
 * OWNER DEFAULT (unconfirmed): colour = palette[FNV-1a(course id) % 8], frontend
 * only. An admin override field would replace courseColourIndex here.
 */
export interface CourseColour {
  name: string;
  /** The course colour; white text on it. */
  solid: string;
  /** Secondary text on a band of the course colour. */
  onBand: string;
  /** The course's text and icons on white or on its tint. */
  text: string;
  tint: string;
  /** The deco circle drawn on the band. */
  deco: string;
  /** The lip under a button that sits on the band. */
  lip: string;
  /** Progress track on the band (the fill is the highlight yellow). */
  track: string;
}

// Categorical palette, mirrored in styles/fun/base.css.
export const COURSE_PALETTE: readonly CourseColour[] = [
  { name: "violet", solid: "#6D28D9", onBand: "#EDE4FF", text: "#5B21B6", tint: "#F1EBFF", deco: "#7C3AED", lip: "#4C1D95", track: "#8B5CF6" }, // design-lint-ignore
  { name: "teal", solid: "#0F766E", onBand: "#E6F4F1", text: "#115E59", tint: "#E6F4F1", deco: "#0D9488", lip: "#134E4A", track: "#14B8A6" }, // design-lint-ignore
  { name: "orange", solid: "#C2410C", onBand: "#FDEEE6", text: "#9A3412", tint: "#FDEEE6", deco: "#EA580C", lip: "#7C2D12", track: "#F97316" }, // design-lint-ignore
  { name: "pink", solid: "#BE185D", onBand: "#FCE7F1", text: "#9D174D", tint: "#FCE7F1", deco: "#DB2777", lip: "#831843", track: "#EC4899" }, // design-lint-ignore
  { name: "indigo", solid: "#4338CA", onBand: "#ECEBFA", text: "#3730A3", tint: "#ECEBFA", deco: "#4F46E5", lip: "#312E81", track: "#6366F1" }, // design-lint-ignore
  { name: "sky", solid: "#0369A1", onBand: "#E6F1F8", text: "#075985", tint: "#E6F1F8", deco: "#0284C7", lip: "#0C4A6E", track: "#0EA5E9" }, // design-lint-ignore
  { name: "fuchsia", solid: "#A21CAF", onBand: "#F6E8F7", text: "#86198F", tint: "#F6E8F7", deco: "#C026D3", lip: "#701A75", track: "#D946EF" }, // design-lint-ignore
  // Lime: its tint fails as on-band text (4.39), so the band uses white.
  { name: "lime", solid: "#4D7C0F", onBand: "#FFFFFF", text: "#3F6212", tint: "#EDF2E7", deco: "#65A30D", lip: "#365314", track: "#84CC16" }, // design-lint-ignore
];

/** FNV-1a 32-bit over a string's UTF-16 code units, as an unsigned number. */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * The palette index for a course. Pass the course (package) id:
 * EnrolledCourse.id / CoursePackage.id / package_dto.id / the course-details
 * `courseId` search param. Never the package_session_id, which differs between
 * batches of one course.
 */
export const courseColourIndex = (courseId: string): number => fnv1a32(courseId) % COURSE_PALETTE.length;

export const courseColourOf = (courseId: string): CourseColour => COURSE_PALETTE[courseColourIndex(courseId)]!;

/** The class that puts the course's colours in --fc-* custom properties (see base.css). */
export const courseColourClass = (courseId: string): string => `fun-course-${courseColourIndex(courseId)}`;
