/**
 * Prices a basket as a WHOLE, instead of adding up what each course costs.
 *
 * MIRROR OF THE SERVER. BasketPricingCalculator.java is authoritative — the
 * enrollment endpoint recomputes the total and overwrites whatever the client
 * sends. If these two disagree the visitor is shown one price and charged
 * another, so a rule change belongs in both files at once.
 *
 * Why it REPLACES the sum rather than discounting it: on a catalogue that sells
 * "any 3 subjects for ₹799" the courses carry no price of their own (iThinkers'
 * are all ₹0), so a percentage off the sum is a percentage of nothing.
 *
 * The rules, in full:
 *  - `pricingBasis` picks what the rules mean. FLAT (default) reads `ladder` as
 *    ABSOLUTE prices — the only thing that works when the courses are ₹0 and
 *    carry no price to discount. DISCOUNT reads `tiers` as a reduction off what
 *    the courses actually cost on their enroll invites, so the single-subject
 *    rate has ONE home: the payment plan. Under FLAT it is written down twice,
 *    here and on the plan, and the two drift apart;
 *  - the ladder gives a price for a basket of 1, 2, 3 … and `perExtra` for each
 *    course beyond the last listed price;
 *  - a tier is {minCourses, type: PERCENT|AMOUNT, value}. The highest
 *    minCourses the basket reaches wins, so a tier at 3 also covers 4, 5, … —
 *    which is the point of a percentage: it scales without a rung per count;
 *  - groups split the basket. `ladderScope: 'GROUP'` (default) runs the ladder
 *    inside each group, so a parent buying one subject each for two children
 *    pays two single-subject prices; `'BASKET'` runs it across everything, so
 *    those two reach the two-subject price. Which is right is a commercial
 *    decision, so it is a setting. Full packs and combos stay per-group either
 *    way — a "full grade pack" only means something within one grade;
 *  - a group whose selection covers EVERY level configured for it can take a
 *    `wholeGroupPrices` entry — the "full grade pack";
 *  - a combo is a set of package names at a fixed price, matched inside a
 *    group. Matched on package, not level, so ONE entry covers every class;
 *  - the LOWEST applicable price wins, so a bigger basket never costs more.
 *
 * Grouping uses admin-authored level lists, never a class parsed out of a level
 * name: the real names drift ("Cyber AI- Class 6", "Social Science Class - 5")
 * and some courses are filed under another subject's level entirely.
 */

export interface BasketPricingGroup {
    label: string;
    /** Level names belonging to this group. */
    levels: string[];
    /**
     * Price for taking EVERY level in this group — the "full grade pack".
     * Exact per group, so it keeps working when a class gains or loses a
     * subject; `wholeGroupPrices` is the fragile count-keyed fallback.
     */
    packPrice?: number;
}

export interface BasketPricingCombo {
    label: string;
    /** Package (course) names that must be selected EXACTLY, within one group. */
    packages: string[];
    price: number;
}

export interface BasketPricingTier {
    /** Applies once the basket reaches this many courses. */
    minCourses?: number;
    /** Applies once the courses cost at least this much. */
    minAmount?: number;
    /**
     * Closes the band at the top, so "₹500–₹999 → 10%" is expressible without
     * fighting the next rule. Absent or zero means open-ended.
     */
    maxAmount?: number;
    type: 'PERCENT' | 'AMOUNT';
    /** Percent of the item total, or a flat currency amount. */
    value: number;
    /** Ceiling in currency for a PERCENT tier. Absent or zero means no cap. */
    maxDiscount?: number;
}

export interface BasketPricingSettings {
    enabled: boolean;
    /**
     * FLAT (default) prices by count via `ladder`. DISCOUNT reduces what the
     * courses cost on their enroll invites via `tiers`.
     */
    pricingBasis?: 'FLAT' | 'DISCOUNT';
    tiers?: BasketPricingTier[];
    ladder: {
        /** Price for a basket of 1, 2, 3 … in order. */
        prices: number[];
        /** Added for each course beyond the last listed price. */
        perExtra: number;
    };
    groups?: BasketPricingGroup[];
    /**
     * Where the ladder counts. GROUP (default) prices each group on its own;
     * BASKET counts every subject together, giving a parent buying for two
     * children the multi-subject rate.
     */
    ladderScope?: 'GROUP' | 'BASKET';
    /** Count → price, applied only when a group is fully covered. */
    wholeGroupPrices?: Record<string, number>;
    combos?: BasketPricingCombo[];
}

/** One selected course, reduced to what pricing cares about. */
export interface BasketItem {
    levelName?: string | null;
    packageName?: string | null;
    /** What its payment plan charges on the enroll invite. */
    price?: number | null;
}

export interface BasketQuoteLine {
    label: string;
    amount: number;
    /**
     * What this group's courses cost bought separately. The checkout needs it to
     * say "₹1,047 → ₹799, save ₹248" instead of quoting a bare ₹799 the parent
     * has no way to judge.
     */
    baseAmount: number;
    /** How this group's price was reached, shown in the summary. */
    how: string;
    count: number;
}

export interface BasketQuote {
    total: number;
    /** Sum of every line's baseAmount. */
    itemTotal: number;
    lines: BasketQuoteLine[];
}

const key = (v?: string | null) => (v ?? '').trim().toLowerCase();

export const parseBasketPricing = (
    settingsJson?: string | null
): BasketPricingSettings | undefined => {
    if (!settingsJson) return undefined;
    try {
        const cfg = JSON.parse(settingsJson)?.basketPricing as BasketPricingSettings | undefined;
        if (!cfg?.enabled) return undefined;
        // A DISCOUNT page needs no ladder at all — its base comes from the
        // courses. A FLAT page with no prices cannot price anything, so treat it
        // as unconfigured and fall back to item prices rather than to free.
        if (cfg.pricingBasis === 'DISCOUNT') return cfg;
        return cfg.ladder?.prices?.length ? cfg : undefined;
    } catch {
        return undefined;
    }
};

/** prices[n-1] while the list lasts, then the last price plus perExtra each. */
export const ladderPrice = (prices: number[], perExtra: number, count: number): number => {
    if (count <= 0) return 0;
    if (count <= prices.length) return prices[count - 1] ?? 0;
    return (prices[prices.length - 1] ?? 0) + perExtra * (count - prices.length);
};

const isDiscountBasis = (settings: BasketPricingSettings): boolean =>
    settings.pricingBasis === 'DISCOUNT';

/**
 * What a set of courses costs on its own.
 *
 * Falls back to the ladder's single-subject rate when the courses are ₹0 — a
 * FLAT page with free courses still needs something to measure the saving
 * against, and the one-subject rung is the figure its price card advertises.
 */
const baseFor = (settings: BasketPricingSettings, picked: BasketItem[]): number => {
    const sum = picked.reduce((total, item) => total + (item.price ?? 0), 0);
    if (sum > 0) return sum;
    return (settings.ladder?.prices?.[0] ?? 0) * picked.length;
};

/**
 * Whether a basket of this size and value reaches a tier's conditions.
 *
 * A tier with neither condition would fire on any basket at all, including a
 * single free course — treat it as unconfigured rather than as "always on".
 */
export const tierApplies = (
    tier: BasketPricingTier,
    base: number,
    count: number
): boolean => {
    const minCourses = tier.minCourses ?? 0;
    const minAmount = tier.minAmount ?? 0;
    if (minCourses <= 0 && minAmount <= 0) return false;
    if (minCourses > 0 && count < minCourses) return false;
    if (minAmount > 0 && base < minAmount) return false;
    const maxAmount = tier.maxAmount ?? 0;
    // Zero means open-ended, so only a positive ceiling closes the band.
    return !(maxAmount > 0 && base > maxAmount);
};

/** What a qualifying tier takes off, before the caller caps it at the base. */
export const tierAmount = (tier: BasketPricingTier, base: number): number => {
    const value = tier.value ?? 0;
    if (value <= 0) return 0;
    let off = tier.type === 'AMOUNT' ? value : (base * value) / 100;
    const cap = tier.maxDiscount ?? 0;
    if (cap > 0) off = Math.min(off, cap);
    return Math.max(0, off);
};

/**
 * The discount for this basket: the BEST of every tier it qualifies for.
 *
 * A tier is gated on how MANY courses, on how MUCH they cost, or on both — and
 * when both are set both must hold, the same reading the page's offers give the
 * same two field names.
 *
 * Best, not highest-threshold: a tier list where a later rung happens to be
 * worth less ("2+ → ₹500 off, 5+ → 10% off") would otherwise take the discount
 * AWAY from a parent for adding a fifth subject. Identical for the normal
 * increasing ladder.
 *
 * `base` is the group's own item total under GROUP scope, so an amount
 * threshold is judged against what THAT class costs — the same figure the tier
 * then discounts.
 */
export const tierDiscount = (
    settings: BasketPricingSettings,
    base: number,
    count: number
): number => {
    let best = 0;
    for (const tier of settings.tiers ?? []) {
        if (!tierApplies(tier, base, count)) continue;
        best = Math.max(best, tierAmount(tier, base));
    }
    return Math.min(Math.max(0, best), base);
};

/**
 * What a set of courses costs under the page's ordinary rule — the ladder under
 * FLAT, the item sum less its best tier under DISCOUNT — before full packs and
 * combos get their turn at beating it.
 *
 * Factored out because a combo now prices its EXTENSION with it: growing a
 * matched combo by one subject must cost what growing any basket by one subject
 * costs, and the only honest source for that is the same function.
 */
const groupPrice = (settings: BasketPricingSettings, picked: BasketItem[]): number => {
    if (picked.length === 0) return 0;
    const base = baseFor(settings, picked);
    return isDiscountBasis(settings)
        ? base - tierDiscount(settings, base, picked.length)
        : ladderPrice(settings.ladder?.prices ?? [], settings.ladder?.perExtra ?? 0, picked.length);
};

const groupBasket = (
    settings: BasketPricingSettings,
    items: BasketItem[]
): Map<string, BasketItem[]> => {
    const levelToGroup = new Map<string, string>();
    for (const group of settings.groups ?? []) {
        for (const level of group.levels ?? []) levelToGroup.set(key(level), group.label);
    }
    const out = new Map<string, BasketItem[]>();
    for (const item of items) {
        const label = levelToGroup.get(key(item.levelName)) ?? '';
        out.set(label, [...(out.get(label) ?? []), item]);
    }
    return out;
};

export const quoteBasket = (
    settings: BasketPricingSettings | undefined,
    items: BasketItem[]
): BasketQuote | null => {
    if (!settings || items.length === 0) return null;

    const { prices, perExtra } = settings.ladder;
    const lines: BasketQuoteLine[] = [];

    for (const [label, picked] of groupBasket(settings, items)) {
        const count = picked.length;
        const base = baseFor(settings, picked);
        // Kept separate from `best`: a full pack may lower `best` below it, and
        // the combo extension below has to measure against the ORDINARY price
        // of this group, not against whatever rule is currently winning.
        const ordinary = groupPrice(settings, picked);
        let best = ordinary;
        let how = `${count} subject${count === 1 ? '' : 's'}`;

        // Full pack — every level configured for this group is in the basket.
        const configured = (settings.groups ?? [])
            .filter((g) => g.label === label)
            .flatMap((g) => g.levels ?? [])
            .map(key);
        if (label && configured.length > 0) {
            const pickedLevels = new Set(picked.map((p) => key(p.levelName)));
            const ownPack = (settings.groups ?? []).find((g) => g.label === label)?.packPrice;
            const packPrice =
                typeof ownPack === 'number' && ownPack > 0
                    ? ownPack
                    : settings.wholeGroupPrices?.[String(count)];
            if (
                configured.every((l) => pickedLevels.has(l)) &&
                typeof packPrice === 'number' &&
                packPrice < best
            ) {
                best = packPrice;
                how = 'full pack';
            }
        }

        // Combo — the group CONTAINS a combo's packages.
        //
        // A subset, not an exact set. All-or-nothing matching is what made a
        // Class 5 basket jump ₹200 for the fourth subject: English+Maths+
        // Science took the ₹749 EMS combo, adding G.K. stopped the combo
        // matching, and the basket fell back onto the plain ₹949 rung — so a
        // page advertising "+₹150 for each extra subject" charged ₹200 for it.
        //
        // The extension is priced at exactly what this page charges to grow a
        // basket from the combo's size to this one, so the combo's own saving
        // rides along instead of evaporating: 749 + (949 − 799) = 899. At an
        // exact match the extension is 0, which is the old behaviour untouched.
        for (const combo of settings.combos ?? []) {
            const comboPackages = new Set((combo.packages ?? []).map(key));
            if (comboPackages.size === 0) continue;
            const inCombo = picked.filter((p) => comboPackages.has(key(p.packageName)));
            // One basket line per named package, or the combo is ambiguous —
            // which of two courses sharing a package name did the price cover?
            if (inCombo.length !== comboPackages.size) continue;
            const price = combo.price + (ordinary - groupPrice(settings, inCombo));
            if (price < best) {
                best = price;
                const extras = count - inCombo.length;
                how = extras > 0 ? `${combo.label} + ${extras} more` : combo.label;
            }
        }

        // Under DISCOUNT the base IS the starting point, so a misconfigured tier
        // must never push the basket above it. Under FLAT the ladder deliberately
        // REPLACES the item sum in both directions — capping there would silently
        // reprice every existing page whose courses undercut its own ladder.
        if (isDiscountBasis(settings) && base > 0) best = Math.min(best, base);

        lines.push({ label: label || 'Your selection', amount: best, baseAmount: base, how, count });
    }

    const grouped = Math.round(lines.reduce((sum, l) => sum + l.amount, 0));
    const itemTotal = Math.round(lines.reduce((sum, l) => sum + l.baseAmount, 0));

    if (settings.ladderScope === 'BASKET') {
        // One ladder over the whole basket. Never worse than pricing the groups
        // apart — a full pack or combo inside one group can still beat it.
        const whole = isDiscountBasis(settings)
            ? itemTotal - tierDiscount(settings, itemTotal, items.length)
            : ladderPrice(prices, perExtra, items.length);
        if (whole < grouped) {
            return {
                total: Math.max(0, Math.round(whole)),
                itemTotal,
                lines: [
                    {
                        label: 'Your selection',
                        amount: whole,
                        baseAmount: itemTotal,
                        how: `${items.length} subject${items.length === 1 ? '' : 's'}`,
                        count: items.length,
                    },
                ],
            };
        }
    }

    return { total: Math.max(0, grouped), itemTotal, lines };
};

/**
 * What the basket saves against buying each course on its own.
 *
 * This is the number the price card advertises ("Save ₹248 vs 3×singles"), and
 * it is the only saving worth showing under basket pricing: the courses have no
 * individual price to discount, so the comparison is against the ladder's own
 * one-subject rate.
 */
export const savingsVsSingles = (
    settings: BasketPricingSettings | undefined,
    quote: BasketQuote | null
): number => {
    if (!settings || !quote) return 0;
    return Math.max(0, Math.round(quote.itemTotal - quote.total));
};

/**
 * The next discount tier the basket has not reached, and exactly how far away.
 *
 * Two gaps, because a tier can be gated on either or both: `coursesAway` is how
 * many more courses it needs, `amountAway` how much more spend. Whichever is
 * non-zero is what the visitor must actually do, so the UI can say "add 1 more
 * subject" or "spend ₹120 more" rather than guessing.
 *
 * Only tiers that would BEAT the discount already applied are returned —
 * nudging someone toward a rung worth less than what they have is worse than
 * saying nothing. And a tier is only offered when reaching it is possible:
 * an unreachable band (maxAmount already exceeded) is skipped.
 *
 * `base` lets the label quote the EXTRA saving rather than the new total. A
 * basket already holding ₹99 off does not gain ₹248 by adding one more — it
 * gains ₹149, and promising the larger number is the kind of thing a parent
 * notices at the payment screen.
 */
export const nextTier = (
    settings: BasketPricingSettings | undefined,
    count: number,
    base = 0
): {
    coursesAway: number;
    amountAway: number;
    /** English, for the surfaces that are not translated yet. */
    label: string;
    /** The same fact as data, so a translated surface can phrase it itself. */
    offer: { type: 'PERCENT' | 'AMOUNT'; value: number; incremental: boolean };
} | null => {
    if (!settings || !isDiscountBasis(settings)) return null;

    const alreadyOff = base > 0 ? tierDiscount(settings, base, count) : 0;

    // A gap in rupees and a gap in courses are not directly comparable, so
    // convert spend into "courses to add" at what this basket's courses
    // actually cost. Without that, a tier needing ₹1,300 more looked NEARER
    // than one needing a single subject, purely because its course gap was 0.
    const avgPrice = count > 0 && base > 0 ? base / count : 0;

    let best: {
        tier: BasketPricingTier;
        coursesAway: number;
        amountAway: number;
        effort: number;
    } | null = null;
    for (const tier of settings.tiers ?? []) {
        if (tierApplies(tier, base, count)) continue;
        const minCourses = tier.minCourses ?? 0;
        const minAmount = tier.minAmount ?? 0;
        if (minCourses <= 0 && minAmount <= 0) continue; // unconfigured

        const maxAmount = tier.maxAmount ?? 0;
        // Already past the top of this band — no amount of adding gets back in.
        if (maxAmount > 0 && base > maxAmount) continue;

        const coursesAway = Math.max(0, minCourses - count);
        const amountAway = Math.max(0, Math.ceil(minAmount - base));
        if (coursesAway === 0 && amountAway === 0) continue;

        // Worth reaching? Compare at the base it would be judged on. Skipped
        // when there is no basket yet: a PERCENT tier of nothing is nothing,
        // and filtering on that would hide every percentage tier from an empty
        // or unpriced cart.
        const projected = Math.max(base, minAmount);
        if (base > 0 && tierAmount(tier, projected) <= alreadyOff) continue;

        const spendAsCourses =
            amountAway > 0 ? (avgPrice > 0 ? Math.ceil(amountAway / avgPrice) : Infinity) : 0;
        const effort = Math.max(coursesAway, spendAsCourses);

        if (
            best === null ||
            effort < best.effort ||
            (effort === best.effort && amountAway < best.amountAway)
        ) {
            best = { tier, coursesAway, amountAway, effort };
        }
    }
    if (!best) return null;

    const { tier, coursesAway, amountAway } = best;
    const projected = Math.max(base, tier.minAmount ?? 0);
    let label: string;
    let offer: { type: 'PERCENT' | 'AMOUNT'; value: number; incremental: boolean };
    if (tier.type === 'AMOUNT') {
        const full = tierAmount(tier, projected);
        const extra = Math.round(full - alreadyOff);
        const incremental = alreadyOff > 0 && extra > 0;
        offer = { type: 'AMOUNT', value: incremental ? extra : Math.round(full), incremental };
        label = incremental ? `₹${extra} more off` : `₹${Math.round(full)} off`;
    } else {
        offer = { type: 'PERCENT', value: tier.value, incremental: false };
        label = `${tier.value}% off`;
    }
    return { coursesAway, amountAway, label, offer };
};

/** The saving as a percentage of what the courses cost apart. 0 when there is none. */
export const savingsPercent = (quote: BasketQuote | null): number => {
    if (!quote || quote.itemTotal <= 0) return 0;
    return Math.max(0, Math.round(((quote.itemTotal - quote.total) / quote.itemTotal) * 100));
};

/**
 * What ONE more course would actually add, and where.
 *
 * Derived from the QUOTE, not from the basket's total count — under GROUP scope
 * the ladder runs inside each group, so a basket of two subjects in two
 * different classes is at step 1 twice, not at step 2. Reading the total count
 * there promised "₹200 for the next one" while the engine would have charged
 * ₹250 to add it to a class.
 *
 * Returns the cheapest option: extending an existing group, or starting a new
 * one at the first-subject price.
 */
export const nextCourseCost = (
    settings: BasketPricingSettings | undefined,
    quote: BasketQuote | null
): { amount: number; group: string | null } | null => {
    if (!settings || !quote) return null;
    // Under DISCOUNT the next course's cost depends on ITS price, which is not
    // known until it is picked. Quoting a number here would be a guess; the
    // honest nudge there is the next tier — see nextTier below.
    if (isDiscountBasis(settings)) return null;
    const { prices, perExtra } = settings.ladder;

    if (settings.ladderScope === 'BASKET') {
        const total = quote.lines.reduce((sum, l) => sum + l.count, 0);
        return {
            amount: ladderPrice(prices, perExtra, total + 1) - ladderPrice(prices, perExtra, total),
            group: null,
        };
    }

    let best: { amount: number; group: string | null } | null = null;
    for (const line of quote.lines) {
        const amount =
            ladderPrice(prices, perExtra, line.count + 1) - ladderPrice(prices, perExtra, line.count);
        if (best === null || amount < best.amount) best = { amount, group: line.label };
    }
    // Starting a fresh group costs the first-subject price — sometimes cheaper
    // than extending a group that is already deep into the ladder.
    const fresh = ladderPrice(prices, perExtra, 1);
    if (best === null || fresh < best.amount) best = { amount: fresh, group: null };
    return best;
};

/**
 * Which pricing group a course falls in, or '' when it belongs to none.
 *
 * Exported so the cart can group what it SHOWS exactly the way the engine
 * groups what it CHARGES. Two different groupings on one screen is how "why is
 * this one ₹250 and that one ₹349" starts.
 */
export const groupLabelFor = (
    settings: BasketPricingSettings | undefined,
    item: BasketItem
): string => {
    for (const group of settings?.groups ?? []) {
        if ((group.levels ?? []).some((l) => key(l) === key(item.levelName))) return group.label;
    }
    return '';
};
