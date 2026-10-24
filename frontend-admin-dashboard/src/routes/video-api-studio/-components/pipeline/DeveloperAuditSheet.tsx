import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Check,
    CaretDown,
    CaretRight,
    Clipboard,
    Code,
    Copy,
    ArrowSquareOut,
    Terminal,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { PipelineState, PipelineEventLogEntry } from './-utils/derive-pipeline-state';
import type {
    VideoStatusMetadata,
    VideoStatusResponse,
    VideoStatusUserSelections,
} from '../../-services/video-generation';
import type { TimelineJson, TimelineShotMeta } from './-utils/parse-timeline-thumbnails';
import { useEffectiveCreditRatio } from '@/services/ai-credits/use-credit-rate';
import { formatCredits, usdToCredits } from '../../-utils/credits';

/**
 * Developer / Audit drawer — a right-side sheet that surfaces the full
 * pathway of a pipeline run: configuration, routing decisions, models,
 * chronological event log, per-shot ledger, quality-gate verdicts, and
 * artifact URLs with copy buttons. Designed for debugging, support
 * triage, and post-hoc auditing — not for end-user consumption.
 *
 * Data sources:
 *   - `state`            (derived `PipelineState` — config snapshot, scenes)
 *   - `statusResp`       (raw `/status` payload — full metadata)
 *   - `timelineJson`     (raw `timeline.json` — `meta.shots[]`, audio_tracks)
 *   - `eventLog`         (live in-memory SSE log from `CurrentGeneration`)
 *   - `apiKey`           (for prefilling curl commands)
 *
 * Everything renders top-to-bottom for scanability; sections collapse on
 * click. Every URL has a copy button. The header has a "Copy audit as
 * JSON" button that dumps the full structured audit for sharing in
 * Slack/Linear without a screenshot.
 */
interface DeveloperAuditSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    state: PipelineState;
    statusResp?: VideoStatusResponse | null;
    timelineJson?: TimelineJson | null;
    eventLog?: PipelineEventLogEntry[];
    apiKey?: string;
}

export function DeveloperAuditSheet({
    open,
    onOpenChange,
    state,
    statusResp,
    timelineJson,
    eventLog,
    apiKey,
}: DeveloperAuditSheetProps) {
    const { t } = useTranslation('videoApiStudioDeveloperAuditSheet');
    const ratio = useEffectiveCreditRatio();
    const meta = statusResp?.metadata ?? null;
    // Memoize the empty-object fallback so `sel`'s identity is stable when
    // metadata is absent — otherwise `auditJson`'s useMemo recomputes on
    // every render.
    const sel: VideoStatusUserSelections = useMemo(() => meta?.user_selections ?? {}, [meta]);

    // Aggregate AI-video credit + USD subtotals from the timeline shot meta.
    const aiVideoTotals = useMemo(() => {
        let credits = 0;
        let usd = 0;
        let shots = 0;
        for (const s of state.scenes) {
            if (typeof s.aiVideoCostCredits === 'number') {
                credits += s.aiVideoCostCredits;
                shots++;
            }
            if (typeof s.aiVideoCostUsd === 'number') {
                usd += s.aiVideoCostUsd;
            }
        }
        return { credits, usd, shots };
    }, [state.scenes]);

    // Snapshot the full audit so the "Copy as JSON" button always has the
    // current view in hand. Memoized — recomputes only when inputs change.
    const auditJson = useMemo(() => {
        return JSON.stringify(
            {
                video_id: state.videoId,
                pipeline_version: state.pipelineVersion,
                status: state.status,
                content_type: state.contentType,
                orientation: state.orientation,
                stats: state.stats,
                artifact_urls: state.artifactUrls,
                user_selections: sel,
                intent_outcomes: meta?.intent_outcomes,
                host: meta?.host,
                audio_tracks: meta?.audio_tracks,
                shot_planner:
                    state.shotPlanner?.state === 'wrapped' ? state.shotPlanner.data : undefined,
                narration_writer:
                    state.narrationWriter?.state === 'wrapped'
                        ? state.narrationWriter.data
                        : undefined,
                scenes: state.scenes,
                event_log: eventLog,
                ai_video_totals: aiVideoTotals,
                timeline_meta: timelineJson?.meta,
                generation_progress: statusResp?.generation_progress,
            },
            null,
            2
        );
    }, [state, sel, meta, eventLog, aiVideoTotals, timelineJson, statusResp]);

    const handleCopyAuditJson = async () => {
        try {
            await navigator.clipboard.writeText(auditJson);
            toast.success(t('sheet.copySuccess'));
        } catch {
            toast.error(t('sheet.copyError'));
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
                <SheetHeader className="space-y-2 border-b pb-3">
                    <SheetTitle className="flex items-center gap-2 text-base">
                        <Terminal className="size-4" />
                        {t('sheet.title')}
                        <Badge
                            variant="outline"
                            className="ms-2 h-5 border-amber-200 bg-amber-50 text-2xs text-amber-700"
                        >
                            {t('sheet.internalBadge')}
                        </Badge>
                    </SheetTitle>
                    <div className="flex flex-wrap items-center gap-2 text-2xs">
                        <CopyChip label={state.videoId} value={state.videoId} mono />
                        <Badge variant="outline" className="h-5 text-2xs">
                            {t('sheet.pipelineBadge', { version: state.pipelineVersion })}
                        </Badge>
                        <Badge variant="outline" className="h-5 text-2xs">
                            {state.status}
                        </Badge>
                        {sel.quality_tier && (
                            <Badge variant="outline" className="h-5 text-2xs">
                                {sel.quality_tier}
                            </Badge>
                        )}
                        {sel.target_stage && sel.target_stage !== 'HTML' && (
                            <Badge
                                variant="outline"
                                className="h-5 border-purple-200 bg-purple-50 text-2xs text-purple-700"
                            >
                                {t('sheet.targetBadge', { stage: sel.target_stage })}
                            </Badge>
                        )}
                        {state.stats.elapsedMs != null && (
                            <span className="font-mono text-muted-foreground">
                                {formatElapsed(state.stats.elapsedMs)}
                            </span>
                        )}
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyAuditJson}
                        className="h-7 w-full justify-center gap-1.5 text-2xs"
                    >
                        <Clipboard className="size-3" />
                        {t('sheet.copyAuditButton')}
                    </Button>
                </SheetHeader>

                <div className="mt-4 space-y-3">
                    <Section title={t('section.configuration')} defaultOpen>
                        <ConfigurationSection sel={sel} state={state} />
                    </Section>

                    <Section title={t('section.routingDecisions')}>
                        <RoutingSection meta={meta} />
                    </Section>

                    <Section title={t('section.modelsAndCosts')}>
                        <ModelsSection
                            state={state}
                            sel={sel}
                            aiVideoTotals={aiVideoTotals}
                            ratio={ratio}
                        />
                    </Section>

                    <Section title={t('section.pipelinePath')} defaultOpen>
                        <PipelinePathSection eventLog={eventLog} state={state} meta={meta} />
                    </Section>

                    <Section title={t('section.perShotLedger', { count: state.scenes.length })}>
                        <PerShotLedger state={state} />
                    </Section>

                    <Section title={t('section.artifactsAndCurl')}>
                        <ArtifactsSection
                            state={state}
                            statusResp={statusResp}
                            timelineJson={timelineJson}
                            apiKey={apiKey}
                        />
                    </Section>

                    <Section title={t('section.rawJson')}>
                        <RawJsonSection label="state (PipelineState)" value={state} />
                        {statusResp && (
                            <RawJsonSection label="/status payload" value={statusResp} />
                        )}
                        {timelineJson?.meta && (
                            <RawJsonSection label="timeline.json meta" value={timelineJson.meta} />
                        )}
                    </Section>
                </div>
            </SheetContent>
        </Sheet>
    );
}

// ── Sections ────────────────────────────────────────────────────────────

function Section({
    title,
    defaultOpen = false,
    children,
}: {
    title: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <section className="rounded-lg border bg-card">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-foreground hover:bg-muted/40"
            >
                {open ? (
                    <CaretDown className="size-3.5 text-muted-foreground" />
                ) : (
                    <CaretRight className="size-3.5 text-muted-foreground" />
                )}
                {title}
            </button>
            {open && <div className="border-t px-3 py-2.5">{children}</div>}
        </section>
    );
}

function ConfigurationSection({
    sel,
    state,
}: {
    sel: VideoStatusUserSelections;
    state: PipelineState;
}) {
    const rows: Array<[string, string | undefined]> = [
        ['video_id', state.videoId],
        ['pipeline_version', state.pipelineVersion],
        ['content_type', sel.content_type ?? state.contentType],
        ['quality_tier', sel.quality_tier],
        ['model', sel.model],
        ['orientation', sel.orientation ?? state.orientation],
        ['target_duration', sel.target_duration],
        ['target_audience', sel.target_audience],
        ['target_stage', sel.target_stage],
        ['language', sel.language],
        ['voice_gender', sel.voice_gender],
        ['tts_provider', sel.tts_provider],
        ['voice_id', sel.voice_id ?? undefined],
        ['html_quality', sel.html_quality],
        ['captions_enabled', bool(sel.captions_enabled)],
        ['background_music_enabled', bool(sel.background_music_enabled)],
        ['background_music_volume', numStr(sel.background_music_volume)],
        ['sound_effects_enabled', bool(sel.sound_effects_enabled)],
        ['sub_shots_enabled', bool(sel.sub_shots_enabled)],
        ['mute_tts_on_source_clips', bool(sel.mute_tts_on_source_clips_kwarg)],
        ['generate_avatar', bool(sel.generate_avatar)],
        ['avatar_image_url', sel.avatar_image_url ?? undefined],
        ['host.type', sel.host?.type],
        ['reference_files_count', numStr(sel.reference_files_count)],
        ['input_video_audio', sel.input_video_audio ?? undefined],
        ['input_video_ids', sel.input_video_ids?.join(', ')],
        ['routing_overrides', jsonInline(sel.routing_overrides)],
        ['visual_preferences', jsonInline(sel.visual_preferences)],
    ];
    return <KvGrid rows={rows} />;
}

function RoutingSection({ meta }: { meta: VideoStatusMetadata | null | undefined }) {
    const { t } = useTranslation('videoApiStudioDeveloperAuditSheet');
    const intent = meta?.intent_outcomes;
    if (!intent) {
        return (
            <p className="text-xs text-muted-foreground">{t('routing.noSnapshot')}</p>
        );
    }
    const tools = intent.tools_enabled ?? [];
    const scrape = intent.scrape_url_artifacts;
    const search = intent.web_search_artifacts;
    return (
        <div className="space-y-2 text-xs">
            <div className="flex flex-wrap gap-1">
                <span className="text-muted-foreground">tools_enabled:</span>
                {tools.length === 0 ? (
                    <span className="text-muted-foreground">{t('routing.none')}</span>
                ) : (
                    tools.map((tool) => (
                        <Badge
                            key={tool}
                            variant="outline"
                            className="h-5 bg-blue-50 text-2xs text-blue-700"
                        >
                            {tool}
                        </Badge>
                    ))
                )}
            </div>
            {scrape && (
                <div className="rounded border bg-muted/20 p-2">
                    <div className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        scrape_url
                    </div>
                    <KvGrid
                        rows={[
                            ['urls_attempted', scrape.urls_attempted?.join(', ')],
                            ['files_count', numStr(scrape.files_count)],
                            ['screenshot_count', numStr(scrape.screenshot_count)],
                            ['inline_image_count', numStr(scrape.inline_image_count)],
                            ['text_chars', numStr(scrape.text_chars)],
                            ['error', scrape.error],
                        ]}
                    />
                </div>
            )}
            {search && (
                <div className="rounded border bg-muted/20 p-2">
                    <div className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        web_search
                    </div>
                    <KvGrid
                        rows={[
                            ['query', search.query],
                            ['answer_chars', numStr(search.answer_chars)],
                            ['sources_count', numStr(search.sources_count)],
                            ['error', search.error],
                        ]}
                    />
                </div>
            )}
        </div>
    );
}

function ModelsSection({
    state,
    sel,
    aiVideoTotals,
    ratio,
}: {
    state: PipelineState;
    sel: VideoStatusUserSelections;
    aiVideoTotals: { credits: number; usd: number; shots: number };
    ratio: number;
}) {
    const { t } = useTranslation(['videoApiStudioDeveloperAuditSheet', 'videoApiStudioCredits']);
    const cum = state.stats.cumulativeTokens;
    const tu = state.stats.tokenUsage;
    const totalTokens = cum?.total_tokens ?? tu?.total_tokens;
    const promptTokens = cum?.prompt_tokens ?? tu?.prompt_tokens;
    const compTokens = cum?.completion_tokens ?? tu?.completion_tokens;
    const cost = cum?.estimated_cost_usd ?? tu?.estimated_cost_usd;
    return (
        <div className="space-y-2 text-xs">
            <KvGrid
                rows={[
                    ['llm_model', sel.model],
                    ['tts_provider + voice', joinDot([sel.tts_provider, sel.voice_id])],
                    ['html_quality', sel.html_quality],
                    ['total_tokens', numStr(totalTokens)],
                    ['prompt_tokens', numStr(promptTokens)],
                    ['completion_tokens', numStr(compTokens)],
                    ['estimated_cost_usd', cost != null ? `$${cost.toFixed(4)}` : undefined],
                    [
                        'estimated_cost_credits',
                        cost != null
                            ? formatCredits(usdToCredits(cost, ratio), { precision: 2, t })
                            : undefined,
                    ],
                    ['image_count', numStr(tu?.image_count)],
                    ['tts_character_count', numStr(tu?.tts_character_count)],
                    ['stock_count', numStr(tu?.stock_count)],
                    ['recorded_at', tu?.recorded_at],
                ]}
            />
            {aiVideoTotals.shots > 0 && (
                <div className="rounded border border-violet-200 bg-violet-50/40 p-2">
                    <div className="mb-1 text-2xs font-semibold uppercase tracking-wider text-violet-700">
                        {t('models.aiVideoHeading')}
                    </div>
                    <KvGrid
                        rows={[
                            ['shots', String(aiVideoTotals.shots)],
                            [
                                'cost_credits',
                                formatCredits(aiVideoTotals.credits, { precision: 1, t }),
                            ],
                            ['cost_usd', `$${aiVideoTotals.usd.toFixed(3)}`],
                        ]}
                    />
                </div>
            )}
        </div>
    );
}

function PipelinePathSection({
    eventLog,
    state,
    meta,
}: {
    eventLog?: PipelineEventLogEntry[];
    state: PipelineState;
    meta: VideoStatusMetadata | null | undefined;
}) {
    const { t } = useTranslation('videoApiStudioDeveloperAuditSheet');
    if (!eventLog || eventLog.length === 0) {
        // History-loaded runs: synthesize a coarse path from the persisted
        // state. We can't know exact event timing, but we can list the
        // ordered stages that did run based on which slots are wrapped.
        return <SynthesizedPath state={state} meta={meta} />;
    }
    return (
        <ol className="space-y-0.5 text-2xs">
            {eventLog.map((e, i) => (
                <li
                    key={i}
                    className="flex items-baseline gap-2 rounded px-1 py-0.5 hover:bg-muted/40"
                >
                    <span className="w-16 shrink-0 font-mono tabular-nums text-muted-foreground">
                        {formatRelMs(e.tsMs)}
                    </span>
                    <span
                        className={`shrink-0 rounded px-1 text-2xs font-medium uppercase tracking-wider ${eventTypeChip(
                            e.eventType
                        )}`}
                    >
                        {e.eventType}
                    </span>
                    {e.subStage && (
                        <span className="shrink-0 font-mono text-2xs text-foreground">
                            {e.subStage}
                        </span>
                    )}
                    {e.stage && (
                        <span className="shrink-0 rounded bg-slate-100 px-1 text-2xs font-medium text-slate-700">
                            {e.stage}
                        </span>
                    )}
                    {e.shotIndex != null && (
                        <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                            {t('pipelinePath.shotIndex', { index: e.shotIndex })}
                        </span>
                    )}
                    {e.shotCount != null && (
                        <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                            {t('pipelinePath.shotCount', { count: e.shotCount })}
                        </span>
                    )}
                    {e.message && (
                        <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
                            {e.message}
                        </span>
                    )}
                    {e.tokenDelta?.prompt_tokens != null && (
                        <span className="shrink-0 font-mono text-2xs tabular-nums text-amber-700">
                            +{e.tokenDelta.prompt_tokens}p/
                            {e.tokenDelta.completion_tokens ?? 0}c
                        </span>
                    )}
                    {e.error && (
                        <span className="shrink-0 text-2xs text-red-700">{e.error}</span>
                    )}
                </li>
            ))}
        </ol>
    );
}

function SynthesizedPath({
    state,
    meta,
}: {
    state: PipelineState;
    meta: VideoStatusMetadata | null | undefined;
}) {
    const { t } = useTranslation('videoApiStudioDeveloperAuditSheet');
    const items: Array<{ stage: string; status: string }> = [];
    items.push({ stage: 'Pitch', status: 'wrapped' });
    if (state.research) items.push({ stage: 'Research', status: state.research.state });
    if (state.pipelineVersion === 'v3') {
        if (state.shotPlanner)
            items.push({ stage: 'ShotPlanner', status: state.shotPlanner.state });
        if (state.narrationWriter)
            items.push({
                stage: 'NarrationWriter',
                status: state.narrationWriter.state,
            });
    } else {
        if (state.beats) items.push({ stage: 'Beats', status: state.beats.state });
        items.push({ stage: 'Screenplay', status: state.screenplay.state });
        items.push({ stage: 'Narration', status: state.narration.state });
        items.push({ stage: 'Storyboard', status: state.storyboard.state });
    }
    items.push({
        stage: t('synthesizedPath.filmingStage', { count: state.scenes.length }),
        status: state.filming.state,
    });
    if (state.talent) items.push({ stage: 'Talent', status: state.talent.state });
    if (state.score) items.push({ stage: 'Score', status: state.score.state });
    items.push({ stage: 'Final Cut', status: state.finalCut.state });

    return (
        <div className="space-y-1.5 text-2xs">
            <p className="text-2xs italic text-muted-foreground">
                {t('synthesizedPath.noLiveLog')}
            </p>
            <ol className="space-y-0.5">
                {items.map((it, i) => (
                    <li key={i} className="flex items-center gap-2">
                        <span className="w-5 shrink-0 font-mono tabular-nums text-muted-foreground">
                            {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="text-foreground">{it.stage}</span>
                        <span
                            className={`ml-auto rounded px-1 text-2xs font-medium uppercase tracking-wider ${statusChip(it.status)}`}
                        >
                            {it.status}
                        </span>
                    </li>
                ))}
            </ol>
            {meta?.user_selections?.target_stage &&
                meta.user_selections.target_stage !== 'HTML' && (
                    <p className="text-2xs text-purple-700">
                        {t('synthesizedPath.reviewModeStopped', {
                            stage: meta.user_selections.target_stage,
                        })}
                    </p>
                )}
        </div>
    );
}

function PerShotLedger({ state }: { state: PipelineState }) {
    const { t } = useTranslation('videoApiStudioDeveloperAuditSheet');
    if (state.scenes.length === 0) {
        return <p className="text-xs text-muted-foreground">{t('shotLedger.empty')}</p>;
    }
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-2xs">
                <thead className="text-muted-foreground">
                    <tr className="border-b">
                        <th className="text-left font-medium">#</th>
                        <th className="text-start font-medium">{t('shotLedger.header.type')}</th>
                        <th className="text-start font-medium">{t('shotLedger.header.intent')}</th>
                        <th className="text-start font-medium">
                            {t('shotLedger.header.background')}
                        </th>
                        <th className="text-start font-medium">{t('shotLedger.header.audio')}</th>
                        <th className="text-end font-medium">
                            {t('shotLedger.header.duration')}
                        </th>
                        <th className="text-end font-medium">{t('shotLedger.header.words')}</th>
                        <th className="text-end font-medium">
                            {t('shotLedger.header.veoCredits')}
                        </th>
                        <th className="text-start font-medium">
                            {t('shotLedger.header.veoRequest')}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {state.scenes.map((s) => {
                        const words = (s.narrationText ?? s.narrationExcerpt ?? '').trim();
                        const wc = words ? words.split(/\s+/).length : 0;
                        return (
                            <tr key={s.index} className="border-b last:border-0">
                                <td className="py-0.5 font-mono tabular-nums text-muted-foreground">
                                    {String(s.index + 1).padStart(2, '0')}
                                </td>
                                <td className="py-0.5 text-foreground">
                                    {s.shotType.replace(/_/g, ' ')}
                                </td>
                                <td className="py-0.5 text-muted-foreground">
                                    {s.intentRole ?? '—'}
                                </td>
                                <td className="py-0.5 text-muted-foreground">
                                    {s.backgroundTreatment?.replace(/_/g, ' ') ?? '—'}
                                </td>
                                <td className="py-0.5">
                                    {s.audioPolicy === 'intrinsic_only' ? (
                                        <span className="text-amber-700">
                                            {t('shotLedger.audioPolicy.intrinsic')}
                                        </span>
                                    ) : (
                                        <span className="text-muted-foreground">
                                            {t('shotLedger.audioPolicy.narrate')}
                                        </span>
                                    )}
                                </td>
                                <td className="py-0.5 text-right font-mono tabular-nums text-muted-foreground">
                                    {s.durationS.toFixed(1)}s
                                </td>
                                <td className="py-0.5 text-right font-mono tabular-nums text-muted-foreground">
                                    {wc || '—'}
                                </td>
                                <td className="py-0.5 text-right font-mono tabular-nums text-violet-700">
                                    {s.aiVideoCostCredits != null
                                        ? formatCredits(s.aiVideoCostCredits, {
                                              precision: 0,
                                              suffix: '',
                                          })
                                        : '—'}
                                </td>
                                <td className="truncate py-0.5 font-mono text-2xs text-muted-foreground">
                                    {s.aiVideoRequestId ? (
                                        <CopyChip
                                            label={truncate(s.aiVideoRequestId, 12)}
                                            value={s.aiVideoRequestId}
                                            mono
                                            tiny
                                        />
                                    ) : (
                                        '—'
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function ArtifactsSection({
    state,
    statusResp,
    timelineJson,
    apiKey,
}: {
    state: PipelineState;
    statusResp?: VideoStatusResponse | null;
    timelineJson?: TimelineJson | null;
    apiKey?: string;
}) {
    const { t } = useTranslation('videoApiStudioDeveloperAuditSheet');
    const a = state.artifactUrls;
    const baseStatus = '/external/video/v1/status';
    const baseUrls = '/external/video/v1/urls';
    const curl = (path: string) =>
        `curl -H 'X-Institute-Key: ${apiKey ?? '<API_KEY>'}' '${path}/${state.videoId}'`;

    const shotMetaCount =
        (timelineJson?.meta?.shots as TimelineShotMeta[] | undefined)?.length ?? 0;

    return (
        <div className="space-y-2 text-xs">
            <UrlRow label="script.txt" url={a.script} />
            <UrlRow label="narration.mp3" url={a.audio} />
            <UrlRow label="word_timings.json" url={a.words} />
            <UrlRow label="timeline.json" url={a.timeline} />
            <UrlRow label="rendered.mp4" url={a.videoMp4} />
            {statusResp?.s3_urls?.avatar && (
                <UrlRow label="avatar.json" url={statusResp.s3_urls.avatar} />
            )}
            {shotMetaCount > 0 && (
                <p className="text-2xs text-muted-foreground">
                    {t('artifacts.shotMetaCount', { count: shotMetaCount })}
                </p>
            )}

            <div className="mt-2 space-y-1.5 rounded border bg-slate-900 p-2 text-2xs text-slate-100">
                <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-slate-400">curl /status</span>
                    <CopyButton value={curl(baseStatus)} />
                </div>
                <pre className="overflow-x-auto font-mono text-2xs">{curl(baseStatus)}</pre>
                <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="font-mono text-slate-400">curl /urls</span>
                    <CopyButton value={curl(baseUrls)} />
                </div>
                <pre className="overflow-x-auto font-mono text-2xs">{curl(baseUrls)}</pre>
            </div>
        </div>
    );
}

function RawJsonSection({ label, value }: { label: string; value: unknown }) {
    const [open, setOpen] = useState(false);
    const json = useMemo(() => JSON.stringify(value, null, 2), [value]);
    return (
        <div className="mb-2 last:mb-0">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center gap-1.5 text-start font-mono text-2xs text-muted-foreground hover:text-foreground"
            >
                {open ? <CaretDown className="size-3" /> : <CaretRight className="size-3" />}
                {label}{' '}
                <span className="text-muted-foreground/60">
                    ({(json.length / 1024).toFixed(1)}kb)
                </span>
                <span className="ml-auto">
                    <CopyButton value={json} small />
                </span>
            </button>
            {open && (
                <pre className="mt-1 max-h-72 overflow-auto rounded border bg-slate-900 p-2 font-mono text-2xs leading-relaxed text-slate-100">
                    {json}
                </pre>
            )}
        </div>
    );
}

// ── Atoms ────────────────────────────────────────────────────────────────

function KvGrid({ rows }: { rows: Array<[string, string | undefined | null]> }) {
    const { t } = useTranslation('videoApiStudioDeveloperAuditSheet');
    const filled = rows.filter(([, v]) => v != null && v !== '');
    if (filled.length === 0)
        return <p className="text-xs text-muted-foreground">{t('kvGrid.empty')}</p>;
    return (
        <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-2xs">
            {filled.map(([k, v]) => (
                <div key={k} className="contents">
                    <span className="font-mono text-muted-foreground">{k}</span>
                    <span className="break-all text-right font-mono text-foreground">
                        {String(v)}
                    </span>
                </div>
            ))}
        </div>
    );
}

function CopyChip({
    label,
    value,
    mono,
    tiny,
}: {
    label: string;
    value: string;
    mono?: boolean;
    tiny?: boolean;
}) {
    const { t } = useTranslation('videoApiStudioDeveloperAuditSheet');
    const [copied, setCopied] = useState(false);
    const handleClick = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
        } catch {
            /* ignore */
        }
    };
    return (
        <button
            type="button"
            onClick={handleClick}
            title={t('copy.copyTitle', { value })}
            className={`inline-flex items-center gap-1 rounded border px-1.5 ${
                tiny ? 'py-0' : 'py-0.5'
            } ${
                mono ? 'font-mono' : ''
            } ${tiny ? 'text-2xs' : 'text-2xs'} bg-card text-foreground hover:bg-muted`}
        >
            {label}
            {copied ? (
                <Check className="size-3 text-green-600" />
            ) : (
                <Copy className="size-3 text-muted-foreground" />
            )}
        </button>
    );
}

function CopyButton({ value, small }: { value: string; small?: boolean }) {
    const { t } = useTranslation('videoApiStudioDeveloperAuditSheet');
    const [copied, setCopied] = useState(false);
    const handleClick = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
        } catch {
            /* ignore */
        }
    };
    return (
        <button
            type="button"
            onClick={handleClick}
            className={`inline-flex items-center gap-1 rounded text-slate-300 hover:text-slate-100 ${
                small ? 'p-0.5' : 'px-1.5 py-0.5'
            }`}
            title={t('copy.copyButtonTitle')}
        >
            {copied ? <Check className="size-3 text-green-400" /> : <Copy className="size-3" />}
        </button>
    );
}

function UrlRow({ label, url }: { label: string; url?: string }) {
    const { t } = useTranslation('videoApiStudioDeveloperAuditSheet');
    if (!url)
        return (
            <div className="flex items-center gap-2 rounded border border-dashed bg-muted/10 px-2 py-1">
                <Code className="size-3 text-muted-foreground/40" />
                <span className="font-mono text-2xs text-muted-foreground">{label}</span>
                <span className="ml-auto text-2xs text-muted-foreground/60">
                    {t('urlRow.notPresent')}
                </span>
            </div>
        );
    return (
        <div className="flex items-center gap-2 rounded border bg-card px-2 py-1">
            <Code className="size-3 text-muted-foreground" />
            <span className="font-mono text-2xs text-foreground">{label}</span>
            <span className="ms-2 min-w-0 truncate font-mono text-2xs text-muted-foreground">
                {url}
            </span>
            <CopyChip label={t('urlRow.copyLabel')} value={url} tiny />
            <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 text-muted-foreground hover:text-blue-600"
                title={t('urlRow.openInNewTab')}
            >
                <ArrowSquareOut className="size-3" />
            </a>
        </div>
    );
}

// ── Formatters ──────────────────────────────────────────────────────────

function bool(v: boolean | undefined | null): string | undefined {
    if (v == null) return undefined;
    return v ? 'true' : 'false';
}
function numStr(v: number | undefined | null): string | undefined {
    if (v == null) return undefined;
    return v.toLocaleString();
}
function jsonInline(v: unknown): string | undefined {
    if (v == null) return undefined;
    if (typeof v === 'string') return v;
    try {
        const s = JSON.stringify(v);
        if (s === '{}' || s === '[]' || s === 'null') return undefined;
        return s.length > 120 ? `${s.slice(0, 117)}…` : s;
    } catch {
        return undefined;
    }
}
function joinDot(parts: Array<string | null | undefined>): string | undefined {
    const filled = parts.filter((p): p is string => !!p);
    return filled.length ? filled.join(' · ') : undefined;
}
function truncate(s: string, n: number): string {
    return s.length > n ? `${s.slice(0, n)}…` : s;
}
function formatElapsed(ms: number): string {
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
}
function formatRelMs(ms: number): string {
    if (ms < 0) return '0.000';
    const totalSec = ms / 1000;
    const m = Math.floor(totalSec / 60);
    const s = totalSec - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}
function eventTypeChip(t: string): string {
    switch (t) {
        case 'sub_stage':
            return 'bg-blue-100 text-blue-700';
        case 'progress':
            return 'bg-slate-100 text-slate-700';
        case 'shot_done':
            return 'bg-green-100 text-green-700';
        case 'shot_error':
            return 'bg-red-100 text-red-700';
        case 'completed':
            return 'bg-emerald-100 text-emerald-700';
        default:
            return 'bg-muted text-muted-foreground';
    }
}
function statusChip(s: string): string {
    switch (s) {
        case 'wrapped':
            return 'bg-green-100 text-green-700';
        case 'in_production':
            return 'bg-blue-100 text-blue-700';
        case 'cut':
            return 'bg-red-100 text-red-700';
        case 'reshoot':
            return 'bg-amber-100 text-amber-700';
        default:
            return 'bg-slate-100 text-slate-600';
    }
}
