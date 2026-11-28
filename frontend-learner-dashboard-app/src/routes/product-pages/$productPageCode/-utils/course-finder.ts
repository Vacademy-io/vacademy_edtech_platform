/**
 * Course Finder — the "choose your class" screen a product page can show
 * before its catalogue.
 *
 * Membership is matched on package_session_id, authored by the admin. Nothing
 * here parses a course or level name: a page selling one scholarship test per
 * class carries all nine of them under a single level ("Scholarship Test") with
 * the class buried in the course name, so name-derived grouping would produce
 * one group containing everything. `levelNames` exists only for pages that
 * genuinely model a class as a level, and ids win wherever both are set.
 *
 * See the catalogue's CourseFinderWizard for the same idea on a catalogue site;
 * that one groups by level because catalogue levels ARE the classes there.
 */
import type {
  ProductPageCourseFinder,
  ProductPageFinderGroup,
  ProductPageMappingResponse,
  ProductPageSettings,
} from "../-types/product-page-types";

/**
 * Where the visitor's pick lives. sessionStorage, not localStorage: coming
 * back tomorrow for a different child should ask again, but stepping Back out
 * of the cart ten seconds later should not.
 */
const storageKey = (productPageCode: string) => `ppFinder_${productPageCode}`;

/**
 * Stored in place of a group id when the visitor chose to browse everything.
 *
 * Skipping has to persist exactly as a pick does: CatalogStep is unmounted for
 * the whole of the cart and form steps, so holding it in component state alone
 * re-opened the finder every time someone stepped Back out of their cart —
 * over a basket they had already filled.
 */
export const FINDER_SKIPPED = "__skipped__";

export const readSavedGroupId = (productPageCode: string): string | null => {
  try {
    return sessionStorage.getItem(storageKey(productPageCode));
  } catch {
    // Private windows and embedded webviews throw on access, not on write.
    return null;
  }
};

export const saveGroupId = (productPageCode: string, groupId: string): void => {
  try {
    sessionStorage.setItem(storageKey(productPageCode), groupId);
  } catch {
    /* a pick that cannot be remembered still works for this render */
  }
};

export const clearSavedGroupId = (productPageCode: string): void => {
  try {
    sessionStorage.removeItem(storageKey(productPageCode));
  } catch {
    /* nothing to clear */
  }
};

export const parseCourseFinder = (
  settingsJson: string | null | undefined,
): ProductPageCourseFinder | null => {
  if (!settingsJson) return null;
  try {
    const parsed = JSON.parse(settingsJson) as ProductPageSettings;
    const finder = parsed?.courseFinder;
    if (!finder?.enabled || !Array.isArray(finder.groups)) return null;
    return finder;
  } catch {
    return null;
  }
};

const norm = (v: string | null | undefined) => (v || "").trim().toLowerCase();

/** Does this course belong on this button? */
export const mappingInGroup = (
  mapping: ProductPageMappingResponse,
  group: ProductPageFinderGroup,
): boolean => {
  const ids = group.packageSessionIds ?? [];
  if (ids.length > 0) return ids.includes(mapping.package_session_id);
  const levels = (group.levelNames ?? []).map(norm);
  // Case-insensitive: group labels are hand-typed and drift from the stored
  // level names ("Cyber Ai-" vs "Cyber AI-").
  return levels.length > 0 && levels.includes(norm(mapping.level_name));
};

export const groupPackageSessionIds = (
  group: ProductPageFinderGroup,
  mappings: ProductPageMappingResponse[],
): string[] =>
  mappings.filter((m) => mappingInGroup(m, group)).map((m) => m.package_session_id);

/**
 * Groups that would actually show something, in authored order.
 *
 * A button leading to an empty catalogue is worse than no button: the course it
 * named was removed from the page, or its session was replaced for the new
 * year, and the visitor who picks it lands on "no courses found" with no way to
 * tell whether they chose wrong. Dropping it costs nothing — the courses behind
 * the remaining buttons are unaffected.
 */
export const usableGroups = (
  finder: ProductPageCourseFinder,
  mappings: ProductPageMappingResponse[],
): ProductPageFinderGroup[] => {
  const active = mappings.filter((m) => m.status === "ACTIVE");
  return (finder.groups || []).filter(
    (g) => g.label?.trim() && active.some((m) => mappingInGroup(m, g)),
  );
};

/**
 * Is the finder worth showing at all?
 *
 * One usable group is a screen with a single button — a click that asks the
 * visitor to confirm the only thing on offer. Show the catalogue instead.
 */
export const isFinderUsable = (
  finder: ProductPageCourseFinder | null,
  mappings: ProductPageMappingResponse[],
): finder is ProductPageCourseFinder =>
  !!finder && usableGroups(finder, mappings).length > 1;

/**
 * Two regexes, deliberately. A `/g` regex carries `lastIndex` between calls, so
 * reusing one for `.test()` returns false on every second call — the button
 * would render the raw `{{class}}` on alternating renders. Global for replacing,
 * non-global for testing.
 */
const CLASS_PLACEHOLDER_ALL = /\{\{\s*class\s*\}\}/gi;
const HAS_CLASS_PLACEHOLDER = /\{\{\s*class\s*\}\}/i;

/**
 * Wording for the finder dialog's confirm button.
 *
 * `{{class}}` lets a page name the pick — "Register for Class 9" — but there is
 * nothing to name until something is chosen, and substituting an empty string
 * leaves the button reading "Register for ". So a placeholder label falls back
 * to the generic wording while the button is still disabled, and a label
 * without one simply stands as written.
 *
 * @param authored  the admin's label, if any
 * @param chosen    the picked group's label, or null before a pick
 * @param fallback  wording that matches what the button actually does
 */
export const finderCtaLabel = (
  authored: string | undefined,
  chosen: string | null,
  fallback: string,
): string => {
  const raw = authored?.trim();
  if (!raw) return fallback;
  if (chosen) return raw.replace(CLASS_PLACEHOLDER_ALL, chosen);
  return HAS_CLASS_PLACEHOLDER.test(raw) ? fallback : raw;
};
