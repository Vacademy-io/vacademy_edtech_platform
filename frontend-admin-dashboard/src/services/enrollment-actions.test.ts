import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, type AxiosResponse } from 'axios';

const h = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('@/lib/auth/axiosInstance', () => ({ default: { post: h.post } }));

const { enrollLearnerV2 } = await import('./enrollment-actions');
const { ENROLL_LEARNER_V2, ENROLL_LEARNER_V2_ADMIN } = await import('@/constants/urls');

const payload = {
    userId: 'user-1',
    institute_id: 'inst-1',
    enrollmentType: 'MANUAL',
    learner_package_session_enrollments: [],
};

const httpError = (status: number, data: unknown) =>
    new AxiosError('failed', String(status), undefined, undefined, {
        status,
        data,
    } as AxiosResponse);

// What admin-core answers for a route it does not have: Spring's /error page, refused.
const unknownRoute = httpError(403, {
    error: 'ACCESS_DENIED',
    message: 'The presented token does not grant access to this endpoint.',
    path: '/error',
});

beforeEach(() => {
    h.post.mockReset();
});

describe('enrollLearnerV2', () => {
    it('enrolls through the admin-only endpoint', async () => {
        h.post.mockResolvedValueOnce({ data: { ok: true } });
        await expect(enrollLearnerV2(payload)).resolves.toEqual({ ok: true });
        expect(h.post).toHaveBeenCalledTimes(1);
        expect(h.post).toHaveBeenCalledWith(ENROLL_LEARNER_V2_ADMIN, payload);
    });

    it('falls back to the public endpoint when admin-core does not have the admin one yet', async () => {
        h.post.mockRejectedValueOnce(unknownRoute).mockResolvedValueOnce({ data: { ok: true } });
        await expect(enrollLearnerV2(payload)).resolves.toEqual({ ok: true });
        expect(h.post).toHaveBeenNthCalledWith(2, ENROLL_LEARNER_V2, payload);
    });

    it("does not fall back on the admin endpoint's own refusal", async () => {
        const refused = httpError(403, {
            ex: 'Access denied: institute admin role required',
            responseCode: '403 FORBIDDEN',
        });
        h.post.mockRejectedValueOnce(refused);
        await expect(enrollLearnerV2(payload)).rejects.toBe(refused);
        expect(h.post).toHaveBeenCalledTimes(1);
    });

    it('does not fall back on other errors', async () => {
        const conflict = httpError(409, { ex: 'Only 0 left' });
        h.post.mockRejectedValueOnce(conflict);
        await expect(enrollLearnerV2(payload)).rejects.toBe(conflict);
        const offline = new Error('Network Error');
        h.post.mockRejectedValueOnce(offline);
        await expect(enrollLearnerV2(payload)).rejects.toBe(offline);
        expect(h.post).toHaveBeenCalledTimes(2);
    });
});
