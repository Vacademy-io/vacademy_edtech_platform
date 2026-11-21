import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCourseTerms } from "@/routes/$tagName/-utils/catalogue-naming";
import { Gift, ShoppingCartSimple, Trash, Plus } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useProductPageStore } from '../-stores/product-page-store';
import type {
    ProductPageData,
    ProductPageMappingResponse,
    ProductPageSettings,
} from '../-types/product-page-types';
import {
    groupLabelFor,
    ladderPrice,
    nextTier,
    parseBasketPricing,
    type BasketQuoteLine,
} from '../-utils/basket-pricing';
import {
    AVATAR_TINTS,
    currencySymbolFor,
    displayName,
    getInitials,
    itemSubject,
    itemTitle,
} from '../-utils/cart-item-display';

/**
 * The cart, where the visitor can actually change it.
 *
 * This is the wide column of the cart step. The narrow summary rail that rides
 * along for the rest of checkout stays read-only and numeric; here the courses
 * are the content, at a size a parent can read, grouped by class because the
 * ladder prices each class on its own. Seeing "Class 5 · 3 subjects · ₹799" in
 * one block is the whole explanation of a price that would otherwise look
 * arbitrary next to a flat list of ₹0 courses.
 */

interface CartItemListProps {
    pageData: ProductPageData;
    settings: ProductPageSettings;
    /**
     * Sends the visitor back to the catalogue to add more. Omitted when the page
     * sets disableBackNavigation — the cart must not hand out a way back that
     * the rest of the flow deliberately withholds.
     */
    onAddMore?: () => void;
    primaryColor: string;
}

interface DisplayGroup {
    /** '' when the page prices everything as one basket. */
    label: string;
    items: ProductPageMappingResponse[];
    /** The quote line this group is charged on, when basket pricing is on. */
    line?: BasketQuoteLine;
}

export const CartItemList = ({
    pageData,
    settings,
    onAddMore,
    primaryColor,
}: CartItemListProps) => {
    const { t } = useTranslation('productPages');
    // The institute's own word for a course — "subject" was baked in, which is
    // wrong anywhere the admin renamed it (Programme, Paper, Module).
    const terms = useCourseTerms();
    const courseTerm = terms.course.toLocaleLowerCase();
    const coursesTerm = terms.courses.toLocaleLowerCase();

    const { selectedPsOptionIds, setSelection, basketQuote } = useProductPageStore();

    const items = useMemo(
        () =>
            pageData.mappings.filter((m) =>
                selectedPsOptionIds.includes(m.ps_invite_payment_option_id)
            ),
        [pageData.mappings, selectedPsOptionIds]
    );

    const currency = pageData.currency || items[0]?.payment_plan?.currency || 'INR';
    const symbol = currencySymbolFor(currency);
    const money = (n: number) => `${symbol}${n.toLocaleString('en-IN')}`;

    const quote = basketQuote();
    const basketSettings = parseBasketPricing(pageData.settings_json);
    // Threshold-based nudge for discount pages, where the next course's price is
    // not known until it is picked.
    const tierAhead = nextTier(basketSettings, items.length, quote?.itemTotal ?? 0);

    const canRemove = settings.allowCourseDeselection !== false;
    const removeItem = (id: string) =>
        setSelection(selectedPsOptionIds.filter((sid) => sid !== id));

    /**
     * Groups for display. Built from the quote's own lines so the headings and
     * the charges cannot disagree — under BASKET scope the engine collapses
     * everything into one line, and this follows it rather than inventing
     * per-class headings for a price that was never computed per class.
     */
    const groups = useMemo<DisplayGroup[]>(() => {
        if (!quote) return [{ label: '', items }];
        const collapsed = quote.lines.length === 1 && quote.lines[0]!.label === 'Your selection';
        if (collapsed) return [{ label: '', items, line: quote.lines[0] }];

        const byLabel = new Map<string, ProductPageMappingResponse[]>();
        for (const item of items) {
            const label =
                groupLabelFor(basketSettings, {
                    levelName: item.level_name,
                    packageName: item.package_name,
                }) || 'Your selection';
            byLabel.set(label, [...(byLabel.get(label) ?? []), item]);
        }
        return quote.lines.map((line) => ({
            label: line.label,
            items: byLabel.get(line.label) ?? [],
            line,
        }));
    }, [quote, items, basketSettings]);

    if (items.length === 0) {
        return (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center">
                <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-white ring-1 ring-gray-200">
                    <ShoppingCartSimple className="size-6 text-gray-400" aria-hidden="true" />
                </div>
                <p className="text-base font-semibold text-gray-900">
                    {t('cartStep.basket.emptyTitle')}
                </p>
                <p className="mx-auto mt-1 max-w-xs text-sm text-gray-500">
                    {t('cartStep.basket.emptyBody', { course: courseTerm })}
                </p>
                {onAddMore && (
                <button
                    type="button"
                    onClick={onAddMore}
                    className="mt-4 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                    // Dynamic: the institute's own page colour, only known at runtime.
                    style={{ backgroundColor: primaryColor }}
                >
                    <Plus className="size-4" aria-hidden="true" />
                    {t('cartStep.basket.browse', { courses: coursesTerm })}
                </button>
                )}
            </div>
        );
    }

    return (
        <section
            aria-label={t('cartStep.basket.cartItems', { courses: coursesTerm })}
            className="space-y-4"
        >
            {groups.map((group, gi) => {
                // Measured against what these same courses cost apart — the
                // figure the group header strikes through. Never an invented
                // "MRP": an inflated original is the fastest way to lose a parent.
                const line = group.line;
                const saved = line ? Math.max(0, Math.round(line.baseAmount - line.amount)) : 0;
                const savedPercent =
                    line && line.baseAmount > 0
                        ? Math.round((saved / line.baseAmount) * 100)
                        : 0;
                // What one more subject in THIS class would add. Named exactly,
                // because "add more to save more" is not something a parent can
                // act on. Only meaningful on a fixed ladder — see tierAhead.
                const nextHere =
                    line && basketSettings && basketSettings.pricingBasis !== 'DISCOUNT'
                        ? ladderPrice(
                              basketSettings.ladder.prices,
                              basketSettings.ladder.perExtra,
                              line.count + 1
                          ) -
                          ladderPrice(
                              basketSettings.ladder.prices,
                              basketSettings.ladder.perExtra,
                              line.count
                          )
                        : null;

                return (
                    <div
                        key={group.label || `group-${gi}`}
                        className="overflow-hidden rounded-2xl border border-gray-200 bg-white"
                    >
                        {/* Group header — the class, and what that class costs */}
                        <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 sm:px-5">
                            <div className="min-w-0">
                                <h3 className="truncate text-sm font-bold text-gray-900">
                                    {group.label || 'Your selection'}
                                </h3>
                                <p className="mt-0.5 truncate text-caption text-gray-500">
                                    {line
                                        ? line.how
                                        : t('cartStep.basket.groupCount', {
                                              count: group.items.length,
                                              course: courseTerm,
                                              courses: coursesTerm,
                                          })}
                                </p>
                            </div>
                            {line && (
                                <div className="shrink-0 text-right">
                                    <p className="flex items-baseline justify-end gap-1.5">
                                        {saved > 0 && (
                                            <span className="text-caption tabular-nums text-gray-400 line-through">
                                                {money(line.baseAmount)}
                                            </span>
                                        )}
                                        <span className="text-base font-bold tabular-nums text-gray-900">
                                            {money(line.amount)}
                                        </span>
                                    </p>
                                    {saved > 0 && (
                                        <p className="text-caption font-semibold text-success-600">
                                            save {money(saved)}
                                            {savedPercent > 0 && ` · ${savedPercent}%`}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>

                        <ul className="divide-y divide-gray-100">
                            {group.items.map((mapping, idx) => {
                                const plan = mapping.payment_plan;
                                const price = plan?.actual_price ?? 0;
                                const full = itemTitle(mapping);
                                const label = group.label ? itemSubject(mapping) : full;
                                return (
                                    <li
                                        key={mapping.ps_invite_payment_option_id}
                                        className="flex items-center gap-3 px-4 py-3 sm:px-5"
                                    >
                                        <span
                                            className={cn(
                                                'flex size-9 shrink-0 items-center justify-center rounded-xl text-caption font-bold',
                                                AVATAR_TINTS[idx % AVATAR_TINTS.length]
                                            )}
                                            aria-hidden="true"
                                        >
                                            {getInitials(full)}
                                        </span>

                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-semibold text-gray-900">
                                                {label}
                                            </p>
                                            {displayName(mapping.session_name) && group.label && (
                                                <p className="truncate text-caption text-gray-500">
                                                    {displayName(mapping.session_name)}
                                                </p>
                                            )}
                                        </div>

                                        {/* Under a whole-basket price the courses have no
                                            individual price; "Free" on every row next to a
                                            ₹799 total reads as a bug, not a bargain. */}
                                        <span className="shrink-0 text-caption font-medium text-gray-500">
                                            {line
                                                ? t('cartStep.basket.included')
                                                : price > 0
                                                  ? money(price)
                                                  : t('common.free')}
                                        </span>

                                        {canRemove && (
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    removeItem(mapping.ps_invite_payment_option_id)
                                                }
                                                className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-danger-50 hover:text-danger-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-400 sm:size-9"
                                                aria-label={`Remove ${full}`}
                                                title={`Remove ${full}`}
                                            >
                                                <Trash className="size-4" aria-hidden="true" />
                                            </button>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>

                        {nextHere !== null && nextHere > 0 && (
                            <div className="flex items-center gap-2 border-t border-gray-100 bg-primary-50/60 px-4 py-2.5 text-caption font-medium text-primary-500 sm:px-5">
                                <Gift className="size-4 shrink-0" aria-hidden="true" />
                                <span className="min-w-0">
                                    {t('cartStep.basket.oneMoreForGroup', {
                                        course: courseTerm,
                                        group:
                                            group.label ||
                                            t('cartStep.basket.thisSelection'),
                                        amount: money(nextHere),
                                    })}
                                </span>
                            </div>
                        )}
                    </div>
                );
            })}

            {/* On a discount page the reward for adding one more is a threshold,
                not a rupee figure — the next course's price is not known until it
                is picked, so quoting one would be a guess dressed as a promise. */}
            {tierAhead && (
                <div className="flex items-center gap-2.5 rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3">
                    <Gift className="size-5 shrink-0 text-primary-500" aria-hidden="true" />
                    <p className="min-w-0 text-sm font-semibold text-primary-500">
                        {/* Whichever gap is real. Promising "add 1 more" for a
                            tier gated on spend would be a promise the basket
                            cannot keep. */}
                        {tierAhead.coursesAway > 0
                            ? t('cartStep.basket.addForTier', {
                                  count: tierAhead.coursesAway,
                                  course: courseTerm,
                                  courses: coursesTerm,
                                  offer: tierAhead.label,
                              })
                            : t('cartStep.basket.spendForTier', {
                                  amount: money(tierAhead.amountAway),
                                  offer: tierAhead.label,
                              })}
                    </p>
                </div>
            )}

            {onAddMore && (
            <button
                type="button"
                onClick={onAddMore}
                className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 bg-white text-sm font-semibold text-gray-600 transition-colors hover:border-gray-400 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
            >
                <Plus className="size-4" aria-hidden="true" />
                {t('cartStep.basket.addAnother', { course: courseTerm })}
            </button>
            )}
        </section>
    );
};
