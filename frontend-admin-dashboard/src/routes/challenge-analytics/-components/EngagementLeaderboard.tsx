import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Trophy,
    Envelope,
    Phone,
    Download,
    CaretLeft,
    CaretRight,
    Funnel,
    X,
} from '@phosphor-icons/react';
import type { LeaderboardResponse } from '@/types/challenge-analytics';

const NO_FIELD_VALUE = '__none__';

export interface LeaderboardFilterField {
    /** Custom field name — matches the key used in user.custom_fields. */
    name: string;
    /** Display label for the dropdown. */
    label: string;
    /** Possible values for this field, parsed from CustomField.config. */
    options: Array<{ value: string; label: string }>;
}

interface EngagementLeaderboardProps {
    data: LeaderboardResponse | undefined;
    isLoading: boolean;
    page: number;
    onPageChange: (page: number) => void;
    /** Available custom fields the user can filter by. Empty = no filter UI. */
    filterFields?: LeaderboardFilterField[];
    selectedFieldName?: string;
    selectedFieldValue?: string;
    onFilterChange?: (fieldName: string, fieldValue: string) => void;
}

const getRankIcon = (rank: number) => {
    switch (rank) {
        case 1:
            return <span className="text-2xl">🥇</span>;
        case 2:
            return <span className="text-2xl">🥈</span>;
        case 3:
            return <span className="text-2xl">🥉</span>;
        default:
            return (
                <span className="flex size-8 items-center justify-center rounded-full bg-gray-100 text-sm font-bold text-gray-600">
                    {rank}
                </span>
            );
    }
};

const getRankColor = (rank: number) => {
    switch (rank) {
        case 1:
            return 'from-yellow-400 to-amber-500';
        case 2:
            return 'from-gray-300 to-gray-400';
        case 3:
            return 'from-amber-600 to-amber-700';
        default:
            return 'from-gray-100 to-gray-200';
    }
};

export function EngagementLeaderboard({
    data,
    isLoading,
    page,
    onPageChange,
    filterFields = [],
    selectedFieldValue = '',
    onFilterChange,
}: EngagementLeaderboardProps) {
    const { t } = useTranslation('challengeAnalyticsEngagementLeaderboard');
    // filterFields[0] is the center field built from connector defaultValuesJson.
    const centerField = filterFields[0] ?? null;

    // Single center dropdown — selecting a value filters the leaderboard instantly.
    const filterControls = centerField && onFilterChange ? (
        <Select
            value={selectedFieldValue || NO_FIELD_VALUE}
            onValueChange={(val) => {
                if (val === NO_FIELD_VALUE) {
                    onFilterChange('', '');
                } else {
                    onFilterChange(centerField.name, val);
                }
            }}
        >
            <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t('allCenters')} />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={NO_FIELD_VALUE}>{t('allCenters')}</SelectItem>
                {centerField.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    ) : null;

    if (isLoading) {
        return (
            <Card className="shadow-sm">
                <CardHeader>
                    <div className="h-6 w-48 animate-pulse rounded bg-gray-200" />
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />
                        ))}
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (!data || !data.leaderboard || data.leaderboard.length === 0) {
        return (
            <Card className="shadow-sm">
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                        <Trophy className="size-5 text-amber-500" weight="fill" />
                        <CardTitle className="text-base font-semibold">
                            {t('title')}
                        </CardTitle>
                    </div>
                    {filterControls}
                </CardHeader>
                <CardContent>
                    <div className="flex h-[200px] items-center justify-center text-gray-500">
                        {selectedFieldValue
                            ? t('emptyStateFiltered', { center: selectedFieldValue })
                            : t('emptyStateDefault')}
                    </div>
                </CardContent>
            </Card>
        );
    }

    const { leaderboard, pagination } = data;

    const exportToCSV = () => {
        const headers = [
            t('csv.rank'),
            t('csv.name'),
            t('csv.email'),
            t('csv.phone'),
            t('csv.center'),
            t('csv.totalMessages'),
            t('csv.engagementScore'),
        ];
        const rows = leaderboard.map((entry) => {
            const cf = entry.user_details?.custom_fields || {};
            const name =
                cf['first name'] && cf['last name']
                    ? `${cf['first name']} ${cf['last name']}`
                    : cf['parent name'] || t('csv.notAvailable');
            return [
                entry.rank,
                name,
                cf['Email'] || cf['alternate email'] || t('csv.notAvailable'),
                entry.phone_number,
                cf['center name'] || t('csv.notAvailable'),
                entry.engagement_metrics.total_messages,
                entry.engagement_metrics.engagement_score,
            ];
        });

        const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `engagement_leaderboard_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    };

    return (
        <Card className="shadow-sm">
            <CardHeader className="pb-2">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                        <div className="rounded-lg bg-amber-100 p-2">
                            <Trophy className="size-5 text-amber-600" weight="fill" />
                        </div>
                        <div>
                            <CardTitle className="text-base font-semibold">
                                {t('title')}
                            </CardTitle>
                            <p className="text-xs text-gray-500">{t('subtitle')}</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {filterControls}
                        <span className="text-sm text-gray-500">
                            {t('totalUsers', { count: pagination.total_users })}
                        </span>
                        <Button variant="outline" size="sm" onClick={exportToCSV} className="gap-2">
                            <Download className="size-4" />
                            {t('exportCsv')}
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {/* Leaderboard Table */}
                <div className="overflow-hidden rounded-lg border">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left font-medium text-gray-700">
                                    {t('table.rank')}
                                </th>
                                <th className="px-4 py-3 text-left font-medium text-gray-700">
                                    {t('table.user')}
                                </th>
                                <th className="px-4 py-3 text-left font-medium text-gray-700">
                                    {t('table.contact')}
                                </th>
                                <th className="px-4 py-3 text-right font-medium text-gray-700">
                                    {t('table.outgoing')}
                                </th>
                                <th className="px-4 py-3 text-right font-medium text-gray-700">
                                    {t('table.incoming')}
                                </th>
                                <th className="px-4 py-3 text-right font-medium text-gray-700">
                                    {t('table.total')}
                                </th>
                                <th className="px-4 py-3 text-right font-medium text-gray-700">
                                    {t('table.score')}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {leaderboard.map((entry) => (
                                <tr key={entry.rank} className="border-t hover:bg-gray-50">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            {getRankIcon(entry.rank)}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div>
                                            <p className="font-medium text-gray-800">
                                                {entry.user_details?.custom_fields?.[
                                                    'first name'
                                                ] &&
                                                entry.user_details?.custom_fields?.['last name']
                                                    ? `${entry.user_details.custom_fields['first name']} ${entry.user_details.custom_fields['last name']}`
                                                    : entry.user_details?.custom_fields?.[
                                                          'parent name'
                                                      ] || t('table.anonymous')}
                                            </p>
                                            {entry.user_details?.custom_fields && (
                                                <p className="text-xs text-gray-500">
                                                    {entry.user_details.custom_fields[
                                                        'children name'
                                                    ] &&
                                                        t('table.childLabel', { name: entry.user_details.custom_fields['children name'] })}
                                                    {entry.user_details.custom_fields[
                                                        'center name'
                                                    ] &&
                                                        ` • ${entry.user_details.custom_fields['center name']}`}
                                                </p>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="space-y-1">
                                            {entry.user_details?.custom_fields?.['Email'] && (
                                                <div className="flex items-center gap-1 text-xs text-gray-600">
                                                    <Envelope className="size-3" />
                                                    <span className="max-w-[150px] truncate">
                                                        {entry.user_details.custom_fields['Email']}
                                                    </span>
                                                </div>
                                            )}
                                            <div className="flex items-center gap-1 text-xs text-gray-600">
                                                <Phone className="size-3" />
                                                <span>
                                                    {entry.user_details?.custom_fields?.['phone'] ||
                                                        entry.phone_number}
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <span className="font-medium text-blue-600">
                                            {entry.engagement_metrics.outgoing_messages}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <span className="font-medium text-emerald-600">
                                            {entry.engagement_metrics.incoming_messages}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right font-medium">
                                        {entry.engagement_metrics.total_messages}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                                            {entry.engagement_metrics.engagement_score}
                                        </span>
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
                            {t('pagination.pageOf', { current: pagination.current_page, total: pagination.total_pages })}
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
