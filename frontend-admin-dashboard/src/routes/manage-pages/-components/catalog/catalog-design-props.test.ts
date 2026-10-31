import { describe, expect, it } from 'vitest';
import {
    appendObject,
    chipActionOf,
    groupIdFrom,
    insertObject,
    isReservedGroupId,
    movedGroupOrder,
    moveObject,
    patchObject,
    removeObject,
    optionIdFrom,
    parseTagList,
    setOrDelete,
    sidebarGroupRows,
    streamOptionsFromItems,
    streamOptionsFromTree,
    toggleSlug,
    uniqueId,
    withChipAction,
} from './catalog-design-props';
import type { FolderNode } from '../../-services/folder-library-service';

const folder = (
    id: string,
    extra: Partial<FolderNode>,
    children: FolderNode[] = []
): FolderNode => ({
    id,
    node_type: 'FOLDER',
    display_order: 0,
    status: 'ACTIVE',
    children,
    ...extra,
});

describe('streamOptionsFromTree', () => {
    it('keys streams and categories the way the site links them', () => {
        const roots = [
            folder('s1', { title: 'शिक्षा', subtitle: 'Education', slug: 'shiksha' }, [
                folder('c1', { title: 'गुरुकुल', subtitle: 'Gurukul Education' }),
                folder('c2', { title: 'Khagol', coming_soon: true, audience_id: 'aud-1' }),
                folder('c3', { title: 'Ganit', coming_soon: true }),
            ]),
            { ...folder('p1', { title: 'A page' }), node_type: 'PRODUCT_PAGE' as const },
        ];
        expect(streamOptionsFromTree(roots)).toEqual([
            {
                slug: 'shiksha',
                label: 'शिक्षा · Education',
                categories: [
                    { slug: 'gurukul-education', label: 'गुरुकुल · Gurukul Education' },
                    // Coming soon only with a notify form, as the site lists it.
                    { slug: 'khagol', label: 'Khagol', comingSoon: true },
                    { slug: 'ganit', label: 'Ganit' },
                ],
            },
        ]);
        expect(streamOptionsFromTree(null)).toEqual([]);
    });

    it('keys tag tabs like the site: slug, else tag, else label, slugified and unique', () => {
        expect(
            streamOptionsFromItems([
                { label: 'Parenting', slug: 'Vedic Parenting' },
                { tag: 'music' },
                { label: 'Kala' },
                { label: 'Again', slug: 'vedic-parenting' },
                { label: 'शिक्षा' },
                'junk',
            ])
        ).toEqual([
            { slug: 'vedic-parenting', label: 'Parenting', categories: [] },
            { slug: 'music', label: 'music', categories: [] },
            { slug: 'kala', label: 'Kala', categories: [] },
        ]);
    });
});

describe('Popular chip actions', () => {
    it('follows the site precedence, then the action just picked', () => {
        expect(chipActionOf({ label: 'x', streamSlug: 'a', quickFilterId: 'q' })).toBe('stream');
        expect(chipActionOf({ label: 'x', searchValue: 'gita', streamSlug: 'a' })).toBe('search');
        expect(chipActionOf({ label: 'x', quickFilterId: 'qf-free' })).toBe('quickFilter');
        expect(chipActionOf({ label: 'x', route: '' })).toBe('link');
        expect(chipActionOf({ label: 'x' })).toBe('stream');
    });

    it('switching drops the old action keys and keeps the rest', () => {
        expect(
            withChipAction(
                { label: 'Garbha', streamSlug: 'swasthya', categorySlug: 'g', note: 1 },
                'link'
            )
        ).toEqual({ label: 'Garbha', note: 1, route: '' });
    });
});

describe('small writers', () => {
    it('setOrDelete removes an emptied override', () => {
        expect(setOrDelete({ paid: 'Enrol', read: 'Read' }, 'paid', '')).toEqual({ read: 'Read' });
        expect(setOrDelete(undefined, 'paid', 'Enrol')).toEqual({ paid: 'Enrol' });
    });

    it('toggleSlug keeps the order of the others and ignores case, like the site', () => {
        expect(toggleSlug(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
        expect(toggleSlug(['a'], 'z')).toEqual(['a', 'z']);
        expect(toggleSlug(['Sanskrit', 'b'], 'sanskrit')).toEqual(['b']);
    });

    it('edits lists in place: entries that are not objects stay where they were', () => {
        const raw = ['note', { id: 'a' }, 7, { id: 'b' }];
        expect(patchObject(raw, 1, { x: 1 })).toEqual(['note', { id: 'a' }, 7, { id: 'b', x: 1 }]);
        expect(removeObject(raw, 0)).toEqual(['note', 7, { id: 'b' }]);
        expect(moveObject(raw, 1, -1)).toEqual(['note', { id: 'b' }, 7, { id: 'a' }]);
        expect(moveObject(raw, 1, 1)).toBe(raw);
        expect(appendObject(raw, { id: 'c' })).toEqual([...raw, { id: 'c' }]);
        expect(insertObject(raw, 1, { id: 'c' })).toEqual([
            'note',
            { id: 'a' },
            7,
            { id: 'c' },
            { id: 'b' },
        ]);
        expect(insertObject(undefined, -1, { id: 'c' })).toEqual([{ id: 'c' }]);
    });

    it('builds URL keys and tag lists', () => {
        expect(optionIdFrom("Women's health")).toBe('women-s-health');
        expect(uniqueId('parents', ['Parents', 'parents-2'])).toBe('parents-3');
        expect(optionIdFrom('शिक्षा')).toBe('');
        expect(parseTagList(' For-Parents, ,parents,for-parents ')).toEqual([
            'for-parents',
            'parents',
        ]);
    });
});

describe('extra filter group URL keys', () => {
    it('never gives a key the site drops (reserved, legacy, utm…, or empty)', () => {
        expect(groupIdFrom('For', [], 'filter-1')).toBe('for');
        expect(groupIdFrom('Price', [], 'filter-1')).toBe('price-2');
        expect(groupIdFrom('Goal', [], 'filter-1')).toBe('goal-2');
        expect(groupIdFrom('Level', [], 'filter-1')).toBe('level-2');
        expect(groupIdFrom('Price range', [], 'filter-1')).toBe('price-range');
        expect(groupIdFrom('UTM source', [], 'filter-1')).toBe('filter-utm-source');
        expect(groupIdFrom('किसके लिए', ['filter-3'], 'filter-3')).toBe('filter-3-2');
        expect(groupIdFrom('For', ['for'], 'filter-1')).toBe('for-2');
    });

    it('flags keys the site skips', () => {
        expect(isReservedGroupId('Category')).toBe(true);
        expect(isReservedGroupId('pricerange')).toBe(true);
        expect(isReservedGroupId('utm_campaign')).toBe(true);
        expect(isReservedGroupId('for')).toBe(false);
    });
});

describe('sidebar group order', () => {
    const props = {
        priceFilter: { enabled: true, label: 'Price' },
        languageFilter: { enabled: false },
        customFilters: [
            { id: 'format', label: 'Format', source: 'courseFormats' },
            { id: 'for', label: 'For', enabled: false },
        ],
        filterSidebar: { order: ['price', 'Format', 'level'] },
    };

    it('lists the groups like the site: authored order first, then the original order', () => {
        expect(sidebarGroupRows(props).map((r) => [r.id, r.shown])).toEqual([
            ['price', true],
            ['format', true],
            ['language', false],
            ['for', false],
        ]);
    });

    it('a move writes every shown group and keeps ids the editor does not list in place', () => {
        const rows = sidebarGroupRows(props);
        expect(movedGroupOrder(rows, 3, -1, props.filterSidebar.order)).toEqual([
            'price',
            'format',
            'level',
            'for',
            'language',
        ]);
        expect(movedGroupOrder(rows, 1, -1, ['level', 'price', 'format'])).toEqual([
            'level',
            'format',
            'price',
            'language',
            'for',
        ]);
        expect(movedGroupOrder(rows, 0, -1, props.filterSidebar.order)).toEqual(
            props.filterSidebar.order
        );
    });
});
