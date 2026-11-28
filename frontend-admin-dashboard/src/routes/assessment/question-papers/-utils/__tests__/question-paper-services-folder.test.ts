import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosMock = vi.fn();
vi.mock('@/lib/auth/axiosInstance', () => ({
    default: (config: unknown) => axiosMock(config),
}));

import { getQuestionPaperDataWithFilters } from '../question-paper-services';

const filters = {
    statuses: [
        { id: 'ACTIVE', name: 'ACTIVE' },
        { id: 'FAVOURITE', name: 'FAVOURITE' },
    ],
    tag_ids: [{ id: 't1', name: 'Algebra' }],
};

const sentBody = () => (axiosMock.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;

describe('paper list request and folders', () => {
    beforeEach(() => {
        axiosMock.mockReset();
        axiosMock.mockResolvedValue({ data: { content: [] } });
    });

    it('without a folder scope sends exactly the body it always did', async () => {
        await getQuestionPaperDataWithFilters(0, 10, 'inst-1', filters);
        expect(sentBody()).toEqual({
            statuses: ['ACTIVE', 'FAVOURITE'],
            tag_ids: ['t1'],
            sort_columns: { createdOn: 'DESC' },
        });
    });

    it('an empty folder scope (flat "All papers" list) adds nothing', async () => {
        await getQuestionPaperDataWithFilters(0, 10, 'inst-1', filters, undefined, {});
        expect(sentBody()).not.toHaveProperty('folder_id');
        expect(sentBody()).not.toHaveProperty('unfiled_only');
    });

    it('a folder adds folder_id only', async () => {
        await getQuestionPaperDataWithFilters(0, 10, 'inst-1', filters, undefined, {
            folder_id: 'f-1',
        });
        expect(sentBody()).toMatchObject({ folder_id: 'f-1' });
        expect(sentBody()).not.toHaveProperty('unfiled_only');
    });

    it('"not in a folder" adds unfiled_only only', async () => {
        await getQuestionPaperDataWithFilters(0, 10, 'inst-1', filters, undefined, {
            unfiled_only: true,
        });
        expect(sentBody()).toMatchObject({ unfiled_only: true });
        expect(sentBody()).not.toHaveProperty('folder_id');
    });
});
