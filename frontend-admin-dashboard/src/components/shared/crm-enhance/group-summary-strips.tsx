import { useTranslation } from 'react-i18next';
import {
    CheckCircle,
    HourglassMedium,
    PaperPlaneTilt,
    Play,
    Sparkle,
    WarningCircle,
} from '@phosphor-icons/react';
import { StatStrip } from '@/components/shared/crm-enhance';
import { useIsInstituteAdmin } from '@/components/shared/crm-enhance/group-dashboard-shell';
import { formatNumber, formatPercent, pctChange } from '@/routes/dashboard/-utils/crm-dashboard';
import {
    useGroupDashboard,
    type AutomationsSections,
    type EngagementSections,
} from '@/services/group-dashboard';

/**
 * Workflows list (admins): the last 30 days of runs from the Automation
 * Dashboard (same cached request), each card opening that dashboard.
 */
export function AutomationRunsStrip({ className }: { className?: string }) {
    const { t } = useTranslation('crmPages');
    const isAdmin = useIsInstituteAdmin();
    const q = useGroupDashboard<AutomationsSections>('automations', 30, isAdmin);
    if (!isAdmin) return null;
    const tot = q.data?.sections.totals;
    const daily = q.data?.sections.daily ?? [];
    const loading = q.isLoading;
    const href = '/automation/dashboard';
    return (
        <div className={className}>
            <StatStrip
                deltaTitle={t('autoDash.hero.deltaTitle')}
                items={[
                    {
                        key: 'runs',
                        icon: Play,
                        label: t('strips.auto.runs'),
                        value: tot?.runs,
                        delta: tot ? pctChange(tot.runs, tot.prev_runs) : null,
                        spark: daily.map((d) => d.runs),
                        href,
                        loading,
                    },
                    {
                        key: 'success',
                        icon: CheckCircle,
                        tint: 'success',
                        label: t('autoDash.stats.success'),
                        value:
                            tot && tot.runs > 0
                                ? formatPercent(tot.runs - tot.failed, tot.runs)
                                : '—',
                        href,
                        loading,
                    },
                    {
                        key: 'failed',
                        icon: WarningCircle,
                        tint: 'danger',
                        label: t('autoDash.stats.failed'),
                        value: tot?.failed,
                        lowerIsBetter: true,
                        delta: tot ? pctChange(tot.failed, tot.prev_failed) : null,
                        spark: daily.map((d) => d.failed),
                        href,
                        loading,
                    },
                ]}
            />
        </div>
    );
}

/**
 * Engines list (admins): the last 30 days of engine tasks
 * from the Engagement Dashboard (same cached request).
 */
export function EngagementTasksStrip() {
    const { t } = useTranslation('crmPages');
    const isAdmin = useIsInstituteAdmin();
    const q = useGroupDashboard<EngagementSections>('engagement', 30, isAdmin);
    if (!isAdmin) return null;
    const tot = q.data?.sections.totals;
    const daily = q.data?.sections.daily ?? [];
    const loading = q.isLoading;
    const href = '/engagement-engines/dashboard';
    return (
        <StatStrip
            deltaTitle={t('engageDash.hero.deltaTitle')}
            items={[
                {
                    key: 'drafted',
                    icon: Sparkle,
                    tint: 'info',
                    label: t('strips.engage.drafted'),
                    value: tot?.drafted,
                    delta: tot ? pctChange(tot.drafted, tot.prev_drafted) : null,
                    spark: daily.map((d) => d.drafted),
                    href,
                    loading,
                },
                {
                    key: 'completed',
                    icon: PaperPlaneTilt,
                    tint: 'success',
                    label: t('engageDash.stats.completed'),
                    value: tot?.completed,
                    detail: tot ? formatPercent(tot.completed, tot.drafted, 0) : undefined,
                    spark: daily.map((d) => d.completed),
                    href,
                    loading,
                },
                {
                    key: 'waiting',
                    icon: HourglassMedium,
                    tint: 'warning',
                    label: t('engageDash.stats.waiting'),
                    value: tot?.open_now,
                    detail: tot
                        ? t('engageDash.stats.waitingDetail', {
                              total: formatNumber(tot.open_over_day),
                          })
                        : undefined,
                    href: '/engagement-engines/inbox',
                    loading,
                },
            ]}
        />
    );
}
