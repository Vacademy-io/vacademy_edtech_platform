import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CreditCard, Heart } from "@phosphor-icons/react";
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { SubscriptionPlanSection } from "./subscription-plan-sections";
import { getAllUniqueFeatures } from "./registration-step";
import { PaymentPlan } from "../-utils/helper";
import { OneTimePlanSection } from "./onetime-plan-section";
import { SelectedPayment } from "./types";
import { getCurrencySymbol } from "@/utils/currency";

interface DonationMetadata {
  allowCustomAmount: boolean;
  suggestedAmounts: string;
  minimumAmount: string;
}
interface PaymentOptions {
  id: string;
  name: string;
  description: string;
  currency: string;
  type: string;
  payment_options?: PaymentPlan[];
  // eslint-disable-next-line
  discount_json?: any;
  // eslint-disable-next-line
  option_metadata?: any;
}
interface PaymentSelectionStepProps {
  paymentOptions: PaymentOptions;
  selectedPayment: SelectedPayment | null;
  onPaymentSelect: (payment: SelectedPayment) => void;
  paymentType?: string;
  donationMetadata?: DonationMetadata;
  onAmountChange?: (amount: number) => void;
  onValidationChange?: (isValid: boolean) => void;
}

// Currency symbols come from the shared currency util so every flow stays in sync.
// Re-exported here because several enroll-flow files import it from this module.
export { getCurrencySymbol };

const PaymentSelectionStep = ({
  paymentOptions,
  selectedPayment,
  onPaymentSelect,
  paymentType,
  donationMetadata,
  onAmountChange,
  onValidationChange,
}: PaymentSelectionStepProps) => {
  const { t } = useTranslation("enrollmentA");
  const [customAmount, setCustomAmount] = useState<string>("");
  const [isDonation, setIsDonation] = useState(false);
  const hasInitialized = useRef(false);
  const hasAutoSelectedSinglePlan = useRef(false);

  useEffect(() => {
    setIsDonation(paymentType === "DONATION");
    if (
      paymentType === "DONATION" &&
      donationMetadata &&
      selectedPayment &&
      !hasInitialized.current
    ) {
      // Set default amount to minimum amount for donations
      const defaultAmount = donationMetadata.minimumAmount || "0";
      setCustomAmount(defaultAmount);

      // Update the selected payment with default amount only once
      const updatedPayment = {
        ...selectedPayment,
        amount: parseInt(defaultAmount),
      };
      onPaymentSelect(updatedPayment);
      onAmountChange?.(parseInt(defaultAmount));

      hasInitialized.current = true;
    }
  }, [paymentType, donationMetadata, selectedPayment, onPaymentSelect, onAmountChange]);

  // Reset initialization flag when payment type changes
  useEffect(() => {
    if (paymentType !== "DONATION") {
      hasInitialized.current = false;
    }
  }, [paymentType]);

  // Auto-select if there's only one plan and nothing is selected yet (must be at top level, not in renderRegularPaymentOptions)
  useEffect(() => {
    if (isDonation) return;
    if (hasAutoSelectedSinglePlan.current) return;
    const plans = paymentOptions?.payment_options || [];
    if (plans.length === 1 && !selectedPayment) {
      const only = plans[0];
      const upd: SelectedPayment = {
        ...only,
        type: paymentOptions?.type,
      } as unknown as SelectedPayment;
      onPaymentSelect(upd);
      hasAutoSelectedSinglePlan.current = true;
    }
  }, [isDonation, paymentOptions, selectedPayment, onPaymentSelect]);

  // Check if donation amount is valid for enabling next button
  useEffect(() => {
    if (isDonation && donationMetadata) {
      const minAmount = parseInt(donationMetadata.minimumAmount);
      const currentAmount = parseInt(customAmount) || 0;
      // Only enable next button when amount is valid (>= minimum and not empty)
      const isValid = currentAmount >= minAmount && customAmount !== "";
      onValidationChange?.(isValid);
    }
  }, [customAmount, isDonation, donationMetadata, onValidationChange]);

  const handleCustomAmountChange = (value: string) => {
    // Only allow whole numbers (no decimals)
    const wholeNumberValue = value.replace(/[^0-9]/g, "");
    setCustomAmount(wholeNumberValue);

    // Update the selected payment with custom amount only if it's valid
    if (selectedPayment && isDonation) {
      const numValue = parseInt(wholeNumberValue);
      const minAmount = donationMetadata
        ? parseInt(donationMetadata.minimumAmount)
        : 0;

      if (wholeNumberValue === "" || numValue >= minAmount) {
        const finalAmount = numValue || minAmount;
        const updatedPayment = {
          ...selectedPayment,
          amount: finalAmount,
        };
        onPaymentSelect(updatedPayment);
        onAmountChange?.(finalAmount);
      }
    }
  };

  const handleSuggestedAmountClick = (amount: number) => {
    const minAmount = donationMetadata
      ? parseInt(donationMetadata.minimumAmount)
      : 0;
    if (amount >= minAmount) {
      setCustomAmount(amount.toString());

      // Update the selected payment with suggested amount
      if (selectedPayment && isDonation) {
        const updatedPayment = {
          ...selectedPayment,
          amount: amount,
        };
        onPaymentSelect(updatedPayment);
        onAmountChange?.(amount);
      }
    }
  };

  const getSuggestedAmounts = (): number[] => {
    if (!donationMetadata?.suggestedAmounts) return [];

    return donationMetadata.suggestedAmounts
      .split(",")
      .map((amount) => parseFloat(amount.trim()))
      .filter((amount) => !isNaN(amount))
      .sort((a, b) => b - a); // Sort in descending order
  };

  const getFilteredSuggestedAmounts = (): number[] => {
    const amounts = getSuggestedAmounts();
    const minAmount = donationMetadata
      ? parseInt(donationMetadata.minimumAmount)
      : 0;
    return amounts.filter((amount) => amount >= minAmount);
  };

  const renderDonationSection = () => {
    if (!isDonation || !donationMetadata) return null;

    const filteredAmounts = getFilteredSuggestedAmounts();
    const minAmount = parseInt(donationMetadata.minimumAmount);

    return (
      <div className="space-y-6">
        {/* Donation Header */}
        <div className="flex items-start gap-2 sm:gap-3 mb-6">
          <div className="p-1.5 sm:p-2 bg-red-100 rounded-lg flex-shrink-0">
            <Heart className="w-5 h-5 sm:w-6 sm:h-6 text-red-600" />
          </div>
          <div>
            <h2 className="text-title-lg font-semibold text-gray-900 leading-tight">
              {t("paymentSelection.donation.title")}
            </h2>
            <p className="text-caption text-muted-foreground mt-1">
              {t("paymentSelection.donation.subtitle")}
            </p>
          </div>
        </div>

        <Separator className="mb-6" />

        {/* Suggested Amounts */}
        {filteredAmounts.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-subtitle font-semibold text-gray-900">
              {t("paymentSelection.donation.suggestedAmounts")}
            </h3>
            <div className="flex flex-wrap gap-3">
              {filteredAmounts.map((amount, index) => (
                <Badge
                  key={index}
                  variant={
                    customAmount === amount.toString() ? "default" : "outline"
                  }
                  className={`cursor-pointer px-4 py-2 text-base font-medium ${
                    customAmount === amount.toString()
                      ? "bg-blue-600 text-white hover:bg-blue-700"
                      : "bg-white text-gray-700 hover:bg-gray-50 border-gray-300"
                  }`}
                  onClick={() => handleSuggestedAmountClick(amount)}
                >
                  {getCurrencySymbol(selectedPayment?.currency || "GBP")}
                  {amount}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Custom Amount Input */}
        {donationMetadata.allowCustomAmount && (
          <div className="space-y-3">
            <h3 className="text-subtitle font-semibold text-gray-900">
              {t("paymentSelection.donation.customAmount")}
            </h3>
            <div className="relative">
              <span className="absolute start-3 top-1/2 transform -translate-y-1/2 text-gray-500 text-lg">
                {getCurrencySymbol(selectedPayment?.currency || "GBP")}
              </span>
              <input
                type="number"
                value={customAmount}
                onChange={(e) => handleCustomAmountChange(e.target.value)}
                min={minAmount}
                step="1"
                className="w-full ps-8 pe-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                placeholder={t("paymentSelection.donation.minimumPlaceholder", {
                  amount: `${getCurrencySymbol(selectedPayment?.currency || "GBP")}${minAmount}`,
                })}
              />
            </div>
            <p className="text-caption text-muted-foreground">
              {t("paymentSelection.donation.minimumAmount", {
                amount: `${getCurrencySymbol(selectedPayment?.currency || "GBP")}${minAmount}`,
              })}
            </p>
          </div>
        )}

        {/* Selected Donation Summary */}
        {selectedPayment && (
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-card">
              <div className="flex items-center justify-between">
                <span className="text-gray-700 font-medium">
                  {t("paymentSelection.donation.yourDonation")}
                </span>
                <span className="text-xl font-bold text-blue-600">
                  {getCurrencySymbol(selectedPayment.currency)}
                  {selectedPayment.amount}
                </span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  const renderRegularPaymentOptions = () => {
    if (isDonation) return null;

    return (
      <>
        <div className="flex items-start gap-2 sm:gap-3 mb-6">
          <div className="p-1.5 sm:p-2 bg-blue-100 rounded-lg flex-shrink-0">
            <CreditCard className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-title-lg font-semibold text-gray-900 leading-tight">
              {t("paymentSelection.regular.title")}
            </h2>
            <p className="text-caption text-muted-foreground mt-1">
              {t("paymentSelection.regular.subtitle")}
            </p>
          </div>
        </div>

        <Separator className="mb-6" />
        {paymentOptions?.type === "SUBSCRIPTION" && (
          <SubscriptionPlanSection
            payment_options={paymentOptions?.payment_options || []}
            currency={getCurrencySymbol(paymentOptions?.currency || "")}
            features={getAllUniqueFeatures(
              paymentOptions.payment_options || []
            )}
            discount_json={paymentOptions?.discount_json}
            selectedPayment={selectedPayment}
            onSelect={onPaymentSelect}
          />
        )}
        {paymentOptions?.type === "ONE_TIME" && (
          <OneTimePlanSection
            payment_options={paymentOptions?.payment_options || []}
            currency={getCurrencySymbol(paymentOptions?.currency || "")}
            discount_json={paymentOptions?.discount_json}
            selectedPayment={selectedPayment}
            onSelect={onPaymentSelect}
          />
        )}
      </>
    );
  };

  return (
    <Card className="shadow-lg w-full">
      <CardContent className="p-5 sm:p-card-lg">
        {renderDonationSection()}
        {renderRegularPaymentOptions()}
      </CardContent>
    </Card>
  );
};

export default PaymentSelectionStep;
