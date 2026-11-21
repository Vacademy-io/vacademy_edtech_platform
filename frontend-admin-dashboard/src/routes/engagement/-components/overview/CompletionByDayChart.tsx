import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts';
import type { TooltipProps } from 'recharts';
import { ChartBar } from '@phosphor-icons/react';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import type { PlanOverviewDay } from '../../-types/types';
import { formatDay, formatNumber, formatPercent } from '../../-utils/format';

/**
 * Completion by day: for each day a task ran, the share of learner-task pairs that
 * were finished (the server's `days[]`, oldest first, at most the last 60 run days).
 *
 * Today's bar is drawn lighter because the day is still open, so a half-full bar
 * there isn't read as a bad day.
 */

export interface CompletionDatum {
    date: string;
    label: string;
    /** 0–100, or null when nothing was available that day. */
    percent: number | null;
    completed: number;
    available: number;
    tasks: number;
    isToday: boolean;
}

/** Pure: server days → chart rows. Exported for tests. */
export function toCompletionData(
    days: PlanOverviewDay[] | null | undefined,
    lang: string,
    today?: string | null
): CompletionDatum[] {
    if (!days?.length) return [];
    return days.map((d) => {
        const available = d.available ?? 0;
        const completed = d.completed ?? 0;
        const rate =
            d.rate != null && Number.isFinite(d.rate)
                ? d.rate
                : available > 0
                  ? completed / available
                  : null;
        return {
            date: d.date,
            label: formatDay(d.date, lang, { weekday: false }),
            percent: rate == null ? null : Math.round(Math.min(1, Math.max(0, rate)) * 100),
            completed,
            available,
            tasks: d.tasks ?? 0,
            isToday: Boolean(today) && d.date === today,
        };
    });
}

/** Completion across every closed-out day (today excluded while it is still open). */
export function averageCompletion(data: CompletionDatum[]): number | null {
    let done = 0;
    let available = 0;
    for (const d of data) {
        if (d.isToday) continue;
        done += d.completed;
        available += d.available;
    }
    return available > 0 ? Math.min(1, done / available) : null;
}

const chartConfig = {
    percent: { label: 'percent', color: 'hsl(var(--primary-500))' },
} satisfies ChartConfig;

const TODAY_FILL = 'hsl(var(--primary-300))';

export interface CompletionByDayChartProps {
    days: PlanOverviewDay[] | null | undefined;
    /** yyyy-MM-dd "today" in the plan's timezone (server `today`). */
    today?: string | null;
    loading?: boolean;
}

export function CompletionByDayChart({ days, today, loading = false }: CompletionByDayChartProps) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const data = useMemo(() => toCompletionData(days, lang, today), [days, lang, today]);
    const average = averageCompletion(data);
    const hasToday = data.some((d) => d.isToday);
    // Time reads right-to-left in RTL: the newest day sits at the start edge. Follow the
    // document's direction (the admin flips it only once RTL is enabled), not the language.
    const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';

    return (
        <section
            className="flex h-full min-w-0 flex-col rounded-lg border border-neutral-200 bg-white p-4"
            aria-labelledby="overview-chart-heading"
        >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3
                    id="overview-chart-heading"
                    className="text-subtitle font-semibold text-neutral-900"
                >
                    {t('overview.chart.title')}
                </h3>
                {average != null && (
                    <span className="text-caption text-neutral-500">
                        {t('overview.chart.average', { percent: formatPercent(average, lang) })}
                    </span>
                )}
            </div>
            <p className="mt-0.5 text-caption text-neutral-500">{t('overview.chart.subtitle')}</p>

            {loading ? (
                <Skeleton className="mt-4 h-48 w-full rounded-md" />
            ) : data.length === 0 ? (
                <div className="mt-4 flex min-h-48 flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-neutral-200 px-4 text-center">
                    <ChartBar size={24} className="text-neutral-400" aria-hidden />
                    <p className="text-body text-neutral-500">{t('overview.chart.empty')}</p>
                </div>
            ) : (
                <>
                    <ChartContainer
                        config={chartConfig}
                        className="mt-4 aspect-auto min-h-48 w-full flex-1"
                        role="img"
                        aria-label={t('overview.chart.ariaLabel', { count: data.length })}
                    >
                        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
                            <CartesianGrid vertical={false} />
                            <XAxis
                                dataKey="label"
                                tickLine={false}
                                axisLine={false}
                                tickMargin={8}
                                minTickGap={12}
                                reversed={rtl}
                            />
                            <YAxis
                                domain={[0, 100]}
                                ticks={[0, 50, 100]}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(v: number) => formatPercent(v / 100, lang)}
                                width={44}
                                orientation={rtl ? 'right' : 'left'}
                            />
                            <ChartTooltip
                                cursor={{ fillOpacity: 0.4 }}
                                content={<DayTooltip lang={lang} />}
                            />
                            <Bar
                                dataKey="percent"
                                fill="var(--color-percent)"
                                radius={[4, 4, 0, 0]}
                                maxBarSize={36}
                                // A track behind every bar, so a 0% day still shows as a day.
                                background={{ className: 'fill-neutral-100', radius: 4 }}
                                isAnimationActive={false}
                            >
                                {data.map((d) => (
                                    <Cell
                                        key={d.date}
                                        fill={d.isToday ? TODAY_FILL : 'var(--color-percent)'}
                                    />
                                ))}
                            </Bar>
                        </BarChart>
                    </ChartContainer>
                    {hasToday && (
                        <p className="mt-2 flex items-center gap-1.5 text-caption text-neutral-500">
                            <span className="size-2 rounded-sm bg-primary-300" aria-hidden />
                            {t('overview.chart.todayOpen')}
                        </p>
                    )}
                    {/* The same numbers for screen readers: a chart is not a table. */}
                    <ul className="sr-only">
                        {data.map((d) => (
                            <li key={d.date}>
                                {formatDay(d.date, lang)}:{' '}
                                {t('overview.chart.doneOf', {
                                    done: formatNumber(d.completed, lang),
                                    available: formatNumber(d.available, lang),
                                })}
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </section>
    );
}

function DayTooltip({ active, payload, lang }: TooltipProps<number, string> & { lang: string }) {
    const { t } = useTranslation('engagement');
    const datum = payload?.[0]?.payload as CompletionDatum | undefined;
    if (!active || !datum) return null;
    return (
        <div className="min-w-40 rounded-md border border-neutral-200 bg-white px-3 py-2 text-caption shadow-lg">
            <p className="font-medium text-neutral-900">
                {formatDay(datum.date, lang)}
                {datum.isToday && (
                    <span className="ms-1 font-normal text-neutral-500">
                        · {t('overview.chart.today')}
                    </span>
                )}
            </p>
            <p className="mt-1 tabular-nums text-neutral-700">
                {datum.percent == null
                    ? t('overview.chart.noneDue')
                    : `${formatPercent(datum.percent / 100, lang)} · ${t('overview.chart.doneOf', {
                          done: formatNumber(datum.completed, lang),
                          available: formatNumber(datum.available, lang),
                      })}`}
            </p>
            <p className="text-neutral-500">{t('overview.chart.tasks', { count: datum.tasks })}</p>
        </div>
    );
}
