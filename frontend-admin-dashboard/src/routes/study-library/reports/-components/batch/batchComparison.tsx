import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MultiSelect } from '@/components/design-system/multi-select';
import { ReportBlock } from '@/components/common/report-visuals/blocks';
import { REPORT_COLORS, pct } from '@/components/common/report-visuals/palette';
import { cn } from '@/lib/utils';
import type { BatchSummaryReport } from '@/services/batch-summary-report';

/** Distinct colours, one per compared batch, in a fixed order. */
const BATCH_COLORS = [
    '#4f46e5',
    '#0ea5e9',
    '#f59e0b',
    '#10b981',
    '#ec4899',
    '#8b5cf6',
    '#ef4444',
    '#14b8a6',
];
const MAX_COMPARED = BATCH_COLORS.length;
const DEFAULT_COMPARED = 5;

type Metric = 'avg' | 'participation';

const METRICS: { key: Metric; label: string }[] = [
    { key: 'avg', label: 'Average score' },
    { key: 'participation', label: 'Took an assessment' },
];

type BatchRow = NonNullable<BatchSummaryReport['batches']>[number];

const valueOf = (b: BatchRow, metric: Metric) =>
    metric === 'avg'
        ? b.avg_score
        : b.learners > 0
          ? Math.round((b.learners_assessed / b.learners) * 1000) / 10
          : null;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * All-batches report: pick up to eight batches and compare them side by side, each in its own
 * colour, by average score or by the share of learners who took an assessment. The figures come
 * with the report, so switching batches or the metric is instant.
 */
export function BatchComparison({
    data,
    brand,
    batchLabels,
}: {
    data: BatchSummaryReport;
    brand: string;
    batchLabels: Map<string, string>;
}) {
    const batches = useMemo(() => (data.batches ?? []).filter((b) => b.learners > 0), [data]);
    const byId = useMemo(() => new Map(batches.map((b) => [b.package_session_id, b])), [batches]);
    const labelOf = (id: string) => batchLabels.get(id) ?? 'Batch';

    const [selected, setSelected] = useState<string[]>([]);
    const [metric, setMetric] = useState<Metric>('avg');

    // Start with the best-scoring batches; keep the pick when the report reloads if still valid.
    useEffect(() => {
        setSelected((prev) => {
            const kept = prev.filter((id) => byId.has(id));
            if (kept.length > 0) return kept;
            return batches
                .filter((b) => b.avg_score != null)
                .slice(0, DEFAULT_COMPARED)
                .map((b) => b.package_session_id);
        });
    }, [batches, byId]);

    const options = useMemo(
        () =>
            batches.map((b) => ({
                value: b.package_session_id,
                label: `${labelOf(b.package_session_id)} (${b.learners_assessed}/${b.learners})`,
            })),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- labels derive from batchLabels
        [batches, batchLabels]
    );

    // Colour follows the batch: assigned by position in the pick, never by rank.
    const colorOf = useMemo(
        () => new Map(selected.map((id, i) => [id, BATCH_COLORS[i % BATCH_COLORS.length] ?? brand])),
        [selected, brand]
    );

    const chart = selected
        .map((id) => byId.get(id))
        .filter((b): b is BatchRow => !!b)
        .map((b) => ({
            id: b.package_session_id,
            name: labelOf(b.package_session_id),
            value: valueOf(b, metric),
            assessed: b.learners_assessed,
            learners: b.learners,
            avg: b.avg_score,
        }));

    const best = [...chart].sort((a, b) => (b.value ?? -1) - (a.value ?? -1))[0];

    return (
        <ReportBlock
            brand={brand}
            tag="Batches compared"
            title={
                best?.value != null
                    ? `${clip(best.name, 48)} leads on ${metric === 'avg' ? 'average score' : 'participation'}`
                    : 'Pick batches to compare'
            }
            lede={`${batches.length} batches with learners. Pick up to ${MAX_COMPARED} to compare.`}
            className="lg:col-span-2"
        >
            <div className="flex flex-col gap-2 md:flex-row md:items-start">
                <MultiSelect
                    options={options}
                    selected={selected}
                    onChange={(next) => setSelected(next.slice(0, MAX_COMPARED))}
                    checkboxes
                    placeholder="Pick batches to compare"
                    className="h-auto min-h-9 flex-1 py-1 text-sm"
                />
                <div className="flex shrink-0 rounded-lg bg-neutral-100 p-1">
                    {METRICS.map((m) => (
                        <button
                            key={m.key}
                            type="button"
                            onClick={() => setMetric(m.key)}
                            className={cn(
                                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                                metric === m.key
                                    ? 'bg-white text-neutral-800 shadow-sm'
                                    : 'text-neutral-500 hover:text-neutral-700'
                            )}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>
            </div>

            {chart.length === 0 ? (
                <p className="py-6 text-center text-sm text-neutral-500">
                    Pick one or more batches above.
                </p>
            ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chart} margin={{ top: 18, right: 8, left: -18, bottom: 0 }}>
                                <CartesianGrid vertical={false} stroke={REPORT_COLORS.line} />
                                <XAxis dataKey="id" tick={false} axisLine={false} tickLine={false} />
                                <YAxis
                                    domain={[0, 100]}
                                    ticks={[0, 25, 50, 75, 100]}
                                    unit="%"
                                    tick={{ fontSize: 11, fill: REPORT_COLORS.muted }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <Tooltip
                                    cursor={{ fill: '#f8fafc' }}
                                    content={({ active, payload }) => {
                                        const p = payload?.[0]?.payload as (typeof chart)[number] | undefined;
                                        return active && p ? (
                                            <div className="max-w-xs rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs shadow-md">
                                                <div className="mb-1 font-semibold text-neutral-800">{p.name}</div>
                                                <div className="text-neutral-600">Average score: {pct(p.avg)}</div>
                                                <div className="text-neutral-600">
                                                    Assessed: {p.assessed} of {p.learners}
                                                </div>
                                            </div>
                                        ) : null;
                                    }}
                                />
                                <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={56}>
                                    {chart.map((c) => (
                                        <Cell key={c.id} fill={colorOf.get(c.id) ?? brand} />
                                    ))}
                                    <LabelList
                                        dataKey="value"
                                        position="top"
                                        fontSize={11}
                                        fill={REPORT_COLORS.ink}
                                        formatter={(v: number | null) => (v == null ? '—' : `${Math.round(v)}%`)}
                                    />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <ul className="flex flex-col gap-2">
                        {chart.map((c) => (
                            <li key={c.id} className="flex items-start gap-2 text-sm">
                                <span
                                    className="mt-1 size-3 shrink-0 rounded-sm"
                                    style={{ background: colorOf.get(c.id) }}
                                />
                                <span className="min-w-0 flex-1">
                                    <span
                                        className="block truncate font-medium"
                                        style={{ color: colorOf.get(c.id) }}
                                        title={c.name}
                                    >
                                        {c.name}
                                    </span>
                                    <span className="text-xs text-neutral-500">
                                        {pct(c.avg)} average · {c.assessed}/{c.learners} assessed
                                    </span>
                                </span>
                                <span className="shrink-0 font-semibold text-neutral-800">
                                    {pct(c.value)}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </ReportBlock>
    );
}
