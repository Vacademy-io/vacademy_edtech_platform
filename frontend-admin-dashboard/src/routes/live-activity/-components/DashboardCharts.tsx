import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    LabelList,
    XAxis,
    YAxis,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import type { LiveActivityAnalytics, NamedCount } from '../-services/live-activity-service';

/**
 * Dashboard charts.
 *
 * <p><b>Why these are all single-series.</b> This design system has exactly two non-status
 * hues (primary and info); success, warning and danger are reserved for state and must not
 * become "series 4". Validating a five-hue categorical palette from these ramps FAILS -- the
 * amber sits outside the lightness band and four of five fall under 3:1 contrast on this
 * surface. So category is encoded on the axis where there is room to spell it out, and
 * colour carries magnitude instead. That is the better chart anyway: comparing five labelled
 * bars is easier than decoding five legend swatches.
 *
 * <p>The data hue is primary-600, which clears 3:1 contrast against the chart surface.
 * primary-500 measures 2.83:1 and was rejected for exactly that reason.
 */

/** The one validated data hue. */
const DATA_HUE = 'hsl(var(--primary-600))';

/** Sequential steps for ordered stages -- light to dark, monotonic. */
const FUNNEL_STEPS = [
    'hsl(var(--primary-300))',
    'hsl(var(--primary-500))',
    'hsl(var(--primary-700))',
];

const AXIS_TICK = { fontSize: 11, fill: 'hsl(var(--neutral-500))' };

export function EnrolmentFunnel({ data }: { data: LiveActivityAnalytics }) {
    // Numbers format per the active locale, not the browser's -- this dashboard ships in
    // en, ar and fr, and digit grouping differs between them.
    const { i18n } = useTranslation();
    const stages = data.funnel;
    const top = stages[0]?.count ?? 0;

    return (
        <Card title="Enrolment funnel" subtitle="Where prospects stop">
            {top === 0 ? (
                <Empty>No invite forms filled in this period.</Empty>
            ) : (
                <div className="space-y-2.5">
                    {stages.map((stage, i) => {
                        const pct = top > 0 ? (stage.count / top) * 100 : 0;
                        const prev = i > 0 ? stages[i - 1]?.count ?? 0 : null;
                        // Drop-off is the reason this chart exists, so it is stated in
                        // words rather than left for the reader to compute from bar widths.
                        const dropped = prev !== null && prev > 0 ? prev - stage.count : null;
                        return (
                            <div key={stage.name}>
                                <div className="flex items-baseline justify-between text-caption">
                                    <span className="text-neutral-600">{stage.name}</span>
                                    <span className="font-medium tabular-nums text-neutral-700">
                                        {stage.count.toLocaleString(i18n.language)}
                                        <span className="ms-1.5 text-neutral-400">
                                            {Math.round(pct)}%
                                        </span>
                                    </span>
                                </div>
                                <div className="mt-1 h-2.5 w-full overflow-hidden rounded bg-neutral-100">
                                    {/* Dynamic: the bar length IS the datum, so it cannot
                                        come from a fixed token. */}
                                    <div
                                        className="h-full rounded"
                                        style={{
                                            width: `${Math.max(pct, 1)}%`,
                                            background: FUNNEL_STEPS[i] ?? DATA_HUE,
                                        }}
                                    />
                                </div>
                                {dropped !== null && dropped > 0 && (
                                    <div className="mt-0.5 text-caption text-neutral-400">
                                        {dropped.toLocaleString(i18n.language)} dropped off here
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}

export function ActivityTimeline({ data }: { data: LiveActivityAnalytics }) {
    const points = data.timeline.map((b) => ({
        label: new Date(b.startEpochMillis).toLocaleTimeString([], { hour: '2-digit' }),
        count: b.count,
    }));
    const total = points.reduce((sum, p) => sum + p.count, 0);

    return (
        <Card title="Activity over time" subtitle="Events per hour">
            {total === 0 ? (
                <Empty>Nothing recorded in this period.</Empty>
            ) : (
                <ChartContainer
                    config={{ count: { label: 'Events' } }}
                    className="h-52 w-full"
                >
                    <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                        {/* Horizontal rules only, and recessive -- the grid orients, it
                            should not compete with the data. */}
                        <CartesianGrid
                            vertical={false}
                            stroke="hsl(var(--neutral-200))"
                            strokeDasharray="2 4"
                        />
                        <XAxis
                            dataKey="label"
                            tickLine={false}
                            axisLine={false}
                            tick={AXIS_TICK}
                            interval="preserveStartEnd"
                            minTickGap={24}
                        />
                        <YAxis
                            tickLine={false}
                            axisLine={false}
                            tick={AXIS_TICK}
                            width={32}
                            allowDecimals={false}
                        />
                        <ChartTooltip />
                        <Area
                            type="monotone"
                            dataKey="count"
                            stroke={DATA_HUE}
                            strokeWidth={2}
                            fill={DATA_HUE}
                            fillOpacity={0.12}
                            dot={false}
                            activeDot={{ r: 4, strokeWidth: 2, stroke: 'white' }}
                        />
                    </AreaChart>
                </ChartContainer>
            )}
        </Card>
    );
}

export function LeadSources({ data }: { data: LiveActivityAnalytics }) {
    return (
        <RankedBars
            title="Lead sources"
            subtitle="Where leads came from"
            rows={data.leadSources}
            empty="No leads in this period."
        />
    );
}

export function CounsellorActivity({ data }: { data: LiveActivityAnalytics }) {
    return (
        <RankedBars
            title="Counsellor activity"
            subtitle="Calls and actions logged"
            rows={data.counsellors}
            empty="No counsellor activity in this period."
        />
    );
}

export function CallOutcomes({ data }: { data: LiveActivityAnalytics }) {
    return (
        <RankedBars
            title="Call outcomes"
            subtitle="Dispositions logged"
            rows={data.callOutcomes}
            empty="No dispositions logged in this period."
        />
    );
}

/**
 * Horizontal bars, sorted, with the value printed on each.
 *
 * <p>Horizontal rather than vertical because the categories are words -- source names,
 * people's names, disposition labels -- and vertical bars force those onto a rotated axis
 * that nobody can read. Direct labels also discharge the contrast obligation: the value is
 * legible as text whatever the fill does.
 */
function RankedBars({
    title,
    subtitle,
    rows,
    empty,
}: {
    title: string;
    subtitle: string;
    rows: NamedCount[];
    empty: string;
}) {
    if (!rows || rows.length === 0) {
        return (
            <Card title={title} subtitle={subtitle}>
                <Empty>{empty}</Empty>
            </Card>
        );
    }

    const height = Math.max(160, rows.length * 34);

    return (
        <Card title={title} subtitle={subtitle}>
            <ChartContainer
                config={{ count: { label: 'Count' } }}
                className="w-full"
                /* Dynamic: height scales with the row count, which is data-dependent. */
                style={{ height }}
            >
                <BarChart
                    data={rows}
                    layout="vertical"
                    margin={{ top: 4, right: 36, bottom: 4, left: 4 }}
                >
                    <XAxis type="number" hide />
                    <YAxis
                        type="category"
                        dataKey="name"
                        tickLine={false}
                        axisLine={false}
                        tick={AXIS_TICK}
                        width={120}
                    />
                    <ChartTooltip />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={14}>
                        {rows.map((row) => (
                            // A Cell per row so the fill follows the entity, not its rank --
                            // re-sorting must never repaint the bars.
                            <Cell key={row.name} fill={DATA_HUE} />
                        ))}
                        <LabelList
                            dataKey="count"
                            position="right"
                            className="fill-neutral-600"
                            fontSize={11}
                        />
                    </Bar>
                </BarChart>
            </ChartContainer>
        </Card>
    );
}

function Card({
    title,
    subtitle,
    children,
}: {
    title: string;
    subtitle?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="mb-3">
                <h3 className="text-body font-medium text-neutral-700">{title}</h3>
                {subtitle && <p className="text-caption text-neutral-500">{subtitle}</p>}
            </div>
            {children}
        </div>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-36 items-center justify-center text-caption text-neutral-400">
            {children}
        </div>
    );
}
