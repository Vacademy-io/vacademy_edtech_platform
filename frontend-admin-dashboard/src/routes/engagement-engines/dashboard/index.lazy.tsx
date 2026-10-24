import { useMemo, useState } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import {
    HourglassMedium,
    Lightning,
    PaperPlaneTilt,
    Sparkle,
    Tray,
    UsersThree,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyTable } from '@/components/design-system/table';
import { InsightStrip, StatStrip, type Insight } from '@/components/shared/crm-enhance';
import { GroupHero } from '@/components/shared/crm-enhance/group-hero';
import {
    GroupDashboardShell,
    staticTableData,
    useIsInstituteAdmin,
} from '@/components/shared/crm-enhance/group-dashboard-shell';
import { CrmLink } from '@/routes/dashboard/-components/crm/crm-cards';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import {
    formatNumber,
    formatPercent,
    humanizeKey,
    pctChange,
} from '@/routes/dashboard/-utils/crm-dashboard';
import {
    useGroupDashboard,
    type EngagementSections,
    type GroupRangeDays,
} from '@/services/group-dashboard';
import { cn } from '@/lib/utils';

export const Route = createLazyFileRoute('/engagement-engines/dashboard/')({
    component: EngagementDashboardPage,
});

type EngineRow = EngagementSections['engines'][number];

const LINK_BTN =
    'inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 font-medium text-neutral-700 hover:border-primary-300 hover:text-primary-600';

const STATUS_TONE: Record<string, string> = {
    ACTIVE: 'bg-success-50 text-success-700',
    DRY_RUN: 'bg-info-50 text-info-700',
    TEMPLATES_PENDING: 'bg-warning-50 text-warning-700',
    DRAFT: 'bg-neutral-100 text-neutral-600',
    PAUSED: 'bg-neutral-100 text-neutral-600',
};

/**
 * Engagement Dashboard: what the AI engagement engines drafted and sent, and what is
 * waiting on the team. Whole-institute numbers, so admins only.
 */
function EngagementDashboardPage() {
    const { t } = useTranslation('crmPages');
    const isAdmin = useIsInstituteAdmin();
    const [days, setDays] = useState<GroupRangeDays>(30);
    const q = useGroupDashboard<EngagementSections>('engagement', days, isAdmin);
    const tot = q.data?.sections.totals;
    const daily = q.data?.sections.daily ?? [];
    const engines = useMemo(() => q.data?.sections.engines ?? [], [q.data]);
    const active = engines.filter((e) => e.status === 'ACTIVE').length;
    const members = engines.reduce((a, e) => a + e.members, 0);
    const holdout = engines.reduce((a, e) => a + e.holdout, 0);

    const insights: Insight[] = [];
    if (tot) {
        if (tot.open_over_day > 0) {
            insights.push({
                key: 'waiting',
                tone: 'danger',
                title: t('engageDash.insights.waiting.title', {
                    total: formatNumber(tot.open_over_day),
                }),
                text: t('engageDash.insights.waiting.text'),
                href: '/engagement-engines/inbox',
            });
        }
        const stuck = engines.filter((e) => e.status === 'TEMPLATES_PENDING');
        if (stuck[0]) {
            insights.push({
                key: 'templates',
                tone: 'warning',
                title: t('engageDash.insights.templates.title', { name: stuck[0].name }),
                text: t('engageDash.insights.templates.text', {
                    total: formatNumber(stuck[0].members),
                }),
                href: `/engagement-engines/${stuck[0].engine_id}`,
            });
        }
        if (tot.failed > 0) {
            insights.push({
                key: 'failed',
                tone: 'warning',
                title: t('engageDash.insights.failed.title', { total: formatNumber(tot.failed) }),
                text: t('engageDash.insights.failed.text'),
                href: '/engagement-engines/inbox',
            });
        }
        if (tot.drafted > 0) {
            insights.push({
                key: 'completion',
                tone: 'success',
                title: t('engageDash.insights.completion.title', {
                    rate: formatPercent(tot.completed, tot.drafted, 0),
                }),
                text: t('engageDash.insights.completion.text', {
                    expired: formatNumber(tot.expired),
                }),
            });
        }
    }

    const columns = useMemo<ColumnDef<EngineRow>[]>(
        () => [
            {
                id: 'name',
                header: t('engageDash.engines.col.engine'),
                size: 240,
                cell: ({ row }) => (
                    <CrmLink
                        href={`/engagement-engines/${row.original.engine_id}`}
                        className="flex min-w-0 items-center gap-2 hover:text-primary-600"
                    >
                        <span className="truncate font-semibold text-neutral-900">
                            <span className="text-caption">{row.original.name}</span>
                        </span>
                        <span
                            className={cn(
                                'shrink-0 rounded-full px-2 py-0.5 font-medium',
                                STATUS_TONE[row.original.status] ??
                                    'bg-neutral-100 text-neutral-600'
                            )}
                        >
                            <span className="text-caption">{humanizeKey(row.original.status)}</span>
                        </span>
                    </CrmLink>
                ),
            },
            {
                id: 'members',
                header: t('engageDash.engines.col.members'),
                size: 110,
                cell: ({ row }) => (
                    <span className="tabular-nums text-neutral-800">
                        <span className="text-caption">
                            {formatNumber(row.original.members)}
                            {row.original.holdout > 0 &&
                                ` · ${t('engageDash.engines.holdout', {
                                    total: formatNumber(row.original.holdout),
                                })}`}
                        </span>
                    </span>
                ),
            },
            {
                id: 'drafted',
                header: t('engageDash.engines.col.drafted'),
                size: 90,
                cell: ({ row }) => (
                    <span className="tabular-nums text-neutral-800">
                        <span className="text-caption">{formatNumber(row.original.drafted)}</span>
                    </span>
                ),
            },
            {
                id: 'completed',
                header: t('engageDash.engines.col.completed'),
                size: 110,
                cell: ({ row }) => (
                    <span className="tabular-nums text-neutral-800">
                        <span className="text-caption">
                            {formatNumber(row.original.completed)}
                            {row.original.drafted > 0 &&
                                ` · ${formatPercent(row.original.completed, row.original.drafted, 0)}`}
                        </span>
                    </span>
                ),
            },
            {
                id: 'failed',
                header: t('engageDash.engines.col.failed'),
                size: 80,
                cell: ({ row }) => (
                    <span
                        className={cn(
                            'tabular-nums',
                            row.original.failed > 0
                                ? 'font-semibold text-danger-600'
                                : 'text-neutral-400'
                        )}
                    >
                        <span className="text-caption">{formatNumber(row.original.failed)}</span>
                    </span>
                ),
            },
        ],
        [t]
    );

    return (
        <GroupDashboardShell
            title={t('engageDash.title')}
            subtitle={t('engageDash.subtitle')}
            isAdmin={isAdmin}
            isLoading={q.isLoading}
            isError={q.isError}
            actions={
                <>
                    <CrmLink href="/engagement-engines/inbox" className={LINK_BTN}>
                        <Tray size={14} />
                        <span className="text-caption">{t('engageDash.inbox')}</span>
                    </CrmLink>
                    <CrmLink href="/engagement-engines" className={LINK_BTN}>
                        <Lightning size={14} />
                        <span className="text-caption">{t('engageDash.engines.all')}</span>
                    </CrmLink>
                </>
            }
        >
            {tot && (
                <>
                    <GroupHero
                        icon={Lightning}
                        eyebrow={t('engageDash.hero.eyebrow', { days })}
                        value={formatNumber(tot.completed)}
                        unit={t('engageDash.hero.unit')}
                        delta={pctChange(tot.completed, tot.prev_completed)}
                        deltaTitle={t('engageDash.hero.deltaTitle')}
                        sub={t('engageDash.hero.sub', {
                            drafted: formatNumber(tot.drafted),
                            rate: formatPercent(tot.completed, tot.drafted, 0),
                            members: formatNumber(members),
                        })}
                        compare={t('engageDash.hero.compare', {
                            days,
                            total: formatNumber(tot.prev_completed),
                        })}
                        days={daily.map((d) => d.day)}
                        series={[
                            {
                                key: 'drafted',
                                label: t('engageDash.hero.drafted'),
                                tint: 'primary',
                                values: daily.map((d) => d.drafted),
                            },
                            {
                                key: 'completed',
                                label: t('engageDash.hero.completed'),
                                tint: 'success',
                                values: daily.map((d) => d.completed),
                            },
                        ]}
                        range={days}
                        onRange={setDays}
                        fromDay={q.data?.from_day}
                        toDay={q.data?.to_day}
                    />
                    <StatStrip
                        deltaTitle={t('engageDash.hero.deltaTitle')}
                        items={[
                            {
                                key: 'engines',
                                icon: Lightning,
                                label: t('engageDash.stats.engines'),
                                value: `${active} / ${engines.length}`,
                                detail: t('engageDash.stats.enginesDetail', {
                                    members: formatNumber(members),
                                    holdout: formatNumber(holdout),
                                }),
                                href: '/engagement-engines',
                            },
                            {
                                key: 'drafted',
                                icon: Sparkle,
                                tint: 'info',
                                label: t('engageDash.stats.drafted'),
                                value: tot.drafted,
                                delta: pctChange(tot.drafted, tot.prev_drafted),
                                detail: t('engageDash.stats.draftedDetail', {
                                    total: formatNumber(Math.round(tot.drafted / days)),
                                }),
                                spark: daily.map((d) => d.drafted),
                            },
                            {
                                key: 'completed',
                                icon: PaperPlaneTilt,
                                tint: 'success',
                                label: t('engageDash.stats.completed'),
                                value: tot.completed,
                                delta: pctChange(tot.completed, tot.prev_completed),
                                detail: t('engageDash.stats.completedDetail', {
                                    failed: formatNumber(tot.failed),
                                }),
                                spark: daily.map((d) => d.completed),
                            },
                            {
                                key: 'waiting',
                                icon: HourglassMedium,
                                tint: 'warning',
                                label: t('engageDash.stats.waiting'),
                                value: tot.open_now,
                                detail: t('engageDash.stats.waitingDetail', {
                                    total: formatNumber(tot.open_over_day),
                                }),
                                href: '/engagement-engines/inbox',
                            },
                        ]}
                    />
                    <InsightStrip insights={insights} />
                    <SectionCard
                        icon={UsersThree}
                        title={t('engageDash.engines.title')}
                        subtitle={t('engageDash.engines.subtitle', { days })}
                    >
                        {engines.length === 0 ? (
                            <EmptyChart text={t('engageDash.engines.empty')} />
                        ) : (
                            <MyTable<EngineRow>
                                data={staticTableData(engines)}
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
                    <p className="flex items-center gap-1.5 text-neutral-500">
                        <WarningCircle size={14} />
                        <span className="text-caption">{t('engageDash.foot')}</span>
                    </p>
                </>
            )}
        </GroupDashboardShell>
    );
}
