import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
    ArrowRight,
    Buildings,
    CaretRight,
    CheckCircle,
    GraduationCap,
    UsersThree,
    type Icon,
} from '@phosphor-icons/react';
import { getSubOrgsWithDetails } from '@/routes/manage-custom-teams/-services/custom-team-services';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

// One stat's visual identity — mirrors the dashboard KpiBand treatment so the
// sub-org cards read as part of the same KPI system (soft gradient card + a
// rounded icon chip).
interface StatVisual {
    Icon: Icon;
    iconBg: string;
    iconColor: string;
    cardBg: string;
}

interface Stat {
    key: string;
    label: string;
    value: string;
    subtitle: string;
    visual: StatVisual;
}

/**
 * Sub-organization (VLE) network snapshot for the admin dashboard, rendered as
 * KPI-style stat cards (Total / Active / Learners / Seats) matching the
 * dashboard's KpiBand look. Every number derives from the SAME enriched list
 * the Manage VLEs screen uses (shared react-query cache key) so the two never
 * disagree, and each card deep-links into Manage VLEs.
 *
 * Per-role visibility is owned by Display Settings (widget id `subOrgOverview`),
 * so the same widget can be turned on for the parent admin's view AND for a
 * sub-org admin's role from Settings → Display Settings → Dashboard Widgets —
 * nothing is role-hardcoded here. Hides itself for institutes with no sub-orgs
 * so it never renders a wall of zeros.
 */
export default function SubOrgOverviewWidget() {
    const { t } = useTranslation('dashboardSubOrgOverviewWidget');
    const navigate = useNavigate();
    const instituteId = getCurrentInstituteId();

    const { data, isLoading, isError } = useQuery({
        // Same key as the Manage VLEs list — one fetch feeds both screens.
        queryKey: ['sub-orgs-with-details', instituteId],
        queryFn: () => getSubOrgsWithDetails(instituteId),
        staleTime: 60_000,
        enabled: !!instituteId,
        retry: false,
    });

    if (isError) return null;

    const rows = data?.content ?? [];
    const total = rows.length;
    // Institutes that don't use sub-orgs shouldn't see an all-zero snapshot.
    if (!isLoading && total === 0) return null;

    const active = rows.filter((r) => (r.plan_status || '').toUpperCase() === 'ACTIVE').length;
    const learners = rows.reduce((sum, r) => sum + (r.used_seats ?? 0), 0);
    const capacity = rows.reduce((sum, r) => sum + (r.total_seats ?? 0), 0);

    const singular = getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg);
    const plural = getTerminologyPlural(OtherTerms.SubOrg, SystemTerms.SubOrg);
    const nfmt = (n: number) => n.toLocaleString('en-IN');

    const stats: Stat[] = [
        {
            key: 'total',
            label: t('stats.total.label', { plural }),
            value: nfmt(total),
            subtitle: t('stats.total.subtitle', { plural }),
            visual: {
                Icon: Buildings,
                iconBg: 'bg-violet-100',
                iconColor: 'text-violet-600',
                cardBg: 'bg-gradient-to-br from-violet-50/60 to-white',
            },
        },
        {
            key: 'active',
            label: t('stats.active.label'),
            value: nfmt(active),
            subtitle: t('stats.active.subtitle'),
            visual: {
                Icon: CheckCircle,
                iconBg: 'bg-emerald-100',
                iconColor: 'text-emerald-600',
                cardBg: 'bg-gradient-to-br from-emerald-50/60 to-white',
            },
        },
        {
            key: 'learners',
            label: t('stats.learners.label'),
            value: nfmt(learners),
            subtitle: t('stats.learners.subtitle', { plural }),
            visual: {
                Icon: GraduationCap,
                iconBg: 'bg-blue-100',
                iconColor: 'text-blue-600',
                cardBg: 'bg-gradient-to-br from-blue-50/60 to-white',
            },
        },
        {
            key: 'seats',
            label: t('stats.seats.label'),
            value: capacity > 0 ? `${nfmt(learners)}/${nfmt(capacity)}` : '—',
            subtitle:
                capacity > 0 ? t('stats.seats.subtitleOccupied') : t('stats.seats.subtitleNoCap'),
            visual: {
                Icon: UsersThree,
                iconBg: 'bg-amber-100',
                iconColor: 'text-amber-600',
                cardBg: 'bg-gradient-to-br from-amber-50/60 to-white',
            },
        },
    ];

    const go = () => navigate({ to: '/manage-custom-teams' });

    return (
        <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                        <Buildings size={14} weight="duotone" />
                    </span>
                    <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-neutral-900">
                            {t('header.title', { plural })}
                        </h3>
                        <p className="line-clamp-1 text-xs text-neutral-500">
                            {t('header.subtitle', { singular })}
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={go}
                    className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
                >
                    {t('manage')}
                    <ArrowRight size={12} weight="bold" />
                </button>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {isLoading
                    ? Array.from({ length: 4 }, (_, i) => (
                          <Card key={i} className="bg-white p-4 shadow-sm">
                              <div className="flex items-start justify-between">
                                  <Skeleton className="h-3 w-20" />
                                  <Skeleton className="size-9 rounded-xl" />
                              </div>
                              <Skeleton className="mt-3 h-7 w-16" />
                              <Skeleton className="mt-2 h-2.5 w-24" />
                          </Card>
                      ))
                    : stats.map((s) => {
                          const StatIcon = s.visual.Icon;
                          return (
                              <button
                                  key={s.key}
                                  type="button"
                                  onClick={go}
                                  className="group text-left"
                              >
                                  <Card
                                      className={`relative h-full overflow-hidden p-4 shadow-sm transition-all group-hover:-translate-y-0.5 group-hover:shadow-md ${s.visual.cardBg}`}
                                  >
                                      <div className="flex items-start justify-between gap-3">
                                          <div className="min-w-0 flex-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
                                              {s.label}
                                          </div>
                                          <span
                                              className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${s.visual.iconBg}`}
                                          >
                                              <StatIcon
                                                  size={18}
                                                  weight="duotone"
                                                  className={s.visual.iconColor}
                                              />
                                          </span>
                                      </div>
                                      <div className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900">
                                          {s.value}
                                      </div>
                                      <div className="mt-1 flex items-center justify-between gap-2">
                                          <span className="line-clamp-1 text-xs text-neutral-500">
                                              {s.subtitle}
                                          </span>
                                          <CaretRight
                                              size={12}
                                              className="shrink-0 text-neutral-300 transition-all group-hover:translate-x-0.5 group-hover:text-primary-500"
                                          />
                                      </div>
                                  </Card>
                              </button>
                          );
                      })}
            </div>
        </section>
    );
}
