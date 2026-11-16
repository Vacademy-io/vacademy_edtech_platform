/**
 * Razorpay Checkout, loaded on demand when the shopper pays (contract P2 §9). UPI is put first;
 * cards and netbanking follow in Razorpay's own order. The key id, order id and amount are the
 * server's (the `payment` of the placed order); nothing here decides an amount.
 */
import type { PlacedPayment } from '../api/types';
import { loadScriptOnce } from './scripts';

export const RAZORPAY_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpayInstance {
    open(): void;
    on(event: string, handler: (response: unknown) => void): void;
}
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

const ctor = (): RazorpayCtor | undefined =>
    typeof window === 'undefined' ? undefined : (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;

export const loadRazorpay = (): Promise<void> => loadScriptOnce(RAZORPAY_SRC, () => typeof ctor() === 'function');

export type RazorpayOutcome =
    | { kind: 'paid'; gatewayOrderId: string; gatewayPaymentId: string; signature: string }
    | { kind: 'dismissed' };

export type PreferredMethod = 'upi' | 'card' | 'netbanking' | null;

/** The options object Razorpay is opened with (exported for tests). */
export const razorpayOptions = (args: {
    payment: PlacedPayment;
    siteName: string;
    phone: string | null;
    email: string | null;
    method: PreferredMethod;
    onPaid(response: { razorpay_order_id?: string; razorpay_payment_id?: string; razorpay_signature?: string }): void;
    onDismiss(): void;
}): Record<string, unknown> => ({
    key: args.payment.key_id,
    order_id: args.payment.gateway_order_id,
    amount: args.payment.amount_minor,
    currency: args.payment.currency,
    name: args.siteName || undefined,
    prefill: {
        ...(args.phone ? { contact: `+91${args.phone}` } : {}),
        ...(args.email ? { email: args.email } : {}),
        ...(args.method ? { method: args.method } : {}),
    },
    config: {
        display: {
            blocks: { upi: { name: 'UPI', instruments: [{ method: 'upi' }] } },
            sequence: ['block.upi'],
            preferences: { show_default_blocks: true },
        },
    },
    retry: { enabled: true },
    handler: args.onPaid,
    modal: { ondismiss: args.onDismiss, confirm_close: true },
});

/** Opens the payment window; resolves when it was paid or closed. Rejects when the script fails. */
export const payWithRazorpay = async (args: {
    payment: PlacedPayment;
    siteName: string;
    phone: string | null;
    email: string | null;
    method: PreferredMethod;
}): Promise<RazorpayOutcome> => {
    await loadRazorpay();
    const Razorpay = ctor();
    if (!Razorpay) throw new Error('razorpay missing');
    return new Promise<RazorpayOutcome>((resolve) => {
        let done = false;
        const finish = (outcome: RazorpayOutcome) => {
            if (done) return;
            done = true;
            resolve(outcome);
        };
        const instance = new Razorpay(
            razorpayOptions({
                ...args,
                onPaid: (response) =>
                    finish({
                        kind: 'paid',
                        gatewayOrderId: response.razorpay_order_id || args.payment.gateway_order_id,
                        gatewayPaymentId: response.razorpay_payment_id || '',
                        signature: response.razorpay_signature || '',
                    }),
                onDismiss: () => finish({ kind: 'dismissed' }),
            })
        );
        instance.open();
    });
};
