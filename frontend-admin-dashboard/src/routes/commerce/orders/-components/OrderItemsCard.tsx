import { useTranslation } from 'react-i18next';
import { Warning } from '@phosphor-icons/react';
import { MoneyCell } from '@/components/design-system/money-cell';
import { SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { formatRate } from '@/routes/commerce/-shared/units';
import { itemLines, liveShipment } from '@/routes/commerce/orders/-shared/order-actions';
import { formatQuantity } from '@/routes/commerce/orders/-shared/order-format';
import type { StaffOrderDetail } from '@/routes/commerce/orders/-shared/order-types';
import { money } from './order-ui';

/** The items, with piece codes of the live parcel, and the shipping/COD charge lines. */
export function OrderItemsCard({ detail }: { detail: StaffOrderDetail }) {
    const { t } = useTranslation('commerce');
    const currency = detail.order.currency;
    const items = itemLines(detail);
    const itemIds = new Set(items.map((line) => line.id));
    const charges = detail.lines.filter((line) => !itemIds.has(line.id));
    const shipment = liveShipment(detail);
    const codesOf = (lineId: string) =>
        shipment?.lines.filter((l) => l.order_line_id === lineId).flatMap((l) => l.piece_codes) ?? [];

    return (
        <SectionCard title={t('orders.detail.items.title')}>
            <ul className="flex flex-col divide-y divide-border">
                {items.map((line) => {
                    const codes = codesOf(line.id);
                    const qty = (value: number) => formatQuantity(value, line.qty_scale, line.unit, t);
                    return (
                        <li key={line.id} className="flex flex-col gap-1 py-3 first:pt-0 sm:flex-row sm:justify-between sm:gap-4">
                            <div className="flex min-w-0 flex-col gap-0.5">
                                <span className="text-body font-medium text-foreground">{line.name ?? '—'}</span>
                                <span className="text-caption text-muted-foreground">
                                    {[line.variant_label, line.sku].filter(Boolean).join(' · ')}
                                </span>
                                {codes.length > 0 && (
                                    <span className="break-all font-mono text-caption text-foreground">
                                        {t('orders.detail.items.pieces', { codes: codes.join(', ') })}
                                    </span>
                                )}
                                <span className="text-caption text-muted-foreground">
                                    {[
                                        line.qty_cancelled > 0 ? t('orders.detail.items.cancelled', { quantity: qty(line.qty_cancelled) }) : null,
                                        line.qty_shipped > 0 ? t('orders.detail.items.shipped', { quantity: qty(line.qty_shipped) }) : null,
                                        line.qty_returned > 0 ? t('orders.detail.items.returned', { quantity: qty(line.qty_returned) }) : null,
                                    ]
                                        .filter(Boolean)
                                        .join(' · ')}
                                </span>
                                {!!line.stock_short_qty && line.stock_short_qty > 0 && (
                                    <span className="flex items-center gap-1 text-caption text-warning-600">
                                        <Warning size={14} weight="fill" />
                                        {t('orders.detail.items.stockShort', { quantity: qty(line.stock_short_qty) })}
                                    </span>
                                )}
                            </div>
                            <div className="flex shrink-0 flex-col gap-0.5 text-end text-body">
                                <span className="tabular-nums text-foreground">
                                    {t('orders.detail.items.qtyTimesPrice', {
                                        quantity: qty(line.quantity),
                                        // A measured line reads "2.5 m × ₹123.40 / m": the wire price is per 10 cm.
                                        price: formatRate(line.unit_price, line.qty_scale, line.unit, currency, t),
                                    })}
                                </span>
                                {line.price_override_by && (
                                    <span className="text-caption text-muted-foreground">
                                        {t('orders.detail.items.priceByStaff', {
                                            price: formatRate(line.list_unit_price ?? line.mrp, line.qty_scale, line.unit, currency, t),
                                        })}
                                    </span>
                                )}
                                {!!line.discount && line.discount > 0 && (
                                    <span className="text-caption text-muted-foreground">
                                        {t('orders.detail.items.discount', { amount: money(line.discount, currency) })}
                                    </span>
                                )}
                                {line.tax_rate !== null && (
                                    <span className="text-caption text-muted-foreground">
                                        {t('orders.detail.items.tax', { rate: line.tax_rate })}
                                    </span>
                                )}
                                <MoneyCell value={line.line_total} currency={currency} className="font-medium" />
                            </div>
                        </li>
                    );
                })}
                {charges.map((line) => (
                    <li key={line.id} className="flex items-baseline justify-between gap-4 py-3 text-body">
                        <span className="text-muted-foreground">
                            {line.line_type?.toUpperCase() === 'COD_CHARGE'
                                ? t('orders.detail.totals.codCharge')
                                : line.line_type?.toUpperCase() === 'SHIPPING'
                                  ? t('orders.detail.totals.shipping')
                                  : (line.name ?? line.line_type ?? '—')}
                        </span>
                        <MoneyCell value={line.line_total} currency={currency} />
                    </li>
                ))}
            </ul>
        </SectionCard>
    );
}
