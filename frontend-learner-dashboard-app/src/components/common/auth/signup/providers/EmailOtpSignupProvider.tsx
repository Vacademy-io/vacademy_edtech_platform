import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { SignupSettings } from "@/config/signup/defaultSignupSettings";
import { useUnifiedRegistration } from "@/components/common/auth/signup/hooks/use-unified-registration";
// import { handlePostSignupAuth } from "@/services/signup-api"; // Keep for later use
// import { useNavigate } from "@tanstack/react-router"; // Keep for later use
import { Preferences } from "@capacitor/preferences";
import axios from "axios";
import { LIVE_SESSION_REQUEST_OTP, LIVE_SESSION_VERIFY_OTP } from "@/constants/urls";
import { checkUserEnrollment } from "@/services/signup-api";
import { ENABLE_OTP_FOR_LOGIN_SIGNUP } from "@/constants/feature-flags";

interface EmailOtpSignupProviderProps {
  instituteId: string;
  settings: SignupSettings;
  isDefault?: boolean;
  onSignupSuccess?: () => void;
  onBackToProviders?: () => void;
  onBackToEmail?: () => void;
  className?: string;
  initialEmail?: string;
}

interface EmailOtpFormData {
  email: string;
  fullName: string;
  username?: string;
  password?: string;
  confirmPassword?: string;
}

interface OtpFormData {
  otp: string;
}

// Dynamic schema based on signup mode
const createEmailOtpSchema = (signupMode: "direct" | "askCredentials") => {
  const baseSchema = {
    email: z.string().email(i18n.t("authExtraB:common.emailInvalid")),
    fullName: z.string().min(2, i18n.t("authExtraB:common.fullNameMinLength")),
  };

  if (signupMode === "askCredentials") {
    return z.object({
      ...baseSchema,
      username: z.string().min(3, i18n.t("authExtraB:common.usernameMinLength")),
      password: z.string().min(8, i18n.t("authExtraB:common.passwordMinLength")),
      confirmPassword: z.string(),
    }).refine((data) => data.password === data.confirmPassword, {
      message: i18n.t("authExtraB:common.passwordsDontMatch"),
      path: ["confirmPassword"],
    });
  }

  return z.object(baseSchema);
};

// We validate OTP length manually from digit inputs; keep schema empty so submit calls our handler
const otpSchema = z.object({});

export function EmailOtpSignupProvider({
  instituteId,
  settings,
  isDefault = false,
  onSignupSuccess,
  onBackToProviders,
  onBackToEmail,
  className = "",
  initialEmail = ""
}: EmailOtpSignupProviderProps) {
  const { t } = useTranslation("authExtraB");
  const { isRegistering, registerUser: registerUserUnified } = useUnifiedRegistration();
  const [currentStep, setCurrentStep] = useState<"otp" | "final" | "success">("otp");
  const [timer, setTimer] = useState(30); // Start with 30 second timer since OTP was already sent
  const [formData, setFormData] = useState<EmailOtpFormData | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState(initialEmail);
  const [otpDigits, setOtpDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const emailOtpSchema = createEmailOtpSchema(settings.emailOtpSignupMode);
  const emailOtpForm = useForm<EmailOtpFormData>({
    resolver: zodResolver(emailOtpSchema),
    defaultValues: {
      email: initialEmail,
      fullName: "",
      username: "",
      password: "",
      confirmPassword: "",
    },
  });

  const otpForm = useForm<OtpFormData>({ resolver: zodResolver(otpSchema) });

  // Timer effect for OTP resend
  useEffect(() => {
    if (timer > 0) {
      const interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [timer]);

  const handleOtpSubmit = async (data: OtpFormData) => {
    try {
      setIsSubmitting(true);
      
      // If email OTP verification is disabled, skip directly to final step
      if (!ENABLE_OTP_FOR_LOGIN_SIGNUP) {
        // Check enrollment before proceeding
        const isEnrolled = await checkEnrollment(initialEmail);
        if (isEnrolled) {
          toast.error(t("emailOtpSignup.toast.alreadyEnrolled"));
          onBackToProviders?.();
          return;
        }
        
        setVerifiedEmail(initialEmail);
        setCurrentStep("final");
        return;
      }
      
      // Get OTP from individual digits
      const otp = otpDigits.join("");
      if (otp.length !== 6) {
        toast.error(t("emailOtpSignup.toast.otpIncomplete"));
        return;
      }
      
      // Verify OTP via API
      await axios.post(LIVE_SESSION_VERIFY_OTP, {
        to: initialEmail,
        subject: "Email Verification",
        service: "signup",
        name: "User",
        otp,
      });
      
      // Check enrollment before proceeding
      const isEnrolled = await checkEnrollment(initialEmail);
      if (isEnrolled) {
        toast.error("User already enrolled. Please sign in instead.");
        onBackToProviders?.();
        return;
      }
      
      setVerifiedEmail(initialEmail);
      setCurrentStep("final");
      toast.success(t("emailOtpSignup.toast.emailVerified"));
    } catch (error) {
      console.error("Error verifying OTP:", error);
      toast.error(t("common.invalidOtpToast"));
    } finally {
      setIsSubmitting(false);
    }
  };

  // const navigate = useNavigate(); // Keep for later use

  const handleFinalSubmit = async (data: EmailOtpFormData) => {
    try {
      // Use unified registration hook
      await registerUserUnified({
        username: data.username,
        email: initialEmail,
        full_name: data.fullName,
        password: settings.emailOtpSignupMode === "askCredentials" ? data.password : undefined,
        instituteId,
        settings,
      });

      // Success: show toast and close modal only (no redirect/navigation)
      toast.success(t("emailOtpSignup.toast.accountCreated"));
      onSignupSuccess?.();
    } catch (error) {
      console.error("Error creating account:", error);
      toast.error(t("emailOtpSignup.toast.accountCreateFailed"));
    }
  };

  const checkEnrollment = async (email: string): Promise<boolean> => {
    try {
      const enrollmentCheck = await checkUserEnrollment(email, instituteId);
      // Since we're now allowing registration for users who exist but aren't enrolled in this institute,
      // we only return true if they're actually enrolled in this specific institute
      // For now, we'll let the registration process handle the actual enrollment check
      return false; // Allow registration, let the API handle enrollment conflicts
    } catch (error) {
      console.error("Error checking enrollment:", error);
      // If there's an error checking enrollment, assume user is not enrolled
      // to avoid blocking legitimate registrations
      return false;
    }
  };

  const handleResendOtp = async () => {
    if (timer > 0) return;
    
    try {
      setIsSubmitting(true);
      // Resend OTP via API. instituteId must ride along exactly as it does on the initial send —
      // it selects the sender address and branding, so omitting it here made a resend arrive from
      // support@vacademy.io while the first mail came from the institute's own address.
      await axios.post(
        LIVE_SESSION_REQUEST_OTP,
        {
          to: initialEmail,
          subject: "Email Verification",
          service: "signup",
          name: "User",
          otp: "",
        },
        {
          params: { instituteId },
        },
      );
      
      setTimer(30);
      toast.success(t("common.resendSuccessToast"));
    } catch (error) {
      console.error("Error resending OTP:", error);
      toast.error(t("common.resendFailedToast"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBackToEmail = () => {
    setCurrentStep("otp");
    setTimer(0);
    setOtpDigits(["", "", "", "", "", ""]);
    emailOtpForm.reset();
    otpForm.reset();
    if (onBackToEmail) onBackToEmail();
  };

  // Back out of signup to provider selection (used in final step "Back" button)
  const handleBackToProviders = () => {
    setCurrentStep("otp");
    setTimer(0);
    setOtpDigits(["", "", "", "", "", ""]);
    emailOtpForm.reset();
    otpForm.reset();
    onBackToProviders?.();
  };

  const handleOtpChange = (index: number, value: string) => {
    const newOtpDigits = [...otpDigits];
    newOtpDigits[index] = value;
    setOtpDigits(newOtpDigits);
  };

  // Step 1: OTP verification form (since email was already entered)
  const renderOtp = () => (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-4"
    >
      {/* Compact OTP Header - matching login form exactly */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="text-center space-y-3"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{
            delay: 0.2,
            type: "spring",
            stiffness: 200,
          }}
          className="w-12 h-12 bg-gray-100 rounded-md mx-auto flex items-center justify-center"
        >
          <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </motion.div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-gray-900">
            {t("emailOtpSignup.otpStep.checkEmail")}
          </h3>
          <p className="text-sm text-gray-600">
            {t("emailOtpSignup.otpStep.codeSentTo")}
          </p>
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="inline-flex items-center space-x-2 bg-gray-50 border border-gray-200 rounded-md px-3 py-1"
          >
            <svg className="w-3 h-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-medium text-gray-800">
              {initialEmail}
            </span>
          </motion.div>
        </div>
      </motion.div>

      <form onSubmit={otpForm.handleSubmit(handleOtpSubmit)} className="space-y-4">
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="space-y-3"
        >
          <div className="flex justify-center gap-2">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <motion.div
                key={index}
                initial={{
                  scale: 0,
                  opacity: 0,
                }}
                animate={{
                  scale: 1,
                  opacity: 1,
                }}
                transition={{
                  delay: 0.5 + index * 0.03,
                }}
              >
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={otpDigits[index]}
                  className="h-12 w-12 text-center text-lg font-semibold border border-gray-200 rounded-lg transition-all duration-200 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 hover:border-gray-300 bg-white shadow-sm"
                  onChange={(e) => {
                    const value = e.target.value;
                    handleOtpChange(index, value);
                    
                    // Auto-focus to next input if value is entered
                    if (value && index < 5) {
                      const nextInput = e.target.parentElement?.nextElementSibling?.querySelector('input');
                      if (nextInput) nextInput.focus();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !e.currentTarget.value && index > 0) {
                      const prevInput = e.target.parentElement?.previousElementSibling?.querySelector('input');
                      if (prevInput) prevInput.focus();
                    }
                  }}
                  onPaste={(e) => {
                    e.preventDefault();
                    const pastedData = e.clipboardData.getData('text/plain').slice(0, 6);
                    const inputs = e.currentTarget.parentElement?.querySelectorAll('input');
                    if (inputs) {
                      const newOtpDigits = [...otpDigits];
                      pastedData.split('').forEach((char, i) => {
                        if (i < 6 && /^\d$/.test(char)) {
                          newOtpDigits[i] = char;
                        }
                      });
                      setOtpDigits(newOtpDigits);
                    }
                  }}
                  disabled={isSubmitting}
                />
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Back to email + Resend code row */}
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-center"
        >
          <div className="flex items-center justify-center gap-4 text-sm text-gray-600">
            <motion.button
              type="button"
              onClick={handleBackToEmail}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="inline-flex items-center text-gray-500 hover:text-gray-700 transition-colors duration-200 font-medium"
            >
              <svg className="w-3 h-3 me-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              {t("emailOtpSignup.otpStep.backToEmail")}
            </motion.button>
            <span className="text-gray-300">|</span>
            <motion.button
              type="button"
              onClick={handleResendOtp}
              disabled={timer > 0 || isSubmitting}
              whileHover={timer === 0 ? { scale: 1.02 } : {}}
              whileTap={timer === 0 ? { scale: 0.98 } : {}}
              className={`font-medium transition-colors duration-200 ${
                timer > 0 || isSubmitting
                  ? "text-gray-400 cursor-not-allowed"
                  : "text-gray-700 hover:text-gray-900"
              }`}
            >
              {timer > 0 ? t("emailOtpSignup.otpStep.resendIn", { seconds: timer }) : t("emailOtpSignup.otpStep.resendCode")}
            </motion.button>
          </div>
        </motion.div>

        {/* Submit Button - matching login form exactly */}
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="pt-1"
        >
          <motion.button
            type="submit"
            disabled={isSubmitting}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            className="w-full bg-gray-900 hover:bg-black text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
          >
            {isSubmitting ? (
              <div className="flex items-center justify-center space-x-2">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{
                    duration: 1,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </motion.div>
                <span className="text-sm">
                  {t("emailOtpSignup.otpStep.verifying")}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-center space-x-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span className="text-sm">{t("emailOtpSignup.otpStep.verifyOtp")}</span>
              </div>
            )}
          </motion.button>
        </motion.div>

        {/* Back to email moved above with resend code */}
      </form>
    </motion.div>
  );

  // Step 2: Final form (full name + optional username/password)
  const renderFinal = () => (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-4"
    >
      {/* Header with back arrow on the left and centered title */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.05 }}
        className="relative flex items-start justify-center"
      >
        <button
          type="button"
          onClick={handleBackToEmail}
          className="absolute start-0 top-0 inline-flex items-center text-sm text-gray-500 hover:text-gray-700 transition-colors duration-200 font-medium"
          aria-label={t("emailOtpSignup.otpStep.backToEmail")}
        >
          <svg className="w-4 h-4 me-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          {t("common.back")}
        </button>
        <div className="text-center space-y-1">
          <h3 className="text-lg font-semibold text-gray-900">{t("common.completeYourProfileTitle")}</h3>
          <p className="text-sm text-gray-600">{t("emailOtpSignup.finalStep.subtitle")}</p>
        </div>
      </motion.div>

      <form onSubmit={emailOtpForm.handleSubmit(handleFinalSubmit)} className="space-y-4">
        {/* Full Name - Always required */}
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="space-y-2"
        >
          <Label htmlFor="fullName" className="text-sm font-medium text-gray-700">{t("emailOtpSignup.finalStep.fullNameLabelRequired")}</Label>
          <Input
            id="fullName"
            {...emailOtpForm.register("fullName")}
            placeholder={t("emailOtpSignup.finalStep.fullNamePlaceholderEnter")}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {emailOtpForm.formState.errors.fullName && (
            <p className="text-sm text-red-600">{emailOtpForm.formState.errors.fullName.message}</p>
          )}
        </motion.div>

        {/* Username - Only if askCredentials mode */}
        {settings.emailOtpSignupMode === "askCredentials" && (
          <motion.div
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="space-y-2"
          >
            <Label htmlFor="username" className="text-sm font-medium text-gray-700">{t("common.usernameLabel")}</Label>
            <Input
              id="username"
              {...emailOtpForm.register("username")}
              placeholder={t("common.usernamePlaceholder")}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {emailOtpForm.formState.errors.username && (
              <p className="text-sm text-red-600">{emailOtpForm.formState.errors.username.message}</p>
            )}
          </motion.div>
        )}

        {/* Password - Only if askCredentials mode */}
        {settings.emailOtpSignupMode === "askCredentials" && (
          <>
            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="space-y-2"
            >
              <Label htmlFor="password" className="text-sm font-medium text-gray-700">{t("common.passwordLabel")}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  {...emailOtpForm.register("password")}
                  placeholder={t("common.passwordPlaceholder")}
                  className="w-full px-3 py-2 pe-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute inset-y-0 end-0 px-3 text-gray-500 hover:text-gray-700 focus:outline-none"
                  aria-label={showPassword ? t("emailOtpSignup.finalStep.hidePassword") : t("emailOtpSignup.finalStep.showPassword")}
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-5 0-9-4-9-7 0-1.042.334-2.021.925-2.874m2.211-2.211C7.42 5.7 9.62 5 12 5c5 0 9 4 9 7 0 1.152-.395 2.352-1.093 3.4M3 3l18 18M9.88 9.88A3 3 0 0114.12 14.12" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
              {emailOtpForm.formState.errors.password && (
                <p className="text-sm text-red-600">{emailOtpForm.formState.errors.password.message}</p>
              )}
            </motion.div>

            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="space-y-2"
            >
              <Label htmlFor="confirmPassword" className="text-sm font-medium text-gray-700">{t("common.confirmPasswordLabel")}</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  {...emailOtpForm.register("confirmPassword")}
                  placeholder={t("common.confirmPasswordPlaceholder")}
                  className="w-full px-3 py-2 pe-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((p) => !p)}
                  className="absolute inset-y-0 end-0 px-3 text-gray-500 hover:text-gray-700 focus:outline-none"
                  aria-label={showConfirmPassword ? t("emailOtpSignup.finalStep.hideConfirmPassword") : t("emailOtpSignup.finalStep.showConfirmPassword")}
                >
                  {showConfirmPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-5 0-9-4-9-7 0-1.042.334-2.021.925-2.874m2.211-2.211C7.42 5.7 9.62 5 12 5c5 0 9 4 9 7 0 1.152-.395 2.352-1.093 3.4M3 3l18 18M9.88 9.88A3 3 0 0114.12 14.12" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
              {emailOtpForm.formState.errors.confirmPassword && (
                <p className="text-sm text-red-600">{emailOtpForm.formState.errors.confirmPassword.message}</p>
              )}
            </motion.div>
          </>
        )}

        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="pt-4"
        >
          <Button 
            type="submit" 
            className="w-full bg-gray-900 hover:bg-black text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
            disabled={isRegistering}
          >
            {isRegistering ? t("common.creatingAccount") : t("common.createAccount")}
          </Button>
        </motion.div>
      </form>
    </motion.div>
  );

  // Success message
  const renderSuccess = () => (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center space-y-4"
    >
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
        <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div>
        <h3 className="text-lg font-semibold text-gray-900">{t("emailOtpSignup.successStep.title")}</h3>
        <p className="text-sm text-gray-600">{t("emailOtpSignup.successStep.subtitle")}</p>
      </div>
    </motion.div>
  );

  return (
    <div className={`space-y-6 ${className}`}>
      <AnimatePresence mode="wait">
        {currentStep === "otp" && renderOtp()}
        {currentStep === "final" && renderFinal()}
        {currentStep === "success" && renderSuccess()}
      </AnimatePresence>
    </div>
  );
}
