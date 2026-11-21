import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PropertyPanel } from './PropertyPanel';

/**
 * The Course Pages control is a section of the Global Settings panel, which is
 * only reachable through `selectGlobalSettings()` in the page tabs. `tsc` is
 * happy with a section that is never mounted, so this renders the real panel in
 * that state and checks the toggle is there and actually reveals the mapping
 * rows.
 */

const COURSE = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

const updateGlobalSettings = vi.fn();

let globalSettings: Record<string, unknown> = {};

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
    Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));
vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: () => ({
        getAllLevels: () => [],
        getCourseFromPackage: () => [{ id: COURSE, name: 'Pregnancy Guide' }],
        instituteDetails: null,
    }),
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
            pages: [{ id: 'p-preg', route: 'pregnancy', title: 'Your Pregnancy Journey', components: [] }],
            globalSettings,
        },
        selectedComponentId: null,
        selectedPageId: null,
        selectedGlobalSettings: true,
        selectedGlobalLayout: null,
        updateGlobalSettings,
        updateComponent: vi.fn(),
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

describe('Global Settings → Course Pages', () => {
    it('shows the Course Pages section in the global settings panel', () => {
        globalSettings = {};
        render(<PropertyPanel />);
        expect(screen.getByText('global.coursePages.heading')).toBeInTheDocument();
        expect(screen.getByText('global.coursePages.enable')).toBeInTheDocument();
    });

    it('hides the mapping rows until the admin switches it on', () => {
        globalSettings = {};
        render(<PropertyPanel />);
        expect(screen.queryByText('global.coursePages.empty')).not.toBeInTheDocument();
    });

    it('turns the setting on from the switch', () => {
        globalSettings = {};
        render(<PropertyPanel />);
        const section = screen.getByText('global.coursePages.heading').closest('div')!;
        fireEvent.click(section.querySelector('button[role="switch"]')!);
        expect(updateGlobalSettings).toHaveBeenCalledWith(
            expect.objectContaining({ coursePages: expect.objectContaining({ enabled: true }) })
        );
    });

    it('reveals the per-course rows once enabled', () => {
        globalSettings = {
            coursePages: { enabled: true, courses: { [COURSE]: { mode: 'PAGE', route: 'pregnancy' } } },
        };
        render(<PropertyPanel />);
        // The row shows the course, the mode it opens in, and the page.
        expect(screen.getByText('Pregnancy Guide')).toBeInTheDocument();
        expect(screen.getByText('global.coursePages.mode.PAGE')).toBeInTheDocument();
        expect(screen.getByText('Your Pregnancy Journey')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /coursePages.add/ })).toBeInTheDocument();
    });

    it('keeps the page picker out of the modes that ignore it', () => {
        globalSettings = { coursePages: { enabled: true, courses: { [COURSE]: { mode: 'OUTLINE' } } } };
        render(<PropertyPanel />);
        expect(screen.getByText('global.coursePages.mode.OUTLINE')).toBeInTheDocument();
        expect(screen.queryByText('global.coursePages.pagePlaceholder')).not.toBeInTheDocument();
    });
});
