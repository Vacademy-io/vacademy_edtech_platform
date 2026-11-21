import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CheckCircle, SpinnerGap, Warning } from "@phosphor-icons/react";

import { AuthPageBranding } from "@/components/common/institute-branding";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { MyButton } from "@/components/design-system/button";
import { completeRenewalPayment } from "@/components/common/user-profile/payment-billing/subscription-services";

/**
 * Where the gateway's hosted card page sends the learner back to.
 *
 * <p>The outcome is NOT read from this URL. The gateway appends its own parameters and the
 * learner can edit them, so the page hands the order id to the backend and the backend asks
 * the gateway what actually happened. All this route decides is what to show while that
 * answer comes back.
 */
export const Route = createFileRoute("/subscriptions/payment-return/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation("miscRoutesB");
  const domainRouting = useDomainRouting();
  const [state, setState] = useState<"confirming" | "paid" | "failed">("confirming");
  const [detail, setDetail] = useState<string | null>(null);
  // Strict mode mounts effects twice in development; confirming twice is harmless on the
  // server (the claim is idempotent) but would flicker the UI, so guard it here too.
  const started = useRef(false);

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get("orderId") ?? "";
  const userPlanId = params.get("userPlanId") ?? "";
  const cancelled = params.get("cancelled") === "true";

  useEffect(() => {
    if (started.current || domainRouting.isLoading) return;
    started.current = true;

    if (cancelled) {
      setState("failed");
      setDetail(t("subscriptions.paymentReturn.cancelled"));
      return;
    }
    if (!orderId || !userPlanId || !domainRouting.instituteId) {
      setState("failed");
      setDetail(t("subscriptions.paymentReturn.missingReference"));
      return;
    }

    completeRenewalPayment(domainRouting.instituteId, userPlanId, orderId)
      .then((response) => {
        const data = response?.payment_response?.response_data || response?.response_data;
        const status = String(data?.paymentStatus ?? "").toUpperCase();
        if (status === "PAID") {
          setState("paid");
        } else {
          setState("failed");
          setDetail(data?.reason ?? null);
        }
      })
      .catch((e) => {
        setState("failed");
        setDetail(e instanceof Error ? e.message : null);
      });
  }, [domainRouting.isLoading, domainRouting.instituteId, orderId, userPlanId, cancelled, t]);

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

      <div className="flex flex-1 items-start justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 text-center">
          {state === "confirming" && (
            <>
              <SpinnerGap className="mx-auto mb-3 size-8 animate-spin text-primary-500" />
              <h2 className="text-lg font-semibold text-gray-900">
                {t("subscriptions.paymentReturn.confirmingTitle")}
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                {t("subscriptions.paymentReturn.confirmingBody")}
              </p>
            </>
          )}

          {state === "paid" && (
            <>
              <CheckCircle className="mx-auto mb-3 size-8 text-success-600" weight="fill" />
              <h2 className="text-lg font-semibold text-gray-900">
                {t("subscriptions.paymentReturn.paidTitle")}
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                {t("subscriptions.paymentReturn.paidBody")}
              </p>
            </>
          )}

          {state === "failed" && (
            <>
              <Warning className="mx-auto mb-3 size-8 text-warning-600" weight="fill" />
              <h2 className="text-lg font-semibold text-gray-900">
                {t("subscriptions.paymentReturn.failedTitle")}
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                {detail ?? t("subscriptions.paymentReturn.failedBody")}
              </p>
            </>
          )}

          {state !== "confirming" && (
            <MyButton
              type="button"
              scale="small"
              buttonType="primary"
              layoutVariant="default"
              className="mt-5"
              onClick={() => {
                window.location.href = "/subscriptions";
              }}
            >
              {t("subscriptions.paymentReturn.backToMembership")}
            </MyButton>
          )}
        </div>
      </div>
    </div>
  );
}
