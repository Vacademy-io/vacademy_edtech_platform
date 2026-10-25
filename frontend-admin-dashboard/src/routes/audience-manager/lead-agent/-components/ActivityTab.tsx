import { useMemo } from 'react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { ChartBar } from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, formatNumber } from '@/lib/formatters';
import { EmptyState, ErrorState } from '@/routes/manage-pages/site-assistant/-components/TabStates';
import type { AgentStatsDay } from '../-types';
import { useAgentStats } from '../-hooks/use-lead-agent';
import { apiErrorMessage } from '../-services/lead-agent-api';

const DAYS = 14;

// Recharts paints SVG, so it needs colour strings: the design tokens' CSS variables.
const SERIES = [
    { key: 'delivered', label: 'Delivered', color: 'hsl(var(--success-500))' },
    { key: 'review', label: 'To review', color: 'hsl(var(--warning-500))' },
    { key: 'rejected', label: 'Rejected', color: 'hsl(var(--danger-400))' },
] as const;

const COLUMNS: { key: keyof AgentStatsDay; label: string }[] = [
    { key: 'discovered', label: 'Found' },
    { key: 'researched', label: 'Researched' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'review', label: 'To review' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'searches', label: 'Searches' },
    { key: 'pages', label: 'Pages read' },
    { key: 'credits', label: 'Credits' },
];

const dayLabel = (day: string) => formatDate(`${day}T00:00:00`, { year: undefined });

/** Last 14 days of the agent's counters (lead_agent_day). */
export function ActivityTab({ agentId }: { agentId: string }) {
    const q = useAgentStats(agentId, DAYS);
    const rows = useMemo(
        () => [...(q.data ?? [])].sort((a, b) => a.day.localeCompare(b.day)),
        [q.data]
    );
    const totals = useMemo(() => {
        const t: Record<string, number> = {};
        for (const c of COLUMNS) t[c.key] = rows.reduce((s, r) => s + Number(r[c.key] || 0), 0);
        return t;
    }, [rows]);

    if (q.isLoading) return <Skeleton className="h-64 w-full" />;
    if (q.isError)
        return (
            <ErrorState
                message={apiErrorMessage(q.error, 'Could not load the activity.')}
                onRetry={() => void q.refetch()}
            />
        );
    if (rows.length === 0)
        return (
            <EmptyState
                icon={<ChartBar className="size-8 text-neutral-400" />}
                title="No activity yet"
            >
                Daily numbers appear here once the agent has run.
            </EmptyState>
        );

    const chartData = rows.map((r) => ({ ...r, label: dayLabel(r.day) }));

    return (
        <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-card p-4">
                <h3 className="text-subtitle font-semibold text-neutral-800">
                    Leads per day, last {DAYS} days
                </h3>
                <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                            data={chartData}
                            margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
                        >
                            <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                            <XAxis
                                dataKey="label"
                                tickLine={false}
                                axisLine={false}
                                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                            />
                            <YAxis
                                allowDecimals={false}
                                tickLine={false}
                                axisLine={false}
                                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                            />
                            <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} />
                            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                            {SERIES.map((s, i) => (
                                <Bar
                                    key={s.key}
                                    dataKey={s.key}
                                    name={s.label}
                                    stackId="leads"
                                    fill={s.color}
                                    stroke="hsl(var(--card))"
                                    strokeWidth={1}
                                    maxBarSize={24}
                                    radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0}
                                />
                            ))}
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </section>

            <div className="overflow-x-auto rounded-lg border border-neutral-200">
                <table className="w-full min-w-max text-body">
                    <thead className="bg-neutral-50 text-caption text-neutral-600">
                        <tr>
                            <th scope="col" className="px-3 py-2 text-start font-semibold">
                                Day
                            </th>
                            {COLUMNS.map((c) => (
                                <th
                                    key={c.key}
                                    scope="col"
                                    className="px-3 py-2 text-end font-semibold"
                                >
                                    {c.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {[...rows].reverse().map((r) => (
                            <tr key={r.day} className="border-t border-neutral-100">
                                <th
                                    scope="row"
                                    className="px-3 py-2 text-start font-regular text-neutral-700"
                                >
                                    {dayLabel(r.day)}
                                </th>
                                {COLUMNS.map((c) => (
                                    <td
                                        key={c.key}
                                        className="px-3 py-2 text-end tabular-nums text-neutral-700"
                                    >
                                        {formatNumber(Number(r[c.key] || 0), {
                                            maximumFractionDigits: c.key === 'credits' ? 2 : 0,
                                        })}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="border-t border-neutral-200 bg-neutral-50">
                        <tr>
                            <th
                                scope="row"
                                className="px-3 py-2 text-start font-semibold text-neutral-800"
                            >
                                Total
                            </th>
                            {COLUMNS.map((c) => (
                                <td
                                    key={c.key}
                                    className="px-3 py-2 text-end font-semibold tabular-nums text-neutral-800"
                                >
                                    {formatNumber(totals[c.key] ?? 0, {
                                        maximumFractionDigits: c.key === 'credits' ? 2 : 0,
                                    })}
                                </td>
                            ))}
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
}
