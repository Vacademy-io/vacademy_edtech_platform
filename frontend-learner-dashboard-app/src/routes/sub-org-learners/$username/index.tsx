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

export const Route = createFileRoute("/sub-org-learners/$username/")({
  component: RouteComponent,
});

/**
 * Passwordless landing for sub-org admins: `/sub-org-learners/<username>`
 * signs the user in (trusted login via SessionLoginForm, or the `?lc=` login
 * code when the institute requires one) and opens `/sub-org-learners`.
 *
 * Same shape as `/go/<username>`, only the destination differs. A visitor who
 * is already signed in goes straight to `/sub-org-learners`, which checks the
 * sub-org admin access itself.
 */
function RouteComponent() {
  const { t } = useTranslation("miscRoutesB");
  const params = Route.useParams();
  const domainRouting = useDomainRouting();
  const navigate = useNavigate();

  // Params can be momentarily undefined during SPA navigation — fall back to
  // parsing the URL. Decoded, because usernames are often emails (%40).
  let username = params.username || "";
  if (!username) {
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 2 && pathParts[0] === "sub-org-learners") {
      try {
        username = decodeURIComponent(pathParts[1] || "");
      } catch {
        username = pathParts[1] || "";
      }
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

  // One navigation path for both the already-signed-in visitor and the one who
  // just completed login, so SessionLoginForm's own navigation is suppressed
  // via a no-op onNavigate below.
  useEffect(() => {
    if (authState === "authenticated") {
      navigate({ to: "/sub-org-learners" });
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
          {/* instituteId optional on purpose, as on /go/<username>: a shared
              domain has no domain-routing row and the username alone is enough
              to look the user up. */}
          <SessionLoginForm
            linkRoute="SUB_ORG_LEARNERS"
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
