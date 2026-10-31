import { useTranslation } from 'react-i18next';
import { useCrmDashboardBlocks } from '@/routes/dashboard/-services/use-crm-blocks';
import type { CrmListStatsRow } from '@/routes/dashboard/-services/crm-dashboard';
import { Sparkline } from '@/routes/dashboard/-components/crm/crm-cards';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { LEAD_LIST_BLOCKS } from '../lead-list-blocks';

/**
 * Lead List card numbers: leads with a 14-day sparkline, new today,
 * unassigned, overdue and converted. One shared request for every card on the page.
 */
export function ListCardStats({ audienceId }: { audienceId: string }) {
    const { t } = useTranslation('crmPages');
    const { pick, isLoading } = useCrmDashboardBlocks(LEAD_LIST_BLOCKS);
    if (!audienceId) return null;
    if (isLoading) return <Skeleton className="h-14 rounded-lg" />;
    const row = pick<{ rows: CrmListStatsRow[] }>('list_stats')?.rows.find(
        (r) => r.audience_id === audienceId
    );
    // No numbers for this list (refused, failed, or outside the caller's scope): show
    // nothing rather than a row of zeros.
    if (!row) return null;
    const n = (v: number | undefined) => (v ?? 0).toLocaleString('en-IN');
    const rate = row && row.leads > 0 ? Math.round((row.converted / row.leads) * 100) : 0;
    const cell = 'flex min-w-0 flex-col rounded-lg bg-neutral-50 px-2.5 py-2';
    return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" onClick={(e) => e.stopPropagation()}>
            <div className={cn(cell, 'sm:col-span-1')}>
                <span className="text-neutral-500">
                    <span className="text-caption">{t('leadList.card.leads')}</span>
                </span>
                <span className="flex items-center justify-between gap-1">
                    <b className="tabular-nums text-neutral-900">{n(row?.leads)}</b>
                    {row && row.daily.some((d) => d > 0) && (
                        <Sparkline values={row.daily} tint="primary" id={`list-${audienceId}`} />
                    )}
                </span>
            </div>
            {(
                [
                    ['newToday', row?.new_today, 'text-info-600'],
                    [
                        'unassigned',
                        row?.unassigned,
                        row?.unassigned ? 'text-warning-700' : 'text-neutral-900',
                    ],
                    [
                        'overdue',
                        row?.overdue,
                        row?.overdue ? 'text-danger-600' : 'text-neutral-900',
                    ],
                ] as const
            ).map(([k, v, tone]) => (
                <div key={k} className={cell}>
                    <span className="text-neutral-500">
                        <span className="text-caption">{t(`leadList.card.${k}`)}</span>
                    </span>
                    <b className={cn('tabular-nums', tone)}>{n(v)}</b>
                </div>
            ))}
            <div className={cell}>
                <span className="text-neutral-500">
                    <span className="text-caption">{t('leadList.card.converted')}</span>
                </span>
                <span className="flex items-center gap-1.5">
                    <b className="tabular-nums text-success-700">{n(row?.converted)}</b>
                    <span className="rounded-full bg-success-50 px-1.5 text-success-700">
                        <span className="text-caption">{rate}%</span>
                    </span>
                </span>
            </div>
        </div>
    );
}
