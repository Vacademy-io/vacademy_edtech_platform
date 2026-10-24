import { memo, useEffect, useRef, useState } from 'react';
import { NodeProps } from 'reactflow';
import {
    Camera,
    CodeSimple as Code2,
    Eye,
    CircleNotch as Loader2,
    ArrowsOut as Maximize2,
    Microphone as Mic,
    Phone,
    ArrowsClockwise as RefreshCw,
    Stamp,
} from '@phosphor-icons/react';
import { Handle, Position } from 'reactflow';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { PipelineNodeData } from '../-utils/build-pipeline-graph';
import type { NodeState, SceneLiveDetail, SceneSlot } from '../-utils/derive-pipeline-state';
import { NODE_SIZES } from '../-utils/build-pipeline-graph';
import { useSceneHtml } from '../-utils/scenes-html-context';

/**
 * One scene in the production. Smaller and more numerous than the linear
 * production-stage nodes — there's one of these per shot in the Director's
 * plan, ranked vertically off Storyboard.
 *
 * Visual hierarchy is intentionally lighter than `BaseNodeShell` (single
 * border + state-tinted left edge instead of a full ring) so a column of
 * 8–30 scenes doesn't overwhelm the diagram.
 */

const STATE_VISUAL: Record<
    NodeState,
    { edge: string; bg: string; iconBg: string; chipColor: string }
> = {
    scheduled: {
        edge: 'border-l-gray-300',
        bg: 'bg-white',
        iconBg: 'bg-gray-100 text-gray-500',
        chipColor: 'bg-gray-100 text-gray-600',
    },
    in_production: {
        edge: 'border-l-blue-500',
        bg: 'bg-blue-50/40',
        iconBg: 'bg-blue-100 text-blue-700',
        chipColor: 'bg-blue-100 text-blue-700',
    },
    wrapped: {
        edge: 'border-l-green-500',
        bg: 'bg-white',
        iconBg: 'bg-green-100 text-green-700',
        chipColor: 'bg-green-100 text-green-700',
    },
    reshoot: {
        edge: 'border-l-amber-500',
        bg: 'bg-amber-50/40',
        iconBg: 'bg-amber-100 text-amber-700',
        chipColor: 'bg-amber-100 text-amber-700',
    },
    cut: {
        edge: 'border-l-red-500',
        bg: 'bg-red-50/40',
        iconBg: 'bg-red-100 text-red-700',
        chipColor: 'bg-red-100 text-red-700',
    },
};

/**
 * Defers iframe mounting until the SceneNode scrolls within ~200px of the
 * browser viewport. On a 30-shot run this trades a 30-iframe initial paint
 * for "iframes mount as you pan/scroll the pipeline into view". Once a
 * given node has been visible we keep the iframe mounted (no flicker on
 * pan-away-then-back).
 *
 * Note: IntersectionObserver fires off geometric position vs the document
 * viewport, not the React Flow viewport. Panning the React Flow surface
 * still translates the SceneNode in document coords, so IO does see those
 * events. The main wins are: (a) tab/route hidden, (b) initial mount when
 * the editor is below-the-fold, (c) deeply zoomed-out runs where most
 * scenes are technically off-screen.
 */
function useFirstVisible<T extends HTMLElement>(): [React.MutableRefObject<T | null>, boolean] {
    const ref = useRef<T | null>(null);
    const [seen, setSeen] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el || seen) return;
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    setSeen(true);
                    io.disconnect();
                }
            },
            { rootMargin: '200px' }
        );
        io.observe(el);
        return () => io.disconnect();
    }, [seen]);
    return [ref, seen];
}

/**
 * Substage → label + icon for the per-scene live status line. Mirrors the
 * BE emit set in run_state_aggregator.py: html_gen | density | bbox_lint |
 * brand_asset | vision_review | screenshot | tts | media_polling.
 */
function buildSubstageVisual(
    t: TFunction
): Record<string, { label: string; Icon: React.ComponentType<{ className?: string }> }> {
    return {
        html_gen: { label: t('substage.htmlGen'), Icon: Code2 },
        density: { label: t('substage.density'), Icon: Loader2 },
        bbox_lint: { label: t('substage.bboxLint'), Icon: Maximize2 },
        brand_asset: { label: t('substage.brandAsset'), Icon: Stamp },
        vision_review: { label: t('substage.visionReview'), Icon: Eye },
        screenshot: { label: t('substage.screenshot'), Icon: Camera },
        tts: { label: t('substage.tts'), Icon: Mic },
        media_polling: { label: t('substage.mediaPolling'), Icon: Phone },
    };
}

/** Compact list of "running" external calls; used in the live status line. */
function pickActiveExternal(detail: SceneLiveDetail | undefined, t: TFunction): string | null {
    if (!detail?.externalCalls) return null;
    for (const c of detail.externalCalls) {
        if (c.state === 'queued' || c.state === 'polling') {
            const stateLabel = t(`externalCallState.${c.state}`);
            return `${c.provider} ${stateLabel}${c.pollCount && c.pollCount > 0 ? ` (${c.pollCount})` : ''}`;
        }
    }
    return null;
}

function SceneNodeInner({ data }: NodeProps<PipelineNodeData>) {
    const { t } = useTranslation('videoApiStudioSceneNode');
    const idx = data.sceneIndex ?? -1;
    const scene: SceneSlot | undefined = data.state.scenes[idx];
    const html = useSceneHtml(idx);
    const [thumbRef, thumbVisible] = useFirstVisible<HTMLDivElement>();
    if (!scene) return null;
    const visual = STATE_VISUAL[scene.state];
    const sceneNumber = String(scene.index + 1).padStart(2, '0');
    const hasThumb = !!(scene.imageUrl || scene.videoUrl);
    // Live detail (substage / regen counter / external-call activity)
    const live = scene.liveDetail;
    const substageVisual = buildSubstageVisual(t);
    const subVisual = live?.substage ? substageVisual[live.substage] : undefined;
    const activeExternal = pickActiveExternal(live, t);
    const regenCount = live?.regenCount ?? 0;
    // AI video badge — shown on Scene nodes whose Director-assigned shot_type
    // is AI_VIDEO_HERO. Marks the shot as Veo-generated so a viewer can spot
    // at a glance which shots used the AI video capability (and contributed
    // to the per-video cost cap). Audio variant gets a slightly different
    // visual; cost is summarized at the PipelinePanel level.
    const isAiVideo = scene.shotType === 'AI_VIDEO_HERO';
    // v3 intrinsic_only badge — master narration is muted in this shot's
    // window, so the shot's own audio (Veo audio / source-clip audio) plays
    // alone. Helps users see why some scenes don't have narration text.
    const isIntrinsic = scene.audioPolicy === 'intrinsic_only';

    return (
        <div
            aria-label={t('ariaLabel', { sceneNumber })}
            // Pin both dimensions to NODE_SIZES so the rendered DOM never
            // grows past what dagre reserved for this node. Without `height`
            // pinned, narration text or a tall thumbnail would push the node
            // beyond 240px and adjacent scenes in the same rank would visibly
            // overlap each other.
            style={{ width: NODE_SIZES.scene.width, height: NODE_SIZES.scene.height }}
            className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border border-l-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${visual.edge} ${visual.bg}`}
        >
            <Handle
                type="target"
                position={Position.Left}
                className="!size-1 !border-0 !bg-transparent"
            />
            <Handle
                type="target"
                position={Position.Top}
                className="!size-1 !border-0 !bg-transparent"
            />
            <Handle
                type="source"
                position={Position.Right}
                className="!size-1 !border-0 !bg-transparent"
            />
            <Handle
                type="source"
                position={Position.Bottom}
                className="!size-1 !border-0 !bg-transparent"
            />

            {/* Header — scene number + state icon + shot type chip */}
            <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
                <span
                    className={`flex size-5 shrink-0 items-center justify-center rounded font-mono text-2xs font-bold tabular-nums ${visual.iconBg}`}
                >
                    {scene.state === 'in_production' ? (
                        <Loader2 className="size-3 animate-spin" />
                    ) : (
                        sceneNumber
                    )}
                </span>
                <span
                    className={`shrink-0 rounded px-1 text-2xs font-medium uppercase tracking-wider ${visual.chipColor}`}
                >
                    {scene.shotType.replace(/_/g, ' ')}
                </span>
                {isAiVideo && (
                    <span
                        title={t('aiVideoTooltip')}
                        className="shrink-0 rounded bg-violet-100 px-1 text-2xs font-semibold uppercase tracking-wider text-violet-700"
                    >
                        ✨ {t('aiBadge')}
                    </span>
                )}
                {isIntrinsic && (
                    <span
                        title={t('intrinsicTooltip', { field: 'audio_policy=intrinsic_only' })}
                        className="shrink-0 rounded bg-amber-100 px-1 text-2xs font-semibold uppercase tracking-wider text-amber-700"
                    >
                        🔇 {t('intrinsicBadge')}
                    </span>
                )}
                {regenCount > 0 && (
                    <span
                        title={t('regenTooltip', { count: regenCount })}
                        className="ml-auto flex shrink-0 items-center gap-0.5 rounded bg-orange-100 px-1 text-2xs font-bold tabular-nums text-orange-700"
                    >
                        <RefreshCw className="size-2.5" />
                        {regenCount}
                    </span>
                )}
                <span
                    className={`${regenCount > 0 ? '' : 'ml-auto'} shrink-0 font-mono text-2xs tabular-nums text-muted-foreground`}
                >
                    {scene.durationS.toFixed(1)}s
                </span>
            </div>
            {/* v3 intent_role + background_treatment + transition_in chips —
                secondary header row, only when populated. Lets reviewers see
                at a glance how the planner classified this beat in the
                narrative arc and which transition leads into it. */}
            {(scene.intentRole || scene.backgroundTreatment || scene.transitionIn) && (
                <div className="flex shrink-0 flex-wrap items-center gap-1 px-2 pb-1 text-2xs">
                    {scene.intentRole && (
                        <span
                            title={t('intentRoleTooltip', { value: scene.intentRole })}
                            className="rounded bg-sky-50 px-1 font-medium uppercase tracking-wider text-sky-700"
                        >
                            {scene.intentRole}
                        </span>
                    )}
                    {scene.backgroundTreatment && (
                        <span
                            title={t('backgroundTreatmentTooltip', { value: scene.backgroundTreatment })}
                            className="rounded bg-slate-100 px-1 font-medium uppercase tracking-wider text-slate-700"
                        >
                            {scene.backgroundTreatment.replace(/_/g, ' ')}
                        </span>
                    )}
                    {scene.transitionIn && (
                        <span
                            title={t('transitionInTooltip', { value: scene.transitionIn })}
                            className="rounded bg-fuchsia-50 px-1 font-medium uppercase tracking-wider text-fuchsia-700"
                        >
                            {scene.transitionIn.replace(/_/g, ' ')}
                        </span>
                    )}
                </div>
            )}
            {/* Live substage line — only while the shot is actively in
                production. The icon hints at *what* the pipeline is doing
                (HTML gen vs vision review vs Veo polling) so the user
                doesn't see a generic spinner for the whole shot. */}
            {scene.state === 'in_production' && (subVisual || activeExternal) && (
                <div className="flex shrink-0 items-center gap-1.5 border-t border-black/5 bg-blue-50/60 px-2 py-1 text-2xs text-blue-800">
                    {subVisual ? (
                        <subVisual.Icon className="size-3 shrink-0 animate-pulse" />
                    ) : (
                        <Loader2 className="size-3 shrink-0 animate-spin" />
                    )}
                    <span className="truncate">
                        {subVisual?.label ?? t('workingFallback')}
                        {activeExternal ? ` · ${activeExternal}` : ''}
                    </span>
                </div>
            )}

            {/* Thumbnail (when timeline.json is loaded) — falls back to a
                placeholder camera icon while parsing or when no media is in
                the scene HTML (pure-text shots). For text-driven shots we
                embed the raw HTML in a sandboxed iframe so the text /
                animation is visible directly in the pipeline view. */}
            <div
                ref={thumbRef}
                className="relative aspect-video w-full overflow-hidden bg-gray-100"
            >
                {scene.videoUrl ? (
                    <video
                        src={scene.videoUrl}
                        muted
                        playsInline
                        preload="metadata"
                        className="size-full object-cover"
                    />
                ) : scene.imageUrl ? (
                    <img
                        src={scene.imageUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                    />
                ) : html && thumbVisible ? (
                    // Render the shot HTML at its native 1920×1080 design
                    // surface and scale-to-fit. `pointer-events-none` lets
                    // clicks bubble to the React Flow node click handler.
                    // Scale is `NODE_SIZES.scene.width / 1920` so the
                    // 16:9 thumbnail box is exactly filled.
                    <iframe
                        title={t('htmlPreviewTitle', { sceneNumber })}
                        srcDoc={html}
                        sandbox="allow-scripts allow-same-origin"
                        loading="lazy"
                        className="pointer-events-none absolute left-0 top-0 origin-top-left border-0 bg-white"
                        style={{
                            width: 1920,
                            height: 1080,
                            transform: `scale(${NODE_SIZES.scene.width / 1920})`,
                        }}
                    />
                ) : (
                    <div className="flex size-full items-center justify-center">
                        <Camera className="size-5 text-gray-300" />
                    </div>
                )}
                {!hasThumb && scene.state === 'wrapped' && (
                    <div className="absolute bottom-1 end-1 rounded bg-black/40 px-1 py-0.5 text-2xs text-white">
                        {html ? t('htmlSceneLabel') : t('textSceneLabel')}
                    </div>
                )}
            </div>

            {/* Narration excerpt */}
            {scene.narrationExcerpt && (
                <p className="line-clamp-2 break-words border-t border-black/5 px-2 py-1 text-2xs italic leading-snug text-foreground/70">
                    &ldquo;{scene.narrationExcerpt}&rdquo;
                </p>
            )}
        </div>
    );
}

export const SceneNode = memo(SceneNodeInner);
