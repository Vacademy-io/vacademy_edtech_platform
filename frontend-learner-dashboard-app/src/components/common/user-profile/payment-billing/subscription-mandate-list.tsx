import { useRef, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ArrowsClockwise, Info, SpinnerGap, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { MyButton } from "@/components/design-system/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  SUBSCRIPTION_LIST_QUERY_KEY,
  fetchSubscriptions,
  cancelScheduledPlanChange,
  isPlanChangeAwaitingPayment,
  cancelSubscription,
  requestPlanChange,
  type PlanChangeResult,
  type PlanChangeTarget,
  type Subscription,
} from "./subscription-services";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import { ChangePlanDialog } from "@/components/common/subscription/ChangePlanDialog";
import type { MandateMethod } from "@/components/common/subscription/MandateMethodPicker";
import {
  RazorpayCheckoutForm,
  type RazorpayCheckoutFormRef,
} from "@/components/common/enroll-by-invite/-components/razorpay-checkout-form";
import { Preferences } from "@capacitor/preferences";

interface SubscriptionMandateListProps {
  instituteId: string;
}

const formatPrice = (amount?: number | null, currency?: string | null): string => {
  if (amount == null) return "";
  const symbol = (currency ?? "INR").toUpperCase() === "INR" ? "₹" : `${currency} `;
  return `${symbol}${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`;
};

const formatDate = (value?: string | null): string | null => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // UTC-anchored to match the renewal sweep's charge day (see subscriptions page).
  return d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

/**
 * Lists the learner's autopay subscriptions next to their billing details and
 * lets them cancel autopay per plan. Cancelling stops future charges but keeps
 * access until the plan's end date (handled server-side).
 */
export const SubscriptionMandateList = ({
  instituteId,
}: SubscriptionMandateListProps) => {
  // Reader-mode (native iOS): autopay/subscription management is a paid-
  // subscription surface Apple flags under Guideline 3.1.1. Constant per session.
  if (shouldHidePaidPurchaseUI()) return null;

  const { t } = useTranslation("userProfileExtra");
  const queryClient = useQueryClient();
  const [toCancel, setToCancel] = useState<Subscription | null>(null);
  const [toChange, setToChange] = useState<Subscription | null>(null);
  const [changingPlanId, setChangingPlanId] = useState<string | null>(null);
  const razorpayRef = useRef<RazorpayCheckoutFormRef>(null);

  const invalidateSubscriptions = () =>
    queryClient.invalidateQueries({
      queryKey: [SUBSCRIPTION_LIST_QUERY_KEY, instituteId],
    });

  /**
   * Book a plan change from the billing settings. An upgrade opens the gateway checkout
   * for the prorated difference; a downgrade is booked for the end of the cycle and only
   * needs a refetch. Auto-pay re-authorisation is forced when the backend reports the
   * current mandate cannot carry the new plan — otherwise the upgrade would land and every
   * subsequent auto-charge would be rejected.
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
          throw new Error(t("subscriptionMandate.toast.planChangeOrderFailed"));
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
        invalidateSubscriptions();
      }
      return result;
    } catch (e) {
      toast.error(t("subscriptionMandate.toast.planChangeFailedTitle"), {
        description:
          e instanceof Error
            ? e.message
            : t("subscriptionMandate.toast.planChangeFailedDescription"),
      });
      return null;
    } finally {
      setChangingPlanId(null);
    }
  };

  const cancelPlanChangeMutation = useMutation({
    mutationFn: (userPlanId: string) =>
      cancelScheduledPlanChange(instituteId, userPlanId),
    onSuccess: () => invalidateSubscriptions(),
  });

  const {
    data: subscriptions,
    isLoading,
    isError,
  } = useQuery({
    queryKey: [SUBSCRIPTION_LIST_QUERY_KEY, instituteId],
    queryFn: () => fetchSubscriptions(instituteId),
    enabled: Boolean(instituteId),
    staleTime: 60 * 1000,
  });

  const cancelMutation = useMutation({
    mutationFn: (userPlanId: string) =>
      cancelSubscription(instituteId, userPlanId),
    onSuccess: () => {
      toast.success(t("subscriptionMandate.toast.cancelSuccessTitle"), {
        description: t("subscriptionMandate.toast.cancelSuccessDescription"),
      });
      setToCancel(null);
      queryClient.invalidateQueries({
        queryKey: [SUBSCRIPTION_LIST_QUERY_KEY, instituteId],
      });
    },
    onError: () => {
      toast.error(t("subscriptionMandate.toast.cancelErrorTitle"), {
        description: t("subscriptionMandate.toast.cancelErrorDescription"),
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-gray-500">
        <SpinnerGap className="size-4 animate-spin" />
        {t("subscriptionMandate.loading")}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
        <Info className="size-4 shrink-0" />
        {t("subscriptionMandate.error")}
      </div>
    );
  }

  const autopaySubs = (subscriptions ?? []).filter(
    (s) => s.has_active_mandate || s.auto_renewal_enabled
  );

  if (autopaySubs.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
        <Info className="size-4 shrink-0" />
        {t("subscriptionMandate.empty")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {autopaySubs.map((sub) => {
        const nextCharge = formatDate(sub.next_charge_at);
        const accessUntil = formatDate(sub.end_date);
        const cancellable = sub.has_active_mandate;
        return (
          <div
            key={sub.user_plan_id}
            className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-4"
          >
            <div className="flex items-start gap-3">
              <ArrowsClockwise
                className="mt-0.5 size-5 text-primary-500"
                weight="duotone"
              />
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-700">
                    {sub.plan_name ?? t("subscriptionMandate.defaultPlanName")}
                  </p>
                  {sub.is_trial && (
                    <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-500">
                      {t("subscriptionMandate.trial")}
                    </span>
                  )}
                  {!cancellable && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                      {t("subscriptionMandate.autopayOff")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  {cancellable && nextCharge
                    ? t("subscriptionMandate.autoRenewsOn", { date: nextCharge })
                    : accessUntil
                      ? t("subscriptionMandate.accessUntil", { date: accessUntil })
                      : t("subscriptionMandate.recurringSubscription")}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* Switch plan — only when the institute flagged another plan switchable
                  and nothing is already booked on this membership. */}
              {sub.can_change_plan && !sub.scheduled_plan_change && (
                <MyButton
                  type="button"
                  scale="small"
                  buttonType="secondary"
                  layoutVariant="default"
                  onClick={() => setToChange(sub)}
                  disable={changingPlanId === sub.user_plan_id}
                >
                  {t("subscriptionMandate.changePlan")}
                </MyButton>
              )}
              {cancellable && (
                <MyButton
                  type="button"
                  scale="small"
                  buttonType="secondary"
                  layoutVariant="default"
                  onClick={() => setToCancel(sub)}
                >
                  {t("subscriptionMandate.cancelAutopay")}
                </MyButton>
              )}
            </div>
          </div>
        );
      })}

      {/* A checkout that was opened and never paid. It blocks a second attempt until it
          is finished or dropped, so it is shown with both actions rather than hidden. */}
      {autopaySubs
        .filter((sub) => isPlanChangeAwaitingPayment(sub.scheduled_plan_change))
        .map((sub) => (
          <div
            key={`awaiting-${sub.user_plan_id}`}
            className="flex items-start gap-2 rounded-lg bg-warning-50 p-3 text-sm text-warning-600"
          >
            <Warning className="mt-0.5 size-4 shrink-0" weight="fill" />
            <div className="min-w-0 flex-1">
              <span>
                {sub.scheduled_plan_change?.amount_due_now != null
                  ? t("subscriptionMandate.planChangeAwaitingPayment", {
                      plan: sub.scheduled_plan_change?.to_plan_name,
                      amount: formatPrice(
                        sub.scheduled_plan_change?.amount_due_now,
                        sub.scheduled_plan_change?.currency ?? sub.currency
                      ),
                    })
                  : t("subscriptionMandate.planChangeAwaitingPaymentNoAmount", {
                      plan: sub.scheduled_plan_change?.to_plan_name,
                    })}
              </span>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <MyButton
                  type="button"
                  scale="small"
                  buttonType="primary"
                  layoutVariant="default"
                  onClick={() => setToChange(sub)}
                  disable={changingPlanId === sub.user_plan_id}
                >
                  {t("subscriptionMandate.planChangeCompletePayment")}
                </MyButton>
                <MyButton
                  type="button"
                  scale="small"
                  buttonType="text"
                  layoutVariant="default"
                  disable={cancelPlanChangeMutation.isPending}
                  onClick={() => cancelPlanChangeMutation.mutate(sub.user_plan_id)}
                >
                  {t("subscriptionMandate.planChangeDiscard")}
                </MyButton>
              </div>
            </div>
          </div>
        ))}

      {/* A downgrade already booked. Listed after the rows so a member never reads
          "auto-renews on <date>" without also seeing which plan it renews onto. */}
      {autopaySubs
        .filter(
          (sub) =>
            sub.scheduled_plan_change &&
            !isPlanChangeAwaitingPayment(sub.scheduled_plan_change)
        )
        .map((sub) => (
          <div
            key={`scheduled-${sub.user_plan_id}`}
            className="flex items-start gap-2 rounded-lg bg-info-50 p-3 text-sm text-info-600"
          >
            <ArrowsClockwise className="mt-0.5 size-4 shrink-0" weight="duotone" />
            <div className="min-w-0 flex-1">
              <span>
                {t("subscriptionMandate.planChangeScheduled", {
                  plan: sub.scheduled_plan_change?.to_plan_name,
                  date:
                    formatDate(sub.scheduled_plan_change?.effective_from) ??
                    t("subscriptionMandate.dialog.defaultEndDate"),
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
                {t("subscriptionMandate.planChangeCancelScheduled")}
              </MyButton>
            </div>
          </div>
        ))}

      <ChangePlanDialog
        open={Boolean(toChange)}
        onOpenChange={(open) => {
          if (!open) setToChange(null);
        }}
        subscription={toChange}
        instituteId={instituteId}
        preselectPlanId={toChange?.scheduled_plan_change?.to_plan_id ?? null}
        isSubmitting={Boolean(changingPlanId)}
        onConfirm={(target, withAutopay, mandateMethod) =>
          startPlanChange(toChange as Subscription, target, withAutopay, mandateMethod)
        }
      />

      {/* Gateway checkout host — visually hidden; the SDK's modal attaches to
          document.body, so hiding this wrapper doesn't affect the checkout. */}
      <div className="hidden">
        <RazorpayCheckoutForm
          ref={razorpayRef}
          error={null}
          amount={0}
          currency="INR"
          onPaymentReady={() => {
            toast.success(t("subscriptionMandate.toast.planChangePaidTitle"), {
              description: t("subscriptionMandate.toast.planChangePaidDescription"),
            });
            // The webhook applies the change asynchronously — re-poll so the row
            // flips to the new plan without a manual reload.
            [3000, 8000, 15000].forEach((ms) =>
              setTimeout(invalidateSubscriptions, ms)
            );
          }}
          onError={(message) =>
            toast.error(t("subscriptionMandate.toast.planChangeFailedTitle"), {
              description: message,
            })
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
              {t("subscriptionMandate.dialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("subscriptionMandate.dialog.descriptionPrefix")}{" "}
              <span className="font-medium text-gray-700">
                {toCancel?.plan_name ?? t("subscriptionMandate.dialog.defaultPlanName")}
              </span>{" "}
              {t("subscriptionMandate.dialog.descriptionSuffix", {
                endDate:
                  formatDate(toCancel?.end_date) ??
                  t("subscriptionMandate.dialog.defaultEndDate"),
              })}
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
              {t("subscriptionMandate.dialog.keepAutopay")}
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
                ? t("subscriptionMandate.dialog.cancelling")
                : t("subscriptionMandate.cancelAutopay")}
            </MyButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
