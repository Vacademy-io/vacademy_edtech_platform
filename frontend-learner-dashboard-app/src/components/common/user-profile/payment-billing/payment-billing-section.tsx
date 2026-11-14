import { Suspense, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  CreditCard,
  CalendarBlank,
  Info,
  SpinnerGap,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { PaymentGatewayWrapper } from "@/components/common/enroll-by-invite/-components/payment-gateway-wrapper";
import type { PaymentVendor } from "@/components/common/enroll-by-invite/-utils/payment-vendor-helper";
import {
  PAYMENT_METHOD_SUMMARY_QUERY_KEY,
  fetchPaymentMethodSummary,
} from "./payment-method-services";
import { StripeCardUpdate } from "./stripe-card-update";
import { EwayCardUpdate } from "./eway-card-update";
import { BillingDetailsForm } from "./billing-details-form";
import { EnrollmentExpiryList } from "./enrollment-expiry-list";
import { SubscriptionMandateList } from "./subscription-mandate-list";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";

interface PaymentBillingSectionProps {
  instituteId: string;
  userId: string;
}

/**
 * "Payment & Billing" section on the learner edit-profile page: shows the
 * saved card charged by subscription renewals (update supported for Stripe
 * and eWay), editable billing details, and each enrollment's access expiry.
 */
export const PaymentBillingSection = ({
  instituteId,
  userId,
}: PaymentBillingSectionProps) => {
  // Reader-mode (native iOS): saved cards, autopay/subscriptions and access
  // expiry are paid-subscription surfaces Apple flags under Guideline 3.1.1 —
  // hide the whole section. The platform check is constant per session, so the
  // early return never changes hook order between renders.
  if (shouldHidePaidPurchaseUI()) return null;

  const { t } = useTranslation("userProfileExtra");
  const [isEditingCard, setIsEditingCard] = useState(false);
  const queryClient = useQueryClient();

  const {
    data: summary,
    isLoading,
    isError,
  } = useQuery({
    queryKey: [PAYMENT_METHOD_SUMMARY_QUERY_KEY, instituteId],
    queryFn: () => fetchPaymentMethodSummary(instituteId),
    enabled: Boolean(instituteId),
    staleTime: 60 * 1000,
  });

  const refreshSummary = () => {
    setIsEditingCard(false);
    queryClient.invalidateQueries({
      queryKey: [PAYMENT_METHOD_SUMMARY_QUERY_KEY, instituteId],
    });
  };

  const renderCardArea = () => {
    if (isLoading) {
      return (
        <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
          <SpinnerGap className="size-4 animate-spin" />
          {t("paymentBillingSection.loadingPayment")}
        </div>
      );
    }

    if (isError || !summary) {
      return (
        <div className="flex items-center gap-2 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
          <Info className="size-4 shrink-0" />
          {t("paymentBillingSection.unavailable")}
        </div>
      );
    }

    if (!summary.update_supported) {
      const message =
        summary.reason === "NO_CUSTOMER"
          ? t("paymentBillingSection.reason.noCustomer")
          : summary.reason === "GATEWAY_NOT_CONFIGURED"
            ? t("paymentBillingSection.reason.gatewayNotConfigured")
            : t("paymentBillingSection.reason.managedAtCheckout");
      return (
        <div className="flex items-center gap-2 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
          <Info className="size-4 shrink-0" />
          {message}
        </div>
      );
    }

    const cardBrand = summary.card_brand
      ? summary.card_brand.toUpperCase()
      : t("paymentBillingSection.defaultCardBrand");
    const cardLabel = summary.has_saved_payment_method
      ? `${cardBrand} •••• ${summary.card_last4 ?? "????"}`
      : t("paymentBillingSection.noCardOnFile");
    const expiryLabel =
      summary.card_expiry_month && summary.card_expiry_year
        ? t("paymentBillingSection.expires", {
            month: String(summary.card_expiry_month).padStart(2, "0"),
            year: summary.card_expiry_year,
          })
        : null;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <CreditCard className="size-6 text-primary-500" weight="duotone" />
            <div>
              <p className="text-sm font-medium text-gray-700">{cardLabel}</p>
              <p className="text-xs text-gray-500">
                {expiryLabel ?? t("paymentBillingSection.usedForRenewals")}
              </p>
            </div>
          </div>
          {!isEditingCard && (
            <MyButton
              type="button"
              scale="small"
              buttonType="secondary"
              layoutVariant="default"
              onClick={() => setIsEditingCard(true)}
            >
              {summary.has_saved_payment_method
                ? t("paymentBillingSection.updateCard")
                : t("paymentBillingSection.addCard")}
            </MyButton>
          )}
        </div>

        {isEditingCard && (
          <Suspense fallback={<DashboardLoader />}>
            <PaymentGatewayWrapper
              vendor={summary.vendor as PaymentVendor}
              instituteId={instituteId}
            >
              {summary.vendor === "STRIPE" ? (
                <StripeCardUpdate
                  instituteId={instituteId}
                  onUpdated={refreshSummary}
                  onCancel={() => setIsEditingCard(false)}
                />
              ) : (
                <EwayCardUpdate
                  instituteId={instituteId}
                  onUpdated={refreshSummary}
                  onCancel={() => setIsEditingCard(false)}
                />
              )}
            </PaymentGatewayWrapper>
          </Suspense>
        )}

        <div className="border-t border-gray-100 pt-4 space-y-stack">
          <p className="text-sm font-medium text-gray-700">
            {t("paymentBillingSection.billingDetailsLabel")}
          </p>
          <BillingDetailsForm
            instituteId={instituteId}
            billingDetails={summary.billing_details}
            onUpdated={refreshSummary}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Payment method + billing */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 border-b pb-2 text-lg font-semibold text-gray-900">
          <CreditCard size={20} className="text-primary-500" weight="bold" />
          <h3>{t("paymentBillingSection.title")}</h3>
        </div>
        {renderCardArea()}
      </div>

      {/* Auto-renewing subscriptions (cancel autopay per plan) */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 border-b pb-2 text-lg font-semibold text-gray-900">
          <ArrowsClockwise
            size={20}
            className="text-primary-500"
            weight="bold"
          />
          <h3>{t("paymentBillingSection.subscriptionsTitle")}</h3>
        </div>
        <SubscriptionMandateList instituteId={instituteId} />
      </div>

      {/* Enrollment expiry */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 border-b pb-2 text-lg font-semibold text-gray-900">
          <CalendarBlank
            size={20}
            className="text-secondary-500"
            weight="bold"
          />
          <h3>{t("paymentBillingSection.membershipTitle")}</h3>
        </div>
        <EnrollmentExpiryList instituteId={instituteId} userId={userId} />
      </div>
    </div>
  );
};
