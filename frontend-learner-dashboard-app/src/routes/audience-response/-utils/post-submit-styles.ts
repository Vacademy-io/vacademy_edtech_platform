/**
 * Design-token class maps for the post-submit thank-you screen.
 *
 * Lives in its own module (not alongside the artwork component) for two
 * reasons: exporting constants from a component file breaks React Fast
 * Refresh, and both the artwork component and the page's button row need
 * these.
 *
 * Tailwind only sees class names it can read literally, so every combination
 * is spelled out here rather than built with `bg-${accent}-100` interpolation.
 */
import type { PostSubmitAccent } from "./post-submit-config";

/** Icon bubble: tinted background + matching foreground. */
export const POST_SUBMIT_ICON_ACCENT_CLASS: Record<PostSubmitAccent, string> = {
  success: "bg-success-100 text-success-600",
  primary: "bg-primary-100 text-primary-500",
  info: "bg-info-100 text-info-600",
  warning: "bg-warning-100 text-warning-600",
  neutral: "bg-neutral-100 text-neutral-600",
};

/** Solid ("primary") action button in the campaign's accent. */
export const POST_SUBMIT_BUTTON_ACCENT_CLASS: Record<PostSubmitAccent, string> = {
  success: "bg-success-600 text-white hover:bg-success-700",
  // The learner app's primary scale stops at 500 — `primary-600` compiles to
  // nothing, so the hover step goes down the scale, not up.
  primary: "bg-primary-500 text-white hover:bg-primary-400",
  info: "bg-info-600 text-white hover:bg-info-700",
  warning: "bg-warning-600 text-white hover:bg-warning-700",
  neutral: "bg-neutral-700 text-white hover:bg-neutral-800",
};
