import { createContext, useContext } from "react";

/**
 * The catalogue tag the current page tree belongs to.
 *
 * Components used to read it from the router params, which stops being true
 * the moment a catalogue is mounted at the host's root: on "/about" the
 * `$tagName` param is "about" (a page route, not a catalogue), and on "/"
 * there is no param at all. The route components know the real tag — they
 * resolved it — so they provide it here and link builders read it from here
 * first, falling back to the param for the classic "/<tag>/..." layout.
 */
export const CatalogueTagContext = createContext<string | null>(null);

export const useCatalogueTag = (fallback?: string): string =>
  useContext(CatalogueTagContext) ?? fallback ?? "";
