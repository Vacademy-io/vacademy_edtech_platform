import { describe, expect, it } from 'vitest';

import strings from '../../../../../../../../public/locales/en/manageStudentsIndividualSendDialog.json';
import { resolveSendVerdict } from './individual-send-dialog';
import type { DeliveryStatus, UnifiedSendResponse } from '@/services/unified-send-service';

/**
 * The send dialog's closing panel is the only place an admin learns what happened to a message, and
 * every wrong answer it can give is expensive: a green tick on a message WhatsApp refused (131042
 * killed 202 HCCA sends behind exactly that tick), or a worried grey "awaiting confirmation" on one
 * that arrived seconds ago. Both verdicts — the send call's and the status webhook's — are covered
 * here, against the real English catalogue so a heading can never point at a key that was renamed.
 */
const lookup = (key: string): string => {
    const value = key
        .split('.')
        .reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            strings as Record<string, unknown>
        );
    if (typeof value !== 'string') throw new Error(`Missing translation: ${key}`);
    return value;
};

const sent = (over: Partial<UnifiedSendResponse> = {}): UnifiedSendResponse => ({
    total: 1,
    accepted: 1,
    failed: 0,
    status: 'COMPLETED',
    results: [{ success: true, status: 'SENT', messageId: 'wamid.ONE' }],
    ...over,
});

const status = (over: Partial<DeliveryStatus> = {}): DeliveryStatus => ({
    messageId: 'wamid.ONE',
    status: 'DELIVERED',
    settled: false,
    ...over,
});

const verdictFor = (
    sendResult: UnifiedSendResponse,
    delivery: DeliveryStatus | null = null,
    awaitingDelivery = false,
    channel: 'EMAIL' | 'WHATSAPP' = 'WHATSAPP'
) => resolveSendVerdict({ sendResult, delivery, channel, awaitingDelivery });

describe('resolveSendVerdict', () => {
    it('shows the green tick and the real status once WhatsApp reports the message delivered', () => {
        const verdict = verdictFor(sent(), status({ status: 'DELIVERED' }));

        expect(verdict.tone).toBe('ok');
        expect(lookup(verdict.headingKey)).toBe('Delivered');
        expect(verdict.confirmedDelivered).toBe(true);
        expect(verdict.deliveryWord).toBe('DELIVERED');
        expect(verdict.reason).toBeNull();
    });

    it('reads a read receipt as delivered rather than as an unknown state', () => {
        const verdict = verdictFor(sent(), status({ status: 'READ', settled: true }));

        expect(verdict.tone).toBe('ok');
        expect(verdict.confirmedDelivered).toBe(true);
    });

    it('still reads as Sent — never as a doubt — when no webhook has landed yet', () => {
        const verdict = verdictFor(sent(), null);

        // The webhook can be late or lost. Handover happened either way, so the panel says so
        // instead of leaving a green-lit send looking like a half-failure.
        expect(verdict.tone).toBe('ok');
        expect(lookup(verdict.headingKey)).toBe('Message Sent');
        expect(verdict.deliveryWord).toBe('SENT');
        expect(lookup(`reviewStep.deliveryStatus.${verdict.deliveryWord}`)).toBe('Sent');
    });

    it('spins only while the poll is still in flight', () => {
        expect(verdictFor(sent(), null, true).tone).toBe('confirming');
        expect(lookup(verdictFor(sent(), null, true).headingKey)).toBe('Confirming delivery…');
    });

    it('turns red with the provider reason when the status webhook reports a failure', () => {
        const verdict = verdictFor(
            sent(),
            status({
                status: 'FAILED',
                settled: true,
                errorCode: '131042',
                errorMessage: 'Business eligibility payment issue',
            })
        );

        expect(verdict.tone).toBe('failed');
        expect(lookup(verdict.headingKey)).toBe('Not delivered');
        expect(verdict.reason).toBe('Business eligibility payment issue (131042)');
    });

    it('reports a rejection that rode back inside a 200, with the reason on screen', () => {
        const verdict = verdictFor(
            sent({
                accepted: 0,
                failed: 1,
                status: 'FAILED',
                results: [
                    { success: false, status: 'FAILED', error: 'Template name does not exist' },
                ],
            })
        );

        expect(verdict.tone).toBe('failed');
        expect(lookup(verdict.headingKey)).toBe('Message Not Sent');
        expect(verdict.reason).toBe('Template name does not exist');
        // Nothing was handed over, so there is no delivery to report on.
        expect(verdict.showDelivery).toBe(false);
    });

    it('trusts the counts over a COMPLETED envelope that still carries a failure', () => {
        const verdict = verdictFor(
            sent({ accepted: 0, failed: 1, status: 'COMPLETED', results: [] })
        );

        expect(verdict.tone).toBe('failed');
        // No reason came back; the panel needs copy of its own rather than an empty red line.
        expect(verdict.reason).toBeNull();
        expect(lookup('reviewStep.noReason')).toBe('No reason reported by the provider.');
    });

    it('leaves email alone — it has no delivery webhook to wait for', () => {
        const verdict = verdictFor(sent(), null, false, 'EMAIL');

        expect(verdict.tone).toBe('ok');
        expect(verdict.showDelivery).toBe(false);
        expect(lookup(verdict.headingKey)).toBe('Message Sent');
    });
});
