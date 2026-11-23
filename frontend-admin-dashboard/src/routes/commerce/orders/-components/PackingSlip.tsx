import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/lib/formatters';
import { itemLines, liveShipment } from '@/routes/commerce/orders/-shared/order-actions';
import { codToCollect, formatQuantity } from '@/routes/commerce/orders/-shared/order-format';
import type { StaffOrderDetail } from '@/routes/commerce/orders/-shared/order-types';
import { AddressBlock, money } from './order-ui';

/**
 * One packing slip (OPS §5 "Documents"): what goes in the parcel and where it
 * goes, never prices. The QR holds the order number, so the pack station's scan
 * box finds the order from the slip. COD orders show the amount to collect in
 * large type for the courier.
 */
export function PackingSlip({ detail, shopName }: { detail: StaffOrderDetail; shopName: string }) {
    const { t } = useTranslation('commerce');
    const order = detail.order;
    const shipment = liveShipment(detail);
    const isCod = (order.payment_method ?? '').toUpperCase() === 'COD';
    const codesOf = (lineId: string) =>
        shipment?.lines.find((line) => line.order_line_id === lineId)?.piece_codes ?? [];

    return (
        <article className="flex break-after-page flex-col gap-4 bg-background p-6 text-foreground">
            <header className="flex items-start justify-between gap-4 border-b border-border pb-4">
                <div className="flex flex-col gap-1">
                    <span className="text-subtitle text-muted-foreground">{shopName}</span>
                    <span className="text-caption text-muted-foreground">{t('orders.print.slipTitle')}</span>
                    <span className="text-h3 font-medium tabular-nums">{order.order_number}</span>
                    {order.created_at && (
                        <span className="text-body text-muted-foreground">
                            {t('orders.print.date', { date: formatDate(order.created_at) })}
                        </span>
                    )}
                </div>
                <QRCodeSVG
                    value={order.order_number}
                    size={96}
                    fgColor="currentColor"
                    bgColor="transparent"
                    aria-label={t('orders.print.qr', { number: order.order_number })}
                    role="img"
                />
            </header>

            <section className="flex flex-col gap-1">
                <h2 className="text-caption text-muted-foreground">{t('orders.print.shipTo')}</h2>
                <AddressBlock address={detail.shipping_address} />
                {!detail.shipping_address?.phone && order.customer_phone && (
                    <span className="text-body">{order.customer_phone}</span>
                )}
            </section>

            {isCod && (
                <p className="rounded-md border-2 border-foreground p-3 text-h3 font-medium">
                    {t('orders.cod.collect', { amount: money(codToCollect(order), order.currency) })}
                </p>
            )}

            <table className="w-full border-collapse text-body">
                <thead>
                    <tr className="border-b border-border text-caption text-muted-foreground">
                        <th className="py-2 text-start font-normal">{t('orders.print.item')}</th>
                        <th className="py-2 text-start font-normal">{t('orders.print.sku')}</th>
                        <th className="py-2 text-end font-normal">{t('orders.print.quantity')}</th>
                    </tr>
                </thead>
                <tbody>
                    {itemLines(detail)
                        .filter((line) => line.quantity - line.qty_cancelled > 0)
                        .map((line) => {
                            const codes = codesOf(line.id);
                            return (
                                <tr key={line.id} className="border-b border-border align-top">
                                    <td className="py-2">
                                        <div className="font-medium">{line.name ?? '—'}</div>
                                        {line.variant_label && (
                                            <div className="text-caption text-muted-foreground">{line.variant_label}</div>
                                        )}
                                        {codes.length > 0 && (
                                            <div className="text-caption">
                                                {t('orders.print.pieces', { codes: codes.join(', ') })}
                                            </div>
                                        )}
                                    </td>
                                    <td className="py-2">{line.sku ?? '—'}</td>
                                    <td className="py-2 text-end tabular-nums">
                                        {formatQuantity(line.quantity - line.qty_cancelled, line.qty_scale, line.unit, t)}
                                    </td>
                                </tr>
                            );
                        })}
                </tbody>
            </table>

            {detail.customer_note && (
                <section className="flex flex-col gap-1">
                    <h2 className="text-caption text-muted-foreground">{t('orders.print.customerNote')}</h2>
                    <p className="text-body">{detail.customer_note}</p>
                </section>
            )}
            {detail.gift_note && (
                <section className="flex flex-col gap-1">
                    <h2 className="text-caption text-muted-foreground">{t('orders.print.giftNote')}</h2>
                    <p className="text-body">{detail.gift_note}</p>
                </section>
            )}
        </article>
    );
}
