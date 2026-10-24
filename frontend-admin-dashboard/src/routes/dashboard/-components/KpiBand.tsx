import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
    CaretRight,
    Users,
    BookOpen,
    UsersThree,
    Money,
    WarningCircle,
    VideoCamera,
    type Icon,
} from '@phosphor-icons/react';
import {
    buildAdminKpis,
    buildTeacherKpis,
    type DashboardKpi,
    type InstituteCounts,
    type KpiBreakdownTone,
} from '../-services/dashboard-kpis-service';
import { toSourceState } from '../-services/dashboard-sources';
import {
    useDashboardUpcomingSessions,
    useInstituteDashboardCounts,
    useInstituteFeeCollection,
    useTeamMemberCount,
} from '../-hooks/useDashboardSources';
import SourceErrorNotice from './SourceErrorNotice';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { formatInstituteMoney, resolveInstituteCurrency } from '@/utils/institute-currency';
import { useEntitlement } from '@/lib/capabilities/use-entitlement';
import { isKpiEntitled } from '../-config/dashboard-entitlements';

interface KpiBandProps {
    instituteId: string;
    roles: string[];
}

// Neutral, compact metrics keep the assistant and pending work visually primary.
const KPI_ICONS: Record<string, Icon> = {
    activeLearners: Users,
    totalCourses: BookOpen,
    teamMembers: UsersThree,
    outstandingFees: Money,
    overdueFees: WarningCircle,
    classesToday: VideoCamera,
};

// Breakdown chips sit under the headline value, so they must read as secondary:
// tinted surface, no border, same tabular-nums as the main figure.
const BREAKDOWN_TONE: Record<KpiBreakdownTone, string> = {
    neutral: 'bg-neutral-100 text-neutral-600',
    success: 'bg-success-50 text-success-600',
    warning: 'bg-warning-50 text-warning-700',
    danger: 'bg-danger-50 text-danger-600',
};

/**
 * `currency` is the institute's resolved code, '' when it cannot be determined. Outstanding fees
 * come from the fee ledger, which stores no currency, so this used to be hardcoded to INR — a UAE
 * institute's dues card read "₹0". An unresolvable institute now shows a bare number instead of a
 * wrong symbol. Locale stays en-IN so compact notation reads as L/Cr.
 */
const formatValue = (k: DashboardKpi, currency: string): string => {
    if (k.format === 'currency') {
        return formatInstituteMoney(k.value, currency);
    }
    if (k.format === 'percent') {
        return `${k.value}%`;
    }
    if (k.value >= 1000) {
        try {
            return new Intl.NumberFormat('en-IN', {
                notation: 'compact',
                maximumFractionDigits: 1,
            }).format(k.value);
        } catch {
            return k.value.toLocaleString('en-IN');
        }
    }
    return k.value.toLocaleString('en-IN');
};

const KpiSkeletonCard = () => (
    <Card className="rounded-xl bg-white p-3 shadow-none sm:p-4">
        <div className="flex items-start justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="size-4 rounded" />
        </div>
        <Skeleton className="mt-3 h-7 w-24" />
        <Skeleton className="mt-2 h-2.5 w-28" />
    </Card>
);

export default function KpiBand({ instituteId, roles }: KpiBandProps) {
    const navigate = useNavigate();
    const { t } = useTranslation('dashboardKpisService');
    const { t: dashboardT } = useTranslation('dashboardIndex');
    const instituteDetails = useInstituteDetailsStore((state) => state.instituteDetails);
    const currency = resolveInstituteCurrency(instituteDetails);

    // `roles` are the CURRENT institute's roles. Admins get the full band; teachers get
    // today's classes only; any other role gets no band.
    const isAdmin = roles.includes('ADMIN');
    const isTeacher = !isAdmin && roles.includes('TEACHER');

    // Shared hooks: the page header, Finance snapshot, Pending Actions and Live Classes read
    // the same queries, so each request goes out once per dashboard load.
    const countsQuery = useInstituteDashboardCounts(instituteId, isAdmin);
    const teamQuery = useTeamMemberCount(instituteId, isAdmin);
    // Plan (MANAGED only): a card outside it is dropped and its source not fetched.
    // In LEGACY every card is entitled, so these flags are exactly the role checks.
    const entitlement = useEntitlement();
    const feesInPlan = isKpiEntitled('outstandingFees', entitlement);
    const sessionsInPlan = isKpiEntitled('classesToday', entitlement);
    const feeQuery = useInstituteFeeCollection(instituteId, isAdmin && feesInPlan);
    const sessionsQuery = useDashboardUpcomingSessions(
        instituteId,
        (isAdmin || isTeacher) && sessionsInPlan
    );

    const refetchByKpi: Record<string, () => void> = {
        activeLearners: () => void countsQuery.refetch(),
        totalCourses: () => void countsQuery.refetch(),
        teamMembers: () => void teamQuery.refetch(),
        outstandingFees: () => void feeQuery.refetch(),
        overdueFees: () => void feeQuery.refetch(),
        classesToday: () => void sessionsQuery.refetch(),
    };

    const sessions = toSourceState(sessionsQuery);
    const allItems: DashboardKpi[] = isAdmin
        ? buildAdminKpis(
              {
                  counts: toSourceState<InstituteCounts>(countsQuery),
                  teamCount: toSourceState(teamQuery),
                  feeCollection: toSourceState(feeQuery),
                  sessions,
              },
              t
          )
        : isTeacher
          ? buildTeacherKpis(sessions, t)
          : [];
    const items = allItems.filter((k) => isKpiEntitled(k.id, entitlement));

    if (items.length === 0) return null;

    const cols =
        items.length === 1
            ? 'grid-cols-1'
            : items.length === 2
              ? 'grid-cols-2'
              : items.length === 3
                ? 'grid-cols-2 lg:grid-cols-3'
                : items.length === 4
                  ? 'grid-cols-2 lg:grid-cols-4'
                  : items.length === 5
                    ? 'grid-cols-2 md:grid-cols-3 2xl:grid-cols-5'
                    : 'grid-cols-2 md:grid-cols-3 2xl:grid-cols-6';

    return (
        <section aria-label={dashboardT('overview.title')}>
            <h2 className="mb-3 text-sm font-semibold text-neutral-800">
                {dashboardT('overview.title')}
            </h2>
            <div className={`grid gap-2 ${cols}`}>
                {items.map((k) => {
                    if (k.status === 'loading') {
                        return <KpiSkeletonCard key={k.id} />;
                    }
                    const Icon = KPI_ICONS[k.id] || Users;
                    if (k.status === 'error') {
                        // Not a link and no value: a failed source must not read as a real 0.
                        return (
                            <Card
                                key={k.id}
                                className="h-full rounded-xl bg-white p-3 shadow-none sm:p-4"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1 text-xs font-medium text-neutral-600">
                                        {k.label}
                                    </div>
                                    <Icon
                                        size={16}
                                        className="mt-0.5 shrink-0 text-neutral-300"
                                        aria-hidden="true"
                                    />
                                </div>
                                <div className="mt-2 text-2xl font-semibold text-neutral-300">
                                    —
                                </div>
                                <SourceErrorNotice
                                    className="mt-1"
                                    onRetry={refetchByKpi[k.id] ?? (() => undefined)}
                                />
                            </Card>
                        );
                    }
                    const clickable = !!k.deepLink;
                    return (
                        <button
                            key={k.id}
                            type="button"
                            onClick={() => k.deepLink && navigate({ to: k.deepLink })}
                            disabled={!clickable}
                            className="group rounded-xl text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 disabled:cursor-default"
                        >
                            <Card
                                className={`h-full rounded-xl bg-white p-3 shadow-none transition-colors sm:p-4 ${clickable ? 'group-hover:border-neutral-400 group-hover:bg-neutral-50' : ''}`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-medium text-neutral-600">
                                            {k.label}
                                        </div>
                                    </div>
                                    <Icon
                                        size={16}
                                        className="mt-0.5 shrink-0 text-neutral-400"
                                        aria-hidden="true"
                                    />
                                </div>
                                <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                    <span className="text-2xl font-semibold tabular-nums text-neutral-900">
                                        {formatValue(k, currency)}
                                    </span>
                                </div>
                                {!!k.breakdown?.length && (
                                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                        {k.breakdown.map((b) => (
                                            <span
                                                key={b.label}
                                                className={`rounded-sm px-1.5 py-0.5 text-2xs font-medium tabular-nums ${
                                                    BREAKDOWN_TONE[b.tone]
                                                }`}
                                            >
                                                {b.value.toLocaleString('en-IN')}{' '}
                                                {b.label.toLowerCase()}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {k.subtitle && (
                                    <div className="mt-1 flex items-center justify-between gap-2">
                                        <span className="text-2xs text-neutral-500">
                                            {k.subtitle}
                                        </span>
                                        {clickable && (
                                            <CaretRight
                                                size={12}
                                                className="shrink-0 text-neutral-300 transition-colors group-hover:text-neutral-700"
                                            />
                                        )}
                                    </div>
                                )}
                            </Card>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
