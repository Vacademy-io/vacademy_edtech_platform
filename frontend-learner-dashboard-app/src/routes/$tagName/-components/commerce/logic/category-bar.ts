/**
 * The category bar's chips and which one is active. Pure, so the header row and its tests
 * share one reading of the category tree and the page on screen.
 */
import type { Category } from '../api/types';
import type { CommerceCategoryBar } from '../config';
import { findCategory } from '../edge/commerce-edge';

export interface BarChip {
    key: string;
    label: string;
    /** Site-relative address ("c/<slug>", "shop"). */
    to: string;
    /** The collection the chip opens, when it opens one. */
    slug: string | null;
    /** Second level, shown on hover and focus on a desktop. */
    children: Array<{ slug: string; label: string }>;
    /** The collection's photo (its image_url), for the "image" style; null = none. */
    image: string | null;
}

/** Only an absolute http(s) address or a site path is used as a picture. */
const picture = (url: string | null | undefined): string | null => {
    const value = (url || '').trim();
    return /^https?:\/\//i.test(value) || (value.startsWith('/') && !value.startsWith('//')) ? value : null;
};

const COLLECTION_ROUTE = /^c\/([a-z0-9][a-z0-9-]{0,159})$/;

/**
 * The chips in order: "All" first when the site asks for it, then the site's own list, or the
 * menu categories (`menu`, already filtered by stock and sorted) when the list is "auto". A
 * chip's photo is its collection's image_url (from `tree` for a site's own list).
 */
export const barChips = (
    bar: Pick<CommerceCategoryBar, 'items' | 'showAll'>,
    menu: readonly Category[],
    labels: { all: string; translate(text: string): string },
    tree?: readonly Category[] | null
): BarChip[] => {
    const chips: BarChip[] = [];
    if (bar.showAll) chips.push({ key: 'all', label: labels.all, to: 'shop', slug: null, children: [], image: null });
    if (bar.items === 'auto') {
        for (const node of menu) {
            chips.push({
                key: `c:${node.slug}`,
                label: node.name || node.slug,
                to: `c/${node.slug}`,
                slug: node.slug,
                children: (node.children || [])
                    .filter((child) => child.product_count > 0)
                    .map((child) => ({ slug: child.slug, label: child.name || child.slug })),
                image: picture(node.image_url),
            });
        }
    } else {
        for (const item of bar.items) {
            const route = item.route.toLowerCase();
            const slug = COLLECTION_ROUTE.exec(route)?.[1] ?? null;
            // "All" is already first; an explicit "shop" item replaces it rather than repeating it.
            if (route === 'shop' && bar.showAll) {
                chips[0] = { ...chips[0]!, label: labels.translate(item.label) };
                continue;
            }
            const image = slug ? picture(findCategory(tree ?? menu, slug)?.node.image_url) : null;
            chips.push({ key: `i:${route}`, label: labels.translate(item.label), to: item.route, slug, children: [], image });
        }
    }
    return chips;
};

/** The page on screen, as far as the bar cares. */
export interface BarPage {
    /** "home", "shop", "collection", "product", "search"… */
    key: string;
    /** The collection on a collection page. */
    slug?: string | null;
    /** The product's category on a product page. */
    productCategory?: string | null;
}

/**
 * Which chip is active: on a collection page the chip of that collection or of its top-level
 * parent ("page"); on a product page the chip of the product's category ("true", outlined); on
 * the shop page the "All" chip ("page"). Nothing on the other pages.
 */
export const activeBarChip = (
    chips: readonly BarChip[],
    page: BarPage,
    tree: readonly Category[] | null | undefined
): { key: string; current: 'page' | 'true' } | null => {
    if (page.key === 'shop') {
        const all = chips.find((chip) => chip.to.toLowerCase() === 'shop');
        return all ? { key: all.key, current: 'page' } : null;
    }
    const slug = page.key === 'collection' ? page.slug : page.key === 'product' ? page.productCategory : null;
    if (!slug) return null;
    const found = findCategory(tree, slug);
    const lineage = [slug, ...(found ? [...found.parents].reverse().map((p) => p.slug) : [])];
    for (const candidate of lineage) {
        const chip = chips.find((c) => c.slug === candidate);
        if (chip) return { key: chip.key, current: page.key === 'collection' ? 'page' : 'true' };
    }
    return null;
};
