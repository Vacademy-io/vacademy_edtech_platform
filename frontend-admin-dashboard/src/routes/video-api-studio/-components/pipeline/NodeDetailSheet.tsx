import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useEffectiveCreditRatio } from '@/services/ai-credits/use-credit-rate';
import { formatCredits, usdToCredits } from '../../-utils/credits';
import {
    TextAlignLeft,
    Camera,
    Check,
    CheckCircle,
    FilmSlate,
    Clock,
    Copy,
    ArrowSquareOut,
    FilmStrip,
    FileText,
    Stack,
    ListNumbers,
    CircleNotch,
    Microphone,
    MusicNote,
    Pause,
    PencilLine,
    Play,
    Sparkle,
    UserSquare,
    SpeakerHigh,
    SpeakerX,
    MagicWand,
    X,
    XCircle,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import {
    fetchScriptText,
    regenerateFrame,
    updateFrame,
    type VideoStatusUserSelections,
} from '../../-services/video-generation';
import { LatexRenderer } from '../LatexRenderer';
import { useSceneHtml } from './-utils/scenes-html-context';
import { buildNodeLabels, type PipelineNodeId } from './-utils/stage-vocab';
import type {
    NodeSlot,
    NodeState,
    PipelineState,
    ResearchArtifact,
    SceneSlot,
    StoryboardArtifact,
} from './-utils/derive-pipeline-state';

/**
 * What the sheet is currently showing. Stage kinds are singletons; scenes
 * carry their index since there are N of them.
 */
export type DetailTarget = { kind: PipelineNodeId } | { kind: 'scene'; sceneIndex: number };

interface NodeDetailSheetProps {
    /** What to show. `null` → sheet closed. */
    target: DetailTarget | null;
    state: PipelineState;
    onOpenChange: (open: boolean) => void;
    /**
     * Forwarded to deep-link affordances (e.g. SceneDetail's "Edit this
     * scene" button). The editor route accepts it as a search param so
     * authenticated calls — `frame/regenerate`, `frame/update`, render
     * status — work without re-prompting for credentials.
     */
    apiKey?: string;
}

const NODE_ICON: Record<PipelineNodeId, React.ReactNode> = {
    pitch: <Sparkle className="size-4" />,
    research: <ArrowSquareOut className="size-4" />,
    beats: <ListNumbers className="size-4" />,
    screenplay: <FileText className="size-4" />,
    narration: <Microphone className="size-4" />,
    storyboard: <Stack className="size-4" />,
    shotPlanner: <FilmSlate className="size-4" />,
    narrationWriter: <PencilLine className="size-4" />,
    filming: <Camera className="size-4" />,
    talent: <UserSquare className="size-4" />,
    score: <MusicNote className="size-4" />,
    finalCut: <FilmStrip className="size-4" />,
};

export function NodeDetailSheet({ target, state, onOpenChange, apiKey }: NodeDetailSheetProps) {
    const open = target !== null;
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
                {target && <DetailSheetContents target={target} state={state} apiKey={apiKey} />}
            </SheetContent>
        </Sheet>
    );
}

function DetailSheetContents({
    target,
    state,
    apiKey,
}: {
    target: DetailTarget;
    state: PipelineState;
    apiKey?: string;
}) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    if (target.kind === 'scene') {
        const scene = state.scenes[target.sceneIndex];
        const sceneLabel = t('scene.label', {
            index: String(target.sceneIndex + 1).padStart(2, '0'),
        });
        return (
            <>
                <SheetHeader className="space-y-1.5 border-b pb-3">
                    <SheetTitle className="flex items-center gap-2 text-base">
                        <span className="text-muted-foreground">
                            <Camera className="size-4" />
                        </span>
                        {sceneLabel}
                    </SheetTitle>
                    {scene && <SceneStateBadge sceneState={scene.state} />}
                </SheetHeader>
                <div className="mt-4">
                    {scene ? (
                        <SceneDetail scene={scene} state={state} apiKey={apiKey} />
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            {t('scene.dataNotAvailable')}
                        </p>
                    )}
                </div>
                <RunSummaryFooter state={state} />
            </>
        );
    }
    return (
        <>
            <SheetHeader className="space-y-1.5 border-b pb-3">
                <SheetTitle className="flex items-center gap-2 text-base">
                    <span className="text-muted-foreground">{NODE_ICON[target.kind]}</span>
                    {buildNodeLabels(t)[target.kind]}
                </SheetTitle>
                <NodeStateBadge kind={target.kind} state={state} />
            </SheetHeader>
            <div className="mt-4">
                <NodeDetailBody kind={target.kind} state={state} />
            </div>
            <RunSummaryFooter state={state} />
        </>
    );
}

/**
 * Run-wide summary footer shown on every node sheet so the user always
 * has the "what did this whole video cost / where are its files" answer
 * without jumping back to the right rail.
 *
 * Renders four sections (each conditional, but the footer itself is always
 * shown for wrapped runs so the user has *something* useful even when token
 * data is missing on older history-restored runs):
 *   - Tokens (from cumulativeTokens, fall back to legacy tokenUsage)
 *   - Estimated cost
 *   - Elapsed (only present for runs that started in this session)
 *   - Artifact URLs (script / audio / words / timeline / mp4 / videoId)
 */
function RunSummaryFooter({ state }: { state: PipelineState }) {
    const { t } = useTranslation(['videoApiStudioNodeDetailSheet', 'videoApiStudioCredits']);
    // Backend reports cumulative cost in USD; convert to credits via the
    // live rate so all surfaces consistently use the credit denomination.
    const ratio = useEffectiveCreditRatio();
    const cum = state.stats.cumulativeTokens;
    const tokenUsage = state.stats.tokenUsage;
    const totalTokens = cum?.total_tokens ?? tokenUsage?.total_tokens;
    const promptTokens = cum?.prompt_tokens ?? tokenUsage?.prompt_tokens;
    const completionTokens = cum?.completion_tokens ?? tokenUsage?.completion_tokens;
    const cost =
        cum?.estimated_cost_usd ??
        (tokenUsage as { estimated_cost_usd?: number | null } | null | undefined)
            ?.estimated_cost_usd;
    const elapsedMs = state.stats.elapsedMs;
    const imageCount = tokenUsage?.image_count;
    const ttsChars = tokenUsage?.tts_character_count;

    const hasAnyTokenData =
        totalTokens != null ||
        cost != null ||
        elapsedMs != null ||
        imageCount != null ||
        ttsChars != null;

    const artifacts = state.artifactUrls;
    const hasArtifacts =
        !!artifacts.script ||
        !!artifacts.audio ||
        !!artifacts.words ||
        !!artifacts.timeline ||
        !!artifacts.videoMp4;

    return (
        <div className="mt-6 space-y-4 border-t pt-3">
            <section>
                <div className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('runSummary.productionBudget')}
                </div>
                {hasAnyTokenData ? (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                        {totalTokens != null && (
                            <>
                                <span className="text-muted-foreground">
                                    {t('runSummary.totalTokens')}
                                </span>
                                <span className="text-right font-mono tabular-nums text-foreground">
                                    {totalTokens.toLocaleString()}
                                </span>
                            </>
                        )}
                        {promptTokens != null && (
                            <>
                                <span className="text-muted-foreground">
                                    {t('runSummary.promptTokens')}
                                </span>
                                <span className="text-right font-mono tabular-nums text-muted-foreground">
                                    {promptTokens.toLocaleString()}
                                </span>
                            </>
                        )}
                        {completionTokens != null && (
                            <>
                                <span className="text-muted-foreground">
                                    {t('runSummary.completionTokens')}
                                </span>
                                <span className="text-right font-mono tabular-nums text-muted-foreground">
                                    {completionTokens.toLocaleString()}
                                </span>
                            </>
                        )}
                        {imageCount != null && imageCount > 0 && (
                            <>
                                <span className="text-muted-foreground">
                                    {t('runSummary.imagesGenerated')}
                                </span>
                                <span className="text-right font-mono tabular-nums text-foreground">
                                    {imageCount.toLocaleString()}
                                </span>
                            </>
                        )}
                        {ttsChars != null && ttsChars > 0 && (
                            <>
                                <span className="text-muted-foreground">
                                    {t('runSummary.ttsCharacters')}
                                </span>
                                <span className="text-right font-mono tabular-nums text-foreground">
                                    {ttsChars.toLocaleString()}
                                </span>
                            </>
                        )}
                        {cost != null && (
                            <>
                                <span className="text-muted-foreground">
                                    {t('runSummary.estimatedCost')}
                                </span>
                                <span className="text-right font-mono tabular-nums text-foreground">
                                    {formatCredits(usdToCredits(cost, ratio), {
                                        precision: 2,
                                        t,
                                    })}
                                </span>
                            </>
                        )}
                        {elapsedMs != null && elapsedMs > 0 && (
                            <>
                                <span className="text-muted-foreground">
                                    {t('runSummary.elapsed')}
                                </span>
                                <span className="text-right font-mono tabular-nums text-foreground">
                                    {formatElapsed(elapsedMs)}
                                </span>
                            </>
                        )}
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground">{t('runSummary.noTokenData')}</p>
                )}
                <p className="mt-2 text-2xs text-muted-foreground">
                    {t('runSummary.cumulativeNote')}
                </p>
            </section>

            {hasArtifacts && (
                <section>
                    <div className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('runSummary.artifacts')}
                    </div>
                    <div className="space-y-1 text-xs">
                        {artifacts.script && (
                            <ArtifactRow label={t('artifactLabel.script')} url={artifacts.script} />
                        )}
                        {artifacts.audio && (
                            <ArtifactRow
                                label={t('artifactLabel.narration')}
                                url={artifacts.audio}
                            />
                        )}
                        {artifacts.words && (
                            <ArtifactRow
                                label={t('artifactLabel.wordTimings')}
                                url={artifacts.words}
                            />
                        )}
                        {artifacts.timeline && (
                            <ArtifactRow
                                label={t('artifactLabel.timeline')}
                                url={artifacts.timeline}
                            />
                        )}
                        {artifacts.videoMp4 && (
                            <ArtifactRow
                                label={t('artifactLabel.renderedMp4')}
                                url={artifacts.videoMp4}
                            />
                        )}
                    </div>
                </section>
            )}

            <section>
                <div className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('runSummary.run')}
                </div>
                <p className="font-mono text-2xs tabular-nums text-muted-foreground">
                    {state.videoId}
                </p>
            </section>
        </div>
    );
}

function formatElapsed(ms: number): string {
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function buildStateBadge(
    t: TFunction
): Record<NodeState, { label: string; cls: string; icon: React.ReactNode }> {
    return {
        wrapped: {
            label: t('stateBadge.wrapped'),
            cls: 'border-green-200 bg-green-50 text-green-700',
            icon: <CheckCircle className="size-3" />,
        },
        in_production: {
            label: t('stateBadge.inProduction'),
            cls: 'border-blue-200 bg-blue-50 text-blue-700',
            icon: <CircleNotch className="size-3 animate-spin" />,
        },
        scheduled: {
            label: t('stateBadge.scheduled'),
            cls: 'border-gray-200 bg-gray-50 text-gray-700',
            icon: <Clock className="size-3" />,
        },
        cut: {
            label: t('stateBadge.cut'),
            cls: 'border-red-200 bg-red-50 text-red-700',
            icon: <XCircle className="size-3" />,
        },
        reshoot: {
            label: t('stateBadge.reshoot'),
            cls: 'border-amber-200 bg-amber-50 text-amber-700',
            icon: <Clock className="size-3" />,
        },
    };
}

function SceneStateBadge({ sceneState }: { sceneState: NodeState }) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const v = buildStateBadge(t)[sceneState];
    return (
        <Badge variant="outline" className={`h-5 gap-1 ${v.cls}`}>
            {v.icon} {v.label}
        </Badge>
    );
}

function NodeStateBadge({ kind, state }: { kind: PipelineNodeId; state: PipelineState }) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const slot = (state as unknown as Record<string, NodeSlot<unknown>>)[kind];
    if (!slot) return null;
    const v = buildStateBadge(t)[slot.state];
    return (
        <Badge variant="outline" className={`h-5 gap-1 ${v.cls}`}>
            {v.icon} {v.label}
        </Badge>
    );
}

function NodeDetailBody({ kind, state }: { kind: PipelineNodeId; state: PipelineState }) {
    switch (kind) {
        case 'pitch':
            return <PitchDetail state={state} />;
        case 'research':
            return <ResearchDetail state={state} />;
        case 'beats':
            return <BeatsDetail state={state} />;
        case 'screenplay':
            return <ScreenplayDetail state={state} />;
        case 'narration':
            return <NarrationDetail state={state} />;
        case 'storyboard':
            return <StoryboardDetail state={state} />;
        case 'shotPlanner':
            return <ShotPlannerDetail state={state} />;
        case 'narrationWriter':
            return <NarrationWriterDetail state={state} />;
        case 'filming':
            return <FilmingDetail state={state} />;
        case 'talent':
            return <TalentDetail state={state} />;
        case 'score':
            return <ScoreDetail state={state} />;
        case 'finalCut':
            return <FinalCutDetail state={state} />;
    }
}

// ── v3 detail bodies ─────────────────────────────────────────────────────

function ShotPlannerDetail({ state }: { state: PipelineState }) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const slot = state.shotPlanner;
    if (!slot) {
        return (
            <div className="text-sm text-muted-foreground">{t('shotPlanner.legacyRun')}</div>
        );
    }
    if (slot.state === 'scheduled') {
        return (
            <div className="text-sm text-muted-foreground">{t('shotPlanner.awaitingBrief')}</div>
        );
    }
    if (slot.state === 'in_production') {
        return (
            <div className="text-sm text-muted-foreground">{t('shotPlanner.inProduction')}</div>
        );
    }
    if (slot.state === 'cut' || slot.state === 'reshoot') {
        return <p className="text-sm text-red-700">{slot.error}</p>;
    }
    if (slot.state !== 'wrapped') return null;
    const {
        shotCount,
        intrinsicCount,
        narratedCount,
        recurringMotifs,
        intentRoleBreakdown,
        backgroundBreakdown,
    } = slot.data;
    return (
        <div className="space-y-4">
            {/* Summary */}
            <section className="space-y-2">
                <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('shotPlanner.planSummary')}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-md border bg-card p-2 text-center">
                        <div className="text-lg font-semibold tabular-nums text-foreground">
                            {shotCount}
                        </div>
                        <div className="text-2xs text-muted-foreground">
                            {t('shotPlanner.shots')}
                        </div>
                    </div>
                    <div className="rounded-md border bg-card p-2 text-center">
                        <div className="text-lg font-semibold tabular-nums text-green-700">
                            {narratedCount}
                        </div>
                        <div className="text-2xs text-muted-foreground">
                            {t('shotPlanner.narrated')}
                        </div>
                    </div>
                    <div className="rounded-md border bg-card p-2 text-center">
                        <div className="text-lg font-semibold tabular-nums text-amber-700">
                            {intrinsicCount}
                        </div>
                        <div className="text-2xs text-muted-foreground">
                            {t('shotPlanner.intrinsic')}
                        </div>
                    </div>
                </div>
            </section>

            {/* Recurring motifs */}
            <section className="space-y-2">
                <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('shotPlanner.recurringMotifs')}
                </div>
                {recurringMotifs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t('shotPlanner.noMotifs')}</p>
                ) : (
                    <ul className="space-y-1.5">
                        {recurringMotifs.map((m, i) => (
                            <li key={i} className="rounded-md border bg-card p-2 text-xs">
                                <div className="font-medium text-foreground">{m.description}</div>
                                {(m.screenPosition || m.whenVisible) && (
                                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-muted-foreground">
                                        {m.screenPosition && (
                                            <span>
                                                <span className="uppercase tracking-wider">
                                                    {t('shotPlanner.where')}
                                                </span>{' '}
                                                {m.screenPosition}
                                            </span>
                                        )}
                                        {m.whenVisible && (
                                            <span>
                                                <span className="uppercase tracking-wider">
                                                    {t('shotPlanner.when')}
                                                </span>{' '}
                                                {m.whenVisible}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {/* Intent role / background breakdown */}
            {(intentRoleBreakdown || backgroundBreakdown) && (
                <section className="space-y-2">
                    <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('shotPlanner.distribution')}
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                        {intentRoleBreakdown && (
                            <div>
                                <div className="mb-1 text-2xs text-muted-foreground">
                                    {t('shotPlanner.intentRoles')}
                                </div>
                                <ul className="space-y-0.5">
                                    {Object.entries(intentRoleBreakdown).map(([role, n]) => (
                                        <li
                                            key={role}
                                            className="flex items-center justify-between gap-2"
                                        >
                                            <span className="truncate text-foreground">{role}</span>
                                            <span className="font-mono tabular-nums text-muted-foreground">
                                                {n}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {backgroundBreakdown && (
                            <div>
                                <div className="mb-1 text-2xs text-muted-foreground">
                                    {t('shotPlanner.backgrounds')}
                                </div>
                                <ul className="space-y-0.5">
                                    {Object.entries(backgroundBreakdown).map(([bg, n]) => (
                                        <li
                                            key={bg}
                                            className="flex items-center justify-between gap-2"
                                        >
                                            <span className="truncate text-foreground">
                                                {bg.replace(/_/g, ' ')}
                                            </span>
                                            <span className="font-mono tabular-nums text-muted-foreground">
                                                {n}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </section>
            )}

            {/* Per-shot mini-grid */}
            <ShotPlannerShotList state={state} />
        </div>
    );
}

function ShotPlannerShotList({ state }: { state: PipelineState }) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    if (state.scenes.length === 0) return null;
    return (
        <section className="space-y-2">
            <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('shotPlanner.shotGrid', { count: state.scenes.length })}
            </div>
            <ol className="space-y-1">
                {state.scenes.map((s) => (
                    <li
                        key={s.index}
                        className="flex items-start gap-1.5 rounded-md border bg-card p-2 text-2xs"
                    >
                        <span className="font-mono tabular-nums text-muted-foreground">
                            {String(s.index + 1).padStart(2, '0')}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                            <span className="rounded bg-muted px-1 text-2xs font-medium uppercase tracking-wider text-foreground">
                                {s.shotType.replace(/_/g, ' ')}
                            </span>
                            {s.intentRole && (
                                <span className="rounded bg-sky-50 px-1 text-2xs font-medium uppercase tracking-wider text-sky-700">
                                    {s.intentRole}
                                </span>
                            )}
                            {s.backgroundTreatment && (
                                <span className="rounded bg-slate-100 px-1 text-2xs font-medium uppercase tracking-wider text-slate-700">
                                    {s.backgroundTreatment.replace(/_/g, ' ')}
                                </span>
                            )}
                            {s.transitionIn && (
                                <span className="rounded bg-violet-50 px-1 text-2xs font-medium uppercase tracking-wider text-violet-700">
                                    ↗ {s.transitionIn.replace(/_/g, ' ')}
                                </span>
                            )}
                            {s.audioPolicy === 'intrinsic_only' && (
                                <span className="rounded bg-amber-100 px-1 text-2xs font-semibold uppercase tracking-wider text-amber-700">
                                    🔇 INTR
                                </span>
                            )}
                        </div>
                        <span className="ml-auto shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
                            {s.durationS.toFixed(1)}s
                        </span>
                    </li>
                ))}
            </ol>
        </section>
    );
}

function NarrationWriterDetail({ state }: { state: PipelineState }) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const slot = state.narrationWriter;
    if (!slot) {
        return (
            <div className="text-sm text-muted-foreground">
                {t('narrationWriter.legacyRun')}
            </div>
        );
    }
    if (slot.state === 'scheduled') {
        return (
            <p className="text-sm text-muted-foreground">
                {t('narrationWriter.waitingForShotPlan')}
            </p>
        );
    }
    if (slot.state === 'in_production') {
        return (
            <p className="text-sm text-muted-foreground">{t('narrationWriter.inProduction')}</p>
        );
    }
    if (slot.state === 'cut' || slot.state === 'reshoot') {
        return <p className="text-sm text-red-700">{slot.error}</p>;
    }
    if (slot.state !== 'wrapped') return null;
    const {
        totalWords,
        perShotWordCounts,
        skippedIntrinsicCount,
        narrationMp3Url,
        narrationWordsUrl,
    } = slot.data;
    const writtenShots = perShotWordCounts.filter((n) => n > 0).length;
    const avgWords = writtenShots > 0 ? Math.round(totalWords / writtenShots) : 0;
    const maxWords = Math.max(...perShotWordCounts, 1);

    return (
        <div className="space-y-4">
            <section className="space-y-2">
                <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('narrationWriter.authoredCopy')}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-md border bg-card p-2 text-center">
                        <div className="text-lg font-semibold tabular-nums text-foreground">
                            {totalWords}
                        </div>
                        <div className="text-2xs text-muted-foreground">
                            {t('narrationWriter.totalWords')}
                        </div>
                    </div>
                    <div className="rounded-md border bg-card p-2 text-center">
                        <div className="text-lg font-semibold tabular-nums text-foreground">
                            {writtenShots}
                        </div>
                        <div className="text-2xs text-muted-foreground">
                            {t('narrationWriter.shotsVoiced')}
                        </div>
                    </div>
                    <div className="rounded-md border bg-card p-2 text-center">
                        <div className="text-lg font-semibold tabular-nums text-foreground">
                            {avgWords}
                        </div>
                        <div className="text-2xs text-muted-foreground">
                            {t('narrationWriter.avgWordsPerShot')}
                        </div>
                    </div>
                </div>
                {skippedIntrinsicCount > 0 && (
                    <p className="flex items-center gap-1.5 text-2xs text-amber-700">
                        <SpeakerX className="size-3" />
                        {t('narrationWriter.silentShots', { count: skippedIntrinsicCount })}
                    </p>
                )}
            </section>

            <section className="space-y-2">
                <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('narrationWriter.perShotWordCount')}
                </div>
                {perShotWordCounts.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                        {t('narrationWriter.noShotsAuthored')}
                    </p>
                ) : (
                    <ul className="space-y-0.5 text-2xs">
                        {perShotWordCounts.map((n, i) => (
                            <li key={i} className="flex items-center gap-1.5">
                                <span className="w-5 shrink-0 font-mono tabular-nums text-muted-foreground">
                                    {String(i + 1).padStart(2, '0')}
                                </span>
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                                    <div
                                        className={
                                            n === 0 ? 'h-full bg-amber-300' : 'h-full bg-blue-500'
                                        }
                                        style={{
                                            width: `${
                                                n === 0 ? 100 : Math.max(5, (n / maxWords) * 100)
                                            }%`,
                                            opacity: n === 0 ? 0.4 : 1,
                                        }}
                                    />
                                </div>
                                <span className="w-10 shrink-0 text-right font-mono tabular-nums text-muted-foreground">
                                    {n === 0 ? '—' : `${n}w`}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {(narrationMp3Url || narrationWordsUrl) && (
                <section className="space-y-1.5">
                    <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('narrationWriter.masterConcat')}
                    </div>
                    {narrationMp3Url && <ArtifactRow label="narration.mp3" url={narrationMp3Url} />}
                    {narrationWordsUrl && (
                        <ArtifactRow label="narration_raw.json" url={narrationWordsUrl} />
                    )}
                </section>
            )}
        </div>
    );
}

function BeatsDetail({ state }: { state: PipelineState }) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const slot = state.beats;
    if (!slot) {
        return (
            <div className="text-sm text-muted-foreground">{t('beats.noRun')}</div>
        );
    }
    if (slot.state === 'scheduled') {
        return (
            <div className="text-sm text-muted-foreground">{t('beats.notStarted')}</div>
        );
    }
    if (slot.state === 'in_production') {
        return (
            <div className="text-sm text-muted-foreground">{t('beats.inProduction')}</div>
        );
    }
    if (slot.state === 'cut' || slot.state === 'reshoot') {
        return <p className="text-sm text-red-700">{slot.error}</p>;
    }
    if (slot.state !== 'wrapped') return null;
    const beats = slot.data.beats ?? [];
    const count = slot.data.count ?? beats.length;
    return (
        <div className="space-y-3">
            <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('beats.planHeading')}
            </div>
            <p className="text-xs text-muted-foreground">
                {count > 0 ? t('beats.summary', { count }) : t('beats.planLocked')}
                {slot.data.wpm
                    ? t('beats.wpmNote', { wpm: slot.data.wpm.toFixed(0) })
                    : ''}
            </p>
            {beats.length > 0 && (
                <ol className="space-y-2 text-xs">
                    {beats.slice(0, 12).map((b: NonNullable<typeof beats>[number], i: number) => (
                        <li key={i} className="rounded-md border bg-muted/20 px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">
                                    {b.label || t('beats.beatFallbackLabel', { number: i + 1 })}
                                </span>
                                {typeof b.durationEstimateS === 'number' && (
                                    <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                                        ~{b.durationEstimateS.toFixed(1)}s
                                    </span>
                                )}
                            </div>
                            {(b.intentRole || b.visualTypeHint) && (
                                <div className="mt-0.5 text-2xs uppercase tracking-wider text-muted-foreground">
                                    {[b.intentRole, b.visualTypeHint].filter(Boolean).join(' · ')}
                                </div>
                            )}
                            {b.intendedNarration && (
                                <p className="mt-1 line-clamp-2 italic text-foreground/70">
                                    &ldquo;{b.intendedNarration}&rdquo;
                                </p>
                            )}
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
}

// ── Per-node detail bodies ────────────────────────────────────────────────

function PitchDetail({ state }: { state: PipelineState }) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const pitchData = state.pitch.state === 'wrapped' ? state.pitch.data : undefined;
    const sel = pitchData?.userSelections;
    const [showAdvanced, setShowAdvanced] = useState(false);
    const promptText = (pitchData?.prompt ?? state.prompt ?? '').trim();

    return (
        <div className="space-y-4">
            {/* ── Brief ──────────────────────────────────────────────── */}
            <section className="space-y-2">
                <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('pitch.brief')}
                </div>
                <div className="rounded-lg border bg-muted/20 p-4">
                    {promptText ? (
                        <LatexRenderer
                            text={promptText}
                            className="whitespace-pre-wrap text-sm text-foreground"
                        />
                    ) : (
                        <p className="text-sm italic text-muted-foreground">
                            {t('pitch.promptUnavailable')}
                        </p>
                    )}
                </div>
                <p className="text-xs text-muted-foreground">{t('pitch.briefCaption')}</p>
            </section>

            {/* ── Configuration (always shown; falls back to message) ── */}
            <section className="space-y-2">
                <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('pitch.configuration')}
                </div>
                {sel ? (
                    <ConfigGrid
                        rows={[
                            [
                                t('pitch.field.contentType'),
                                formatLabel(sel.content_type ?? state.contentType),
                            ],
                            [t('pitch.field.qualityTier'), formatLabel(sel.quality_tier)],
                            [
                                t('pitch.field.orientation'),
                                formatLabel(sel.orientation ?? state.orientation),
                            ],
                            [t('pitch.field.targetDuration'), sel.target_duration],
                            [t('pitch.field.targetAudience'), sel.target_audience],
                            [t('pitch.field.language'), sel.language],
                            [t('pitch.field.voice'), formatVoice(sel.voice_gender, sel.tts_provider)],
                            [t('pitch.field.voiceId'), sel.voice_id || undefined],
                            [t('pitch.field.captions'), formatBool(t, sel.captions_enabled)],
                            [
                                t('pitch.field.backgroundMusic'),
                                formatBool(t, sel.background_music_enabled),
                            ],
                            [
                                t('pitch.field.soundEffects'),
                                formatBool(t, sel.sound_effects_enabled),
                            ],
                            [t('pitch.field.hostAvatar'), formatHost(t, sel)],
                            [
                                t('pitch.field.referenceFiles'),
                                formatCount(sel.reference_files_count),
                            ],
                            [t('pitch.field.targetStage'), sel.target_stage],
                        ]}
                    />
                ) : (
                    <p className="text-xs text-muted-foreground">
                        {t('pitch.configUnavailable')}
                    </p>
                )}
            </section>

            {/* ── Advanced (collapsible — only when config exists) ───── */}
            {sel && (
                <section className="space-y-2">
                    <button
                        type="button"
                        onClick={() => setShowAdvanced((v) => !v)}
                        className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    >
                        <span>{showAdvanced ? '▾' : '▸'}</span> {t('pitch.advanced')}
                    </button>
                    {showAdvanced && (
                        <ConfigGrid
                            rows={[
                                [t('pitch.field.model'), sel.model],
                                [t('pitch.field.htmlQuality'), formatLabel(sel.html_quality)],
                                [
                                    t('pitch.field.subShotsEnabled'),
                                    formatBool(t, sel.sub_shots_enabled),
                                ],
                                [
                                    t('pitch.field.routingOverrides'),
                                    formatRoutingOverrides(sel.routing_overrides),
                                ],
                                [
                                    t('pitch.field.visualPreferences'),
                                    formatVisualPreferences(sel.visual_preferences),
                                ],
                                [t('pitch.field.avatarImageUrl'), sel.avatar_image_url || undefined],
                                [t('pitch.field.inputVideoIds'), formatList(sel.input_video_ids)],
                                [
                                    t('pitch.field.inputVideoAudio'),
                                    formatLabel(sel.input_video_audio),
                                ],
                                [
                                    t('pitch.field.muteTtsOnSourceClips'),
                                    formatBool(t, sel.mute_tts_on_source_clips_kwarg),
                                ],
                                [
                                    t('pitch.field.backgroundMusicVolume'),
                                    sel.background_music_volume != null
                                        ? sel.background_music_volume.toFixed(2)
                                        : undefined,
                                ],
                            ]}
                            emptyMessage={t('pitch.noAdvancedOverrides')}
                        />
                    )}
                </section>
            )}
        </div>
    );
}

/**
 * Two-column key/value grid. Rows with empty values are auto-omitted —
 * callers list every field unconditionally and `ConfigGrid` decides what
 * actually renders. Keeps Pitch's Configuration block clean across the
 * wide variation in what user_selections actually contains per run.
 */
function ConfigGrid({
    rows,
    emptyMessage,
}: {
    rows: Array<[string, string | undefined | null]>;
    emptyMessage?: string;
}) {
    const filled = rows.filter(([, v]) => v != null && v !== '');
    if (filled.length === 0) {
        return emptyMessage ? (
            <p className="text-xs text-muted-foreground">{emptyMessage}</p>
        ) : null;
    }
    return (
        <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-xs">
            {filled.map(([k, v]) => (
                <Fragment key={k}>
                    <span className="text-muted-foreground">{k}</span>
                    <span className="break-all text-right text-foreground">{v}</span>
                </Fragment>
            ))}
        </div>
    );
}

// ── Formatters for ConfigGrid rows ──────────────────────────────────────
//
// All return `undefined` when there's nothing meaningful to show so the
// grid auto-omits the row. Boolean fields collapse to 'On'/'Off'; snake_case
// strings get prettified to Title Case.

function formatLabel(v: string | undefined | null): string | undefined {
    if (!v) return undefined;
    return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatBool(t: TFunction, v: boolean | undefined | null): string | undefined {
    if (v == null) return undefined;
    return v ? t('format.on') : t('format.off');
}

function formatCount(n: number | undefined | null): string | undefined {
    if (n == null || n === 0) return undefined;
    return n.toString();
}

function formatVoice(gender: string | undefined, provider: string | undefined): string | undefined {
    if (!gender && !provider) return undefined;
    const parts = [gender, provider].filter(Boolean).map((p) => formatLabel(p as string));
    return parts.join(' · ');
}

function formatHost(t: TFunction, sel: VideoStatusUserSelections): string | undefined {
    const generate = sel.generate_avatar;
    const hostType = sel.host?.type;
    if (!generate && !hostType) return t('format.none');
    if (hostType === 'avatar' || generate) {
        const id = (sel.host?.avatar as { saved_avatar_id?: string } | undefined)?.saved_avatar_id;
        return id ? t('format.avatarWithId', { id }) : t('format.avatar');
    }
    if (hostType === 'raw') return t('format.rawClips');
    return formatLabel(hostType);
}

function formatList(arr: string[] | undefined | null): string | undefined {
    if (!arr || arr.length === 0) return undefined;
    return arr.join(', ');
}

function formatRoutingOverrides(o: Record<string, unknown> | null | undefined): string | undefined {
    if (!o) return undefined;
    const tools = (o as { tools?: Record<string, boolean | null> }).tools;
    if (!tools) return JSON.stringify(o);
    const flags = Object.entries(tools)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}=${v ? 'on' : 'off'}`);
    return flags.length ? flags.join(', ') : undefined;
}

function formatVisualPreferences(
    p: Record<string, unknown> | null | undefined
): string | undefined {
    if (!p) return undefined;
    const entries = Object.entries(p).filter(([, v]) => v != null && v !== 'auto');
    if (entries.length === 0) return undefined;
    return entries.map(([k, v]) => `${k}=${String(v)}`).join(', ');
}

function ResearchDetail({ state }: { state: PipelineState }) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const slot = state.research;
    if (!slot) {
        return (
            <p className="text-sm text-muted-foreground">{t('research.notNeeded')}</p>
        );
    }
    if (slot.state === 'cut' || slot.state === 'reshoot') {
        return <p className="text-sm text-red-700">{slot.error}</p>;
    }
    if (slot.state === 'scheduled') {
        return (
            <p className="text-sm text-muted-foreground">{t('research.notOpened')}</p>
        );
    }
    // Both `wrapped` and `in_production` carry payload data — narrow once
    // and extract whichever sub-fields are present.
    const data: Partial<ResearchArtifact> =
        slot.state === 'wrapped'
            ? slot.data
            : slot.state === 'in_production'
              ? slot.partialData ?? {}
              : {};

    const urlsAttempted = data.urlsAttempted ?? [];
    const screenshots = data.screenshots ?? [];
    const sources = data.sources ?? [];
    const scrapedExcerpt = data.scrapedExcerpt;
    const searchAnswer = data.searchAnswer;
    const searchQuery = data.searchQuery;

    return (
        <div className="space-y-4">
            {slot.state === 'in_production' && (
                <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                    <CircleNotch className="me-1.5 inline size-3 animate-spin" />
                    {t('research.investigating')}
                </div>
            )}

            {urlsAttempted.length > 0 && (
                <div className="space-y-1.5">
                    <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('research.urlsScraped')}
                    </div>
                    <ul className="space-y-1">
                        {urlsAttempted.map((u, i) => (
                            <li
                                key={i}
                                className="flex items-center gap-2 truncate rounded-md border bg-card px-2 py-1.5 text-xs"
                            >
                                <ArrowSquareOut className="size-3 shrink-0 text-muted-foreground" />
                                <a
                                    href={u}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="truncate text-foreground hover:text-blue-700"
                                >
                                    {u}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {screenshots.length > 0 && (
                <div className="space-y-1.5">
                    <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('research.pageCaptures')}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        {screenshots.map((s, i) => (
                            <a
                                key={i}
                                href={s.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group overflow-hidden rounded-lg border bg-gray-100 hover:border-blue-300"
                            >
                                <img
                                    src={s.url}
                                    alt={s.name ?? t('research.captureAlt', { number: i + 1 })}
                                    loading="lazy"
                                    className="aspect-video w-full object-cover transition group-hover:opacity-90"
                                />
                                {s.name && (
                                    <div className="truncate border-t bg-white px-2 py-1 text-2xs text-muted-foreground">
                                        {s.name}
                                    </div>
                                )}
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {scrapedExcerpt && (
                <div className="space-y-1.5">
                    <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('research.scrapedExcerpt')}
                    </div>
                    <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/20 p-3 font-sans text-xs leading-relaxed text-foreground/80">
                        {scrapedExcerpt}
                    </pre>
                </div>
            )}

            {searchQuery && (
                <div className="space-y-1.5">
                    <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('research.webSearchQuery')}
                    </div>
                    <p className="rounded-md border bg-card px-2 py-1.5 font-mono text-xs text-foreground">
                        {searchQuery}
                    </p>
                </div>
            )}

            {searchAnswer && (
                <div className="space-y-1.5">
                    <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('research.synthesizedAnswer')}
                    </div>
                    <p className="rounded-lg border bg-muted/20 p-3 text-xs leading-relaxed text-foreground/80">
                        {searchAnswer}
                    </p>
                </div>
            )}

            {sources.length > 0 && (
                <div className="space-y-1.5">
                    <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('research.citedSources')}
                    </div>
                    <ul className="space-y-1">
                        {sources.map((s, i) => (
                            <li key={i}>
                                <a
                                    href={s.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs hover:bg-muted/40"
                                >
                                    <ArrowSquareOut className="size-3 shrink-0 text-muted-foreground" />
                                    <span className="truncate">{s.title || s.host || s.url}</span>
                                    {s.host && s.title && (
                                        <span className="ml-auto truncate text-2xs text-muted-foreground">
                                            {s.host}
                                        </span>
                                    )}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {urlsAttempted.length === 0 &&
                screenshots.length === 0 &&
                sources.length === 0 &&
                !scrapedExcerpt &&
                !searchAnswer && (
                    <p className="text-sm text-muted-foreground">{t('research.noArtifacts')}</p>
                )}
        </div>
    );
}

function ScreenplayDetail({ state }: { state: PipelineState }) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const slot = state.screenplay;
    // History-restored wrapped runs sometimes have `slot.data.scriptUrl`
    // unset (the History sidebar doesn't always hydrate it). Fall back to
    // `state.artifactUrls.script`, which is populated from the same /status
    // source and the PipelineFlow enrichment can backfill.
    const scriptUrl =
        (slot.state === 'wrapped' ? slot.data.scriptUrl : undefined) ?? state.artifactUrls.script;
    const [text, setText] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [fetchFailed, setFetchFailed] = useState(false);
    useEffect(() => {
        if (!scriptUrl) return;
        setLoading(true);
        setFetchFailed(false);
        fetchScriptText(scriptUrl)
            .then((raw) => {
                let display = raw;
                try {
                    const parsed = JSON.parse(raw);
                    display =
                        parsed.script ||
                        parsed.narration ||
                        parsed.narration_script ||
                        parsed.text ||
                        JSON.stringify(parsed, null, 2);
                } catch {
                    /* leave as raw text */
                }
                setText(display);
            })
            .catch(() => {
                setText(null);
                setFetchFailed(true);
            })
            .finally(() => setLoading(false));
    }, [scriptUrl]);

    const handleCopy = async () => {
        if (!text) return;
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    if (slot.state !== 'wrapped') {
        return (
            <div className="text-sm text-muted-foreground">{t('screenplay.notFinished')}</div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                {scriptUrl && (
                    <a
                        href={scriptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
                    >
                        <ArrowSquareOut className="size-3" />
                        {t('screenplay.openRawFile')}
                    </a>
                )}
                <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={handleCopy}
                    disabled={!text}
                >
                    <Copy className="size-3" />
                    {copied ? t('screenplay.copied') : t('screenplay.copyScript')}
                </Button>
            </div>
            <div className="rounded-lg border bg-muted/20 p-4">
                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CircleNotch className="size-4 animate-spin" /> {t('screenplay.loading')}
                    </div>
                ) : text ? (
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
                        {text}
                    </pre>
                ) : !scriptUrl ? (
                    <p className="text-sm text-muted-foreground">
                        {t('screenplay.urlUnavailable')}
                    </p>
                ) : fetchFailed ? (
                    <div className="space-y-2 text-sm">
                        <p className="text-muted-foreground">
                            <Trans
                                t={t}
                                i18nKey="screenplay.previewFailed"
                                components={{
                                    bold: <span className="font-medium text-foreground" />,
                                }}
                            />
                        </p>
                        <p className="text-2xs text-muted-foreground">
                            {t('screenplay.previewFailedNote')}
                        </p>
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {t('screenplay.couldNotLoad')}
                    </p>
                )}
            </div>
        </div>
    );
}

function NarrationDetail({ state }: { state: PipelineState }) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const slot = state.narration;
    if (slot.state !== 'wrapped') {
        return (
            <div className="text-sm text-muted-foreground">{t('narration.notRecorded')}</div>
        );
    }
    const { audioUrl, wordsUrl } = slot.data;
    return (
        <div className="space-y-4">
            {audioUrl && (
                <div className="space-y-2">
                    <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('narration.voiceover')}
                    </div>
                    {/* Native controls give scrub / volume / playback rate. */}
                    <audio controls preload="none" className="w-full">
                        <source src={audioUrl} type="audio/mpeg" />
                    </audio>
                    <a
                        href={audioUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                    >
                        <ArrowSquareOut className="size-3" />
                        {t('narration.openAudioFile')}
                    </a>
                </div>
            )}
            {wordsUrl && <WordTimingsList wordsUrl={wordsUrl} />}
        </div>
    );
}

function WordTimingsList({ wordsUrl }: { wordsUrl: string }) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const [words, setWords] = useState<Array<{ word: string; start: number; end: number }> | null>(
        null
    );
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        setLoading(true);
        fetch(wordsUrl)
            .then((r) => r.json())
            .then((j) => setWords(Array.isArray(j) ? j : null))
            .catch(() => setWords(null))
            .finally(() => setLoading(false));
    }, [wordsUrl]);

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <TextAlignLeft className="size-3 text-muted-foreground" />
                <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('wordTimings.heading')}
                </div>
                {words && (
                    <span className="text-2xs text-muted-foreground">
                        {t('wordTimings.count', { count: words.length })}
                    </span>
                )}
            </div>
            {loading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CircleNotch className="size-3 animate-spin" /> {t('wordTimings.loading')}
                </div>
            ) : !words ? (
                <p className="text-xs text-muted-foreground">{t('wordTimings.couldNotLoad')}</p>
            ) : (
                <div className="flex max-h-64 flex-wrap gap-1 overflow-y-auto rounded-md border bg-muted/20 p-3">
                    {words.map((w, i) => (
                        <span
                            key={i}
                            className="inline-flex items-baseline gap-0.5 rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-2xs text-blue-800"
                            title={`${w.start.toFixed(2)}s – ${w.end.toFixed(2)}s`}
                        >
                            {w.word}
                            <span className="text-2xs text-blue-400">{w.start.toFixed(1)}s</span>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function StoryboardDetail({ state }: { state: PipelineState }) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const slot = state.storyboard;
    if (slot.state !== 'wrapped') {
        return (
            <div className="text-sm text-muted-foreground">{t('storyboard.notMapped')}</div>
        );
    }
    // Storyboard's own scenes can be empty on history-restored wrapped
    // runs (the live SSE shotPlan never arrived). The enriched `state.scenes`
    // is synthesized from /status.shot_plan by PipelineFlow's enrichedState
    // memo, so it's the more reliable source for the wrapped list.
    const storyScenes = (slot.data as StoryboardArtifact).scenes;
    const scenes =
        storyScenes.length > 0
            ? storyScenes
            : state.scenes.map((s) => ({
                  index: s.index,
                  shotType: s.shotType,
                  startTime: s.startTime,
                  endTime: s.endTime,
                  durationS: s.durationS,
                  narrationExcerpt: s.narrationExcerpt,
              }));
    if (scenes.length === 0) {
        return (
            <div className="text-sm text-muted-foreground">{t('storyboard.noSceneDetails')}</div>
        );
    }
    return (
        <div className="space-y-2">
            <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('storyboard.scenesMapped', { count: scenes.length })}
            </div>
            <ol className="space-y-1.5">
                {scenes.map((s) => (
                    <li key={s.index} className="rounded-lg border bg-card p-3 text-xs shadow-sm">
                        <div className="mb-1 flex items-center gap-2">
                            <span className="font-mono tabular-nums text-muted-foreground">
                                {String(s.index + 1).padStart(2, '0')}
                            </span>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wider text-foreground">
                                {s.shotType.replace(/_/g, ' ')}
                            </span>
                            <span className="ml-auto tabular-nums text-muted-foreground">
                                {s.startTime.toFixed(1)}s – {s.endTime.toFixed(1)}s ·{' '}
                                {s.durationS.toFixed(1)}s
                            </span>
                        </div>
                        {s.narrationExcerpt && (
                            <p className="italic text-foreground/80">
                                &ldquo;{s.narrationExcerpt}&rdquo;
                            </p>
                        )}
                    </li>
                ))}
            </ol>
        </div>
    );
}

function FilmingDetail({ state }: { state: PipelineState }) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const slot = state.filming;
    if (slot.state === 'cut') {
        return <p className="text-sm text-red-700">{slot.error}</p>;
    }
    let completed = 0;
    let total = 0;
    if (slot.state === 'wrapped') {
        completed = slot.data.shotsCompleted;
        total = slot.data.shotsTotal;
    } else if (slot.state === 'in_production' && slot.partialData) {
        completed = slot.partialData.shotsCompleted ?? 0;
        total = slot.partialData.shotsTotal ?? 0;
    }
    // History-restored wrapped runs may have lost the shotsCompleted/Total
    // counters but the enriched `state.scenes` is synthesized from
    // /status.shot_plan. Use it as the canonical count when the filming
    // slot's own counter is missing — otherwise we'd render "hasn't
    // started" on a video that's already done.
    const wrappedWithoutCounter = slot.state === 'wrapped' && total === 0;
    if (wrappedWithoutCounter && state.scenes.length > 0) {
        total = state.scenes.length;
        completed = state.scenes.filter((s) => s.state === 'wrapped').length || state.scenes.length;
    }
    const isWrapped = slot.state === 'wrapped';
    return (
        <div className="space-y-3">
            {total > 0 ? (
                <div>
                    <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {isWrapped ? t('filming.scenesWrapped') : t('filming.scenesFilmed')}
                    </div>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                        {completed}{' '}
                        <span className="text-base text-muted-foreground">/ {total}</span>
                    </p>
                </div>
            ) : isWrapped ? (
                <p className="text-sm text-muted-foreground">
                    {t('filming.wrappedNoCounters')}
                </p>
            ) : (
                <p className="text-sm text-muted-foreground">{t('filming.notStarted')}</p>
            )}
            <p className="text-xs text-muted-foreground">{t('filming.diagramHint')}</p>
        </div>
    );
}

function SceneDetail({
    scene,
    state,
    apiKey,
}: {
    scene: SceneSlot;
    state: PipelineState;
    apiKey?: string;
}) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const timeline = state.artifactUrls.timeline;
    const html = useSceneHtml(scene.index);
    // `playKey` bumps every time the user hits "Play this beat" so the
    // iframe re-mounts and any JS-driven animations restart from t=0.
    const [playKey, setPlayKey] = useState(0);
    const handleRestartIframe = () => setPlayKey((k) => k + 1);
    // Regenerate is only useful when the run has wrapped — pre-HTML the
    // BE has no timeline.json to find the frame in, and `frame/regenerate`
    // would fail with a 400 ("Generate HTML stage first").
    const canRegen = !!timeline && !!apiKey;

    const narration = state.narration;
    const narrationAudioUrl = narration.state === 'wrapped' ? narration.data.audioUrl : undefined;

    const isAiVideoScene = scene.shotType === 'AI_VIDEO_HERO';
    const isIntrinsic = scene.audioPolicy === 'intrinsic_only';
    return (
        <div className="space-y-4">
            {/* Header row: shot type + duration / time range + v3 chips */}
            <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-muted px-2 py-1 text-2xs font-medium uppercase tracking-wider text-foreground">
                    {scene.shotType.replace(/_/g, ' ')}
                </span>
                {scene.intentRole && (
                    <span
                        title={t('sceneDetail.intentRoleTitle', { value: scene.intentRole })}
                        className="rounded bg-sky-50 px-2 py-1 text-2xs font-medium uppercase tracking-wider text-sky-700"
                    >
                        {scene.intentRole}
                    </span>
                )}
                {scene.backgroundTreatment && (
                    <span
                        title={t('sceneDetail.backgroundTreatmentTitle', {
                            value: scene.backgroundTreatment,
                        })}
                        className="rounded bg-slate-100 px-2 py-1 text-2xs font-medium uppercase tracking-wider text-slate-700"
                    >
                        {t('sceneDetail.bgPrefix')} {scene.backgroundTreatment.replace(/_/g, ' ')}
                    </span>
                )}
                {scene.transitionIn && (
                    <span
                        title={t('sceneDetail.transitionInTitle', { value: scene.transitionIn })}
                        className="rounded bg-violet-50 px-2 py-1 text-2xs font-medium uppercase tracking-wider text-violet-700"
                    >
                        ↗ {scene.transitionIn.replace(/_/g, ' ')}
                    </span>
                )}
                {isAiVideoScene && (
                    <span
                        className="rounded bg-violet-100 px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-violet-700"
                        title={t('sceneDetail.aiVideoTitle')}
                    >
                        ✨ {t('sceneDetail.aiVideoBadge')}
                    </span>
                )}
                {isIntrinsic && (
                    <span
                        className="rounded bg-amber-100 px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-amber-700"
                        title={t('sceneDetail.intrinsicAudioTitle')}
                    >
                        🔇 {t('sceneDetail.intrinsicAudioBadge')}
                    </span>
                )}
                <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                    {scene.startTime.toFixed(1)}s – {scene.endTime.toFixed(1)}s ·{' '}
                    {scene.durationS.toFixed(1)}s
                </span>
            </div>

            {isAiVideoScene && (
                <div className="rounded-md border border-violet-200 bg-violet-50/60 p-3 text-xs text-violet-900">
                    <div className="mb-1 font-medium">{t('sceneDetail.aiVideoHeading')}</div>
                    <div className="text-violet-700">{t('sceneDetail.aiVideoBody')}</div>
                </div>
            )}

            {isIntrinsic && (
                <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900">
                    <div className="mb-1 flex items-center gap-1.5 font-medium">
                        <SpeakerX className="size-3.5" />
                        {t('sceneDetail.intrinsicHeading')}
                    </div>
                    <div className="text-amber-800">
                        {t('sceneDetail.intrinsicBody', {
                            start: scene.startTime.toFixed(1),
                            end: scene.endTime.toFixed(1),
                            audioSource: isAiVideoScene
                                ? t('sceneDetail.veoGeneratedAudio')
                                : t('sceneDetail.sourceClipAudio'),
                        })}
                    </div>
                </div>
            )}

            {/* v3 live-progress detail — present when the BE RunStateAggregator
                snapshot includes per-shot detail for this scene. Shows the
                current substage, the full regen log (every gate verdict), and
                any active third-party calls. Quietly absent for legacy runs. */}
            {scene.liveDetail && (
                <div className="rounded-md border bg-gradient-to-b from-slate-50 to-white p-3 text-xs">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="font-medium text-foreground">
                            {t('sceneDetail.liveProgress')}
                        </span>
                        {scene.liveDetail.elapsedS != null && (
                            <span className="font-mono tabular-nums text-muted-foreground">
                                {t('sceneDetail.elapsedSuffix', {
                                    sec: scene.liveDetail.elapsedS.toFixed(1),
                                })}
                            </span>
                        )}
                    </div>
                    {scene.liveDetail.substage && (
                        <div className="mb-2 text-foreground/80">
                            {t('sceneDetail.currentSubstage')}{' '}
                            <span className="font-mono">{scene.liveDetail.substage}</span>
                        </div>
                    )}
                    {scene.liveDetail.attempts && Object.keys(scene.liveDetail.attempts).length > 0 && (
                        <div className="mb-2">
                            <div className="mb-1 text-2xs uppercase tracking-wider text-muted-foreground">
                                {t('sceneDetail.regenAttempts')}
                            </div>
                            <div className="flex flex-wrap gap-1">
                                {Object.entries(scene.liveDetail.attempts).map(([step, n]) => (
                                    <span
                                        key={step}
                                        className="rounded bg-orange-50 px-1.5 py-0.5 font-mono text-2xs text-orange-700"
                                    >
                                        {step.replace(/_regen$/, '')}: {n}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                    {scene.liveDetail.regenLog && scene.liveDetail.regenLog.length > 0 && (
                        <div className="mb-2">
                            <div className="mb-1 text-2xs uppercase tracking-wider text-muted-foreground">
                                {t('sceneDetail.verdictLog')}
                            </div>
                            <ol className="space-y-1">
                                {scene.liveDetail.regenLog.map((r, i) => (
                                    <li
                                        key={`${r.step}-${r.attempt}-${i}`}
                                        className="flex items-start gap-2 text-2xs leading-snug"
                                    >
                                        <span className="mt-0.5 font-mono text-muted-foreground">
                                            {r.step}#{r.attempt}
                                        </span>
                                        <span
                                            className={
                                                r.verdict === 'pass'
                                                    ? 'rounded bg-emerald-50 px-1 text-2xs text-emerald-700'
                                                    : r.verdict === 'shipped_original'
                                                      ? 'rounded bg-amber-50 px-1 text-2xs text-amber-700'
                                                      : 'rounded bg-rose-50 px-1 text-2xs text-rose-700'
                                            }
                                        >
                                            {r.verdict === 'pass'
                                                ? t('sceneDetail.verdict.pass')
                                                : r.verdict === 'shipped_original'
                                                  ? t('sceneDetail.verdict.shippedOriginal')
                                                  : r.verdict}
                                        </span>
                                        {r.reason && (
                                            <span className="flex-1 text-foreground/70">
                                                {r.reason}
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}
                    {scene.liveDetail.externalCalls &&
                        scene.liveDetail.externalCalls.length > 0 && (
                            <div>
                                <div className="mb-1 text-2xs uppercase tracking-wider text-muted-foreground">
                                    {t('sceneDetail.externalCalls')}
                                </div>
                                <ul className="space-y-1">
                                    {scene.liveDetail.externalCalls.map((c) => (
                                        <li
                                            key={c.id}
                                            className="flex items-center gap-2 text-2xs"
                                        >
                                            <span className="font-mono text-foreground/80">
                                                {c.provider} · {c.op}
                                            </span>
                                            <span
                                                className={
                                                    c.state === 'done'
                                                        ? 'rounded bg-emerald-50 px-1 text-2xs text-emerald-700'
                                                        : c.state === 'failed'
                                                          ? 'rounded bg-rose-50 px-1 text-2xs text-rose-700'
                                                          : 'rounded bg-blue-50 px-1 text-2xs text-blue-700'
                                                }
                                            >
                                                {c.state === 'done'
                                                    ? t('sceneDetail.callState.done')
                                                    : c.state === 'failed'
                                                      ? t('sceneDetail.callState.failed')
                                                      : c.state === 'polling'
                                                        ? t('sceneDetail.callState.polling')
                                                        : t('sceneDetail.callState.queued')}
                                                {c.pollCount ? ` (${c.pollCount})` : ''}
                                            </span>
                                            {c.elapsedS != null && (
                                                <span className="font-mono text-muted-foreground">
                                                    {c.elapsedS.toFixed(1)}s
                                                </span>
                                            )}
                                            {c.error && (
                                                <span className="truncate text-rose-700">
                                                    {c.error}
                                                </span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    {scene.liveDetail.lastError && (
                        <div className="mt-2 rounded bg-rose-50 p-2 text-2xs text-rose-800">
                            {scene.liveDetail.lastError}
                        </div>
                    )}
                </div>
            )}

            {/* Hero media — prefer the rendered HTML when present so the
                user can actually "play" the beat (animations, video tags
                inside the HTML, etc). Falls back to the AI B-roll clip,
                then the still, then a text-only notice. */}
            {html ? (
                <SceneHtmlPreview html={html} sceneIndex={scene.index} playKey={playKey} />
            ) : scene.videoUrl ? (
                <div className="overflow-hidden rounded-lg border bg-black">
                    <video
                        src={scene.videoUrl}
                        controls
                        muted
                        playsInline
                        preload="metadata"
                        className="aspect-video w-full"
                    />
                </div>
            ) : scene.imageUrl ? (
                <div className="overflow-hidden rounded-lg border bg-gray-100">
                    <img
                        src={scene.imageUrl}
                        alt={t('sceneDetail.sceneAlt', { number: scene.index + 1 })}
                        className="aspect-video w-full object-cover"
                    />
                </div>
            ) : (
                <div className="flex aspect-video w-full items-center justify-center rounded-lg border bg-gray-50 text-xs text-muted-foreground">
                    {t('sceneDetail.textDrivenScene')}
                </div>
            )}

            {/* Narration-synced playback. Crops the wrapped voiceover to
                this scene's [startTime, endTime] window and re-keys the
                HTML iframe so its animations restart in lock-step with
                the audio — the closest "play this beat" we can get
                without rendering the MP4. */}
            {html && narrationAudioUrl && (
                <SceneNarrationPlayer
                    audioUrl={narrationAudioUrl}
                    startTime={scene.startTime}
                    endTime={scene.endTime}
                    onRestartIframe={handleRestartIframe}
                />
            )}

            {/* Regenerate this scene — inline AI remake panel. Drives the
                same `frame/regenerate` + `frame/update` endpoints the
                editor uses, but without leaving the pipeline view. The
                user types what to change, we round-trip through the LLM,
                show "ready", and on accept persist + invalidate the
                timeline cache so the new HTML reflects on next render. */}
            {canRegen && (
                <RegenerateScenePanel
                    videoId={state.videoId}
                    apiKey={apiKey!}
                    scene={scene}
                    timelineUrl={timeline!}
                />
            )}

            {/* Narration — brief (planner intent) + text (what gets said) */}
            <SceneNarrationSection scene={scene} />

            {/* Per-shot TTS audio (v3) — distinct from master narration. */}
            <ScenePerShotAudio scene={scene} />

            {/* AI-video telemetry — request_id, segments, cost. */}
            <SceneAiVideoSection scene={scene} />

            {/* Asset links */}
            {(scene.imageUrl || scene.videoUrl) && (
                <div className="space-y-1 text-xs">
                    <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('sceneDetail.assets')}
                    </div>
                    {scene.imageUrl && (
                        <ArtifactRow label={t('sceneDetail.stillLabel')} url={scene.imageUrl} />
                    )}
                    {scene.videoUrl && (
                        <ArtifactRow
                            label={t('sceneDetail.brollClipLabel')}
                            url={scene.videoUrl}
                        />
                    )}
                </div>
            )}

            {scene.error && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                    <div className="mb-1 font-medium">{t('sceneDetail.productionError')}</div>
                    {scene.error}
                </div>
            )}
        </div>
    );
}

/**
 * Narration section for a scene. On v3 runs we have both `narrationBrief`
 * (what the planner wanted said) and `narrationText` (what NarrationWriter
 * actually wrote). On intrinsic_only shots the text is empty by design —
 * show an explanatory empty state instead of a blank box.
 */
function SceneNarrationSection({ scene }: { scene: SceneSlot }) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const isIntrinsic = scene.audioPolicy === 'intrinsic_only';
    const brief = scene.narrationBrief;
    const text = scene.narrationText ?? scene.narrationExcerpt;
    if (!brief && !text && !isIntrinsic) return null;
    return (
        <section className="space-y-2">
            <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('sceneNarration.heading')}
            </div>
            {brief && (
                <div>
                    <div className="mb-1 text-2xs uppercase tracking-wider text-muted-foreground">
                        {t('sceneNarration.plannerBrief')}
                    </div>
                    <p className="rounded-lg border bg-sky-50/40 p-2.5 text-xs leading-relaxed text-foreground">
                        {brief}
                    </p>
                </div>
            )}
            {isIntrinsic ? (
                <div>
                    <div className="mb-1 text-2xs uppercase tracking-wider text-muted-foreground">
                        {t('sceneNarration.spokenNarration')}
                    </div>
                    <p className="rounded-lg border border-dashed bg-muted/20 p-2.5 text-xs italic text-muted-foreground">
                        {t('sceneNarration.intrinsicNote')}
                    </p>
                </div>
            ) : (
                text && (
                    <div>
                        <div className="mb-1 text-2xs uppercase tracking-wider text-muted-foreground">
                            {t('sceneNarration.spokenNarration')}
                        </div>
                        <p className="rounded-lg border bg-muted/20 p-2.5 text-sm italic leading-relaxed text-foreground">
                            &ldquo;{text}&rdquo;
                        </p>
                    </div>
                )
            )}
        </section>
    );
}

/**
 * Per-shot TTS audio (v3 only). On v2 runs there's no per-shot mp3; the
 * master narration covers everything. On v3, each non-intrinsic shot has a
 * dedicated mp3 the editor (and future per-shot regenerate flow) can swap
 * in isolation.
 */
function ScenePerShotAudio({ scene }: { scene: SceneSlot }) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    if (!scene.audioUrl) return null;
    return (
        <section className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                <SpeakerHigh className="size-3" />
                {t('perShotAudio.heading')}
                {scene.audioDurationS != null && (
                    <span className="font-mono normal-case tracking-normal text-muted-foreground/70">
                        ({scene.audioDurationS.toFixed(2)}s)
                    </span>
                )}
            </div>
            <audio controls preload="none" className="w-full">
                <source src={scene.audioUrl} type="audio/mpeg" />
            </audio>
            <div className="flex flex-wrap items-center gap-2 text-2xs">
                <a
                    href={scene.audioUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700"
                >
                    <ArrowSquareOut className="size-3" />
                    {t('perShotAudio.mp3')}
                </a>
                {scene.audioWordsUrl && (
                    <a
                        href={scene.audioWordsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700"
                    >
                        <ArrowSquareOut className="size-3" />
                        {t('perShotAudio.wordTimings')}
                    </a>
                )}
                {scene.audioScriptUrl && (
                    <a
                        href={scene.audioScriptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700"
                    >
                        <ArrowSquareOut className="size-3" />
                        {t('perShotAudio.scriptTxt')}
                    </a>
                )}
            </div>
        </section>
    );
}

/**
 * AI-video (Veo) telemetry for a scene, shown when the scene was generated
 * via the AI video orchestrator. Surfaces request_id, segment list, cost,
 * audio flag — everything the orchestrator wrote to the timeline entry.
 */
function SceneAiVideoSection({ scene }: { scene: SceneSlot }) {
    const { t } = useTranslation(['videoApiStudioNodeDetailSheet', 'videoApiStudioCredits']);
    const hasTelemetry =
        scene.aiVideoRequestId ||
        scene.aiVideoUrl ||
        scene.aiVideoSegments?.length ||
        scene.aiVideoCostCredits != null ||
        scene.aiVideoCostUsd != null;
    if (!hasTelemetry) return null;
    return (
        <section className="space-y-1.5">
            <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('aiVideoTelemetry.heading')}
            </div>
            <div className="space-y-1 rounded-md border bg-violet-50/30 p-2.5 text-2xs">
                {scene.aiVideoRequestId && (
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">request_id</span>
                        <span className="truncate font-mono text-foreground">
                            {scene.aiVideoRequestId}
                        </span>
                    </div>
                )}
                {scene.aiVideoCostCredits != null && (
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                            {t('aiVideoTelemetry.cost')}
                        </span>
                        <span className="font-mono tabular-nums text-violet-700">
                            {formatCredits(scene.aiVideoCostCredits, { precision: 1, t })}
                            {scene.aiVideoCostUsd != null && (
                                <span className="ml-1 text-muted-foreground">
                                    (${scene.aiVideoCostUsd.toFixed(3)})
                                </span>
                            )}
                        </span>
                    </div>
                )}
                {scene.aiVideoElapsedS != null && (
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                            {t('aiVideoTelemetry.elapsed')}
                        </span>
                        <span className="font-mono tabular-nums text-foreground">
                            {scene.aiVideoElapsedS.toFixed(1)}s
                        </span>
                    </div>
                )}
                {scene.aiVideoOn != null && (
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                            {t('aiVideoTelemetry.veoAudio')}
                        </span>
                        <span className="text-foreground">
                            {scene.aiVideoOn
                                ? t('aiVideoTelemetry.on')
                                : t('aiVideoTelemetry.off')}
                        </span>
                    </div>
                )}
                {scene.aiVideoUrl && (
                    <a
                        href={scene.aiVideoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700"
                    >
                        <ArrowSquareOut className="size-3" />
                        {t('aiVideoTelemetry.openVeoOutput')}
                    </a>
                )}
                {scene.aiVideoSegments && scene.aiVideoSegments.length > 0 && (
                    <div className="mt-1.5 border-t border-violet-200/60 pt-1.5">
                        <div className="mb-1 text-2xs uppercase tracking-wider text-muted-foreground">
                            {t('aiVideoTelemetry.segments', {
                                count: scene.aiVideoSegments.length,
                            })}
                        </div>
                        <ul className="space-y-0.5">
                            {scene.aiVideoSegments.map((seg) => (
                                <li
                                    key={seg.segIdx}
                                    className="flex items-center gap-2 text-2xs"
                                >
                                    <span className="font-mono tabular-nums text-muted-foreground">
                                        {t('aiVideoTelemetry.seg')} {seg.segIdx}
                                    </span>
                                    {seg.durationS != null && (
                                        <span className="font-mono tabular-nums text-foreground">
                                            {seg.durationS.toFixed(1)}s
                                        </span>
                                    )}
                                    {seg.cacheHit && (
                                        <span className="rounded bg-emerald-100 px-1 text-2xs font-medium uppercase tracking-wider text-emerald-700">
                                            {t('aiVideoTelemetry.cached')}
                                        </span>
                                    )}
                                    {seg.videoUrl && (
                                        <a
                                            href={seg.videoUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="ml-auto inline-flex items-center gap-1 text-blue-600 hover:text-blue-700"
                                        >
                                            <ArrowSquareOut className="size-3" />
                                            mp4
                                        </a>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </section>
    );
}

/**
 * Inline AI-regenerate UI for a single scene, surfaced from the pipeline's
 * SceneDetail sheet. Mirrors the editor's "Remake this shot with AI" panel
 * (PropertiesPanel.tsx) but skips the editor canvas — the user accepts the
 * new HTML directly and we persist via `frame/update`.
 *
 * Three-state machine:
 *   `idle`     — user composing the prompt
 *   `loading`  — regenerateFrame() in flight (~10–60s on Gemini Pro)
 *   `preview`  — new HTML returned; user can Accept (persist) or Discard
 *
 * On Accept we invalidate the cached timeline JSON so the next pipeline
 * state read picks up the new HTML; the rendered MP4 is downstream of that.
 */
function RegenerateScenePanel({
    videoId,
    apiKey,
    scene,
    timelineUrl,
}: {
    videoId: string;
    apiKey: string;
    scene: SceneSlot;
    timelineUrl: string;
}) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const [phase, setPhase] = useState<'idle' | 'loading' | 'preview'>('idle');
    // Pre-fill with the narration excerpt so users editing for tone /
    // copy have a reasonable starting point.
    const [prompt, setPrompt] = useState(scene.narrationExcerpt ?? '');
    const [result, setResult] = useState<{ frameIndex: number; newHtml: string } | null>(null);

    const handleToggle = () => {
        if (!open) {
            setPhase('idle');
            setResult(null);
            // Re-seed prompt when reopening — the narration is the most
            // useful starting point for a re-roll.
            setPrompt(scene.narrationExcerpt ?? '');
        }
        setOpen((v) => !v);
    };

    const handleGenerate = async () => {
        const trimmed = prompt.trim();
        if (!trimmed) {
            toast.error(t('regenerate.describeChangeError'));
            return;
        }
        setPhase('loading');
        try {
            // BE resolves frame by `inTime <= ts < exitTime` — same logic
            // as the editor uses. Nudge by 0.05s to land inside the shot.
            const ts = Math.max(scene.startTime + 0.05, 0);
            const res = await regenerateFrame(videoId, apiKey, ts, trimmed);
            setResult({ frameIndex: res.frame_index, newHtml: res.new_html });
            setPhase('preview');
        } catch (err) {
            setPhase('idle');
            toast.error(
                err instanceof Error ? err.message : t('regenerate.regenerationFailedFallback')
            );
        }
    };

    const handleAccept = async () => {
        if (!result) return;
        setPhase('loading');
        try {
            await updateFrame(videoId, apiKey, result.frameIndex, result.newHtml);
            // Force the next pipeline-flow read to refetch the timeline so
            // the new HTML reflects in the SceneDetail thumbnail too. The
            // queryKey shape mirrors `useTimelineJson`'s definition.
            queryClient.invalidateQueries({ queryKey: ['video-timeline', videoId, timelineUrl] });
            toast.success(t('regenerate.successToast'));
            setOpen(false);
            setPhase('idle');
            setResult(null);
        } catch (err) {
            setPhase('preview');
            toast.error(err instanceof Error ? err.message : t('regenerate.saveFailedFallback'));
        }
    };

    const handleDiscard = () => {
        setPhase('idle');
        setResult(null);
    };

    if (!open) {
        return (
            <Button variant="default" size="sm" onClick={handleToggle} className="w-full gap-2">
                <MagicWand className="size-3.5" />
                {t('regenerate.cta')}
            </Button>
        );
    }

    return (
        <div className="space-y-2 rounded-lg border bg-card p-3 shadow-sm">
            <div className="flex items-center gap-1.5">
                <MagicWand className="size-3.5 text-indigo-600" />
                <span className="text-xs font-medium text-foreground">
                    {t('regenerate.heading', {
                        number: String(scene.index + 1).padStart(2, '0'),
                    })}
                </span>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setOpen(false)}
                    className="ml-auto size-6"
                    title={t('regenerate.close')}
                    disabled={phase === 'loading'}
                >
                    <X className="size-3.5" />
                </Button>
            </div>
            <textarea
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t('regenerate.placeholder')}
                disabled={phase === 'loading'}
                className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-indigo-400 focus:outline-none disabled:opacity-60"
            />

            {phase === 'preview' ? (
                <div className="space-y-1.5">
                    <p className="text-2xs text-green-700">{t('regenerate.readyNotice')}</p>
                    <div className="flex gap-1.5">
                        <Button
                            size="sm"
                            onClick={handleAccept}
                            className="h-7 flex-1 gap-1 bg-green-600 text-2xs text-white hover:bg-green-700"
                        >
                            <Check className="size-3" />
                            {t('regenerate.acceptSave')}
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={handleDiscard}
                            className="h-7 flex-1 gap-1 text-2xs"
                        >
                            <X className="size-3" />
                            {t('regenerate.discard')}
                        </Button>
                    </div>
                </div>
            ) : (
                <Button
                    size="sm"
                    onClick={handleGenerate}
                    disabled={!prompt.trim() || phase === 'loading'}
                    className="h-7 w-full gap-1.5 bg-indigo-600 text-2xs text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                    {phase === 'loading' ? (
                        <>
                            <CircleNotch className="size-3 animate-spin" />
                            {t('regenerate.generating')}
                        </>
                    ) : (
                        <>
                            <MagicWand className="size-3" />
                            {t('regenerate.generate')}
                        </>
                    )}
                </Button>
            )}

            <p className="text-2xs text-muted-foreground">{t('regenerate.footerNote')}</p>
        </div>
    );
}

/**
 * Embed a shot's rendered HTML in a sandboxed iframe at its native 1920×1080
 * design surface, scaled to fit the sheet's viewport width. ResizeObserver
 * keeps the scale correct as the sheet grows / shrinks (e.g. responsive
 * breakpoints, devtools toggle). Re-uses the same sandbox flags as
 * AIVideoPlayer so JS-driven animations + autoplay work.
 *
 * `key={`${sceneIndex}-${playKey}`}` on the iframe serves two purposes:
 *   - Switching between scenes forces a fresh document so animation timers
 *     from the previous scene don't bleed in.
 *   - Bumping `playKey` from the parent re-mounts the iframe so the user
 *     can replay the beat in lock-step with the narration audio.
 */
function SceneHtmlPreview({
    html,
    sceneIndex,
    playKey,
}: {
    html: string;
    sceneIndex: number;
    playKey?: number;
}) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const containerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(0.3);

    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const update = () => {
            const w = el.getBoundingClientRect().width;
            if (w > 0) setScale(w / 1920);
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return (
        <div
            ref={containerRef}
            className="relative aspect-video w-full overflow-hidden rounded-lg border bg-white"
        >
            <iframe
                key={`${sceneIndex}-${playKey ?? 0}`}
                title={t('htmlPreviewTitle', { number: sceneIndex + 1 })}
                srcDoc={html}
                sandbox="allow-scripts allow-same-origin"
                allow="autoplay"
                className="absolute left-0 top-0 origin-top-left border-0"
                style={{
                    width: 1920,
                    height: 1080,
                    transform: `scale(${scale})`,
                }}
            />
        </div>
    );
}

/**
 * Plays the wrapped narration audio cropped to a single scene's time
 * window, in lock-step with a re-keyed HTML iframe. Single play head
 * inside this component — pause is real, "Play this beat" reseeks
 * audio to `startTime`, kicks the parent to restart the iframe, and
 * schedules an auto-pause at `endTime` via rAF (timeupdate granularity
 * is too coarse for short beats — we typically have 2-4s shots).
 *
 * We deliberately don't try to drive the iframe's internal animations
 * via postMessage — the rendered HTML doesn't subscribe to messages,
 * and re-mounting is the same effect with no contract.
 */
function SceneNarrationPlayer({
    audioUrl,
    startTime,
    endTime,
    onRestartIframe,
}: {
    audioUrl: string;
    startTime: number;
    endTime: number;
    onRestartIframe: () => void;
}) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const audioRef = useRef<HTMLAudioElement>(null);
    const rafRef = useRef<number | null>(null);
    const [playing, setPlaying] = useState(false);

    // Stop the rAF auto-pause loop on unmount / scene switch — otherwise
    // a still-running tick can call `pause()` on a fresh audio element.
    useEffect(() => {
        return () => {
            if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        };
    }, []);

    const handlePlay = async () => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.currentTime = Math.max(0, startTime);
        // Restart the iframe alongside the audio so animations re-trigger
        // from t=0 of this beat. We do this *before* play() so the tiny
        // remount delay doesn't desync.
        onRestartIframe();
        try {
            await audio.play();
        } catch (err) {
            // Likely autoplay-policy denial. Surface so the user can retry.
            toast.error(
                err instanceof Error ? err.message : t('narrationPlayer.playbackErrorFallback')
            );
            return;
        }
        setPlaying(true);

        const tick = () => {
            const a = audioRef.current;
            if (!a || a.paused) {
                rafRef.current = null;
                setPlaying(false);
                return;
            }
            if (a.currentTime >= endTime) {
                a.pause();
                setPlaying(false);
                rafRef.current = null;
                return;
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(tick);
    };

    const handlePause = () => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.pause();
        setPlaying(false);
        if (rafRef.current != null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
    };

    return (
        <div className="space-y-2 rounded-lg border bg-card p-3">
            <div className="flex items-center gap-2">
                <Button
                    size="sm"
                    onClick={playing ? handlePause : handlePlay}
                    className="h-7 gap-1.5 text-2xs"
                >
                    {playing ? (
                        <>
                            <Pause className="size-3" /> {t('narrationPlayer.pause')}
                        </>
                    ) : (
                        <>
                            <Play className="size-3" /> {t('narrationPlayer.play')}
                        </>
                    )}
                </Button>
                <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                    {startTime.toFixed(1)}s – {endTime.toFixed(1)}s
                </span>
            </div>
            {/* Hidden control surface — the visible affordance is the
                button above. Keeping the element rendered (not just a
                bare <audio>) means users can right-click → save / inspect
                if they want the raw audio for the full timeline. */}
            <audio ref={audioRef} src={audioUrl} preload="metadata" controls className="w-full" />
        </div>
    );
}

function TalentDetail({ state }: { state: PipelineState }) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const slot = state.talent;
    if (!slot) {
        return (
            <div className="text-sm text-muted-foreground">{t('talent.noHost')}</div>
        );
    }
    if (slot.state === 'cut' || slot.state === 'reshoot') {
        return <p className="text-sm text-red-700">{slot.error}</p>;
    }
    if (slot.state === 'scheduled') {
        return (
            <div className="text-sm text-muted-foreground">{t('talent.onCallSheet')}</div>
        );
    }
    if (slot.state === 'in_production') {
        const completed = slot.partialData?.completed ?? 0;
        const total = slot.partialData?.total ?? 0;
        return (
            <div className="space-y-3">
                <div>
                    <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('talent.takesRecorded')}
                    </div>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                        {completed}{' '}
                        {total > 0 && (
                            <span className="text-base text-muted-foreground">/ {total}</span>
                        )}
                    </p>
                </div>
                <p className="text-xs text-muted-foreground">{t('talent.inProductionNote')}</p>
            </div>
        );
    }

    if (slot.state !== 'wrapped') return null;

    const total = slot.data.total || slot.data.takes?.length || 0;
    const takes = (slot.data.takes ?? []).slice().sort((a, b) => a.shotIndex - b.shotIndex);
    return (
        <div className="space-y-4">
            <div>
                <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('talent.takesInTheCan')}
                </div>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                    {t('talent.takesCount', { count: takes.length || total })}
                </p>
            </div>
            {takes.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                    {takes.map((take) => (
                        <div
                            key={take.shotIndex}
                            className="overflow-hidden rounded-lg border bg-card text-xs shadow-sm"
                        >
                            <div className="aspect-video w-full bg-gray-100">
                                {take.avatarVideoUrl ? (
                                    <video
                                        src={take.avatarVideoUrl}
                                        controls
                                        muted
                                        playsInline
                                        preload="none"
                                        poster={take.hostImageUrl}
                                        className="size-full object-cover"
                                    />
                                ) : take.hostImageUrl ? (
                                    <img
                                        src={take.hostImageUrl}
                                        alt={t('talent.takeAlt', {
                                            number: take.shotIndex + 1,
                                        })}
                                        className="size-full object-cover"
                                        loading="lazy"
                                    />
                                ) : (
                                    <div className="flex size-full items-center justify-center text-2xs text-muted-foreground">
                                        {t('talent.noPreview')}
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center gap-1.5 px-2 py-1.5">
                                <span className="font-mono tabular-nums text-muted-foreground">
                                    {t('talent.takeLabel', {
                                        number: String(take.shotIndex + 1).padStart(2, '0'),
                                    })}
                                </span>
                                {take.durationS != null && (
                                    <span className="ml-auto tabular-nums text-muted-foreground">
                                        {take.durationS.toFixed(1)}s
                                    </span>
                                )}
                            </div>
                            {take.error && (
                                <p className="border-t bg-red-50 px-2 py-1 text-2xs text-red-700">
                                    {take.error}
                                </p>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-sm text-muted-foreground">
                    {t('talent.wrappedNoPreviews')}
                </p>
            )}
        </div>
    );
}

function ScoreDetail({ state }: { state: PipelineState }) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const slot = state.score;
    if (!slot) {
        return (
            <div className="text-sm text-muted-foreground">{t('score.noScore')}</div>
        );
    }
    if (slot.state === 'cut' || slot.state === 'reshoot') {
        return <p className="text-sm text-red-700">{slot.error}</p>;
    }
    if (slot.state === 'scheduled') {
        return (
            <div className="text-sm text-muted-foreground">{t('score.notArrived')}</div>
        );
    }
    if (slot.state === 'in_production') {
        const completed = slot.partialData?.segmentsCompleted ?? 0;
        const total = slot.partialData?.segmentsTotal ?? 0;
        return (
            <div className="space-y-3">
                <div>
                    <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('score.chunksComposed')}
                    </div>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                        {completed}{' '}
                        {total > 0 && (
                            <span className="text-base text-muted-foreground">/ {total}</span>
                        )}
                    </p>
                </div>
                <p className="text-xs text-muted-foreground">{t('score.inProductionNote')}</p>
            </div>
        );
    }

    if (slot.state !== 'wrapped') return null;

    const { audioUrl, label, segmentsTotal } = slot.data;
    return (
        <div className="space-y-4">
            {audioUrl ? (
                <div className="space-y-2">
                    <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {label || t('score.defaultLabel')}
                    </div>
                    <audio controls preload="none" className="w-full">
                        <source src={audioUrl} type="audio/mpeg" />
                    </audio>
                    <a
                        href={audioUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                    >
                        <ArrowSquareOut className="size-3" />
                        {t('narration.openAudioFile')}
                    </a>
                </div>
            ) : (
                <p className="text-sm text-muted-foreground">{t('score.wrappedNote')}</p>
            )}
            {segmentsTotal != null && (
                <p className="text-xs text-muted-foreground">
                    {t('score.composedIn', { count: segmentsTotal })}
                </p>
            )}
        </div>
    );
}

function FinalCutDetail({ state }: { state: PipelineState }) {
    const { t } = useTranslation('videoApiStudioNodeDetailSheet');
    const slot = state.finalCut;
    if (slot.state !== 'wrapped') {
        return (
            <div className="text-sm text-muted-foreground">{t('finalCut.notAssembled')}</div>
        );
    }
    const { timelineUrl, audioUrl, wordsUrl } = slot.data;
    return (
        <div className="space-y-3">
            <p className="text-sm text-foreground">
                <Trans
                    t={t}
                    i18nKey="finalCut.description"
                    components={{ bold: <span className="font-medium" /> }}
                />
            </p>
            <div className="space-y-1 text-xs">
                <ArtifactRow label={t('artifactLabel.timeline')} url={timelineUrl} />
                {audioUrl && <ArtifactRow label={t('artifactLabel.audio')} url={audioUrl} />}
                {wordsUrl && (
                    <ArtifactRow label={t('artifactLabel.wordTimings')} url={wordsUrl} />
                )}
            </div>
        </div>
    );
}

function ArtifactRow({ label, url }: { label: string; url: string }) {
    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded border bg-muted/20 px-2 py-1.5 text-xs hover:bg-muted/40"
        >
            <ArrowSquareOut className="size-3 text-muted-foreground" />
            <span className="font-medium text-foreground">{label}</span>
            <span className="ml-auto truncate font-mono text-2xs text-muted-foreground">
                {url.split('/').pop()}
            </span>
        </a>
    );
}
