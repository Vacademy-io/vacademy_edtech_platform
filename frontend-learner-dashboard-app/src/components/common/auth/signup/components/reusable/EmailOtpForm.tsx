import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SpinnerGap,
  Envelope,
  ArrowRight,
  ArrowLeft,
  ArrowsClockwise,
  CheckCircle,
} from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { SignupSettings } from "@/config/signup/defaultSignupSettings";
import { toast } from "sonner";
import axios from "axios";
import {
  LIVE_SESSION_REQUEST_OTP,
  LIVE_SESSION_VERIFY_OTP,
} from "@/constants/urls";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { ENABLE_OTP_FOR_LOGIN_SIGNUP } from "@/constants/feature-flags";

interface EmailOtpFormData {
  email: string;
  fullName: string;
}

interface OtpFormData {
  otp: string[];
}

interface EmailOtpFormProps {
  settings: SignupSettings;
  initialEmail?: string;
  initialFullName?: string;
  onOtpVerified: (email: string, fullName: string) => Promise<void>;
  onBack?: () => void;
  className?: string;
  isOAuth?: boolean;
  hideFullName?: boolean;
  privateEmailMessage?: string;
}

// Dynamic schema based on signup mode
const createEmailOtpSchema = (
  signupMode: "direct" | "askCredentials",
  hideFullName: boolean = false
) => {
  const baseSchema: any = {
    email: z.string().email(i18n.t("auth:validation.validEmail")),
  };

  if (!hideFullName) {
    baseSchema.fullName = z
      .string()
      .min(2, i18n.t("auth:validation.fullNameMin"));
  }

  return z.object(baseSchema);
};

export function EmailOtpForm({
  settings,
  initialEmail = "",
  initialFullName = "",
  onOtpVerified,
  onBack,
  className = "",
  isOAuth = false,
  hideFullName = false,
  privateEmailMessage = "",
}: EmailOtpFormProps) {
  const { t } = useTranslation("auth");
  const [currentStep, setCurrentStep] = useState<"form" | "otp" | "verifying">(
    "form"
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [timer, setTimer] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [formData, setFormData] = useState<EmailOtpFormData | null>(null);
  const [otpValues, setOtpValues] = useState<string[]>(Array(6).fill(""));
  const domainRouting = useDomainRouting();

  const schema = createEmailOtpSchema(
    settings.emailOtpSignupMode,
    hideFullName
  );
  const form = useForm<EmailOtpFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: initialEmail,
      fullName: initialFullName,
    },
  });

  const otpForm = useForm<OtpFormData>({
    resolver: zodResolver(
      z.object({
        otp: z
          .array(z.string())
          .length(6)
          .transform((val) => val.join("")),
      })
    ),
    defaultValues: {
      otp: Array(6).fill(""),
    },
  });

  // Timer for OTP resend
  const startTimer = () => {
    setTimer(60);
    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleEmailSubmit = async (data: EmailOtpFormData) => {
    try {
      const instituteId = domainRouting?.instituteId;
      setIsSubmitting(true);

      // If email OTP verification is disabled, skip directly to success
      if (!ENABLE_OTP_FOR_LOGIN_SIGNUP) {
        const fullNameToPass = data.fullName || initialFullName || "User";
        await onOtpVerified(data.email, fullNameToPass);
        return;
      }

      // Send OTP
      await axios.post(
        LIVE_SESSION_REQUEST_OTP,
        {
          to: data.email.trim(),
          subject: "Email Verification",
          service: "signup",
          name: data.fullName || initialFullName || "User", // Use initialFullName if fullName not provided
          otp: "",
        },
        {
          params: { instituteId },
        }
      );

      setFormData(data);
      setIsOtpSent(true);
      setCurrentStep("otp");
      // Reset OTP values when starting new OTP flow
      setOtpValues(Array(6).fill(""));
      otpForm.setValue("otp", Array(6).fill(""));
      startTimer();
      toast.success(i18n.t("auth:toasts.otpSentEmail"));
    } catch (error) {
      toast.error(i18n.t("auth:toasts.failedToSendOtpRetry"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOtpSubmit = async () => {
    if (!formData) {
      return;
    }

    try {
      setCurrentStep("verifying");

      // Use local OTP state instead of form state
      const otpString = otpValues.join("");

      // Check if OTP is complete
      if (otpString.length !== 6) {
        toast.error(i18n.t("auth:validation.completeOtp"));
        setCurrentStep("otp");
        return;
      }

      // Verify OTP
      await axios.post(LIVE_SESSION_VERIFY_OTP, {
        to: formData.email,
        otp: otpString,
        service: "signup",
      });

      // OTP verified, call the callback
      // Use initialFullName as fallback when fullName is not provided (for GitHub private email case)
      const fullNameToPass = formData.fullName || initialFullName || "User";
      await onOtpVerified(formData.email, fullNameToPass);
    } catch (error) {
      toast.error(i18n.t("auth:toasts.invalidOtpRetry"));
      setCurrentStep("otp");
    }
  };

  const handleResendOtp = async () => {
    if (!formData || timer > 0) return;

    try {
      const instituteId = domainRouting?.instituteId;

      await axios.post(
        LIVE_SESSION_REQUEST_OTP,
        {
          to: formData.email.trim(),
          subject: "Email Verification",
          service: "signup",
          name: formData.fullName || initialFullName || "User", // Use initialFullName if fullName not provided
          otp: "",
        },
        {
          params: { instituteId },
        }
      );

      startTimer();
      toast.success(i18n.t("auth:toasts.otpResent"));
    } catch (error) {
      toast.error(i18n.t("auth:toasts.failedToResendOtp"));
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    // Only allow single digit
    if (value.length > 1) {
      value = value[0];
    }

    // Update local state
    const newOtpValues = [...otpValues];
    newOtpValues[index] = value;
    setOtpValues(newOtpValues);

    // Also update form state for compatibility
    otpForm.setValue("otp", newOtpValues);

    // Auto-focus next input
    if (value && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === "Backspace") {
      if (!e.currentTarget.value && index > 0) {
        // If current field is empty and backspace is pressed, go to previous field
        otpInputRefs.current[index - 1]?.focus();
      } else if (e.currentTarget.value) {
        // If current field has value, clear it first
        const newOtpValues = [...otpValues];
        newOtpValues[index] = "";
        setOtpValues(newOtpValues);
        otpForm.setValue("otp", newOtpValues);
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData
      .getData("text/plain")
      .replace(/\D/g, "")
      .slice(0, 6);

    if (pastedData.length > 0) {
      // Create OTP array with pasted data + empty strings for remaining slots
      const otpArray = pastedData
        .split("")
        .concat(Array(6 - pastedData.length).fill(""));

      setOtpValues(otpArray);
      otpForm.setValue("otp", otpArray);

      // Focus the next empty input or the last input
      const nextIndex = Math.min(pastedData.length, 5);
      if (otpInputRefs.current[nextIndex]) {
        otpInputRefs.current[nextIndex]?.focus();
      } else if (otpInputRefs.current[5]) {
        // If nextIndex is out of bounds, focus the last input
        otpInputRefs.current[5]?.focus();
      }

      // Show success message
      // OTP pasted successfully - no need to show toast
    }
  };

  if (currentStep === "form") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`space-y-6 ${className}`}
      >
        {/* Header */}
        <div className="text-center space-y-2">
          <h3 className="text-xl font-semibold text-gray-900">
            {isOAuth ? t("emailInput.verifyEmail") : t("signup.createAccount")}
          </h3>
          <p className="text-sm text-gray-600">
            {isOAuth
              ? t("emailInput.verifyEmailSubtitle")
              : t("emailInput.enterDetails")}
          </p>
        </div>

        {/* Email Form */}
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleEmailSubmit)}
            className="space-y-4"
          >
            {/* Private Email Message */}
            {hideFullName && privateEmailMessage && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    <svg
                      className="w-5 h-5 text-blue-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-blue-800">
                      {privateEmailMessage}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Full Name Field - Only show when not hidden */}
            {!hideFullName && (
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-gray-700">
                      {t("emailInput.fullNameLabel")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t("emailInput.enterFullName")}
                        className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-gray-700">
                    {t("emailInput.emailLabel")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      placeholder={t("common.enterEmailAddress")}
                      className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-gray-900 hover:bg-black text-white font-medium py-3 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
            >
              {isSubmitting ? (
                <>
                  <SpinnerGap className="w-4 h-4 me-2 animate-spin" />
                  {t("emailInput.sendingOtp")}
                </>
              ) : (
                <>
                  {t("emailInput.sendOtp")}
                  <ArrowRight className="w-4 h-4 ms-2" />
                </>
              )}
            </Button>
          </form>
        </Form>

        {/* Back Button */}
        {onBack && (
          <button
            onClick={onBack}
            className="w-full flex items-center justify-center gap-2 text-sm text-gray-600 hover:text-gray-800 transition-colors duration-200"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("emailInput.backToOptions")}
          </button>
        )}
      </motion.div>
    );
  }

  if (currentStep === "otp") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`space-y-6 ${className}`}
      >
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Envelope className="w-8 h-8 text-blue-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900">
            {t("emailInput.verifyEmail")}
          </h3>
          <p className="text-sm text-gray-600">
            {t("common.sentSixDigitCode")}{" "}
            <span className="font-medium">{formData?.email}</span>
          </p>
        </div>

        {/* OTP Form */}
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="flex justify-center space-x-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Input
                  key={index}
                  ref={(el) => (otpInputRefs.current[index] = el)}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={otpValues[index]}
                  onChange={(e) => handleOtpChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  onPaste={index === 0 ? handlePaste : undefined}
                  className="h-12 w-12 text-center text-lg font-semibold border border-gray-200 rounded-lg transition-all duration-200 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 hover:border-gray-300 bg-white shadow-sm"
                />
              ))}
            </div>
          </div>

          <Button
            onClick={handleOtpSubmit}
            disabled={currentStep === "verifying"}
            className="w-full bg-gray-900 hover:bg-black text-white font-medium py-3 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {currentStep === "verifying" ? (
              <>
                <SpinnerGap className="w-4 h-4 me-2 animate-spin" />
                {t("common.verifying")}
              </>
            ) : (
              t("otpVerification.verifyOtp")
            )}
          </Button>
        </div>

        {/* Resend OTP */}
        <div className="text-center">
          <button
            onClick={handleResendOtp}
            disabled={timer > 0}
            className="text-sm text-gray-600 hover:text-gray-800 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors duration-200"
          >
            {timer > 0 ? (
              <span className="flex items-center justify-center gap-2">
                <ArrowsClockwise className="w-4 h-4 animate-spin" />
                {t("common.resendIn", { count: timer })}
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <ArrowsClockwise className="w-4 h-4" />
                {t("otpVerification.resendOtp")}
              </span>
            )}
          </button>
        </div>

        {/* Back Button */}
        <button
          onClick={() => {
            setCurrentStep("form");
            // Reset OTP values when going back
            setOtpValues(Array(6).fill(""));
            otpForm.setValue("otp", Array(6).fill(""));
          }}
          className="w-full flex items-center justify-center gap-2 text-sm text-gray-600 hover:text-gray-800 transition-colors duration-200"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("otpVerification.backToEmailForm")}
        </button>
      </motion.div>
    );
  }

  if (currentStep === "verifying") {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
          <p className="text-gray-600">{t("otpVerification.verifyingOtp")}</p>
        </div>
      </div>
    );
  }

  return null;
}
