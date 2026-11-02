import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trans, useTranslation } from "react-i18next";
import { Preferences } from "@capacitor/preferences";
import { getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import {
  ArrowsClockwise,
  CreditCard,
  Info,
  SpinnerGap,
  Warning,
} from "@phosphor-icons/react";
import {
  RazorpayCheckoutForm,
  type RazorpayCheckoutFormRef,
} from "@/components/common/enroll-by-invite/-components/razorpay-checkout-form";

import { AuthPageBranding } from "@/components/common/institute-branding";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import {
  getCurrentUsername,
  getTokenFromStorage,
  removeTokensAndLogout,
} from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { isNullOrEmptyOrUndefined } from "@/lib/utils";
import { MyButton } from "@/components/design-system/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SessionLoginForm } from "@/routes/study-library/live-class/$username/components/SessionLoginForm";
import {
  SUBSCRIPTION_LIST_QUERY_KEY,
  cancelScheduledPlanChange,
  cancelSubscription,
  fetchSubscriptions,
  initiateRenewalPayment,
  isRenewalAlreadyPaid,
  isRenewalRedirect,
  renewalRedirectUrl,
  renewalResponseData,
  requestPlanChange,
  type PlanChangeResult,
  type PlanChangeTarget,
  type Subscription,
} from "@/components/common/user-profile/payment-billing/subscription-services";
import { ChangePlanDialog } from "@/components/common/subscription/ChangePlanDialog";
import { EwayRenewalCardDialog } from "@/components/common/subscription/EwayRenewalCardDialog";
import {
  DEFAULT_MANDATE_METHOD,
  MandateMethodPicker,
  type MandateMethod,
} from "@/components/common/subscription/MandateMethodPicker";

const formatPrice = (amount?: number | null, currency?: string | null): string => {
  if (amount == null) return "";
  const symbol = (currency ?? "INR").toUpperCase() === "INR" ? "₹" : `${currency} `;
  return `${symbol}${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`;
};

/**
 * A plan's period, as a unit + count the copy can inflect ("12 months", "another year").
 *
 * Months and years are snapped from day counts rather than divided exactly, because real
 * plans are stored as 30 / 90 / 180 / 360 / 365 days and a literal days/30 reads as
 * "12.17 months". Anything that is not close to a whole month stays in days, so an odd
 * plan (a 10-day pass) is described honestly instead of rounded into a wrong month.
 * Returns null when validity is unknown — the caller then omits the period wording
 * entirely rather than guessing a year.
 */
type PlanPeriod = { unit: "month" | "year" | "day"; count: number };

const planPeriodOf = (days?: number | null): PlanPeriod | null => {
  if (days == null || days <= 0) return null;
  const years = days / 365;
  if (days >= 330 && Math.abs(years - Math.round(years)) * 365 <= 20) {
    return { unit: "year", count: Math.max(1, Math.round(years)) };
  }
  const months = days / 30;
  if (days >= 28 && Math.abs(months - Math.round(months)) * 30 <= 5) {
    return { unit: "month", count: Math.max(1, Math.round(months)) };
  }
  return { unit: "day", count: days };
};

/** A year is sold as "12 months" on the price line, but read back as "a year" in prose. */
const periodInMonths = (period: PlanPeriod): PlanPeriod =>
  period.unit === "year" ? { unit: "month", count: period.count * 12 } : period;

/**
 * Which page the landing renders:
 * - manage → /subscriptions/<username>: every membership with stop, renew and change-plan.
 * - cancel → /subscriptions/<username>/cancel: the "thinking of stopping?" page — a
 *   retention card with the stop button, and the renewal card under it.
 */
export type SubscriptionsLandingVariant = "manage" | "cancel";

/**
 * The session is gone: the interceptor rejects with a bare "Unauthorized" once a refresh
 * is refused (another login for this user replaced the refresh token — there is only one
 * per user), and the server answers 401 for an expired one.
 */
const isSessionLost = (error: unknown): boolean =>
  (axios.isAxiosError(error) && error.response?.status === 401) ||
  (error instanceof Error && error.message === "Unauthorized");

/** The server's own reason for a failed request, when it sent one. */
const serverMessage = (error: unknown): string | null => {
  if (!axios.isAxiosError(error)) return null;
  const data = error.response?.data as { message?: string; ex?: string } | undefined;
  return data?.message || data?.ex || null;
};

const formatDate = (value?: string | null): string | null => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // UTC-anchored: charge/end timestamps are stored UTC and the renewal sweep
  // charges on the UTC date. Local-tz rendering shifted late-evening charges to
  // the next day (message said 11 Aug, page said 12 Aug).
  return d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

/** True when the signed-in user is not the one the link was sent to. */
const isDifferentUser = (sessionUsername: string | null, linkUsername: string): boolean => {
  const normalize = (value: string) => {
    try {
      return decodeURIComponent(value).trim().toLowerCase();
    } catch {
      return value.trim().toLowerCase();
    }
  };
  if (!linkUsername) return false;
  // A token without a username can't be matched to the link, so treat it as someone else.
  if (!sessionUsername) return true;
  return normalize(sessionUsername) !== normalize(linkUsername);
};

/**
 * Public per-learner membership page, linked from WhatsApp and email ("tomorrow we
 * auto-deduct — click here to stop"). Same trusted-login flow as the unique live-class
 * link: /subscriptions/<username> (and /cancel under it) logs the learner in
 * passwordlessly on branded domains, then shows their memberships. Cancelling never cuts
 * access early — the page always states the exact end date after which no further
 * deduction happens.
 */
export function SubscriptionsLanding({
  username: routeUsername,
  variant,
}: {
  username?: string;
  variant: SubscriptionsLandingVariant;
}) {
  const { t } = useTranslation("miscRoutesB");
  const domainRouting = useDomainRouting();

  // Params can be momentarily undefined during SPA navigation — fall back to
  // parsing the URL, same as the live-class username route.
  let username = routeUsername || "";
  if (!username) {
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 2 && pathParts[0] === "subscriptions") {
      username = pathParts[1] || "";
    }
  }

  const queryClient = useQueryClient();
  const [authState, setAuthState] = useState<
    "loading" | "authenticated" | "unauthenticated"
  >("loading");

  // Once the domain is resolved, check the session once per username. This used to depend
  // on the whole domainRouting object, which is a new object every render, so the check
  // re-ran on every render: a slow run that logged out a stale session could finish after
  // the login form had already signed the member in, wiping the fresh tokens (and ending
  // that session server-side) — the "keeps logging in" loop.
  const domainReady = !domainRouting.isLoading;
  useEffect(() => {
    if (!domainReady) return;
    let stale = false;
    const checkAuth = async () => {
      try {
        const token = await getTokenFromStorage(TokenKey.accessToken);
        const studentDetails = await Preferences.get({ key: "StudentDetails" });
        const instituteDetails = await Preferences.get({
          key: "InstituteDetails",
        });
        if (stale) return;
        if (
          !isNullOrEmptyOrUndefined(token) &&
          !isNullOrEmptyOrUndefined(studentDetails.value) &&
          !isNullOrEmptyOrUndefined(instituteDetails.value)
        ) {
          // The link names the member it is for. A session left on this device by
          // someone else (an admin testing links, a shared family computer) must not
          // show that person's membership: drop it and sign in the member in the link.
          const sessionUsername = await getCurrentUsername();
          if (stale) return;
          if (isDifferentUser(sessionUsername, username)) {
            await removeTokensAndLogout();
            queryClient.clear();
            if (!stale) setAuthState("unauthenticated");
            return;
          }
          setAuthState("authenticated");
        } else {
          setAuthState("unauthenticated");
        }
      } catch (error) {
        console.error("Error checking authentication:", error);
        if (!stale) setAuthState("unauthenticated");
      }
    };
    checkAuth();
    return () => {
      stale = true;
    };
  }, [domainReady, username, queryClient]);

  // A request found the session gone (see isSessionLost): sign the member in again from the
  // link, once per page load. Only once — if a fresh login is refused straight away too, a
  // second attempt would just be the loop again, so the page stays on the login form.
  const reauthUsed = useRef(false);
  const handleSessionLost = useCallback(() => {
    if (reauthUsed.current) return false;
    reauthUsed.current = true;
    queryClient.clear();
    setAuthState("unauthenticated");
    return true;
  }, [queryClient]);

  if (domainRouting.isLoading || authState === "loading") {
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

      <div className="flex flex-1 justify-center px-4 py-8">
        <div className="w-full max-w-xl">
          {authState === "authenticated" ? (
            domainRouting.instituteId ? (
              <ManageSubscriptions
                instituteId={domainRouting.instituteId}
                variant={variant}
                onSessionLost={handleSessionLost}
              />
            ) : (
              <div className="space-y-4 text-center">
                <h2 className="text-2xl font-semibold text-gray-900">
                  {t("subscriptions.unableToLoad.title")}
                </h2>
                <p className="text-gray-600">
                  {t("subscriptions.unableToLoad.description")}
                </p>
              </div>
            )
          ) : domainRouting.instituteId ? (
            <SessionLoginForm
              linkRoute="SUBSCRIPTIONS"
              username={username}
              instituteId={domainRouting.instituteId}
              onLoginSuccess={() => setAuthState("authenticated")}
              onNavigate={() => {}}
              successToastDescription={t("subscriptions.loadingToast")}
            />
          ) : (
            <div className="space-y-4 text-center">
              <h2 className="text-2xl font-semibold text-gray-900">
                {t("subscriptions.unableToLoad.title")}
              </h2>
              <p className="text-gray-600">
                {t("subscriptions.unableToLoad.description")}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="border-t bg-white">
        <div className="mx-auto px-4 py-4">
          <p className="text-center text-sm text-gray-500">
            {t("subscriptions.footer")}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Membership list + stop flow. Three visually distinct states per plan, because
 * a learner glancing at this page should be able to tell them apart instantly:
 * - renewing      → next payment date + "Stop membership" button, no banner
 *                   (no autopay: just the button, while the plan is active and renewable)
 * - stopped       → amber "Membership stopped" + the date classes run until
 * - payment failed → red, with the pay-now option below
 *
 * Deliberately not green-with-a-tick for the stopped state: that read as
 * "everything is fine" to learners who had just cancelled.
 */
function ManageSubscriptions({
  instituteId,
  variant,
  onSessionLost,
}: {
  instituteId: string;
  variant: SubscriptionsLandingVariant;
  /** Re-runs the link login; false when it already has once this page load. */
  onSessionLost: () => boolean;
}) {
  const { t } = useTranslation("miscRoutesB");
  const liveClasses = getTerminologyPlural(ContentTerms.LiveSession, SystemTerms.LiveSession);
  const queryClient = useQueryClient();
  const [toCancel, setToCancel] = useState<Subscription | null>(null);
  const [toChange, setToChange] = useState<Subscription | null>(null);
  const [changingPlanId, setChangingPlanId] = useState<string | null>(null);
  const [renewingPlanId, setRenewingPlanId] = useState<string | null>(null);
  // eWay renewal waiting on the card form (EwayRenewalCardDialog).
  const [cardRenewal, setCardRenewal] = useState<Subscription | null>(null);
  // Per-plan "also enable auto-pay" choice (offered only when the invite has
  // autopay configured). Default off: the learner cancelled it deliberately.
  const [autopayChoice, setAutopayChoice] = useState<Record<string, boolean>>({});
  // UPI vs card for the re-registered mandate; only read when autopayChoice is on.
  const [mandateMethodChoice, setMandateMethodChoice] = useState<Record<string, MandateMethod>>({});
  const razorpayRef = useRef<RazorpayCheckoutFormRef>(null);
  /**
   * First name for the renewal greeting. Read from the session the trusted-login flow
   * already stored, so no extra request — and left empty when unavailable, which drops the
   * greeting line rather than rendering "Hi ,".
   */
  const [firstName, setFirstName] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    Preferences.get({ key: "StudentDetails" })
      .then(({ value }) => {
        if (cancelled || isNullOrEmptyOrUndefined(value)) return;
        const parsed = JSON.parse(value as string) as { full_name?: string };
        const first = (parsed?.full_name ?? "").trim().split(/\s+/)[0] ?? "";
        setFirstName(first);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  /**
   * Whether this renewal should arm autopay: the learner's explicit choice if they made
   * one, otherwise the institute's default. `??` not `||` — an explicit false must survive.
   */
  const autopayWanted = (sub: Subscription) =>
    autopayChoice[sub.user_plan_id] ?? Boolean(sub.autopay_default);

  /**
   * The institute requires autopay, and this plan can actually take it. A plan whose invite
   * does not offer autopay is never blocked — the requirement is about the choice, and
   * there is no choice to make here.
   */
  const autopayRequired = (sub: Subscription) =>
    Boolean(sub.autopay_required) && Boolean(sub.autopay_available);

  /**
   * Blocked from paying because a required autopay option has been cleared. Stored-token
   * gateways show no checkbox at all, so there is nothing to clear and nothing to block.
   */
  const autopayBlocks = (sub: Subscription) =>
    autopayRequired(sub) && !sub.instant_renewal && !autopayWanted(sub);


  const refetchSoon = () => {
    // The gateway webhook reactivates the plan asynchronously — refetch a few
    // times so the page flips to "active" without a manual reload.
    [3000, 8000, 15000].forEach((ms) =>
      setTimeout(
        () =>
          queryClient.invalidateQueries({
            queryKey: [SUBSCRIPTION_LIST_QUERY_KEY, "public-manage", instituteId],
          }),
        ms
      )
    );
  };

  const startRenewal = async (sub: Subscription) => {
    // eWay: take the card here with the shared card form instead of sending the learner
    // to eWay's hosted page. Nothing is requested until they press pay in the dialog.
    if ((sub.renewal_vendor ?? "").toUpperCase() === "EWAY") {
      setCardRenewal(sub);
      return;
    }
    try {
      setRenewingPlanId(sub.user_plan_id);
      let email = "";
      let mobile = "";
      try {
        const stored = await Preferences.get({ key: "StudentDetails" });
        if (stored.value) {
          const details = JSON.parse(stored.value);
          email = details?.email ?? "";
          mobile = details?.mobile_number ?? details?.mobileNumber ?? "";
        }
      } catch {
        // best effort — the backend resolves the customer from the JWT anyway
      }
      // A stored-token gateway needs no mandate ceremony, so the checkbox is not
      // rendered for it and there is no method to pick.
      const withAutopay = Boolean(
        sub.autopay_available && !sub.instant_renewal && autopayWanted(sub)
      );
      const response = await initiateRenewalPayment(
        instituteId,
        sub,
        withAutopay,
        sub.instant_renewal
          ? undefined
          : mandateMethodChoice[sub.user_plan_id] ?? DEFAULT_MANDATE_METHOD
      );
      // Hosted gateway: nothing charged yet. The learner finishes on the gateway's own card
      // page and comes back to /subscriptions/payment-return, which confirms the order.
      // Leave renewingPlanId set — the page is navigating away, and clearing it would flash
      // the button back to its idle label first.
      if (isRenewalRedirect(response)) {
        const url = renewalRedirectUrl(response);
        if (!url) {
          throw new Error(t("subscriptions.manage.toast.orderCreationFailed"));
        }
        window.location.href = url;
        return;
      }
      // Stored-token gateway (eWay): the backend already charged the saved card and
      // reactivated the membership, so there is no checkout to open. This has to be
      // checked before the razorpayKeyId test below, or a completed payment would be
      // reported to the learner as a failure to create the order.
      if (isRenewalAlreadyPaid(response)) {
        toast.success(t("subscriptions.manage.toast.paymentReceivedTitle"), {
          description: t("subscriptions.manage.toast.paymentReceivedDescription"),
        });
        refetchSoon();
        return;
      }
      const orderDetails = renewalResponseData(response);
      if (!orderDetails?.razorpayKeyId || !orderDetails?.razorpayOrderId) {
        throw new Error(t("subscriptions.manage.toast.orderCreationFailed"));
      }
      razorpayRef.current?.openPayment({
        razorpayKeyId: orderDetails.razorpayKeyId,
        razorpayOrderId: orderDetails.razorpayOrderId,
        amount: orderDetails.amount,
        currency: orderDetails.currency || sub.currency || "INR",
        contact: mobile,
        email,
        // Mandate mode: present when the backend registered a recurring order —
        // the same approval pays and re-authorizes auto-pay.
        recurring: orderDetails.recurring,
        customerId: orderDetails.customerId,
      });
    } catch (e) {
      toast.error(t("subscriptions.manage.toast.startFailedTitle"), {
        description: e instanceof Error ? e.message : t("subscriptions.manage.toast.genericRetry"),
      });
    } finally {
      setRenewingPlanId(null);
    }
  };

  /**
   * Book a plan change from this page. Mirrors startRenewal: an upgrade opens the same
   * Razorpay checkout (for the prorated difference), a downgrade is booked for the end of
   * the cycle and only needs a refetch. Mandate re-auth is forced when the backend says
   * the current mandate cannot carry the new plan.
   */
  const startPlanChange = async (
    sub: Subscription,
    target: PlanChangeTarget,
    withAutopay: boolean,
    mandateMethod?: MandateMethod
  ): Promise<PlanChangeResult | null> => {
    try {
      setChangingPlanId(sub.user_plan_id);
      const result = await requestPlanChange(
        instituteId,
        sub.user_plan_id,
        target.plan_id,
        withAutopay || Boolean(target.requires_mandate_reauth),
        mandateMethod
      );
      if (result.status === "PENDING_PAYMENT" && result.payment_response) {
        const orderDetails =
          result.payment_response?.payment_response?.response_data ??
          result.payment_response?.response_data;
        if (!orderDetails?.razorpayKeyId || !orderDetails?.razorpayOrderId) {
          throw new Error(t("subscriptions.manage.toast.orderCreationFailed"));
        }
        let email = "";
        let mobile = "";
        try {
          const stored = await Preferences.get({ key: "StudentDetails" });
          if (stored.value) {
            const details = JSON.parse(stored.value);
            email = details?.email ?? "";
            mobile = details?.mobile_number ?? details?.mobileNumber ?? "";
          }
        } catch {
          // best effort — the backend resolves the customer from the JWT anyway
        }
        razorpayRef.current?.openPayment({
          razorpayKeyId: orderDetails.razorpayKeyId,
          razorpayOrderId: orderDetails.razorpayOrderId,
          amount: orderDetails.amount,
          currency: orderDetails.currency || target.currency || "INR",
          contact: mobile,
          email,
          recurring: orderDetails.recurring,
          customerId: orderDetails.customerId,
        });
      } else {
        queryClient.invalidateQueries({
          queryKey: [SUBSCRIPTION_LIST_QUERY_KEY, "public-manage", instituteId],
        });
      }
      return result;
    } catch (e) {
      toast.error(t("subscriptions.manage.toast.startFailedTitle"), {
        description:
          e instanceof Error ? e.message : t("subscriptions.manage.toast.genericRetry"),
      });
      return null;
    } finally {
      setChangingPlanId(null);
    }
  };

  const cancelPlanChangeMutation = useMutation({
    mutationFn: (userPlanId: string) =>
      cancelScheduledPlanChange(instituteId, userPlanId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: [SUBSCRIPTION_LIST_QUERY_KEY, "public-manage", instituteId],
      }),
  });

  const {
    data: subscriptions,
    isLoading,
    isError,
    error: listError,
  } = useQuery({
    queryKey: [SUBSCRIPTION_LIST_QUERY_KEY, "public-manage", instituteId],
    queryFn: () => fetchSubscriptions(instituteId),
    enabled: Boolean(instituteId),
    // A lost session will not come back by retrying — the re-login below handles it.
    retry: (failureCount, error) => !isSessionLost(error) && failureCount < 2,
  });

  useEffect(() => {
    if (isError && isSessionLost(listError)) onSessionLost();
  }, [isError, listError, onSessionLost]);

  const cancelMutation = useMutation({
    mutationFn: (userPlanId: string) =>
      cancelSubscription(instituteId, userPlanId),
    onSuccess: (updated) => {
      const until = formatDate(updated.end_date);
      // Not toast.success: they have cancelled something, and a green tick
      // alongside "membership stopped" is the mixed signal this page had.
      toast(t("subscriptions.manage.toast.membershipStoppedTitle"), {
        description: until
          ? t("subscriptions.manage.toast.stoppedWithDate", { liveClasses, date: until })
          : t("subscriptions.manage.toast.stoppedNoDate"),
      });
      setToCancel(null);
      queryClient.invalidateQueries({
        queryKey: [SUBSCRIPTION_LIST_QUERY_KEY, "public-manage", instituteId],
      });
    },
    onError: (error) => {
      // The usual cause: this page's session was replaced by a login elsewhere (another
      // tab, the app, a second click on the link), so the request never reached the
      // membership. Sign in again from the link and ask them to press stop once more,
      // rather than a "try again" that would fail the same way.
      if (isSessionLost(error) && onSessionLost()) {
        setToCancel(null);
        toast(t("subscriptions.manage.toast.stopFailedTitle"), {
          description: t("subscriptions.manage.toast.sessionRenewed"),
        });
        return;
      }
      toast.error(t("subscriptions.manage.toast.stopFailedTitle"), {
        description: serverMessage(error) ?? t("subscriptions.manage.toast.genericRetry"),
      });
    },
  });

  /**
   * The "Renew your membership" card, shared by both pages. `intro` is the line under the
   * greeting: the manage page welcomes a lapsed member back, the cancel page talks to one
   * who is still here.
   */
  const renderRenewal = (sub: Subscription, intro: string) => {
    if (!sub.can_renew_manually || sub.plan_price == null) return null;
    // Period drives every bit of copy below: the price caption ("AUD for 12
    // months") and the invitation ("back for another year"). Null when the
    // backend has no validity for the plan — each line then falls back to
    // wording that names no period at all, rather than implying a year.
    const period = planPeriodOf(sub.plan_validity_days);
    const priceLabel = formatPrice(sub.plan_price, sub.currency);
    const hasEnded = sub.status === "EXPIRED" || sub.status === "PAYMENT_FAILED";
    const billed = period ? periodInMonths(period) : null;
    return (
      <div className="space-y-4 rounded-xl border border-primary-100 bg-primary-50 p-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-gray-800">
            {t("subscriptions.manage.renew.title")}
          </h3>
          {firstName && (
            <p className="text-sm text-gray-700">
              {t("subscriptions.manage.renew.greeting", { name: firstName })}
            </p>
          )}
          {/* No period in this sentence: the plan length is already stated exactly
              on the price line, and "back for another year" read oddly on monthly
              plans and wrong on anything irregular. */}
          <p className="text-sm text-gray-600">{intro}</p>
        </div>

        <div className="space-y-3 rounded-lg border-t-4 border-primary-500 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span className="text-sm font-medium text-gray-700">
              {sub.plan_name ?? t("subscriptions.manage.planFallback")}
            </span>
            <span className="text-right">
              <span className="block text-2xl font-semibold text-gray-900">
                {priceLabel}
              </span>
              {billed && (
                <span className="block text-xs text-gray-500">
                  {t("subscriptions.manage.renew.priceCaption", {
                    currency: (sub.currency ?? "").toUpperCase(),
                    period: t(`subscriptions.manage.renew.duration_${billed.unit}`, {
                      count: billed.count,
                    }),
                  })}
                </span>
              )}
            </span>
          </div>
          <p className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-gray-600">
            {accessUntil
              ? t(
                  hasEnded
                    ? "subscriptions.manage.renew.endedOn"
                    : "subscriptions.manage.renew.endsOn",
                  { date: accessUntil },
                )
              : t(
                  hasEnded
                    ? "subscriptions.manage.renew.endedNoDate"
                    : "subscriptions.manage.renew.endsNoDate",
                )}
          </p>
        </div>
        {sub.autopay_available && sub.instant_renewal && autopayWanted(sub) && (
          /* No checkbox on a stored-token gateway, so say plainly that this card
             will be charged again — arming autopay silently would be wrong. */
          <div className="flex items-start gap-2 rounded-lg bg-primary-100 p-2 text-sm text-gray-700">
            <Info className="mt-0.5 size-4 shrink-0" />
            <span>{t("subscriptions.manage.autopayDefaultNotice")}</span>
          </div>
        )}
        {sub.autopay_available && !sub.instant_renewal && (
          <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary-500"
              checked={autopayWanted(sub)}
              onChange={(e) =>
                setAutopayChoice((prev) => ({
                  ...prev,
                  [sub.user_plan_id]: e.target.checked,
                }))
              }
            />
            <span>
              {t("subscriptions.manage.autopayCheckbox")}
              {autopayRequired(sub) && (
                <span className="block text-xs text-gray-500">
                  {t("subscriptions.manage.autopayRequiredHint")}
                </span>
              )}
            </span>
          </label>
        )}
        {sub.autopay_available && !sub.instant_renewal && autopayWanted(sub) && (
          <MandateMethodPicker
            value={mandateMethodChoice[sub.user_plan_id] ?? DEFAULT_MANDATE_METHOD}
            onChange={(method) =>
              setMandateMethodChoice((prev) => ({
                ...prev,
                [sub.user_plan_id]: method,
              }))
            }
            disabled={renewingPlanId === sub.user_plan_id}
          />
        )}
        <div className="space-y-2">
          <MyButton
            type="button"
            scale="large"
            buttonType="primary"
            layoutVariant="default"
            className="w-full"
            onClick={() => startRenewal(sub)}
            disable={renewingPlanId === sub.user_plan_id || autopayBlocks(sub)}
          >
            <CreditCard className="me-1.5 size-4" />
            {renewingPlanId === sub.user_plan_id
              ? t("subscriptions.manage.startingPayment")
              : t("subscriptions.manage.renew.cta", { amount: priceLabel })}
          </MyButton>
          <p className="text-center text-xs text-gray-500">
            {autopayBlocks(sub)
              ? t("subscriptions.manage.autopayRequiredBlocked")
              : t("subscriptions.manage.renew.secureNote")}
          </p>
        </div>

        {/* Institute's own utility email. Omitted entirely when unconfigured —
            showing a different institute's support address would be worse. */}
        {sub.support_email && (
          <p className="text-center text-xs text-gray-500">
            <Trans
              i18nKey="subscriptions.manage.renew.support"
              ns="miscRoutesB"
              values={{ email: sub.support_email }}
              components={{
                mail: (
                  <a
                    className="text-primary-500 underline"
                    href={`mailto:${sub.support_email}`}
                  />
                ),
              }}
            />
          </p>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
        <SpinnerGap className="size-4 animate-spin" />
        {t("subscriptions.manage.loading")}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
        <Info className="size-4 shrink-0" />
        {t("subscriptions.manage.error")}
      </div>
    );
  }

  // This page manages recurring memberships only, so one-time purchases are left off. A row
  // with no type (an older backend that does not send it) is kept rather than hidden.
  // The cancel page also leaves out never-finished signups: there is no membership to stop
  // or renew on those, and the manage page already walks them back to the checkout.
  const subs = (subscriptions ?? []).filter(
    (sub) =>
      (!sub.payment_option_type || sub.payment_option_type === "SUBSCRIPTION") &&
      !(variant === "cancel" && sub.can_complete_enrollment),
  );

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-900">{t("subscriptions.manage.heading")}</h2>

      {subs.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
          <Info className="size-4 shrink-0" />
          {t("subscriptions.manage.empty")}
        </div>
      )}

      {subs.map((sub) => {
        const nextCharge = formatDate(sub.next_charge_at);
        const accessUntil = formatDate(sub.end_date);
        const autopayOn =
          sub.has_active_mandate && sub.status !== "CANCELED";
        // A renewable membership with no autopay can still be stopped: cancelling just marks
        // it as not renewing and access runs to the end date, the same as stopping autopay.
        // Limited to ACTIVE plans with a future end date that offer renewal, so one-off and
        // lifetime purchases never show a stop button.
        const endsInFuture =
          !!sub.end_date && new Date(sub.end_date).getTime() > Date.now();
        const canStop =
          autopayOn ||
          (sub.status === "ACTIVE" && !!sub.can_renew_manually && endsInFuture);
        const paymentFailed = sub.status === "PAYMENT_FAILED";
        if (variant === "cancel") {
          const stopped = sub.status === "CANCELED";
          return (
            <div key={sub.user_plan_id} className="space-y-4">
              <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                  <ArrowsClockwise className="size-5 text-primary-500" weight="duotone" />
                  <p className="text-sm font-medium text-gray-700">
                    {sub.plan_name ?? t("subscriptions.manage.planFallback")}
                  </p>
                  {sub.is_trial && (
                    <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-500">
                      {t("subscriptions.manage.trialBadge")}
                    </span>
                  )}
                </div>
                {stopped ? (
                  <div className="space-y-2">
                    <h3 className="text-base font-semibold text-gray-800">
                      {t("subscriptions.cancelPage.stoppedTitle")}
                    </h3>
                    <p className="text-sm text-gray-600">
                      {accessUntil
                        ? t("subscriptions.cancelPage.stoppedWithDate", { date: accessUntil })
                        : t("subscriptions.cancelPage.stoppedNoDate")}
                    </p>
                  </div>
                ) : paymentFailed ? (
                  <div className="flex items-start gap-2 rounded-lg bg-danger-50 p-3 text-sm text-danger-600">
                    <Warning className="mt-0.5 size-4 shrink-0" weight="fill" />
                    <span>
                      <span className="font-medium">{t("subscriptions.manage.paymentFailedLabel")}</span>{" "}
                      {accessUntil
                        ? t("subscriptions.manage.paymentFailedWithDate", { liveClasses, date: accessUntil })
                        : t("subscriptions.manage.paymentFailedNoDate")}
                    </span>
                  </div>
                ) : canStop ? (
                  <div className="space-y-3">
                    <h3 className="text-base font-semibold text-gray-800">
                      {t("subscriptions.cancelPage.title")}
                    </h3>
                    <p className="text-sm text-gray-600">
                      {sub.support_email ? (
                        <Trans
                          i18nKey="subscriptions.cancelPage.support"
                          ns="miscRoutesB"
                          values={{ email: sub.support_email }}
                          components={{
                            mail: (
                              <a
                                className="text-primary-500 underline"
                                href={`mailto:${sub.support_email}`}
                              />
                            ),
                          }}
                        />
                      ) : (
                        t("subscriptions.cancelPage.supportNoEmail")
                      )}
                    </p>
                    <p className="text-sm text-gray-600">{t("subscriptions.cancelPage.stopBody")}</p>
                    <MyButton
                      type="button"
                      scale="medium"
                      buttonType="secondary"
                      layoutVariant="default"
                      onClick={() => setToCancel(sub)}
                    >
                      {t("subscriptions.manage.stopMembership")}
                    </MyButton>
                  </div>
                ) : (
                  <p className="text-sm text-gray-600">{t("subscriptions.cancelPage.nothingToStop")}</p>
                )}
              </div>
              {renderRenewal(sub, t("subscriptions.cancelPage.renewIntro"))}
            </div>
          );
        }
        return (
          <div
            key={sub.user_plan_id}
            className="space-y-3 rounded-lg border border-gray-200 bg-white p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <ArrowsClockwise
                  className="mt-0.5 size-5 text-primary-500"
                  weight="duotone"
                />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-gray-700">
                      {sub.plan_name ?? t("subscriptions.manage.planFallback")}
                    </p>
                    {sub.is_trial && (
                      <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-500">
                        {t("subscriptions.manage.trialBadge")}
                      </span>
                    )}
                  </div>
                  {autopayOn && (
                    <p className="text-xs text-gray-500">
                      {nextCharge
                        ? t("subscriptions.manage.nextPayment", { date: nextCharge })
                        : t("subscriptions.manage.renewsAutomatically")}
                    </p>
                  )}
                </div>
              </div>
              {canStop && (
                <MyButton
                  type="button"
                  scale="small"
                  buttonType="secondary"
                  layoutVariant="default"
                  onClick={() => setToCancel(sub)}
                >
                  {t("subscriptions.manage.stopMembership")}
                </MyButton>
              )}
            </div>

            {paymentFailed && (
              <div className="flex items-start gap-2 rounded-lg bg-danger-50 p-3 text-sm text-danger-600">
                <Warning className="mt-0.5 size-4 shrink-0" weight="fill" />
                <span>
                  <span className="font-medium">{t("subscriptions.manage.paymentFailedLabel")}</span>{" "}
                  {accessUntil
                    ? t("subscriptions.manage.paymentFailedWithDate", { liveClasses, date: accessUntil })
                    : t("subscriptions.manage.paymentFailedNoDate")}
                </span>
              </div>
            )}

            {/* Never a membership (abandoned or failed first checkout): there is nothing to
                renew, so send the learner back through the invite checkout to finish signing
                up. Paying here would extend access that was never granted — the server
                refuses it too (SubscriptionService.initiateRenewalPayment). */}
            {sub.can_complete_enrollment && sub.enroll_invite_code && (
              <div className="space-y-3 rounded-lg border border-warning-200 bg-warning-50 p-3">
                <div className="flex items-start gap-2 text-sm text-gray-700">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {t("subscriptions.manage.completeEnrollmentPrompt", { liveClasses })}
                  </span>
                </div>
                <div className="flex justify-end">
                  <MyButton
                    type="button"
                    scale="small"
                    buttonType="primary"
                    layoutVariant="default"
                    onClick={() =>
                      window.location.assign(
                        `/learner-invitation-response?instituteId=${encodeURIComponent(
                          instituteId,
                        )}&inviteCode=${encodeURIComponent(sub.enroll_invite_code ?? "")}`,
                      )
                    }
                  >
                    <CreditCard className="me-1.5 size-4" />
                    {t("subscriptions.manage.completeEnrollmentCta")}
                  </MyButton>
                </div>
              </div>
            )}

            {renderRenewal(sub, t("subscriptions.manage.renew.intro"))}

            {/* A downgrade already booked for the end of the cycle. */}
            {sub.scheduled_plan_change && (
              <div className="flex items-start gap-2 rounded-lg bg-info-50 p-3 text-sm text-info-600">
                <ArrowsClockwise className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <span>
                    {t("subscriptions.manage.planChangeScheduled", {
                      plan: sub.scheduled_plan_change.to_plan_name,
                      date:
                        formatDate(sub.scheduled_plan_change.effective_from) ??
                        t("subscriptions.manage.currentPeriodFallback"),
                    })}
                  </span>
                  <MyButton
                    type="button"
                    scale="small"
                    buttonType="text"
                    layoutVariant="default"
                    disable={cancelPlanChangeMutation.isPending}
                    onClick={() => cancelPlanChangeMutation.mutate(sub.user_plan_id)}
                  >
                    {t("subscriptions.manage.planChangeCancelScheduled")}
                  </MyButton>
                </div>
              </div>
            )}

            {/* Switch plan — only when the institute flagged another plan switchable. */}
            {sub.can_change_plan && !sub.scheduled_plan_change && (
              <div className="flex justify-end">
                <MyButton
                  type="button"
                  scale="small"
                  buttonType="secondary"
                  layoutVariant="default"
                  onClick={() => setToChange(sub)}
                  disable={changingPlanId === sub.user_plan_id}
                >
                  <ArrowsClockwise className="me-1.5 size-4" />
                  {t("subscriptions.manage.changePlan")}
                </MyButton>
              </div>
            )}
          </div>
        );
      })}

      <ChangePlanDialog
        open={Boolean(toChange)}
        onOpenChange={(open) => {
          if (!open) setToChange(null);
        }}
        subscription={toChange}
        instituteId={instituteId}
        isSubmitting={Boolean(changingPlanId)}
        onConfirm={(target, withAutopay, mandateMethod) =>
          startPlanChange(toChange as Subscription, target, withAutopay, mandateMethod)
        }
      />

      <EwayRenewalCardDialog
        open={Boolean(cardRenewal)}
        onOpenChange={(open) => {
          if (!open) setCardRenewal(null);
        }}
        subscription={cardRenewal}
        instituteId={instituteId}
        priceLabel={formatPrice(cardRenewal?.plan_price, cardRenewal?.currency)}
        onPaid={() => {
          setCardRenewal(null);
          refetchSoon();
        }}
      />

      {/* Gateway checkout host — visually hidden (its built-in card UI shows a
          placeholder amount); the SDK's payment modal attaches to document.body,
          so hiding this wrapper doesn't affect the checkout itself. */}
      <div className="hidden">
      <RazorpayCheckoutForm
        ref={razorpayRef}
        error={null}
        amount={0}
        currency="INR"
        onPaymentReady={() => {
          toast.success(t("subscriptions.manage.toast.paymentReceivedTitle"), {
            description: t("subscriptions.manage.toast.paymentReceivedDescription"),
          });
          refetchSoon();
        }}
        onError={(message) =>
          toast.error(t("subscriptions.manage.toast.paymentNotCompletedTitle"), { description: message })
        }
      />
      </div>

      <Dialog
        open={Boolean(toCancel)}
        onOpenChange={(open) => {
          if (!open) setToCancel(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Warning className="size-5 text-danger-500" weight="fill" />
              {t("subscriptions.manage.cancelDialog.title")}
            </DialogTitle>
            <DialogDescription>
              <Trans
                i18nKey="subscriptions.manage.cancelDialog.description"
                t={t}
                values={{
                  liveClasses,
                  date:
                    formatDate(toCancel?.end_date) ??
                    t("subscriptions.manage.endOfPaidPeriodFallback"),
                }}
                components={{ bold: <span className="font-medium text-gray-700" /> }}
              />
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <MyButton
              type="button"
              scale="small"
              buttonType="secondary"
              layoutVariant="default"
              onClick={() => setToCancel(null)}
              disable={cancelMutation.isPending}
            >
              {t("subscriptions.manage.cancelDialog.keepMembership")}
            </MyButton>
            <MyButton
              type="button"
              scale="small"
              buttonType="primary"
              layoutVariant="default"
              onClick={() =>
                toCancel && cancelMutation.mutate(toCancel.user_plan_id)
              }
              disable={cancelMutation.isPending}
            >
              {cancelMutation.isPending
                ? t("subscriptions.manage.stopping")
                : t("subscriptions.manage.stopMembership")}
            </MyButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
