import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PropertyPanel } from './PropertyPanel';

/**
 * The Knowledge Streams controls live inside the real property panel: two
 * Global Settings cards (course languages, site cart), the "Show on" rule
 * builder in every section's settings, and the Learning Path editor. tsc
 * accepts a control that is never mounted, so this renders the panel the way
 * the editor does and checks each one is there and writes the right thing.
 */

const updateGlobalSettings = vi.fn();
const updateComponent = vi.fn();

let globalSettings: Record<string, unknown> = {};
let selectedGlobalSettings = false;
let selectedComponentId: string | null = null;
let components: any[] = [];

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
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
            pages: [{ id: 'home', route: 'home', title: 'Home', components }],
            globalSettings,
        },
        selectedComponentId,
        selectedPageId: 'home',
        selectedGlobalSettings,
        selectedGlobalLayout: null,
        updateGlobalSettings,
        updateComponent,
        deleteComponent: vi.fn(),
        duplicateComponent: vi.fn(),
        reorderComponents: vi.fn(),
        updatePageSeo: vi.fn(),
        updatePageBackgroundColor: vi.fn(),
        setPageHideSiteChrome: vi.fn(),
        copyComponent: vi.fn(),
        pasteComponent: vi.fn(),
        clipboard: null,
        selectComponent: vi.fn(),
        deleteFromSlot: vi.fn(),
    }),
}));

const learningPath = (over: Record<string, unknown> = {}) => ({
    id: 'lp-1',
    type: 'learningPath',
    enabled: true,
    props: { mode: 'single', productPageCode: '', title: 'Paths', showStepNumbers: true, showTotal: true },
    ...over,
});

beforeEach(() => {
    updateGlobalSettings.mockClear();
    updateComponent.mockClear();
    globalSettings = {};
    selectedGlobalSettings = false;
    selectedComponentId = null;
    components = [];
});

describe('Global Settings → Course languages and Site cart', () => {
    beforeEach(() => {
        selectedGlobalSettings = true;
    });

    it('shows both cards, off, on a site that has never used them', () => {
        render(<PropertyPanel />);
        expect(screen.getByText('Course languages')).toBeInTheDocument();
        expect(screen.getByText('Site cart')).toBeInTheDocument();
        // Nothing beyond the switch until it is turned on.
        expect(screen.queryByText('Try a level name')).not.toBeInTheDocument();
        expect(screen.queryByText('Store product page')).not.toBeInTheDocument();
    });

    it('switches course languages on without writing a language list (defaults apply)', () => {
        render(<PropertyPanel />);
        fireEvent.click(screen.getByRole('switch', { name: 'Merge language versions of a course' }));
        expect(updateGlobalSettings).toHaveBeenCalledWith({ courseLanguages: { enabled: true } });
    });

    it('switches the site cart on, keeping what was already set', () => {
        globalSettings = { siteCart: { storeProductPageCode: 'store', storeProductPageName: 'Store' } };
        render(<PropertyPanel />);
        fireEvent.click(screen.getByRole('switch', { name: 'Site-wide cart' }));
        expect(updateGlobalSettings).toHaveBeenCalledWith({
            siteCart: { storeProductPageCode: 'store', storeProductPageName: 'Store', enabled: true },
        });
    });
});

describe('Section settings → Show on (visibleWhen)', () => {
    it('is always shown by default and applies the All courses tab preset as a top-level field', () => {
        components = [learningPath()];
        selectedComponentId = 'lp-1';
        render(<PropertyPanel />);
        expect(screen.getByText('Always shown')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Show on'));
        fireEvent.click(screen.getByText('Only on the All courses tab'));
        expect(updateComponent).toHaveBeenCalledWith('home', 'lp-1', {
            visibleWhen: [{ param: 'stream', op: 'empty' }],
        });
    });

    it('clears the rules back to "always" by dropping the key', () => {
        components = [learningPath({ visibleWhen: [{ param: 'stream', op: 'empty' }] })];
        selectedComponentId = 'lp-1';
        render(<PropertyPanel />);
        fireEvent.click(screen.getByText('Show on'));
        fireEvent.click(screen.getByText('Always'));
        expect(updateComponent).toHaveBeenCalledWith('home', 'lp-1', { visibleWhen: undefined });
    });
});

describe('Learning Path section', () => {
    it('opens its own editor and writes the mode into props', () => {
        components = [learningPath()];
        selectedComponentId = 'lp-1';
        render(<PropertyPanel />);
        expect(screen.getByText('Product page (the path)')).toBeInTheDocument();
        fireEvent.click(screen.getByText('A list of paths'));
        expect(updateComponent).toHaveBeenCalledWith('home', 'lp-1', {
            props: expect.objectContaining({ mode: 'list', title: 'Paths' }),
        });
    });
});
