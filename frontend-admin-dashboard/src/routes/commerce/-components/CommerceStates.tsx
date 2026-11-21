import type { ReactNode } from 'react';
import { HourglassMedium, Lock, WarningCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { StatusChip } from '@/components/design-system/status-chips';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { type CommerceStatusKind, commerceStatusMeta } from '@/routes/commerce/-shared/status-maps';

/**
 * The states every commerce screen renders: loading as skeleton
 * rows, an error with the server's sentence and Retry, an illustration-free
 * empty card, "no access", and "coming soon" for a card whose backend is not
 * built yet. One place, so the screens agree on wording and shape.
 */

export const CommerceLoadingRows = ({ rows = 4 }: { rows?: number }) => (
    <div className="flex flex-col gap-2" aria-busy="true">
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

export const CommerceErrorState = ({
    message,
    onRetry,
}: {
    message: string;
    onRetry?: () => void;
}) => {
    const { t } = useTranslation('commerce');
    return (
        <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-lg border border-danger-200 bg-danger-50 p-4"
        >
            <div className="flex items-start gap-2">
                <WarningCircle size={18} weight="fill" className="mt-0.5 text-danger-600" />
                <p className="text-body text-danger-600">{message}</p>
            </div>
            {onRetry && (
                <MyButton type="button" buttonType="secondary" scale="small" onClick={onRetry}>
                    {t('common.retry')}
                </MyButton>
            )}
        </div>
    );
};

export const CommerceEmptyState = ({
    title,
    description,
    children,
}: {
    title: string;
    description?: ReactNode;
    children?: ReactNode;
}) => (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
        <div className="flex max-w-md flex-col gap-1">
            <p className="text-body font-medium text-foreground">{title}</p>
            {description && <p className="text-caption text-muted-foreground">{description}</p>}
        </div>
        {children && (
            <div className="flex flex-wrap items-center justify-center gap-3">{children}</div>
        )}
    </div>
);

/** A deep link the person's role does not open (the action itself is hidden). */
export const CommerceNoAccessCard = ({ className }: { className?: string }) => {
    const { t } = useTranslation('commerce');
    return (
        <Card className={cn('mx-auto w-full max-w-lg', className)}>
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                <Lock size={32} className="text-muted-foreground" />
                <p className="text-title text-foreground">{t('noAccess.title')}</p>
                <p className="text-body text-muted-foreground">{t('noAccess.description')}</p>
            </CardContent>
        </Card>
    );
};

/** A screen or card that is designed but whose backend is not built yet. */
export const CommerceComingSoon = ({
    title,
    description,
}: {
    title: string;
    description?: string;
}) => {
    const { t } = useTranslation('commerce');
    return (
        <Card className="mx-auto w-full max-w-lg">
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                <HourglassMedium size={32} className="text-muted-foreground" />
                <p className="text-title text-foreground">{title}</p>
                <p className="text-body text-muted-foreground">
                    {description ?? t('comingSoon.description')}
                </p>
                <StatusChip
                    text={t('comingSoon.badge')}
                    textSize="text-caption"
                    status="INFO"
                    showIcon={false}
                />
            </CardContent>
        </Card>
    );
};

/** A status from `status-maps.ts` as a chip. The only way a commerce status is drawn. */
export const CommerceStatusChip = ({
    kind,
    value,
}: {
    kind: CommerceStatusKind;
    value: string | null | undefined;
}) => {
    const { t } = useTranslation('commerce');
    const meta = commerceStatusMeta(kind, value);
    return (
        <StatusChip
            text={meta.known ? t(meta.labelKey) : meta.value || t('common.unknown')}
            textSize="text-caption"
            status={meta.tone}
            showIcon={false}
        />
    );
};
