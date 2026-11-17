import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/lib/formatters';
import { SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import type { StaffOrderDetail } from '@/routes/commerce/orders/-shared/order-types';

/** Status moves, newest first. The server gives actor ids only: shown as "Staff" (G9). */
export function OrderTimelineCard({ detail }: { detail: StaffOrderDetail }) {
    const { t } = useTranslation('commerce');
    const entries = [...detail.timeline].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
    if (entries.length === 0) return null;
    return (
        <SectionCard title={t('orders.detail.timeline.title')}>
            <ol className="flex flex-col gap-3 border-s border-border ps-4">
                {entries.map((entry, index) => (
                    <li key={`${entry.at}-${index}`} className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <CommerceStatusChip kind="order" value={entry.status} />
                            <span className="text-caption text-muted-foreground">
                                {entry.at ? formatDateTime(entry.at) : '—'}
                                {entry.actor_user_id ? ` · ${t('orders.staff')}` : ''}
                            </span>
                        </div>
                        {entry.note && <p className="whitespace-pre-line text-body text-foreground">{entry.note}</p>}
                    </li>
                ))}
            </ol>
        </SectionCard>
    );
}
