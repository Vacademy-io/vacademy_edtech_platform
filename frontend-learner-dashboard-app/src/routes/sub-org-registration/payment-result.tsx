import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import {
  EnvelopeSimple,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { ModernCard } from "@/components/design-system/modern-card";
import {
  getTerminology,
} from "@/components/common/layout-container/sidebar/utils";
import { RoleTerms, SystemTerms } from "@/types/naming-settings";
import CompletionPanel from "./-components/completion-panel";
import { getSubOrgRegistrationStatus } from "./-services/sub-org-registration-services";

const POLL_INTERVAL_MS = 5000;
/** After ~3 minutes of polling, reassure the user that email is the fallback. */
const REASSURANCE_AFTER_MS = 3 * 60 * 1000;

/**
 * Gateways can duplicate params when appending to a return URL that already
 * has a query string — tolerate arrays by taking the first value. The router's
 * search parser also JSON-parses values, so numeric-looking ids arrive as
 * numbers — stringify them instead of failing validation.
 */
const firstString = z.preprocess((value) => {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first === "number" || typeof first === "boolean") {
    return String(first);
  }
  return first;
}, z.string().optional());

const paymentResultSearchSchema = z.object({
  instituteId: firstString,
  code: firstString,
  registrationId: firstString,
  orderId: firstString,
  /** Cashfree may append its own order id under this key. */
  order_id: firstString,
});

export const Route = createFileRoute("/sub-org-registration/payment-result")({
  validateSearch: paymentResultSearchSchema,
  component: PaymentResultPage,
});

interface StashedReturnContext {
  orderId?: string;
  registrationId?: string;
  instituteId?: string;
  code?: string;
}

/** Context stashed by the payment step before the gateway handoff. */
const readStashedContext = (key: string): StashedReturnContext | null => {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StashedReturnContext) : null;
  } catch {
    return null;
  }
};

/**
 * Return page for hosted-checkout vendors (Cashfree/PhonePe) in the sub-org
 * registration flow. Polls the public registration status every ~5s until the
 * webhook completes the registration, then renders the shared completion
 * panel (redirect / custom message / default admin-portal CTA).
 */
function PaymentResultPage() {
  const { t } = useTranslation("registrationB");
  const admin = getTerminology(RoleTerms.Admin, SystemTerms.Admin).toLocaleLowerCase();
  const search = Route.useSearch();

  // The gateway redirect can drop our query params — recover the registration
  // from the sessionStorage context stashed before the handoff (keyed by
  // orderId, with a fixed-key fallback when the orderId was dropped too).
  const registrationId = useMemo(() => {
    if (search.registrationId) return search.registrationId;
    const orderId = search.orderId ?? search.order_id;
    const stashed =
      (orderId ? readStashedContext(`sub_org_payment_${orderId}`) : null) ??
      readStashedContext("sub_org_payment_pending");
    return stashed?.registrationId || undefined;
  }, [search.registrationId, search.orderId, search.order_id]);

  const { data: status } = useQuery({
    queryKey: ["SUB_ORG_REGISTRATION_STATUS", registrationId],
    queryFn: () => getSubOrgRegistrationStatus(registrationId ?? ""),
    enabled: !!registrationId,
    // Transient failures must not stop the confirmation — refetchInterval
    // keeps polling through error states until the registration completes.
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === "COMPLETED" ? false : POLL_INTERVAL_MS,
  });

  const isCompleted = status?.status === "COMPLETED";

  const [showReassurance, setShowReassurance] = useState(false);
  useEffect(() => {
    if (isCompleted) return;
    const timeoutId = window.setTimeout(
      () => setShowReassurance(true),
      REASSURANCE_AFTER_MS
    );
    return () => window.clearTimeout(timeoutId);
  }, [isCompleted]);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-neutral-50 to-primary-50 px-4 py-8">
      <div className="w-full max-w-2xl">
        {isCompleted && status ? (
          <CompletionPanel
            orgName={status.org_name}
            adminEmail={status.admin_email}
            paid
            adminPortalUrl={status.admin_portal_url}
            completionMessage={status.completion_message}
            completionButtonLabel={status.completion_button_label}
            completionButtonUrl={status.completion_button_url}
            completionRedirectUrl={status.completion_redirect_url}
          />
        ) : !registrationId ? (
          // Irrecoverable — no params and no stashed context (e.g. a different
          // browser). The payment itself is safe: completion emails credentials.
          <ModernCard
            variant="glass"
            padding="lg"
            rounded="lg"
            className="border border-white/40 bg-white/90 shadow-lg backdrop-blur-md"
          >
            <div className="space-y-4 py-6 text-center">
              <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-warning-50">
                <WarningCircle className="size-8 text-warning-600" />
              </div>
              <h1 className="text-xl font-semibold text-neutral-700">
                {t("subOrgRegistration.paymentResult.notFoundTitle")}
              </h1>
              <p className="mx-auto max-w-md text-sm text-neutral-500">
                {t("subOrgRegistration.paymentResult.notFoundDescription", {
                  admin,
                })}
              </p>
              <p className="text-caption text-neutral-400">
                {t("subOrgRegistration.paymentResult.notFoundEmailHint")}
              </p>
            </div>
          </ModernCard>
        ) : (
          // Waiting — the payment webhook completes the registration server-side.
          <ModernCard
            variant="glass"
            padding="lg"
            rounded="lg"
            className="border border-white/40 bg-white/90 shadow-lg backdrop-blur-md"
          >
            <div className="space-y-5 py-8 text-center">
              <SpinnerGap className="mx-auto size-10 animate-spin text-primary-500" />
              <div className="space-y-2">
                <h1 className="text-xl font-semibold text-neutral-700">
                  {t("subOrgRegistration.paymentResult.waitingTitle")}
                </h1>
                <p className="mx-auto max-w-md text-sm text-neutral-500">
                  {t("subOrgRegistration.paymentResult.waitingDescription")}
                </p>
              </div>
              {showReassurance && (
                <div className="mx-auto flex max-w-md items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-start">
                  <EnvelopeSimple className="mt-0.5 size-5 flex-shrink-0 text-primary-500" />
                  <p className="text-sm text-neutral-600">
                    {t("subOrgRegistration.paymentResult.reassurancePrefix")}
                    {status?.admin_email ? (
                      <>
                        {" "}
                        {t("subOrgRegistration.paymentResult.reassuranceTo")}{" "}
                        <span className="font-semibold text-neutral-700">
                          {status.admin_email}
                        </span>
                      </>
                    ) : (
                      " " +
                      t(
                        "subOrgRegistration.paymentResult.reassuranceToAdminEmail",
                        { admin }
                      )
                    )}
                    .
                  </p>
                </div>
              )}
            </div>
          </ModernCard>
        )}
      </div>
    </div>
  );
}
