import { Envelope } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

interface DonationEmailStepProps {
  amount: number;
  email: string;
  validationError: string;
  onEmailChange: (email: string) => void;
  onBack: () => void;
}

export const DonationEmailStep = ({
  amount,
  email,
  validationError,
  onEmailChange,
  onBack
}: DonationEmailStepProps) => {
  const { t } = useTranslation("coursesRouteA");
  return (
    <>
      <div className="mb-2 bg-white border border-neutral-300 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold text-gray-700">{t("donation.summary.title")}</span>
        </div>
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="text-gray-600">{t("donation.summary.amountLabel")}</span>
          <span className="font-semibold text-gray-900">${amount}</span>
        </div>
        <button
          className="text-xs font-medium ms-auto block rounded border border-neutral-300 bg-white text-neutral-600 px-3 py-1 focus:outline-none transition-colors duration-200 hover:bg-blue-50/50 hover:border-blue-300"
          onClick={onBack}
          style={{ boxShadow: 'none', textDecoration: 'none' }}
        >
          {t("donation.summary.editButton")}
        </button>
      </div>

      <div className="mb-2">
        <label className="block text-xs text-gray-600 mb-1" htmlFor="donation-email">
          {t("donation.emailStep.emailLabel")}
        </label>
        <div className="relative">
          <span className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400">
            <Envelope size={16} />
          </span>
          <input
            id="donation-email"
            type="email"
            className={`border rounded ps-9 p-2 text-xs w-full h-10 ${
              validationError ? 'border-red-500 bg-red-50' : ''
            }`}
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder={validationError ? validationError : t("donation.emailStep.emailPlaceholder")}
          />
        </div>
        <p className="text-caption text-gray-400 mt-1">
          {t("donation.emailStep.receiptNote")}
        </p>
      </div>
    </>
  );
};
