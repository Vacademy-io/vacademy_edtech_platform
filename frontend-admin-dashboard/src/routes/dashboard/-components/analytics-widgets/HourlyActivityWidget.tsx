import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fetchAnalyticsEngagementTrends } from '../../-services/dashboard-services';
import { useTheme } from '@/providers/theme/theme-provider';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import { Clock, Sun, Moon } from '@phosphor-icons/react';

interface HourlyActivityWidgetProps {
    instituteId: string;
}

export default function HourlyActivityWidget({ instituteId }: HourlyActivityWidgetProps) {
    const { t, i18n } = useTranslation('dashboardHourlyActivityWidget');
    const { primaryColor } = useTheme();

    const { data, isLoading, error } = useQuery({
        queryKey: ['analytics-hourly-activity', instituteId],
        queryFn: () => fetchAnalyticsEngagementTrends(instituteId),
        staleTime: 300000, // 5 minutes - data considered fresh
        gcTime: 600000, // 10 minutes - keep in cache after becoming unused
    });

    console.log('HourlyActivityWidget - data:', data);

    // Process hourly activity data
    const hourlyData =
        data?.hourly_activity?.map((hour: any) => ({
            hour: hour.hour,
            activity: hour.activity_count,
            users: hour.unique_users,
            timeLabel: formatHour(hour.hour),
            period:
                hour.hour < 6
                    ? 'night'
                    : hour.hour < 12
                      ? 'morning'
                      : hour.hour < 18
                        ? 'afternoon'
                        : 'evening',
        })) || [];

    function formatHour(hour: number) {
        if (hour === 0) return t('time.am', { hour: 12 });
        if (hour < 12) return t('time.am', { hour });
        if (hour === 12) return t('time.pm', { hour: 12 });
        return t('time.pm', { hour: hour - 12 });
    }

    function getBarColor(period: string) {
        switch (period) {
            case 'night':
                return 'hsl(var(--info-600))'; // Blue
            case 'morning':
                return 'hsl(var(--warning-500))'; // Amber
            case 'afternoon':
                return 'hsl(var(--danger-600))'; // Red
            case 'evening':
                return 'hsl(var(--primary-500))'; // Brand accent
            default:
                return 'hsl(var(--muted-foreground))'; // Gray
        }
    }

    function getPeriodLabel(period: string) {
        switch (period) {
            case 'night':
                return t('period.night');
            case 'morning':
                return t('period.morning');
            case 'afternoon':
                return t('period.afternoon');
            case 'evening':
                return t('period.evening');
            default:
                return period;
        }
    }

    const peakHour = hourlyData.reduce(
        (peak: any, current: any) => (current.activity > (peak?.activity || 0) ? current : peak),
        null
    );

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            return (
                <div className="rounded-lg border bg-white p-3 shadow-lg">
                    <p className="font-semibold text-gray-800">{data.timeLabel}</p>
                    <p className="text-sm text-gray-600">
                        {t('tooltip.activity', { value: data.activity.toLocaleString(i18n.language) })}
                    </p>
                    <p className="text-sm text-gray-600">
                        {t('tooltip.users', { value: data.users.toLocaleString(i18n.language) })}
                    </p>
                    <p className="text-primary-600 text-sm font-medium capitalize">
                        {getPeriodLabel(data.period)}
                    </p>
                </div>
            );
        }
        return null;
    };

    return (
        <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            whileHover={{ y: -3 }}
            className="h-full"
        >
            <Card className="h-full border-0 bg-gradient-to-br from-white to-amber-50 shadow-lg transition-all duration-300 hover:shadow-xl">
                <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                        <motion.div
                            animate={{ rotate: [0, 360] }}
                            transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                            className="rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 p-2 text-white"
                        >
                            <Clock size={20} />
                        </motion.div>
                        <div className="flex-1">
                            <CardTitle className="text-lg font-bold text-gray-800">
                                {t('header.title')}
                            </CardTitle>
                            <CardDescription className="text-sm text-gray-600">
                                {t('header.subtitle')}
                            </CardDescription>
                        </div>
                        {peakHour && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 1 }}
                                className="text-right"
                            >
                                <div className="text-xs text-gray-500">{t('peakHour.label')}</div>
                                <div className="text-lg font-bold text-amber-700">
                                    {peakHour.timeLabel}
                                </div>
                            </motion.div>
                        )}
                    </div>
                </CardHeader>

                <CardContent className="pt-0">
                    {isLoading ? (
                        <div className="flex h-48 items-center justify-center">
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                                className="border-3 size-8 rounded-full border-amber-500 border-t-transparent"
                            />
                        </div>
                    ) : error ? (
                        <div className="py-8 text-center text-red-500">
                            <Clock size={32} className="mx-auto mb-2 opacity-50" />
                            <p className="text-sm">{t('error.message')}</p>
                        </div>
                    ) : hourlyData.length === 0 ? (
                        <div className="py-8 text-center text-gray-500">
                            <Clock size={32} className="mx-auto mb-2 opacity-50" />
                            <p className="text-sm">{t('empty.message')}</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Bar Chart */}
                            <div className="h-48">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={hourlyData}>
                                        <XAxis
                                            dataKey="hour"
                                            tick={{ fontSize: 10 }}
                                            axisLine={false}
                                            tickFormatter={(hour) =>
                                                hour % 4 === 0 ? formatHour(hour) : ''
                                            }
                                        />
                                        <YAxis tick={{ fontSize: 12 }} axisLine={false} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Bar
                                            dataKey="activity"
                                            radius={[2, 2, 0, 0]}
                                            animationDuration={1000}
                                        >
                                            {hourlyData.map((entry: any, index: number) => (
                                                <Cell
                                                    key={`cell-${index}`}
                                                    fill={getBarColor(entry.period)}
                                                />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Period Breakdown */}
                            <div className="grid grid-cols-4 gap-2 text-center">
                                {[
                                    {
                                        period: 'morning',
                                        icon: Sun,
                                        color: 'text-amber-600',
                                        bg: 'bg-amber-100',
                                        border: 'border-amber-200',
                                    },
                                    {
                                        period: 'afternoon',
                                        icon: Sun,
                                        color: 'text-red-600',
                                        bg: 'bg-red-100',
                                        border: 'border-red-200',
                                    },
                                    {
                                        period: 'evening',
                                        icon: Moon,
                                        color: 'text-purple-600',
                                        bg: 'bg-purple-100',
                                        border: 'border-purple-200',
                                    },
                                    {
                                        period: 'night',
                                        icon: Moon,
                                        color: 'text-indigo-600',
                                        bg: 'bg-indigo-100',
                                        border: 'border-indigo-200',
                                    },
                                ].map((p, index) => {
                                    const periodData = hourlyData.filter(
                                        (h: any) => h.period === p.period
                                    );
                                    const totalActivity = periodData.reduce(
                                        (sum: number, h: any) => sum + h.activity,
                                        0
                                    );

                                    return (
                                        <motion.div
                                            key={p.period}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: 0.5 + index * 0.1 }}
                                            className={`rounded-lg p-2 ${p.bg} border ${p.border}`}
                                        >
                                            <p.icon size={16} className={`mx-auto ${p.color}`} />
                                            <div className={`text-sm font-bold ${p.color}`}>
                                                {totalActivity}
                                            </div>
                                            <div className="text-xs capitalize text-gray-600">
                                                {getPeriodLabel(p.period)}
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </motion.div>
    );
}
