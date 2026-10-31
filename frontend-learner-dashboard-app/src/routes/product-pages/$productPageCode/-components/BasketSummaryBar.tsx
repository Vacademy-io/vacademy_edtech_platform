import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Gift, ShoppingCart } from '@phosphor-icons/react';
import { useCourseTerms } from "@/routes/$tagName/-utils/catalogue-naming";
import type { ProductPageData } from '../-types/product-page-types';
import { celebrateSavingOnce } from '../-utils/celebrate-saving';
import { useBasketSavings } from '../-utils/use-basket-savings';

/**
 * The running basket, pinned to the bottom of the catalogue.
 *
 * It quotes what checkout will actually charge, not the sum of the card prices
 * — those two used to differ by the whole discount, so a parent watched ₹698
 * turn into ₹599 only after committing to a checkout. It also names what one
 * more subject would unlock, and celebrates the moment the basket crosses into
 * a better price, because a discount nobody noticed earning grows no basket.
 *
 * It replaces two separate copies of this bar that were already translated and
 * already spoke the institute's own word for a course, so it keeps both — a
 * shared component that quietly reverted ar/fr/hi to English would be a poor
 * trade for the deduplication.
 */

interface BasketSummaryBarProps {
    pageData: ProductPageData;
    onNext: () => void;
    primaryColor: string;
}

export const BasketSummaryBar = ({ pageData, onNext, primaryColor }: BasketSummaryBarProps) => {
    const { t } = useTranslation('productPages');
    // Deliberately the pre-coupon figure: see totalBeforeCoupon. A code applied
    // at the cart is only re-validated back at the cart, so quoting it here can
    // promise less than the server will charge.
    const { count, itemTotal, totalBeforeCoupon, saved, savedPercent, tierAhead, money } =
        useBasketSavings(pageData);
    const total = totalBeforeCoupon;

    const terms = useCourseTerms();
    const courseTerm = terms.course;
    const coursesTerm = terms.courses;

    // Celebrate a saving this basket has never reached before. Shared with the
    // catalogue bar and keyed the same way, so walking between the two surfaces
    // cannot re-fire a burst the visitor has already seen.
    useEffect(() => {
        if (count === 0) return;
        celebrateSavingOnce(pageData.code, saved, primaryColor);
    }, [count, saved, primaryColor, pageData.code]);

    if (count === 0) return null;

    return (
        <div className="sticky bottom-0 z-30 border-t border-gray-100 bg-white/95 shadow-top-bar backdrop-blur-md">
            {/* The nudge sits above the bar, full width, so it reads as an offer
                rather than as a caption on the price. */}
            {tierAhead && (
                <div className="border-b border-primary-100 bg-primary-50">
                    <p className="mx-auto flex max-w-screen-2xl items-center gap-2 px-4 py-2 text-caption font-semibold text-primary-500">
                        <Gift className="size-4 shrink-0" aria-hidden="true" />
                        {tierAhead.coursesAway > 0
                            ? t(
                                  tierAhead.offer.type === 'PERCENT'
                                      ? 'common.basketNextTierPercent'
                                      : tierAhead.offer.incremental
                                        ? 'common.basketNextTierAmountMore'
                                        : 'common.basketNextTierAmount',
                                  {
                                      count: tierAhead.coursesAway,
                                      course: (tierAhead.coursesAway === 1
                                          ? courseTerm
                                          : coursesTerm
                                      ).toLocaleLowerCase(),
                                      amount: money(tierAhead.offer.value),
                                      percent: tierAhead.offer.value,
                                  }
                              )
                            : t('cartStep.basket.spendForTier', {
                                  amount: money(tierAhead.amountAway),
                                  offer: tierAhead.label,
                              })}
                    </p>
                </div>
            )}

            <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                    <p className="text-caption text-gray-500">
                        {t('common.itemsSelected', {
                            count,
                            course: (count === 1
                                ? courseTerm
                                : coursesTerm
                            ).toLocaleLowerCase(),
                        })}
                    </p>

                    {total > 0 ? (
                        <p className="flex flex-wrap items-baseline gap-x-2">
                            {/* Struck price is what these same courses cost apart —
                                never an invented MRP. */}
                            {saved > 0 && (
                                <span className="text-sm tabular-nums text-gray-400 line-through">
                                    {money(itemTotal)}
                                </span>
                            )}
                            <span className="text-xl font-bold tabular-nums text-gray-900">
                                {money(total)}
                            </span>
                            {saved > 0 && (
                                <span className="rounded-md bg-success-50 px-1.5 py-0.5 text-caption font-bold tabular-nums text-success-700">
                                    {savedPercent > 0
                                        ? t('common.basketSavedWithPercent', {
                                              amount: money(saved),
                                              percent: savedPercent,
                                          })
                                        : t('common.basketSaved', { amount: money(saved) })}
                                </span>
                            )}
                        </p>
                    ) : (
                        <p className="text-base font-bold text-success-600">
                            {t('common.freeEnrollment')}
                        </p>
                    )}
                </div>

                <button
                    type="button"
                    onClick={onNext}
                    className="flex min-h-12 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-7 text-sm font-bold text-white transition-all duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-95"
                    // Dynamic: the institute's own page colour, only known at runtime.
                    style={{ backgroundColor: primaryColor, boxShadow: `0 4px 14px ${primaryColor}55` }}
                >
                    <ShoppingCart className="size-4" aria-hidden="true" />
                    {t('common.proceedToCheckout')}
                </button>
            </div>
        </div>
    );
};
