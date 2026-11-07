import { beforeEach, describe, expect, it, vi } from 'vitest';

const { http } = vi.hoisted(() => ({
    http: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: http }));
vi.mock('@/constants/urls', () => ({ COMPLETED_LEAD_FOLLOWUPS: '/completed' }));

import { fetchCompletedFollowUps } from '../get-completed-follow-ups';

describe('fetchCompletedFollowUps', () => {
    beforeEach(() => {
        http.get.mockReset().mockResolvedValue({ data: { content: [] } });
        http.post.mockReset().mockResolvedValue({ data: { content: [] } });
    });

    it('without lead filters sends the original GET, unchanged', async () => {
        await fetchCompletedFollowUps({ instituteId: 'i1', search: 'neha', page: 0, size: 20 });
        expect(http.post).not.toHaveBeenCalled();
        expect(http.get).toHaveBeenCalledWith('/completed', {
            params: {
                instituteId: 'i1',
                counsellorUserId: undefined,
                search: 'neha',
                closedFrom: undefined,
                closedTo: undefined,
                leadStatusId: undefined,
                leadStatusExcludeId: undefined,
                page: 0,
                size: 20,
                includeLeadDetail: undefined,
            },
        });
    });

    it('with lead filters POSTs them as a snake_case body (a Source can be 100+ ids)', async () => {
        const ids = Array.from({ length: 150 }, (_, i) => `audience-${i}`);
        await fetchCompletedFollowUps({
            instituteId: 'i1',
            leadStatusExcludeId: 'LOST',
            audienceIds: ids,
            utmFilters: { sources: ['google'] },
            interestLevels: ['Very Hot', 'Hot, warmish'],
            page: 2,
            size: 20,
            includeLeadDetail: true,
        });
        expect(http.get).not.toHaveBeenCalled();
        expect(http.post).toHaveBeenCalledWith(
            '/completed',
            expect.objectContaining({
                institute_id: 'i1',
                lead_status_exclude_id: 'LOST',
                audience_ids: ids,
                utm_filters: { sources: ['google'] },
                interest_levels: ['Very Hot', 'Hot, warmish'],
                page: 2,
                size: 20,
                include_lead_detail: true,
            })
        );
    });
});
