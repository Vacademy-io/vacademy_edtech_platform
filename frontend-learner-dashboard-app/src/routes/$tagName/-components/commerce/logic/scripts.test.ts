// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { RAZORPAY_SRC, razorpayOptions } from './razorpay';
import { ScriptLoadError, loadScriptOnce, resetScriptsForTests } from './scripts';
import { TURNSTILE_SRC } from './turnstile';

afterEach(() => {
    resetScriptsForTests();
    document.head.innerHTML = '';
});

const scripts = (src: string) => Array.from(document.head.querySelectorAll('script')).filter((s) => s.src === src);

describe('script loaders', () => {
    it('adds a script once, however often it is asked for', async () => {
        let ready = false;
        const one = loadScriptOnce(RAZORPAY_SRC, () => ready);
        const two = loadScriptOnce(RAZORPAY_SRC, () => ready);
        expect(scripts(RAZORPAY_SRC)).toHaveLength(1);
        ready = true;
        scripts(RAZORPAY_SRC)[0]!.dispatchEvent(new Event('load'));
        await expect(one).resolves.toBeUndefined();
        await expect(two).resolves.toBeUndefined();
        await expect(loadScriptOnce(RAZORPAY_SRC, () => ready)).resolves.toBeUndefined();
        expect(scripts(RAZORPAY_SRC)).toHaveLength(1);
    });

    it('fails with an error state on a load failure, and tries again next time', async () => {
        const first = loadScriptOnce(TURNSTILE_SRC, () => false);
        scripts(TURNSTILE_SRC)[0]!.dispatchEvent(new Event('error'));
        await expect(first).rejects.toBeInstanceOf(ScriptLoadError);
        expect(scripts(TURNSTILE_SRC)).toHaveLength(0);
        void loadScriptOnce(TURNSTILE_SRC, () => false).catch(() => undefined);
        expect(scripts(TURNSTILE_SRC)).toHaveLength(1);
    });

    it('treats a script that loads without its global as failed', async () => {
        const promise = loadScriptOnce(RAZORPAY_SRC, () => false);
        scripts(RAZORPAY_SRC)[0]!.dispatchEvent(new Event('load'));
        await expect(promise).rejects.toBeInstanceOf(ScriptLoadError);
    });

    it('loads Turnstile in explicit mode from Cloudflare', () => {
        expect(TURNSTILE_SRC).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
        expect(RAZORPAY_SRC).toBe('https://checkout.razorpay.com/v1/checkout.js');
    });
});

describe('Razorpay options', () => {
    it('uses the server payment, puts UPI first and prefills only what was typed', () => {
        const options = razorpayOptions({
            payment: { vendor: 'RAZORPAY', gateway_order_id: 'order_1', key_id: 'rzp_test_1', amount_minor: 497900, currency: 'INR' },
            siteName: 'Example Brand',
            phone: '9876543210',
            email: null,
            method: 'upi',
            onPaid: () => undefined,
            onDismiss: () => undefined,
        });
        expect(options).toMatchObject({ key: 'rzp_test_1', order_id: 'order_1', amount: 497900, currency: 'INR', name: 'Example Brand' });
        expect(options.prefill).toEqual({ contact: '+919876543210', method: 'upi' });
        expect((options.config as { display: { sequence: string[] } }).display.sequence).toEqual(['block.upi']);
    });
});
