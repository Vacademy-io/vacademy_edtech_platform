import { useTranslation } from 'react-i18next';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import { formatDate, formatDateTime } from '@/lib/formatters';
import { RTO_REASONS, type StaffOrderDetail } from '@/routes/commerce/orders/-shared/order-types';
import { DetailRow } from './detail-bits';

const RTO_REASON_SET: ReadonlySet<string> = new Set(RTO_REASONS);

/** Every parcel of the order (Phase 1: one live one, plus cancelled ones). */
export function OrderParcelCard({ detail }: { detail: StaffOrderDetail }) {
    const { t } = useTranslation('commerce');
    if (detail.shipments.length === 0) return null;
    return (
        <SectionCard title={t('orders.detail.parcel.title')}>
            <div className="flex flex-col gap-4">
                {detail.shipments.map((shipment) => {
                    const codes = shipment.lines.flatMap((line) => line.piece_codes);
                    return (
                        <div key={shipment.id} className="flex flex-col gap-1.5">
                            <div>
                                <CommerceStatusChip kind="shipment" value={shipment.status} />
                            </div>
                            {shipment.carrier_name && (
                                <DetailRow label={t('orders.ship.courier')}>{shipment.carrier_name}</DetailRow>
                            )}
                            {shipment.tracking_number && (
                                <DetailRow label={t('orders.ship.trackingNumber')}>
                                    {shipment.tracking_url ? (
                                        <a
                                            href={shipment.tracking_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-primary-500 hover:underline"
                                        >
                                            {shipment.tracking_number}
                                            <ArrowSquareOut size={14} />
                                        </a>
                                    ) : (
                                        shipment.tracking_number
                                    )}
                                </DetailRow>
                            )}
                            {shipment.weight_grams !== null && (
                                <DetailRow label={t('orders.ship.weight')}>{shipment.weight_grams}</DetailRow>
                            )}
                            {shipment.packed_at && (
                                <DetailRow label={t('orders.detail.parcel.packedAt')}>{formatDateTime(shipment.packed_at)}</DetailRow>
                            )}
                            {shipment.shipped_at && (
                                <DetailRow label={t('orders.detail.parcel.shippedAt')}>{formatDateTime(shipment.shipped_at)}</DetailRow>
                            )}
                            {shipment.delivered_on && (
                                <DetailRow label={t('orders.detail.parcel.deliveredOn')}>{formatDate(shipment.delivered_on)}</DetailRow>
                            )}
                            {shipment.rto_at && (
                                <DetailRow label={t('orders.detail.parcel.rtoAt')}>{formatDateTime(shipment.rto_at)}</DetailRow>
                            )}
                            {shipment.rto_reason && (
                                <DetailRow label={t('orders.reason')}>
                                    {RTO_REASON_SET.has(shipment.rto_reason)
                                        ? t(`orders.rto.reasons.${shipment.rto_reason}`)
                                        : shipment.rto_reason}
                                </DetailRow>
                            )}
                            {shipment.rto_received_at && (
                                <DetailRow label={t('orders.detail.parcel.rtoReceivedAt')}>
                                    {formatDateTime(shipment.rto_received_at)}
                                </DetailRow>
                            )}
                            {codes.length > 0 && (
                                <p className="break-all font-mono text-caption text-foreground">
                                    {t('orders.detail.items.pieces', { codes: codes.join(', ') })}
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>
        </SectionCard>
    );
}
