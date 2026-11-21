import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CaretRight } from '@phosphor-icons/react';
import { MoneyCell } from '@/components/design-system/money-cell';
import { formatDate, formatDateTime } from '@/lib/formatters';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import { fetchReturn } from '@/routes/commerce/orders/-shared/order-api';
import { orderKeys } from '@/routes/commerce/orders/-shared/order-hooks';
import { REFUND_METHODS, type ReturnView, type StaffOrderDetail } from '@/routes/commerce/orders/-shared/order-types';
import { RefundRowActions } from './RefundRowActions';
import { ReturnSheet } from './ReturnSheet';

const KNOWN_METHODS: ReadonlySet<string> = new Set([...REFUND_METHODS, 'EXCHANGE_CREDIT']);

/**
 * The received returns of an order read in full, for the manager's "Exchange
 * for a new order" (the summaries lack the credit still open). Nobody else
 * reads them.
 */
export function useExchangeReturnViews(detail: StaffOrderDetail | undefined): ReturnView[] {
    const access = useCommerceAccess();
    const enabled = access.isResolved && access.isManager && access.canOpen('commerce-orders');
    const received = (detail?.returns ?? []).filter((summary) => {
        const status = (summary.status ?? '').toUpperCase();
        return status === 'RECEIVED' || status === 'CLOSED';
    });
    const queries = useQueries({
        queries: received.map((summary) => ({
            queryKey: orderKeys.returnView(summary.id),
            queryFn: () => fetchReturn(summary.id),
            enabled,
            staleTime: 10 * 1000,
        })),
    });
    return queries.map((query) => query.data).filter((view): view is ReturnView => !!view);
}

/**
 * Returns and refunds of the order (contract §5.7.3). Every order reader sees
 * the rows; money steps (record payout, cancel, check) are the manager's.
 */
export function OrderReturnsCard({ detail }: { detail: StaffOrderDetail }) {
    const { t } = useTranslation('commerce');
    const [openReturn, setOpenReturn] = useState<string | null>(null);
    const currency = detail.order.currency;
    const empty = detail.returns.length === 0 && detail.refunds.length === 0;

    return (
        <SectionCard title={t('orders.returns.cardTitle')}>
            {empty && <p className="text-body text-muted-foreground">{t('orders.returns.none')}</p>}
            {detail.returns.length > 0 && (
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                    {detail.returns.map((summary) => (
                        <li key={summary.id}>
                            <button
                                type="button"
                                onClick={() => setOpenReturn(summary.id)}
                                className="flex min-h-12 w-full items-center justify-between gap-3 p-3 text-start hover:bg-muted"
                            >
                                <div className="flex min-w-0 flex-col gap-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-body font-medium text-foreground">
                                            {summary.return_number ?? summary.id}
                                        </span>
                                        <CommerceStatusChip kind="return" value={summary.status} />
                                    </div>
                                    <span className="text-caption text-muted-foreground">
                                        {[
                                            t('orders.returns.units', { count: summary.units ?? 0 }),
                                            summary.reason
                                                ? t(`orders.returns.reasons.${summary.reason}`, { defaultValue: summary.reason })
                                                : null,
                                            summary.created_at ? formatDate(summary.created_at) : null,
                                        ]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </span>
                                </div>
                                <div className="flex shrink-0 items-center gap-3">
                                    <div className="flex flex-col items-end">
                                        <MoneyCell value={summary.credit_total ?? 0} currency={currency} />
                                        {!!summary.refunded && (
                                            <span className="text-caption text-muted-foreground">
                                                {t('orders.returns.refundedShort')}{' '}
                                                <MoneyCell value={summary.refunded} currency={currency} className="inline" />
                                            </span>
                                        )}
                                    </div>
                                    <CaretRight size={16} className="text-muted-foreground rtl:rotate-180" />
                                </div>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {detail.refunds.length > 0 && (
                <div className="flex flex-col gap-2">
                    <h4 className="text-body font-medium text-foreground">{t('orders.refunds.title')}</h4>
                    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                        {detail.refunds.map((refund) => (
                            <li key={refund.id} className="flex flex-col gap-2 p-3">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="flex min-w-0 flex-col gap-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-body text-foreground">
                                                {refund.method && KNOWN_METHODS.has(refund.method)
                                                    ? t(`orders.refund.methods.${refund.method}`)
                                                    : (refund.method ?? '—')}
                                            </span>
                                            <CommerceStatusChip kind="refund" value={refund.status} />
                                        </div>
                                        <span className="text-caption text-muted-foreground">
                                            {[
                                                refund.return_number
                                                    ? t('orders.refunds.forReturn', { number: refund.return_number })
                                                    : null,
                                                refund.reference,
                                                refund.paid_on ? formatDate(refund.paid_on) : null,
                                                refund.processed_at ? formatDateTime(refund.processed_at) : null,
                                                refund.created_at && !refund.processed_at ? formatDateTime(refund.created_at) : null,
                                            ]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </span>
                                        {refund.failure_code && (
                                            <span className="text-caption text-danger-600">
                                                {t('orders.refunds.failed', { code: refund.failure_code })}
                                            </span>
                                        )}
                                    </div>
                                    <MoneyCell value={refund.amount ?? 0} currency={refund.currency ?? currency} />
                                </div>
                                <RefundRowActions refund={refund} currency={refund.currency ?? currency} />
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <ReturnSheet
                returnId={openReturn}
                detail={detail}
                open={openReturn !== null}
                onOpenChange={(open) => {
                    if (!open) setOpenReturn(null);
                }}
            />
        </SectionCard>
    );
}
