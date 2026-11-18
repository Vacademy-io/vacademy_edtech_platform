import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoTagDialog } from './TagToolsDialogs';

const api = vi.hoisted(() => ({ autoTagLibrary: vi.fn() }));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('../-services/question-library-services', async (original) => {
    const actual = await original<Record<string, unknown>>();
    return { ...actual, ...api };
});

const node = {
    id: 'kin',
    parent_id: 'phy',
    name: 'Kinematics',
    display_order: 0,
    depth: 2,
    question_count: 5,
    easy_count: 0,
    medium_count: 5,
    hard_count: 0,
};

describe('AutoTagDialog', () => {
    beforeEach(() => vi.clearAllMocks());

    it('counts first, then tags batch after batch, sending back every id tried', async () => {
        api.autoTagLibrary
            .mockResolvedValueOnce({ attempted_ids: [], tagged: 0, remaining: 3, tags: [] })
            .mockResolvedValueOnce({
                attempted_ids: ['q1', 'q2'],
                tagged: 2,
                remaining: 1,
                tags: ['Projectile Motion'],
            })
            .mockResolvedValueOnce({
                attempted_ids: ['q3'],
                tagged: 0,
                remaining: 0,
                tags: [],
            });
        const onTagged = vi.fn();
        render(
            <AutoTagDialog
                open
                onOpenChange={() => undefined}
                instituteId="inst-1"
                node={node}
                onTagged={onTagged}
            />
        );

        await waitFor(() => expect(screen.getByText('autoTag.start')).toBeTruthy());
        expect(api.autoTagLibrary).toHaveBeenCalledWith('inst-1', { node_id: 'kin', limit: 0 });

        fireEvent.click(screen.getByText('autoTag.start'));
        await waitFor(() => expect(screen.getByText('autoTag.done')).toBeTruthy());

        expect(api.autoTagLibrary).toHaveBeenNthCalledWith(2, 'inst-1', {
            node_id: 'kin',
            exclude_question_ids: [],
        });
        expect(api.autoTagLibrary).toHaveBeenNthCalledWith(3, 'inst-1', {
            node_id: 'kin',
            exclude_question_ids: ['q1', 'q2'],
        });
        expect(onTagged).toHaveBeenCalledTimes(2);
        expect(screen.getByText('Projectile Motion')).toBeTruthy();
    });

    it('offers nothing to start when every question is tagged', async () => {
        api.autoTagLibrary.mockResolvedValueOnce({
            attempted_ids: [],
            tagged: 0,
            remaining: 0,
            tags: [],
        });
        render(
            <AutoTagDialog
                open
                onOpenChange={() => undefined}
                instituteId="inst-1"
                node={node}
                onTagged={() => undefined}
            />
        );

        await waitFor(() => expect(screen.getByText('autoTag.nothingToDo')).toBeTruthy());
        expect(screen.queryByText('autoTag.start')).toBeNull();
    });

    it('shows the server message when a batch fails and lets the run continue', async () => {
        api.autoTagLibrary
            .mockResolvedValueOnce({ attempted_ids: [], tagged: 0, remaining: 4, tags: [] })
            .mockRejectedValueOnce({
                response: { data: { ex: 'AI tagging failed for this batch.' } },
            });
        render(
            <AutoTagDialog
                open
                onOpenChange={() => undefined}
                instituteId="inst-1"
                node={node}
                onTagged={() => undefined}
            />
        );

        await waitFor(() => expect(screen.getByText('autoTag.start')).toBeTruthy());
        fireEvent.click(screen.getByText('autoTag.start'));

        await waitFor(() =>
            expect(screen.getByText('AI tagging failed for this batch.')).toBeTruthy()
        );
        expect(screen.getByText('autoTag.resume')).toBeTruthy();
    });
});
