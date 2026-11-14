import type { TFunction } from 'i18next';
import type { UpcomingSessionDay } from '@/routes/study-library/live-session/-services/utils';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import type { DashboardCollectionResponse } from '@/services/manage-finances';
import { toFeeTotals, type SourceState } from './dashboard-sources';

export type KpiFormat = 'number' | 'currency' | 'percent';

export type KpiBreakdownTone = 'neutral' | 'success' | 'warning' | 'danger';

/** A secondary count shown as a chip under the headline value (e.g. Inactive 29). */
export interface KpiBreakdownItem {
    label: string;
    value: number;
    tone: KpiBreakdownTone;
}

/**
 * `ready`: value is real. `loading`: its source is still in flight. `error`: its source
 * failed — the card must say so instead of showing `value` (which is a meaningless 0).
 */
export type KpiStatus = 'ready' | 'loading' | 'error';

export interface DashboardKpi {
    id: string;
    label: string;
    value: number;
    format: KpiFormat;
    status: KpiStatus;
    deepLink?: string;
    subtitle?: string;
    breakdown?: KpiBreakdownItem[];
}

const todayKey = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
    ).padStart(2, '0')}`;
};

const statusOf = (s: SourceState<unknown>): KpiStatus =>
    s.isError ? 'error' : s.isLoading || s.data === undefined ? 'loading' : 'ready';

const countClassesToday = (sessions: UpcomingSessionDay[] | undefined): number => {
    const today = todayKey();
    return sessions?.find((d) => (d.date || '').slice(0, 10) === today)?.sessions?.length || 0;
};

export interface InstituteCounts {
    student_count?: number;
    // Learner status breakdown, matching the Learner Management header badges. Each
    // is a distinct-learner count, so a learner active in one batch and terminated in
    // another is in both buckets — they need not sum to total_student_count.
    total_student_count?: number;
    active_student_count?: number;
    inactive_student_count?: number;
    terminated_student_count?: number;
    batch_count?: number;
    course_count?: number;
    subject_count?: number;
    level_count?: number;
    profile_completion_percentage?: number;
}

export interface AdminKpiSources {
    counts: SourceState<InstituteCounts>;
    teamCount: SourceState<number>;
    feeCollection: SourceState<DashboardCollectionResponse>;
    sessions: SourceState<UpcomingSessionDay[]>;
}

const buildClassesTodayKpi = (
    sessions: SourceState<UpcomingSessionDay[]>,
    t: TFunction,
    withSubtitle: boolean
): DashboardKpi => {
    const liveSessionsPlural = getTerminologyPlural(
        ContentTerms.LiveSession,
        SystemTerms.LiveSession
    );
    return {
        id: 'classesToday',
        label: t('dashboardKpisService:kpis.classesToday.label', { sessions: liveSessionsPlural }),
        value: countClassesToday(sessions.data),
        format: 'number',
        status: statusOf(sessions),
        ...(withSubtitle
            ? {
                  subtitle: t('dashboardKpisService:kpis.classesToday.subtitle', {
                      sessions: liveSessionsPlural.toLowerCase(),
                  }),
              }
            : {}),
        deepLink: '/study-library/live-session',
    };
};

/**
 * Admin KPI cards from already-fetched sources. Each card carries its own source's status,
 * so one failed request marks one card instead of zeroing (or hiding) the whole band.
 */
export const buildAdminKpis = (s: AdminKpiSources, t: TFunction): DashboardKpi[] => {
    const counts = s.counts.data;
    const fees = s.feeCollection.data ? toFeeTotals(s.feeCollection.data) : null;

    const activeLearners = counts?.active_student_count ?? counts?.student_count ?? 0;
    const inactiveLearners = counts?.inactive_student_count ?? 0;
    const terminatedLearners = counts?.terminated_student_count ?? 0;
    const totalLearners = counts?.total_student_count ?? activeLearners;

    const learnersPlural = getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner);
    const coursesPlural = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
    const feeStatus = statusOf(s.feeCollection);

    return [
        {
            id: 'activeLearners',
            // "Active", not "Total" — the value is the active count, and labelling it
            // Total made it read as contradicting Learner Management's own Total badge.
            label: t('dashboardKpisService:kpis.activeLearners.label', {
                learners: learnersPlural,
            }),
            value: activeLearners,
            format: 'number',
            status: statusOf(s.counts),
            subtitle: t('dashboardKpisService:kpis.activeLearners.subtitle', {
                total: totalLearners.toLocaleString('en-IN'),
            }),
            deepLink: '/manage-students/students-list',
            // Always rendered, zeros included — "0 terminated" is itself the answer
            // an admin is looking for. Empty buckets drop to a neutral tone so a
            // healthy institute isn't showing amber/red chips for nothing.
            breakdown: [
                {
                    label: t('dashboardKpisService:breakdown.inactive'),
                    value: inactiveLearners,
                    tone: inactiveLearners > 0 ? 'warning' : 'neutral',
                },
                {
                    label: t('dashboardKpisService:breakdown.terminated'),
                    value: terminatedLearners,
                    tone: terminatedLearners > 0 ? 'danger' : 'neutral',
                },
            ] as KpiBreakdownItem[],
        },
        {
            id: 'totalCourses',
            label: t('dashboardKpisService:kpis.totalCourses.label', { courses: coursesPlural }),
            value: counts?.course_count || 0,
            format: 'number',
            status: statusOf(s.counts),
            subtitle: t('dashboardKpisService:kpis.totalCourses.subtitle', {
                courses: coursesPlural.toLowerCase(),
            }),
            deepLink: '/study-library/courses',
        },
        {
            id: 'teamMembers',
            label: t('dashboardKpisService:kpis.teamMembers.label'),
            value: s.teamCount.data ?? 0,
            format: 'number',
            status: statusOf(s.teamCount),
            subtitle: t('dashboardKpisService:kpis.teamMembers.subtitle', {
                admins: getTerminologyPlural(RoleTerms.Admin, SystemTerms.Admin),
                teachers: getTerminologyPlural(
                    RoleTerms.Teacher,
                    SystemTerms.Teacher
                ).toLowerCase(),
            }),
        },
        // Both fee cards read the Collection Dashboard totals (institute-wide). They used to
        // read the adjustment-approval queue, which only holds bills with a concession or
        // penalty awaiting review — so they showed ~0 for almost every institute.
        {
            id: 'outstandingFees',
            label: t('dashboardKpisService:kpis.outstandingFees.label'),
            value: Math.round(fees?.outstanding ?? 0),
            format: 'currency',
            status: feeStatus,
            subtitle: t('dashboardKpisService:kpis.outstandingFees.subtitle'),
            deepLink: '/financial-management/collection-dashboard',
        },
        {
            id: 'overdueFees',
            label: t('dashboardKpisService:kpis.overdueFees.label'),
            value: Math.round(fees?.overdue ?? 0),
            format: 'currency',
            status: feeStatus,
            subtitle: t('dashboardKpisService:kpis.overdueFees.subtitle'),
            deepLink: '/financial-management/collection-dashboard',
        },
        buildClassesTodayKpi(s.sessions, t, true),
    ];
};

export const buildTeacherKpis = (
    sessions: SourceState<UpcomingSessionDay[]>,
    t: TFunction
): DashboardKpi[] => [buildClassesTodayKpi(sessions, t, false)];
