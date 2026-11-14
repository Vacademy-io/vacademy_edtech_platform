import { useTranslation } from 'react-i18next';
import { SavedViews } from './SavedViews';
import { EnhancedHeader, QuickViews, type QuickView } from '@/components/shared/crm-enhance';
import { Skeleton } from '@/components/ui/skeleton';
import { CrmHero } from '@/routes/dashboard/-components/crm/crm-cards';
import { useCrmDashboardBlocks } from '@/routes/dashboard/-services/use-crm-blocks';
import type { CrmSummaryBlock, CrmViewsBlock } from '@/routes/dashboard/-services/crm-dashboard';
import { formatMinutes, formatPercent, isoDay } from '@/routes/dashboard/-utils/crm-dashboard';

const BASE = '/audience-manager/recent-leads';

/**
 * Recent Leads: last-30-day numbers and quick-view count cards above the
 * filters. Counts use the same scope as this list; each card opens the list with the
 * matching filter.
 */
export function RecentLeadsEnhancedHeader() {
    const { t } = useTranslation('crmPages');
    const { pick, isLoading, window } = useCrmDashboardBlocks(['summary', 'views']);
    const summary = pick<CrmSummaryBlock>('summary');
    const views = pick<CrmViewsBlock>('views');
    const today = isoDay(new Date());
    const q = (o: Record<string, string>) => `${BASE}?${new URLSearchParams(o).toString()}`;

    const quick: QuickView[] = [
        {
            key: 'all',
            label: t('recentLeads.views.all'),
            count: views?.all_leads,
            href: q({ range: 'ALL', status: '__ALL_STATUS__' }),
        },
        {
            key: 'active',
            label: t('recentLeads.views.active'),
            count: views?.active,
            href: q({ range: 'ALL', status: '__ACTIVE__' }),
        },
        {
            key: 'today',
            label: t('recentLeads.views.newToday'),
            count: views?.new_today,
            tone: 'info',
            href: q({ range: 'CUSTOM', from: today, to: today, status: '__ALL_STATUS__' }),
        },
        {
            key: 'unassigned',
            label: t('recentLeads.views.unassigned'),
            count: views?.unassigned,
            tone: 'warning',
            href: q({ range: 'ALL', status: '__ALL_STATUS__', counsellor: '__UNASSIGNED__' }),
        },
        {
            key: 'overdue',
            label: t('recentLeads.views.overdue'),
            count: views?.followup_overdue,
            tone: 'danger',
            href: '/audience-manager/follow-ups?bucket=overdue',
        },
        {
            key: 'converted',
            label: t('recentLeads.views.converted'),
            count: views?.converted,
            tone: 'success',
            href: q({ range: 'ALL', status: '__CONVERTED__' }),
        },
    ];

    return (
        <EnhancedHeader>
            {summary ? (
                <CrmHero
                    summary={summary}
                    window={window}
                    rangeDays={30}
                    rangeControl={null}
                    actions={
                        <span className="text-neutral-600">
                            <span className="text-caption">
                                {t('recentLeads.stats.firstResponseDetail', {
                                    share: formatPercent(summary.contacted, summary.new_leads, 0),
                                })}{' '}
                                · {t('recentLeads.stats.firstResponse')}:{' '}
                                {formatMinutes(summary.median_first_response_minutes)}
                            </span>
                        </span>
                    }
                    showContacted
                />
            ) : isLoading ? (
                <Skeleton className="h-52 rounded-xl" />
            ) : null}
            <QuickViews views={quick} caption={t('recentLeads.viewsCaption')} />
            <SavedViews />
        </EnhancedHeader>
    );
}
