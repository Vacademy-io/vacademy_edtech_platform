import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, Sparkle, Lightbulb } from '@phosphor-icons/react';
import type { DecisionAnswer, DecisionRequest } from '../../../-services/video-generation';

interface CreativeConceptDecisionProps {
    decision: DecisionRequest;
    isSubmitting?: boolean;
    onSubmit: (answer: DecisionAnswer) => void;
}

// Order of the concept fields the planner emits (keys are payload field names, not translated).
const FIELD_KEYS = [
    'controlling_idea',
    'tonal_register',
    'emotional_arc',
    'visual_metaphor',
    'signature_device',
] as const;

// Translated label + hint for the concept fields the planner emits.
const buildFields = (t: TFunction): Array<{ key: string; label: string; hint: string }> =>
    FIELD_KEYS.map((key) => ({
        key,
        label: t(`fields.${key}.label`),
        hint: t(`fields.${key}.hint`),
    }));

/**
 * Creative-direction gate. Shows the AI's creative DNA for the video; the user
 * can approve, edit, or steer. NOTE: the shot structure + narration are already
 * authored against this concept, so edits mainly steer the VISUAL direction
 * (metaphor / signature device) that the per-shot HTML stage still reads.
 */
export function CreativeConceptDecision({ decision, isSubmitting, onSubmit }: CreativeConceptDecisionProps) {
    const { t } = useTranslation('videoApiStudioCreativeConceptDecision');
    const fields = useMemo(() => buildFields(t), [t]);

    const initial = useMemo<Record<string, string>>(() => {
        const c = (decision.payload?.concept as Record<string, unknown>) ?? {};
        const out: Record<string, string> = {};
        for (const key of FIELD_KEYS) out[key] = c[key] != null ? String(c[key]) : '';
        return out;
    }, [decision.payload]);

    const [vals, setVals] = useState<Record<string, string>>(initial);
    const [dirty, setDirty] = useState(false);
    // Which direction card is active: 0 = the AI's draft, 1+ = alternatives.
    const [activeDir, setActiveDir] = useState(0);

    const alternatives = useMemo(
        () =>
            ((decision.payload?.alternatives as Array<Record<string, string>>) ?? []).filter(
                (a) => a && a.controlling_idea
            ),
        [decision.payload]
    );

    const set = (k: string, v: string) => {
        setVals((prev) => ({ ...prev, [k]: v }));
        setDirty(true);
    };

    const pickDirection = (dirIdx: number) => {
        setActiveDir(dirIdx);
        if (dirIdx === 0) {
            setVals(initial);
            setDirty(false);
            return;
        }
        const alt = alternatives[dirIdx - 1];
        if (!alt) return;
        const next: Record<string, string> = {};
        for (const key of FIELD_KEYS) next[key] = alt[key] != null ? String(alt[key]) : '';
        setVals(next);
        setDirty(true);
    };

    const approve = () => {
        if (!dirty) {
            onSubmit({ kind: 'accept_recommended' });
            return;
        }
        onSubmit({ kind: 'edit', gate_type: 'creative_concept', concept: vals });
    };

    return (
        <div className="rounded-xl border bg-white shadow-sm dark:bg-card">
            <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold text-foreground">
                <span className="flex size-7 items-center justify-center rounded-md bg-violet-100 dark:bg-violet-900/30">
                    <Lightbulb className="size-4 text-violet-600" />
                </span>
                {t('header.title')}
            </div>

            {alternatives.length > 0 && (
                <div className="grid gap-2 border-b bg-violet-50/50 p-3 dark:bg-violet-950/20 sm:grid-cols-3">
                    {[
                        {
                            ...Object.fromEntries(FIELD_KEYS.map((key) => [key, initial[key]])),
                            why_this_works: t('directions.draftWhyThisWorks'),
                        },
                        ...alternatives,
                    ].map((dir, i) => (
                        <button
                            key={i}
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => pickDirection(i)}
                            className={`rounded-lg border p-2.5 text-left transition-colors ${
                                activeDir === i
                                    ? 'border-violet-500 bg-white ring-1 ring-violet-500 dark:bg-card'
                                    : 'bg-white/60 hover:border-violet-300 dark:bg-card/60'
                            }`}
                        >
                            <p className="text-xs font-semibold text-foreground">
                                {i === 0
                                    ? t('directions.draftLabel', { letter: 'A' })
                                    : t('directions.label', { letter: String.fromCharCode(65 + i) })}
                                {dir.tonal_register ? (
                                    <span className="ml-1 font-normal text-muted-foreground">
                                        · {String(dir.tonal_register)}
                                    </span>
                                ) : null}
                            </p>
                            <p className="mt-1 line-clamp-2 text-xs text-foreground">
                                {String(dir.controlling_idea ?? '')}
                            </p>
                            {dir.why_this_works ? (
                                <p className="mt-1 line-clamp-2 text-xs italic text-muted-foreground">
                                    {String(dir.why_this_works)}
                                </p>
                            ) : null}
                        </button>
                    ))}
                </div>
            )}

            <div className="space-y-3 p-4">
                {fields.map((f) => (
                    <label key={f.key} className="block">
                        <span className="mb-1 block text-xs font-medium text-muted-foreground">
                            {f.label} <span className="font-normal opacity-60">· {f.hint}</span>
                        </span>
                        <Input
                            value={vals[f.key] ?? ''}
                            disabled={isSubmitting}
                            onChange={(e) => set(f.key, e.target.value)}
                            className="h-8 text-sm"
                            placeholder={f.hint}
                        />
                    </label>
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
                    {dirty ? t('actions.saveAndContinue') : t('actions.approveDirection')}
                </Button>
            </div>
        </div>
    );
}
