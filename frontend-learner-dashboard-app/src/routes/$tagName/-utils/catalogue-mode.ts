/**
 * The storefront's buy / rent mode.
 *
 * The mode lives in sessionStorage `levelFilter` (the level name the catalogue filters on, e.g.
 * "Buy" / "Rent"), and every listener (BookCatalogueComponent, CartComponent, cart-store) reacts
 * to the `levelFilterChanged` window event. Change the mode only through `setCatalogueMode`, so
 * the storage value and the event always go together.
 */
export type CatalogueMode = "buy" | "rent";

const LEVEL_FILTER_KEY = "levelFilter";
export const LEVEL_FILTER_CHANGED_EVENT = "levelFilterChanged";

/** A level name means rent when it contains "rent" (case-insensitive), else buy. */
export const modeOfLevelFilter = (levelFilter: string | null | undefined): CatalogueMode =>
  (levelFilter || "").toLowerCase().includes("rent") ? "rent" : "buy";

export const getCatalogueMode = (): CatalogueMode => {
  try {
    return modeOfLevelFilter(sessionStorage.getItem(LEVEL_FILTER_KEY));
  } catch {
    return "buy";
  }
};

/**
 * Switch the storefront to the mode of `levelFilterValue` (the level name, e.g. "Rent").
 * Writes sessionStorage and fires `levelFilterChanged` so open screens update at once.
 */
export const setCatalogueMode = (levelFilterValue: string): void => {
  if (!levelFilterValue) return;
  try {
    sessionStorage.setItem(LEVEL_FILTER_KEY, levelFilterValue);
  } catch {
    // storage blocked (private mode): the event below still updates open screens
  }
  window.dispatchEvent(
    new CustomEvent(LEVEL_FILTER_CHANGED_EVENT, { detail: { levelFilter: levelFilterValue } }),
  );
};
