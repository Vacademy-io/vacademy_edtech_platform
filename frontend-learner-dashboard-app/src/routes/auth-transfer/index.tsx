import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/auth-transfer/")({
  component: AuthTransferComponent,
});

/**
 * Landing route when redirecting from teacher portal with tokens in URL.
 * __root beforeLoad handles ?accessToken=...&refreshToken=... and redirects;
 * this component only renders if no tokens are present (e.g. after redirect).
 */
function AuthTransferComponent() {
  const { t } = useTranslation("miscRoutesB");
  return (
    <div className="flex min-h-screen-40 items-center justify-center">
      <p className="text-muted-foreground">{t("authTransfer.signingIn")}</p>
    </div>
  );
}
