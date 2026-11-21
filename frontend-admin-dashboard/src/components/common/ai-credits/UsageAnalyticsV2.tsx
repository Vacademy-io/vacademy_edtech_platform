/**
 * Analytics tab v2 of the AI credits popover, driven by
 * GET /credits/v2/institutes/{id}/usage-summary. Cards: by feature (human
 * labels from the use-case catalog), by role, top users (admins only) and a
 * daily trend. Mounted only when usage-config reports history_v2_enabled.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChartBar } from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
    toNumber,
    useUsageSummaryQuery,
    type UsageGroupBy,
    type UsageMetric,
    type UsageSummaryRow,
} from '@/services/ai-credits/usage-v2';
import { lastIstDays } from './usageV2Format';

const DAY_CHIPS = [7, 14, 30];
const TOP_USERS = 10;

interface UsageAnalyticsV2Props {
    instituteId: string;
    isAdmin: boolean;
}

function CardShell({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl border bg-white p-3">
            <h4 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-neutral-500">
                {title}
            </h4>
            {children}
        </div>
    );
}

function CardSkeleton() {
    return (
        <div className="space-y-2">
            <Skeleton className="h-6 w-full rounded" />
            <Skeleton className="h-6 w-full rounded" />
            <Skeleton className="h-6 w-2/3 rounded" />
        </div>
    );
}

function ShareBars({
    rows,
    labelFor,
    limit,
    fmt,
}: {
    rows: UsageSummaryRow[];
    labelFor: (row: UsageSummaryRow) => string;
    limit?: number;
    fmt: Intl.NumberFormat;
}) {
    const { t } = useTranslation('aiCreditsUsage');
    const shown = limit ? rows.slice(0, limit) : rows;
    return (
        <div className="space-y-2">
            {shown.map((row) => {
                const share = Math.max(0, Math.min(100, toNumber(row.share_pct)));
                return (
                    <div key={row.key || '∅'}>
                        <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-medium text-neutral-700">
                                {labelFor(row)}
                            </span>
                            <span className="shrink-0 text-xs text-neutral-500">
                                {t('analytics.credits', {
                                    credits: fmt.format(toNumber(row.credits)),
                                })}
                            </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                            <div
                                className="h-full rounded-full bg-gradient-to-r from-purple-400 to-purple-600 transition-all duration-500"
                                // Dynamic data-driven width; no token can express it.
                                style={{ width: `${share}%` }}
                            />
                        </div>
                        <div className="mt-0.5 flex justify-between text-2xs text-neutral-400">
                            <span>{t('analytics.events', { count: row.events })}</span>
                            <span>{fmt.format(share)}%</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function SummaryCard({
    title,
    instituteId,
    days,
    groupBy,
    metric,
    labelFor,
    limit,
    fmt,
}: {
    title: string;
    instituteId: string;
    days: number;
    groupBy: UsageGroupBy;
    metric: UsageMetric;
    labelFor: (row: UsageSummaryRow) => string;
    limit?: number;
    fmt: Intl.NumberFormat;
}) {
    const { t } = useTranslation('aiCreditsUsage');
    const { data, isLoading, isError } = useUsageSummaryQuery(instituteId, days, groupBy, metric);
    return (
        <CardShell title={title}>
            {isLoading ? (
                <CardSkeleton />
            ) : isError ? (
                <p className="text-xs text-danger-600">{t('analytics.error')}</p>
            ) : !data || data.rows.length === 0 ? (
                <p className="text-xs text-neutral-400">{t('analytics.empty')}</p>
            ) : (
                <ShareBars rows={data.rows} labelFor={labelFor} limit={limit} fmt={fmt} />
            )}
        </CardShell>
    );
}

function DailyTrendCard({
    instituteId,
    days,
    metric,
    fmt,
    locale,
}: {
    instituteId: string;
    days: number;
    metric: UsageMetric;
    fmt: Intl.NumberFormat;
    locale: string;
}) {
    const { t } = useTranslation('aiCreditsUsage');
    const { data, isLoading, isError } = useUsageSummaryQuery(instituteId, days, 'day', metric);

    const series = useMemo(() => {
        const byKey = new Map((data?.rows ?? []).map((r) => [r.key, toNumber(r.credits)]));
        return lastIstDays(days).map((date) => ({ date, credits: byKey.get(date) ?? 0 }));
    }, [data, days]);
    const max = Math.max(...series.map((d) => d.credits), 0.1);

    return (
        <CardShell title={t('analytics.dailyTrend')}>
            {isLoading ? (
                <Skeleton className="h-12 w-full rounded" />
            ) : isError ? (
                <p className="text-xs text-danger-600">{t('analytics.error')}</p>
            ) : (
                <div className="flex h-12 items-end gap-0.5">
                    {series.map((day) => {
                        const h = Math.max((day.credits / max) * 100, 4);
                        const dateLabel = new Date(`${day.date}T00:00:00Z`).toLocaleDateString(
                            locale,
                            { month: 'short', day: 'numeric', timeZone: 'UTC' }
                        );
                        const tip = t('analytics.dayTooltip', {
                            date: dateLabel,
                            credits: fmt.format(day.credits),
                        });
                        return (
                            <div
                                key={day.date}
                                title={tip}
                                aria-label={tip}
                                className="group flex h-full flex-1 flex-col justify-end"
                            >
                                <div
                                    className={cn(
                                        'w-full rounded-t transition-all',
                                        day.credits > 0
                                            ? 'bg-gradient-to-t from-purple-400 to-purple-300 group-hover:from-purple-500 group-hover:to-purple-400'
                                            : 'bg-neutral-100'
                                    )}
                                    // Dynamic data-driven height; no token can express it.
                                    style={{ height: `${h}%` }}
                                />
                            </div>
                        );
                    })}
                </div>
            )}
        </CardShell>
    );
}

export function UsageAnalyticsV2({ instituteId, isAdmin }: UsageAnalyticsV2Props) {
    const { t, i18n } = useTranslation('aiCreditsUsage');
    const locale = i18n.language || 'en';
    const [days, setDays] = useState(30);
    const [metric, setMetric] = useState<UsageMetric>('charged');
    const fmt = useMemo(
        () => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
        [locale]
    );

    const { data: totals } = useUsageSummaryQuery(instituteId, days, 'use_case', metric);

    const plainLabel = (row: UsageSummaryRow) => row.label || row.key || '—';
    const roleLabel = (row: UsageSummaryRow) =>
        t(`roleClass.${row.key}`, { defaultValue: row.label || row.key || '—' });

    return (
        <div className="space-y-3">
            {/* Period + metric */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                    {DAY_CHIPS.map((d) => (
                        <button
                            key={d}
                            type="button"
                            onClick={() => setDays(d)}
                            className={cn(
                                'rounded-full px-2.5 py-1 text-2xs font-medium transition-all',
                                days === d
                                    ? 'bg-purple-600 text-white shadow-sm'
                                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                            )}
                        >
                            {d}d
                        </button>
                    ))}
                </div>
                <div className="flex items-center rounded-full bg-neutral-100 p-0.5">
                    {(['charged', 'list'] as UsageMetric[]).map((m) => (
                        <button
                            key={m}
                            type="button"
                            onClick={() => setMetric(m)}
                            className={cn(
                                'rounded-full px-2 py-0.5 text-2xs font-medium transition-all',
                                metric === m
                                    ? 'bg-white text-purple-700 shadow-sm'
                                    : 'text-neutral-500 hover:text-neutral-700'
                            )}
                        >
                            {m === 'charged' ? t('analytics.charged') : t('analytics.list')}
                        </button>
                    ))}
                </div>
            </div>

            {totals && (
                <p className="text-2xs text-neutral-500">
                    {t('analytics.total', {
                        credits: fmt.format(toNumber(totals.total_credits)),
                        events: totals.total_events,
                    })}
                </p>
            )}

            {totals && totals.rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-xs text-neutral-400">
                    <ChartBar className="mb-2 size-8 text-neutral-300" />
                    {t('analytics.empty')}
                </div>
            ) : (
                <>
                    <SummaryCard
                        title={t('analytics.byFeature')}
                        instituteId={instituteId}
                        days={days}
                        groupBy="use_case"
                        metric={metric}
                        labelFor={plainLabel}
                        fmt={fmt}
                    />
                    <SummaryCard
                        title={t('analytics.byRole')}
                        instituteId={instituteId}
                        days={days}
                        groupBy="role_class"
                        metric={metric}
                        labelFor={roleLabel}
                        fmt={fmt}
                    />
                    {isAdmin && (
                        <SummaryCard
                            title={t('analytics.topUsers')}
                            instituteId={instituteId}
                            days={days}
                            groupBy="user"
                            metric={metric}
                            labelFor={plainLabel}
                            limit={TOP_USERS}
                            fmt={fmt}
                        />
                    )}
                    <DailyTrendCard
                        instituteId={instituteId}
                        days={days}
                        metric={metric}
                        fmt={fmt}
                        locale={locale}
                    />
                </>
            )}
        </div>
    );
}
