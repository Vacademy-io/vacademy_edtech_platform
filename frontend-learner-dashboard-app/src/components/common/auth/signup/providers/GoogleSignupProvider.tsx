import { useState } from "react";
import { motion } from "framer-motion";
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
import { FcGoogle } from "react-icons/fc"; // design-lint-ignore: brand logo, no phosphor equivalent

interface GoogleSignupProviderProps {
  instituteId: string;
  settings: SignupSettings;
  isDefault?: boolean;
  onSignupSuccess?: () => void;
  onBackToProviders?: () => void;
  className?: string;
}

interface GoogleProfile {
  name: string;
  email: string;
}

interface CredentialsFormData {
  fullName: string;
  username: string;
  password: string;
  confirmPassword: string;
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

export function GoogleSignupProvider({
  instituteId,
  settings,
  isDefault = false,
  onSignupSuccess,
  onBackToProviders,
  className = ""
}: GoogleSignupProviderProps) {
  const { t } = useTranslation("authExtraB");
  const { isRegistering, registerUser: registerUserUnified } = useUnifiedRegistration();
  const [currentStep, setCurrentStep] = useState<"button" | "credentials" | "processing">("button");
  const [googleProfile, setGoogleProfile] = useState<GoogleProfile | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const credentialsForm = useForm<CredentialsFormData>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: {
      fullName: "",
      username: "",
      password: "",
      confirmPassword: "",
    },
  });

  const handleGoogleOAuth = async () => {
    try {
      setCurrentStep("processing");
      
      // Simulate Google OAuth flow - in real implementation, this would redirect to Google
      // For now, we'll simulate getting a profile
      const mockProfile: GoogleProfile = {
        name: "John Doe",
        email: "john.doe@gmail.com"
      };
      
      setGoogleProfile(mockProfile);
      
      // Decide whether we need credentials based on strategies
      // For Google OAuth, we can often proceed directly if we have the profile data
      const needsUsername = settings.usernameStrategy === "manual" && !profile.email;
      const needsPassword = settings.passwordStrategy === "manual";
      
      // If we have an email and don't need a password, we can register directly
      if (profile.email && !needsPassword) {
        await handleDirectRegistration(mockProfile);
      } else {
        setCurrentStep("credentials");
        credentialsForm.setValue("fullName", mockProfile.name);
      }
    } catch (error) {
      console.error("Google OAuth error:", error);
      toast.error(t("googleSignup.toast.oauthFailed"));
      setCurrentStep("button");
    }
  };

  const handleDirectRegistration = async (profile: GoogleProfile) => {
    try {
      console.log('[GoogleSignupProvider] Starting direct registration for:', profile.email);
      
      // Use unified registration hook with settings
      await registerUserUnified({
        username: settings.usernameStrategy === "email" ? profile.email : undefined,
        email: profile.email,
        full_name: profile.name,
        instituteId,
        settings, // Pass settings for credential generation
        subject_id: profile.sub, // OAuth subject ID (Google sub)
        vendor_id: "google", // OAuth provider
      });

      console.log('[GoogleSignupProvider] Direct registration completed successfully');
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
      if (!googleProfile?.email)
        throw new Error("Missing Google profile data");

      console.log('[GoogleSignupProvider] Credentials form submitted:', data);
      
      // Use unified registration hook with settings
      await registerUserUnified({
        username: data.username,
        email: googleProfile.email,
        full_name: data.fullName || googleProfile.name,
        password: data.password,
        instituteId,
        settings, // Pass settings for credential generation
        subject_id: googleProfile.sub, // OAuth subject ID (Google sub)
        vendor_id: "google", // OAuth provider
      });

      console.log('[GoogleSignupProvider] Registration with credentials completed successfully');
      // Success handling is now managed by the unified hook
      onSignupSuccess?.();
    } catch (error) {
      console.error("Registration error:", error);
      toast.error(t("common.registerFailed"));
    }
  };

  const handleBackToProviders = () => {
    setCurrentStep("button");
    setGoogleProfile(null);
    credentialsForm.reset();
    onBackToProviders?.();
  };

  if (currentStep === "processing") {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
          <p className="text-gray-600">{t("googleSignup.connecting")}</p>
        </div>
      </div>
    );
  }

  if (currentStep === "credentials") {
    return renderCredentialsForm();
  }

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
            {t("googleSignup.credentialsStep.subtitle")}
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
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              {...credentialsForm.register("password")}
              placeholder={t("common.passwordPlaceholder")}
              className="w-full px-3 py-2 pe-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              type="button"
              onClick={() => setShowPassword(p => !p)}
              className="absolute inset-y-0 end-0 px-3 text-gray-500 hover:text-gray-700 focus:outline-none"
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
          <div className="relative">
            <Input
              id="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              {...credentialsForm.register("confirmPassword")}
              placeholder={t("common.confirmPasswordPlaceholder")}
              className="w-full px-3 py-2 pe-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(p => !p)}
              className="absolute inset-y-0 end-0 px-3 text-gray-500 hover:text-gray-700 focus:outline-none"
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

  // Render the Google signup button
  if (currentStep === "button") {
  return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`space-y-4 ${className}`}
      >
    <motion.button
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={handleGoogleOAuth}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-md bg-white text-gray-700 font-medium hover:bg-gray-50 hover:border-gray-300 hover:shadow-sm transition-all duration-200 group"
      type="button"
    >
          <FcGoogle className="w-5 h-5" />
        {t("googleSignup.button")}
    </motion.button>

        {/* Test button for direct registration */}
        <Button
          onClick={() => handleDirectRegistration({
            name: "Test User",
            email: "test@example.com"
          })}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-blue-200 rounded-md bg-blue-50 text-blue-700 font-medium hover:bg-blue-100 hover:border-blue-300 hover:shadow-sm transition-all duration-200 group"
          type="button"
        >
          {t("googleSignup.testButton")}
        </Button>

        {onBackToProviders && (
          <Button
            onClick={onBackToProviders}
            variant="ghost"
            className="w-full text-gray-600 hover:text-gray-800"
          >
            {t("googleSignup.backToOptions")}
          </Button>
        )}
      </motion.div>
    );
  }
}
