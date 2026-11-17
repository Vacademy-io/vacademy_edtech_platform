import { type ReactNode, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/formatters';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import { CommerceErrorState, CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import { serverActions } from '@/routes/commerce/orders/-shared/order-actions';
import { readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { channelLabel, codToCollect, paymentLabel } from '@/routes/commerce/orders/-shared/order-format';
import { useOrderDetail } from '@/routes/commerce/orders/-shared/order-hooks';
import type { ReturnView, StaffOrderDetail } from '@/routes/commerce/orders/-shared/order-types';
import { type ExtraOrderDialogs, OrderActionBar, OrderDialogSwitch } from './OrderActionBar';
import { OrderCustomerCard } from './OrderCustomerCard';
import { OrderDocumentsCard } from './OrderDocumentsCard';
import { OrderItemsCard } from './OrderItemsCard';
import { OrderMessagesCard } from './OrderMessagesCard';
import { OrderParcelCard } from './OrderParcelCard';
import { OrderPaymentsCard } from './OrderPaymentsCard';
import { OrderTimelineCard } from './OrderTimelineCard';
import { OrderTotalsCard } from './OrderTotalsCard';
import { OrderAccessAlertContext, OrderNotice, money, useOrderErrorText } from './order-ui';

interface OrderDetailPageProps {
    orderId: string;
    /** A dialog to open once (desk deep link), only when the server offers it. */
    initialAction?: string;
    /** Part 3: the returns and refunds card. */
    renderReturns?: (detail: StaffOrderDetail) => ReactNode;
    /** Part 3: dialogs for CREATE_RETURN and REFUND. */
    extraDialogs?: ExtraOrderDialogs;
    /** Part 3: returns read in full (the Exchange action needs them). */
    returnViews?: readonly ReturnView[];
}

/** S2: one order with its action table, items, money, parcel, people and messages. */
export function OrderDetailPage(props: OrderDetailPageProps) {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const query = useOrderDetail(props.orderId, access.isResolved && access.canOpen('commerce-orders'));
    const detail = query.data;
    // Above the page so a 403 from the header's dialogs lands on the page too.
    const [accessMessage, setAccessMessage] = useState<string | null>(null);
    return (
        <OrderAccessAlertContext.Provider value={setAccessMessage}>
            <CommercePage
                navId="commerce-orders"
                title={detail ? t('orders.detail.title', { number: detail.order.order_number }) : t('orders.title')}
                backTo={{ to: '/commerce/orders', label: t('orders.backToDesk') }}
                actions={
                    detail ? (
                        <OrderActionBar
                            detail={detail}
                            returnViews={props.returnViews}
                            extraDialogs={props.extraDialogs}
                            initialAction={props.initialAction}
                        />
                    ) : undefined
                }
            >
                <OrderDetailBody
                    query={query}
                    accessMessage={accessMessage}
                    onDismissAccess={() => setAccessMessage(null)}
                    {...props}
                />
            </CommercePage>
        </OrderAccessAlertContext.Provider>
    );
}

function OrderDetailBody({
    query,
    renderReturns,
    extraDialogs,
    accessMessage,
    onDismissAccess,
}: OrderDetailPageProps & {
    query: ReturnType<typeof useOrderDetail>;
    accessMessage: string | null;
    onDismissAccess: () => void;
}) {
    const { t } = useTranslation('commerce');
    const text = useOrderErrorText();
    const [clearing, setClearing] = useState(false);

    if (query.isLoading) {
        return (
            <div className="grid gap-4 lg:grid-cols-3" aria-busy="true">
                <Skeleton className="h-64 w-full lg:col-span-2" />
                <Skeleton className="h-64 w-full" />
                <Skeleton className="h-40 w-full lg:col-span-2" />
            </div>
        );
    }
    if (query.isError) {
        const error = readOrderError(query.error);
        if (error.status === 404) {
            return (
                <OrderNotice tone="warning">
                    <p>{t('orders.errors.ORDER_NOT_FOUND')}</p>
                    <Link to="/commerce/orders" className="text-primary-500 hover:underline">
                        {t('orders.detail.backToDesk')}
                    </Link>
                </OrderNotice>
            );
        }
        return <CommerceErrorState message={text(error)} onRetry={() => void query.refetch()} />;
    }
    const detail = query.data;
    if (!detail) return null;
    const order = detail.order;
    const actions = serverActions(detail);
    const awaitingRemittance =
        (order.payment_method ?? '').toUpperCase() === 'COD' &&
        order.status === 'DELIVERED' &&
        (order.payment_status ?? '').toUpperCase() === 'UNPAID' &&
        !detail.cod_remittance_id;

    return (
        <>
            <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                    <CommerceStatusChip kind="order" value={order.status} />
                    <span className="text-caption text-muted-foreground">{paymentLabel(order, t)}</span>
                    <CommerceStatusChip kind="paymentStatus" value={order.payment_status} />
                    <span className="text-caption text-muted-foreground">
                        {channelLabel(order.channel, t)}
                        {order.created_at ? ` · ${formatDateTime(order.created_at)}` : ''}
                    </span>
                </div>
                {accessMessage && (
                    <OrderNotice
                        tone="danger"
                        action={
                            <MyButton type="button" buttonType="secondary" scale="small" onClick={onDismissAccess}>
                                {t('orders.detail.dismiss')}
                            </MyButton>
                        }
                    >
                        {accessMessage}
                    </OrderNotice>
                )}
                {detail.stock_short && (
                    <OrderNotice
                        tone="warning"
                        action={
                            actions.includes('CLEAR_STOCK_SHORT') ? (
                                <MyButton type="button" buttonType="secondary" scale="small" onClick={() => setClearing(true)}>
                                    {t('orders.detail.alerts.clear')}
                                </MyButton>
                            ) : undefined
                        }
                    >
                        {t('orders.detail.alerts.stockShort')}
                    </OrderNotice>
                )}
                {!!detail.refund_open && detail.refund_open > 0 && (
                    <OrderNotice tone="warning">
                        {t('orders.detail.alerts.refundOpen', { amount: money(detail.refund_open, order.currency) })}
                    </OrderNotice>
                )}
                {awaitingRemittance && (
                    <OrderNotice tone="info">
                        {t('orders.detail.alerts.codAwaiting', { amount: money(codToCollect(order), order.currency) })}
                    </OrderNotice>
                )}
                {detail.exchange_of_order_id && (
                    <OrderNotice tone="info">
                        <Link
                            to="/commerce/orders/$orderId"
                            params={{ orderId: detail.exchange_of_order_id }}
                            className="text-primary-500 hover:underline"
                        >
                            {t('orders.detail.alerts.exchangeOf')}
                        </Link>
                    </OrderNotice>
                )}

                <div className="grid items-start gap-4 lg:grid-cols-3">
                    <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
                        <OrderItemsCard detail={detail} />
                    </div>
                    <div className="flex min-w-0 flex-col gap-4 lg:col-start-3 lg:row-span-2 lg:row-start-1">
                        <OrderCustomerCard detail={detail} />
                        <OrderDocumentsCard detail={detail} />
                    </div>
                    <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
                        <OrderTotalsCard detail={detail} />
                        <OrderParcelCard detail={detail} />
                        {renderReturns?.(detail) ?? null}
                        <OrderPaymentsCard detail={detail} />
                        <OrderMessagesCard detail={detail} />
                        <OrderTimelineCard detail={detail} />
                    </div>
                </div>
            </div>
            {clearing && (
                <OrderDialogSwitch
                    code="CLEAR_STOCK_SHORT"
                    detail={detail}
                    extraDialogs={extraDialogs}
                    onClose={() => setClearing(false)}
                />
            )}
        </>
    );
}
