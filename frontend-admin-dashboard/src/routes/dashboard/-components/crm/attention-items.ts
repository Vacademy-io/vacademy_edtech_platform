import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type {
    CrmCounsellorRow,
    CrmFollowupsBlock,
    CrmListRow,
    CrmSummaryBlock,
} from '../../-services/crm-dashboard';
import { formatNumber, type CrmWindow } from '../../-utils/crm-dashboard';
import { recentLeadsLink, type AttentionItem } from './crm-cards';

/**
 * "Needs attention", worst first: overdue follow-ups, counsellors holding 3+ overdue,
 * new leads nobody contacted, today's load and lists with leads but no conversions.
 * Shared by the CRM Dashboard and the enhanced Sales Dashboard; every number comes
 * from the caller's own lead scope.
 */
export function useAttentionItems({
    followups,
    counsellors,
    summary,
    lists,
    window,
}: {
    followups?: CrmFollowupsBlock;
    counsellors?: CrmCounsellorRow[];
    summary?: CrmSummaryBlock;
    lists?: CrmListRow[];
    window: CrmWindow;
}): AttentionItem[] {
    const { t } = useTranslation('crmDashboard');
    return useMemo<AttentionItem[]>(() => {
        const items: AttentionItem[] = [];
        if (followups && followups.overdue > 0) {
            items.push({
                key: 'overdue',
                tone: 'danger',
                title: t('attention.overdue.title', { total: formatNumber(followups.overdue) }),
                text: t('attention.overdue.text'),
                to: '/audience-manager/follow-ups?bucket=overdue',
                cta: t('attention.open'),
            });
        }
        (counsellors ?? [])
            .filter((c) => c.overdue >= 3)
            .sort((a, b) => b.overdue - a.overdue)
            .slice(0, 2)
            .forEach((c) =>
                items.push({
                    key: `c-${c.owner_id}`,
                    tone: 'danger',
                    title: t('attention.counsellor.title', {
                        name: c.name || '—',
                        count: c.overdue,
                    }),
                    text: t('attention.counsellor.text'),
                    to: '/audience-manager/follow-ups?bucket=overdue',
                    cta: t('attention.open'),
                })
            );
        if (summary) {
            const notContacted = summary.new_leads - summary.contacted;
            if (notContacted > 0) {
                items.push({
                    key: 'notContacted',
                    tone: 'warning',
                    title: t('attention.notContacted.title', { total: formatNumber(notContacted) }),
                    text: t('attention.notContacted.text'),
                    to: recentLeadsLink(window),
                    cta: t('attention.open'),
                });
            }
        }
        if (followups && followups.today > 0) {
            items.push({
                key: 'today',
                tone: 'warning',
                title: t('attention.today.title', { total: formatNumber(followups.today) }),
                text: t('attention.today.text'),
                to: '/audience-manager/follow-ups?bucket=today',
                cta: t('attention.open'),
            });
        }
        (lists ?? [])
            .filter((l) => l.leads >= 20 && l.converted === 0)
            .slice(0, 2)
            .forEach((l) =>
                items.push({
                    key: `l-${l.audience_id}`,
                    tone: 'info',
                    title: t('attention.coldList.title', { name: l.name || '—' }),
                    text: t('attention.coldList.text', { total: formatNumber(l.leads) }),
                    to: '/audience-manager/list',
                    cta: t('attention.open'),
                })
            );
        return items.slice(0, 6);
    }, [followups, counsellors, summary, lists, window, t]);
}
