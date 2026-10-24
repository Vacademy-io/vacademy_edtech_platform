import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Receipt, CalendarBlank, WarningCircle } from '@phosphor-icons/react';
import { getSubOrgFinanceDetail } from '@/routes/manage-custom-teams/-services/custom-team-services';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getValidSelectedSubOrgId, getFacultyAccessData } from '@/lib/auth/facultyAccessUtils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { formatInstituteMoney, resolveInstituteCurrency } from '@/utils/institute-currency';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The sub-org's plan/dues amounts carry no currency of their own, so they follow the institute's
// resolved currency and render unsymbolled when it cannot be determined (never a guessed ₹).

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

/**
 * SUB-ORG admin widget: the org's own subscription plan & dues (from
 * finance-detail.admin_payment). Renders ONLY when the sub-org actually has a
 * plan — no empty "No active plan" card cluttering the dashboard.
 */
export default function SubOrgActivityDuesWidget() {
    const { t } = useTranslation('dashboardSubOrgActivityDuesWidget');
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
    const instituteDetails = useInstituteDetailsStore((state) => state.instituteDetails);
    const currency = resolveInstituteCurrency(instituteDetails);
    const money = (n: number) => formatInstituteMoney(n, currency);

    if (!subOrgId || isError) return null;

    const ap = finance?.admin_payment;
    const planTotal = ap?.total_amount ?? 0;
    // Self-hide when there's no plan (once loaded) so the dashboard stays clean.
    if (!isLoading && (!ap || planTotal <= 0)) return null;

    const planPaid = ap?.paid_amount ?? 0;
    const outstanding = ap?.outstanding_amount ?? Math.max(planTotal - planPaid, 0);
    const planPct = planTotal > 0 ? Math.round((planPaid / planTotal) * 100) : 0;
    const pendingInstallments = ap?.pending_installments_count ?? 0;
    const nextDue = ap?.next_due;

    return (
        <Card className="p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                    <Receipt size={14} weight="duotone" />
                </span>
                <h3 className="text-sm font-semibold text-neutral-900">{t('heading')}</h3>
            </div>

            {isLoading ? (
                <Skeleton className="h-24 w-full rounded-md" />
            ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Plan payment progress */}
                    <div className="rounded-lg border border-neutral-200 p-3">
                        <div className="text-xs font-medium text-neutral-500">
                            {t('planPayment.label')}
                        </div>
                        <div className="mt-0.5 flex items-baseline gap-1.5">
                            <span className="text-xl font-semibold tabular-nums text-neutral-900">
                                {money(planPaid)}
                            </span>
                            <span className="text-xs text-neutral-500">
                                {t('planPayment.of', { amount: money(planTotal) })}
                            </span>
                        </div>
                        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                            <div
                                className="h-full rounded-full bg-primary-500"
                                style={{ width: `${Math.min(planPct, 100)}%` }}
                            />
                        </div>
                        <div className="mt-1.5 text-xs text-neutral-500">
                            {t('planPayment.percentPaid', { percent: planPct })}
                        </div>
                    </div>

                    {/* Dues */}
                    <div className="flex flex-col justify-center gap-2.5 rounded-lg border border-neutral-200 p-3">
                        <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-neutral-500">
                                <WarningCircle size={13} weight="duotone" className="text-amber-500" />
                                {t('dues.outstanding')}
                            </span>
                            <span className="font-semibold tabular-nums text-neutral-900">
                                {money(outstanding)}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-neutral-500">{t('dues.pendingInstallments')}</span>
                            <span className="font-semibold tabular-nums text-neutral-800">
                                {pendingInstallments}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 text-neutral-500">
                                <CalendarBlank size={12} weight="duotone" />
                                {t('dues.nextDue')}
                            </span>
                            <span className="font-medium text-neutral-700">
                                {nextDue?.due_date ? shortDate(nextDue.due_date) : '—'}
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </Card>
    );
}
