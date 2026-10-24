import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PropertyPanel } from '../PropertyPanel';
import { useEditorStore } from '../../-stores/editor-store';
import brahmVarchasSite from '../brahm-varchas-site.fixture.json';

/**
 * Header "Look", brand footer, band banner and editorial hero fields, on the
 * real Brahm Varchas site: each control writes its own key and every other
 * setting of the section stays as it was. Renders the real panel against the
 * real store. Sites without a palette (other institutes) see none of the new
 * design choices.
 */

// Each test renders the whole property panel; give a loaded machine room.
vi.setConfig({ testTimeout: 15_000 });

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (k: string, o?: { value?: string }) => (o?.value ? `${k}:${o.value}` : k),
    }),
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
vi.mock('../../-services/ai-page-service', () => ({ generateSectionVariants: vi.fn() }));
vi.mock('@tanstack/react-query', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
        queryKey[0] === 'campaignsList'
            ? {
                  data: { content: [{ id: 'camp-news', campaign_name: 'Newsletter 2' }] },
                  isLoading: false,
                  isError: false,
              }
            : { data: [], isLoading: false, isError: false },
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- hand-written site JSON
type Json = Record<string, any>;
const BV = brahmVarchasSite as unknown as { pages: Json[]; globalSettings: Json };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const config = () => useEditorStore.getState().config!;
const live = (pageId: string, id: string) =>
    config()
        .pages.find((p) => p.id === pageId)!
        .components.find((c) => c.id === id)! as Json;
const chrome = (key: 'header' | 'footer') =>
    (config().globalSettings as Json).layout[key].props as Json;
const group = (name: string) => within(screen.getByRole('group', { name }));
const input = (label: string) => screen.getByLabelText(label);

const load = (edit?: (site: Json) => void) => {
    const site = clone(BV) as Json;
    edit?.(site);
    useEditorStore.getState().setConfig(site as never);
};
/** Another institute's site: no theme.palette. */
const noPalette = (site: Json) => {
    delete site.globalSettings.theme.palette;
};
const PLAIN_CTA = {
    id: 'plain-cta',
    type: 'ctaBanner',
    enabled: true,
    props: { heading: 'Join', button: { enabled: true, text: 'Go', target: '/x' } },
};

describe('Header "Look" group', () => {
    beforeEach(() => {
        load();
        useEditorStore.getState().selectGlobalLayout('header');
    });

    it('shows the site’s choices and changes one key at a time', () => {
        const before = clone(chrome('header'));
        render(<PropertyPanel />);

        const nav = group('headerLook.navStyle');
        expect(nav.getByRole('button', { name: 'headerLook.editorial' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        expect(
            group('headerLook.languageSwitcherStyle').getByRole('button', {
                name: 'headerLook.switchSegmented',
            })
        ).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(nav.getByRole('button', { name: 'headerLook.standard' }));
        fireEvent.click(
            group('headerLook.cartDisplay').getByRole('button', { name: 'headerLook.cartAlways' })
        );
        fireEvent.click(screen.getByRole('switch', { name: 'headerLook.logoOnly' }));
        fireEvent.click(
            group('headerLook.megaMenuStyle').getByRole('button', { name: 'headerLook.standard' })
        );

        expect(chrome('header')).toEqual({
            ...before,
            navStyle: 'default',
            cartDisplay: 'always',
            logoOnly: false,
            megaMenuStyle: 'default',
        });
    });

    it('a header without the keys writes nothing on render and hides the style rows it has no use for', () => {
        load((site) => {
            site.globalSettings.layout.header.props = { title: 'Site', navigation: [] };
        });
        useEditorStore.getState().selectGlobalLayout('header');
        const before = JSON.stringify(config());
        render(<PropertyPanel />);

        expect(
            group('headerLook.barSize').getByRole('button', { name: 'headerLook.standard' })
        ).toHaveAttribute('aria-pressed', 'true');
        // Clicking the look already shown writes nothing.
        fireEvent.click(
            group('headerLook.barSize').getByRole('button', { name: 'headerLook.standard' })
        );
        expect(
            screen.queryByRole('group', { name: 'headerLook.languageSwitcherStyle' })
        ).toBeNull();
        expect(screen.queryByRole('group', { name: 'headerLook.megaMenuStyle' })).toBeNull();
        expect(JSON.stringify(config())).toBe(before);
    });

    it('a site without a palette and a header without the keys shows no Look group', () => {
        load((site) => {
            noPalette(site);
            site.globalSettings.layout.header.props = { title: 'Site', navigation: [] };
        });
        useEditorStore.getState().selectGlobalLayout('header');
        const before = JSON.stringify(config());
        render(<PropertyPanel />);

        expect(screen.getByText('headerExtras.heading')).toBeInTheDocument();
        expect(screen.queryByText('headerLook.heading')).toBeNull();
        expect(screen.queryByRole('group', { name: 'headerLook.navStyle' })).toBeNull();
        expect(JSON.stringify(config())).toBe(before);
    });

    it('a site without a palette still shows the group once the header sets a look key', () => {
        load((site) => {
            noPalette(site);
            site.globalSettings.layout.header.props = { title: 'Site', barSize: 'compact' };
        });
        useEditorStore.getState().selectGlobalLayout('header');
        render(<PropertyPanel />);
        expect(
            group('headerLook.barSize').getByRole('button', { name: 'headerLook.barCompact' })
        ).toHaveAttribute('aria-pressed', 'true');
    });

    it('an unknown stored value stays selected as "Custom"', () => {
        load((site) => {
            site.globalSettings.layout.header.props.contentWidth = 'shell';
        });
        useEditorStore.getState().selectGlobalLayout('header');
        render(<PropertyPanel />);
        expect(
            group('headerLook.contentWidth').getByRole('button', {
                name: 'options.customValue:shell',
            })
        ).toHaveAttribute('aria-pressed', 'true');
    });
});

describe('Brand footer fields', () => {
    beforeEach(() => {
        load();
        useEditorStore.getState().selectGlobalLayout('footer');
    });

    it('edits the tagline, newsletter, bottom bar and background and keeps the rest', () => {
        const before = clone(chrome('footer'));
        render(<PropertyPanel />);

        fireEvent.change(input('footerBrand.tagline'), { target: { value: 'Know • Grow' } });
        fireEvent.change(input('footerBrand.newsletter.heading'), {
            target: { value: 'Join us' },
        });
        const list = screen.getByText('footerBrand.newsletterList').parentElement!;
        fireEvent.change(list.querySelector('select')!, { target: { value: 'camp-news' } });
        fireEvent.change(input('footerBrand.bottomTagline'), { target: { value: 'Made here' } });
        fireEvent.click(screen.getByRole('switch', { name: 'footerBrand.languageSwitch' }));
        fireEvent.click(screen.getByRole('button', { name: 'chromeLook.useSiteColour' }));

        expect(chrome('footer')).toEqual({
            ...before,
            leftSection: { ...before.leftSection, tagline: 'Know • Grow' },
            newsletter: {
                ...before.newsletter,
                heading: 'Join us',
                audienceId: 'camp-news',
                audienceName: 'Newsletter 2',
            },
            bottomTagline: 'Made here',
            showLanguageSwitcher: !before.showLanguageSwitcher,
            backgroundColor: undefined,
        });
    });

    it('the logo is editable', () => {
        const before = clone(chrome('footer'));
        render(<PropertyPanel />);

        fireEvent.change(screen.getAllByDisplayValue(before.leftSection.logo)[0]!, {
            target: { value: 'https://cdn.example.com/logo.png' },
        });

        expect(chrome('footer')).toEqual({
            ...before,
            leftSection: { ...before.leftSection, logo: 'https://cdn.example.com/logo.png' },
        });
    });

    it('the "Support" column (column 5) is editable and only it changes', () => {
        const before = clone(chrome('footer'));
        render(<PropertyPanel />);

        expect(screen.getByText('footer.column5')).toBeInTheDocument();
        fireEvent.change(screen.getByDisplayValue('Support'), { target: { value: 'Help' } });
        fireEvent.click(screen.getByRole('button', { name: /Privacy Policy/ }));
        fireEvent.change(screen.getByDisplayValue('Privacy Policy'), {
            target: { value: 'Privacy' },
        });

        const links = [...before.rightSection4.links];
        links[1] = { ...links[1], label: 'Privacy' };
        expect(chrome('footer')).toEqual({
            ...before,
            rightSection4: { ...before.rightSection4, title: 'Help', links },
        });
    });

    it('turning the newsletter off keeps its texts for later', () => {
        const before = clone(chrome('footer'));
        render(<PropertyPanel />);
        fireEvent.click(screen.getByRole('switch', { name: 'footerBrand.newsletterShow' }));

        expect(chrome('footer')).toEqual({
            ...before,
            newsletter: { ...before.newsletter, enabled: false },
        });
        expect(screen.queryByLabelText('footerBrand.newsletter.heading')).toBeNull();
    });
});

describe('Band banner fields', () => {
    beforeEach(() => load());

    it('institutions band: both buttons are editable and nothing else changes', () => {
        const before = clone(live('learning-paths', 'lp-institutions'));
        useEditorStore.getState().selectComponent('lp-institutions');
        render(<PropertyPanel />);

        expect(
            group('ctaBand.bandSize').getByRole('button', { name: 'ctaBand.sizeLarge' })
        ).toHaveAttribute('aria-pressed', 'true');

        const [firstStyle, secondStyle] = screen.getAllByRole('group', {
            name: 'ctaBand.buttonStyle',
        });
        fireEvent.click(
            within(firstStyle!).getByRole('button', { name: 'ctaBand.styleOutlineLight' })
        );
        fireEvent.click(within(secondStyle!).getByRole('button', { name: 'ctaBand.styleOlive' }));
        const [firstForm, secondForm] = screen.getAllByLabelText('ctaBand.formTitle');
        fireEvent.change(firstForm!, { target: { value: 'Talk to our team' } });
        fireEvent.change(secondForm!, { target: { value: 'Become a partner' } });
        fireEvent.change(screen.getByDisplayValue('Partner with us'), {
            target: { value: 'Partner' },
        });
        fireEvent.change(input('ctaBand.eyebrow'), { target: { value: 'For schools' } });

        expect(live('learning-paths', 'lp-institutions')).toEqual({
            ...before,
            props: {
                ...before.props,
                eyebrow: 'For schools',
                button: {
                    ...before.props.button,
                    style: 'outline-light',
                    formTitle: 'Talk to our team',
                },
                secondaryButton: {
                    ...before.props.secondaryButton,
                    style: 'olive',
                    formTitle: 'Become a partner',
                    text: 'Partner',
                },
            },
        });
    });

    it('app band: the phone picture and its alt text are editable', () => {
        const before = clone(live('learning-paths', 'lp-app'));
        useEditorStore.getState().selectComponent('lp-app');
        render(<PropertyPanel />);

        fireEvent.change(screen.getByDisplayValue(before.props.mockup.alt), {
            target: { value: 'Our app' },
        });
        fireEvent.click(screen.getAllByRole('switch', { name: 'ctaBand.arrow' })[0]!);

        expect(live('learning-paths', 'lp-app').props).toEqual({
            ...before.props,
            mockup: { ...before.props.mockup, alt: 'Our app' },
            button: { ...before.props.button, icon: 'none' },
        });
    });

    it('app band: the phone picture switched off and on again comes back', () => {
        const before = clone(live('learning-paths', 'lp-app'));
        useEditorStore.getState().selectComponent('lp-app');
        render(<PropertyPanel />);

        const phone = () => screen.getByRole('switch', { name: 'ctaBand.phoneShow' });
        fireEvent.click(phone());
        expect(live('learning-paths', 'lp-app').props.mockup).toBeUndefined();
        expect(screen.queryByDisplayValue(before.props.mockup.alt)).toBeNull();
        fireEvent.click(phone());

        expect(live('learning-paths', 'lp-app').props).toEqual(before.props);
    });

    it('the second button switched off and on keeps its text and action', () => {
        const before = clone(live('learning-paths', 'lp-institutions'));
        useEditorStore.getState().selectComponent('lp-institutions');
        render(<PropertyPanel />);

        const [, second] = screen.getAllByRole('switch', { name: 'ctaBanner.showButton' });
        fireEvent.click(second!);
        expect(live('learning-paths', 'lp-institutions').props.secondaryButton).toEqual({
            ...before.props.secondaryButton,
            enabled: false,
        });
        // Text and form title are both "Partner with us".
        expect(screen.queryAllByDisplayValue('Partner with us')).toHaveLength(0);
        fireEvent.click(second!);

        expect(live('learning-paths', 'lp-institutions').props).toEqual({
            ...before.props,
            secondaryButton: { ...before.props.secondaryButton, enabled: true },
        });
        expect(screen.queryAllByDisplayValue('Partner with us')).toHaveLength(2);
    });

    it('a band button without "enabled" shows as on, as on the site', () => {
        load((site) => {
            site.pages[0].components.push({
                ...PLAIN_CTA,
                props: { variant: 'band', button: { text: 'Go', target: '/x' } },
            });
        });
        useEditorStore.getState().selectComponent('plain-cta');
        const before = JSON.stringify(config());
        render(<PropertyPanel />);

        const [first] = screen.getAllByRole('switch', { name: 'ctaBanner.showButton' });
        expect(first).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByDisplayValue('Go')).toBeInTheDocument();
        expect(screen.getByText('ctaBand.firstButtonLook')).toBeInTheDocument();
        expect(JSON.stringify(config())).toBe(before);

        fireEvent.click(first!);
        expect(live('courses', 'plain-cta').props.button).toEqual({
            text: 'Go',
            target: '/x',
            enabled: false,
        });
        // A hidden button shows neither its text nor its look.
        expect(screen.queryByDisplayValue('Go')).toBeNull();
        expect(screen.queryByText('ctaBand.firstButtonLook')).toBeNull();
    });

    it('a band without colours shows the site colour note, not made-up defaults', () => {
        load((site) => {
            site.pages[0].components.push({
                ...PLAIN_CTA,
                props: { variant: 'band', heading: 'Join' },
            });
        });
        useEditorStore.getState().selectComponent('plain-cta');
        render(<PropertyPanel />);

        expect(screen.queryByDisplayValue(/3B82F6/i)).toBeNull();
        // background, text, eyebrow and subheading colours are all unset
        expect(screen.getAllByText('chromeLook.siteColourNote')).toHaveLength(4);
    });

    it('a site without a palette shows no design choice on a classic banner', () => {
        load((site) => {
            noPalette(site);
            site.pages[0].components.push(clone(PLAIN_CTA));
        });
        useEditorStore.getState().selectComponent('plain-cta');
        const before = JSON.stringify(config());
        render(<PropertyPanel />);

        expect(screen.queryByRole('group', { name: 'ctaBand.style' })).toBeNull();
        expect(screen.getByDisplayValue('Go')).toBeInTheDocument();
        expect(JSON.stringify(config())).toBe(before);
    });

    it('a classic banner shows only the design choice and writes nothing until it is used', () => {
        load((site) => {
            site.pages[0].components.push(clone(PLAIN_CTA));
        });
        useEditorStore.getState().selectComponent('plain-cta');
        const before = JSON.stringify(config());
        render(<PropertyPanel />);

        expect(
            group('ctaBand.style').getByRole('button', { name: 'ctaBand.styleClassic' })
        ).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByLabelText('ctaBand.eyebrow')).toBeNull();
        expect(screen.queryByText('ctaBand.secondButton')).toBeNull();
        expect(JSON.stringify(config())).toBe(before);

        fireEvent.click(group('ctaBand.style').getByRole('button', { name: 'ctaBand.styleBand' }));
        expect(live('courses', 'plain-cta').props).toEqual({
            heading: 'Join',
            button: { enabled: true, text: 'Go', target: '/x' },
            variant: 'band',
        });
        expect(screen.getByText('ctaBand.secondButton')).toBeInTheDocument();
    });
});

describe('Editorial hero fields', () => {
    beforeEach(() => {
        load();
        useEditorStore.getState().selectComponent('lp-hero');
    });

    it('edits the accent line, checklist, breadcrumb, width and outline and keeps the rest', () => {
        const before = clone(live('learning-paths', 'lp-hero'));
        render(<PropertyPanel />);

        fireEvent.change(input('heroEditorial.titleAccent'), {
            target: { value: 'Pick a path.' },
        });
        fireEvent.change(input('heroEditorial.checklist 2'), {
            target: { value: 'Step 1 free' },
        });
        // The first crumb links to the home page; "Clear" makes it plain text.
        // Scoped to that crumb's picker: the hero CTA pickers above have their own Clear.
        const homeCrumb = screen.getAllByText('/homepage').find((el) => el.tagName === 'STRONG')!;
        fireEvent.click(within(homeCrumb.closest('div')!).getByRole('button', { name: 'Clear' }));
        fireEvent.change(input('heroEditorial.mediaWidth'), { target: { value: '560' } });
        fireEvent.click(screen.getByRole('button', { name: 'chromeLook.useSiteColour' }));

        const checklist = [...before.props.left.checklist];
        checklist[1] = 'Step 1 free';
        expect(live('learning-paths', 'lp-hero').props).toEqual({
            ...before.props,
            left: { ...before.props.left, titleAccent: 'Pick a path.', checklist },
            breadcrumb: [{ label: 'Home' }, ...before.props.breadcrumb.slice(1)],
            mediaWidth: 560,
            outlineColor: undefined,
        });
    });

    it('an empty picture width removes the key (the site default is used)', () => {
        load((site) => {
            site.pages
                .find((p: Json) => p.id === 'learning-paths')
                .components.find((c: Json) => c.id === 'lp-hero').props.mediaWidth = 560;
        });
        useEditorStore.getState().selectComponent('lp-hero');
        const before = clone(live('learning-paths', 'lp-hero'));
        render(<PropertyPanel />);

        fireEvent.change(input('heroEditorial.mediaWidth'), { target: { value: '' } });

        expect(live('learning-paths', 'lp-hero').props).toEqual({
            ...before.props,
            mediaWidth: undefined,
        });
    });

    it('a picture width outside 200–800 is pulled into range when the field is left', () => {
        const before = clone(live('learning-paths', 'lp-hero'));
        render(<PropertyPanel />);
        const field = input('heroEditorial.mediaWidth');

        fireEvent.change(field, { target: { value: '150' } });
        expect(field).toHaveAttribute('aria-invalid', 'true');
        fireEvent.blur(field);
        expect(live('learning-paths', 'lp-hero').props).toEqual({ ...before.props, mediaWidth: 200 });
        expect(screen.getByRole('status')).toHaveTextContent('heroEditorial.mediaWidthClamped');

        fireEvent.change(input('heroEditorial.mediaWidth'), { target: { value: '900' } });
        fireEvent.blur(input('heroEditorial.mediaWidth'));
        expect(live('learning-paths', 'lp-hero').props.mediaWidth).toBe(800);
    });

    it('a site without a palette shows no design choice on a classic hero', () => {
        load((site) => {
            noPalette(site);
            const hero = site.pages
                .find((p: Json) => p.id === 'learning-paths')
                .components.find((c: Json) => c.id === 'lp-hero');
            delete hero.props.variant;
        });
        useEditorStore.getState().selectComponent('lp-hero');
        const before = JSON.stringify(config());
        render(<PropertyPanel />);

        expect(screen.queryByRole('group', { name: 'heroEditorial.style' })).toBeNull();
        expect(screen.queryByLabelText('heroEditorial.titleAccent')).toBeNull();
        expect(JSON.stringify(config())).toBe(before);
    });

    it('switching to Classic hides the editorial fields and keeps their values', () => {
        const before = clone(live('learning-paths', 'lp-hero'));
        render(<PropertyPanel />);

        fireEvent.click(
            group('heroEditorial.style').getByRole('button', { name: 'heroEditorial.styleClassic' })
        );

        expect(live('learning-paths', 'lp-hero').props).toEqual({
            ...before.props,
            variant: undefined,
        });
        expect(screen.queryByLabelText('heroEditorial.titleAccent')).toBeNull();
    });
});

describe('Editing in हिन्दी', () => {
    const TAGLINE = BV.globalSettings.layout.footer.props.leftSection.tagline as string;
    const hi = () => (config().globalSettings as Json).i18n.strings.hi as Record<string, string>;
    beforeEach(() =>
        load((site) => {
            site.globalSettings.i18n.strings.hi = {
                [TAGLINE]: 'ज्ञान का अनुवाद',
                'Courses in the right order': 'सही क्रम में कोर्स',
            };
        })
    );

    it('a footer tagline typed in Hindi is stored as its translation, English unchanged', () => {
        const before = clone(chrome('footer'));
        useEditorStore.getState().selectGlobalLayout('footer');
        useEditorStore.getState().setEditingLocale('hi');
        render(<PropertyPanel />);

        fireEvent.change(screen.getByDisplayValue('ज्ञान का अनुवाद'), {
            target: { value: 'ज्ञान का अनुवाद करें' },
        });

        expect(chrome('footer')).toEqual(before);
        expect(hi()[TAGLINE]).toBe('ज्ञान का अनुवाद करें');
    });

    it('a hero checklist item typed in Hindi is stored as its translation', () => {
        const before = clone(live('learning-paths', 'lp-hero'));
        useEditorStore.getState().selectComponent('lp-hero');
        useEditorStore.getState().setEditingLocale('hi');
        render(<PropertyPanel />);

        fireEvent.change(screen.getByDisplayValue('सही क्रम में कोर्स'), {
            target: { value: 'सही क्रम में पाठ्यक्रम' },
        });

        expect(live('learning-paths', 'lp-hero')).toEqual(before);
        expect(hi()['Courses in the right order']).toBe('सही क्रम में पाठ्यक्रम');
    });
});
