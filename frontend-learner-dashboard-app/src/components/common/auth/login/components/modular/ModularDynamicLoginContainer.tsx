import { motion } from "framer-motion";
import { FcGoogle } from "react-icons/fc"; // design-lint-ignore: Google brand logo
import { ArrowRight } from "@phosphor-icons/react";
import { isIOSNative, shouldHideThirdPartyLogin } from "@/utils/ios-iap-compliance";
import { LOGIN_URL_GOOGLE_GITHUB } from "@/constants/urls";
import {
  loginWithAppleNative,
  AppleSessionLimitError,
  AppleSignInCancelledError,
} from "@/lib/auth/appleNativeAuth";
import { AppleSignInButton } from "@/components/common/auth/AppleSignInButton";
import { resolveFontStack } from "@/utils/branding";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { Preferences } from "@capacitor/preferences";
import { useTheme } from "@/providers/theme/theme-provider";
import { ModalEmailLogin } from "../../forms/modal/ModalEmailOtpForm";
import { ModalUsernameLogin } from "../../forms/modal/ModalUsernamePasswordForm";
import { LoginSettings } from "@/config/login/defaultLoginSettings";
import { SignupSettings } from "@/config/signup/defaultSignupSettings";
import { TokenKey } from "@/constants/auth/tokens";
import { setTokenInStorage, getTokenDecodedData } from "@/lib/auth/sessionUtility";
import { fetchAndStoreInstituteDetails } from "@/services/fetchAndStoreInstituteDetails";
import { fetchAndStoreStudentDetails } from "@/services/studentDetails";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import ClipLoader from "react-spinners/ClipLoader";
import {
  getOAuthRedirectOrigin,
  isNativeOAuthRequired,
  openOAuthInSystemBrowser,
} from "@/lib/auth/nativeOAuth";

interface ModularDynamicLoginContainerProps {
  instituteId?: string;
  settings?: LoginSettings | null;
  signupSettings?: SignupSettings | null;
  type?: string;
  courseId?: string;
  onSwitchToSignup?: (email?: string, shouldAutoSendOtp?: boolean) => void;
  onSwitchToForgotPassword?: () => void;
  onLoginSuccess?: () => void;
  className?: string;
  /** "Don't have an account? Sign up here" under the form. Off unless the caller offers signup. */
  showSignupLink?: boolean;
}

export function ModularDynamicLoginContainer({
  instituteId,
  settings,
  signupSettings,
  type,
  courseId,
  onSwitchToSignup,
  onSwitchToForgotPassword,
  onLoginSuccess,
  className = "",
  showSignupLink = false
}: ModularDynamicLoginContainerProps) {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const { setPrimaryColor } = useTheme();
  
  // Use backend settings if available, otherwise fall back to defaults
  const effectiveSettings = settings || {
    providers: {
      google: true,
      github: true,
      emailOtp: true,
      usernamePassword: true,
      defaultProvider: "usernamePassword" as const,
    },
    usernameStrategy: "email" as const,
    passwordStrategy: "manual" as const,
    passwordDelivery: "none" as const,
  };

  // Apple 4.8 — see shouldHideThirdPartyLogin(). Strip Google/GitHub on Mac App
  // Store builds before anything reads them; note the fallback above defaults
  // both to TRUE, which is exactly what a reviewer's fresh install hits.
  if (shouldHideThirdPartyLogin()) {
    effectiveSettings.providers.google = false;
    effectiveSettings.providers.github = false;
  }

  // Get enabled providers
  const enabledProviders = Object.entries(effectiveSettings.providers)
    .filter(([key, value]) => key !== "defaultProvider" && value === true)
    .map(([key]) => key);

  // Form providers are only emailOtp and usernamePassword
  const formEnabledProviders = ["emailOtp", "usernamePassword"].filter((p) => {
    const flags = effectiveSettings.providers as unknown as Record<string, boolean>;
    return Boolean(flags[p]);
  });

  // Check if signup is available
  const isSignupAvailable = !!(signupSettings && 
    Object.entries(signupSettings.providers)
      .filter(([key, value]) => key !== "defaultProvider" && value === true)
      .length > 0);

  // Determine initial provider based on defaultProvider (only form providers)
  const defaultProvider = effectiveSettings.providers.defaultProvider;
  
  // State to track current provider being shown
  const [currentProvider, setCurrentProvider] = useState<string>(() => {
    // Prefer defaultProvider only if it's a form provider and enabled
    const isFormDefault = (defaultProvider === "emailOtp" || defaultProvider === "usernamePassword")
      && formEnabledProviders.includes(defaultProvider);
    const initial = isFormDefault
      ? defaultProvider
      : (formEnabledProviders[0] || "usernamePassword");
    try { console.info("[ModularDynamicLoginContainer] init currentProvider=", initial, { defaultProvider, enabledProviders, formEnabledProviders }); } catch (err) { void err; }
    return initial;
  });

  // State to track OAuth processing (after popup closes, before redirect)
  const [isOAuthProcessing, setIsOAuthProcessing] = useState(false);
  const [isAppleLoading, setIsAppleLoading] = useState(false);
  // When we open OAuth popup, set this so we only accept results written after open (avoids stale data)
  const oauthPopupOpenedAtRef = useRef<number>(0);

  // Always show at least one provider, even if only one is enabled
  // (selection UI currently always shown via enabled providers list)

  // Update current provider only if current provider is disabled among form providers
  useEffect(() => {
    if (!formEnabledProviders.includes(currentProvider) && formEnabledProviders.length > 0) {
      const canUseDefault = (defaultProvider === "emailOtp" || defaultProvider === "usernamePassword")
        && formEnabledProviders.includes(defaultProvider);
      const next = canUseDefault ? defaultProvider : formEnabledProviders[0];
      try { console.info("[ModularDynamicLoginContainer] adjusting currentProvider=", next); } catch (err) { void err; }
      setCurrentProvider(next);
    }
  }, [formEnabledProviders, currentProvider, defaultProvider]);

  useEffect(() => {
    // Helper to finalize login after receiving tokens
    const finalizeLoginWithTokens = async (accessToken: string, refreshToken: string) => {
      try {
        console.log('[ModularDynamicLoginContainer] 🎯 Finalizing login with tokens from popup');
        
        // Show loading state immediately
        setIsOAuthProcessing(true);
        
        await setTokenInStorage(TokenKey.accessToken, accessToken);
        await setTokenInStorage(TokenKey.refreshToken, refreshToken);

        // Decode token to get user and institute information
        const decodedData = getTokenDecodedData(accessToken);
        const authorities = decodedData?.authorities;
        const userId = decodedData?.user;
        const authorityKeys = authorities ? Object.keys(authorities) : [];

        console.log('[ModularDynamicLoginContainer] 📋 Decoded token:', { userId, authorityKeys });

        // Multiple institutes: redirect to institute-selection so user can choose (tokens already stored above)
        if (userId && authorityKeys.length > 1) {
          console.log('[ModularDynamicLoginContainer] 🏫 Multiple institutes, redirecting to institute selection');
          if (onLoginSuccess) onLoginSuccess();
          setTimeout(() => {
            window.location.href = '/institute-selection';
          }, 100);
          return;
        }

        if (userId && authorities && authorityKeys.length > 0) {
          // Single institute: use first (or from sessionStorage)
          let instituteId = authorityKeys[0];
          try {
            const stored = sessionStorage.getItem('modal_oauth_data');
            if (stored) {
              const parsed = JSON.parse(stored);
              if (parsed?.instituteId && authorityKeys.includes(parsed.instituteId)) {
                instituteId = parsed.instituteId;
              }
            }
          } catch (e) { void e; }

          console.log('[ModularDynamicLoginContainer] 🏫 Fetching details for institute:', instituteId);
          const details = await fetchAndStoreInstituteDetails(instituteId, userId);
          if (setPrimaryColor) {
            setPrimaryColor(details?.institute_theme_code ?? import.meta.env.VITE_DEFAULT_THEME_COLOR ?? "#E67E22"); // design-lint-ignore: default brand color fallback
          }
          await fetchAndStoreStudentDetails(instituteId, userId);
          console.log('[ModularDynamicLoginContainer] ✅ Institute and student details fetched successfully');
          try {
            await getStudentDisplaySettings(true);
          } catch (e) {
            console.warn('[ModularDynamicLoginContainer] ⚠️ Failed to load student display settings:', e);
          }
        }

        // Determine redirect target from sessionStorage (set when opening OAuth)
        let redirectTo: string | undefined;
        try {
          const stored = sessionStorage.getItem('modal_oauth_data');
          if (stored) {
            const parsed = JSON.parse(stored);
            redirectTo = parsed?.redirectTo;
          }
        } catch (e) { void e; }

        console.log('[ModularDynamicLoginContainer] 🚀 Redirecting to:', redirectTo || '/dashboard');
        if (onLoginSuccess) onLoginSuccess();
        setTimeout(() => {
          const target = redirectTo && typeof redirectTo === 'string' ? redirectTo : '/dashboard';
          if (/^https?:\/\//.test(target)) {
            window.location.assign(target);
          } else {
            window.location.href = target;
          }
        }, 100);
      } catch (error) {
        console.error('[ModularDynamicLoginContainer] ❌ Error finalizing login:', error);
        setIsOAuthProcessing(false);
        toast.error(i18n.t("auth:toasts.failedCompleteLogin"));
      }
    };

    // Ensure we only process once
    let processed = false;

    // When OAuth fails (e.g. GitHub private email / invalid response), show signup with "your email is private" flow
    const handleOAuthErrorFromPopup = (data?: { message?: string }) => {
      if (onSwitchToSignup) {
        try {
          sessionStorage.setItem(
            'oauth_signup_data',
            JSON.stringify({ signupData: { provider: 'github', email: null, name: null } })
          );
        } catch (e) {
          console.error('[OAuth Parent] Failed to store signup data:', e);
        }
        onSwitchToSignup('', false);
        toast.info(i18n.t("auth:toasts.emailPrivateInfo"));
      } else {
        toast.error(
          data?.message || i18n.t("auth:toasts.couldNotCompleteSignIn")
        );
      }
    };

    // Listen for OAuth completion messages from popup
    const messageHandler = async (event: MessageEvent) => {
      const data = event.data;

      // DEBUG: Log all received messages for debugging
      console.log('[OAuth Parent][DEBUG] Received message:', {
        origin: event.origin,
        data: data,
        source: event.source
      });

      // Legacy/custom path: action-based message
      if (data && data.action === 'oauth_complete') {
        if (data.success) {
          const { redirectTo } = data;
          if (!processed) {
            processed = true;
            if (onLoginSuccess) onLoginSuccess();
            setTimeout(() => {
              const target = redirectTo && typeof redirectTo === 'string' ? redirectTo : '/dashboard';
              if (/^https?:\/\//.test(target)) {
                window.location.assign(target);
              } else {
                window.location.href = target;
              }
            }, 100);
          }
        } else if (data.needsSignup && data.signupData) {
          // User doesn't exist but we have OAuth data - switch to signup
          console.log('[OAuth Parent] User needs signup, switching to signup flow with OAuth data');
          if (onSwitchToSignup) {
            // Pass the OAuth data to signup (will be handled by the parent component)
            onSwitchToSignup(data.signupData?.signupData?.email || '', false);
            // Store OAuth data for signup to consume
            try {
              sessionStorage.setItem('oauth_signup_data', JSON.stringify(data.signupData));
            } catch (e) {
              console.error('[OAuth Parent] Failed to store signup data:', e);
            }
          } else {
            toast.info(i18n.t("auth:toasts.pleaseSignUpToContinue"));
          }
        } else if (data.error) {
          toast.error(data.error || i18n.t("auth:toasts.oauthLoginFailed"), {
            duration: 5000,
            description: i18n.t("auth:toasts.checkConnection")
          });
        }
        return;
      }

      // Standard path used by oauth-popup-handler.html
      if (data && data.type === 'oauth_success' && data.data) {
        const payload = data.data;
        if (!processed && payload?.accessToken && payload?.refreshToken) {
          processed = true;
          await finalizeLoginWithTokens(payload.accessToken, payload.refreshToken);
        }
      } else if (data && data.type === 'oauth_signup_needed' && data.data) {
        // User doesn't exist but we have OAuth data - switch to signup
        console.log('[OAuth Parent] User needs signup (standard path), switching to signup flow');
        if (onSwitchToSignup) {
          onSwitchToSignup(data.data?.signupData?.email || '', false);
          try {
            sessionStorage.setItem('oauth_signup_data', JSON.stringify(data.data));
          } catch (e) {
            console.error('[OAuth Parent] Failed to store signup data:', e);
          }
        } else {
          toast.info(i18n.t("auth:toasts.pleaseSignUpToContinue"));
        }
      } else if (data && data.type === 'oauth_error') {
        handleOAuthErrorFromPopup(data?.data);
      }
    };

    // Fallback: storage event when COOP blocks postMessage
    const storageHandler = async (e: StorageEvent) => {
      console.log('[OAuth Parent][DEBUG] Storage event received:', {
        key: e.key,
        newValue: e.newValue,
        oldValue: e.oldValue,
        url: e.url
      });

      if (!e) return;
      if (e.key === 'OAUTH_RESULT' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          const openedAt = oauthPopupOpenedAtRef.current;
          const isAfterOpen = !openedAt || (parsed?.ts && parsed.ts >= openedAt - 2000);
          if (isAfterOpen && parsed?.isModalLogin !== false && parsed?.type === 'oauth_success' && parsed?.data) {
            const { accessToken, refreshToken } = parsed.data || {};
            if (!processed && accessToken && refreshToken) {
              processed = true;
              await finalizeLoginWithTokens(accessToken, refreshToken);
              localStorage.removeItem('OAUTH_RESULT');
            }
          } else if (parsed?.isModalLogin !== false && parsed?.type === 'oauth_signup_needed' && parsed?.data) {
            console.log('[OAuth Parent] User needs signup (storage), switching to signup flow');
            if (onSwitchToSignup) {
              onSwitchToSignup(parsed.data?.signupData?.email || '', false);
              try {
                sessionStorage.setItem('oauth_signup_data', JSON.stringify(parsed.data));
              } catch (e) {
                console.error('[OAuth Parent] Failed to store signup data:', e);
              }
            } else {
              toast.info(i18n.t("auth:toasts.pleaseSignUpToContinue"));
            }
            localStorage.removeItem('OAUTH_RESULT');
          } else if (parsed?.isModalLogin !== false && parsed?.type === 'oauth_error') {
            handleOAuthErrorFromPopup(parsed?.data);
            localStorage.removeItem('OAUTH_RESULT');
          }
          // Don't remove localStorage if it's a page-level login - let __root.tsx handle it
        } catch (err) { void err; }
      }
    };

    // Fallback: BroadcastChannel
    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('OAUTH_CHANNEL');
        bc.onmessage = async (ev: MessageEvent) => {
          const msg = ev?.data;
          if (!msg || typeof msg !== 'object') return;
          // Only process if this was a modal login
          if (msg.isModalLogin !== false && msg.type === 'oauth_success' && msg.data) {
            const { accessToken, refreshToken } = msg.data || {};
            if (!processed && accessToken && refreshToken) {
              processed = true;
              await finalizeLoginWithTokens(accessToken, refreshToken);
            }
          } else if (msg.isModalLogin !== false && msg.type === 'oauth_signup_needed' && msg.data) {
            console.log('[OAuth Parent] User needs signup (broadcast), switching to signup flow');
            if (onSwitchToSignup) {
              onSwitchToSignup(msg.data?.signupData?.email || '', false);
              try {
                sessionStorage.setItem('oauth_signup_data', JSON.stringify(msg.data));
              } catch (e) {
                console.error('[OAuth Parent] Failed to store signup data:', e);
              }
            } else {
              toast.info(i18n.t("auth:toasts.pleaseSignUpToContinue"));
            }
          } else if (msg.isModalLogin !== false && msg.type === 'oauth_error') {
            handleOAuthErrorFromPopup(msg?.data);
          }
        };
      }
    } catch (err) { void err; }

    // Immediate localStorage check in case write happened before listener attached
    const checkLocalOnce = () => {
      try {
        const existing = localStorage.getItem('OAUTH_RESULT');
        if (existing) {
          const parsed = JSON.parse(existing);
          // Only process if this was a modal login (not a page-level login)
          if (parsed?.isModalLogin !== false && parsed?.type === 'oauth_success' && parsed?.data) {
            const { accessToken, refreshToken } = parsed.data || {};
            if (!processed && accessToken && refreshToken) {
              processed = true;
              finalizeLoginWithTokens(accessToken, refreshToken);
              // Clean up after processing modal login
              localStorage.removeItem('OAUTH_RESULT');
            }
          } else if (parsed?.isModalLogin !== false && parsed?.type === 'oauth_signup_needed' && parsed?.data) {
            console.log('[OAuth Parent] User needs signup (checkLocal), switching to signup flow');
            if (onSwitchToSignup) {
              onSwitchToSignup(parsed.data?.signupData?.email || '', false);
              try {
                sessionStorage.setItem('oauth_signup_data', JSON.stringify(parsed.data));
              } catch (e) {
                console.error('[OAuth Parent] Failed to store signup data:', e);
              }
            } else {
              toast.info(i18n.t("auth:toasts.pleaseSignUpToContinue"));
            }
            localStorage.removeItem('OAUTH_RESULT');
          } else if (parsed?.isModalLogin !== false && parsed?.type === 'oauth_error') {
            handleOAuthErrorFromPopup(parsed?.data);
            localStorage.removeItem('OAUTH_RESULT');
          }
          // Don't remove localStorage if it's a page-level login - let __root.tsx handle it
        }
      } catch (err) { void err; }
    };
    checkLocalOnce();

    // Polling fallback: storage event can be unreliable with COOP/popups, so poll for 90s
    const pollUntil = Date.now() + 90_000;
    const pollTimer = window.setInterval(() => {
      if (processed || Date.now() > pollUntil) {
        window.clearInterval(pollTimer);
        return;
      }
      checkLocalOnce();
    }, 350);

    window.addEventListener('message', messageHandler);
    window.addEventListener('storage', storageHandler);

    return () => {
      window.removeEventListener('message', messageHandler);
      window.removeEventListener('storage', storageHandler);
      try { window.clearInterval(pollTimer); } catch (err) { void err; }
      try { if (bc) bc.close(); } catch (err) { void err; }
    };
  }, [onLoginSuccess]);

  const handleOAuthLogin = async (provider: "google" | "github" | "apple") => {
    // Native iOS "Sign in with Apple" uses the native sheet (no popup / redirect)
    // and completes the auth cycle itself.
    if (provider === "apple" && isIOSNative()) {
      try {
        setIsAppleLoading(true);
        const urlInstituteId =
          new URLSearchParams(window.location.search).get("instituteId") ||
          instituteId;
        await loginWithAppleNative({ instituteId: urlInstituteId });
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
      return;
    }

    try {
      // Get current page information for redirection after login
      const currentPath = window.location.pathname;
      const currentSearch = window.location.search;
      
      // Clean the current URL to remove sensitive data like instituteId
      const cleanCurrentUrl = cleanUrlOfSensitiveData(`${currentPath}${currentSearch}`);
      
      // Extract instituteId from current URL (but don't expose it in redirect URLs)
      const urlParams = new URLSearchParams(currentSearch);
      const instituteIdFromUrl = urlParams.get("instituteId") || instituteId;
      
      // Determine the appropriate study-library URL based on current page and type
      let studyLibraryUrl = "/study-library/courses";
      
      if (type === "courseDetailsPage" && courseId) {
        studyLibraryUrl = `/study-library/courses/course-details?courseId=${courseId}&selectedTab=ALL`;
      } else if (currentPath.includes("/courses/course-details")) {
        // Extract courseId from current URL
        const courseIdFromUrl = urlParams.get("courseId");
        if (courseIdFromUrl) {
          studyLibraryUrl = `/study-library/courses/course-details?courseId=${courseIdFromUrl}&selectedTab=ALL`;
        }
      } else if (currentPath.includes("/courses")) {
        // For courses page, redirect to study-library courses
        studyLibraryUrl = "/study-library/courses";
      }
      
      // Store additional data in sessionStorage to reduce state size
      const modalOAuthData = {
        redirectTo: studyLibraryUrl,
        currentUrl: cleanCurrentUrl, // Use cleaned URL without sensitive data
        type: type,
        courseId: courseId,
        instituteId: instituteIdFromUrl, // Keep instituteId for backend processing but don't expose in URLs
      };
      
      // Store in sessionStorage
      sessionStorage.setItem('modal_oauth_data', JSON.stringify(modalOAuthData));

      // Clear any stale OAuth result and mark that we're waiting for this popup (so we accept only fresh results)
      try {
        localStorage.removeItem('OAUTH_RESULT');
        oauthPopupOpenedAtRef.current = Date.now();
      } catch { /* ignore */ }

      // Resolve the public-facing origin for OAuth redirect
      // On native (Android/iOS) window.location.origin is localhost, so we use the public URL
      const redirectOrigin = await getOAuthRedirectOrigin();

      // Create minimal state object
      const stateObj: Record<string, unknown> = {
        account_type: "login",
        user_type: "learner",
      };

      // Include institute_id if available (from URL or props)
      if (instituteIdFromUrl) {
        stateObj.institute_id = instituteIdFromUrl;
      }

      if (isNativeOAuthRequired()) {
        // Native: redirect back to the public learner route (deep link will catch it)
        stateObj.from = `${redirectOrigin}/login/oauth/learner`;
      } else {
        // Web: redirect back to the static popup handler
        stateObj.from = `${redirectOrigin}/oauth-popup-handler.html?popup=1`;
      }

      const stateJson = JSON.stringify(stateObj);
      const base64State = btoa(stateJson);
      const encodedState = encodeURIComponent(base64State);
      const loginUrl = `${LOGIN_URL_GOOGLE_GITHUB}/${provider}?state=${encodedState}`;

      if (isNativeOAuthRequired()) {
        // Native: open in system browser via Capacitor Browser plugin
        await openOAuthInSystemBrowser(loginUrl);
      } else {
        // Web: open OAuth in popup window
        const popup = window.open(
          loginUrl,
          'oauth_popup',
          'width=500,height=600,scrollbars=yes,resizable=yes'
        );

      if (!popup) {
        console.error('[OAuth] Popup blocked');
        toast.error(i18n.t("auth:toasts.popupBlocked"));
        return;
      }

      // Focus the popup
      popup.focus();
     }
    } catch {
      toast.error(i18n.t("auth:toasts.failedInitiateLogin"));
    }
  };

  // Helper function to clean URLs of sensitive data
  const cleanUrlOfSensitiveData = (url: string): string => {
    try {
      const urlObj = new URL(url, window.location.origin);
      
      // Remove sensitive parameters
      urlObj.searchParams.delete("instituteId");
      urlObj.searchParams.delete("accessToken");
      urlObj.searchParams.delete("refreshToken");
      urlObj.searchParams.delete("state");
      
      // Keep only safe parameters
      const safeParams = new URLSearchParams();
      for (const [key, value] of urlObj.searchParams.entries()) {
        if (key === "type" || key === "courseId" || key === "fromOAuth") {
          safeParams.set(key, value);
        }
      }
      
      // Reconstruct URL with only safe parameters
      const cleanUrl = `${urlObj.pathname}${safeParams.toString() ? '?' + safeParams.toString() : ''}`;
      return cleanUrl;
    } catch (error) {
      console.error("Error cleaning URL:", error);
      // Return original URL if cleaning fails
      return url;
    }
  };

  // Apply institute theme and font (pre-login) from Preferences
  useEffect(() => {
    (async () => {
      try {
        const storedInstitute = instituteId || (await Preferences.get({ key: "InstituteId" })).value || "";
        if (!storedInstitute) return;
        const stored = await Preferences.get({ key: `LEARNER_${storedInstitute}` });
        if (!stored?.value) return;
        const parsed = JSON.parse(stored.value);
        if (parsed?.theme) {
          setPrimaryColor(parsed.theme);
        }
        if (parsed?.fontFamily) {
          const family = resolveFontStack(parsed.fontFamily);
          document.documentElement.style.setProperty("--app-font-family", family);
          document.body.style.fontFamily = family;
        }
      } catch {
        // Ignore
      }
    })();
  }, [instituteId, setPrimaryColor]);

  // Open Terms/Privacy using institute-specific URLs if available, else fallback
  const openTerms = async () => {
    try {
      const storedInstitute = instituteId || (await Preferences.get({ key: "InstituteId" })).value || "";
      if (storedInstitute) {
        const stored = await Preferences.get({ key: `LEARNER_${storedInstitute}` });
        if (stored?.value) {
          const parsed = JSON.parse(stored.value);
          if (parsed?.termsAndConditionUrl) {
            window.open(parsed.termsAndConditionUrl, "_blank");
            return;
          }
        }
      }
    } catch (err) { void err; }
    navigate({ to: "/terms-and-conditions" });
  };

  const openPrivacy = async () => {
    try {
      const storedInstitute = instituteId || (await Preferences.get({ key: "InstituteId" })).value || "";
      if (storedInstitute) {
        const stored = await Preferences.get({ key: `LEARNER_${storedInstitute}` });
        if (stored?.value) {
          const parsed = JSON.parse(stored.value);
          if (parsed?.privacyPolicyUrl) {
            window.open(parsed.privacyPolicyUrl, "_blank");
            return;
          }
        }
      }
    } catch (err) { void err; }
    navigate({ to: "/privacy-policy" });
  };

  // Show loading overlay when processing OAuth
  if (isOAuthProcessing) {
    return (
      <div className={`${className}`}>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="min-h-96 flex items-center justify-center py-12 px-6"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="text-center space-y-4"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: "linear",
              }}
              className="inline-block"
            >
              <ClipLoader size={36} color="hsl(var(--muted-foreground))" />
            </motion.div>
            <div className="space-y-2">
              <h3 className="text-base font-medium text-gray-900">
                {t("sso.signingYouIn")}
              </h3>
              <p className="text-sm text-gray-500">
                {t("sso.pleaseWait")}
              </p>
            </div>
          </motion.div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="text-center space-y-3"
      >
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-gray-900">
            {t("common.welcome")}
          </h3>
          <p className="text-sm text-gray-600">
            {t("common.signInToContinue")}
          </p>
        </div>
      </motion.div>

      {/* OAuth Providers. On native iOS, Sign in with Apple (below) provides the
          Guideline 4.8 parity that previously required hiding Google/GitHub.
          web / Android / Electron unaffected. */}
      {(effectiveSettings.providers.google || effectiveSettings.providers.github) && (
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="space-y-2"
        >
          {effectiveSettings.providers.google && (
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-md bg-white text-gray-700 font-medium hover:bg-gray-50 hover:border-gray-300 hover:shadow-sm transition-all duration-200 group"
              onClick={() => handleOAuthLogin("google")}
              type="button"
            >
              <FcGoogle className="w-4 h-4" />
              <span className="text-sm">
                {t("common.continueWithGoogle")}
              </span>
              <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
            </motion.button>
          )}
          
          {effectiveSettings.providers.github && (
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-md bg-white text-gray-700 font-medium hover:bg-gray-50 hover:border-gray-300 hover:shadow-sm transition-all duration-200 group"
              onClick={() => handleOAuthLogin("github")}
              type="button"
            >
              <GitHubLogoIcon className="w-4 h-4" />
              <span className="text-sm">
                {t("common.continueWithGitHub")}
              </span>
              <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
            </motion.button>
          )}

          {/* Sign in with Apple — native iOS only (no Android plugin support).
              Shown whenever a third-party provider is offered, per Apple 4.8. */}
          {isIOSNative() &&
            (effectiveSettings.providers.google ||
              effectiveSettings.providers.github) && (
              <AppleSignInButton
                onClick={() => handleOAuthLogin("apple")}
                disabled={isAppleLoading}
              />
            )}
        </motion.div>
      )}

      {/* Spacing between OAuth and forms */}
      {(effectiveSettings.providers.emailOtp || effectiveSettings.providers.usernamePassword) && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.3 }}
          className="my-4"
        />
      )}

      {/* Login Forms - Show if enabled */}
      {(effectiveSettings.providers.emailOtp || effectiveSettings.providers.usernamePassword) && (
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          <motion.div
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.8 }}
          >
            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 1.1 }}
            >
              {currentProvider === "emailOtp" && effectiveSettings.providers.emailOtp ? (
                <ModalEmailLogin
                  onSwitchToUsername={() => setCurrentProvider("usernamePassword")}
                  type={type}
                  courseId={courseId}
                  onSwitchToSignup={onSwitchToSignup}
                  onLoginSuccess={onLoginSuccess}
                  showUsernameSwitch={false} // Disable built-in switching since we handle it in container
                  signupAvailable={isSignupAvailable}
                  instituteId={instituteId}
                />
              ) : currentProvider === "usernamePassword" && effectiveSettings.providers.usernamePassword ? (
                <ModalUsernameLogin
                  onSwitchToEmail={() => setCurrentProvider("emailOtp")}
                  type={type}
                  courseId={courseId}
                  onSwitchToSignup={onSwitchToSignup}
                  onSwitchToForgotPassword={onSwitchToForgotPassword}
                  onLoginSuccess={onLoginSuccess}
                  showEmailSwitch={false} // Disable built-in switching since we handle it in container
                  signupAvailable={isSignupAvailable}
                />
              ) : null}



              {/* Provider Switching Links - Only show if both username and email OTP are enabled */}
              {effectiveSettings.providers.emailOtp && effectiveSettings.providers.usernamePassword && (
                <motion.div
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 1.15 }}
                  className="text-center pt-3"
                >
                  {currentProvider === "emailOtp" ? (
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      className="text-sm text-gray-500 hover:text-gray-700 transition-colors duration-200 relative group font-medium"
                      onClick={() => setCurrentProvider("usernamePassword")}
                    >
                      {t("login.preferUsernameLogin")}
                      <span className="absolute -bottom-1 start-0 w-0 h-0.5 bg-gray-700 transition-all duration-200 group-hover:w-full"></span>
                    </motion.button>
                  ) : (
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      className="text-sm text-gray-500 hover:text-gray-700 transition-colors duration-200 relative group font-medium"
                      onClick={() => setCurrentProvider("emailOtp")}
                    >
                      {t("login.preferEmailLogin")}
                      <span className="absolute -bottom-1 start-0 w-0 h-0.5 bg-gray-700 transition-all duration-200 group-hover:w-full"></span>
                    </motion.button>
                  )}
                </motion.div>
              )}
            </motion.div>
          </motion.div>
        </motion.div>
      )}

      {/* Security Notice */}
      {/* Security message removed as requested */}
      {/* <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1.3 }}
        className="mt-4 p-3 bg-gray-50/80 border border-gray-200/60 rounded-lg"
      >
        <div className="flex items-start space-x-2">
          <Shield className="w-4 h-4 text-gray-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-medium text-gray-800 mb-1">
              Secure Login
            </p>
            <p className="text-xs text-gray-600">
              Your data is protected with enterprise-grade encryption.
            </p>
          </div>
        </div>
      </motion.div> */}

      {/* Sign up link, the mirror of the signup screen's "Sign in here" */}
      {showSignupLink && onSwitchToSignup && (
        <div className="text-center text-xs text-gray-600 p-4">
          <p>
            {t("common.dontHaveAccount")}{" "}
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              onClick={() => onSwitchToSignup()}
              className="text-gray-800 hover:text-gray-900 font-medium underline cursor-pointer"
            >
              {t("common.signUpHere")}
            </motion.button>
          </p>
        </div>
      )}

      {/* Footer Links */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1.5 }}
        className="text-center text-xs text-gray-600"
      >
        <p>
          {t("common.iAgreeTo")}{" "}
          <motion.button
            whileHover={{ scale: 1.02 }}
            onClick={openTerms}
            className="text-gray-800 hover:text-gray-900 font-medium underline cursor-pointer"
          >
            {t("common.termsAndConditions")}
          </motion.button>{" "}
          {t("common.and")}{" "}
          <motion.button
            whileHover={{ scale: 1.02 }}
            onClick={openPrivacy}
            className="text-gray-800 hover:text-gray-900 font-medium underline cursor-pointer"
          >
            {t("common.privacyPolicy")}
          </motion.button>
        </p>
      </motion.div>
    </div>
  );
}