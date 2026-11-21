import axios from "axios";

/**
 * What to tell a learner when the product-page checkout call fails.
 *
 * The checkout calls go through plain axios, so a failure's own `message` is
 * the transport's ("Request failed with status code 409"). The server's
 * explanation lives in the response body ({message} or {ex}); show that when
 * it was written for the learner. A 409 means a price on the page changed
 * since it loaded (the server refuses a plan the page no longer sells) — the
 * page data must be fetched again before the learner can retry.
 */
export interface CheckoutError {
  message: string;
  /** The page's prices changed: refetch it before retrying. */
  priceChanged: boolean;
}

/**
 * Whose body is meant to be read: a refused request (4xx — the price notice, a
 * coupon that no longer applies) or a VacademyException (510). Every other
 * failure keeps the caller's translated message — the 511 catch-all answers
 * with the raw exception text (SQL, class names), other 5xx with whatever the
 * proxy sent, and a network error with no response at all.
 */
const isLearnerFacingStatus = (status: number | undefined): boolean =>
  status !== undefined && ((status >= 400 && status < 500) || status === 510);

export const checkoutErrorOf = (err: unknown, fallback: string, priceChangedFallback: string): CheckoutError => {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data as { message?: unknown; ex?: unknown } | undefined;
    const raw = typeof data?.message === "string" ? data.message : typeof data?.ex === "string" ? data.ex : "";
    const serverMessage = raw.trim();
    if (status === 409) return { message: serverMessage || priceChangedFallback, priceChanged: true };
    if (serverMessage && isLearnerFacingStatus(status)) return { message: serverMessage, priceChanged: false };
  }
  return { message: fallback, priceChanged: false };
};
