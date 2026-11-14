import {
    memo,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type KeyboardEvent,
    type RefObject,
} from 'react';
import { useController, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    ArrowDown,
    ArrowUp,
    Copy,
    DotsSixVertical,
    DotsThreeVertical,
    Lightbulb,
    Trash,
    Warning,
    X,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { FLASHCARD_LIMITS, normalizeCardText } from './flashcards-schema';
import { CharCounter, FieldError, useFieldError, type LooseControl } from '../items/item-fields';

export interface FlashcardRowProps {
    control: LooseControl;
    /** `slots.{d}.items.{i}.flashcards.cards` */
    cardsPath: string;
    index: number;
    /** Stable key for drag and drop (the field array's row key, not the card id). */
    sortId: string;
    total: number;
    isActive: boolean;
    /** 1-based number of an earlier card with the same front, or null. */
    duplicateOf: number | null;
    /** Focus the Front field once, right after the row is added. */
    autoFocusFront: boolean;
    canAdd: boolean;
    onFocusCard: (index: number) => void;
    onAutoFocused: () => void;
    onDuplicate: (index: number) => void;
    onRemove: (index: number) => void;
    onMove: (from: number, to: number) => void;
    /** Enter (without Shift) in the last card's Back. */
    onEnterInLastBack: () => void;
}

/** Grow a textarea to fit its text, so a long back never hides behind a scrollbar. */
function useAutoSize(ref: RefObject<HTMLTextAreaElement>, value: string) {
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }, [ref, value]);
}

/**
 * One card of the deck editor: drag handle and number, Front (200) and Back (500)
 * with live counters, an optional Hint (150), and a menu with Duplicate, Move up/down
 * and Remove. Focusing anywhere in the row makes it the card the preview shows.
 */
export const FlashcardRow = memo(function FlashcardRow({
    control,
    cardsPath,
    index,
    sortId,
    total,
    isActive,
    duplicateOf,
    autoFocusFront,
    canAdd,
    onFocusCard,
    onAutoFocused,
    onDuplicate,
    onRemove,
    onMove,
    onEnterInLastBack,
}: FlashcardRowProps) {
    const { t } = useTranslation('engagement');
    const base = `${cardsPath}.${index}`;
    const { field: front } = useController({ control, name: `${base}.front` });
    const { field: back } = useController({ control, name: `${base}.back` });
    const frontError = useFieldError(control, `${base}.front`);
    const backError = useFieldError(control, `${base}.back`);
    const hintError = useFieldError(control, `${base}.hint`);
    // Watched, not controlled: a card saved without a hint has no `hint` key, and
    // registering one would mark an untouched plan dirty.
    const hintWatched: unknown = useWatch({ control, name: `${base}.hint` });
    const idError = useFieldError(control, `${base}.id`);

    const frontValue = typeof front.value === 'string' ? front.value : '';
    const backValue = typeof back.value === 'string' ? back.value : '';
    const hintValue = typeof hintWatched === 'string' ? hintWatched : '';
    const [hintOpen, setHintOpen] = useState(hintValue.trim() !== '');
    const showHint = hintOpen || hintValue.trim() !== '' || Boolean(hintError);

    const frontRef = useRef<HTMLInputElement | null>(null);
    const backRef = useRef<HTMLTextAreaElement | null>(null);
    const [focusHint, setFocusHint] = useState(false);
    useAutoSize(backRef, backValue);

    const uid = useId();
    const frontId = `${uid}-front`;
    const backId = `${uid}-back`;
    const number = index + 1;
    const isLast = index === total - 1;

    const {
        attributes,
        listeners,
        setNodeRef,
        setActivatorNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: sortId });
    const dragStyle = { transform: CSS.Transform.toString(transform), transition };

    useEffect(() => {
        if (!autoFocusFront) return;
        frontRef.current?.focus();
        onAutoFocused();
    }, [autoFocusFront, onAutoFocused]);

    function onBackKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || !isLast) return;
        e.preventDefault();
        onEnterInLastBack();
    }

    const len = (value: string) => normalizeCardText(value).length;

    return (
        <li
            ref={setNodeRef}
            style={dragStyle}
            onFocusCapture={() => onFocusCard(index)}
            aria-label={t('composer.flashcards.cardLabel', { number, total })}
            className={cn(
                'relative flex flex-col gap-3 rounded-lg border bg-card p-3 transition-colors sm:p-4',
                isActive ? 'border-primary-300 ring-1 ring-primary-200' : 'border-neutral-200',
                isDragging && 'z-10 shadow-lg'
            )}
        >
            <div className="flex items-center gap-2">
                <MyButton
                    ref={setActivatorNodeRef}
                    type="button"
                    buttonType="text"
                    layoutVariant="icon"
                    scale="small"
                    aria-label={t('composer.flashcards.dragHandle', { number })}
                    className="cursor-grab touch-none !text-neutral-400 hover:!text-neutral-700 active:cursor-grabbing"
                    {...attributes}
                    {...listeners}
                >
                    <DotsSixVertical size={16} weight="bold" aria-hidden />
                </MyButton>
                <span className="text-caption font-semibold text-neutral-600">
                    {t('composer.flashcards.cardNumber', { number })}
                </span>
                {duplicateOf != null && (
                    <span className="flex min-w-0 items-center gap-1 text-caption text-warning-700">
                        <Warning size={14} className="shrink-0" aria-hidden />
                        <span className="truncate">
                            {t('composer.flashcards.sameFrontAs', { number: duplicateOf })}
                        </span>
                    </span>
                )}
                <div className="ms-auto">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <MyButton
                                type="button"
                                buttonType="text"
                                layoutVariant="icon"
                                scale="small"
                                aria-label={t('composer.flashcards.cardActions', { number })}
                                className="!text-neutral-500 hover:!text-neutral-800"
                            >
                                <DotsThreeVertical size={18} weight="bold" aria-hidden />
                            </MyButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-44">
                            <DropdownMenuItem
                                disabled={!canAdd}
                                onSelect={() => onDuplicate(index)}
                            >
                                <Copy size={16} aria-hidden />{' '}
                                {t('composer.flashcards.duplicateCard')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                disabled={index === 0}
                                onSelect={() => onMove(index, index - 1)}
                            >
                                <ArrowUp size={16} aria-hidden /> {t('composer.flashcards.moveUp')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                disabled={isLast}
                                onSelect={() => onMove(index, index + 1)}
                            >
                                <ArrowDown size={16} aria-hidden />{' '}
                                {t('composer.flashcards.moveDown')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onSelect={() => onRemove(index)}
                                className="text-danger-600 focus:text-danger-600"
                            >
                                <Trash size={16} aria-hidden />{' '}
                                {t('composer.flashcards.removeCard')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Front and back side by side on wide screens, like a term list. */}
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex items-end justify-between gap-2">
                        <Label htmlFor={frontId} className="text-body font-medium text-neutral-700">
                            {t('composer.flashcards.front')}
                        </Label>
                        <CharCounter length={len(frontValue)} max={FLASHCARD_LIMITS.front} />
                    </div>
                    <MyInput
                        id={frontId}
                        ref={(el) => {
                            frontRef.current = el;
                            front.ref(el);
                        }}
                        inputType="text"
                        dir="auto"
                        input={frontValue}
                        onChangeFunction={(e) => front.onChange(e.target.value)}
                        onBlur={front.onBlur}
                        inputPlaceholder={t('composer.flashcards.frontPlaceholder')}
                        aria-invalid={frontError ? true : undefined}
                        aria-describedby={frontError ? `${frontId}-error` : undefined}
                        className={cn('sm:w-full', frontError && 'border-danger-600')}
                    />
                    <FieldError id={`${frontId}-error`} message={frontError} />
                </div>

                <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex items-end justify-between gap-2">
                        <Label htmlFor={backId} className="text-body font-medium text-neutral-700">
                            {t('composer.flashcards.back')}
                        </Label>
                        <CharCounter length={len(backValue)} max={FLASHCARD_LIMITS.back} />
                    </div>
                    <Textarea
                        id={backId}
                        ref={(el) => {
                            backRef.current = el;
                            back.ref(el);
                        }}
                        dir="auto"
                        rows={2}
                        value={backValue}
                        onChange={(e) => back.onChange(e.target.value)}
                        onBlur={back.onBlur}
                        onKeyDown={onBackKeyDown}
                        placeholder={t('composer.flashcards.backPlaceholder')}
                        aria-invalid={backError ? true : undefined}
                        aria-describedby={
                            [isLast ? `${backId}-tip` : null, backError ? `${backId}-error` : null]
                                .filter(Boolean)
                                .join(' ') || undefined
                        }
                        className={cn(
                            'min-h-16 resize-none overflow-hidden border-neutral-300 text-body text-neutral-700',
                            backError && 'border-danger-600'
                        )}
                    />
                    {isLast && (
                        <p id={`${backId}-tip`} className="sr-only">
                            {t('composer.flashcards.enterTip')}
                        </p>
                    )}
                    <FieldError id={`${backId}-error`} message={backError} />
                </div>
            </div>

            {showHint ? (
                <HintField
                    control={control}
                    path={`${base}.hint`}
                    number={number}
                    error={hintError}
                    autoFocus={focusHint}
                    onAutoFocused={() => setFocusHint(false)}
                    onClose={() => setHintOpen(false)}
                />
            ) : (
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="small"
                    onClick={() => {
                        setFocusHint(true);
                        setHintOpen(true);
                    }}
                    className="self-start px-0"
                >
                    <Lightbulb size={14} aria-hidden /> {t('composer.flashcards.addHint')}
                </MyButton>
            )}
            <FieldError message={idError} />
        </li>
    );
});

/** The optional hint, mounted only when shown so an absent hint stays absent. */
function HintField({
    control,
    path,
    number,
    error,
    autoFocus,
    onAutoFocused,
    onClose,
}: {
    control: LooseControl;
    path: string;
    number: number;
    error?: string;
    autoFocus: boolean;
    onAutoFocused: () => void;
    onClose: () => void;
}) {
    const { t } = useTranslation('engagement');
    const { field } = useController({ control, name: path });
    const inputRef = useRef<HTMLInputElement | null>(null);
    const id = useId();
    const value = typeof field.value === 'string' ? field.value : '';

    useEffect(() => {
        if (!autoFocus) return;
        inputRef.current?.focus();
        onAutoFocused();
    }, [autoFocus, onAutoFocused]);

    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-end justify-between gap-2">
                <Label htmlFor={id} className="text-body font-medium text-neutral-700">
                    {t('composer.flashcards.hint')}
                </Label>
                <CharCounter length={normalizeCardText(value).length} max={FLASHCARD_LIMITS.hint} />
            </div>
            <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                    <MyInput
                        id={id}
                        ref={(el) => {
                            inputRef.current = el;
                            field.ref(el);
                        }}
                        inputType="text"
                        dir="auto"
                        input={value}
                        onChangeFunction={(e) => field.onChange(e.target.value)}
                        onBlur={field.onBlur}
                        inputPlaceholder={t('composer.flashcards.hintPlaceholder')}
                        aria-invalid={error ? true : undefined}
                        className={cn('sm:w-full', error && 'border-danger-600')}
                    />
                </div>
                <MyButton
                    type="button"
                    buttonType="text"
                    layoutVariant="icon"
                    scale="medium"
                    aria-label={t('composer.flashcards.removeHint', { number })}
                    onClick={() => {
                        field.onChange('');
                        onClose();
                    }}
                    className="shrink-0 !text-neutral-500 hover:!text-danger-600"
                >
                    <X size={16} aria-hidden />
                </MyButton>
            </div>
            <FieldError message={error} />
        </div>
    );
}
