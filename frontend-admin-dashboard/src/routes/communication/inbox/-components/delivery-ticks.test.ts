import { describe, expect, it } from 'vitest';
import {
    deliveryLabel,
    deliveryState,
} from '@/routes/communication/inbox/-components/delivery-ticks';

/**
 * The tick mapping, pinned in both directions.
 *
 * The conversation list drew a hard-coded single tick for years, so when it still shows one tick
 * the question is always "is the mapping wrong, or did the row arrive with no status?". These
 * tests answer the first half: every status the two webhook writers can produce
 * (SENT/DELIVERED/READ/FAILED, uppercase, from WebhookEventProcessor and CombotWebhookService)
 * maps to its own mark, and only a genuinely absent status falls back to one tick.
 */
describe('delivery ticks', () => {
    it('gives each reported status its own mark', () => {
        expect(deliveryState('READ')).toBe('READ');
        expect(deliveryState('DELIVERED')).toBe('DELIVERED');
        expect(deliveryState('SENT')).toBe('SENT');
        expect(deliveryState('FAILED')).toBe('FAILED');
    });

    it('falls back to one tick only when nothing has been reported', () => {
        expect(deliveryState(undefined)).toBe('SENT');
        expect(deliveryState('')).toBe('SENT');
        // A backend that predates lastMessageStatus sends no field at all — the row then says
        // "sent", which is the one thing we do know, and never claims delivery.
        expect(deliveryState(undefined, 'WHATSAPP_MESSAGE_OUTGOING')).toBe('SENT');
    });

    it('treats a send the provider accepted as sent, not delivered', () => {
        expect(deliveryState('SUCCESS')).toBe('SENT');
    });

    it('still reads the log row type, which is all the thread had before the webhook landed', () => {
        expect(deliveryState(undefined, 'WHATSAPP_MESSAGE_READ')).toBe('READ');
        expect(deliveryState(undefined, 'WHATSAPP_MESSAGE_DELIVERED')).toBe('DELIVERED');
    });

    it('a reported failure outranks the row type', () => {
        expect(deliveryState('FAILED', 'WHATSAPP_MESSAGE_DELIVERED')).toBe('FAILED');
    });

    it('names every state for the tooltip', () => {
        expect(deliveryLabel('READ')).toBe('Read');
        expect(deliveryLabel('DELIVERED')).toBe('Delivered');
        expect(deliveryLabel('SENT')).toBe('Sent');
        expect(deliveryLabel('FAILED')).toBe('Not delivered');
    });
});
