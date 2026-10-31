import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PropertyPanel } from './PropertyPanel';
import { useEditorStore } from '../-stores/editor-store';

/**
 * Hero CTA navigation. The multi-CTA "Navigate" target was a bare text box (an
 * admin had to know to type "#anchor" AND set that anchor ID on the section),
 * and a hero carrying only the legacy left.button (every page template) had no
 * button editor at all. Each hero button now gets the LinkPicker, whose Section
 * tab lists this page's sections and gives the picked one an anchor ID.
 */

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

const page = (heroLeft: Record<string, unknown>) => ({
    id: 'home',
    route: 'home',
    title: 'Home',
    components: [
        { id: 'hdr', type: 'header', enabled: true, props: {} },
        { id: 'hero', type: 'heroSection', enabled: true, props: { layout: 'split', left: heroLeft } },
        { id: 'courses', type: 'courseCatalog', enabled: true, props: { title: 'Our Courses' } },
        { id: 'faq', type: 'faqSection', enabled: true, anchorId: 'faq', props: { heading: 'FAQ' } },
    ],
});

const setup = (heroLeft: Record<string, unknown>) => {
    useEditorStore.getState().setConfig({ pages: [page(heroLeft)], globalSettings: {} } as never);
    useEditorStore.getState().selectPage('home');
    useEditorStore.getState().selectComponent('hero');
    render(<PropertyPanel />);
};

const comps = () => useEditorStore.getState().config!.pages[0]!.components;
const heroLeft = () => comps().find((c) => c.id === 'hero')!.props.left;

describe('Hero CTA → navigate to a section', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('multi-CTA: Section tab lists this page’s sections (not header, not the hero itself)', () => {
        setup({ title: 'Hi', buttons: [{ text: 'Explore', action: 'navigate', target: '', variant: 'primary' }] });
        fireEvent.click(screen.getByRole('button', { name: /^Section$/ }));
        expect(screen.getByRole('button', { name: /Course Catalog — Our Courses/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /FAQ/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Header/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Hero Section/ })).not.toBeInTheDocument();
    });

    it('picking a section without an anchor gives it one and points the button at it', () => {
        setup({ title: 'Hi', buttons: [{ text: 'Explore', action: 'navigate', target: '', variant: 'primary' }] });
        fireEvent.click(screen.getByRole('button', { name: /^Section$/ }));
        fireEvent.click(screen.getByRole('button', { name: /Course Catalog — Our Courses/ }));
        const anchor = comps().find((c) => c.id === 'courses')!.anchorId;
        expect(anchor).toBe('course-catalog');
        expect(heroLeft().buttons[0].target).toBe('#course-catalog');
        expect(screen.getByText(/Scrolls to:/)).toBeInTheDocument();
    });

    it('reuses an existing anchor ID instead of inventing one', () => {
        setup({ title: 'Hi', buttons: [{ text: 'FAQ', action: 'navigate', target: '', variant: 'primary' }] });
        fireEvent.click(screen.getByRole('button', { name: /^Section$/ }));
        fireEvent.click(screen.getByRole('button', { name: /FAQ — FAQ/ }));
        expect(heroLeft().buttons[0].target).toBe('#faq');
        expect(comps().find((c) => c.id === 'faq')!.anchorId).toBe('faq');
    });

    it('opens on the Section tab for an existing #target and flags a dangling one', () => {
        setup({ title: 'Hi', buttons: [{ text: 'Explore', action: 'navigate', target: '#courses', variant: 'primary' }] });
        expect(screen.getByText(/No section on this page has ID/)).toBeInTheDocument();
    });

    it('legacy single button (page templates) is editable with the same navigate picker', () => {
        setup({ title: 'Hi', button: { enabled: true, text: 'Browse Courses', action: 'navigate', target: 'courses' } });
        const block = screen.getByText('hero.mainButton').closest('div.rounded') as HTMLElement;
        expect(within(block).getByDisplayValue('Browse Courses')).toBeInTheDocument();
        fireEvent.click(within(block).getByRole('button', { name: /^Section$/ }));
        fireEvent.click(within(block).getByRole('button', { name: /FAQ — FAQ/ }));
        expect(heroLeft().button).toMatchObject({ enabled: true, text: 'Browse Courses', target: '#faq' });
    });

    it('hides the legacy block once a multi-CTA has text (the live hero hides it too)', () => {
        setup({
            title: 'Hi',
            button: { enabled: true, text: 'Old', action: 'navigate', target: '' },
            buttons: [{ text: 'New', action: 'navigate', target: '', variant: 'primary' }],
        });
        expect(screen.queryByText('hero.mainButton')).not.toBeInTheDocument();
    });
});
