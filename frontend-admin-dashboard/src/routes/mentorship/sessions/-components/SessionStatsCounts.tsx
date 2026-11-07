import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { QuickViews } from '@/components/shared/crm-enhance';
import { getRolesForCurrentInstitute } from '@/lib/auth/instituteUtils';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { MENTORSHIP_SESSION_STATS } from '@/constants/urls';

interface SessionStats {
    today: number;
    upcoming: number;
    completed: number;
    cancelled: number;
    no_show: number;
    awaiting_review: number;
}

/**
 * Mentorship Sessions: session counts by stage from the existing stats
 * endpoint (admin-only on the server, so it is only asked for by admins).
 */
export function SessionStatsCounts({ instituteId }: { instituteId: string | null | undefined }) {
    const isAdmin = useMemo(() => getRolesForCurrentInstitute().includes('ADMIN'), []);
    const enabled = isAdmin && !!instituteId;
    const { t } = useTranslation('crmPages');
    const { data } = useQuery({
        queryKey: ['mentorship-session-stats', instituteId],
        queryFn: async () =>
            (
                await authenticatedAxiosInstance.get<SessionStats>(MENTORSHIP_SESSION_STATS, {
                    params: { instituteId },
                })
            ).data,
        enabled,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
    if (!enabled || !data) return null;
    return (
        <QuickViews
            views={[
                {
                    key: 'today',
                    label: t('mentorship.sessions.today'),
                    count: data.today,
                    tone: 'info',
                },
                { key: 'upcoming', label: t('mentorship.sessions.upcoming'), count: data.upcoming },
                {
                    key: 'completed',
                    label: t('mentorship.sessions.completed'),
                    count: data.completed,
                    tone: 'success',
                },
                {
                    key: 'review',
                    label: t('mentorship.sessions.awaitingReview'),
                    count: data.awaiting_review,
                    tone: 'warning',
                },
                {
                    key: 'noShow',
                    label: t('mentorship.sessions.noShow'),
                    count: data.no_show,
                    tone: 'danger',
                },
                {
                    key: 'cancelled',
                    label: t('mentorship.sessions.cancelled'),
                    count: data.cancelled,
                },
            ]}
        />
    );
}
