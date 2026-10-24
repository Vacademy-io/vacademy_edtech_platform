import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { isIOSNative, shouldHideThirdPartyLogin } from "@/utils/ios-iap-compliance";
import { TokenKey } from "@/constants/auth/tokens";
import { useNavigate } from "@tanstack/react-router";
import { isNullOrEmptyOrUndefined } from "@/lib/utils";
import {
  getTokenDecodedData,
  getTokenFromStorage,
  setTokenInStorage,
} from "@/lib/auth/sessionUtility";
import { EmailLogin } from "./EmailOtpForm";
import { UsernameLogin } from "./UsernamePasswordForm";
import { PhoneLoginForm } from "./PhoneLoginForm";
import { Preferences } from "@capacitor/preferences";
import { resolveFontStack } from "@/utils/branding";
import { FcGoogle } from "react-icons/fc"; // design-lint-ignore: brand logo, no phosphor equivalent
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import {
  HOLISTIC_INSTITUTE_ID,
  LOGIN_URL_GOOGLE_GITHUB,
} from "@/constants/urls";
import { toast } from "sonner";
import { useTheme } from "@/providers/theme/theme-provider";
import { fetchAndStoreInstituteDetails } from "@/services/fetchAndStoreInstituteDetails";
import { fetchAndStoreStudentDetails } from "@/services/studentDetails";
import { hydrateParentSession } from "@/lib/auth/detect-user-role";
import {
  pickOtpLoginMethod,
  readOtpLoginHandoff,
  stripOtpLoginHandoff,
} from "@/lib/auth/otp-login-handoff";
import ClipLoader from "react-spinners/ClipLoader";
import { motion, AnimatePresence } from "framer-motion";
import { useInstituteFeatureStore } from "@/stores/insititute-feature-store";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { useSignupAvailability } from "@/hooks/use-signup-availability";
import { usePublicDoubtConfig } from "@/services/public-doubt-config";
import { GuestQueryDialog } from "@/components/common/queries/GuestQueryDialog";
import { AuthPageBranding } from "@/components/common/institute-branding";
import { LanguageDropdown } from "@/components/common/localization/language-dropdown";
import { identifyUser } from "@/lib/analytics";
import { useEffect as useEffectTheme } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  getOAuthRedirectOrigin,
  isNativeOAuthRequired,
  openOAuthInSystemBrowser,
} from "@/lib/auth/nativeOAuth";
import {
  loginWithAppleNative,
  AppleSessionLimitError,
  AppleSignInCancelledError,
} from "@/lib/auth/appleNativeAuth";
import { AppleSignInButton } from "@/components/common/auth/AppleSignInButton";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import {
  ContentTerms,
  RoleTerms,
  SystemTerms,
} from "@/types/naming-settings";

export const getFromStorage = async (key: string) => {
  const result = await Preferences.get({ key });
  return result.value;
};

export const setToStorage = async (key: string, value: string) => {
  await Preferences.set({ key, value });
};

export function LoginForm({
  type,
  courseId,
  onSwitchToSignup,
}: {
  type?: string;
  courseId?: string;
  onSwitchToSignup?: () => void;
}) {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const { setPrimaryColor } = useTheme();
  const urlParams = new URLSearchParams(window.location.search);
  const [isSSOLoading, setIsSSOLoading] = useState(false);
  const isPublic = urlParams.get("isPublicAssessment");
  const redirect = urlParams.get("redirect");
  // Admin-sent "reset your password" links arrive as
  // /login?username=<their username>&redirect=%2Fchange-password. Pre-filling the username is
  // the whole point of carrying it: the learner being asked to set a new password is exactly the
  // learner least likely to remember what they sign in as. It is a convenience only — they still
  // authenticate normally (password, or the email-OTP tab) before reaching the change-password
  // screen — which is why the link stays predictable enough for an outside system to generate.
  const prefilledUsername = urlParams.get("username") || undefined;
  const fromPaymentSuccess = urlParams.get("fromPaymentSuccess") === "1";
  // /login?method=otp&email=…&phone=… (see otp-login-handoff): open the OTP form the portal
  // allows, prefilled. Read once, because the params are stripped from the URL below.
  const [otpHandoff] = useState(() => readOtpLoginHandoff(window.location.search));
  const [postPaymentCreds, setPostPaymentCreds] = useState<{
    username: string;
    password: string;
  } | null>(null);
  // Demo handoff: an onboarding "Enter as Learner" link arrives with
  // ?demo=1&demo_username=…&demo_password=… → prefill + auto sign-in.
  const [demoCreds, setDemoCreds] = useState<{
    username: string;
    password: string;
  } | null>(null);
  const [authMethod, setAuthMethod] = useState<"EMAIL" | "USERNAME" | "PHONE">(() => {
    if (isPublic === "true" && !fromPaymentSuccess) return "EMAIL";
    // Permissive defaults until the portal policy arrives; the effect below re-picks.
    const otpMethod = pickOtpLoginMethod(otpHandoff, {
      allowEmailOtpAuth: true,
      allowPhoneAuth: true,
    });
    if (otpMethod) return otpMethod;
    return "USERNAME";
  });
  const [providerFlags, setProviderFlags] = useState<{
    allowGoogleAuth: boolean;
    allowGithubAuth: boolean;
    allowEmailOtpAuth: boolean;
    allowUsernamePasswordAuth: boolean;
    allowPhoneAuth: boolean;
  }>({
    allowGoogleAuth: true,
    allowGithubAuth: true,
    allowEmailOtpAuth: true,
    allowUsernamePasswordAuth: true,
    allowPhoneAuth: false,
  });
  // Third-party buttons stay hidden until the institute's real policy is known.
  // The defaults above are permissive so a portal with no policy keeps working,
  // but rendering them before resolution flashed Google/GitHub — and, through
  // the Apple 4.8 pairing rule, Sign in with Apple — on portals that have all
  // three switched off. Apple tapped that phantom button and rejected the build.
  const [providersResolved, setProvidersResolved] = useState(false);
  const { setInstituteId } = useInstituteFeatureStore();
  const domainRouting = useDomainRouting();
  const routedInstituteId = domainRouting?.instituteId ?? null;
  // "Sign up here" is offered only when BOTH the portal (domain routing) and
  // the institute's signup settings say so. Routing alone is not enough: a
  // portal can carry allowSignup=true while the admin has switched signup off
  // or left it with no provider the signup screen can render, and the link
  // would open on an empty dialog. Unknown from routing → undefined so the
  // forms keep their legacy fallback.
  const signupAvailability = useSignupAvailability(routedInstituteId);
  const signupOffered: boolean | undefined =
    domainRouting.allowSignup === null
      ? undefined
      : domainRouting.allowSignup &&
        signupAvailability.resolved &&
        signupAvailability.enabled &&
        signupAvailability.hasProvider;

  // Logged-out query intake ("Need help?"): gated per-institute via the open doubt-config
  // endpoint, using the institute already resolved by domain routing. Fetch failure → hidden.
  const { guestQueriesEnabled, guestQueryTypes } = usePublicDoubtConfig(
    domainRouting.instituteId,
  );
  const [guestDialogOpen, setGuestDialogOpen] = useState(false);

  // Pre-login theme and font from Preferences if present (external-first branding)
  // Re-runs once domain routing resolves: on a fresh install InstituteId is
  // empty at mount, so a mount-only read returned early and left the defaults
  // in place for the whole session.
  useEffectTheme(() => {
    (async () => {
      try {
        const instituteId =
          routedInstituteId ||
          (await Preferences.get({ key: "InstituteId" })).value ||
          "";
        if (!instituteId) return;
        const stored = await Preferences.get({ key: `LEARNER_${instituteId}` });
        if (!stored?.value) return;
        const parsed = JSON.parse(stored.value);
        if (parsed?.theme) {
          setPrimaryColor(parsed.theme);
        }
        setProvidersResolved(true);
        // Update provider flags from preferences
        setProviderFlags({
          allowGoogleAuth: parsed?.allowGoogleAuth !== false,
          allowGithubAuth: parsed?.allowGithubAuth !== false,
          allowEmailOtpAuth: parsed?.allowEmailOtpAuth !== false,
          allowUsernamePasswordAuth:
            parsed?.allowUsernamePasswordAuth !== false,
          allowPhoneAuth: parsed?.allowPhoneAuth === true,
        });
        if (
          parsed?.allowUsernamePasswordAuth === false &&
          parsed?.allowEmailOtpAuth !== false
        ) {
          setAuthMethod("EMAIL");
        } else if (
          parsed?.allowUsernamePasswordAuth === false &&
          parsed?.allowEmailOtpAuth === false &&
          parsed?.allowPhoneAuth === true
        ) {
          setAuthMethod("PHONE");
        }
        if (parsed?.fontFamily) {
          const family = resolveFontStack(parsed.fontFamily);
          document.documentElement.style.setProperty(
            "--app-font-family",
            family,
          );
          document.body.style.fontFamily = family;
        }
      } catch {
        // ignore
      }
    })();
  }, [setPrimaryColor, routedInstituteId]);

  // Domain routing is the source of truth for the login policy. It arrives
  // over the network, so it cannot lose the race the Preferences read above
  // could; a null flag means the backend did not say, so the prior value
  // (the permissive default) is kept rather than silently removing a login.
  useEffect(() => {
    if (!routedInstituteId) return;
    setProviderFlags((prev) => ({
      allowGoogleAuth: domainRouting.allowGoogleAuth ?? prev.allowGoogleAuth,
      allowGithubAuth: domainRouting.allowGithubAuth ?? prev.allowGithubAuth,
      allowEmailOtpAuth:
        domainRouting.allowEmailOtpAuth ?? prev.allowEmailOtpAuth,
      allowUsernamePasswordAuth:
        domainRouting.allowUsernamePasswordAuth ??
        prev.allowUsernamePasswordAuth,
      allowPhoneAuth: domainRouting.allowPhoneAuth ?? prev.allowPhoneAuth,
    }));
    setProvidersResolved(true);
  }, [
    routedInstituteId,
    domainRouting.allowGoogleAuth,
    domainRouting.allowGithubAuth,
    domainRouting.allowEmailOtpAuth,
    domainRouting.allowUsernamePasswordAuth,
    domainRouting.allowPhoneAuth,
  ]);

  // OTP hand-off: re-pick the form once the portal's real policy is known, so
  // the link follows whatever OTP the portal has switched on. No allowed match
  // leaves the page on its usual form.
  useEffect(() => {
    if (!otpHandoff || !providersResolved) return;
    const method = pickOtpLoginMethod(otpHandoff, {
      allowEmailOtpAuth: providerFlags.allowEmailOtpAuth,
      allowPhoneAuth: providerFlags.allowPhoneAuth,
    });
    if (method) setAuthMethod(method);
  }, [otpHandoff, providersResolved, providerFlags.allowEmailOtpAuth, providerFlags.allowPhoneAuth]);

  useEffect(() => {
    if (!otpHandoff) return;
    const url = new URL(window.location.href);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${stripOtpLoginHandoff(url.search)}${url.hash}`,
    );
  }, [otpHandoff]);
  // Providers from stored flags
  // Apple 4.8: the Mac App Store build offers no third-party login at all (the
  // Sign in with Apple plugin is iOS-only, so it cannot be paired with them
  // there). Forced off at the source so the buttons, the "or continue with"
  // divider and the Apple gate below all follow — including on a fresh install,
  // where allowGoogleAuth/allowGithubAuth default to TRUE.
  const hideThirdPartyLogin = shouldHideThirdPartyLogin();
  const authProviders = {
    google:
      providersResolved && !hideThirdPartyLogin && providerFlags.allowGoogleAuth,
    github:
      providersResolved && !hideThirdPartyLogin && providerFlags.allowGithubAuth,
  };

  useEffect(() => {
    if (!fromPaymentSuccess) return;
    try {
      const raw = sessionStorage.getItem("post_payment_login_creds");
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        username?: string;
        password?: string;
        instituteId?: string;
      };
      sessionStorage.removeItem("post_payment_login_creds");
      if (parsed?.username && parsed?.password) {
        setPostPaymentCreds({
          username: parsed.username,
          password: parsed.password,
        });
        setAuthMethod("USERNAME");
        if (parsed.instituteId) {
          Preferences.set({
            key: "InstituteId",
            value: parsed.instituteId,
          }).catch(() => { });
        }
      }
    } catch {
      /* ignore */
    }
  }, [fromPaymentSuccess]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") !== "1") return;
    const username = params.get("demo_username");
    const password = params.get("demo_password");
    if (!username || !password) return;
    setDemoCreds({ username, password });
    setAuthMethod("USERNAME");
    const cleanUrl = new URL(window.location.href);
    ["demo", "demo_username", "demo_password"].forEach((k) =>
      cleanUrl.searchParams.delete(k),
    );
    window.history.replaceState({}, "", cleanUrl.toString());
  }, []);

  useEffect(() => {
    // CRITICAL: Check for popup FIRST, before anything else
    const urlParams = new URLSearchParams(window.location.search);
    const accessToken = urlParams.get("accessToken");
    const refreshToken = urlParams.get("refreshToken");

    // If this page is loaded inside an OAuth popup, do NOT complete login here.
    // Instead, broadcast tokens to the opener and close the popup to avoid duplicate app instances.
    const isPopupWindow = (() => {
      // Check if we have an opener (most reliable way to detect popup)
      try {
        if (window.opener && !window.opener.closed) {
          console.log("[LoginForm] ✅ Detected popup via window.opener");
          return true;
        }
      } catch (e) {
        console.log("[LoginForm] ❌ window.opener check failed:", e);
      }

      // Check window name
      try {
        if (window.name && window.name.toLowerCase() === "oauth_popup") {
          console.log("[LoginForm] ✅ Detected popup via window.name");
          return true;
        }
      } catch { }

      // Check for popup parameter in URL
      try {
        const q = new URLSearchParams(window.location.search);
        if (q.get("popup") === "1") {
          console.log("[LoginForm] ✅ Detected popup via ?popup=1");
          return true;
        }
      } catch { }

      console.log("[LoginForm] ❌ Not detected as popup window");
      console.log("[LoginForm] Debug:", {
        hasOpener: !!window.opener,
        windowName: window.name,
        searchParams: window.location.search,
      });
      return false;
    })();

    console.log("[LoginForm] 🔍 POPUP DETECTION:", {
      isPopupWindow,
      hasTokens: !!(accessToken && refreshToken),
      accessToken: accessToken?.substring(0, 50) + "...",
    });

    if (isPopupWindow && accessToken && refreshToken) {
      console.log("[LoginForm] 🚀 POPUP DETECTED WITH TOKENS - CLOSING POPUP");
      try {
        // postMessage (may be blocked by COOP)
        try {
          if (window.opener && !window.opener.closed) {
            console.log("[LoginForm] 📨 Sending postMessage to opener");
            window.opener.postMessage(
              {
                type: "oauth_success",
                data: { accessToken, refreshToken },
                isModalLogin: true,
              },
              "*",
            );
          }
        } catch (e) {
          console.log("[LoginForm] ❌ postMessage failed:", e);
        }

        // localStorage event for parent listeners
        try {
          console.log("[LoginForm] 💾 Writing to localStorage");
          localStorage.setItem(
            "OAUTH_RESULT",
            JSON.stringify({
              type: "oauth_success",
              data: { accessToken, refreshToken },
              ts: Date.now(),
              isModalLogin: true, // Mark as modal login so __root.tsx ignores it
            }),
          );
        } catch (e) {
          console.log("[LoginForm] ❌ localStorage failed:", e);
        }

        // BroadcastChannel fallback
        try {
          if (typeof BroadcastChannel !== "undefined") {
            console.log("[LoginForm] 📡 Broadcasting via BroadcastChannel");
            const bc = new BroadcastChannel("OAUTH_CHANNEL");
            bc.postMessage({
              type: "oauth_success",
              data: { accessToken, refreshToken },
              isModalLogin: true,
            });
            try {
              bc.close();
            } catch {
              /* ignore */
            }
          }
        } catch (e) {
          console.log("[LoginForm] ❌ BroadcastChannel failed:", e);
        }
      } finally {
        // Close popup quickly
        console.log("[LoginForm] 🔒 Closing popup in 300ms");
        setTimeout(() => {
          try {
            console.log("[LoginForm] 👋 Closing now");
            window.close();
          } catch (e) {
            console.log("[LoginForm] ❌ window.close() failed:", e);
          }
        }, 300);
      }
      return; // Don't proceed with in-popup login
    }

    // Handle OAuth error case in popup mode (when user doesn't exist)
    if (isPopupWindow) {
      const error = urlParams.get("error");
      const signupData = urlParams.get("signupData");
      const emailVerified = urlParams.get("emailVerified");
      const state = urlParams.get("state");

      if (error === "true") {
        console.log(
          "[LoginForm] 🚫 POPUP DETECTED WITH ERROR - OAuth login failed",
        );

        // Check if this is a signup scenario (user doesn't exist but we have OAuth data)
        if (signupData) {
          console.log(
            "[LoginForm] 📝 SignupData present - switching to signup flow",
          );

          // Decode signupData
          let decodedSignupData = null;
          try {
            decodedSignupData = JSON.parse(atob(signupData));
          } catch (e) {
            console.log("[LoginForm] ❌ Failed to decode signupData:", e);
          }

          // Send signup_needed message to parent
          const signupPayload = {
            signupData: decodedSignupData,
            state: state,
            emailVerified: emailVerified === "true",
          };

          try {
            if (window.opener && !window.opener.closed) {
              console.log(
                "[LoginForm] 📨 Sending signup_needed postMessage to opener",
              );
              window.opener.postMessage(
                {
                  action: "oauth_complete",
                  success: false,
                  needsSignup: true,
                  signupData: signupPayload,
                },
                "*",
              );
            }
          } catch (e) {
            console.log("[LoginForm] ❌ Signup postMessage failed:", e);
          }

          // localStorage for storage event listeners
          try {
            console.log("[LoginForm] 💾 Writing signup_needed to localStorage");
            localStorage.setItem(
              "OAUTH_RESULT",
              JSON.stringify({
                type: "oauth_signup_needed",
                data: signupPayload,
                ts: Date.now(),
                isModalLogin: true,
              }),
            );
          } catch (e) {
            console.log("[LoginForm] ❌ localStorage signup write failed:", e);
          }

          // BroadcastChannel fallback
          try {
            if (typeof BroadcastChannel !== "undefined") {
              console.log(
                "[LoginForm] 📡 Broadcasting signup_needed via BroadcastChannel",
              );
              const bc = new BroadcastChannel("OAUTH_CHANNEL");
              bc.postMessage({
                type: "oauth_signup_needed",
                data: signupPayload,
                isModalLogin: true,
              });
              try {
                bc.close();
              } catch {
                /* ignore */
              }
            }
          } catch (e) {
            console.log("[LoginForm] ❌ BroadcastChannel signup failed:", e);
          }
        } else {
          // No signupData - genuine error
          const errorMessage = i18n.t("auth:toasts.userNotFoundCredentials");

          // Send error via multiple channels (same as modal-learner.tsx)
          try {
            if (window.opener && !window.opener.closed) {
              console.log("[LoginForm] 📨 Sending error postMessage to opener");
              window.opener.postMessage(
                {
                  action: "oauth_complete",
                  success: false,
                  error: errorMessage,
                },
                "*",
              );
            }
          } catch (e) {
            console.log("[LoginForm] ❌ Error postMessage failed:", e);
          }

          // localStorage for storage event listeners
          try {
            console.log("[LoginForm] 💾 Writing error to localStorage");
            localStorage.setItem(
              "OAUTH_RESULT",
              JSON.stringify({
                type: "oauth_error",
                data: { message: errorMessage },
                ts: Date.now(),
                isModalLogin: true,
              }),
            );
          } catch (e) {
            console.log("[LoginForm] ❌ localStorage error write failed:", e);
          }

          // BroadcastChannel fallback
          try {
            if (typeof BroadcastChannel !== "undefined") {
              console.log(
                "[LoginForm] 📡 Broadcasting error via BroadcastChannel",
              );
              const bc = new BroadcastChannel("OAUTH_CHANNEL");
              bc.postMessage({
                type: "oauth_error",
                data: { message: errorMessage },
                isModalLogin: true,
              });
              try {
                bc.close();
              } catch {
                /* ignore */
              }
            }
          } catch (e) {
            console.log("[LoginForm] ❌ BroadcastChannel error failed:", e);
          }
        }

        // Close popup after short delay
        console.log("[LoginForm] 🔒 Closing popup in 800ms");
        setTimeout(() => {
          try {
            console.log("[LoginForm] 👋 Closing popup now");
            window.close();
          } catch (e) {
            console.log("[LoginForm] ❌ window.close() failed:", e);
          }
        }, 800);

        return; // Don't proceed with rendering login form
      }
    }

    if (
      isNullOrEmptyOrUndefined(accessToken) ||
      isNullOrEmptyOrUndefined(refreshToken)
    ) {
      return;
    }

    if (accessToken && refreshToken) {
      // Failsafe: Double-check if this is a popup that somehow got past the first check
      const hasOpener = (() => {
        try {
          return window.opener && !window.opener.closed;
        } catch {
          return false;
        }
      })();

      if (hasOpener) {
        console.log(
          "[LoginForm] FAILSAFE: Detected opener after initial check - closing popup",
        );
        // Send tokens and close
        try {
          window.opener.postMessage(
            {
              type: "oauth_success",
              data: { accessToken, refreshToken },
              isModalLogin: true,
            },
            "*",
          );
        } catch {
          /* ignore */
        }
        try {
          localStorage.setItem(
            "OAUTH_RESULT",
            JSON.stringify({
              type: "oauth_success",
              data: { accessToken, refreshToken },
              ts: Date.now(),
              isModalLogin: true,
            }),
          );
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          try {
            window.close();
          } catch {
            /* ignore */
          }
        }, 300);
        return;
      }

      // Show loading screen immediately when processing OAuth tokens
      setIsSSOLoading(true);
      setTokenInStorage(TokenKey.accessToken, accessToken);
      setTokenInStorage(TokenKey.refreshToken, refreshToken);
      // Call async function without awaiting (it will navigate when complete)
      handleSuccessfulLogin(accessToken, redirect).catch((e) => {
        console.error("Login failed:", e);
        setIsSSOLoading(false);
      });
    }
  }, [navigate]);

  // Listen for OAuth completion from popup via localStorage/BroadcastChannel
  useEffect(() => {
    let processed = false;

    const finalizeLoginWithTokens = async (
      accessToken: string,
      refreshToken: string,
    ) => {
      try {
        // Show loading screen immediately when processing OAuth tokens from popup
        setIsSSOLoading(true);
        await setTokenInStorage(TokenKey.accessToken, accessToken);
        await setTokenInStorage(TokenKey.refreshToken, refreshToken);
        await handleSuccessfulLogin(accessToken, redirect);
      } catch {
        toast.error(i18n.t("auth:toasts.failedCompleteLogin"));
        setIsSSOLoading(false);
      }
    };

    const storageHandler = async (e: StorageEvent) => {
      if (!e) return;
      if (e.key === "OAUTH_RESULT" && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed?.type === "oauth_success" && parsed?.data) {
            const { accessToken, refreshToken } = parsed.data || {};
            if (!processed && accessToken && refreshToken) {
              processed = true;
              await finalizeLoginWithTokens(accessToken, refreshToken);
            }
          }
          // Clean up
          localStorage.removeItem("OAUTH_RESULT");
        } catch {
          // Ignore JSON parse errors while reading OAuth result
          void 0;
        }
      }
    };

    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        bc = new BroadcastChannel("OAUTH_CHANNEL");
        bc.onmessage = async (ev: MessageEvent) => {
          const msg = ev?.data;
          if (!msg || typeof msg !== "object") return;
          if (msg.type === "oauth_success" && msg.data) {
            const { accessToken, refreshToken } = msg.data || {};
            if (!processed && accessToken && refreshToken) {
              processed = true;
              await finalizeLoginWithTokens(accessToken, refreshToken);
            }
          }
        };
      }
    } catch {
      // Ignore BroadcastChannel construction failures in unsupported environments
      void 0;
    }

    // Immediate localStorage check in case write happened before listener attached
    const checkLocalOnce = async () => {
      try {
        const existing = localStorage.getItem("OAUTH_RESULT");
        if (existing) {
          const parsed = JSON.parse(existing);
          if (parsed?.type === "oauth_success" && parsed?.data) {
            const { accessToken, refreshToken } = parsed.data || {};
            if (!processed && accessToken && refreshToken) {
              processed = true;
              await finalizeLoginWithTokens(accessToken, refreshToken);
            }
          }
          localStorage.removeItem("OAUTH_RESULT");
        }
      } catch {
        // Ignore localStorage access/parse errors
        void 0;
      }
    };
    checkLocalOnce();

    // Short polling as a last resort
    const pollUntil = Date.now() + 15000;
    const pollTimer = window.setInterval(() => {
      if (processed || Date.now() > pollUntil) {
        window.clearInterval(pollTimer);
        return;
      }
      void checkLocalOnce();
    }, 400);

    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener("storage", storageHandler);
      try {
        window.clearInterval(pollTimer);
      } catch {
        // Ignore timer cleanup errors
        void 0;
      }
      try {
        if (bc) bc.close();
      } catch {
        // Ignore BroadcastChannel close errors
        void 0;
      }
    };
  }, [navigate, redirect]);

  // Apply domain routing theme if available
  useEffect(() => {
    if (domainRouting.instituteThemeCode) {
      setPrimaryColor(domainRouting.instituteThemeCode);
    }
  }, [domainRouting.instituteThemeCode, setPrimaryColor]);

  const handleSuccessfulLogin = async (
    accessToken: string,
    redirect?: string | null,
  ) => {
    try {
      const decodedData = getTokenDecodedData(accessToken);
      const authorities = decodedData?.authorities;
      const userId = decodedData?.user;
      const authorityKeys = authorities ? Object.keys(authorities) : [];
      console.log("abc", userId);
      // Identify user in analytics as soon as we know the userId
      if (userId) {
        try {
          identifyUser(userId, {
            username: decodedData?.username,
            email: decodedData?.email,
          });
        } catch {
          console.warn("Failed to identify user for analytics");
        }
      }

      // Check if user has PARENT role by examining authorities
      let isParent = false;
      const allRoles: string[] = [];

      if (authorities && typeof authorities === "object") {
        for (const [, instAuthority] of Object.entries(authorities)) {
          if (instAuthority && typeof instAuthority === "object") {
            const instRoles = (instAuthority as { roles?: string[] }).roles;
            if (Array.isArray(instRoles)) {
              allRoles.push(...instRoles);
            }
          }
        }
      }

      const upperRoles = allRoles.map((r) => r.toUpperCase());
      isParent = upperRoles.includes("PARENT");
      const isStudentToo = upperRoles.includes("STUDENT");

      // PARENT-only guardians route to the monitoring portal. They have no student
      // row, so we must hydrate a minimal session (StudentDetails + InstituteDetails)
      // or isAuthenticated() rejects them. Dual-role users (STUDENT+PARENT) are NOT
      // force-routed — they fall through to their own learner dashboard.
      if (isParent && !isStudentToo) {
        const parentInstituteId = authorities ? Object.keys(authorities)[0] : undefined;
        if (parentInstituteId && userId) {
          await hydrateParentSession(userId, parentInstituteId, {
            user: userId,
            authorities,
          });
        }
        setIsSSOLoading(false);
        navigate({ to: "/parent/child" });
        return;
      }

      if (authorityKeys.length > 1) {
        // User has multiple institutes - redirect to institute selection
        navigate({
          to: "/institute-selection",
          search: { redirect: redirect || "/dashboard/" },
        });
        setIsSSOLoading(false);
      } else {
        // User has only one institute - proceed directly to dashboard
        const instituteId = authorities
          ? Object.keys(authorities)[0]
          : undefined;

        if (instituteId && userId) {
          try {
            // Fetch and store institute details
            const details = await fetchAndStoreInstituteDetails(
              instituteId,
              userId,
            );
            setInstituteId(instituteId);
            if (instituteId === HOLISTIC_INSTITUTE_ID) {
              setPrimaryColor("holistic");
            } else {
              setPrimaryColor(
                details?.institute_theme_code ??
                  import.meta.env.VITE_DEFAULT_THEME_COLOR ??
                  "#E67E22", // design-lint-ignore: theme fallback color passed to setPrimaryColor, not a CSS class
              );
            }
          } catch (error) {
            console.error("Error fetching institute details:", error);
          }

          try {
            await fetchAndStoreStudentDetails(instituteId, userId);
          } catch {
            toast.error(
              i18n.t("auth:toasts.failedFetchLearnerDetails", {
                learner: getTerminology(
                  RoleTerms.Learner,
                  SystemTerms.Learner
                ).toLowerCase(),
              })
            );
          }
        } else {
          toast.error(i18n.t("auth:toasts.invalidUserData"));
        }

        // Refresh and use Student Display Settings post-login route
        // Explicit redirect param (from deep-links) takes priority over settings
        try {
          const settings = await getStudentDisplaySettings(true);
          const redirectRoute =
            redirect || settings?.postLoginRedirectRoute || "/dashboard";

          if (/^https?:\/\//.test(redirectRoute)) {
            window.location.assign(redirectRoute);
          } else if (redirectRoute.includes("?")) {
            // TanStack navigate({to}) treats `to` as path only — query strings
            // in `to` are ignored. For deep-links carrying query params (e.g.
            // /reports/attendance?from=...&to=...&batchId=...), do a full
            // same-origin navigation so the URL is preserved verbatim.
            window.location.assign(redirectRoute);
          } else {
            navigate({ to: redirectRoute as never });
          }
        } catch (e) {
          console.error(
            "[Post-Login Redirect] Falling back to /dashboard due to error:",
            e,
          );
          navigate({ to: "/dashboard" });
        }
      }
    } catch {
      toast.error(i18n.t("auth:toasts.failedProcessUserData"));
    }
  };

  const handleOAuthLogin = async (provider: "google" | "github" | "apple") => {
    // Native iOS: "Sign in with Apple" uses the native ASAuthorization sheet
    // (no browser redirect / Universal Link). The helper completes the auth
    // cycle and navigates on success.
    if (provider === "apple" && isIOSNative()) {
      try {
        setIsSSOLoading(true);
        await loginWithAppleNative({ instituteId: domainRouting?.instituteId });
      } catch (e) {
        setIsSSOLoading(false);
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
      // Resolve the public-facing origin for OAuth redirect
      const redirectOrigin = await getOAuthRedirectOrigin();

      const stateObj: Record<string, unknown> = {
        from: `${redirectOrigin}/login/oauth/learner`,
        account_type: "login",
        user_type: "learner",
        isModalLogin: false, // Flag to indicate this is a page login
      };

      // Include institute_id if resolved from domain routing
      if (domainRouting?.instituteId) {
        stateObj.institute_id = domainRouting.instituteId;
      }

      const base64State = btoa(JSON.stringify(stateObj));
      const loginUrl = `${LOGIN_URL_GOOGLE_GITHUB}/${provider}?state=${encodeURIComponent(
        base64State,
      )}`;

      if (isNativeOAuthRequired()) {
        // Native: open in system browser via Capacitor Browser plugin
        await openOAuthInSystemBrowser(loginUrl);
      } else if (Capacitor.getPlatform() === "electron") {
        // Electron: open in a popup window — Electron main process intercepts
        // OAuth URLs, opens them in a managed child BrowserWindow, and passes
        // tokens back via localStorage OAUTH_RESULT
        window.open(loginUrl, "_blank");
      } else {
        window.location.href = loginUrl;
      }
    } catch {
      toast.error(i18n.t("auth:toasts.failedInitiateLogin"));
    }
  };

  if (isSSOLoading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="min-h-screen bg-background flex flex-col items-center justify-center relative overflow-hidden"
      >
        {/* Subtle Background Elements (gradients removed) */}
        <div className="absolute inset-0 -z-10" />
        <motion.div
          animate={{
            scale: [1, 1.05, 1],
            rotate: [0, 2, -2, 0],
          }}
          transition={{
            duration: 6,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute top-20 start-20 w-24 h-24 bg-muted/20 rounded-full blur-xl"
        />
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
            rotate: [0, -2, 2, 0],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 1,
          }}
          className="absolute bottom-20 end-20 w-32 h-32 bg-muted/20 rounded-full blur-xl"
        />

        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <div className="mb-6">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "linear",
              }}
              className="inline-block"
            >
              <ClipLoader size={40} color="#374151" /* design-lint-ignore: spinner prop, not a CSS class */ />
            </motion.div>
          </div>
          <motion.h2
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-xl font-semibold text-gray-900 mb-2"
          >
            {t("sso.preparingExperience")}
          </motion.h2>
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-gray-600 text-sm"
          >
            {t("sso.personalizing")}
          </motion.p>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <div
      className={`${
        type ? "h-reg-400 overflow-auto" : "min-h-screen overflow-hidden"
      } bg-background relative mt-10`}
    >
      {/* Subtle Background Pattern (gradients removed) */}
      <div className="absolute inset-0 -z-10" />

      {/* Language switcher — full-page login only (not the embedded variant).
          Options come from the institute's enabled locales; defaults to just
          English until an institute enables more. */}
      {!type && <LanguageDropdown />}

      {/* Centered container */}
      <div className="w-full min-h-screen-60 flex items-center justify-center p-4">
        <div className="w-full max-w-lg xl:max-w-xl">
          {/* Prominent Institute Branding above the card */}
          {domainRouting.instituteId && (
            <div className="mb-4">
              <AuthPageBranding
                branding={{
                  instituteId: domainRouting.instituteId,
                  instituteName: domainRouting.instituteName,
                  instituteLogoFileId: domainRouting.instituteLogoFileId,
                  instituteThemeCode: domainRouting.instituteThemeCode,
                  hideInstituteName: domainRouting.hideInstituteName,
                  logoWidthPx: domainRouting.logoWidthPx,
                  logoHeightPx: domainRouting.logoHeightPx,
                }}
              />
            </div>
          )}

          {/* Login Card */}
          <motion.div
            initial={{ y: 20, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="w-full"
          >
            <Card
              className={
                type
                  ? "border-0 shadow-none p-0"
                  : "w-full shadow-lg border-gray-100"
              }
            >
              <CardHeader className="space-y-1 pb-6 text-center">
                <CardTitle className="text-2xl font-bold tracking-tight text-primary-700">
                  {t("common.welcome")}
                </CardTitle>
                <CardDescription>
                  {t("common.signInToContinue")}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6">
                {/* OAuth Buttons */}
                <motion.div
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.7 }}
                  className="grid grid-cols-1 gap-stack"
                >
                  {/* Apple Guideline 4.8: on native iOS, an app offering
                      third-party social login (Google/GitHub) MUST also offer
                      Sign in with Apple as a peer. The Apple button below
                      satisfies that, so Google/GitHub are no longer hidden on
                      iOS. web / Android / Electron are unaffected. */}
                  {authProviders?.google && (
                    <Button
                      variant="outline"
                      className="w-full relative h-11"
                      onClick={() => handleOAuthLogin("google")}
                      type="button"
                    >
                      <FcGoogle className="me-2 h-4 w-4" />
                      {t("common.continueWithGoogle")}
                    </Button>
                  )}
                  {authProviders?.github && (
                    <Button
                      variant="outline"
                      className="w-full relative h-11"
                      onClick={() => handleOAuthLogin("github")}
                      type="button"
                    >
                      <GitHubLogoIcon className="me-2 h-4 w-4" />
                      {t("common.continueWithGitHub")}
                    </Button>
                  )}
                  {/* Sign in with Apple — native iOS only (the plugin has no
                      Android support; web/Android Apple login is a later phase).
                      Shown whenever a third-party provider is offered, per 4.8. */}
                  {isIOSNative() &&
                    (authProviders?.google || authProviders?.github) && (
                      <AppleSignInButton
                        onClick={() => handleOAuthLogin("apple")}
                      />
                    )}
                </motion.div>

                {/* Divider */}
                {(authProviders?.google || authProviders?.github) && (
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">
                        {t("common.orContinueWith")}
                      </span>
                    </div>
                  </div>
                )}

                {/* Form Content */}
                <motion.div
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 1.1 }}
                >
                  <AnimatePresence mode="wait">
                    {(() => {
                      const allowEmail = providerFlags.allowEmailOtpAuth;
                      const allowUserPass = providerFlags.allowUsernamePasswordAuth;
                      const allowPhone = providerFlags.allowPhoneAuth;

                      // Determine active method (fallback strategy)
                      let activeMethod = authMethod;
                      if (activeMethod === "EMAIL" && !allowEmail) {
                        activeMethod = allowUserPass ? "USERNAME" : (allowPhone ? "PHONE" : "USERNAME");
                      } else if (activeMethod === "USERNAME" && !allowUserPass) {
                        activeMethod = allowEmail ? "EMAIL" : (allowPhone ? "PHONE" : "EMAIL");
                      } else if (activeMethod === "PHONE" && !allowPhone) {
                        activeMethod = allowEmail ? "EMAIL" : (allowUserPass ? "USERNAME" : "EMAIL");
                      }

                      if (activeMethod === "PHONE" && allowPhone) {
                        return (
                          <motion.div
                            key="phone"
                            initial={{ x: 200, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: -200, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <PhoneLoginForm
                              onSwitchToUsername={() => setAuthMethod("USERNAME")}
                              onSwitchToEmail={() => setAuthMethod("EMAIL")}
                              allowUsernamePasswordAuth={allowUserPass}
                              allowEmailOtpAuth={allowEmail}
                              type={type}
                              courseId={courseId}
                              onSwitchToSignup={onSwitchToSignup}
                              allowSignup={signupOffered}
                              initialPhone={otpHandoff?.phone}
                            />
                          </motion.div>
                        );
                      }

                      if (activeMethod === "EMAIL" && allowEmail) {
                        return (
                          <motion.div
                            key="email"
                            initial={{ x: 200, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: -200, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <EmailLogin
                              onSwitchToUsername={() => setAuthMethod("USERNAME")}
                              onSwitchToPhone={() => setAuthMethod("PHONE")}
                              type={type}
                              courseId={courseId}
                              onSwitchToSignup={onSwitchToSignup}
                              allowUsernamePasswordAuth={allowUserPass}
                              allowPhoneAuth={allowPhone}
                              allowSignup={signupOffered}
                              initialEmail={otpHandoff?.email}
                            />
                          </motion.div>
                        );
                      }

                      if (activeMethod === "USERNAME" && allowUserPass) {
                        return (
                          <motion.div
                            key="username"
                            initial={{ x: 200, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: -200, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <UsernameLogin
                              onSwitchToEmail={() => setAuthMethod("EMAIL")}
                              onSwitchToPhone={() => setAuthMethod("PHONE")}
                              allowEmailOtpAuth={allowEmail}
                              allowPhoneAuth={allowPhone}
                              allowSignup={signupOffered}
                              type={type}
                              courseId={courseId}
                              onSwitchToSignup={onSwitchToSignup}
                              initialUsername={
                                demoCreds?.username ??
                                postPaymentCreds?.username ??
                                prefilledUsername
                              }
                              initialPassword={demoCreds?.password ?? postPaymentCreds?.password}
                              autoSubmit={!!demoCreds}
                            />
                          </motion.div>
                        );
                      }

                      return null;
                    })()}
                  </AnimatePresence>
                </motion.div>

                {/* Explore Courses (for institutes with public catalog) */}
                {domainRouting?.redirectPath &&
                domainRouting.redirectPath !== "/login" ? (
                  <motion.div
                    initial={{ y: 10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 1.2 }}
                  >
                    <Button
                      variant="default"
                      className="w-full h-11 text-base font-medium shadow-sm hover:shadow-md transition-all duration-200"
                      onClick={() =>
                        navigate({ to: domainRouting.redirectPath as never })
                      }
                    >
                      {t("login.exploreCourses", {
                        courses: getTerminologyPlural(
                          ContentTerms.Course,
                          SystemTerms.Course
                        ),
                      })}
                    </Button>
                  </motion.div>
                ) : null}
              </CardContent>
            </Card>
          </motion.div>

          {/* Footer Links */}
          <motion.div
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 1.5 }}
            className="mt-6 text-center text-xs text-gray-600"
          >
            <p>
              {t("common.iAgreeTo")}{" "}
              <motion.button
                whileHover={{ scale: 1.02 }}
                onClick={async () => {
                  try {
                    const storedInstitute =
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
                    // Fallback to internal route below on any error
                  }
                  navigate({ to: "/terms-and-conditions" });
                }}
                className="text-primary-700 hover:text-primary-800 font-medium underline cursor-pointer"
              >
                {t("common.termsAndConditions")}
              </motion.button>{" "}
              {t("common.and")}{" "}
              <motion.button
                whileHover={{ scale: 1.02 }}
                onClick={async () => {
                  try {
                    const storedInstitute =
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
                    // Fallback to internal route below on any error
                  }
                  navigate({ to: "/privacy-policy" });
                }}
                className="text-primary-700 hover:text-primary-800 font-medium underline cursor-pointer"
              >
                {t("common.privacyPolicy")}
              </motion.button>
            </p>

            {guestQueriesEnabled && domainRouting.instituteId && (
              <p className="mt-3">
                {t("common.havingTrouble")}{" "}
                <button
                  type="button"
                  onClick={() => setGuestDialogOpen(true)}
                  className="text-primary-700 hover:text-primary-800 font-medium underline cursor-pointer"
                >
                  {t("common.needHelp")}
                </button>
              </p>
            )}
          </motion.div>

          {guestQueriesEnabled && domainRouting.instituteId && (
            <GuestQueryDialog
              open={guestDialogOpen}
              onOpenChange={setGuestDialogOpen}
              instituteId={domainRouting.instituteId}
              queryTypes={guestQueryTypes}
            />
          )}
        </div>
      </div>
    </div>
  );
}
