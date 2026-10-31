import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowsClockwise,
    CaretLeft,
    CaretRight,
    Cards,
    Check,
    Lightbulb,
    Repeat,
    Shuffle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { clsx } from 'clsx';
import { cn } from '@/lib/utils';
import type { FlashcardCard } from '../../-types/types';
import { normalizeCardText } from './flashcards-schema';

/**
 * The learner's flashcard, as the composer is editing it: one card at a time, front
 * first, flipped by a click or Space/Enter (the card is a real button), with
 * "Card 1 of 12", previous/next, and the two rating buttons shown disabled (rating is
 * the learner's, and it never changes points).
 *
 * It follows `activeCardId`: focusing a row in the deck editor brings that card up,
 * front side first. Faces are plain text rendered as text nodes with `dir="auto"`, so
 * `2 < x > 1`, code and Arabic all show exactly as a learner sees them.
 */

export interface FlashcardPreviewProps {
    cards: Pick<FlashcardCard, 'id' | 'front' | 'back' | 'hint'>[];
    /** The card the editor is on; the preview jumps to it (front side). */
    activeCardId?: string | null;
    /** The deck's shuffle setting: learners get a per-learner order. */
    shuffle?: boolean;
    className?: string;
}

export function FlashcardPreview({
    cards,
    activeCardId,
    shuffle,
    className,
}: FlashcardPreviewProps) {
    const { t } = useTranslation('engagement');
    const [index, setIndex] = useState(0);
    const [flipped, setFlipped] = useState(false);
    const [hintShown, setHintShown] = useState(false);
    const total = cards.length;

    // Follow the editor: jump to the active card, front first.
    useEffect(() => {
        if (!activeCardId) return;
        const next = cards.findIndex((card) => card.id === activeCardId);
        if (next >= 0) {
            setIndex(next);
            setFlipped(false);
            setHintShown(false);
        }
        // When the editor moves (or a card is added or removed), not on every keystroke.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeCardId, total]);

    // Keep the index in range when cards are removed.
    useEffect(() => {
        if (index > 0 && index >= total) setIndex(Math.max(0, total - 1));
    }, [index, total]);

    if (total === 0) {
        return (
            <div
                className={cn(
                    'flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center',
                    className
                )}
            >
                <Cards size={28} className="text-neutral-400" aria-hidden="true" />
                <p className="text-body text-neutral-500">{t('preview.flashcards.empty')}</p>
            </div>
        );
    }

    const safeIndex = Math.min(index, total - 1);
    const card = cards[safeIndex]!;
    const front = normalizeCardText(card.front);
    const back = normalizeCardText(card.back);
    const hint = normalizeCardText(card.hint);
    const face = flipped ? back : front;
    const sideLabel = flipped ? t('preview.flashcards.back') : t('preview.flashcards.front');

    const go = (next: number) => {
        setIndex(Math.max(0, Math.min(total - 1, next)));
        setFlipped(false);
        setHintShown(false);
    };

    return (
        <div className={cn('space-y-3', className)}>
            {/* "Card 1 of 12" + segmented progress, as in the learner runner. */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                    <p className="text-caption font-semibold tabular-nums text-neutral-700">
                        {t('preview.flashcards.cardOf', { index: safeIndex + 1, total })}
                    </p>
                    <div className="flex items-center gap-1">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            layoutVariant="icon"
                            scale="medium"
                            disable={safeIndex === 0}
                            onClick={() => go(safeIndex - 1)}
                            aria-label={t('preview.flashcards.prev')}
                            title={t('preview.flashcards.prev')}
                        >
                            <CaretLeft size={16} className="rtl:rotate-180" aria-hidden="true" />
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            layoutVariant="icon"
                            scale="medium"
                            disable={safeIndex >= total - 1}
                            onClick={() => go(safeIndex + 1)}
                            aria-label={t('preview.flashcards.next')}
                            title={t('preview.flashcards.next')}
                        >
                            <CaretRight size={16} className="rtl:rotate-180" aria-hidden="true" />
                        </MyButton>
                    </div>
                </div>
                <div className="flex h-1 gap-0.5" aria-hidden="true">
                    {cards.map((c, i) => (
                        <span
                            key={c.id || i}
                            className={cn(
                                'h-full flex-1 rounded-full',
                                i <= safeIndex ? 'bg-primary-500' : 'bg-neutral-200'
                            )}
                        />
                    ))}
                </div>
            </div>

            {/* The card. A button, so Space/Enter flip it like the learner's. */}
            <button
                type="button"
                onClick={() => setFlipped((f) => !f)}
                aria-label={t('preview.flashcards.flipAria', {
                    index: safeIndex + 1,
                    total,
                    side: sideLabel,
                    text: face || t('preview.flashcards.emptyFace'),
                })}
                className={cn(
                    'group relative flex h-48 w-full flex-col rounded-lg border p-4 text-start shadow-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
                    flipped
                        ? 'border-primary-200 bg-primary-50'
                        : 'border-neutral-200 bg-white hover:border-primary-200'
                )}
            >
                <span
                    // clsx, not cn: tailwind-merge reads text-caption as a colour and drops it.
                    className={clsx(
                        'text-caption font-semibold uppercase tracking-wide',
                        flipped ? 'text-primary-500' : 'text-neutral-500'
                    )}
                >
                    {sideLabel}
                </span>
                <span
                    key={`${safeIndex}-${flipped ? 'b' : 'f'}`}
                    dir="auto"
                    className={clsx(
                        'my-auto block max-h-32 w-full overflow-y-auto whitespace-pre-line break-words text-center',
                        'motion-safe:duration-150 motion-safe:animate-in motion-safe:fade-in-0',
                        flipped
                            ? 'text-body text-neutral-800'
                            : 'text-title font-semibold text-neutral-900',
                        !face && 'font-normal italic text-neutral-400'
                    )}
                >
                    {face || t('preview.flashcards.emptyFace')}
                </span>
                <span className="flex items-center justify-center gap-1 text-caption text-neutral-500">
                    <ArrowsClockwise size={12} aria-hidden="true" />
                    {t('preview.flashcards.flip')}
                </span>
            </button>
            {/* Announces the back when it turns over. */}
            <p className="sr-only" aria-live="polite">
                {flipped ? back : ''}
            </p>

            {hint && !flipped && (
                <div className="flex flex-col items-start gap-1">
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        aria-expanded={hintShown}
                        onClick={() => setHintShown((v) => !v)}
                    >
                        <Lightbulb size={14} aria-hidden="true" />
                        {hintShown
                            ? t('preview.flashcards.hideHint')
                            : t('preview.flashcards.showHint')}
                    </MyButton>
                    {hintShown && (
                        <p
                            dir="auto"
                            className="whitespace-pre-line break-words rounded-md bg-warning-50 px-2.5 py-1.5 text-caption text-warning-700"
                        >
                            {hint}
                        </p>
                    )}
                </div>
            )}

            {/* The learner's rating footer, disabled: rating is theirs, not the teacher's. */}
            <div className="grid grid-cols-2 gap-2">
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    disable
                    className="h-11 w-full"
                >
                    <Repeat size={16} aria-hidden="true" />
                    {t('preview.flashcards.stillLearning')}
                </MyButton>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    disable
                    className="h-11 w-full"
                >
                    <Check size={16} aria-hidden="true" />
                    {t('preview.flashcards.gotIt')}
                </MyButton>
            </div>
            <p className="text-caption text-neutral-500">{t('preview.flashcards.ratingNote')}</p>
            {shuffle && (
                <p className="flex items-center gap-1.5 text-caption text-neutral-500">
                    <Shuffle size={14} className="shrink-0" aria-hidden="true" />
                    {t('preview.flashcards.shuffled')}
                </p>
            )}
        </div>
    );
}
