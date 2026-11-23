/**
 * The phone layout fixes (spec 7.8): one 16 px side gutter instead of 28, a
 * 12 px rhythm between blocks (COMPACT), 8 px between the avatar row and the
 * date, and pinch zoom.
 *
 * Owner decision Q2 is pending, so this is ONE switch:
 * - "BUILDER_ONLY" (today's default): only institutes with a published home get them;
 *   every other institute keeps the classic dashboard byte for byte.
 * - "EVERYONE": the classic dashboard gets the same gutter, rhythm, header gap and zoom.
 */
export type PhoneLayoutFixScope = "BUILDER_ONLY" | "EVERYONE";

export const PHONE_LAYOUT_FIX_SCOPE: PhoneLayoutFixScope = "BUILDER_ONLY";

export const phoneLayoutFixApplies = (builder: boolean, scope: PhoneLayoutFixScope = PHONE_LAYOUT_FIX_SCOPE) =>
  builder || scope === "EVERYONE";

/** The dashboard wrapper's padding: LayoutContainer already pads 16 px on phones. */
export const pagePaddingClass = (fixed: boolean) => (fixed ? "px-0 py-3 sm:p-4 lg:p-6" : "p-3 sm:p-4 lg:p-6");

export const VIEWPORT_LOCKED = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no";
export const VIEWPORT_ZOOMABLE = "width=device-width, initial-scale=1.0";
