import { useTranslation } from 'react-i18next';
import { QuickViews } from '@/components/shared/crm-enhance';
import type { SessionsResponse } from '@/types/study-library/session-types';

export type SessionStatusView = 'all' | 'active' | 'inactive';

/**
 * Sessions: session and batch counts from the list the page already loaded.
 * The three session counts double as the page's status filter.
 */
export function SessionsEnhancedCounts({
    sessions,
    status,
    onStatus,
}: {
    sessions: SessionsResponse | undefined;
    status: SessionStatusView;
    onStatus: (status: SessionStatusView) => void;
}) {
    const { t } = useTranslation('crmPages');
    if (!sessions?.length) return null;
    const active = sessions.filter((s) => s.session.status === 'ACTIVE').length;
    const batches = sessions.flatMap((s) => s.packages.flatMap((p) => p.level));
    const activeBatches = batches.filter((b) => b.package_session_status === 'ACTIVE').length;
    const courses = new Set(sessions.flatMap((s) => s.packages.map((p) => p.package_dto.id))).size;
    return (
        <QuickViews
            views={[
                {
                    key: 'all',
                    label: t('sessions.all'),
                    count: sessions.length,
                    active: status === 'all',
                    onSelect: () => onStatus('all'),
                },
                {
                    key: 'active',
                    label: t('sessions.active'),
                    count: active,
                    tone: 'success',
                    active: status === 'active',
                    onSelect: () => onStatus('active'),
                },
                {
                    key: 'inactive',
                    label: t('sessions.inactive'),
                    count: sessions.length - active,
                    active: status === 'inactive',
                    onSelect: () => onStatus('inactive'),
                },
                { key: 'courses', label: t('sessions.courses'), count: courses, tone: 'info' },
                {
                    key: 'batches',
                    label: t('sessions.batches'),
                    count: activeBatches,
                    tone: 'info',
                },
            ]}
        />
    );
}
