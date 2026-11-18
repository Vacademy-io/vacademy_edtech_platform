import { useMemo, useState } from 'react';
import { useForm, useWatch, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Cards } from '@phosphor-icons/react';
import { FlashcardsEditor } from '@/routes/engagement/-components/flashcards/FlashcardsEditor';
import { FlashcardPreview } from '@/routes/engagement/-components/flashcards/FlashcardPreview';
import {
    flashcardsDeckSchema,
    type FlashcardsDeck,
} from '@/routes/engagement/-components/flashcards/flashcards-schema';
import type { ComposerForm } from '@/routes/engagement/-components/forms/composer-schema';
import type { Slide } from '../../-hooks/use-slides';
import { parseFlashcardsSlideData, serializeFlashcardsSlideData } from './activity-types';
import { storedActivityJson, useSyncActivityDraft } from './use-sync-activity-draft';

/**
 * The daily-engagement deck editor (add, reorder, import, hints, shuffle) hosted in a
 * one-item form, so a course deck and a daily-task deck are authored the same way and
 * stored in the same `flashcards/v1` payload.
 */
const ITEM_PATH = 'slots.0.items.0' as const;

const formSchema = z.object({
    slots: z.array(
        z.object({
            items: z.array(z.object({ flashcards: flashcardsDeckSchema }).passthrough()),
        })
    ),
});

interface DeckForm {
    slots: { items: { flashcards: FlashcardsDeck; completedCount: number }[] }[];
}

export function FlashcardsSlideEditor({
    slide,
    isEditable,
}: {
    slide: Slide;
    isEditable: boolean;
}) {
    const { t } = useTranslation('slideActivity');
    const [initialJson] = useState(() =>
        isEditable
            ? storedActivityJson(slide)
            : slide.document_slide?.published_data || storedActivityJson(slide)
    );
    const form = useForm<DeckForm>({
        defaultValues: {
            slots: [
                {
                    items: [
                        { flashcards: parseFlashcardsSlideData(initialJson), completedCount: 0 },
                    ],
                },
            ],
        },
        resolver: zodResolver(formSchema, undefined, { raw: true }),
        mode: 'onChange',
    });
    const deck = useWatch({ control: form.control, name: `${ITEM_PATH}.flashcards` });
    const json = useMemo(() => serializeFlashcardsSlideData(deck), [deck]);
    const userEdited = form.formState.isDirty;
    useSyncActivityDraft(slide.id, json, userEdited, initialJson);

    const [activeCardId, setActiveCardId] = useState<string | null>(null);
    const filled = deck.cards.filter((c) => c.front.trim() && c.back.trim()).length;

    return (
        <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
            <header className="space-y-1">
                <h2 className="flex items-center gap-2 text-subtitle font-semibold text-neutral-900">
                    <Cards size={20} aria-hidden /> {t('flashcards.title')}
                </h2>
                <p className="text-body text-neutral-600">{t('flashcards.hint')}</p>
                {filled === 0 && (
                    <p className="text-caption text-warning-700">{t('flashcards.empty')}</p>
                )}
            </header>
            <div className="grid gap-6 lg:grid-cols-3">
                <fieldset disabled={!isEditable} className="min-w-0 lg:col-span-2">
                    <FlashcardsEditor
                        control={form.control as unknown as Control<ComposerForm>}
                        name={ITEM_PATH}
                        activeCardId={activeCardId}
                        onActiveCardChange={setActiveCardId}
                    />
                </fieldset>
                <aside className="hidden lg:block">
                    <div className="sticky top-4">
                        <FlashcardPreview
                            cards={deck.cards}
                            activeCardId={activeCardId}
                            shuffle={deck.shuffle}
                        />
                    </div>
                </aside>
            </div>
        </div>
    );
}
