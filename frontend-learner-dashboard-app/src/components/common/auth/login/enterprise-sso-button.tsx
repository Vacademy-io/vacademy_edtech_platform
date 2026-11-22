import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Buildings, WarningCircle } from "@phosphor-icons/react";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import {
  autoRedirectSkipped,
  discoverSso,
  readSsoError,
  skipAutoRedirect,
  startSso,
  type SsoDiscovery,
  type SsoErrorCode,
} from "@/lib/auth/enterprise-sso";

type Props = {
  instituteId: string | null | undefined;
  /** Path to land on after sign-in (e.g. the login page's ?redirect=). */
  returnPath?: string | null;
  className?: string;
};

/**
 * "Sign in with <company>" for an institute that signs learners in through its own
 * identity provider. Renders nothing when the institute has no SSO. With
 * auto-redirect on, it sends the learner straight to the provider unless they came
 * back with an error or chose another way to sign in.
 *
 * Web only for now: the native apps open sign-in in the system browser and need
 * an app link to come back, which this flow does not have yet.
 */
export function EnterpriseSsoButton({ instituteId, returnPath, className }: Props) {
  const { t } = useTranslation("auth");
  const [sso, setSso] = useState<SsoDiscovery | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [error] = useState<SsoErrorCode | null>(() =>
    typeof window === "undefined" ? null : readSsoError(),
  );

  useEffect(() => {
    if (!instituteId || Capacitor.isNativePlatform()) return;
    const ssoParam = new URLSearchParams(window.location.search).get("sso");
    // /login?sso=off keeps the other sign-in methods reachable (staff, support).
    if (ssoParam === "off") {
      skipAutoRedirect();
    }
    // /login?sso=start: the backend sent a sign-in started elsewhere (the provider's app
    // launcher) here so this tab can start it again, tied to itself.
    const startNow = ssoParam === "start" && !error;
    let cancelled = false;
    void discoverSso(instituteId).then((value) => {
      if (cancelled) return;
      setSso(value);
      if (value.enabled && (startNow || (value.autoRedirect && !error && !autoRedirectSkipped()))) {
        setRedirecting(true);
        void startSso(instituteId, returnPath);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [instituteId, returnPath, error]);

  if (!instituteId || !sso?.enabled) {
    return error ? <SsoErrorNotice code={error} /> : null;
  }

  const name = sso.displayName || t("enterpriseSso.yourOrganisation");

  return (
    <div className={cn("grid gap-2", className)}>
      {error && <SsoErrorNotice code={error} />}
      <Button
        type="button"
        className="h-11 w-full"
        disabled={redirecting}
        onClick={() => {
          setRedirecting(true);
          void startSso(instituteId, returnPath);
        }}
      >
        <Buildings className="me-2 size-4" weight="bold" aria-hidden="true" />
        {redirecting
          ? t("enterpriseSso.redirecting", { name })
          : t("enterpriseSso.signInWith", { name })}
      </Button>
      {sso.autoRedirect && (
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-sm text-muted-foreground"
          onClick={() => {
            skipAutoRedirect();
            setRedirecting(false);
          }}
        >
          {t("enterpriseSso.useAnotherWay")}
        </Button>
      )}
    </div>
  );
}

function SsoErrorNotice({ code }: { code: SsoErrorCode }) {
  const { t } = useTranslation("auth");
  return (
    <Alert variant="destructive" role="alert">
      <WarningCircle className="size-4" aria-hidden="true" />
      <AlertDescription>{t(`enterpriseSso.errors.${code}`)}</AlertDescription>
    </Alert>
  );
}
