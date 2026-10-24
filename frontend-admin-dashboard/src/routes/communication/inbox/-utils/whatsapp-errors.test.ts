import { describe, expect, it, vi } from 'vitest';
import en from '../../../../../public/locales/en/communicationWhatsappErrors.json';

/**
 * whatsapp-errors.ts resolves its display text through the i18next singleton (it runs from
 * plain, non-React call sites, so it cannot use the useTranslation() hook). Rather than boot the
 * real i18next backend (which fetches catalogs over the network — unavailable here), mock the
 * singleton with a tiny resolver over the real English catalog, so these tests still exercise the
 * actual production strings rather than raw keys.
 */
function readCatalog(path: string[]): unknown {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return path.reduce((node: any, segment) => node?.[segment], en);
}

vi.mock('@/i18n', () => ({
    default: {
        language: 'en',
        t: (key: string, options?: Record<string, unknown>) => {
            const [, path] = key.split(':');
            const value = readCatalog(path?.split('.') ?? []);
            if (typeof value !== 'string') return key;
            if (!options) return value;
            return value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options[name] ?? ''));
        },
    },
}));

const {
    describeApiError,
    explainWhatsAppFailure,
} = await import('@/routes/communication/inbox/-utils/whatsapp-errors');

/**
 * A failed WhatsApp message used to reach the admin as the provider's own shorthand —
 * "Re-engagement message (131047)" — which names the rule Meta applied and nothing an admin can do
 * about it. These tests pin the two halves of the contract: known codes are explained, and unknown
 * ones still show the provider's exact words rather than a guess.
 */
describe('explaining a WhatsApp failure', () => {
    it('turns the 24-hour window refusal into what actually happened', () => {
        const failure = explainWhatsAppFailure('Re-engagement message (131047)');

        expect(failure?.title).toBe('24-hour reply window closed');
        expect(failure?.detail).toContain('approved template');
        expect(failure?.code).toBe('131047');
        expect(failure?.accountLevel).toBeFalsy();
    });

    it('marks a billing failure as affecting the whole number, not one recipient', () => {
        const failure = explainWhatsAppFailure('Business eligibility payment issue (131042)');

        expect(failure?.accountLevel).toBe(true);
        expect(failure?.code).toBe('131042');
    });

    it('keeps the provider’s own words for a code it does not know', () => {
        const failure = explainWhatsAppFailure('Something new went wrong (999999)');

        expect(failure?.title).toBe('Something new went wrong');
        expect(failure?.detail).toBeUndefined();
        expect(failure?.code).toBe('999999');
    });

    it('reads a code that is labelled instead of bracketed', () => {
        expect(explainWhatsAppFailure('error code: 131026')?.title).toBe('Message undeliverable');
    });

    it('recognises an exhausted wallet, which arrives as prose with no code at all', () => {
        const failure = explainWhatsAppFailure('Insufficient balance to send message');

        expect(failure?.title).toBe('Out of WhatsApp credits');
        expect(failure?.accountLevel).toBe(true);
    });

    it('cuts an essay down to a headline instead of laying it out in full', () => {
        const failure = explainWhatsAppFailure('x'.repeat(400));

        expect(failure?.title.length).toBeLessThanOrEqual(161);
        expect(failure?.title.endsWith('…')).toBe(true);
    });

    it('has nothing to say about a message that carries no failure', () => {
        expect(explainWhatsAppFailure(undefined)).toBeNull();
        expect(explainWhatsAppFailure('   ')).toBeNull();
    });
});

describe('explaining a failed request', () => {
    it('prefers the server’s own reason, translated', () => {
        const info = describeApiError(
            { response: { status: 502, data: { message: 'Re-engagement message (131047)' } } },
            'Message not sent'
        );

        expect(info.title).toBe('24-hour reply window closed');
    });

    it('names a session that has expired rather than blaming the message', () => {
        expect(describeApiError({ response: { status: 403 } }, 'Message not sent').title).toBe(
            'You do not have access to this inbox'
        );
    });

    it('says the server could not be reached when there is no response at all', () => {
        const info = describeApiError({}, 'Could not load conversations');

        expect(info.title).toBe('Could not load conversations');
        expect(info.detail).toContain('Could not reach the server');
    });

    it('ignores a gateway’s HTML error page instead of pasting markup into a toast', () => {
        const info = describeApiError(
            { response: { status: 502, data: '<html><body>502 Bad Gateway</body></html>' } },
            'Could not load conversations'
        );

        expect(info.title).toBe('Could not load conversations');
        expect(info.detail).toContain('502');
    });

    it('does not blame the network for an error thrown while handling the answer', () => {
        const info = describeApiError(
            new TypeError('data.reverse is not a function'),
            'Could not load this conversation'
        );

        expect(info.detail).toContain('data.reverse is not a function');
        expect(info.detail).not.toContain('connection');
    });

    it('still blames the network for a real transport failure', () => {
        const info = describeApiError(
            { isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' },
            'Could not load conversations'
        );

        expect(info.detail).toContain('Could not reach the server');
    });

    it('reports a server error with its status, not as a silent empty list', () => {
        const info = describeApiError(
            { response: { status: 500 } },
            'Could not load conversations'
        );

        expect(info.title).toBe('Could not load conversations');
        expect(info.detail).toContain('500');
    });
});
