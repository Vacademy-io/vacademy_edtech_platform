import { useEffect } from "react";
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

export const Route = createFileRoute("/login/oauth/modal-learner")({
  component: ModalOAuthRedirectHandler,
});

function ModalOAuthRedirectHandler() {
  const navigate = useNavigate();
  const { setPrimaryColor } = useTheme();

  useEffect(() => {
    handleModalOAuthCallback(navigate, setPrimaryColor);
  }, [navigate, setPrimaryColor]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-gradient-to-br from-success-50 via-white to-teal-50">
      <DashboardLoader />
    </div>
  );
}

// Robust error notifier: attempts postMessage to opener, writes to localStorage,
// and broadcasts via BroadcastChannel so the parent can always react.
function sendOAuthErrorToParent(message: string) {
  // Try postMessage (may be blocked by COOP)
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        {
          action: 'oauth_complete',
          success: false,
          error: message,
        },
        '*'
      );
    }
  } catch {
    // ignore postMessage failures
  }

  // Always write to localStorage so parent can pick it via storage event
  try {
    localStorage.setItem(
      'OAUTH_RESULT',
      JSON.stringify({ type: 'oauth_error', data: { message }, ts: Date.now(), isModalLogin: true })
    );
  } catch {
    // ignore storage errors
  }

  // BroadcastChannel fallback for same-origin tabs
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('OAUTH_CHANNEL');
      bc.postMessage({ type: 'oauth_error', data: { message }, isModalLogin: true });
      try { bc.close(); } catch { /* ignore */ }
    }
  } catch {
    // ignore broadcast errors
  }
}

const handleModalOAuthCallback = async (
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
  let type = "";
  let courseId = "";
  let instituteId = "";
   
  if (state) {
    try {
      // Check if state needs URL decoding first
      let decodedState;
      try {
        decodedState = atob(state);
      } catch {
        const urlDecodedState = decodeURIComponent(state);
        decodedState = atob(urlDecodedState);
      }
      
      const stateObj = JSON.parse(decodedState);
      
      redirectTo = stateObj.redirectTo || "/dashboard";
      currentUrl = stateObj.currentUrl || "";
      type = stateObj.type || "";
      courseId = stateObj.courseId || "";
      instituteId = stateObj.instituteId || "";
    } catch {
      // Error parsing state
    }
  }

  // Try to get data from sessionStorage first (new approach)
  const storedModalData = sessionStorage.getItem('modal_oauth_data');
   
  if (storedModalData) {
    try {
      const modalData = JSON.parse(storedModalData);
      
      // Use data from sessionStorage
      redirectTo = modalData.redirectTo || redirectTo;
      currentUrl = modalData.currentUrl || currentUrl;
      type = modalData.type || type;
      courseId = modalData.courseId || courseId;
      instituteId = modalData.instituteId || instituteId;
    } catch {
      // Error parsing stored modal data
    }
  }

  if (error) {
    // Check if we have signup data (user doesn't exist but we have OAuth profile)
    const signupData = urlParams.get("signupData");
    const emailVerified = urlParams.get("emailVerified");

    if (signupData) {
      // User doesn't exist but we have OAuth data - this is a signup scenario
      console.log('[modal-learner] 📝 SignupData present - switching to signup flow');
      
      // Decode signupData
      let decodedSignupData = null;
      try {
        decodedSignupData = JSON.parse(atob(signupData));
      } catch (e) {
        console.log('[modal-learner] ❌ Failed to decode signupData:', e);
      }
      
      // Send signup_needed message to parent
      const signupPayload = {
        signupData: decodedSignupData,
        state: state,
        emailVerified: emailVerified === 'true'
      };
      
      // Try postMessage (may be blocked by COOP)
      try {
        if (window.opener && !window.opener.closed) {
          console.log('[modal-learner] 📨 Sending signup_needed postMessage to opener');
          window.opener.postMessage({
            action: 'oauth_complete',
            success: false,
            needsSignup: true,
            signupData: signupPayload,
          }, '*');
        }
      } catch (e) {
        console.log('[modal-learner] ❌ Signup postMessage failed:', e);
      }
      
      // localStorage for storage event listeners
      try {
        console.log('[modal-learner] 💾 Writing signup_needed to localStorage');
        localStorage.setItem('OAUTH_RESULT', JSON.stringify({ 
          type: 'oauth_signup_needed', 
          data: signupPayload, 
          ts: Date.now(), 
          isModalLogin: true 
        }));
      } catch (e) {
        console.log('[modal-learner] ❌ localStorage signup write failed:', e);
      }
      
      // BroadcastChannel fallback
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          console.log('[modal-learner] 📡 Broadcasting signup_needed via BroadcastChannel');
          const bc = new BroadcastChannel('OAUTH_CHANNEL');
          bc.postMessage({ 
            type: 'oauth_signup_needed', 
            data: signupPayload, 
            isModalLogin: true 
          });
          try { bc.close(); } catch { /* ignore */ }
        }
      } catch (e) {
        console.log('[modal-learner] ❌ BroadcastChannel signup failed:', e);
      }
    } else {
      // No signupData - genuine error
      const errorMessage = "We could not find a user for the credentials used. Please sign up to create a new account or contact the administrator.";
      sendOAuthErrorToParent(errorMessage);
    }

    // Close this popup after sending messages
    setTimeout(() => {
      try { window.close(); } catch { /* ignore */ }
    }, 800);
    return;
  }

  if (accessToken && refreshToken) {
    try {
      // Multiple institutes: send tokens to parent so it can redirect to /institute-selection (don't complete login in popup)
      const decodedData = getTokenDecodedData(accessToken);
      const authorities = decodedData?.authorities;
      const authorityKeys = authorities ? Object.keys(authorities) : [];
      if (authorityKeys.length > 1) {
        const payload = { type: 'oauth_success', data: { accessToken, refreshToken }, isModalLogin: true, ts: Date.now() };
        try {
          localStorage.setItem('OAUTH_RESULT', JSON.stringify(payload));
        } catch { /* ignore */ }
        try {
          if (typeof BroadcastChannel !== 'undefined') {
            const bc = new BroadcastChannel('OAUTH_CHANNEL');
            bc.postMessage({ type: 'oauth_success', data: { accessToken, refreshToken }, isModalLogin: true });
            try { bc.close(); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'oauth_success', data: { accessToken, refreshToken }, isModalLogin: true }, '*');
          }
        } catch { /* ignore */ }
        setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 1000);
        return;
      }

      await setToStorage("accessToken", accessToken);
      await setToStorage("refreshToken", refreshToken);
      await setTokenInStorage(TokenKey.accessToken, accessToken);
      await setTokenInStorage(TokenKey.refreshToken, refreshToken);

      await handleModalSuccessfulLogin(
        accessToken,
        refreshToken,
        navigate,
        setPrimaryColor,
        redirectTo,
        currentUrl,
        type,
        courseId,
        instituteId
      );
    } catch {
      // Failed to store authentication tokens
    }
  } else {
    // Don't show toast in popup - send error message to parent window instead
    console.log('[OAuth Popup][DEBUG] No tokens received, sending generic error');

    // Send error message to parent window and close popup
    const genericMessage = 'Authentication failed. Please try logging in again.';
    sendOAuthErrorToParent(genericMessage);

    if (window.opener && !window.opener.closed) {
      setTimeout(() => {
        console.log('[OAuth Popup][DEBUG] Closing popup after sending generic error');
        try { window.close(); } catch { /* ignore */ }
      }, 800);
    } else {
      console.log('[OAuth Popup][DEBUG] Parent window not accessible for generic error, redirecting');
      // Fallback: redirect to login page with parameters
      const loginUrl = new URL(window.location.origin + "/login");
      loginUrl.searchParams.set("fromOAuth", "true");
      window.location.href = loginUrl.toString();
    }
  }
};

const handleModalSuccessfulLogin = async (
  accessToken: string,
  _refreshToken: string,
  _navigate: ReturnType<typeof useNavigate>,
  setPrimaryColor?: (color: string) => void,
  redirectTo?: string,
  _currentUrl?: string,
  _type?: string,
  _courseId?: string,
  instituteId?: string
) => {
  try {
    const decodedData = getTokenDecodedData(accessToken);
    const authorities = decodedData?.authorities;
    const userId = decodedData?.user;

    const authorityKeys = authorities ? Object.keys(authorities) : [];

    if (!userId || authorityKeys.length === 0) {
      toast.error("Invalid user or institute data.");
      // Send error message to parent window and close popup
      sendOAuthErrorToParent('Invalid user or institute data.');
      setTimeout(() => window.close(), 1000);
      return;
    }

    // If instituteId is provided, check if user is enrolled in that institute
    if (instituteId) {
      if (authorityKeys.includes(instituteId)) {
        // User is enrolled in the specified institute
        const details = await fetchAndStoreInstituteDetails(instituteId, userId);
        if (setPrimaryColor) {
          setPrimaryColor(details?.institute_theme_code ?? import.meta.env.VITE_DEFAULT_THEME_COLOR ?? "#E67E22"); // design-lint-ignore: default brand color fallback
        }
        await fetchAndStoreStudentDetails(instituteId, userId);

        // Use dynamic redirection logic (same as signup flow)
        await handleDynamicRedirection(window.opener, _currentUrl, redirectTo, accessToken, _refreshToken);
      } else {
        // User is not enrolled in the specified institute
        toast.error("You are not enrolled in this institute.");
        // Send error message to parent window and close popup
        sendOAuthErrorToParent('You are not enrolled in this institute.');
        setTimeout(() => window.close(), 1000);
      }
    } else {
      // No instituteId provided, use the first available institute
      const firstInstituteId = authorityKeys[0];
      
      const details = await fetchAndStoreInstituteDetails(firstInstituteId, userId);
      if (setPrimaryColor) {
        setPrimaryColor(details?.institute_theme_code ?? import.meta.env.VITE_DEFAULT_THEME_COLOR ?? "#E67E22"); // design-lint-ignore: default brand color fallback
      }
      await fetchAndStoreStudentDetails(firstInstituteId, userId);

      // Use dynamic redirection logic (same as signup flow)
      await handleDynamicRedirection(window.opener, _currentUrl, redirectTo, accessToken, _refreshToken);
    }
  } catch {
    // Error in modal successful login
  } finally {
    // Clean up sessionStorage after processing is complete
    sessionStorage.removeItem('modal_oauth_data');
  }
};

// Dynamic redirection logic (same as signup flow)
const handleDynamicRedirection = async (
  opener: Window | null,
  _currentUrl?: string,
  fallbackRedirect?: string,
  accessToken?: string,
  refreshToken?: string
) => {
  try {
    // 1. Fetch student display settings (same as signup flow)
    const studentSettings = await getStudentDisplaySettings(true);
    
    // 2. Determine the final redirect route
    let finalRedirectRoute = "/dashboard";
    
    // Priority order:
    // 1. Backend postLoginRedirectRoute (highest priority) - but clean it first
    if (studentSettings?.postLoginRedirectRoute) {
      finalRedirectRoute = cleanUrlOfSensitiveData(studentSettings.postLoginRedirectRoute);
    }
    // 2. Fallback redirect from state (this is the cleaned studyLibraryUrl)
    else if (fallbackRedirect && fallbackRedirect !== "/dashboard") {
      finalRedirectRoute = fallbackRedirect;
    }
    // 3. NEVER use currentUrl for redirection as it may contain sensitive data
    // Instead, construct a safe route based on type and courseId
    


    // Send success message to parent window with redirect information
    if (opener && !opener.closed) {
      opener.postMessage({
        action: 'oauth_complete',
        success: true,
        redirectTo: finalRedirectRoute,
        backendRoute: studentSettings?.postLoginRedirectRoute,
        currentUrl: _currentUrl
      }, '*');
    }
    
    // Also persist success for storage/BroadcastChannel-based listeners
    try {
      if (accessToken && refreshToken) {
        localStorage.setItem('OAUTH_RESULT', JSON.stringify({
          type: 'oauth_success',
          data: { accessToken, refreshToken },
          ts: Date.now(),
          isModalLogin: true,
        }));
      }
    } catch {
      // ignore
    }

    try {
      if (typeof BroadcastChannel !== 'undefined' && accessToken && refreshToken) {
        const bc = new BroadcastChannel('OAUTH_CHANNEL');
        bc.postMessage({ type: 'oauth_success', data: { accessToken, refreshToken }, isModalLogin: true });
        try { bc.close(); } catch { /* ignore */ }
      }
    } catch {
      // ignore
    }

  // Close or redirect after sending message
  setTimeout(() => {
    try {
      // If there is no opener (same-tab flow), redirect this window so the app can complete login
      if ((!opener || opener.closed) && accessToken && refreshToken) {
        const next = new URL('/login', window.location.origin);
        next.searchParams.set('accessToken', accessToken);
        next.searchParams.set('refreshToken', refreshToken);
        window.location.replace(next.toString());
        return;
      }
    } catch {
      // ignore and try to close
    }
    try { window.close(); } catch { /* ignore */ }
  }, 500);
    
  } catch {
    // Error in dynamic redirection
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
  } catch {
    // Error cleaning URL
    return url;
  }
}; 