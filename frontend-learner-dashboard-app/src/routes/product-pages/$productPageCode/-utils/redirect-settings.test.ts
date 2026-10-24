import { describe, expect, it } from 'vitest';
import {
    DEFAULT_REDIRECT_DELAY_SECONDS,
    MAX_REDIRECT_DELAY_SECONDS,
    clampRedirectDelay,
    resolveRedirectTarget,
} from './redirect-settings';

/**
 * Both settings come from a free-text field in the admin editor, so the
 * checkout has to survive whatever is typed there — and the admin screen shows
 * the learner exactly these answers before anyone buys anything.
 */

describe('resolveRedirectTarget', () => {
    it('accepts an absolute http(s) URL and a same-site path', () => {
        expect(resolveRedirectTarget('https://shikshanation.com/thank-you')).toBe(
            'https://shikshanation.com/thank-you'
        );
        expect(resolveRedirectTarget('  https://shikshanation.com/thank-you  ')).toBe(
            'https://shikshanation.com/thank-you'
        );
        expect(resolveRedirectTarget('/dashboard')).toBe('/dashboard');
    });

    it('refuses anything a browser should not be sent to', () => {
        // A bare host is the likely typo — the browser would resolve it as a
        // relative path off /product-pages/, landing the buyer nowhere.
        expect(resolveRedirectTarget('shikshanation.com/thank-you')).toBeNull();
        expect(resolveRedirectTarget('javascript:alert(1)')).toBeNull();
        expect(resolveRedirectTarget('')).toBeNull();
        expect(resolveRedirectTarget('   ')).toBeNull();
    });

    it('treats a protocol-relative value as the absolute URL it is', () => {
        expect(resolveRedirectTarget('//shikshanation.com/thank-you')).toBeNull();
    });
});

describe('clampRedirectDelay', () => {
    it('falls back to the default when the setting was never written', () => {
        expect(clampRedirectDelay(undefined)).toBe(DEFAULT_REDIRECT_DELAY_SECONDS);
        expect(clampRedirectDelay(null)).toBe(DEFAULT_REDIRECT_DELAY_SECONDS);
        expect(clampRedirectDelay(Number.NaN)).toBe(DEFAULT_REDIRECT_DELAY_SECONDS);
    });

    it('honours an explicit instant redirect', () => {
        // 0 is a real choice, not a missing value — it must not fall back.
        expect(clampRedirectDelay(0)).toBe(0);
    });

    it('keeps the wait inside a range a buyer will sit through', () => {
        expect(clampRedirectDelay(-5)).toBe(0);
        expect(clampRedirectDelay(900)).toBe(MAX_REDIRECT_DELAY_SECONDS);
        expect(clampRedirectDelay(2.4)).toBe(2);
    });
});
