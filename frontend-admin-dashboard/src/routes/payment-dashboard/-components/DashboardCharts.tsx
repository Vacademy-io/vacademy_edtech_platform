import { useMemo, useState } from 'react';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    LabelList,
    Line,
    ResponsiveContainer,
    Tooltip as ChartTooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';
import type {
    DashboardForecastMonth,
    DashboardSeriesPoint,
    DashboardYearPoint,
} from '@/services/payment-dashboard';
import {
    formatCompact,
    formatFull,
    heatLevel,
    monthLabel,
    percentChange,
    visibleYears,
} from '../-utils/dashboardMath';

// Theme tokens as CSS values, so charts follow the institute's own colours.
const PRIMARY = 'hsl(var(--primary-500))';
const PRIMARY_SOFT = 'hsl(var(--primary-200))';
const SUCCESS = 'hsl(var(--success-500))';
const MUTED = 'hsl(var(--muted-foreground))';
const GRID = 'hsl(var(--border))';

const axisTick = { fill: MUTED, fontSize: 11 };

/**
 * The hero card's trend: money collected in each of the last 12 months as a filled area, with the
 * same months a year earlier as a dashed line for scale.
 */
export function CollectedTrend({
    months,
    currency,
}: {
    months: DashboardSeriesPoint[];
    currency: string | null;
}) {
    const last12 = months.slice(-12);
    const prior12 = months.slice(-24, -12);
    const data = last12.map((p, i) => ({
        label: monthLabel(p.bucket),
        full: monthLabel(p.bucket, true),
        current: p.collected,
        previous: prior12[i]?.collected ?? 0,
    }));
    const hasPrevious = data.some((d) => d.previous > 0);
    return (
        <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
                    <defs>
                        <linearGradient id="collected-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.35} />
                            <stop offset="100%" stopColor={PRIMARY} stopOpacity={0.02} />
                        </linearGradient>
                    </defs>
                    <XAxis
                        dataKey="label"
                        tick={axisTick}
                        tickLine={false}
                        axisLine={false}
                        interval="preserveStartEnd"
                    />
                    <YAxis hide />
                    <ChartTooltip
                        cursor={{ stroke: GRID }}
                        content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const p = payload[0]!.payload as (typeof data)[number];
                            return (
                                <div className="rounded-lg bg-neutral-900 px-3 py-2 text-caption text-white shadow-lg">
                                    <div className="font-semibold">{p.full}</div>
                                    <div>{formatFull(p.current, currency)} collected</div>
                                    {hasPrevious && (
                                        <div className="text-neutral-300">
                                            A year earlier: {formatFull(p.previous, currency)}
                                        </div>
                                    )}
                                </div>
                            );
                        }}
                    />
                    {hasPrevious && (
                        <Area
                            dataKey="previous"
                            type="monotone"
                            stroke={MUTED}
                            strokeDasharray="4 4"
                            strokeWidth={1.5}
                            fill="none"
                            isAnimationActive={false}
                        />
                    )}
                    <Area
                        dataKey="current"
                        type="monotone"
                        stroke={PRIMARY}
                        strokeWidth={2.5}
                        fill="url(#collected-fill)"
                        dot={false}
                        activeDot={{ r: 4, fill: PRIMARY, strokeWidth: 0 }}
                        isAnimationActive={false}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

type Metric = 'collected' | 'payers' | 'new_payers';

const METRICS: { key: Metric; label: string }[] = [
    { key: 'collected', label: 'Collected' },
    { key: 'payers', label: 'Paying learners' },
    { key: 'new_payers', label: 'New paying learners' },
];

/**
 * The last 12 months as bars with the same month a year earlier as a line — one scale, so the two
 * read against each other directly.
 */
export function RevenueByMonth({
    months,
    currency,
}: {
    months: DashboardSeriesPoint[];
    currency: string | null;
}) {
    const [metric, setMetric] = useState<Metric>('collected');
    const value = (p: DashboardSeriesPoint | undefined) =>
        !p
            ? 0
            : metric === 'collected'
              ? p.collected
              : metric === 'payers'
                ? p.payers
                : p.new_payers ?? 0;
    const fmt = (v: number) =>
        metric === 'collected' ? formatCompact(v, currency) : v.toLocaleString('en-IN');

    const last12 = months.slice(-12);
    const prior12 = months.slice(-24, -12);
    const data = last12.map((p, i) => ({
        label: monthLabel(p.bucket),
        full: monthLabel(p.bucket, true),
        current: value(p),
        previous: value(prior12[i]),
    }));
    // A learner who pays every month is one paying learner in each month, so twelve monthly counts
    // do not add up to a yearly headcount. That tab shows the monthly average instead of a sum.
    // (Collected and first payments do add up.)
    const averaged = metric === 'payers';
    const total = data.reduce((s, d) => s + d.current, 0) / (averaged ? data.length || 1 : 1);
    const previousTotal =
        data.reduce((s, d) => s + d.previous, 0) / (averaged ? data.length || 1 : 1);
    const change = percentChange(total, previousTotal);
    const best = data.reduce<(typeof data)[number] | null>(
        (b, d) => (d.current > (b?.current ?? 0) ? d : b),
        null
    );

    return (
        <div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100">
                <div className="flex gap-5">
                    {METRICS.map((m) => (
                        <button
                            key={m.key}
                            type="button"
                            onClick={() => setMetric(m.key)}
                            className={cn(
                                '-mb-px border-b-2 pb-2 text-body transition-colors',
                                metric === m.key
                                    ? 'border-primary-500 font-semibold text-neutral-900'
                                    : 'border-transparent text-neutral-500 hover:text-neutral-700'
                            )}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-4 pb-2 text-caption text-neutral-600">
                    <span className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-sm bg-primary-500" /> Last 12 months
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="h-0.5 w-3 rounded bg-neutral-400" /> A year earlier
                    </span>
                </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-8">
                <div>
                    <div className="text-h3 font-bold tabular-nums text-neutral-900">
                        {fmt(averaged ? Math.round(total) : total)}
                    </div>
                    <div className="text-caption text-neutral-500">
                        {averaged ? 'Average per month, last 12 months' : 'Last 12 months'}
                    </div>
                </div>
                {change !== null && (
                    <div>
                        <div
                            className={cn(
                                'text-h3 font-bold tabular-nums',
                                change >= 0 ? 'text-success-600' : 'text-danger-600'
                            )}
                        >
                            {change >= 0 ? '+' : '−'}
                            {Math.abs(change).toFixed(1)}%
                        </div>
                        <div className="text-caption text-neutral-500">vs the 12 months before</div>
                    </div>
                )}
                {best && best.current > 0 && (
                    <div>
                        <div className="text-h3 font-bold tabular-nums text-neutral-900">
                            {fmt(best.current)}
                        </div>
                        <div className="text-caption text-neutral-500">
                            Best month · {best.full}
                        </div>
                    </div>
                )}
            </div>
            <div className="mt-3 h-64">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid vertical={false} stroke={GRID} />
                        <XAxis
                            dataKey="label"
                            tick={axisTick}
                            tickLine={false}
                            axisLine={{ stroke: GRID }}
                        />
                        <YAxis
                            tick={axisTick}
                            tickLine={false}
                            axisLine={false}
                            width={56}
                            tickFormatter={(v: number) => fmt(v)}
                        />
                        <ChartTooltip
                            cursor={{ fill: 'hsl(var(--muted))' }}
                            content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const p = payload[0]!.payload as (typeof data)[number];
                                const ch = percentChange(p.current, p.previous);
                                return (
                                    <div className="rounded-lg bg-neutral-900 px-3 py-2 text-caption text-white shadow-lg">
                                        <div className="font-semibold">{p.full}</div>
                                        <div>
                                            {metric === 'collected'
                                                ? formatFull(p.current, currency)
                                                : p.current}
                                        </div>
                                        <div className="text-neutral-300">
                                            A year earlier:{' '}
                                            {metric === 'collected'
                                                ? formatFull(p.previous, currency)
                                                : p.previous}
                                        </div>
                                        {ch !== null && p.previous > 0 && (
                                            <div
                                                className={
                                                    ch >= 0 ? 'text-success-300' : 'text-danger-300'
                                                }
                                            >
                                                {ch >= 0 ? '▲' : '▼'} {Math.abs(ch).toFixed(1)}%
                                            </div>
                                        )}
                                    </div>
                                );
                            }}
                        />
                        <Bar
                            dataKey="current"
                            fill={PRIMARY}
                            radius={[4, 4, 0, 0]}
                            maxBarSize={36}
                            isAnimationActive={false}
                        />
                        <Line
                            dataKey="previous"
                            stroke={MUTED}
                            strokeWidth={2}
                            dot={{ r: 3, fill: MUTED, strokeWidth: 0 }}
                            isAnimationActive={false}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

/** Balances still to come, by the month they fall due. */
export function ForecastChart({
    months,
    currency,
}: {
    months: DashboardForecastMonth[];
    currency: string | null;
}) {
    // Up to 12 dated months, and the undated balance (sorted last by the API) is always kept.
    const shown = [
        ...months.filter((m) => m.month).slice(0, 12),
        ...months.filter((m) => !m.month),
    ];
    const data = shown.map((m) => ({
        label: m.month ? monthLabel(m.month) : 'No date',
        full: m.month ? monthLabel(m.month, true) : 'No due date',
        amount: m.amount,
        learners: m.learners,
    }));
    if (data.length === 0) {
        return (
            <p className="py-10 text-center text-caption text-neutral-500">
                Nothing scheduled to come in.
            </p>
        );
    }
    return (
        <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 22, right: 8, bottom: 0, left: 8 }}>
                    <XAxis
                        dataKey="label"
                        tick={axisTick}
                        tickLine={false}
                        axisLine={{ stroke: GRID }}
                    />
                    <YAxis hide />
                    <ChartTooltip
                        cursor={{ fill: 'hsl(var(--muted))' }}
                        content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const p = payload[0]!.payload as (typeof data)[number];
                            return (
                                <div className="rounded-lg bg-neutral-900 px-3 py-2 text-caption text-white shadow-lg">
                                    <div className="font-semibold">{p.full}</div>
                                    <div>{formatFull(p.amount, currency)} expected</div>
                                    <div className="text-neutral-300">
                                        {p.learners} learner{p.learners === 1 ? '' : 's'}
                                    </div>
                                </div>
                            );
                        }}
                    />
                    <Bar
                        dataKey="amount"
                        fill={SUCCESS}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={40}
                        isAnimationActive={false}
                    >
                        <LabelList
                            dataKey="amount"
                            position="top"
                            formatter={(v: number) => formatCompact(v, currency)}
                            className="fill-neutral-800 text-caption font-semibold"
                        />
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

/** Collected per financial year; the running year is drawn lighter and marked "so far". */
export function YearChart({
    years,
    currency,
}: {
    years: DashboardYearPoint[];
    currency: string | null;
}) {
    // Years before the institute took any money are empty bars that only push the real ones aside.
    const data = visibleYears(years).map((y) => ({
        label: `FY ${y.financial_year}`,
        amount: y.collected,
        partial: y.partial,
    }));
    if (data.every((d) => d.amount === 0)) {
        return (
            <p className="py-10 text-center text-caption text-neutral-500">
                No payments in these years.
            </p>
        );
    }
    return (
        <div>
            <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 22, right: 8, bottom: 0, left: 8 }}>
                        <XAxis
                            dataKey="label"
                            tick={axisTick}
                            tickLine={false}
                            axisLine={{ stroke: GRID }}
                        />
                        <YAxis hide />
                        <ChartTooltip
                            cursor={{ fill: 'hsl(var(--muted))' }}
                            content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const p = payload[0]!.payload as (typeof data)[number];
                                return (
                                    <div className="rounded-lg bg-neutral-900 px-3 py-2 text-caption text-white shadow-lg">
                                        <div className="font-semibold">
                                            {p.label}
                                            {p.partial ? ' (so far)' : ''}
                                        </div>
                                        <div>{formatFull(p.amount, currency)} collected</div>
                                    </div>
                                );
                            }}
                        />
                        <Bar
                            dataKey="amount"
                            radius={[4, 4, 0, 0]}
                            maxBarSize={48}
                            isAnimationActive={false}
                        >
                            {data.map((d) => (
                                <Cell key={d.label} fill={d.partial ? PRIMARY_SOFT : PRIMARY} />
                            ))}
                            <LabelList
                                dataKey="amount"
                                position="top"
                                formatter={(v: number) => formatCompact(v, currency)}
                                className="fill-neutral-800 text-caption font-semibold"
                            />
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
            {data.some((d) => d.partial) && (
                <p className="mt-2 text-caption text-neutral-500">
                    The lighter bar is the current year so far.
                </p>
            )}
        </div>
    );
}

const HEAT_CLASSES = [
    'fill-neutral-100',
    'fill-primary-100',
    'fill-primary-200',
    'fill-primary-300',
    'fill-primary-400',
    'fill-primary-500',
];

/** A calendar day from its "YYYY-MM-DD" bucket, at local midnight (not UTC, which can shift it). */
const dayOf = (bucket: string): Date => {
    const [y, m, d] = bucket.split('-').map(Number);
    return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Money received per day, one square per day, weeks as columns (Monday on top). */
export function CollectionCalendar({
    days,
    currency,
}: {
    days: DashboardSeriesPoint[];
    currency: string | null;
}) {
    const [hover, setHover] = useState<DashboardSeriesPoint | null>(null);
    const { cells, weeks, monthMarks, max, stats } = useMemo(() => {
        const out: { point: DashboardSeriesPoint; week: number; weekday: number }[] = [];
        const marks: { week: number; label: string }[] = [];
        const byWeekday = Array.from({ length: 7 }, () => 0);
        let week = 0;
        let lastMonth = '';
        days.forEach((p, i) => {
            const date = dayOf(p.bucket);
            const weekday = (date.getDay() + 6) % 7; // Monday = 0
            if (i > 0 && weekday === 0) week += 1;
            const monthKey = p.bucket.slice(0, 7);
            if (monthKey !== lastMonth) {
                // A month that starts too close to the previous label would print over it —
                // the newer month wins.
                if (marks.length && week - marks[marks.length - 1]!.week < 3) marks.pop();
                marks.push({ week, label: date.toLocaleDateString('en-IN', { month: 'short' }) });
                lastMonth = monthKey;
            }
            byWeekday[weekday] = (byWeekday[weekday] ?? 0) + p.collected;
            out.push({ point: p, week, weekday });
        });
        const paying = days.filter((p) => p.collected > 0);
        const total = paying.reduce((sum, p) => sum + p.collected, 0);
        const busiest = paying.reduce<DashboardSeriesPoint | null>(
            (b, p) => (p.collected > (b?.collected ?? 0) ? p : b),
            null
        );
        const topWeekday = byWeekday.indexOf(Math.max(...byWeekday));
        return {
            cells: out,
            weeks: week + 1,
            monthMarks: marks,
            max: Math.max(0, ...days.map((p) => p.collected)),
            stats: {
                payingDays: paying.length,
                average: paying.length ? total / paying.length : 0,
                busiest,
                topWeekday: total > 0 ? WEEKDAYS[topWeekday] : null,
            },
        };
    }, [days]);

    const size = 18;
    const gap = 4;
    const left = 34;
    const top = 20;
    const width = left + weeks * (size + gap);
    const height = top + 7 * (size + gap);
    const dayLabel = (bucket: string) =>
        dayOf(bucket).toLocaleDateString('en-IN', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
        });

    return (
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
            <div className="min-w-0">
                <div className="overflow-x-auto">
                    <svg
                        width={width}
                        height={height}
                        className="block"
                        role="img"
                        aria-label="Money received per day"
                    >
                        {monthMarks.map((m) => (
                            <text
                                key={`${m.week}-${m.label}`}
                                x={left + m.week * (size + gap)}
                                y={12}
                                className="fill-neutral-400 text-caption"
                            >
                                {m.label}
                            </text>
                        ))}
                        {['Mon', 'Wed', 'Fri'].map((d, i) => (
                            <text
                                key={d}
                                x={0}
                                y={top + i * 2 * (size + gap) + size - 4}
                                className="fill-neutral-400 text-caption"
                            >
                                {d}
                            </text>
                        ))}
                        {cells.map((c) => (
                            <rect
                                key={c.point.bucket}
                                x={left + c.week * (size + gap)}
                                y={top + c.weekday * (size + gap)}
                                width={size}
                                height={size}
                                rx={4}
                                className={cn(
                                    HEAT_CLASSES[heatLevel(c.point.collected, max)],
                                    'cursor-pointer'
                                )}
                                onMouseEnter={() => setHover(c.point)}
                                onMouseLeave={() => setHover(null)}
                            />
                        ))}
                    </svg>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-caption text-neutral-500">
                    <span>
                        {hover
                            ? `${dayLabel(hover.bucket)} · ${formatFull(hover.collected, currency)} from ${hover.payments} payment${hover.payments === 1 ? '' : 's'}`
                            : 'Hover a day to see what came in.'}
                    </span>
                    <span className="flex items-center gap-1.5">
                        Less
                        {HEAT_CLASSES.map((c) => (
                            <svg key={c} width={12} height={12} aria-hidden>
                                <rect width={12} height={12} rx={3} className={c} />
                            </svg>
                        ))}
                        More
                    </span>
                </div>
            </div>
            <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-4 border-neutral-100 xl:border-l xl:pl-6">
                <div>
                    <dt className="text-caption text-neutral-500">Days with payments</dt>
                    <dd className="text-subtitle font-semibold tabular-nums text-neutral-900">
                        {stats.payingDays} of {days.length}
                    </dd>
                </div>
                <div>
                    <dt className="text-caption text-neutral-500">Average on those days</dt>
                    <dd className="text-subtitle font-semibold tabular-nums text-neutral-900">
                        {formatCompact(stats.average, currency)}
                    </dd>
                </div>
                <div>
                    <dt className="text-caption text-neutral-500">Busiest day</dt>
                    <dd className="text-subtitle font-semibold tabular-nums text-neutral-900">
                        {stats.busiest ? formatCompact(stats.busiest.collected, currency) : '—'}
                    </dd>
                    {stats.busiest && (
                        <dd className="text-caption text-neutral-500">
                            {dayLabel(stats.busiest.bucket)}
                        </dd>
                    )}
                </div>
                <div>
                    <dt className="text-caption text-neutral-500">Strongest weekday</dt>
                    <dd className="text-subtitle font-semibold text-neutral-900">
                        {stats.topWeekday ?? '—'}
                    </dd>
                </div>
            </dl>
        </div>
    );
}
