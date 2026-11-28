import { useCallback, useSyncExternalStore } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface BoardStatus {
    status_key: string;
    label: string;
}

const PALETTE = [
    'bg-primary-500',
    'bg-info-500',
    'bg-warning-500',
    'bg-success-500',
    'bg-primary-300',
    'bg-info-300',
    'bg-warning-300',
    'bg-success-300',
    'bg-neutral-400',
];

/**
 * Lead Board: one strip that adds up the board's own column totals (read
 * from the columns' query cache — no extra request), so it always matches the board
 * and its filters. Columns themselves are untouched.
 */
export function LeadBoardEnhancedStrip({
    statuses,
    scopeId,
    basePayload,
}: {
    statuses: BoardStatus[];
    scopeId: string;
    basePayload: unknown;
}) {
    const { t } = useTranslation('crmPages');
    const qc = useQueryClient();
    const baseKey = JSON.stringify(basePayload);

    const subscribe = useCallback((cb: () => void) => qc.getQueryCache().subscribe(cb), [qc]);
    const snapshot = useCallback(() => {
        const totals = statuses.map((s) => {
            const hit = qc
                .getQueriesData<InfiniteData<{ totalElements?: number }>>({
                    queryKey: ['lead-board', 'lead-board', scopeId, baseKey, s.status_key],
                })
                .find(([, d]) => d?.pages?.[0]?.totalElements != null);
            return hit?.[1]?.pages?.[0]?.totalElements ?? -1;
        });
        return totals.join(',');
    }, [qc, statuses, scopeId, baseKey]);
    const raw = useSyncExternalStore(subscribe, snapshot, snapshot);
    const totals = raw.split(',').map(Number);
    const known = totals.filter((n) => n >= 0);
    if (known.length === 0) return null;
    const sum = known.reduce((a, b) => a + b, 0);
    const rows = statuses
        .map((s, i) => ({ ...s, n: totals[i] ?? -1, color: PALETTE[i % PALETTE.length]! }))
        .filter((r) => r.n >= 0);
    const biggest = [...rows].sort((a, b) => b.n - a.n)[0];

    return (
        <Card className="mb-3 rounded-xl border-neutral-200 p-4 shadow-sm">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-neutral-900">
                    <span className="text-body">
                        {t('leadBoard.total', { total: sum.toLocaleString('en-IN') })}
                    </span>
                </span>
                {biggest && sum > 0 && (
                    <span className="text-neutral-500">
                        <span className="text-caption">
                            {t('leadBoard.biggest', {
                                name: biggest.label,
                                share: `${Math.round((biggest.n / sum) * 100)}%`,
                            })}
                        </span>
                    </span>
                )}
            </div>
            <div className="flex h-3 overflow-hidden rounded-full bg-neutral-100">
                {rows.map((r) =>
                    r.n > 0 ? (
                        <span
                            key={r.status_key}
                            title={`${r.label}: ${r.n}`}
                            className={cn('h-full', r.color)}
                            style={{ width: `${(r.n / Math.max(1, sum)) * 100}%` }} // design-lint-ignore: data-driven share of the bar
                        />
                    ) : null
                )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {rows.map((r) => (
                    <span key={r.status_key} className="flex items-center gap-1.5 text-neutral-600">
                        <span className={cn('size-2 rounded-sm', r.color)} />
                        <span className="text-caption">
                            {r.label} <b className="tabular-nums">{r.n.toLocaleString('en-IN')}</b>
                        </span>
                    </span>
                ))}
            </div>
            <p className="mt-2 text-neutral-500">
                <span className="text-caption">{t('leadBoard.caption')}</span>
            </p>
        </Card>
    );
}
