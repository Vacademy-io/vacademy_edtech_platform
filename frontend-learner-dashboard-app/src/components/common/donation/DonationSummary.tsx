import React from "react";
import { useTranslation } from "react-i18next";
import { formatCurrency } from "../../../routes/study-library/courses/course-details/-services/enrollment-api";

interface DonationSummaryProps {
  amount: number;
  currency: string;
  paymentPlanName?: string;
  email?: string;
  showEmail?: boolean;
  onEdit: () => void;
}

export const DonationSummary: React.FC<DonationSummaryProps> = ({
  amount,
  currency,
  paymentPlanName,
  email,
  showEmail = false,
  onEdit,
}) => {
  const { t } = useTranslation("layoutCommonB");
  return (
    <div className="mb-2 bg-white border border-neutral-300 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-gray-700">{t("donation.summary.title")}</span>
      </div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-gray-600">{t("donation.summary.amount")}</span>
        <span className="font-semibold text-gray-900">{formatCurrency(amount, currency)}</span>
      </div>
      {paymentPlanName && (
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="text-gray-600">{t("donation.summary.plan")}</span>
          <span className="font-semibold text-gray-900">{paymentPlanName}</span>
        </div>
      )}
      {showEmail && email && (
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="text-gray-600">{t("donation.summary.email")}</span>
          <span className="font-semibold text-gray-900">{email}</span>
        </div>
      )}
      <button
        className="text-xs font-medium ms-auto block rounded border border-neutral-300 bg-white text-neutral-600 px-3 py-1 focus:outline-none transition-colors duration-200 hover:bg-primary-50/50 hover:border-primary-300"
        onClick={onEdit}
        style={{ boxShadow: 'none', textDecoration: 'none' }}
      >
        {t("donation.summary.edit")}
      </button>
    </div>
  );
};
