/**
 * The admin's current AI plan: period, renewal, autopay, what is owed, and the
 * plan actions (change, cancel at period end, resume, billing details).
 * Every state shown here is the server's; the buttons only ask for changes.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowSquareOut,
    CalendarBlank,
    CreditCard,
    Lightning,
    PencilSimple,
    Warning,
} from '@phosphor-icons/react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { formatDate } from '@/lib/formatters';
import { usePlatformBrand } from '@/lib/platform-brand';
import {
    EMPTY_GST_BILLING,
    GstBillingFields,
    validatePlanBilling,
    type GstBillingValue,
} from '@/components/common/ai-credits/GstBillingFields';
import {
    aboveAutopayCeiling,
    effectivePrice,
    formatMinor,
    priceLines,
} from '@/services/ai-plans/format';
import {
    apiErrorCode,
    cancelMandate,
    changePlan,
    isPayableCharge,
    loadStorefront,
    normalizeIndianMobile,
    payCharge,
    planReturnUrl,
    saveBillingProfile,
    setupMandate,
    useInvalidatePlanQueries,
    type AutopayMethod,
    type ChangeAction,
    type OpenCharge,
    type Storefront,
} from '@/services/ai-plans/storefront';
import { AutopayFields } from './AutopayFields';
import { StatusChip, errorMessageKey, subscriptionStatusKey } from './plan-ui';
import { rememberPendingPlanPayment } from './plan-payment-return';

interface ManageSubscriptionProps {
    instituteId: string;
    storefront: Storefront;
    onComparePlans: () => void;
}

type Confirm = 'cancel' | 'resume' | 'autopayOff' | null;

function mandateReturnUrl(): string {
    try {
        const u = new URL(planReturnUrl());
        u.searchParams.set('plan_mandate', '1');
        return u.toString();
    } catch {
        return planReturnUrl();
    }
}

export function ManageSubscription({
    instituteId,
    storefront,
    onComparePlans,
}: ManageSubscriptionProps) {
    const { t } = useTranslation('aiPlans');
    const brand = usePlatformBrand(instituteId);
    const invalidate = useInvalidatePlanQueries();
    const [confirm, setConfirm] = useState<Confirm>(null);
    const [busy, setBusy] = useState(false);
    const [editBilling, setEditBilling] = useState(false);
    const [autopayDialog, setAutopayDialog] = useState(false);

    const sub = storefront.subscription;
    if (!sub) return null;
    const charge = storefront.open_charge;
    const status = subscriptionStatusKey(sub, charge);
    const currentPlan = storefront.plans.find((p) => p.is_current) ?? null;
    const currentPrice = currentPlan
        ? effectivePrice(currentPlan.price, sub.price_override_base_minor)
        : null;
    const lines =
        currentPlan && currentPrice ? priceLines(currentPrice, currentPlan.period_months, t) : null;
    const periodEnd = sub.period_end ? formatDate(sub.period_end) : null;
    const renewsAt = sub.renews_at ?? sub.period_end;
    const mandateActive = storefront.mandate?.status === 'ACTIVE';
    const canSetUpAutopay =
        storefront.autopay.enabled &&
        !mandateActive &&
        !sub.cancel_at_period_end &&
        (sub.status === 'ACTIVE' || sub.status === 'GRACE') &&
        !!currentPlan &&
        currentPlan.autopay_eligible !== false &&
        !aboveAutopayCeiling(
            (currentPrice ?? currentPlan.price).total_minor,
            storefront.autopay.max_debit_minor
        );

    const refresh = async () => {
        await loadStorefront(instituteId, { force: true });
        invalidate();
    };

    const runChange = async (action: ChangeAction, successKey: string) => {
        setBusy(true);
        try {
            await changePlan({ instituteId, action });
            await refresh();
            toast.success(t(successKey, { date: periodEnd ?? '' }));
        } catch (e) {
            toast.error(t(errorMessageKey(apiErrorCode(e)), brand.vars));
        } finally {
            setBusy(false);
            setConfirm(null);
        }
    };

    const turnOffAutopay = async () => {
        setBusy(true);
        try {
            await cancelMandate(instituteId);
            await refresh();
            toast.success(t('autopay.turnedOff'));
        } catch (e) {
            toast.error(t(errorMessageKey(apiErrorCode(e)), brand.vars));
        } finally {
            setBusy(false);
            setConfirm(null);
        }
    };

    return (
        <section className="space-y-3">
            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-subtitle font-semibold text-neutral-900">
                            {brand.scrubText(sub.plan_name || currentPlan?.name || '')}
                        </h4>
                        <StatusChip status={status} date={periodEnd} />
                    </div>
                    {lines && (
                        <p className="text-sm font-medium text-neutral-700">{lines.headline}</p>
                    )}
                </div>

                <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                    {sub.period_start && sub.period_end && (
                        <div>
                            <dt className="flex items-center gap-1 text-caption text-neutral-500">
                                <CalendarBlank className="size-3.5" />
                                {t('manage.currentPeriod')}
                            </dt>
                            <dd className="mt-0.5 font-medium text-neutral-800">
                                {t('manage.periodRange', {
                                    start: formatDate(sub.period_start),
                                    end: formatDate(sub.period_end),
                                })}
                            </dd>
                        </div>
                    )}
                    {sub.status !== 'PENDING' && (renewsAt || sub.end_at) && (
                        <div>
                            <dt className="text-caption text-neutral-500">
                                {sub.cancel_at_period_end
                                    ? t('manage.endsOn')
                                    : t('manage.renewsOn')}
                            </dt>
                            <dd className="mt-0.5 font-medium text-neutral-800">
                                {formatDate(
                                    (sub.cancel_at_period_end
                                        ? sub.end_at ?? sub.period_end
                                        : renewsAt) ?? ''
                                )}
                            </dd>
                        </div>
                    )}
                    {sub.status !== 'PENDING' && (
                        <div>
                            <dt className="flex items-center gap-1 text-caption text-neutral-500">
                                <Lightning className="size-3.5" />
                                {t('autopay.title')}
                            </dt>
                            <dd className="mt-0.5 font-medium text-neutral-800">
                                {mandateActive
                                    ? storefront.mandate?.method
                                        ? t('autopay.onWithMethod', {
                                              method: t(
                                                  `autopay.method.${storefront.mandate.method}`,
                                                  {
                                                      defaultValue: storefront.mandate.method,
                                                  }
                                              ),
                                          })
                                        : t('autopay.on')
                                    : storefront.mandate?.status === 'PENDING'
                                      ? t('autopay.pending')
                                      : storefront.mandate?.status === 'PAUSED'
                                        ? t('autopay.paused')
                                        : t('autopay.off')}
                            </dd>
                        </div>
                    )}
                </dl>

                {/* What is owed right now */}
                {sub.status === 'PENDING' && (
                    <Banner tone="info">
                        <span>{t('manage.pendingBody')}</span>
                        {isPayableCharge(charge) && (
                            <PayNowButton
                                instituteId={instituteId}
                                charge={charge}
                                onApplied={refresh}
                            />
                        )}
                    </Banner>
                )}
                {sub.status !== 'PENDING' && isPayableCharge(charge) && (
                    <Banner tone={sub.status === 'GRACE' ? 'danger' : 'warning'}>
                        <span>
                            {sub.status === 'GRACE'
                                ? t('manage.overdueBody', {
                                      amount: formatMinor(charge.total_minor, charge.currency),
                                      date: sub.grace_until ? formatDate(sub.grace_until) : '',
                                  })
                                : t('manage.dueBody', {
                                      amount: formatMinor(charge.total_minor, charge.currency),
                                      date: charge.due_at ? formatDate(charge.due_at) : '',
                                  })}
                        </span>
                        <PayNowButton
                            instituteId={instituteId}
                            charge={charge}
                            onApplied={refresh}
                        />
                    </Banner>
                )}
                {charge?.status === 'DEBIT_SCHEDULED' && (
                    <Banner tone="info">
                        <span>
                            {t('manage.debitScheduled', {
                                amount: formatMinor(charge.total_minor, charge.currency),
                                date: formatDate(charge.next_attempt_at ?? charge.due_at ?? ''),
                            })}
                        </span>
                    </Banner>
                )}
                {sub.pending_plan && (
                    <Banner tone="info">
                        <span>
                            {t('manage.pendingSwitch', {
                                plan: brand.scrubText(sub.pending_plan.name),
                                date: sub.pending_plan.effective_at
                                    ? formatDate(sub.pending_plan.effective_at)
                                    : periodEnd ?? '',
                            })}
                        </span>
                    </Banner>
                )}
                {sub.cancel_at_period_end && (
                    <p className="mt-3 text-caption text-neutral-500">
                        {t('manage.cancelledNote', { date: periodEnd ?? '' })}
                    </p>
                )}
                {sub.status !== 'PENDING' && !mandateActive && !sub.cancel_at_period_end && (
                    <p className="mt-3 text-caption text-neutral-500">
                        {t('manage.linkRenewalNote')}
                    </p>
                )}
                <p className="mt-1 text-2xs text-neutral-400">{t('manage.anchorNote')}</p>

                <div className="mt-4 flex flex-wrap gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={onComparePlans}
                        disable={busy}
                    >
                        {sub.status === 'PENDING'
                            ? t('actions.choosePlan')
                            : t('actions.changePlan')}
                    </MyButton>
                    {sub.status !== 'PENDING' && !sub.cancel_at_period_end && (
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            disable={busy}
                            onClick={() => setConfirm('cancel')}
                        >
                            {t('actions.cancelPlan')}
                        </MyButton>
                    )}
                    {sub.cancel_at_period_end && (
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            disable={busy}
                            onClick={() => setConfirm('resume')}
                        >
                            {t('actions.resume')}
                        </MyButton>
                    )}
                    {mandateActive && (
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            disable={busy}
                            onClick={() => setConfirm('autopayOff')}
                        >
                            {t('autopay.turnOff')}
                        </MyButton>
                    )}
                    {canSetUpAutopay && (
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            disable={busy}
                            onClick={() => setAutopayDialog(true)}
                        >
                            <CreditCard className="me-1.5 size-4" />
                            {t('autopay.setUp')}
                        </MyButton>
                    )}
                    <MyButton
                        buttonType="text"
                        scale="medium"
                        disable={busy}
                        onClick={() => setEditBilling(true)}
                    >
                        <PencilSimple className="me-1.5 size-4" />
                        {t('actions.editBilling')}
                    </MyButton>
                </div>
            </div>

            <AlertDialog
                open={confirm !== null}
                onOpenChange={(o) => !o && !busy && setConfirm(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {confirm === 'cancel'
                                ? t('confirm.cancelTitle')
                                : confirm === 'resume'
                                  ? t('confirm.resumeTitle')
                                  : t('confirm.autopayOffTitle')}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirm === 'cancel'
                                ? t('confirm.cancelBody', {
                                      plan: brand.scrubText(sub.plan_name),
                                      date: periodEnd ?? '',
                                  })
                                : confirm === 'resume'
                                  ? t('confirm.resumeBody', { date: periodEnd ?? '' })
                                  : t('confirm.autopayOffBody')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={busy}>{t('actions.keep')}</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={busy}
                            onClick={(e) => {
                                e.preventDefault();
                                if (confirm === 'cancel')
                                    void runChange('CANCEL', 'manage.cancelDone');
                                else if (confirm === 'resume')
                                    void runChange('RESUME', 'manage.resumeDone');
                                else void turnOffAutopay();
                            }}
                        >
                            {confirm === 'cancel'
                                ? t('actions.cancelPlan')
                                : confirm === 'resume'
                                  ? t('actions.resume')
                                  : t('autopay.turnOff')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {autopayDialog && (
                <AutopaySetupDialog
                    instituteId={instituteId}
                    onClose={() => setAutopayDialog(false)}
                />
            )}

            {editBilling && (
                <BillingProfileDialog
                    instituteId={instituteId}
                    storefront={storefront}
                    onClose={() => setEditBilling(false)}
                    onSaved={refresh}
                />
            )}
        </section>
    );
}

function Banner({
    tone,
    children,
}: {
    tone: 'info' | 'warning' | 'danger';
    children: React.ReactNode;
}) {
    const cls =
        tone === 'danger'
            ? 'border-danger-200 bg-danger-50 text-danger-700'
            : tone === 'warning'
              ? 'border-warning-200 bg-warning-50 text-warning-700'
              : 'border-info-200 bg-info-50 text-info-700';
    return (
        <div
            className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-caption ${cls}`}
        >
            {tone !== 'info' && <Warning className="size-4 shrink-0" weight="fill" />}
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
                {children}
            </div>
        </div>
    );
}

/**
 * Pay an open charge: the live hosted link when the storefront has one,
 * otherwise a fresh link from the facade (an expired renewal link, a failed
 * autopay debit). The payment id is remembered so the return can be confirmed.
 */
function PayNowButton({
    instituteId,
    charge,
    onApplied,
}: {
    instituteId: string;
    charge: OpenCharge;
    onApplied: () => Promise<void> | void;
}) {
    const { t } = useTranslation('aiPlans');
    const brand = usePlatformBrand(instituteId);
    const [busy, setBusy] = useState(false);

    const pay = async () => {
        setBusy(true);
        try {
            if (charge.link_url) {
                rememberPendingPlanPayment(charge.platform_payment_id);
                window.location.assign(charge.link_url);
                return;
            }
            const res = await payCharge(instituteId, charge.charge_id, planReturnUrl());
            if (res.mode === 'APPLIED') {
                await onApplied();
                toast.success(t('manage.alreadyPaid'));
                setBusy(false);
                return;
            }
            if (!res.url) throw new Error('no payment link');
            rememberPendingPlanPayment(res.platform_payment_id);
            window.location.assign(res.url);
        } catch (e) {
            toast.error(t(errorMessageKey(apiErrorCode(e)), brand.vars));
            setBusy(false);
        }
    };

    return (
        <button
            type="button"
            onClick={pay}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-primary-500 px-3 py-1.5 text-caption font-semibold text-white hover:bg-primary-400 disabled:opacity-60"
        >
            {t('actions.payNow')}
            <ArrowSquareOut className="size-3.5 rtl:-scale-x-100" />
        </button>
    );
}

function AutopaySetupDialog({
    instituteId,
    onClose,
}: {
    instituteId: string;
    onClose: () => void;
}) {
    const { t } = useTranslation('aiPlans');
    const brand = usePlatformBrand(instituteId);
    const [method, setMethod] = useState<AutopayMethod>('UPI');
    const [contact, setContact] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const start = async () => {
        const mobile = normalizeIndianMobile(contact);
        if (!mobile) {
            setError(t('autopay.mobileInvalid'));
            return;
        }
        setBusy(true);
        try {
            const res = await setupMandate(instituteId, mandateReturnUrl(), method, mobile);
            if (!res.url) throw new Error('no url');
            window.location.assign(res.url);
        } catch (e) {
            setError(t(errorMessageKey(apiErrorCode(e)), brand.vars));
            setBusy(false);
        }
    };

    return (
        <MyDialog
            open
            onOpenChange={(o) => !o && !busy && onClose()}
            heading={t('autopay.setUpTitle')}
            dialogWidth="max-w-md"
            footer={
                <div className="flex w-full justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={onClose}
                        disable={busy}
                    >
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton buttonType="primary" scale="medium" onClick={start} disable={busy}>
                        {t('autopay.continue')}
                    </MyButton>
                </div>
            }
        >
            <div className="space-y-2 p-4 sm:p-6">
                <p className="text-caption text-neutral-600">{t('autopay.explain')}</p>
                <p className="text-caption text-neutral-600">{t('autopay.setUpNote')}</p>
                <AutopayFields
                    method={method}
                    onMethod={setMethod}
                    contact={contact}
                    onContact={(v) => {
                        setContact(v);
                        setError(null);
                    }}
                    error={error}
                    disabled={busy}
                />
            </div>
        </MyDialog>
    );
}

function BillingProfileDialog({
    instituteId,
    storefront,
    onClose,
    onSaved,
}: {
    instituteId: string;
    storefront: Storefront;
    onClose: () => void;
    onSaved: () => Promise<void> | void;
}) {
    const { t } = useTranslation('aiPlans');
    const b = storefront.billing_profile;
    const [value, setValue] = useState<GstBillingValue>({
        ...EMPTY_GST_BILLING,
        gstin: b?.gstin ?? '',
        stateCode: b?.state_code ?? '',
        legalName: b?.legal_name ?? '',
        address: b?.address ?? '',
        email: b?.billing_email ?? '',
    });
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const save = async () => {
        const problem = validatePlanBilling(value);
        if (problem) {
            setError(t(`billing.errors.${problem}`));
            return;
        }
        setSaving(true);
        try {
            await saveBillingProfile(instituteId, value);
            await onSaved();
            toast.success(t('billing.saved'));
            onClose();
        } catch (e) {
            setError(t(errorMessageKey(apiErrorCode(e))));
        } finally {
            setSaving(false);
        }
    };

    return (
        <MyDialog
            open
            onOpenChange={(o) => !o && !saving && onClose()}
            heading={t('billing.editTitle')}
            dialogWidth="max-w-lg"
            footer={
                <div className="flex w-full justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={onClose}
                        disable={saving}
                    >
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton buttonType="primary" scale="medium" onClick={save} disable={saving}>
                        {t('actions.save')}
                    </MyButton>
                </div>
            }
        >
            <div className="space-y-2 p-4 sm:p-6">
                <GstBillingFields
                    value={value}
                    onChange={(patch) => {
                        setValue((v) => ({ ...v, ...patch }));
                        setError(null);
                    }}
                    error={error}
                    showIdentity
                    stateRequired
                    disabled={saving}
                />
                <p className="text-2xs text-neutral-500">{t('billing.futureOnly')}</p>
            </div>
        </MyDialog>
    );
}
