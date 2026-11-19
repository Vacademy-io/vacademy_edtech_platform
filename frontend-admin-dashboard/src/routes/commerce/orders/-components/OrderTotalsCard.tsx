import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { dueLoweredByReturns } from '@/routes/commerce/orders/-shared/refund-cap';
import type { StaffOrderDetail } from '@/routes/commerce/orders/-shared/order-types';
import { DetailRow } from './detail-bits';
import { money } from './order-ui';

/**
 * The order's money. "Still owed" is the server's `amount_due` (M10: the
 * figure "Record receipt" and the customer dues report use), with a line when
 * goods returned before payment lowered it (contract §15).
 */
export function OrderTotalsCard({ detail }: { detail: StaffOrderDetail }) {
    const { t } = useTranslation('commerce');
    const currency = detail.order.currency;
    const totals = detail.totals;
    const due = detail.amount_due;
    const lowered = dueLoweredByReturns(detail);
    const showDue = typeof due === 'number' && (due > 0 || lowered > 0);
    const row = (key: string, value: number | null | undefined, strong = false) =>
        value === null || value === undefined ? null : (
            <DetailRow key={key} label={t(`orders.detail.totals.${key}`)} strong={strong}>
                {money(value, currency)}
            </DetailRow>
        );
    return (
        <SectionCard title={t('orders.detail.totals.title')}>
            <div className="flex flex-col gap-1.5">
                {row('subtotal', totals?.subtotal)}
                {!!totals?.discount && row('discount', -Math.abs(totals.discount))}
                {!!totals?.shipping && row('shipping', totals.shipping)}
                {!!totals?.cod_charge && row('codCharge', totals.cod_charge)}
                {row('tax', totals?.tax)}
                {!!totals?.round_off && row('roundOff', totals.round_off)}
                <div className="my-1 border-t border-border" />
                {row('total', totals?.total ?? detail.order.total, true)}
                {row('paid', detail.order.amount_paid)}
                {!!detail.amount_refunded && row('refunded', detail.amount_refunded)}
                {!!detail.refund_open && detail.refund_open > 0 && row('refundOpen', detail.refund_open, true)}
                {showDue && row('due', Math.max(0, due), true)}
                {showDue && lowered > 0 && (
                    <p className="text-caption text-muted-foreground" data-testid="order-due-lowered">
                        {t('orders.detail.totals.dueLowered', { amount: money(lowered, currency) })}
                    </p>
                )}
            </div>
        </SectionCard>
    );
}
