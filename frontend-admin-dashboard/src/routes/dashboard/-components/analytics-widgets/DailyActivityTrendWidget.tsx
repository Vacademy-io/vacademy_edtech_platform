import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { fetchAnalyticsEngagementTrends } from '../../-services/dashboard-services';
import { ChartLine } from '@phosphor-icons/react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    ResponsiveContainer,
    Tooltip,
    CartesianGrid,
} from 'recharts';

interface DailyActivityTrendWidgetProps {
    instituteId: string;
}

interface TrendDay {
    date: string;
    unique_users: number;
    total_sessions: number;
    total_api_calls: number;
    average_session_duration?: number;
}

interface TrendPoint {
    date: string;
    users: number;
    sessions: number;
    avgDuration: number;
}

interface TooltipPayloadEntry {
    color: string;
    name: string;
    value: number;
}

function buildFormatDate(t: TFunction) {
    const months = t('chart.months', { returnObjects: true }) as string[];
    return (dateStr: string) => {
        const parsed = new Date(dateStr);
        return t('chart.dateLabel', {
            month: months[parsed.getMonth()],
            day: parsed.getDate(),
        });
    };
}

const CustomTooltip = ({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: TooltipPayloadEntry[];
    label?: string;
}) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-md border border-neutral-200 bg-white p-2 text-xs shadow-md">
            <div className="font-semibold text-neutral-800">{label}</div>
            {payload.map((entry, i) => (
                <div key={i} className="mt-0.5" style={{ color: entry.color }}>
                    {entry.name}: {entry.value.toLocaleString()}
                </div>
            ))}
        </div>
    );
};

export default function DailyActivityTrendWidget({ instituteId }: DailyActivityTrendWidgetProps) {
    const { t } = useTranslation('dashboardDailyActivityTrendWidget');
    const { data, isLoading, isError } = useQuery({
        queryKey: ['analytics-daily-trends', instituteId],
        queryFn: () => fetchAnalyticsEngagementTrends(instituteId),
        staleTime: 300_000,
        gcTime: 600_000,
        retry: false,
    });

    const formatDate = buildFormatDate(t);

    const days: TrendDay[] = data?.daily_activity_trend || [];
    const trendData: TrendPoint[] = days
        .map((day) => ({
            date: formatDate(day.date),
            users: day.unique_users,
            sessions: day.total_sessions,
            avgDuration: Math.round(day.average_session_duration || 0),
        }))
        .slice(-7);

    const totalUsers = trendData.reduce((sum, d) => sum + d.users, 0);
    const totalSessions = trendData.reduce((sum, d) => sum + d.sessions, 0);
    const avgDuration =
        trendData.length > 0
            ? Math.round(trendData.reduce((sum, d) => sum + d.avgDuration, 0) / trendData.length)
            : 0;

    return (
        <Card className="flex h-full flex-col bg-white shadow-sm">
            <CardHeader className="p-4 pb-2">
                <div className="flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                        <ChartLine size={14} weight="duotone" />
                    </span>
                    <div className="min-w-0">
                        <CardTitle className="text-sm font-semibold">
                            {t('header.title')}
                        </CardTitle>
                        <CardDescription className="line-clamp-1 text-2xs text-neutral-500 sm:text-xs">
                            {t('header.subtitle')}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <div className="flex flex-1 flex-col px-4 pb-4">
                {isLoading ? (
                    <div className="flex flex-1 flex-col gap-3">
                        <div className="grid grid-cols-3 gap-2">
                            <Skeleton className="h-12 rounded-md" />
                            <Skeleton className="h-12 rounded-md" />
                            <Skeleton className="h-12 rounded-md" />
                        </div>
                        <Skeleton className="h-32 flex-1 rounded-md" />
                    </div>
                ) : isError || trendData.length === 0 ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
                        <ChartLine size={20} weight="duotone" className="text-neutral-300" />
                        <div className="text-2xs text-neutral-500">
                            {isError ? t('error.message') : t('empty.message')}
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-3 gap-2">
                            <div className="rounded-md border border-blue-100 bg-blue-50/60 p-2">
                                <div className="text-base font-semibold tabular-nums text-blue-700">
                                    {totalUsers.toLocaleString('en-IN')}
                                </div>
                                <div className="text-2xs text-blue-700/80">
                                    {t('stats.users')}
                                </div>
                            </div>
                            <div className="rounded-md border border-emerald-100 bg-emerald-50/60 p-2">
                                <div className="text-base font-semibold tabular-nums text-emerald-700">
                                    {totalSessions.toLocaleString('en-IN')}
                                </div>
                                <div className="text-2xs text-emerald-700/80">
                                    {t('stats.sessions')}
                                </div>
                            </div>
                            <div className="rounded-md border border-violet-100 bg-violet-50/60 p-2">
                                <div className="text-base font-semibold tabular-nums text-violet-700">
                                    {avgDuration}
                                    <span className="text-xs">{t('stats.avgDurationUnit')}</span>
                                </div>
                                <div className="text-2xs text-violet-700/80">
                                    {t('stats.avgDuration')}
                                </div>
                            </div>
                        </div>
                        <div className="mt-3 h-32 flex-1">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart
                                    data={trendData}
                                    margin={{ top: 4, right: 4, bottom: 0, left: -16 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                                    <XAxis
                                        dataKey="date"
                                        tick={{ fontSize: 10 }}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        tick={{ fontSize: 10 }}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Line
                                        type="monotone"
                                        dataKey="users"
                                        stroke="hsl(var(--info-500))"
                                        strokeWidth={2}
                                        dot={{ fill: 'hsl(var(--info-500))', r: 3 }}
                                        name={t('stats.users')}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="sessions"
                                        stroke="hsl(var(--success-500))"
                                        strokeWidth={2}
                                        dot={{ fill: 'hsl(var(--success-500))', r: 3 }}
                                        name={t('stats.sessions')}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </>
                )}
            </div>
        </Card>
    );
}
