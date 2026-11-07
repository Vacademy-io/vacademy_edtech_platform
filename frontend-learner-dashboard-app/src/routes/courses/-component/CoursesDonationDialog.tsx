import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Cross2Icon } from "@radix-ui/react-icons";
import { MyButton } from "@/components/design-system/button";
import { SpinnerGap } from "@phosphor-icons/react";
import { fetchPaymentOptions, PaymentOption } from "../-services/payment-options-api";
import { getCurrencyWithPriority } from "@/utils/currency";
import {
  DonationHeader,
  DonationAmountStep,
  DonationEmailStep,
  DonationPaymentStep,
  DonationSuccessStep
} from "../-components/donation";

interface CoursesDonationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instituteId: string;
}

export const CoursesDonationDialog: React.FC<CoursesDonationDialogProps> = ({
  open,
  onOpenChange,
  instituteId,
}) => {
  const { t } = useTranslation("coursesRouteA");
  const [step, setStep] = useState<'select' | 'email' | 'payment' | 'success'>('select');
  const [selectedAmount, setSelectedAmount] = useState<number | 'other'>(0);
  const [customAmount, setCustomAmount] = useState('');
  const [email, setEmail] = useState('');
  const [validationError, setValidationError] = useState<string>('');
  const [isInitializing, setIsInitializing] = useState(false);
  const [paymentOptions, setPaymentOptions] = useState<PaymentOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'success' | 'failure' | null>(null);
  const [paymentError, setPaymentError] = useState<string>('');
  const [currency, setCurrency] = useState<string>('USD');

  const getCurrentAmount = (): number => {
    if (selectedAmount === 'other') {
      return parseFloat(customAmount) || 0;
    }
    return selectedAmount;
  };

  const handleAmountSelect = (amount: number | 'other') => {
    setSelectedAmount(amount);
    if (amount !== 'other') {
      setCustomAmount('');
    }
    setValidationError('');
  };

  const handleCustomAmountChange = (value: string) => {
    setCustomAmount(value);
    setSelectedAmount('other');
    setValidationError('');
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    setValidationError('');
  };

  const handleContinue = () => {
    if (step === 'select') {
      const amount = getCurrentAmount();
      
      // Require user to select or enter an amount
      if (amount <= 0) {
        setValidationError(t("donationDialog.errors.amountRequired"));
        return;
      }

      setStep('email');
    } else if (step === 'email') {
      // Validate email
      if (!email || !email.includes('@')) {
        setValidationError(t("donationDialog.errors.invalidEmail"));
        return;
      }
      
      setStep('payment');
    }
  };

  const handleBack = () => {
    if (step === 'email') {
      setStep('select');
    } else if (step === 'payment') {
      setStep('email');
    }
  };

  const handlePaymentSuccess = () => {
    setPaymentStatus('success');
    setPaymentError('');
    setStep('success');
  };

  const handlePaymentError = (error: string) => {
    setPaymentStatus('failure');
    setPaymentError(error);
    setStep('success'); // Show the result dialog (which will show failure UI)
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      setIsInitializing(true);
      setLoading(true);
      
      // Fetch payment options
      fetchPaymentOptions(instituteId).then((options) => {
        setPaymentOptions(options);
        
        // Extract currency from payment options
        if (options) {
          const extractedCurrency = getCurrencyWithPriority(
            options.payment_plans?.[0], // Use first payment plan if available
            options.payment_option_metadata_json || "",
            "USD"
          );
          setCurrency(extractedCurrency);
        }
        
        setLoading(false);
      }).catch((error) => {
        setLoading(false);
      });
      
      setTimeout(() => {
        setStep('select');
        setSelectedAmount(0);
        setCustomAmount('');
        setEmail('');
        setValidationError('');
        setPaymentStatus(null);
        setPaymentError('');
        setIsInitializing(false);
      }, 100);
    }
  }, [open, instituteId]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <DialogPrimitive.Content className="fixed start-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl focus:outline-none">
          <button
            className="absolute end-2 top-2 text-gray-400 hover:text-gray-700 focus:outline-none"
            onClick={handleClose}
            aria-label={t("donationDialog.closeAriaLabel")}
          >
            <Cross2Icon className="h-4 w-4" />
          </button>

          {isInitializing ? (
            <div className="text-center space-y-6">
              <div className="flex justify-center">
                <SpinnerGap className="w-12 h-12 text-blue-500 animate-spin" />
              </div>
              <h2 className="text-xl font-semibold text-gray-700">{t("common.loading")}</h2>
            </div>
          ) : step === 'success' ? (
            <DonationSuccessStep
              amount={getCurrentAmount()}
              currency={currency}
              status={paymentStatus}
              error={paymentError}
              onClose={handleClose}
              onRetry={() => setStep('payment')}
            />
          ) : (
            <>
              <DonationHeader step={step} />

              {step === 'select' && (
                <DonationAmountStep
                  paymentOptions={paymentOptions}
                  loading={loading}
                  selectedAmount={selectedAmount}
                  customAmount={customAmount}
                  validationError={validationError}
                  onAmountSelect={handleAmountSelect}
                  onCustomAmountChange={handleCustomAmountChange}
                />
              )}

              {step === 'email' && (
                <DonationEmailStep
                  amount={getCurrentAmount()}
                  email={email}
                  validationError={validationError}
                  onEmailChange={handleEmailChange}
                  onBack={handleBack}
                />
              )}

              {step === 'payment' && (
                <DonationPaymentStep
                  amount={getCurrentAmount()}
                  currency={currency}
                  email={email}
                  instituteId={instituteId}
                  onSuccess={handlePaymentSuccess}
                  onError={handlePaymentError}
                  onBack={handleBack}
                />
              )}

              {(step === 'select' || step === 'email') && (
                <div className="flex flex-col gap-2 w-full mt-3">
                  <MyButton
                    buttonType="primary"
                    scale="medium"
                    layoutVariant="default"
                    className="w-full h-11 text-base"
                    onClick={handleContinue}
                    disabled={false}
                  >
                    {t("donationDialog.continueButton")}
                  </MyButton>
                </div>
              )}
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};