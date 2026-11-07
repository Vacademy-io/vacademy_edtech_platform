import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Warning, TrendDown, Lightbulb, ArrowRight, XCircle, CheckCircle } from '@phosphor-icons/react';
import { ResponsiveContainer, FunnelChart, Funnel, LabelList, Tooltip, Cell } from 'recharts';
import { useTranslation } from 'react-i18next';
import type { DailyParticipationResponse, ChurnAlert } from '@/types/challenge-analytics';

interface ChurnAnalysisProps {
    data: DailyParticipationResponse | undefined;
    isLoading: boolean;
}

const FUNNEL_COLORS = ['#10B981', '#22C55E', '#84CC16', '#EAB308', '#F59E0B', '#F97316', '#EF4444'];

export function ChurnAnalysis({ data, isLoading }: ChurnAnalysisProps) {
    const { t } = useTranslation('challengeAnalyticsChurnAnalysis');

    if (isLoading) {
        return (
            <Card className="shadow-sm">
                <CardHeader>
                    <div className="h-6 w-48 animate-pulse rounded bg-gray-200" />
                </CardHeader>
                <CardContent>
                    <div className="h-[250px] animate-pulse rounded bg-gray-100" />
                </CardContent>
            </Card>
        );
    }

    if (!data || !data.daily_participation || !data.daily_participation.days.length) {
        return (
            <Card className="shadow-sm">
                <CardHeader className="flex flex-row items-center gap-2">
                    <TrendDown className="h-5 w-5 text-red-500" weight="fill" />
                    <CardTitle className="text-base font-semibold">{t('title')}</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex h-[200px] items-center justify-center text-gray-500">
                        {t('noData')}
                    </div>
                </CardContent>
            </Card>
        );
    }

    const { days, summary } = data.daily_participation;

    // Analyze churn patterns
    const analyzeChurn = (): ChurnAlert[] => {
        const alerts: ChurnAlert[] = [];

        days.forEach((day, index) => {
            // No outgoing messages
            if (day.outgoing.total_messages === 0) {
                alerts.push({
                    type: 'critical',
                    message: t('alerts.noOutgoingMessages', { dayNumber: day.day_number }),
                    action: t('actions.scheduleContentImmediately'),
                    day_number: day.day_number,
                    day_label: day.day_label,
                });
            }
            // Low response rate
            else if (day.response_rate < 30 && day.outgoing.total_messages > 0) {
                alerts.push({
                    type: 'warning',
                    message: t('alerts.lowResponseRate', {
                        dayNumber: day.day_number,
                        rate: day.response_rate.toFixed(1),
                    }),
                    action: t('actions.reviewAndOptimizeContent'),
                    day_number: day.day_number,
                    day_label: day.day_label,
                });
            }

            // Sudden drop (50%+ decline)
            if (index > 0) {
                const previousDay = days[index - 1];
                if (previousDay && previousDay.response_rate > 0) {
                    const dropPercentage = ((previousDay.response_rate - day.response_rate) / previousDay.response_rate) * 100;
                    if (dropPercentage >= 50) {
                        alerts.push({
                            type: 'urgent',
                            message: t('alerts.suddenDrop', {
                                dropPercentage: dropPercentage.toFixed(0),
                                previousDay: day.day_number - 1,
                                dayNumber: day.day_number,
                            }),
                            action: t('actions.investigateContentChange'),
                            day_number: day.day_number,
                            day_label: day.day_label,
                        });
                    }
                }
            }
        });

        return alerts;
    };

    const alerts = analyzeChurn();
    const criticalAlerts = alerts.filter((a) => a.type === 'critical');
    const urgentAlerts = alerts.filter((a) => a.type === 'urgent');
    const warningAlerts = alerts.filter((a) => a.type === 'warning');

    // Prepare funnel data
    const funnelData = days
        .filter((day) => day.outgoing.unique_users > 0)
        .slice(0, 7) // Show first 7 days for funnel
        .map((day, index) => ({
            name: `Day ${day.day_number}`,
            value: day.outgoing.unique_users,
            label: day.day_label,
            fill: FUNNEL_COLORS[index % FUNNEL_COLORS.length],
        }));

    // Calculate overall churn rate
    const firstDayUsers = days[0]?.outgoing.unique_users || 0;
    const lastDayUsers = days[days.length - 1]?.incoming.unique_users || 0;
    const churnRate = firstDayUsers > 0
        ? (((firstDayUsers - lastDayUsers) / firstDayUsers) * 100).toFixed(1)
        : '0';
    const retentionRate = (100 - parseFloat(churnRate)).toFixed(1);

    // Get recommendations
    const getRecommendations = () => {
        const recommendations: string[] = [];

        if (criticalAlerts.length > 0) {
            recommendations.push(t('recommendations.scheduleAutomatedMessages'));
        }
        if (urgentAlerts.length > 0) {
            recommendations.push(t('recommendations.reviewContentStrategy'));
        }
        if (parseFloat(churnRate) > 50) {
            recommendations.push(t('recommendations.addIncentives'));
        }
        if (summary.overall_response_rate < 50) {
            recommendations.push(t('recommendations.abTestFormats'));
        }
        if (recommendations.length === 0) {
            recommendations.push(t('recommendations.healthyEngagement'));
        }

        return recommendations;
    };

    return (
        <Card className="shadow-sm">
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="rounded-lg bg-red-100 p-2">
                            <TrendDown className="h-5 w-5 text-red-600" weight="fill" />
                        </div>
                        <div>
                            <CardTitle className="text-base font-semibold">{t('title')}</CardTitle>
                            <p className="text-xs text-gray-500">{t('subtitle')}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-center">
                            <span className="text-xs text-gray-500">{t('churnRate')}</span>
                            <p className={`text-lg font-bold ${parseFloat(churnRate) > 50 ? 'text-red-600' : parseFloat(churnRate) > 30 ? 'text-amber-600' : 'text-green-600'}`}>
                                {churnRate}%
                            </p>
                        </div>
                        <div className="text-center">
                            <span className="text-xs text-gray-500">{t('retention')}</span>
                            <p className={`text-lg font-bold ${parseFloat(retentionRate) >= 70 ? 'text-green-600' : parseFloat(retentionRate) >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                                {retentionRate}%
                            </p>
                        </div>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid gap-6 lg:grid-cols-2">
                    {/* Funnel Chart */}
                    <div>
                        <h4 className="mb-3 text-sm font-medium text-gray-700">{t('funnelHeading')}</h4>
                        {funnelData.length > 0 ? (
                            <div className="h-[280px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <FunnelChart>
                                        <Tooltip
                                            content={({ active, payload }) => {
                                                if (active && payload && payload.length) {
                                                    return (
                                                        <div className="rounded-lg border bg-white px-3 py-2 shadow-lg">
                                                            <p className="font-medium">{payload[0]?.payload?.name}</p>
                                                            <p className="text-sm text-gray-600">{payload[0]?.payload?.label}</p>
                                                            <p className="font-semibold text-primary">
                                                                {t('usersTooltip', {
                                                                    count: Number(payload[0]?.value ?? 0),
                                                                })}
                                                            </p>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            }}
                                        />
                                        <Funnel
                                            dataKey="value"
                                            data={funnelData}
                                            isAnimationActive
                                        >
                                            <LabelList
                                                position="right"
                                                fill="#666"
                                                stroke="none"
                                                dataKey="name"
                                                fontSize={11}
                                            />
                                            {funnelData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.fill} />
                                            ))}
                                        </Funnel>
                                    </FunnelChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="flex h-[280px] items-center justify-center text-gray-500">
                                {t('funnelInsufficientData')}
                            </div>
                        )}
                    </div>

                    {/* Alerts & Recommendations */}
                    <div className="space-y-4">
                        {/* Alerts Summary */}
                        <div className="grid grid-cols-3 gap-2">
                            <div className={`rounded-lg p-3 ${criticalAlerts.length > 0 ? 'bg-red-100' : 'bg-gray-50'}`}>
                                <div className="flex items-center gap-2">
                                    <XCircle className={`h-4 w-4 ${criticalAlerts.length > 0 ? 'text-red-600' : 'text-gray-400'}`} weight="fill" />
                                    <span className="text-xs font-medium text-gray-600">{t('critical')}</span>
                                </div>
                                <p className={`mt-1 text-xl font-bold ${criticalAlerts.length > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                    {criticalAlerts.length}
                                </p>
                            </div>
                            <div className={`rounded-lg p-3 ${urgentAlerts.length > 0 ? 'bg-orange-100' : 'bg-gray-50'}`}>
                                <div className="flex items-center gap-2">
                                    <Warning className={`h-4 w-4 ${urgentAlerts.length > 0 ? 'text-orange-600' : 'text-gray-400'}`} weight="fill" />
                                    <span className="text-xs font-medium text-gray-600">{t('urgent')}</span>
                                </div>
                                <p className={`mt-1 text-xl font-bold ${urgentAlerts.length > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                                    {urgentAlerts.length}
                                </p>
                            </div>
                            <div className={`rounded-lg p-3 ${warningAlerts.length > 0 ? 'bg-amber-100' : 'bg-gray-50'}`}>
                                <div className="flex items-center gap-2">
                                    <Warning className={`h-4 w-4 ${warningAlerts.length > 0 ? 'text-amber-600' : 'text-gray-400'}`} weight="fill" />
                                    <span className="text-xs font-medium text-gray-600">{t('warning')}</span>
                                </div>
                                <p className={`mt-1 text-xl font-bold ${warningAlerts.length > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                                    {warningAlerts.length}
                                </p>
                            </div>
                        </div>

                        {/* Alert List */}
                        {alerts.length > 0 ? (
                            <div className="max-h-[180px] space-y-2 overflow-y-auto">
                                {alerts.slice(0, 5).map((alert, index) => (
                                    <div
                                        key={index}
                                        className={`flex items-start gap-3 rounded-lg border p-3 ${
                                            alert.type === 'critical'
                                                ? 'border-red-200 bg-red-50'
                                                : alert.type === 'urgent'
                                                ? 'border-orange-200 bg-orange-50'
                                                : 'border-amber-200 bg-amber-50'
                                        }`}
                                    >
                                        <Warning
                                            className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                                                alert.type === 'critical'
                                                    ? 'text-red-600'
                                                    : alert.type === 'urgent'
                                                    ? 'text-orange-600'
                                                    : 'text-amber-600'
                                            }`}
                                            weight="fill"
                                        />
                                        <div className="flex-1">
                                            <p className="text-sm font-medium text-gray-800">{alert.message}</p>
                                            <p className="mt-0.5 text-xs text-gray-600">{alert.day_label}</p>
                                            <div className="mt-2 flex items-center gap-1 text-xs text-gray-500">
                                                <ArrowRight className="h-3 w-3" />
                                                <span>{alert.action}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 rounded-lg bg-green-50 p-4">
                                <CheckCircle className="h-5 w-5 text-green-600" weight="fill" />
                                <span className="text-sm text-green-700">{t('noCriticalIssues')}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Recommendations */}
                <div className="mt-6 rounded-lg bg-blue-50 p-4">
                    <div className="mb-2 flex items-center gap-2">
                        <Lightbulb className="h-5 w-5 text-blue-600" weight="fill" />
                        <h4 className="font-medium text-blue-800">{t('recommendationsHeading')}</h4>
                    </div>
                    <ul className="space-y-1">
                        {getRecommendations().map((rec, index) => (
                            <li key={index} className="flex items-start gap-2 text-sm text-blue-700">
                                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-400" />
                                {rec}
                            </li>
                        ))}
                    </ul>
                </div>
            </CardContent>
        </Card>
    );
}
