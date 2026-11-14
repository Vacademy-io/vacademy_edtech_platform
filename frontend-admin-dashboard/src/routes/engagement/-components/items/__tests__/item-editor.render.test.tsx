import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useEffect, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Form } from '@/components/ui/form';
import {
    itemToForm,
    newComposerForm,
    newItemForm,
    type ComposerForm,
    type ItemForm,
} from '../../forms/composer-schema';
import { ItemEditor } from '../ItemEditor';
import { nextOptionId } from '../QuestionEditor';
import { splitItemPath, errorText } from '../item-fields';
import {
    chapterIdOf,
    chapterNameOf,
    isLearnerVisibleSlide,
    isListedChapter,
    slideKind,
} from '../../CourseSlidePicker';
import { FlashcardsImportDialog } from '../../flashcards/FlashcardsImportDialog';

/**
 * The shared task editor against a real react-hook-form. i18n returns keys, TipTap is
 * a textarea, and the flashcards flag is on, so the legacy-deck conversion is offered.
 */

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, unknown>) =>
            opts && 'count' in opts ? `${key}:${String(opts.count)}` : key,
    }),
    Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/tiptap/TipTapEditor', () => ({
    TipTapEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
        <textarea data-testid="tiptap" value={value} onChange={(e) => onChange(e.target.value)} />
    ),
}));
vi.mock('@tanstack/react-query', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
}));
vi.mock('../../../-utils/type-meta', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    isFlashcardsAuthoringEnabled: () => true,
}));

// MyTable mounts app dialogs that read localStorage, which this environment lacks.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
});

let formRef: UseFormReturn<ComposerForm> | null = null;

function Harness({ item }: { item: ItemForm }) {
    const form = useForm<ComposerForm>({ defaultValues: newComposerForm({ items: [item] }) });
    useEffect(() => {
        formRef = form;
    });
    return (
        <Form {...form}>
            <ItemEditor control={form.control} name="slots.0.items.0" />
        </Form>
    );
}

const current = () => formRef!.getValues('slots.0.items') as ItemForm[];

describe('ItemEditor', () => {
    it('question: a labelled correct-answer group, 2–6 options, removing the key clears it', () => {
        const item = newItemForm('QUESTION_OF_DAY');
        render(<Harness item={item} />);

        const group = screen.getByRole('radiogroup', { name: 'items.question.correctAnswer' });
        expect(within(group).getAllByRole('radio')).toHaveLength(2);

        // Pick B, then remove it: the key must not silently move to another option.
        fireEvent.click(within(group).getAllByRole('radio')[1]!);
        const addButton = screen.getByRole('button', { name: /items.question.addOption/ });
        fireEvent.click(addButton);
        expect(within(group).getAllByRole('radio')).toHaveLength(3);
        const q = () =>
            (current()[0] as Extract<ItemForm, { itemType: 'QUESTION_OF_DAY' }>).question;
        expect(q().correctOptionId).toBe('b');

        // Six is the most a question takes.
        fireEvent.click(addButton);
        fireEvent.click(addButton);
        fireEvent.click(addButton);
        expect(q().options.map((o) => o.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
        expect(addButton).toBeDisabled();
    });

    it('question: removing the keyed option clears the answer key', () => {
        const item = newItemForm('QUESTION_OF_DAY');
        render(<Harness item={item} />);
        const group = screen.getByRole('radiogroup', { name: 'items.question.correctAnswer' });
        fireEvent.click(screen.getByRole('button', { name: /items.question.addOption/ }));
        fireEvent.click(within(group).getAllByRole('radio')[2]!);
        const q = () =>
            (current()[0] as Extract<ItemForm, { itemType: 'QUESTION_OF_DAY' }>).question;
        expect(q().correctOptionId).toBe('c');
        const removeButtons = screen.getAllByRole('button', {
            name: 'items.question.removeOption',
        });
        fireEvent.click(removeButtons[2]!);
        expect(q().options.map((o) => o.id)).toEqual(['a', 'b']);
        expect(q().correctOptionId).toBe('');
        // At the minimum of two, remove is disabled.
        screen
            .getAllByRole('button', { name: 'items.question.removeOption' })
            .forEach((button) => expect(button).toBeDisabled());
    });

    it('question: switching to a written answer clears the MCQ-only bonus and hide-result', () => {
        const item = {
            ...newItemForm('QUESTION_OF_DAY'),
            correctPoints: 20,
            hideResultUntilReveal: true,
        };
        render(<Harness item={item as ItemForm} />);
        expect(screen.getByText('composer.bonus')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('radio', { name: /composer.formats.TEXT/ }));
        expect(current()[0]!.correctPoints).toBe(0);
        expect(current()[0]!.hideResultUntilReveal).toBe(false);
        expect(screen.queryByText('composer.bonus')).not.toBeInTheDocument();
        expect(
            screen.queryByRole('radiogroup', { name: 'items.question.correctAnswer' })
        ).toBeNull();
    });

    it('flashcards: Enter in the last Back adds a card with a fresh id; bonus fields are hidden', () => {
        const item = newItemForm('FLASHCARDS') as Extract<ItemForm, { itemType: 'FLASHCARDS' }>;
        item.flashcards = {
            cards: [{ id: 'c_aaaaaa', front: 'Osmosis', back: '' }],
            shuffle: true,
        };
        render(<Harness item={item} />);

        expect(screen.queryByText('composer.bonus')).not.toBeInTheDocument();
        expect(screen.queryByText('composer.hideResult')).not.toBeInTheDocument();

        const back = screen.getByLabelText('composer.flashcards.back');
        fireEvent.change(back, { target: { value: 'Water moves across a membrane' } });
        fireEvent.keyDown(back, { key: 'Enter' });

        const deck = (current()[0] as typeof item).flashcards;
        expect(deck.cards).toHaveLength(2);
        expect(deck.cards[0]!.back).toBe('Water moves across a membrane');
        expect(deck.cards[1]!.id).toMatch(/^c_[a-z0-9]{6}$/);
        expect(deck.cards[1]!.id).not.toBe('c_aaaaaa');

        // Shift+Enter is a newline, not a new card.
        const backs = screen.getAllByLabelText('composer.flashcards.back');
        fireEvent.keyDown(backs[1]!, { key: 'Enter', shiftKey: true });
        expect((current()[0] as typeof item).flashcards.cards).toHaveLength(2);
    });

    it('flashcards: flags a repeated front without blocking', () => {
        const item = newItemForm('FLASHCARDS') as Extract<ItemForm, { itemType: 'FLASHCARDS' }>;
        item.flashcards = {
            cards: [
                { id: 'c_aaaaaa', front: 'Osmosis', back: 'a' },
                { id: 'c_bbbbbb', front: ' osmosis ', back: 'b' },
            ],
            shuffle: true,
        };
        render(<Harness item={item} />);
        expect(screen.getByText('composer.flashcards.sameFrontAs')).toBeInTheDocument();
        expect(screen.getByText('composer.flashcards.duplicateFrontWarning:1')).toBeInTheDocument();
    });

    it('game: a legacy AI deck with no completions converts to Flashcards in place', () => {
        const html =
            '<html><script>var cards=[{"front":"Impairment","back":"A problem in body function"},' +
            '{"front":"2 &lt; 3","back":"True"}];</script></html>';
        const item = itemToForm({
            id: 'item-1',
            itemType: 'GAME',
            title: 'Flashcards: terms',
            contentHtml: html,
            maxScore: 2,
            completionPoints: 10,
            completedCount: 0,
        });
        render(<Harness item={item} />);

        fireEvent.click(screen.getByRole('button', { name: /items.game.openInCardEditor/ }));
        fireEvent.click(screen.getByRole('button', { name: 'items.game.convertConfirm' }));

        const converted = current()[0] as Extract<ItemForm, { itemType: 'FLASHCARDS' }>;
        expect(converted.itemType).toBe('FLASHCARDS');
        expect(converted.id).toBe('item-1');
        expect(converted.title).toBe('Flashcards: terms');
        expect(converted.flashcards.cards.map((c) => c.front)).toEqual(['Impairment', '2 < 3']);
        expect(converted.correctPoints).toBe(0);
        expect(converted.contentHtml).toBeUndefined();
    });

    it('game: a legacy deck learners finished is duplicated, never converted', () => {
        const html = '<script>var cards=[{"front":"A","back":"B"}];</script>';
        const item = itemToForm({
            id: 'item-2',
            itemType: 'GAME',
            title: 'Deck',
            contentHtml: html,
            maxScore: 1,
            completedCount: 3,
        });
        render(<Harness item={item} />);
        fireEvent.click(screen.getByRole('button', { name: /items.game.duplicateAsFlashcards/ }));
        const items = current();
        expect(items).toHaveLength(2);
        expect(items[0]!.itemType).toBe('GAME');
        expect(items[0]!.id).toBe('item-2');
        expect(items[1]!.itemType).toBe('FLASHCARDS');
        expect(items[1]!.id).toBeUndefined();
        expect(items[1]!.origin).toBeUndefined();
    });

    it('game: max score is labelled required', () => {
        const item = newItemForm('GAME');
        render(<Harness item={item} />);
        expect(screen.getByLabelText(/items.game.maxScore/)).toBeInTheDocument();
    });
});

/** MyTable mounts app dialogs that use mutations, so the import dialog needs a client. */
const withClient = (ui: ReactElement) =>
    render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe('FlashcardsImportDialog', () => {
    const existing = [
        { id: 'c_keep01', front: 'Osmosis', back: 'old' },
        { id: 'c_gone01', front: 'Diffusion', back: 'old' },
    ];

    it('Replace keeps ids for matching fronts and warns when learners studied the deck', async () => {
        const onImport = vi.fn();
        withClient(
            <FlashcardsImportDialog
                open
                onOpenChange={() => {}}
                existingCards={existing}
                completedCount={4}
                onImport={onImport}
            />
        );
        fireEvent.change(screen.getByLabelText('composer.flashcards.importDialog.paste'), {
            target: {
                value: 'Osmosis\tWater across a membrane\nActive transport\tUses ATP\nNo back here',
            },
        });
        expect(screen.queryByText('composer.flashcards.importDialog.replaceWarning')).toBeNull();
        fireEvent.click(screen.getByRole('radio', { name: /importDialog\.replace/ }));
        expect(
            screen.getByText('composer.flashcards.importDialog.replaceWarning')
        ).toBeInTheDocument();
        // The row with no back is listed but skipped.
        expect(
            screen.getByText('composer.flashcards.importDialog.row_missingBack')
        ).toBeInTheDocument();

        fireEvent.click(
            screen.getByRole('button', { name: 'composer.flashcards.importDialog.confirm:2' })
        );
        await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
        const result = onImport.mock.calls[0]![0];
        expect(result.mode).toBe('replace');
        expect(result.cards.map((c: { front: string }) => c.front)).toEqual([
            'Osmosis',
            'Active transport',
        ]);
        expect(result.cards[0].id).toBe('c_keep01');
        expect(result.cards[1].id).not.toBe('c_gone01');
    });

    it('Append adds new ids after the existing cards', async () => {
        const onImport = vi.fn();
        withClient(
            <FlashcardsImportDialog
                open
                onOpenChange={() => {}}
                existingCards={existing}
                completedCount={0}
                onImport={onImport}
            />
        );
        fireEvent.change(screen.getByLabelText('composer.flashcards.importDialog.paste'), {
            target: { value: 'Osmosis - again' },
        });
        fireEvent.click(
            screen.getByRole('button', { name: 'composer.flashcards.importDialog.confirm:1' })
        );
        await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
        const result = onImport.mock.calls[0]![0];
        expect(result.mode).toBe('append');
        expect(result.cards).toHaveLength(3);
        expect(result.cards[2].id).not.toBe('c_keep01');
    });
});

describe('editor helpers', () => {
    it('nextOptionId takes the first free letter', () => {
        expect(nextOptionId([{ id: 'a' }, { id: 'c' }])).toBe('b');
        expect(nextOptionId([])).toBe('a');
    });

    it('splitItemPath finds the task array and index', () => {
        expect(splitItemPath('slots.3.items.12')).toEqual({
            itemsPath: 'slots.3.items',
            index: 12,
        });
    });

    it('errorText reads a message or a field array root', () => {
        expect(errorText({ message: 'k', type: 'custom' })).toBe('k');
        expect(errorText({ root: { message: 'r' } })).toBe('r');
        expect(errorText(undefined)).toBeUndefined();
    });

    it('offers only slides learners can open', () => {
        expect(isLearnerVisibleSlide({ status: 'PUBLISHED' })).toBe(true);
        expect(isLearnerVisibleSlide({ status: 'UNSYNC' })).toBe(true);
        expect(isLearnerVisibleSlide({ status: 'DRAFT' })).toBe(false);
        expect(isLearnerVisibleSlide({ status: 'PENDING_APPROVAL' })).toBe(false);
        expect(isLearnerVisibleSlide({})).toBe(false);
    });

    it('maps slide types to icons', () => {
        expect(slideKind({ source_type: 'DOCUMENT', document_slide: { type: 'PDF' } })).toBe('PDF');
        expect(slideKind({ source_type: 'HTML_VIDEO' })).toBe('VIDEO');
        expect(slideKind({ source_type: 'SOMETHING_NEW' })).toBe('LESSON');
    });

    it('reads chapters in the nested shape the modules-with-chapters API returns', () => {
        const nested = { chapter: { id: 'ch1', chapter_name: 'Cells', status: 'ACTIVE' } };
        expect(chapterIdOf(nested)).toBe('ch1');
        expect(chapterNameOf(nested)).toBe('Cells');
        expect(isListedChapter(nested)).toBe(true);
        expect(chapterIdOf({ chapter_dto: { id: 'ch2' } })).toBe('ch2');
        expect(chapterIdOf({ id: 'ch3', chapter_name: 'Inline' })).toBe('ch3');
        expect(isListedChapter({ chapter: { id: 'ch4', status: 'DELETED' } })).toBe(false);
        expect(isListedChapter({})).toBe(false);
    });
});
