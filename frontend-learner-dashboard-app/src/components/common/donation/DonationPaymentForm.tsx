import React, { useRef, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SpinnerGap } from "@phosphor-icons/react";
import { LockSimple } from "@phosphor-icons/react";
import { SiStripe } from "react-icons/si"; // design-lint-ignore: brand logo, no phosphor equivalent
import { MyButton } from "@/components/design-system/button";
import { DonationSummary } from "./DonationSummary";

interface DonationPaymentFormProps {
  email: string;
  amount: number;
  currency: string;
  paymentPlanName?: string;
  cardElementError: string;
  cardElementReady: boolean;
  isApiLoading: boolean;
  paymentGatewayData?: any;
  cardElementRef: React.RefObject<HTMLDivElement>;
  onEdit: () => void;
  onPayment: () => void;
  onSkip: () => void;
}

export const DonationPaymentForm: React.FC<DonationPaymentFormProps> = ({
  email,
  amount,
  currency,
  paymentPlanName,
  cardElementError,
  cardElementReady,
  isApiLoading,
  paymentGatewayData,
  cardElementRef,
  onEdit,
  onPayment,
  onSkip,
}) => {
  const { t } = useTranslation("layoutCommonB");

  return (
    <>
      <DonationSummary
        amount={amount}
        currency={currency}
        paymentPlanName={paymentPlanName}
        email={email}
        showEmail={true}
        onEdit={onEdit}
      />
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs text-gray-600">{t("donation.paymentForm.cardDetails")}</label>
        </div>

        <div className={`border rounded p-3 text-sm w-full min-h-12 ${
          cardElementError ? 'border-red-500 bg-red-50' : 'border-gray-300'
        }`}>
          {!cardElementReady && (
            <div className="flex items-center justify-center h-full text-gray-500">
              <SpinnerGap className="w-4 h-4 animate-spin me-2" />
              {t("donation.paymentForm.loadingPaymentForm")}
            </div>
          )}
          <div ref={cardElementRef} className="w-full h-full" />
        </div>
        
        {cardElementError && (
          <div className="text-red-600 text-xs mb-2 mt-1">
            {cardElementError}
          </div>
        )}
        
        <div className="flex flex-col gap-2 w-full mt-3">
          <MyButton
            buttonType="primary"
            scale="medium"
            layoutVariant="default"
            className="w-full h-11 text-base flex items-center justify-center gap-2"
            onClick={onPayment}
            disabled={isApiLoading}
          >
            {isApiLoading ? (
              <>
                <SpinnerGap size={18} className="animate-spin" />
                {t("donation.paymentForm.processing")}
              </>
            ) : (
              <>
                <LockSimple size={18} weight="bold" />
                {t("donation.paymentForm.donateNow")}
              </>
            )}
          </MyButton>
          <MyButton
            buttonType="secondary"
            scale="medium"
            layoutVariant="default"
            className="w-full h-10 text-sm border-none"
            onClick={onSkip}
            disabled={isApiLoading}
          >
            {isApiLoading ? t("donation.paymentForm.processing") : t("donation.paymentForm.skip")}
          </MyButton>
        </div>
        <div className="text-xs text-gray-500 text-center mt-2 flex items-center justify-center gap-1">
          <LockSimple size={14} className="inline-block me-1" />
          {t("donation.paymentForm.securePaymentPoweredBy")}
          <span className="font-semibold flex items-center gap-1 ms-1">
            <SiStripe size={16} className="text-indigo-600" />
            {paymentGatewayData?.vendor || t("donation.paymentForm.stripe")}
          </span>
        </div>
      </div>
    </>
  );
};
