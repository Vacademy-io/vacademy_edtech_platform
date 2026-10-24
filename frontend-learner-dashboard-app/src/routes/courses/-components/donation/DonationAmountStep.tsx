import { SpinnerGap } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { PaymentOption } from "../../-services/payment-options-api";
import { getCurrencySymbol, getCurrencyWithPriority } from "@/utils/currency";

interface DonationAmountStepProps {
  paymentOptions: PaymentOption | null;
  loading: boolean;
  selectedAmount: number | 'other';
  customAmount: string;
  validationError: string;
  onAmountSelect: (amount: number | 'other') => void;
  onCustomAmountChange: (amount: string) => void;
}

export const DonationAmountStep = ({
  paymentOptions,
  loading,
  selectedAmount,
  customAmount,
  validationError,
  onAmountSelect,
  onCustomAmountChange
}: DonationAmountStepProps) => {
  const { t } = useTranslation("coursesRouteA");
  // Get suggested amounts from payment options
  const getSuggestedAmounts = (): number[] => {
    if (paymentOptions?.payment_option_metadata_json) {
      try {
        const metadata = JSON.parse(paymentOptions.payment_option_metadata_json);
        if (metadata?.donationData?.suggestedAmounts) {
          const amounts = metadata.donationData.suggestedAmounts
            .split(',')
            .map((amount: string) => parseFloat(amount.trim()))
            .filter((amount: number) => !isNaN(amount));
          
          if (amounts.length > 0) {
            return amounts;
          }
        }
      } catch (error) {
        // Silent error handling
      }
    }
    
    // Fallback to default amounts
    return [5, 10, 25, 50, 100];
  };

  const getMinAmount = (): number => {
    if (paymentOptions?.payment_option_metadata_json) {
      try {
        const metadata = JSON.parse(paymentOptions.payment_option_metadata_json);
        if (metadata?.donationData?.minimumAmount) {
          const minAmount = parseFloat(metadata.donationData.minimumAmount);
          if (!isNaN(minAmount)) {
            return minAmount;
          }
        }
      } catch (error) {
        // Silent error handling
      }
    }
    
    // Fallback to minimum of suggested amounts
    const amounts = getSuggestedAmounts();
    return Math.min(...amounts);
  };

  const suggestedAmounts = getSuggestedAmounts();
  const minAmount = getMinAmount();
  
  // Get currency from payment options
  const currency = getCurrencyWithPriority(
    paymentOptions?.payment_plans?.[0], // Use first payment plan if available
    paymentOptions?.payment_option_metadata_json || "",
    "USD"
  );
  const currencySymbol = getCurrencySymbol(currency);

  if (loading) {
    return (
      <div className="text-center py-8 space-y-4">
        <SpinnerGap className="w-8 h-8 text-blue-500 animate-spin mx-auto" />
        <p className="text-sm text-gray-600">{t("donation.amountStep.loadingOptions")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 justify-center mb-2">
        {suggestedAmounts.map((amount) => (
            <div
              key={amount}
              className={`h-11 min-w-24 flex items-center justify-center rounded border cursor-pointer select-none text-sm font-medium transition-colors duration-200 ${
                selectedAmount === amount ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-800 border-gray-300 hover:bg-blue-50'
              }`}
              onClick={() => onAmountSelect(amount)}
              role="button"
              tabIndex={0}
            >
              {currencySymbol}{amount}
            </div>
        ))}
        {selectedAmount !== 'other' && (
          <div
            className={`h-11 w-full flex items-center justify-center rounded border cursor-pointer select-none text-sm font-medium transition-colors duration-200 bg-white text-gray-800 border-gray-300 hover:bg-blue-50`}
            onClick={() => onAmountSelect('other')}
            role="button"
            tabIndex={0}
            style={{ gridColumn: 'span 2' }}
          >
            {t("donation.amountStep.other")}
          </div>
        )}
        {selectedAmount === 'other' && (
          <input
            type="number"
            min={minAmount}
            step="0.01"
            max="10000"
            placeholder={t("donation.amountStep.minAmountPlaceholder", { currencySymbol, minAmount })}
            className="border rounded p-2 text-xs w-full mt-1 mb-1 col-span-2 h-12"
            value={customAmount}
            onChange={(e) => onCustomAmountChange(e.target.value)}
            style={{ gridColumn: 'span 2' }}
          />
        )}
      </div>
      
      {/* Validation Error Message */}
      {validationError && (
        <div className="text-red-600 text-xs text-center mt-2">
          {validationError}
        </div>
      )}
    </>
  );
};
