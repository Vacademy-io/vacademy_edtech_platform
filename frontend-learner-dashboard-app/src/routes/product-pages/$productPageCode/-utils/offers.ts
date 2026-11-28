/**
 * Predefined offers on a product page — the "₹99 off on orders above ₹500" strip
 * a food-delivery app shows you.
 *
 * MIRROR OF THE SERVER. OfferCalculator.java is authoritative: the enrolment
 * endpoint recomputes the total and overwrites whatever the client sends, so a
 * rule change belongs in both files at once.
 *
 * These are NOT coupons. A coupon is a code someone types, with its own row,
 * redemption limit and lifecycle. An offer is part of how the page sells —
 * no code, applies by itself, everyone sees the same list — so it lives in the
 * page's settings and needs no schema change to add one.
 *
 * The BEST qualifying rule wins, never several stacked: two innocuous offers
 * that stack are how a cart reaches zero. Applied after basket pricing and
 * before any coupon.
 */

export interface OfferRule {
    id: string;
    label: string;
    /** Cart total at or above this qualifies. Omit for no amount condition. */
    minAmount?: number;
    /** At least this many courses. Omit for no count condition. */
    minCourses?: number;
    discountType: 'FIXED' | 'PERCENTAGE';
    discountValue: number;
    /** Ceiling for a percentage offer. */
    maxDiscount?: number;
}

export interface OffersSettings {
    enabled: boolean;
    rules: OfferRule[];
    /** Heading above the list in the cart. */
    heading?: string;
}

export interface AppliedOffer {
    rule: OfferRule;
    amount: number;
}

export const parseOffers = (settingsJson?: string | null): OffersSettings | undefined => {
    if (!settingsJson) return undefined;
    try {
        const cfg = JSON.parse(settingsJson)?.offers as OffersSettings | undefined;
        return cfg?.enabled && Array.isArray(cfg.rules) && cfg.rules.length > 0 ? cfg : undefined;
    } catch {
        return undefined;
    }
};

const qualifies = (rule: OfferRule, amount: number, courseCount: number): boolean =>
    amount >= (rule.minAmount ?? 0) && courseCount >= (rule.minCourses ?? 0);

/** What one rule takes off, capped and rounded exactly as the server does. */
export const offerDiscount = (rule: OfferRule, amount: number): number => {
    if (!rule.discountValue || rule.discountValue <= 0) return 0;
    let off =
        rule.discountType === 'PERCENTAGE'
            ? (amount * rule.discountValue) / 100
            : rule.discountValue;
    if (rule.maxDiscount && rule.maxDiscount > 0) off = Math.min(off, rule.maxDiscount);
    return Math.max(0, Math.min(Math.round(off), amount));
};

export const bestOffer = (
    settings: OffersSettings | undefined,
    amount: number,
    courseCount: number
): AppliedOffer | null => {
    if (!settings || amount <= 0) return null;
    let best: AppliedOffer | null = null;
    for (const rule of settings.rules) {
        if (!qualifies(rule, amount, courseCount)) continue;
        const off = offerDiscount(rule, amount);
        if (off > 0 && (best === null || off > best.amount)) best = { rule, amount: off };
    }
    return best;
};

/**
 * Every rule with what it would give and what it still needs — the whole point
 * of showing offers rather than silently applying one. "Add ₹151 more to save
 * ₹99" is the line that grows a basket; a discount the visitor never knew they
 * missed does nothing.
 */
export interface OfferStatus {
    rule: OfferRule;
    /** Met right now. */
    unlocked: boolean;
    /** The one actually being applied (the best of the unlocked). */
    applied: boolean;
    /** Currency still needed, when that is what is missing. */
    amountShort: number;
    /** Courses still needed, when that is what is missing. */
    coursesShort: number;
    /** What it would take off at the current cart total. */
    wouldGive: number;
}

export const offerStatuses = (
    settings: OffersSettings | undefined,
    amount: number,
    courseCount: number
): OfferStatus[] => {
    if (!settings) return [];
    const winner = bestOffer(settings, amount, courseCount);
    return settings.rules.map((rule) => ({
        rule,
        unlocked: qualifies(rule, amount, courseCount),
        applied: winner?.rule.id === rule.id,
        amountShort: Math.max(0, (rule.minAmount ?? 0) - amount),
        coursesShort: Math.max(0, (rule.minCourses ?? 0) - courseCount),
        wouldGive: offerDiscount(rule, Math.max(amount, rule.minAmount ?? 0)),
    }));
};
