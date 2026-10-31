/**
 * Settings → AI → Plan & billing. Rendered only when the storefront GET
 * succeeded for this admin (AiSettings decides); otherwise the read-only
 * AiPlanSection stays exactly as before.
 *
 *  - no live plan  → plan catalog (subscribe)
 *  - live/pending  → manage view, with "Compare plans" opening the catalog
 *  - always        → what the current plan covers (AiPlanSection) and the
 *                    plan invoices / credit notes
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { SealCheck } from '@phosphor-icons/react';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
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
import { getInstituteId } from '@/constants/helper';
import { formatDate } from '@/lib/formatters';
import { containsBrandWord, usePlatformBrand } from '@/lib/platform-brand';
import { isPlanInEffect, useAiPlanQuery } from '@/components/common/ai-credits/aiPlan';
import { PlanBillingDocuments } from '@/components/common/ai-credits/PlanBillingDocuments';
import {
    apiErrorCode,
    changePlan,
    loadStorefront,
    useInvalidatePlanQueries,
    useStorefrontQuery,
    type PlanAction,
    type StorefrontPlan,
} from '@/services/ai-plans/storefront';
import { AiPlanSection } from './AiPlanSection';
import { ManageSubscription } from './ManageSubscription';
import { PlanCatalog } from './PlanCatalog';
import { PlanCheckoutDialog, type CheckoutKind } from './PlanCheckoutDialog';
import { consumePlanPaymentReturn } from './plan-payment-return';
import { errorMessageKey } from './plan-ui';

interface CheckoutState {
    plan: StorefrontPlan | null;
    kind: CheckoutKind;
    resumePaymentId: string | null;
}

export function AiPlanBilling() {
    const { t } = useTranslation('aiPlans');
    const instituteId = getInstituteId() ?? '';
    const brand = usePlatformBrand(instituteId);
    const storefrontQuery = useStorefrontQuery(instituteId);
    const planQuery = useAiPlanQuery(instituteId);
    const invalidate = useInvalidatePlanQueries();
    const [checkout, setCheckout] = useState<CheckoutState | null>(null);
    const [downgrade, setDowngrade] = useState<StorefrontPlan | null>(null);
    const [contact, setContact] = useState(false);
    const [compare, setCompare] = useState(false);
    const [busy, setBusy] = useState(false);

    // Back from Razorpay: resume the confirmation (read once, URL scrubbed).
    useEffect(() => {
        const ret = consumePlanPaymentReturn();
        if (!ret) return;
        if (ret.paymentId) {
            setCheckout({ plan: null, kind: 'NEW', resumePaymentId: ret.paymentId });
        } else if (ret.mandate) {
            toast.message(t('autopay.returned'));
            void loadStorefront(instituteId, { force: true }).then(() => invalidate());
        }
        // Runs once per mount by design.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const sf = storefrontQuery.data;
    if (storefrontQuery.isLoading) {
        return (
            <div className="space-y-3">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-40 w-full rounded-xl" />
            </div>
        );
    }
    if (!sf) return <AiPlanSection />;

    const sub = sf.subscription;
    const hasPlan = !!sub && ['PENDING', 'TRIAL', 'ACTIVE', 'GRACE'].includes(sub.status);
    const showCatalog = !hasPlan || compare;
    // Never show a platform-branded address on a neutral (white-labelled) screen.
    const supportEmail =
        sf.supplier.support_email &&
        !(brand.mode === 'NEUTRAL' && containsBrandWord(sf.supplier.support_email))
            ? sf.supplier.support_email
            : null;

    const onChoose = (plan: StorefrontPlan, action: PlanAction) => {
        if (action === 'SUBSCRIBE') setCheckout({ plan, kind: 'NEW', resumePaymentId: null });
        else if (action === 'UPGRADE')
            setCheckout({ plan, kind: 'UPGRADE', resumePaymentId: null });
        else if (action === 'DOWNGRADE') setDowngrade(plan);
        else if (action === 'CONTACT_SALES') setContact(true);
    };

    const confirmDowngrade = async () => {
        if (!downgrade) return;
        setBusy(true);
        try {
            await changePlan({
                instituteId,
                action: 'DOWNGRADE',
                planVersionId: downgrade.plan_version_id,
            });
            await loadStorefront(instituteId, { force: true });
            invalidate();
            toast.success(
                t('downgrade.done', {
                    plan: brand.scrubText(downgrade.name),
                    date: sub?.period_end ? formatDate(sub.period_end) : '',
                })
            );
            setCompare(false);
        } catch (e) {
            toast.error(t(errorMessageKey(apiErrorCode(e)), brand.vars));
        } finally {
            setBusy(false);
            setDowngrade(null);
        }
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                    <SealCheck className="size-5 text-primary-500" weight="fill" />
                    <h3 className="text-h3 font-semibold text-neutral-700">{t('heading')}</h3>
                </div>
                <p className="text-body text-neutral-500">
                    {hasPlan ? t('subheadingManage') : t('subheadingCatalog')}
                </p>
            </div>

            {hasPlan && (
                <ManageSubscription
                    instituteId={instituteId}
                    storefront={sf}
                    onComparePlans={() => setCompare((v) => !v)}
                />
            )}

            {showCatalog && (
                <section className="space-y-3">
                    {hasPlan && (
                        <div className="flex items-center justify-between gap-2">
                            <h4 className="text-subtitle font-semibold text-neutral-800">
                                {t('catalog.compareTitle')}
                            </h4>
                            <MyButton
                                buttonType="text"
                                scale="small"
                                onClick={() => setCompare(false)}
                            >
                                {t('actions.close')}
                            </MyButton>
                        </div>
                    )}
                    {!hasPlan && (
                        <h4 className="text-subtitle font-semibold text-neutral-800">
                            {t('catalog.title')}
                        </h4>
                    )}
                    <PlanCatalog storefront={sf} onChoose={onChoose} busy={busy} />
                </section>
            )}

            {hasPlan && isPlanInEffect(planQuery.data) && (
                <section className="space-y-2">
                    <AiPlanSection embedded />
                </section>
            )}

            <PlanBillingDocuments instituteId={instituteId} />

            {checkout && (
                <PlanCheckoutDialog
                    open
                    onOpenChange={(o) => {
                        if (!o) {
                            setCheckout(null);
                            setCompare(false);
                        }
                    }}
                    instituteId={instituteId}
                    storefront={sf}
                    plan={checkout.plan}
                    kind={checkout.kind}
                    resumePaymentId={checkout.resumePaymentId}
                />
            )}

            <AlertDialog open={!!downgrade} onOpenChange={(o) => !o && !busy && setDowngrade(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t('downgrade.title', { plan: brand.scrubText(downgrade?.name ?? '') })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('downgrade.body', {
                                plan: brand.scrubText(downgrade?.name ?? ''),
                                date: sub?.period_end ? formatDate(sub.period_end) : '',
                            })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={busy}>{t('actions.keep')}</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={busy}
                            onClick={(e) => {
                                e.preventDefault();
                                void confirmDowngrade();
                            }}
                        >
                            {t('downgrade.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={contact} onOpenChange={setContact}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('contact.title', brand.vars)}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {supportEmail
                                ? t('contact.bodyEmail', { ...brand.vars, email: supportEmail })
                                : t('contact.body', brand.vars)}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogAction>{t('actions.ok')}</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
