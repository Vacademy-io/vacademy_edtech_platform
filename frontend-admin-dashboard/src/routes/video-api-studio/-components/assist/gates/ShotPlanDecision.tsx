import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Check, Sparkle, FilmSlate } from '@phosphor-icons/react';
import type {
    DecisionAnswer,
    DecisionRequest,
    ShotPlanRow,
} from '../../../-services/video-generation';

interface ShotPlanDecisionProps {
    decision: DecisionRequest;
    isSubmitting?: boolean;
    onSubmit: (answer: DecisionAnswer) => void;
}

type Row = ShotPlanRow;

const TRANSITIONS = [
    'cut',
    'fade',
    'crossfade',
    'slide_left',
    'slide_up',
    'zoom_in',
    'whip_pan',
    'circle_iris',
    'smash_cut',
    'dip_to_black',
    'dissolve_up',
] as const;
const BACKGROUNDS = ['brand_solid', 'brand_textured', 'brand_gradient', 'media_hero'] as const;

/** Translated label for a transition-style option value. */
const buildTransitionLabel = (t: TFunction, value: (typeof TRANSITIONS)[number]) =>
    t(`transitions.${value}`);

/** Translated label for a background-treatment option value. */
const buildBackgroundLabel = (t: TFunction, value: (typeof BACKGROUNDS)[number]) =>
    t(`backgrounds.${value}`);

const selectCls =
    'h-8 rounded-md border bg-background px-2 text-xs text-foreground outline-none focus:border-violet-500';

const sceneChipCls =
    'inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground';

/** True when this row is an acted (lip-synced dialogue) scene. */
const isActedScene = (r: Row) => (r.shot_type ?? '').toUpperCase() === 'DIALOGUE_SCENE';

/**
 * Shot-plan gate — an editable table of the drafted shots. The user can tweak
 * each shot's type, duration, and brief, then approve; or let the AI keep its
 * plan. Editing any field switches "Approve" to an edit submission.
 */
export function ShotPlanDecision({ decision, isSubmitting, onSubmit }: ShotPlanDecisionProps) {
    const { t } = useTranslation('videoApiStudioShotPlanDecision');
    const initial = useMemo<Row[]>(
        () =>
            (decision.payload?.shots ?? []).map((s, i) => ({
                ...s,
                shot_index: s.shot_index ?? i,
            })),
        [decision.payload?.shots]
    );
    const [rows, setRows] = useState<Row[]>(initial);
    const [dirty, setDirty] = useState(false);

    const update = (idx: number, patch: Partial<Row>) => {
        setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
        setDirty(true);
    };

    const updateDialogueLine = (rowIdx: number, lineIdx: number, line: string) => {
        setRows((prev) =>
            prev.map((r, i) =>
                i === rowIdx
                    ? {
                          ...r,
                          dialogue: (r.dialogue ?? []).map((d, di) =>
                              di === lineIdx ? { ...d, line } : d
                          ),
                      }
                    : r
            )
        );
        setDirty(true);
    };

    const actedCount = rows.filter(isActedScene).length;

    const approve = () => {
        if (dirty) {
            onSubmit({ kind: 'edit', gate_type: 'shot_plan', shots: rows });
        } else {
            onSubmit({ kind: 'accept_recommended' });
        }
    };

    return (
        <div className="rounded-xl border bg-white shadow-sm dark:bg-card">
            <div className="flex items-center gap-2 border-b px-4 py-3">
                <span className="flex size-7 items-center justify-center rounded-md bg-violet-100 dark:bg-violet-900/30">
                    <FilmSlate className="size-4 text-violet-600" />
                </span>
                <div className="text-sm font-semibold text-foreground">
                    {t('header.shotPlan', { count: rows.length })}
                </div>
                <span
                    className={cn(
                        'ml-auto text-xs',
                        actedCount === 0
                            ? 'font-medium text-amber-600'
                            : 'text-muted-foreground'
                    )}
                >
                    {t('header.actedScenes', { count: actedCount })}
                </span>
            </div>

            <div className="max-h-96 divide-y overflow-y-auto">
                {rows.map((r, i) => (
                    <div key={r.shot_index} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
                        <span className="mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
                            {i + 1}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                            <div className="grid gap-2 sm:grid-cols-[140px_90px_1fr]">
                                <Input
                                    value={r.shot_type ?? ''}
                                    disabled={isSubmitting}
                                    onChange={(e) => update(i, { shot_type: e.target.value })}
                                    className="h-8 text-xs"
                                    placeholder={t('row.shotTypePlaceholder')}
                                />
                                <Input
                                    type="number"
                                    value={r.duration_estimate_s ?? r.duration_s ?? ''}
                                    disabled={isSubmitting}
                                    onChange={(e) =>
                                        update(i, { duration_estimate_s: Number(e.target.value) })
                                    }
                                    className="h-8 text-xs"
                                    placeholder={t('row.secondsPlaceholder')}
                                />
                                <Input
                                    value={r.narration_brief ?? ''}
                                    disabled={isSubmitting}
                                    onChange={(e) => update(i, { narration_brief: e.target.value })}
                                    className="h-8 text-xs"
                                    placeholder={t('row.narrationBriefPlaceholder')}
                                />
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <select
                                    value={r.transition_in ?? ''}
                                    disabled={isSubmitting}
                                    onChange={(e) => update(i, { transition_in: e.target.value })}
                                    className={selectCls}
                                    aria-label={t('row.transitionInAriaLabel')}
                                >
                                    <option value="">{t('row.transitionPlaceholder')}</option>
                                    {TRANSITIONS.map((transition) => (
                                        <option key={transition} value={transition}>
                                            {buildTransitionLabel(t, transition)}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    value={r.background_treatment ?? ''}
                                    disabled={isSubmitting}
                                    onChange={(e) =>
                                        update(i, { background_treatment: e.target.value })
                                    }
                                    className={selectCls}
                                    aria-label={t('row.backgroundTreatmentAriaLabel')}
                                >
                                    <option value="">{t('row.backgroundPlaceholder')}</option>
                                    {BACKGROUNDS.map((background) => (
                                        <option key={background} value={background}>
                                            {buildBackgroundLabel(t, background)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {isActedScene(r) && (
                                <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/50 p-2.5 dark:border-violet-900/40 dark:bg-violet-900/10">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                                            <FilmSlate weight="fill" className="size-3" />
                                            {t('row.actedScene')}
                                        </span>
                                        {(r.character_names ?? []).map((name) => (
                                            <span
                                                key={name}
                                                className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
                                            >
                                                {name}
                                            </span>
                                        ))}
                                    </div>
                                    {(r.dialogue ?? []).length > 0 && (
                                        <div className="space-y-1.5">
                                            {(r.dialogue ?? []).map((d, di) => (
                                                <div
                                                    key={di}
                                                    className="flex items-start gap-2"
                                                >
                                                    <span className="mt-1.5 shrink-0 text-xs font-medium text-foreground">
                                                        {d.character}:
                                                    </span>
                                                    <Textarea
                                                        value={d.line}
                                                        disabled={isSubmitting}
                                                        onChange={(e) =>
                                                            updateDialogueLine(
                                                                i,
                                                                di,
                                                                e.target.value
                                                            )
                                                        }
                                                        className="min-h-9 flex-1 text-xs"
                                                        aria-label={t('row.dialogueLineAriaLabel', {
                                                            character: d.character,
                                                        })}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {r.scene_description ? (
                                        <p className="text-xs text-muted-foreground">
                                            {r.scene_description}
                                        </p>
                                    ) : null}
                                    {r.action_description ? (
                                        <p className="text-xs italic text-muted-foreground">
                                            {r.action_description}
                                        </p>
                                    ) : null}
                                    {(r.scene_continuity ||
                                        r.time_of_day ||
                                        r.emotional_beat) && (
                                        <div className="flex flex-wrap gap-1.5">
                                            {r.scene_continuity && (
                                                <span className={sceneChipCls}>
                                                    {r.scene_continuity === 'continuous'
                                                        ? t('row.continuesPreviousScene')
                                                        : t('row.newScene')}
                                                </span>
                                            )}
                                            {r.time_of_day && (
                                                <span className={sceneChipCls}>
                                                    {r.time_of_day}
                                                </span>
                                            )}
                                            {r.emotional_beat && (
                                                <span className={sceneChipCls}>
                                                    {r.emotional_beat}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
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
                    {t('footer.letAiDecide')}
                </Button>
                <Button
                    size="sm"
                    disabled={isSubmitting}
                    onClick={approve}
                    className="gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700"
                >
                    <Check className="size-4" />
                    {dirty ? t('footer.saveAndContinue') : t('footer.approvePlan')}
                </Button>
            </div>
        </div>
    );
}
