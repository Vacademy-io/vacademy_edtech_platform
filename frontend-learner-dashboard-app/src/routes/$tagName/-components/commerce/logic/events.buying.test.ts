import { describe, expect, it, vi } from 'vitest';
import { buildCommerceEvent, sendBeginCheckoutOnce, sendCommerceEvent, sendPurchaseOnce } from './events';

const items = [{ id: 'SAR-1', name: 'Red saree', unitPrice: 4899, quantity: 1, qtyScale: 1 }];
const store = () => {
    const data = new Map<string, string>();
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};
const page = (search = '') => ({ location: { search }, gtag: vi.fn(), fbq: vi.fn(), dataLayer: [] as unknown[] });

const PERSONAL = /9876543210|asha|example\.com|ghat|v1\.|s1\./i;

describe('checkout events', () => {
    it('builds begin_checkout, add_shipping_info and add_payment_info with the server value', () => {
        const begin = buildCommerceEvent({ name: 'begin_checkout', items, value: 4979, currency: 'INR', coupon: 'DIWALI' });
        expect(begin.ga).toMatchObject({ name: 'begin_checkout', params: { value: 4979, currency: 'INR', coupon: 'DIWALI' } });
        expect(begin.meta?.name).toBe('InitiateCheckout');
        expect(buildCommerceEvent({ name: 'add_shipping_info', items, value: 4979 }).ga.params).toMatchObject({ shipping_tier: 'standard', value: 4979 });
        const payment = buildCommerceEvent({ name: 'add_payment_info', items, value: 4979, paymentType: 'cod' });
        expect(payment.ga.params).toMatchObject({ payment_type: 'cod' });
        expect(payment.meta?.name).toBe('AddPaymentInfo');
    });

    it('builds purchase with the order number as transaction id and Meta eventID', () => {
        const built = buildCommerceEvent({ name: 'purchase', transactionId: 'ORD-000123', items, value: 4979, tax: 233.291, shipping: 80, currency: 'INR', paymentType: 'prepaid' });
        expect(built.ga.params).toMatchObject({ transaction_id: 'ORD-000123', value: 4979, tax: 233.29, shipping: 80, payment_type: 'prepaid' });
        expect(built.meta).toMatchObject({ name: 'Purchase', eventId: 'ORD-000123' });
        const win = page();
        sendCommerceEvent({ name: 'purchase', transactionId: 'ORD-000123', items, value: 4979, paymentType: 'prepaid' }, win);
        expect(win.fbq).toHaveBeenCalledWith('track', 'Purchase', expect.any(Object), { eventID: 'ORD-000123' });
    });

    it('sends login and the checkout error code only', () => {
        expect(buildCommerceEvent({ name: 'login' }).ga).toEqual({ name: 'login', params: { method: 'whatsapp_otp' } });
        expect(buildCommerceEvent({ name: 'commerce_checkout_error', code: 'price_changed' }).ga).toEqual({ name: 'commerce_checkout_error', params: { code: 'price_changed' } });
    });

    it('sends purchase once per order number on a device', () => {
        const storage = store();
        const win = page();
        const event = { name: 'purchase' as const, transactionId: 'ORD-000123', items, value: 4979, paymentType: 'cod' as const };
        expect(sendPurchaseOnce(event, 'inst-1', storage, win)).not.toBeNull();
        expect(sendPurchaseOnce(event, 'inst-1', storage, win)).toBeNull();
        expect(sendPurchaseOnce({ ...event, transactionId: 'ORD-000124' }, 'inst-1', storage, win)).not.toBeNull();
        // Order numbers restart per shop: the same number in another shop is its own purchase.
        expect(sendPurchaseOnce(event, 'inst-2', storage, win)).not.toBeNull();
        expect(win.gtag).toHaveBeenCalledTimes(3);
    });

    it('sends begin_checkout once per cart per session', () => {
        const storage = store();
        const win = page();
        const event = { name: 'begin_checkout' as const, items, value: 4979 };
        expect(sendBeginCheckoutOnce('h1', event, storage, win)).not.toBeNull();
        expect(sendBeginCheckoutOnce('h1', event, storage, win)).toBeNull();
        expect(sendBeginCheckoutOnce('h2', event, storage, win)).not.toBeNull();
    });

    it('says nothing, and remembers nothing, in the page builder preview', () => {
        const storage = store();
        const preview = page('?preview=true');
        expect(sendPurchaseOnce({ name: 'purchase', transactionId: 'ORD-1', items, paymentType: 'cod' }, 'inst-1', storage, preview)).toBeNull();
        expect(sendBeginCheckoutOnce('h1', { name: 'begin_checkout', items }, storage, preview)).toBeNull();
        expect(preview.gtag).not.toHaveBeenCalled();
        expect(storage.data.size).toBe(0);
    });

    it('carries no phone, e-mail, name, address or token in any payload', () => {
        const all = [
            buildCommerceEvent({ name: 'begin_checkout', items }),
            buildCommerceEvent({ name: 'add_shipping_info', items }),
            buildCommerceEvent({ name: 'add_payment_info', items, paymentType: 'prepaid' }),
            buildCommerceEvent({ name: 'purchase', transactionId: 'ORD-1', items, paymentType: 'prepaid' }),
            buildCommerceEvent({ name: 'login' }),
            buildCommerceEvent({ name: 'commerce_checkout_error', code: 'email_required' }),
        ];
        for (const built of all) expect(JSON.stringify(built)).not.toMatch(PERSONAL);
    });
});
