import type { ProductPageData, ProductPageStep } from '../-types/product-page-types';

type PageIdentity = Pick<ProductPageData, 'id' | 'code'>;

/**
 * Is `next` a different product page from the one the (module-level) store
 * last served? Then its coupon, discount, learner and CPO state must not carry
 * over. Nothing served yet, or the same page again, is not a switch.
 */
export const isDifferentProductPage = (
    previous: PageIdentity | null | undefined,
    next: PageIdentity
): boolean => {
    if (!previous) return false;
    const key = (p: PageIdentity) => (p.id || p.code || '').trim();
    return key(previous) !== key(next);
};

/** The same courses, in any order. */
export const isSameSelection = (a: readonly string[], b: readonly string[]): boolean => {
    const inA = new Set(a);
    const inB = new Set(b);
    return inA.size === inB.size && [...inB].every((id) => inA.has(id));
};

/**
 * What the store keeps when a product page mounts.
 *
 * RESET — start clean: another page was served, or the last order on this one
 * finished (its coupon, learner and CPO plan belong to that order).
 * NEW_BASKET — same page, a different selection: the coupon and the CPO plan
 * and instalment pick were worked out for the previous basket and go; the rest
 * stays.
 * KEEP — same page, same selection, nothing finished: everything stays,
 * exactly as before.
 */
export type CheckoutEntry = 'RESET' | 'NEW_BASKET' | 'KEEP';

export const checkoutEntryOf = (
    stored: {
        pageData: PageIdentity | null | undefined;
        step: ProductPageStep;
        selectedPsOptionIds: readonly string[];
    },
    next: PageIdentity,
    nextSelection: readonly string[]
): CheckoutEntry => {
    if (isDifferentProductPage(stored.pageData, next) || stored.step === 'SUCCESS') return 'RESET';
    if (!isSameSelection(stored.selectedPsOptionIds, nextSelection)) return 'NEW_BASKET';
    return 'KEEP';
};
