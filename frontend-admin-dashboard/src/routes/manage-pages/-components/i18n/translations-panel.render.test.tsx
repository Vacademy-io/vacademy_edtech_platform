import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEditorStore } from '../../-stores/editor-store';
import { TranslationsPanel } from './TranslationsPanel';

/**
 * Global Settings → Languages → Translations: every page text of the site for
 * one language, edited inline, kept "same as English", or translated with AI
 * in batches — writing only the dictionary, never the English page texts.
 */

const translateSiteStrings = vi.fn();

vi.mock('../../-services/ai-page-service', () => ({
    translateSiteStrings: (...args: unknown[]) => translateSiteStrings(...args),
}));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
/** What every live query (courses, folders, product pages) returns; a test may make them fail. */
let liveQuery = { data: [] as unknown[], isLoading: false, isError: false };
vi.mock('@tanstack/react-query', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useQuery: () => ({ ...liveQuery, refetch: vi.fn() }),
}));

const load = (hi: Record<string, string> = {}) =>
    useEditorStore.getState().setConfig({
        pages: [
            {
                id: 'home',
                route: 'home',
                components: [
                    {
                        id: 'h',
                        type: 'heroSection',
                        enabled: true,
                        props: {
                            title: 'Learn the Indian way',
                            subtitle: 'NEET',
                            buttonText: 'Join now',
                        },
                    },
                ],
            },
        ],
        globalSettings: {
            i18n: {
                enabled: true,
                defaultLocale: 'en',
                locales: [
                    { code: 'en', label: 'EN' },
                    { code: 'hi', label: 'हिन्दी' },
                ],
                strings: { hi },
            },
        },
    } as never);

const hi = () => useEditorStore.getState().config!.globalSettings.i18n!.strings!.hi!;
const base = () => useEditorStore.getState().config!.pages[0]!.components[0]!.props;

const aiResult = (translations: Record<string, string>) => ({
    translations,
    failed: [],
    tm_hits: 0,
    run_id: 'r1',
    model: 'm',
    warnings: [],
});

/** An AI request still in flight, settled by the test. */
const inFlight = () => {
    let resolve!: (value: ReturnType<typeof aiResult>) => void;
    const promise = new Promise<ReturnType<typeof aiResult>>((r) => (resolve = r));
    return { promise, resolve };
};

/** Settles a request and lets the batch loop run on to its next step. */
const settle = (land: () => void) =>
    act(async () => {
        land();
        await new Promise((r) => setTimeout(r, 0));
    });

/** Long enough to travel alone, so site A's run has two batches: this text, then NEET + Join now. */
const LONG = 'A long story about our school and its teachers. '.repeat(70);

const loadWithLongText = () => {
    load({ 'Learn the Indian way': 'भारतीय तरीके से सीखें' });
    useEditorStore.getState().updateComponent('home', 'h', {
        props: { ...base(), description: LONG },
    });
};

/** What the editor does when the admin opens another site: the same store, a new config. */
const openSiteB = (i18n?: Record<string, unknown>) =>
    act(() =>
        useEditorStore.getState().setConfig({
            pages: [
                {
                    id: 'b-home',
                    route: 'home',
                    components: [
                        { id: 'b', type: 'heroSection', enabled: true, props: { title: 'Site B' } },
                    ],
                },
            ],
            globalSettings: i18n ? { i18n } : {},
        } as never)
    );

describe('TranslationsPanel', () => {
    beforeEach(() => {
        translateSiteStrings.mockReset();
        load({ 'Learn the Indian way': 'भारतीय तरीके से सीखें' });
    });

    it('lists what is missing and saves an inline translation on blur', () => {
        render(<TranslationsPanel open initialLocale="hi" onOpenChange={vi.fn()} />);
        expect(screen.getByText('हिन्दी: 1 of 3 translated · 2 missing')).toBeInTheDocument();
        // Missing only (default): the translated title is not listed.
        expect(screen.queryByText('Learn the Indian way')).not.toBeInTheDocument();
        const boxes = screen.getAllByRole('textbox', { name: 'हिन्दी translation' });
        fireEvent.change(boxes[1]!, { target: { value: 'अभी जुड़ें' } });
        expect(hi()['Join now']).toBeUndefined();
        fireEvent.blur(boxes[1]!);
        expect(hi()['Join now']).toBe('अभी जुड़ें');
        expect(base().buttonText).toBe('Join now');
    });

    it('keeps a brand name the same as English, which counts as translated', () => {
        render(<TranslationsPanel open initialLocale="hi" onOpenChange={vi.fn()} />);
        fireEvent.click(screen.getAllByRole('button', { name: 'Same as English' })[0]!);
        expect(hi().NEET).toBe('NEET');
        expect(screen.getByText('हिन्दी: 2 of 3 translated · 1 missing')).toBeInTheDocument();
    });

    it('translates the missing texts with AI and offers to keep what the AI left unchanged', async () => {
        translateSiteStrings.mockResolvedValue({
            translations: { NEET: 'NEET', 'Join now': 'अभी जुड़ें' },
            failed: [],
            tm_hits: 0,
            run_id: 'r1',
            model: 'm',
            warnings: [],
        });
        render(<TranslationsPanel open initialLocale="hi" onOpenChange={vi.fn()} />);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Translate 2 missing with AI/ }));
        });
        expect(translateSiteStrings).toHaveBeenCalledTimes(1);
        expect(translateSiteStrings.mock.calls[0]![0]).toEqual({
            strings: ['NEET', 'Join now'],
            target_locale: 'hi',
            source_locale: 'en',
        });
        await waitFor(() => expect(hi()['Join now']).toBe('अभी जुड़ें'));
        expect(hi().NEET).toBeUndefined();
        fireEvent.click(screen.getByRole('button', { name: 'Keep them in English' }));
        expect(hi().NEET).toBe('NEET');
        expect(base()).toEqual({
            title: 'Learn the Indian way',
            subtitle: 'NEET',
            buttonText: 'Join now',
        });
    });

    it('shows the server reason when the AI call fails (e.g. no credits) and stops', async () => {
        translateSiteStrings.mockRejectedValue({
            response: {
                data: { detail: 'Insufficient credits: needs ~1 credits but the balance is 0.' },
            },
        });
        render(<TranslationsPanel open initialLocale="hi" onOpenChange={vi.fn()} />);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Translate 2 missing with AI/ }));
        });
        expect(await screen.findByText(/Insufficient credits/)).toBeInTheDocument();
        expect(hi()).toEqual({ 'Learn the Indian way': 'भारतीय तरीके से सीखें' });
    });

    it('keeps writing every batch while the admin edits the same site', async () => {
        loadWithLongText();
        const first = inFlight();
        translateSiteStrings
            .mockReturnValueOnce(first.promise)
            .mockResolvedValueOnce(aiResult({ NEET: 'नीट', 'Join now': 'अभी जुड़ें' }));
        render(<TranslationsPanel open initialLocale="hi" onOpenChange={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /Translate 3 missing with AI/ }));
        // An ordinary edit while the first batch runs: still the same site.
        act(() =>
            useEditorStore.getState().updateComponent('home', 'h', { props: { ...base(), layout: 'centered' } })
        );
        await settle(() => first.resolve(aiResult({ [LONG]: 'हमारे स्कूल की कहानी' })));
        await waitFor(() => expect(hi()['Join now']).toBe('अभी जुड़ें'));
        expect(translateSiteStrings).toHaveBeenCalledTimes(2);
        expect(hi()[LONG]).toBe('हमारे स्कूल की कहानी');
        expect(hi().NEET).toBe('नीट');
    });

    it('drops a batch that lands after another site was opened, and sends no more', async () => {
        loadWithLongText();
        const first = inFlight();
        translateSiteStrings
            .mockReturnValueOnce(first.promise)
            .mockResolvedValue(aiResult({ NEET: 'नीट', 'Join now': 'अभी जुड़ें' }));
        render(<TranslationsPanel open initialLocale="hi" onOpenChange={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /Translate 3 missing with AI/ }));
        expect(translateSiteStrings.mock.calls[0]![0].strings).toEqual([LONG]);
        // Browser Back, then site B, while site A's first batch is still running.
        openSiteB();
        await settle(() => first.resolve(aiResult({ [LONG]: 'हमारे स्कूल की कहानी' })));
        // Site B gets no i18n block and no edit (the autosave would have saved it as a draft).
        expect(useEditorStore.getState().config!.globalSettings).toEqual({});
        expect(useEditorStore.getState().config!.pages[0]!.id).toBe('b-home');
        expect(translateSiteStrings).toHaveBeenCalledTimes(1);
    });

    it('stops sending batches when the dialog goes away without being closed (route change)', async () => {
        loadWithLongText();
        const first = inFlight();
        translateSiteStrings
            .mockReturnValueOnce(first.promise)
            .mockResolvedValue(aiResult({ NEET: 'नीट', 'Join now': 'अभी जुड़ें' }));
        const { unmount } = render(<TranslationsPanel open initialLocale="hi" onOpenChange={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /Translate 3 missing with AI/ }));
        unmount();
        await settle(() => first.resolve(aiResult({ [LONG]: 'हमारे स्कूल की कहानी' })));
        expect(translateSiteStrings).toHaveBeenCalledTimes(1);
        expect(hi().NEET).toBeUndefined();
    });

    it('drops a row’s AI translation that lands after another site was opened', async () => {
        const pending = inFlight();
        translateSiteStrings.mockReturnValueOnce(pending.promise);
        render(<TranslationsPanel open initialLocale="hi" onOpenChange={vi.fn()} />);
        fireEvent.click(screen.getAllByRole('button', { name: 'Translate with AI' })[0]!);
        expect(translateSiteStrings.mock.calls[0]![0].strings).toEqual(['NEET']);
        openSiteB({
            enabled: true,
            defaultLocale: 'en',
            locales: [
                { code: 'en', label: 'EN' },
                { code: 'hi', label: 'हिन्दी' },
            ],
            strings: { hi: {} },
        });
        await settle(() => pending.resolve(aiResult({ NEET: 'नीट' })));
        expect(hi()).toEqual({});
    });
});

describe('TranslationsPanel — where a text is and entries no tab lists', () => {
    beforeEach(() => {
        translateSiteStrings.mockReset();
        liveQuery = { data: [], isLoading: false, isError: false };
        load({ 'Learn the Indian way': 'भारतीय तरीके से सीखें', 'Old banner text': 'पुराना बैनर' });
    });

    it('shows under each page text where it is: page › section › field', () => {
        render(<TranslationsPanel open initialLocale="hi" onOpenChange={vi.fn()} />);
        expect(screen.getByText('home › Hero Section › buttonText')).toBeInTheDocument();
    });

    it('lists a translation no page text uses under Other entries, where Clear deletes it', () => {
        render(<TranslationsPanel open initialLocale="hi" onOpenChange={vi.fn()} />);
        expect(screen.queryByText('Old banner text')).not.toBeInTheDocument();
        fireEvent.mouseDown(screen.getByRole('tab', { name: 'Other entries' }), { button: 0 });
        expect(screen.getByText('Old banner text')).toBeInTheDocument();
        expect(screen.queryByText('Learn the Indian way')).not.toBeInTheDocument();
        expect(screen.queryByRole('switch')).not.toBeInTheDocument();
        const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
        fireEvent.click(screen.getByRole('button', { name: /Clear/ }));
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(hi()['Old banner text']).toBe('पुराना बैनर');
        confirm.mockReturnValueOnce(true);
        fireEvent.click(screen.getByRole('button', { name: /Clear/ }));
        expect(hi()['Old banner text']).toBeUndefined();
        expect(hi()['Learn the Indian way']).toBe('भारतीय तरीके से सीखें');
        confirm.mockRestore();
    });

    it('lists no other entries while live data failed to load: a course translation must not look unused', () => {
        liveQuery = { data: [], isLoading: false, isError: true };
        render(<TranslationsPanel open initialLocale="hi" onOpenChange={vi.fn()} />);
        fireEvent.mouseDown(screen.getByRole('tab', { name: 'Other entries' }), { button: 0 });
        expect(screen.getByText('Some live data could not be loaded.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
        expect(screen.getByText(/listed only after courses, folders and product pages/)).toBeInTheDocument();
        expect(screen.queryByText('Old banner text')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Clear/ })).not.toBeInTheDocument();
    });

    it('keeps the translation of a hidden section out of Other entries', () => {
        act(() =>
            useEditorStore.getState().updateComponent('home', 'h', {
                props: { ...base(), title: 'Old banner text' },
                enabled: false,
            })
        );
        render(<TranslationsPanel open initialLocale="hi" onOpenChange={vi.fn()} />);
        fireEvent.mouseDown(screen.getByRole('tab', { name: 'Other entries' }), { button: 0 });
        expect(screen.queryByText('Old banner text')).not.toBeInTheDocument();
    });
});
