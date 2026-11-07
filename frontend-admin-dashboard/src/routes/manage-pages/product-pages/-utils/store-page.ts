/**
 * Is this product page a site's STORE page (globalSettings.siteCart in a
 * website's published catalogue JSON)? The catalogue sync fills a store page
 * with the catalogue's courses, each through its default invite link, so
 * anything that fans out per mapped invite — custom fields, above all —
 * reaches the invite links of most courses in the institute.
 */

export interface StoreSiteRef {
    /** The website (catalogue tag) that checks out through this page. */
    tagName: string;
    /** Whether that site's cart is switched on (the page is designated either way). */
    cartEnabled: boolean;
}

export const findStoreSites = (
    catalogues: { tagName: string; catalogueJson?: string | null }[] | null | undefined,
    productPageCode: string | null | undefined
): StoreSiteRef[] => {
    const code = (productPageCode || '').trim();
    if (!code) return [];
    const sites: StoreSiteRef[] = [];
    for (const c of catalogues || []) {
        if (!c?.catalogueJson) continue;
        let parsed: unknown;
        try {
            parsed = JSON.parse(c.catalogueJson);
        } catch {
            continue;
        }
        const cart = (parsed as { globalSettings?: { siteCart?: unknown } } | null)?.globalSettings?.siteCart as
            | { enabled?: unknown; storeProductPageCode?: unknown }
            | undefined;
        if (cart && typeof cart.storeProductPageCode === 'string' && cart.storeProductPageCode.trim() === code) {
            sites.push({ tagName: c.tagName, cartEnabled: cart.enabled === true });
        }
    }
    return sites;
};

/** Distinct enroll invites behind a page's rows — what a custom-field change is written to. */
export const distinctInviteCount = (rows: { inviteId?: string | null }[]): number =>
    new Set(rows.map((r) => (r.inviteId || '').trim()).filter(Boolean)).size;
