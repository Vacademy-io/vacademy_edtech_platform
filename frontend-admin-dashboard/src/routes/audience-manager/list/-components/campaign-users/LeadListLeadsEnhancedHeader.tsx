import { useTranslation } from 'react-i18next';
import { CheckCircle, Timer, Users } from '@phosphor-icons/react';
import { EnhancedHeader, QuickViews, StatStrip } from '@/components/shared/crm-enhance';
import { useCrmDashboardBlocks } from '@/routes/dashboard/-services/use-crm-blocks';
import type { CrmSummaryBlock, CrmViewsBlock } from '@/routes/dashboard/-services/crm-dashboard';
import { formatMinutes, formatPercent, pctChange } from '@/routes/dashboard/-utils/crm-dashboard';

/**
 * One lead list: 30-day numbers and the list's status counts above its
 * table. Same scope as the table (the caller's own leads in this list).
 */
export function LeadListLeadsEnhancedHeader({ audienceId }: { audienceId: string }) {
    const { t } = useTranslation('crmPages');
    const { pick, isLoading } = useCrmDashboardBlocks(['summary', 'views'], {
        enabled: !!audienceId,
        audienceId,
    });
    if (!audienceId) return null;
    const summary = pick<CrmSummaryBlock>('summary');
    const views = pick<CrmViewsBlock>('views');
    const loading = isLoading && !summary;
    return (
        <EnhancedHeader>
            <StatStrip
                deltaTitle={t('common.vsPrevious')}
                items={[
                    {
                        key: 'new',
                        icon: Users,
                        label: t('recentLeads.stats.newLeads'),
                        value: summary?.new_leads,
                        delta: summary
                            ? pctChange(summary.new_leads, summary.previous_new_leads)
                            : undefined,
                        spark: summary?.daily.map((d) => d.leads),
                        loading,
                    },
                    {
                        key: 'converted',
                        icon: CheckCircle,
                        tint: 'success',
                        label: t('recentLeads.stats.converted'),
                        value: summary?.converted,
                        detail: summary
                            ? t('recentLeads.stats.convertedDetail', {
                                  rate: formatPercent(summary.converted, summary.new_leads),
                              })
                            : undefined,
                        loading,
                    },
                    {
                        key: 'response',
                        icon: Timer,
                        tint: 'info',
                        label: t('recentLeads.stats.firstResponse'),
                        value: summary
                            ? formatMinutes(summary.median_first_response_minutes)
                            : undefined,
                        detail: summary
                            ? t('recentLeads.stats.firstResponseDetail', {
                                  share: formatPercent(summary.contacted, summary.new_leads, 0),
                              })
                            : undefined,
                        loading,
                    },
                ]}
            />
            <QuickViews
                caption={t('leadListLeads.caption')}
                views={[
                    { key: 'all', label: t('recentLeads.views.all'), count: views?.all_leads },
                    { key: 'active', label: t('recentLeads.views.active'), count: views?.active },
                    {
                        key: 'today',
                        label: t('recentLeads.views.newToday'),
                        count: views?.new_today,
                        tone: 'info',
                    },
                    {
                        key: 'unassigned',
                        label: t('recentLeads.views.unassigned'),
                        count: views?.unassigned,
                        tone: 'warning',
                    },
                    {
                        key: 'overdue',
                        label: t('recentLeads.views.overdue'),
                        count: views?.followup_overdue,
                        tone: 'danger',
                    },
                    {
                        key: 'converted',
                        label: t('recentLeads.views.converted'),
                        count: views?.converted,
                        tone: 'success',
                    },
                ]}
            />
        </EnhancedHeader>
    );
}
