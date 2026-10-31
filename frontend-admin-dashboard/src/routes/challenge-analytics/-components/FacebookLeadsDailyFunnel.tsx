import { useMemo } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
    ChartConfig,
    ChartContainer,
    ChartLegend,
    ChartLegendContent,
    ChartTooltip,
    ChartTooltipContent,
} from '@/components/ui/chart';
import { CalendarBlank, ChartLineUp, ChatCircle, PaperPlaneTilt } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { LeadJourneyFunnelResponse } from '@/types/challenge-analytics';

/**
 * Daily message funnel for Facebook leads — the same "Daily Participation"
 * view as the Overview tab, but driven by the lead-journey funnel (per-day
 * sends/replies for the FB-lead drip).
 */

const chartConfig = {
    outgoing: { label: 'Sent', color: 'hsl(var(--chart-1))' },
    incoming: { label: 'Replied', color: 'hsl(var(--chart-2))' },
    response_rate: { label: 'Response %', color: 'hsl(var(--chart-4))' },
} satisfies ChartConfig;

interface KpiPill {
    label: string;
    value: string;
    icon: typeof CalendarBlank;
    tone: string;
}

export function FacebookLeadsDailyFunnel({
    funnel,
    loading,
}: {
    funnel?: LeadJourneyFunnelResponse;
    loading?: boolean;
}) {
    const { t } = useTranslation('challengeAnalyticsFacebookLeadsDailyFunnel');
    const chartData = useMemo(
        () =>
            (funnel?.days ?? []).map((d) => ({
                name: `Day ${d.day_number}`,
                outgoing: d.total_sends,
                incoming: d.replied,
                response_rate: d.reply_rate,
            })),
        [funnel]
    );

    const summary = funnel?.summary;
    const kpis: KpiPill[] = [
        {
            label: t('kpis.days'),
            value: `${funnel?.days?.length ?? 0}`,
            icon: CalendarBlank,
            tone: 'bg-info-50 text-info-600',
        },
        {
            label: t('kpis.sent'),
            value: `${summary?.total_sends ?? 0}`,
            icon: PaperPlaneTilt,
            tone: 'bg-primary-50 text-primary-500',
        },
        {
            label: t('kpis.replied'),
            value: `${summary?.replied_recipients ?? 0}`,
            icon: ChatCircle,
            tone: 'bg-success-50 text-success-600',
        },
        {
            label: t('kpis.response'),
            value: `${summary?.reply_rate != null ? `${summary.reply_rate}%` : '0%'}`,
            icon: ChartLineUp,
            tone: 'bg-warning-50 text-warning-600',
        },
    ];

    const hasData = chartData.length > 0 && (summary?.total_sends ?? 0) > 0;

    return (
        <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-neutral-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-2.5">
                    <div className="shrink-0 rounded-md bg-primary-50 p-1.5 text-primary-500">
                        <ChartLineUp className="size-4" />
                    </div>
                    <div>
                        <h3 className="text-subtitle font-semibold text-neutral-700">
                            {t('title')}
                        </h3>
                        <p className="mt-0.5 text-caption text-neutral-500">
                            {t('subtitle')}
                        </p>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {kpis.map((k) => (
                        <div
                            key={k.label}
                            className="flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-2"
                        >
                            <div className={`shrink-0 rounded-md p-1.5 ${k.tone}`}>
                                <k.icon className="size-4" />
                            </div>
                            <div>
                                <p className="text-caption text-neutral-500">{k.label}</p>
                                <p className="text-body font-semibold text-neutral-700">{k.value}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="p-5">
                {loading ? (
                    <div className="flex h-72 items-center justify-center text-body text-neutral-500">
                        {t('loading')}
                    </div>
                ) : !hasData ? (
                    <div className="flex h-72 flex-col items-center justify-center gap-1 text-center">
                        <p className="text-subtitle font-semibold text-neutral-700">{t('emptyTitle')}</p>
                        <p className="text-body text-neutral-500">
                            {t('emptyDescription')}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                        <div>
                            <h4 className="mb-3 text-caption font-semibold uppercase tracking-wide text-neutral-500">
                                {t('messagesByDayHeading')}
                            </h4>
                            <ChartContainer config={chartConfig} className="h-72 w-full">
                                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                                    <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} />
                                    <YAxis tickLine={false} axisLine={false} width={32} />
                                    <ChartTooltip content={<ChartTooltipContent />} />
                                    <ChartLegend content={<ChartLegendContent />} />
                                    <Bar dataKey="outgoing" stackId="a" fill="var(--color-outgoing)" radius={[0, 0, 0, 0]} />
                                    <Bar dataKey="incoming" stackId="a" fill="var(--color-incoming)" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ChartContainer>
                        </div>
                        <div>
                            <h4 className="mb-3 text-caption font-semibold uppercase tracking-wide text-neutral-500">
                                {t('responseRateTrendHeading')}
                            </h4>
                            <ChartContainer config={chartConfig} className="h-72 w-full">
                                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                                    <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} />
                                    <YAxis tickLine={false} axisLine={false} width={36} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                                    <ChartTooltip content={<ChartTooltipContent />} />
                                    <Area
                                        dataKey="response_rate"
                                        type="monotone"
                                        stroke="var(--color-response_rate)"
                                        fill="var(--color-response_rate)"
                                        fillOpacity={0.15}
                                        strokeWidth={2}
                                    />
                                </AreaChart>
                            </ChartContainer>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
