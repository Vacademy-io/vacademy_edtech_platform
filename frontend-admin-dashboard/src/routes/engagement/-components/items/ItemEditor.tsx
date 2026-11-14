import { useCallback, useId, useMemo, type ReactNode } from 'react';
import {
    get,
    useController,
    useFormContext,
    useWatch,
    type Control,
    type UseFormReturn,
} from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Info } from '@phosphor-icons/react';
import { MyInput } from '@/components/design-system/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { getEngagementSettings } from '@/routes/settings/-services/engagement-settings';
import type { EngagementItemType, QuestionFormat } from '../../-types/types';
import { isFlashcardsAuthoringEnabled } from '../../-utils/type-meta';
import {
    MAX_POINTS,
    TITLE_MAX,
    changeItemType,
    newKey,
    type ComposerForm,
    type ItemForm,
} from '../forms/composer-schema';
import type { FlashcardsDeck } from '../flashcards/flashcards-schema';
import { FlashcardsEditor } from '../flashcards/FlashcardsEditor';
import { CourseContentEditor } from './CourseContentEditor';
import { GameEditor, type LegacyDeckAction } from './GameEditor';
import { PollEditor } from './PollEditor';
import { QuestionEditor } from './QuestionEditor';
import { ReadingEditor } from './ReadingEditor';
import {
    CharCounter,
    FieldBlock,
    loose,
    numberInputValue,
    parseNumberInput,
    splitItemPath,
    useFieldError,
    type ItemPath,
    type LooseControl,
} from './item-fields';

export type { ItemPath } from './item-fields';

export interface ItemEditorProps {
    control: Control<ComposerForm>;
    /** The task to edit: `slots.{day}.items.{task}`. */
    name: ItemPath;
    /** Called when the teacher focuses or clicks into this editor (the preview follows). */
    onActivate?: () => void;
    /** The flashcard the preview shows; that card's row is highlighted. */
    activeCardId?: string | null;
    /** A flashcard row was focused (its id) or the active card was removed (null). */
    onActiveCardChange?: (id: string | null) => void;
    /**
     * Optional (additive to the frozen interface). Replace this whole task, e.g.
     * `useFieldArray(...).update(index, item)`. Used to convert a legacy game deck in
     * place. Without it the editor falls back to the surrounding `<Form>` context.
     */
    onReplaceItem?: (item: ItemForm) => void;
    /**
     * Optional (additive). Insert a task right after this one, e.g.
     * `insert(index + 1, item)`. Used by "Duplicate as flashcards". Without it the editor
     * falls back to the surrounding `<Form>` context.
     */
    onInsertItemAfter?: (item: ItemForm) => void;
    /** Optional (additive). The batch a Course content task picks lessons from. */
    packageSessionId?: string | null;
    className?: string;
}

/** Types whose own "bonus" field is meaningful; everything else earns completion only. */
function bonusKind(
    type: EngagementItemType,
    format: QuestionFormat | undefined
): 'mcq' | 'game' | null {
    if (type === 'QUESTION_OF_DAY' && (format ?? 'MCQ') === 'MCQ') return 'mcq';
    if (type === 'GAME') return 'game';
    return null;
}

function PointsInput({
    control,
    path,
    label,
    hint,
}: {
    control: LooseControl;
    path: string;
    label: string;
    hint?: string;
}) {
    const { field } = useController({ control, name: path });
    const error = useFieldError(control, path);
    return (
        <FieldBlock label={label} hint={hint} error={error}>
            {(a11y) => (
                <MyInput
                    {...a11y}
                    ref={field.ref}
                    inputType="number"
                    inputMode="numeric"
                    min={0}
                    max={MAX_POINTS}
                    step={1}
                    input={String(numberInputValue(field.value))}
                    onChangeFunction={(e) => field.onChange(parseNumberInput(e.target.value))}
                    onBlur={field.onBlur}
                    className={cn('sm:w-full', error && 'border-danger-600')}
                />
            )}
        </FieldBlock>
    );
}

/**
 * The editor for one task, shared by the composer and the AI review: its title, the
 * type's own editor (reading, question, poll, game, course content or flashcards),
 * points and "Required". The type itself is chosen outside (the composer's type chips).
 *
 * It edits the composer form in place under `name`, so validation, dirty state and
 * "go to first error" all come from the surrounding react-hook-form.
 *
 * Per type:
 * - Question: format, prompt, 2–6 options with a labelled "Correct answer" radio
 *   group, explanation, and hide-result; the bonus only for multiple choice.
 * - Poll: prompt and 2–6 choices; no key, bonus or reveal.
 * - Game: required Max score, "Bonus at full score" (only when Settings reward
 *   unverified scores), .html upload and a resizable source editor. An old AI deck
 *   saved as a game is offered in the card editor.
 * - Flashcards: the deck editor. Bonus and hide-result are hidden (the server forces
 *   them off).
 */
export function ItemEditor({
    control,
    name,
    onActivate,
    activeCardId,
    onActiveCardChange,
    onReplaceItem,
    onInsertItemAfter,
    packageSessionId,
    className,
}: ItemEditorProps) {
    const { t } = useTranslation('engagement');
    const c = loose(control);
    // Null outside a <Form> provider; only used as the fallback writer below.
    const formContext = useFormContext<ComposerForm>() as UseFormReturn<ComposerForm> | null;
    const itemType = useWatch({ control: c, name: `${name}.itemType` }) as EngagementItemType;
    const format = useWatch({ control: c, name: `${name}.question.format` }) as
        | QuestionFormat
        | undefined;
    const completedCount =
        (useWatch({ control: c, name: `${name}.completedCount` }) as number | null | undefined) ??
        0;
    const { field: titleField } = useController({ control: c, name: `${name}.title` });
    const { field: requiredField } = useController({ control: c, name: `${name}.isRequired` });
    const titleError = useFieldError(c, `${name}.title`);
    const requiredId = useId();
    const requiredHintId = useId();

    const kind = bonusKind(itemType, format);
    const settingsQuery = useQuery({
        queryKey: ['engagement-settings'],
        queryFn: getEngagementSettings,
        enabled: kind === 'game',
        staleTime: 5 * 60 * 1000,
    });
    const rewardsUnverified = settingsQuery.data?.settings.allowUnverifiedScoreBonus === true;
    const gameBonus = useWatch({ control: c, name: `${name}.correctPoints` }) as number | undefined;
    const showBonus =
        kind === 'mcq' ||
        (kind === 'game' &&
            (rewardsUnverified || (Number.isFinite(gameBonus) && (gameBonus ?? 0) > 0)));

    const readItem = useCallback(
        (): ItemForm | undefined =>
            (formContext?.getValues(name) as ItemForm | undefined) ??
            (get(control._formValues, name) as ItemForm | undefined),
        [formContext, control, name]
    );

    const writeItems = useCallback(
        (edit: (items: ItemForm[], index: number) => ItemForm[]) => {
            if (!formContext) return false;
            const { itemsPath, index } = splitItemPath(name);
            const items = (formContext.getValues(itemsPath as `slots.${number}.items`) ??
                []) as ItemForm[];
            formContext.setValue(itemsPath as `slots.${number}.items`, edit([...items], index), {
                shouldDirty: true,
            });
            return true;
        },
        [formContext, name]
    );

    const canWrite = Boolean(formContext);
    const legacyAction = useMemo<LegacyDeckAction | null>(() => {
        if (itemType !== 'GAME' || !isFlashcardsAuthoringEnabled()) return null;
        const toDeck = (source: ItemForm, deck: FlashcardsDeck): ItemForm => {
            const next = changeItemType(source, 'FLASHCARDS');
            return next.itemType === 'FLASHCARDS' ? { ...next, flashcards: deck } : next;
        };
        if (completedCount > 0) {
            if (!onInsertItemAfter && !canWrite) return null;
            return {
                kind: 'duplicate',
                run: (deck) => {
                    const current = readItem();
                    if (!current) return;
                    // A brand-new task: no id, version, answers or loaded payload.
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { id: _id, origin: _origin, ...rest } = current;
                    const copy = toDeck(
                        {
                            ...rest,
                            key: newKey('task'),
                            version: null,
                            completedCount: null,
                        } as ItemForm,
                        deck
                    );
                    if (onInsertItemAfter) onInsertItemAfter(copy);
                    else
                        writeItems((items, index) => [
                            ...items.slice(0, index + 1),
                            copy,
                            ...items.slice(index + 1),
                        ]);
                    toast.success(t('items.game.duplicated', { count: deck.cards.length }));
                },
            };
        }
        if (!onReplaceItem && !canWrite) return null;
        return {
            kind: 'convert',
            run: (deck) => {
                const current = readItem();
                if (!current) return;
                const converted = toDeck(current, deck);
                if (onReplaceItem) onReplaceItem(converted);
                else
                    writeItems((items, index) =>
                        items.map((item, i) => (i === index ? converted : item))
                    );
                toast.success(t('items.game.converted', { count: deck.cards.length }));
            },
        };
    }, [
        itemType,
        completedCount,
        onInsertItemAfter,
        onReplaceItem,
        canWrite,
        readItem,
        writeItems,
        t,
    ]);

    const titleValue = typeof titleField.value === 'string' ? titleField.value : '';
    const placeholderKey = `items.placeholders.${itemType}`;

    let body: ReactNode;
    switch (itemType) {
        case 'READING_HTML':
        case 'VISUAL_NOTE':
            body = <ReadingEditor control={control} name={name} variant={itemType} />;
            break;
        case 'QUESTION_OF_DAY':
            body = <QuestionEditor control={control} name={name} />;
            break;
        case 'POLL':
            body = <PollEditor control={control} name={name} />;
            break;
        case 'GAME':
            body = <GameEditor control={control} name={name} legacyAction={legacyAction} />;
            break;
        case 'COURSE_SLIDE':
            body = (
                <CourseContentEditor
                    control={control}
                    name={name}
                    packageSessionId={packageSessionId}
                />
            );
            break;
        case 'FLASHCARDS':
            body = (
                <FlashcardsEditor
                    control={control}
                    name={name}
                    activeCardId={activeCardId}
                    onActiveCardChange={onActiveCardChange}
                />
            );
            break;
        default:
            body = (
                <p className="flex items-start gap-2 rounded-md bg-neutral-50 px-3 py-2 text-caption text-neutral-600">
                    <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
                    <span>{t('items.unsupported')}</span>
                </p>
            );
    }

    return (
        <div
            className={cn('flex min-w-0 flex-col gap-5', className)}
            onFocusCapture={onActivate}
            onPointerDownCapture={onActivate}
        >
            <FieldBlock
                label={t('composer.taskTitle')}
                required
                error={titleError}
                aside={<CharCounter length={titleValue.trim().length} max={TITLE_MAX} />}
            >
                {(a11y) => (
                    <MyInput
                        {...a11y}
                        ref={titleField.ref}
                        inputType="text"
                        dir="auto"
                        input={titleValue}
                        onChangeFunction={(e) => titleField.onChange(e.target.value)}
                        onBlur={titleField.onBlur}
                        inputPlaceholder={t(placeholderKey, {
                            defaultValue: t('composer.taskTitlePlaceholder'),
                        })}
                        className={cn('sm:w-full', titleError && 'border-danger-600')}
                    />
                )}
            </FieldBlock>

            {body}

            <fieldset className="flex flex-col gap-3 border-t border-neutral-200 pt-4">
                <legend className="sr-only">{t('items.points.legend')}</legend>
                <div className={cn('grid grid-cols-1 gap-3', showBonus && 'sm:grid-cols-2')}>
                    <PointsInput
                        control={c}
                        path={`${name}.completionPoints`}
                        label={
                            itemType === 'FLASHCARDS'
                                ? t('items.points.finishDeck')
                                : t('composer.completionPoints')
                        }
                    />
                    {showBonus && kind === 'mcq' && (
                        <PointsInput
                            control={c}
                            path={`${name}.correctPoints`}
                            label={t('composer.bonus')}
                            hint={t('items.points.mcqBonusHint')}
                        />
                    )}
                    {showBonus && kind === 'game' && (
                        <PointsInput
                            control={c}
                            path={`${name}.correctPoints`}
                            label={t('items.points.gameBonus')}
                            hint={
                                rewardsUnverified
                                    ? t('items.points.gameBonusHint')
                                    : t('items.points.gameBonusOff')
                            }
                        />
                    )}
                </div>
                {kind === 'game' && !showBonus && (
                    <p className="text-caption text-neutral-500">
                        {t('items.points.gameCompletionOnly')}
                    </p>
                )}

                <div className="flex items-start gap-3">
                    <Switch
                        id={requiredId}
                        checked={Boolean(requiredField.value)}
                        onCheckedChange={requiredField.onChange}
                        aria-describedby={requiredHintId}
                        className="mt-0.5"
                    />
                    <div className="min-w-0 space-y-0.5">
                        <Label
                            htmlFor={requiredId}
                            className="text-body font-medium text-neutral-800"
                        >
                            {t('composer.required')}
                        </Label>
                        <p id={requiredHintId} className="text-caption text-neutral-500">
                            {t('items.requiredHint')}
                        </p>
                    </div>
                </div>
            </fieldset>
        </div>
    );
}
