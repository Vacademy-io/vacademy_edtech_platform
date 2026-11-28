import React, { useState, useEffect, useCallback } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Cross2Icon } from "@radix-ui/react-icons";
import { SpinnerGap, Clock, CheckCircle, XCircle } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { fetchUserPlanStatus } from "@/services/payment-status-api";
import { getTokenFromStorage } from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface PaymentStatusPollingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packageSessionId: string;
  courseTitle: string;
  onPaymentSuccess?: (approvalRequired: boolean) => void;
  onPaymentFailed?: () => void;
  onClose?: () => void;
}

type PaymentStatus = 'PAYMENT_PENDING' | 'PAID' | 'FAILED' | 'UNKNOWN';
type LearnerStatus = 'INVITED' | 'PENDING_FOR_APPROVAL' | 'ACTIVE' | 'UNKNOWN';

interface PaymentStatusResponse {
  user_plan_status: string;
  learner_status: string;
  approval_required?: boolean;
}

export const PaymentStatusPollingDialog: React.FC<PaymentStatusPollingDialogProps> = ({
  open,
  onOpenChange,
  packageSessionId,
  courseTitle,
  onPaymentSuccess,
  onPaymentFailed,
  onClose,
}) => {
  const [status, setStatus] = useState<PaymentStatus>('PAYMENT_PENDING');
  const [learnerStatus, setLearnerStatus] = useState<LearnerStatus>('INVITED');
  const [approvalRequired, setApprovalRequired] = useState<boolean>(false);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // Get access token on mount
  useEffect(() => {
    const getToken = async () => {
      try {
        const token = await getTokenFromStorage(TokenKey.accessToken);
        setAccessToken(token);
      } catch (error) {
        console.error('Error getting access token:', error);
        setError('Failed to authenticate. Please try again.');
      }
    };

    if (open) {
      getToken();
    }
  }, [open]);

  // Parse status strings to typed enums
  const parseUserPlanStatus = (status: string): PaymentStatus => {
    const normalizedStatus = status?.toUpperCase()?.trim();
    switch (normalizedStatus) {
      case 'FAILED':
        return 'FAILED';
      case 'PAID':
      case 'ACTIVE':
        return 'PAID';
      case 'PAYMENT_PENDING':
      case 'PENDING_FOR_PAYMENT':
        return 'PAYMENT_PENDING';
      default:
        console.warn('PaymentStatusPollingDialog - Unknown user plan status:', {
          originalStatus: status,
          normalizedStatus,
          packageSessionId
        });
        return 'UNKNOWN';
    }
  };

  const parseLearnerStatus = (status: string): LearnerStatus => {
    const normalizedStatus = status?.toUpperCase()?.trim();
    switch (normalizedStatus) {
      case 'INVITED':
        return 'INVITED';
      case 'PENDING_FOR_APPROVAL':
      case 'PENDING_APPROVAL':
        return 'PENDING_FOR_APPROVAL';
      case 'ACTIVE':
        return 'ACTIVE';
      default:
        console.warn('PaymentStatusPollingDialog - Unknown learner status:', {
          originalStatus: status,
          normalizedStatus,
          packageSessionId
        });
        return 'UNKNOWN';
    }
  };

  // Polling function
  const checkPaymentStatus = useCallback(async () => {
    if (!packageSessionId || !accessToken) {
      console.log('PaymentStatusPollingDialog - Skipping status check: missing packageSessionId or accessToken', {
        packageSessionId: !!packageSessionId,
        accessToken: !!accessToken
      });
      return;
    }

    console.log('PaymentStatusPollingDialog - Checking payment status', {
      packageSessionId,
      currentStatus: status,
      isPolling
    });

    try {
      const response: PaymentStatusResponse = await fetchUserPlanStatus(packageSessionId, accessToken);
      const newStatus = parseUserPlanStatus(response.user_plan_status);
      const newLearnerStatus = parseLearnerStatus(response.learner_status);
      
      console.log('PaymentStatusPollingDialog - Payment status response', {
        rawResponse: response,
        parsedStatus: newStatus,
        parsedLearnerStatus: newLearnerStatus,
        approvalRequired: response.approval_required,
        previousStatus: status
      });
      
      setStatus(newStatus);
      setLearnerStatus(newLearnerStatus);
      setApprovalRequired(response.approval_required || false);
      setError(null);

      // Stop polling if status is no longer pending
      if (newStatus !== 'PAYMENT_PENDING') {
        console.log('PaymentStatusPollingDialog - Payment status changed, stopping polling', {
          newStatus,
          previousStatus: status
        });
        setIsPolling(false);
        
        if (newStatus === 'PAID') {
          console.log('PaymentStatusPollingDialog - Payment successful, calling onPaymentSuccess', {
            approvalRequired: response.approval_required
          });
          onPaymentSuccess?.(response.approval_required || false);
        } else if (newStatus === 'FAILED') {
          console.log('PaymentStatusPollingDialog - Payment failed, calling onPaymentFailed');
          onPaymentFailed?.();
        }
      } else {
        console.log('PaymentStatusPollingDialog - Payment still pending, continuing to poll');
      }
    } catch (err) {
      console.error('PaymentStatusPollingDialog - Error checking payment status:', err);
      setError('Failed to check payment status. Please try again.');
      setIsPolling(false);
    }
  }, [packageSessionId, accessToken, onPaymentSuccess, onPaymentFailed, status, isPolling]);

  // Start polling when dialog opens
  useEffect(() => {
    if (open && accessToken) {
      console.log('PaymentStatusPollingDialog - Starting payment status polling', {
        packageSessionId,
        courseTitle,
        accessToken: !!accessToken
      });
      
      setIsPolling(true);
      setStatus('PAYMENT_PENDING');
      setError(null);
      
      // Initial check
      checkPaymentStatus();
      
      // Set up polling interval (every 7 seconds)
      const intervalId = setInterval(checkPaymentStatus, 7000);
      console.log('PaymentStatusPollingDialog - Polling interval set up', { intervalId });
      
      return () => {
        console.log('PaymentStatusPollingDialog - Cleaning up polling interval', { intervalId });
        clearInterval(intervalId);
        setIsPolling(false);
      };
    }
  }, [open, accessToken, checkPaymentStatus, packageSessionId, courseTitle]);

  // Handle dialog close
  const handleClose = () => {
    console.log('PaymentStatusPollingDialog - Dialog closing', {
      packageSessionId,
      currentStatus: status,
      isPolling
    });
    setIsPolling(false);
    onOpenChange(false);
    onClose?.();
  };

  // Render content based on status
  const renderContent = () => {
    if (error) {
      return (
        <div className="text-center py-8">
          {/* Error Icon */}
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="w-20 h-20 bg-gradient-to-br from-danger-100 to-danger-200 rounded-full flex items-center justify-center shadow-lg">
                <XCircle className="w-10 h-10 text-red-600" />
              </div>
              <div className="absolute -top-1 -end-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
                <XCircle className="w-3 h-3 text-white" />
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="space-y-4">
            <h3 className="text-2xl font-bold text-gray-900">
              Error Checking Payment Status
            </h3>
            <p className="text-gray-600 text-lg">
              We encountered an issue while checking your payment status.
            </p>
          </div>

          {/* Error Details */}
          <div className="mt-8 bg-gradient-to-r from-danger-50 to-pink-50 border border-red-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
                  <XCircle className="w-4 h-4 text-white" />
                </div>
              </div>
              <div className="flex-1 text-start">
                <h4 className="text-sm font-semibold text-red-900 mb-2">
                  Error Details
                </h4>
                <p className="text-sm text-red-800 mb-3">
                  {error}
                </p>
                <p className="text-sm text-red-700">
                  Please try again or contact support if the issue persists.
                </p>
              </div>
            </div>
          </div>
          
          <div className="mt-8">
            <MyButton
              buttonType="primary"
              scale="large"
              onClick={checkPaymentStatus}
              className="w-full h-12 text-base font-semibold"
            >
              Try Again
            </MyButton>
          </div>
        </div>
      );
    }

    if (status === 'PAYMENT_PENDING') {
      return (
        <div className="text-center py-8">
          {/* Animated Processing Icon */}
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="w-20 h-20 bg-gradient-to-br from-info-100 to-info-200 rounded-full flex items-center justify-center shadow-lg">
                <SpinnerGap className="w-10 h-10 text-blue-600 animate-spin" />
              </div>
              <div className="absolute -top-1 -end-1 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="space-y-4">
            <h3 className="text-2xl font-bold text-gray-900">
              Processing Payment
            </h3>
          </div>

          {/* Processing Card */}
          <div className="mt-8 bg-gradient-to-r from-info-50 to-indigo-50 border border-blue-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <div className="flex-1 text-start space-y-1">
                <h4 className="text-sm font-semibold text-gray-900">
                  Payment in Progress
                </h4>
                <p className="text-sm text-gray-700 leading-relaxed">
                  Your payment is being processed securely. This usually takes just a few moments. 
                  We'll automatically update your enrollment status once the payment is confirmed.
                </p>
              </div>
            </div>
          </div>


          {/* Security Notice */}
          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-center space-x-2 text-xs text-gray-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span>Your payment is secured with bank-level encryption</span>
            </div>
          </div>
        </div>
      );
    }

    if (status === 'PAID') {
      return (
        <div className="text-center py-8">
          {/* Success Icon */}
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="w-20 h-20 bg-gradient-to-br from-success-100 to-success-200 rounded-full flex items-center justify-center shadow-lg">
                <CheckCircle className="w-10 h-10 text-green-600" />
              </div>
              <div className="absolute -top-1 -end-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                <CheckCircle className="w-3 h-3 text-white" />
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="space-y-4">
            <h3 className="text-2xl font-bold text-gray-900">
              Payment Successful!
            </h3>
            <p className="text-gray-600 text-lg">
              Your payment for <span className="font-semibold text-gray-800">{courseTitle}</span> has been processed successfully.
            </p>
          </div>
          
          {approvalRequired ? (
            <div className="mt-8 bg-gradient-to-r from-warning-50 to-primary-50 border border-yellow-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center">
                    <Clock className="w-4 h-4 text-white" />
                  </div>
                </div>
                <div className="flex-1 text-start">
                  <h4 className="text-sm font-semibold text-yellow-900 mb-2">
                    Admin Approval Required
                  </h4>
                  <p className="text-sm text-yellow-800 mb-3">
                    Your payment was successful and the {getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} requires admin approval.
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2 text-sm text-yellow-700">
                      <div className="w-1.5 h-1.5 bg-yellow-600 rounded-full"></div>
                      <span>Administrator will review your enrollment request</span>
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-yellow-700">
                      <div className="w-1.5 h-1.5 bg-yellow-600 rounded-full"></div>
                      <span>You will receive an email notification once approved</span>
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-yellow-700">
                      <div className="w-1.5 h-1.5 bg-yellow-600 rounded-full"></div>
                      <span>{getTerminology(ContentTerms.Course, SystemTerms.Course)} access will be granted automatically</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-8 bg-gradient-to-r from-success-50 to-success-50 border border-green-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                    <CheckCircle className="w-4 h-4 text-white" />
                  </div>
                </div>
                <div className="flex-1 text-start space-y-1">
                  <h4 className="text-sm font-semibold text-green-900">
                    Ready to Explore!
                  </h4>
                  <p className="text-sm text-green-800">
                    You can now access the {getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} content and start learning.
                  </p>
                </div>
              </div>
            </div>
          )}
          
          <div className="mt-8">
            <MyButton
              buttonType="primary"
              scale="large"
              onClick={handleClose}
              className="w-full h-12 text-base font-semibold"
            >
              {approvalRequired ? 'Close' : `Explore ${getTerminology(ContentTerms.Course, SystemTerms.Course)}`}
            </MyButton>
          </div>
        </div>
      );
    }

    if (status === 'FAILED') {
      return (
        <div className="text-center py-8">
          {/* Error Icon */}
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="w-20 h-20 bg-gradient-to-br from-danger-100 to-danger-200 rounded-full flex items-center justify-center shadow-lg">
                <XCircle className="w-10 h-10 text-red-600" />
              </div>
              <div className="absolute -top-1 -end-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
                <XCircle className="w-3 h-3 text-white" />
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="space-y-4">
            <h3 className="text-2xl font-bold text-gray-900">
              Payment Failed
            </h3>
            <p className="text-gray-600 text-lg">
              Your payment for <span className="font-semibold text-gray-800">{courseTitle}</span> could not be processed. 
              Please try again.
            </p>
          </div>

          {/* Action Card */}
          <div className="mt-8 bg-gradient-to-r from-danger-50 to-pink-50 border border-red-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
                  <XCircle className="w-4 h-4 text-white" />
                </div>
              </div>
              <div className="flex-1 text-start space-y-2">
                <h4 className="text-sm font-semibold text-red-900">
                  What to do next?
                </h4>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2 text-sm text-red-700">
                    <div className="w-1.5 h-1.5 bg-red-600 rounded-full"></div>
                    <span>Check your payment method and try again</span>
                  </div>
                  <div className="flex items-center space-x-2 text-sm text-red-700">
                    <div className="w-1.5 h-1.5 bg-red-600 rounded-full"></div>
                    <span>Contact support if the issue persists</span>
                  </div>
                  <div className="flex items-center space-x-2 text-sm text-red-700">
                    <div className="w-1.5 h-1.5 bg-red-600 rounded-full"></div>
                    <span>You can start the enrollment process again</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="mt-8">
            <MyButton
              buttonType="primary"
              scale="large"
              onClick={handleClose}
              className="w-full h-12 text-base font-semibold"
            >
              Try Again
            </MyButton>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 animate-fade-in" />
        <DialogPrimitive.Content
          className="fixed start-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl focus:outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Payment Status</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Checking payment status for your enrollment
          </DialogPrimitive.Description>
          
          <button
            className="absolute end-2 top-2 text-gray-400 hover:text-gray-700 focus:outline-none"
            onClick={handleClose}
            aria-label="Close"
          >
            <Cross2Icon className="h-4 w-4" />
          </button>
          
          {renderContent()}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
