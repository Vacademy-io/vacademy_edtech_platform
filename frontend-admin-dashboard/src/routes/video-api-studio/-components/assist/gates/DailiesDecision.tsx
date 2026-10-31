import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
    ArrowCounterClockwise,
    Check,
    CheckCircle,
    FilmReel,
    WarningCircle,
} from '@phosphor-icons/react';
import type {
    DailiesClip,
    DecisionAnswer,
    DecisionRequest,
} from '../../../-services/video-generation';

interface DailiesDecisionProps {
    decision: DecisionRequest;
    isSubmitting?: boolean;
    onSubmit: (answer: DecisionAnswer) => void;
}

/** Green "QC passed" / amber "QC flagged: …" pill; nothing when QC didn't run. */
function QcBadge({ qc }: { qc: DailiesClip['qc'] }) {
    const { t } = useTranslation('videoApiStudioDailiesDecision');
    if (!qc) return null;
    if (qc.pass) {
        return (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                <CheckCircle weight="fill" className="size-3 shrink-0" />
                {t('qc.passed')}
            </span>
        );
    }
    const firstIssue = qc.issues?.[0];
    return (
        <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
            <WarningCircle weight="fill" className="size-3 shrink-0" />
            <span className="truncate">
                {firstIssue ? t('qc.flaggedWithIssue', { issue: firstIssue }) : t('qc.flagged')}
            </span>
        </span>
    );
}

/**
 * Dailies gate — the post-filming review of every acted dialogue clip, BEFORE
 * the final cut is assembled. Each clip plays inline with its scene brief,
 * spoken lines, and the automated QC verdict; the user approves everything or
 * sends specific clips back for a re-take with a note (re-films are charged
 * like the original take).
 */
export function DailiesDecision({ decision, isSubmitting, onSubmit }: DailiesDecisionProps) {
    const { t } = useTranslation('videoApiStudioDailiesDecision');
    const clips = useMemo<DailiesClip[]>(() => {
        const raw = (decision.payload?.clips as DailiesClip[]) ?? [];
        return Array.isArray(raw) ? raw.filter((c) => c && typeof c.shot_index === 'number') : [];
    }, [decision.payload]);

    // shot_index → re-take note; presence in the map = "redo this clip".
    const [notes, setNotes] = useState<Record<number, string>>({});
    const redoCount = Object.keys(notes).length;
    const hasEmptyNote = Object.values(notes).some((n) => !n.trim());

    const toggle = (idx: number) => {
        setNotes((prev) => {
            const next = { ...prev };
            if (idx in next) delete next[idx];
            else next[idx] = '';
            return next;
        });
    };

    const submit = () => {
        const redos = Object.entries(notes)
            .map(([idx, note]) => ({ shot_index: Number(idx), redo_note: note.trim() }))
            .filter((r) => r.redo_note.length > 0);
        if (redos.length === 0) {
            onSubmit({ kind: 'accept_recommended' });
            return;
        }
        onSubmit({ kind: 'edit', gate_type: 'dailies', clips: redos });
    };

    return (
        <div className="rounded-xl border bg-white shadow-sm dark:bg-card">
            <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold text-foreground">
                <span className="flex size-7 items-center justify-center rounded-md bg-violet-100 dark:bg-violet-900/30">
                    <FilmReel className="size-4 text-violet-600" />
                </span>
                {t('header.title')}
                {clips.length > 0 && (
                    <span className="font-normal text-muted-foreground">
                        {t('header.count', { count: clips.length })}
                    </span>
                )}
            </div>

            {clips.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                    {t('empty')}
                </p>
            ) : (
                <div className="grid max-h-96 gap-3 overflow-y-auto p-4 sm:grid-cols-2">
                    {clips.map((c) => {
                        const selected = c.shot_index in notes;
                        return (
                            <div
                                key={c.shot_index}
                                className={cn(
                                    'overflow-hidden rounded-lg border transition-shadow',
                                    selected && 'border-violet-500 ring-1 ring-violet-500'
                                )}
                            >
                                <video
                                    controls
                                    playsInline
                                    preload="metadata"
                                    src={c.clip_url}
                                    className="max-h-56 w-full rounded-t-lg bg-black"
                                />
                                <div className="space-y-1.5 p-2.5">
                                    <div className="flex items-start justify-between gap-1.5">
                                        <p className="text-xs font-medium text-foreground">
                                            {c.scene_description}
                                        </p>
                                        <Button
                                            variant={selected ? 'secondary' : 'ghost'}
                                            size="sm"
                                            disabled={isSubmitting}
                                            onClick={() => toggle(c.shot_index)}
                                            className="h-6 shrink-0 gap-1 px-1.5 text-xs"
                                        >
                                            <ArrowCounterClockwise className="size-3" />
                                            {selected ? t('clip.keepIt') : t('clip.redo')}
                                        </Button>
                                    </div>
                                    {c.lines ? (
                                        <p className="line-clamp-3 text-xs text-muted-foreground">
                                            “{c.lines}”
                                        </p>
                                    ) : null}
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="text-xs tabular-nums text-muted-foreground">
                                            {t('clip.durationSeconds', {
                                                value: Number(c.duration_s ?? 0).toFixed(1),
                                            })}
                                        </span>
                                        <QcBadge qc={c.qc} />
                                    </div>
                                    {selected && (
                                        <Textarea
                                            value={notes[c.shot_index] ?? ''}
                                            disabled={isSubmitting}
                                            onChange={(e) =>
                                                setNotes((prev) => ({
                                                    ...prev,
                                                    [c.shot_index]: e.target.value,
                                                }))
                                            }
                                            placeholder={t('clip.notePlaceholder')}
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
                    {redoCount > 0
                        ? t('footer.reFilmSummary', { count: redoCount })
                        : t('footer.reTakeNote')}
                </span>
                <Button
                    size="sm"
                    disabled={isSubmitting || (redoCount > 0 && hasEmptyNote)}
                    onClick={submit}
                    className="shrink-0 gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700"
                >
                    <Check className="size-4" />
                    {redoCount > 0
                        ? t('footer.reFilmSubmit', { count: redoCount })
                        : t('footer.approveAll')}
                </Button>
            </div>
        </div>
    );
}
