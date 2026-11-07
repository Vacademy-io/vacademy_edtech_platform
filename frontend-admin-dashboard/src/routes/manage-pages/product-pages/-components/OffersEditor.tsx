import { Percent, Plus, Trash } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { OfferRule, OffersSettings } from '../-types/product-page-types';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

/**
 * Predefined offers for a product page — "₹99 off on orders above ₹500".
 *
 * These need no coupon code and no schema change: they are part of how this
 * page sells, so they live in its settings next to the pricing ladder. A coupon
 * is the other thing — a code someone types, with its own redemption limit —
 * and that lives in the Coupons tab.
 *
 * Only the BEST qualifying offer is ever applied, never several stacked.
 */

interface Props {
    value: OffersSettings;
    currencySymbol?: string;
    onChange: (next: OffersSettings) => void;
}

const num = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
};

export const OffersEditor = ({ value, currencySymbol = '₹', onChange }: Props) => {
    const rules = value.rules ?? [];
    const set = (next: Partial<OffersSettings>) => onChange({ ...value, ...next });
    const setRule = (index: number, patch: Partial<OfferRule>) =>
        set({ rules: rules.map((r, i) => (i === index ? { ...r, ...patch } : r)) });

    /** What the visitor will read. Kept in step with the numbers unless edited. */
    const describe = (r: OfferRule) => {
        const off =
            r.discountType === 'PERCENTAGE'
                ? `${r.discountValue}% off`
                : `${currencySymbol}${r.discountValue} off`;
        const on = r.minAmount
            ? ` on orders above ${currencySymbol}${r.minAmount}`
            : r.minCourses
              ? ` on ${r.minCourses}+ ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}`
              : '';
        return `${off}${on}`;
    };

    return (
        <div className="space-y-3 bg-neutral-50/60 px-5 py-4 ps-14">
            <p className="text-2xs text-neutral-500">
                Shown to every visitor, applied automatically — no code needed. Only the best
                qualifying offer is applied, so two offers never stack into a free order.
            </p>

            {rules.map((rule, index) => (
                <div key={index} className="space-y-2 rounded border border-neutral-200 bg-white p-2">
                    <div className="flex items-center gap-1">
                        <Percent className="size-3.5 shrink-0 text-neutral-400" />
                        <Input
                            value={rule.label}
                            onChange={(e) => setRule(index, { label: e.target.value })}
                            placeholder={describe(rule)}
                            className="h-8"
                        />
                        <button
                            type="button"
                            aria-label={`Remove offer ${index + 1}`}
                            onClick={() => set({ rules: rules.filter((_, i) => i !== index) })}
                            className="rounded p-1 text-neutral-400 hover:text-danger-500"
                        >
                            <Trash className="size-3.5" />
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-2xs text-neutral-500">Give</span>
                        <Input
                            type="number"
                            min={0}
                            value={rule.discountValue}
                            onChange={(e) => setRule(index, { discountValue: num(e.target.value) })}
                            className="h-8 w-20"
                        />
                        <select
                            value={rule.discountType}
                            onChange={(e) =>
                                setRule(index, {
                                    discountType: e.target.value as OfferRule['discountType'],
                                })
                            }
                            className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-xs"
                        >
                            <option value="FIXED">{currencySymbol} off</option>
                            <option value="PERCENTAGE">% off</option>
                        </select>

                        <span className="text-2xs text-neutral-500">when cart is at least</span>
                        <Input
                            type="number"
                            min={0}
                            value={rule.minAmount ?? ''}
                            placeholder="any"
                            onChange={(e) =>
                                setRule(index, {
                                    minAmount: e.target.value ? num(e.target.value) : undefined,
                                })
                            }
                            className="h-8 w-24"
                        />

                        <span className="text-2xs text-neutral-500">and has</span>
                        <Input
                            type="number"
                            min={0}
                            value={rule.minCourses ?? ''}
                            placeholder="any"
                            onChange={(e) =>
                                setRule(index, {
                                    minCourses: e.target.value ? num(e.target.value) : undefined,
                                })
                            }
                            className="h-8 w-20"
                        />
                        <span className="text-2xs text-neutral-500">
                            {getTerminologyPlural(
                                ContentTerms.Course,
                                SystemTerms.Course
                            ).toLocaleLowerCase()}
                        </span>
                    </div>

                    {rule.discountType === 'PERCENTAGE' && (
                        <div className="flex items-center gap-2">
                            <span className="text-2xs text-neutral-500">Cap the discount at</span>
                            <Input
                                type="number"
                                min={0}
                                value={rule.maxDiscount ?? ''}
                                placeholder="no cap"
                                onChange={(e) =>
                                    setRule(index, {
                                        maxDiscount: e.target.value ? num(e.target.value) : undefined,
                                    })
                                }
                                className="h-8 w-24"
                            />
                        </div>
                    )}

                    <p className="text-2xs text-neutral-400">Visitors see: “{describe(rule)}”</p>
                </div>
            ))}

            <button
                type="button"
                onClick={() =>
                    set({
                        rules: [
                            ...rules,
                            {
                                // Stable id so the payment log can name which offer paid out.
                                id: `offer-${Date.now()}-${rules.length}`,
                                label: '',
                                minAmount: 500,
                                discountType: 'FIXED',
                                discountValue: 99,
                            },
                        ],
                    })
                }
                className="inline-flex items-center gap-1 text-2xs font-semibold text-primary-500"
            >
                <Plus className="size-3.5" /> Add offer
            </button>
        </div>
    );
};
