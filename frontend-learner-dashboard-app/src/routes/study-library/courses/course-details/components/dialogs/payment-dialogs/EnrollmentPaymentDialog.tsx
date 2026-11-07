import React, { useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { SpinnerGap } from "@phosphor-icons/react";
import {
  fetchEnrollmentDetails,
  type EnrollmentResponse,
} from "../../-services/enrollment-api";
import { DonationDialog } from "@/components/common/donation/DonationDialog";
import { SubscriptionPaymentDialog } from "./SubscriptionPaymentDialog";
import { OneTimePaymentDialog } from "./OneTimePaymentDialog";
import { FreePlanDialog } from "./FreePlanDialog";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface EnrollmentPaymentRouterProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packageSessionId: string;
  instituteId: string;
  token: string;
  courseTitle?: string;
  inviteCode?: string;
  onEnrollmentSuccess?: () => void;
}

export const EnrollmentPaymentDialog: React.FC<EnrollmentPaymentRouterProps> = ({
  open,
  onOpenChange,
  packageSessionId,
  instituteId,
  token,
  courseTitle = getTerminology(ContentTerms.Course, SystemTerms.Course),
  inviteCode = "default",
  onEnrollmentSuccess,
}) => {
  const [enrollmentData, setEnrollmentData] = useState<EnrollmentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [paymentType, setPaymentType] = useState<string | null>(null);

  // Fetch enrollment data when dialog opens
  useEffect(() => {
    if (open && packageSessionId) {
      fetchEnrollmentData();
    }
  }, [open, packageSessionId]);

  const fetchEnrollmentData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchEnrollmentDetails(inviteCode, instituteId, packageSessionId, token);
      setEnrollmentData(data);
      
      // Determine payment type from the first payment option
      if (data.package_session_to_payment_options && data.package_session_to_payment_options.length > 0) {
        const firstPaymentOption = data.package_session_to_payment_options[0].payment_option;
        setPaymentType(firstPaymentOption.type);
      }
    } catch (err) {
      setError("Failed to load enrollment options. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 animate-fade-in flex items-center justify-center">
        <div className="bg-white rounded-lg p-6 max-w-sm">
          <div className="text-center space-y-4">
            <SpinnerGap className="w-8 h-8 animate-spin mx-auto text-primary-600" />
            <p className="text-gray-600">Loading enrollment options...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error && !enrollmentData) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 animate-fade-in flex items-center justify-center">
        <div className="bg-white rounded-lg p-6 max-w-sm">
          <div className="text-center space-y-4">
            <h3 className="text-lg font-semibold">Enrollment Error</h3>
            <p className="text-red-600">{error}</p>
            <Button onClick={fetchEnrollmentData} variant="outline">
              Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }



  // Function to render the appropriate dialog based on payment type
  const renderPaymentDialog = () => {
    if (!paymentType) return null;

    const commonProps = {
      packageSessionId,
      instituteId,
      token,
      courseTitle,
      inviteCode,
      onEnrollmentSuccess,
    };

    switch (paymentType.toLowerCase()) {
      case 'donation':
        return (
          <DonationDialog
            open={open}
            onOpenChange={onOpenChange}
            courseTitle={courseTitle}
            packageSessionId={packageSessionId}
            instituteId={instituteId}
            token={token}
            inviteCode={inviteCode}
            mode="enrollment"
            isUserEnrolled={false}
            onEnrollmentSuccess={onEnrollmentSuccess}
          />
        );
      
      case 'subscription':
        return (
          <SubscriptionPaymentDialog
            open={open}
            onOpenChange={onOpenChange}
            {...commonProps}
          />
        );
      
      case 'one-time':
      case 'one_time':
      case 'onetime':
        return (
          <OneTimePaymentDialog
            open={open}
            onOpenChange={onOpenChange}
            {...commonProps}
          />
        );
      
      case 'free':
      case 'free_plan':
      case 'freep plan':
        return (
          <FreePlanDialog
            open={open}
            onOpenChange={onOpenChange}
            {...commonProps}
          />
        );
      
      default:
        // Fallback to subscription dialog for unknown types
        return (
          <SubscriptionPaymentDialog
            open={open}
            onOpenChange={onOpenChange}
            {...commonProps}
          />
        );
    }
  };



  // Show error state
  if (error) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 animate-fade-in flex items-center justify-center">
        <div className="bg-white rounded-lg p-6 max-w-sm">
          <div className="text-center space-y-4">
            <h3 className="text-lg font-semibold">Enrollment Error</h3>
            <p className="text-red-600">{error}</p>
            <Button onClick={fetchEnrollmentData} variant="outline">
              Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Render the appropriate payment dialog based on type
  return renderPaymentDialog();
}; 