import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { QuickViews, type QuickView } from '@/components/shared/crm-enhance';
import { fetchOnboardingStatusCounts } from '../-services/onboarding-service';

const STATUSES = ['IN_PROGRESS', 'COMPLETED', 'ABANDONED', 'CANCELLED'] as const;
const TONE: Record<(typeof STATUSES)[number], QuickView['tone']> = {
    IN_PROGRESS: 'info',
    COMPLETED: 'success',
    ABANDONED: 'warning',
    CANCELLED: 'neutral',
};

/**
 * Onboarding: a count card per status (for the selected flow) that also sets the
 * page's status filter. All counts come from one grouped request, cached 5 minutes.
 */
export function OnboardingEnhancedHeader({
    instituteId,
    flowId,
    status,
    onStatus,
}: {
    instituteId: string;
    flowId: string | undefined;
    status: string | undefined;
    onStatus: (status: string | undefined) => void;
}) {
    const { t } = useTranslation('crmPages');
    const keys = [undefined, ...STATUSES] as const;
    const { data: counts } = useQuery({
        queryKey: ['onboarding-status-counts', instituteId, flowId ?? null],
        queryFn: () => fetchOnboardingStatusCounts(instituteId, flowId),
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
    const views: QuickView[] = keys.map((s) => ({
        key: s ?? 'all',
        label: t(`onboarding.status.${s ?? 'ALL'}`),
        count: counts ? counts[s ?? 'ALL'] ?? 0 : undefined,
        tone: s ? TONE[s] : 'neutral',
        active: status === s,
        onSelect: () => onStatus(s),
    }));
    return <QuickViews views={views} caption={t('onboarding.caption')} />;
}
