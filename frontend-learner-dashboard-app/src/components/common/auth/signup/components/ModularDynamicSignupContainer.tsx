import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { isIOSNative, shouldHideThirdPartyLogin } from "@/utils/ios-iap-compliance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SignupStep,
  CredentialsForm,
  EmailInputForm,
  OtpVerificationForm,
} from "./reusable";
import { SignupSettings } from "@/config/signup/defaultSignupSettings";
import { FcGoogle } from "react-icons/fc"; // design-lint-ignore: brand logo, no phosphor equivalent
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { ArrowRight } from "@phosphor-icons/react";
import {
  loginWithAppleNative,
  AppleSessionLimitError,
  AppleSignInCancelledError,
} from "@/lib/auth/appleNativeAuth";
import { AppleSignInButton } from "@/components/common/auth/AppleSignInButton";
import { resolveFontStack } from "@/utils/branding";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import {
  LOGIN_URL_GOOGLE_GITHUB,
  LIVE_SESSION_REQUEST_OTP,
} from "@/constants/urls";
import axios from "axios";
import { toast } from "sonner";
import { useUnifiedRegistration } from "../hooks/use-unified-registration";
import { parseInstituteSettings } from "@/services/signup-api";
import {
  checkUserEnrollmentInInstitute,
  handleEnrolledUser,
} from "../utils/enrollment-checker";
import { Preferences } from "@capacitor/preferences";
import { useTheme } from "@/providers/theme/theme-provider";
import { setTokenInStorage } from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import {
  getOAuthRedirectOrigin,
  isNativeOAuthRequired,
  openOAuthInSystemBrowser,
} from "@/lib/auth/nativeOAuth";

interface ModularDynamicSignupContainerProps {
  instituteId?: string;
  settings?: SignupSettings;
  instituteDetails?: any; // Add institute details prop
  onSignupSuccess?: () => void;
  onBackToProviders?: () => void;
  className?: string;
  initialEmail?: string; // Pre-filled email from login flow (default: "")
  autoSendOtp?: boolean; // Auto-trigger OTP send (default: false)
}

type SignupStep =
  | "providers"
  | "emailInput"
  | "otpVerification"
  | "credentials"
  | "success";

export function ModularDynamicSignupContainer({
  instituteId,
  settings,
  instituteDetails,
  onSignupSuccess,
  onBackToProviders,
  className = "",
  initialEmail = "", // Default to empty string (no pre-fill)
  autoSendOtp = false, // Default to false (no auto-send)
}: ModularDynamicSignupContainerProps) {
  const { t } = useTranslation("auth");
  const { setPrimaryColor } = useTheme();
  const { registerUser: registerUserUnified } = useUnifiedRegistration();
  const [currentStep, setCurrentStep] = useState<SignupStep>("providers");
  const [isAppleLoading, setIsAppleLoading] = useState(false);
  const [emailInput, setEmailInput] = useState(initialEmail); // Pre-fill if provided
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [oauthData, setOAuthData] = useState<any>(null);
  const [emailForOtp, setEmailForOtp] = useState("");
  const [fullNameForOtp, setFullNameForOtp] = useState("");
  const [instituteSettings, setInstituteSettings] = useState<any>(null);
  const [hasExecutedCallback, setHasExecutedCallback] = useState(false);
  const [enrollmentChecked, setEnrollmentChecked] = useState<Set<string>>(
    new Set()
  );
  const [uiError, setUiError] = useState<
    | { type: "alreadyEnrolled" | "oauthError" | "network" | "validation"; message: string }
    | null
  >(null);
  const [oauthDataProcessed, setOauthDataProcessed] = useState(false);

  // Use backend settings if available, otherwise fall back to defaults
  const effectiveSettings = settings || {
    providers: {
      google: true,
      github: true,
      emailOtp: true,
      defaultProvider: "emailOtp",
    },
    googleSignupMode: "askCredentials",
    githubSignupMode: "askCredentials",
    emailOtpSignupMode: "askCredentials",
    usernameStrategy: "manual",
    passwordStrategy: "manual",
    passwordDelivery: "none",
  };

  // Apple 4.8 — same rule as the login container: no third-party signup on Mac
  // App Store builds (the fallback above defaults google/github to TRUE).
  if (shouldHideThirdPartyLogin()) {
    effectiveSettings.providers.google = false;
    effectiveSettings.providers.github = false;
  }

  // Check for OAuth signup data from login flow on mount
  useEffect(() => {
    if (oauthDataProcessed) return;
    
    const checkOAuthSignupData = () => {
      try {
        const storedData = sessionStorage.getItem('oauth_signup_data');
        if (storedData) {
          console.log('[Signup] Found OAuth signup data from login flow');
          const parsedData = JSON.parse(storedData);
          setOauthDataProcessed(true);
          // Store in state to be processed
          setOAuthData(parsedData);
          // Determine next step based on OAuth data
          const { signupData } = parsedData;
          if (signupData?.provider === "github" && !signupData?.email) {
            // GitHub with private email - ask for email
            setSelectedProvider("oauth");
            setCurrentStep("emailInput");
          } else if (signupData?.email) {
            // Has email - check if credentials needed
            setSelectedProvider("oauth");
            const needsUsername =
              effectiveSettings.usernameStrategy === "manual" ||
              effectiveSettings.usernameStrategy === " ";
            const needsPassword =
              effectiveSettings.passwordStrategy === "manual" ||
              effectiveSettings.passwordStrategy === " ";
            
            if (needsUsername || needsPassword) {
              setEmailForOtp(signupData.email);
              setFullNameForOtp(signupData.name || "");
              setCurrentStep("credentials");
            } else {
              // Direct registration - will be handled by handleOAuthSuccess
              setEmailForOtp(signupData.email);
              setFullNameForOtp(signupData.name || "");
              setCurrentStep("credentials");
            }
          }
          // Clean up
          sessionStorage.removeItem('oauth_signup_data');
        }
      } catch (e) {
        console.error('[Signup] Failed to process OAuth signup data:', e);
      }
    };
    
    checkOAuthSignupData();
  }, [oauthDataProcessed, effectiveSettings.usernameStrategy, effectiveSettings.passwordStrategy]);

  // Handle success step callback execution
  useEffect(() => {
    if (currentStep === "success" && onSignupSuccess && !hasExecutedCallback) {
      setHasExecutedCallback(true);

      // Execute callback after a delay to allow success message to be seen
      const timer = setTimeout(() => {
        onSignupSuccess();
      }, 1500);

      return () => clearTimeout(timer);
    }
  }, [currentStep, onSignupSuccess, hasExecutedCallback]);

  // Reset callback execution flag when step changes
  useEffect(() => {
    if (currentStep !== "success") {
      setHasExecutedCallback(false);
    }
  }, [currentStep]);

  // Auto-send OTP when autoSendOtp is true and email is prefilled
  // This only runs when explicitly triggered from login flow
  useEffect(() => {
    // Guard: Only proceed if autoSendOtp is explicitly true AND initialEmail exists
    if (!autoSendOtp || !initialEmail || !emailInput) {
      return;
    }

    // Guard: Only proceed if we're on the providers step (initial load)
    if (currentStep !== "providers") {
      return;
    }

    // Guard: Don't auto-send if already sending
    if (isSendingOtp) {
      return;
    }

    // Trigger OTP send after a short delay to ensure UI is ready
    const timer = setTimeout(async () => {
      try {
        setIsSendingOtp(true);
        await axios.post(
          LIVE_SESSION_REQUEST_OTP,
          {
            to: emailInput.trim(),
            subject: "Email Verification",
            service: "signup",
            name: "User",
            otp: "",
          },
          {
            params: { instituteId },
          }
        );

        toast.success(i18n.t("auth:toasts.otpSent"));
        setEmailForOtp(emailInput.trim());
        setSelectedProvider("emailOtp");
        setCurrentStep("otpVerification");
      } catch (e) {
        toast.error(i18n.t("auth:toasts.failedToSendOtp"), {
        description: i18n.t("auth:toasts.tryAgain"),
      });
      } finally {
        setIsSendingOtp(false);
      }
    }, 500); // 500ms delay to ensure smooth UI transition

    return () => clearTimeout(timer);
  }, [autoSendOtp, initialEmail, currentStep, emailInput, isSendingOtp, instituteId]);

  // Parse institute settings to check for allowLearnersToCreateCourses
  useEffect(() => {
    if (instituteDetails?.setting) {
      try {
        const parsedSettings = parseInstituteSettings(instituteDetails.setting);
        setInstituteSettings(parsedSettings);
      } catch (error) {
        // Silently handle parsing errors
      }
    }
  }, [instituteDetails]);

  // Apply institute theme and font (pre-login) from Preferences
  useEffect(() => {
    (async () => {
      try {
        const storedInstitute =
          instituteId ||
          (await Preferences.get({ key: "InstituteId" })).value ||
          "";
        if (!storedInstitute) return;
        const stored = await Preferences.get({
          key: `LEARNER_${storedInstitute}`,
        });
        if (!stored?.value) return;
        const parsed = JSON.parse(stored.value);
        if (parsed?.theme) {
          setPrimaryColor(parsed.theme);
        }
        if (parsed?.fontFamily) {
          const family = resolveFontStack(parsed.fontFamily);
          document.documentElement.style.setProperty(
            "--app-font-family",
            family
          );
          document.body.style.fontFamily = family;
        }
      } catch {
        // Ignore
      }
    })();
  }, [instituteId, setPrimaryColor]);

  // If no institute ID, show error
  if (!instituteId) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {t("signup.configurationError")}
          </h3>
          <p className="text-gray-600">{t("signup.instituteIdRequired")}</p>
        </div>
      </div>
    );
  }

  // Get enabled providers
  const enabledProviders = Object.entries(effectiveSettings.providers)
    .filter(([key, value]) => key !== "defaultProvider" && value === true)
    .map(([key]) => key);

  // Check if any providers are enabled
  const hasEnabledProviders = enabledProviders.length > 0;

  // Always show provider selection step, even if only one provider is enabled
  const shouldShowProviderSelection = hasEnabledProviders;

  // If no providers are enabled, show a message that signup is not available
  if (!hasEnabledProviders) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {t("signup.signupNotAvailable")}
          </h3>
          <p className="text-gray-600 mb-4">
            {t("signup.signupDisabled")}
          </p>
          {onBackToProviders && (
            <button
              onClick={onBackToProviders}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium rounded-md transition-colors"
            >
              {t("common.goBack")}
            </button>
          )}
        </div>
      </div>
    );
  }

  const handleOAuthSignUp = async (provider: "google" | "github") => {
    try {
      // Build state payload
      const currentPath = window.location.pathname;
      const currentSearch = window.location.search;
      const currentUrl = `${currentPath}${currentSearch}`;

      let studyLibraryUrl = "/study-library/courses";
      if (currentPath.includes("/courses/course-details")) {
        const urlParams = new URLSearchParams(currentSearch);
        const courseId = urlParams.get("courseId");
        if (courseId) {
          studyLibraryUrl = `/study-library/courses/course-details?courseId=${courseId}&selectedTab=ALL`;
        }
      } else if (currentPath.includes("/courses")) {
        studyLibraryUrl = "/study-library/courses";
      }

      // Resolve the public-facing origin for OAuth redirect
      const redirectOrigin = await getOAuthRedirectOrigin();

      const stateObj = {
        from: isNativeOAuthRequired()
          ? `${redirectOrigin}/login/oauth/learner`
          : `${redirectOrigin}/oauth-popup-handler.html`,
        account_type: "signup",
        user_type: "learner",
        institute_id: instituteId,
        redirectTo: studyLibraryUrl,
        currentUrl,
        isModalSignup: true,
      } as const;

      const base64State = btoa(JSON.stringify(stateObj));
      const signupUrl = `${LOGIN_URL_GOOGLE_GITHUB}/${provider}?state=${encodeURIComponent(
        base64State
      )}`;

      if (isNativeOAuthRequired()) {
        // Native: open in system browser via Capacitor Browser plugin
        await openOAuthInSystemBrowser(signupUrl);
        return;
      }

      // Web: open OAuth in popup window
      const popup = window.open(
        signupUrl,
        "oauth_popup",
        "width=500,height=600,scrollbars=yes,resizable=yes"
      );

      if (!popup) {
        toast.error(i18n.t("auth:toasts.popupBlocked"));
        setUiError({
          type: "network",
          message: i18n.t("auth:signupErrors.popupOpenFailed"),
        });
        return;
      }

      // Listen for OAuth completion message from popup using a cleanup-aware handler
      let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
      let processed = false;

      const cleanup = () => {
        window.removeEventListener("message", onMessage);
        window.removeEventListener("storage", onStorage);
        try {
          if (bc) {
            bc.close();
            bc = null;
          }
        } catch {}
        if (cleanupTimer) {
          clearTimeout(cleanupTimer);
          cleanupTimer = null;
        }
      };

      const handleSuccessPayload = async (payload: unknown) => {
        if (processed) return;
        processed = true;
        // Handle tokens-only success (direct login path)
        if (
          payload &&
          typeof payload === "object" &&
          "accessToken" in payload &&
          "refreshToken" in payload
        ) {
          const { accessToken, refreshToken } = payload as {
            accessToken: string;
            refreshToken: string;
          };
          try {
            await setTokenInStorage(TokenKey.accessToken, accessToken);
            await setTokenInStorage(TokenKey.refreshToken, refreshToken);
            setCurrentStep("success");
            onSignupSuccess?.();
          } catch {
            toast.error(i18n.t("auth:signupErrors.failedStoreTokens"));
            setUiError({
              type: "network",
              message: i18n.t("auth:signupErrors.couldNotCompleteAuth"),
            });
          }
          return true;
        }
        return false;
      };

      const onMessage = async (event: MessageEvent) => {
        // Only handle messages we expect
        if (!event?.data || typeof event.data !== "object") return;

        if (event.data.type === "oauth_success") {
          const payload = event.data.data;
          const handled = await handleSuccessPayload(payload);
          if (!handled) {
            // Fallback to signup data flow
            handleOAuthSuccess(payload);
          }
          cleanup();
        } else if (event.data.type === "oauth_error") {
          cleanup();
          toast.error(
            event.data.data?.message ||
              i18n.t("auth:signupErrors.oauthAuthFailed")
          );
          setUiError({
            type: "oauthError",
            message:
              i18n.t("auth:signupErrors.authFailedSignIn"),
          });
        }
      };

      window.addEventListener("message", onMessage);

      // Fallback: listen for storage events when COOP blocks postMessage
      const onStorage = async (e: StorageEvent) => {
        if (!e) return;
        if (e.key === "OAUTH_RESULT" && e.newValue) {
          try {
            const parsed = JSON.parse(e.newValue);
            if (parsed?.type === "oauth_success") {
              const handled = await handleSuccessPayload(parsed.data);
              if (!handled) {
                handleOAuthSuccess(parsed.data);
              }
              // Clean up stored value
              localStorage.removeItem("OAUTH_RESULT");
              cleanup();
            } else if (parsed?.type === "oauth_error") {
              cleanup();
              toast.error(
              parsed?.data?.message ||
                i18n.t("auth:signupErrors.oauthAuthFailed")
            );
              setUiError({
                type: "oauthError",
                message:
                  i18n.t("auth:signupErrors.authFailedSignIn"),
              });
            }
          } catch { return; }
        }
      };
      window.addEventListener("storage", onStorage);

      // BroadcastChannel listener (works when COOP blocks postMessage)
      let bc: BroadcastChannel | null = null;
      try {
        if (typeof BroadcastChannel !== "undefined") {
          bc = new BroadcastChannel("OAUTH_CHANNEL");
          bc.onmessage = async (ev: MessageEvent) => {
            const msg = ev?.data;
            if (!msg || typeof msg !== "object") return;
            if (msg.type === "oauth_success") {
              const handled = await handleSuccessPayload(msg.data);
              if (!handled) {
                handleOAuthSuccess(msg.data);
              }
              cleanup();
            } else if (msg.type === "oauth_error") {
              cleanup();
              toast.error(
              msg?.data?.message ||
                i18n.t("auth:signupErrors.oauthAuthFailed")
            );
              setUiError({
                type: "oauthError",
                message:
                  i18n.t("auth:signupErrors.authFailedSignIn"),
              });
            }
          };
        }
      } catch {
        // ignore
      }

      // Immediate localStorage check in case write happened before listener attached
      (async () => {
        try {
          const existing = localStorage.getItem("OAUTH_RESULT");
          if (!existing) return;
          const parsed = JSON.parse(existing);
          if (parsed?.type === "oauth_success") {
            const handled = await handleSuccessPayload(parsed.data);
            if (!handled) {
              handleOAuthSuccess(parsed.data);
            }
            localStorage.removeItem("OAUTH_RESULT");
            cleanup();
          } else if (parsed?.type === "oauth_error") {
            cleanup();
            toast.error(
              parsed?.data?.message ||
                i18n.t("auth:signupErrors.oauthAuthFailed")
            );
            setUiError({
              type: "oauthError",
              message:
                i18n.t("auth:signupErrors.authFailedSignIn"),
            });
          }
        } catch { /* ignore */ }
      })();

      // Fallback cleanup after a timeout to avoid COOP-related access to popup.closed
      cleanupTimer = setTimeout(() => {
        cleanup();
      }, 5 * 60 * 1000);
    } catch (error) {
      toast.error(i18n.t("auth:signupErrors.failedInitiateSignup"));
      setUiError({
        type: "network",
        message: i18n.t("auth:signupErrors.unableToStart"),
      });
    }
  };

  const handleAppleNativeSignup = async () => {
    // Native iOS Apple sign-in is login-or-signup: the backend auto-creates the
    // learner per the institute signup policy, then returns tokens.
    try {
      setIsAppleLoading(true);
      await loginWithAppleNative({ instituteId });
    } catch (e) {
      setIsAppleLoading(false);
      if (e instanceof AppleSignInCancelledError) {
        return; // user dismissed the sheet — no error UI
      }
      if (e instanceof AppleSessionLimitError) {
        toast.error(i18n.t("auth:toasts.sessionLimitReached"));
      } else {
        toast.error(
          e instanceof Error
            ? e.message
            : i18n.t("auth:toasts.appleSignInFailed"),
        );
      }
    }
  };

  const handleProviderSelect = (provider: string) => {
    if (provider === "google" || provider === "github") {
      handleOAuthSignUp(provider as "google" | "github");
      return;
    }

    if (provider === "apple") {
      handleAppleNativeSignup();
      return;
    }

    // For email OTP, directly go to email input step
    if (provider === "emailOtp") {
      setSelectedProvider(provider);
      setCurrentStep("emailInput");
      return;
    }

    setSelectedProvider(provider);
    setCurrentStep("emailInput");
  };

  const handleEmailOtpSignup = async () => {
    if (!emailInput.trim()) return;
    try {
      setIsSendingOtp(true);
      await axios.post(
        LIVE_SESSION_REQUEST_OTP,
        {
          to: emailInput.trim(),
          subject: "Email Verification",
          service: "signup",
          name: "User",
          otp: "",
        },
        {
          params: { instituteId },
        }
      );

      toast.success(i18n.t("auth:toasts.otpSent"));
      setEmailForOtp(emailInput.trim());
      setSelectedProvider("emailOtp");
      setCurrentStep("otpVerification");
    } catch (e) {
      toast.error(i18n.t("auth:toasts.failedToSendOtp"), {
        description: i18n.t("auth:toasts.tryAgain"),
      });
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleEmailInputSuccess = (email: string, fullName?: string) => {
    // For OAuth flows, we should already have the full name, so use it
    if (selectedProvider === "oauth" && oauthData?.signupData?.name) {
      setEmailForOtp(email);
      setFullNameForOtp(oauthData.signupData.name); // Use the OAuth full name
    } else {
      // For regular email OTP flows, use the provided full name
      // When usernameStrategy is "email", use email as full name
      const fullNameToUse =
        effectiveSettings.usernameStrategy === "email" ? email : fullName || "";
      setEmailForOtp(email);
      setFullNameForOtp(fullNameToUse);
    }

    setCurrentStep("otpVerification");
  };

  const handleBackToProviders = () => {
    setCurrentStep("providers");
    setSelectedProvider(null);
    setEmailForOtp("");
    setFullNameForOtp("");
    // Removed onBackToProviders?.() call to keep user in signup flow
  };

  // Helper function to check enrollment only once per email
  const checkEnrollmentOnce = async (email: string) => {
    // If we've already checked this email, don't check again
    if (enrollmentChecked.has(email)) {
      return null;
    }

    const enrollmentResult = await checkUserEnrollmentInInstitute(
      email,
      instituteId!
    );

    // Mark this email as checked
    setEnrollmentChecked((prev) => new Set(prev).add(email));

    return enrollmentResult;
  };

  const handleOAuthSuccess = async (oauthData: any) => {
    try {
      const { signupData, state, emailVerified } = oauthData;

      // Store OAuth data for later use
      setOAuthData({ signupData, state, emailVerified });

      // ENROLLMENT CHECK: Check if user is already enrolled before proceeding
      // This handles OAuth flows with public email (Google, GitHub with public email)
      // For flows requiring email verification (GitHub private email, regular email OTP),
      // enrollment is checked AFTER OTP verification in the OtpVerificationForm
      if (signupData.email) {
        const enrollmentResult = await checkEnrollmentOnce(signupData.email);

        if (enrollmentResult?.isEnrolled) {
          const autoLoginResult = await handleEnrolledUser(
            signupData.email,
            instituteId!,
            () => {
              // Auto-login success - redirect to success step
              setCurrentStep("success");
              onSignupSuccess?.();
            },
            (error) => {
              // Auto-login failed - show error and go back to providers
              setCurrentStep("providers");
              setSelectedProvider(null);
              setOAuthData(null);
              setUiError({
                type: "alreadyEnrolled",
                message: i18n.t("auth:signupErrors.alreadyRegistered"),
              });
            },
            true // shouldRedirectAfterLogin - will handle navigation automatically
          );

          if (autoLoginResult.success) {
            return; // Auto-login handled everything
          }
        }
      }

      // Check credential requirements based on institute settings
      const needsUsername =
        effectiveSettings.usernameStrategy === "manual" ||
        effectiveSettings.usernameStrategy === " ";
      const needsPassword =
        effectiveSettings.passwordStrategy === "manual" ||
        effectiveSettings.passwordStrategy === " ";

      // GitHub with private email - always need email OTP verification
      // We don't check enrollment here because we need to verify the email first
      // Enrollment will be checked AFTER OTP verification in OtpVerificationForm
      if (signupData.provider === "github" && !signupData.email) {
        setCurrentStep("emailInput");
        setSelectedProvider("oauth");
        return;
      }

      // Google or GitHub with public email - check if we can register immediately
      if (
        signupData.provider === "google" ||
        (signupData.provider === "github" && signupData.email)
      ) {
        // If we need credentials, show credentials form
        if (needsUsername || needsPassword) {
          // For OAuth flows that need credentials, also set the email for consistency
          if (signupData.email) {
            setEmailForOtp(signupData.email);
          }
          setCurrentStep("credentials");
          setSelectedProvider("oauth");
          return;
        }

        // If no credentials needed, proceed with direct registration
        await handleDirectRegistration(signupData);
        return;
      }

      // Fallback - should not reach here
      // For fallback OAuth flows, also set the email if available
      if (signupData.email) {
        setEmailForOtp(signupData.email);
      }
      setCurrentStep("credentials");
      setSelectedProvider("oauth");
    } catch (error) {
      toast.error(i18n.t("auth:signupErrors.failedProcessOauth"));
      setUiError({
        type: "oauthError",
        message: i18n.t("auth:signupErrors.couldNotCompleteAuth"),
      });
    }
  };

  const handleDirectRegistration = async (signupData: any) => {
    try {
      // Use unified registration hook for OAuth signups with settings
      await registerUserUnified({
        username: signupData.username || signupData.email?.split("@")[0],
        email: signupData.email,
        full_name: signupData.name, // This should already be the full name from OAuth
        instituteId: instituteId!,
        settings: effectiveSettings, // Pass settings for credential generation
        subject_id: signupData.sub, // OAuth subject ID (e.g., Google sub)
        vendor_id: signupData.provider, // OAuth provider (e.g., "google", "github")
      });

      setCurrentStep("success");

      // Callback will be handled by the success step component
    } catch (error) {
      toast.error(i18n.t("auth:signupErrors.failedCreateAccount"));
      // Fallback to credentials form
      setCurrentStep("credentials");
    }
  };

  const handleOtpVerificationSuccess = async (
    email: string,
    fullName?: string
  ) => {
    // ENROLLMENT CHECK: Check if user is already enrolled after OTP verification
    // This handles: GitHub private email, regular email OTP, and any other email verification flows
    // We check here because we now have a verified email address
    const enrollmentResult = await checkEnrollmentOnce(email);

    if (enrollmentResult?.isEnrolled) {
      const autoLoginResult = await handleEnrolledUser(
        email,
        instituteId!,
        () => {
          // Auto-login success - redirect to success step
          setCurrentStep("success");
          onSignupSuccess?.();
        },
        (error) => {
          // Auto-login failed - show error and go back to providers
          setCurrentStep("providers");
          setSelectedProvider(null);
          setOAuthData(null);
        },
        true // shouldRedirectAfterLogin - will handle navigation automatically
      );

      if (autoLoginResult.success) {
        return; // Auto-login handled everything
      }
    }

    // Check if we need credentials form
    const needsUsername =
      effectiveSettings.usernameStrategy === "manual" ||
      effectiveSettings.usernameStrategy === " ";
    const needsPassword =
      effectiveSettings.passwordStrategy === "manual" ||
      effectiveSettings.passwordStrategy === " ";

    // For OAuth flows, update the OAuth data with verified email
    if (selectedProvider === "oauth" && oauthData) {
      setOAuthData({
        ...oauthData,
        signupData: {
          ...oauthData.signupData,
          email: email,
          name: fullName || oauthData.signupData.name,
        },
      });

      // Also update the fullNameForOtp for OAuth flows
      setFullNameForOtp(oauthData.signupData.name);
    } else {
      // For non-OAuth flows, use the provided fullName
      // When usernameStrategy is "email", use email as full name
      const fullNameToUse =
        effectiveSettings.usernameStrategy === "email" ? email : fullName || "";
      setFullNameForOtp(fullNameToUse);
    }

    if (needsUsername || needsPassword) {
      // For OAuth flows that need credentials after OTP, ensure email is set
      if (selectedProvider === "oauth" && oauthData?.signupData?.email) {
        setEmailForOtp(email);
      }
      setCurrentStep("credentials");
    } else {
      // Direct registration - no credentials needed

      if (selectedProvider === "oauth" && oauthData) {
        // For OAuth flows, use the updated OAuth data - we already have the full name
        await handleDirectRegistration({
          ...oauthData.signupData,
          email: email,
          name: oauthData.signupData.name, // Use the name from OAuth, not the fullName parameter
        });
      } else {
        // For email OTP flows (non-OAuth), we need to ask for full name first
        // When usernameStrategy is "email", use email as full name
        const fullNameToUse =
          effectiveSettings.usernameStrategy === "email" ? email : fullName;

        if (!fullNameToUse) {
          setCurrentStep("credentials");
        } else {
          // We have everything needed for registration
          await registerUserUnified({
            email: email,
            full_name: fullNameToUse,
            instituteId: instituteId!,
            settings: effectiveSettings,
          });
          setCurrentStep("success");
        }
      }
    }
  };

  const renderProviderSelection = () => (
    <div className="space-y-4">
      {/* Header */}
      <SignupStep delay={0.1}>
        <div className="text-center space-y-3">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-gray-900">
              {t("signup.createAccount")}
            </h3>
            <p className="text-sm text-gray-600">
              {t("signup.chooseSignup")}
            </p>
          </div>
        </div>
      </SignupStep>

      {/* OAuth Providers. On native iOS, Sign in with Apple (below) provides the
          Guideline 4.8 parity that previously required hiding Google/GitHub.
          web/Android unaffected. */}
      {(effectiveSettings.providers.google || effectiveSettings.providers.github) && (
      <SignupStep delay={0.2}>
        <div className="space-y-2 mb-6">
          {effectiveSettings.providers.google && (
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => handleProviderSelect("google")}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-md bg-white text-gray-700 font-medium hover:bg-gray-50 hover:border-gray-300 hover:shadow-sm transition-all duration-200 group"
              type="button"
            >
              <FcGoogle className="w-4 h-4" />
              <span className="text-sm">{t("common.continueWithGoogle")}</span>
              <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
            </motion.button>
          )}

          {effectiveSettings.providers.github && (
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => handleProviderSelect("github")}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-md bg-white text-gray-700 font-medium hover:bg-gray-50 hover:border-gray-300 hover:shadow-sm transition-all duration-200 group"
              type="button"
            >
              <GitHubLogoIcon className="w-4 h-4" />
              <span className="text-sm">{t("common.continueWithGitHub")}</span>
              <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
            </motion.button>
          )}

          {/* Sign in with Apple — native iOS only (no Android plugin support).
              Shown whenever a third-party provider is offered, per Apple 4.8. */}
          {isIOSNative() &&
            (effectiveSettings.providers.google ||
              effectiveSettings.providers.github) && (
              <AppleSignInButton
                onClick={() => handleProviderSelect("apple")}
                disabled={isAppleLoading}
              />
            )}
        </div>
      </SignupStep>
      )}

      {/* Divider — only meaningful when there is something above it to
          "continue with" instead of; an email-only institute would otherwise
          open on a stray "or continue with" line. */}
      {effectiveSettings.providers.emailOtp &&
        (effectiveSettings.providers.google ||
          effectiveSettings.providers.github) && (
        <SignupStep delay={0.4}>
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 py-1 text-gray-500 font-medium rounded-full border border-gray-200">
                {t("signup.orContinueWith")}
              </span>
            </div>
          </div>
        </SignupStep>
      )}

      {/* Email OTP Input Field */}
      {effectiveSettings.providers.emailOtp && (
        <SignupStep delay={0.6}>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label
                htmlFor="email"
                className="text-sm font-medium text-gray-700"
              >
                {t("common.emailAddressLabel")}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="email"
                  type="email"
                  placeholder={t("common.enterEmailAddress")}
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-gray-50/50 focus:bg-white hover:bg-white"
                />
                <Button
                  onClick={handleEmailOtpSignup}
                  disabled={!emailInput.trim() || isSendingOtp}
                  className="px-4 bg-gray-900 hover:bg-black text-white font-medium py-3 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                >
                  {isSendingOtp ? t("signup.sending") : t("signup.sendOtp")}
                </Button>
              </div>
            </div>
          </div>
        </SignupStep>
      )}

      {/* Login Link */}
      <SignupStep delay={0.8}>
        <div className="text-center text-xs text-gray-600 p-4">
          <p>
            {t("common.alreadyHaveAccount")}{" "}
            <motion.button
              whileHover={{ scale: 1.02 }}
              onClick={onBackToProviders}
              className="text-gray-800 hover:text-gray-900 font-medium underline cursor-pointer"
            >
              {t("common.signInHere")}
            </motion.button>
          </p>
        </div>
      </SignupStep>

      {/* Security Notice */}
      <SignupStep delay={0.9}>
        <div />
      </SignupStep>

      {/* Terms and Privacy Policy */}
      <SignupStep delay={0.95}>
        <div className="text-center text-xs text-gray-500">
          <p>
            {t("common.iAgreeTo")}{" "}
            <motion.button
              whileHover={{ scale: 1.02 }}
              onClick={async () => {
                try {
                  const storedInstitute =
                    instituteId ||
                    (await Preferences.get({ key: "InstituteId" })).value ||
                    "";
                  if (storedInstitute) {
                    const stored = await Preferences.get({
                      key: `LEARNER_${storedInstitute}`,
                    });
                    if (stored?.value) {
                      const parsed = JSON.parse(stored.value);
                      if (parsed?.termsAndConditionUrl) {
                        window.open(parsed.termsAndConditionUrl, "_blank");
                        return;
                      }
                    }
                  }
                } catch {
                  // ignore and fallback
                }
                window.open("/terms-and-conditions", "_blank");
              }}
              className="text-gray-700 hover:text-gray-900 font-medium underline cursor-pointer"
            >
              {t("common.termsAndConditions")}
            </motion.button>{" "}
            {t("common.and")}{" "}
            <motion.button
              whileHover={{ scale: 1.02 }}
              onClick={async () => {
                try {
                  const storedInstitute =
                    instituteId ||
                    (await Preferences.get({ key: "InstituteId" })).value ||
                    "";
                  if (storedInstitute) {
                    const stored = await Preferences.get({
                      key: `LEARNER_${storedInstitute}`,
                    });
                    if (stored?.value) {
                      const parsed = JSON.parse(stored.value);
                      if (parsed?.privacyPolicyUrl) {
                        window.open(parsed.privacyPolicyUrl, "_blank");
                        return;
                      }
                    }
                  }
                } catch {
                  // ignore and fallback
                }
                window.open("/privacy-policy", "_blank");
              }}
              className="text-gray-700 hover:text-gray-900 font-medium underline cursor-pointer"
            >
              {t("common.privacyPolicy")}
            </motion.button>
          </p>
        </div>
      </SignupStep>
    </div>
  );

  // Always show provider selection step, even if only one provider is enabled
  // This prevents automatic auth process from starting

  return (
    <div className={className}>
      <AnimatePresence mode="wait">
        {uiError && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            {uiError.message}{" "}
            {uiError.type !== "validation" && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                onClick={onBackToProviders}
                className="ms-2 underline font-medium"
              >
                {t("signup.signInInstead")}
              </motion.button>
            )}
          </div>
        )}
        {currentStep === "providers" && renderProviderSelection()}

        {currentStep === "emailInput" && (
          <EmailInputForm
            settings={effectiveSettings}
            initialEmail={
              selectedProvider === "oauth" && oauthData?.signupData?.email
                ? oauthData.signupData.email
                : ""
            }
            initialFullName={
              selectedProvider === "oauth" && oauthData?.signupData?.name
                ? oauthData.signupData.name
                : ""
            }
            onOtpSent={handleEmailInputSuccess}
            onBack={handleBackToProviders}
            isOAuth={selectedProvider === "oauth"}
            hideFullName={
              // GitHub with private email: ask only for email (hide full name) before OTP
              // For OAuth flows, we already have the full name, so we can hide it
              selectedProvider === "oauth" && oauthData?.signupData?.name
            }
            privateEmailMessage={
              selectedProvider === "oauth" &&
              oauthData?.signupData?.provider === "github" &&
              !oauthData?.signupData?.email
                ? t("emailInput.githubPrivateEmail")
                : selectedProvider === "oauth"
                ? t("emailInput.verifyEmailOauthProcess")
                : t("emailInput.verifyEmailProcess")
            }
            instituteId={instituteId}
            onEnrolledUserDetected={() => {
              // User is already enrolled and auto-login was successful
              setCurrentStep("success");
              onSignupSuccess?.();
            }}
            checkEnrollmentOnce={checkEnrollmentOnce}
          />
        )}

        {currentStep === "otpVerification" && (
          <OtpVerificationForm
            email={emailForOtp}
            fullName={fullNameForOtp}
            onOtpVerified={handleOtpVerificationSuccess}
            onBack={handleBackToProviders}
            className=""
            instituteId={instituteId}
            onEnrolledUserDetected={() => {
              // User is already enrolled and auto-login was successful
              setCurrentStep("success");
              onSignupSuccess?.();
            }}
            checkEnrollmentOnce={checkEnrollmentOnce}
            settings={effectiveSettings}
          />
        )}

        {currentStep === "credentials" && (
          <>
            <CredentialsForm
              settings={effectiveSettings}
              initialData={{
                fullName:
                  (selectedProvider === "oauth" &&
                    oauthData?.signupData?.name) ||
                  fullNameForOtp ||
                  "",
                ...(effectiveSettings.usernameStrategy === "manual" ||
                effectiveSettings.usernameStrategy === " "
                  ? {
                      username:
                        selectedProvider === "oauth" &&
                        oauthData?.signupData?.email
                          ? oauthData.signupData.email
                          : "",
                    }
                  : {}),
              }}
              onSubmit={async (data) => {
                try {
                  // Determine the correct email source
                  const email =
                    selectedProvider === "oauth" && oauthData?.signupData?.email
                      ? oauthData.signupData.email
                      : emailForOtp;

                  // Use unified registration hook with settings
                  await registerUserUnified({
                    username: data.username,
                    email: email,
                    full_name: data.fullName || fullNameForOtp,
                    password: data.password,
                    instituteId: instituteId!,
                    settings: effectiveSettings, // Pass settings for credential generation
                    // Include OAuth fields if this is an OAuth flow
                    ...(selectedProvider === "oauth" &&
                      oauthData?.signupData && {
                        subject_id: oauthData.signupData.sub, // OAuth subject ID
                        vendor_id: oauthData.signupData.provider, // OAuth provider
                      }),
                  });

                  // Move to success step
                  setCurrentStep("success");
                  // Callback will be handled by the success step component
                } catch (error) {
                  toast.error(i18n.t("auth:signupErrors.failedCreateAccount"));
                }
              }}
              onBack={handleBackToProviders}
              isOAuth={selectedProvider === "oauth"}
              oauthProvider={
                selectedProvider === "oauth" && oauthData?.signupData?.provider
                  ? oauthData.signupData.provider
                  : ""
              }
              hideFullName={
                // For OAuth flows: hide full name if:
                // 1. We have OAuth name AND no manual credentials are needed, OR
                // 2. usernameStrategy is "email" (hide field but still use OAuth name)
                // For Email OTP: never hide full name (always ask for it after OTP verification)
                selectedProvider === "oauth" &&
                oauthData?.signupData?.name &&
                ((!(
                  effectiveSettings.usernameStrategy === "manual" ||
                  effectiveSettings.usernameStrategy === " "
                ) &&
                  !(
                    effectiveSettings.passwordStrategy === "manual" ||
                    effectiveSettings.passwordStrategy === " "
                  )) ||
                  effectiveSettings.usernameStrategy === "email")
              }
            />
          </>
        )}

        {currentStep === "success" && (
          <div className="text-center p-8">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
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
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {t("signup.accountCreatedTitle")}
            </h3>
            <p className="text-gray-600">
              {t("signup.redirecting")}
            </p>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}