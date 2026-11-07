import { useMemo } from 'react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Line,
    LineChart,
    Pie,
    PieChart,
    ReferenceLine,
    XAxis,
    YAxis,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import { format } from 'date-fns';
import { CheckCircle, Question, XCircle, type Icon as PhosphorIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { ChipToggleGroup } from '@/components/design-system/chips';
import type {
    LearnerAttendanceStatus,
    LearnerLiveClass,
    LearnerLiveSessionsResponse,
} from '@/services/learner-live-sessions';
import { formatMinutes, fromYmd } from './live-session-helpers';

// ── Status palette ────────────────────────────────────────────────────────────
//
// Status colours, not a categorical palette: success-700 / neutral-400 / danger-700, ordered
// Present → Not marked → Absent so the red/green pair (ΔE 6.7 under deuteranopia — legal only
// with secondary encoding) never touches except across the donut's wrap-around. That encoding is
// always present: 2px surface gaps between slices, an icon + text label on every status, and the
// counts in the legend.

export const STATUS_ORDER: LearnerAttendanceStatus[] = ['PRESENT', 'UNMARKED', 'ABSENT'];

export const STATUS_META: Record<
    LearnerAttendanceStatus,
    { label: string; fill: string; bg: string; icon: PhosphorIcon }
> = {
    PRESENT: { label: 'Present', fill: 'fill-success-700', bg: 'bg-success-700', icon: CheckCircle },
    UNMARKED: { label: 'Not marked', fill: 'fill-neutral-400', bg: 'bg-neutral-400', icon: Question },
    ABSENT: { label: 'Absent', fill: 'fill-danger-700', bg: 'bg-danger-700', icon: XCircle },
};

const TooltipCard = ({ children }: { children: React.ReactNode }) => (
    <div className="min-w-32 max-w-56 rounded-md border border-border bg-card px-2.5 py-1.5 text-2xs text-card-foreground shadow-md">
        {children}
    </div>
);

// ── Attendance donut ──────────────────────────────────────────────────────────

const donutConfig = {
    count: { label: 'Classes' },
} satisfies ChartConfig;

/**
 * Part-to-whole of the period's classes by attendance. Click a slice or a legend row to filter
 * the class list to that status; click it again to clear.
 */
export const AttendanceDonut = ({
    summary,
    active,
    onSelect,
}: {
    summary: LearnerLiveSessionsResponse;
    active: LearnerAttendanceStatus | null;
    onSelect: (status: LearnerAttendanceStatus | null) => void;
}) => {
    const counts: Record<LearnerAttendanceStatus, number> = {
        PRESENT: summary.present_count,
        UNMARKED: summary.unmarked_count,
        ABSENT: summary.absent_count,
    };
    const total = summary.total_classes;
    const data = STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => ({ status: s, count: counts[s] }));
    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
    const toggle = (s: LearnerAttendanceStatus) => onSelect(active === s ? null : s);

    return (
        <div className="flex items-center gap-3">
            <div className="relative size-36 shrink-0">
                <ChartContainer config={donutConfig} className="aspect-square size-36">
                    <PieChart>
                        <ChartTooltip
                            cursor={false}
                            content={({ active: hovering, payload }: TooltipProps<number, string>) => {
                                const row = hovering ? payload?.[0]?.payload : null;
                                if (!row) return null;
                                const meta = STATUS_META[row.status as LearnerAttendanceStatus];
                                return (
                                    <TooltipCard>
                                        <p className="font-semibold">{meta.label}</p>
                                        <p className="text-muted-foreground">
                                            {row.count} of {total} classes · {pct(row.count)}%
                                        </p>
                                    </TooltipCard>
                                );
                            }}
                        />
                        <Pie
                            data={data}
                            dataKey="count"
                            nameKey="status"
                            innerRadius={46}
                            outerRadius={68}
                            // 2px surface ring = the gap between slices.
                            stroke="hsl(var(--card))"
                            strokeWidth={2}
                            isAnimationActive={false}
                            onClick={(entry: {
                                status?: LearnerAttendanceStatus;
                                payload?: { status?: LearnerAttendanceStatus };
                            }) => {
                                const s = entry?.payload?.status ?? entry?.status;
                                if (s) toggle(s);
                            }}
                        >
                            {data.map((d) => (
                                <Cell
                                    key={d.status}
                                    className={cn(
                                        STATUS_META[d.status].fill,
                                        'cursor-pointer outline-none transition-opacity',
                                        active && active !== d.status && 'opacity-30'
                                    )}
                                />
                            ))}
                        </Pie>
                    </PieChart>
                </ChartContainer>
                {/* Centre label — the headline number the donut exists to support. */}
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-h3 font-semibold leading-none text-card-foreground">
                        {total > 0 ? `${Math.round(summary.attendance_percentage)}%` : '—'}
                    </span>
                    <span className="mt-0.5 text-2xs text-muted-foreground">attended</span>
                </div>
            </div>

            <ul className="flex min-w-0 flex-1 flex-col gap-1" aria-label="Attendance breakdown">
                {STATUS_ORDER.map((s) => {
                    const meta = STATUS_META[s];
                    const Icon = meta.icon;
                    const isActive = active === s;
                    return (
                        <li key={s}>
                            <button
                                type="button"
                                onClick={() => toggle(s)}
                                disabled={counts[s] === 0}
                                aria-pressed={isActive}
                                className={cn(
                                    'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:cursor-default disabled:opacity-50',
                                    isActive ? 'bg-primary-50 ring-1 ring-primary-200' : 'hover:bg-muted'
                                )}
                            >
                                <span className={cn('size-2.5 shrink-0 rounded-sm', meta.bg)} />
                                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                                <span className="min-w-0 flex-1 truncate text-caption text-card-foreground">
                                    {meta.label}
                                </span>
                                <span className="shrink-0 text-caption font-semibold tabular-nums text-card-foreground">
                                    {counts[s]}
                                </span>
                                <span className="w-8 shrink-0 text-right text-2xs tabular-nums text-muted-foreground">
                                    {pct(counts[s])}%
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

// ── Per-class trend ───────────────────────────────────────────────────────────

export type TrendMetric = 'concentration' | 'duration';

interface TrendPoint {
    id: string;
    label: string;
    title: string;
    date: string;
    status: LearnerAttendanceStatus;
    score: number | null;
    minutes: number | null;
    meetingMinutes: number | null;
}

const trendConfig = {
    score: { label: 'Concentration', color: 'hsl(var(--primary-500))' },
    minutes: { label: 'Time in class', color: 'hsl(var(--primary-500))' },
} satisfies ChartConfig;

const TrendTooltip = ({ active, payload }: TooltipProps<number, string>) => {
    const p = active ? (payload?.[0]?.payload as TrendPoint | undefined) : undefined;
    if (!p) return null;
    const meta = STATUS_META[p.status];
    return (
        <TooltipCard>
            <p className="truncate font-semibold">{p.title}</p>
            <p className="text-muted-foreground">{p.date}</p>
            <p className="mt-1">
                Concentration{' '}
                <span className="font-semibold">{p.score != null ? `${p.score}/100` : '—'}</span>
            </p>
            <p>
                Time in class{' '}
                <span className="font-semibold">
                    {p.minutes != null
                        ? p.meetingMinutes
                            ? `${formatMinutes(p.minutes)} of ${formatMinutes(p.meetingMinutes)}`
                            : formatMinutes(p.minutes)
                        : '—'}
                </span>
            </p>
            <p className="mt-1 inline-flex items-center gap-1 text-muted-foreground">
                <meta.icon className="size-3" />
                {meta.label} · click to find it below
            </p>
        </TooltipCard>
    );
};

const classKey = (c: LearnerLiveClass) => `${c.schedule_id}:${c.session_id}`;

/**
 * One measure per chart — concentration (0–100) or minutes in class, switched by a toggle rather
 * than drawn on two y-axes. A dashed line marks the period average. Hover for the class; click a
 * point/bar to jump to that class in the list.
 */
export const ClassTrendChart = ({
    classes,
    metric,
    onMetricChange,
    avgScore,
    avgMinutes,
    selectedId,
    onSelectClass,
}: {
    /** Newest first, as the API returns them. */
    classes: LearnerLiveClass[];
    metric: TrendMetric;
    onMetricChange: (m: TrendMetric) => void;
    avgScore: number | null;
    avgMinutes: number | null;
    selectedId: string | null;
    onSelectClass: (id: string) => void;
}) => {
    const data: TrendPoint[] = useMemo(
        () =>
            [...classes].reverse().map((c) => ({
                id: classKey(c),
                label: format(fromYmd(c.meeting_date), 'd MMM'),
                title: c.title || 'Live class',
                date: format(fromYmd(c.meeting_date), 'EEE, d MMM yyyy'),
                status: c.attendance_status,
                score: c.concentration_score,
                minutes: c.duration_minutes,
                meetingMinutes: c.meeting_duration_minutes,
            })),
        [classes]
    );

    const hasValues = data.some((d) => (metric === 'concentration' ? d.score != null : d.minutes != null));
    const avg = metric === 'concentration' ? avgScore : avgMinutes;
    const handleClick = (e: { activePayload?: { payload?: TrendPoint }[] } | null) => {
        const id = e?.activePayload?.[0]?.payload?.id;
        if (id) onSelectClass(id);
    };

    const axisTick = { fontSize: 10, fill: 'hsl(var(--muted-foreground))' };
    const common = {
        data,
        margin: { top: 8, right: 8, bottom: 0, left: -12 },
        onClick: handleClick,
        className: 'cursor-pointer',
    };
    const avgLine = avg != null && (
        <ReferenceLine
            y={avg}
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="4 4"
            label={{
                value: `avg ${metric === 'concentration' ? Math.round(avg) : formatMinutes(avg)}`,
                position: 'insideTopRight',
                fontSize: 10,
                fill: 'hsl(var(--muted-foreground))',
            }}
        />
    );

    return (
        <div className="flex flex-col gap-2">
            <ChipToggleGroup<TrendMetric>
                value={metric}
                onChange={onMetricChange}
                ariaLabel="Chart measure"
                variant="outline"
                options={[
                    { value: 'concentration', label: 'Concentration' },
                    { value: 'duration', label: 'Time in class' },
                ]}
            />
            {!hasValues ? (
                <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-2xs text-muted-foreground">
                    {metric === 'concentration'
                        ? 'No class in this period has data to score yet.'
                        : 'No class in this period has a recorded duration yet.'}
                </p>
            ) : (
                <ChartContainer config={trendConfig} className="aspect-auto h-44 w-full">
                    {metric === 'concentration' ? (
                        <LineChart {...common}>
                            <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                            <XAxis
                                dataKey="label"
                                tickLine={false}
                                axisLine={false}
                                tick={axisTick}
                                minTickGap={16}
                            />
                            <YAxis
                                domain={[0, 100]}
                                ticks={[0, 50, 100]}
                                tickLine={false}
                                axisLine={false}
                                tick={axisTick}
                            />
                            <ChartTooltip
                                cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
                                content={<TrendTooltip />}
                            />
                            {avgLine}
                            <Line
                                dataKey="score"
                                type="monotone"
                                stroke="var(--color-score)"
                                strokeWidth={2}
                                connectNulls
                                isAnimationActive={false}
                                dot={(props: { cx?: number; cy?: number; payload?: TrendPoint }) => {
                                    const { cx, cy, payload } = props;
                                    if (cx == null || cy == null || payload?.score == null) {
                                        return <g key={payload?.id ?? `${cx}`} />;
                                    }
                                    const selected = payload.id === selectedId;
                                    return (
                                        <circle
                                            key={payload.id}
                                            cx={cx}
                                            cy={cy}
                                            r={selected ? 6 : 4}
                                            fill="var(--color-score)"
                                            // 2px surface ring keeps overlapping dots legible.
                                            stroke="hsl(var(--card))"
                                            strokeWidth={2}
                                        />
                                    );
                                }}
                                activeDot={{ r: 6, stroke: 'hsl(var(--card))', strokeWidth: 2 }}
                            />
                        </LineChart>
                    ) : (
                        <BarChart {...common}>
                            <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                            <XAxis
                                dataKey="label"
                                tickLine={false}
                                axisLine={false}
                                tick={axisTick}
                                minTickGap={16}
                            />
                            <YAxis
                                tickLine={false}
                                axisLine={false}
                                tick={axisTick}
                                allowDecimals={false}
                            />
                            <ChartTooltip cursor={{ fill: 'hsl(var(--muted))' }} content={<TrendTooltip />} />
                            {avgLine}
                            <Bar
                                dataKey="minutes"
                                fill="var(--color-minutes)"
                                radius={[4, 4, 0, 0]}
                                maxBarSize={24}
                                isAnimationActive={false}
                            >
                                {data.map((d) => (
                                    <Cell
                                        key={d.id}
                                        className={cn(
                                            'transition-opacity',
                                            selectedId && selectedId !== d.id && 'opacity-40'
                                        )}
                                    />
                                ))}
                            </Bar>
                        </BarChart>
                    )}
                </ChartContainer>
            )}
        </div>
    );
};

// ── By subject ────────────────────────────────────────────────────────────────

const MAX_SUBJECT_ROWS = 6;
const NO_SUBJECT = 'No subject';
const OTHER = 'Other';

/**
 * 100% stacked bar per subject (present / not marked / absent). Click a subject to filter the
 * class list; the folded "Other" row is summary-only. Renders nothing for fewer than 2 subjects.
 */
export const SubjectBreakdown = ({
    classes,
    active,
    onSelect,
}: {
    classes: LearnerLiveClass[];
    active: string | null;
    onSelect: (subject: string | null) => void;
}) => {
    const rows = useMemo(() => {
        const bySubject = new Map<string, Record<LearnerAttendanceStatus, number>>();
        for (const c of classes) {
            const key = c.subject?.trim() || NO_SUBJECT;
            const r = bySubject.get(key) ?? { PRESENT: 0, ABSENT: 0, UNMARKED: 0 };
            r[c.attendance_status] = (r[c.attendance_status] ?? 0) + 1;
            bySubject.set(key, r);
        }
        const sorted = [...bySubject.entries()]
            .map(([subject, counts]) => ({
                subject,
                counts,
                total: counts.PRESENT + counts.ABSENT + counts.UNMARKED,
            }))
            .sort((a, b) => b.total - a.total);
        if (sorted.length <= MAX_SUBJECT_ROWS) return sorted;
        const head = sorted.slice(0, MAX_SUBJECT_ROWS - 1);
        const tail = sorted.slice(MAX_SUBJECT_ROWS - 1);
        const other = { PRESENT: 0, ABSENT: 0, UNMARKED: 0 } as Record<LearnerAttendanceStatus, number>;
        for (const t of tail) for (const s of STATUS_ORDER) other[s] += t.counts[s];
        return [
            ...head,
            { subject: OTHER, counts: other, total: tail.reduce((n, t) => n + t.total, 0) },
        ];
    }, [classes]);

    if (rows.length < 2) return null;

    return (
        <ul className="flex flex-col gap-1.5" aria-label="Attendance by subject">
            {rows.map((r) => {
                const isOther = r.subject === OTHER;
                const isActive = active === r.subject;
                return (
                    <li key={r.subject}>
                        <button
                            type="button"
                            disabled={isOther}
                            onClick={() => onSelect(isActive ? null : r.subject)}
                            aria-pressed={isActive}
                            className={cn(
                                'flex w-full flex-col gap-1 rounded-md px-2 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:cursor-default',
                                isActive ? 'bg-primary-50 ring-1 ring-primary-200' : !isOther && 'hover:bg-muted',
                                active && !isActive && 'opacity-50'
                            )}
                        >
                            <span className="flex items-center justify-between gap-2 text-caption">
                                <span className="truncate text-card-foreground">{r.subject}</span>
                                <span className="shrink-0 tabular-nums text-muted-foreground">
                                    {r.counts.PRESENT}/{r.total} attended
                                </span>
                            </span>
                            {/* gap-0.5 = the 2px surface gap between stacked segments. */}
                            <span className="flex h-2 w-full gap-0.5 overflow-hidden rounded-sm">
                                {STATUS_ORDER.filter((s) => r.counts[s] > 0).map((s) => (
                                    <span
                                        key={s}
                                        className={cn('h-full first:rounded-l-sm last:rounded-r-sm', STATUS_META[s].bg)}
                                        // Data-driven segment width — not tokenizable.
                                        style={{ width: `${(r.counts[s] / r.total) * 100}%` }}
                                        title={`${STATUS_META[s].label}: ${r.counts[s]}`}
                                    />
                                ))}
                            </span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
};
