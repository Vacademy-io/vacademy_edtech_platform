import { useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRight, BookOpen, UserCirclePlus } from '@phosphor-icons/react';
import {
    getScopedInvites,
    getSubOrgFinanceDetail,
} from '@/routes/manage-custom-teams/-services/custom-team-services';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getValidSelectedSubOrgId, getFacultyAccessData } from '@/lib/auth/facultyAccessUtils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { formatInstituteMoney, resolveInstituteCurrency } from '@/utils/institute-currency';

const nfmt = (n: number) => n.toLocaleString('en-IN');
// Dues carry no currency of their own — follow the institute's, unsymbolled when undeterminable.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const toTime = (v: string | number | null | undefined): number | null => {
    if (v == null) return null;
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
};
const shortDate = (v: string | number | null | undefined): string => {
    const t = toTime(v);
    if (t == null) return '—';
    const d = new Date(t);
    return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''}`;
};
const initials = (name: string): string =>
    name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('') || '?';

interface CourseRow {
    id: string;
    name: string;
    sub: string;
}
const buildCoursesFromInvites =
    (t: TFunction) =>
    (invites: unknown): CourseRow[] => {
        if (!Array.isArray(invites)) return [];
        const byId = new Map<string, CourseRow>();
        invites.forEach((inv) => {
            const pss = (
                inv as {
                    package_sessions?: {
                        id?: string;
                        package_name?: string;
                        level_name?: string;
                        session_name?: string;
                    }[];
                }
            )?.package_sessions;
            if (Array.isArray(pss)) {
                pss.forEach((ps) => {
                    if (!ps?.id || byId.has(ps.id)) return;
                    byId.set(ps.id, {
                        id: ps.id,
                        name: (ps.package_name ?? '').trim() || t('courses.fallbackName'),
                        sub: [ps.level_name, ps.session_name].filter(Boolean).join(' · '),
                    });
                });
            }
        });
        return [...byId.values()];
    };

/**
 * SUB-ORG admin widget: recent learner enrollments + the org's course catalogue,
 * side by side. Scoped to the caller's validated sub-org. Seats moved to the
 * hero KPI cards, so this focuses on "who joined" and "what we offer".
 */
export default function SubOrgSeatCoursesWidget() {
    const navigate = useNavigate();
    const { t } = useTranslation('dashboardSubOrgSeatCoursesWidget');
    const instituteDetails = useInstituteDetailsStore((state) => state.instituteDetails);
    const inr = (n: number) => formatInstituteMoney(n, resolveInstituteCurrency(instituteDetails));
    const instituteId = getCurrentInstituteId();
    const subOrgId =
        getValidSelectedSubOrgId() ?? getFacultyAccessData()?.subOrgs?.[0]?.subOrgId ?? null;

    const { data: finance, isLoading, isError } = useQuery({
        queryKey: ['sub-org-self-finance', subOrgId, instituteId],
        queryFn: () => getSubOrgFinanceDetail(subOrgId || '', instituteId || undefined),
        enabled: !!subOrgId,
        staleTime: 60_000,
        retry: false,
    });
    const { data: scopedInvites } = useQuery({
        queryKey: ['sub-org-self-scoped-invites', subOrgId],
        queryFn: () => getScopedInvites(subOrgId || ''),
        enabled: !!subOrgId,
        staleTime: 60_000,
        retry: false,
    });

    const learners = useMemo(() => finance?.learners ?? [], [finance]);

    // Learner count per course (package session) — course-wise distribution.
    const learnerByCourse = useMemo(() => {
        const m = new Map<string, number>();
        for (const l of learners) {
            const psIds = new Set<string>();
            if (l.package_session_id) psIds.add(l.package_session_id);
            (l.package_session_ids ?? []).forEach((id) => psIds.add(id));
            psIds.forEach((id) => m.set(id, (m.get(id) ?? 0) + 1));
        }
        return m;
    }, [learners]);

    // Courses ranked by how many learners they have (active courses first).
    const courses = useMemo(() => {
        return buildCoursesFromInvites(t)(scopedInvites)
            .map((c) => ({ ...c, learners: learnerByCourse.get(c.id) ?? 0 }))
            .sort((a, b) => b.learners - a.learners);
    }, [scopedInvites, learnerByCourse, t]);

    const recent = useMemo(
        () =>
            [...learners]
                .sort((a, b) => (toTime(b.enrolled_date) ?? 0) - (toTime(a.enrolled_date) ?? 0))
                .slice(0, 5),
        [learners]
    );
    const owing = useMemo(
        () => learners.filter((l) => (l.outstanding_amount ?? 0) > 0).length,
        [learners]
    );

    if (!subOrgId || isError) return null;

    return (
        <Card className="p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <UserCirclePlus size={14} weight="duotone" />
                </span>
                <h3 className="text-sm font-semibold text-neutral-900">{t('heading')}</h3>
            </div>

            {isLoading ? (
                <Skeleton className="h-40 w-full rounded-md" />
            ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Recent enrollments */}
                    <div className="rounded-lg border border-neutral-200 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-neutral-600">
                                {t('recentEnrollments.label')}
                            </span>
                            {owing > 0 && (
                                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                                    {t('recentEnrollments.oweFees', { count: owing })}
                                </span>
                            )}
                        </div>
                        {recent.length === 0 ? (
                            <p className="py-4 text-center text-xs text-neutral-400">
                                {t('recentEnrollments.empty')}
                            </p>
                        ) : (
                            <div className="space-y-2.5">
                                {recent.map((l, i) => {
                                    const due = l.outstanding_amount ?? 0;
                                    return (
                                        <div key={l.user_id || i} className="flex items-center gap-2">
                                            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-600">
                                                {initials(l.full_name ?? '')}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <div className="line-clamp-1 text-xs font-medium text-neutral-800">
                                                    {(l.full_name ?? '').trim() ||
                                                        t('recentEnrollments.learnerFallback')}
                                                </div>
                                                <div className="text-xs text-neutral-400">
                                                    {t('recentEnrollments.joined', {
                                                        date: shortDate(l.enrolled_date),
                                                    })}
                                                </div>
                                            </div>
                                            {due > 0 ? (
                                                <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                                                    {t('recentEnrollments.due', { amount: inr(due) })}
                                                </span>
                                            ) : (
                                                <span className="shrink-0 rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-success-700 ring-1 ring-success-200">
                                                    {t('recentEnrollments.paid')}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Courses */}
                    <div className="flex flex-col rounded-lg border border-neutral-200 p-3">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-600">
                                <BookOpen size={13} weight="duotone" className="text-emerald-500" />
                                {t('courses.label')}
                            </span>
                            <span className="text-xs font-semibold tabular-nums text-neutral-800">
                                {nfmt(courses.length)}
                            </span>
                        </div>
                        {courses.length === 0 ? (
                            <p className="py-4 text-center text-xs text-neutral-400">
                                {t('courses.empty')}
                            </p>
                        ) : (
                            <div className="max-h-28 space-y-1.5 overflow-y-auto">
                                {courses.slice(0, 8).map((c) => (
                                    <div key={c.id} className="flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="line-clamp-1 text-xs font-medium text-neutral-800">
                                                {c.name}
                                            </div>
                                            {c.sub && (
                                                <div className="line-clamp-1 text-xs text-neutral-400">
                                                    {c.sub}
                                                </div>
                                            )}
                                        </div>
                                        <span
                                            className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium tabular-nums text-blue-600"
                                            title={t('courses.learnerCountTitle', {
                                                count: c.learners,
                                            })}
                                        >
                                            {nfmt(c.learners)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={() => navigate({ to: '/manage-suborg-teams' })}
                            className="mt-2 flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
                        >
                            {t('manage')}
                            <ArrowRight size={12} weight="bold" />
                        </button>
                    </div>
                </div>
            )}
        </Card>
    );
}
