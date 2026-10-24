import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SpinnerGap, CheckCircle, Lock } from "@phosphor-icons/react";
import { SiStripe } from "react-icons/si"; // design-lint-ignore: brand logo, no phosphor equivalent
import {
  fetchEnrollmentDetails,
  getPaymentOptions,
  getPaymentPlans,
  formatCurrency,
  handlePaymentForEnrollment,
  fetchPaymentGatewayDetails,
  createStripePaymentMethodWithElements,
  validateAndSanitizeEmail,
  type EnrollmentResponse,
  type PaymentOption,
  type PaymentPlan,
} from "../../-services/enrollment-api";
import { MyButton } from "@/components/design-system/button";
import { EnrollmentSuccessDialog } from "./EnrollmentSuccessDialog";
import { EnrollmentPendingDialog } from "./EnrollmentPendingDialog";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { useCouponsEnabled } from "@/components/common/coupon/use-coupons-enabled";
import { useCheckoutCoupon } from "@/components/common/coupon/use-checkout-coupon";
import { CouponInput } from "@/components/common/coupon/CouponInput";

// TypeScript declarations for Stripe
declare global {
  interface Window {
    Stripe?: (publishableKey: string) => any;
  }
}

interface OneTimePaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packageSessionId: string;
  instituteId: string;
  token: string;
  courseTitle?: string;
  inviteCode?: string;
  onEnrollmentSuccess?: () => void;
}

export const OneTimePaymentDialog: React.FC<OneTimePaymentDialogProps> = ({
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
  const [processingPayment, setProcessingPayment] = useState(false);
  const [step, setStep] = useState<'select' | 'payment'>('select');
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [showPendingDialog, setShowPendingDialog] = useState(false);
  
  // Stripe Elements state
  const [stripe, setStripe] = useState<any>(null);
  const [stripeElements, setStripeElements] = useState<any>(null);
  const [cardElement, setCardElement] = useState<any>(null);
  const [cardElementError, setCardElementError] = useState<string>('');
  const [cardElementReady, setCardElementReady] = useState<boolean>(false);

  // Discount coupon — gated by institute toggle (admin Settings → Coupons).
  const couponsEnabled = useCouponsEnabled();
  const couponCtx = useCheckoutCoupon({
    buildRequest: (code) => ({
      couponCode: code,
      instituteId,
      enrollInviteId: enrollmentData?.id || null,
      packageSessionId,
      paymentPlanId: selectedPaymentPlan?.id ?? null,
      totalAmount:
        typeof selectedPaymentPlan?.actual_price === "number"
          ? selectedPaymentPlan.actual_price
          : 0,
    }),
  });
  const effectiveAmount = Math.max(
    0,
    (selectedPaymentPlan?.actual_price ?? 0) -
      (couponCtx.state.appliedCode ? couponCtx.state.discount : 0)
  );

  // Drop the applied coupon if the learner switches plans — its discount was
  // computed against the previous plan's price, and leaving it in place would
  // make the gateway charge a different amount than the BE re-validates to.
  const prevPlanIdRef = useRef<string | null | undefined>(selectedPaymentPlan?.id);
  useEffect(() => {
    const currentId = selectedPaymentPlan?.id;
    if (prevPlanIdRef.current !== currentId) {
      prevPlanIdRef.current = currentId;
      if (couponCtx.state.appliedCode) {
        couponCtx.clear();
      }
    }
  }, [selectedPaymentPlan?.id, couponCtx]);

  const cardElementRef = useRef<HTMLDivElement>(null);

  // Fetch enrollment data when dialog opens
  useEffect(() => {
    if (open && packageSessionId) {
      fetchEnrollmentData();
    }
  }, [open, packageSessionId]);

  // Simple loadStripe function
  const loadStripe = useCallback(async (publishableKey: string) => {
    try {
      // Check if Stripe is already loaded
      if (window.Stripe) {
        return window.Stripe(publishableKey);
      }

      // Load Stripe.js script
      const script = document.createElement('script');
      script.src = 'https://js.stripe.com/v3/';
      script.async = true;
      
      return new Promise((resolve, reject) => {
        script.onload = () => {
          if (window.Stripe) {
            const stripe = window.Stripe(publishableKey);
            resolve(stripe);
          } else {
            reject(new Error('Stripe failed to load'));
          }
        };
        script.onerror = () => {
          reject(new Error('Failed to load Stripe script'));
        };
        document.head.appendChild(script);
      });
    } catch (error) {
      throw error;
    }
  }, []);

  // Initialize Stripe Elements when payment gateway data is loaded
  useEffect(() => {
    const initializeStripeElements = async () => {
      if (enrollmentData && cardElementRef.current && step === 'payment') {
        // Clear any previous errors when starting initialization
        setCardElementError('');
        
        try {
          // Fetch payment gateway details
          const paymentGatewayData = await fetchPaymentGatewayDetails(instituteId, 'STRIPE', token);
          
          let stripeInstance = stripe;
          
          // Load Stripe if not already loaded
          if (!stripeInstance) {
            stripeInstance = await loadStripe(paymentGatewayData.publishableKey);
            setStripe(stripeInstance);
          }
          
          // Create elements if not already created
          let elements = stripeElements;
          if (!elements) {
            elements = (stripeInstance as any).elements();
            setStripeElements(elements);
          }
          
          // Clean up existing card element if it exists
          if (cardElement) {
            try {
              cardElement.destroy();
            } catch (destroyError) {
              // Ignore destroy errors
            }
            setCardElement(null);
            setCardElementReady(false);
          }
          
          // Create new card element
          const card = elements.create('card', {
            style: {
              base: {
                fontSize: '16px',
                color: '#374151', // design-lint-ignore: Stripe SDK element style data
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                '::placeholder': {
                  color: '#9CA3AF', // design-lint-ignore: Stripe SDK element style data
                },
                padding: '8px 0',
              },
              invalid: {
                color: '#DC2626', // design-lint-ignore: Stripe SDK element style data
              },
            },
            hidePostalCode: true,
          });
          
          // Set card element immediately
          setCardElement(card);
          
          // Mount card element with a small delay to ensure DOM is ready
          setTimeout(() => {
            if (cardElementRef.current && card) {
              card.mount(cardElementRef.current);
              
              // Set up event listeners
              card.on('ready', () => {
                setCardElementReady(true);
                setCardElementError('');
              });
              
              card.on('change', (event: any) => {
                if (event.error) {
                  setCardElementError(event.error.message);
                } else {
                  setCardElementError('');
                }
              });
            }
          }, 100);
          
        } catch (error) {
          console.error('Stripe initialization error:', error);
          setCardElementError('Failed to load payment form. Please refresh and try again.');
        }
      }
    };

    initializeStripeElements();
  }, [enrollmentData, stripe, stripeElements, step, open, loadStripe, instituteId, token]);

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
      setError("Failed to load payment options. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleEnroll = async () => {
    if (!selectedPaymentOption || !selectedPaymentPlan || !enrollmentData) {
      setError("Please select a payment plan.");
      return;
    }

    setProcessingPayment(true);
    setError(null);
    setCardElementError('');
    
    try {
      // Validate Stripe Elements
      if (!stripe || !cardElement || !cardElementReady) {
        setCardElementError('Payment form not loaded. Please refresh and try again.');
        return;
      }

      // Create payment method using Stripe Elements
      const paymentMethod = await createStripePaymentMethodWithElements(stripe, cardElement);
      
      // Fetch payment gateway details (needed for enrollment API)
      const paymentGatewayData = await fetchPaymentGatewayDetails(instituteId, 'STRIPE', token);
      
      // Call the enrollment API with payment
      await handlePaymentForEnrollment({
        userEmail: "user@example.com", // This should come from user profile
        receiptEmail: "user@example.com", // This should come from user profile
        instituteId,
        packageSessionId,
        enrollmentData,
        paymentGatewayData,
        selectedPaymentPlan,
        selectedPaymentOption,
        amount: effectiveAmount,
        currency: selectedPaymentPlan.currency || enrollmentData.currency,
        description: `One-time payment for ${courseTitle}`,
        paymentType: 'one-time',
        paymentMethod,
        token,
        returnUrl: window.location.origin + "/courses", // Default return URL
        couponCode: couponCtx.state.appliedCode,
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
      console.error('One-time payment error:', err);
      if (err instanceof Error) {
        const errorMsg = err.message.toLowerCase();
        if (errorMsg.includes('card') || errorMsg.includes('payment method')) {
          setCardElementError(err.message);
        } else {
          setError(err.message);
        }
      } else {
        setError("Payment processing failed. Please try again.");
      }
    } finally {
      setProcessingPayment(false);
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
            <DialogTitle>Loading Payment Options</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center py-12">
            <div className="text-center space-y-4">
              <SpinnerGap className="w-8 h-8 animate-spin mx-auto text-primary-600" />
              <p className="text-gray-600">Loading payment options...</p>
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
            <DialogTitle>Payment Error</DialogTitle>
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-screen-90 overflow-y-auto p-0">
          {/* Header */}
          <div className="bg-primary-50 px-6 py-4 rounded-t-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Lock className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <DialogTitle className="text-xl font-semibold text-gray-900">
                  One-Time Payment for {courseTitle}
                </DialogTitle>
                {enrollmentData && (
                  <p className="text-gray-600 text-sm">
                    Complete your one-time payment to access the {getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}
                  </p>
                )}
              </div>
            </div>
          </div>
          
          {/* Content */}
          <div className="p-6 space-y-6">

        {enrollmentData && step === 'select' && (
          <div className="space-y-6">
            {/* Course Info */}
            <Card className="shadow-sm border border-gray-200">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold text-gray-900">{getTerminology(ContentTerms.Course, SystemTerms.Course)} Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">{getTerminology(ContentTerms.Course, SystemTerms.Course)}:</span>
                  <span className="font-medium text-gray-900">{courseTitle}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Access Period:</span>
                  <span className="text-sm text-gray-900">
                    {new Date(enrollmentData.start_date).toLocaleDateString()} - {new Date(enrollmentData.end_date).toLocaleDateString()}
                  </span>
                </div>
                {enrollmentData.learner_access_days > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Access Duration:</span>
                    <span className="text-sm text-gray-900">{enrollmentData.learner_access_days} days</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Payment Plans */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Select Payment Plan</h3>
                  <p className="text-gray-600 text-sm">Choose the plan that best suits your needs</p>
                </div>
              </div>
              
              {paymentOptions.length === 0 ? (
                <Card className="shadow-sm border border-gray-200">
                  <CardContent className="py-8 text-center">
                    <p className="text-gray-600">No payment plans available at the moment.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {paymentOptions.map((option) => (
                    <div key={option.id} className="space-y-3">
                      <div className="flex items-center space-x-3">
                        <CheckCircle className="w-5 h-5 text-blue-600" />
                        <div>
                          <h4 className="font-semibold text-gray-900">{option.name}</h4>
                          <p className="text-sm text-gray-600">{option.tag}</p>
                        </div>
                      </div>
                      
                      <div className="grid gap-3">
                        {getPaymentPlans(option).map((plan) => (
                          <Card
                            key={plan.id}
                            className={`cursor-pointer transition-all duration-200 shadow-sm ${
                              selectedPaymentPlan?.id === plan.id
                                ? "ring-2 ring-blue-500 border-blue-500 bg-blue-50"
                                : "border-gray-200 hover:border-gray-300 hover:shadow-md"
                            }`}
                            onClick={() => {
                              setSelectedPaymentOption(option);
                              setSelectedPaymentPlan(plan);
                            }}
                          >
                            <CardContent className="p-card-lg">
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center space-x-2 mb-2">
                                    <h5 className="font-semibold text-gray-900">{plan.name}</h5>
                                    {plan.tag && (
                                      <Badge variant="secondary" className="text-xs">
                                        {plan.tag}
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-sm text-gray-600 mb-3">
                                    {plan.description}
                                  </p>
                                  <div className="flex items-center space-x-4 text-xs text-gray-500">
                                    {plan.validity_in_days > 0 && (
                                      <span>Valid for {plan.validity_in_days} days</span>
                                    )}
                                    {plan.currency && (
                                      <span>Currency: {plan.currency.toUpperCase()}</span>
                                    )}
                                  </div>
                                </div>
                                <div className="text-end">
                                  <div className="text-2xl font-bold text-blue-600">
                                    {formatCurrency(plan.actual_price, plan.currency)}
                                  </div>
                                  {plan.elevated_price > plan.actual_price && (
                                    <div className="text-sm text-gray-500 line-through">
                                      {formatCurrency(plan.elevated_price, plan.currency)}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <strong className="text-red-800">❌ Error</strong>
                <p className="text-red-700 text-sm mt-1">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* Payment Step */}
        {step === 'payment' && selectedPaymentPlan && (
          <div className="space-y-6">
            {/* Summary */}
            <Card className="shadow-sm border border-gray-200">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold text-gray-900">Payment Summary</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStep('select')}
                    className="text-blue-600 border-blue-200 bg-blue-50 hover:bg-blue-100"
                  >
                    Change Plan
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Plan:</span>
                  <span className="font-medium text-gray-900">{selectedPaymentPlan.name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Amount:</span>
                  <span className="font-bold text-xl text-blue-600">
                    {formatCurrency(selectedPaymentPlan.actual_price, selectedPaymentPlan.currency)}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Payment Form */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Lock className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">💳 Secure Payment</h3>
                  <p className="text-gray-600 text-sm">Enter your card details below.</p>
                </div>
              </div>
              
              {couponsEnabled && (
                <div>
                  <CouponInput
                    state={couponCtx.state}
                    onChange={couponCtx.setCode}
                    onApply={couponCtx.apply}
                    onClear={couponCtx.clear}
                    currencySymbol={selectedPaymentPlan?.currency === "INR" ? "₹" : "$"}
                  />
                  {couponCtx.state.appliedCode && couponCtx.state.discount > 0 && (
                    <div className="mt-3 flex justify-between rounded bg-gray-50 px-3 py-2 text-sm">
                      <span className="text-gray-600">
                        Subtotal {selectedPaymentPlan?.actual_price?.toFixed(2)} ·
                        Coupon ({couponCtx.state.appliedCode}) − {couponCtx.state.discount.toFixed(2)}
                      </span>
                      <span className="font-semibold text-gray-900">
                        You pay {effectiveAmount.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <Card className="shadow-sm border border-gray-200">
                <CardContent className="p-card-lg">
                  <div className={`border rounded-lg p-4 bg-white ${
                    cardElementError ? 'border-red-500 bg-red-50' : 'border-gray-300'
                  }`}>
                    {!cardElementReady && (
                      <div className="flex items-center justify-center h-12 text-gray-500">
                        <SpinnerGap className="w-5 h-5 animate-spin me-2" />
                        Loading payment form...
                      </div>
                    )}
                    <div ref={cardElementRef} className="w-full h-full" />
                  </div>
                  
                  {cardElementError && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg mt-4">
                      <strong className="text-red-800">❌ Error</strong>
                      <p className="text-red-700 text-sm mt-1">{cardElementError}</p>
                    </div>
                  )}

                  <div className="flex flex-col gap-stack mt-6">
                    <MyButton
                      type="button"
                      scale="large"
                      buttonType="primary"
                      layoutVariant="default"
                      disabled={processingPayment}
                      onClick={handleEnroll}
                      className="w-full h-12 text-base flex items-center justify-center gap-2"
                    >
                      {processingPayment ? (
                        <>
                          <SpinnerGap className="w-5 h-5 animate-spin" />
                          Processing Payment...
                        </>
                      ) : (
                        <>
                          <Lock className="w-5 h-5" />
                          Pay Now
                        </>
                      )}
                    </MyButton>
                    
                    <div className="text-sm text-gray-500 text-center flex items-center justify-center gap-2">
                      <Lock size={16} />
                      Secure payment powered by
                      <span className="font-semibold flex items-center gap-1">
                        <SiStripe size={18} className="text-indigo-600" />
                        Stripe
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
          </div>
          
          {/* Footer */}
          <div className="border-t border-gray-200 px-6 py-4 bg-gray-50 rounded-b-lg">
            {step === 'select' ? (
              <div className="flex gap-3">
                <MyButton
                  buttonType="secondary"
                  scale="large"
                  layoutVariant="default"
                  className="flex-1 h-11"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </MyButton>
                <MyButton
                  buttonType="primary"
                  scale="large"
                  layoutVariant="default"
                  className="flex-1 h-11"
                  disabled={!selectedPaymentOption || !selectedPaymentPlan}
                  onClick={() => setStep('payment')}
                >
                  Continue to Payment
                </MyButton>
              </div>
            ) : (
              <MyButton
                buttonType="secondary"
                scale="large"
                layoutVariant="default"
                className="w-full h-11"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </MyButton>
            )}
          </div>
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