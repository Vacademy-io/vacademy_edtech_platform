import { create } from 'zustand';
import type {
    ProductPageData,
    ProductPageStep,
    FieldValue,
} from '../-types/product-page-types';
import { parseBasketPricing, quoteBasket, type BasketQuote } from '../-utils/basket-pricing';
import { bestOffer, parseOffers, type AppliedOffer } from '../-utils/offers';

interface ProductPageStore {
    // Server data
    pageData: ProductPageData | null;
    setPageData: (data: ProductPageData) => void;
    /**
     * The page arrived again after the checkout started — the refetch after a
     * 409 "price changed", or a background refresh. Every total is priced from
     * this copy, so it takes the new one; a selection the page no longer sells
     * is dropped, and so is a coupon whose discount was worked out for a basket
     * that no longer costs the same (the learner can apply it again).
     */
    syncPageData: (data: ProductPageData) => void;

    // Navigation
    step: ProductPageStep;
    setStep: (step: ProductPageStep) => void;

    // Course selection — stores ps_invite_payment_option_ids
    selectedPsOptionIds: string[];
    toggleSelection: (psOptionId: string) => void;
    setSelection: (psOptionIds: string[]) => void;

    // Coupon
    couponCode: string;
    couponId: string;
    appliedCouponDiscountId: string;
    discountAmount: number;
    setCouponCode: (code: string) => void;
    applyCoupon: (couponId: string, appliedCouponDiscountId: string, discount: number) => void;
    clearCoupon: () => void;

    // Form / user data (from Step 3 — MultiEnrollForm)
    registrationData: Record<string, FieldValue>;
    setRegistrationData: (data: Record<string, FieldValue>) => void;

    // Post form-submit
    userId: string | null;
    abandonedCartIds: string[];
    setFormSubmitResult: (userId: string, abandonedCartIds: string[]) => void;

    /** One-time code from a paid enroll, for autoLoginAfterPayment. */
    loginCode: string | null;
    setLoginCode: (code: string | null) => void;

    // CPO installment state
    cpoUserPlanId: string | null;
    cpoSelectedSfpIds: string[];
    cpoSelectedTotal: number;
    cpoCustomAmount: number | undefined;
    setCpoEnrollResult: (userPlanId: string) => void;
    setCpoSelection: (sfpIds: string[], total: number) => void;
    setCpoCustomAmount: (amount: number | undefined) => void;

    /**
     * A different basket on the same page: the coupon and the CPO plan and
     * instalment pick were worked out for the previous one, so they go. The
     * learner's details stay.
     */
    clearBasketState: () => void;

    // UTM params (forwarded from URL)
    utmParams: Record<string, string>;
    setUtmParams: (params: Record<string, string>) => void;

    // Computed
    totalPrice: () => number;
    /**
     * The cart at the plans' own (base) prices when the server priced it for the viewer's
     * region, else null. Coupon amounts are written in the base currency, so the coupon is
     * checked against this figure and the server scales the discount to the regional one.
     */
    regionalBaseTotal: () => number | null;
    /**
     * Whole-basket price, when the page is configured for one. Null means the
     * page prices per course and totalPrice() stands.
     */
    basketQuote: () => BasketQuote | null;
    /** Best predefined page offer for the current cart, or null. */
    appliedOffer: () => AppliedOffer | null;
    /**
     * What the basket costs before any coupon: the basket price (or the sum of
     * the courses), less the best offer. The server works a coupon out on this
     * figure at enrolment, so the cart asks about a coupon on it too.
     */
    priceBeforeCoupon: () => number;
    finalPrice: () => number;

    reset: () => void;
}

const noCoupon = {
    couponCode: '',
    couponId: '',
    appliedCouponDiscountId: '',
    discountAmount: 0,
};

const noCpoState = {
    cpoUserPlanId: null,
    cpoSelectedSfpIds: [],
    cpoSelectedTotal: 0,
    cpoCustomAmount: undefined,
};

const initialState = {
    pageData: null,
    step: 'CATALOG' as ProductPageStep,
    selectedPsOptionIds: [],
    ...noCoupon,
    registrationData: {},
    userId: null,
    abandonedCartIds: [],
    loginCode: null,
    utmParams: {},
    ...noCpoState,
};

export const useProductPageStore = create<ProductPageStore>((set, get) => ({
    ...initialState,

    setPageData: (data) => set({ pageData: data }),

    syncPageData: (data) => {
        const before = get();
        if (before.pageData === data) return;
        const onSale = new Set(
            data.mappings
                .filter((m) => m.status === 'ACTIVE')
                .map((m) => m.ps_invite_payment_option_id)
        );
        const kept = before.selectedPsOptionIds.filter((id) => onSale.has(id));
        const selectionChanged = kept.length !== before.selectedPsOptionIds.length;
        const priceBefore = before.priceBeforeCoupon();

        set(selectionChanged ? { pageData: data, selectedPsOptionIds: kept } : { pageData: data });

        const hadCoupon = !!before.couponCode || !!before.couponId || before.discountAmount > 0;
        if (hadCoupon && (selectionChanged || get().priceBeforeCoupon() !== priceBefore)) {
            set(noCoupon);
        }
    },

    setStep: (step) => set({ step }),

    toggleSelection: (psOptionId) => {
        const { selectedPsOptionIds, pageData } = get();
        const settings = pageData?.settings_json
            ? (() => { try { return JSON.parse(pageData.settings_json); } catch { return {}; } })()
            : {};
        const allowDeselect = settings.allowCourseDeselection !== false;

        if (selectedPsOptionIds.includes(psOptionId)) {
            if (allowDeselect) {
                set({ selectedPsOptionIds: selectedPsOptionIds.filter((id) => id !== psOptionId) });
            }
        } else {
            set({ selectedPsOptionIds: [...selectedPsOptionIds, psOptionId] });
        }
    },

    setSelection: (psOptionIds) => set({ selectedPsOptionIds: psOptionIds }),

    setCouponCode: (code) => set({ couponCode: code }),

    applyCoupon: (couponId, appliedCouponDiscountId, discount) =>
        set({ couponId, appliedCouponDiscountId, discountAmount: discount }),

    clearCoupon: () => set(noCoupon),

    setRegistrationData: (data) => set({ registrationData: data }),

    setFormSubmitResult: (userId, abandonedCartIds) => set({ userId, abandonedCartIds }),

    setLoginCode: (loginCode) => set({ loginCode }),

    setCpoEnrollResult: (userPlanId) => set({ cpoUserPlanId: userPlanId }),

    setCpoSelection: (sfpIds, total) => set({ cpoSelectedSfpIds: sfpIds, cpoSelectedTotal: total }),

    setCpoCustomAmount: (amount) => set({ cpoCustomAmount: amount }),

    clearBasketState: () => set({ ...noCoupon, ...noCpoState }),

    setUtmParams: (params) => set({ utmParams: params }),

    totalPrice: () => {
        const { pageData, selectedPsOptionIds } = get();
        if (!pageData) return 0;
        return pageData.mappings
            .filter((m) => selectedPsOptionIds.includes(m.ps_invite_payment_option_id))
            .reduce((sum, m) => sum + (m.payment_plan?.actual_price ?? 0), 0);
    },

    regionalBaseTotal: () => {
        const { pageData, selectedPsOptionIds } = get();
        if (!pageData) return null;
        const selected = pageData.mappings.filter((m) =>
            selectedPsOptionIds.includes(m.ps_invite_payment_option_id)
        );
        // The server prices a product-page cart regionally all or nothing, so one
        // regionally priced course means the whole cart is.
        if (!selected.some((m) => m.payment_plan?.pricing_country)) return null;
        return selected.reduce(
            (sum, m) =>
                sum + (m.payment_plan?.base_actual_price ?? m.payment_plan?.actual_price ?? 0),
            0
        );
    },

    basketQuote: () => {
        const { pageData, selectedPsOptionIds } = get();
        if (!pageData) return null;
        const selected = pageData.mappings.filter((m) =>
            selectedPsOptionIds.includes(m.ps_invite_payment_option_id)
        );
        return quoteBasket(
            parseBasketPricing(pageData.settings_json),
            // The plan's own price rides along: a DISCOUNT-basis page reduces
            // that sum rather than replacing it, so the single-subject rate is
            // read from the enroll invite instead of the page settings.
            selected.map((m) => ({
                levelName: m.level_name,
                packageName: m.package_name,
                price: m.payment_plan?.actual_price ?? 0,
            }))
        );
    },

    appliedOffer: () => {
        const { pageData, selectedPsOptionIds } = get();
        if (!pageData) return null;
        const quote = get().basketQuote();
        const base = quote ? quote.total : get().totalPrice();
        return bestOffer(parseOffers(pageData.settings_json), base, selectedPsOptionIds.length);
    },

    // Same order the server applies them: a configured basket price REPLACES
    // the sum of item prices, then the best offer comes off.
    priceBeforeCoupon: () => {
        const quote = get().basketQuote();
        const base = quote ? quote.total : get().totalPrice();
        return Math.max(0, base - (get().appliedOffer()?.amount ?? 0));
    },

    // The coupon comes off last, so it discounts what the visitor would
    // actually have paid (see priceBeforeCoupon).
    finalPrice: () => Math.max(0, get().priceBeforeCoupon() - get().discountAmount),

    reset: () => set(initialState),
}));
