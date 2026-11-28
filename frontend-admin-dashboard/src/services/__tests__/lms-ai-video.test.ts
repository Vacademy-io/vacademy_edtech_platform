import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import { isTerminalLmsVideoStatus, parseLmsVideoError } from '../lms-ai-video';

const axiosError = (status: number, data: unknown) => ({ response: { status, data } });

describe('parseLmsVideoError', () => {
    it('reads a flat {detail, code} body (402 insufficient credits)', () => {
        expect(
            parseLmsVideoError(
                axiosError(402, {
                    detail: 'Not enough credits',
                    code: 'INSUFFICIENT_CREDITS',
                    required: 20,
                    balance: 4,
                }),
                'fallback'
            )
        ).toEqual({ status: 402, code: 'INSUFFICIENT_CREDITS', detail: 'Not enough credits' });
    });

    it('reads an HTTPException dict detail (403 policy block)', () => {
        expect(
            parseLmsVideoError(
                axiosError(403, { detail: { detail: 'Monthly cap reached', code: 'MONTHLY_CAP' } }),
                'fallback'
            )
        ).toEqual({ status: 403, code: 'MONTHLY_CAP', detail: 'Monthly cap reached' });
    });

    it('joins 422 validation messages and falls back when nothing is readable', () => {
        expect(
            parseLmsVideoError(
                axiosError(422, { detail: [{ msg: 'teacher is required' }, { msg: 'too long' }] }),
                'fallback'
            ).detail
        ).toBe('teacher is required; too long');
        expect(parseLmsVideoError(new Error('network'), 'fallback')).toEqual({
            status: undefined,
            detail: 'fallback',
        });
    });
});

describe('isTerminalLmsVideoStatus', () => {
    it('treats COMPLETED, FAILED and CANCELLED as final', () => {
        expect(isTerminalLmsVideoStatus('COMPLETED')).toBe(true);
        expect(isTerminalLmsVideoStatus('failed')).toBe(true);
        expect(isTerminalLmsVideoStatus('CANCELLED')).toBe(true);
        expect(isTerminalLmsVideoStatus('IN_PROGRESS')).toBe(false);
        expect(isTerminalLmsVideoStatus('AWAITING_INPUT')).toBe(false);
        expect(isTerminalLmsVideoStatus(null)).toBe(false);
    });
});
