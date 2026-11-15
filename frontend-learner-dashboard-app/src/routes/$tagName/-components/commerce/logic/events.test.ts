import { describe, expect, it } from 'vitest';
import { buildCommerceEvent, gaItem, isBuilderPreview, sendCommerceEvent } from './events';

const saree = { id: 'SAR-1', name: 'Red saree', unitPrice: 4899, quantity: 1, qtyScale: 1, category: 'Sarees' };
// Cloth at ₹4.50 per base unit (1 cm), 100 base units to the metre, 2.5 m in the cart.
const cloth = { id: 'FAB-1', name: 'Khadi fabric', unitPrice: 4.5, quantity: 250, qtyScale: 100 };

describe('commerce events', () => {
    it('reports goods sold by length per metre, so price times quantity is the money', () => {
        expect(gaItem(cloth)).toEqual({ item_id: 'FAB-1', item_name: 'Khadi fabric', price: 450, quantity: 2.5 });
        expect(buildCommerceEvent({ name: 'add_to_cart', item: cloth }).ga.params).toMatchObject({ currency: 'INR', value: 1125 });
    });

    it('builds view_item with the Meta ViewContent twin', () => {
        const built = buildCommerceEvent({ name: 'view_item', item: saree, currency: 'inr' });
        expect(built.ga).toEqual({
            name: 'view_item',
            params: { currency: 'INR', value: 4899, items: [{ item_id: 'SAR-1', item_name: 'Red saree', price: 4899, quantity: 1, item_category: 'Sarees' }] },
        });
        expect(built.meta).toEqual({
            name: 'ViewContent',
            params: { content_ids: ['SAR-1'], content_name: 'Red saree', content_type: 'product', currency: 'INR', value: 4899 },
        });
    });

    it('sends no value when a price is unknown, never a zero', () => {
        const built = buildCommerceEvent({ name: 'view_item', item: { ...saree, unitPrice: null } });
        expect(built.ga.params).not.toHaveProperty('value');
        expect(built.ga.params).not.toHaveProperty('currency');
    });

    it('builds list, select and cart events', () => {
        const list = buildCommerceEvent({ name: 'view_item_list', listId: 'c/sarees', listName: 'Sarees', items: [{ ...saree, index: 0 }] });
        expect(list.ga.params).toMatchObject({ item_list_id: 'c/sarees', item_list_name: 'Sarees' });
        expect((list.ga.params.items as unknown[])[0]).toMatchObject({ index: 0 });
        expect(buildCommerceEvent({ name: 'select_item', listId: 'search', item: saree }).ga.name).toBe('select_item');
        expect(buildCommerceEvent({ name: 'remove_from_cart', item: saree }).meta).toBeUndefined();
        // The cart total is the server's number when given.
        expect(buildCommerceEvent({ name: 'view_cart', items: [saree, cloth], value: 6100 }).ga.params).toMatchObject({ value: 6100 });
        expect(buildCommerceEvent({ name: 'view_cart', items: [saree, cloth] }).ga.params).toMatchObject({ value: 6024 });
    });

    it('marks a search that found nothing', () => {
        expect(buildCommerceEvent({ name: 'search', term: 'lehenga' })).toEqual({
            ga: { name: 'search', params: { search_term: 'lehenga' } },
            meta: { name: 'Search', params: { search_string: 'lehenga' } },
        });
        expect(buildCommerceEvent({ name: 'view_search_results', term: 'lehenga', results: 0 }).ga.params).toEqual({
            search_term: 'lehenga',
            results_count: 0,
            zero_results: true,
        });
    });

    it('speaks to gtag, a GTM data layer and the pixel, whichever is on the page', () => {
        const gtag: unknown[][] = [];
        const fbq: unknown[][] = [];
        const dataLayer: unknown[] = [];
        const win = { location: { search: '?lang=en' }, gtag: (...a: unknown[]) => void gtag.push(a), fbq: (...a: unknown[]) => void fbq.push(a), dataLayer };
        sendCommerceEvent({ name: 'add_to_cart', item: saree }, win);
        expect(gtag).toEqual([['event', 'add_to_cart', expect.objectContaining({ value: 4899 })]]);
        expect(fbq).toEqual([['track', 'AddToCart', expect.objectContaining({ content_ids: ['SAR-1'] })]]);
        expect(dataLayer).toEqual([{ ecommerce: null }, { event: 'commerce_add_to_cart', ecommerce: expect.objectContaining({ value: 4899 }) }]);
    });

    it('is silent on a site with no tracking, in the builder preview, and when a tool throws', () => {
        expect(sendCommerceEvent({ name: 'search', term: 'x' }, {})).not.toBeNull();
        const gtag: unknown[] = [];
        const preview = { location: { search: '?preview=true' }, gtag: () => void gtag.push(1) };
        expect(isBuilderPreview(preview)).toBe(true);
        expect(sendCommerceEvent({ name: 'search', term: 'x' }, preview)).toBeNull();
        expect(gtag).toEqual([]);
        expect(sendCommerceEvent({ name: 'search', term: 'x' }, { gtag: () => { throw new Error('blocked'); } })).toBeNull();
        expect(sendCommerceEvent({ name: 'search', term: 'x' }, undefined)).toBeNull();
    });
});
