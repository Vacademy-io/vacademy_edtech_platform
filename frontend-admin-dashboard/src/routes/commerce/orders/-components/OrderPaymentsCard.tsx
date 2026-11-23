import { useTranslation } from 'react-i18next';
import { MoneyCell } from '@/components/design-system/money-cell';
import { formatDateTime } from '@/lib/formatters';
import { SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { TENDER_MODES, type StaffOrderDetail } from '@/routes/commerce/orders/-shared/order-types';

const KNOWN_MODES: ReadonlySet<string> = new Set(TENDER_MODES);

/** Payments received against the order (tenders). */
export function OrderPaymentsCard({ detail }: { detail: StaffOrderDetail }) {
    const { t } = useTranslation('commerce');
    return (
        <SectionCard title={t('orders.detail.payments.title')}>
            {detail.tenders.length === 0 ? (
                <p className="text-body text-muted-foreground">{t('orders.detail.payments.none')}</p>
            ) : (
                <ul className="flex flex-col divide-y divide-border">
                    {detail.tenders.map((tender) => (
                        <li key={tender.id} className="flex items-start justify-between gap-3 py-2 first:pt-0">
                            <div className="flex min-w-0 flex-col">
                                <span className="text-body text-foreground">
                                    {tender.mode && KNOWN_MODES.has(tender.mode)
                                        ? t(`orders.tender.${tender.mode}`)
                                        : (tender.mode ?? '—')}
                                </span>
                                <span className="text-caption text-muted-foreground">
                                    {[tender.reference, tender.status, tender.received_at ? formatDateTime(tender.received_at) : null]
                                        .filter(Boolean)
                                        .join(' · ')}
                                </span>
                            </div>
                            <MoneyCell value={tender.amount} currency={detail.order.currency} />
                        </li>
                    ))}
                </ul>
            )}
        </SectionCard>
    );
}
