/**
 * Where "Back" from the cart step leads (ProductPageShell.backFromCart).
 *
 * - ownCatalog: this page's own catalogue step — once the visitor has been
 *   there, or when nothing better is known.
 * - siteFinder: the catalogue the visitor came from (its home), asking for its
 *   Course Finder — a basket handed over by a catalogue section, where going
 *   back means choosing again.
 * - history / siteHome: the SITE CART's store checkout. The visitor opened the
 *   cart on some page of the site (a course page, the Courses page…) and
 *   pressed Checkout; Back returns to that page (browser history) with the cart
 *   drawer open again, or to the site's home when there is no in-app history
 *   (a reloaded or shared checkout link). Never the Course Finder: the cart
 *   was their choice already.
 */
export type CartBackTarget = 'ownCatalog' | 'siteFinder' | 'history' | 'siteHome';

export const cartBackTarget = (ctx: {
    /** Arrived from the site cart (?source=siteCart). */
    fromSiteCart: boolean;
    /** Has browsed this page's own catalogue step. */
    sawOwnCatalog: boolean;
    /** The router has an in-app entry to go back to. */
    canGoBack: boolean;
    /** Catalogue slug the visitor came from. */
    tagName?: string;
}): CartBackTarget => {
    if (!ctx.sawOwnCatalog) {
        if (ctx.fromSiteCart && ctx.canGoBack) return 'history';
        if (ctx.fromSiteCart && ctx.tagName) return 'siteHome';
        if (ctx.tagName) return 'siteFinder';
    }
    return 'ownCatalog';
};
