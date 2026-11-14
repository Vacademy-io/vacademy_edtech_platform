/**
 * courseCatalog.streams extension — OWNED BY FEATURE 'tabs' (specs/stream-tabs.json).
 * Merged into CatalogStreamsConfig. Every field is opt-in: a section without
 * `variant: "icons"` renders the original pill tabs, untouched.
 */
export type CatalogStreamTabsVariant = "pills" | "icons";

export interface CatalogStreamsTabsExtension {
  /**
   * "icons" = a full-width band of equal-width tabs, each with the stream's
   * round image (its folder's image_url), its name and a second line, with a
   * saffron underline under the active tab. Colours follow
   * globalSettings.theme.palette. Default "pills" (the original tabs).
   * The icon band does not stick under the header unless `sticky: true` is
   * set explicitly (unlike the pills, whose `sticky` defaults to true).
   */
  variant?: CatalogStreamTabsVariant;
  /**
   * Icons variant only: "English name · 12" — the number of courses in each
   * stream (catalogue totals, ignoring search and filters; the All tab shows
   * every course). Default false.
   */
  showCounts?: boolean;
  /** Icons variant only: second line of the All tab ("All courses"). Translated with the site dictionary. Default none. */
  allSubtitle?: string;
}
