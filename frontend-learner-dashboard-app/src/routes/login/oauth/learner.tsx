import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { setToStorage } from "@/components/common/auth/login/forms/page/login-form";
import {
  getTokenDecodedData,
  setTokenInStorage,
} from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { fetchAndStoreInstituteDetails } from "@/services/fetchAndStoreInstituteDetails";
import { fetchAndStoreStudentDetails } from "@/services/studentDetails";
import { useTheme } from "@/providers/theme/theme-provider";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { createFileRoute } from "@tanstack/react-router";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import { identifyUser } from "@/lib/analytics";

export const Route = createFileRoute("/login/oauth/learner")({
  component: OAuthRedirectHandler,
});

function OAuthRedirectHandler() {
  const navigate = useNavigate();
  const { setPrimaryColor } = useTheme();
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;
    
    handleOAuthCallback(
      navigate,
      setPrimaryColor
    );
  }, [navigate, setPrimaryColor]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-gradient-to-br from-success-50 via-white to-teal-50">
      <DashboardLoader />
    </div>
  );
}

// Robust success notifier for popup contexts: postMessage, localStorage, BroadcastChannel
// isModalLogin: true so the parent (modal) processes the result; parent ignores when isModalLogin === false
function sendOAuthSuccessToParent(accessToken: string, refreshToken: string) {
  const payload = { type: 'oauth_success', data: { accessToken, refreshToken }, isModalLogin: true, ts: Date.now() };
  // Try postMessage (may be blocked by COOP)
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: 'oauth_success', data: { accessToken, refreshToken }, isModalLogin: true },
        '*'
      );
    }
  } catch {
    // ignore postMessage failures
  }

  // Always write to localStorage so parent can pick via storage event (same-origin)
  try {
    localStorage.setItem('OAUTH_RESULT', JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }

  // BroadcastChannel fallback (works when COOP blocks postMessage)
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('OAUTH_CHANNEL');
      bc.postMessage({ type: 'oauth_success', data: { accessToken, refreshToken }, isModalLogin: true });
      try { bc.close(); } catch { /* ignore */ }
    }
  } catch {
    // ignore broadcast errors
  }
}

function sendOAuthErrorToParent(message: string) {
  // Try postMessage
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: 'oauth_error', data: { message } },
        '*'
      );
    }
  } catch {
    // ignore
  }

  try {
    localStorage.setItem(
      'OAUTH_RESULT',
      JSON.stringify({ type: 'oauth_error', data: { message }, ts: Date.now() })
    );
  } catch {}

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('OAUTH_CHANNEL');
      bc.postMessage({ type: 'oauth_error', data: { message } });
      try { bc.close(); } catch { /* ignore */ }
    }
  } catch {}
}

const handleOAuthCallback = async (
  navigate: ReturnType<typeof useNavigate>,
  setPrimaryColor: (color: string) => void
) => {
  const urlParams = new URLSearchParams(window.location.search);
  const accessToken = urlParams.get("accessToken");
  const refreshToken = urlParams.get("refreshToken");
  const error = urlParams.get("error");
  const state = urlParams.get("state");
   
  // Parse state to get redirect information
  let redirectTo = "/dashboard";
  let currentUrl = "";
   
  if (state) {
    try {
      // Use a more robust decoding approach
      const decodedState = decodeURIComponent(escape(atob(state)));
      const stateObj = JSON.parse(decodedState);
      redirectTo = stateObj.redirectTo || "/dashboard";
      currentUrl = stateObj.currentUrl || "";
    } catch {
      // Error parsing state - continue with default values
    }
  }

  // Detect popup context: opener present, or known window.name, or explicit flag
  const isPopupWindow = (() => {
    try {
      if (window.opener && !window.opener.closed) return true;
    } catch {}
    try {
      if (window.name && window.name.toLowerCase() === 'oauth_popup') return true;
    } catch {}
    try {
      const qp = new URLSearchParams(window.location.search);
      if (qp.get('popup') === '1') return true;
    } catch {}
    return false;
  })();

  if (error) {
    const message = "We couldn't find an account with these details. Please try a different login method or contact support.";
    if (isPopupWindow) {
      sendOAuthErrorToParent(message);
      setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 600);
      return;
    }
    toast.error(message);
    navigate({ to: "/login" });
    return;
  }

  if (accessToken && refreshToken) {
    try {
      // If this is a popup window, send tokens to parent and close without navigating here
      if (isPopupWindow) {
        sendOAuthSuccessToParent(accessToken, refreshToken);
        setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 800);
        return;
      }

      await setToStorage("accessToken", accessToken);
      await setToStorage("refreshToken", refreshToken);
      await setTokenInStorage(TokenKey.accessToken, accessToken);
      await setTokenInStorage(TokenKey.refreshToken, refreshToken);

      await handleSuccessfulLogin(
        accessToken,
        refreshToken,
        navigate,
        setPrimaryColor,
        redirectTo,
        currentUrl,
        isPopupWindow
      );
    } catch {
      toast.error("Failed to store authentication tokens. Please try again.");
      // Redirect back to login page instead of signup page
      navigate({ to: "/login" });
    }
  } else {
    const message = "Missing tokens in redirect URL. Please try logging in again.";
    if (isPopupWindow) {
      sendOAuthErrorToParent(message);
      setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 600);
      return;
    }
    toast.error(message);
    navigate({ to: "/login" });
  }
};

const handleSuccessfulLogin = async (
  accessToken: string,
  refreshToken: string,
  navigate: ReturnType<typeof useNavigate>,
  setPrimaryColor?: (color: string) => void,
  redirectTo?: string,
  currentUrl?: string,
  isPopupWindow?: boolean
) => {
  try {
    const decodedData = getTokenDecodedData(accessToken);
    const authorities = decodedData?.authorities;
    const userId = decodedData?.user;

    // Identify user in analytics immediately after successful OAuth login
    if (userId) {
      try {
        identifyUser(userId, {
          username: decodedData?.username,
          email: decodedData?.email,
        });
      } catch {}
    }

    const authorityKeys = authorities ? Object.keys(authorities) : [];

    if (!userId || authorityKeys.length === 0) {
      toast.error("Invalid user or institute data. Please try logging in again.");
      navigate({ to: "/login" });
      return;
    }

    if (authorityKeys.length === 1) {
      const instituteId = authorityKeys[0];

      const details = await fetchAndStoreInstituteDetails(instituteId, userId);
      if (setPrimaryColor) {
        setPrimaryColor(details?.institute_theme_code ?? import.meta.env.VITE_DEFAULT_THEME_COLOR ?? "#E67E22"); // design-lint-ignore: default brand color fallback
      }
      await fetchAndStoreStudentDetails(instituteId, userId);

      // Handle redirection for OAuth login
      // Since we're now handling OAuth in same tab, redirect to study-library page directly
      if (redirectTo && redirectTo !== "/dashboard" && currentUrl && 
          (currentUrl.includes("/courses") || currentUrl.includes("/course-details"))) {
        // Redirect in same tab instead of opening new tab
        window.location.href = redirectTo;
        return;
      }
      
      // Navigate using Student Display Settings post-login route (force refresh)
      try {
        const settings = await getStudentDisplaySettings(true);
        const redirectRoute = settings?.postLoginRedirectRoute || "/dashboard";

        if (/^https?:\/\//.test(redirectRoute)) {
          window.location.assign(redirectRoute);
        } else {
          navigate({ to: redirectRoute as string });
        }
      } catch (e) {
        // Falling back to /dashboard due to error
        const fallbackRedirect = "/dashboard";
        
        // Send success message to parent window with fallback redirect
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({
            action: 'oauth_complete',
            success: true,
            redirectTo: fallbackRedirect,
            error: 'Dynamic redirection failed, using fallback route'
          }, window.location.origin);
        }
        
        // Close popup after sending message
        setTimeout(() => window.close(), 500);
      }
    } else {
      // For multiple institutes
      // If this is a popup, send tokens to parent and close - parent will handle institute selection
      if (isPopupWindow && window.opener && !window.opener.closed) {
        sendOAuthSuccessToParent(accessToken, refreshToken);
        setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 800);
        return;
      }
      
      // For page-level login, navigate to institute selection
      navigate({
        to: "/institute-selection",
        search: { redirect: "/dashboard/" },
      });
    }
  } catch {
    toast.error("Failed to process user data. Please try logging in again.");
    navigate({ to: "/login" });
  }
};
 