/**
 * Plan checkout: review → billing details → autopay choice → redirect to the
 * hosted Razorpay page. On the way back (`resumePaymentId`) it only polls the
 * payment status until the webhook has activated the plan; the webhook is the
 * source of truth, this dialog just reflects it.
 *
 * Every amount comes from the server (storefront plan price, or the upgrade
 * quote). The dialog never computes what anyone pays.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CheckCircle,
    CircleNotch,
    DownloadSimple,
    Lightning,
    Warning,
} from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Switch } from '@/components/ui/switch';
import { formatDate } from '@/lib/formatters';
import { usePlatformBrand, supplierDisplayName } from '@/lib/platform-brand';
import {
    EMPTY_GST_BILLING,
    GstBillingFields,
    validatePlanBilling,
    type GstBillingValue,
} from '@/components/common/ai-credits/GstBillingFields';
import { fetchOrderStatus } from '@/services/ai-credits/credit-pack-services';
import {
    apiErrorCode,
    changePlan,
    downloadBillingDocumentPdf,
    isLiveSubscription,
    loadStorefront,
    newIdempotencyKey,
    planReturnUrl,
    saveBillingProfile,
    startPlanCheckout,
    useInvalidatePlanQueries,
    normalizeIndianMobile,
    type AutopayMethod,
    type Storefront,
    type StorefrontPlan,
    type UpgradeQuote,
} from '@/services/ai-plans/storefront';
import { AutopayFields } from './AutopayFields';
import {
    aboveAutopayCeiling,
    formatMinor,
    priceLines,
    taxRatePct,
} from '@/services/ai-plans/format';
import { errorMessageKey } from './plan-ui';
import { pollDelayMs, rememberPendingPlanPayment } from './plan-payment-return';

export type CheckoutKind = 'NEW' | 'UPGRADE';

interface PlanCheckoutDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    storefront: Storefront;
    /** The plan being bought. Null only when resuming after the redirect. */
    plan: StorefrontPlan | null;
    kind: CheckoutKind;
    /** Set when coming back from Razorpay: skip the form, poll this payment. */
    resumePaymentId?: string | null;
}

type Phase = 'form' | 'launching' | 'awaiting' | 'success' | 'error';

/** After this long in the foreground the dialog says "we'll email you"; polling continues. */
const FOREGROUND_WAIT_MS = 60_000;

function billingFromStorefront(sf: Storefront): GstBillingValue {
    const b = sf.billing_profile;
    return {
        ...EMPTY_GST_BILLING,
        gstin: b?.gstin ?? '',
        stateCode: b?.state_code ?? '',
        legalName: b?.legal_name ?? '',
        address: b?.address ?? '',
        email: b?.billing_email ?? '',
    };
}

export function PlanCheckoutDialog({
    open,
    onOpenChange,
    instituteId,
    storefront,
    plan,
    kind,
    resumePaymentId,
}: PlanCheckoutDialogProps) {
    const { t } = useTranslation('aiPlans');
    const brand = usePlatformBrand(instituteId);
    const invalidate = useInvalidatePlanQueries();

    const [phase, setPhase] = useState<Phase>('form');
    const [billing, setBilling] = useState<GstBillingValue>(() =>
        billingFromStorefront(storefront)
    );
    const [billingError, setBillingError] = useState<string | null>(null);
    const [errorKey, setErrorKey] = useState<string | null>(null);
    const [autopay, setAutopay] = useState(true);
    const [autopayMethod, setAutopayMethod] = useState<AutopayMethod>('UPI');
    const [contact, setContact] = useState('');
    const [contactError, setContactError] = useState<string | null>(null);
    const [quote, setQuote] = useState<UpgradeQuote | null>(plan?.upgrade_quote ?? null);
    const [quoteFailed, setQuoteFailed] = useState(false);
    const [pollingFor, setPollingFor] = useState<string | null>(null);
    const [slow, setSlow] = useState(false);
    const [invoice, setInvoice] = useState<{ id: string; number: string | null } | null>(null);
    const [downloading, setDownloading] = useState(false);
    const idempotencyKey = useRef<string>(newIdempotencyKey());

    const autopayAvailable =
        kind === 'NEW' &&
        !!plan &&
        storefront.autopay.enabled &&
        plan.autopay_eligible !== false &&
        !aboveAutopayCeiling(plan.price.total_minor, storefront.autopay.max_debit_minor);
    const autopayTooHigh =
        kind === 'NEW' &&
        !!plan &&
        storefront.autopay.enabled &&
        aboveAutopayCeiling(plan.price.total_minor, storefront.autopay.max_debit_minor);

    // Fresh state on every open.
    useEffect(() => {
        if (!open) return;
        idempotencyKey.current = newIdempotencyKey();
        setBilling(billingFromStorefront(storefront));
        setBillingError(null);
        setErrorKey(null);
        setAutopay(true);
        setAutopayMethod('UPI');
        setContactError(null);
        setQuote(plan?.upgrade_quote ?? null);
        setQuoteFailed(false);
        setSlow(false);
        setInvoice(null);
        if (resumePaymentId) {
            setPollingFor(resumePaymentId);
            setPhase('awaiting');
        } else {
            setPollingFor(null);
            setPhase('form');
        }
        // storefront is intentionally read at open time only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, resumePaymentId, plan?.plan_version_id]);

    // Upgrade without a quote in the catalog: ask the server for one (dry run).
    useEffect(() => {
        if (!open || kind !== 'UPGRADE' || !plan || quote || resumePaymentId) return;
        let cancelled = false;
        changePlan({
            instituteId,
            action: 'UPGRADE',
            planVersionId: plan.plan_version_id,
            dryRun: true,
        })
            .then((res) => {
                if (cancelled) return;
                if (res.quote) setQuote(res.quote);
                else setQuoteFailed(true);
            })
            .catch(() => {
                if (!cancelled) setQuoteFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [open, kind, plan, quote, instituteId, resumePaymentId]);

    // Poll the payment until the webhook has fulfilled it (backs off, stops at 10 min).
    useEffect(() => {
        if (phase !== 'awaiting' || !pollingFor) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const started = Date.now();
        const slowTimer = setTimeout(() => !cancelled && setSlow(true), FOREGROUND_WAIT_MS);

        const tick = async () => {
            let paid = false;
            let failed = false;
            try {
                const status = await fetchOrderStatus(pollingFor);
                paid = status.payment_status === 'PAID';
                failed = status.payment_status === 'FAILED';
                if (paid && status.invoice_id) {
                    setInvoice({ id: status.invoice_id, number: status.invoice_number });
                }
            } catch {
                // Status endpoint unavailable: fall back to the storefront —
                // a live plan with nothing left to pay means it went through.
                const sf = await loadStorefront(instituteId, { force: true });
                paid = !!sf && isLiveSubscription(sf.subscription) && !sf.open_charge;
            }
            if (cancelled) return;
            if (paid) {
                await loadStorefront(instituteId, { force: true });
                invalidate();
                setPhase('success');
                return;
            }
            if (failed) {
                setErrorKey('errors.paymentFailed');
                setPhase('error');
                return;
            }
            const delay = pollDelayMs(Date.now() - started);
            if (delay !== null) timer = setTimeout(tick, delay);
        };
        void tick();
        return () => {
            cancelled = true;
            clearTimeout(slowTimer);
            if (timer) clearTimeout(timer);
        };
    }, [phase, pollingFor, instituteId, invalidate]);

    const lines = useMemo(
        () => (plan ? priceLines(plan.price, plan.period_months, t) : null),
        [plan, t]
    );
    const payTotal =
        kind === 'UPGRADE' ? quote?.total_minor ?? null : plan ? plan.price.total_minor : null;
    const currency = plan?.price.currency ?? 'INR';
    const supplierName = supplierDisplayName(
        storefront.supplier,
        brand.mode,
        t('checkout.supplierFallback')
    );
    const legalName = storefront.supplier.legal_name ?? supplierName;

    const handlePay = async () => {
        if (!plan) return;
        const problem = validatePlanBilling(billing);
        if (problem) {
            setBillingError(t(`billing.errors.${problem}`));
            return;
        }
        if (kind === 'UPGRADE' && payTotal === null) return;
        const useAutopay = autopayAvailable && autopay;
        const mobile = useAutopay ? normalizeIndianMobile(contact) : null;
        if (useAutopay && !mobile) {
            setContactError(t('autopay.mobileInvalid'));
            return;
        }
        setBillingError(null);
        setContactError(null);
        setErrorKey(null);
        setPhase('launching');
        try {
            await saveBillingProfile(instituteId, billing);
            const res =
                kind === 'NEW'
                    ? await startPlanCheckout({
                          instituteId,
                          planVersionId: plan.plan_version_id,
                          autopay: useAutopay,
                          autopayMethod: useAutopay ? autopayMethod : undefined,
                          contact: mobile ?? undefined,
                          returnUrl: planReturnUrl(),
                          idempotencyKey: idempotencyKey.current,
                      })
                    : await changePlan({
                          instituteId,
                          action: 'UPGRADE',
                          planVersionId: plan.plan_version_id,
                          returnUrl: planReturnUrl(),
                      });
            if (res.mode === 'APPLIED') {
                // Nothing to pay (e.g. a tiny pro-rata amount): confirm from the server.
                await loadStorefront(instituteId, { force: true });
                invalidate();
                setPhase('success');
                return;
            }
            if (!res.url) {
                setErrorKey('errors.linkUnavailable');
                setPhase('error');
                return;
            }
            rememberPendingPlanPayment(res.platform_payment_id);
            window.location.assign(res.url);
        } catch (e) {
            const code = apiErrorCode(e);
            if (code === 'BUYER_STATE_REQUIRED' || code === 'INVALID_GSTIN') {
                setBillingError(t(errorMessageKey(code)));
                setPhase('form');
                return;
            }
            setErrorKey(errorMessageKey(code));
            setPhase('error');
        }
    };

    const heading =
        phase === 'awaiting' || phase === 'success'
            ? t('checkout.confirmTitle')
            : kind === 'UPGRADE'
              ? t('checkout.upgradeTitle', { plan: brand.scrubText(plan?.name ?? '') })
              : t('checkout.title', { plan: brand.scrubText(plan?.name ?? '') });

    const footer = (
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {phase === 'form' && (
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={!plan || payTotal === null}
                        onClick={handlePay}
                    >
                        {payTotal !== null
                            ? t('checkout.pay', { amount: formatMinor(payTotal, currency) })
                            : t('checkout.payPending')}
                    </MyButton>
                </>
            )}
            {(phase === 'success' || phase === 'error' || (phase === 'awaiting' && slow)) && (
                <MyButton buttonType="primary" scale="medium" onClick={() => onOpenChange(false)}>
                    {t('actions.done')}
                </MyButton>
            )}
        </div>
    );

    return (
        <MyDialog
            open={open}
            onOpenChange={(o) => phase !== 'launching' && onOpenChange(o)}
            heading={heading}
            footer={footer}
            dialogWidth="max-w-xl"
        >
            <div className="space-y-4 p-4 sm:p-6">
                {phase === 'form' && plan && (
                    <>
                        <section className="rounded-xl border border-neutral-200 bg-white p-4">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <p className="text-subtitle font-semibold text-neutral-900">
                                    {brand.scrubText(plan.name)}
                                </p>
                                {lines && (
                                    <p className="text-sm font-medium text-neutral-700">
                                        {lines.headline}
                                    </p>
                                )}
                            </div>
                            <p className="mt-1 text-caption text-neutral-500">
                                {kind === 'NEW'
                                    ? t('checkout.startsOnPayment', { period: lines?.period ?? '' })
                                    : quote
                                      ? t('checkout.upgradeToday', {
                                            amount: formatMinor(
                                                quote.total_minor ?? quote.base_minor,
                                                currency
                                            ),
                                            date: quote.service_end
                                                ? formatDate(quote.service_end)
                                                : '',
                                        })
                                      : quoteFailed
                                        ? t('checkout.quoteFailed')
                                        : t('checkout.quoteLoading')}
                            </p>
                            <PriceBreakdown
                                base={
                                    kind === 'NEW'
                                        ? plan.price.base_minor
                                        : quote?.base_minor ?? null
                                }
                                tax={
                                    kind === 'NEW' ? plan.price.tax_minor : quote?.tax_minor ?? null
                                }
                                total={payTotal}
                                currency={currency}
                                taxLabel={
                                    plan.price.tax_label ??
                                    (taxRatePct(plan.price) !== null
                                        ? t('checkout.gstRate', { rate: taxRatePct(plan.price) })
                                        : t('checkout.gst'))
                                }
                            />
                            {kind === 'NEW' && (
                                <p className="mt-2 text-2xs text-neutral-500">
                                    {t('checkout.anchorNote')}
                                </p>
                            )}
                        </section>

                        <GstBillingFields
                            value={billing}
                            onChange={(patch) => {
                                setBilling((b) => ({ ...b, ...patch }));
                                setBillingError(null);
                            }}
                            error={billingError}
                            showIdentity
                            stateRequired
                        />

                        {kind === 'NEW' && storefront.autopay.enabled && (
                            <section className="rounded-xl border border-neutral-200 bg-white p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
                                            <Lightning
                                                className="size-4 text-primary-500"
                                                weight="fill"
                                            />
                                            {t('autopay.title')}
                                        </p>
                                        <p className="mt-0.5 text-xs text-neutral-500">
                                            {t('autopay.explain')}
                                        </p>
                                    </div>
                                    <Switch
                                        checked={autopayAvailable && autopay}
                                        disabled={!autopayAvailable}
                                        onCheckedChange={(v) => setAutopay(v)}
                                        aria-label={t('autopay.title')}
                                    />
                                </div>
                                {autopayAvailable && autopay && (
                                    <AutopayFields
                                        method={autopayMethod}
                                        onMethod={setAutopayMethod}
                                        contact={contact}
                                        onContact={(v) => {
                                            setContact(v);
                                            setContactError(null);
                                        }}
                                        error={contactError}
                                    />
                                )}
                                <p className="mt-2 text-2xs text-neutral-500">
                                    {autopayTooHigh
                                        ? t('autopay.aboveCeiling', {
                                              amount: formatMinor(
                                                  storefront.autopay.max_debit_minor,
                                                  'INR'
                                              ),
                                          })
                                        : t('autopay.ceilingNote', {
                                              amount: formatMinor(
                                                  storefront.autopay.max_debit_minor,
                                                  'INR'
                                              ),
                                          })}
                                </p>
                            </section>
                        )}

                        <p className="text-caption text-neutral-500">
                            {t('checkout.supplierLine', {
                                supplier: supplierName,
                                legal: legalName,
                            })}
                        </p>
                    </>
                )}

                {phase === 'launching' && (
                    <div className="flex flex-col items-center gap-3 py-12">
                        <CircleNotch className="size-8 animate-spin text-primary-500" />
                        <p className="text-sm text-neutral-600">{t('checkout.launching')}</p>
                    </div>
                )}

                {phase === 'awaiting' && (
                    <div className="flex flex-col items-center gap-3 py-12 text-center">
                        <CircleNotch className="size-8 animate-spin text-primary-500" />
                        <p className="text-sm font-medium text-neutral-800">
                            {t('checkout.confirming')}
                        </p>
                        <p className="max-w-sm text-xs text-neutral-500">
                            {slow ? t('checkout.slow') : t('checkout.confirmingHint')}
                        </p>
                    </div>
                )}

                {phase === 'success' && (
                    <SuccessView
                        instituteId={instituteId}
                        invoice={invoice}
                        downloading={downloading}
                        setDownloading={setDownloading}
                    />
                )}

                {phase === 'error' && (
                    <div className="flex flex-col items-center gap-3 py-10 text-center">
                        <div className="flex size-14 items-center justify-center rounded-full bg-warning-50">
                            <Warning className="size-8 text-warning-600" weight="fill" />
                        </div>
                        <p className="text-base font-semibold text-neutral-900">
                            {t('checkout.errorTitle')}
                        </p>
                        <p className="max-w-sm text-sm text-neutral-600">
                            {t(errorKey ?? 'errors.generic', brand.vars)}
                        </p>
                    </div>
                )}
            </div>
        </MyDialog>
    );
}

function PriceBreakdown({
    base,
    tax,
    total,
    currency,
    taxLabel,
}: {
    base: number | null;
    tax: number | null;
    total: number | null;
    currency: string;
    taxLabel: string;
}) {
    const { t } = useTranslation('aiPlans');
    const fmt = (v: number | null) => (v === null ? '…' : formatMinor(v, currency));
    return (
        <dl className="mt-3 space-y-1 border-t border-dashed border-neutral-200 pt-3 text-sm">
            <div className="flex justify-between gap-3 text-neutral-600">
                <dt>{t('checkout.base')}</dt>
                <dd className="tabular-nums">{fmt(base)}</dd>
            </div>
            {tax !== 0 && (
                <div className="flex justify-between gap-3 text-neutral-600">
                    <dt>{taxLabel}</dt>
                    <dd className="tabular-nums">{fmt(tax)}</dd>
                </div>
            )}
            <div className="flex justify-between gap-3 font-semibold text-neutral-900">
                <dt>{t('checkout.total')}</dt>
                <dd className="tabular-nums">{fmt(total)}</dd>
            </div>
        </dl>
    );
}

function SuccessView({
    instituteId,
    invoice,
    downloading,
    setDownloading,
}: {
    instituteId: string;
    invoice: { id: string; number: string | null } | null;
    downloading: boolean;
    setDownloading: (v: boolean) => void;
}) {
    const { t } = useTranslation('aiPlans');
    const [failed, setFailed] = useState(false);
    return (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-success-50">
                <CheckCircle className="size-9 text-success-600" weight="fill" />
            </div>
            <p className="text-base font-semibold text-neutral-900">{t('checkout.successTitle')}</p>
            <p className="max-w-sm text-sm text-neutral-600">{t('checkout.successBody')}</p>
            {invoice && (
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    disable={downloading}
                    onClick={async () => {
                        setDownloading(true);
                        setFailed(false);
                        try {
                            await downloadBillingDocumentPdf(instituteId, {
                                id: invoice.id,
                                doc_type: 'INVOICE',
                                number: invoice.number ?? invoice.id,
                            });
                        } catch {
                            setFailed(true);
                        } finally {
                            setDownloading(false);
                        }
                    }}
                >
                    <DownloadSimple className="me-1.5 size-4" weight="bold" />
                    {t('invoices.downloadInvoice')}
                </MyButton>
            )}
            {failed && <p className="text-xs text-danger-600">{t('invoices.downloadFailed')}</p>}
        </div>
    );
}
