import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, ChartLine, Target, TrendUp, ChatCircle, Calendar } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

interface KPICardsProps {
    activeUsers: number;
    totalUsersReached: number;
    totalMessages: number;
    completionRate: number;
    responseRate: number;
    totalDays: number;
    isLoading?: boolean;
}

export function KPICards({
    activeUsers,
    totalUsersReached,
    totalMessages,
    completionRate,
    responseRate,
    totalDays,
    isLoading,
}: KPICardsProps) {
    const { t, i18n } = useTranslation('challengeAnalyticsKPICards');
    const activePercentage =
        totalUsersReached > 0 ? ((activeUsers / totalUsersReached) * 100).toFixed(1) : '0';

    if (isLoading) {
        return (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
                {[...Array(6)].map((_, i) => (
                    <Card key={i} className="animate-pulse">
                        <CardHeader className="pb-2">
                            <div className="h-4 w-20 rounded bg-gray-200" />
                        </CardHeader>
                        <CardContent>
                            <div className="h-8 w-16 rounded bg-gray-200" />
                        </CardContent>
                    </Card>
                ))}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {/* Active Users */}
            <Card className="relative overflow-hidden border-l-4 border-l-emerald-500 bg-gradient-to-br from-emerald-50 to-white shadow-sm transition-all hover:shadow-md">
                <div className="absolute right-2 top-2 rounded-full bg-emerald-100 p-2">
                    <Users className="size-4 text-emerald-600" weight="fill" />
                </div>
                <CardHeader className="pb-1 pt-3">
                    <CardTitle className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        {t('activeUsers')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="pb-3">
                    <div className="text-2xl font-bold text-emerald-700">
                        {activeUsers.toLocaleString(i18n.language)}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                        {activePercentage}%{' '}
                        {t('reachedSuffix', {
                            total: totalUsersReached.toLocaleString(i18n.language),
                        })}
                    </p>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-500"
                            style={{ width: `${Math.min(parseFloat(activePercentage), 100)}%` }}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Total Users Reached */}
            <Card className="relative overflow-hidden border-l-4 border-l-blue-500 bg-gradient-to-br from-blue-50 to-white shadow-sm transition-all hover:shadow-md">
                <div className="absolute right-2 top-2 rounded-full bg-blue-100 p-2">
                    <Target className="size-4 text-blue-600" weight="fill" />
                </div>
                <CardHeader className="pb-1 pt-3">
                    <CardTitle className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        {t('usersReached')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="pb-3">
                    <div className="text-2xl font-bold text-blue-700">
                        {totalUsersReached.toLocaleString(i18n.language)}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{t('totalUniqueUsers')}</p>
                </CardContent>
            </Card>

            {/* Total Messages */}
            <Card className="relative overflow-hidden border-l-4 border-l-purple-500 bg-gradient-to-br from-purple-50 to-white shadow-sm transition-all hover:shadow-md">
                <div className="absolute right-2 top-2 rounded-full bg-purple-100 p-2">
                    <ChatCircle className="size-4 text-purple-600" weight="fill" />
                </div>
                <CardHeader className="pb-1 pt-3">
                    <CardTitle className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        {t('totalMessages')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="pb-3">
                    <div className="text-2xl font-bold text-purple-700">
                        {totalMessages.toLocaleString(i18n.language)}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{t('sentAndReceived')}</p>
                </CardContent>
            </Card>

            {/* Response Rate */}
            <Card className="relative overflow-hidden border-l-4 border-l-amber-500 bg-gradient-to-br from-amber-50 to-white shadow-sm transition-all hover:shadow-md">
                <div className="absolute right-2 top-2 rounded-full bg-amber-100 p-2">
                    <TrendUp className="size-4 text-amber-600" weight="fill" />
                </div>
                <CardHeader className="pb-1 pt-3">
                    <CardTitle className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        {t('responseRate')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="pb-3">
                    <div className="text-2xl font-bold text-amber-700">
                        {responseRate.toFixed(1)}%
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{t('overallEngagement')}</p>
                </CardContent>
            </Card>

            {/* Completion Rate */}
            <Card className="relative overflow-hidden border-l-4 border-l-rose-500 bg-gradient-to-br from-rose-50 to-white shadow-sm transition-all hover:shadow-md">
                <div className="absolute right-2 top-2 rounded-full bg-rose-100 p-2">
                    <ChartLine className="size-4 text-rose-600" weight="fill" />
                </div>
                <CardHeader className="pb-1 pt-3">
                    <CardTitle className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        {t('completionRate')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="pb-3">
                    <div className="text-2xl font-bold text-rose-700">
                        {completionRate.toFixed(1)}%
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{t('challengeCompleted')}</p>
                </CardContent>
            </Card>

            {/* Total Days */}
            <Card className="relative overflow-hidden border-l-4 border-l-indigo-500 bg-gradient-to-br from-indigo-50 to-white shadow-sm transition-all hover:shadow-md">
                <div className="absolute right-2 top-2 rounded-full bg-indigo-100 p-2">
                    <Calendar className="size-4 text-indigo-600" weight="fill" />
                </div>
                <CardHeader className="pb-1 pt-3">
                    <CardTitle className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        {t('totalDays')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="pb-3">
                    <div className="text-2xl font-bold text-indigo-700">{totalDays}</div>
                    <p className="mt-1 text-xs text-gray-500">{t('challengeDuration')}</p>
                </CardContent>
            </Card>
        </div>
    );
}
