import type { ProductPageEnrollResponse } from '../-types/product-page-types';
import { isPaidEnrollment } from './site-cart-housekeeping';

/**
 * What the product-page checkout has to do with the server's answer to an
 * enrol call.
 *
 * The server, not the page, picks the gateway: it charges through the FIRST
 * SELECTED course's invite, while the page draws its payment UI from the first
 * course it maps. On a store page that sells through more than one gateway the
 * two differ, so the answer — never the page — decides what happens next:
 *
 * - `redirect`: a hosted payment page (Cashfree, PhonePe, …). Send the visitor
 *   there; the gateway confirms by webhook.
 * - `razorpay`: Razorpay Phase 1 — an order was created and waits to be paid
 *   (PAYMENT_PENDING with an order id). Nothing is bought yet, so this must
 *   never read as success: open Razorpay Checkout for that order.
 * - `unpayable`: such an order without the key Checkout needs to open it.
 * - `done`: the enrolment went through — free, a synchronous charge (Stripe,
 *   Eway), Razorpay Phase 2, or a payment the server recorded to settle later
 *   (INITIATED, e.g. offline). Only `paid` ones clear the site cart.
 */
export type EnrollOutcome =
    | { kind: 'redirect'; paymentUrl: string }
    | { kind: 'razorpay'; orderId: string; keyId: string }
    | { kind: 'unpayable' }
    | { kind: 'done'; paid: boolean };

type EnrollAnswer = Pick<
    ProductPageEnrollResponse,
    'status' | 'payment_url' | 'order_id' | 'razorpay_key_id'
>;

export const enrollOutcomeOf = (result: EnrollAnswer | null | undefined): EnrollOutcome => {
    if (result?.payment_url) return { kind: 'redirect', paymentUrl: result.payment_url };
    const orderId = result?.order_id || '';
    const keyId = result?.razorpay_key_id || '';
    const pending = String(result?.status ?? '').toUpperCase() === 'PAYMENT_PENDING';
    // An order id with the key is what the Razorpay button has always opened;
    // PAYMENT_PENDING with an order id is the same order even when the key is
    // missing — still unpaid, so still not a success.
    if (orderId && (pending || keyId)) {
        return keyId ? { kind: 'razorpay', orderId, keyId } : { kind: 'unpayable' };
    }
    return { kind: 'done', paid: isPaidEnrollment(result) };
};
