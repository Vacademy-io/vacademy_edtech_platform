import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, Monitor, Users, UsersThree } from '@phosphor-icons/react';
import { getSubOrgsWithDetails } from '../../-services/custom-team-services';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { cn } from '@/lib/utils';

/**
 * One headline figure: tinted icon badge on the left, number and label stacked on the
 * right. The badge tint is what separates the four at a glance — four bare numbers in a
 * row all look the same from across a desk.
 *
 * Exported because the single-sub-org page (/manage-suborg-teams) shows the same row of
 * figures for one channel partner. Sharing the component — rather than copying the
 * classes — is what keeps the two headers identical when either is restyled.
 */
export function StatCard({
    label,
    value,
    icon,
    tone,
}: {
    label: string;
    value: string;
    icon: ReactNode;
    tone: 'primary' | 'success' | 'warning' | 'info';
}) {
    const toneClass: Record<typeof tone, string> = {
        primary: 'bg-primary-50 text-primary-500',
        success: 'bg-success-50 text-success-600',
        warning: 'bg-warning-50 text-warning-700',
        info: 'bg-info-50 text-info-600',
    };
    return (
        <div className="flex min-w-36 items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
            <span
                className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-lg',
                    toneClass[tone]
                )}
                aria-hidden="true"
            >
                {icon}
            </span>
            <div className="min-w-0">
                <p className="truncate text-xl font-semibold leading-tight text-neutral-900">
                    {value}
                </p>
                <p className="truncate text-xs text-neutral-500">{label}</p>
            </div>
        </div>
    );
}

/**
 * The four headline figures beside the page title.
 *
 * Reads the same query key as the list below it, so React Query serves both from one
 * cache entry — the page still makes a single request, and the cards can never disagree
 * with the table because they were fetched separately. These are network-wide totals,
 * deliberately NOT reduced by the table's filters: they caption the page, not the
 * current view.
 */
export function SubOrgSummaryCards() {
    const { t } = useTranslation('manageCustomTeamsSubOrgSummaryCards');
    const instituteId = getCurrentInstituteId();
    const { data, isLoading } = useQuery({
        queryKey: ['sub-orgs-with-details', instituteId],
        queryFn: () => getSubOrgsWithDetails(instituteId),
        enabled: !!instituteId,
    });

    const rows = useMemo(() => data?.content ?? [], [data?.content]);
    const summary = useMemo(() => {
        let active = 0;
        let learners = 0;
        let usedSeats = 0;
        let totalSeats = 0;
        rows.forEach((o) => {
            if (o.plan_status === 'ACTIVE') active += 1;
            learners += o.learner_count ?? o.used_seats ?? 0;
            usedSeats += o.used_seats ?? 0;
            totalSeats += o.total_seats ?? 0;
        });
        return { total: rows.length, active, learners, usedSeats, totalSeats };
    }, [rows]);

    const term = getTerminologyPlural(OtherTerms.SubOrg, SystemTerms.SubOrg);
    const show = (n: number) => (isLoading ? '—' : String(n));

    return (
        <div className="flex flex-wrap gap-3">
            <StatCard
                tone="primary"
                label={t('cards.totalTerm', { term })}
                value={show(summary.total)}
                icon={<Monitor className="size-5" />}
            />
            <StatCard
                tone="success"
                label={t('cards.active')}
                value={show(summary.active)}
                icon={<CheckCircle className="size-5" />}
            />
            <StatCard
                tone="warning"
                label={t('cards.totalLearners')}
                value={show(summary.learners)}
                icon={<UsersThree className="size-5" />}
            />
            <StatCard
                tone="info"
                label={t('cards.totalSeats')}
                value={isLoading ? '—' : `${summary.usedSeats}/${summary.totalSeats}`}
                icon={<Users className="size-5" />}
            />
        </div>
    );
}
