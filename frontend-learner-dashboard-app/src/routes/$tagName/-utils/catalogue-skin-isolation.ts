import { useLayoutEffect } from "react";
import { suspendAppSkin } from "@/lib/app-skin";

/**
 * Holds the learner app skin (Play, Fun, Corporate, ...) off <html> while a
 * public catalogue page is on screen, and puts it back exactly on unmount.
 *
 * The skin sheets are global: `.ui-play input[type="search"]` and
 * `.ui-play [role="tab"]` carry `!important` borders, weights and casing. A
 * signed-in learner therefore saw the site restyled by their institute's skin
 * (a second rounded border inside the search box, bold placeholder text,
 * upper-case course page tabs) while a visitor saw it as designed. The site
 * has its own theme, so it looks the same for both.
 *
 * `active` is false where the wrapper draws no site (a product page opened
 * without a catalogue keeps the skin). A layout effect, so the page never
 * paints with the skin first. Holds nest, so a site page inside the site
 * chrome is fine.
 */
export function useCatalogueSkinIsolation(active = true): void {
  useLayoutEffect(() => (active ? suspendAppSkin() : undefined), [active]);
}
