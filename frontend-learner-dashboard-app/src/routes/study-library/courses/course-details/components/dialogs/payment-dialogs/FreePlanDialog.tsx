import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SpinnerGap, CheckCircle, Gift, Check } from "@phosphor-icons/react";
import {
  fetchEnrollmentDetails,
  getPaymentOptions,
  getPaymentPlans,
  formatCurrency,
  handlePaymentForEnrollment,
  fetchPaymentGatewayDetails,
  type EnrollmentResponse,
  type PaymentOption,
  type PaymentPlan,
} from "../../-services/enrollment-api";
import { MyButton } from "@/components/design-system/button";
import { EnrollmentSuccessDialog } from "./EnrollmentSuccessDialog";
import { EnrollmentPendingDialog } from "./EnrollmentPendingDialog";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface FreePlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packageSessionId: string;
  instituteId: string;
  token: string;
  courseTitle?: string;
  inviteCode?: string;
  onEnrollmentSuccess?: () => void;
}

export const FreePlanDialog: React.FC<FreePlanDialogProps> = ({
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
  const [selectedPaymentOption, setSelectedPaymentOption] = useState<PaymentOption | null>(null);
  const [selectedPaymentPlan, setSelectedPaymentPlan] = useState<PaymentPlan | null>(null);
  const [processingEnrollment, setProcessingEnrollment] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [showPendingDialog, setShowPendingDialog] = useState(false);

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
      
      // Auto-select first payment option and plan
      const paymentOptions = getPaymentOptions(data);
      if (paymentOptions.length > 0) {
        const firstOption = paymentOptions[0];
        setSelectedPaymentOption(firstOption);
        
        const plans = getPaymentPlans(firstOption);
        if (plans.length > 0) {
          setSelectedPaymentPlan(plans[0]);
        }
      }
    } catch (err) {
      setError("Failed to load free plan options. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleEnroll = async () => {
    if (!selectedPaymentOption || !selectedPaymentPlan || !enrollmentData) {
      setError("Please select a free plan.");
      return;
    }

    setProcessingEnrollment(true);
    setError(null);
    
    try {
      // For free enrollment, no payment gateway details needed
      // Call the enrollment API directly
      await handlePaymentForEnrollment({
        userEmail: "user@example.com", // This should come from user profile
        receiptEmail: "user@example.com", // This should come from user profile
        instituteId,
        packageSessionId,
        enrollmentData,
        paymentGatewayData: null, // No payment gateway needed for free enrollment
        selectedPaymentPlan,
        selectedPaymentOption,
        amount: selectedPaymentPlan.actual_price,
        currency: selectedPaymentPlan.currency || enrollmentData.currency,
        description: `Free enrollment for ${courseTitle}`,
        paymentType: 'free',
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
      console.error('Free enrollment error:', err);
      setError(err instanceof Error ? err.message : "Enrollment failed. Please try again.");
    } finally {
      setProcessingEnrollment(false);
    }
  };

  const handleExploreCourse = () => {
    setShowSuccessDialog(false);
    if (onEnrollmentSuccess) {
      onEnrollmentSuccess();
    }
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Loading Free Plan</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center py-12">
            <div className="text-center space-y-4">
              <SpinnerGap className="w-8 h-8 animate-spin mx-auto text-primary-600" />
              <p className="text-gray-600">Loading free plan options...</p>
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
            <DialogTitle>Free Plan Error</DialogTitle>
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

  const paymentOptions = enrollmentData ? getPaymentOptions(enrollmentData) : [];
  const freePlans = paymentOptions.flatMap(option => 
    getPaymentPlans(option).filter(plan => plan.actual_price === 0)
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-screen-90 overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center space-x-2">
            <Gift className="w-6 h-6 text-green-600" />
            <span>Free Plan for {courseTitle}</span>
          </DialogTitle>
          {enrollmentData && (
            <p className="text-sm text-gray-600">
              Enroll in the free plan to start learning
            </p>
          )}
        </DialogHeader>

        {enrollmentData && (
          <div className="space-y-6">
            {/* Course Info */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">{getTerminology(ContentTerms.Course, SystemTerms.Course)} Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">{getTerminology(ContentTerms.Course, SystemTerms.Course)}:</span>
                  <span className="font-medium">{courseTitle}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Access Period:</span>
                  <span className="text-sm">
                    {new Date(enrollmentData.start_date).toLocaleDateString()} - {new Date(enrollmentData.end_date).toLocaleDateString()}
                  </span>
                </div>
                {enrollmentData.learner_access_days > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Access Duration:</span>
                    <span className="text-sm">{enrollmentData.learner_access_days} days</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Free Plans */}
            <div className="space-y-4">
              <div className="text-center space-y-2">
                <h3 className="text-lg font-semibold text-gray-900">Available Free Plans</h3>
                <p className="text-gray-600">Choose your free plan to get started</p>
              </div>
              
              {freePlans.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center">
                    <p className="text-gray-600">No free plans available at the moment.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4">
                  {freePlans.map((plan) => (
                    <Card
                      key={plan.id}
                      className={`cursor-pointer transition-all duration-200 ${
                        selectedPaymentPlan?.id === plan.id
                          ? "ring-2 ring-green-500 border-green-500 bg-green-50"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                      onClick={() => setSelectedPaymentPlan(plan)}
                    >
                      <CardContent className="p-card-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-3 mb-3">
                              <div className="p-2 bg-green-100 rounded-lg">
                                <Gift className="w-5 h-5 text-green-600" />
                              </div>
                              <div>
                                <h4 className="text-lg font-semibold text-gray-900">{plan.name}</h4>
                                {plan.tag && (
                                  <Badge className="bg-green-100 text-green-800 text-xs">
                                    {plan.tag}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            
                            <p className="text-sm text-gray-600 mb-3">
                              {plan.description}
                            </p>
                            
                            {/* Features */}
                            <div className="space-y-2">
                              {plan.feature_json ? (
                                (() => {
                                  try {
                                    const features = JSON.parse(plan.feature_json);
                                    return Array.isArray(features) ? features.slice(0, 3).map((feature: string, index: number) => (
                                      <div key={index} className="flex items-center space-x-2">
                                        <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
                                        <span className="text-sm text-gray-700">{feature}</span>
                                      </div>
                                    )) : [];
                                  } catch {
                                    return [
                                      <div key="default" className="flex items-center space-x-2">
                                        <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
                                        <span className="text-sm text-gray-700">Basic {getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} access</span>
                                      </div>
                                    ];
                                  }
                                })()
                              ) : (
                                <div className="flex items-center space-x-2">
                                  <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
                                  <span className="text-sm text-gray-700">Basic {getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} access</span>
                                </div>
                              )}
                            </div>
                            
                            <div className="flex items-center space-x-4 text-xs text-gray-500 mt-3">
                              {plan.validity_in_days > 0 && (
                                <span>Valid for {plan.validity_in_days} days</span>
                              )}
                              {plan.currency && (
                                <span>Currency: {plan.currency.toUpperCase()}</span>
                              )}
                            </div>
                          </div>
                          
                          <div className="text-end">
                            <div className="text-2xl font-bold text-green-600">
                              FREE
                            </div>
                            <div className="text-sm text-gray-500">
                              {plan.validity_in_days === 30 ? '1 month' : 
                               plan.validity_in_days === 90 ? '3 months' :
                               plan.validity_in_days === 180 ? '6 months' :
                               plan.validity_in_days === 365 ? '1 year' :
                               `${plan.validity_in_days} days`}
                            </div>
                            {selectedPaymentPlan?.id === plan.id && (
                              <CheckCircle className="w-5 h-5 text-green-600 mt-2" />
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end space-x-3 pt-4">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={processingEnrollment}
              >
                Cancel
              </Button>
              <MyButton
                type="button"
                scale="large"
                buttonType="primary"
                layoutVariant="default"
                disabled={!selectedPaymentPlan || processingEnrollment}
                onClick={handleEnroll}
                className="flex items-center space-x-2"
              >
                {processingEnrollment ? (
                  <>
                    <SpinnerGap className="w-4 h-4 animate-spin" />
                    Enrolling...
                  </>
                ) : (
                  <>
                    <Gift className="w-4 h-4" />
                    Enroll for Free
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
    </>
  );
}; 