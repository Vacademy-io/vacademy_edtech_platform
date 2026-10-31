import { fetchPaymentOutcome } from "../-components/site-cart/payment-status";
import type { PaymentOutcome } from "../-components/site-cart/pending-purchases";

/**
 * Settling a storefront payment.
 *
 * Razorpay calling its success handler only says the learner finished paying;
 * the order counts as paid when the gateway webhook marks the payment log PAID.
 * The cart is cleared (and the learner sent on) only after that, so everything
 * here reads the open payment-log status rather than trusting the browser.
 */

/** How often the status is asked for while waiting for the webhook. */
export const PAYMENT_POLL_INTERVAL_MS = 3000;
/** How long the checkout waits for the webhook before leaving it to the cart page's own check. */
export const PAYMENT_POLL_TIMEOUT_MS = 2 * 60 * 1000;
/**
 * How long the cart page's own check waits (three looks, 3 s apart) before it
 * leaves an order that is still settling for the next visit.
 */
export const PENDING_ORDER_CHECK_WINDOW_MS = 2 * PAYMENT_POLL_INTERVAL_MS;
/**
 * An unsettled order older than this is given up on: the stock hold on it has
 * expired by then, so there is nothing left to wait for.
 */
export const PENDING_ORDER_MAX_AGE_MS = 30 * 60 * 1000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /**
   * Whether the first FAILED reading ends the wait. A learner may retry inside
   * the same Razorpay window after a failed attempt, and the gateway reports
   * that failed attempt as FAILED until the successful retry's webhook turns it
   * PAID. A caller that already knows Razorpay accepted a payment passes
   * `false`, so only a FAILED that outlasts the whole wait counts.
   */
  failedIsFinal?: boolean;
  /** Overridable for tests. */
  fetchOutcome?: (paymentLogId: string) => Promise<PaymentOutcome>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Asks for the payment's status every `intervalMs` until it is PAID (or FAILED,
 * see `failedIsFinal`) or `timeoutMs` has passed, in which case it is still
 * "pending". A status call that errors counts as "not known yet", never as a
 * failure: the payment may well have gone through.
 */
export const pollPaymentOutcome = async (
  paymentLogId: string,
  {
    intervalMs = PAYMENT_POLL_INTERVAL_MS,
    timeoutMs = PAYMENT_POLL_TIMEOUT_MS,
    failedIsFinal = true,
    fetchOutcome = fetchPaymentOutcome,
    sleep = wait,
    now = Date.now,
  }: PollOptions = {},
): Promise<PaymentOutcome> => {
  const deadline = now() + timeoutMs;
  let last: PaymentOutcome = "pending";
  for (;;) {
    try {
      last = await fetchOutcome(paymentLogId);
      if (last === "paid") return "paid";
      if (last === "failed" && failedIsFinal) return "failed";
    } catch {
      last = "pending";
    }
    if (now() + intervalMs > deadline) return last;
    await sleep(intervalMs);
  }
};

/**
 * True when the order was started more than `PENDING_ORDER_MAX_AGE_MS` ago.
 * A missing, unreadable or future timestamp (a skewed clock) is not stale, so
 * the order is only ever given up on for a reason that can be proven.
 */
export const isPendingOrderStale = (
  createdAt: string | number | null | undefined,
  now: number = Date.now(),
): boolean => {
  const started = Number(createdAt);
  if (!createdAt || !Number.isFinite(started)) return false;
  return now - started > PENDING_ORDER_MAX_AGE_MS;
};
