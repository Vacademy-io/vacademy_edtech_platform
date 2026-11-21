import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Preferences } from "@capacitor/preferences";
import { toast } from "sonner";
import {
  SUBSCRIPTION_LIST_QUERY_KEY,
  cancelScheduledPlanChange,
  cancelSubscription,
  fetchSubscriptions,
  initiateRenewalPayment,
  isRenewalAlreadyPaid,
  renewalResponseData,
  requestPlanChange,
  type PlanChangeResult,
  type PlanChangeTarget,
  type Subscription,
} from "@/components/common/user-profile/payment-billing/subscription-services";
import type { MandateMethod } from "@/components/common/subscription/MandateMethodPicker";

/**
 * Gateway checkout payload handed to the host's <RazorpayCheckoutForm> ref.
 * Shaped by the backend's renew-payment response, not by us.
 */
export interface RenewalCheckoutPayload {
  razorpayKeyId: string;
  razorpayOrderId: string;
  amount: number;
  currency: string;
  contact: string;
  email: string;
  /** Present only when the backend registered a recurring (mandate) order. */
  recurring?: number;
  customerId?: string;
}

interface UseSubscriptionManagerArgs {
  instituteId: string | null | undefined;
  /**
   * Cache scope so two surfaces listing the same learner's subscriptions
   * (e.g. the public /subscriptions page and a dashboard card) don't fight
   * over one query key.
   */
  scope: string;
  /** Opens the gateway checkout — the caller owns the checkout component. */
  onCheckout: (payload: RenewalCheckoutPayload) => void;
}

/**
 * The learner-facing subscription actions in one place: list the plans, stop
 * auto-deduction (access is always retained until end_date), and start a
 * manual "pay to continue" renewal.
 *
 * Cancelling never cuts access early and renewing never creates a new plan —
 * the backend reactivates the SAME user_plan on gateway confirmation, which is
 * why `refetchSoon` re-polls instead of optimistically flipping the status.
 */
export function useSubscriptionManager({
  instituteId,
  scope,
  onCheckout,
}: UseSubscriptionManagerArgs) {
  const queryClient = useQueryClient();
  const [renewingPlanId, setRenewingPlanId] = useState<string | null>(null);
  const [changingPlanId, setChangingPlanId] = useState<string | null>(null);
  const queryKey = [SUBSCRIPTION_LIST_QUERY_KEY, scope, instituteId];
  // Guards against stacking timers when a learner retries a payment.
  const refetchTimers = useRef<number[]>([]);

  const {
    data: subscriptions,
    isLoading,
    isError,
  } = useQuery({
    queryKey,
    queryFn: () => fetchSubscriptions(instituteId as string),
    enabled: Boolean(instituteId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  /**
   * The gateway webhook reactivates the plan asynchronously — re-poll a few
   * times so the card flips to "active" without a manual reload.
   */
  const refetchSoon = () => {
    refetchTimers.current.forEach((id) => window.clearTimeout(id));
    refetchTimers.current = [3000, 8000, 15000].map((ms) =>
      window.setTimeout(invalidate, ms)
    );
  };

  const cancelMutation = useMutation({
    mutationFn: (userPlanId: string) =>
      cancelSubscription(instituteId as string, userPlanId),
    onSuccess: () => invalidate(),
  });

  const startRenewal = async (
    sub: Subscription,
    withAutopay: boolean,
    mandateMethod?: MandateMethod
  ) => {
    if (!instituteId) return;
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
      const response = await initiateRenewalPayment(
        instituteId,
        sub,
        // A stored-token gateway has no mandate to register, so neither flag applies.
        withAutopay && !sub.instant_renewal,
        sub.instant_renewal ? undefined : mandateMethod
      );
      // Stored-token gateway (eWay): the saved card was charged server-side and the
      // membership is already reactivating, so there is no checkout to hand over. Must be
      // checked before the razorpayKeyId test, or a completed payment would surface to the
      // learner as a failure to create the order.
      if (isRenewalAlreadyPaid(response)) {
        toast.success("Payment received!", {
          description: "Your membership is being reactivated — this takes a few seconds.",
        });
        refetchSoon();
        return;
      }
      const orderDetails = renewalResponseData(response);
      if (!orderDetails?.razorpayKeyId || !orderDetails?.razorpayOrderId) {
        throw new Error("Could not create the payment order");
      }
      onCheckout({
        razorpayKeyId: orderDetails.razorpayKeyId,
        razorpayOrderId: orderDetails.razorpayOrderId,
        amount: orderDetails.amount,
        currency: orderDetails.currency || sub.currency || "INR",
        contact: mobile,
        email,
        recurring: orderDetails.recurring,
        customerId: orderDetails.customerId,
      });
    } catch (e) {
      toast.error("Couldn't start the payment", {
        description:
          e instanceof Error ? e.message : "Please try again in a moment.",
      });
    } finally {
      setRenewingPlanId(null);
    }
  };

  /**
   * Book a plan change. An upgrade comes back with a gateway payload and is handed to the
   * host's checkout, exactly like a renewal; a downgrade comes back SCHEDULED with nothing
   * to pay, so the caller just shows the effective date. Returns the result either way so
   * the caller can tell the two apart.
   *
   * `requires_mandate_reauth` on the chosen target forces mandate mode: without it the
   * upgrade would go through and then every future auto-charge would be rejected — either
   * for exceeding the mandate's ceiling or because the new invite uses another gateway.
   */
  const startPlanChange = async (
    sub: Subscription,
    target: PlanChangeTarget,
    withAutopay: boolean,
    mandateMethod?: MandateMethod
  ): Promise<PlanChangeResult | null> => {
    if (!instituteId) return null;
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
          throw new Error("Could not create the payment order");
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
        onCheckout({
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
        // SCHEDULED or an upgrade fully covered by the proration credit — the plan (or the
        // booking on it) has already changed server-side, so re-read it.
        invalidate();
      }
      return result;
    } catch (e) {
      toast.error("Couldn't change the plan", {
        description:
          e instanceof Error ? e.message : "Please try again in a moment.",
      });
      return null;
    } finally {
      setChangingPlanId(null);
    }
  };

  const cancelPlanChangeMutation = useMutation({
    mutationFn: (userPlanId: string) =>
      cancelScheduledPlanChange(instituteId as string, userPlanId),
    onSuccess: () => invalidate(),
  });

  return {
    subscriptions: subscriptions ?? [],
    isLoading,
    isError,
    cancel: cancelMutation.mutateAsync,
    isCancelling: cancelMutation.isPending,
    startRenewal,
    renewingPlanId,
    startPlanChange,
    changingPlanId,
    cancelPlanChange: cancelPlanChangeMutation.mutateAsync,
    isCancellingPlanChange: cancelPlanChangeMutation.isPending,
    refetchSoon,
  };
}

export type { PlanChangeResult, PlanChangeTarget, Subscription };
// Re-exported so the hosts of this hook can tell an abandoned checkout from a booking
// without reaching past it into the services module.
export { isPlanChangeAwaitingPayment } from "@/components/common/user-profile/payment-billing/subscription-services";
