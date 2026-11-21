import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PropertyPanel } from './PropertyPanel';

/**
 * Site-level SEO lives in the Global Settings panel and feeds the learner edge
 * middleware (keywords/verification → <head>, organisation → JSON-LD). The
 * list fields are edited as text and committed on blur — committing on every
 * keystroke would strip the separator the admin has just typed.
 */

const updateGlobalSettings = vi.fn();
const updatePageSeo = vi.fn();

let globalSettings: Record<string, unknown> = {};
let selectedGlobalSettings = true;
let selectedPageId: string | null = null;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
    Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));
vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: () => ({ getAllLevels: () => [], getCourseFromPackage: () => [], instituteDetails: null }),
}));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@tanstack/react-query', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useQuery: () => ({ data: [], isLoading: false, isError: false }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../-stores/editor-store', () => ({
    useEditorStore: () => ({
        config: {
            pages: [{ id: 'home', route: 'home', title: 'Smart AI Academy', components: [], seo: { metaTitle: 'A'.repeat(70), metaDescription: 'Short one.' } }],
            globalSettings,
        },
        selectedComponentId: null,
        selectedPageId,
        selectedGlobalSettings,
        selectedGlobalLayout: null,
        updateGlobalSettings,
        updateComponent: vi.fn(),
        deleteComponent: vi.fn(),
        duplicateComponent: vi.fn(),
        reorderComponents: vi.fn(),
        updatePageSeo,
        updatePageBackgroundColor: vi.fn(),
        setPageHideSiteChrome: vi.fn(),
        copyComponent: vi.fn(),
        pasteComponent: vi.fn(),
        clipboard: null,
        selectComponent: vi.fn(),
        deleteFromSlot: vi.fn(),
    }),
}));

beforeEach(() => {
    updateGlobalSettings.mockClear();
    globalSettings = {};
    selectedGlobalSettings = true;
    selectedPageId = null;
});

describe('Global Settings → SEO', () => {
    it('shows the SEO section with keywords, verification and organisation fields', () => {
        render(<PropertyPanel />);
        expect(screen.getByText('global.seo.heading')).toBeInTheDocument();
        expect(screen.getByText('global.seo.keywordsLabel')).toBeInTheDocument();
        expect(screen.getByText('global.seo.verificationLabel')).toBeInTheDocument();
        expect(screen.getByText('global.seo.orgFounder')).toBeInTheDocument();
        expect(screen.getByText('global.seo.sameAsLabel')).toBeInTheDocument();
    });

    it('stores keywords as a list, committed on blur, from comma-separated text', () => {
        render(<PropertyPanel />);
        const box = screen.getByPlaceholderText('global.seo.keywordsPlaceholder');
        fireEvent.change(box, { target: { value: 'Smart AI Academy, AI courses ,, learn AI' } });
        expect(updateGlobalSettings).not.toHaveBeenCalled();
        fireEvent.blur(box);
        expect(updateGlobalSettings).toHaveBeenCalledWith({ seo: { keywords: ['Smart AI Academy', 'AI courses', 'learn AI'] } });
    });

    it('writes organisation fields under seo.organization without clobbering siblings', () => {
        globalSettings = { seo: { keywords: ['x'], organization: { name: 'Smart AI Academy' } } };
        render(<PropertyPanel />);
        const section = screen.getByText('global.seo.organizationHeading').closest('div')!;
        const inputs = section.querySelectorAll('input');
        // name, founder, foundingDate, email, telephone, address, logo — founder is the 2nd
        fireEvent.change(inputs[1]!, { target: { value: 'Tapan Sengupta' } });
        expect(updateGlobalSettings).toHaveBeenCalledWith({
            seo: { keywords: ['x'], organization: { name: 'Smart AI Academy', founder: 'Tapan Sengupta' } },
        });
    });

    it('shows the existing verification token', () => {
        globalSettings = { seo: { googleSiteVerification: 'tok-123' } };
        render(<PropertyPanel />);
        expect(screen.getByDisplayValue('tok-123')).toBeInTheDocument();
    });
});

describe('Page settings → SEO preview', () => {
    it('renders a search preview with length counters, amber when over the limit', () => {
        selectedGlobalSettings = false;
        selectedPageId = 'home';
        render(<PropertyPanel />);
        expect(screen.getByText('pageSettings.seo.previewHeading')).toBeInTheDocument();
        const titleCounter = screen.getByText('70/60');
        expect(titleCounter.className).toContain('text-amber-600');
        expect(screen.getByText('10/160').className).not.toContain('text-amber-600');
    });
});

describe('SEO list field', () => {
    it('keeps uncommitted typing when the panel re-renders with an empty list', () => {
        globalSettings = {};
        const { rerender } = render(<PropertyPanel />);
        const box = screen.getByPlaceholderText('global.seo.keywordsPlaceholder') as HTMLTextAreaElement;
        fireEvent.change(box, { target: { value: 'Smart AI Academy, AI cour' } });
        rerender(<PropertyPanel />); // parent re-render → a fresh `[]` for the value prop
        expect(box.value).toBe('Smart AI Academy, AI cour');
    });
});
