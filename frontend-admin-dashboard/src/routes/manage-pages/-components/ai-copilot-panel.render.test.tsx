import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AiCopilotPanel } from './AiCopilotPanel';

/**
 * The copilot composer. Two things here are invisible to `tsc`: whether the
 * send control actually renders (it used to be an unlabelled icon that the
 * rail clipped away, leaving no way to submit but an Enter nobody could see),
 * and whether a dropped or pasted screenshot reaches the upload path.
 */

const uploadFile = vi.fn(async () => 'file-1');
const toast = vi.fn();

vi.mock('../-stores/editor-store', () => ({
    useEditorStore: () => ({
        config: {
            pages: [{ id: 'p1', route: '/', title: 'Home', components: [] }],
            globalSettings: {},
        },
        selectedPageId: 'p1',
        selectedComponentId: null,
        updateConfig: vi.fn(),
    }),
}));
vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: () => ({ instituteDetails: { institute_name: 'The7Cs' } }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/hooks/use-file-upload', () => ({ useFileUpload: () => ({ uploadFile }) }));
vi.mock('@/services/upload_file', () => ({
    getPublicUrl: vi.fn(async () => 'https://cdn/img.png'),
}));
vi.mock('@/utils/userDetails', () => ({ getUserId: () => 'user-1' }));
vi.mock('@/components/common/layout-container/sidebar/utils', () => ({
    getTerminology: (a: string) => a,
}));
vi.mock('@/routes/settings/-components/NamingSettings', () => ({
    ContentTerms: { Course: 'Course', Level: 'Level', Batch: 'Batch' },
    RoleTerms: { Learner: 'Learner' },
    SystemTerms: { Course: 'Course', Level: 'Level', Batch: 'Batch', Learner: 'Learner' },
}));
vi.mock('../-services/ai-page-service', () => ({
    editAiPage: vi.fn(async () => ({ reply: 'Done.', ops: [], warnings: [] })),
    applyOps: vi.fn((c: unknown) => c),
    deriveBrandKit: vi.fn(async () => ({ kits: [] })),
    brandKitToGlobalPatch: vi.fn(() => ({})),
}));

const png = () => new File(['x'], 'shot.png', { type: 'image/png' });

const renderPanel = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <AiCopilotPanel />
        </QueryClientProvider>
    );
};

describe('AiCopilotPanel composer', () => {
    beforeEach(() => {
        uploadFile.mockClear();
        toast.mockClear();
    });

    it('renders a labelled Send control, not just an icon', () => {
        renderPanel();
        expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
        expect(screen.getByText(/Enter to send/i)).toBeInTheDocument();
    });

    it('tells the admin that dragging or pasting an image works', () => {
        renderPanel();
        expect(screen.getByText(/paste one with/i)).toBeInTheDocument();
    });

    it('shows the drop zone while a file drag is over the panel, and hides it on leave', () => {
        const { container } = renderPanel();
        const panel = container.firstChild as HTMLElement;
        const dataTransfer = { types: ['Files'], files: [] };

        fireEvent.dragEnter(panel, { dataTransfer });
        expect(screen.getByText('Drop to attach')).toBeInTheDocument();

        fireEvent.dragLeave(panel, { dataTransfer });
        expect(screen.queryByText('Drop to attach')).not.toBeInTheDocument();
    });

    it('ignores a dnd-kit component drag — those carry no Files type', () => {
        const { container } = renderPanel();
        fireEvent.dragEnter(container.firstChild as HTMLElement, { dataTransfer: { types: [] } });
        expect(screen.queryByText('Drop to attach')).not.toBeInTheDocument();
    });

    it('uploads a dropped screenshot and stages it for the next instruction', async () => {
        const { container } = renderPanel();
        fireEvent.drop(container.firstChild as HTMLElement, {
            dataTransfer: { types: ['Files'], files: [png()] },
        });
        await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
        expect(await screen.findByText('1 attached')).toBeInTheDocument();
        expect(screen.queryByText('Drop to attach')).not.toBeInTheDocument();
    });

    it('uploads a pasted screenshot', async () => {
        renderPanel();
        fireEvent.paste(screen.getByPlaceholderText(/Describe a change/i), {
            clipboardData: { files: [png()] },
        });
        await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
    });

    it('refuses a non-image drop instead of uploading it', async () => {
        const { container } = renderPanel();
        fireEvent.drop(container.firstChild as HTMLElement, {
            dataTransfer: {
                types: ['Files'],
                files: [new File(['x'], 'notes.pdf', { type: 'application/pdf' })],
            },
        });
        await waitFor(() =>
            expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Images only' }))
        );
        expect(uploadFile).not.toHaveBeenCalled();
    });

    it('leaves a plain text paste alone', () => {
        renderPanel();
        fireEvent.paste(screen.getByPlaceholderText(/Describe a change/i), {
            clipboardData: { files: [] },
        });
        expect(uploadFile).not.toHaveBeenCalled();
    });
});
