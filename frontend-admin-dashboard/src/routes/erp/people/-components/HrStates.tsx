import type { ReactNode } from 'react';
import { Lock, WarningCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The four states every People screen has to render: no access, loading, error and
 * empty. Kept in one place so the four screens agree on wording and shape.
 */

/**
 * Shown instead of the content when the signed-in admin has no HR role.
 *
 * Deliberately not a "request access" flow: HR roles are granted in team settings
 * by someone else, and pretending otherwise would send the user in a circle.
 */
export const HrNoAccessCard = ({ className }: { className?: string }) => {
    const { t } = useTranslation('erpHrStates');
    return (
        <Card className={cn('mx-auto max-w-lg', className)}>
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                <Lock size={32} className="text-muted-foreground" />
                <p className="text-title text-foreground">{t('noAccess.title')}</p>
                <p className="text-body text-muted-foreground">{t('noAccess.description')}</p>
            </CardContent>
        </Card>
    );
};

export const HrLoadingRows = ({ rows = 5 }: { rows?: number }) => (
    <div className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_, index) => (
            <div
                key={index}
                className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4"
            >
                <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-6 w-20" />
            </div>
        ))}
    </div>
);

export const HrErrorState = ({ message, onRetry }: { message: string; onRetry?: () => void }) => {
    const { t } = useTranslation('erpHrStates');
    return (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-danger-200 bg-danger-50 p-4">
            <div className="flex items-center gap-2">
                <WarningCircle size={18} weight="fill" className="text-danger-600" />
                <p className="text-body text-danger-600">{message}</p>
            </div>
            {onRetry && (
                <MyButton type="button" buttonType="secondary" scale="small" onClick={onRetry}>
                    {t('retry')}
                </MyButton>
            )}
        </div>
    );
};

export const HrEmptyState = ({
    icon,
    title,
    description,
    children,
}: {
    icon?: ReactNode;
    title: string;
    description?: ReactNode;
    children?: ReactNode;
}) => (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-8 text-center sm:p-10">
        {icon}
        <div className="flex max-w-md flex-col gap-1">
            <p className="text-body font-semibold text-foreground">{title}</p>
            {description && <p className="text-caption text-muted-foreground">{description}</p>}
        </div>
        {children && (
            <div className="flex flex-wrap items-center justify-center gap-3">{children}</div>
        )}
    </div>
);
