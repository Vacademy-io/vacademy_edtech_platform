import { ArrowRight, CaretUp, Lock } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

/**
 * The total and the way forward, pinned to the bottom of small screens.
 *
 * On mobile the summary sits above a list that can run past a screen and a
 * half, so both the price and the button scroll out of reach exactly when the
 * visitor is deciding. Desktop keeps the sticky rail and hides this.
 */

interface MobileCheckoutBarProps {
    /** Already formatted, so this stays out of the currency business. */
    totalLabel: string;
    /** Short line above the total — "3 subjects", "You save ₹248". */
    caption?: string;
    ctaLabel: string;
    onContinue: () => void;
    disabled?: boolean;
    primaryColor: string;
    /** Scrolls the order summary into view. Omitted when there is nothing to show. */
    onShowSummary?: () => void;
}

export const MobileCheckoutBar = ({
    totalLabel,
    caption,
    ctaLabel,
    onContinue,
    disabled = false,
    primaryColor,
    onShowSummary,
}: MobileCheckoutBarProps) => {
    const { t } = useTranslation('productPages');
    return (
    <>
        {/* Clearance is the page's job, not this card's — CheckoutLayout pads the
            column bottom, because content below this component (the mobile order
            summary) would otherwise sit under the bar. */}
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 shadow-top-bar backdrop-blur-md lg:hidden">
            <div className="mx-auto flex max-w-screen-xl items-center gap-3 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
                <button
                    type="button"
                    onClick={onShowSummary}
                    disabled={!onShowSummary}
                    className="min-w-0 flex-1 text-left disabled:cursor-default"
                    aria-label={onShowSummary ? t('cartStep.basket.viewSummary') : undefined}
                >
                    <span className="flex items-center gap-1 text-2xl font-bold tabular-nums text-gray-900">
                        {totalLabel}
                        {onShowSummary && (
                            <CaretUp className="size-3.5 text-gray-400" aria-hidden="true" />
                        )}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-caption text-gray-500">
                        <Lock className="size-3 shrink-0" aria-hidden="true" />
                        {caption ?? t('cartStep.basket.inclusiveTaxes')}
                    </span>
                </button>

                <button
                    type="button"
                    onClick={onContinue}
                    disabled={disabled}
                    className="flex min-h-12 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-6 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    // Dynamic: the institute's own page colour, only known at runtime.
                    style={{ backgroundColor: primaryColor }}
                >
                    {ctaLabel}
                    <ArrowRight className="size-4" aria-hidden="true" />
                </button>
            </div>
        </div>
    </>
);
};
