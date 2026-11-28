import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PropertyPanel } from '../PropertyPanel';
import { useEditorStore } from '../../-stores/editor-store';
import { useLocalizedEditNotice } from '../../-hooks/use-localized-editing';
import { EditingLanguageToggle } from './EditingLanguageToggle';
import { LocalizedEditingBar } from './LocalizedEditingBar';

/**
 * "Editing: English | हिन्दी" end to end through the REAL property panel and
 * store: in Hindi the panel shows the translations, typing writes the
 * dictionary (the English base never changes), an empty English field cannot
 * be "translated", and English mode shows the base text as before.
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
vi.mock('@tanstack/react-query', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useQuery: () => ({ data: [], isLoading: false, isError: false }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const HI = {
    'Six streams of knowledge': 'ज्ञान की छह धाराएँ',
    'Smart Academy': 'स्मार्ट अकादमी',
    'Home of learning': 'सीखने का घर',
};

const LOCALES = [
    { code: 'en', label: 'EN' },
    { code: 'hi', label: 'हिन्दी' },
];

const load = () => {
    useEditorStore.getState().setConfig({
        pages: [
            {
                id: 'home',
                route: 'home',
                title: 'Home',
                seo: { metaTitle: 'Home of learning' },
                components: [
                    {
                        id: 'sh',
                        type: 'sectionHeading',
                        enabled: true,
                        props: { title: 'Six streams of knowledge', eyebrow: '' },
                    },
                ],
            },
        ],
        globalSettings: {
            layout: {
                header: {
                    type: 'header',
                    enabled: true,
                    props: { title: 'Smart Academy', navigation: [] },
                },
            },
            i18n: {
                enabled: true,
                defaultLocale: 'en',
                locales: LOCALES,
                strings: { hi: { ...HI } },
            },
        },
    } as never);
};

const state = () => useEditorStore.getState();
const hi = () => state().config!.globalSettings.i18n!.strings!.hi!;

describe('PropertyPanel — editing हिन्दी', () => {
    beforeEach(() => {
        load();
        useLocalizedEditNotice.getState().clear();
    });

    it('shows the Hindi text and stores what is typed as its translation, leaving English untouched', () => {
        state().selectComponent('sh');
        state().setEditingLocale('hi');
        render(<PropertyPanel />);
        const title = screen.getByDisplayValue('ज्ञान की छह धाराएँ');
        fireEvent.change(title, { target: { value: 'ज्ञान की छह धाराएं' } });
        expect(state().config!.pages[0]!.components[0]!.props.title).toBe(
            'Six streams of knowledge'
        );
        expect(hi()['Six streams of knowledge']).toBe('ज्ञान की छह धाराएं');
        expect(screen.getByDisplayValue('ज्ञान की छह धाराएं')).toBeInTheDocument();
    });

    it('refuses typing into a field that is empty in English', () => {
        state().selectComponent('sh');
        state().setEditingLocale('hi');
        render(<PropertyPanel />);
        const before = state().config;
        fireEvent.change(screen.getByPlaceholderText('sectionHeading.eyebrowPlaceholder'), {
            target: { value: 'नया' },
        });
        expect(state().config).toBe(before);
        expect(useLocalizedEditNotice.getState().notice?.reason).toBe('emptySource');
    });

    it('in English shows and edits the base text exactly as before', () => {
        state().selectComponent('sh');
        render(<PropertyPanel />);
        fireEvent.change(screen.getByDisplayValue('Six streams of knowledge'), {
            target: { value: 'Six streams' },
        });
        expect(state().config!.pages[0]!.components[0]!.props.title).toBe('Six streams');
        expect(hi()).toEqual(HI);
    });

    it('translates the global header title', () => {
        state().selectGlobalLayout('header');
        state().setEditingLocale('hi');
        render(<PropertyPanel />);
        fireEvent.change(screen.getByDisplayValue('स्मार्ट अकादमी'), {
            target: { value: 'स्मार्ट एकेडमी' },
        });
        expect(state().config!.globalSettings.layout!.header.props.title).toBe('Smart Academy');
        expect(hi()['Smart Academy']).toBe('स्मार्ट एकेडमी');
    });

    it('translates the page SEO title', () => {
        state().selectPage('home');
        state().setEditingLocale('hi');
        render(<PropertyPanel />);
        fireEvent.change(screen.getByDisplayValue('सीखने का घर'), {
            target: { value: 'सीखने की जगह' },
        });
        expect(state().config!.pages[0]!.seo!.metaTitle).toBe('Home of learning');
        expect(hi()['Home of learning']).toBe('सीखने की जगह');
    });

    it('keeps the AI "try another version" swap for the base language only', () => {
        state().selectComponent('sh');
        state().setEditingLocale('hi');
        render(<PropertyPanel />);
        expect(
            screen.getByTitle('Switch to the base language to try other versions')
        ).toBeDisabled();
    });
});

describe('Global Settings → Languages', () => {
    beforeEach(load);

    it('shows each offered language with its translation coverage, and never rewrites translations', () => {
        state().selectGlobalSettings();
        render(<PropertyPanel />);
        expect(screen.getByText('Languages')).toBeInTheDocument();
        // header title, section title, page SEO title translated; the page
        // title 'Home' (shown by the site search) is counted and still open.
        expect(screen.getByText('3 of 4 texts translated')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Stop offering हिन्दी' }));
        const i18n = state().config!.globalSettings.i18n!;
        expect(i18n.locales).toEqual([{ code: 'en', label: 'EN' }]);
        expect(i18n.strings!.hi).toEqual(HI);
        // One language left: nothing to switch between, so the visitor switch is off.
        expect(i18n.enabled).toBe(false);
        expect(
            screen.getByRole('switch', { name: 'Show the language switch to visitors' })
        ).not.toBeChecked();
    });

    it('keeps the visitor switch on while two languages remain', () => {
        useEditorStore.getState().setConfig({
            pages: [],
            globalSettings: {
                i18n: {
                    enabled: true,
                    defaultLocale: 'en',
                    locales: [...LOCALES, { code: 'mr', label: 'मराठी' }],
                    strings: {},
                },
            },
        } as never);
        state().selectGlobalSettings();
        render(<PropertyPanel />);
        fireEvent.click(screen.getByRole('button', { name: 'Stop offering मराठी' }));
        expect(state().config!.globalSettings.i18n!.enabled).toBe(true);
        expect(state().config!.globalSettings.i18n!.locales).toEqual(LOCALES);
    });

    it('lets the switch label be typed as is — spaces mid-typing, emptied to retype', () => {
        state().selectGlobalSettings();
        const { container } = render(<PropertyPanel />);
        const label = () => container.querySelector<HTMLInputElement>('#switch-label-hi')!;
        const stored = () => state().config!.globalSettings.i18n!.locales!.find((l) => l.code === 'hi')!.label;

        fireEvent.change(label(), { target: { value: 'Hindi ' } });
        expect(stored()).toBe('Hindi ');
        expect(label()).toHaveValue('Hindi ');
        fireEvent.change(label(), { target: { value: 'Hindi (हिन्दी)' } });
        expect(label()).toHaveValue('Hindi (हिन्दी)');

        fireEvent.change(label(), { target: { value: '' } });
        expect(stored()).toBe('');
        expect(label()).toHaveValue('');
        // Editing one label never rewrites another.
        expect(state().config!.globalSettings.i18n!.locales![0]).toEqual({ code: 'en', label: 'EN' });
    });

    it('renders for a site without languages, with the visitor switch locked until a second language exists', () => {
        useEditorStore.getState().setConfig({ pages: [], globalSettings: {} } as never);
        state().selectGlobalSettings();
        render(<PropertyPanel />);
        expect(screen.getByText('Languages')).toBeInTheDocument();
        expect(
            screen.getByRole('switch', { name: 'Show the language switch to visitors' })
        ).toBeDisabled();
    });
});

describe('EditingLanguageToggle', () => {
    it('is hidden until the site offers two languages', () => {
        const { container } = render(
            <EditingLanguageToggle
                i18n={{ locales: [{ code: 'en', label: 'EN' }] }}
                editingLocale={null}
                onChange={vi.fn()}
            />
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('switches between the base language (null) and another one', () => {
        const onChange = vi.fn();
        render(
            <EditingLanguageToggle
                i18n={{ locales: LOCALES }}
                editingLocale={null}
                onChange={onChange}
            />
        );
        expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        fireEvent.click(screen.getByRole('button', { name: 'हिन्दी' }));
        expect(onChange).toHaveBeenLastCalledWith('hi');
        fireEvent.click(screen.getByRole('button', { name: 'English' }));
        expect(onChange).toHaveBeenLastCalledWith(null);
    });
});

describe('LocalizedEditingBar', () => {
    it('explains a refused edit in terms of the base language', () => {
        useLocalizedEditNotice.getState().show('emptySource');
        render(
            <LocalizedEditingBar
                i18n={{ locales: LOCALES }}
                locale="hi"
                globalSettingsSelected={false}
            />
        );
        expect(screen.getByRole('alert')).toHaveTextContent('Add the English text first');
    });
});
