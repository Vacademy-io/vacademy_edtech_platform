import { createFileRoute, useRouter, redirect } from "@tanstack/react-router";
import { z } from "zod";
import EnrollByInvite from "@/components/common/enroll-by-invite/enroll-form";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import { hasActiveLearnerSession } from "@/lib/auth/sessionUtility";
import { useSuspenseQuery } from "@tanstack/react-query";
import { handleGetEnrollInviteData } from "@/components/common/enroll-by-invite/-services/enroll-invite-services";
import { PaymentGatewayWrapper } from "@/components/common/enroll-by-invite/-components/payment-gateway-wrapper";
import { getPaymentVendor } from "@/components/common/enroll-by-invite/-utils/payment-vendor-helper";
import { LinkBreak, CreditCard, Warning, ClipboardText } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { InviteUnavailableMessage } from "@/components/common/enroll-by-invite/-components/InviteUnavailableMessage";
import {
  resolveInviteAvailability,
  extractUnavailableMessageHtml,
  type InviteAvailability,
} from "@/lib/invite-availability";

const inviteParamsSchema = z.object({
  instituteId: z.string().uuid(),
  inviteCode: z.string(),
  ref: z.string().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_content: z.string().optional(),
  utm_term: z.string().optional(),
});

function InviteNotFoundPage() {
  const { t } = useTranslation("miscRoutesB");
  const router = useRouter();
  return (
    <div className="h-screen w-full bg-gray-50 flex flex-col justify-center items-center px-4">
      <div className="max-w-md mx-auto text-center w-full">
        <div className="mb-8 flex justify-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-orange-100 border-4 border-white shadow-sm">
            <LinkBreak className="h-12 w-12 text-orange-500" aria-hidden="true" />
          </div>
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
          {t("learnerInvitationResponse.notFound.title")}
        </h1>
        <p className="mt-4 text-base text-gray-500 max-w-sm mx-auto">
          {t("learnerInvitationResponse.notFound.description")}
        </p>
        <div className="mt-8">
          <button
            onClick={() => router.history.back()}
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
          >
            {t("learnerInvitationResponse.goBack")}
          </button>
        </div>
      </div>
    </div>
  );
}

function PaymentGatewayNotConfiguredPage() {
  const { t } = useTranslation("miscRoutesB");
  const router = useRouter();
  return (
    <div className="h-screen w-full bg-gray-50 flex flex-col justify-center items-center px-4">
      <div className="max-w-md mx-auto text-center w-full">
        <div className="mb-8 flex justify-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-blue-100 border-4 border-white shadow-sm">
            <CreditCard className="h-12 w-12 text-blue-500" aria-hidden="true" />
          </div>
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
          {t("learnerInvitationResponse.gatewayNotConfigured.title")}
        </h1>
        <p className="mt-4 text-base text-gray-500 max-w-sm mx-auto">
          {t("learnerInvitationResponse.gatewayNotConfigured.description")}
        </p>
        <div className="mt-8">
          <button
            onClick={() => router.history.back()}
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
          >
            {t("learnerInvitationResponse.goBack")}
          </button>
        </div>
      </div>
    </div>
  );
}

function NoEnrollmentPlansPage() {
  const { t } = useTranslation("miscRoutesB");
  const router = useRouter();
  return (
    <div className="h-screen w-full bg-gray-50 flex flex-col justify-center items-center px-4">
      <div className="max-w-md mx-auto text-center w-full">
        <div className="mb-8 flex justify-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-amber-100 border-4 border-white shadow-sm">
            <ClipboardText className="h-12 w-12 text-amber-500" aria-hidden="true" />
          </div>
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
          {t("learnerInvitationResponse.noPlans.title")}
        </h1>
        <p className="mt-4 text-base text-gray-500 max-w-sm mx-auto">
          {t("learnerInvitationResponse.noPlans.description")}
        </p>
        <div className="mt-8">
          <button
            onClick={() => router.history.back()}
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
          >
            {t("learnerInvitationResponse.goBack")}
          </button>
        </div>
      </div>
    </div>
  );
}

function UnexpectedErrorPage() {
  const { t } = useTranslation("miscRoutesB");
  const router = useRouter();
  return (
    <div className="h-screen w-full bg-gray-50 flex flex-col justify-center items-center px-4">
      <div className="max-w-md mx-auto text-center w-full">
        <div className="mb-8 flex justify-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-red-100 border-4 border-white shadow-sm">
            <Warning className="h-12 w-12 text-red-500" aria-hidden="true" />
          </div>
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
          {t("learnerInvitationResponse.unexpectedError.title")}
        </h1>
        <p className="mt-4 text-base text-gray-500 max-w-sm mx-auto">
          {t("learnerInvitationResponse.unexpectedError.description")}
        </p>
        <div className="mt-8">
          <button
            onClick={() => router.history.back()}
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
          >
            {t("learnerInvitationResponse.goBack")}
          </button>
        </div>
      </div>
    </div>
  );
}

function InviteUnavailablePage({
  availability,
  messageHtml,
}: {
  availability: InviteAvailability;
  messageHtml: string;
}) {
  const { t } = useTranslation("miscRoutesB");
  const router = useRouter();
  return (
    <div className="h-screen w-full bg-gray-50 flex flex-col justify-center items-center px-4">
      <div className="max-w-md mx-auto w-full">
        <InviteUnavailableMessage availability={availability} messageHtml={messageHtml} />
        <div className="mt-8 flex justify-center">
          <button
            onClick={() => router.history.back()}
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
          >
            {t("learnerInvitationResponse.goBack")}
          </button>
        </div>
      </div>
    </div>
  );
}

function InviteErrorComponent({ error }: { error: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const axiosError = error as any;
  const status = axiosError?.response?.status;
  const errorMessage: string = axiosError?.response?.data?.ex ?? "";

  if (status === 510 || status === 404) {
    if (errorMessage.toLowerCase().includes("configurar") || errorMessage.toLowerCase().includes("payment gateway")) {
      return <PaymentGatewayNotConfiguredPage />;
    }
    return <InviteNotFoundPage />;
  }
  return <UnexpectedErrorPage />;
}

export const Route = createFileRoute("/learner-invitation-response/")({
  validateSearch: inviteParamsSchema,
  // Reader mode (iOS always / reader-mode institutes): the enroll-by-invite
  // flow contains paid plan selection + external payment gateways + "Upgrade
  // Now" redirects across many sub-steps. Block the whole route so none of it
  // can render (Apple 3.1.1). Mirrors the $tagName marketplace guards.
  beforeLoad: async () => {
    if (shouldHidePaidPurchaseUI()) {
      // /dashboard is auth-only: sending a logged-OUT learner there bounces
      // back to the institute landing route, which is reader-blocked again —
      // an infinite loop that hangs the app on the boot splash. See
      // hasActiveLearnerSession().
      throw redirect({
        to: (await hasActiveLearnerSession()) ? "/dashboard" : "/login",
      });
    }
  },
  component: RouteComponent,
  errorComponent: ({ error }) => <InviteErrorComponent error={error} />,
});

function RouteComponent() {
  const { instituteId, inviteCode, utm_source, utm_medium, utm_campaign, utm_content, utm_term } = Route.useSearch();
  const utmParams = Object.fromEntries(
    Object.entries({ utm_source, utm_medium, utm_campaign, utm_content, utm_term }).filter(([, v]) => v !== undefined)
  ) as Record<string, string>;

  // Fetch invite details FIRST to determine payment vendor
  const { data: inviteData } = useSuspenseQuery(
    handleGetEnrollInviteData({ instituteId, inviteCode })
  );

  // Guard: invite is expired / not-yet-started / deactivated. The backend now returns the
  // invite (instead of a 510) for these states so we can render the admin's rich message from
  // setting_json here. Enrollment itself is still blocked server-side.
  const availability = resolveInviteAvailability(inviteData?.availability_status);
  if (availability !== "AVAILABLE") {
    return (
      <InviteUnavailablePage
        availability={availability}
        messageHtml={extractUnavailableMessageHtml(inviteData?.setting_json)}
      />
    );
  }

  // Guard: invite exists but has no payment plans attached. Without this, the
  // form would crash downstream trying to read payment_option_metadata_json off
  // an undefined paymentOption (see enroll-form.tsx ~L321 / helper.ts L294).
  const hasPaymentOption = Boolean(
    inviteData?.package_session_to_payment_options?.[0]?.payment_option
  );
  if (!hasPaymentOption) {
    return <NoEnrollmentPlansPage />;
  }

  // Determine which payment gateway to use based on invite data
  const paymentVendor = getPaymentVendor(inviteData);
  return (
    <PaymentGatewayWrapper vendor={paymentVendor} instituteId={instituteId}>
      <EnrollByInvite vendor={paymentVendor} utmParams={utmParams} />
    </PaymentGatewayWrapper>
  );
}