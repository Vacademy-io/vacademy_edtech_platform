import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useProductPageStore } from '../-stores/product-page-store';
import { enrollCpoForProductPage, handleGetProductPage } from '../-services/product-page-service';
import { checkoutErrorOf } from '../-utils/checkout-error';
import {
    fetchCpoSchedule,
    fetchCpoDues,
    payCpoInstallments,
    mapCpoScheduleToDues,
    type CpoInstallmentDue,
} from '@/components/common/enroll-by-invite/-services/enroll-invite-services';
import { CpoInstallmentSelectionStep } from '@/components/common/enroll-by-invite/-components';
import { RazorpayCheckoutForm } from '@/components/common/enroll-by-invite/-components/razorpay-checkout-form';
import type { RazorpayCheckoutFormRef } from '@/components/common/enroll-by-invite/-components/razorpay-checkout-form';
import { ArrowLeft, SpinnerGap, ShieldCheck } from '@phosphor-icons/react';
import type { ProductPageData, ProductPageSettings } from '../-types/product-page-types';
import type { FieldValue } from '../-types/product-page-types';
import { resolveLearnerIdentity } from '../-utils/learner-identity';
import {
    clearPurchasedFromSiteCart,
    isPaidCpoPayment,
    notePendingSiteCartPurchase,
} from '../-utils/site-cart-housekeeping';

interface CpoInstallmentsCheckoutStepProps {
    pageData: ProductPageData;
    settings: ProductPageSettings;
    vendor: string;
    primaryColor?: string;
    onBack: () => void;
    onSuccess: () => void;
}

/** A failure this step explains itself, in words already translated. */
class CpoStepError extends Error {}

export const CpoInstallmentsCheckoutStep = ({
    pageData,
    settings,
    vendor,
    primaryColor = '#2563eb', // design-lint-ignore: page-builder default color
    onBack,
    onSuccess,
}: CpoInstallmentsCheckoutStepProps) => {
    const { t, i18n } = useTranslation('productPages');
    const {
        selectedPsOptionIds,
        registrationData,
        userId,
        cpoUserPlanId,
        cpoSelectedSfpIds,
        cpoSelectedTotal,
        cpoCustomAmount,
        setCpoEnrollResult,
        setCpoSelection,
        setCpoCustomAmount,
    } = useProductPageStore();

    const razorpayRef = useRef<RazorpayCheckoutFormRef>(null);
    const [templateDues, setTemplateDues] = useState<CpoInstallmentDue[]>([]);
    const [loadingSchedule, setLoadingSchedule] = useState(false);
    const [scheduleError, setScheduleError] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [paymentError, setPaymentError] = useState<string | null>(null);
    const scheduleFetched = useRef(false);
    // Stable ref for enrolled data — avoids stale closure in Razorpay handler
    const enrolledDataRef = useRef<{ userId: string; userPlanId: string } | null>(null);

    const currency = pageData.currency || 'INR';

    const cpoMapping = pageData.mappings.find(
        (m) =>
            selectedPsOptionIds.includes(m.ps_invite_payment_option_id) &&
            m.payment_option_type?.toUpperCase() === 'CPO'
    );
    // What this checkout enrols — leaves the site-wide cart once it succeeds.
    const cpoSessionIds = cpoMapping?.package_session_id ? [cpoMapping.package_session_id] : [];

    // Same resolver the submit calls use — a label search for "name" also
    // matches "School Name", and the first MATCH is not necessarily the first
    // ANSWER. See learner-identity.
    const { email: userEmail, name: userName } = resolveLearnerIdentity(
        Object.values(registrationData as Record<string, FieldValue>)
    );

    const payAmount = cpoCustomAmount !== undefined ? cpoCustomAmount : cpoSelectedTotal;

    const queryClient = useQueryClient();
    const priceChangedMessage = t(
        'common.priceChangedReload',
        'The price of a course in your cart has changed. Please review your cart and try again.'
    );
    /**
     * Why a payment step failed, as the combined checkout says it
     * (checkoutErrorOf): the server's own words when they were written for the
     * learner, else `fallback` — never the transport's "Request failed with
     * status code …". A 409 means the plan on this page changed since it
     * loaded (the server refuses the plan id the step sent): the page is
     * fetched again, so a retry sends the mapping's current plan.
     */
    const failPayment = (err: unknown, fallback: string) => {
        if (err instanceof CpoStepError) {
            setPaymentError(err.message);
            return;
        }
        const { message, priceChanged } = checkoutErrorOf(err, fallback, priceChangedMessage);
        setPaymentError(message);
        if (priceChanged) {
            void queryClient.invalidateQueries({
                queryKey: handleGetProductPage(pageData.code, pageData.institute_id).queryKey,
            });
        }
    };

    // On mount: fetch the CPO installment template (before enrollment)
    useEffect(() => {
        if (scheduleFetched.current) return;
        scheduleFetched.current = true;

        if (!cpoMapping?.payment_option_id) {
            setScheduleError(t('cpoInstallments.noCpoOptionFoundInSelection'));
            return;
        }

        setLoadingSchedule(true);
        fetchCpoSchedule(cpoMapping.payment_option_id)
            .then((cpoDto) => {
                setTemplateDues(mapCpoScheduleToDues(cpoDto));
            })
            .catch((err) => {
                setScheduleError(err instanceof Error ? err.message : t('cpoInstallments.failedToLoadSchedule'));
            })
            .finally(() => setLoadingSchedule(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /**
     * Enroll without payment (if not already done), fetch actual SFP dues to get
     * their IDs, then pay all pending SFPs with the user-selected amount as customAmount.
     */
    const doEnrollAndPay = async (buildPayRequest: (
        userId: string,
        userPlanId: string,
        sfpIds: string[],
    ) => Promise<void>) => {
        if (!cpoMapping) {
            setPaymentError(t('cpoInstallments.noCpoOptionFound'));
            return;
        }

        let currentUserId = enrolledDataRef.current?.userId || userId || '';
        let currentUserPlanId = enrolledDataRef.current?.userPlanId || cpoUserPlanId || '';

        if (!currentUserPlanId) {
            const result = await enrollCpoForProductPage({
                coursePageCode: pageData.code,
                instituteId: pageData.institute_id,
                psInvitePaymentOptionId: cpoMapping.ps_invite_payment_option_id,
                paymentPlanId: cpoMapping.payment_plan_id,
                registrationData: registrationData as Record<string, FieldValue>,
            });
            currentUserId = result.user_id;
            currentUserPlanId = result.user_plan_id;
            // Write to ref FIRST so Razorpay handler always reads fresh data
            enrolledDataRef.current = { userId: currentUserId, userPlanId: currentUserPlanId };
            setCpoEnrollResult(currentUserPlanId);
        } else {
            enrolledDataRef.current = { userId: currentUserId, userPlanId: currentUserPlanId };
        }

        if (!currentUserId || !currentUserPlanId) {
            throw new CpoStepError(t('cpoInstallments.enrollmentDataMissingRetryLater'));
        }

        // Fetch actual SFP rows to get their IDs
        const sfpDues = await fetchCpoDues({ userId: currentUserId, userPlanId: currentUserPlanId });
        const pendingSfpIds = sfpDues
            .filter((d) => d.status !== 'PAID' && d.status !== 'WAIVED')
            .map((d) => d.id);

        if (pendingSfpIds.length === 0) {
            throw new CpoStepError(t('cpoInstallments.noPendingInstallmentsFound'));
        }

        await buildPayRequest(currentUserId, currentUserPlanId, pendingSfpIds);
    };

    const handleRazorpayPay = async () => {
        setIsProcessing(true);
        setPaymentError(null);
        try {
            await doEnrollAndPay(async (resolvedUserId, resolvedUserPlanId, sfpIds) => {
                const result = await payCpoInstallments({
                    userId: resolvedUserId,
                    userPlanId: resolvedUserPlanId,
                    instituteId: pageData.institute_id,
                    studentFeePaymentIds: sfpIds,
                    customAmount: payAmount,
                    paymentVendor: 'RAZORPAY',
                    currency,
                    email: userEmail,
                    name: userName,
                });

                if (result?.order_id && result?.razorpay_key_id && razorpayRef.current) {
                    razorpayRef.current.openPayment({
                        razorpayKeyId: result.razorpay_key_id,
                        razorpayOrderId: result.order_id,
                        amount: payAmount * 100,
                        currency,
                        email: userEmail,
                    });
                }
            });
        } catch (err) {
            failPayment(err, t('common.couldNotInitiatePayment'));
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRazorpaySuccess = async (razorpayData: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
    }) => {
        setIsProcessing(true);
        setPaymentError(null);
        try {
            // Read from ref — always up-to-date even if this closure is stale
            const enrolled = enrolledDataRef.current;
            if (!enrolled?.userId || !enrolled?.userPlanId) {
                throw new CpoStepError(t('cpoInstallments.enrollmentDataMissingRetry'));
            }
            const sfpDues = await fetchCpoDues({ userId: enrolled.userId, userPlanId: enrolled.userPlanId });
            const pendingSfpIds = sfpDues
                .filter((d) => d.status !== 'PAID' && d.status !== 'WAIVED')
                .map((d) => d.id);

            await payCpoInstallments({
                userId: enrolled.userId,
                userPlanId: enrolled.userPlanId,
                instituteId: pageData.institute_id,
                studentFeePaymentIds: pendingSfpIds,
                customAmount: payAmount,
                paymentVendor: 'RAZORPAY',
                currency,
                email: userEmail,
                name: userName,
                razorpayPaymentData: razorpayData,
            });
            void clearPurchasedFromSiteCart([pageData.institute_id], cpoSessionIds);
            onSuccess();
        } catch (err) {
            failPayment(err, t('cpoInstallments.paymentConfirmationFailed'));
        } finally {
            setIsProcessing(false);
        }
    };

    const handleOtherVendorPay = async () => {
        setIsProcessing(true);
        setPaymentError(null);
        try {
            await doEnrollAndPay(async (resolvedUserId, resolvedUserPlanId, sfpIds) => {
                const result = await payCpoInstallments({
                    userId: resolvedUserId,
                    userPlanId: resolvedUserPlanId,
                    instituteId: pageData.institute_id,
                    studentFeePaymentIds: sfpIds,
                    customAmount: payAmount,
                    paymentVendor: vendor as 'STRIPE' | 'EWAY' | 'RAZORPAY' | 'CASHFREE',
                    currency,
                    email: userEmail,
                    name: userName,
                });

                if (result?.payment_url) {
                    // order_id is the payment log the gateway settles.
                    await notePendingSiteCartPurchase({
                        paymentLogId: result?.order_id,
                        instituteIds: [pageData.institute_id],
                        packageSessionIds: cpoSessionIds,
                    });
                    window.location.href = result.payment_url;
                } else {
                    // Only a confirmed payment clears the site cart. Anything
                    // else (a gateway still settling, or one whose payment page
                    // this step does not open) is noted against its payment
                    // log, so the course leaves the cart once it is paid.
                    if (isPaidCpoPayment(result)) {
                        void clearPurchasedFromSiteCart([pageData.institute_id], cpoSessionIds);
                    } else {
                        await notePendingSiteCartPurchase({
                            paymentLogId: result?.order_id,
                            instituteIds: [pageData.institute_id],
                            packageSessionIds: cpoSessionIds,
                        });
                    }
                    onSuccess();
                }
            });
        } catch (err) {
            failPayment(err, t('common.genericPaymentFailed'));
        } finally {
            setIsProcessing(false);
        }
    };

    const canPay = cpoSelectedSfpIds.length > 0 || (cpoCustomAmount !== undefined && cpoCustomAmount > 0);

    if (loadingSchedule) {
        return (
            <div className="flex min-h-reg-300 items-center justify-center">
                <div className="text-center space-y-3">
                    <SpinnerGap className="size-8 animate-spin text-primary-500 mx-auto" aria-hidden="true" />
                    <p className="text-sm text-gray-500">{t('cpoInstallments.loadingSchedule')}</p>
                </div>
            </div>
        );
    }

    if (scheduleError) {
        return (
            <div className="px-5 py-6 sm:px-6">
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
                    {scheduleError}
                </div>
                {!settings.disableBackNavigation && (
                    <button
                        type="button"
                        onClick={onBack}
                        className="mt-4 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
                    >
                        <ArrowLeft className="size-4" />
                        {t('common.back')}
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="px-5 py-6 sm:px-6 space-y-6">
            <div>
                <h1 className="text-xl font-bold text-gray-900">{t('cpoInstallments.selectInstallments.title')}</h1>
                <p className="mt-1 text-sm text-gray-500">
                    {t('cpoInstallments.selectInstallments.subtitle')}
                </p>
            </div>

            <CpoInstallmentSelectionStep
                dues={templateDues}
                currency={currency}
                selectedSfpIds={cpoSelectedSfpIds}
                onSelectionChange={setCpoSelection}
                customAmount={cpoCustomAmount}
                onCustomAmountChange={setCpoCustomAmount}
            />

            {paymentError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {paymentError}
                </div>
            )}

            {canPay && (
                <>
                    {vendor === 'RAZORPAY' ? (
                        <>
                            <RazorpayCheckoutForm
                                ref={razorpayRef}
                                error={paymentError}
                                amount={payAmount}
                                currency={currency}
                                userName=""
                                courseName={pageData.name}
                                courseDescription={t('cpoInstallments.installmentPaymentDescription')}
                                onPaymentReady={handleRazorpaySuccess}
                                onError={(err) => {
                                    setPaymentError(err);
                                    setIsProcessing(false);
                                }}
                                isProcessing={isProcessing}
                            />
                            <button
                                type="button"
                                disabled={isProcessing}
                                onClick={handleRazorpayPay}
                                className="flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                                style={{ backgroundColor: primaryColor }}
                            >
                                {isProcessing ? (
                                    <><SpinnerGap className="size-4 animate-spin" aria-hidden="true" /> {t('common.processing')}</>
                                ) : (
                                    t('common.pay', { currency, amount: payAmount.toLocaleString(i18n.language) })
                                )}
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            disabled={isProcessing}
                            onClick={handleOtherVendorPay}
                            className="flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                            style={{ backgroundColor: primaryColor }}
                        >
                            {isProcessing ? (
                                <><SpinnerGap className="size-4 animate-spin" aria-hidden="true" /> {t('common.processing')}</>
                            ) : (
                                t('common.pay', { currency, amount: payAmount.toLocaleString(i18n.language) })
                            )}
                        </button>
                    )}
                </>
            )}

            <div className="flex items-center justify-between">
                {!settings.disableBackNavigation ? (
                    <button
                        type="button"
                        onClick={onBack}
                        disabled={isProcessing}
                        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-40"
                    >
                        <ArrowLeft className="size-4" />
                        {t('common.back')}
                    </button>
                ) : <div />}
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <ShieldCheck className="size-3.5" />
                    {t('common.securedPayment')}
                </div>
            </div>
        </div>
    );
};
