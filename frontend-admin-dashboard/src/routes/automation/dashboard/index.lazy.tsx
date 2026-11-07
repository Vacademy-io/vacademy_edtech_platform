import { useMemo, useState } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import type { ColumnDef } from '@tanstack/react-table';
import {
    CheckCircle,
    FlowArrow,
    Lightning,
    Play,
    Plus,
    Trophy,
    WarningCircle,
    XCircle,
} from '@phosphor-icons/react';
import { MyTable } from '@/components/design-system/table';
import { InsightStrip, StatStrip, type Insight } from '@/components/shared/crm-enhance';
import { GroupHero } from '@/components/shared/crm-enhance/group-hero';
import {
    GroupDashboardShell,
    staticTableData,
    toDate,
    useIsInstituteAdmin,
} from '@/components/shared/crm-enhance/group-dashboard-shell';
import { CrmLink, Meter } from '@/routes/dashboard/-components/crm/crm-cards';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { formatNumber, formatPercent, pctChange } from '@/routes/dashboard/-utils/crm-dashboard';
import {
    useGroupDashboard,
    type AutomationsSections,
    type GroupRangeDays,
} from '@/services/group-dashboard';

export const Route = createLazyFileRoute('/automation/dashboard/')({
    component: AutomationDashboardPage,
});

type WorkflowRow = AutomationsSections['workflows'][number];

const LINK_BTN =
    'inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 font-medium text-neutral-700 hover:border-primary-300 hover:text-primary-600';
const LINK_PRIMARY =
    'inline-flex items-center gap-1.5 rounded-md bg-primary-500 px-3 py-1.5 font-medium text-white hover:bg-primary-600';

/**
 * Automation Dashboard: are the institute's workflows running, and which ones fail.
 * Counts every workflow run in the period (whole institute), so admins only.
 */
function AutomationDashboardPage() {
    const { t } = useTranslation('crmPages');
    const isAdmin = useIsInstituteAdmin();
    const [days, setDays] = useState<GroupRangeDays>(30);
    const q = useGroupDashboard<AutomationsSections>('automations', days, isAdmin);
    const tot = q.data?.sections.totals;
    const daily = q.data?.sections.daily ?? [];
    const workflows = useMemo(() => q.data?.sections.workflows ?? [], [q.data]);
    const failing = useMemo(
        () =>
            workflows
                .filter((w) => w.failed > 0)
                .sort((a, b) => b.failed / b.runs - a.failed / a.runs)
                .slice(0, 8),
        [workflows]
    );
    const top = workflows.slice(0, 8);
    const topMax = Math.max(1, ...top.map((w) => w.runs));

    const success = tot && tot.runs > 0 ? formatPercent(tot.runs - tot.failed, tot.runs) : '—';
    const insights: Insight[] = [];
    if (tot) {
        if (failing[0]) {
            insights.push({
                key: 'worst',
                tone: 'danger',
                title: t('autoDash.insights.worst.title', {
                    name: failing[0].name,
                    total: formatNumber(failing[0].failed),
                }),
                text: failing[0].last_error || t('autoDash.insights.worst.text'),
                href: `/workflow/${failing[0].workflow_id}`,
            });
        } else if (tot.runs > 0) {
            insights.push({
                key: 'clean',
                tone: 'success',
                title: t('autoDash.insights.clean.title'),
                text: t('autoDash.insights.clean.text', { total: formatNumber(tot.runs) }),
            });
        }
        const idle = tot.active_workflows - tot.workflows_ran;
        if (idle > 0) {
            insights.push({
                key: 'idle',
                tone: 'warning',
                title: t('autoDash.insights.idle.title', { total: idle }),
                text: t('autoDash.insights.idle.text', { days }),
                href: '/workflow/list',
            });
        }
        if (top[0] && tot.runs > 0) {
            insights.push({
                key: 'busiest',
                tone: 'info',
                title: t('autoDash.insights.busiest.title', { name: top[0].name }),
                text: t('autoDash.insights.busiest.text', {
                    share: formatPercent(top[0].runs, tot.runs, 0),
                }),
                href: `/workflow/${top[0].workflow_id}`,
            });
        }
    }

    const columns = useMemo<ColumnDef<WorkflowRow>[]>(
        () => [
            {
                id: 'name',
                header: t('autoDash.failing.col.workflow'),
                size: 280,
                cell: ({ row }) => (
                    <CrmLink
                        href={`/workflow/${row.original.workflow_id}`}
                        className="block min-w-0 hover:text-primary-600"
                    >
                        <span className="block truncate font-semibold text-neutral-900">
                            <span className="text-caption">{row.original.name}</span>
                        </span>
                        <span
                            className="block truncate text-neutral-500"
                            title={row.original.last_error ?? ''}
                        >
                            <span className="text-caption">
                                {row.original.last_error || t('autoDash.failing.noError')}
                            </span>
                        </span>
                    </CrmLink>
                ),
            },
            {
                id: 'failed',
                header: t('autoDash.failing.col.failed'),
                size: 140,
                cell: ({ row }) => {
                    const last = toDate(row.original.last_failed_at);
                    return (
                        <span className="block">
                            <span className="block font-semibold text-danger-600">
                                <span className="text-caption">
                                    {t('autoDash.failing.ofRuns', {
                                        failed: formatNumber(row.original.failed),
                                        runs: formatNumber(row.original.runs),
                                    })}
                                </span>
                            </span>
                            {last && (
                                <span className="block text-neutral-500">
                                    <span className="text-caption">
                                        {formatDistanceToNow(last, { addSuffix: true })}
                                    </span>
                                </span>
                            )}
                        </span>
                    );
                },
            },
            {
                id: 'rate',
                header: t('autoDash.failing.col.rate'),
                size: 90,
                cell: ({ row }) => (
                    <span className="inline-flex rounded-full bg-danger-50 px-2 py-0.5 font-semibold text-danger-600">
                        <span className="text-caption">
                            {formatPercent(row.original.failed, row.original.runs, 0)}
                        </span>
                    </span>
                ),
            },
        ],
        [t]
    );

    return (
        <GroupDashboardShell
            title={t('autoDash.title')}
            subtitle={t('autoDash.subtitle')}
            isAdmin={isAdmin}
            isLoading={q.isLoading}
            isError={q.isError}
            actions={
                <>
                    <CrmLink href="/workflow/list" className={LINK_BTN}>
                        <FlowArrow size={14} />
                        <span className="text-caption">{t('autoDash.allWorkflows')}</span>
                    </CrmLink>
                    <CrmLink href="/workflow/create" className={LINK_PRIMARY}>
                        <Plus size={14} />
                        <span className="text-caption">{t('autoDash.create')}</span>
                    </CrmLink>
                </>
            }
        >
            {tot && (
                <>
                    <GroupHero
                        icon={Lightning}
                        eyebrow={t('autoDash.hero.eyebrow', { days })}
                        value={formatNumber(tot.runs)}
                        unit={t('autoDash.hero.unit')}
                        delta={pctChange(tot.runs, tot.prev_runs)}
                        deltaTitle={t('autoDash.hero.deltaTitle')}
                        sub={t('autoDash.hero.sub', {
                            success,
                            failed: formatNumber(tot.failed),
                            workflows: formatNumber(tot.workflows_ran),
                        })}
                        compare={t('autoDash.hero.compare', {
                            days,
                            total: formatNumber(tot.prev_runs),
                        })}
                        days={daily.map((d) => d.day)}
                        series={[
                            {
                                key: 'runs',
                                label: t('autoDash.hero.runs'),
                                tint: 'primary',
                                values: daily.map((d) => d.runs),
                            },
                            {
                                key: 'failed',
                                label: t('autoDash.hero.failed'),
                                tint: 'danger',
                                values: daily.map((d) => d.failed),
                            },
                        ]}
                        range={days}
                        onRange={setDays}
                        fromDay={q.data?.from_day}
                        toDay={q.data?.to_day}
                    />
                    <StatStrip
                        deltaTitle={t('autoDash.hero.deltaTitle')}
                        items={[
                            {
                                key: 'runs',
                                icon: Play,
                                label: t('autoDash.stats.runs'),
                                value: tot.runs,
                                delta: pctChange(tot.runs, tot.prev_runs),
                                detail: t('autoDash.stats.runsDetail', {
                                    total: formatNumber(Math.round(tot.runs / days)),
                                }),
                                spark: daily.map((d) => d.runs),
                            },
                            {
                                key: 'success',
                                icon: CheckCircle,
                                tint: 'success',
                                label: t('autoDash.stats.success'),
                                value: success,
                                detail: t('autoDash.stats.successDetail'),
                            },
                            {
                                key: 'failed',
                                icon: WarningCircle,
                                tint: 'danger',
                                label: t('autoDash.stats.failed'),
                                value: tot.failed,
                                delta: pctChange(tot.failed, tot.prev_failed),
                                lowerIsBetter: true,
                                detail: t('autoDash.stats.failedDetail', {
                                    total: failing.length,
                                }),
                                spark: daily.map((d) => d.failed),
                            },
                            {
                                key: 'active',
                                icon: FlowArrow,
                                tint: 'info',
                                label: t('autoDash.stats.active'),
                                value: tot.active_workflows,
                                detail: t('autoDash.stats.activeDetail', {
                                    total: formatNumber(tot.total_workflows),
                                }),
                                href: '/workflow/list',
                            },
                        ]}
                    />
                    <InsightStrip insights={insights} />
                    <div className="grid gap-4 xl:grid-cols-2">
                        <SectionCard
                            icon={XCircle}
                            title={t('autoDash.failing.title')}
                            subtitle={t('autoDash.failing.subtitle')}
                        >
                            {failing.length === 0 ? (
                                <EmptyChart text={t('autoDash.failing.empty')} />
                            ) : (
                                <MyTable<WorkflowRow>
                                    data={staticTableData(failing)}
                                    columns={columns}
                                    isLoading={false}
                                    error={null}
                                    currentPage={0}
                                    enableColumnResizing={false}
                                    enableColumnPinning={false}
                                    scrollable
                                />
                            )}
                        </SectionCard>
                        <SectionCard
                            icon={Trophy}
                            title={t('autoDash.top.title')}
                            subtitle={t('autoDash.top.subtitle')}
                        >
                            {top.length === 0 ? (
                                <EmptyChart text={t('autoDash.top.empty')} />
                            ) : (
                                <div className="space-y-2.5">
                                    {top.map((w) => (
                                        <CrmLink
                                            key={w.workflow_id}
                                            href={`/workflow/${w.workflow_id}`}
                                            className="grid grid-cols-12 items-center gap-3 rounded-md hover:bg-neutral-50"
                                        >
                                            <span className="col-span-5 min-w-0">
                                                <span
                                                    className="block truncate font-medium text-neutral-800"
                                                    title={w.name}
                                                >
                                                    <span className="text-caption">{w.name}</span>
                                                </span>
                                                <span className="block text-neutral-500">
                                                    <span className="text-caption">
                                                        {t('autoDash.top.success', {
                                                            rate: formatPercent(
                                                                w.runs - w.failed,
                                                                w.runs
                                                            ),
                                                        })}
                                                    </span>
                                                </span>
                                            </span>
                                            <span className="col-span-5">
                                                <Meter value={w.runs} max={topMax} tone="primary" />
                                            </span>
                                            <span className="col-span-2 text-right font-semibold tabular-nums text-neutral-900">
                                                <span className="text-caption">
                                                    {formatNumber(w.runs)}
                                                </span>
                                            </span>
                                        </CrmLink>
                                    ))}
                                </div>
                            )}
                        </SectionCard>
                    </div>
                    <p className="text-neutral-500">
                        <span className="text-caption">{t('autoDash.foot')}</span>
                    </p>
                </>
            )}
        </GroupDashboardShell>
    );
}
