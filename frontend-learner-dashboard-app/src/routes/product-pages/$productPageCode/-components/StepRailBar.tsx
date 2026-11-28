import { useTranslation } from 'react-i18next';
import { ShieldCheck } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { StepProgress } from './StepProgress';

/**
 * The step rail and its trust marker, in one place.
 *
 * It used to exist twice: in CheckoutLayout, and in CatalogStep's fallback
 * branch only — a comment there reasoned that a page_json-designed catalogue is
 * the admin's own layout and should not get platform chrome above it. The
 * result was that every designed page showed no wizard while browsing and then
 * produced one the moment the visitor reached the cart, which reads as the
 * wizard appearing at random rather than as a four-step journey.
 */
interface StepRailBarProps {
    primaryColor: string;
    /** Catalogue-themed tokens for the browse step; plain chrome for checkout. */
    variant?: 'checkout' | 'catalogue';
    className?: string;
}

export const StepRailBar = ({
    primaryColor,
    variant = 'checkout',
    className,
}: StepRailBarProps) => {
    const { t } = useTranslation('productPages');
    const catalogue = variant === 'catalogue';

    return (
        <div
            className={cn(
                'border-b px-4 py-5',
                catalogue
                    ? 'border-catalogue-border bg-catalogue-bg-elevated'
                    : 'border-gray-200 bg-white',
                className
            )}
        >
            <div className="mx-auto flex max-w-screen-xl items-center gap-4">
                <div className="min-w-0 flex-1 overflow-x-auto">
                    <StepProgress primaryColor={primaryColor} />
                </div>
                <div className="hidden shrink-0 items-center gap-1.5 md:flex">
                    <ShieldCheck className="size-4 text-success-600" aria-hidden="true" />
                    <div className="leading-tight">
                        <p
                            className={cn(
                                'text-caption font-semibold',
                                catalogue ? 'text-catalogue-text-secondary' : 'text-gray-700'
                            )}
                        >
                            {t('stepRail.secureTitle')}
                        </p>
                        <p
                            className={cn(
                                'text-2xs',
                                catalogue ? 'text-catalogue-text-muted' : 'text-gray-400'
                            )}
                        >
                            {t('stepRail.secureNote')}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
