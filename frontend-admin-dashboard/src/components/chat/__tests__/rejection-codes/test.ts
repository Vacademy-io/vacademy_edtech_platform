import { describe, expect, it } from 'vitest';
import { classifyChatSendError } from '@/services/chat/chatApi';

/**
 * Pins the wire contract between the backend's error body and the reader here.
 *
 * Chat is OFF until an institute opts in, so CHAT_DISABLED is the state most institutes are in.
 * The backend answers 403 with the bare reason code in `message` (common_service's
 * GlobalExceptionHandler.handleResponseStatus). It used to answer 511 with the reason mangled into
 * `ex` instead, because the catch-all RuntimeException handler matched ResponseStatusException and
 * overwrote its status -- and this reader skips anything >= 500, so every chat rejection degraded
 * into a generic "something went wrong".
 */
const httpError = (status: number, body: Record<string, unknown>) => ({
    response: { status, data: body },
});

describe('classifyChatSendError', () => {
    it('reads the reason code off the 403 the backend now returns', () => {
        const out = classifyChatSendError(
            httpError(403, {
                url: 'https://backend-stage.vacademy.io/notification-service/v1/chat/conversations/community',
                ex: 'CHAT_DISABLED',
                message: 'CHAT_DISABLED',
                responseCode: '403',
                date: '2026-09-01T14:27:07.664+00:00',
            })
        );
        expect(out).toEqual({
            code: 'CHAT_DISABLED',
            message: 'Chat is currently disabled for this institute.',
        });
    });

    it('classifies the other rule rejections the same way', () => {
        expect(classifyChatSendError(httpError(403, { message: 'SLOW_MODE' }))?.code).toBe(
            'SLOW_MODE'
        );
        expect(
            classifyChatSendError(httpError(403, { message: 'RULES_NOT_ACKNOWLEDGED' }))?.code
        ).toBe('RULES_NOT_ACKNOWLEDGED');
    });

    it('ignores a 5xx — the shape the old 511 bug produced', () => {
        expect(
            classifyChatSendError(
                httpError(511, {
                    ex: '403 FORBIDDEN "CHAT_DISABLED"',
                    responseCode: '403 FORBIDDEN "CHAT_DISABLED"',
                })
            )
        ).toBeNull();
    });

    it('returns null for an unrecognised 4xx reason', () => {
        expect(classifyChatSendError(httpError(400, { message: 'SOMETHING_ELSE' }))).toBeNull();
    });
});
