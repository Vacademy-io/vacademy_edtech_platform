import { useContext } from 'react';
import type { Icon } from '@phosphor-icons/react';
import { CircleNotch, WarningCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { ReportRetryingContext } from './retry-context';

/**
 * Shown in place of a section the server could not build; the rest of the report is fine.
 * While the report is being fetched again the button says so and cannot be pressed twice.
 */
export function SectionError({
    onRetry,
    message,
}: {
    onRetry?: () => void;
    /** Replaces the default "couldn't load this section" wording. */
    message?: string;
}) {
    const { t } = useTranslation('engagementDailyReport');
    const retrying = useContext(ReportRetryingContext);
    return (
        <div
            role="alert"
            className="flex flex-col gap-3 rounded-lg border border-warning-200 bg-warning-50 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
            <div className="flex items-start gap-2 text-warning-700">
                <WarningCircle size={18} weight="fill" className="mt-0.5 shrink-0" />
                <span className="text-body">{message ?? t('sectionError')}</span>
            </div>
            {onRetry && (
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    disable={retrying}
                    onClick={onRetry}
                    aria-busy={retrying}
                >
                    {retrying ? (
                        <span className="flex items-center justify-center gap-2">
                            <CircleNotch className="size-4 animate-spin" />
                            {t('retrying')}
                        </span>
                    ) : (
                        t('retry')
                    )}
                </MyButton>
            )}
        </div>
    );
}

interface ReportSectionProps {
    title: string;
    subtitle?: string;
    icon?: Icon;
    right?: React.ReactNode;
    /** No report yet for this day or engine: show a skeleton. */
    isLoading?: boolean;
    /** The server listed this section under `errors`. */
    hasError?: boolean;
    isEmpty?: boolean;
    emptyText?: string;
    onRetry?: () => void;
    className?: string;
    children: React.ReactNode;
}

/**
 * One card of the report with its four states: loading skeleton, inline "couldn't load
 * this section" note, empty message, or the content.
 */
export function ReportSection({
    title,
    subtitle,
    icon,
    right,
    isLoading,
    hasError,
    isEmpty,
    emptyText,
    onRetry,
    className,
    children,
}: ReportSectionProps) {
    const { t } = useTranslation('engagementDailyReport');
    return (
        <SectionCard
            title={title}
            subtitle={subtitle}
            icon={icon}
            right={right}
            className={className}
        >
            {isLoading ? (
                <Skeleton className="h-40 w-full rounded-lg" />
            ) : hasError ? (
                <SectionError onRetry={onRetry} />
            ) : isEmpty ? (
                <EmptyChart text={emptyText ?? t('noActivity')} className="h-32" />
            ) : (
                children
            )}
        </SectionCard>
    );
}
