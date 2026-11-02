import {
    Area,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    Line,
    Pie,
    PieChart,
    PolarAngleAxis,
    PolarGrid,
    PolarRadiusAxis,
    Radar,
    RadarChart,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { REPORT_COLORS, pct, scoreColor, tint } from './palette';

/**
 * Report charts (recharts). Every chart takes {@code animate}: the on-screen views animate, the
 * printable report passes false so the PDF export never captures a chart mid-animation.
 */

const AXIS_TICK = { fontSize: 11, fill: REPORT_COLORS.muted };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const TooltipBox = ({
    title,
    rows,
}: {
    title?: string;
    rows: { label: string; value: string; color?: string }[];
}) => (
    <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs shadow-md">
        {title && <div className="mb-1 font-semibold text-neutral-800">{title}</div>}
        {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-2 text-neutral-600">
                {r.color && (
                    <span className="size-2 rounded-full" style={{ background: r.color }} />
                )}
                <span>{r.label}</span>
                <span className="ml-auto pl-3 font-semibold text-neutral-800">{r.value}</span>
            </div>
        ))}
    </div>
);

export const ChartLegend = ({
    items,
}: {
    items: { label: string; color: string; dashed?: boolean }[];
}) => (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
        {items.map((i) => (
            <span key={i.label} className="flex items-center gap-1.5">
                {i.dashed ? (
                    <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: i.color }} />
                ) : (
                    <span className="size-2.5 rounded-sm" style={{ background: i.color }} />
                )}
                {i.label}
            </span>
        ))}
    </div>
);

// ── Donut ───────────────────────────────────────────────────────────────────

export interface DonutSlice {
    label: string;
    value: number;
    color: string;
}

/** A donut with the headline number in its hole and a counted legend beside it. */
export const DonutChart = ({
    data,
    centerValue,
    centerLabel,
    size = 150,
    animate = true,
    legend = 'side',
}: {
    data: DonutSlice[];
    centerValue: string;
    centerLabel?: string;
    size?: number;
    animate?: boolean;
    legend?: 'side' | 'below' | 'none';
}) => {
    const total = data.reduce((s, d) => s + d.value, 0);
    const shown = data.filter((d) => d.value > 0);
    return (
        <div
            className={
                legend === 'side'
                    ? 'flex flex-wrap items-center gap-4'
                    : 'flex flex-col items-center gap-3'
            }
        >
            <div className="relative shrink-0" style={{ width: size, height: size }}>
                <PieChart width={size} height={size}>
                    <Pie
                        data={total > 0 ? shown : [{ label: 'none', value: 1, color: REPORT_COLORS.line }]}
                        dataKey="value"
                        nameKey="label"
                        innerRadius={size * 0.34}
                        outerRadius={size / 2 - 2}
                        paddingAngle={shown.length > 1 ? 2 : 0}
                        stroke="#fff"
                        strokeWidth={2}
                        startAngle={90}
                        endAngle={-270}
                        isAnimationActive={animate}
                    >
                        {(total > 0 ? shown : [{ color: REPORT_COLORS.line }]).map((d, i) => (
                            <Cell key={i} fill={d.color} />
                        ))}
                    </Pie>
                    {total > 0 && (
                        <Tooltip
                            content={({ active, payload }) =>
                                active && payload?.[0] ? (
                                    <TooltipBox
                                        rows={[
                                            {
                                                label: String(payload[0].name),
                                                value: `${payload[0].value} (${pct(
                                                    (Number(payload[0].value) / total) * 100
                                                )})`,
                                                color: (payload[0].payload as DonutSlice).color,
                                            },
                                        ]}
                                    />
                                ) : null
                            }
                        />
                    )}
                </PieChart>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xl font-bold text-neutral-800">{centerValue}</span>
                    {centerLabel && (
                        <span className="text-2xs uppercase tracking-wide text-neutral-500">
                            {centerLabel}
                        </span>
                    )}
                </div>
            </div>
            {legend !== 'none' && (
                <ul className="flex min-w-[140px] flex-1 flex-col gap-1.5">
                    {data.map((d) => (
                        <li key={d.label} className="flex items-center gap-2 text-sm">
                            <span
                                className="size-3 shrink-0 rounded-sm"
                                style={{ background: d.color }}
                            />
                            <span className="text-neutral-700">{d.label}</span>
                            <span className="ml-auto font-semibold text-neutral-800">{d.value}</span>
                            <span className="w-12 text-right text-xs text-neutral-500">
                                {total > 0 ? pct((d.value / total) * 100) : '—'}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

// ── You vs class, by subject ────────────────────────────────────────────────

export interface CompareRow {
    name: string;
    you: number | null;
    klass: number | null;
}

export const CompareBarChart = ({
    data,
    brand,
    youLabel = 'Score',
    height = 230,
    animate = true,
}: {
    data: CompareRow[];
    brand: string;
    youLabel?: string;
    height?: number;
    animate?: boolean;
}) => {
    const hasClass = data.some((d) => d.klass != null);
    return (
        <div className="flex flex-col gap-2">
            <ChartLegend
                items={[
                    { label: youLabel, color: brand },
                    ...(hasClass ? [{ label: 'Class average', color: REPORT_COLORS.neutral }] : []),
                ]}
            />
            <div style={{ height }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 16, right: 4, left: -18, bottom: 0 }} barGap={2}>
                        <CartesianGrid vertical={false} stroke={REPORT_COLORS.line} />
                        <XAxis
                            dataKey="name"
                            tick={AXIS_TICK}
                            tickLine={false}
                            axisLine={false}
                            interval={0}
                            tickFormatter={(v: string) => clip(v, data.length > 4 ? 9 : 16)}
                        />
                        <YAxis
                            domain={[0, 100]}
                            ticks={[0, 25, 50, 75, 100]}
                            tick={AXIS_TICK}
                            tickLine={false}
                            axisLine={false}
                            unit="%"
                        />
                        <Tooltip
                            cursor={{ fill: tint(brand, 0.92) }}
                            content={({ active, payload, label }) =>
                                active && payload?.length ? (
                                    <TooltipBox
                                        title={String(label)}
                                        rows={payload.map((p) => ({
                                            label: p.dataKey === 'you' ? youLabel : 'Class average',
                                            value: pct(p.value as number),
                                            color: p.dataKey === 'you' ? brand : REPORT_COLORS.neutral,
                                        }))}
                                    />
                                ) : null
                            }
                        />
                        <Bar
                            dataKey="you"
                            fill={brand}
                            radius={[4, 4, 0, 0]}
                            maxBarSize={36}
                            isAnimationActive={animate}
                            label={{
                                position: 'top',
                                fontSize: 10,
                                fill: REPORT_COLORS.ink,
                                formatter: (v: number | null) => (v == null ? '' : `${Math.round(v)}%`),
                            }}
                        />
                        {hasClass && (
                            <Bar
                                dataKey="klass"
                                fill={REPORT_COLORS.neutral}
                                radius={[4, 4, 0, 0]}
                                maxBarSize={36}
                                isAnimationActive={animate}
                            />
                        )}
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

// ── Score trend ─────────────────────────────────────────────────────────────

export interface TrendPoint {
    label: string;
    sub?: string;
    you: number | null;
    klass: number | null;
}

export const TrendChart = ({
    data,
    brand,
    height = 210,
    animate = true,
    referenceAt,
}: {
    data: TrendPoint[];
    brand: string;
    height?: number;
    animate?: boolean;
    /** A dashed horizontal guide, e.g. the pass mark. */
    referenceAt?: number;
}) => {
    const hasClass = data.some((d) => d.klass != null);
    const gradientId = `trend-${brand.replace('#', '')}`;
    return (
        <div className="flex flex-col gap-2">
            <ChartLegend
                items={[
                    { label: 'Score', color: brand },
                    ...(hasClass
                        ? [{ label: 'Class average', color: REPORT_COLORS.classMark, dashed: true }]
                        : []),
                ]}
            />
            <div style={{ height }}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data} margin={{ top: 14, right: 12, left: -18, bottom: 0 }}>
                        <defs>
                            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={brand} stopOpacity={0.28} />
                                <stop offset="100%" stopColor={brand} stopOpacity={0.02} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} stroke={REPORT_COLORS.line} />
                        <XAxis
                            dataKey="label"
                            tick={AXIS_TICK}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v: string) => clip(v, 10)}
                        />
                        <YAxis
                            domain={[0, 100]}
                            ticks={[0, 25, 50, 75, 100]}
                            tick={AXIS_TICK}
                            tickLine={false}
                            axisLine={false}
                            unit="%"
                        />
                        {referenceAt != null && (
                            <ReferenceLine y={referenceAt} stroke={REPORT_COLORS.warn} strokeDasharray="4 4" />
                        )}
                        <Tooltip
                            content={({ active, payload }) => {
                                const p = payload?.[0]?.payload as TrendPoint | undefined;
                                return active && p ? (
                                    <TooltipBox
                                        title={p.sub ? `${p.label} · ${p.sub}` : p.label}
                                        rows={[
                                            { label: 'Score', value: pct(p.you), color: brand },
                                            ...(p.klass != null
                                                ? [
                                                      {
                                                          label: 'Class average',
                                                          value: pct(p.klass),
                                                          color: REPORT_COLORS.classMark,
                                                      },
                                                  ]
                                                : []),
                                        ]}
                                    />
                                ) : null;
                            }}
                        />
                        <Area
                            type="monotone"
                            dataKey="you"
                            stroke={brand}
                            strokeWidth={2}
                            fill={`url(#${gradientId})`}
                            dot={{ r: 4, fill: brand, stroke: '#fff', strokeWidth: 2 }}
                            activeDot={{ r: 6 }}
                            connectNulls
                            isAnimationActive={animate}
                        />
                        {hasClass && (
                            <Line
                                type="monotone"
                                dataKey="klass"
                                stroke={REPORT_COLORS.classMark}
                                strokeWidth={2}
                                strokeDasharray="5 4"
                                dot={false}
                                connectNulls
                                isAnimationActive={animate}
                            />
                        )}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

// ── Topic radar ─────────────────────────────────────────────────────────────

export const TopicRadar = ({
    data,
    brand,
    height = 250,
    animate = true,
}: {
    data: { topic: string; accuracy: number }[];
    brand: string;
    height?: number;
    animate?: boolean;
}) => (
    <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data} outerRadius="72%">
                <PolarGrid stroke={REPORT_COLORS.line} />
                <PolarAngleAxis
                    dataKey="topic"
                    tick={{ fontSize: 10, fill: REPORT_COLORS.muted }}
                    tickFormatter={(v: string) => clip(v, 14)}
                />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                <Radar
                    dataKey="accuracy"
                    stroke={brand}
                    strokeWidth={2}
                    fill={brand}
                    fillOpacity={0.22}
                    dot={{ r: 3, fill: brand }}
                    isAnimationActive={animate}
                />
                <Tooltip
                    content={({ active, payload }) => {
                        const p = payload?.[0]?.payload as { topic: string; accuracy: number } | undefined;
                        return active && p ? (
                            <TooltipBox
                                title={p.topic}
                                rows={[{ label: 'Accuracy', value: pct(p.accuracy), color: brand }]}
                            />
                        ) : null;
                    }}
                />
            </RadarChart>
        </ResponsiveContainer>
    </div>
);

// ── Histogram ───────────────────────────────────────────────────────────────

export interface HistogramBucket {
    label: string;
    count: number;
    /** Lower edge of the bucket, used for the colour. */
    from: number;
}

/** How many learners scored in each 10-point range, coloured by score band. */
export const ScoreHistogram = ({
    data,
    height = 220,
    animate = true,
    highlightFrom,
    brand,
}: {
    data: HistogramBucket[];
    height?: number;
    animate?: boolean;
    /** Bucket to draw in the brand colour (e.g. the learner own score). */
    highlightFrom?: number | null;
    brand?: string;
}) => (
    <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 16, right: 4, left: -22, bottom: 0 }} barCategoryGap={3}>
                <CartesianGrid vertical={false} stroke={REPORT_COLORS.line} />
                <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} />
                <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <Tooltip
                    cursor={{ fill: '#f8fafc' }}
                    content={({ active, payload }) => {
                        const p = payload?.[0]?.payload as HistogramBucket | undefined;
                        return active && p ? (
                            <TooltipBox
                                title={`${p.label}%`}
                                rows={[{ label: 'Learners', value: String(p.count) }]}
                            />
                        ) : null;
                    }}
                />
                <Bar
                    dataKey="count"
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={animate}
                    label={{
                        position: 'top',
                        fontSize: 10,
                        fill: REPORT_COLORS.ink,
                        formatter: (v: number) => (v > 0 ? v : ''),
                    }}
                >
                    {data.map((b) => (
                        <Cell
                            key={b.label}
                            fill={
                                highlightFrom != null && b.from === highlightFrom && brand
                                    ? brand
                                    : scoreColor(b.from + 5)
                            }
                        />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    </div>
);

/** Ten 10-point buckets (0-10 … 90-100) from a list of percentages. */
export const toHistogram = (values: (number | null | undefined)[]): HistogramBucket[] => {
    const buckets = Array.from({ length: 10 }, (_, i) => ({
        label: `${i * 10}-${i * 10 + 10}`,
        count: 0,
        from: i * 10,
    }));
    values.forEach((v) => {
        if (v == null || Number.isNaN(v)) return;
        const bucket = buckets[Math.min(9, Math.max(0, Math.floor(v / 10)))];
        if (bucket) bucket.count++;
    });
    return buckets;
};

// ── Horizontal bars ─────────────────────────────────────────────────────────

export interface HBarRow {
    key: string;
    label: string;
    value: number | null;
    display: string;
    sub?: string;
    color?: string;
}

/** Labelled horizontal bars on a 0-max scale, for rankings and per-subject progress. */
export const HorizontalBars = ({
    rows,
    color,
    max = 100,
    marker,
}: {
    rows: HBarRow[];
    color: string;
    max?: number;
    /** A thin dark tick on every bar, e.g. the class average. */
    marker?: { value: number; label: string } | null;
}) => (
    <ul className="flex flex-col gap-2.5">
        {rows.map((r) => (
            <li key={r.key} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-medium text-neutral-700" title={r.label}>
                        {r.label}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-500">
                        {r.sub ? `${r.sub} · ` : ''}
                        <strong className="text-neutral-800">{r.display}</strong>
                    </span>
                </div>
                <div className="relative h-2 w-full rounded-full bg-neutral-100">
                    <div
                        className="h-full rounded-full"
                        style={{
                            width: `${Math.max(r.value ? 2 : 0, Math.min(100, ((r.value ?? 0) / max) * 100))}%`,
                            background: r.color ?? color,
                        }}
                    />
                    {marker && (
                        <div
                            className="absolute -top-1 h-4 w-0.5 rounded bg-slate-700"
                            style={{ left: `${Math.min(100, (marker.value / max) * 100)}%` }}
                            title={marker.label}
                        />
                    )}
                </div>
            </li>
        ))}
    </ul>
);
