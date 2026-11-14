import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PropertyPanel } from '../PropertyPanel';
import { useEditorStore } from '../../-stores/editor-store';

/**
 * Header editor: nav item type + mega-menu settings, per-button look and the
 * header extras. Renders the real panel against the real store (the global
 * header goes through the same HeaderEditor as a page header).
 */

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string, d?: unknown) => (typeof d === 'string' ? d : k) }),
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
vi.mock('@tanstack/react-query', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
        queryKey[0] === 'FOLDER_LIBRARIES'
            ? {
                  data: [{ id: 'lib-1', name: 'Streams', node_count: 8, institute_id: 'inst-1' }],
                  isLoading: false,
                  isError: false,
              }
            : { data: [], isLoading: false, isError: false },
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const headerProps = () => useEditorStore.getState().config!.globalSettings.layout!.header.props;

const seed = (props: Record<string, unknown>) => {
    useEditorStore.getState().setConfig({
        pages: [
            { id: 'home', route: 'home', title: 'Home', components: [] },
            { id: 'p-path', route: 'find-your-path', title: 'Find your path', components: [] },
        ],
        globalSettings: {
            layout: { header: { id: 'header', type: 'header', enabled: true, props } },
        },
    } as never);
    useEditorStore.getState().selectGlobalLayout('header');
};

describe('Global header → nav item type and mega menu', () => {
    beforeEach(() =>
        seed({
            title: 'Site',
            navigation: [
                { label: 'Knowledge Streams', route: '', openInSameTab: true },
                { label: 'Courses', route: 'courses', openInSameTab: true },
            ],
            authLinks: [{ label: 'Login', route: 'login' }],
        })
    );

    it('renders a header saved without the new keys and writes nothing on its own', () => {
        const before = JSON.stringify(useEditorStore.getState().config);
        render(<PropertyPanel />);
        expect(screen.getByText('headerExtras.heading')).toBeInTheDocument();
        expect(JSON.stringify(useEditorStore.getState().config)).toBe(before);
    });

    it('turns a nav item into a mega menu and edits its settings in one item', () => {
        render(<PropertyPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Knowledge Streams/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Mega menu' }));
        expect(headerProps().navigation[0]).toMatchObject({
            label: 'Knowledge Streams',
            type: 'megaMenu',
            megaMenu: { showLegend: true },
        });
        expect(screen.getByText('Mega menu', { selector: 'span' })).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Folder library'), { target: { value: 'lib-1' } });
        expect(headerProps().navigation[0].megaMenu).toMatchObject({
            libraryId: 'lib-1',
            libraryName: 'Streams',
        });

        fireEvent.change(screen.getByPlaceholderText('Six streams of knowledge'), {
            target: { value: 'Six streams of knowledge' },
        });
        expect(headerProps().navigation[0]).toMatchObject({
            type: 'megaMenu',
            megaMenu: { libraryId: 'lib-1', eyebrow: 'Six streams of knowledge', showLegend: true },
        });
        // The other item is untouched.
        expect(headerProps().navigation[1]).toEqual({
            label: 'Courses',
            route: 'courses',
            openInSameTab: true,
        });
    });

    it('stores the help link as a site path', () => {
        render(<PropertyPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Knowledge Streams/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Mega menu' }));
        const helpPicker = screen.getByText('Help link', { selector: 'label' }).parentElement!;
        fireEvent.click(within(helpPicker).getByRole('button', { name: /Find your path/ }));
        expect(headerProps().navigation[0].megaMenu.helpRoute).toBe('/find-your-path');
    });

    it('keeps a mega-menu item and its settings through "Sync from pages"', () => {
        render(<PropertyPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Knowledge Streams/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Mega menu' }));
        fireEvent.change(screen.getByLabelText('Folder library'), { target: { value: 'lib-1' } });
        const before = headerProps().navigation[0];

        fireEvent.click(screen.getByRole('button', { name: 'header.syncPages' }));
        const nav = headerProps().navigation;
        expect(nav.map((i: { label: string }) => i.label)).toEqual([
            'Knowledge Streams',
            'Courses',
            'Home',
            'Find your path',
        ]);
        expect(nav[0]).toEqual(before);
        expect(nav[0]).toMatchObject({ type: 'megaMenu', megaMenu: { libraryId: 'lib-1' } });
        // "Courses" is not one of this site's pages: it is the admin's own link and stays.
        expect(nav[1]).toMatchObject({ label: 'Courses', route: 'courses' });
    });

    it('switches back to a plain link, keeping the menu settings for later', () => {
        render(<PropertyPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Knowledge Streams/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Mega menu' }));
        fireEvent.change(screen.getByPlaceholderText('Six streams of knowledge'), {
            target: { value: 'Eyebrow' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Its link' }));
        expect(headerProps().navigation[0]).toMatchObject({
            type: 'link',
            megaMenu: { eyebrow: 'Eyebrow' },
        });
        expect(screen.queryByLabelText('Folder library')).not.toBeInTheDocument();
    });
});

describe('Global header → button look and extras', () => {
    beforeEach(() =>
        seed({
            navigation: [],
            authLinks: [
                { label: 'Login', route: 'login' },
                { label: 'Become a member', route: 'join' },
            ],
        })
    );

    it('sets and clears a button style', () => {
        render(<PropertyPanel />);
        fireEvent.click(screen.getByRole('button', { name: /^.*Login$/ }));
        expect(
            screen.getByText('The first button is filled, the others outlined.')
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Text link' }));
        expect(headerProps().authLinks[0]).toMatchObject({ label: 'Login', style: 'text' });
        fireEvent.click(screen.getByRole('button', { name: 'Automatic' }));
        expect(headerProps().authLinks[0].style).toBeUndefined();
        expect(JSON.parse(JSON.stringify(headerProps().authLinks[0]))).toEqual({
            label: 'Login',
            route: 'login',
        });
    });

    it('writes the header extras', () => {
        render(<PropertyPanel />);
        fireEvent.click(screen.getByRole('button', { name: 'headerExtras.underline' }));
        expect(headerProps().activeStyle).toBe('underline');
        fireEvent.click(screen.getByRole('switch', { name: 'headerExtras.search' }));
        expect(headerProps().showSearch).toBe(true);
        fireEvent.click(screen.getByRole('switch', { name: 'headerExtras.languageSwitch' }));
        expect(headerProps().showLanguageSwitcher).toBe(true);
    });

    it('sets where the logo leads: home by default, another page, or no link', () => {
        render(<PropertyPanel />);
        const choice = within(screen.getByRole('group', { name: 'headerExtras.logoClick' }));
        expect(choice.getByRole('button', { name: 'headerExtras.logoHome' })).toHaveAttribute('aria-pressed', 'true');
        expect(headerProps().logoLink).toBeUndefined();

        fireEvent.click(choice.getByRole('button', { name: 'headerExtras.logoNone' }));
        expect(headerProps().logoLink).toBe('none');

        // "Another page or link" offers the site's pages; picking one stores its route.
        fireEvent.click(choice.getByRole('button', { name: 'headerExtras.logoOther' }));
        expect(headerProps().logoLink).toBeUndefined();
        fireEvent.click(screen.getByRole('button', { name: /Find your path/ }));
        expect(headerProps().logoLink).toBe('find-your-path');

        fireEvent.click(choice.getByRole('button', { name: 'headerExtras.logoHome' }));
        expect(headerProps().logoLink).toBeUndefined();
    });
});
