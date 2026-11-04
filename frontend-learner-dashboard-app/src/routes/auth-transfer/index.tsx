import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { hasArrivalTokens } from "@/lib/auth/arrival-tokens";

export const Route = createFileRoute("/auth-transfer/")({
  component: AuthTransferComponent,
});

/**
 * Landing route when redirecting from teacher portal with tokens in URL.
 * __root beforeLoad handles ?accessToken=...&refreshToken=... and redirects.
 * With no tokens to use (e.g. the page was reloaded), this page has nothing to
 * wait for, so it hands over to "/", which routes by sign-in state.
 */
function AuthTransferComponent() {
  const { t } = useTranslation("miscRoutesB");
  const navigate = useNavigate();

  useEffect(() => {
    if (!hasArrivalTokens()) void navigate({ to: "/", replace: true });
  }, [navigate]);

  return (
    <div className="flex min-h-screen-40 items-center justify-center">
      <p className="text-muted-foreground">{t("authTransfer.signingIn")}</p>
    </div>
  );
}
