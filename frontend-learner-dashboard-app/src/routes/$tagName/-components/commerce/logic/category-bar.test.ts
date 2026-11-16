import { describe, expect, it } from 'vitest';
import type { Category } from '../api/types';
import { activeBarChip, barChips } from './category-bar';

const node = (slug: string, name: string, children: Category[] = [], productCount = 5): Category =>
    ({ slug, name, kind: 'CATEGORY', description: null, image_url: null, path: `/c/${slug}`, position: 0, product_count: productCount, in_stock_count: productCount, children }) as unknown as Category;

const TREE = [
    node('sarees', 'साड़ियाँ', [node('silk-sarees', 'रेशमी'), node('empty-child', 'खाली', [], 0)]),
    node('bags', 'बैग'),
];
const labels = { all: 'सब', translate: (text: string) => `~${text}` };

describe('barChips', () => {
    it('lists the menu categories with their second level, and "All" first when asked', () => {
        const chips = barChips({ items: 'auto', showAll: true }, TREE, labels);
        expect(chips.map((c) => [c.key, c.label, c.to])).toEqual([
            ['all', 'सब', 'shop'],
            ['c:sarees', 'साड़ियाँ', 'c/sarees'],
            ['c:bags', 'बैग', 'c/bags'],
        ]);
        // A child without products is not offered.
        expect(chips[1]!.children).toEqual([{ slug: 'silk-sarees', label: 'रेशमी' }]);
        expect(barChips({ items: 'auto', showAll: false }, TREE, labels).map((c) => c.key)).toEqual(['c:sarees', 'c:bags']);
    });

    it("uses the site's own list, through its dictionary, without repeating the All chip", () => {
        const chips = barChips(
            { items: [{ label: 'सब कुछ', route: 'shop' }, { label: 'उपहार', route: 'c/gifts-under-999' }, { label: 'कहानी', route: 'our-story' }], showAll: true },
            TREE,
            labels
        );
        expect(chips.map((c) => [c.key, c.label, c.to, c.slug])).toEqual([
            ['all', '~सब कुछ', 'shop', null],
            ['i:c/gifts-under-999', '~उपहार', 'c/gifts-under-999', 'gifts-under-999'],
            ['i:our-story', '~कहानी', 'our-story', null],
        ]);
    });
});

describe('activeBarChip', () => {
    const chips = barChips({ items: 'auto', showAll: true }, TREE, labels);

    it('marks the collection page, and a child collection on its parent', () => {
        expect(activeBarChip(chips, { key: 'collection', slug: 'bags' }, TREE)).toEqual({ key: 'c:bags', current: 'page' });
        expect(activeBarChip(chips, { key: 'collection', slug: 'silk-sarees' }, TREE)).toEqual({ key: 'c:sarees', current: 'page' });
        expect(activeBarChip(chips, { key: 'collection', slug: 'unknown' }, TREE)).toBeNull();
    });

    it("outlines the product's category, marks All on the shop page, and nothing on home or search", () => {
        expect(activeBarChip(chips, { key: 'product', productCategory: 'silk-sarees' }, TREE)).toEqual({ key: 'c:sarees', current: 'true' });
        expect(activeBarChip(chips, { key: 'product', productCategory: null }, TREE)).toBeNull();
        expect(activeBarChip(chips, { key: 'shop' }, TREE)).toEqual({ key: 'all', current: 'page' });
        expect(activeBarChip(chips, { key: 'home' }, TREE)).toBeNull();
        expect(activeBarChip(chips, { key: 'search' }, TREE)).toBeNull();
    });
});
