import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SpinnerGap, Lock } from "@phosphor-icons/react";
import { EnvelopeSimple } from "@phosphor-icons/react";
import { SiStripe } from "react-icons/si"; // design-lint-ignore: Stripe brand logo (Simple Icons; no Phosphor equivalent)
import { Preferences } from "@capacitor/preferences";
import {
  fetchEnrollmentDetails,
  getPaymentOptions,
  getPaymentPlans,
  formatCurrency,
  handlePaymentForEnrollment,
  fetchPaymentGatewayDetails,
  createStripePaymentMethodWithElements,
  validateAndSanitizeEmail,
  resolveEnrollmentVendor,
  extractRazorpayOrderDetails,
  type EnrollmentResponse,
  type PaymentOption,
  type PaymentPlan,
} from "../../-services/enrollment-api";
import {
  RazorpayCheckoutForm,
  type RazorpayCheckoutFormRef,
} from "@/components/common/enroll-by-invite/-components/razorpay-checkout-form";
import EwayCardForm from "@/components/common/enroll-by-invite/-components/eway-card-form";
import { EwayProvider } from "@/components/common/enroll-by-invite/-contexts/eway-context";
import {
  runPhonePeCheckout,
  runCashfreeCheckout,
  runEwayCheckout,
  type EwayEncryptedData,
} from "./vendor-checkout";
import { MyButton } from "@/components/design-system/button";
import { EnrollmentSuccessDialog } from "./EnrollmentSuccessDialog";
import { EnrollmentPendingDialog } from "./EnrollmentPendingDialog";
import { EnrollmentPendingApprovalDialog } from "./EnrollmentPendingApprovalDialog";
import { PaymentStatusPollingDialog } from "./PaymentStatusPollingDialog";
import { PaymentSuccessDialog } from "./PaymentSuccessDialog";
import { PaymentFailedDialog } from "./PaymentFailedDialog";
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
  onNavigateToSlides?: () => void;
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
  const [processingPayment, setProcessingPayment] = useState(false);
  const [step, setStep] = useState<"select" | "email" | "payment">("select");
  const [email, setEmail] = useState("");
  const [validationError, setValidationError] = useState<string>("");
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [showPendingDialog, setShowPendingDialog] = useState(false);
  const [showPendingApprovalDialog, setShowPendingApprovalDialog] =
    useState(false);
  const [showPaymentStatusDialog, setShowPaymentStatusDialog] = useState(false);
  const [showPaymentSuccessDialog, setShowPaymentSuccessDialog] =
    useState(false);
  const [showPaymentFailedDialog, setShowPaymentFailedDialog] = useState(false);
  const [approvalRequired, setApprovalRequired] = useState(false);

  // Stripe Elements state
  const [stripe, setStripe] = useState<any>(null);
  const [stripeElements, setStripeElements] = useState<any>(null);
  const [cardElement, setCardElement] = useState<any>(null);
  const [cardElementError, setCardElementError] = useState<string>("");
  const [cardElementReady, setCardElementReady] = useState<boolean>(false);
  const cardElementRef = useRef<HTMLDivElement>(null);

  // Payment gateway vendor the institute is configured with (STRIPE | RAZORPAY | …),
  // resolved from the enrollment /details response. Drives which checkout UI and
  // which payment request we build — never assume STRIPE.
  const vendor = resolveEnrollmentVendor(enrollmentData);
  const isRazorpay = vendor === "RAZORPAY";
  const isStripe = vendor === "STRIPE";
  const isEway = vendor === "EWAY";
  const isCashfree = vendor === "CASHFREE";
  const isPhonePe = vendor === "PHONEPE";
  // Vendors this in-course dialog can take payment for. Anything else (PAYPAL,
  // MANUAL, …) shows a clear notice instead of a dead Stripe card form.
  const isSupportedVendor =
    isStripe || isRazorpay || isEway || isCashfree || isPhonePe;
  const razorpayRef = useRef<RazorpayCheckoutFormRef>(null);
  // Eway: eCrypt keys (fetched for EWAY institutes) + the encrypted card payload.
  const [ewayKeys, setEwayKeys] = useState<{
    encryptionKey: string;
    publicKey: string;
  } | null>(null);
  const [ewayData, setEwayData] = useState<EwayEncryptedData | null>(null);

  // Track if we already prefilled the email for this dialog open
  const hasPrefilledEmailRef = useRef<boolean>(false);

  // Institute-level coupon toggle + checkout state. The applied discount is
  // subtracted from `effectiveAmount` so the gateway charges the right amount,
  // and the code is passed through to handlePaymentForEnrollment so the BE
  // can atomically decrement usage_limit at UserPlan creation.
  const couponsEnabled = useCouponsEnabled();
  const couponCtx = useCheckoutCoupon({
    buildRequest: (code) => ({
      couponCode: code,
      instituteId,
      enrollInviteId: enrollmentData?.id || null,
      packageSessionId,
      paymentPlanId: selectedPaymentPlan?.id ?? null,
      userEmail: email || null,
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

  // Helper function to get real user data from preferences
  const getRealUserData = useCallback(async () => {
    try {
      const { value } = await Preferences.get({ key: "StudentDetails" });
      if (!value) {
        return null;
      }

      const studentData = JSON.parse(value);
      // Handle both array and object formats
      const student = Array.isArray(studentData) ? studentData[0] : studentData;

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
      };
    } catch (error) {
      return null;
    }
  }, []);

  // Prefill email when dialog opens (only once per open)
  useEffect(() => {
    const prefillEmail = async () => {
      if (open && !hasPrefilledEmailRef.current) {
        const userData = await getRealUserData();
        if (userData?.email) {
          // Only set if user hasn't typed anything yet
          setEmail((prev) => (prev ? prev : userData.email));
        }
        hasPrefilledEmailRef.current = true;
      }

      if (!open) {
        // Reset flag when dialog closes so next open can prefill again
        hasPrefilledEmailRef.current = false;
      }
    };

    prefillEmail();
  }, [open, getRealUserData]);

  // Fetch enrollment data when dialog opens
  useEffect(() => {
    if (open && packageSessionId) {
      fetchEnrollmentData();
    }
  }, [open, packageSessionId]);

  // Auto-select first payment option and best plan
  useEffect(() => {
    if (enrollmentData && !selectedPaymentOption) {
      const paymentOptions = getPaymentOptions(enrollmentData);
      const oneTimeOptions = paymentOptions.filter(
        (option) => option.payment_option_type === "ONE_TIME"
      );

      if (oneTimeOptions.length > 0) {
        const option = oneTimeOptions[0];
        setSelectedPaymentOption(option);

        // Auto-select the best plan (prefer discounted plans, then default)
        const plans = getPaymentPlans(option);
        console.log("OneTimePaymentDialog - Available plans:", plans);

        if (plans.length > 0) {
          // Remove duplicate plans by ID to prevent React key warnings
          const uniquePlans = plans.filter(
            (plan, index, self) =>
              index === self.findIndex((p) => p.id === plan.id)
          );

          console.log(
            "OneTimePaymentDialog - Unique plans after deduplication:",
            uniquePlans
          );

          // Sort plans: discounted plans first, then by price
          const sortedPlans = uniquePlans.sort((a, b) => {
            // Check if plan has discount (elevated_price > actual_price)
            const aHasDiscount =
              a.elevated_price && a.elevated_price > a.actual_price;
            const bHasDiscount =
              b.elevated_price && b.elevated_price > b.actual_price;

            // Prioritize discounted plans
            if (aHasDiscount && !bHasDiscount) return -1;
            if (!aHasDiscount && bHasDiscount) return 1;

            // If both have discount, prefer the one with higher discount percentage
            if (aHasDiscount && bHasDiscount) {
              const aDiscountPercent =
                ((a.elevated_price - a.actual_price) / a.elevated_price) * 100;
              const bDiscountPercent =
                ((b.elevated_price - b.actual_price) / b.elevated_price) * 100;
              return bDiscountPercent - aDiscountPercent; // Higher discount first
            }

            // If neither has discount, sort by price (lowest first)
            return a.actual_price - b.actual_price;
          });

          console.log("OneTimePaymentDialog - Selected plan:", sortedPlans[0]);
          setSelectedPaymentPlan(sortedPlans[0]);
        }
      }
    }
  }, [enrollmentData, selectedPaymentOption]);

  // Simple loadStripe function
  const loadStripe = useCallback(async (publishableKey: string) => {
    // Check if Stripe is already loaded
    if (window.Stripe) {
      return window.Stripe(publishableKey);
    }

    // Load Stripe.js script
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.async = true;

    return new Promise((resolve, reject) => {
      script.onload = () => {
        if (window.Stripe) {
          const stripe = window.Stripe(publishableKey);
          resolve(stripe);
        } else {
          reject(new Error("Stripe failed to load"));
        }
      };
      script.onerror = () => {
        reject(new Error("Failed to load Stripe script"));
      };
      document.head.appendChild(script);
    });
  }, []);

  // Initialize Stripe Elements when payment gateway data is loaded
  useEffect(() => {
    const initializeStripeElements = async () => {
      // Stripe-only: skip entirely for Razorpay (or any non-Stripe) institutes,
      // otherwise we'd fetch STRIPE gateway details that don't exist and error.
      if (
        vendor === "STRIPE" &&
        enrollmentData &&
        cardElementRef.current &&
        step === "payment"
      ) {
        // Clear any previous errors when starting initialization
        setCardElementError("");

        try {
          // Fetch payment gateway details
          const paymentGatewayData = await fetchPaymentGatewayDetails(
            instituteId,
            vendor,
            token
          );

          let stripeInstance = stripe;

          // Load Stripe if not already loaded
          if (!stripeInstance) {
            stripeInstance = await loadStripe(
              paymentGatewayData.publishableKey
            );
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
          const card = elements.create("card", {
            style: {
              base: {
                fontSize: "16px",
                color: "#374151", // design-lint-ignore: payment SDK element style
                fontFamily:
                  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                "::placeholder": {
                  color: "#9CA3AF", // design-lint-ignore: payment SDK element style
                },
                padding: "8px 0",
              },
              invalid: {
                color: "#DC2626", // design-lint-ignore: payment SDK element style
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
              card.on("ready", () => {
                setCardElementReady(true);
                setCardElementError("");
              });

              card.on("change", (event: any) => {
                if (event.error) {
                  setCardElementError(event.error.message);
                } else {
                  setCardElementError("");
                }
              });
            }
          }, 100);
        } catch (error) {
          console.error("Stripe initialization error:", error);
          setCardElementError(
            "Failed to load payment form. Please refresh and try again."
          );
        }
      }
    };

    initializeStripeElements();
  }, [
    enrollmentData,
    stripe,
    stripeElements,
    step,
    open,
    loadStripe,
    instituteId,
    token,
    vendor,
  ]);

  // Fetch Eway eCrypt keys for EWAY institutes — EwayCardForm needs them (via
  // EwayProvider) to encrypt the card client-side before we submit.
  useEffect(() => {
    if (!isEway || !open || ewayKeys) return;
    let cancelled = false;
    (async () => {
      try {
        const keys = (await fetchPaymentGatewayDetails(
          instituteId,
          "EWAY",
          token
        )) as unknown as { encryptionKey?: string; publicKey?: string };
        if (!cancelled) {
          setEwayKeys({
            encryptionKey: keys?.encryptionKey || "",
            publicKey: keys?.publicKey || "",
          });
        }
      } catch {
        // Leave keys null → EwayCardForm renders unconfigured; Pay stays disabled.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEway, open, instituteId, token, ewayKeys]);

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

      // Auto-select first payment option and first plan
      const paymentOptions = getPaymentOptions(data);
      if (paymentOptions.length > 0) {
        const firstOption = paymentOptions[0];
        setSelectedPaymentOption(firstOption);

        // Auto-select the first plan since there's only one
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

  // Razorpay: create the order server-side, then open Razorpay's hosted modal.
  // Payment completion arrives asynchronously via handleRazorpaySuccess.
  const handleRazorpayPayment = async () => {
    if (!selectedPaymentOption || !selectedPaymentPlan || !enrollmentData) {
      setError("Please select a payment plan.");
      return;
    }

    setProcessingPayment(true);
    setError(null);

    try {
      const paymentGatewayData = await fetchPaymentGatewayDetails(
        instituteId,
        vendor,
        token
      );

      const userData = await getRealUserData();
      const userProfileEmail = userData?.email || email;
      const contact = userData?.mobile_number || "";

      // Step 1: create the Razorpay order via the enroll endpoint.
      const result = await handlePaymentForEnrollment({
        userEmail: userProfileEmail,
        receiptEmail: email,
        instituteId,
        packageSessionId,
        enrollmentData,
        paymentGatewayData,
        selectedPaymentPlan,
        selectedPaymentOption,
        amount: effectiveAmount,
        currency: selectedPaymentPlan.currency || enrollmentData.currency,
        description: `One-time payment for ${courseTitle}`,
        paymentType: "one-time",
        vendor,
        contact,
        returnUrl: window.location.origin + "/courses",
        couponCode: couponCtx.state.appliedCode,
        token,
        userData: userData || undefined,
      });

      // Step 2: extract order details and open the hosted checkout.
      const orderDetails = extractRazorpayOrderDetails(result);
      if (!orderDetails) {
        throw new Error(
          "Failed to create the payment order. Please try again."
        );
      }
      if (!razorpayRef.current) {
        throw new Error("Payment gateway not ready. Please try again.");
      }

      razorpayRef.current.openPayment({
        razorpayKeyId: orderDetails.razorpayKeyId,
        razorpayOrderId: orderDetails.razorpayOrderId,
        amount: orderDetails.amount,
        currency:
          orderDetails.currency ||
          selectedPaymentPlan.currency ||
          enrollmentData.currency,
        contact: orderDetails.contact || contact,
        email: orderDetails.email || email,
      });

      // Modal is now open; stop the button spinner. Completion is handled by
      // handleRazorpaySuccess (onPaymentReady) / handleRazorpayError (onError).
      setProcessingPayment(false);
    } catch (err) {
      console.error("One-time Razorpay payment error:", err);
      if (err instanceof Error && err.message === "ENROLLMENT_PENDING_APPROVAL") {
        onOpenChange(false);
        setShowPendingApprovalDialog(true);
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Payment processing failed. Please try again."
        );
      }
      setProcessingPayment(false);
    }
  };

  // Razorpay hosted-modal callbacks.
  const handleRazorpaySuccess = () => {
    // Order is paid; close checkout and poll the backend for confirmation.
    onOpenChange(false);
    setShowPaymentStatusDialog(true);
  };

  const handleRazorpayError = (message: string) => {
    setProcessingPayment(false);
    setError(message);
  };

  // EWAY (inline encrypted card) + CASHFREE / PHONEPE (full-page redirect).
  const handleAltVendorPayment = async () => {
    if (!selectedPaymentOption || !selectedPaymentPlan || !enrollmentData) {
      setError("Please select a payment plan.");
      return;
    }
    if (isEway && !ewayData) {
      setError("Please complete the card details.");
      return;
    }

    setProcessingPayment(true);
    setError(null);

    try {
      const userData = await getRealUserData();
      const baseParams = {
        instituteId,
        packageSessionId,
        enrollmentData,
        selectedPaymentPlan,
        selectedPaymentOption,
        amount: effectiveAmount,
        currency: selectedPaymentPlan.currency || enrollmentData.currency,
        description: `One-time payment for ${courseTitle}`,
        paymentType: "one-time" as const,
        email,
        contact: userData?.mobile_number || "",
        userData: userData || undefined,
        couponCode: couponCtx.state.appliedCode,
        token,
      };

      if (isEway) {
        const { status } = await runEwayCheckout({
          ...baseParams,
          ewayPaymentData: ewayData!,
        });
        if (status === "PAID") {
          onOpenChange(false);
          setShowPaymentStatusDialog(true);
        } else {
          setError(
            "Payment was not successful. Please check your card details and try again."
          );
          setProcessingPayment(false);
        }
        return;
      }

      // Cashfree / PhonePe navigate away to the hosted page; the browser unloads
      // on success, so we only reach the catch below on failure.
      if (isCashfree) {
        await runCashfreeCheckout(baseParams);
        return;
      }
      if (isPhonePe) {
        await runPhonePeCheckout(baseParams);
        return;
      }
    } catch (err) {
      console.error("One-time alt-vendor payment error:", err);
      if (err instanceof Error && err.message === "ENROLLMENT_PENDING_APPROVAL") {
        onOpenChange(false);
        setShowPendingApprovalDialog(true);
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Payment processing failed. Please try again."
        );
      }
      setProcessingPayment(false);
    }
  };

  const handleEnroll = async () => {
    if (!selectedPaymentOption || !selectedPaymentPlan || !enrollmentData) {
      setError("Please select a payment plan.");
      return;
    }

    // Razorpay uses a hosted modal + server-created order, not Stripe Elements.
    if (isRazorpay) {
      await handleRazorpayPayment();
      return;
    }

    // Eway (encrypted card) + Cashfree / PhonePe (redirect) have their own flows.
    if (isEway || isCashfree || isPhonePe) {
      await handleAltVendorPayment();
      return;
    }

    setProcessingPayment(true);
    setError(null);
    setCardElementError("");

    try {
      // Validate Stripe Elements
      if (!stripe || !cardElement || !cardElementReady) {
        setCardElementError(
          "Payment form not loaded. Please refresh and try again."
        );
        return;
      }

      // Create payment method using Stripe Elements
      const paymentMethod = await createStripePaymentMethodWithElements(
        stripe,
        cardElement
      );

      // Fetch payment gateway details (needed for enrollment API)
      const paymentGatewayData = await fetchPaymentGatewayDetails(
        instituteId,
        vendor,
        token
      );

      // Get real user data for payment
      const userData = await getRealUserData();
      const userProfileEmail = userData?.email || email;

      // Call the enrollment API with payment
      console.log("OneTimePaymentDialog - Calling enrollment API", {
        packageSessionId,
        courseTitle,
        userEmail: userProfileEmail,
        receiptEmail: email,
        amount: selectedPaymentPlan.actual_price,
        currency: selectedPaymentPlan.currency || enrollmentData.currency,
        paymentType: "one-time",
      });

      await handlePaymentForEnrollment({
        userEmail: userProfileEmail,
        receiptEmail: email,
        instituteId,
        packageSessionId,
        enrollmentData,
        paymentGatewayData,
        selectedPaymentPlan,
        selectedPaymentOption,
        amount: effectiveAmount,
        currency: selectedPaymentPlan.currency || enrollmentData.currency,
        description: `One-time payment for ${courseTitle}`,
        paymentType: "one-time",
        paymentMethod,
        returnUrl: window.location.origin + "/courses", // Default return URL
        couponCode: couponCtx.state.appliedCode,
        token,
      });

      console.log(
        "OneTimePaymentDialog - Enrollment API call successful, starting payment status polling",
        {
          packageSessionId,
          courseTitle,
        }
      );

      // Close the main dialog
      onOpenChange(false);

      // For one_time payments, start payment status polling
      setShowPaymentStatusDialog(true);
    } catch (err) {
      console.error("One-time payment error:", err);

      // Handle specific error cases
      if (
        err instanceof Error &&
        err.message === "ENROLLMENT_PENDING_APPROVAL"
      ) {
        // User already has a pending enrollment request
        onOpenChange(false);
        setShowPendingApprovalDialog(true);
      } else if (err instanceof Error) {
        const errorMsg = err.message.toLowerCase();
        if (errorMsg.includes("card") || errorMsg.includes("payment method")) {
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

  const handleExploreCourse = async () => {
    setShowSuccessDialog(false);
    if (onEnrollmentSuccess) {
      await onEnrollmentSuccess();
    }
  };

  // Payment status dialog handlers
  const handlePaymentSuccess = (approvalRequired: boolean) => {
    console.log("OneTimePaymentDialog - Payment success received", {
      packageSessionId,
      courseTitle,
      approvalRequired,
    });
    setShowPaymentStatusDialog(false);
    setApprovalRequired(approvalRequired);

    // If no approval required, immediately enroll user
    if (!approvalRequired) {
      console.log(
        "OneTimePaymentDialog - No approval required, enrolling user immediately"
      );
      if (onEnrollmentSuccess) {
        onEnrollmentSuccess();
      }
    }

    // Always show success dialog (for both approval required and not required cases)
    setShowPaymentSuccessDialog(true);
  };

  const handlePaymentFailed = () => {
    console.log("OneTimePaymentDialog - Payment failed received", {
      packageSessionId,
      courseTitle,
    });
    setShowPaymentStatusDialog(false);
    setShowPaymentFailedDialog(true);
  };

  const handlePaymentStatusClose = () => {
    console.log("OneTimePaymentDialog - Payment status dialog closed", {
      packageSessionId,
      courseTitle,
    });
    setShowPaymentStatusDialog(false);
  };

  const handlePaymentSuccessClose = () => {
    console.log("OneTimePaymentDialog - Payment success dialog closed", {
      packageSessionId,
      courseTitle,
      approvalRequired,
    });
    setShowPaymentSuccessDialog(false);
    // For approval required case, just close the dialog - enrollment will happen when admin approves
  };

  const handlePaymentFailedClose = () => {
    console.log("OneTimePaymentDialog - Payment failed dialog closed", {
      packageSessionId,
      courseTitle,
    });
    setShowPaymentFailedDialog(false);
  };

  const handleTryAgain = () => {
    console.log("OneTimePaymentDialog - Try again clicked", {
      packageSessionId,
      courseTitle,
    });
    setShowPaymentFailedDialog(false);
    // Reopen the main enrollment dialog
    onOpenChange(true);
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md max-h-screen-90 overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-center">
              One-Time Payment
            </DialogTitle>
            {enrollmentData && (
              <p className="text-sm text-gray-600 text-center">
                Complete your one-time payment to access the {getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}
              </p>
            )}
          </DialogHeader>

          {enrollmentData && step === "select" && (
            <>
              {/* Plan Summary */}
              {selectedPaymentPlan && (
                <div className="bg-gradient-to-r from-info-50 to-indigo-50 border border-blue-200 rounded-xl p-6 mb-6">
                  <div className="text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
                      <svg
                        className="w-8 h-8 text-blue-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"
                        />
                      </svg>
                    </div>
                    <h3 className="text-2xl font-bold text-gray-900 mb-2">
                      {selectedPaymentOption?.name || selectedPaymentPlan.name}
                    </h3>
                    <div className="flex items-center justify-center gap-3 mb-3">
                      {selectedPaymentPlan.elevated_price &&
                        selectedPaymentPlan.elevated_price >
                          selectedPaymentPlan.actual_price && (
                          <div className="text-2xl font-bold text-gray-400 line-through">
                            {formatCurrency(
                              selectedPaymentPlan.elevated_price,
                              selectedPaymentPlan.currency
                            )}
                          </div>
                        )}
                      <div className="text-4xl font-bold text-blue-600">
                        {formatCurrency(
                          selectedPaymentPlan.actual_price,
                          selectedPaymentPlan.currency
                        )}
                      </div>
                      {selectedPaymentPlan.elevated_price &&
                        selectedPaymentPlan.elevated_price >
                          selectedPaymentPlan.actual_price && (
                          <div className="inline-flex items-center px-2 py-1 bg-green-100 text-green-700 text-sm font-medium rounded-full">
                            {Math.round(
                              ((selectedPaymentPlan.elevated_price -
                                selectedPaymentPlan.actual_price) /
                                selectedPaymentPlan.elevated_price) *
                                100
                            )}
                            % OFF
                          </div>
                        )}
                    </div>
                    <div className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-700 text-sm font-medium rounded-full">
                      One-time payment
                    </div>
                  </div>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-center">
                    <svg
                      className="w-5 h-5 text-red-400 me-2"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <p className="text-red-600 text-sm">{error}</p>
                  </div>
                </div>
              )}

              {/* Action Button */}
              <div className="space-y-4">
                <MyButton
                  type="button"
                  scale="large"
                  buttonType="primary"
                  layoutVariant="default"
                  className="w-full h-14 text-lg font-semibold"
                  disabled={
                    !selectedPaymentOption ||
                    !selectedPaymentPlan ||
                    processingPayment
                  }
                  onClick={() => setStep("email")}
                >
                  {processingPayment ? (
                    <>
                      <SpinnerGap className="w-5 h-5 animate-spin me-2" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-5 h-5 me-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13 7l5 5m0 0l-5 5m5-5H6"
                        />
                      </svg>
                      Continue to Payment
                    </>
                  )}
                </MyButton>

                <div className="text-center">
                  <p className="text-xs text-gray-500">
                    Secure payment • Instant access • 30-day money-back
                    guarantee
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Email Step */}
          {step === "email" && selectedPaymentPlan && (
            <>
              {/* Selected Plan Summary */}
              {selectedPaymentPlan && (
                <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="mb-2">
                    <span className="font-semibold text-blue-700">
                      Payment Summary
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-blue-600">Plan:</span>
                    <span className="font-semibold text-blue-900">
                      {selectedPaymentOption?.name || selectedPaymentPlan.name}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-blue-600">Price:</span>
                    <span className="font-semibold text-blue-900">
                      {formatCurrency(
                        selectedPaymentPlan.actual_price,
                        selectedPaymentPlan.currency
                      )}
                    </span>
                  </div>
                  <div className="flex justify-end mt-3">
                    <MyButton
                      buttonType="secondary"
                      scale="small"
                      layoutVariant="default"
                      className="text-xs"
                      onClick={() => setStep("select")}
                    >
                      Back
                    </MyButton>
                  </div>
                </div>
              )}

              {/* Email Input */}
              <div className="mb-4">
                <label
                  className="block text-sm font-medium text-gray-700 mb-2"
                  htmlFor="one-time-email"
                >
                  Email Address
                </label>
                <div className="relative">
                  <span className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <EnvelopeSimple size={18} />
                  </span>
                  <input
                    id="one-time-email"
                    type="email"
                    className={`border rounded-lg ps-10 pe-4 py-3 text-sm w-full h-12 focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      validationError
                        ? "border-red-500 bg-red-50"
                        : "border-gray-300"
                    }`}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setValidationError("");
                    }}
                    placeholder="you@example.com"
                  />
                </div>
                {validationError && (
                  <p className="text-red-600 text-xs mt-1">{validationError}</p>
                )}
                <p className="text-sm text-gray-500 mt-2">
                  We'll send your receipt and {getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} details to this email
                  address
                </p>
              </div>

              {/* Continue Button */}
              <div className="flex justify-center">
                <MyButton
                  type="button"
                  scale="large"
                  buttonType="primary"
                  layoutVariant="default"
                  className="w-full"
                  disabled={!email.trim()}
                  onClick={() => {
                    // Validate email before proceeding to payment
                    if (!email || !email.trim()) {
                      setValidationError("Please enter your email address");
                      return;
                    }

                    // Enhanced email validation and sanitization
                    try {
                      const sanitizedEmail = validateAndSanitizeEmail(email);
                      setEmail(sanitizedEmail);
                    } catch (error) {
                      setValidationError(
                        error instanceof Error
                          ? error.message
                          : "Please enter a valid email address"
                      );
                      return;
                    }

                    setStep("payment");
                  }}
                >
                  Continue to Payment
                </MyButton>
              </div>
            </>
          )}

          {/* Payment Step */}
          {step === "payment" && selectedPaymentPlan && (
            <>
              {/* Payment Summary */}
              {selectedPaymentPlan && (
                <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="mb-2">
                    <span className="font-semibold text-blue-700">
                      Payment Summary
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-blue-600">Plan:</span>
                    <span className="font-semibold text-blue-900">
                      {selectedPaymentOption?.name || selectedPaymentPlan.name}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-blue-600">Amount:</span>
                    <span className="font-semibold text-blue-900">
                      {formatCurrency(
                        selectedPaymentPlan.actual_price,
                        selectedPaymentPlan.currency
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-blue-600">Email:</span>
                    <span className="font-semibold text-blue-900">{email}</span>
                  </div>
                  <div className="flex justify-end mt-3">
                    <MyButton
                      buttonType="secondary"
                      scale="small"
                      layoutVariant="default"
                      className="text-xs"
                      onClick={() => setStep("email")}
                    >
                      Edit
                    </MyButton>
                  </div>
                </div>
              )}

              {/* Discount coupon — institute toggle gates whether visible. */}
              {couponsEnabled && (
                <div className="mb-4">
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
                        Subtotal{" "}
                        {selectedPaymentPlan?.actual_price?.toFixed(2)} ·
                        Coupon ({couponCtx.state.appliedCode}) − {couponCtx.state.discount.toFixed(2)}
                      </span>
                      <span className="font-semibold text-gray-900">
                        You pay {effectiveAmount.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {!isSupportedVendor ? (
                /* PAYPAL / MANUAL etc. aren't wired into this in-course dialog —
                   show a clear notice instead of a broken Stripe form. */
                <div className="mb-2 border border-orange-300 bg-orange-50 rounded p-4 text-sm space-y-2">
                  <div className="flex items-center gap-2 text-orange-700">
                    <Lock size={16} />
                    <span className="font-medium">
                      {vendor} payments aren't available here yet
                    </span>
                  </div>
                  <p className="text-orange-600">
                    This {getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}'s payment provider ({vendor}) isn't supported on
                    this screen yet. Please use the enrollment link to complete
                    your payment, or contact support.
                  </p>
                </div>
              ) : isRazorpay ? (
                /* Razorpay renders its own hosted card; we just mount the
                   component (loads the SDK + exposes openPayment via ref). */
                <div className="mb-2">
                  <RazorpayCheckoutForm
                    ref={razorpayRef}
                    error={error}
                    amount={effectiveAmount}
                    currency={
                      selectedPaymentPlan.currency || enrollmentData.currency
                    }
                    courseName={courseTitle}
                    courseDescription={`One-time payment for ${courseTitle}`}
                    userEmail={email}
                    onPaymentReady={handleRazorpaySuccess}
                    onError={handleRazorpayError}
                    isProcessing={processingPayment}
                  />
                </div>
              ) : isEway ? (
                /* Eway: collect card + encrypt client-side via eCrypt (keys from
                   EwayProvider). onPaymentReady hands us the encrypted payload. */
                <div className="mb-2">
                  {ewayKeys ? (
                    <EwayProvider
                      encryptionKey={ewayKeys.encryptionKey}
                      publicKey={ewayKeys.publicKey}
                    >
                      <EwayCardForm
                        isProcessing={processingPayment}
                        onPaymentReady={setEwayData}
                        onError={(msg) => setError(msg)}
                      />
                    </EwayProvider>
                  ) : (
                    <div className="flex items-center justify-center py-6 text-gray-500">
                      <SpinnerGap className="w-4 h-4 animate-spin me-2" />
                      Loading secure card form...
                    </div>
                  )}
                </div>
              ) : isCashfree || isPhonePe ? (
                /* Cashfree / PhonePe are full-page redirect flows — no inline
                   card; the Pay button hands off to the hosted checkout page. */
                <div className="mb-2 border border-blue-200 bg-blue-50 rounded p-4 text-sm text-blue-700">
                  You'll be securely redirected to{" "}
                  {isCashfree ? "Cashfree" : "PhonePe"} to complete your payment,
                  then brought back to your {getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}.
                </div>
              ) : (
                <div className="mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs text-gray-600">
                      Card Details
                    </label>
                  </div>

                  <div
                    className={`border rounded p-3 text-sm w-full min-h-12 ${
                      cardElementError
                        ? "border-red-500 bg-red-50"
                        : "border-gray-300"
                    }`}
                  >
                    {!cardElementReady && (
                      <div className="flex items-center justify-center h-full text-gray-500">
                        <SpinnerGap className="w-4 h-4 animate-spin me-2" />
                        Loading payment form...
                      </div>
                    )}
                    <div ref={cardElementRef} className="w-full h-full" />
                  </div>

                  {cardElementError && (
                    <div className="text-red-600 text-sm mt-2">
                      {cardElementError}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-4">
                <MyButton
                  type="button"
                  scale="large"
                  buttonType="primary"
                  layoutVariant="default"
                  className="w-full"
                  disabled={
                    processingPayment ||
                    !isSupportedVendor ||
                    (isEway && !ewayData)
                  }
                  onClick={handleEnroll}
                >
                  {processingPayment ? (
                    <>
                      <SpinnerGap className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4" />
                      Pay Now
                    </>
                  )}
                </MyButton>

                <div className="text-xs text-gray-500 text-center flex items-center justify-center gap-1">
                  <Lock size={14} className="inline-block me-1" />
                  Secure payment powered by
                  <span className="font-semibold flex items-center gap-1 ms-1">
                    {isStripe ? (
                      <>
                        <SiStripe size={16} className="text-indigo-600" />
                        Stripe
                      </>
                    ) : (
                      vendor.charAt(0) + vendor.slice(1).toLowerCase()
                    )}
                  </span>
                </div>
              </div>
            </>
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
        onClose={() => setShowPendingApprovalDialog(false)}
      />

      {/* Payment Status Polling Dialog */}
      <PaymentStatusPollingDialog
        open={showPaymentStatusDialog}
        onOpenChange={setShowPaymentStatusDialog}
        packageSessionId={packageSessionId}
        courseTitle={courseTitle}
        onPaymentSuccess={handlePaymentSuccess}
        onPaymentFailed={handlePaymentFailed}
        onClose={handlePaymentStatusClose}
      />

      {/* Payment Success Dialog */}
      <PaymentSuccessDialog
        open={showPaymentSuccessDialog}
        onOpenChange={setShowPaymentSuccessDialog}
        courseTitle={courseTitle}
        approvalRequired={approvalRequired}
        onExploreCourse={onNavigateToSlides}
        onClose={handlePaymentSuccessClose}
      />

      {/* Payment Failed Dialog */}
      <PaymentFailedDialog
        open={showPaymentFailedDialog}
        onOpenChange={setShowPaymentFailedDialog}
        courseTitle={courseTitle}
        onTryAgain={handleTryAgain}
        onClose={handlePaymentFailedClose}
      />
    </>
  );
};
