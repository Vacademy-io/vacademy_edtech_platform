import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPaymentCompletionStatus } from "@/components/common/enroll-by-invite/-services/enroll-invite-services";
import { getCashfreePaymentStatus } from "@/services/cashfree-payment";
import { getPhonePePaymentStatus } from "@/services/phonepe-payment";
import { performFullAuthCycle } from "@/services/auth-cycle-service";
import { loginEnrolledUser } from "@/services/signup-api";
import { getAccessToken } from "@/lib/auth/sessionUtility";
import { CheckCircle, XCircle, SpinnerGap } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { BASE_URL_LEARNER_DASHBOARD } from "@/constants/urls";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { settlePendingPurchase } from "@/routes/$tagName/-components/site-cart/pending-purchases";

const paymentResultSearchSchema = z.object({
  orderId: z.string().optional(),
  order_id: z.string().optional(), // Cashfree may append this; prefer orderId (payment log ID)
  instituteId: z.string().optional(),
  institute_id: z.string().optional(), // snake_case fallback
  status: z.enum(["success", "failed", "cancelled"]).optional(),
  source: z.string().optional(), // "invoice" skips gateway-specific status polling
  vendor: z.string().optional(), // "PHONEPE" routes to the PhonePe status endpoint
  redirect: z.string().optional(), // in-app path to continue to after a successful payment
});

export const Route = createFileRoute("/payment-result/")({
  validateSearch: paymentResultSearchSchema,
  component: PaymentResultPage,
});

function isValidInstituteId(id: string | undefined): id is string {
  return !!(id && id !== "null" && id.trim() !== "");
}

function PaymentResultPage() {
  const { t } = useTranslation("miscRoutesB");
  const search = Route.useSearch();
  const {
    orderId: orderIdParam,
    order_id: orderIdSnake,
    instituteId: instituteIdParam,
    institute_id: instituteIdSnake,
    status: queryStatus,
    source,
    vendor: vendorParam,
    redirect: redirectPath,
  } = search;

  // Only allow in-app relative paths — never absolute URLs — as continue targets.
  const safeRedirectPath =
    redirectPath && redirectPath.startsWith("/") && !redirectPath.startsWith("//")
      ? redirectPath
      : undefined;

  const isPhonePeFlow = (vendorParam ?? "").toUpperCase() === "PHONEPE";

  // PhonePe redirects can land here without the query params (some return modes
  // drop them). Recover the order id + institute id we stashed before handing off
  // to PhonePe's hosted page.
  const phonePePending = useMemo(() => {
    if (!isPhonePeFlow || typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem("phonepe_pending_order");
      return raw
        ? (JSON.parse(raw) as { orderId?: string; instituteId?: string })
        : null;
    } catch {
      return null;
    }
  }, [isPhonePeFlow]);

  // Prefer orderId (payment log ID) from our return URL; order_id may be Cashfree's ID
  const orderId =
    orderIdParam ?? orderIdSnake ?? phonePePending?.orderId ?? "";
  const instituteId =
    instituteIdParam ?? instituteIdSnake ?? phonePePending?.instituteId;
  const validInstituteId = isValidInstituteId(instituteId) ? instituteId : undefined;
  // Invoice payments must not use the Cashfree user-plan status endpoint
  const isInvoicePayment = source === "invoice";
  const isCashfreeFlow =
    !isPhonePeFlow && !!orderId && !!validInstituteId && !isInvoicePayment;
  const hasRedirectedRef = useRef(false);

  // Extract status from various backend response shapes (payment_status, status, paymentStatus, nested)
  const getStatusFromResponse = (data: unknown): string | undefined => {
    if (!data || typeof data !== "object") return undefined;
    const d = data as Record<string, unknown>;
    const rd = d.response_data as Record<string, unknown> | undefined;
    const inner = (d.data ?? d.result) as Record<string, unknown> | undefined;
    const raw =
      (d.payment_status as string) ??
      (d.status as string) ??
      (d.paymentStatus as string) ??
      (rd?.payment_status as string) ??
      (rd?.status as string) ??
      (rd?.paymentStatus as string) ??
      (inner?.payment_status as string) ??
      (inner?.status as string) ??
      (inner?.paymentStatus as string);
    return typeof raw === "string" ? raw.toUpperCase() : undefined;
  };

  const { data: paymentStatus, isLoading } = useQuery({
    queryKey: isPhonePeFlow
      ? ["PHONEPE_PAYMENT_STATUS", orderId, validInstituteId]
      : isCashfreeFlow
        ? ["CASHFREE_PAYMENT_STATUS", orderId, validInstituteId]
        : ["GET_PAYMENT_COMPLETION_STATUS", orderId],
    queryFn: () =>
      isPhonePeFlow && orderId && validInstituteId
        ? getPhonePePaymentStatus(orderId, validInstituteId)
        : isCashfreeFlow && orderId && validInstituteId
          ? getCashfreePaymentStatus(orderId, validInstituteId)
          : getPaymentCompletionStatus({ paymentLogId: orderId || "" }),
    enabled: !!orderId,
    refetchInterval: (query) => {
      const ps = getStatusFromResponse(query.state.data);
      if (
        ps === "PAID" ||
        ps === "SUCCESS" ||
        ps === "COMPLETED" ||
        ps === "FLAGGED" ||
        ps === "FAILED"
      )
        return false;
      // Poll less frequently to reduce backend load
      return 12000; // 8 seconds
    },
  });

  const paymentStatusValue = getStatusFromResponse(paymentStatus);
  const isPaid =
    paymentStatusValue === "PAID" ||
    paymentStatusValue === "SUCCESS" ||
    paymentStatusValue === "COMPLETED" ||
    paymentStatusValue === "FLAGGED";
  const isFailed =
    paymentStatusValue === "FAILED" ||
    paymentStatusValue === "CANCELLED" ||
    paymentStatusValue === "USER_DROPPED" ||
    queryStatus === "failed" ||
    queryStatus === "cancelled";
  const isPending = !isPaid && !isFailed && (!!orderId || isLoading);

  // Site-wide cart: a product-page checkout that left for a redirect gateway
  // noted what it was buying (see site-cart/pending-purchases). Once the
  // gateway settles, paid courses leave the cart; a failed payment only drops
  // the note so the courses stay ready to retry. A no-op without such a note.
  // Only the SERVER's status settles a note: the ?status= hint in the return
  // URL can say failed/cancelled while the payment is still in flight, and
  // dropping the note on it would leave a later PAID nothing to clear.
  const serverSaysFailed =
    paymentStatusValue === "FAILED" ||
    paymentStatusValue === "CANCELLED" ||
    paymentStatusValue === "USER_DROPPED";
  useEffect(() => {
    if (!orderId || isInvoicePayment) return;
    if (isPaid) void settlePendingPurchase(orderId, "paid");
    else if (serverSaysFailed) void settlePendingPurchase(orderId, "failed");
  }, [orderId, isInvoicePayment, isPaid, serverSaysFailed]);

  // Invoice payments: just show the success screen, no enrollment redirect.
  // The invoice page is public; the learner may not have a dashboard session.

  // Invoice payment with an in-app continue target (e.g. a paid live class):
  // hand the user straight back — the target page resumes into the session.
  useEffect(() => {
    if (!isPaid || !isInvoicePayment || !safeRedirectPath) return;
    if (hasRedirectedRef.current) return;
    hasRedirectedRef.current = true;
    const timer = setTimeout(() => {
      window.location.href = `${window.location.origin}${safeRedirectPath}`;
    }, 1500);
    return () => clearTimeout(timer);
  }, [isPaid, isInvoicePayment, safeRedirectPath]);

  // When payment is successful: auto-login via tokens from status API, or fallback to stored creds + login API
  useEffect(() => {
    if (!isPaid || hasRedirectedRef.current || isInvoicePayment) return;

    // PhonePe order is settled — drop the pending marker so a later visit doesn't
    // resurrect a stale order id.
    if (isPhonePeFlow && typeof window !== "undefined") {
      try {
        localStorage.removeItem("phonepe_pending_order");
      } catch {
        /* ignore */
      }
    }

    const doRedirect = (path = "/study-library/courses") => {
      if (hasRedirectedRef.current) return;
      hasRedirectedRef.current = true;
      const base =
        typeof window !== "undefined"
          ? window.location.origin
          : BASE_URL_LEARNER_DASHBOARD;
      window.location.href = `${base}${path}`;
    };

    const data = paymentStatus as {
      accessToken?: string;
      access_token?: string;
      refreshToken?: string;
      refresh_token?: string;
      user?: { email?: string; username?: string; password?: string };
      response_data?: {
        accessToken?: string;
        access_token?: string;
        refreshToken?: string;
        refresh_token?: string;
        institute_id?: string;
      };
      institute_id?: string;
    };
    const instituteIdFromApi =
      data?.institute_id ?? data?.response_data?.institute_id;
    const effectiveInstituteId =
      validInstituteId ?? (typeof instituteIdFromApi === "string" && instituteIdFromApi ? instituteIdFromApi : undefined);

    // Tokens from status API (legacy fallback – if backend still returns them)
    const accessToken =
      data?.accessToken ??
      data?.access_token ??
      data?.response_data?.accessToken ??
      data?.response_data?.access_token;
    const refreshToken =
      data?.refreshToken ??
      data?.refresh_token ??
      data?.response_data?.refreshToken ??
      data?.response_data?.refresh_token;
    const userEmail = data?.user?.email ?? data?.user?.username;
    const userPassword = data?.user?.password;

    const runLoginAndRedirect = async () => {
      try {
        // Get stored credentials from enrollment (catalog or learner-invitation)
        const credsFromStorage = orderId
          ? (() => {
              try {
                const raw = sessionStorage.getItem(
                  `enroll_payment_creds_${orderId}`
                );
                if (!raw) return null;
                const parsed = JSON.parse(raw) as {
                  username?: string;
                  password?: string;
                };
                sessionStorage.removeItem(`enroll_payment_creds_${orderId}`);
                return parsed;
              } catch {
                return null;
              }
            })()
          : null;

        // Prefer stored credentials (from enrollment API), fallback to status response
        const username = credsFromStorage?.username ?? userEmail ?? "";
        const password = credsFromStorage?.password ?? userPassword ?? "";

        // 1. Primary flow: Use stored credentials + standard login API (catalog & learner-invitation)
        if (username && password && effectiveInstituteId) {
          const loginResponse = await loginEnrolledUser(
            username,
            password,
            effectiveInstituteId
          );
          await performFullAuthCycle(loginResponse, effectiveInstituteId);
          doRedirect("/study-library/courses");
          return;
        }

        // 2. Legacy fallback: tokens in status response (if backend still returns them)
        if (effectiveInstituteId && accessToken && refreshToken) {
          await performFullAuthCycle(
            { accessToken, refreshToken },
            effectiveInstituteId
          );
          doRedirect("/study-library/courses");
          return;
        }

        // 3. Already-authenticated learner (e.g. an in-course purchase from the
        //    course-details flow, where no signup creds are ever stashed): their
        //    session is already live, so skip login and go straight to courses
        //    instead of bouncing them to /login.
        const existingToken = await getAccessToken();
        if (existingToken) {
          doRedirect("/study-library/courses");
          return;
        }
      } catch {
        /* login failed, fallback to login page */
      }
      doRedirect("/login?redirect=/study-library/courses");
    };

    runLoginAndRedirect();
  }, [isPaid, paymentStatus, orderId, validInstituteId, isPhonePeFlow]);

  const useFullScreenLayout = isPending || isPaid;

  return (
    <div className="min-h-screen w-full bg-gray-50 flex items-center justify-center p-4">
      <div
        className={
          useFullScreenLayout
            ? "w-full min-h-screen flex flex-col items-center justify-center"
            : "max-w-md w-full bg-white rounded-lg shadow-md p-8 text-center"
        }
      >
        {!orderId ? (
          <>
            <div className="mx-auto w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-4">
              <XCircle className="w-10 h-10 text-amber-600" />
            </div>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">
              {t("paymentResult.invalidLink.title")}
            </h1>
            <p className="text-gray-600 mb-6">
              {t("paymentResult.invalidLink.description")}
            </p>
          </>
        ) : isPaid ? (
          <div className="w-full flex flex-col items-center justify-center text-center px-6">
            <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <CheckCircle className="w-10 h-10 text-green-600" />
            </div>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">
              {t("paymentResult.success.title")}
            </h1>
            {isInvoicePayment ? (
              <p className="text-gray-600 mb-6">
                {t("paymentResult.success.invoiceDescription")}
              </p>
            ) : (
              <p className="text-gray-600 mb-6">
                {t("paymentResult.success.enrollmentDescription", {
                  courses: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course),
                })}
              </p>
            )}
            {isInvoicePayment && safeRedirectPath ? (
              <>
                <p className="text-gray-600 mb-2">
                  {t("paymentResult.success.takingToLiveClass", {
                    liveClass: getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession),
                  })}
                </p>
                <a
                  href={
                    typeof window !== "undefined"
                      ? `${window.location.origin}${safeRedirectPath}`
                      : `${BASE_URL_LEARNER_DASHBOARD}${safeRedirectPath}`
                  }
                  className="inline-flex items-center justify-center px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 font-medium"
                >
                  {t("paymentResult.success.continueNow")}
                </a>
              </>
            ) : isInvoicePayment ? null : (
              <a
                href={
                  typeof window !== "undefined"
                    ? `${window.location.origin}/study-library/courses`
                    : `${BASE_URL_LEARNER_DASHBOARD}/study-library/courses`
                }
                className="inline-flex items-center justify-center px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 font-medium"
              >
                {t("paymentResult.success.goToCourses", {
                  courses: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course),
                })}
              </a>
            )}
          </div>
        ) : isFailed ? (
          <>
            <div className="mx-auto w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
              <XCircle className="w-10 h-10 text-red-600" />
            </div>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">
              {t("paymentResult.failed.title")}
            </h1>
            <p className="text-gray-600 mb-6">
              {t("paymentResult.failed.description")}
            </p>
            <a
              href={
                typeof window !== "undefined"
                  ? `${window.location.origin}/study-library/courses`
                  : `${BASE_URL_LEARNER_DASHBOARD}/study-library/courses`
              }
              className="inline-flex items-center justify-center px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium"
            >
              {t("paymentResult.failed.backToDashboard")}
            </a>
          </>
        ) : (
          <div className="w-full flex flex-col items-center justify-center text-center px-6">
            <div className="mx-auto w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mb-4">
              <SpinnerGap className="w-10 h-10 text-blue-600 animate-spin" />
            </div>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">
              {t("paymentResult.pending.title")}
            </h1>
            <p className="text-gray-600">
              {t("paymentResult.pending.description")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
