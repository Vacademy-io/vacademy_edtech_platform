import { ArrowLeft, ArrowRight, SpinnerGap } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { MyButton } from "@/components/design-system/button";
import { SelectedPayment } from "./types";
import { PaymentVendor } from "../-utils/payment-vendor-helper";

interface NavigationButtonsProps {
  currentStep: number;
  selectedPayment: SelectedPayment | null;
  onPrevious: () => void;
  onNext: () => void;
  onSubmitEnrollment: () => void;
  loading: boolean;
  paymentType?: string;
  donationAmountValid?: boolean;
  paymentVendor?: PaymentVendor;
  isPaymentDataReady?: boolean; // For Stripe processor or Eway encrypted data
  hasUnappliedReferral?: boolean;
  hidePrimaryButton?: boolean; // For CASHFREE inline card - pay via form's Pay Now
  // Autopay invites: the review step shows a mandate-consent checkbox; block Next
  // until the learner ticks it.
  autopayConsentPending?: boolean;
}

const NavigationButtons = ({
  currentStep,
  selectedPayment,
  onPrevious,
  onNext,
  onSubmitEnrollment,
  loading,
  paymentType,
  donationAmountValid,
  paymentVendor,
  isPaymentDataReady = false,
  hasUnappliedReferral = false,
  hidePrimaryButton = false,
  autopayConsentPending = false,
}: NavigationButtonsProps) => {
  const { t } = useTranslation("enrollmentA");
  const isNextDisabled = () => {
    if (loading) return true;
    if (hasUnappliedReferral) return true;

    // Step 2: Review — autopay invites require ticking the mandate consent first.
    if (currentStep === 2 && autopayConsentPending) return true;

    // Step 1: Payment selection
    if (currentStep === 1 && !selectedPayment) return true;
    if (currentStep === 1 && paymentType === "DONATION" && !donationAmountValid)
      return true;

    // Step 3: Payment details - check if payment data is ready based on vendor
    if (currentStep === 3) {
      // For Eway: require encrypted data
      if (paymentVendor === "EWAY" && !isPaymentDataReady) {
        return true;
      }
      // For Stripe: require payment processor
      if (paymentVendor === "STRIPE" && !isPaymentDataReady) {
        return true;
      }
      // For Razorpay: button is always enabled (order created on click)
      // Payment happens after button click, not before
    }

    return false;
  };

  return (
    // Pinned to the bottom of the viewport on phones. The plan step can run
    // several screens long once features are listed, so a learner who picks a
    // plan sees nothing happen and no way forward — the page reads as frozen
    // because the only Next button is far below the fold. Sticky keeps it in
    // reach the whole way down; from sm: up the page is short enough that the
    // bar sits inline as before.
    <div className="sticky bottom-0 z-30 sm:static p-4 sm:p-6 flex flex-col-reverse sm:flex-row items-center justify-between w-full gap-stack mt-4 bg-white border border-gray-200 rounded-lg shadow-lg sm:shadow-sm">
      <MyButton
        type="button"
        buttonType="secondary"
        scale="medium"
        layoutVariant="default"
        onClick={onPrevious}
        className="w-full sm:w-auto flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-3 px-6 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md"
      >
        <ArrowLeft className="w-4 h-4" />
        {t("navigationButtons.previous")}
      </MyButton>
      {!hidePrimaryButton && (
      <MyButton
        type="button"
        buttonType="primary"
        scale="medium"
        layoutVariant="default"
        onClick={
          currentStep === 3 || (currentStep === 2 && paymentType === "FREE")
            ? onSubmitEnrollment
            : onNext
        }
        disable={isNextDisabled()}
        className="w-full sm:w-auto flex items-center gap-2 bg-gradient-to-r from-primary-500 to-primary-500 text-white font-medium py-3 px-6 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md"
      >
        {loading
          ? t("navigationButtons.processing")
          : currentStep === 2 && paymentType === "FREE"
            ? t("navigationButtons.completeEnrollment")
            : currentStep === 3
              ? paymentVendor === "RAZORPAY"
                ? t("navigationButtons.payNow")
                : t("navigationButtons.confirmAndPay")
              : t("navigationButtons.next")}
        {loading ? (
          <SpinnerGap className="w-4 h-4 animate-spin" />
        ) : (
          <ArrowRight className="w-4 h-4" />
        )}
      </MyButton>
      )}
    </div>
  );
};

export default NavigationButtons;
