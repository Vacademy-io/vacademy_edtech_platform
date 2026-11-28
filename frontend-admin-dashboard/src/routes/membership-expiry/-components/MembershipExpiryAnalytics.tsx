import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useMembershipExpiryAnalytics } from '../-hooks/useMembershipExpiryAnalytics';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { ClockCounterClockwise, Warning } from '@phosphor-icons/react';
import type { MembershipStatus } from '@/types/membership-expiry';

interface Props {
    packageSessionIds: string[] | undefined;
    onCardClick?: (range: { start: Date; end: Date; status: MembershipStatus }) => void;
}

export function MembershipExpiryAnalytics({ packageSessionIds, onCardClick }: Props) {
    const { t } = useTranslation('membershipExpiryMembershipExpiryAnalytics');
    const { stats, dateRanges, isLoading } = useMembershipExpiryAnalytics(packageSessionIds);

    if (isLoading) {
        return <div className="flex h-32 items-center justify-center"><DashboardLoader /></div>;
    }

    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card
                className="cursor-pointer border-l-4 border-l-red-500 shadow-sm transition-all hover:bg-gray-50"
                onClick={() => onCardClick?.(dateRanges.expired)}
            >
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500">{t('recentlyExpired')}</CardTitle>
                    <ClockCounterClockwise className="h-5 w-5 text-red-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-red-600">{stats.recentlyExpired}</div>
                    <p className="text-xs text-gray-500">{t('membershipsEnded')}</p>
                </CardContent>
            </Card>

            <Card
                className="cursor-pointer border-l-4 border-l-amber-500 shadow-sm transition-all hover:bg-gray-50"
                onClick={() => onCardClick?.(dateRanges.expiring)}
            >
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-gray-500">{t('expiringSoon')}</CardTitle>
                    <Warning className="h-5 w-5 text-amber-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-amber-600">{stats.expiringSoon}</div>
                    <p className="text-xs text-gray-500">{t('membershipsExpiring')}</p>
                </CardContent>
            </Card>
        </div>
    );
}
