import { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { ArrowClockwise } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { formatDateTime } from '@/lib/formatters';
import { SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import { fetchOrderNotifications } from '@/routes/commerce/orders/-shared/order-api';
import type { DeliveryView, StaffOrderDetail } from '@/routes/commerce/orders/-shared/order-types';
import { OrderNotice, useOrderErrorHandler, useOrderErrorText } from './order-ui';

/**
 * A trigger's name; the code itself while its strings are missing. The keys are
 * built in a variable: the trigger and delivery-code strings come with the
 * notification settings screen.
 */
export const triggerTitle = (code: string | null, t: TFunction): string => {
    if (!code) return '—';
    const key = ['notifications', 'triggers', code, 'title'].join('.');
    return t(key, { defaultValue: code });
};

const deliveryCode = (code: string | null, t: TFunction): string | null => {
    if (!code) return null;
    const key = ['notifications', 'deliveryCodes', code].join('.');
    return t(key, { defaultValue: code });
};

const newestFirst = (rows: DeliveryView[]) =>
    [...rows].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));

/** Messages sent to the customer for this order (contract §5.12.4). */
export function OrderMessagesCard({ detail }: { detail: StaffOrderDetail }) {
    const { t } = useTranslation('commerce');
    const handle = useOrderErrorHandler();
    const text = useOrderErrorText();
    const [rows, setRows] = useState<DeliveryView[]>(() => newestFirst(detail.notifications));
    const [error, setError] = useState<string | null>(null);
    useEffect(() => setRows(newestFirst(detail.notifications)), [detail.notifications]);

    const refresh = async () => {
        setError(null);
        try {
            setRows(newestFirst(await fetchOrderNotifications(detail.order.id)));
        } catch (raw) {
            const left = handle(raw);
            if (left) setError(text(left));
        }
    };

    return (
        <SectionCard
            title={t('orders.detail.messages.title')}
            actions={
                <MyButton type="button" buttonType="secondary" scale="small" onAsyncClick={refresh}>
                    <ArrowClockwise size={14} />
                    {t('orders.detail.messages.refresh')}
                </MyButton>
            }
        >
            {error && <OrderNotice tone="danger">{error}</OrderNotice>}
            {rows.length === 0 ? (
                <p className="text-body text-muted-foreground">{t('orders.detail.messages.empty')}</p>
            ) : (
                <ul className="flex flex-col divide-y divide-border">
                    {rows.map((row, index) => (
                        <li key={`${row.created_at}-${row.channel}-${index}`} className="flex flex-col gap-1 py-2 first:pt-0">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-body text-foreground">{triggerTitle(row.trigger, t)}</span>
                                <CommerceStatusChip kind="delivery" value={row.status} />
                            </div>
                            <span className="text-caption text-muted-foreground">
                                {[
                                    row.channel?.toUpperCase() === 'WHATSAPP'
                                        ? t('orders.detail.messages.whatsapp')
                                        : row.channel?.toUpperCase() === 'EMAIL'
                                          ? t('orders.detail.messages.email')
                                          : row.channel,
                                    row.locale?.toLowerCase().startsWith('hi')
                                        ? t('orders.detail.messages.hindi')
                                        : row.locale
                                          ? t('orders.detail.messages.english')
                                          : null,
                                    row.recipient_masked,
                                    deliveryCode(row.code, t),
                                ]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </span>
                            <span className="text-caption text-muted-foreground">
                                {row.created_at ? t('orders.detail.messages.created', { time: formatDateTime(row.created_at) }) : ''}
                                {row.sent_at ? ` · ${t('orders.detail.messages.sent', { time: formatDateTime(row.sent_at) })}` : ''}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </SectionCard>
    );
}
