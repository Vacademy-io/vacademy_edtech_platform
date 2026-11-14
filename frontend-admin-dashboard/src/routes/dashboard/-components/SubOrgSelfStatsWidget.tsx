import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
    ArrowRight,
    CaretRight,
    Coins,
    Money,
    GraduationCap,
    UsersThree,
    type Icon,
} from '@phosphor-icons/react';
import { getSubOrgFinanceDetail } from '@/routes/manage-custom-teams/-services/custom-team-services';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getValidSelectedSubOrgId, getFacultyAccessData } from '@/lib/auth/facultyAccessUtils';
import { fetchCollectionSummary } from '../-services/collection-summary-service';
import { isRealCurrency } from '@/utils/payment-currency';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { resolveInstituteCurrency } from '@/utils/institute-currency';

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
 * `code` empty (or unrecognised) renders a bare number — the collection API is the only source
 * here that knows a currency, and guessing ₹ mislabels a sub-org that collects in USD/GBP.
 * Locale stays en-IN so compact notation reads as L/Cr.
 */
const money = (n: number, code?: string | null): string => {
    const notation = n >= 100000 ? 'compact' : 'standard';
    const currency = code?.trim().toUpperCase() || '';
    if (isRealCurrency(currency)) {
        try {
            return new Intl.NumberFormat('en-IN', {
                style: 'currency',
                currency,
                maximumFractionDigits: 0,
                notation,
            }).format(n);
        } catch {
            /* fall through to the plain-number form below */
        }
    }
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0, notation }).format(n);
};

// Outstanding fees come from the sub-org finance API, which carries no currency at all, so they
// follow the institute's resolved currency (see `resolveInstituteCurrency`). Collected has a real
// per-payment currency from the collection summary and uses that instead.

const nfmt = (n: number) => n.toLocaleString('en-IN');

/**
 * Self-scoped stats for a SUB-ORG ADMIN's dashboard: their own sub-org's
 * learners, seats used/total, courses and outstanding fees — as KPI stat cards
 * matching the dashboard KpiBand look. Distinct from SubOrgOverviewWidget
 * (which is the PARENT admin's whole-network view); this one only ever renders
 * for a sub-org admin, scoped to the sub-org they're currently in.
 *
 * The caller MUST already be a sub-org admin (the dashboard gates this on
 * isCallerSubOrgAdmin()); the sub-org id is resolved from their validated
 * faculty-access data — never from a URL/param — so they can only ever see
 * their own org. Numbers come from getSubOrgFinanceDetail (one call yields
 * seats + learner count + outstanding); course count from scoped invites.
 * Deep-links into the sub-org portal. Renders nothing if no sub-org resolves.
 */
export default function SubOrgSelfStatsWidget() {
    const { t } = useTranslation('dashboardSubOrgSelfStatsWidget');
    const navigate = useNavigate();
    const instituteId = getCurrentInstituteId();
    // Prefer the validated selected sub-org, else fall back to the caller's first
    // faculty-access sub-org — the selected id is cleared on login, so a freshly
    // logged-in sub-org admin often has it null, which used to hide this whole
    // widget (no learner/seat/revenue KPIs shown at all).
    const subOrgId =
        getValidSelectedSubOrgId() ?? getFacultyAccessData()?.subOrgs?.[0]?.subOrgId ?? null;

    const { data: finance, isLoading: financeLoading, isError } = useQuery({
        queryKey: ['sub-org-self-finance', subOrgId, instituteId],
        queryFn: () => getSubOrgFinanceDetail(subOrgId || '', instituteId || undefined),
        enabled: !!subOrgId,
        staleTime: 60_000,
        retry: false,
    });

    const instituteDetails = useInstituteDetailsStore((state) => state.instituteDetails);
    const instituteCurrency = resolveInstituteCurrency(instituteDetails);

    // All-time collected fees for this sub-org (needs the collection-summary
    // backend deployed; shows 0 until then).
    const { data: collection } = useQuery({
        queryKey: ['sub-org-self-collection', subOrgId, instituteId],
        queryFn: () =>
            fetchCollectionSummary({ institute_id: instituteId || '', sub_org_id: subOrgId || '' }),
        enabled: !!subOrgId && !!instituteId,
        staleTime: 60_000,
        retry: false,
    });

    // No resolvable sub-org, or the finance call failed → render nothing rather
    // than a broken/zero card.
    if (!subOrgId || isError) return null;

    const isLoading = financeLoading;
    const seat = finance?.seat_usage;
    const used = seat?.used ?? 0;
    const total = seat?.total ?? null;
    const remaining = seat?.remaining ?? null;
    const learners = finance?.totals?.learner_count ?? 0;
    const outstanding = finance?.totals?.total_outstanding ?? 0;
    const collected = collection?.total_amount ?? 0;
    const heading = finance?.sub_org_name?.trim() || t('defaultOrgName');

    const stats: Stat[] = [
        {
            key: 'learners',
            label: t('stats.learners.label'),
            value: nfmt(learners),
            subtitle: t('stats.learners.subtitle'),
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
            value: total != null ? `${nfmt(used)}/${nfmt(total)}` : nfmt(used),
            subtitle:
                total != null
                    ? t('stats.seats.seatsLeft', {
                          count: Math.max(remaining ?? total - used, 0),
                      })
                    : t('stats.seats.noCap'),
            visual: {
                Icon: UsersThree,
                iconBg: 'bg-violet-100',
                iconColor: 'text-violet-600',
                cardBg: 'bg-gradient-to-br from-violet-50/60 to-white',
            },
        },
        {
            key: 'collected',
            label: t('stats.collected.label'),
            value: money(collected, collection?.currency),
            subtitle: t('stats.collected.subtitle'),
            visual: {
                Icon: Coins,
                iconBg: 'bg-emerald-100',
                iconColor: 'text-emerald-600',
                cardBg: 'bg-gradient-to-br from-emerald-50/60 to-white',
            },
        },
        {
            key: 'outstanding',
            label: t('stats.outstanding.label'),
            value: money(outstanding, instituteCurrency),
            subtitle: t('stats.outstanding.subtitle'),
            visual: {
                Icon: Money,
                iconBg: 'bg-amber-100',
                iconColor: 'text-amber-600',
                cardBg: 'bg-gradient-to-br from-amber-50/60 to-white',
            },
        },
    ];

    const go = () => navigate({ to: '/manage-suborg-teams' });

    return (
        <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                        <UsersThree size={18} weight="duotone" />
                    </span>
                    <div className="min-w-0">
                        <p className="text-xs font-medium text-neutral-400">
                            {t('welcomeBack')}
                        </p>
                        <h3 className="line-clamp-1 text-base font-semibold text-neutral-900">
                            {heading}
                        </h3>
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
