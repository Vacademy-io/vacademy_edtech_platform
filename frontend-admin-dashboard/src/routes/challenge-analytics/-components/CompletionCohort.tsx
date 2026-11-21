import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    GraduationCap,
    Download,
    CaretLeft,
    CaretRight,
    Envelope,
    Calendar,
    User,
    MegaphoneSimple,
} from '@phosphor-icons/react';
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
} from 'recharts';
import type { CompletionCohortResponse, CompletedUser } from '@/types/challenge-analytics';

interface CompletionCohortProps {
    data: CompletionCohortResponse | undefined;
    isLoading: boolean;
    page: number;
    onPageChange: (page: number) => void;
}

export function CompletionCohort({ data, isLoading, page, onPageChange }: CompletionCohortProps) {
    const { t, i18n } = useTranslation('challengeAnalyticsCompletionCohort');
    if (isLoading) {
        return (
            <Card className="shadow-sm">
                <CardHeader>
                    <div className="h-6 w-48 animate-pulse rounded bg-gray-200" />
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />
                        ))}
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (!data || !data.completed_users || data.completed_users.length === 0) {
        return (
            <Card className="shadow-sm">
                <CardHeader className="flex flex-row items-center gap-2">
                    <GraduationCap className="size-5 text-green-500" weight="fill" />
                    <CardTitle className="text-base font-semibold">
                        {t('title')}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex h-[200px] flex-col items-center justify-center text-gray-500">
                        <GraduationCap className="mb-2 size-12 text-gray-300" />
                        <p>{t('emptyState.message')}</p>
                        <p className="text-xs">{t('emptyState.hint')}</p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    const { completion_summary, completed_users, pagination } = data;

    // Group completions by date for timeline
    const completionsByDate = completed_users.reduce(
        (acc, user) => {
            const date = user.completion_date?.split(' ')[0] || 'Unknown';
            if (!acc[date]) acc[date] = [];
            acc[date]?.push(user);
            return acc;
        },
        {} as Record<string, CompletedUser[]>
    );

    const timelineData = Object.entries(completionsByDate)
        .map(([date, users]) => ({
            date,
            completions: users.length,
            formattedDate: new Date(date).toLocaleDateString(i18n.language, {
                month: 'short',
                day: 'numeric',
            }),
        }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Export functionality
    const exportToCSV = () => {
        const headers = [
            t('csv.name'),
            t('csv.email'),
            t('csv.phone'),
            t('csv.completionDate'),
            t('csv.center'),
        ];
        const rows = completed_users.map((user) => [
            user.user_details?.user?.full_name || t('notAvailable'),
            user.user_details?.user?.email || t('notAvailable'),
            user.phone_number,
            user.completion_date,
            user.user_details?.custom_fields?.['center name'] || t('notAvailable'),
        ]);

        const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `completion_cohort_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    };

    return (
        <Card className="shadow-sm">
            <CardHeader className="pb-2">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                        <div className="rounded-lg bg-green-100 p-2">
                            <GraduationCap className="size-5 text-green-600" weight="fill" />
                        </div>
                        <div>
                            <CardTitle className="text-base font-semibold">
                                {t('title')}
                            </CardTitle>
                            <p className="text-xs text-gray-500">{t('subtitle')}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" className="gap-2">
                            <MegaphoneSimple className="size-4" />
                            {t('createCampaign')}
                        </Button>
                        <Button variant="outline" size="sm" onClick={exportToCSV} className="gap-2">
                            <Download className="size-4" />
                            {t('export')}
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {/* Summary Cards */}
                <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                    <div className="rounded-lg bg-gradient-to-br from-green-50 to-emerald-50 p-4">
                        <span className="text-xs font-medium text-gray-500">
                            {t('summary.totalCompleted')}
                        </span>
                        <p className="mt-1 text-2xl font-bold text-green-700">
                            {completion_summary.total_completed_users}
                        </p>
                    </div>
                    <div className="rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
                        <span className="text-xs font-medium text-gray-500">
                            {t('summary.templatesTracked')}
                        </span>
                        <p className="mt-1 text-2xl font-bold text-blue-700">
                            {completion_summary.completion_template_identifiers.length}
                        </p>
                    </div>
                    <div className="rounded-lg bg-gradient-to-br from-purple-50 to-violet-50 p-4">
                        <span className="text-xs font-medium text-gray-500">
                            {t('summary.currentPage')}
                        </span>
                        <p className="mt-1 text-2xl font-bold text-purple-700">
                            {pagination.current_page} / {pagination.total_pages}
                        </p>
                    </div>
                    <div className="rounded-lg bg-gradient-to-br from-amber-50 to-orange-50 p-4">
                        <span className="text-xs font-medium text-gray-500">
                            {t('summary.dateRange')}
                        </span>
                        <p className="mt-1 text-sm font-medium text-amber-700">
                            {completion_summary.date_range.start_date.split(' ')[0]} —{' '}
                            {completion_summary.date_range.end_date.split(' ')[0]}
                        </p>
                    </div>
                </div>

                {/* Completion Timeline Chart */}
                {timelineData.length > 1 && (
                    <div className="mb-6">
                        <h4 className="mb-3 text-sm font-medium text-gray-700">
                            {t('timeline.title')}
                        </h4>
                        <div className="h-[200px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart
                                    data={timelineData}
                                    margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                                >
                                    <defs>
                                        <linearGradient
                                            id="colorCompletions"
                                            x1="0"
                                            y1="0"
                                            x2="0"
                                            y2="1"
                                        >
                                            <stop
                                                offset="5%"
                                                stopColor="#10B981"
                                                stopOpacity={0.3}
                                            />
                                            <stop
                                                offset="95%"
                                                stopColor="#10B981"
                                                stopOpacity={0}
                                            />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="formattedDate" tick={{ fontSize: 11 }} />
                                    <YAxis tick={{ fontSize: 11 }} />
                                    <Tooltip
                                        content={({ active, payload }) => {
                                            if (active && payload && payload.length) {
                                                return (
                                                    <div className="rounded-lg border bg-white px-3 py-2 shadow-lg">
                                                        <p className="font-medium">
                                                            {payload[0]?.payload?.date}
                                                        </p>
                                                        <p className="font-semibold text-green-600">
                                                            {t('timeline.completionsCount', {
                                                                count: Number(
                                                                    payload[0]?.value ?? 0
                                                                ),
                                                            })}
                                                        </p>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="completions"
                                        stroke="#10B981"
                                        strokeWidth={2}
                                        fillOpacity={1}
                                        fill="url(#colorCompletions)"
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                )}

                {/* Templates Used */}
                <div className="mb-4">
                    <h4 className="mb-2 text-sm font-medium text-gray-700">
                        {t('completionTemplates')}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                        {completion_summary.completion_template_identifiers.map(
                            (template, index) => (
                                <span
                                    key={index}
                                    className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700"
                                >
                                    {template}
                                </span>
                            )
                        )}
                    </div>
                </div>

                {/* Completed Users Table */}
                <div className="overflow-hidden rounded-lg border">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-start font-medium text-gray-700">
                                    {t('table.user')}
                                </th>
                                <th className="px-4 py-3 text-start font-medium text-gray-700">
                                    {t('table.contact')}
                                </th>
                                <th className="px-4 py-3 text-start font-medium text-gray-700">
                                    {t('table.center')}
                                </th>
                                <th className="px-4 py-3 text-start font-medium text-gray-700">
                                    {t('table.completed')}
                                </th>
                                <th className="px-4 py-3 text-center font-medium text-gray-700">
                                    {t('table.actions')}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {completed_users.map((user, index) => (
                                <tr
                                    key={`${user.phone_number}-${index}`}
                                    className="border-t hover:bg-gray-50"
                                >
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className="flex size-8 items-center justify-center rounded-full bg-green-100">
                                                <User
                                                    className="size-4 text-green-600"
                                                    weight="fill"
                                                />
                                            </div>
                                            <div>
                                                <p className="font-medium text-gray-800">
                                                    {user.user_details?.user?.full_name ||
                                                        t('anonymous')}
                                                </p>
                                                {user.user_details?.custom_fields?.[
                                                    'parent name'
                                                ] && (
                                                    <p className="text-xs text-gray-500">
                                                        {t('parentLabel', {
                                                            name: user.user_details
                                                                .custom_fields['parent name'],
                                                        })}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="space-y-1">
                                            {user.user_details?.user?.email && (
                                                <div className="flex items-center gap-1 text-xs text-gray-600">
                                                    <Envelope className="size-3" />
                                                    <span className="max-w-[150px] truncate">
                                                        {user.user_details.user.email}
                                                    </span>
                                                </div>
                                            )}
                                            <div className="flex items-center gap-1 text-xs text-gray-600">
                                                <span className="font-mono">
                                                    {user.phone_number}
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                                            {user.user_details?.custom_fields?.['center name'] ||
                                                t('unknown')}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-1 text-sm text-gray-600">
                                            <Calendar className="size-4" />
                                            <span>
                                                {user.completion_date
                                                    ? new Date(
                                                          user.completion_date
                                                      ).toLocaleDateString(i18n.language, {
                                                          month: 'short',
                                                          day: 'numeric',
                                                          year: 'numeric',
                                                      })
                                                    : t('notAvailable')}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <Button variant="ghost" size="sm" className="gap-1 text-xs">
                                            <MegaphoneSimple className="size-3" />
                                            {t('send')}
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {pagination.total_pages > 1 && (
                    <div className="mt-4 flex items-center justify-between">
                        <span className="text-sm text-gray-500">
                            {t('pagination.showing', {
                                shown: completed_users.length,
                                count: pagination.total_users,
                            })}
                        </span>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onPageChange(page - 1)}
                                disabled={page <= 1}
                            >
                                <CaretLeft className="size-4" />
                                {t('pagination.previous')}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onPageChange(page + 1)}
                                disabled={page >= pagination.total_pages}
                            >
                                {t('pagination.next')}
                                <CaretRight className="size-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
