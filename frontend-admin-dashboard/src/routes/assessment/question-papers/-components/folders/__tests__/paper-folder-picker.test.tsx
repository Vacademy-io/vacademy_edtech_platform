/**
 * "Choose saved paper" dialogs with question paper folders on: folder cards first, open one
 * to pick from its papers. With no folders (or a failed folder load) the plain list renders
 * exactly as before. The list itself is a stub here: the test checks which scope it gets.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PaperFolderFilter, QuestionPaperFolder } from '@/services/question-paper-folders';

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@/components/core/dashboard-loader', () => ({
    DashboardLoader: () => <div data-testid="loader" />,
}));
vi.mock('@/components/common/assessment-folders/FolderThumb', () => ({
    FolderThumb: () => <span />,
}));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));

const folderState: { data?: QuestionPaperFolder[]; isLoading: boolean; isError: boolean } = {
    data: [],
    isLoading: false,
    isError: false,
};
vi.mock('@/services/question-paper-folders', () => ({
    PAPER_FOLDERS_QUERY_KEY: ['QUESTION_PAPER_FOLDERS'],
    usePaperFolders: () => folderState,
}));

const listRequest = vi.fn();
vi.mock('../../../-utils/question-paper-services', () => ({
    getQuestionPaperDataWithFilters: (...args: unknown[]) => listRequest(...args),
}));

const { PaperFolderPicker } = await import('../PaperFolderPicker');

const folder = (id: string, name: string, paperCount: number): QuestionPaperFolder => ({
    id,
    name,
    description: null,
    image_url: null,
    display_order: 0,
    status: 'ACTIVE',
    parent_id: null,
    paper_count: paperCount,
});

const renderPicker = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <PaperFolderPicker
                renderList={({
                    key,
                    folderFilter,
                }: {
                    key: string;
                    folderFilter?: PaperFolderFilter;
                }) => (
                    <div data-testid="paper-list" data-key={key}>
                        {JSON.stringify(folderFilter ?? null)}
                    </div>
                )}
            />
        </QueryClientProvider>
    );
};

const list = () => screen.queryByTestId('paper-list');

describe('PaperFolderPicker', () => {
    beforeEach(() => {
        localStorage.clear();
        folderState.data = [];
        folderState.isLoading = false;
        folderState.isError = false;
        listRequest.mockReset();
        listRequest.mockResolvedValue({ total_elements: 3 });
    });

    it('with no folders shows the plain list, unscoped, as before', () => {
        renderPicker();
        expect(list()?.textContent).toBe('null');
        expect(screen.queryByText('grid.title')).toBeNull();
        expect(listRequest).not.toHaveBeenCalled();
    });

    it('when the folders fail to load shows the plain list (an error never hides a paper)', () => {
        folderState.isError = true;
        folderState.data = [folder('f1', 'Class 10 Maths', 2)];
        renderPicker();
        expect(list()?.textContent).toBe('null');
        expect(screen.queryByText('Class 10 Maths')).toBeNull();
    });

    it('waits for the folders before mounting any list', () => {
        folderState.isLoading = true;
        renderPicker();
        expect(screen.getByTestId('loader')).toBeTruthy();
        expect(list()).toBeNull();
    });

    it('shows folder cards, then the papers in no folder', async () => {
        folderState.data = [folder('f1', 'Class 10 Maths', 2), folder('f2', 'JEE Mocks', 0)];
        renderPicker();
        expect(screen.getByText('Class 10 Maths')).toBeTruthy();
        expect(screen.getByText('JEE Mocks')).toBeTruthy();
        await waitFor(() => expect(list()?.textContent).toBe('{"unfiled_only":true}'));
        expect(screen.getByText('grid.unfiledTitle')).toBeTruthy();
    });

    it('hides the "not in a folder" list when every paper is in a folder', async () => {
        listRequest.mockResolvedValue({ total_elements: 0 });
        folderState.data = [folder('f1', 'Class 10 Maths', 2)];
        renderPicker();
        await waitFor(() => expect(listRequest).toHaveBeenCalled());
        expect(list()).toBeNull();
        expect(screen.queryByText('grid.unfiledTitle')).toBeNull();
    });

    it('opens a folder to list only its papers, and goes back to the cards', async () => {
        folderState.data = [folder('f1', 'Class 10 Maths', 2)];
        renderPicker();
        fireEvent.click(screen.getByText('Class 10 Maths'));
        expect(list()?.textContent).toBe('{"folder_id":"f1"}');
        expect(list()?.getAttribute('data-key')).toBe('folder:f1');
        fireEvent.click(screen.getByText('grid.allFolders'));
        await waitFor(() => expect(list()?.textContent).toBe('{"unfiled_only":true}'));
    });

    it('"All papers" lists every paper unscoped and is remembered', () => {
        folderState.data = [folder('f1', 'Class 10 Maths', 2)];
        renderPicker();
        fireEvent.click(screen.getByText('view.list'));
        expect(list()?.textContent).toBe('null');
        expect(screen.queryByText('Class 10 Maths')).toBeNull();
        expect(localStorage.getItem('questionPaperPickerFolderView')).toBe('list');
    });
});
