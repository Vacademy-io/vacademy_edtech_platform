import { z } from 'zod';

/**
 * The product page route's search params.
 *
 * The router JSON-parses every value before this schema sees it, so
 * `?lang=1`, `?lang=true` and `?lang=null` arrive as a number, a boolean and
 * null. A param this page only carries along must never fail validation for
 * that — a failed search renders the page's error screen instead of the page.
 */
export const productPageSearchSchema = z.object({
    instituteId: z.string().optional(),
    courseIds: z.string().optional(),
    defaultTab: z.enum(['CATALOG', 'CART', 'PAYMENT']).optional(),
    // Catalogue slug the visitor arrived from. Lets the page wear that
    // catalogue's header, footer and theme instead of rendering bare.
    tagName: z.string().optional(),
    // Comma-separated level names the browse step is restricted to. Carries a
    // Course Finder pick across from the catalogue so the visitor who just
    // chose "Class 6" does not land back on every level. Unlike courseIds this
    // only narrows what is VISIBLE — it selects nothing into the cart.
    levels: z.string().optional(),
    // The site language (?lang=hi) the visitor was reading the catalogue in.
    // Declared so it survives this route's own search handling and goes back
    // out with the visitor (see backFromCart in ProductPageShell). A value
    // that is not a string is dropped rather than failing the page.
    lang: z.string().optional().catch(undefined),
    // "siteCart" when the site cart's Checkout sent the visitor here: Back
    // from the cart then returns to the page the cart was opened on. Any other
    // value is ignored — and never fails validation (an unrelated ?source= on
    // an existing link must not break the page).
    source: z.string().optional().catch(undefined),
    utm_source: z.string().optional(),
    utm_medium: z.string().optional(),
    utm_campaign: z.string().optional(),
    utm_content: z.string().optional(),
    utm_term: z.string().optional(),
});

export type ProductPageSearch = z.infer<typeof productPageSearchSchema>;
