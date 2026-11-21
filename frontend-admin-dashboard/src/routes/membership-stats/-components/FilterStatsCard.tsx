import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, Users, UserPlus, ArrowsClockwise } from '@phosphor-icons/react';
import { useQueries } from '@tanstack/react-query';
import { fetchMembershipStats, getMembershipStatsQueryKey } from '@/services/membership-stats';
import type { StudentStatsFilter } from '@/types/membership-stats';

interface FilterStatsCardProps {
    requestFilters: Omit<StudentStatsFilter, 'institute_id'>;
    onViewMembers: () => void;
}

export function FilterStatsCard({ requestFilters, onViewMembers }: FilterStatsCardProps) {
    const { t, i18n } = useTranslation('membershipStatsFilterStatsCard');
    // Fetch total, NEW_USER, and RETAINER counts in parallel
    const results = useQueries({
        queries: [
            {
                queryKey: getMembershipStatsQueryKey(0, 1, requestFilters),
                queryFn: () => fetchMembershipStats(0, 1, requestFilters),
                staleTime: 30000,
            },
            {
                queryKey: getMembershipStatsQueryKey(0, 1, { ...requestFilters, user_types: ['NEW_USER' as const] }),
                queryFn: () => fetchMembershipStats(0, 1, { ...requestFilters, user_types: ['NEW_USER'] }),
                staleTime: 30000,
            },
            {
                queryKey: getMembershipStatsQueryKey(0, 1, { ...requestFilters, user_types: ['RETAINER' as const] }),
                queryFn: () => fetchMembershipStats(0, 1, { ...requestFilters, user_types: ['RETAINER'] }),
                staleTime: 30000,
            },
        ],
    });

    const isLoading = results.some((r) => r.isLoading);
    const total = results[0]?.data?.total_elements || 0;
    const newUsers = results[1]?.data?.total_elements || 0;
    const retainers = results[2]?.data?.total_elements || 0;

    return (
        <Card className="border-primary-100 bg-primary-50/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="space-y-1">
                    <CardTitle className="text-base font-semibold text-primary-900">
                        {t('title')}
                    </CardTitle>
                    <p className="text-sm text-primary-600/80">
                        {t('subtitle')}
                    </p>
                </div>
                <div className="rounded-full bg-primary-100 p-2 text-primary-600">
                    <Users size={20} weight="duotone" />
                </div>
            </CardHeader>
            <CardContent>
                <div className="flex items-end justify-between">
                    <div>
                        {isLoading ? (
                            <div className="h-8 w-16 animate-pulse rounded bg-primary-100" />
                        ) : (
                            <div>
                                <div className="flex items-baseline gap-2">
                                    <span className="text-3xl font-bold text-primary-900">
                                        {total.toLocaleString(i18n.language)}
                                    </span>
                                    <span className="text-sm font-medium text-primary-600">
                                        {t('usersFound', { count: total })}
                                    </span>
                                </div>
                                <div className="mt-2 flex items-center gap-4">
                                    <div className="flex items-center gap-1.5">
                                        <UserPlus size={14} className="text-indigo-500" />
                                        <span className="text-sm font-semibold text-indigo-600">{newUsers.toLocaleString(i18n.language)}</span>
                                        <span className="text-xs text-gray-500">{t('new')}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <ArrowsClockwise size={14} className="text-amber-500" />
                                        <span className="text-sm font-semibold text-amber-600">{retainers.toLocaleString(i18n.language)}</span>
                                        <span className="text-xs text-gray-500">{t('retainer')}</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    <Button
                        onClick={onViewMembers}
                        className="gap-2"
                        disabled={isLoading}
                    >
                        {t('viewMembers')}
                        <ArrowRight size={16} />
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
