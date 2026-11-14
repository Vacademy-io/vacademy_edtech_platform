import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BlogManagerDialog } from './BlogManagerDialog';
import { useBlogManagerStore } from '../../-stores/blog-manager-store';

/**
 * Blog posts are managed inside the Website Builder: one dialog whose face
 * (list vs editor) follows the store. Neither face routes anywhere — the
 * list hands ids up, the editor hands back — so a new post created from the
 * editor stays inside the dialog.
 */

vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../../-hooks/use-catalogue-permissions', () => ({
    useCataloguePermissions: () => ({ canWrite: true, canPublish: true }),
}));
vi.mock('@tanstack/react-query', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useQuery: () => ({
        data: {
            content: [
                {
                    id: 'post-1',
                    title: 'Results day',
                    slug: 'results-day',
                    status: 'PUBLISHED',
                    source: 'ADMIN',
                    updated_at: '2026-09-21T10:00:00Z',
                },
            ],
            total_pages: 1,
            total_elements: 1,
            categories: [],
        },
        isLoading: false,
        isError: false,
    }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
// The editor face is heavy (TipTap + Monaco); this test only needs to see which face is up.
vi.mock('./BlogPostEditor', () => ({
    BlogPostEditor: ({
        postId,
        onBack,
        onCreated,
    }: {
        postId: string;
        onBack: () => void;
        onCreated: (id: string) => void;
    }) => (
        <div>
            <span data-testid="editor-face">editor:{postId}</span>
            <button type="button" onClick={onBack}>
                back
            </button>
            <button type="button" onClick={() => onCreated('post-9')}>
                created
            </button>
        </div>
    ),
}));

beforeEach(() => {
    useBlogManagerStore.getState().close();
});

describe('BlogManagerDialog', () => {
    it('stays unmounted until opened, then shows the posts list', () => {
        render(<BlogManagerDialog />);
        expect(screen.queryByText('Results day')).toBeNull();
        act(() => useBlogManagerStore.getState().open());
        expect(screen.getByText('Results day')).toBeTruthy();
        expect(screen.queryByTestId('editor-face')).toBeNull();
    });

    it('opens a post in the editor face and comes back to the list without leaving the dialog', () => {
        render(<BlogManagerDialog />);
        act(() => useBlogManagerStore.getState().open());
        fireEvent.click(screen.getByText('Results day'));
        expect(screen.getByTestId('editor-face').textContent).toBe('editor:post-1');
        fireEvent.click(screen.getByText('back'));
        expect(screen.getByText('Results day')).toBeTruthy();
        expect(useBlogManagerStore.getState().isOpen).toBe(true);
    });

    it('a new post created from the editor swaps to editing that post', () => {
        render(<BlogManagerDialog />);
        act(() => useBlogManagerStore.getState().open('new'));
        expect(screen.getByTestId('editor-face').textContent).toBe('editor:new');
        fireEvent.click(screen.getByText('created'));
        expect(screen.getByTestId('editor-face').textContent).toBe('editor:post-9');
    });
});
