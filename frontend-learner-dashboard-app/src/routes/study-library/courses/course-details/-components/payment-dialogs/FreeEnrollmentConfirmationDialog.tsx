import React, { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SpinnerGap, Gift } from "@phosphor-icons/react";
import { Preferences } from "@capacitor/preferences";
import {
  fetchEnrollmentDetails,
  getPaymentOptions,
  getPaymentPlans,
  handlePaymentForEnrollment,
  UserData,
  type EnrollmentResponse,
  type PaymentOption,
  type PaymentPlan,
} from "../../-services/enrollment-api";
import { MyButton } from "@/components/design-system/button";
import { EnrollmentSuccessDialog } from "./EnrollmentSuccessDialog";
import { EnrollmentPendingDialog } from "./EnrollmentPendingDialog";
import { EnrollmentPendingApprovalDialog } from "./EnrollmentPendingApprovalDialog";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface FreeEnrollmentConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packageSessionId: string;
  instituteId: string;
  token: string;
  courseTitle?: string;
  inviteCode?: string;
  onEnrollmentSuccess?: () => void;
  onNavigateToSlides?: () => void;
}

export const FreeEnrollmentConfirmationDialog: React.FC<
  FreeEnrollmentConfirmationDialogProps
> = ({
  open,
  onOpenChange,
  packageSessionId,
  instituteId,
  token,
  courseTitle = getTerminology(ContentTerms.Course, SystemTerms.Course),
  inviteCode = "default",
  onNavigateToSlides,
}) => {
  const [enrollmentData, setEnrollmentData] =
    useState<EnrollmentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPaymentOption, setSelectedPaymentOption] =
    useState<PaymentOption | null>(null);
  const [selectedPaymentPlan, setSelectedPaymentPlan] =
    useState<PaymentPlan | null>(null);
  const [processingEnrollment, setProcessingEnrollment] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [showPendingDialog, setShowPendingDialog] = useState(false);
  const [showPendingApprovalDialog, setShowPendingApprovalDialog] =
    useState(false);

  // Helper function to get real user data from preferences
  const getRealUserData: () => Promise<UserData | undefined> =
    useCallback(async () => {
      try {
        const { value } = await Preferences.get({ key: "StudentDetails" });
        if (!value) {
          return null;
        }

        const studentData = JSON.parse(value);
        // Handle both array and object formats
        const student = Array.isArray(studentData)
          ? studentData[0]
          : studentData;

        return {
          email: student.email || "",
          username: student.username || "",
          full_name: student.full_name || "",
          mobile_number: student.mobile_number || "",
          date_of_birth: student.date_of_birth || new Date().toISOString(),
          gender: student.gender,
          address_line: student.address_line || "",
          city: student.city || "",
          region: student.region || "",
          pin_code: student.pin_code || "",
          profile_pic_file_id: student.face_file_id || "",
          country: student.country || "",
        } as UserData;
      } catch (error) {
        console.error("Error fetching user data from preferences:", error);
        return null;
      }
    }, []);

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
      const data = await fetchEnrollmentDetails(
        inviteCode,
        instituteId,
        packageSessionId,
        token
      );
      setEnrollmentData(data);

      // Auto-select first FREE payment option and plan
      const paymentOptions = getPaymentOptions(data);
      const freeOptions = paymentOptions.filter(
        (option) => option.type === "FREE"
      );

      if (freeOptions.length > 0) {
        const firstFreeOption = freeOptions[0];
        setSelectedPaymentOption(firstFreeOption);

        const plans = getPaymentPlans(firstFreeOption);
        if (plans.length > 0) {
          setSelectedPaymentPlan(plans[0]);
        } else {
          // Create a minimal payment plan for FREE enrollment without plans
          const minimalPlan = {
            id: "free-plan-default",
            name: "Free Plan",
            actual_price: 0,
            currency: data.currency || "USD",
            description: `Free enrollment for ${courseTitle}`,
            feature_json:
              '["Full course access", "Lifetime access", "Certificate of completion"]',
          };
          setSelectedPaymentPlan(minimalPlan);
        }
      } else if (paymentOptions.length > 0) {
        // Fallback to any option with free plans
        const firstOption = paymentOptions[0];
        setSelectedPaymentOption(firstOption);

        const plans = getPaymentPlans(firstOption);
        const freePlans = plans.filter((plan) => plan.actual_price === 0);
        if (freePlans.length > 0) {
          setSelectedPaymentPlan(freePlans[0]);
        } else {
          // Create a minimal payment plan for FREE enrollment without plans
          const minimalPlan = {
            id: "free-plan-default",
            name: "Free Plan",
            actual_price: 0,
            currency: data.currency || "USD",
            description: `Free enrollment for ${courseTitle}`,
            feature_json:
              '["Full course access", "Lifetime access", "Certificate of completion"]',
          };
          setSelectedPaymentPlan(minimalPlan);
        }
      } else {
        setError("No enrollment options available.");
      }
    } catch (err) {
      setError("Failed to load free enrollment options. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleEnroll = async () => {
    if (!selectedPaymentOption || !enrollmentData) {
      setError("Free enrollment configuration not available.");
      return;
    }

    setProcessingEnrollment(true);
    setError(null);

    try {
      // For free enrollment, we don't need payment plans or payment gateway
      // Create a minimal payment plan object if none exists
      let paymentPlan = selectedPaymentPlan;
      if (!paymentPlan) {
        // Create a minimal payment plan for FREE enrollment without plans
        paymentPlan = {
          id: "free-plan-default",
          name: "Free Plan",
          actual_price: 0,
          currency: enrollmentData.currency || "USD",
          description: `Free enrollment for ${courseTitle}`,
          feature_json:
            '["Full course access", "Lifetime access", "Certificate of completion"]',
        };
      }

      // Get real user data for enrollment
      const userData = await getRealUserData();
      const userProfileEmail = userData?.email || "guest@example.com";

      // Call the enrollment API
      await handlePaymentForEnrollment({
        userEmail: userProfileEmail,
        userData: userData,
        receiptEmail: userProfileEmail,
        instituteId,
        packageSessionId,
        enrollmentData,
        paymentGatewayData: null as any, // No payment gateway needed for free enrollment
        selectedPaymentPlan: paymentPlan,
        selectedPaymentOption,
        amount: paymentPlan.actual_price,
        currency: paymentPlan.currency,
        description: `Free enrollment for ${courseTitle}`,
        paymentType: "free",
        token,
      });

      // Close the main dialog
      onOpenChange(false);

      // Check if approval is required
      if (selectedPaymentOption.require_approval) {
        setShowPendingDialog(true);
      } else {
        setShowSuccessDialog(true);
      }
    } catch (err) {
      console.error("Free enrollment error:", err);

      // Handle specific error cases
      if (
        err instanceof Error &&
        err.message === "ENROLLMENT_PENDING_APPROVAL"
      ) {
        // User already has a pending enrollment request
        onOpenChange(false);
        setShowPendingApprovalDialog(true);
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Enrollment failed. Please try again."
        );
      }
    } finally {
      setProcessingEnrollment(false);
    }
  };

  const handleExploreCourse = async () => {
    setShowSuccessDialog(false);
    if (onNavigateToSlides) {
      await onNavigateToSlides();
    }
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Loading Free Enrollment</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center py-12">
            <div className="text-center space-y-4">
              <SpinnerGap className="w-8 h-8 animate-spin mx-auto text-primary-600" />
              <p className="text-gray-600">Loading enrollment options...</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (error && !enrollmentData) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enrollment Error</DialogTitle>
          </DialogHeader>
          <div className="text-center py-6 space-y-4">
            <p className="text-red-600">{error}</p>
            <Button onClick={fetchEnrollmentData} variant="outline">
              Try Again
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-center">
              Free Enrollment
            </DialogTitle>
          </DialogHeader>

          {enrollmentData && selectedPaymentOption && (
            <div className="space-y-6">
              {/* Course Info Card */}
              <Card className="bg-green-50 border-green-200">
                <CardContent className="p-card-lg">
                  <div className="text-center">
                    {/* Approval Required - Process Steps */}
                    {selectedPaymentOption?.require_approval && (
                      <div className="bg-gradient-to-br from-slate-50 to-info-50 border border-slate-200 rounded-xl p-5 mb-4 shadow-sm space-y-4">
                        <div className="text-center">
                          <div className="inline-flex items-center justify-center w-10 h-10 bg-gradient-to-r from-info-500 to-indigo-600 rounded-full mb-3">
                            <svg
                              className="w-5 h-5 text-white"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                          </div>
                          <h4 className="text-lg font-semibold text-slate-800">
                            What happens next?
                          </h4>
                          <p className="text-sm text-slate-600 mt-1">
                            Your enrollment request will be processed
                          </p>
                        </div>

                        <div className="space-y-4">
                          <div className="flex items-start space-x-3">
                            <div className="flex-shrink-0 w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mt-0.5">
                              <span className="text-xs font-semibold text-blue-700">
                                1
                              </span>
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-slate-800">
                                Administrator will review your enrollment
                                request
                              </p>
                            </div>
                          </div>

                          <div className="flex items-start space-x-3">
                            <div className="flex-shrink-0 w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mt-0.5">
                              <span className="text-xs font-semibold text-blue-700">
                                2
                              </span>
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-slate-800">
                                You will receive an email notification once
                                approved
                              </p>
                            </div>
                          </div>

                          <div className="flex items-start space-x-3">
                            <div className="flex-shrink-0 w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mt-0.5">
                              <span className="text-xs font-semibold text-blue-700">
                                3
                              </span>
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-slate-800">
                                {getTerminology(ContentTerms.Course, SystemTerms.Course)} access will be granted automatically
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Simple Confirmation Message - No Approval Required */}
                    {!selectedPaymentOption?.require_approval && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                        <div className="text-center">
                          <div className="inline-flex items-center justify-center w-10 h-10 bg-green-100 rounded-full mb-3">
                            <svg
                              className="w-5 h-5 text-green-600"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          </div>
                          <h4 className="text-lg font-semibold text-green-800 mb-2">
                            Ready to Enroll
                          </h4>
                          <p className="text-sm text-green-700">
                            You'll get instant access to the {getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} after
                            enrollment
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Error Message */}
              {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-600 text-sm">{error}</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-center">
                <MyButton
                  type="button"
                  scale="large"
                  buttonType="primary"
                  layoutVariant="default"
                  disabled={processingEnrollment}
                  onClick={handleEnroll}
                  className="w-full max-w-xs flex items-center justify-center space-x-2"
                >
                  {processingEnrollment ? (
                    <>
                      <SpinnerGap className="w-4 h-4 animate-spin" />
                      Enrolling...
                    </>
                  ) : (
                    <>
                      <Gift className="w-4 h-4" />
                      Confirm Free Enrollment
                    </>
                  )}
                </MyButton>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Success Dialog */}
      <EnrollmentSuccessDialog
        open={showSuccessDialog}
        onOpenChange={setShowSuccessDialog}
        courseTitle={courseTitle}
        onExploreCourse={handleExploreCourse}
      />

      {/* Pending Dialog */}
      <EnrollmentPendingDialog
        open={showPendingDialog}
        onOpenChange={setShowPendingDialog}
        courseTitle={courseTitle}
      />

      {/* Pending Approval Dialog */}
      <EnrollmentPendingApprovalDialog
        open={showPendingApprovalDialog}
        onOpenChange={setShowPendingApprovalDialog}
        courseTitle={courseTitle}
      />
    </>
  );
};
