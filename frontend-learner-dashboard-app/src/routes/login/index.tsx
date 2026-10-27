import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LoginForm } from "@/components/common/auth/login/forms/page/login-form";
import { AuthModal, type AuthModalRef } from "@/components/common/auth/modal/AuthModal";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { getPublicStudentDisplaySettings } from "@/services/student-display-settings";
import { getTokenFromStorage } from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { navigateAfterLogin } from "@/lib/auth/post-login-redirect";
import { getCachedRootCatalogueTag } from "@/services/domain-routing";
import { CatalogueTagContext } from "../$tagName/-components/CatalogueTagContext";

const CourseCataloguePage = lazy(() =>
  import("../$tagName/-components/CourseCataloguePage").then((m) => ({
    default: m.CourseCataloguePage,
  })),
);

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
  const [modalView, setModalView] = useState<boolean | null>(
    keepPage ? false : null,
  );
  // Same rule as the page's "Sign up here": the portal allows signup, it is on,
  // and it has a provider the signup screen can render.
  const [signupLink, setSignupLink] = useState(false);

  useEffect(() => {
    if (keepPage || modalView !== null || domainRouting.isLoading) return;
    let cancelled = false;
    // Fresh read: the 24h local copy would hide a newly enabled popup.
    getPublicStudentDisplaySettings(domainRouting.instituteId, { skipLocalCache: true })
      .then((settings) => {
        if (cancelled) return;
        const signup = settings?.signup;
        const providers = signup?.providers;
        setSignupLink(
          domainRouting.allowSignup !== false &&
            signup?.enabled !== false &&
            (!providers || !!(providers.google || providers.github || providers.emailOtp)),
        );
        setModalView(signup?.loginPageAsModal === true);
      })
      .catch(() => {
        if (!cancelled) setModalView(false);
      });
    return () => {
      cancelled = true;
    };
  }, [keepPage, modalView, domainRouting.isLoading, domainRouting.instituteId, domainRouting.allowSignup]);

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
    // On a host whose "/" is the institute's site, show that site behind the
    // popup (blurred by the backdrop) instead of a blank page.
    const rootTag = getCachedRootCatalogueTag();
    return (
      <div className="w-full min-h-screen bg-background">
        {rootTag && domainRouting.instituteId && (
          <CatalogueTagContext.Provider value={rootTag}>
            <Suspense fallback={null}>
              <CourseCataloguePage
                tagName={rootTag}
                instituteId={domainRouting.instituteId}
                instituteThemeCode={domainRouting.instituteThemeCode}
              />
            </Suspense>
          </CatalogueTagContext.Provider>
        )}
        <AuthModal
          ref={signupModalRef}
          // Visitors reach /login from a Login button, so open on Sign in;
          // "Sign up here" inside the popup switches to Create Account.
          initialMode="login"
          onSignupSuccess={handleSignupSuccess}
          onClose={handleModalClose}
          blurBackdrop={!!rootTag}
          showSignupLink={signupLink}
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
