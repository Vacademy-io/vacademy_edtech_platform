import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Legend } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { useMembershipAnalytics } from '../-hooks/useMembershipAnalytics';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { Users, Clock, Calendar, UserPlus, ArrowsClockwise } from '@phosphor-icons/react';

interface MembershipAnalyticsProps {
    packageSessionIds: string[] | undefined;
    onCardClick?: (range: { start: Date; end: Date }) => void;
}

const buildChartConfig = (t: TFunction) => ({
    newUsers: {
        label: t('newUsers'),
        color: 'hsl(var(--chart-1))',
    },
    retainers: {
        label: t('retainers'),
        color: 'hsl(var(--chart-2))',
    },
});

interface StatBreakdown {
    total: number;
    newUsers: number;
    retainers: number;
}

function StatsCardContent({ stats, t }: { stats: StatBreakdown; t: TFunction }) {
    return (
        <div>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="mb-2 text-xs text-gray-500">{t('totalUsers', { count: stats.total })}</p>
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                    <UserPlus size={14} className="text-indigo-500" />
                    <span className="text-sm font-semibold text-indigo-600">{stats.newUsers}</span>
                    <span className="text-xs text-gray-500">{t('new')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <ArrowsClockwise size={14} className="text-amber-500" />
                    <span className="text-sm font-semibold text-amber-600">{stats.retainers}</span>
                    <span className="text-xs text-gray-500">{t('retainer')}</span>
                </div>
            </div>
        </div>
    );
}

export function MembershipAnalytics({ packageSessionIds, onCardClick }: MembershipAnalyticsProps) {
    const { t } = useTranslation('membershipStatsMembershipAnalytics');
    const chartConfig = buildChartConfig(t);
    const { stats, graphData, dateRanges, isLoading } = useMembershipAnalytics(packageSessionIds);

    if (isLoading) {
        return (
            <div className="flex h-40 items-center justify-center">
                <DashboardLoader />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card
                    className="cursor-pointer shadow-sm transition-all hover:border-primary-200 hover:bg-gray-50 hover:shadow-md"
                    onClick={() => onCardClick?.(dateRanges.last24h)}
                >
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-500">
                            {t('last24Hours')}
                        </CardTitle>
                        <Clock className="h-4 w-4 text-gray-400" />
                    </CardHeader>
                    <CardContent>
                        <StatsCardContent stats={stats.last24Hours} t={t} />
                    </CardContent>
                </Card>
                <Card
                    className="cursor-pointer shadow-sm transition-all hover:border-primary-200 hover:bg-gray-50 hover:shadow-md"
                    onClick={() => onCardClick?.(dateRanges.last7d)}
                >
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-500">
                            {t('last7Days')}
                        </CardTitle>
                        <Calendar className="h-4 w-4 text-gray-400" />
                    </CardHeader>
                    <CardContent>
                        <StatsCardContent stats={stats.last7Days} t={t} />
                    </CardContent>
                </Card>
                <Card
                    className="cursor-pointer shadow-sm transition-all hover:border-primary-200 hover:bg-gray-50 hover:shadow-md"
                    onClick={() => onCardClick?.(dateRanges.last30d)}
                >
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-500">
                            {t('last30Days')}
                        </CardTitle>
                        <Users className="h-4 w-4 text-gray-400" />
                    </CardHeader>
                    <CardContent>
                        <StatsCardContent stats={stats.last30Days} t={t} />
                    </CardContent>
                </Card>
            </div>

            {/* Weekly Stats Chart — Stacked Bar */}
            <Card className="shadow-sm">
                <CardHeader className="pb-2">
                    <CardTitle className="text-base font-semibold">{t('weeklyUserTrends')}</CardTitle>
                    <p className="text-xs text-gray-500">{t('userRegistrationsLast7Days')}</p>
                </CardHeader>
                <CardContent>
                    <div className="h-56 w-full">
                        <ChartContainer config={chartConfig} className="h-full w-full">
                            <BarChart data={graphData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                <XAxis
                                    dataKey="date"
                                    tickLine={false}
                                    axisLine={false}
                                    tickMargin={10}
                                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                                />
                                <ChartTooltip
                                    cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                                    content={<ChartTooltipContent />}
                                />
                                <Legend
                                    iconType="circle"
                                    iconSize={8}
                                    wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                                />
                                <Bar
                                    dataKey="newUsers"
                                    name={t('newUsers')}
                                    stackId="a"
                                    fill="var(--color-newUsers)"
                                    radius={[0, 0, 0, 0]}
                                    barSize={40}
                                />
                                <Bar
                                    dataKey="retainers"
                                    name={t('retainers')}
                                    stackId="a"
                                    fill="var(--color-retainers)"
                                    radius={[4, 4, 0, 0]}
                                    barSize={40}
                                />
                            </BarChart>
                        </ChartContainer>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
