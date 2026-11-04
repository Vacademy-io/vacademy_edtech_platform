/**
 * Word cloud of feedback answers for the classroom screen.
 *
 * Replaces components/WordCloudModal.tsx on the panel: its @isoterik/react-word-cloud
 * layout calls `new OffscreenCanvas(1, 1)` unguarded (read in the emitted chunk),
 * which throws on Chrome 66-68 (OffscreenCanvas is Chrome 69). This version is a
 * plain wrapped list of words sized by frequency with design tokens: no canvas,
 * no layout library, and it keeps Hindi (Devanagari) words, which the admin
 * version's /^[a-zA-Z]+$/ filter drops. Word selection otherwise follows
 * WordCloudModal.tsx (≥ 3 characters, ≤ 20, stop words removed, top 40).
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const STOP_WORDS = new Set(
    (
        'the and or but in on at to for of with by is are was were be been being have has had do does did ' +
        'will would could should may might must can this that these those it its they them their there here ' +
        'what which who whom whose when where why how all any both each few more most other some such only ' +
        'own same than too very just also not from into about over after before again then once you your ' +
        'yours our ours his her hers him she he we us me my mine i a an so if as because until while ' +
        'है हैं था थे थी और या का की के को में से पर भी तो ही यह वह ये वे कि जो एक'
    ).split(' ')
);

const SPLIT = /[\s.,!?;:"'“”‘’()[\]{}<>/\\|@#$%^&*+=~`_-]+/;

/** Size + colour buckets, smallest first (tokens only). */
const SIZE_CLASSES = ['text-title', 'text-h3', 'text-h2', 'text-h1', 'text-4xl', 'text-5xl'];
const COLOR_CLASSES = ['text-primary-500', 'text-info-600', 'text-success-600', 'text-neutral-700'];

export interface WordCount {
    text: string;
    value: number;
}

export function countWords(answers: (string | null | undefined)[]): WordCount[] {
    const counts = new Map<string, number>();
    answers.forEach((answer) => {
        if (!answer) return;
        answer
            .toLowerCase()
            .split(SPLIT)
            .forEach((word) => {
                if (word.length < 3 || word.length > 20) return;
                if (/^\d+$/.test(word) || STOP_WORDS.has(word)) return;
                counts.set(word, (counts.get(word) || 0) + 1);
            });
    });
    const list: WordCount[] = [];
    counts.forEach((value, text) => list.push({ text, value }));
    return list.sort((a, b) => b.value - a.value || (a.text < b.text ? -1 : 1)).slice(0, 40);
}

export interface PanelWordCloudProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    answers: (string | null | undefined)[];
}

export function PanelWordCloud({ open, onOpenChange, answers }: PanelWordCloudProps) {
    const { t } = useTranslation('volt');
    const words = useMemo(() => countWords(answers), [answers]);
    const answered = answers.filter((answer) => !!answer && answer.trim()).length;

    // Alphabetical display order reads like a cloud instead of a ranked list.
    const display = useMemo(() => {
        if (words.length === 0) return [];
        const max = words[0]?.value ?? 1;
        const min = words[words.length - 1]?.value ?? 1;
        return words
            .map((word, index) => {
                const ratio = max === min ? 0 : (word.value - min) / (max - min);
                const bucket = Math.round(ratio * (SIZE_CLASSES.length - 1));
                return {
                    ...word,
                    sizeClass: SIZE_CLASSES[bucket] ?? 'text-title',
                    colorClass: COLOR_CLASSES[index % COLOR_CLASSES.length] ?? 'text-neutral-700',
                };
            })
            .sort((a, b) => (a.text < b.text ? -1 : 1));
    }, [words]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-11/12 max-w-6xl p-8">
                <DialogHeader className="space-y-2">
                    <DialogTitle className="flex items-center space-x-3 text-h2 font-semibold text-neutral-800">
                        <Cloud size={36} className="text-primary-500" aria-hidden />
                        <span>{t('responses.wordCloud')}</span>
                    </DialogTitle>
                    <DialogDescription className="text-title text-neutral-500">
                        {t('responses.answeredCount', { count: answered })}
                    </DialogDescription>
                </DialogHeader>
                {display.length === 0 ? (
                    <div className="flex min-h-64 flex-col items-center justify-center space-y-3 text-center">
                        <Cloud size={64} className="text-neutral-400" aria-hidden />
                        <p className="text-h3 text-neutral-500">{t('responses.noWords')}</p>
                    </div>
                ) : (
                    <ul className="flex min-h-64 flex-wrap items-center justify-center py-6 text-center">
                        {display.map((word) => (
                            <li
                                key={word.text}
                                className={cn(
                                    'mx-4 my-2 font-semibold leading-tight',
                                    word.sizeClass,
                                    word.colorClass
                                )}
                                title={t('responses.wordTimes', { count: word.value })}
                            >
                                {word.text}
                            </li>
                        ))}
                    </ul>
                )}
                <DialogFooter>
                    <MyButton
                        buttonType="secondary"
                        scale="large"
                        className="h-16 px-8"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('responses.close')}
                    </MyButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default PanelWordCloud;
