import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { removeTokensAndLogout } from "@/lib/auth/sessionUtility";
import { pushNotificationService } from "@/services/push-notifications/push-notification-service";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { useDripConditionStore } from "@/stores/study-library/drip-conditions-store";

export const Route = createFileRoute("/logout/")({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    return {
      redirect:
        typeof search.redirect === "string" ? search.redirect : undefined,
    };
  },
});

function RouteComponent() {
  const { t } = useTranslation("miscRoutesB");
  const domainRouting = useDomainRouting();
  const { redirect } = Route.useSearch();
  const { clearAll } = useDripConditionStore();
  const [cleared, setCleared] = useState(false);

  // Clear all client-side session data once on mount, then mark as cleared.
  useEffect(() => {
    let active = true;
    void (async () => {
      clearAll(); // reset in-memory drip-conditions store
      pushNotificationService.deactivateToken().catch(() => {});
      await removeTokensAndLogout(); // wipes cookies, storage and caches
      if (active) setCleared(true);
    })();
    return () => {
      active = false;
    };
  }, [clearAll]);

  // Once everything is cleared and domain routing has resolved, hard-redirect
  // (full reload) so in-memory caches (React Query, Zustand) are dropped too.
  useEffect(() => {
    if (!cleared) return;

    // Prefer explicit redirect param if provided.
    if (redirect && typeof redirect === "string") {
      window.location.assign(redirect);
      return;
    }

    // Wait until domain routing finishes resolving to avoid defaulting to /login prematurely.
    if (domainRouting.isLoading) return;

    window.location.assign(domainRouting.redirectPath || "/login");
  }, [cleared, redirect, domainRouting.isLoading, domainRouting.redirectPath]);

  return <div>{t("logout.loggingOut")}</div>;
}
