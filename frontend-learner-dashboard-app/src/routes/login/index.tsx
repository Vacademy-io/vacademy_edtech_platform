import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LoginForm } from "@/components/common/auth/login/forms/page/login-form";
import { AuthModal, type AuthModalRef } from "@/components/common/auth/modal/AuthModal";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { getPublicStudentDisplaySettings } from "@/services/student-display-settings";
import { getTokenFromStorage } from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { navigateAfterLogin } from "@/lib/auth/post-login-redirect";

export const Route = createFileRoute("/login/")({
  component: RouteComponent,
});

// The full page owns every /login link that carries a query param: the OTP
// hand-off sent to migrated buyers, SSO tokens, OAuth callbacks, post-payment
// creds, demo sign-in, ?username=, ?redirect= and public assessments. Only a
// bare /login (ad tracking params aside) may become the popup.
const TRACKING_PARAMS = ["gclid", "fbclid", "gbraid", "wbraid", "gad_source", "msclkid"];

const needsFullPage = (search: string) =>
  Array.from(new URLSearchParams(search).keys()).some(
    (key) => !key.startsWith("utm_") && !TRACKING_PARAMS.includes(key),
  );

// If settings never resolve, fall back to the page rather than spin forever.
const SETTINGS_TIMEOUT_MS = 4000;

function RouteComponent() {
  // "Don't have an account? Sign up here" on the standalone login page. Without
  // a handler the forms fall back to navigate({ to: "/signup" }), and that route
  // is a bare redirect back to /login — so the tap did nothing. Apple reviewed
  // exactly that ("button unresponsive") on Brahm Varchas 1.0 (6). Reuse the
  // signup modal the catalogue header already opens for its own Sign Up link.
  const signupModalRef = useRef<AuthModalRef>(null);
  const navigate = useNavigate();
  const domainRouting = useDomainRouting();
  const [keepPage] = useState(() => needsFullPage(window.location.search));
  // null = still deciding; the institute's signup.loginPageAsModal picks the view.
  const [modalView, setModalView] = useState<{ startOnSignup: boolean } | false | null>(
    keepPage ? false : null,
  );

  useEffect(() => {
    if (keepPage || modalView !== null || domainRouting.isLoading) return;
    let cancelled = false;
    getPublicStudentDisplaySettings(domainRouting.instituteId)
      .then((settings) => {
        if (cancelled) return;
        const signup = settings?.signup;
        const providers = signup?.providers;
        // Same rule as useSignupAvailability: signup must be on and offer a
        // provider the signup screen can render, else open on Sign in.
        const startOnSignup =
          signup?.enabled !== false &&
          (!providers || !!(providers.google || providers.github || providers.emailOtp));
        setModalView(signup?.loginPageAsModal === true ? { startOnSignup } : false);
      })
      .catch(() => {
        if (!cancelled) setModalView(false);
      });
    return () => {
      cancelled = true;
    };
  }, [keepPage, modalView, domainRouting.isLoading, domainRouting.instituteId]);

  useEffect(() => {
    if (modalView !== null) return;
    const timer = setTimeout(
      () => setModalView((current) => (current === null ? false : current)),
      SETTINGS_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [modalView]);

  useEffect(() => {
    if (modalView) signupModalRef.current?.setIsOpen(true);
  }, [modalView]);

  // The signup screen never navigates on its own, so send the learner on here.
  const handleSignupSuccess = () => {
    void navigateAfterLogin(navigate);
  };

  // The modal closes on ×/Esc/backdrop and after a login or signup. Signed in →
  // send the learner on, unless a form is already navigating (OAuth and some
  // forms do a full-page redirect themselves). Signed out → back to the site;
  // a host whose "/" redirects to /login lands here again, so reopen.
  const handleModalClose = async () => {
    const token = await getTokenFromStorage(TokenKey.accessToken);
    if (!token) {
      await navigate({ to: "/" });
      if (window.location.pathname.startsWith("/login")) {
        signupModalRef.current?.setIsOpen(true);
      }
      return;
    }
    setTimeout(() => {
      if (window.location.pathname.startsWith("/login")) {
        void navigateAfterLogin(navigate);
      }
    }, 1500);
  };

  if (modalView === null) {
    return <DashboardLoader />;
  }

  if (modalView) {
    return (
      <div className="w-full min-h-screen bg-background">
        <AuthModal
          ref={signupModalRef}
          initialMode={modalView.startOnSignup ? "signup" : "login"}
          onSignupSuccess={handleSignupSuccess}
          onClose={handleModalClose}
          trigger={<span style={{ display: "none" }} aria-hidden="true" />}
        />
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-background">
      <LoginForm onSwitchToSignup={() => signupModalRef.current?.setIsOpen(true)} />
      <AuthModal
        ref={signupModalRef}
        initialMode="signup"
        trigger={<span style={{ display: "none" }} aria-hidden="true" />}
      />
    </div>
  );
}
