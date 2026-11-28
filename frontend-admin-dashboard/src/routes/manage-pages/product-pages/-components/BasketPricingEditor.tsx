import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
    BasketPricingCombo,
    BasketPricingGroup,
    BasketPricingSettings,
    BasketPricingTier,
    MappingRow,
} from '../-types/product-page-types';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

/**
 * Authors a whole-basket price: "any 3 subjects for ₹799, ₹150 each after".
 *
 * Every list here is filled from the page's OWN courses — real level and course
 * names, never typed by hand and never a class parsed out of a name. Level
 * names in the wild drift ("Cyber AI- Class 6", "Social Science Class - 5") and
 * some courses sit under another subject's level, so anything derived from
 * their shape would quietly mis-price a basket.
 */

interface Props {
    value: BasketPricingSettings;
    courses: MappingRow[];
    onChange: (next: BasketPricingSettings) => void;
}

const num = (v: string, fallback = 0) => {
    const parsed = Number(v);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export const BasketPricingEditor = ({ value, courses, onChange }: Props) => {
    const courseLower = getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase();
    const coursesTerm = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
    const coursesLower = coursesTerm.toLocaleLowerCase();
    const [openGroup, setOpenGroup] = useState<number | null>(null);
    const [openCombo, setOpenCombo] = useState<number | null>(null);

    const levelNames = useMemo(
        () =>
            [...new Set(courses.map((c) => c.levelName ?? '').filter(Boolean))].sort((a, b) =>
                a.localeCompare(b, undefined, { numeric: true })
            ),
        [courses]
    );
    const courseNames = useMemo(
        () => [...new Set(courses.map((c) => c.packageName ?? '').filter(Boolean))].sort(),
        [courses]
    );

    const set = (patch: Partial<BasketPricingSettings>) => onChange({ ...value, ...patch });
    const prices = value.ladder?.prices ?? [];
    const groups = value.groups ?? [];
    const combos = value.combos ?? [];
    const packs = value.wholeGroupPrices ?? {};
    const tiers = value.tiers ?? [];
    const basis = value.pricingBasis ?? 'FLAT';

    /**
     * The commonest course price on this page. Only used to preview the maths —
     * the engine reads each course's own plan, never this.
     */
    const typicalPrice = useMemo(() => {
        const counts = new Map<number, number>();
        for (const c of courses) {
            const price = c.paymentPlanPrice ?? 0;
            if (price > 0) counts.set(price, (counts.get(price) ?? 0) + 1);
        }
        let best = 0;
        let bestCount = 0;
        for (const [price, n] of counts) {
            if (n > bestCount) {
                best = price;
                bestCount = n;
            }
        }
        return best;
    }, [courses]);

    const setTier = (index: number, patch: Partial<BasketPricingTier>) =>
        set({ tiers: tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)) });

    /** Mirrors tierApplies in the engine — count, spend, or both. */
    const applies = (tier: BasketPricingTier, base: number, count: number) => {
        const minCourses = tier.minCourses ?? 0;
        const minAmount = tier.minAmount ?? 0;
        if (minCourses <= 0 && minAmount <= 0) return false;
        if (minCourses > 0 && count < minCourses) return false;
        if (minAmount > 0 && base < minAmount) return false;
        const maxAmount = tier.maxAmount ?? 0;
        return !(maxAmount > 0 && base > maxAmount);
    };

    /** Mirrors tierAmount: the value, then the optional currency ceiling. */
    const amountOf = (tier: BasketPricingTier, base: number) => {
        const value = tier.value ?? 0;
        if (value <= 0) return 0;
        let off = tier.type === 'AMOUNT' ? value : (base * value) / 100;
        const cap = tier.maxDiscount ?? 0;
        if (cap > 0) off = Math.min(off, cap);
        return Math.max(0, off);
    };

    /** Mirrors tierDiscount: the best tier this basket qualifies for. */
    const discountAt = (count: number, base: number) => {
        let best = 0;
        for (const tier of tiers) {
            if (!applies(tier, base, count)) continue;
            best = Math.max(best, amountOf(tier, base));
        }
        return Math.min(Math.max(0, best), base);
    };

    /** What the ladder charges for a basket of n — mirrors the pricing engine. */
    const ladderAt = (n: number) =>
        n <= prices.length
            ? (prices[n - 1] ?? 0)
            : (prices[prices.length - 1] ?? 0) + (value.ladder?.perExtra ?? 0) * (n - prices.length);

    const setPrice = (index: number, price: number) =>
        set({
            ladder: {
                ...value.ladder,
                prices: prices.map((p, i) => (i === index ? price : p)),
            },
        });

    const setGroup = (index: number, patch: Partial<BasketPricingGroup>) =>
        set({ groups: groups.map((g, i) => (i === index ? { ...g, ...patch } : g)) });

    const setCombo = (index: number, patch: Partial<BasketPricingCombo>) =>
        set({ combos: combos.map((c, i) => (i === index ? { ...c, ...patch } : c)) });

    const toggleIn = (list: string[], item: string) =>
        list.includes(item) ? list.filter((v) => v !== item) : [...list, item];

    return (
        <div className="space-y-4 bg-neutral-50/60 px-5 py-4 ps-14">
            <p className="text-2xs text-neutral-500">
                Prices the basket as a whole rather than {courseLower} by {courseLower}. The
                cheapest applicable rule always wins, so a bigger basket never costs more.
            </p>

            {/* ── Pricing basis ──────────────────────────────────────────────── */}
            <div className="space-y-2">
                <Label className="text-xs">Where the price comes from</Label>
                {(
                    [
                        [
                            'DISCOUNT',
                            `Discount off the ${courseLower} prices`,
                            `The ${coursesLower} keep the price set on their enroll invite and the basket takes a percentage or amount off. Change a price once, on the invite, and every basket follows.`,
                        ],
                        [
                            'FLAT',
                            'A fixed price per number of subjects',
                            `The basket costs a set amount whatever the ${coursesLower} cost. Needed only when the ${coursesLower} are free and there is nothing to discount — otherwise the per-subject rate ends up written down twice and the two drift apart.`,
                        ],
                    ] as const
                ).map(([option, label, hint]) => {
                    const active = basis === option;
                    return (
                        <button
                            key={option}
                            type="button"
                            onClick={() => set({ pricingBasis: option })}
                            className={`w-full rounded border p-2 text-start ${
                                active
                                    ? 'border-primary-400 bg-primary-50'
                                    : 'border-neutral-200 bg-white'
                            }`}
                        >
                            <p className="text-2xs font-semibold text-neutral-700">{label}</p>
                            <p className="mt-0.5 text-2xs text-neutral-500">{hint}</p>
                        </button>
                    );
                })}
                {basis === 'DISCOUNT' && typicalPrice === 0 && (
                    <p className="rounded border border-danger-200 bg-danger-50 p-2 text-2xs text-danger-600">
                        These {coursesLower} have no price on their enroll invites, so there is
                        nothing to discount and every basket will be <strong>free</strong>. Price
                        the {coursesLower} on their invites, or use a fixed price per number of
                        subjects.
                    </p>
                )}
                {basis === 'FLAT' && typicalPrice > 0 && (
                    <p className="rounded border border-warning-200 bg-warning-50 p-2 text-2xs text-warning-700">
                        These {coursesLower} are priced ({typicalPrice} each on their invite), so a
                        fixed price ignores that. Repricing a {courseLower} on its invite will not
                        change what a basket costs.
                    </p>
                )}
            </div>

            {/* ── Discount tiers ─────────────────────────────────────────────── */}
            {basis === 'DISCOUNT' && (
                <div className="space-y-2 border-t border-neutral-200 pt-3">
                    <Label className="text-xs">Discount by number of subjects</Label>
                    <p className="text-2xs text-neutral-500">
                        Gate a tier on how many subjects, on how much the basket is worth, or on
                        both — when both are set, both must hold. Leave an amount at 0 to ignore it.
                        The best qualifying tier wins, so a bigger basket never loses a discount it
                        already had.
                    </p>
                    {tiers.length === 0 && (
                        <p className="text-2xs text-neutral-400">
                            No tiers yet — every basket pays full {courseLower} price.
                        </p>
                    )}
                    {tiers.map((tier, index) => {
                        // Preview against a basket that actually reaches this tier,
                        // so the figure shown is the figure charged.
                        const byCount = (tier.minCourses ?? 0) * typicalPrice;
                        const base = Math.max(byCount, tier.minAmount ?? 0);
                        const count = Math.max(
                            tier.minCourses ?? 0,
                            typicalPrice > 0 ? Math.ceil(base / typicalPrice) : 0
                        );
                        const off = discountAt(count, base);
                        const noCondition =
                            (tier.minCourses ?? 0) <= 0 && (tier.minAmount ?? 0) <= 0;
                        const impossibleBand =
                            (tier.maxAmount ?? 0) > 0 &&
                            (tier.maxAmount ?? 0) < (tier.minAmount ?? 0);
                        return (
                            <div
                                key={index}
                                className="space-y-1.5 rounded border border-neutral-200 bg-white p-2"
                            >
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-2xs text-neutral-500">From</span>
                                    <Input
                                        type="number"
                                        min={0}
                                        value={tier.minCourses ?? 0}
                                        onChange={(e) =>
                                            setTier(index, { minCourses: num(e.target.value) })
                                        }
                                        className="h-8 w-14"
                                        aria-label="Minimum subjects for this tier"
                                    />
                                    <span className="text-2xs text-neutral-500">
                                        subjects, or from
                                    </span>
                                    <Input
                                        type="number"
                                        min={0}
                                        value={tier.minAmount ?? 0}
                                        onChange={(e) =>
                                            setTier(index, { minAmount: num(e.target.value) })
                                        }
                                        className="h-8 w-20"
                                        aria-label="Minimum basket amount for this tier"
                                    />
                                    <span className="text-2xs text-neutral-500">up to</span>
                                    <Input
                                        type="number"
                                        min={0}
                                        value={tier.maxAmount ?? 0}
                                        onChange={(e) =>
                                            setTier(index, { maxAmount: num(e.target.value) })
                                        }
                                        className="h-8 w-20"
                                        aria-label="Maximum basket amount for this tier"
                                    />
                                    <button
                                        type="button"
                                        aria-label="Remove this tier"
                                        onClick={() =>
                                            set({ tiers: tiers.filter((_, i) => i !== index) })
                                        }
                                        className="ms-auto rounded p-1 text-neutral-400 hover:text-danger-500"
                                    >
                                        <Trash className="size-3.5" />
                                    </button>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-2xs text-neutral-500">take</span>
                                    <Input
                                        type="number"
                                        min={0}
                                        value={tier.value}
                                        onChange={(e) =>
                                            setTier(index, { value: num(e.target.value) })
                                        }
                                        className="h-8 w-20"
                                        aria-label="Discount value"
                                    />
                                    <select
                                        value={tier.type}
                                        onChange={(e) =>
                                            setTier(index, {
                                                type: e.target.value as BasketPricingTier['type'],
                                            })
                                        }
                                        className="h-8 rounded border border-neutral-200 bg-white px-2 text-2xs"
                                        aria-label="Discount type"
                                    >
                                        <option value="PERCENT">% off</option>
                                        <option value="AMOUNT">₹ off</option>
                                    </select>
                                    {tier.type === 'PERCENT' && (
                                        <>
                                            <span className="text-2xs text-neutral-500">
                                                but never more than
                                            </span>
                                            <Input
                                                type="number"
                                                min={0}
                                                value={tier.maxDiscount ?? 0}
                                                onChange={(e) =>
                                                    setTier(index, {
                                                        maxDiscount: num(e.target.value),
                                                    })
                                                }
                                                className="h-8 w-20"
                                                aria-label="Maximum discount for this tier"
                                            />
                                        </>
                                    )}
                                </div>
                                {noCondition && (
                                    <p className="text-2xs text-warning-700">
                                        Set a subject count or an amount, or this tier never
                                        applies.
                                    </p>
                                )}
                                {!noCondition && impossibleBand && (
                                    <p className="text-2xs text-danger-600">
                                        The upper bound is below the lower one, so no basket can
                                        fall inside this band.
                                    </p>
                                )}
                                {!noCondition && !impossibleBand && base > 0 && (
                                    <p className="text-2xs text-neutral-400">
                                        {count} × {typicalPrice} = {Math.round(base)} &rarr;{' '}
                                        <strong className="text-neutral-600">
                                            {Math.round(base - off)}
                                        </strong>{' '}
                                        (&minus;{Math.round(off)})
                                    </p>
                                )}
                            </div>
                        );
                    })}
                    <button
                        type="button"
                        onClick={() =>
                            set({
                                tiers: [
                                    ...tiers,
                                    {
                                        minCourses:
                                            Math.max(1, ...tiers.map((t) => t.minCourses ?? 0)) +
                                            1,
                                        type: 'PERCENT',
                                        value: 10,
                                    },
                                ],
                            })
                        }
                        className="inline-flex items-center gap-1 text-2xs font-semibold text-primary-500"
                    >
                        <Plus className="size-3.5" /> Add a tier
                    </button>
                </div>
            )}

            {/* ── Ladder ─────────────────────────────────────────────────────── */}
            {basis === 'FLAT' && (
                <div className="space-y-2">
                    <Label className="text-xs">Price by number of subjects</Label>
                    {prices.map((price, index) => (
                        <div key={index} className="flex items-center gap-2">
                            <span className="w-24 shrink-0 text-2xs text-neutral-500">
                                {index + 1} subject{index === 0 ? '' : 's'}
                            </span>
                            <Input
                                type="number"
                                min={0}
                                value={price}
                                onChange={(e) => setPrice(index, num(e.target.value))}
                                className="h-8 w-24"
                            />
                            {index === prices.length - 1 && prices.length > 1 && (
                                <button
                                    type="button"
                                    aria-label={`Remove the ${index + 1}-subject price`}
                                    onClick={() =>
                                        set({ ladder: { ...value.ladder, prices: prices.slice(0, -1) } })
                                    }
                                    className="rounded p-1 text-neutral-400 hover:text-danger-500"
                                >
                                    <Trash className="size-3.5" />
                                </button>
                            )}
                        </div>
                    ))}
                    <button
                        type="button"
                        onClick={() =>
                            set({
                                ladder: {
                                    ...value.ladder,
                                    prices: [...prices, ladderAt(prices.length + 1)],
                                },
                            })
                        }
                        className="inline-flex items-center gap-1 text-2xs font-semibold text-primary-500"
                    >
                        <Plus className="size-3.5" /> Add a step
                    </button>

                    <div className="flex items-center gap-2 pt-1">
                        <span className="w-24 shrink-0 text-2xs text-neutral-500">Each extra</span>
                        <Input
                            type="number"
                            min={0}
                            value={value.ladder?.perExtra ?? 0}
                            onChange={(e) =>
                                set({ ladder: { ...value.ladder, perExtra: num(e.target.value) } })
                            }
                            className="h-8 w-24"
                        />
                        <span className="text-2xs text-neutral-400">
                            beyond {prices.length} — e.g. {prices.length + 2} subjects ={' '}
                            {ladderAt(prices.length + 2)}
                        </span>
                    </div>
                </div>
            )}

            {/* ── Ladder scope ───────────────────────────────────────────────── */}
            <div className="space-y-2 border-t border-neutral-200 pt-3">
                <Label className="text-xs">When subjects are for different classes</Label>
                {(
                    [
                        [
                            'GROUP',
                            'Price each class separately',
                            'One subject for a Class 6 child and one for a Class 8 child = two single-subject prices. No accidental sibling discount.',
                        ],
                        [
                            'BASKET',
                            'Count the whole basket together',
                            'Those same two subjects reach the two-subject price, whoever they are for.',
                        ],
                    ] as const
                ).map(([scope, label, hint]) => {
                    const active = (value.ladderScope ?? 'GROUP') === scope;
                    return (
                        <button
                            key={scope}
                            type="button"
                            onClick={() => set({ ladderScope: scope })}
                            className={`w-full rounded border p-2 text-start ${
                                active
                                    ? 'border-primary-400 bg-primary-50'
                                    : 'border-neutral-200 bg-white'
                            }`}
                        >
                            <p
                                className={`text-2xs font-semibold ${
                                    active ? 'text-primary-600' : 'text-neutral-700'
                                }`}
                            >
                                {label}
                            </p>
                            <p className="mt-0.5 text-2xs text-neutral-500">{hint}</p>
                        </button>
                    );
                })}
                <p className="text-2xs text-neutral-400">
                    Full packs and combos always stay per class — a &ldquo;full grade pack&rdquo;
                    only means something within one grade.
                </p>
            </div>

            {/* ── Full-pack prices ───────────────────────────────────────────── */}
            <div className="space-y-2 border-t border-neutral-200 pt-3">
                <Label className="text-xs">Full pack price</Label>
                <p className="text-2xs text-neutral-400">
                    Charged only when a visitor picks <em>every</em> subject in their group. Keyed
                    by how many that is.
                </p>
                {Object.entries(packs).map(([count, price]) => (
                    <div key={count} className="flex items-center gap-2">
                        <span className="w-24 shrink-0 text-2xs text-neutral-500">
                            all {count} subjects
                        </span>
                        <Input
                            type="number"
                            min={0}
                            value={price}
                            onChange={(e) =>
                                set({ wholeGroupPrices: { ...packs, [count]: num(e.target.value) } })
                            }
                            className="h-8 w-24"
                        />
                        <span className="text-2xs text-neutral-400">
                            ladder would be {ladderAt(Number(count))}
                        </span>
                        <button
                            type="button"
                            aria-label={`Remove the ${count}-subject pack price`}
                            onClick={() => {
                                const next = { ...packs };
                                delete next[count];
                                set({ wholeGroupPrices: next });
                            }}
                            className="rounded p-1 text-neutral-400 hover:text-danger-500"
                        >
                            <Trash className="size-3.5" />
                        </button>
                    </div>
                ))}
                <button
                    type="button"
                    onClick={() => {
                        // Next unused count, so repeated clicks add distinct rows.
                        let n = 2;
                        while (packs[String(n)] !== undefined) n += 1;
                        set({ wholeGroupPrices: { ...packs, [String(n)]: ladderAt(n) } });
                    }}
                    className="inline-flex items-center gap-1 text-2xs font-semibold text-primary-500"
                >
                    <Plus className="size-3.5" /> Add a pack price
                </button>
            </div>

            {/* ── Groups ─────────────────────────────────────────────────────── */}
            <div className="space-y-2 border-t border-neutral-200 pt-3">
                <Label className="text-xs">Groups</Label>
                <p className="text-2xs text-neutral-400">
                    Usually one per class. The basket is split by group and each priced on its own,
                    so a parent buying for two children pays for two children. Leave empty to price
                    the whole basket together.
                </p>

                {groups.map((group, index) => {
                    const open = openGroup === index;
                    return (
                        <div key={index} className="rounded border border-neutral-200 bg-white p-2">
                            <div className="flex items-center gap-1">
                                <Input
                                    value={group.label}
                                    onChange={(e) => setGroup(index, { label: e.target.value })}
                                    placeholder="Class 6"
                                    className="h-8"
                                />
                                <button
                                    type="button"
                                    aria-label={`Move ${group.label || 'group'} up`}
                                    disabled={index === 0}
                                    onClick={() => {
                                        const next = [...groups];
                                        const [row] = next.splice(index, 1);
                                        if (row) next.splice(index - 1, 0, row);
                                        set({ groups: next });
                                    }}
                                    className="rounded p-1 text-neutral-400 disabled:opacity-30"
                                >
                                    <ArrowUp className="size-3.5" />
                                </button>
                                <button
                                    type="button"
                                    aria-label={`Move ${group.label || 'group'} down`}
                                    disabled={index === groups.length - 1}
                                    onClick={() => {
                                        const next = [...groups];
                                        const [row] = next.splice(index, 1);
                                        if (row) next.splice(index + 1, 0, row);
                                        set({ groups: next });
                                    }}
                                    className="rounded p-1 text-neutral-400 disabled:opacity-30"
                                >
                                    <ArrowDown className="size-3.5" />
                                </button>
                                <button
                                    type="button"
                                    aria-label={`Remove ${group.label || 'group'}`}
                                    onClick={() =>
                                        set({ groups: groups.filter((_, i) => i !== index) })
                                    }
                                    className="rounded p-1 text-neutral-400 hover:text-danger-500"
                                >
                                    <Trash className="size-3.5" />
                                </button>
                            </div>

                            <div className="mt-1 flex items-center gap-2">
                                <span className="text-2xs text-neutral-500">Full pack price</span>
                                <Input
                                    type="number"
                                    min={0}
                                    value={group.packPrice ?? ''}
                                    placeholder="use the count table"
                                    onChange={(e) =>
                                        setGroup(index, {
                                            packPrice: e.target.value ? num(e.target.value) : undefined,
                                        })
                                    }
                                    className="h-7 w-24"
                                />
                                <span className="text-2xs text-neutral-400">
                                    charged when all {group.levels?.length || 0} are taken
                                </span>
                            </div>

                            <button
                                type="button"
                                onClick={() => setOpenGroup(open ? null : index)}
                                className="mt-1 text-2xs text-neutral-500"
                            >
                                {group.levels?.length || 0} level
                                {group.levels?.length === 1 ? '' : 's'} · {open ? 'hide' : 'choose'}
                            </button>

                            {open && (
                                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto border-t pt-2">
                                    {levelNames.length === 0 && (
                                        <p className="text-2xs text-neutral-400">
                                            No {coursesLower} on this page yet — add them in the{' '}
                                            {coursesTerm} tab.
                                        </p>
                                    )}
                                    {levelNames.map((level) => (
                                        <label
                                            key={level}
                                            className="flex items-center gap-2 text-2xs text-neutral-700"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={(group.levels ?? []).includes(level)}
                                                onChange={() =>
                                                    setGroup(index, {
                                                        levels: toggleIn(group.levels ?? [], level),
                                                    })
                                                }
                                                className="size-3.5 rounded border-neutral-300 accent-primary-500"
                                            />
                                            {level}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}

                <button
                    type="button"
                    onClick={() => {
                        set({ groups: [...groups, { label: `Group ${groups.length + 1}`, levels: [] }] });
                        setOpenGroup(groups.length);
                    }}
                    className="inline-flex items-center gap-1 text-2xs font-semibold text-primary-500"
                >
                    <Plus className="size-3.5" /> Add group
                </button>
            </div>

            {/* ── Combos ─────────────────────────────────────────────────────── */}
            <div className="space-y-2 border-t border-neutral-200 pt-3">
                <Label className="text-xs">Combos</Label>
                <p className="text-2xs text-neutral-400">
                    A fixed price for one exact set of {coursesLower}, matched inside a group.
                    Chosen by {courseLower} rather than level, so a single combo covers every class.
                </p>

                {combos.map((combo, index) => {
                    const open = openCombo === index;
                    return (
                        <div key={index} className="rounded border border-neutral-200 bg-white p-2">
                            <div className="flex items-center gap-1">
                                <Input
                                    value={combo.label}
                                    onChange={(e) => setCombo(index, { label: e.target.value })}
                                    placeholder="EMS combo"
                                    className="h-8"
                                />
                                <Input
                                    type="number"
                                    min={0}
                                    value={combo.price}
                                    onChange={(e) => setCombo(index, { price: num(e.target.value) })}
                                    className="h-8 w-24"
                                />
                                <button
                                    type="button"
                                    aria-label={`Remove ${combo.label || 'combo'}`}
                                    onClick={() =>
                                        set({ combos: combos.filter((_, i) => i !== index) })
                                    }
                                    className="rounded p-1 text-neutral-400 hover:text-danger-500"
                                >
                                    <Trash className="size-3.5" />
                                </button>
                            </div>

                            <button
                                type="button"
                                onClick={() => setOpenCombo(open ? null : index)}
                                className="mt-1 text-2xs text-neutral-500"
                            >
                                {combo.packages?.length || 0}{' '}
                                {combo.packages?.length === 1 ? courseLower : coursesLower} ·{' '}
                                {open ? 'hide' : 'choose'}
                            </button>

                            {open && (
                                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto border-t pt-2">
                                    {courseNames.map((name) => (
                                        <label
                                            key={name}
                                            className="flex items-center gap-2 text-2xs text-neutral-700"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={(combo.packages ?? []).includes(name)}
                                                onChange={() =>
                                                    setCombo(index, {
                                                        packages: toggleIn(combo.packages ?? [], name),
                                                    })
                                                }
                                                className="size-3.5 rounded border-neutral-300 accent-primary-500"
                                            />
                                            {name}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}

                <button
                    type="button"
                    onClick={() => {
                        set({
                            combos: [
                                ...combos,
                                { label: 'Combo', packages: [], price: ladderAt(3) },
                            ],
                        });
                        setOpenCombo(combos.length);
                    }}
                    className="inline-flex items-center gap-1 text-2xs font-semibold text-primary-500"
                >
                    <Plus className="size-3.5" /> Add combo
                </button>
            </div>
        </div>
    );
};
