import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Check, Sparkle, MicrophoneStage } from '@phosphor-icons/react';
import type { DecisionAnswer, DecisionRequest } from '../../../-services/video-generation';

interface NarrationDecisionProps {
    decision: DecisionRequest;
    prompt: string;
    isSubmitting?: boolean;
    onSubmit: (answer: DecisionAnswer) => void;
}

interface Row {
    shot_index: number;
    narration_text: string;
}

const WORDS_PER_SECOND = 160 / 60; // ≈160 wpm reading rate

function wordCount(s: string): number {
    return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Narration gate — PER-SHOT editing. v3 reads each shot's narration_text from
 * shot_plan.json (NOT the monolithic script.txt), so edits must be per-shot to
 * actually take effect. Each shot's spoken line is an editable textarea; on
 * approve we send the per-shot narration (the backend writes it back into
 * shot_plan.json) plus a concatenated script for v2 compatibility.
 */
export function NarrationDecision({ decision, isSubmitting, onSubmit }: NarrationDecisionProps) {
    const { t } = useTranslation('videoApiStudioNarrationDecision');
    const initial = useMemo<Row[]>(() => {
        const shots = decision.payload?.shots ?? [];
        if (shots.length > 0) {
            return shots.map((s, i) => ({
                shot_index: s.shot_index ?? i,
                narration_text: s.narration_text ?? '',
            }));
        }
        // Fallback: no per-shot data — single editable block from full_script.
        return [{ shot_index: 0, narration_text: decision.payload?.full_script ?? '' }];
    }, [decision.payload]);

    const [rows, setRows] = useState<Row[]>(initial);
    const [dirty, setDirty] = useState(false);
    // Which hook is active: -1 = the original draft, 0/1 = a variant.
    const [activeHook, setActiveHook] = useState(-1);

    const hookVariants = useMemo(
        () =>
            (decision.payload?.hook_variants ?? []).filter(
                (v): v is { technique: string; text: string } => !!v?.text
            ),
        [decision.payload]
    );
    const originalHook = initial[0]?.narration_text ?? '';

    const update = (idx: number, text: string) => {
        setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, narration_text: text } : r)));
        setDirty(true);
    };

    const pickHook = (variantIdx: number) => {
        const text = variantIdx === -1 ? originalHook : hookVariants[variantIdx]?.text;
        if (text == null) return;
        setActiveHook(variantIdx);
        setRows((prev) => prev.map((r, i) => (i === 0 ? { ...r, narration_text: text } : r)));
        setDirty(variantIdx !== -1);
    };

    const totalWords = rows.reduce((n, r) => n + wordCount(r.narration_text), 0);
    const estSeconds = Math.round(totalWords / WORDS_PER_SECOND);

    const approve = () => {
        // Compare against the initial draft rather than trusting the dirty
        // flag alone — picking the "Draft" hook chip resets `dirty`, which
        // must not discard edits the user made to OTHER shots' lines.
        const actuallyChanged =
            dirty ||
            rows.some(
                (r, i) => r.narration_text !== (initial[i]?.narration_text ?? '')
            );
        if (!actuallyChanged) {
            onSubmit({ kind: 'accept_recommended' });
            return;
        }
        const modified_script = rows
            .map((r) => r.narration_text.trim())
            .filter(Boolean)
            .join(' ');
        onSubmit({
            kind: 'edit',
            gate_type: 'narration',
            modified_script,
            shots: rows.map((r) => ({ shot_index: r.shot_index, narration_text: r.narration_text })),
        });
    };

    return (
        <div className="rounded-xl border bg-white shadow-sm dark:bg-card">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="flex size-7 items-center justify-center rounded-md bg-violet-100 dark:bg-violet-900/30">
                        <MicrophoneStage className="size-4 text-violet-600" />
                    </span>
                    {t('header.title', { count: rows.length })}
                </div>
                <div className="text-xs text-muted-foreground">
                    {t('header.wordsEstimate', { count: totalWords, seconds: estSeconds })}
                </div>
            </div>

            {hookVariants.length > 0 && (
                <div className="space-y-1.5 border-b bg-violet-50/50 px-4 py-2.5 dark:bg-violet-950/20">
                    <p className="text-xs font-medium text-muted-foreground">
                        {t('hooks.pickLabel')}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        <button
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => pickHook(-1)}
                            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                                activeHook === -1
                                    ? 'border-violet-500 bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            {t('hooks.draft')}
                        </button>
                        {hookVariants.map((v, i) => (
                            <button
                                key={i}
                                type="button"
                                disabled={isSubmitting}
                                title={v.text}
                                onClick={() => pickHook(i)}
                                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                                    activeHook === i
                                        ? 'border-violet-500 bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {v.technique.replace(/_/g, ' ')}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="max-h-96 divide-y overflow-y-auto">
                {rows.map((r, i) => (
                    <div key={r.shot_index} className="flex gap-3 px-4 py-3">
                        <span className="mt-1.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
                            {i + 1}
                        </span>
                        <Textarea
                            value={r.narration_text}
                            disabled={isSubmitting}
                            onChange={(e) => update(i, e.target.value)}
                            rows={2}
                            className="min-h-0 resize-y text-sm leading-relaxed"
                            placeholder={t('shot.placeholder')}
                        />
                    </div>
                ))}
            </div>

            <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={isSubmitting}
                    onClick={() => onSubmit({ kind: 'auto' })}
                    className="gap-1.5 text-muted-foreground"
                >
                    <Sparkle className="size-3.5" />
                    {t('actions.letAiDecide')}
                </Button>
                <Button
                    size="sm"
                    disabled={isSubmitting}
                    onClick={approve}
                    className="gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700"
                >
                    <Check className="size-4" />
                    {dirty ? t('actions.saveAndContinue') : t('actions.approveAndContinue')}
                </Button>
            </div>
        </div>
    );
}
