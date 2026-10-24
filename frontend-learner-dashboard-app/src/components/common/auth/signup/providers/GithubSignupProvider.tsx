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

interface GithubSignupProviderProps {
  instituteId: string;
  settings: SignupSettings;
  isDefault?: boolean;
  onSignupSuccess?: () => void;
  onBackToProviders?: () => void;
  className?: string;
}

interface GithubProfile {
  name: string;
  email?: string;
  emailPublic?: boolean;
  emailVerified?: boolean;
  id?: string; // GitHub user ID
  login?: string; // GitHub username
}

interface CredentialsFormData {
  fullName: string;
  username: string;
  password: string;
  confirmPassword: string;
}

interface EmailOtpFormData {
  email: string;
  fullName: string;
}

interface OtpFormData {
  otp: string;
}

const credentialsSchema = z.object({
  fullName: z.string().min(2, i18n.t("authExtraB:common.fullNameMinLength")),
  username: z.string().min(3, i18n.t("authExtraB:common.usernameMinLength")),
  password: z.string().min(8, i18n.t("authExtraB:common.passwordMinLength")),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: i18n.t("authExtraB:common.passwordsDontMatch"),
  path: ["confirmPassword"],
});

const emailOtpSchema = z.object({
  email: z.string().email(i18n.t("authExtraB:common.emailInvalid")),
  fullName: z.string().min(2, i18n.t("authExtraB:common.fullNameMinLength")),
});

const otpSchema = z.object({
  otp: z.string().length(6, i18n.t("authExtraB:githubSignup.otpLengthError")),
});

export function GithubSignupProvider({
  instituteId,
  settings,
  isDefault = false,
  onSignupSuccess,
  onBackToProviders,
  className = ""
}: GithubSignupProviderProps) {
  const { t } = useTranslation("authExtraB");
  const { isRegistering, registerUser: registerUserUnified } = useUnifiedRegistration();
  const [currentStep, setCurrentStep] = useState<"button" | "credentials" | "emailOtp" | "otpVerification" | "processing">("button");
  const [githubProfile, setGithubProfile] = useState<GithubProfile | null>(null);
  const [emailForOtp, setEmailForOtp] = useState("");
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [timer, setTimer] = useState(0);
  const otpInputRef = useRef<HTMLInputElement>(null);

  const credentialsForm = useForm<CredentialsFormData>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: {
      fullName: "",
      username: "",
      password: "",
      confirmPassword: "",
    },
  });

  const emailOtpForm = useForm<EmailOtpFormData>({
    resolver: zodResolver(emailOtpSchema),
    defaultValues: {
      email: "",
      fullName: "",
    },
  });

  const otpForm = useForm<OtpFormData>({
    resolver: zodResolver(otpSchema),
    defaultValues: {
      otp: "",
    },
  });

  // Timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [timer]);

  const startTimer = () => {
    setTimer(60); // 60 seconds
  };

  const handleGithubOAuth = async () => {
    try {
      setCurrentStep("processing");
      
      // Simulate GitHub OAuth process
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Mock profile data - in real implementation, this would come from GitHub OAuth
      const mockProfile: GithubProfile = {
        name: "John Doe",
        email: "john.doe@example.com", // This could be undefined if email is private
        emailPublic: false, // Simulate private email
        emailVerified: false, // Simulate unverified email
      };
      
      setGithubProfile(mockProfile);
      
      // Check if we need to handle private email or proceed with registration
      if (!mockProfile.email || !mockProfile.emailPublic || !mockProfile.emailVerified) {
        // Need to get email via OTP
        setCurrentStep("emailOtp");
        emailOtpForm.setValue("fullName", mockProfile.name);
      } else {
        // Decide whether we need credentials based on strategies
        const needsUsername = !["email", "auto"].includes((settings.usernameStrategy as string) || "manual");
        const needsPassword = !["auto", "none"].includes((settings.passwordStrategy as string) || "manual");
        if (needsUsername || needsPassword) {
          setCurrentStep("credentials");
          credentialsForm.setValue("fullName", mockProfile.name);
        } else {
          await handleDirectRegistration(mockProfile);
        }
      }
    } catch (error) {
      console.error("GitHub OAuth error:", error);
      toast.error(t("githubSignup.toast.oauthFailed"));
      setCurrentStep("button");
    }
  };

  const handleDirectRegistration = async (profile: GithubProfile) => {
    try {
      console.log('[GithubSignupProvider] Starting direct registration for:', profile.email);
      
      // Use unified registration hook with settings
      await registerUserUnified({
        username: profile.email ? (settings.usernameStrategy === "email" ? profile.email : profile.email.split("@")[0]) : "",
        email: profile.email!,
        full_name: profile.name,
        instituteId,
        settings, // Pass settings for credential generation
        subject_id: profile.id?.toString() || profile.login, // GitHub user ID or username as subject_id
        vendor_id: "github", // OAuth provider
      });

      console.log('[GithubSignupProvider] Direct registration completed successfully');
      // Success handling is now managed by the unified hook
      onSignupSuccess?.();
    } catch (error) {
      console.error("Direct registration error:", error);
      toast.error(t("common.registerFailed"));
      setCurrentStep("button");
    }
  };

  const handleCredentialsSubmit = async (data: CredentialsFormData) => {
    try {
      if (!githubProfile?.email) throw new Error("Missing email");
      
      console.log('[GithubSignupProvider] Credentials form submitted:', data);
      
      // Use unified registration hook with settings
      await registerUserUnified({
        username: data.username,
        email: githubProfile.email,
        full_name: data.fullName || githubProfile.name,
        password: data.password,
        instituteId,
        settings, // Pass settings for credential generation
        subject_id: githubProfile.id?.toString() || githubProfile.login, // GitHub user ID or username as subject_id
        vendor_id: "github", // OAuth provider
      });

      console.log('[GithubSignupProvider] Registration with credentials completed successfully');
      // Success handling is now managed by the unified hook
      onSignupSuccess?.();
    } catch (error) {
      console.error("Registration error:", error);
      toast.error(t("common.registerFailed"));
    }
  };

  const handleEmailOtpSubmit = async (data: EmailOtpFormData) => {
    try {
      setEmailForOtp(data.email);
      
      // Here you would call the sendOtp API
      // For now, we'll simulate success
      
      setIsOtpSent(true);
      startTimer();
      setCurrentStep("otpVerification");
      
      // Focus OTP input
      setTimeout(() => {
        otpInputRef.current?.focus();
      }, 100);
      
      toast.success(t("githubSignup.toast.otpSent"));
    } catch (error) {
      console.error("Error sending OTP:", error);
      toast.error(t("githubSignup.toast.sendOtpFailed"));
    }
  };

  const handleOtpSubmit = async (data: OtpFormData) => {
    try {
      setCurrentStep("processing");
      
      // Here you would call the verifyOtp API
      // For now, we'll simulate success
      
      // Simulate OTP verification delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Update the profile with the verified email
      const profileWithEmail = { ...githubProfile!, email: emailForOtp };
      setGithubProfile(profileWithEmail);
      
      // Proceed based on signup mode
      if (settings.githubSignupMode === "direct") {
        await handleDirectRegistration(profileWithEmail);
      } else {
        setCurrentStep("credentials");
        credentialsForm.setValue("fullName", profileWithEmail.name);
      }
    } catch (error) {
      console.error("Error verifying OTP:", error);
      toast.error(t("common.invalidOtpToast"));
      setCurrentStep("otpVerification");
    }
  };

  const handleResendOtp = async () => {
    try {
      // Here you would call the sendOtp API again
      
      startTimer();
      toast.success(t("common.resendSuccessToast"));
    } catch (error) {
      console.error("Error resending OTP:", error);
      toast.error(t("common.resendFailedToast"));
    }
  };

  const handleBackToProviders = () => {
    setCurrentStep("button");
    setGithubProfile(null);
    setEmailForOtp("");
    setIsOtpSent(false);
    setTimer(0);
    credentialsForm.reset();
    emailOtpForm.reset();
    otpForm.reset();
    onBackToProviders?.();
  };

  const handleBackToEmailOtp = () => {
    setCurrentStep("emailOtp");
    setIsOtpSent(false);
    setTimer(0);
    otpForm.reset();
  };

  if (currentStep === "processing") {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
          <p className="text-gray-600">{t("githubSignup.processing")}</p>
        </div>
      </div>
    );
  }

  if (currentStep === "otpVerification") {
    return (
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        className="space-y-4"
      >
        {/* Header */}
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="text-center space-y-3"
        >
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-gray-900">{t("githubSignup.otpVerification.title")}</h3>
            <p className="text-sm text-gray-600">
              {t("githubSignup.otpVerification.subtitleSentTo")} <span className="font-medium text-gray-800">{emailForOtp}</span>
            </p>
          </div>
        </motion.div>

        <form onSubmit={otpForm.handleSubmit(handleOtpSubmit)} className="space-y-4">
          <motion.div
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="space-y-2"
          >
            <Label htmlFor="otp" className="text-sm font-medium text-gray-700">{t("githubSignup.otpVerification.codeLabel")}</Label>
            <Input
              ref={otpInputRef}
              id="otp"
              {...otpForm.register("otp")}
              placeholder={t("githubSignup.otpVerification.codePlaceholder")}
              maxLength={6}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center text-lg tracking-widest"
            />
            {otpForm.formState.errors.otp && (
              <p className="text-sm text-red-600">{otpForm.formState.errors.otp.message}</p>
            )}
          </motion.div>

          <motion.div
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="flex gap-3 pt-4"
          >
            <Button
              type="button"
              variant="outline"
              onClick={handleBackToEmailOtp}
              className="flex-1 border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400"
            >
              {t("common.back")}
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-gray-900 hover:bg-black text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
            >
              {t("common.verifyContinue")}
            </Button>
          </motion.div>
        </form>

        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-center"
        >
          {timer > 0 ? (
            <p className="text-sm text-gray-500">
              {t("githubSignup.otpVerification.resendIn", { seconds: timer })}
            </p>
          ) : (
            <Button
              type="button"
              variant="link"
              onClick={handleResendOtp}
              className="text-sm text-blue-600 hover:text-blue-700 underline"
            >
              {t("githubSignup.otpVerification.resendPrompt")}
            </Button>
          )}
        </motion.div>
      </motion.div>
    );
  }

  if (currentStep === "emailOtp") {
    return renderEmailOtpForm();
  }

  if (currentStep === "credentials") {
    return renderCredentialsForm();
  }

  // Loading state is now managed by the unified registration hook

  const renderCredentialsForm = () => (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-4"
    >
      {/* Header */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="text-center space-y-3"
      >
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-gray-900">{t("common.completeYourProfileTitle")}</h3>
          <p className="text-sm text-gray-600">
            {t("githubSignup.credentialsStep.subtitle")}
          </p>
        </div>
      </motion.div>

      <form onSubmit={credentialsForm.handleSubmit(handleCredentialsSubmit)} className="space-y-4">
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="space-y-2"
        >
          <Label htmlFor="fullName" className="text-sm font-medium text-gray-700">{t("common.fullNameLabel")}</Label>
          <Input
            id="fullName"
            {...credentialsForm.register("fullName")}
            placeholder={t("common.fullNamePlaceholder")}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            readOnly
          />
        </motion.div>

        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="space-y-2"
        >
          <Label htmlFor="username" className="text-sm font-medium text-gray-700">{t("common.usernameLabel")}</Label>
          <Input
            id="username"
            {...credentialsForm.register("username")}
            placeholder={t("common.usernamePlaceholder")}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {credentialsForm.formState.errors.username && (
            <p className="text-sm text-red-600">{credentialsForm.formState.errors.username.message}</p>
          )}
        </motion.div>

        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="space-y-2"
        >
          <Label htmlFor="password" className="text-sm font-medium text-gray-700">{t("common.passwordLabel")}</Label>
          <Input
            id="password"
            type="password"
            {...credentialsForm.register("password")}
            placeholder={t("common.passwordPlaceholder")}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {credentialsForm.formState.errors.password && (
            <p className="text-sm text-red-600">{credentialsForm.formState.errors.password.message}</p>
          )}
        </motion.div>

        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="space-y-2"
        >
          <Label htmlFor="confirmPassword" className="text-sm font-medium text-gray-700">{t("common.confirmPasswordLabel")}</Label>
          <Input
            id="confirmPassword"
            type="password"
            {...credentialsForm.register("confirmPassword")}
            placeholder={t("common.confirmPasswordPlaceholder")}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {credentialsForm.formState.errors.confirmPassword && (
            <p className="text-sm text-red-600">{credentialsForm.formState.errors.confirmPassword.message}</p>
          )}
        </motion.div>

        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="flex gap-3 pt-4"
        >
          <Button
            type="button"
            variant="outline"
            onClick={handleBackToProviders}
            className="flex-1 border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400"
          >
            {t("common.back")}
          </Button>
          <Button
            type="submit"
            className="flex-1 bg-gray-900 hover:bg-black text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
            disabled={isRegistering}
          >
            {isRegistering ? t("common.creatingAccount") : t("common.createAccount")}
          </Button>
        </motion.div>
      </form>
    </motion.div>
  );

  const renderEmailOtpForm = () => (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-4"
    >
      {/* Header */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="text-center space-y-3"
      >
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-gray-900">{t("githubSignup.emailOtpStep.title")}</h3>
          <p className="text-sm text-gray-600">
            {t("githubSignup.emailOtpStep.subtitle")}
          </p>
        </div>
      </motion.div>

      <form onSubmit={emailOtpForm.handleSubmit(handleEmailOtpSubmit)} className="space-y-4">
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="space-y-2"
        >
          <Label htmlFor="fullName" className="text-sm font-medium text-gray-700">{t("common.fullNameLabel")}</Label>
          <Input
            id="fullName"
            {...emailOtpForm.register("fullName")}
            placeholder={t("common.fullNamePlaceholder")}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            readOnly
          />
        </motion.div>

        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="space-y-2"
        >
          <Label htmlFor="email" className="text-sm font-medium text-gray-700">{t("githubSignup.emailOtpStep.emailLabel")}</Label>
          <Input
            id="email"
            type="email"
            {...emailOtpForm.register("email")}
            placeholder={t("githubSignup.emailOtpStep.emailPlaceholder")}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {emailOtpForm.formState.errors.email && (
            <p className="text-sm text-red-600">{emailOtpForm.formState.errors.email.message}</p>
          )}
        </motion.div>

        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex gap-3 pt-4"
        >
          <Button
            type="button"
            variant="outline"
            onClick={handleBackToProviders}
            className="flex-1 border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400"
          >
            {t("common.back")}
          </Button>
          <Button
            type="submit"
            className="flex-1 bg-gray-900 hover:bg-black text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
          >
            {t("common.verifyContinue")}
          </Button>
        </motion.div>
      </form>
    </motion.div>
  );

  // Render the GitHub signup button
  return (
    <motion.button
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={handleGithubOAuth}
      className={`w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-md bg-white text-gray-700 font-medium hover:bg-gray-50 hover:border-gray-300 hover:shadow-sm transition-all duration-200 group ${className}`}
      type="button"
    >
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 4.624-5.479 4.72.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
      </svg>
      <span className="text-sm">
        {t("githubSignup.button")}
      </span>
    </motion.button>
  );
}
