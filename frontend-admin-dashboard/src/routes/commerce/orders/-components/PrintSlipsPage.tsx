import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import { Printer } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { CommerceEmptyState } from '@/routes/commerce/-components/CommerceStates';
import { fetchOrder } from '@/routes/commerce/orders/-shared/order-api';
import { orderKeys } from '@/routes/commerce/orders/-shared/order-hooks';
import type { StaffOrderDetail } from '@/routes/commerce/orders/-shared/order-types';
import { PackingSlip } from './PackingSlip';

/** At most this many slips per print job, and this many orders read at once. */
export const MAX_PRINT_IDS = 50;
const CONCURRENT_READS = 6;

/** `a,b,,a` → `['a','b']`, at most 50. */
export function parsePrintIds(raw: string | undefined): string[] {
    const ids = (raw ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    return Array.from(new Set(ids)).slice(0, MAX_PRINT_IDS);
}

/**
 * Print packing slips (contract §5.10): a full page without the app frame,
 * one slip per order on its own sheet, and the print dialog once every order
 * has answered. Invoices are not merged here (one PDF per order, G7).
 */
export function PrintSlipsPage({ ids }: { ids?: string }) {
    const { t } = useTranslation('commerce');
    const orderIds = useMemo(() => parsePrintIds(ids), [ids]);
    const shopName =
        useInstituteDetailsStore((state) => state.instituteDetails?.institute_name) || t('orders.print.shop');

    // Six at a time: the next six start once the earlier ones have settled.
    const [limit, setLimit] = useState(CONCURRENT_READS);
    const pooled = useQueries({
        queries: orderIds.map((orderId, index) => ({
            queryKey: orderKeys.detail(orderId),
            queryFn: () => fetchOrder(orderId),
            staleTime: 10 * 1000,
            retry: 1,
            enabled: index < limit,
        })),
    });
    const settledCount = pooled.filter((q) => q.isSuccess || q.isError).length;
    useEffect(() => {
        if (settledCount >= limit && limit < orderIds.length) setLimit((current) => current + CONCURRENT_READS);
    }, [settledCount, limit, orderIds.length]);
    const allSettled = orderIds.length > 0 && pooled.every((q) => q.isSuccess || q.isError);

    const printed = useRef(false);
    useEffect(() => {
        if (!allSettled || printed.current) return;
        printed.current = true;
        const timer = setTimeout(() => {
            try {
                window.print();
            } catch {
                // The Print button is still there.
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [allSettled]);

    return (
        <div className="min-h-screen bg-background">
            <Helmet>
                <title>{t('meta.pageTitle', { title: t('orders.print.title') })}</title>
            </Helmet>
            <div className="flex items-center justify-between gap-3 border-b border-border p-4 print:hidden">
                <div className="flex flex-col">
                    <h1 className="text-title font-medium text-foreground">{t('orders.print.title')}</h1>
                    <p className="text-caption text-muted-foreground">
                        {allSettled
                            ? t('orders.print.ready', { count: orderIds.length })
                            : t('orders.print.loading', { done: settledCount, count: orderIds.length })}
                    </p>
                </div>
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="medium"
                    disable={!allSettled}
                    onClick={() => window.print()}
                >
                    <Printer size={16} />
                    {t('orders.print.print')}
                </MyButton>
            </div>
            {orderIds.length === 0 && (
                <div className="p-4">
                    <CommerceEmptyState title={t('orders.print.none')} />
                </div>
            )}
            <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 print:max-w-none print:gap-0 print:p-0">
                {orderIds.map((orderId, index) => {
                    const query = pooled[index];
                    if (!query || query.isPending) {
                        return <Skeleton key={orderId} className="h-64 w-full print:hidden" />;
                    }
                    if (query.isError || !query.data) {
                        return (
                            <article
                                key={orderId}
                                className="break-after-page rounded-lg border border-border p-6 text-body text-danger-600 print:border-0"
                            >
                                {t('orders.print.failed', { id: orderId })}
                            </article>
                        );
                    }
                    return (
                        <div key={orderId} className="rounded-lg border border-border print:rounded-none print:border-0">
                            <PackingSlip detail={query.data as StaffOrderDetail} shopName={shopName} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
