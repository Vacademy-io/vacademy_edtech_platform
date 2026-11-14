import { describe, expect, it } from 'vitest';
import { enrollOutcomeOf } from './enroll-outcome';

const answer = (fields: Record<string, unknown>) => ({
    status: 'PAID',
    payment_url: null,
    order_id: null,
    razorpay_key_id: null,
    ...fields,
});

/**
 * Every answer ProductPageEnrollmentService.enrollForProductPage gives, and
 * what the page must make of it.
 */
describe('enrollOutcomeOf', () => {
    it('opens Razorpay for a Phase 1 order — never a success', () => {
        expect(enrollOutcomeOf(answer({ status: 'PAYMENT_PENDING', order_id: 'order_1', razorpay_key_id: 'rzp_key' }))).toEqual({
            kind: 'razorpay',
            orderId: 'order_1',
            keyId: 'rzp_key',
        });
    });

    it('cannot open a Phase 1 order without the key — still not a success', () => {
        expect(enrollOutcomeOf(answer({ status: 'PAYMENT_PENDING', order_id: 'order_1' }))).toEqual({ kind: 'unpayable' });
        expect(enrollOutcomeOf(answer({ status: 'payment_pending', order_id: 'order_1', razorpay_key_id: '' }))).toEqual({
            kind: 'unpayable',
        });
    });

    it('follows a hosted payment page (Cashfree, PhonePe)', () => {
        expect(enrollOutcomeOf(answer({ status: 'PAYMENT_PENDING', payment_url: 'https://pay.example/x' }))).toEqual({
            kind: 'redirect',
            paymentUrl: 'https://pay.example/x',
        });
    });

    it('finishes what the server finished: free, synchronous charge, Phase 2', () => {
        expect(enrollOutcomeOf(answer({ status: 'PAID' }))).toEqual({ kind: 'done', paid: true });
    });

    it('finishes a payment recorded to settle later, without counting it as paid', () => {
        expect(enrollOutcomeOf(answer({ status: 'INITIATED' }))).toEqual({ kind: 'done', paid: false });
        // PAYMENT_PENDING with neither an order nor a page: as before, a finish.
        expect(enrollOutcomeOf(answer({ status: 'PAYMENT_PENDING' }))).toEqual({ kind: 'done', paid: false });
    });

    it('opens an order the Razorpay button got back, as it always has', () => {
        // The button opened any answer carrying an order id and a key.
        expect(enrollOutcomeOf(answer({ status: 'CREATED', order_id: 'order_2', razorpay_key_id: 'rzp_key' }))).toEqual({
            kind: 'razorpay',
            orderId: 'order_2',
            keyId: 'rzp_key',
        });
    });
});
