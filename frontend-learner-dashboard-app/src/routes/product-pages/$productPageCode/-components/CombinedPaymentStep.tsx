import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useProductPageStore } from '../-stores/product-page-store';
import { enrollForProductPage, handleGetProductPage } from '../-services/product-page-service';
import { checkoutErrorOf, type CheckoutError } from '../-utils/checkout-error';
import { enrollOutcomeOf } from '../-utils/enroll-outcome';
import {
    pushCombinedPaymentInitiated,
    pushCombinedEnrollmentSuccess,
    pushCombinedPaymentFailed,
} from '@/components/common/enroll-by-invite/-utils/gtm';
import { RazorpayCheckoutForm } from '@/components/common/enroll-by-invite/-components/razorpay-checkout-form';
import type { RazorpayCheckoutFormRef } from '@/components/common/enroll-by-invite/-components/razorpay-checkout-form';
import { ArrowLeft, SpinnerGap, ShieldCheck } from "@phosphor-icons/react";
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/types/naming-settings';
import type {
    ProductPageData,
    ProductPageEnrollResponse,
    ProductPageSettings,
} from '../-types/product-page-types';
import { resolveLearnerIdentity } from '../-utils/learner-identity';
import {
    clearPurchasedFromSiteCart,
    notePendingSiteCartPurchase,
    purchasedPackageSessionIds,
} from '../-utils/site-cart-housekeeping';

interface CombinedPaymentStepProps {
    pageData: ProductPageData;
    settings: ProductPageSettings;
    instituteId: string;
    vendor: string;
    primaryColor?: string;
    onBack: () => void;
    onSuccess: () => void;
}

type RazorpayOrderDetails = Parameters<RazorpayCheckoutFormRef['openPayment']>[0];

export const CombinedPaymentStep = ({
    pageData,
    settings,
    instituteId,
    vendor,
    primaryColor = '#2563eb', // design-lint-ignore: page-builder default color
    onBack,
    onSuccess,
}: CombinedPaymentStepProps) => {
    const { t, i18n } = useTranslation('productPages');
    const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const coursePlural = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
    const courseTermFor = (count: number) => (count === 1 ? course : coursePlural).toLocaleLowerCase();
    const {
        selectedPsOptionIds, registrationData, userId, couponCode, discountAmount,
        clearCoupon, finalPrice, utmParams, setLoginCode,
    } = useProductPageStore();

    const razorpayRef = useRef<RazorpayCheckoutFormRef | null>(null);
    const hasAutoEnrolledRef = useRef(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [paymentError, setPaymentError] = useState<string | null>(null);
    // Set once the server answers with a Razorpay order on a page drawn for
    // another gateway (see openRazorpayOrder): this basket pays through
    // Razorpay, so Razorpay's checkout takes the place of the page's Pay button.
    const [razorpayAnswered, setRazorpayAnswered] = useState(false);
    // That order, until Razorpay's checkout is ready to open it.
    const pendingRazorpayOrderRef = useRef<RazorpayOrderDetails | null>(null);
    const quietOpenRef = useRef<(() => void) | null>(null);
    const showsRazorpayCheckout = vendor === 'RAZORPAY' || razorpayAnswered;

    const selectedPageMappings = pageData.mappings.filter((m) =>
        selectedPsOptionIds.includes(m.ps_invite_payment_option_id)
    );
    const selectedMappings = selectedPageMappings.map((m) => ({
        ps_invite_payment_option_id: m.ps_invite_payment_option_id,
        payment_plan_id: m.payment_plan_id,
        amount: m.payment_plan?.actual_price ?? 0,
    }));
    // The site-wide cart is per institute; the page's and the route's are the
    // same institute in practice — both are tried (see site-cart-housekeeping).
    const cartInstituteIds = [pageData.institute_id, instituteId];

    const currency = (pageData.currency || pageData.mappings[0]?.payment_plan?.currency || 'INR') as string;
    const amount = finalPrice();

    // These three prefill the payment vendor's contact block, so they must be
    // the same values the enrolment is created under. Shared resolver: a label
    // search for "name" also matches "School Name". See learner-identity.
    const {
        email: userEmail,
        phone: userPhone,
        name: userName,
    } = resolveLearnerIdentity(Object.values(registrationData));

    const queryClient = useQueryClient();
    const priceChangedMessage = t(
        'common.priceChangedReload',
        'The price of a course in your cart has changed. Please review your cart and try again.'
    );
    // A 409 means a price on this page changed since it loaded: refetch it so
    // the cart shows the current prices before the learner tries again.
    const showCheckoutError = ({ message, priceChanged }: CheckoutError) => {
        setPaymentError(message);
        pushCombinedPaymentFailed(message, vendor, utmParams);
        if (priceChanged) {
            void queryClient.invalidateQueries({
                queryKey: handleGetProductPage(pageData.code, pageData.institute_id).queryKey,
            });
        }
    };
    const failCheckout = (err: unknown, fallback: string) =>
        showCheckoutError(checkoutErrorOf(err, fallback, priceChangedMessage));

    /**
     * Opens Razorpay Checkout for an order the server created. On a page drawn
     * for Razorpay its checkout is on screen and opens the order at once. On a
     * store page whose first course sells through another gateway it is not:
     * the step switches to Razorpay's checkout, which opens the order as soon
     * as Razorpay has loaded — and whose Pay button is there should it not.
     */
    const openRazorpayOrder = (order: { orderId: string; keyId: string }) => {
        const details: RazorpayOrderDetails = {
            razorpayKeyId: order.keyId,
            razorpayOrderId: order.orderId,
            amount: amount * 100,
            currency,
            contact: userPhone,
            email: userEmail,
        };
        if (razorpayRef.current) {
            razorpayRef.current.openPayment(details);
            return;
        }
        pendingRazorpayOrderRef.current = details;
        setRazorpayAnswered(true);
    };

    // Razorpay's checkout hands over a fresh handle every time it renders; while
    // an order waits, each one tries to open it. Until Razorpay's script has
    // loaded the attempt fails — that is waiting, not an error, so what it
    // reports stays off the screen.
    const attachRazorpayCheckout = useCallback((handle: RazorpayCheckoutFormRef | null) => {
        razorpayRef.current = handle;
        const details = pendingRazorpayOrderRef.current;
        if (!handle || !details) return;
        let failed = false;
        quietOpenRef.current = () => {
            failed = true;
        };
        try {
            handle.openPayment(details);
        } finally {
            quietOpenRef.current = null;
        }
        if (!failed) pendingRazorpayOrderRef.current = null;
    }, []);

    const handleRazorpayError = (err: string) => {
        if (quietOpenRef.current) {
            quietOpenRef.current();
            return;
        }
        setPaymentError(err);
        setIsProcessing(false);
    };

    /**
     * Acts on the server's answer — the server, not this page, picks the
     * gateway (see enroll-outcome): follow a hosted payment page, open Razorpay
     * for an order still to be paid, or finish.
     */
    const settleEnrollment = async (result: ProductPageEnrollResponse, fallback: string) => {
        const outcome = enrollOutcomeOf(result);

        if (outcome.kind === 'redirect') {
            // The gateway confirms by webhook after the visitor has left;
            // note what this buys so the site cart can drop it once paid.
            await notePendingSiteCartPurchase({
                paymentLogId: result.payment_log_id,
                instituteIds: cartInstituteIds,
                packageSessionIds: purchasedPackageSessionIds(result, selectedPageMappings),
            });
            window.location.href = outcome.paymentUrl;
            return;
        }

        if (outcome.kind === 'unpayable') {
            failCheckout(null, fallback);
            return;
        }

        if (outcome.kind === 'razorpay') {
            // This page showed the basket as free and the server wants payment:
            // the page's prices are out of date. Show the current ones before
            // anyone is asked to pay them.
            if (amount <= 0) {
                // With a coupon in play the coupon may be what went out of date,
                // and refetching the page never corrects a coupon — every retry
                // would ask for another unpaid order. So it goes: the step shows
                // the price without it, and the learner can apply it again for
                // what it takes off now.
                if (discountAmount > 0) {
                    clearCoupon();
                    showCheckoutError({
                        message: t('cartStep.couponChanged', 'Cart changed — please re-apply your coupon.'),
                        priceChanged: true,
                    });
                    return;
                }
                showCheckoutError({ message: priceChangedMessage, priceChanged: true });
                return;
            }
            openRazorpayOrder(outcome);
            return;
        }

        // Synchronously here, not on the success screen: that screen may
        // redirect away. A no-op without a site cart.
        if (outcome.paid) {
            void clearPurchasedFromSiteCart(
                cartInstituteIds,
                purchasedPackageSessionIds(result, selectedPageMappings)
            );
        }

        setLoginCode(result.login_code ?? null);
        pushCombinedEnrollmentSuccess(amount, selectedPsOptionIds.length, utmParams);
        onSuccess();
    };

    const doEnroll = async (paymentInitiationRequest: Record<string, unknown>) => {
        setIsProcessing(true);
        setPaymentError(null);
        try {
            pushCombinedPaymentInitiated(amount, selectedPsOptionIds.length, vendor, utmParams);
            const result = await enrollForProductPage({
                coursePageCode: pageData.code,
                instituteId: pageData.institute_id,
                userId: userId || '',
                selectedMappings,
                couponCode: couponCode || undefined,
                registrationData,
                paymentInitiationRequest,
                utmParams,
            });
            await settleEnrollment(result, t('common.genericPaymentFailed'));
        } catch (err) {
            failCheckout(err, t('common.genericPaymentFailed'));
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRazorpaySuccess = async (razorpayData: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
    }) => {
        await doEnroll({
            vendor: 'RAZORPAY',
            amount,
            currency,
            razorpay_request: razorpayData,
        });
    };

    const handleFreeEnroll = () => {
        doEnroll({ vendor: 'FREE', amount: 0, currency });
    };

    // Auto-skip the payment step for free enrollments — mirrors the invite flow
    // (learner-invitation-response): when the total is 0, enroll immediately on
    // mount instead of waiting for a button click. The ref guards against
    // double-firing (React Strict Mode / re-renders).
    useEffect(() => {
        if (amount <= 0 && !hasAutoEnrolledRef.current && !isProcessing) {
            hasAutoEnrolledRef.current = true;
            handleFreeEnroll();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [amount]);

    const handleRazorpayPay = async () => {
        setIsProcessing(true);
        setPaymentError(null);
        // Paying by hand asks for a fresh order; one still waiting to open on
        // its own must not pop up over it.
        pendingRazorpayOrderRef.current = null;
        try {
            pushCombinedPaymentInitiated(amount, selectedPsOptionIds.length, vendor, utmParams);
            const result = await enrollForProductPage({
                coursePageCode: pageData.code,
                instituteId: pageData.institute_id,
                userId: userId || '',
                selectedMappings,
                couponCode: couponCode || undefined,
                registrationData,
                paymentInitiationRequest: {
                    vendor: 'RAZORPAY',
                    amount,
                    currency,
                    razorpay_request: {},
                },
                utmParams,
            });
            // Usually the Razorpay order this button asked for. On a store page
            // whose first selected course sells through another gateway the
            // server answers with that gateway instead: a payment page to
            // follow, or an enrolment that is already through.
            await settleEnrollment(result, t('common.couldNotInitiatePayment'));
        } catch (err) {
            failCheckout(err, t('common.couldNotInitiatePayment'));
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <>
            {/* Line items and totals live in CheckoutLayout's OrderSummaryPanel,
                which is on screen throughout checkout — this step shows only
                the payment action itself. */}
            <div className="px-5 py-6 sm:px-6">
                <div className="min-w-0">
                    <h1 className="mb-1 text-lg font-bold text-gray-900">{t('combinedPaymentStep.title')}</h1>
                    <p className="mb-6 text-caption text-gray-500">
                        {t('combinedPaymentStep.completeEnrollmentFor', {
                            count: selectedPsOptionIds.length,
                            course: courseTermFor(selectedPsOptionIds.length),
                        })}
                        {' · '}
                        {t('combinedPaymentStep.amountPayable', {
                            currency,
                            amount: amount.toLocaleString(i18n.language),
                        })}
                    </p>

                    {paymentError && (
                        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            {paymentError}
                        </div>
                    )}

                    {/* Vendor-specific payment UI — free path driven by amount only, not vendor label */}
                    {amount <= 0 ? (
                        // Free enrollment auto-completes on mount (see useEffect above);
                        // show a loading state, and only fall back to a retry button on error.
                        paymentError ? (
                            <button
                                type="button"
                                disabled={isProcessing}
                                onClick={handleFreeEnroll}
                                className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                            >
                                {isProcessing ? (
                                    <><SpinnerGap className="size-4 animate-spin" /> {t('combinedPaymentStep.completingEnrollment')}</>
                                ) : (
                                    t('combinedPaymentStep.retryEnrollment')
                                )}
                            </button>
                        ) : (
                            <div className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-5 py-3 text-sm font-semibold text-white">
                                <SpinnerGap className="size-4 animate-spin" /> {t('combinedPaymentStep.completingEnrollment')}
                            </div>
                        )
                    ) : showsRazorpayCheckout ? (
                        <>
                            <RazorpayCheckoutForm
                                ref={attachRazorpayCheckout}
                                error={paymentError}
                                amount={amount}
                                currency={currency}
                                userName={userName}
                                courseName={pageData.name}
                                courseDescription={t('combinedPaymentStep.courseDescriptionForGateway', {
                                    count: selectedPsOptionIds.length,
                                    course: courseTermFor(selectedPsOptionIds.length),
                                })}
                                onPaymentReady={handleRazorpaySuccess}
                                onError={handleRazorpayError}
                                isProcessing={isProcessing}
                            />
                            <button
                                type="button"
                                disabled={isProcessing}
                                onClick={handleRazorpayPay}
                                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                                style={{ backgroundColor: primaryColor }}
                            >
                                {isProcessing ? (
                                    <><SpinnerGap className="size-4 animate-spin" /> {t('combinedPaymentStep.openingPayment')}</>
                                ) : (
                                    t('common.pay', { currency, amount: amount.toLocaleString(i18n.language) })
                                )}
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            disabled={isProcessing}
                            onClick={() => doEnroll({ vendor, amount, currency })}
                            className="flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                            style={{ backgroundColor: primaryColor }}
                        >
                            {isProcessing ? (
                                <><SpinnerGap className="size-4 animate-spin" /> {t('common.processing')}</>
                            ) : (
                                t('common.pay', { currency, amount: amount.toLocaleString(i18n.language) })
                            )}
                        </button>
                    )}

                    <div className="mt-6 flex items-center justify-between">
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
            </div>
        </>
    );
};
