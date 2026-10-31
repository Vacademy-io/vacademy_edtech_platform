import React from "react";
import { useTranslation } from "react-i18next";
import { formatCurrency, getCurrencySymbol } from "../../../routes/study-library/courses/course-details/-services/enrollment-api";

interface DonationAmountSelectorProps {
  selectedAmount: number | 'other';
  customAmount: string;
  validationError: string;
  donationAmounts: number[];
  minimumAmount: number;
  currency: string;
  onAmountSelect: (amount: number | 'other') => void;
  onCustomAmountChange: (amount: string) => void;
}

export const DonationAmountSelector: React.FC<DonationAmountSelectorProps> = ({
  selectedAmount,
  customAmount,
  validationError,
  donationAmounts,
  minimumAmount,
  currency,
  onAmountSelect,
  onCustomAmountChange,
}) => {
  const { t } = useTranslation("layoutCommonB");
  // Check if the current amount selection is valid
  const isAmountValid = () => {
    if (selectedAmount === 'other') {
      if (!customAmount || customAmount.trim() === '') {
        return false;
      }
      const amount = parseFloat(customAmount);
      if (isNaN(amount) || amount <= 0) {
        return false;
      }
      return amount >= minimumAmount;
    }
    return selectedAmount > 0;
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3 justify-center mb-2">
        {donationAmounts.map((amount) => (
          <div
            key={amount}
            className={`h-11 min-w-reg-100 flex items-center justify-center rounded border cursor-pointer select-none text-sm font-medium transition-colors duration-200
              ${selectedAmount === amount ? 'bg-primary-500 text-white border-primary-500' : 'bg-white text-gray-800 border-gray-300 hover:bg-primary-50'}`}
            onClick={() => onAmountSelect(amount)}
            role="button"
            tabIndex={0}
            onKeyPress={(e) => { if (e.key === 'Enter' || e.key === ' ') onAmountSelect(amount); }}
          >
            {formatCurrency(amount, currency)}
          </div>
        ))}
        {selectedAmount !== 'other' && (
          <div
            className={`h-11 w-full flex items-center justify-center rounded border cursor-pointer select-none text-sm font-medium transition-colors duration-200
              bg-white text-gray-800 border-gray-300 hover:bg-primary-50`}
            onClick={() => onAmountSelect('other')}
            role="button"
            tabIndex={0}
            onKeyPress={(e) => { if (e.key === 'Enter' || e.key === ' ') onAmountSelect('other'); }}
            style={{ gridColumn: 'span 2' }}
          >
            {t("donation.amountSelector.other")}
          </div>
        )}
        {selectedAmount === 'other' && (
          <input
            type="number"
            min="0"
            placeholder={t("donation.amountSelector.customAmountPlaceholder", {
              symbol: getCurrencySymbol(currency),
              minAmount: formatCurrency(minimumAmount, currency),
            })}
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
