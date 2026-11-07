import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PropertyPanel } from './PropertyPanel';
import { renderComponentPreview } from './ComponentPreviews';
import { useEditorStore } from '../-stores/editor-store';
import { buildComponentTemplates } from '../-utils/component-templates';
import { componentDescription, componentLabel } from '../-utils/component-labels';

/**
 * `documentViewer` — a PDF (catalogue / brochure) the visitor reads on the
 * page or in a full-screen overlay, instead of a CTA that links out to a
 * Canva / Drive viewer. These pin the admin wiring: the template exists with
 * the defaults the learner renderer expects, the canvas preview is not the
 * unknown-type fallback, and the property panel edits the right props.
 */

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
    Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));
vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: () => ({
        getAllLevels: () => [],
        getCourseFromPackage: () => [],
        instituteDetails: null,
    }),
}));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-file-upload', () => ({ useFileUpload: () => ({ uploadFile: vi.fn() }) }));
vi.mock('@tanstack/react-query', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useQuery: () => ({ data: [], isLoading: false, isError: false }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const PDF = 'https://cdn.example.com/CATALOGUE_DOCUMENTS/ADMIN/abc-the7cs-book-catalogue.pdf';
const t = ((k: string) => k) as never;

const viewer = (props: Record<string, unknown>) => ({
    id: 'doc-1',
    type: 'documentViewer',
    enabled: true,
    props,
});

const currentProps = () =>
    useEditorStore.getState().config!.pages[0]!.components[0]!.props as Record<string, unknown>;

describe('documentViewer → template + labels', () => {
    it('ships a template whose defaults match the learner renderer contract', () => {
        const tpl = buildComponentTemplates(t).documentViewer!;
        expect(tpl.type).toBe('documentViewer');
        expect(tpl.props).toMatchObject({
            documentUrl: '',
            display: 'button',
            height: '70vh',
            showDownload: true,
        });
        expect(tpl.props.heading).toBe('documentViewer.heading');
        expect(tpl.props.buttonText).toBe('documentViewer.buttonText');
    });

    it('has a product name and a palette description', () => {
        expect(componentLabel('documentViewer')).toBe('Document Viewer');
        expect(componentDescription('documentViewer')).toMatch(/PDF/);
    });
});

describe('documentViewer → canvas preview', () => {
    it('button display paints the CTA, not the unknown-component fallback', () => {
        render(
            <>
                {renderComponentPreview(
                    viewer({
                        heading: 'Our catalogue',
                        documentUrl: PDF,
                        buttonText: 'Click to access',
                    })
                )}
            </>
        );
        expect(screen.getByText('Our catalogue')).toBeInTheDocument();
        expect(screen.getByText('Click to access')).toBeInTheDocument();
        expect(screen.queryByText(/dispatcher.unknownComponent/)).not.toBeInTheDocument();
    });

    it('inline display paints a frame naming the file', () => {
        render(<>{renderComponentPreview(viewer({ documentUrl: PDF, display: 'inline' }))}</>);
        expect(screen.getByText('abc-the7cs-book-catalogue.pdf')).toBeInTheDocument();
    });

    it('with no file it asks for one instead of drawing an empty frame', () => {
        render(<>{renderComponentPreview(viewer({ display: 'inline' }))}</>);
        expect(screen.getByText('documentViewer.addPdf')).toBeInTheDocument();
    });
});

describe('documentViewer → property panel', () => {
    beforeEach(() => {
        useEditorStore.getState().setConfig({
            pages: [
                {
                    id: 'p-books',
                    route: 'books',
                    title: 'Books',
                    components: [
                        viewer({
                            documentUrl: PDF,
                            display: 'button',
                            buttonText: 'Click to access',
                        }),
                    ],
                },
            ],
            globalSettings: {},
        } as never);
        useEditorStore.getState().selectPage('p-books');
        useEditorStore.getState().selectComponent('doc-1');
    });

    it('offers a PDF upload and shows the current file', () => {
        render(<PropertyPanel />);
        expect(
            screen.getByRole('button', { name: /documentViewer.uploadPdf/ })
        ).toBeInTheDocument();
        expect(screen.getByDisplayValue(PDF)).toBeInTheDocument();
        expect(screen.getByText('abc-the7cs-book-catalogue.pdf')).toBeInTheDocument();
    });

    it('button display exposes the button text; switching to inline swaps it for the frame height', () => {
        render(<PropertyPanel />);
        const buttonText = screen.getByDisplayValue('Click to access');
        fireEvent.change(buttonText, { target: { value: 'Open the catalogue' } });
        expect(currentProps().buttonText).toBe('Open the catalogue');

        fireEvent.change(screen.getByDisplayValue('documentViewer.displayButton'), {
            target: { value: 'inline' },
        });
        expect(currentProps().display).toBe('inline');
        expect(screen.queryByDisplayValue('Open the catalogue')).not.toBeInTheDocument();
        expect(screen.getByDisplayValue('documentViewer.heightMedium')).toBeInTheDocument();
    });

    it('the download toggle writes showDownload', () => {
        render(<PropertyPanel />);
        // The panel has other switches (section enabled etc.), so find ours by its row label.
        const toggle = screen
            .getByText('documentViewer.showDownload')
            .parentElement!.querySelector('[role="switch"]') as HTMLElement;
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(toggle);
        expect(currentProps().showDownload).toBe(false);
    });
});
