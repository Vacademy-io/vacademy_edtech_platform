import { useEffect, useMemo } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    Armchair,
    BookOpen,
    Buildings,
    GraduationCap,
    Package,
    Stack,
    UsersThree,
    CalendarBlank,
    type Icon,
} from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { getCurrentInstituteId, getRolesForCurrentInstitute } from '@/lib/auth/instituteUtils';
import { instituteTerms } from '@/components/shared/crm-enhance/institute-terms';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { InsightStrip, StatStrip, type Insight } from '@/components/shared/crm-enhance';
import { CrmLink, Meter } from '@/routes/dashboard/-components/crm/crm-cards';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { useInstituteDashboardCounts } from '@/routes/dashboard/-hooks/useDashboardSources';
import { fetchInventoryStats } from '@/routes/manage-inventory/-services/inventory-service';
import { getSubOrgsWithDetails } from '@/routes/manage-custom-teams/-services/custom-team-services';
import { formatNumber, formatPercent } from '@/routes/dashboard/-utils/crm-dashboard';

export const Route = createLazyFileRoute('/manage-institute/overview/')({
    component: InstituteOverviewPage,
});

/**
 * Institute Overview: learners, courses, batches, seat fill and Sub-Orgs on one page,
 * from the same requests the dashboard, Inventory and Sub-Orgs pages already make.
 * Those numbers are institute-wide, so the page is for admins only.
 */
function InstituteOverviewPage() {
    const { t } = useTranslation('crmPages');
    // Institute's own names for learners, batches, sub-orgs… (Settings → Naming).
    const terms = instituteTerms();
    const ti = (key: string, opts?: Record<string, unknown>) => t(key, { ...terms, ...opts });
    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="font-medium">{t('institute.title')}</h1>);
    }, [setNavHeading, t]);

    const instituteId = getCurrentInstituteId();
    const isAdmin = useMemo(() => getRolesForCurrentInstitute().includes('ADMIN'), []);
    const counts = useInstituteDashboardCounts(instituteId, isAdmin);
    const inventory = useQuery({
        queryKey: ['institute-overview-inventory', instituteId],
        queryFn: fetchInventoryStats,
        enabled: isAdmin && !!instituteId,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
    // Same key as the Sub-Orgs page, so the list is shared rather than fetched twice.
    const subOrgs = useQuery({
        queryKey: ['sub-orgs-with-details', instituteId],
        queryFn: () => getSubOrgsWithDetails(instituteId),
        enabled: isAdmin && !!instituteId,
    });

    const c = counts.data as
        | {
              student_count?: number;
              course_count?: number;
              batch_count?: number;
              level_count?: number;
          }
        | undefined;
    const inv = inventory.data;
    const orgs = subOrgs.data?.content ?? [];
    const used = inv ? (inv.total_capacity ?? 0) - (inv.total_available ?? 0) : 0;
    const planCounts = orgs.reduce<Record<string, number>>((m, o) => {
        const k = o.plan_status || 'NONE';
        m[k] = (m[k] ?? 0) + 1;
        return m;
    }, {});

    const insights: Insight[] = [];
    if (inv && inv.critical_sessions > 0) {
        insights.push({
            key: 'critical',
            tone: 'danger',
            title: ti('institute.insights.critical.title', { total: inv.critical_sessions }),
            text: ti('institute.insights.critical.text'),
            href: '/manage-inventory',
        });
    }
    if (inv && inv.low_availability_sessions > 0) {
        insights.push({
            key: 'low',
            tone: 'warning',
            title: ti('institute.insights.low.title', { total: inv.low_availability_sessions }),
            text: ti('institute.insights.low.text'),
            href: '/manage-inventory',
        });
    }
    const pendingPay = orgs.filter((o) => o.plan_status && o.plan_status !== 'ACTIVE').length;
    if (pendingPay > 0) {
        insights.push({
            key: 'suborg',
            tone: 'warning',
            title: ti('institute.insights.suborg.title', { total: pendingPay }),
            text: ti('institute.insights.suborg.text'),
            href: '/manage-custom-teams',
        });
    }
    const links: Array<[string, Icon, string]> = [
        ['batches', Stack, '/manage-institute/batches'],
        ['sessions', CalendarBlank, '/manage-institute/sessions'],
        ['teams', UsersThree, '/manage-institute/teams'],
        ['inventory', Armchair, '/manage-inventory'],
        ['packages', Package, '/admin-package-management'],
        ['subOrgs', Buildings, '/manage-custom-teams'],
    ];

    return (
        <LayoutContainer>
            <div className="flex flex-col gap-5">
                <div>
                    <h1 className="font-semibold text-neutral-900">
                        <span className="text-h2">{ti('institute.title')}</span>
                    </h1>
                    <p className="text-neutral-500">
                        <span className="text-body">{ti('institute.subtitle')}</span>
                    </p>
                </div>
                {!isAdmin ? (
                    <EmptyChart text={ti('institute.adminOnly')} className="h-32" />
                ) : (
                    <>
                        <StatStrip
                            items={[
                                {
                                    key: 'learners',
                                    icon: GraduationCap,
                                    label: ti('institute.stats.learners'),
                                    value: c?.student_count,
                                    href: '/manage-students/students-list',
                                    loading: counts.isLoading,
                                },
                                {
                                    key: 'courses',
                                    icon: BookOpen,
                                    tint: 'info',
                                    label: ti('institute.stats.courses'),
                                    value: c?.course_count,
                                    detail: c
                                        ? ti('institute.stats.coursesDetail', {
                                              total: formatNumber(c.level_count ?? 0),
                                          })
                                        : undefined,
                                    loading: counts.isLoading,
                                },
                                {
                                    key: 'batches',
                                    icon: Stack,
                                    tint: 'success',
                                    label: ti('institute.stats.batches'),
                                    value: c?.batch_count,
                                    href: '/manage-institute/batches',
                                    loading: counts.isLoading,
                                },
                                {
                                    key: 'seats',
                                    icon: Armchair,
                                    tint: 'warning',
                                    label: ti('institute.stats.seats'),
                                    value:
                                        inv && inv.total_capacity > 0
                                            ? formatPercent(used, inv.total_capacity, 0)
                                            : '—',
                                    detail:
                                        inv && typeof inv.total_capacity === 'number'
                                            ? ti('institute.stats.seatsDetail', {
                                                  used: formatNumber(used),
                                                  total: formatNumber(inv.total_capacity),
                                              })
                                            : undefined,
                                    href: '/manage-inventory',
                                    loading: inventory.isLoading,
                                },
                            ]}
                        />
                        <InsightStrip insights={insights} />
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                            {links.map(([key, I, href]) => (
                                <CrmLink
                                    key={key}
                                    href={href}
                                    className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3 transition-shadow hover:border-primary-300 hover:shadow-md"
                                >
                                    <span className="flex size-8 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                                        <I size={16} weight="duotone" />
                                    </span>
                                    <span className="font-medium text-neutral-800">
                                        <span className="text-caption">
                                            {ti(`institute.links.${key}`)}
                                        </span>
                                    </span>
                                </CrmLink>
                            ))}
                        </div>
                        <div className="grid gap-4 xl:grid-cols-2">
                            <SectionCard
                                icon={Armchair}
                                title={ti('institute.seats.title')}
                                subtitle={ti('institute.seats.subtitle')}
                            >
                                {!inv || inv.total_sessions === 0 ? (
                                    <EmptyChart text={ti('institute.seats.empty')} />
                                ) : (
                                    <div className="space-y-3">
                                        <Meter
                                            value={used}
                                            max={Math.max(1, inv.total_capacity)}
                                            tone={
                                                used / Math.max(1, inv.total_capacity) >= 0.9
                                                    ? 'danger'
                                                    : 'success'
                                            }
                                        />
                                        {[
                                            ['total', inv.total_sessions],
                                            ['limited', inv.limited_sessions],
                                            ['unlimited', inv.unlimited_sessions],
                                            ['critical', inv.critical_sessions],
                                            ['low', inv.low_availability_sessions],
                                        ].map(([k, v]) => (
                                            <div key={k as string} className="flex justify-between">
                                                <span className="text-neutral-600">
                                                    <span className="text-caption">
                                                        {ti(`institute.seats.${k}`)}
                                                    </span>
                                                </span>
                                                <span className="font-semibold tabular-nums text-neutral-900">
                                                    <span className="text-caption">
                                                        {formatNumber(v as number)}
                                                    </span>
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </SectionCard>
                            <SectionCard
                                icon={Buildings}
                                title={ti('institute.subOrgs.title')}
                                subtitle={ti('institute.subOrgs.subtitle', { total: orgs.length })}
                            >
                                {orgs.length === 0 ? (
                                    <EmptyChart text={ti('institute.subOrgs.empty')} />
                                ) : (
                                    <div className="space-y-2">
                                        {Object.entries(planCounts)
                                            .sort((a, b) => b[1] - a[1])
                                            .map(([k, n]) => (
                                                <div
                                                    key={k}
                                                    className="grid grid-cols-12 items-center gap-3"
                                                >
                                                    <span className="col-span-4 truncate text-neutral-700">
                                                        <span className="text-caption">
                                                            {ti(`institute.subOrgs.status.${k}`, {
                                                                defaultValue: k,
                                                            })}
                                                        </span>
                                                    </span>
                                                    <span className="col-span-7">
                                                        <Meter
                                                            value={n}
                                                            max={orgs.length}
                                                            tone={
                                                                k === 'ACTIVE'
                                                                    ? 'success'
                                                                    : 'warning'
                                                            }
                                                        />
                                                    </span>
                                                    <span className="col-span-1 text-right font-semibold tabular-nums text-neutral-900">
                                                        <span className="text-caption">{n}</span>
                                                    </span>
                                                </div>
                                            ))}
                                    </div>
                                )}
                            </SectionCard>
                        </div>
                    </>
                )}
            </div>
        </LayoutContainer>
    );
}
