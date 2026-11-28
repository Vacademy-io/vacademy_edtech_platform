import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Preferences } from "@capacitor/preferences";

import { AuthPageBranding } from "@/components/common/institute-branding";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { getTokenFromStorage } from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { isNullOrEmptyOrUndefined } from "@/lib/utils";
import { SessionLoginForm } from "@/routes/study-library/live-class/$username/components/SessionLoginForm";

export const Route = createFileRoute("/go/$username/")({
  component: RouteComponent,
});

/**
 * Passwordless landing route for links sent over WhatsApp/email.
 *
 * Meta will not approve a WhatsApp template that carries login credentials in
 * its body — any "Login ID"/"password"/"log in" wording is classified as
 * AUTHENTICATION, and that category's body is fixed-format, so the template is
 * rejected with INCORRECT_CATEGORY in every category. So messages link here
 * with the learner's username in the path instead of quoting a password, and
 * trusted login (SessionLoginForm) signs them in and drops them on /dashboard.
 *
 * Deliberately channel-agnostic and destination-agnostic: any campaign that
 * needs "open my account" can reuse `/go/<username>` without a new route.
 */
function RouteComponent() {
  const { t } = useTranslation("miscRoutesB");
  const params = Route.useParams();
  const domainRouting = useDomainRouting();
  const navigate = useNavigate();

  // Params can be momentarily undefined during SPA navigation — fall back to
  // parsing the URL, same as the live-class and subscriptions username routes.
  let username = params.username || "";
  if (!username) {
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 2 && pathParts[0] === "go") {
      username = pathParts[1] || "";
    }
  }

  const [authState, setAuthState] = useState<
    "loading" | "authenticated" | "unauthenticated"
  >("loading");

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = await getTokenFromStorage(TokenKey.accessToken);
        const studentDetails = await Preferences.get({ key: "StudentDetails" });
        const instituteDetails = await Preferences.get({
          key: "InstituteDetails",
        });
        if (
          !isNullOrEmptyOrUndefined(token) &&
          !isNullOrEmptyOrUndefined(studentDetails.value) &&
          !isNullOrEmptyOrUndefined(instituteDetails.value)
        ) {
          setAuthState("authenticated");
        } else {
          setAuthState("unauthenticated");
        }
      } catch (error) {
        console.error("Error checking authentication:", error);
        setAuthState("unauthenticated");
      }
    };
    if (!domainRouting.isLoading) {
      checkAuth();
    }
  }, [domainRouting.isLoading, domainRouting]);

  // Single navigation path for both the already-signed-in visitor and the one
  // who just completed trusted login, so SessionLoginForm's own navigation is
  // suppressed via a no-op onNavigate below.
  useEffect(() => {
    if (authState === "authenticated") {
      navigate({ to: "/dashboard" });
    }
  }, [authState, navigate]);

  if (domainRouting.isLoading || authState !== "unauthenticated") {
    return <DashboardLoader />;
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-gray-50">
      {domainRouting.instituteId && (
        <div className="w-full bg-white shadow-sm">
          <div className="mx-auto px-4 py-4">
            <AuthPageBranding
              branding={{
                instituteId: domainRouting.instituteId,
                instituteName: domainRouting.instituteName,
                instituteLogoFileId: domainRouting.instituteLogoFileId,
                instituteThemeCode: domainRouting.instituteThemeCode,
              }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {/* instituteId stays optional on purpose: institutes served from a
              shared domain have no domain-routing row, and gating the form on it
              locked those learners out of their own link. The username in the
              path is globally unique, which is enough to look the learner up. */}
          <SessionLoginForm
            linkRoute="GO"
            username={username}
            instituteId={domainRouting.instituteId ?? undefined}
            onLoginSuccess={() => setAuthState("authenticated")}
            onNavigate={() => {}}
            successToastDescription={t("quickAccess.loadingToast")}
          />
        </div>
      </div>

      <div className="border-t bg-white">
        <div className="mx-auto px-4 py-4">
          <p className="text-center text-sm text-gray-500">
            {t("quickAccess.footer")}
          </p>
        </div>
      </div>
    </div>
  );
}
