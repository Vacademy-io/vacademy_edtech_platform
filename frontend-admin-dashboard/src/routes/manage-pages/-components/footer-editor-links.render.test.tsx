import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PropertyPanel } from './PropertyPanel';
import { useEditorStore } from '../-stores/editor-store';

/**
 * Footer link columns in the global footer editor. Each link used to be one
 * horizontal row holding the label box, the entire LinkPicker (page search +
 * page list) and the delete button, inside the 320px property panel — the
 * picker took the width and the label input shrank to a ~26px sliver, so
 * admins could not rename a link (one typed "h" blind and published it).
 * Links are now collapsed rows that open into a stacked editor, like the
 * header's navigation links. Renders the real panel against the real store.
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

const footer = {
    id: 'footer-1',
    type: 'footer',
    enabled: true,
    props: {
        layout: 'four-column',
        leftSection: { title: 'The7cs', text: 'x', socials: [] },
        rightSection1: { title: 'Main Menu', links: [{ label: 'Home page', route: 'homepage' }] },
        rightSection2: { title: 'Our Offerings', links: [{ label: 'All Content', route: 'books' }] },
        rightSection3: { title: 'Support', links: [{ label: 'FAQs', route: 'faq' }, { label: 'Privacy Policy', route: 'privacy-policy' }] },
    },
};

const footerLinks = (section: 'rightSection2' | 'rightSection3') =>
    useEditorStore.getState().config!.globalSettings.layout!.footer.props[section].links;

describe('Global footer → link columns', () => {
    beforeEach(() => {
        useEditorStore.getState().setConfig({
            pages: [
                { id: 'home', route: 'home', title: 'Home', components: [] },
                { id: 'p-books', route: 'books', title: 'Books', components: [] },
            ],
            globalSettings: { layout: { footer } },
        } as never);
        useEditorStore.getState().selectGlobalLayout('footer');
    });

    it('lists links collapsed, with the label box hidden until a row is opened', () => {
        render(<PropertyPanel />);
        expect(screen.getByRole('button', { name: /Privacy Policy/ })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByDisplayValue('Privacy Policy')).not.toBeInTheDocument();
    });

    it('opens a row into a stacked label + route editor and renames through it', () => {
        render(<PropertyPanel />);
        fireEvent.click(screen.getByRole('button', { name: /Privacy Policy/ }));
        const input = screen.getByDisplayValue('Privacy Policy');
        // The label box must own the panel width — the collapsed-row layout
        // stacks it above the LinkPicker instead of beside it.
        expect(input.parentElement).toHaveClass('space-y-2');
        expect(input.parentElement!.querySelector('input[placeholder="Search pages..."]')).not.toBeNull();

        fireEvent.change(input, { target: { value: 'Privacy' } });
        expect(footerLinks('rightSection3')[1]).toMatchObject({ label: 'Privacy', route: 'privacy-policy' });
        // The row header follows the label so the admin sees the rename land.
        expect(screen.getByRole('button', { name: /^Privacy$/ })).toHaveAttribute('aria-expanded', 'true');
    });

    it('opens a newly added link so the label box is the next thing on screen', () => {
        render(<PropertyPanel />);
        const addButtons = screen.getAllByRole('button', { name: /actions\.add/ });
        // Column order in the panel: socials, column 2, column 3, column 4.
        fireEvent.click(addButtons[2]!);
        expect(footerLinks('rightSection2')).toHaveLength(2);
        expect(screen.getByDisplayValue('header.defaults.newLink')).toBeInTheDocument();
    });

    it('deletes a link from its row header', () => {
        render(<PropertyPanel />);
        const row = screen.getByRole('button', { name: /All Content/ }).parentElement!;
        fireEvent.click(row.querySelector('button[aria-label="actions.delete"]')!);
        expect(footerLinks('rightSection2')).toHaveLength(0);
    });
});
