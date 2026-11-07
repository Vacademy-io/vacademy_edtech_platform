import { useTranslation } from 'react-i18next';
import { WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';

interface SourceErrorNoticeProps {
    onRetry: () => void;
    /** Defaults to the generic "Couldn't load". */
    message?: string;
    className?: string;
}

/**
 * Inline "Couldn't load · Retry" for a dashboard card whose data source failed. Small on
 * purpose: it replaces one value (or sits under a partial list), not the whole widget.
 */
export default function SourceErrorNotice({ onRetry, message, className }: SourceErrorNoticeProps) {
    const { t } = useTranslation('dashboardIndex');
    return (
        <div
            role="status"
            className={cn(
                'flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs text-neutral-500',
                className
            )}
        >
            <WarningCircle size={12} className="shrink-0 text-warning-600" aria-hidden="true" />
            <span>{message ?? t('sourceError.message')}</span>
            <MyButton
                type="button"
                buttonType="text"
                scale="small"
                className="!h-auto !min-w-0 !px-0 text-2xs font-medium"
                onClick={(e) => {
                    // Cards are often links themselves; a retry must not navigate.
                    e.stopPropagation();
                    onRetry();
                }}
            >
                {t('sourceError.retry')}
            </MyButton>
        </div>
    );
}
