import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';

/** Calm error block with an optional retry, used by both panels. */
export function ErrorState({
    title,
    message,
    onRetry,
    className,
}: {
    title?: string;
    message?: string;
    onRetry?: () => void;
    className?: string;
}) {
    const { t } = useTranslation('marketing');
    return (
        <div
            role="alert"
            className={cn(
                'flex flex-col items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 p-6 text-center',
                className
            )}
        >
            <WarningCircle size={24} className="text-danger-600" aria-hidden />
            <p className="text-subtitle font-medium text-danger-700">
                {title ?? t('common.errorTitle')}
            </p>
            <p className="max-w-sm text-body text-danger-700">{message ?? t('common.errorHint')}</p>
            {onRetry && (
                <MyButton buttonType="secondary" scale="small" onClick={onRetry} className="mt-1">
                    {t('common.retry')}
                </MyButton>
            )}
        </div>
    );
}

/** Friendly "nothing here yet" block. */
export function EmptyState({
    icon,
    title,
    children,
    action,
    className,
}: {
    icon?: ReactNode;
    title: string;
    children?: ReactNode;
    action?: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                'flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-6 py-10 text-center',
                className
            )}
        >
            {icon && (
                <span className="mb-1 flex size-12 items-center justify-center rounded-full bg-primary-50 text-primary-500">
                    {icon}
                </span>
            )}
            <p className="text-subtitle font-medium text-neutral-800">{title}</p>
            {children && <div className="max-w-md text-body text-neutral-500">{children}</div>}
            {action && <div className="mt-2">{action}</div>}
        </div>
    );
}
