import { useEffect } from "react";
import {
  ArrowSquareOut,
  CheckCircle,
  EnvelopeSimple,
  SpinnerGap,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { ModernCard } from "@/components/design-system/modern-card";
import { MyButton } from "@/components/design-system/button";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { RoleTerms, SystemTerms } from "@/types/naming-settings";
import { renderSafeLinkText } from "../-utils/safe-link-text";

/** Redirect delay — long enough to read the confirmation, short enough to feel instant. */
const REDIRECT_DELAY_MS = 1500;

/** Default admin portal when the institute hasn't configured one. */
const DEFAULT_ADMIN_PORTAL_URL = "https://dash.vacademy.io";

/** Only https URLs may drive the redirect/button (mirrors backend validation). */
const asHttpsUrl = (url?: string | null): string | null => {
  const trimmed = url?.trim();
  return trimmed && trimmed.startsWith("https://") ? trimmed : null;
};

interface CompletionPanelProps {
  orgName?: string | null;
  adminEmail?: string | null;
  /** Paid registration — payment was confirmed before completion. */
  paid?: boolean;
  /** Institute's admin portal base URL (default completion CTA target). */
  adminPortalUrl?: string | null;
  /** Template's custom completion message; inline links via [label](url). */
  completionMessage?: string | null;
  /** Template's custom completion button — label + url come as a pair. */
  completionButtonLabel?: string | null;
  completionButtonUrl?: string | null;
  /** When set, completion auto-redirects here (highest precedence). */
  completionRedirectUrl?: string | null;
}

/**
 * Shared completion experience for the sub-org registration wizard's success
 * step AND the /sub-org-registration/payment-result return page. Precedence:
 *   1. completionRedirectUrl set → brief confirmation, then auto-redirect;
 *   2. completionMessage / button set → custom message page;
 *   3. default → standard success copy + "Go to Admin Portal" button.
 */
const CompletionPanel = ({
  orgName,
  adminEmail,
  paid = false,
  adminPortalUrl,
  completionMessage,
  completionButtonLabel,
  completionButtonUrl,
  completionRedirectUrl,
}: CompletionPanelProps) => {
  const { t } = useTranslation("registrationB");
  const admin = getTerminology(RoleTerms.Admin, SystemTerms.Admin);
  const redirectUrl = asHttpsUrl(completionRedirectUrl);
  const buttonUrl = asHttpsUrl(completionButtonUrl);
  const buttonLabel = completionButtonLabel?.trim() || null;
  const message = completionMessage?.trim() || null;
  const hasCustomButton = !!(buttonUrl && buttonLabel);
  const portalUrl = asHttpsUrl(adminPortalUrl) ?? DEFAULT_ADMIN_PORTAL_URL;

  // Auto-redirect mode — replace() so Back doesn't bounce through this page.
  useEffect(() => {
    if (!redirectUrl) return;
    const timeoutId = window.setTimeout(() => {
      window.location.replace(redirectUrl);
    }, REDIRECT_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [redirectUrl]);

  if (redirectUrl) {
    return (
      <ModernCard
        variant="glass"
        padding="lg"
        rounded="lg"
        className="border border-white/40 bg-white/90 shadow-lg backdrop-blur-md"
      >
        <div className="space-y-4 py-10 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-success-50">
            <CheckCircle weight="fill" className="size-8 text-success-600" />
          </div>
          <p className="text-lg font-semibold text-neutral-700">
            {paid
              ? t("subOrgRegistration.completion.redirectingPaid")
              : t("subOrgRegistration.completion.redirectingFree")}
          </p>
          <SpinnerGap className="mx-auto size-6 animate-spin text-primary-500" />
        </div>
      </ModernCard>
    );
  }

  return (
    <ModernCard
      variant="glass"
      padding="lg"
      rounded="lg"
      className="border border-white/40 bg-white/90 shadow-lg backdrop-blur-md"
    >
      <div className="space-y-6 py-8 text-center">
        <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-success-50">
          <CheckCircle weight="fill" className="size-10 text-success-600" />
        </div>

        <div className="space-y-3">
          <h2 className="text-2xl font-bold text-neutral-700 sm:text-3xl">
            {paid
              ? t("subOrgRegistration.completion.paidTitle")
              : t("subOrgRegistration.completion.freeTitle")}
          </h2>
          {orgName && (
            <p className="text-lg text-neutral-600">
              <span className="font-semibold">{orgName}</span>{" "}
              {t("subOrgRegistration.completion.orgReadySuffix")}
            </p>
          )}

          {message || hasCustomButton ? (
            // Custom message page (institute-authored)
            <>
              {message && (
                <p className="mx-auto max-w-md whitespace-pre-line text-sm leading-relaxed text-neutral-600">
                  {renderSafeLinkText(message)}
                </p>
              )}
              {adminEmail && (
                <div className="mx-auto flex max-w-md items-start justify-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-start">
                  <EnvelopeSimple className="mt-0.5 size-5 flex-shrink-0 text-primary-500" />
                  <p className="text-sm text-neutral-600">
                    {t("subOrgRegistration.completion.credentialsSentPrefix")}{" "}
                    <span className="font-semibold text-neutral-700">
                      {adminEmail}
                    </span>
                    .
                  </p>
                </div>
              )}
            </>
          ) : (
            // Default completion copy
            <div className="mx-auto flex max-w-md items-start justify-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-start">
              <EnvelopeSimple className="mt-0.5 size-5 flex-shrink-0 text-primary-500" />
              <p className="text-sm text-neutral-600">
                {t("subOrgRegistration.completion.defaultPrefix")}{" "}
                <span className="font-semibold text-neutral-700">
                  {adminEmail}
                </span>
                .
              </p>
            </div>
          )}
        </div>

        {hasCustomButton ? (
          <MyButton
            type="button"
            buttonType="primary"
            scale="large"
            layoutVariant="default"
            onClick={() => {
              window.location.href = buttonUrl;
            }}
            className="min-w-32"
          >
            {buttonLabel}
            <ArrowSquareOut className="ms-2 size-4" />
          </MyButton>
        ) : message ? null : (
          <MyButton
            type="button"
            buttonType="primary"
            scale="large"
            layoutVariant="default"
            onClick={() => {
              window.location.href = portalUrl;
            }}
            className="min-w-32"
          >
            {t("subOrgRegistration.completion.goToAdminPortal", { admin })}
            <ArrowSquareOut className="ms-2 size-4" />
          </MyButton>
        )}
      </div>
    </ModernCard>
  );
};

export default CompletionPanel;
