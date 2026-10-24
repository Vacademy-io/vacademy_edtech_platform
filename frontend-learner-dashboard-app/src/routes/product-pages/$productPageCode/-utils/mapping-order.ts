import type { ProductPageData } from '../-types/product-page-types';

/**
 * Product-page mappings in the order the admin arranged them.
 *
 * by-code returns mappings in whatever order the database hands back, while
 * `display_order` is what the admin set (and what a learning path's step
 * numbers mean). Sorting once — in the product-page query's `select` — gives
 * every consumer the same order: the course grid, cart, order summary, plan
 * tiles, the catalogue's offer section and learning paths.
 *
 * The sort is stable and ties keep the server's order, so a page whose rows all
 * share display_order 0 (rows created outside the editor) renders exactly as
 * before, and once the server breaks ties by (created_at, id) the client agrees
 * with it. A missing or non-numeric display_order counts as 0.
 */
const orderOf = (m: { display_order?: number | null }): number =>
    typeof m.display_order === 'number' && Number.isFinite(m.display_order) ? m.display_order : 0;

export const sortMappingsByDisplayOrder = <T extends { display_order?: number | null }>(
    mappings: readonly T[]
): T[] =>
    mappings
        .map((m, index) => ({ m, index }))
        .sort((a, b) => orderOf(a.m) - orderOf(b.m) || a.index - b.index)
        .map(({ m }) => m);

/**
 * The page with its mappings in display order. Returns the SAME object when
 * nothing moves, so react-query's select keeps a stable reference.
 */
export const withOrderedMappings = (page: ProductPageData): ProductPageData => {
    const mappings = Array.isArray(page?.mappings) ? page.mappings : null;
    if (!mappings || mappings.length < 2) return page;
    const sorted = sortMappingsByDisplayOrder(mappings);
    return sorted.every((m, i) => m === mappings[i]) ? page : { ...page, mappings: sorted };
};
