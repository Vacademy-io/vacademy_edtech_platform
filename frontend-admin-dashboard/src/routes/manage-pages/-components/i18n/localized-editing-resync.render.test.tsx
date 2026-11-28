import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PropertyPanel } from '../PropertyPanel';
import { useEditorStore } from '../../-stores/editor-store';
import {
    useLocalizedEditNotice,
    useLocalizedPanelKey,
} from '../../-hooks/use-localized-editing';

/**
 * A refused edit in another language changes nothing in the store, so an
 * editor that keeps its own draft (the TipTap rich-text box) would go on
 * showing text that was never saved. The editor page keys the property panel
 * with useLocalizedPanelKey, which changes after every refusal: the panel is
 * rebuilt from the stored values.
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
// Stands in for the TipTap box: keeps its own content, takes `value` only when
// it mounts, and reports every change — like the real one when the value it
// is given never changes.
vi.mock('../RichTextField', async () => {
    const { useState } = await import('react');
    return {
        RichTextField: ({
            label,
            value,
            onChange,
        }: {
            label: string;
            value: string;
            onChange: (html: string) => void;
        }) => {
            const [draft, setDraft] = useState(value || '');
            return (
                <textarea
                    aria-label={label}
                    value={draft}
                    onChange={(e) => {
                        setDraft(e.target.value);
                        onChange(e.target.value);
                    }}
                />
            );
        },
    };
});

const load = () => {
    useEditorStore.getState().setConfig({
        pages: [{ id: 'home', route: 'home', title: 'Home', components: [] }],
        globalSettings: {
            layout: {
                footer: {
                    type: 'footer',
                    enabled: true,
                    props: {
                        layout: 'two-column',
                        leftSection: { title: 'Smart Academy', text: '' },
                    },
                },
            },
            i18n: {
                enabled: true,
                defaultLocale: 'en',
                locales: [
                    { code: 'en', label: 'EN' },
                    { code: 'hi', label: 'हिन्दी' },
                ],
                strings: { hi: { 'Smart Academy': 'स्मार्ट अकादमी' } },
            },
        },
    } as never);
    useEditorStore.getState().selectGlobalLayout('footer');
    useEditorStore.getState().setEditingLocale('hi');
};

const footerText = () =>
    useEditorStore.getState().config!.globalSettings.layout!.footer.props.leftSection.text;

/** The editor page's mount: <PropertyPanel key={useLocalizedPanelKey(activeLocale)} />. */
const KeyedPanel = () => <PropertyPanel key={useLocalizedPanelKey('hi')} />;

describe('PropertyPanel — after a refused edit in हिन्दी', () => {
    beforeEach(() => {
        load();
        useLocalizedEditNotice.setState({ notice: null, refusals: 0, lastRefusalAt: 0 });
    });

    it('a rich-text box shows the stored text again, not the unsaved Hindi', () => {
        render(<KeyedPanel />);
        fireEvent.change(screen.getByLabelText('footer.description'), {
            target: { value: '<p>हिंदी विवरण</p>' },
        });
        expect(useLocalizedEditNotice.getState().notice?.reason).toBe('emptySource');
        expect(footerText()).toBe('');
        expect(screen.getByLabelText('footer.description')).toHaveValue('');
    });

    it('without the key the box would keep the unsaved text (why the page keys the panel)', () => {
        render(<PropertyPanel />);
        fireEvent.change(screen.getByLabelText('footer.description'), {
            target: { value: '<p>हिंदी विवरण</p>' },
        });
        expect(footerText()).toBe('');
        expect(screen.getByLabelText('footer.description')).toHaveValue('<p>हिंदी विवरण</p>');
    });

    it('an accepted edit does not rebuild the panel', () => {
        render(<KeyedPanel />);
        const title = screen.getByDisplayValue('स्मार्ट अकादमी');
        fireEvent.change(title, { target: { value: 'स्मार्ट एकेडमी' } });
        expect(useLocalizedEditNotice.getState().refusals).toBe(0);
        // Same input element: nothing was remounted under the admin's cursor.
        expect(screen.getByDisplayValue('स्मार्ट एकेडमी')).toBe(title);
    });
});
