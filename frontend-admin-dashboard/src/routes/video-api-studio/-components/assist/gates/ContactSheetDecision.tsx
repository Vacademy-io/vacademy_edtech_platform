import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { ArrowCounterClockwise, Check, FilmStrip, ImageBroken } from '@phosphor-icons/react';
import type {
    ContactSheetShot,
    DecisionAnswer,
    DecisionRequest,
} from '../../../-services/video-generation';

interface ContactSheetDecisionProps {
    decision: DecisionRequest;
    isSubmitting?: boolean;
    onSubmit: (answer: DecisionAnswer) => void;
}

/**
 * Contact-sheet gate — the pre-finalize frame review. Every shot appears as a
 * card with its real mid-run screenshot (when the vision reviewer captured
 * one). The user approves the sheet, or toggles specific shots to "send back"
 * with a note; sent-back shots regenerate with the note injected into their
 * prompt while everything else stays cached.
 */
export function ContactSheetDecision({ decision, isSubmitting, onSubmit }: ContactSheetDecisionProps) {
    const { t } = useTranslation('videoApiStudioContactSheetDecision');

    const shots = useMemo<ContactSheetShot[]>(() => {
        const raw = (decision.payload?.shots as ContactSheetShot[]) ?? [];
        return Array.isArray(raw) ? raw : [];
    }, [decision.payload]);

    // shot_index → revision note; presence in the map = "send back".
    const [notes, setNotes] = useState<Record<number, string>>({});
    const regenCount = Object.keys(notes).length;

    const toggle = (idx: number) => {
        setNotes((prev) => {
            const next = { ...prev };
            if (idx in next) delete next[idx];
            else next[idx] = '';
            return next;
        });
    };

    const submit = () => {
        const regens = Object.entries(notes)
            .map(([idx, note]) => ({ shot_index: Number(idx), note: note.trim() }))
            .filter((r) => r.note.length > 0);
        if (regens.length === 0) {
            onSubmit({ kind: 'accept_recommended' });
            return;
        }
        onSubmit({ kind: 'edit', gate_type: 'contact_sheet', regens });
    };

    const hasEmptyNote = Object.values(notes).some((n) => !n.trim());

    return (
        <div className="rounded-xl border bg-white shadow-sm dark:bg-card">
            <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold text-foreground">
                <span className="flex size-7 items-center justify-center rounded-md bg-violet-100 dark:bg-violet-900/30">
                    <FilmStrip className="size-4 text-violet-600" />
                </span>
                {t('header.title', { count: shots.length })}
            </div>

            {shots.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                    {t('empty')}
                </p>
            ) : (
                <div className="grid max-h-96 grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3">
                    {shots.map((s) => {
                        const selected = s.shot_index in notes;
                        return (
                            <div
                                key={s.shot_index}
                                className={cn(
                                    'overflow-hidden rounded-lg border transition-shadow',
                                    selected && 'border-violet-500 ring-1 ring-violet-500'
                                )}
                            >
                                {s.thumb_url ? (
                                    <img
                                        src={s.thumb_url}
                                        alt={t('shot.label', { number: s.shot_index + 1 })}
                                        className="aspect-video w-full bg-muted object-cover"
                                        loading="lazy"
                                    />
                                ) : (
                                    <div className="flex aspect-video w-full items-center justify-center bg-muted">
                                        <ImageBroken className="size-6 text-muted-foreground/50" />
                                    </div>
                                )}
                                <div className="space-y-1.5 p-2">
                                    <div className="flex items-center justify-between gap-1">
                                        <span className="text-xs font-medium text-foreground">
                                            {t('shot.label', { number: s.shot_index + 1 })}
                                            {s.shot_type ? (
                                                <span className="ml-1 font-normal text-muted-foreground">
                                                    {t('shot.type', {
                                                        type: s.shot_type.toLowerCase().replace(/_/g, ' '),
                                                    })}
                                                </span>
                                            ) : null}
                                        </span>
                                        <Button
                                            variant={selected ? 'secondary' : 'ghost'}
                                            size="sm"
                                            disabled={isSubmitting}
                                            onClick={() => toggle(s.shot_index)}
                                            className="h-6 gap-1 px-1.5 text-xs"
                                        >
                                            <ArrowCounterClockwise className="size-3" />
                                            {selected ? t('shot.keepIt') : t('shot.redo')}
                                        </Button>
                                    </div>
                                    {s.narration_excerpt ? (
                                        <p className="line-clamp-2 text-xs text-muted-foreground">
                                            {s.narration_excerpt}
                                        </p>
                                    ) : null}
                                    {selected && (
                                        <Textarea
                                            value={notes[s.shot_index] ?? ''}
                                            disabled={isSubmitting}
                                            onChange={(e) =>
                                                setNotes((prev) => ({
                                                    ...prev,
                                                    [s.shot_index]: e.target.value,
                                                }))
                                            }
                                            placeholder={t('shot.notePlaceholder')}
                                            className="min-h-14 text-xs"
                                        />
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
                <span className="text-xs text-muted-foreground">
                    {regenCount > 0
                        ? t('footer.regenNote', { count: regenCount })
                        : t('footer.allGood')}
                </span>
                <Button
                    size="sm"
                    disabled={isSubmitting || (regenCount > 0 && hasEmptyNote)}
                    onClick={submit}
                    className="gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700"
                >
                    <Check className="size-4" />
                    {regenCount > 0
                        ? t('footer.submitRedo', { count: regenCount })
                        : t('footer.submitApprove')}
                </Button>
            </div>
        </div>
    );
}
