import { useTranslation } from 'react-i18next';
import { ChatCircleText, Star, UserMinus, UsersThree } from '@phosphor-icons/react';
import {
    EnhancedHeader,
    InsightStrip,
    StatStrip,
    type Insight,
} from '@/components/shared/crm-enhance';
import type { WorkbenchCounsellor } from '../-services/counsellor-workbench-services';

/**
 * Counsellors: team numbers and who needs a look, computed from the
 * counsellor list this page already loads — no extra request, same scope.
 */
export function CounsellorsEnhancedHeader({ counsellors }: { counsellors: WorkbenchCounsellor[] }) {
    const { t } = useTranslation('crmPages');
    if (counsellors.length === 0) return null;

    const name = (c: WorkbenchCounsellor) => c.full_name || c.email || '—';
    const active = counsellors.filter((c) => c.is_active);
    const inactiveWithLeads = counsellors.filter((c) => !c.is_active && c.open_leads_count > 0);
    const openLeads = counsellors.reduce((s, c) => s + c.open_leads_count, 0);
    const rated = counsellors.filter((c) => c.rating !== null && c.rating !== undefined);
    const avgRating = rated.length
        ? rated.reduce((s, c) => s + (c.rating ?? 0), 0) / rated.length
        : null;
    const heaviest = [...active].sort((a, b) => b.open_leads_count - a.open_leads_count)[0];
    const avgLoad = active.length ? openLeads / active.length : 0;
    const topRated = [...rated].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];

    const insights: Insight[] = [];
    if (inactiveWithLeads.length > 0) {
        insights.push({
            key: 'inactive',
            tone: 'danger',
            title: t('counsellors.insights.inactive.title', { total: inactiveWithLeads.length }),
            text: t('counsellors.insights.inactive.text', {
                names: inactiveWithLeads.slice(0, 2).map(name).join(', '),
                total: inactiveWithLeads.reduce((s, c) => s + c.open_leads_count, 0),
            }),
        });
    }
    if (heaviest && avgLoad > 0 && heaviest.open_leads_count >= avgLoad * 1.5) {
        insights.push({
            key: 'heavy',
            tone: 'warning',
            title: t('counsellors.insights.heavy.title', { name: name(heaviest) }),
            text: t('counsellors.insights.heavy.text', {
                total: heaviest.open_leads_count,
                avg: Math.round(avgLoad),
            }),
        });
    }
    if (topRated && (topRated.rating ?? 0) > 0) {
        insights.push({
            key: 'top',
            tone: 'success',
            title: t('counsellors.insights.top.title', { name: name(topRated) }),
            text: t('counsellors.insights.top.text', { rating: (topRated.rating ?? 0).toFixed(1) }),
        });
    }

    return (
        <EnhancedHeader>
            <StatStrip
                items={[
                    {
                        key: 'team',
                        icon: UsersThree,
                        label: t('counsellors.stats.team'),
                        value: counsellors.length,
                        detail: t('counsellors.stats.teamDetail', { total: active.length }),
                    },
                    {
                        key: 'load',
                        icon: ChatCircleText,
                        tint: 'info',
                        label: t('counsellors.stats.openLeads'),
                        value: openLeads,
                        detail: t('counsellors.stats.openLeadsDetail', {
                            avg: Math.round(avgLoad),
                        }),
                    },
                    {
                        key: 'inactive',
                        icon: UserMinus,
                        tint: inactiveWithLeads.length > 0 ? 'danger' : 'primary',
                        label: t('counsellors.stats.inactiveWithLeads'),
                        value: inactiveWithLeads.length,
                        detail: t('counsellors.stats.inactiveWithLeadsDetail'),
                    },
                    {
                        key: 'rating',
                        icon: Star,
                        tint: 'warning',
                        label: t('counsellors.stats.rating'),
                        value: avgRating === null ? null : avgRating.toFixed(1),
                        detail: t('counsellors.stats.ratingDetail', { total: rated.length }),
                    },
                ]}
            />
            <InsightStrip insights={insights} />
        </EnhancedHeader>
    );
}
