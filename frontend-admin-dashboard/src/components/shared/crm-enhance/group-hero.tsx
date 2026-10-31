import { useMemo } from 'react';
import type { Icon } from '@phosphor-icons/react';
import {
    Area,
    AreaChart,
    CartesianGrid,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { DeltaChip, type Tint } from '@/routes/dashboard/-components/crm/crm-cards';
import { GROUP_RANGE_OPTIONS, type GroupRangeDays } from '@/services/group-dashboard';

const STROKE: Record<Tint, string> = {
    primary: 'hsl(var(--primary-500))',
    info: 'hsl(var(--info-500))',
    success: 'hsl(var(--success-500))',
    warning: 'hsl(var(--warning-500))',
    danger: 'hsl(var(--danger-500))',
};
const DOT: Record<Tint, string> = {
    primary: 'bg-primary-500',
    info: 'bg-info-500',
    success: 'bg-success-500',
    warning: 'bg-warning-500',
    danger: 'bg-danger-500',
};

export interface HeroSeries {
    key: string;
    label: string;
    tint: Tint;
    /** One value per day, oldest first (same length as `days`). */
    values: number[];
    /** The first series is drawn as a filled area, the rest as lines. */
}

/**
 * The trend hero used by the group dashboards (Contacts, Automations, Engagement):
 * a headline number with its change, a short explanation and a per-day chart.
 */
export function GroupHero({
    icon: HeroIcon,
    eyebrow,
    value,
    unit,
    delta,
    deltaTitle,
    sub,
    compare,
    days,
    series,
    range,
    onRange,
    fromDay,
    toDay,
}: {
    icon: Icon;
    eyebrow: string;
    value: string;
    unit: string;
    delta: number | null;
    deltaTitle: string;
    sub: string;
    compare?: string;
    days: string[];
    series: HeroSeries[];
    range: GroupRangeDays;
    onRange: (d: GroupRangeDays) => void;
    fromDay?: string;
    toDay?: string;
}) {
    const data = useMemo(
        () =>
            days.map((d, i) => {
                const row: Record<string, string | number> = { day: d.slice(5) };
                series.forEach((s) => {
                    row[s.key] = s.values[i] ?? 0;
                });
                return row;
            }),
        [days, series]
    );
    const labels = useMemo(() => Object.fromEntries(series.map((s) => [s.key, s.label])), [series]);
    const [first, ...rest] = series;
    return (
        <Card className="overflow-hidden rounded-xl border-primary-100 bg-gradient-to-br from-primary-50 via-white to-white p-5 shadow-sm">
            <div className="grid gap-6 lg:grid-cols-12 lg:items-center">
                <div className="min-w-0 lg:col-span-4">
                    <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wide text-primary-600">
                        <HeroIcon size={14} weight="fill" />
                        <span className="text-caption">{eyebrow}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-baseline gap-2">
                        <span className="font-bold tabular-nums text-neutral-900">
                            <span className="text-h1">{value}</span>
                        </span>
                        <span className="text-neutral-500">
                            <span className="text-body">{unit}</span>
                        </span>
                        <DeltaChip value={delta} title={deltaTitle} />
                    </div>
                    <p className="mt-2 text-neutral-600">
                        <span className="text-body">{sub}</span>
                    </p>
                    {compare && (
                        <p className="mt-1 text-neutral-500">
                            <span className="text-caption">{compare}</span>
                        </p>
                    )}
                </div>
                <div className="h-36 min-w-0 lg:col-span-6">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                            <defs>
                                <linearGradient id="groupHeroArea" x1="0" y1="0" x2="0" y2="1">
                                    <stop
                                        offset="0%"
                                        stopColor={STROKE[first?.tint ?? 'primary']}
                                        stopOpacity={0.25}
                                    />
                                    <stop
                                        offset="100%"
                                        stopColor={STROKE[first?.tint ?? 'primary']}
                                        stopOpacity={0}
                                    />
                                </linearGradient>
                            </defs>
                            <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                            <XAxis
                                dataKey="day"
                                tickLine={false}
                                axisLine={false}
                                minTickGap={24}
                                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                            />
                            <Tooltip
                                formatter={(v: number, k: string) => [
                                    Math.round(v).toLocaleString('en-IN'),
                                    labels[k] ?? k,
                                ]}
                            />
                            {first && (
                                <Area
                                    isAnimationActive={false}
                                    type="monotone"
                                    dataKey={first.key}
                                    stroke={STROKE[first.tint]}
                                    strokeWidth={2}
                                    fill="url(#groupHeroArea)"
                                    dot={false}
                                />
                            )}
                            {rest.map((s) => (
                                <Line
                                    key={s.key}
                                    isAnimationActive={false}
                                    type="monotone"
                                    dataKey={s.key}
                                    stroke={STROKE[s.tint]}
                                    strokeWidth={2}
                                    dot={false}
                                />
                            ))}
                        </AreaChart>
                    </ResponsiveContainer>
                    <div className="mt-1 flex flex-wrap gap-4 text-neutral-500">
                        {series.map((s) => (
                            <span key={s.key} className="flex items-center gap-1.5">
                                <span className={cn('size-2 rounded-full', DOT[s.tint])} />
                                <span className="text-caption">{s.label}</span>
                            </span>
                        ))}
                    </div>
                </div>
                <div className="flex flex-col items-start gap-2 lg:col-span-2 lg:items-end">
                    <RangeSegment value={range} onChange={onRange} />
                    {fromDay && toDay && (
                        <span className="text-neutral-500">
                            <span className="text-caption">
                                {fromDay} → {toDay}
                            </span>
                        </span>
                    )}
                </div>
            </div>
        </Card>
    );
}

export function RangeSegment({
    value,
    onChange,
}: {
    value: GroupRangeDays;
    onChange: (d: GroupRangeDays) => void;
}) {
    return (
        <div className="flex rounded-lg border border-neutral-200 bg-white p-0.5">
            {GROUP_RANGE_OPTIONS.map((d) => (
                <button
                    key={d}
                    type="button"
                    onClick={() => onChange(d)}
                    className={cn(
                        'rounded-md px-3 py-1 font-medium transition-colors',
                        value === d
                            ? 'bg-primary-500 text-white'
                            : 'text-neutral-600 hover:bg-neutral-100'
                    )}
                >
                    <span className="text-caption">{d}d</span>
                </button>
            ))}
        </div>
    );
}
