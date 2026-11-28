import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, CalendarX, CaretRight } from '@phosphor-icons/react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getPlanningCoverage } from '@/routes/engagement/-services/engagement-service';
import SourceErrorNotice from './SourceErrorNotice';

/**
 * Daily engagement on the dashboard: which batches have no published tasks in the next
 * seven days, with a one-click way to plan each. Teachers see only the batches they
 * teach. Renders nothing for an institute with no active batches.
 */
export function EngagementPlanningWidget({ mine }: { mine: boolean }) {
    const { t } = useTranslation('engagement');
    const { data, isPending, isError, refetch } = useQuery({
        queryKey: ['engagement-planning-coverage', mine],
        queryFn: () => getPlanningCoverage(mine, 3),
        staleTime: 5 * 60_000,
        retry: 1,
    });

    if (!isPending && !isError && (data?.batchCount ?? 0) === 0) return null;
    const missing = data?.unplannedCount ?? 0;
    const attention = !isPending && !isError && missing > 0;

    return (
        <Card
            className={`grow shadow-none ${
                attention ? 'border-warning-200 bg-warning-50' : 'border-neutral-200 bg-neutral-50'
            }`}
        >
            <CardHeader className="p-4">
                <CardTitle
                    className={`flex items-center gap-2 text-sm font-semibold ${
                        attention ? 'text-neutral-900' : 'text-neutral-700'
                    }`}
                >
                    {attention ? (
                        <CalendarX
                            size={18}
                            weight="fill"
                            className="text-warning-600"
                            aria-hidden
                        />
                    ) : (
                        <CalendarCheck
                            size={18}
                            weight="duotone"
                            className="text-neutral-500"
                            aria-hidden
                        />
                    )}
                    {t('coverage.heading')}
                </CardTitle>
                <CardDescription
                    className={`mt-1 text-xs ${attention ? 'text-warning-700' : 'text-neutral-600'}`}
                >
                    {isPending ? (
                        <Skeleton className="h-3 w-3/4" />
                    ) : isError ? (
                        <SourceErrorNotice onRetry={() => void refetch()} />
                    ) : missing > 0 ? (
                        t('coverage.missing', { count: missing, total: data?.batchCount ?? 0 })
                    ) : (
                        t('coverage.allPlanned')
                    )}
                </CardDescription>
                {attention && data && (
                    <ul className="mt-3 space-y-1">
                        {data.unplanned.map((batch) => (
                            <li key={batch.packageSessionId}>
                                <Link
                                    to="/engagement"
                                    search={{ packageSessionId: batch.packageSessionId }}
                                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs text-neutral-800 hover:bg-warning-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                                >
                                    <span className="min-w-0 truncate">
                                        {batch.label || t('list.unknownBatch')}
                                        <span className="ms-1 text-neutral-500">
                                            {t('coverage.learners', { count: batch.learnerCount })}
                                        </span>
                                    </span>
                                    <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-primary-500">
                                        {t('coverage.plan')}
                                        <CaretRight size={12} aria-hidden />
                                    </span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
                {attention && missing > (data?.unplanned.length ?? 0) && (
                    <Link
                        to="/engagement"
                        search={{ packageSessionId: undefined }}
                        className="mt-2 inline-block text-xs font-semibold text-primary-500 hover:underline"
                    >
                        {t('coverage.seeAll')}
                    </Link>
                )}
            </CardHeader>
        </Card>
    );
}
