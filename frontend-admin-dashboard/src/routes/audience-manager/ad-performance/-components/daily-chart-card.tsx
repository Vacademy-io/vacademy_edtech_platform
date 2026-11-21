/**
 * "<Metric> by day": a stacked bar per day (per week for long windows), one segment per
 * platform. Only the top segment of each bar is rounded, whichever platform that is.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChartBar } from '@phosphor-icons/react';
import { Bar, BarChart, CartesianGrid, Rectangle, XAxis, YAxis } from 'recharts';
import type { TooltipProps } from 'recharts';
import { Card } from '@/components/ui/card';
import {
    ChartContainer,
    ChartLegend,
    ChartLegendContent,
    ChartTooltip,
} from '@/components/ui/chart';
import { PillTabs } from '@/components/shared/crm-enhance/screen-header';
import {
    adPlatformChartConfig,
    platformChartColor,
    platformLabel,
} from '../../-marketing/platform-meta';
import type { AdPerformanceDaily, AdPlatform } from '../../-marketing/types';
import { AD_METRICS, type AdMetric } from '../index';
import {
    WEEKLY_THRESHOLD_DAYS,
    buildChartRows,
    formatCount,
    formatCountCompact,
    formatMoney,
    formatMoneyCompact,
    platformsWithData,
    windowDays,
    type ChartRow,
} from './ad-performance-utils';

const TOP_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

/** Bar segment that rounds its top only when no platform above it has a value that day. */
function segmentShape(platform: AdPlatform, stack: AdPlatform[]) {
    const above = stack.slice(stack.indexOf(platform) + 1);
    function Segment(props: unknown) {
        const shapeProps = props as React.ComponentProps<typeof Rectangle> & { payload?: ChartRow };
        const row = shapeProps.payload;
        const isTop = !row || above.every((p) => !row[p]);
        return <Rectangle {...shapeProps} radius={isTop ? TOP_RADIUS : 0} />;
    }
    return Segment;
}

/** Legend swatch colour: a theme CSS variable per platform, so it has to be a runtime style. */
const swatchStyle = (platform: AdPlatform) => ({ backgroundColor: platformChartColor(platform) });

function DailyTooltip({
    active,
    payload,
    metric,
    currency,
    platforms,
}: TooltipProps<number, string> & {
    metric: AdMetric;
    currency: string;
    platforms: AdPlatform[];
}) {
    const { t } = useTranslation('marketingAds');
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as ChartRow | undefined;
    if (!row) return null;
    const fmt = (value: number) =>
        metric === 'spend' ? formatMoney(value, currency) : formatCount(value);
    const total = platforms.reduce((sum, platform) => sum + (row[platform] || 0), 0);
    return (
        <div className="grid min-w-48 gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-lg">
            <span className="text-caption font-semibold text-neutral-800">{row.tooltipLabel}</span>
            <div className="grid gap-1.5">
                {[...platforms].reverse().map((platform) => (
                    <div
                        key={platform}
                        className="flex items-center justify-between gap-4 text-caption"
                    >
                        <span className="flex items-center gap-1.5 text-neutral-600">
                            <span
                                className="size-2 shrink-0 rounded-sm"
                                style={swatchStyle(platform)}
                            />
                            {platformLabel(platform, t, 'ads')}
                        </span>
                        <span className="font-medium tabular-nums text-neutral-800">
                            {fmt(row[platform] || 0)}
                        </span>
                    </div>
                ))}
            </div>
            {platforms.length > 1 && (
                <div className="flex items-center justify-between gap-4 border-t border-neutral-100 pt-1.5 text-caption">
                    <span className="text-neutral-500">{t('ads.chart.total')}</span>
                    <span className="font-semibold tabular-nums text-neutral-900">
                        {fmt(total)}
                    </span>
                </div>
            )}
        </div>
    );
}

export function DailyChartCard({
    daily,
    from,
    to,
    metric,
    onMetricChange,
    currency,
    firstSyncPending,
}: {
    daily: AdPerformanceDaily[];
    from: string;
    to: string;
    metric: AdMetric;
    onMetricChange: (metric: AdMetric) => void;
    currency: string;
    /** Some account has not finished its first sync, so an empty chart is expected. */
    firstSyncPending: boolean;
}) {
    const { t, i18n } = useTranslation('marketingAds');
    const weekly = windowDays(from, to) > WEEKLY_THRESHOLD_DAYS;

    const rows = useMemo(
        () =>
            buildChartRows(daily, from, to, metric, weekly, i18n.language, (day) =>
                t('ads.chart.weekOf', { day })
            ),
        [daily, from, to, metric, weekly, i18n.language, t]
    );
    const platforms = useMemo(() => platformsWithData(rows), [rows]);
    const config = useMemo(() => adPlatformChartConfig(t), [t]);
    const shapes = useMemo(
        () => new Map(platforms.map((platform) => [platform, segmentShape(platform, platforms)])),
        [platforms]
    );
    // ~10 labels whatever the window: every day for a week, every 3rd day for a month.
    const tickInterval = rows.length <= 10 ? 0 : Math.ceil(rows.length / 10) - 1;
    const hasData = platforms.length > 0;

    return (
        <Card className="flex flex-col gap-4 p-5 shadow-none lg:col-span-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-subtitle font-semibold text-neutral-800">
                    {weekly ? t(`ads.chart.titleWeekly.${metric}`) : t(`ads.chart.title.${metric}`)}
                </h2>
                <PillTabs
                    tabs={AD_METRICS.map((key) => ({ key, label: t(`ads.chart.metric.${key}`) }))}
                    value={metric}
                    onChange={(key) => onMetricChange(key as AdMetric)}
                />
            </div>
            {hasData ? (
                <ChartContainer config={config} className="aspect-auto h-72 w-full">
                    <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis
                            dataKey="label"
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            interval={tickInterval}
                        />
                        <YAxis
                            tickLine={false}
                            axisLine={false}
                            width={metric === 'spend' ? 56 : 36}
                            allowDecimals={false}
                            tickFormatter={(value: number) =>
                                metric === 'spend'
                                    ? formatMoneyCompact(value, currency)
                                    : formatCountCompact(value)
                            }
                        />
                        <ChartTooltip
                            cursor={{ fillOpacity: 0.4 }}
                            content={
                                <DailyTooltip
                                    metric={metric}
                                    currency={currency}
                                    platforms={platforms}
                                />
                            }
                        />
                        <ChartLegend content={<ChartLegendContent />} />
                        {platforms.map((platform) => (
                            <Bar
                                key={platform}
                                dataKey={platform}
                                stackId="platforms"
                                fill={`var(--color-${platform})`}
                                maxBarSize={36}
                                shape={shapes.get(platform)}
                                isAnimationActive={false}
                            />
                        ))}
                    </BarChart>
                </ChartContainer>
            ) : (
                <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-200 px-6 text-center">
                    <ChartBar size={28} className="text-neutral-300" />
                    <p className="text-body font-medium text-neutral-700">
                        {firstSyncPending ? t('ads.chart.syncingTitle') : t('ads.chart.emptyTitle')}
                    </p>
                    <p className="max-w-sm text-caption text-neutral-500">
                        {firstSyncPending ? t('ads.chart.syncingHint') : t('ads.chart.emptyHint')}
                    </p>
                </div>
            )}
        </Card>
    );
}
