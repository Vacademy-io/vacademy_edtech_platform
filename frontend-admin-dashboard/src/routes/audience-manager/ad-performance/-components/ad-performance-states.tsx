/**
 * Loading and error blocks for the Ad performance screen. The skeleton mirrors the real
 * layout (KPI row, chart + suggestion, table) so nothing jumps when the data arrives.
 */
import { useTranslation } from 'react-i18next';
import { WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function KpiRowSkeleton() {
    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
                <Card key={i} className="flex flex-col gap-3 p-5 shadow-none">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-8 w-32" />
                    <Skeleton className="h-3 w-28" />
                </Card>
            ))}
        </div>
    );
}

export function ChartRowSkeleton() {
    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="flex flex-col gap-4 p-5 shadow-none lg:col-span-2">
                <div className="flex items-center justify-between gap-4">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-8 w-56" />
                </div>
                <div className="flex h-72 items-end gap-2">
                    {[40, 65, 30, 80, 55, 70, 45, 90, 60, 35, 75, 50].map((h, i) => (
                        <Skeleton
                            key={i}
                            className={cn(
                                'flex-1 rounded-b-none',
                                h > 70 ? 'h-56' : h > 50 ? 'h-40' : h > 35 ? 'h-28' : 'h-20'
                            )}
                        />
                    ))}
                </div>
            </Card>
            <Card className="flex flex-col gap-3 p-5 shadow-none">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="mt-auto h-9 w-48" />
            </Card>
        </div>
    );
}

export function TableSkeleton() {
    return (
        <Card className="flex flex-col gap-3 p-5 shadow-none">
            <Skeleton className="h-5 w-40" />
            {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-4 py-2">
                    <Skeleton className="size-8 rounded-md" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-16" />
                </div>
            ))}
        </Card>
    );
}

export function ReportSkeleton() {
    return (
        <div className="flex flex-col gap-4" aria-busy="true">
            <KpiRowSkeleton />
            <ChartRowSkeleton />
            <TableSkeleton />
        </div>
    );
}

export function PageSkeleton() {
    return (
        <div className="flex flex-col gap-6" aria-busy="true">
            <div className="flex items-start gap-3">
                <Skeleton className="size-10 rounded-xl" />
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-6 w-48" />
                    <Skeleton className="h-4 w-72" />
                </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-2">
                    <Skeleton className="h-9 w-36 rounded-full" />
                    <Skeleton className="h-9 w-36 rounded-full" />
                </div>
                <Skeleton className="h-10 w-72 rounded-xl" />
            </div>
            <ReportSkeleton />
        </div>
    );
}

export function ErrorBlock({
    title,
    message,
    onRetry,
}: {
    title?: string;
    message: string;
    onRetry?: () => void;
}) {
    const { t } = useTranslation('marketingAds');
    return (
        <div
            role="alert"
            className="flex flex-col items-center gap-3 rounded-xl border border-danger-200 bg-danger-50 px-6 py-10 text-center"
        >
            <WarningCircle className="size-7 text-danger-600" />
            <div className="flex max-w-md flex-col gap-1">
                <p className="text-subtitle font-semibold text-danger-700">
                    {title ?? t('ads.states.errorTitle')}
                </p>
                <p className="text-body text-danger-700">{message}</p>
            </div>
            {onRetry && (
                <MyButton buttonType="secondary" scale="small" onClick={onRetry}>
                    {t('ads.states.retry')}
                </MyButton>
            )}
        </div>
    );
}
