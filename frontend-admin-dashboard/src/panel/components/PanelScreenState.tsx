/**
 * Loading / empty / error states at 10-foot scale, so every panel screen has
 * all four states (design-system 07 §5). Grid/space-* spacing only: flex `gap`
 * needs Chrome 84.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleNotch, MagnifyingGlass, WarningCircle, type Icon } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';

interface StateFrameProps {
    className?: string;
    children: ReactNode;
}

function StateFrame({ className, children }: StateFrameProps) {
    return (
        <div
            className={cn(
                'flex w-full flex-col items-center justify-center space-y-4 p-8 text-center',
                className
            )}
        >
            {children}
        </div>
    );
}

export interface PanelLoadingProps {
    label?: string;
    className?: string;
}

export function PanelLoading({ label, className }: PanelLoadingProps) {
    const { t } = useTranslation('panel');
    return (
        <StateFrame className={className}>
            <CircleNotch size={64} className="animate-spin text-primary-500" aria-hidden />
            <p className="text-title text-neutral-600" role="status">
                {label ?? t('states.loading')}
            </p>
        </StateFrame>
    );
}

export interface PanelEmptyProps {
    title: string;
    description?: string;
    icon?: Icon;
    action?: ReactNode;
    className?: string;
}

export function PanelEmpty({ title, description, icon, action, className }: PanelEmptyProps) {
    const IconComponent = icon ?? MagnifyingGlass;
    return (
        <StateFrame className={className}>
            <IconComponent size={64} className="text-neutral-400" aria-hidden />
            <h2 className="text-h2 text-neutral-700">{title}</h2>
            {description && <p className="max-w-2xl text-title text-neutral-500">{description}</p>}
            {action && <div className="pt-2">{action}</div>}
        </StateFrame>
    );
}

export interface PanelErrorProps {
    title?: string;
    description?: string;
    /** Shown in small print under the description (e.g. error.message). */
    detail?: string;
    onRetry?: () => void;
    action?: ReactNode;
    className?: string;
}

export function PanelError({
    title,
    description,
    detail,
    onRetry,
    action,
    className,
}: PanelErrorProps) {
    const { t } = useTranslation('panel');
    return (
        <StateFrame className={className}>
            <WarningCircle size={64} className="text-danger-500" aria-hidden />
            <h2 className="text-h2 text-neutral-700">{title ?? t('states.errorTitle')}</h2>
            <p className="max-w-2xl text-title text-neutral-500">
                {description ?? t('states.errorDescription')}
            </p>
            {detail && <p className="max-w-2xl break-all text-body text-neutral-400">{detail}</p>}
            {(onRetry || action) && (
                <div className="space-x-4 pt-2">
                    {onRetry && (
                        <MyButton
                            buttonType="primary"
                            scale="large"
                            className="h-16 px-8"
                            onClick={onRetry}
                        >
                            {t('common.retry')}
                        </MyButton>
                    )}
                    {action}
                </div>
            )}
        </StateFrame>
    );
}
