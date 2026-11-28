import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TemplateLibrary } from './TemplateLibrary';
import { VariantSwitcher } from './VariantSwitcher';
import { useEditorStore } from '../-stores/editor-store';

/**
 * The design-pattern registry's recipes in the Templates tab, and its whole-block
 * looks in the variant switcher, through the real editor store: a recipe page
 * replaces the page's sections (after the confirm), Brand chrome sets the header
 * and footer without touching the page, and a look keeps the admin's content.
 */

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k }),
}));

const state = () => useEditorStore.getState();

describe('Templates tab: design recipes', () => {
    beforeEach(() => {
        state().setConfig({
            pages: [
                {
                    id: 'courses',
                    route: 'courses',
                    title: 'Courses',
                    components: [{ id: 'old', type: 'textBlock', enabled: true, props: { content: 'x' } }],
                },
            ],
            globalSettings: {
                layout: {
                    header: { id: 'h', type: 'header', enabled: true, props: { title: 'Mine', navigation: [{ label: 'Home', route: 'home' }] } },
                },
            },
        } as never);
        state().selectPage('courses');
    });

    it('Editorial catalogue replaces the page with the editorial catalogue and a band', () => {
        render(<TemplateLibrary />);
        fireEvent.click(screen.getByRole('button', { name: /Editorial catalogue/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Apply Template' }));
        const comps = state().config!.pages[0]!.components;
        expect(comps.map((c) => c.type)).toEqual(['courseCatalog', 'ctaBanner']);
        expect((comps[0]!.props as Record<string, any>).render.cardStyle).toBe('editorial');
        expect(JSON.stringify(comps)).not.toMatch(/<[^<>]*>/);
    });

    it('Brand chrome (under Sections) sets header and footer and leaves the page alone', () => {
        render(<TemplateLibrary />);
        fireEvent.click(screen.getByRole('button', { name: /Sections/ }));
        const card = screen.getByRole('button', { name: /Brand chrome/ });
        expect(card).toHaveTextContent('Sets header & footer');
        fireEvent.click(card);
        // Asks first: it changes the header and footer of every page.
        expect(screen.getByText(/changes the header and footer on every page/)).toBeInTheDocument();
        expect((state().config!.globalSettings.layout as Record<string, any>).footer).toBeUndefined();
        fireEvent.click(screen.getByRole('button', { name: 'Apply Template' }));
        const config = state().config!;
        expect(config.pages[0]!.components.map((c) => c.id)).toEqual(['old']);
        const layout = config.globalSettings.layout as Record<string, any>;
        expect(layout.header.id).toBe('h');
        expect(layout.header.props.title).toBe('Mine');
        expect(layout.header.props.navigation).toEqual([{ label: 'Home', route: 'home' }]);
        expect(layout.header.props.navStyle).toBe('editorial');
        expect(layout.footer.props.variant).toBe('brand');
    });

    it('Brand chrome does nothing when the confirm is cancelled', () => {
        render(<TemplateLibrary />);
        fireEvent.click(screen.getByRole('button', { name: /Sections/ }));
        const before = JSON.stringify(state().config);
        fireEvent.click(screen.getByRole('button', { name: /Brand chrome/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(JSON.stringify(state().config)).toBe(before);
    });
});

describe('Variant switcher: registry looks', () => {
    it('offers the registry look by its label and applies only its look props', () => {
        const onApply = vi.fn();
        const current = { title: 'Mine', navigation: [{ label: 'Home', route: 'home' }], style: 'full-nav' };
        render(<VariantSwitcher componentType="header" currentProps={current} onApply={onApply} />);
        expect(screen.getByRole('button', { name: /Full Nav/ })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Editorial header' }));
        const applied = onApply.mock.calls[0]![0];
        expect(applied).toMatchObject({ title: 'Mine', navigation: [{ label: 'Home', route: 'home' }], navStyle: 'editorial' });
    });
});
