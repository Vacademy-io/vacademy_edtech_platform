import { beforeEach, describe, expect, it } from 'vitest';
import type { CartPrice } from '../api/types';
import {
    CART_MAX_LINES,
    EMPTY_CART,
    addLine,
    applyPrice,
    cartCount,
    cartStorageKey,
    priceRequestKey,
    removeLine,
    reviveCart,
    setPincode,
    setQuantity,
    toPriceRequest,
    type CartLine,
    type CartState,
} from './cart-logic';
import { useCommerceCart, type CartStorage } from './cart-store';

const line = (over: Partial<CartLine> = {}): Omit<CartLine, 'addedAt'> => ({
    variantId: 'v-1',
    slug: 'red-saree',
    name: 'Red saree',
    variantLabel: null,
    imageUrl: 'https://cdn.example/a.webp',
    quantity: 1,
    qtyScale: 1,
    qtyStep: 1,
    unit: 'PCS',
    piece: false,
    unitPrice: 4899,
    ...over,
});

const fabric = (over: Partial<CartLine> = {}) =>
    line({ variantId: 'v-fabric', slug: 'khadi', name: 'Khadi', quantity: 25, qtyScale: 10, qtyStep: 5, unit: 'MTR', unitPrice: 45, ...over });

describe('adding to the cart', () => {
    it('adds a new line at the front', () => {
        const first = addLine(EMPTY_CART, line(), 1);
        expect(first.outcome).toBe('added');
        const second = addLine(first.cart, line({ variantId: 'v-2' }), 2);
        expect(second.cart.lines.map((l) => l.variantId)).toEqual(['v-2', 'v-1']);
        // The input is never mutated.
        expect(EMPTY_CART.lines).toEqual([]);
    });

    it('grows the line of a variant already in the cart', () => {
        const once = addLine(EMPTY_CART, line(), 1).cart;
        const twice = addLine(once, line({ quantity: 2 }), 2);
        expect(twice.outcome).toBe('increased');
        expect(twice.cart.lines).toHaveLength(1);
        expect(twice.cart.lines[0]!.quantity).toBe(3);
        expect(twice.cart.lines[0]!.addedAt).toBe(1);
    });

    it('keeps a one-of-a-kind piece at one', () => {
        const once = addLine(EMPTY_CART, line({ piece: true }), 1).cart;
        const again = addLine(once, line({ piece: true }), 2);
        expect(again.outcome).toBe('unchanged');
        expect(again.cart).toBe(once);
        expect(addLine(EMPTY_CART, line({ piece: true, quantity: 4 }), 1).cart.lines[0]!.quantity).toBe(1);
    });

    it('puts a measured quantity on its step grid', () => {
        expect(addLine(EMPTY_CART, fabric({ quantity: 12 }), 1).cart.lines[0]!.quantity).toBe(10);
        expect(addLine(EMPTY_CART, fabric({ quantity: 0 }), 1).cart.lines[0]!.quantity).toBe(5);
    });

    it('stops at the line limit', () => {
        let cart: CartState = EMPTY_CART;
        for (let i = 0; i < CART_MAX_LINES; i += 1) cart = addLine(cart, line({ variantId: `v-${i}` }), i).cart;
        const over = addLine(cart, line({ variantId: 'one-too-many' }), 99);
        expect(over.outcome).toBe('full');
        expect(over.cart.lines).toHaveLength(CART_MAX_LINES);
        // A variant already in the cart can still grow.
        expect(addLine(cart, line({ variantId: 'v-3' }), 99).outcome).toBe('increased');
    });
});

describe('changing the cart', () => {
    const cart = addLine(addLine(EMPTY_CART, line(), 1).cart, fabric(), 2).cart;

    it('sets a quantity on the step grid and removes a line at zero', () => {
        expect(setQuantity(cart, 'v-fabric', 32).lines[0]!.quantity).toBe(30);
        expect(setQuantity(cart, 'v-1', 4).lines[1]!.quantity).toBe(4);
        expect(setQuantity(cart, 'v-1', 0).lines.map((l) => l.variantId)).toEqual(['v-fabric']);
        expect(removeLine(cart, 'v-fabric').lines.map((l) => l.variantId)).toEqual(['v-1']);
        expect(removeLine(cart, 'unknown').lines).toHaveLength(2);
    });

    it('counts pieces, and a length of cloth as one', () => {
        expect(cartCount(EMPTY_CART)).toBe(0);
        expect(cartCount(cart)).toBe(2);
        expect(cartCount(setQuantity(cart, 'v-1', 3))).toBe(4);
        expect(cartCount(setQuantity(cart, 'v-fabric', 100))).toBe(2);
    });

    it('accepts only a six-digit pincode', () => {
        expect(setPincode(cart, '482001').pincode).toBe('482001');
        expect(setPincode(cart, '012345').pincode).toBeNull();
        expect(setPincode(cart, '4820').pincode).toBeNull();
        expect(setPincode(cart, null).pincode).toBeNull();
    });
});

describe('pricing', () => {
    const cart = setPincode(addLine(addLine(EMPTY_CART, line(), 1).cart, fabric(), 2).cart, '482001');

    it('sends variant, quantity and the price last shown; never a total', () => {
        expect(toPriceRequest(cart)).toEqual({
            lines: [
                { line_ref: 'v-fabric', variant_id: 'v-fabric', quantity: 25, unit_price: 45 },
                { line_ref: 'v-1', variant_id: 'v-1', quantity: 1, unit_price: 4899 },
            ],
            pincode: '482001',
            payment_method: 'PREPAID',
        });
        expect(JSON.stringify(toPriceRequest(cart))).not.toMatch(/total|gross|net|discount/);
    });

    it('leaves out a price it never saw and a pincode it does not have', () => {
        const request = toPriceRequest(addLine(EMPTY_CART, line({ unitPrice: null }), 1).cart);
        expect(request.lines[0]).toEqual({ line_ref: 'v-1', variant_id: 'v-1', quantity: 1 });
        expect('pincode' in request).toBe(false);
    });

    it('keys a request by what changes the answer', () => {
        const key = priceRequestKey(cart, 'hi');
        expect(priceRequestKey(setQuantity(cart, 'v-1', 2), 'hi')).not.toBe(key);
        expect(priceRequestKey(setPincode(cart, '110001'), 'hi')).not.toBe(key);
        expect(priceRequestKey(cart, 'en')).not.toBe(key);
        // A new unit price from the server must not trigger another request.
        const repriced: CartState = { ...cart, lines: cart.lines.map((l) => ({ ...l, unitPrice: 1 })) };
        expect(priceRequestKey(repriced, 'hi')).toBe(key);
    });

    it("folds the server's answer back into the remembered lines", () => {
        const price = {
            lines: [
                {
                    line_ref: 'v-1',
                    variant_id: 'v-1',
                    name: 'Red saree (new name)',
                    slug: 'red-saree',
                    variant_label: 'Red',
                    quantity: 1,
                    qty_scale: 1,
                    qty_step: 1,
                    piece: true,
                    unit: 'PCS',
                    unit_price: 5099,
                },
            ],
            unavailable: [{ line_ref: 'v-fabric', reason: 'OUT_OF_STOCK' }],
        } as unknown as CartPrice;
        const next = applyPrice(cart, price);
        const saree = next.lines.find((l) => l.variantId === 'v-1')!;
        expect(saree).toMatchObject({ name: 'Red saree (new name)', variantLabel: 'Red', unitPrice: 5099, piece: true });
        // A line the server could not price is left as it was.
        expect(next.lines.find((l) => l.variantId === 'v-fabric')).toEqual(cart.lines.find((l) => l.variantId === 'v-fabric'));
        // The same answer again changes nothing (same object: no re-render, no re-save).
        expect(applyPrice(next, price)).toBe(next);
    });
});

describe('reading a cart back from storage', () => {
    it('round-trips a cart', () => {
        const cart = setPincode(addLine(addLine(EMPTY_CART, line(), 1).cart, fabric(), 2).cart, '482001');
        expect(reviveCart(JSON.parse(JSON.stringify(cart)))).toEqual(cart);
    });

    it('drops anything malformed instead of trusting it', () => {
        expect(reviveCart(null)).toEqual(EMPTY_CART);
        expect(reviveCart('x')).toEqual(EMPTY_CART);
        expect(reviveCart({ version: 99, lines: [line()] })).toEqual(EMPTY_CART);
        const revived = reviveCart({
            version: 1,
            pincode: 'abc',
            lines: [
                { ...line(), addedAt: 1 },
                { ...line(), addedAt: 2 },
                { variantId: '', quantity: 1 },
                null,
                { ...line({ variantId: 'v-9', quantity: -3, qtyStep: 5, imageUrl: 'javascript:alert(1)', unitPrice: -1 }), addedAt: 3 },
            ],
        });
        expect(revived.pincode).toBeNull();
        expect(revived.lines.map((l) => l.variantId)).toEqual(['v-1', 'v-9']);
        expect(revived.lines[1]).toMatchObject({ quantity: 5, imageUrl: null, unitPrice: null });
    });

    it('keeps one cart per site', () => {
        expect(cartStorageKey('inst-1', 'Shop')).toBe('commerce-cart:inst-1:shop');
        expect(cartStorageKey('inst-1', 'shop')).not.toBe(cartStorageKey('inst-2', 'shop'));
    });
});

describe('the cart store', () => {
    const memory = (): CartStorage & { data: Map<string, string> } => {
        const data = new Map<string, string>();
        return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
    };

    beforeEach(() => {
        useCommerceCart.setState({ key: null, cart: EMPTY_CART, hydrated: false, drawerOpen: false, lastAdded: null });
    });

    it('saves every change under the site key and reads it back', () => {
        const storage = memory();
        const store = useCommerceCart.getState();
        store.bind('inst-1', 'shop', storage);
        expect(useCommerceCart.getState().hydrated).toBe(true);
        expect(store.add(line())).toBe('added');
        expect(store.add(line())).toBe('increased');
        store.setQuantity('v-1', 5);
        store.setPincode('482001');
        const saved = JSON.parse(storage.data.get('commerce-cart:inst-1:shop') as string) as CartState;
        expect(saved.lines[0]).toMatchObject({ variantId: 'v-1', quantity: 5 });
        expect(saved.pincode).toBe('482001');

        // A fresh page of the same site finds the cart; another site finds none.
        useCommerceCart.setState({ key: null, cart: EMPTY_CART, hydrated: false });
        useCommerceCart.getState().bind('inst-1', 'shop', storage);
        expect(cartCount(useCommerceCart.getState().cart)).toBe(5);
        useCommerceCart.getState().bind('inst-2', 'shop', storage);
        expect(useCommerceCart.getState().cart.lines).toEqual([]);
    });

    it('marks what was just added and forgets it when the drawer closes', () => {
        const store = useCommerceCart.getState();
        store.bind('inst-1', 'shop', memory());
        store.add(line());
        store.openDrawer();
        expect(useCommerceCart.getState()).toMatchObject({ lastAdded: 'v-1', drawerOpen: true });
        store.closeDrawer();
        expect(useCommerceCart.getState()).toMatchObject({ lastAdded: null, drawerOpen: false });
    });

    it('works without storage (private mode) and survives a broken stored value', () => {
        const store = useCommerceCart.getState();
        store.bind('inst-1', 'shop', null);
        expect(store.add(line())).toBe('added');
        expect(cartCount(useCommerceCart.getState().cart)).toBe(1);

        const broken = memory();
        broken.data.set('commerce-cart:inst-3:shop', '{not json');
        useCommerceCart.getState().bind('inst-3', 'shop', broken);
        expect(useCommerceCart.getState().cart).toEqual(EMPTY_CART);
    });

    it('removes a line', () => {
        const store = useCommerceCart.getState();
        store.bind('inst-1', 'shop', memory());
        store.add(line());
        store.remove('v-1');
        expect(useCommerceCart.getState().cart.lines).toEqual([]);
        expect(useCommerceCart.getState().lastAdded).toBeNull();
    });
});
