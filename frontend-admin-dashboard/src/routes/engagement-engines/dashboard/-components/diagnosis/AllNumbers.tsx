import type { ReactNode } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface AllNumbersProps {
    /** Whether the section is open. The page keeps it in the URL (?numbers=1). */
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The full report could not load: the closed section says so, so it is not mistaken for fine. */
    failed?: boolean;
    children: ReactNode;
}

/**
 * The full report (headline numbers, charts and tables), folded away under the diagnosis so the
 * day starts short. Closed by default; the open state is the page's, so a link can share it.
 */
export function AllNumbers({ open, onOpenChange, failed = false, children }: AllNumbersProps) {
    const { t } = useTranslation('engagementDailyReport');
    return (
        <Collapsible open={open} onOpenChange={onOpenChange}>
            <CollapsibleTrigger asChild>
                <MyButton
                    buttonType="secondary"
                    scale="large"
                    className="h-auto w-full justify-between gap-2 py-2"
                >
                    <span className="flex flex-col items-start text-start">
                        <span className="font-semibold">{t('diagnosis.allNumbers.title')}</span>
                        <span
                            className={cn(
                                'text-caption font-normal',
                                failed ? 'text-warning-700' : 'text-neutral-500'
                            )}
                        >
                            {failed
                                ? t('diagnosis.allNumbers.failed')
                                : open
                                  ? t('diagnosis.allNumbers.hide')
                                  : t('diagnosis.allNumbers.show')}
                        </span>
                    </span>
                    <CaretDown
                        size={16}
                        aria-hidden="true"
                        className={cn('shrink-0 transition-transform', open && 'rotate-180')}
                    />
                </MyButton>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4">{children}</CollapsibleContent>
        </Collapsible>
    );
}
