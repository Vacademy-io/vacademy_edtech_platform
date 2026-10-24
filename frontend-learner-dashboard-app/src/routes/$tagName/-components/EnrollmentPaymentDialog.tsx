import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { BASE_URL } from "@/constants/urls";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import {
  RazorpayCheckoutForm,
  RazorpayCheckoutFormRef,
} from "@/components/common/enroll-by-invite/-components/razorpay-checkout-form";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Cross2Icon } from "@radix-ui/react-icons";
import { MyButton } from "@/components/design-system/button";
import { SpinnerGap } from "@phosphor-icons/react";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { SiStripe } from "react-icons/si"; // design-lint-ignore: Stripe brand logo (no Phosphor equivalent)
import { Lock } from "@phosphor-icons/react";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/bootstrap.css";
import { isBlankPhone, validatePhoneField } from "@/lib/phone-validation";
import {
  phoneFieldHasInput,
  usePreferredPhoneCountries,
} from "@/hooks/use-preferred-phone-countries";
import {
  GET_PAYMENT_GATEWAY_DETAILS_URL,
  ENROLLMENT_INVITE_URL,
  LIVE_SESSION_REQUEST_OTP,
  LIVE_SESSION_VERIFY_OTP,
  ENROLL_USER_INVITE_PAYMENT_URL,
  LOGIN_URL,
} from "@/constants/urls";
import { CashfreeCheckoutForm } from "@/components/common/enroll-by-invite/-components/cashfree-checkout-form";
import { getCashfreeReturnUrl } from "@/services/cashfree-payment";
import { cachedGet } from "@/lib/http/clientCache";
import { getCurrencySymbol } from "@/utils/currency";
import axios from "axios";
import { toast } from "sonner";
import { useCouponsEnabled } from "@/components/common/coupon/use-coupons-enabled";
import { useCheckoutCoupon } from "@/components/common/coupon/use-checkout-coupon";
import { CouponInput } from "@/components/common/coupon/CouponInput";
import { invitePaymentEntryFor } from "../-services/course-levels-service";

interface EnrollmentPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instituteId: string;
  courseData: {
    id: string;
    title: string;
    price: number;
    packageSessionId: string;
    enrollInviteId: string;
  };
  onSuccess: (tokens: { accessToken: string; refreshToken: string }) => void;
}

interface PaymentOption {
  id: string;
  name: string;
  payment_plans: Array<{
    id: string;
    name: string;
    actual_price: number;
    elevated_price: number;
    currency: string;
    description: string;
    tag: string;
    validity_in_days: number;
  }>;
}

interface EnrollmentData {
  id: string;
  name: string;
  enroll_invite_id: string;
  vendor?: string;
  package_session_to_payment_options: Array<{
    package_session_id: string;
    payment_option: PaymentOption;
    enroll_invite_id: string;
    status: string;
  }>;
}

export const EnrollmentPaymentDialog: React.FC<
  EnrollmentPaymentDialogProps
> = ({ open, onOpenChange, instituteId, courseData, onSuccess }) => {
  const { t } = useTranslation("coursePlayerA");
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const [step, setStep] = useState<"email" | "payment" | "success">("email");
  const [vendor, setVendor] = useState("STRIPE");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [validationError, setValidationError] = useState<string>("");
  const [emailError, setEmailError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [isInitializing, setIsInitializing] = useState(false);
  const [enrollmentData, setEnrollmentData] = useState<EnrollmentData | null>(
    null
  );
  const [selectedPaymentPlan, setSelectedPaymentPlan] = useState<any>(null);
  const [availablePaymentPlans, setAvailablePaymentPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<
    "success" | "failure" | null
  >(null);
  const [paymentError, setPaymentError] = useState<string>("");
  const [stripePromise, setStripePromise] = useState<any>(null);
  const [currency, setCurrency] = useState<string>("USD");

  // Institute-level coupon kill switch (admin Settings → Coupons).
  const couponsEnabled = useCouponsEnabled();
  // Coupon state — re-validated by BE at enroll time + atomically decremented
  // (V308/V309). `appliedDiscount` is the live discount value from validate.
  const couponCtx = useCheckoutCoupon({
    buildRequest: (code) => ({
      couponCode: code,
      instituteId,
      enrollInviteId: courseData.enrollInviteId || null,
      packageSessionId:
        selectedPaymentPlan?.package_session_id ||
        (courseData as { package_session_id?: string }).package_session_id ||
        null,
      paymentPlanId: selectedPaymentPlan?.id ?? null,
      userEmail: email || null,
      totalAmount:
        typeof selectedPaymentPlan?.actual_price === "number"
          ? selectedPaymentPlan.actual_price
          : 0,
    }),
  });
  // Effective amount the gateway should actually charge, after coupon discount.
  const effectiveAmount = Math.max(
    0,
    (selectedPaymentPlan?.actual_price ?? 0) -
      (couponCtx.state.appliedCode ? couponCtx.state.discount : 0)
  );

  // Plan switch invalidates the discount value the FE captured for the old
  // plan: the BE will re-validate against the new plan at enroll time and
  // may compute a different discount than what the gateway already charged.
  // Drop the applied coupon so the learner sees a clean slate and re-applies
  // for the new plan.
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

  // OTP state variables
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [isLoadingOtp, setIsLoadingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isEmailVerified, setIsEmailVerified] = useState(false);

  // What this phone field starts on: the institute's configured preferred
  // countries, or — when it configured none, or the portal is on GEO_FIRST —
  // the country the visitor is opening this page from.
  //
  // A hook rather than a one-shot read: these pages are public and routinely
  // render before domain routing replies, which used to leave the field on the
  // platform fallback (+91) for every visitor. It takes the institute's answer
  // whenever it lands, and never once a number has been typed into the box.
  const { defaultCountry: defaultPhoneCountry, preferredCountries } =
    usePreferredPhoneCountries({ freeze: phoneFieldHasInput(phone) });

  // Validation functions
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    setValidationError("");
    setEmailError("");
  };

  const handlePhoneChange = (value: string) => {
    // PhoneInput returns formatted value with country code (e.g., +919876543210)
    setPhone(value);
    setPhoneError("");
    setValidationError("");
  };

  const handleFullNameChange = (value: string) => {
    setFullName(value);
    setValidationError("");
  };

  const handleContinue = () => {
    if (step === "email") {
      // Clear previous errors
      setEmailError("");
      setPhoneError("");
      setValidationError("");

      let hasErrors = false;

      // Validate email
      if (!email.trim()) {
        setEmailError(t("enrollmentPaymentDialog.emailRequired"));
        hasErrors = true;
      } else if (!validateEmail(email)) {
        setEmailError(t("common.invalidEmail"));
        hasErrors = true;
      }

      // Validate full name
      if (!fullName.trim()) {
        setValidationError(t("enrollmentPaymentDialog.fullNameRequired"));
        hasErrors = true;
      }

      // Validate phone (optional — but any digits typed beyond the pre-filled
      // country dial code must form a valid number for that country).
      const phoneFieldError = validatePhoneField(phone);
      if (phoneFieldError) {
        setPhoneError(phoneFieldError);
        hasErrors = true;
      }

      if (hasErrors) {
        return;
      }

      setStep("payment");
    }
  };

  const handleBack = () => {
    if (step === "payment") {
      setStep("email");
    }
  };

  const handlePaymentSuccess = (tokens: {
    accessToken: string;
    refreshToken: string;
  }) => {
    setPaymentStatus("success");
    setPaymentError("");
    onSuccess(tokens);
  };

  const handlePaymentError = (error: string) => {
    setPaymentStatus("failure");
    setPaymentError(error);
    // Surface the failure to the learner — previously this was written to
    // state that was never rendered, so a failed (free or paid) enrollment
    // looked like "nothing happened".
    toast.error(error || t("enrollmentPaymentDialog.enrollmentFailed"));
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  // OTP functions
  const handleSendOTP = async () => {
    if (!email.trim()) {
      toast.error(t("enrollmentPaymentDialog.enterEmailAddress"));
      return;
    }

    setIsLoadingOtp(true);
    try {
      await axios.post(
        LIVE_SESSION_REQUEST_OTP,
        {
          to: email,
        },
        {
          headers: {
            accept: "*/*",
            "Content-Type": "application/json",
          },
          params: {
            instituteId,
          },
        }
      );

      setOtpSent(true);
      toast.success(t("common.otpSent"));
    } catch (error) {
      toast.error(t("common.otpSendFailed"));
    } finally {
      setIsLoadingOtp(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otp.trim()) {
      toast.error(t("enrollmentPaymentDialog.enterOtp"));
      return;
    }

    setIsVerifyingOtp(true);
    try {
      await axios.post(
        LIVE_SESSION_VERIFY_OTP,
        {
          to: email,
          otp: otp,
          client_name: "LEARNER",
          institute_id: instituteId,
        },
        {
          headers: {
            accept: "*/*",
            "Content-Type": "application/json",
          },
        }
      );

      setIsEmailVerified(true);
      setOtpSent(false);
      setOtp("");
      toast.success(t("common.emailVerified"));
    } catch (error) {
      toast.error(t("common.otpVerifyFailed"));
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const handlePaymentPlanChange = (planId: string) => {
    const selectedPlan = availablePaymentPlans.find(
      (plan) => plan.id === planId
    );
    if (selectedPlan) {
      setSelectedPaymentPlan(selectedPlan);
      setCurrency(selectedPlan.currency || "USD");
    }
  };

  // Fetch enrollment data and payment options
  useEffect(() => {
    if (open) {
      if (!courseData.enrollInviteId) {
        setIsInitializing(false);
        setLoading(false);
        toast.error(t("enrollmentPaymentDialog.invalidCourseData", { course }));
        return;
      }

      setIsInitializing(true);
      setLoading(true);

      // Fetch enrollment invite details
      const enrollmentUrl = `${ENROLLMENT_INVITE_URL}/${instituteId}/${courseData.enrollInviteId}`;

      fetch(enrollmentUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          accept: "*/*",
        },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          return response.json();
        })
        .then((data: EnrollmentData) => {
          setEnrollmentData(data);

          // Extract vendor and fetch payment gateway details
          const vendor = data.vendor || "STRIPE";
          setVendor(vendor);
          if (vendor !== "CASHFREE") {
            fetchStripeKey(vendor);
          }
          if (vendor !== "CASHFREE") {
            fetchStripeKey(vendor);
          }

          // Plans of the invite entry for THIS package session: one invite can
          // sell several versions (Hindi + English), and entry [0] may be the
          // other one. Falls back to [0] when the version is not listed.
          const paymentEntry = invitePaymentEntryFor(data, courseData.packageSessionId);
          if (paymentEntry) {
            const paymentOption = paymentEntry.payment_option;
            const enrollInviteId =
              paymentEntry.enroll_invite_id ||
              data.enroll_invite_id ||
              data.id;

            if (
              paymentOption.payment_plans &&
              paymentOption.payment_plans.length > 0
            ) {
              // Store all available payment plans
              setAvailablePaymentPlans(paymentOption.payment_plans);

              // Find the best payment plan (prefer non-free plans, then lowest price)
              const sortedPlans = paymentOption.payment_plans.sort((a, b) => {
                // First, prefer plans that are not tagged as "free"
                if (a.tag === "free" && b.tag !== "free") return 1;
                if (a.tag !== "free" && b.tag === "free") return -1;
                // Then sort by actual_price
                return a.actual_price - b.actual_price;
              });

              const selectedPlan = sortedPlans[0];
              setSelectedPaymentPlan(selectedPlan);
              setCurrency(selectedPlan.currency || "USD");
            } else {
            }
          } else {
            console.log("No payment options found in enrollment data");
            setAvailablePaymentPlans([]);
            setSelectedPaymentPlan(null);
            setCurrency("USD");
          }

          setLoading(false);
        })
        .catch((error) => {
          console.error("Enrollment data fetch error:", error);
          setAvailablePaymentPlans([]);
          setSelectedPaymentPlan(null);
          setLoading(false);
        });

      setTimeout(() => {
        setStep("email");
        setEmail("");
        setFullName("");
        setPhone("");
        setValidationError("");
        setPaymentStatus(null);
        setPaymentError("");
        setIsInitializing(false);
        // Reset OTP state
        setOtpSent(false);
        setOtp("");
        setIsLoadingOtp(false);
        setIsVerifyingOtp(false);
        setIsEmailVerified(false);
      }, 100);
    }
  }, [open, courseData.enrollInviteId, courseData.packageSessionId, instituteId]);

  const fetchStripeKey = async (vendor: string = "STRIPE") => {
    try {
      const data = await cachedGet<Record<string, any>>(
        `${GET_PAYMENT_GATEWAY_DETAILS_URL}?instituteId=${instituteId}&vendor=${vendor}`,
        {
          method: "GET",
          headers: {
            accept: "*/*",
          },
        }
      );

      let publishableKey: string | undefined;

      // Try different possible field names for the publishable key
      const possibleKeys = [
        data.publishableKey,
        data.publishable_key,
        data.stripe_publishable_key,
        data.stripePublishableKey,
        data.key,
        data.public_key,
      ];

      publishableKey = possibleKeys.find(
        (key) => key && typeof key === "string" && key.startsWith("pk_")
      );

      if (!publishableKey && data.config_json) {
        try {
          const config = JSON.parse(data.config_json);
          const configKeys = [
            config.publishableKey,
            config.publishable_key,
            config.stripe_publishable_key,
            config.stripePublishableKey,
            config.key,
            config.public_key,
          ];
          publishableKey = configKeys.find(
            (key) => key && typeof key === "string" && key.startsWith("pk_")
          );
        } catch (error) { }
      }

      if (publishableKey) {
        const stripeInstance = loadStripe(publishableKey);
        setStripePromise(stripeInstance);
      } else {
        // For testing: use a proper Stripe test key format
        const testKey = "pk_test_51234567890abcdef"; // This will show as invalid but allows UI testing
        const stripeInstance = loadStripe(testKey);
        setStripePromise(stripeInstance);
      }
    } catch (error) {
      // For testing: use a test Stripe key even when API fails
      const testKey = "pk_test_51234567890abcdef"; // Test key for UI testing
      const stripeInstance = loadStripe(testKey);
      setStripePromise(stripeInstance);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <DialogPrimitive.Content className="fixed start-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-catalogue-md bg-white p-6 shadow-xl focus:outline-none">
          <button
            className="absolute end-2 top-2 text-gray-400 hover:text-gray-700 focus:outline-none"
            onClick={handleClose}
            aria-label={t("common.close")}
          >
            <Cross2Icon className="h-4 w-4" />
          </button>

          {isInitializing ? (
            <div className="text-center space-y-6">
              <div className="flex justify-center">
                <SpinnerGap className="w-12 h-12 text-blue-500 animate-spin" />
              </div>
              <h2 className="text-xl font-semibold text-gray-700">
                {t("common.loading")}
              </h2>
            </div>
          ) : step === "success" ? (
            <div className="text-center space-y-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <svg
                  className="w-8 h-8 text-green-600"
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
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-gray-900">
                  {t("enrollmentPaymentDialog.enrollmentSuccessful")}
                </h2>
                <p className="text-gray-600">
                  {t("enrollmentPaymentDialog.enrolledInCourse", { course })}
                </p>
              </div>
              <MyButton
                buttonType="primary"
                scale="medium"
                layoutVariant="default"
                className="w-full h-11 text-base"
                onClick={handleClose}
              >
                {t("enrollmentPaymentDialog.continueToCourse", { course })}
              </MyButton>
            </div>
          ) : (
            <>
              <div className="mb-6 space-y-2">
                <h2 className="text-xl font-semibold text-gray-900">
                  {t("enrollmentPaymentDialog.enrollInCourse", { course })}
                </h2>
                <p className="text-sm text-gray-600">
                  {enrollmentData?.name || courseData.title}
                </p>
              </div>

              {step === "email" && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("enrollmentPaymentDialog.fullNameLabel")}
                    </label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => handleFullNameChange(e.target.value)}
                      className={`w-full px-3 py-2 border rounded-catalogue-sm focus:outline-none focus:ring-2 ${validationError
                        ? "border-red-500 focus:ring-red-500"
                        : "border-gray-300 focus:ring-blue-500"
                        }`}
                      placeholder={t("enrollmentPaymentDialog.fullNamePlaceholder")}
                    />
                    {validationError && (
                      <p className="text-red-500 text-sm mt-1">
                        {validationError}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("enrollmentPaymentDialog.emailAddressLabel")}
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => handleEmailChange(e.target.value)}
                      className={`w-full px-3 py-2 border rounded-catalogue-sm focus:outline-none focus:ring-2 ${emailError
                        ? "border-red-500 focus:ring-red-500"
                        : "border-gray-300 focus:ring-blue-500"
                        }`}
                      placeholder={t("enrollmentPaymentDialog.emailAddressPlaceholder")}
                    />
                    {emailError && (
                      <p className="text-red-500 text-sm mt-1">{emailError}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t("enrollmentPaymentDialog.phoneNumberLabel")}
                    </label>
                    <PhoneInput
                      country={defaultPhoneCountry}
                      enableSearch={true}
                      value={phone}
                      onChange={(value) => handlePhoneChange(value)}
                      onBlur={() => setPhoneError(validatePhoneField(phone) ?? "")}
                      inputClass="!w-full h-10 !rounded-catalogue-sm !border-input"
                      buttonClass="!rounded-s-catalogue-sm !border-input"
                      containerClass="!w-full"
                      placeholder={t("enrollmentPaymentDialog.phoneNumberPlaceholder")}
                      countryCodeEditable={false}
                      enableAreaCodes={false}
                      disableCountryGuess={false}
                      preferredCountries={preferredCountries}
                    />
                    {phoneError && (
                      <p className="text-red-500 text-sm mt-1">{phoneError}</p>
                    )}
                    {/* {<p className="text-gray-500 text-xs mt-1">
                      Include country code (e.g., +91 9876543210)
                    </p> } */}
                  </div>

                  {validationError && (
                    <div className="text-red-600 text-sm">
                      {validationError}
                    </div>
                  )}

                  {/* OTP Verification Section */}
                  <div className="border-t pt-4 mt-4">
                    <div className="text-center mb-4 space-y-2">
                      <h4 className="text-md font-semibold text-gray-900">
                        {t("enrollmentPaymentDialog.emailVerificationHeading")}
                      </h4>
                      <p className="text-sm text-gray-600">
                        {t("enrollmentPaymentDialog.verifyEmailToContinue")}
                      </p>
                    </div>

                    {!otpSent && !isEmailVerified && (
                      <div className="text-center">
                        <MyButton
                          buttonType="secondary"
                          scale="medium"
                          layoutVariant="default"
                          className="w-full h-10 text-sm"
                          onClick={handleSendOTP}
                          disabled={
                            isLoadingOtp ||
                            !email.trim() ||
                            !validateEmail(email)
                          }
                        >
                          {isLoadingOtp ? (
                            <>
                              <SpinnerGap
                                size={16}
                                className="animate-spin me-2"
                              />
                              {t("enrollmentPaymentDialog.sending")}
                            </>
                          ) : (
                            t("leadCollectionModal.sendOtp")
                          )}
                        </MyButton>
                      </div>
                    )}

                    {otpSent && !isEmailVerified && (
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="block text-sm font-medium text-gray-700">
                            {t("enrollmentPaymentDialog.enterSixDigitOtp")}
                          </label>
                          <input
                            type="text"
                            value={otp}
                            onChange={(e) =>
                              setOtp(
                                e.target.value.replace(/\D/g, "").slice(0, 6)
                              )
                            }
                            placeholder={t("enrollmentPaymentDialog.enterOtpPlaceholder")}
                            className="w-full px-3 py-2 border border-gray-300 rounded-catalogue-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center text-lg tracking-widest"
                            maxLength={6}
                          />
                        </div>
                        <div className="flex gap-2">
                          <MyButton
                            buttonType="secondary"
                            scale="medium"
                            layoutVariant="default"
                            className="flex-1 h-10 text-sm"
                            onClick={handleSendOTP}
                            disabled={isLoadingOtp}
                          >
                            {isLoadingOtp ? (
                              <>
                                <SpinnerGap
                                  size={16}
                                  className="animate-spin me-2"
                                />
                                {t("enrollmentPaymentDialog.resending")}
                              </>
                            ) : (
                              t("leadCollectionModal.resendOtp")
                            )}
                          </MyButton>
                          <MyButton
                            buttonType="primary"
                            scale="medium"
                            layoutVariant="default"
                            className="flex-1 h-10 text-sm"
                            onClick={handleVerifyOTP}
                            disabled={
                              isVerifyingOtp || !otp.trim() || otp.length !== 6
                            }
                          >
                            {isVerifyingOtp ? (
                              <>
                                <SpinnerGap
                                  size={16}
                                  className="animate-spin me-2"
                                />
                                {t("leadCollectionModal.verifying")}
                              </>
                            ) : (
                              t("leadCollectionModal.verifyOtp")
                            )}
                          </MyButton>
                        </div>
                      </div>
                    )}

                    {isEmailVerified && (
                      <div className="text-center">
                        <div className="inline-flex items-center px-3 py-2 bg-green-50 border border-green-200 rounded-catalogue-sm">
                          <svg
                            className="w-4 h-4 text-green-600 me-2"
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
                          <span className="text-sm font-medium text-green-800">
                            {t("common.emailVerified")}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {step === "payment" && (
                <div className="space-y-4">
                  {selectedPaymentPlan ? (
                    <>
                      <div className="bg-gray-50 border border-gray-200 rounded-catalogue-md p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-gray-700">
                            {t("enrollmentPaymentDialog.courseSummary", { course })}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-gray-600">{t("enrollmentPaymentDialog.courseLabel", { course })}</span>
                          <span className="font-semibold text-gray-900">
                            {enrollmentData?.name || courseData.title}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-gray-600">{t("enrollmentPaymentDialog.emailLabel")}</span>
                          <span className="font-semibold text-gray-900">
                            {email}
                          </span>
                        </div>
                        <button
                          className="text-xs font-medium ms-auto block rounded-catalogue-xs border border-gray-300 bg-white text-gray-600 px-3 py-1 focus:outline-none transition-colors duration-200 hover:bg-blue-50/50 hover:border-blue-300"
                          onClick={handleBack}
                        >
                          {t("common.edit")}
                        </button>
                      </div>

                      {/* Payment Plan Selection */}
                      {availablePaymentPlans.length > 1 && (
                        <div className="space-y-3">
                          <label className="block text-sm font-medium text-gray-700">
                            {t("enrollmentPaymentDialog.selectPaymentPlan")}
                          </label>
                          <div className="space-y-2">
                            {availablePaymentPlans.map((plan) => (
                              <div
                                key={plan.id}
                                className={`border rounded-catalogue-md p-3 cursor-pointer transition-colors ${selectedPaymentPlan.id === plan.id
                                  ? "border-blue-500 bg-blue-50"
                                  : "border-gray-200 hover:border-gray-300"
                                  }`}
                                onClick={() => handlePaymentPlanChange(plan.id)}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="radio"
                                        checked={
                                          selectedPaymentPlan.id === plan.id
                                        }
                                        onChange={() =>
                                          handlePaymentPlanChange(plan.id)
                                        }
                                        className="text-blue-600"
                                      />
                                      <span className="font-medium text-gray-900">
                                        {plan.name}
                                      </span>
                                    </div>
                                    {plan.description && (
                                      <p className="text-sm text-gray-600 mt-1">
                                        {plan.description}
                                      </p>
                                    )}
                                  </div>
                                  <div className="text-end">
                                    <div className="flex items-center gap-2">
                                      {plan.elevated_price &&
                                        plan.elevated_price >
                                        plan.actual_price && (
                                          <span className="text-sm text-gray-500 line-through">
                                            {getCurrencySymbol(plan.currency)}
                                            {plan.elevated_price}
                                          </span>
                                        )}
                                      <span className="text-lg font-semibold text-gray-900">
                                        {getCurrencySymbol(plan.currency)}
                                        {plan.actual_price}
                                      </span>
                                    </div>
                                    <div className="text-xs text-gray-500 mt-1">
                                      {t("enrollmentPaymentDialog.daysAccess", { count: plan.validity_in_days })}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Single Plan Display */}
                      {availablePaymentPlans.length === 1 && (
                        <div className="bg-blue-50 border border-blue-200 rounded-catalogue-md p-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-medium text-gray-900">
                                {selectedPaymentPlan.name}
                              </div>
                              {selectedPaymentPlan.description && (
                                <p className="text-sm text-gray-600 mt-1">
                                  {selectedPaymentPlan.description}
                                </p>
                              )}
                            </div>
                            <div className="text-end">
                              <div className="flex items-center gap-2">
                                {selectedPaymentPlan.elevated_price &&
                                  selectedPaymentPlan.elevated_price >
                                  selectedPaymentPlan.actual_price && (
                                    <span className="text-sm text-gray-500 line-through">
                                      {getCurrencySymbol(
                                        selectedPaymentPlan.currency
                                      )}
                                      {selectedPaymentPlan.elevated_price}
                                    </span>
                                  )}
                                <span className="text-lg font-semibold text-gray-900">
                                  {getCurrencySymbol(
                                    selectedPaymentPlan.currency
                                  )}
                                  {selectedPaymentPlan.actual_price}
                                </span>
                              </div>
                              <div className="text-xs text-gray-500 mt-1">
                                {t("enrollmentPaymentDialog.daysAccess", { count: selectedPaymentPlan.validity_in_days })}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Discount Coupon — institute-level toggle gates whether
                          the UI is visible at all. The applied discount is
                          subtracted from `effectiveAmount` below so the gateway
                          actually charges the discounted price. */}
                      {couponsEnabled && (
                        <div className="mb-4">
                          <CouponInput
                            state={couponCtx.state}
                            onChange={couponCtx.setCode}
                            onApply={couponCtx.apply}
                            onClear={couponCtx.clear}
                            currencySymbol={getCurrencySymbol(currency || "")}
                          />
                          {couponCtx.state.appliedCode &&
                            couponCtx.state.discount > 0 && (
                              <div className="mt-3 flex justify-between text-sm">
                                <span className="text-gray-600">
                                  {t("enrollmentPaymentDialog.subtotalCoupon", {
                                    subtotal: `${getCurrencySymbol(currency)}${selectedPaymentPlan.actual_price.toFixed(2)}`,
                                    couponCode: couponCtx.state.appliedCode,
                                    discount: `${getCurrencySymbol(currency)}${couponCtx.state.discount.toFixed(2)}`,
                                  })}
                                </span>
                                <span className="font-semibold text-gray-900">
                                  {t("enrollmentPaymentDialog.youPay", {
                                    amount: `${getCurrencySymbol(currency)}${effectiveAmount.toFixed(2)}`,
                                  })}
                                </span>
                              </div>
                            )}
                        </div>
                      )}

                      {vendor === "CASHFREE" ? (
                        <CashfreePaymentForm
                          amount={effectiveAmount}
                          currency={currency}
                          email={email}
                          fullName={fullName}
                          phone={isBlankPhone(phone) ? "" : phone}
                          instituteId={instituteId}
                          courseData={courseData}
                          enrollmentData={enrollmentData}
                          selectedPaymentPlan={selectedPaymentPlan}
                          onSuccess={handlePaymentSuccess}
                          onError={handlePaymentError}
                          onBack={handleBack}
                          appliedCouponCode={couponCtx.state.appliedCode}
                        />
                      ) : vendor === "RAZORPAY" ? (
                        <PaymentForm
                          amount={effectiveAmount}
                          currency={currency}
                          email={email}
                          fullName={fullName}
                          phone={isBlankPhone(phone) ? "" : phone}
                          instituteId={instituteId}
                          courseData={courseData}
                          enrollmentData={enrollmentData}
                          selectedPaymentPlan={selectedPaymentPlan}
                          onSuccess={handlePaymentSuccess}
                          onError={handlePaymentError}
                          onBack={handleBack}
                          vendor={vendor}
                          appliedCouponCode={couponCtx.state.appliedCode}
                        />
                      ) : stripePromise ? (
                        <Elements stripe={stripePromise}>
                          <StripeConnectedPaymentForm
                            amount={effectiveAmount}
                            currency={currency}
                            email={email}
                            fullName={fullName}
                            phone={isBlankPhone(phone) ? "" : phone}
                            instituteId={instituteId}
                            courseData={courseData}
                            enrollmentData={enrollmentData}
                            selectedPaymentPlan={selectedPaymentPlan}
                            onSuccess={handlePaymentSuccess}
                            onError={handlePaymentError}
                            onBack={handleBack}
                            appliedCouponCode={couponCtx.state.appliedCode}
                          />
                        </Elements>
                      ) : (
                        <div className="text-center py-8">
                          <p className="text-sm text-red-600">
                            {t("enrollmentPaymentDialog.paymentGatewayUnavailable")}
                          </p>
                          <p className="text-xs text-gray-500 mt-2">
                            {t("enrollmentPaymentDialog.loadingStripe")}
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-sm text-red-600">
                        {t("enrollmentPaymentDialog.noPaymentPlanAvailable")}
                      </p>
                      <p className="text-xs text-gray-500 mt-2">
                        {t("enrollmentPaymentDialog.loadingPaymentOptions")}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {step === "email" && (
                <div className="flex flex-col gap-2 w-full mt-6">
                  <MyButton
                    buttonType="primary"
                    scale="medium"
                    layoutVariant="default"
                    className="w-full h-11 text-base"
                    onClick={handleContinue}
                    disabled={loading || !isEmailVerified}
                  >
                    {loading ? (
                      <>
                        <SpinnerGap size={18} className="animate-spin me-2" />
                        {t("common.loading")}
                      </>
                    ) : (selectedPaymentPlan?.actual_price === 0 || (availablePaymentPlans.length > 0 && availablePaymentPlans.every(p => p.actual_price === 0))) ? (
                      t("enrollmentPaymentDialog.continue")
                    ) : (
                      t("enrollmentPaymentDialog.continueToPayment")
                    )}
                  </MyButton>

                  {!isEmailVerified && (
                    <p className="text-xs text-gray-500 text-center mt-2">
                      {t("enrollmentPaymentDialog.pleaseVerifyEmailToContinue")}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

// Cashfree Payment Form - same implementation as enroll-by-invite
interface CashfreePaymentFormProps {
  amount: number;
  currency: string;
  email: string;
  fullName: string;
  phone: string;
  instituteId: string;
  courseData: {
    id: string;
    title: string;
    price: number;
    packageSessionId: string;
    enrollInviteId: string;
  };
  enrollmentData: EnrollmentData | null;
  selectedPaymentPlan: any;
  onSuccess: (tokens: { accessToken: string; refreshToken: string }) => void;
  onError: (error: string) => void;
  onBack: () => void;
  appliedCouponCode?: string | null;
}

const CashfreePaymentForm: React.FC<CashfreePaymentFormProps> = ({
  amount,
  currency,
  email,
  fullName,
  phone,
  instituteId,
  courseData,
  enrollmentData,
  selectedPaymentPlan,
  onSuccess,
  onError,
  onBack,
  appliedCouponCode,
}) => {
  const { t } = useTranslation("coursePlayerA");
  const [cashfreeSessionData, setCashfreeSessionData] = useState<{
    paymentSessionId: string;
    orderId: string;
    /** "sandbox" | "production" from the backend — must match the session. */
    environment: string | null;
  } | null>(null);
  const [cashfreeInitLoading, setCashfreeInitLoading] = useState(false);
  const initAttemptedRef = useRef(false);

  useEffect(() => {
    if (
      !enrollmentData ||
      !selectedPaymentPlan ||
      cashfreeSessionData ||
      cashfreeInitLoading ||
      initAttemptedRef.current
    ) {
      return;
    }

    initAttemptedRef.current = true;
    setCashfreeInitLoading(true);

    const init = async () => {
      try {
        // The invite entry for the version being bought (not blindly [0]).
        const paymentEntry = invitePaymentEntryFor(enrollmentData, courseData.packageSessionId);
        const finalEnrollInviteId =
          paymentEntry?.enroll_invite_id ||
          enrollmentData?.enroll_invite_id ||
          enrollmentData?.id ||
          courseData.enrollInviteId;

        const enrollPayload = {
          user: {
            email,
            full_name: fullName,
            address_line: "",
            city: "",
            region: "",
            pin_code: "",
            mobile_number: phone,
            date_of_birth: "",
            gender: "",
            password: "",
            profile_pic_file_id: "",
            roles: ["STUDENT"],
            root_user: true,
          },
          institute_id: instituteId,
          subject_id: "",
          vendor_id: "CASHFREE",
          learner_package_session_enroll: {
            package_session_ids: [
              paymentEntry?.package_session_id || courseData.packageSessionId,
            ],
            plan_id: selectedPaymentPlan.id,
            payment_option_id: paymentEntry?.payment_option?.id || "",
            enroll_invite_id: finalEnrollInviteId,
            refer_request: null,
            coupon_code: appliedCouponCode || null,
            payment_initiation_request: {
              vendor: "CASHFREE",
              amount,
              currency: currency || "INR",
              description: t("enrollmentPaymentDialog.enrollmentDescription", { course: enrollmentData?.name || courseData.title }),
              charge_automatically: true,
              institute_id: instituteId,
              stripe_request: {},
              razorpay_request: {},
              pay_pal_request: {},
              eway_request: {},
              cashfree_request: {
                return_url: getCashfreeReturnUrl(),
              },
              include_pending_items: true,
            },
            custom_field_values: [],
          },
        };

        const response = await axios({
          method: "POST",
          url: ENROLL_USER_INVITE_PAYMENT_URL,
          data: enrollPayload,
        });

        const paymentResponse = response.data;
        const responseData = paymentResponse?.payment_response?.response_data;
        const paymentSessionId =
          responseData?.paymentSessionId ?? responseData?.payment_session_id;
        // Use top-level orderId (paymentLogId) for status API – backend looks up by payment_log.id
        const orderId =
          paymentResponse?.orderId ??
          paymentResponse?.payment_response?.order_id ??
          responseData?.orderId ??
          responseData?.order_id;

        if (!paymentSessionId) {
          throw new Error(t("enrollmentPaymentDialog.cashfreeInitFailed"));
        }

        const ordId = orderId ?? "";
        setCashfreeSessionData({
          paymentSessionId,
          orderId: ordId,
          environment:
            typeof responseData?.environment === "string"
              ? responseData.environment
              : null,
        });

        // Store username and password from enrollment response for post-payment login
        // Prefer user.username (required by login API), fallback to user.email
        const username =
          paymentResponse?.user?.username ?? paymentResponse?.user?.email;
        const userPassword = paymentResponse?.user?.password;
        if (ordId && username && userPassword) {
          try {
            sessionStorage.setItem(
              `enroll_payment_creds_${ordId}`,
              JSON.stringify({ username, password: userPassword })
            );
          } catch {
            /* ignore */
          }
        }
      } catch (err: any) {
        const errorMsg =
          err?.response?.data?.ex ||
          err?.response?.data?.message ||
          (err instanceof Error ? err.message : t("enrollmentPaymentDialog.paymentInitFailed"));
        onError(errorMsg);
      } finally {
        setCashfreeInitLoading(false);
      }
    };

    init();
  }, [
    enrollmentData,
    selectedPaymentPlan,
    amount,
    currency,
    email,
    fullName,
    phone,
    instituteId,
    courseData,
    cashfreeSessionData,
    cashfreeInitLoading,
  ]);

  if (cashfreeInitLoading || !cashfreeSessionData) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4">
        <SpinnerGap className="w-10 h-10 text-blue-500 animate-spin" />
        <p className="text-sm text-gray-600">{t("enrollmentPaymentDialog.preparingPayment")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <CashfreeCheckoutForm
        error={null}
        amount={amount}
        currency={currency}
        paymentSessionId={cashfreeSessionData.paymentSessionId}
        returnUrl={getCashfreeReturnUrl()}
        orderId={cashfreeSessionData.orderId}
        environment={cashfreeSessionData.environment}
        instituteId={instituteId}
        onPayClick={() => { }}
        onPayError={() => onError(t("enrollmentPaymentDialog.paymentInitFailed"))}
        isProcessing={false}
      />
      <button
        type="button"
        className="text-sm font-medium text-gray-600 hover:text-gray-800"
        onClick={onBack}
      >
        {t("common.back")}
      </button>
    </div>
  );
};

// Payment Form Component
interface PaymentFormProps {
  amount: number;
  currency: string;
  email: string;
  fullName: string;
  phone: string;
  instituteId: string;
  courseData: {
    id: string;
    title: string;
    price: number;
    packageSessionId: string;
    enrollInviteId: string;
  };
  enrollmentData: EnrollmentData | null;
  selectedPaymentPlan: any;
  onSuccess: (tokens: { accessToken: string; refreshToken: string }) => void;
  onError: (error: string) => void;
  onBack: () => void;
  stripe?: any;
  elements?: any;
  vendor?: string;
  appliedCouponCode?: string | null;
}

const StripeConnectedPaymentForm: React.FC<PaymentFormProps> = (props) => {
  const stripe = useStripe();
  const elements = useElements();
  return <PaymentForm {...props} stripe={stripe} elements={elements} />;
};

const PaymentForm: React.FC<PaymentFormProps> = ({
  amount,
  currency,
  email,
  fullName,
  phone,
  instituteId,
  courseData,
  enrollmentData,
  selectedPaymentPlan,
  onSuccess,
  onError,
  onBack,
  stripe,
  elements,
  vendor: vendorProp,
  appliedCouponCode,
}) => {
  const { t } = useTranslation("coursePlayerA");
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  // const stripe = useStripe(); // Removed
  // const elements = useElements(); // Removed
  const [isProcessing, setIsProcessing] = useState(false);
  const [cardError, setCardError] = useState("");
  const [cardComplete, setCardComplete] = useState(false);
  const razorpayRef = useRef<RazorpayCheckoutFormRef>(null);

  // Store credentials from Enroll API for auto-login after Razorpay payment
  // Using useRef instead of useState to avoid closure issues with callbacks
  const razorpayCredentialsRef = useRef<{
    username: string;
    password: string;
  } | null>(null);

  // Use vendor prop, fallback to enrollmentData vendor, then STRIPE
  const vendor = vendorProp || enrollmentData?.vendor || "STRIPE";

  // The invite entry for the version being bought: one invite can sell
  // several package sessions (Hindi + English), so entry [0] may be the wrong
  // one. Every enrol payload below — free, Razorpay, Stripe — uses this entry.
  const paymentEntry = invitePaymentEntryFor(enrollmentData, courseData.packageSessionId);

  console.log("PaymentForm vendor:", vendor, "vendorProp:", vendorProp);

  // Directly handle Razorpay completion - called after payment modal closes
  const completeRazorpayEnrollment = async (paymentData: any) => {
    console.log("=== completeRazorpayEnrollment CALLED ===");
    console.log("razorpayCredentialsRef.current:", razorpayCredentialsRef.current);

    // Use a local variable to prevent multiple executions
    if (isProcessing) {
      console.log("⚠️ Already processing, but continuing anyway for Razorpay completion");
    }

    setIsProcessing(true);
    console.log("=== Razorpay payment completed, processing auto-login ===");
    console.log("Payment Data:", paymentData);

    const credentials = razorpayCredentialsRef.current;
    console.log("Stored credentials available:", credentials ? "YES" : "NO");
    if (credentials) {
      console.log("Stored username:", credentials.username);
    }

    try {
      // PRIORITY 1: If we have stored credentials from the Enroll API, 
      // call Login API directly - no need for another API call
      if (credentials?.username && credentials?.password) {
        console.log("=== Calling Login API with stored credentials ===");
        console.log("Username:", credentials.username);

        const loginResponse = await fetch(LOGIN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_name: credentials.username,
            password: credentials.password,
            client_name: "ADMIN_PORTAL",
          }),
        });

        const loginResult = await loginResponse.json();
        console.log("Login API response:", loginResult);

        if (loginResponse.ok && loginResult.accessToken && loginResult.refreshToken) {
          console.log("Auto-login successful!");
          // Clear stored credentials after successful login
          razorpayCredentialsRef.current = null;
          setIsProcessing(false);
          onSuccess({
            accessToken: loginResult.accessToken,
            refreshToken: loginResult.refreshToken,
          });
          return;
        } else {
          console.warn("Login API failed:", loginResult);
          // Continue to fallback methods
        }
      }

      // FALLBACK: If no stored credentials or login failed, 
      // call Register API to complete enrollment and get tokens
      console.log("=== Fallback: Calling Register API for enrollment completion ===");

      const finalEnrollInviteId =
        paymentEntry?.enroll_invite_id ||
        enrollmentData?.enroll_invite_id ||
        enrollmentData?.id ||
        courseData.enrollInviteId;

      const baseUrl = BASE_URL;

      // Call Register API with payment verification data
      const registerPayload = {
        user: {
          email: email,
          full_name: fullName,
          address_line: "",
          city: "",
          region: "",
          pin_code: "",
          mobile_number: phone,
          date_of_birth: "",
          gender: "",
          password: "",
          profile_pic_file_id: "",
          roles: ["STUDENT"],
          root_user: true,
        },
        institute_id: instituteId,
        subject_id: "",
        vendor_id: "RAZORPAY",
        learner_package_session_enroll: {
          package_session_ids: [paymentEntry?.package_session_id || courseData.packageSessionId],
          plan_id: selectedPaymentPlan.id,
          payment_option_id: paymentEntry?.payment_option?.id || "",
          enroll_invite_id: finalEnrollInviteId,
          refer_request: null,
          coupon_code: appliedCouponCode || null,
          payment_initiation_request: {
            vendor: "RAZORPAY",
            amount: amount,
            currency: currency,
            description: t("enrollmentPaymentDialog.enrollmentDescription", { course: enrollmentData?.name || courseData.title }),
            charge_automatically: true,
            institute_id: instituteId,
            stripe_request: {},
            razorpay_request: {
              customer_id: null,
              contact: phone,
              email: email,
              razorpay_payment_id: paymentData.razorpay_payment_id,
              razorpay_order_id: paymentData.razorpay_order_id,
              razorpay_signature: paymentData.razorpay_signature,
            },
            pay_pal_request: {},
            eway_request: {},
            include_pending_items: true,
          },
          custom_field_values: [],
        },
      };

      console.log("Register API Completion Payload:", JSON.stringify(registerPayload, null, 2));

      const response = await fetch(
        `${baseUrl}/auth-service/learner/v1/register`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(registerPayload),
        }
      );

      const paymentResponse = await response.json();
      console.log("Register API response:", paymentResponse);

      if (!response.ok) {
        throw new Error(paymentResponse.message || paymentResponse.ex || t("enrollmentPaymentDialog.completeEnrollmentFailed"));
      }

      // Try to get credentials from register response and login
      const username = paymentResponse?.user?.username || paymentResponse?.user_details?.username || paymentResponse?.username;
      const password = paymentResponse?.user?.password || paymentResponse?.user_details?.password || paymentResponse?.password;

      if (username && password) {
        console.log("=== Calling Login API with register response credentials ===");
        const loginResponse = await fetch(LOGIN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_name: username,
            password: password,
            client_name: "ADMIN_PORTAL",
          }),
        });

        const loginResult = await loginResponse.json();
        console.log("Login API response:", loginResult);

        if (loginResponse.ok && loginResult.accessToken && loginResult.refreshToken) {
          console.log("Auto-login successful from register response!");
          onSuccess({
            accessToken: loginResult.accessToken,
            refreshToken: loginResult.refreshToken,
          });
          return;
        }
      }

      // Final fallback: Extract tokens directly from register response
      if (paymentResponse.accessToken && paymentResponse.refreshToken) {
        onSuccess({
          accessToken: paymentResponse.accessToken,
          refreshToken: paymentResponse.refreshToken,
        });
      } else if (paymentResponse.access_token && paymentResponse.refresh_token) {
        onSuccess({
          accessToken: paymentResponse.access_token,
          refreshToken: paymentResponse.refresh_token,
        });
      } else if (paymentResponse?.user_details?.access_token && paymentResponse?.user_details?.refresh_token) {
        onSuccess({
          accessToken: paymentResponse.user_details.access_token,
          refreshToken: paymentResponse.user_details.refresh_token,
        });
      } else {
        onError(t("enrollmentPaymentDialog.autoLoginFailed"));
      }
    } catch (error) {
      console.error("Razorpay completion error:", error);
      onError(error instanceof Error ? error.message : t("enrollmentPaymentDialog.completeEnrollmentFailed"));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmit = async () => {
    console.log("=== handleSubmit called ===");
    console.log("vendor:", vendor);
    console.log("amount:", amount);
    console.log("enrollmentData:", enrollmentData);
    console.log("courseData:", courseData);

    // Check if this is a free course based on the selected plan price
    const isFree = amount === 0;
    console.log("isFree:", isFree);

    if (isFree) {
      setIsProcessing(true);

      try {
        const finalEnrollInviteId =
          paymentEntry?.enroll_invite_id ||
          enrollmentData?.enroll_invite_id ||
          enrollmentData?.id ||
          courseData.enrollInviteId;

        // Validate that we have a valid enroll_invite_id
        if (!finalEnrollInviteId) {
          onError(t("enrollmentPaymentDialog.noEnrollInviteId"));
          setIsProcessing(false);
          return;
        }

        const result = await processEnrollmentPayment({
          user: {
            id: null,
            username: email.split("@")[0],
            email: email,
            full_name: fullName,
            mobile_number: phone,
            date_of_birth: "",
            gender: "",
            address_line: "",
            city: "",
            region: "",
            pin_code: "",
            profile_pic_file_id: "",
            roles: ["STUDENT"],
            root_user: true,
          },
          institute_id: instituteId,
          subject_id: "",
          vendor_id: "FREE",
          learner_package_session_enroll: {
            // The same package session the paid paths enrol in.
            package_session_ids: [paymentEntry?.package_session_id || courseData.packageSessionId],
            plan_id: "free-plan",
            payment_option_id: paymentEntry?.payment_option?.id || null,
            enroll_invite_id: finalEnrollInviteId,
            coupon_code: appliedCouponCode || null,
            payment_initiation_request: {
              amount: 0,
              currency: "USD",
              description: t("enrollmentPaymentDialog.freeEnrollmentDescription", { course: enrollmentData?.name || courseData.title }),
              charge_automatically: false,
              order_id: `free_enrollment_${Date.now()}_${Math.random()
                .toString(36)
                .substr(2, 9)}`,
              institute_id: instituteId,
              email: email,
              vendor: "FREE",
              vendor_id: "free_enrollment",
              stripe_request: {},
              razorpay_request: {},
              pay_pal_request: {},
              include_pending_items: true,
            },
            custom_field_values: [],
          },
        });

        if (result.accessToken && result.refreshToken) {
          onSuccess({
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
          });
        } else if (result.access_token && result.refresh_token) {
          onSuccess({
            accessToken: result.access_token,
            refreshToken: result.refresh_token,
          });
        } else if (result.success) {
          onSuccess({
            accessToken: "free_access_token_" + Date.now(),
            refreshToken: "free_refresh_token_" + Date.now(),
          });
        } else {
          onError(result.message || t("enrollmentPaymentDialog.freeEnrollmentFailed", { course }));
        }
      } catch (error) {
        onError(
          error instanceof Error
            ? error.message
            : t("enrollmentPaymentDialog.freeEnrollmentFailedRetry", { course })
        );
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    // Razorpay Flow - using same service as enroll-form.tsx
    if (vendor === "RAZORPAY") {
      setIsProcessing(true);
      try {
        const finalEnrollInviteId =
          paymentEntry?.enroll_invite_id ||
          enrollmentData?.enroll_invite_id ||
          enrollmentData?.id ||
          courseData.enrollInviteId;

        console.log("Calling Enroll API for Razorpay order creation...");

        // Step 1: Call ENROLL API to create order (this returns Razorpay order details)
        const enrollPayload = {
          user: {
            email: email,
            full_name: fullName,
            address_line: "",
            city: "",
            region: "",
            pin_code: "",
            mobile_number: phone,
            date_of_birth: "",
            gender: "",
            password: "",
            profile_pic_file_id: "",
            roles: ["STUDENT"],
            root_user: true,
          },
          institute_id: instituteId,
          subject_id: "",
          vendor_id: "RAZORPAY",
          learner_package_session_enroll: {
            package_session_ids: [paymentEntry?.package_session_id || courseData.packageSessionId],
            plan_id: selectedPaymentPlan.id,
            payment_option_id: paymentEntry?.payment_option?.id || "",
            enroll_invite_id: finalEnrollInviteId,
            refer_request: null,
            coupon_code: appliedCouponCode || null,
            payment_initiation_request: {
              vendor: "RAZORPAY",
              amount: amount,
              currency: currency,
              description: t("enrollmentPaymentDialog.enrollmentDescription", { course: enrollmentData?.name || courseData.title }),
              charge_automatically: true,
              institute_id: instituteId,
              stripe_request: {},
              razorpay_request: {
                customer_id: null,
                contact: phone,
                email: email,
              },
              pay_pal_request: {},
              eway_request: {},
              include_pending_items: true,
            },
            custom_field_values: [],
          },
        };

        console.log("Enroll API Payload:", JSON.stringify(enrollPayload, null, 2));

        const response = await axios({
          method: "POST",
          url: ENROLL_USER_INVITE_PAYMENT_URL,
          data: enrollPayload,
        });

        const paymentResponse = response.data;
        console.log("Enroll API Response:", JSON.stringify(paymentResponse, null, 2));

        // Extract and store username/password for auto-login after payment
        // Try multiple possible paths in the response
        const enrollUsername =
          paymentResponse?.user?.username ||  // Actual path from API response
          paymentResponse?.user_details?.username ||
          paymentResponse?.username;
        const enrollPassword =
          paymentResponse?.user?.password ||  // Actual path from API response
          paymentResponse?.user_details?.password ||
          paymentResponse?.password;

        console.log("Extracted credentials - username:", enrollUsername, "password:", enrollPassword ? "***" : undefined);

        if (enrollUsername && enrollPassword) {
          console.log("✓ Storing credentials from Enroll API for auto-login after payment");
          razorpayCredentialsRef.current = {
            username: enrollUsername,
            password: enrollPassword,
          };
        } else {
          console.log("✗ No credentials found in Enroll API response");
          console.log("Response structure:", JSON.stringify(Object.keys(paymentResponse), null, 2));
          razorpayCredentialsRef.current = null;
        }

        // Step 2: Extract order details from response
        const orderDetails = paymentResponse?.payment_response?.response_data;
        console.log("Order Details:", orderDetails);

        if (!orderDetails || !orderDetails.razorpayKeyId || !orderDetails.razorpayOrderId) {
          console.error("Missing Razorpay keys. Full result:", paymentResponse);
          throw new Error(t("enrollmentPaymentDialog.razorpayOrderFailed"));
        }

        // Step 3: Open Razorpay payment modal
        if (razorpayRef.current) {
          razorpayRef.current.openPayment({
            razorpayKeyId: orderDetails.razorpayKeyId,
            razorpayOrderId: orderDetails.razorpayOrderId,
            amount: orderDetails.amount,
            currency: orderDetails.currency || currency,
            contact: orderDetails.contact || phone,
            email: orderDetails.email || email,
          });
        } else {
          throw new Error(t("enrollmentPaymentDialog.razorpayNotReady"));
        }

        setIsProcessing(false);
      } catch (error: any) {
        console.error("Razorpay init error:", error);
        const errorMessage = error?.response?.data?.ex || error?.response?.data?.message || (error instanceof Error ? error.message : t("enrollmentPaymentDialog.paymentInitFailed"));
        onError(errorMessage);
        setIsProcessing(false);
      }
      return;
    }

    // For paid courses, proceed with Stripe payment
    if (!stripe || !elements) {
      onError(t("enrollmentPaymentDialog.stripeNotLoaded"));
      return;
    }

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      onError(t("enrollmentPaymentDialog.cardElementNotFound"));
      return;
    }

    setIsProcessing(true);
    setCardError("");

    try {
      // Create payment method
      const { error: paymentMethodError, paymentMethod } =
        await stripe.createPaymentMethod({
          type: "card",
          card: cardElement,
          billing_details: {
            email: email,
            name: fullName,
          },
        });

      if (paymentMethodError) {
        setCardError(
          paymentMethodError.message || t("enrollmentPaymentDialog.paymentMethodCreationFailed")
        );
        setIsProcessing(false);
        return;
      }

      // Prioritize enroll_invite_id from courseData (passed from course catalog)
      const finalEnrollInviteId =
        paymentEntry?.enroll_invite_id ||
        enrollmentData?.enroll_invite_id ||
        enrollmentData?.id ||
        courseData.enrollInviteId;

      // Process enrollment payment
      const result = await processEnrollmentPayment({
        user: {
          email: email,
          full_name: fullName,
          address_line: "",
          city: "",
          region: "",
          pin_code: "",
          mobile_number: phone,
          date_of_birth: "",
          gender: "",
          password: "",
          profile_pic_file_id: "",
          roles: ["STUDENT"],
          root_user: true,
        },
        institute_id: instituteId,
        subject_id: "",
        vendor_id: "STRIPE",
        learner_package_session_enroll: {
          package_session_ids: [paymentEntry?.package_session_id || courseData.packageSessionId],
          plan_id: selectedPaymentPlan.id,
          payment_option_id: paymentEntry?.payment_option?.id || "",
          enroll_invite_id: finalEnrollInviteId,
          refer_request: null,
          coupon_code: appliedCouponCode || null,
          payment_initiation_request: {
            vendor: "STRIPE",
            amount: amount,
            currency: currency,
            description: t("enrollmentPaymentDialog.enrollmentDescription", { course: enrollmentData?.name || courseData.title }),
            charge_automatically: true,
            institute_id: instituteId,
            stripe_request: {
              payment_method_id: paymentMethod.id,
              card_last4: paymentMethod.card?.last4 || "0000",
              customer_id: paymentMethod.customer || "",
              return_url: window.location.origin + "/study-library/courses",
            },
            pay_pal_request: {},
            include_pending_items: true,
          },
          custom_field_values: [],
        },
      });

      // Check for successful payment
      if (result.accessToken && result.refreshToken) {
        onSuccess({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        });
      } else if (result.access_token && result.refresh_token) {
        onSuccess({
          accessToken: result.access_token,
          refreshToken: result.refresh_token,
        });
      } else if (result.success) {
        // For testing: create mock tokens
        onSuccess({
          accessToken: "mock_access_token_" + Date.now(),
          refreshToken: "mock_refresh_token_" + Date.now(),
        });
      } else {
        onError(result.message || t("enrollmentPaymentDialog.paymentProcessingFailed"));
      }
    } catch (error) {
      // For testing: if payment fails, show success anyway with mock tokens
      if (error instanceof Error && error.message.includes("test")) {
        onSuccess({
          accessToken: "test_access_token_" + Date.now(),
          refreshToken: "test_refresh_token_" + Date.now(),
        });
      } else {
        onError(
          error instanceof Error
            ? error.message
            : t("enrollmentPaymentDialog.paymentFailedRetry")
        );
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Card Element Container - Only show for paid courses */}
      {amount > 0 && vendor === "STRIPE" && (
        <div className="min-h-12 border border-gray-300 rounded-catalogue-sm p-3 bg-white">
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: "16px",
                  color: "#374151", // design-lint-ignore: page-builder default color
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  "::placeholder": {
                    color: "#9CA3AF", // design-lint-ignore: page-builder default color
                  },
                },
                invalid: {
                  color: "#DC2626", // design-lint-ignore: page-builder default color
                },
              },
            }}
            onChange={(event) => {
              setCardComplete(event.complete);
              if (event.error) {
                setCardError(event.error.message);
              } else {
                setCardError("");
              }
            }}
          />
        </div>
      )}

      {/* Razorpay Component */}
      {amount > 0 && vendor === "RAZORPAY" && (
        <RazorpayCheckoutForm
          ref={razorpayRef}
          error={cardError}
          amount={amount}
          currency={currency}
          userName={fullName}
          userEmail={email}
          userContact={phone}
          courseName={enrollmentData?.name || courseData.title}
          onPaymentReady={(paymentData) => {
            console.log("=== onPaymentReady called ===");
            console.log("Payment Data from Razorpay:", paymentData);
            completeRazorpayEnrollment(paymentData);
          }}
          onError={setCardError}
        />
      )}

      {/* Free course message */}
      {amount === 0 && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-catalogue-sm">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-green-400"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ms-3">
              <p className="text-sm font-medium text-green-800">
                {t("enrollmentPaymentDialog.freeCourseMessage", { course })}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {cardError && <div className="text-red-600 text-xs">{cardError}</div>}

      {/* Enroll Button */}
      <div className="pt-2">
        <MyButton
          buttonType="primary"
          scale="medium"
          layoutVariant="default"
          className="w-full h-11 text-base flex items-center justify-center gap-2"
          onClick={handleSubmit}
          disabled={
            isProcessing || (amount > 0 && vendor === "STRIPE" && (!stripe || !cardComplete))
          }
        >
          {isProcessing ? (
            <>
              <SpinnerGap size={18} className="animate-spin" />
              {amount === 0 ? t("enrollmentPaymentDialog.enrolling") : t("enrollmentPaymentDialog.processing")}
            </>
          ) : (
            <>
              {amount === 0 ? (
                <>
                  <svg
                    className="w-5 h-5"
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
                  {t("enrollmentPaymentDialog.enrollForFree")}
                </>
              ) : (
                <>
                  <Lock size={18} />
                  {vendor === "RAZORPAY" ? t("enrollmentPaymentDialog.proceedToPay") : t("enrollmentPaymentDialog.enrollNow")}
                </>
              )}
            </>
          )}
        </MyButton>
      </div>

      {/* Security Message - Only show for paid courses */}
      {amount > 0 && (
        <div className="text-xs text-gray-500 text-center flex items-center justify-center gap-1">
          <Lock size={14} className="inline-block me-1" />
          {t("enrollmentPaymentDialog.securePaymentPoweredBy")}
          <span className="font-semibold flex items-center gap-1 ms-1">
            {vendor === "RAZORPAY" ? (
              <span>Razorpay</span>
            ) : (
              <>
                <SiStripe size={16} className="text-indigo-600" />
                Stripe
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
};

// API function to process enrollment payment
const processEnrollmentPayment = async (paymentData: any) => {
  try {
    const baseUrl = BASE_URL;

    console.log("Register API Payload (Stripe/Free):", JSON.stringify(paymentData, null, 2));

    const response = await fetch(
      `${baseUrl}/auth-service/learner/v1/register`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(paymentData),
      }
    );

    const result = await response.json();
    console.log("Register API Response (Stripe/Free):", JSON.stringify(result, null, 2));

    if (!response.ok) {
      throw new Error(result.message || result.ex || i18n.t("coursePlayerA:enrollmentPaymentDialog.paymentFailedFallback"));
    }

    return result;
  } catch (error) {
    throw error;
  }
};
