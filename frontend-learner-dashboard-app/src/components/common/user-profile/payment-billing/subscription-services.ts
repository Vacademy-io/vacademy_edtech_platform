import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import {
  LEARNER_SUBSCRIPTION_LIST,
  LEARNER_SUBSCRIPTION_CANCEL,
  LEARNER_SUBSCRIPTION_RENEW_COMPLETE,
  LEARNER_PLAN_CHANGE_OPTIONS,
  LEARNER_PLAN_CHANGE,
} from "@/constants/urls";
import type { MandateMethod } from "@/components/common/subscription/MandateMethodPicker";

/**
 * One subscription (a UserPlan) and its autopay mandate. Mirrors the backend
 * SubscriptionDTO (snake_case, like the other learner payment endpoints).
 */
export interface Subscription {
  user_plan_id: string;
  plan_name?: string | null;
  status: string; // ACTIVE | CANCELED | EXPIRED | PAYMENT_FAILED
  end_date?: string | null; // access valid until
  next_charge_at?: string | null;
  auto_renewal_enabled?: boolean | null;
  is_trial?: boolean | null;
  vendor?: string | null; // RAZORPAY | EWAY | ...
  mandate_status?: string | null; // ACTIVE | REVOKED | FAILED | null
  mandate_max_amount?: number | null;
  currency?: string | null;
  has_active_mandate: boolean;
  package_session_ids?: string[] | null;
  // Manual renewal ("pay to continue"): plan price + gateway coordinates for
  // building the RENEWAL payment; flag decides whether to offer the button.
  plan_price?: number | null;
  vendor_id?: string | null;
  can_renew_manually?: boolean;
  /**
   * Length of one paid period in days, so the renewal screen can name what is being bought
   * ("AUD for 12 months", "back for another month") instead of assuming a year. Server-side
   * it comes from the same resolver the renewal uses to extend end_date, so the period shown
   * is the period charged. Absent on older backends — fall back to a period-less wording.
   */
  plan_validity_days?: number | null;
  /**
   * Institute's utility-email address, for the "questions about your renewal" line. Absent
   * when the institute has none configured — the line is then dropped, never defaulted to
   * another institute's address.
   */
  support_email?: string | null;
  /**
   * This plan row was never a membership — an abandoned or failed first checkout. The server
   * refuses to renew it (a renewal extends existing access, and there is none), so offer
   * "complete your enrollment" instead and route back through the invite checkout, where a
   * fresh access window is computed. Mutually exclusive with can_renew_manually.
   */
  can_complete_enrollment?: boolean;
  /** Invite code behind the plan, for building that enrollment link. */
  enroll_invite_code?: string | null;
  /** Invite has autopay configured — gates the "enable auto-pay" option. */
  autopay_available?: boolean;
  /**
   * The gateway charges a card already stored against the learner (eWay), so a manual
   * renewal completes in the one request: no checkout opens, and there is no mandate to
   * register — hence no autopay method picker. False means the renewal returns checkout
   * coordinates to open (Razorpay).
   */
  instant_renewal?: boolean;
  /**
   * The gateway a renewal will actually go through — NOT always `vendor`, which names the
   * gateway the plan was sold on. Use this for gateway-specific assets (eWay eCrypt keys):
   * the institute may no longer have the plan's original gateway configured.
   */
  renewal_vendor?: string | null;
  /**
   * The institute wants a manual renewal to arm autopay by default
   * (PAYMENT_SETTING.autopayDefaultOnManualRenewal). Pre-select the autopay choice from
   * this rather than assuming off — the learner can still clear it where a checkbox shows.
   */
  autopay_default?: boolean;
  /**
   * At least one other plan is flagged switchable for this membership. Gates the
   * "Change plan" entry point so we never open an empty picker.
   */
  can_change_plan?: boolean;
  /** A downgrade already booked for the end of the cycle, if any. */
  scheduled_plan_change?: ScheduledPlanChange | null;
}

/**
 * A plan change that is open but has not landed yet: either booked for the end of the
 * cycle (SCHEDULED) or waiting on a checkout the learner has not paid (PENDING_PAYMENT).
 * Shown on the card because otherwise "you're on Monthly" quietly stops being true at the
 * next renewal -- and because an unpaid one used to be invisible while still blocking a
 * second attempt, leaving the learner with no way forward.
 */
export interface ScheduledPlanChange {
  change_request_id: string;
  to_plan_id: string;
  to_plan_name?: string | null;
  to_plan_price?: number | null;
  currency?: string | null;
  effective_from?: string | null;
  /** SCHEDULED | PENDING_PAYMENT. Branch on this, not on which fields are set. */
  status?: string | null;
  /** What is still owed on a PENDING_PAYMENT change. Null for a scheduled one. */
  amount_due_now?: number | null;
}

/**
 * True for a change whose checkout was opened and abandoned. The copy and the actions
 * differ completely from a booked change: this one needs finishing or dropping, and there
 * is no date on which it would apply by itself.
 */
export const isPlanChangeAwaitingPayment = (
  change?: ScheduledPlanChange | null
): boolean => change?.status === "PENDING_PAYMENT";

/**
 * One plan the learner may switch to, already priced for them right now — mirrors the
 * backend PlanChangeTargetDTO.
 */
export interface PlanChangeTarget {
  plan_id: string;
  plan_name?: string | null;
  payment_option_id: string;
  option_name?: string | null;
  option_type?: string | null;
  enroll_invite_id?: string | null;
  price?: number | null;
  currency?: string | null;
  validity_in_days?: number | null;
  feature_json?: string | null;
  description?: string | null;
  /** UPGRADE | DOWNGRADE | LATERAL */
  direction: string;
  /** IMMEDIATE | END_OF_CYCLE */
  effective_type: string;
  /** The current plan's price, allowed against this plan's price. Zero when nothing is traded in. */
  proration_credit?: number | null;
  /** True when the current plan was traded in, so amount_due_now is the price DIFFERENCE. */
  trade_in_applied?: boolean;
  /** Days this change adds to the access window. */
  extension_days?: number | null;
  /** What the learner pays now. 0 for a scheduled downgrade. */
  amount_due_now?: number | null;
  effective_from?: string | null;
  /**
   * Taking this target invalidates the existing auto-pay mandate (price above its
   * max_amount, or a different gateway), so the checkout must re-register the mandate.
   */
  requires_mandate_reauth?: boolean;
  /** Also moves the learner to a different payment option + enroll invite. */
  cross_option?: boolean;
}

export interface PlanChangeOptions {
  user_plan_id: string;
  current_plan_id?: string | null;
  current_plan_name?: string | null;
  current_plan_price?: number | null;
  current_payment_option_id?: string | null;
  current_option_name?: string | null;
  currency?: string | null;
  current_validity_in_days?: number | null;
  current_end_date?: string | null;
  targets: PlanChangeTarget[];
  scheduled_change?: ScheduledPlanChange | null;
  can_change_plan: boolean;
  /** Populated when can_change_plan is false, so the UI can say why. */
  blocked_reason?: string | null;
}

export interface PlanChangeResult {
  /** PENDING_PAYMENT | SCHEDULED | APPLIED — branch on this, not on which fields are set. */
  status: string;
  change_request_id: string;
  direction: string;
  to_plan_id: string;
  to_plan_name?: string | null;
  effective_from?: string | null;
  amount_due_now?: number | null;
  proration_credit?: number | null;
  currency?: string | null;
  requires_mandate_reauth?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payment_response?: any;
}

export const SUBSCRIPTION_LIST_QUERY_KEY = "LEARNER_SUBSCRIPTION_LIST";

export const fetchSubscriptions = async (
  instituteId: string
): Promise<Subscription[]> => {
  const response = await authenticatedAxiosInstance.get(
    LEARNER_SUBSCRIPTION_LIST,
    { params: { instituteId } }
  );
  return response.data;
};

/** Cancel autopay for a subscription. Access is retained until end_date. */
export const cancelSubscription = async (
  instituteId: string,
  userPlanId: string
): Promise<Subscription> => {
  const response = await authenticatedAxiosInstance.post(
    LEARNER_SUBSCRIPTION_CANCEL(userPlanId),
    null,
    { params: { instituteId } }
  );
  return response.data;
};

/**
 * Start a MANUAL RENEWAL payment for an existing plan ("pay to continue").
 * The backend derives amount/vendor from the plan itself and creates a
 * plan-linked RENEWAL order — on gateway confirmation the SAME membership
 * reactivates (no new records). With withAutopay the checkout opens in
 * mandate mode: one approval pays AND re-registers auto-pay.
 *
 * Two response shapes, distinguished by response_data — always check
 * isRenewalAlreadyPaid() FIRST:
 *  - hosted gateway (eWay): paymentStatus === "REDIRECT" and nothing charged —
 *    send the browser to `redirectUrl`, where the gateway collects the card. It
 *    returns to /subscriptions/payment-return, which calls completeRenewalPayment;
 *  - checkout gateway (Razorpay): razorpayKeyId / razorpayOrderId to open.
 */
export const initiateRenewalPayment = async (
  instituteId: string,
  sub: Subscription,
  withAutopay: boolean,
  // Only meaningful with withAutopay: how the fresh mandate is authorised (UPI Autopay
  // or card e-mandate), the same choice the enrol form offers.
  mandateMethod?: MandateMethod
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> => {
  // No body: the card is never posted to us, it is entered on the gateway's own page.
  // `undefined` (not `null`) makes axios omit the body and its content-type header
  // together — posting null let the browser default to form-urlencoded, which the
  // endpoint could not parse.
  const response = await authenticatedAxiosInstance.post(
    `${LEARNER_SUBSCRIPTION_LIST}/${sub.user_plan_id}/renew-payment`,
    undefined,
    {
      params: {
        instituteId,
        withAutopay,
        ...(withAutopay && mandateMethod ? { mandateMethod } : {}),
      },
    }
  );
  return response.data;
};

/** The checkout/confirmation block of a renewal or plan-change response, wherever it sits. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const renewalResponseData = (response: any) =>
  response?.payment_response?.response_data || response?.response_data;

/**
 * True when the backend already took the payment and there is no checkout to open — a
 * stored-token gateway like eWay charges the saved card server-side and confirms inline.
 * Callers must test this BEFORE looking for razorpayKeyId, or a completed payment reads
 * as "could not create the order".
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isRenewalAlreadyPaid = (response: any): boolean =>
  String(renewalResponseData(response)?.paymentStatus ?? "").toUpperCase() === "PAID";

/**
 * True when the learner must finish on the gateway's own hosted card page. Nothing has been
 * charged; send the browser to `renewalRedirectUrl(response)`. Not an error state.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isRenewalRedirect = (response: any): boolean =>
  String(renewalResponseData(response)?.paymentStatus ?? "").toUpperCase() === "REDIRECT";

/** The hosted card page to send the browser to, when isRenewalRedirect(). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const renewalRedirectUrl = (response: any): string | undefined =>
  renewalResponseData(response)?.redirectUrl;

/**
 * Confirms a renewal after the gateway redirected the learner back. The backend asks the
 * gateway what happened rather than trusting the return URL, and the claim is idempotent, so
 * calling this twice cannot extend the membership twice.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const completeRenewalPayment = async (
  instituteId: string,
  userPlanId: string,
  orderId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> => {
  const response = await authenticatedAxiosInstance.post(
    LEARNER_SUBSCRIPTION_RENEW_COMPLETE(userPlanId),
    undefined,
    { params: { instituteId, orderId } }
  );
  return response.data;
};

export const PLAN_CHANGE_OPTIONS_QUERY_KEY = "LEARNER_PLAN_CHANGE_OPTIONS";

/** The plans this learner may switch to, priced for them right now. */
export const fetchPlanChangeOptions = async (
  instituteId: string,
  userPlanId: string
): Promise<PlanChangeOptions> => {
  const response = await authenticatedAxiosInstance.get(
    LEARNER_PLAN_CHANGE_OPTIONS(userPlanId),
    { params: { instituteId } }
  );
  return response.data;
};

/**
 * Book a plan change. Sends only the target plan id — the price, the proration and whether
 * the target is even allowed are all derived server-side, never trusted from here.
 *
 * An upgrade comes back PENDING_PAYMENT with a gateway checkout payload; a downgrade comes
 * back SCHEDULED with the date it takes effect and nothing to pay.
 */
export const requestPlanChange = async (
  instituteId: string,
  userPlanId: string,
  targetPlanId: string,
  withAutopay: boolean,
  mandateMethod?: MandateMethod
): Promise<PlanChangeResult> => {
  const response = await authenticatedAxiosInstance.post(
    LEARNER_PLAN_CHANGE(userPlanId),
    {
      target_plan_id: targetPlanId,
      with_autopay: withAutopay,
      ...(withAutopay && mandateMethod ? { mandate_method: mandateMethod } : {}),
    },
    { params: { instituteId } }
  );
  return response.data;
};

/** Call off an open change: a booked downgrade, or a checkout that was never paid. */
export const cancelScheduledPlanChange = async (
  instituteId: string,
  userPlanId: string
): Promise<void> => {
  await authenticatedAxiosInstance.delete(LEARNER_PLAN_CHANGE(userPlanId), {
    params: { instituteId },
  });
};
