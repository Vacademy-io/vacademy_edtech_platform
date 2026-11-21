import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { findFigmaUrl, isFigmaUrl } from '../-utils/figma-link';

/**
 * A figma.com link given to the AI page wizard. Nothing in the product can
 * open a Figma file (no server-side Figma), and the server used to screenshot
 * Figma's sign-in page as the "reference site". The wizard now says so where
 * the link is typed and never sends it; the intake chat says so while the link
 * is still in the box.
 */

const generateAiPage = vi.fn<[Record<string, unknown>], Promise<unknown>>(async () => ({
    page: { id: 'p', route: 'home', title: 'Home', components: [] },
    global_settings: null,
    warnings: [],
    model: 'm',
}));
const generateAiSite = vi.fn<[Record<string, unknown>], Promise<unknown>>(async () => ({
    pages: [],
    global_settings: null,
    warnings: [],
    model: 'm',
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));
vi.mock('../-stores/editor-store', () => ({
    useEditorStore: () => ({
        config: { pages: [], globalSettings: {} },
        addPage: vi.fn(),
        updateGlobalSettings: vi.fn(),
    }),
}));
vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: () => ({ instituteDetails: { institute_name: 'Brahm Varchas' } }),
}));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-file-upload', () => ({ useFileUpload: () => ({ uploadFile: vi.fn() }) }));
vi.mock('@/services/upload_file', () => ({ getPublicUrl: vi.fn() }));
vi.mock('@/utils/userDetails', () => ({ getUserId: () => 'user-1' }));
vi.mock('@/components/common/layout-container/sidebar/utils', () => ({
    getTerminology: (a: string) => a,
}));
vi.mock('@/routes/settings/-components/NamingSettings', () => ({
    ContentTerms: { Course: 'Course', Level: 'Level', Session: 'Session', Batch: 'Batch' },
    RoleTerms: { Learner: 'Learner' },
    SystemTerms: {
        Course: 'Course',
        Level: 'Level',
        Session: 'Session',
        Batch: 'Batch',
        Learner: 'Learner',
    },
}));
vi.mock('./ImageUploadField', () => ({ ImageUploadField: () => null }));
vi.mock('./ComponentPreviews', () => ({ renderComponentPreview: () => null }));
vi.mock('../-services/ai-page-service', () => ({
    generateAiPage: (p: Record<string, unknown>) => generateAiPage(p),
    generateAiSite: (p: Record<string, unknown>) => generateAiSite(p),
    generateAiImage: vi.fn(),
    estimateAiPageCredits: vi.fn(async () => ({ sufficient: true })),
    intakeAiTurn: vi.fn(),
    MAX_INSPIRATION_IMAGES: 6,
}));

import { AiPageWizard } from './AiPageWizard';
import { AiIntakeChat } from './AiIntakeChat';

const FIGMA = 'https://www.figma.com/design/c3DrF8i0qcRGQNayy/BV?node-id=1-36';
const NOTICE = 'figmaLink.message';

const withQuery = (ui: React.ReactElement) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

/** chat → quick brief (optionally "whole site") → assets */
const openAssetsStep = ({ wholeSite = false } = {}) => {
    withQuery(<AiPageWizard open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'footer.preferForm' }));
    fireEvent.change(screen.getByPlaceholderText('brief.briefPlaceholder'), {
        target: { value: 'A Sanskrit learning site' },
    });
    if (wholeSite) {
        const row = screen.getByText('brief.wholeSiteLabel').parentElement?.parentElement as HTMLElement;
        fireEvent.click(within(row).getByRole('switch'));
    }
    fireEvent.click(screen.getByRole('button', { name: 'footer.nextImages' }));
};

describe('figma link detection', () => {
    it('matches figma.com links only', () => {
        expect(isFigmaUrl(FIGMA)).toBe(true);
        expect(isFigmaUrl('figma.com/file/AbC/x')).toBe(true);
        expect(isFigmaUrl('https://embed.figma.com/design/AbC')).toBe(true);
        expect(isFigmaUrl('https://figma.com.evil.io/design/AbC')).toBe(false);
        expect(isFigmaUrl('https://notfigma.com/x')).toBe(false);
        expect(isFigmaUrl('https://brahm-varchas.figma.site/')).toBe(false);
        expect(isFigmaUrl('')).toBe(false);
    });

    it('finds a figma link inside a chat message', () => {
        expect(findFigmaUrl(`Our design: ${FIGMA} — follow it`)).toBe(FIGMA);
        expect(findFigmaUrl('mail design@figma.com or https://example.edu/figma.com')).toBeNull();
        expect(findFigmaUrl('a coaching institute in Jaipur')).toBeNull();
        // Scheme-less needs a Figma file path; a bare mention or a query value is not a shared design.
        expect(findFigmaUrl('see www.figma.com/file/AbC/x')).toBe('www.figma.com/file/AbC/x');
        expect(findFigmaUrl('our designer uses figma.com daily')).toBeNull();
        expect(findFigmaUrl('https://example.com/?u=figma.com')).toBeNull();
        expect(findFigmaUrl('https://example.com/?u=https://www.figma.com/design/AbC')).toBeNull();
    });
});

describe('AiPageWizard with a Figma link', () => {
    beforeEach(() => {
        generateAiPage.mockClear();
        generateAiSite.mockClear();
    });

    it('keeps Figma links out of a whole-site build too', async () => {
        openAssetsStep({ wholeSite: true });
        fireEvent.change(screen.getByLabelText('assets.rebuildHeading'), { target: { value: FIGMA } });
        fireEvent.change(screen.getByLabelText('assets.referenceHeading'), {
            target: { value: 'figma.com/design/AbC/x' },
        });
        expect(screen.getAllByText(NOTICE)).toHaveLength(2);

        fireEvent.click(screen.getByRole('button', { name: 'footer.nextGenerate' }));
        fireEvent.click(await screen.findByRole('button', { name: 'footer.generateSite' }));
        await waitFor(() => expect(generateAiSite).toHaveBeenCalledTimes(1));
        expect(generateAiPage).not.toHaveBeenCalled();
        const payload = generateAiSite.mock.calls[0]?.[0];
        expect(payload?.source_url).toBeUndefined();
        expect(payload?.reference_url).toBeUndefined();
    });

    it('explains a Figma reference link and never sends it', async () => {
        openAssetsStep();
        const reference = screen.getByLabelText('assets.referenceHeading');
        fireEvent.change(reference, { target: { value: 'https://example.edu' } });
        expect(screen.queryByText(NOTICE)).toBeNull();

        fireEvent.change(reference, { target: { value: FIGMA } });
        expect(screen.getByRole('note')).toHaveTextContent(NOTICE);

        fireEvent.click(screen.getByRole('button', { name: 'footer.nextGenerate' }));
        fireEvent.click(await screen.findByRole('button', { name: 'footer.generatePage' }));
        await waitFor(() => expect(generateAiPage).toHaveBeenCalledTimes(1));
        expect(generateAiPage.mock.calls[0]?.[0].reference_url).toBeUndefined();
    });

    it('explains a Figma link in the rebuild field and never sends it', async () => {
        openAssetsStep();
        fireEvent.change(screen.getByLabelText('assets.rebuildHeading'), {
            target: { value: 'figma.com/file/AbC/x' },
        });
        expect(screen.getByText(NOTICE)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('assets.referenceHeading'), {
            target: { value: 'https://example.edu' },
        });

        fireEvent.click(screen.getByRole('button', { name: 'footer.nextGenerate' }));
        fireEvent.click(await screen.findByRole('button', { name: 'footer.generatePage' }));
        await waitFor(() => expect(generateAiPage).toHaveBeenCalledTimes(1));
        const payload = generateAiPage.mock.calls[0]?.[0];
        expect(payload?.source_url).toBeUndefined();
        expect(payload?.reference_url).toBe('https://example.edu');
    });
});

describe('AiIntakeChat with a Figma link', () => {
    it('says Figma cannot be opened while the link is in the box', () => {
        withQuery(<AiIntakeChat courses={[]} terminology={{}} onComplete={() => {}} />);
        const box = screen.getByPlaceholderText(/Type your answer/);
        fireEvent.change(box, { target: { value: 'A school site for Class 6–10' } });
        expect(screen.queryByText(NOTICE)).toBeNull();
        fireEvent.change(box, { target: { value: `Make it like this ${FIGMA}` } });
        expect(screen.getByText(NOTICE)).toBeInTheDocument();
    });
});
