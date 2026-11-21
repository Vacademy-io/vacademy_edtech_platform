import { beforeEach, describe, expect, it, vi } from 'vitest';

// The user-messages endpoints require the signed-in user's token, so the bell must call them
// through the authenticated axios instance (Authorization + clientId), not plain axios.
const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/constants/urls', () => ({ BASE_URL: 'https://api.test' }));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get, post } }));

const { fetchSystemAlerts, markSystemAlertAsRead, dismissSystemAlert } = await import(
    './system-alerts'
);

const BASE = 'https://api.test/notification-service/v1/user-messages';

describe('system alerts send the user token', () => {
    beforeEach(() => {
        get.mockReset();
        post.mockReset();
    });

    it('lists alerts through the authenticated instance', async () => {
        get.mockResolvedValue({ data: { content: [] } });
        await fetchSystemAlerts({ userId: 'staff-1', page: 0, size: 5 });
        expect(get).toHaveBeenCalledWith(`${BASE}/user/staff-1/system-alerts`, {
            params: { page: 0, size: 5 },
        });
    });

    it('marks read and dismisses through the authenticated instance', async () => {
        post.mockResolvedValue({ data: {} });
        await markSystemAlertAsRead('rm-1', 'staff-1');
        await dismissSystemAlert('rm-2', 'staff-1');
        expect(post).toHaveBeenCalledWith(`${BASE}/interactions/read`, {
            recipientMessageId: 'rm-1',
            userId: 'staff-1',
            interactionType: 'READ',
        });
        expect(post).toHaveBeenCalledWith(`${BASE}/interactions/dismiss`, {
            recipientMessageId: 'rm-2',
            userId: 'staff-1',
            interactionType: 'DISMISSED',
        });
    });
});
