import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { SpinnerGap } from "@phosphor-icons/react";
import { usePaymentStatusDialog } from "@/hooks/use-payment-status";
import { DonationDialog } from "@/components/common/donation/DonationDialog";
import { SubscriptionPaymentDialog } from "./SubscriptionPaymentDialog";
import { OneTimePaymentDialog } from "./OneTimePaymentDialog";
import { FreePlanDialog } from "./FreePlanDialog";
import { FreeEnrollmentConfirmationDialog } from "./FreeEnrollmentConfirmationDialog";
import { EnrollmentPendingApprovalDialog } from "./EnrollmentPendingApprovalDialog";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface PaymentStatusAwareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packageSessionId: string;
  instituteId: string;
  token: string;
  courseTitle?: string;
  inviteCode?: string;
  onEnrollmentSuccess?: () => void;
}

/**
 * Enhanced enrollment dialog that uses payment status API to determine the correct dialog to show
 * This replaces the basic EnrollmentPaymentDialog with status-aware logic
 */
export const PaymentStatusAwareDialog: React.FC<PaymentStatusAwareDialogProps> = ({
  open,
  onOpenChange,
  packageSessionId,
  instituteId,
  token,
  courseTitle = getTerminology(ContentTerms.Course, SystemTerms.Course),
  inviteCode = "default",
  onEnrollmentSuccess,
}) => {
  // Use the payment status hook to determine dialog type
  const {
    dialogType,
    user_plan_status,
    learner_status,
    is_loading,
    error,
    refetch,
    shouldShowEnrollmentDialog,
    shouldShowPaymentDialog,
    shouldShowPendingDialog,
    isAlreadyEnrolled,
  } = usePaymentStatusDialog(packageSessionId);

  // Debug logging
  useEffect(() => {
    if (open) {
      console.log('PaymentStatusAwareDialog - Status check:', {
        packageSessionId,
        dialogType,
        user_plan_status,
        learner_status,
        is_loading,
        error: error?.message,
      });
    }
  }, [open, packageSessionId, dialogType, user_plan_status, learner_status, is_loading, error]);

  // Show loading state
  if (is_loading) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 animate-fade-in flex items-center justify-center">
        <div className="bg-white rounded-lg p-6 max-w-sm">
          <div className="text-center space-y-4">
            <SpinnerGap className="w-8 h-8 animate-spin mx-auto text-primary-600" />
            <p className="text-gray-600">Checking payment status...</p>
          </div>
        </div>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 animate-fade-in flex items-center justify-center">
        <div className="bg-white rounded-lg p-6 max-w-sm">
          <div className="text-center space-y-4">
            <h3 className="text-lg font-semibold">Status Check Error</h3>
            <p className="text-red-600">{error.message}</p>
            <div className="space-x-2">
              <Button onClick={() => refetch()} variant="outline">
                Try Again
              </Button>
              <Button onClick={() => onOpenChange(false)} variant="ghost">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // User is already enrolled
  if (isAlreadyEnrolled) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 animate-fade-in flex items-center justify-center">
        <div className="bg-white rounded-lg p-6 max-w-sm">
          <div className="text-center space-y-4">
            <h3 className="text-lg font-semibold">Already Enrolled</h3>
            <p className="text-gray-600">
              You are already enrolled in this {getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}.
            </p>
            <Button onClick={() => onOpenChange(false)} variant="outline">
              Close
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // User has pending approval
  if (shouldShowPendingDialog) {
    return (
      <EnrollmentPendingApprovalDialog
        open={open}
        onOpenChange={onOpenChange}
        courseTitle={courseTitle}
      />
    );
  }

  // Common props for all payment dialogs
  const commonProps = {
    packageSessionId,
    instituteId,
    token,
    courseTitle,
    inviteCode,
    onEnrollmentSuccess,
  };

  // Route to appropriate dialog based on payment status
  switch (dialogType) {
    case 'enrollment':
      // Show the original enrollment flow for users without active plans
      return <EnrollmentPaymentDialog {...commonProps} open={open} onOpenChange={onOpenChange} />;
    
    case 'payment_required':
      // User has active plan but needs to complete payment
      // This would show a different dialog focused on payment completion
      return (
        <div className="fixed inset-0 z-50 bg-black/60 animate-fade-in flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 max-w-sm">
            <div className="text-center space-y-4">
              <h3 className="text-lg font-semibold">Payment Required</h3>
              <p className="text-gray-600">
                You have an active plan but need to complete payment for this {getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}.
              </p>
              <div className="space-x-2">
                <Button onClick={() => onOpenChange(false)} variant="outline">
                  Cancel
                </Button>
                <Button onClick={() => {
                  // Navigate to payment completion flow
                  console.log('Navigate to payment completion');
                }}>
                  Complete Payment
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    
    default:
      // Fallback to original enrollment dialog
      return <EnrollmentPaymentDialog {...commonProps} open={open} onOpenChange={onOpenChange} />;
  }
};

// Import the original EnrollmentPaymentDialog for fallback
import { EnrollmentPaymentDialog } from "./EnrollmentPaymentDialog";
