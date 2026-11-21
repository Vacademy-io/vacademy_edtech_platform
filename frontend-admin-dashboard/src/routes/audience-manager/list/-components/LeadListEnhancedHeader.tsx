import { useTranslation } from 'react-i18next';
import { CheckCircle, UserMinus, Users, WarningCircle } from '@phosphor-icons/react';
import {
    EnhancedHeader,
    InsightStrip,
    StatStrip,
    type Insight,
} from '@/components/shared/crm-enhance';
import { useCrmDashboardBlocks } from '@/routes/dashboard/-services/use-crm-blocks';
import { LEAD_LIST_BLOCKS } from './lead-list-blocks';
import type {
    CrmFollowupsBlock,
    CrmListRow,
    CrmSummaryBlock,
    CrmViewsBlock,
} from '@/routes/dashboard/-services/crm-dashboard';
import { formatNumber, formatPercent, pctChange } from '@/routes/dashboard/-utils/crm-dashboard';

const RECENT = '/audience-manager/recent-leads';

/**
 * Lead List: 30-day lead numbers and list highlights above the list cards.
 * Same scope as the leads list; the list cards themselves are unchanged.
 */
export function LeadListEnhancedHeader() {
    const { t } = useTranslation('crmPages');
    const { pick, isLoading, window } = useCrmDashboardBlocks(LEAD_LIST_BLOCKS);
    const summary = pick<CrmSummaryBlock>('summary');
    const followups = pick<CrmFollowupsBlock>('followups');
    const views = pick<CrmViewsBlock>('views');
    const lists = pick<CrmListRow[]>('lists') ?? [];
    const loading = isLoading && !summary;

    const insights: Insight[] = [];
    const rated = lists.filter((l) => l.leads >= 20);
    const best = [...rated].sort((a, b) => b.converted / b.leads - a.converted / a.leads)[0];
    if (best && best.converted > 0) {
        insights.push({
            key: 'best',
            tone: 'success',
            title: t('leadList.insights.best.title', { name: best.name || '—' }),
            text: t('leadList.insights.best.text', {
                rate: formatPercent(best.converted, best.leads),
                total: formatNumber(best.leads),
            }),
        });
    }
    const busiest = lists[0];
    if (busiest && busiest.leads > 0) {
        insights.push({
            key: 'busiest',
            tone: 'info',
            title: t('leadList.insights.busiest.title', { name: busiest.name || '—' }),
            text: t('leadList.insights.busiest.text', {
                total: formatNumber(busiest.leads),
                share: formatPercent(busiest.contacted, busiest.leads, 0),
            }),
        });
    }
    const cold = rated.find((l) => l.converted === 0);
    if (cold) {
        insights.push({
            key: 'cold',
            tone: 'warning',
            title: t('leadList.insights.cold.title', { name: cold.name || '—' }),
            text: t('leadList.insights.cold.text', { total: formatNumber(cold.leads) }),
        });
    }
    if (views && views.unassigned > 0) {
        insights.push({
            key: 'unassigned',
            tone: 'danger',
            title: t('leadList.insights.unassigned.title', {
                total: formatNumber(views.unassigned),
            }),
            text: t('leadList.insights.unassigned.text'),
            href: `${RECENT}?range=ALL&status=__ALL_STATUS__&counsellor=__UNASSIGNED__`,
        });
    }

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
                        href: `${RECENT}?range=CUSTOM&from=${window.fromDay}&to=${window.toDay}`,
                        loading,
                    },
                    {
                        key: 'converted',
                        icon: CheckCircle,
                        tint: 'success',
                        label: t('recentLeads.stats.converted'),
                        value: summary?.converted,
                        delta: summary
                            ? pctChange(summary.converted, summary.previous_converted)
                            : undefined,
                        detail: summary
                            ? t('recentLeads.stats.convertedDetail', {
                                  rate: formatPercent(summary.converted, summary.new_leads),
                              })
                            : undefined,
                        loading,
                    },
                    {
                        key: 'overdue',
                        icon: WarningCircle,
                        tint: 'danger',
                        label: t('recentLeads.views.overdue'),
                        value: followups?.overdue,
                        detail: followups
                            ? t('leadList.dueToday', { total: formatNumber(followups.today) })
                            : undefined,
                        href: '/audience-manager/follow-ups?bucket=overdue',
                        loading: isLoading && !followups,
                    },
                    {
                        key: 'unassigned',
                        icon: UserMinus,
                        tint: 'warning',
                        label: t('recentLeads.views.unassigned'),
                        value: views?.unassigned,
                        detail: t('leadList.unassignedDetail'),
                        href: `${RECENT}?range=ALL&status=__ALL_STATUS__&counsellor=__UNASSIGNED__`,
                        loading: isLoading && !views,
                    },
                ]}
            />
            <InsightStrip insights={insights} />
        </EnhancedHeader>
    );
}
