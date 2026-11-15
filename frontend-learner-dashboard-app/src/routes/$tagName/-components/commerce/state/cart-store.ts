/**
 * The shop cart of the site on screen: a zustand store over cart-logic.ts, saved in
 * localStorage per site (institute + catalogue tag) and per device. One store for the whole
 * page, so the header count, the drawer and the product page agree; other tabs follow through
 * the storage event.
 */
import { create } from 'zustand';
import {
    EMPTY_CART,
    addLine,
    applyPrice,
    cartStorageKey,
    removeLine,
    reviveCart,
    setPincode,
    setQuantity,
    type AddResult,
    type CartLine,
    type CartState,
} from './cart-logic';
import type { CartPrice } from '../api/types';

export interface CartStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

const browserStorage = (): CartStorage | null => {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
};

interface CartStore {
    /** Storage key of the site the cart belongs to; null until a site is bound. */
    key: string | null;
    cart: CartState;
    hydrated: boolean;
    drawerOpen: boolean;
    /** Variant id of the line just added, for the "added" confirmation in the drawer. */
    lastAdded: string | null;
    bind(instituteId: string, tagName: string, storage?: CartStorage | null): void;
    add(line: Omit<CartLine, 'addedAt'>): AddResult['outcome'];
    setQuantity(variantId: string, quantity: number): void;
    remove(variantId: string): void;
    setPincode(pincode: string | null): void;
    applyPrice(price: CartPrice): void;
    /** Empties the cart (after a paid or a cash-on-delivery order). */
    clear(): void;
    openDrawer(): void;
    closeDrawer(): void;
}

let storage: CartStorage | null = null;

const save = (key: string | null, cart: CartState) => {
    if (!key || !storage) return;
    try {
        storage.setItem(key, JSON.stringify(cart));
    } catch {
        // Private mode or a full quota: the cart lasts as long as the page does.
    }
};

const load = (key: string): CartState => {
    if (!storage) return EMPTY_CART;
    try {
        const raw = storage.getItem(key);
        return raw ? reviveCart(JSON.parse(raw)) : EMPTY_CART;
    } catch {
        return EMPTY_CART;
    }
};

export const useCommerceCart = create<CartStore>((set, get) => {
    const commit = (cart: CartState, extra: Partial<CartStore> = {}) => {
        if (cart === get().cart && Object.keys(extra).length === 0) return;
        set({ cart, ...extra });
        save(get().key, cart);
    };
    return {
        key: null,
        cart: EMPTY_CART,
        hydrated: false,
        drawerOpen: false,
        lastAdded: null,
        bind: (instituteId, tagName, custom) => {
            const key = cartStorageKey(instituteId, tagName);
            if (get().key === key && get().hydrated) return;
            storage = custom === undefined ? browserStorage() : custom;
            set({ key, cart: load(key), hydrated: true, lastAdded: null });
        },
        add: (line) => {
            const result = addLine(get().cart, line);
            if (result.outcome !== 'full') commit(result.cart, { lastAdded: line.variantId });
            return result.outcome;
        },
        setQuantity: (variantId, quantity) => commit(setQuantity(get().cart, variantId, quantity)),
        remove: (variantId) =>
            commit(removeLine(get().cart, variantId), get().lastAdded === variantId ? { lastAdded: null } : {}),
        setPincode: (pincode) => commit(setPincode(get().cart, pincode)),
        applyPrice: (price) => commit(applyPrice(get().cart, price)),
        clear: () => commit({ ...EMPTY_CART, pincode: get().cart.pincode }, { lastAdded: null }),
        openDrawer: () => set({ drawerOpen: true }),
        closeDrawer: () => set({ drawerOpen: false, lastAdded: null }),
    };
});

/** Another tab changed this site's cart: follow it. Returns the unsubscribe. */
export const followOtherTabs = (): (() => void) => {
    if (typeof window === 'undefined') return () => {};
    const onStorage = (event: StorageEvent) => {
        const { key } = useCommerceCart.getState();
        if (!key || event.key !== key) return;
        useCommerceCart.setState({ cart: load(key) });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
};
