import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useController, useFieldArray, useWatch, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { Cards, Info, Plus, Shuffle, UploadSimple, Warning } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import type { FlashcardCard } from '../../-types/types';
import type { ComposerForm } from '../forms/composer-schema';
import {
    FLASHCARD_LIMITS,
    estimateFlashcardMinutes,
    frontKey,
    mintCardId,
    newFlashcard,
} from './flashcards-schema';
import { FlashcardRow } from './FlashcardRow';
import { FlashcardsImportDialog, type FlashcardsImportResult } from './FlashcardsImportDialog';
import { FieldError, loose, useFieldError, type ItemPath } from '../items/item-fields';

type CardRow = FlashcardCard & { fieldKey: string };

/**
 * The FLASHCARDS deck editor, working directly on the composer form under
 * `{name}.flashcards` (the composer's zod schema validates the deck with the rest of
 * the plan, so card errors show inline next to the card).
 *
 * - Rows: drag to reorder (or Move up/down from the row menu), Front/Back/Hint with
 *   counters, Duplicate (a new card id) and Remove with an Undo toast.
 * - Fast entry: Enter in the last Back adds a card and focuses its Front.
 * - Footer: Add card, Import (paste a list), the Shuffle switch, "12 cards · ~3 min
 *   for learners", and a non-blocking warning for repeated fronts.
 * - Focusing a card reports its id through `onActiveCardChange`, so the preview can
 *   show that card.
 */
export function FlashcardsEditor({
    control,
    name,
    activeCardId,
    onActiveCardChange,
}: {
    control: Control<ComposerForm>;
    name: ItemPath;
    activeCardId?: string | null;
    onActiveCardChange?: (id: string | null) => void;
}) {
    const { t } = useTranslation('engagement');
    const c = loose(control);
    const cardsPath = `${name}.flashcards.cards`;
    const { fields, append, insert, remove, move, replace } = useFieldArray({
        control: c,
        name: cardsPath,
        keyName: 'fieldKey',
    });
    const rows = fields as unknown as CardRow[];
    const watched = useWatch({ control: c, name: cardsPath }) as FlashcardCard[] | undefined;
    const cards = useMemo(() => watched ?? [], [watched]);
    const completedCount =
        (useWatch({ control: c, name: `${name}.completedCount` }) as number | null | undefined) ??
        0;
    const { field: shuffleField } = useController({
        control: c,
        name: `${name}.flashcards.shuffle`,
    });
    const deckError = useFieldError(c, cardsPath);
    const [importOpen, setImportOpen] = useState(false);
    const [focusCardId, setFocusCardId] = useState<string | null>(null);
    const shuffleId = useId();
    const shuffleHintId = useId();

    // Callbacks read the latest values through a ref so the memoised rows keep stable
    // props and only re-render when their own card changes.
    const latest = useRef({ cards, onActiveCardChange, activeCardId });
    latest.current = { cards, onActiveCardChange, activeCardId };

    const count = rows.length;
    const canAdd = count < FLASHCARD_LIMITS.maxCards;
    const minutes = estimateFlashcardMinutes(count);

    /** For each card whose front repeats an earlier one, the earlier card's number. */
    const duplicateOf = useMemo(() => {
        const firstAt = new Map<string, number>();
        const out = new Map<number, number>();
        cards.forEach((card, index) => {
            const key = frontKey(card?.front ?? '');
            if (!key) return;
            const first = firstAt.get(key);
            if (first === undefined) firstAt.set(key, index);
            else out.set(index, first + 1);
        });
        return out;
    }, [cards]);

    const ids = useCallback(() => latest.current.cards.map((card) => card?.id).filter(Boolean), []);

    const addCard = useCallback(() => {
        if (latest.current.cards.length >= FLASHCARD_LIMITS.maxCards) return;
        const card = newFlashcard(ids());
        append(card, { shouldFocus: false });
        setFocusCardId(card.id);
    }, [append, ids]);

    const duplicateCard = useCallback(
        (index: number) => {
            const source = latest.current.cards[index];
            if (!source || latest.current.cards.length >= FLASHCARD_LIMITS.maxCards) return;
            const copy: FlashcardCard = { ...source, id: mintCardId(ids()) };
            insert(index + 1, copy, { shouldFocus: false });
            setFocusCardId(copy.id);
        },
        [insert, ids]
    );

    const removeCard = useCallback(
        (index: number) => {
            const removed = latest.current.cards[index];
            if (!removed) return;
            remove(index);
            if (latest.current.activeCardId === removed.id) {
                latest.current.onActiveCardChange?.(null);
            }
            toast(t('composer.flashcards.removed', { number: index + 1 }), {
                action: {
                    label: t('composer.flashcards.undo'),
                    onClick: () => {
                        const now = latest.current.cards;
                        const taken = now.map((card) => card?.id).filter(Boolean);
                        const restored = taken.includes(removed.id)
                            ? { ...removed, id: mintCardId(taken) }
                            : removed;
                        insert(Math.min(index, now.length), restored, { shouldFocus: false });
                    },
                },
            });
        },
        [remove, insert, t]
    );

    const moveCard = useCallback(
        (from: number, to: number) => {
            if (to < 0 || to >= latest.current.cards.length) return;
            move(from, to);
        },
        [move]
    );

    const onFocusCard = useCallback((index: number) => {
        const id = latest.current.cards[index]?.id ?? null;
        latest.current.onActiveCardChange?.(id);
    }, []);

    const clearFocus = useCallback(() => setFocusCardId(null), []);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    function onDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const from = rows.findIndex((row) => row.fieldKey === active.id);
        const to = rows.findIndex((row) => row.fieldKey === over.id);
        if (from >= 0 && to >= 0) move(from, to);
    }

    function onImport(result: FlashcardsImportResult) {
        // Filling an empty deck is an add, not a replace, whatever mode the merge used.
        const hadCards = latest.current.cards.some(
            (card) => Boolean(card?.front?.trim()) || Boolean(card?.back?.trim())
        );
        replace(result.cards);
        toast.success(
            result.mode === 'replace' && hadCards
                ? t('composer.flashcards.importedReplace', { count: result.added })
                : t('composer.flashcards.importedAppend', { count: result.added })
        );
    }

    const duplicateCount = duplicateOf.size;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="text-body font-medium text-neutral-700">
                        {t('composer.flashcards.cards')}
                    </span>
                    <span className="text-caption text-neutral-500">
                        {count > 0
                            ? t('composer.flashcards.summary', { count, minutes })
                            : t('composer.flashcards.none')}
                    </span>
                </div>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    onClick={() => setImportOpen(true)}
                >
                    <UploadSimple size={14} aria-hidden /> {t('composer.flashcards.import')}
                </MyButton>
            </div>

            {count === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center">
                    <span className="flex size-12 items-center justify-center rounded-full bg-info-50 text-info-600">
                        <Cards size={24} aria-hidden />
                    </span>
                    <div className="max-w-sm space-y-1">
                        <p className="text-subtitle font-semibold text-neutral-900">
                            {t('composer.flashcards.emptyTitle')}
                        </p>
                        <p className="text-caption text-neutral-500">
                            {t('composer.flashcards.emptyHint')}
                        </p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            onClick={addCard}
                        >
                            <Plus size={16} aria-hidden /> {t('composer.flashcards.addCard')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setImportOpen(true)}
                        >
                            <UploadSimple size={16} aria-hidden />{' '}
                            {t('composer.flashcards.importList')}
                        </MyButton>
                    </div>
                </div>
            ) : (
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                    onDragEnd={onDragEnd}
                >
                    <SortableContext
                        items={rows.map((row) => row.fieldKey)}
                        strategy={verticalListSortingStrategy}
                    >
                        <ol
                            className="flex flex-col gap-2"
                            aria-label={t('composer.flashcards.cards')}
                        >
                            {rows.map((row, index) => {
                                const cardId = cards[index]?.id ?? row.id;
                                return (
                                    <FlashcardRow
                                        key={row.fieldKey}
                                        control={c}
                                        cardsPath={cardsPath}
                                        index={index}
                                        sortId={row.fieldKey}
                                        total={count}
                                        isActive={Boolean(activeCardId) && activeCardId === cardId}
                                        duplicateOf={duplicateOf.get(index) ?? null}
                                        autoFocusFront={focusCardId === cardId}
                                        canAdd={canAdd}
                                        onFocusCard={onFocusCard}
                                        onAutoFocused={clearFocus}
                                        onDuplicate={duplicateCard}
                                        onRemove={removeCard}
                                        onMove={moveCard}
                                        onEnterInLastBack={addCard}
                                    />
                                );
                            })}
                        </ol>
                    </SortableContext>
                </DndContext>
            )}

            <FieldError message={deckError} />

            {duplicateCount > 0 && (
                <p className="flex items-start gap-2 rounded-md bg-warning-50 px-3 py-2 text-caption text-warning-700">
                    <Warning size={16} className="shrink-0" aria-hidden />
                    <span>
                        {t('composer.flashcards.duplicateFrontWarning', { count: duplicateCount })}
                    </span>
                </p>
            )}

            {count > 0 && (
                <div className="flex flex-col gap-3 border-t border-neutral-200 pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            disable={!canAdd}
                            onClick={addCard}
                        >
                            <Plus size={16} aria-hidden /> {t('composer.flashcards.addCard')}
                        </MyButton>
                        {!canAdd && (
                            <span className="text-caption text-neutral-500">
                                {t('composer.flashcards.max', { max: FLASHCARD_LIMITS.maxCards })}
                            </span>
                        )}
                    </div>
                    <div className="flex items-start gap-2">
                        <Switch
                            id={shuffleId}
                            checked={Boolean(shuffleField.value)}
                            onCheckedChange={shuffleField.onChange}
                            aria-describedby={shuffleHintId}
                            className="mt-0.5"
                        />
                        <div className="min-w-0">
                            <Label
                                htmlFor={shuffleId}
                                className="flex items-center gap-1.5 text-body font-medium text-neutral-800"
                            >
                                <Shuffle size={14} aria-hidden /> {t('composer.flashcards.shuffle')}
                            </Label>
                            <p id={shuffleHintId} className="text-caption text-neutral-500">
                                {t('composer.flashcards.shuffleHint')}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            <p className="flex items-start gap-2 text-caption text-neutral-500">
                <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
                <span>{t('composer.flashcards.pointsNote')}</span>
            </p>

            <FlashcardsImportDialog
                open={importOpen}
                onOpenChange={setImportOpen}
                existingCards={cards}
                completedCount={completedCount}
                onImport={onImport}
            />
        </div>
    );
}
