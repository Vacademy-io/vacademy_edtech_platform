import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Users, UsersThree, Wallet } from '@phosphor-icons/react';
import {
    getScopedInvites,
    getSubOrgFinanceDetail,
    type SubOrgFinanceDetail,
} from '@/routes/manage-custom-teams/-services/custom-team-services';
import { StatCard } from '@/routes/manage-custom-teams/sub-orgs/-components/sub-org-summary-cards';
import { humanizeStatus } from '@/routes/manage-custom-teams/-utils/status-display';
import { getPaymentOptions } from '@/services/payment-options';
import type { PaymentOptionApi } from '@/types/payment';
import { getCurrencySymbol } from '@/routes/settings/-components/Payment/utils/utils';
import { formatPlanPrice } from '@/utils/finance-utils';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { subOrgPermission } from '@/lib/display-settings/sub-org-module';
import { fmtMoney } from './sub-org-analytics-panel';

/**
 * Only the two fields the plan label needs off the org-level invite; the endpoint returns
 * far more, and the panel's own copy of this query reads the rest.
 */
interface ScopedInviteRow {
    tag?: string | null;
    payment_type?: string | null;
    payment_option_id?: string | null;
}

/**
 * The headline figures beside the title on /manage-suborg-teams — the single-sub-org
 * counterpart to `SubOrgSummaryCards` on the Manage <SubOrgs> list, and deliberately the
 * same `StatCard` component so the two page headers cannot drift apart.
 *
 * Both queries reuse the exact query keys `SubOrgAnalyticsPanel` already mounts below,
 * so React Query serves them from one cache entry: the page still issues a single
 * request per endpoint, and the cards can never disagree with the panel.
 */
export function SubOrgStatCards({
    subOrgId,
    full = false,
}: {
    subOrgId: string;
    /**
     * Institute-admin drilldown. Adds the configured payment option's name and price to
     * the plan card — the parent institute's options are readable only by an institute
     * admin, which is why the sub-org-admin page leaves this off and falls back to the
     * raw payment type.
     */
    full?: boolean;
}) {
    const { t } = useTranslation('manageSuborgTeamsSubOrgStatCards');
    const instituteId = getCurrentInstituteId();
    // Outstanding is the sub-org admin's own dues to the parent institute; a role
    // without finance access sees the other three figures and no money at all.
    const canViewFinance = subOrgPermission('canViewFinance');

    // Both keys are byte-identical to the ones SubOrgAnalyticsPanel mounts below — that
    // sameness IS the deduplication, so neither may gain an extra segment. instituteId is
    // therefore deliberately absent from the finance key (it only disambiguates the parent
    // for the request; a sub-org id already identifies the row).
    const { data: finance, isLoading } = useQuery<SubOrgFinanceDetail>({
        // eslint-disable-next-line @tanstack/query/exhaustive-deps
        queryKey: ['sub-org-finance-detail', subOrgId],
        queryFn: () => getSubOrgFinanceDetail(subOrgId, instituteId || undefined),
        enabled: !!subOrgId,
    });

    const { data: scopedInvites = [] } = useQuery<ScopedInviteRow[]>({
        queryKey: ['sub-org-scoped-invites', subOrgId],
        queryFn: () => getScopedInvites(subOrgId),
        enabled: !!subOrgId,
    });

    // Same key and gate as the panel's copy, so the drilldown still fetches the options once.
    const { data: institutePaymentOptions = [] } = useQuery<PaymentOptionApi[]>({
        queryKey: ['sub-org-institute-payment-options', instituteId],
        queryFn: () =>
            getPaymentOptions({
                types: ['ONE_TIME', 'SUBSCRIPTION', 'FREE'],
                source: 'INSTITUTE',
                source_id: instituteId || '',
                require_approval: true,
                not_require_approval: true,
            }),
        enabled: !!instituteId && full,
        staleTime: 30000,
    });

    const admin = finance?.admin_payment;
    const seat = finance?.seat_usage;

    // The org-level SUB_ORG invite carries the plan a *future* admin will pay via, so a
    // sub-org whose invite is still unredeemed reads "Awaiting admin / ONE_TIME plan"
    // rather than a bare "No plan".
    const orgInvite = scopedInvites.find((r) => r?.tag === 'SUB_ORG') ?? scopedInvites[0];
    const configuredOption = institutePaymentOptions.find(
        (o) => o.id === orgInvite?.payment_option_id
    );
    const configuredPlan = configuredOption?.payment_plans?.[0];
    const configuredPriceLabel =
        configuredOption?.type === 'FREE'
            ? t('free')
            : configuredPlan
              ? `${getCurrencySymbol(configuredPlan.currency || '')}${formatPlanPrice(
                    configuredPlan.actual_price
                )}`
              : '';

    // A redeemed admin's own plan wins; otherwise name the option a future admin will pay
    // via. The enum branches stay raw and get the word "plan" appended ("CPO plan") —
    // humanizing turns the CPO acronym into "Cpo", and every other surface in this module
    // prints the payment type as the backend sends it. A configured option already carries
    // a human name, so it is printed as-is: "Starter Plan plan" reads like a typo.
    const planLabel = admin?.payment_type
        ? t('planLabel', { plan: admin.payment_type })
        : configuredOption?.name ||
          (orgInvite?.payment_type ? t('planLabel', { plan: orgInvite.payment_type }) : null);
    // The price is the CONFIGURED option's, i.e. what a future admin will pay. Printing it
    // next to a redeemed admin's own plan ("CPO plan · ₹5,000") states a number that has
    // nothing to do with what they owe, so it only rides along while the seat is empty.
    const planCaption = [planLabel || t('planStatus'), !admin?.payment_type && configuredPriceLabel]
        .filter(Boolean)
        .join(' · ');

    const statusValue = admin?.user_plan_status
        ? humanizeStatus(admin.user_plan_status)
        : planLabel
          ? t('awaitingAdmin')
          : t('noPlan');

    const seatValue =
        seat?.total != null ? `${seat.used ?? 0}/${seat.total}` : String(seat?.used ?? 0);

    // One dash everywhere while the shared query is in flight, rather than a row of
    // zeroes that reads as real data.
    const show = (value: string) => (isLoading ? '—' : value);

    return (
        <div className="flex flex-wrap gap-3">
            <StatCard
                tone="success"
                label={planCaption}
                value={show(statusValue)}
                icon={<CheckCircle className="size-5" />}
            />
            <StatCard
                tone="warning"
                label={t('totalLearners')}
                value={show(String(finance?.totals?.learner_count ?? 0))}
                icon={<UsersThree className="size-5" />}
            />
            <StatCard
                tone="info"
                label={t('totalSeats')}
                value={show(seatValue)}
                icon={<Users className="size-5" />}
            />
            {canViewFinance && (
                <StatCard
                    tone="primary"
                    label={t('adminOutstanding')}
                    value={show(fmtMoney(admin?.outstanding_amount))}
                    icon={<Wallet className="size-5" />}
                />
            )}
        </div>
    );
}
