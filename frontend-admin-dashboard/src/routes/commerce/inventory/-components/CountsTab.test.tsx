/**
 * Counts tab: the Blind recount button follows the server's `next_actions` of
 * each row, so it is never shown to someone the server refuses (a person who
 * only saved a line of the count is a main counter too).
 */
import { describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: http }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));

import { fetchCounts } from '../-shared/inventory-api';
import { canRecount } from './CountsTab';

const open = { kind: 'COUNT', status: 'OPEN', started_by: 'u-other' };

describe('Blind recount button', () => {
    it('is hidden when the server does not offer RECOUNT (a line-only counter)', () => {
        expect(canRecount({ ...open, next_actions: ['COUNT', 'REVIEW', 'POST'] }, 'u-me')).toBe(false);
        expect(canRecount({ ...open, next_actions: [] }, 'u-me')).toBe(false);
    });

    it('is shown when the server offers it', () => {
        expect(canRecount({ ...open, next_actions: ['COUNT', 'REVIEW', 'POST', 'RECOUNT'] }, 'u-me')).toBe(true);
    });

    it('an older server without next_actions: an open count started by someone else', () => {
        expect(canRecount({ ...open, next_actions: null }, 'u-me')).toBe(true);
        expect(canRecount({ ...open, started_by: 'u-me', next_actions: null }, 'u-me')).toBe(false);
    });

    it('the list answer carries each row’s next_actions', async () => {
        http.get.mockResolvedValueOnce({
            data: {
                counts: [
                    { id: 'c-1', kind: 'COUNT', status: 'OPEN', started_by: 'u-other', line_count: 2, next_actions: ['COUNT', 'REVIEW'] },
                    { id: 'c-2', kind: 'COUNT', status: 'POSTED', line_count: 1 },
                ],
                page: 0,
                size: 50,
                total: 2,
            },
        });
        const page = await fetchCounts({ page: 0, size: 50 });
        expect(page.rows.map((r) => r.next_actions)).toEqual([['COUNT', 'REVIEW'], null]);
    });
});
