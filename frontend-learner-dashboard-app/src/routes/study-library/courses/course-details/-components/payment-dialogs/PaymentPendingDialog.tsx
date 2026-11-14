import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Cross2Icon } from "@radix-ui/react-icons";
import { MyButton } from "@/components/design-system/button";
import { Clock, CreditCard } from "@phosphor-icons/react";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

export interface PaymentPendingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentData?: {
    amount: number;
    currency: string;
    courseName?: string;
    planName?: string;
    transactionId?: string;
  };
}

export const PaymentPendingDialog: React.FC<PaymentPendingDialogProps> = ({
  open,
  onOpenChange,
  paymentData,
}) => {
  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 animate-fade-in" />
        <DialogPrimitive.Content className="fixed start-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl focus:outline-none">
          <button
            className="absolute end-2 top-2 text-gray-400 hover:text-gray-700 focus:outline-none"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            <Cross2Icon className="h-4 w-4" />
          </button>

          <div className="text-center">
            {/* Pending Icon */}
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100">
              <Clock className="h-8 w-8 text-yellow-600" />
            </div>

            {/* Title */}
            <h2 className="mb-2 text-xl font-semibold text-gray-900">
              Payment Pending
            </h2>

            {/* Description */}
            <p className="mb-6 text-gray-600">
              Your payment is being processed. This may take a few minutes.
            </p>

            {/* Payment Details */}
            {paymentData && (
              <div className="mb-6 rounded-lg bg-gray-50 p-4 text-start space-y-stack">
                <h3 className="font-medium text-gray-900">
                  Payment Details
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Amount:</span>
                    <span className="font-medium text-gray-900">
                      {formatCurrency(paymentData.amount, paymentData.currency)}
                    </span>
                  </div>
                  {paymentData.courseName && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">{getTerminology(ContentTerms.Course, SystemTerms.Course)}:</span>
                      <span className="font-medium text-gray-900">
                        {paymentData.courseName}
                      </span>
                    </div>
                  )}
                  {paymentData.planName && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Plan:</span>
                      <span className="font-medium text-gray-900">
                        {paymentData.planName}
                      </span>
                    </div>
                  )}
                  {paymentData.transactionId && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Transaction ID:</span>
                      <span className="font-mono text-sm text-gray-900">
                        {paymentData.transactionId}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Status Message */}
            <div className="mb-6 rounded-lg bg-yellow-50 p-3">
              <div className="flex items-center justify-center gap-2 text-yellow-800">
                <CreditCard className="h-4 w-4" />
                <span className="text-sm font-medium">
                  Processing your payment...
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <MyButton
                buttonType="secondary"
                scale="medium"
                className="flex-1"
                onClick={() => onOpenChange(false)}
              >
                Close
              </MyButton>
              <MyButton
                buttonType="primary"
                scale="medium"
                className="flex-1"
                onClick={() => {
                  // Refresh the page to check payment status
                  window.location.reload();
                }}
              >
                Refresh Status
              </MyButton>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
