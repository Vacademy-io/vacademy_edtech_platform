import { FilmSlate, FileText, Globe, Image as ImageIcon, Stack as Layers, Microphone as Mic, Sparkle as Sparkles, SpeakerHigh as Volume2, X } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { RoutingPlan, RoutingToolName } from '../../-services/video-generation';

export interface AttachmentItem {
    fileId: string;
    fileName: string;
    fileType: 'image' | 'pdf';
    url: string;
    previewUrl?: string;
}

export interface IndexedVideoItem {
    id: string;
    name: string;
    kind: 'video' | 'image';
    mode: string;
    duration_seconds: number | null;
    status: string;
    progress?: number;
}

interface ContextTrayProps {
    /* Refs / attachments */
    attachments: AttachmentItem[];
    onRemoveAttachment: (fileId: string) => void;

    /* Selected source videos */
    selectedInputVideoIds: string[];
    indexedVideos: IndexedVideoItem[];
    onRemoveInputVideo: (id: string) => void;

    /* Audio source for selected source videos */
    inputVideoAudio: 'original' | 'tts';
    onInputVideoAudioChange: (mode: 'original' | 'tts') => void;
    muteTtsDuringSourceClips: boolean;
    onMuteTtsDuringSourceClipsChange: (mute: boolean) => void;

    /* Smart Plan */
    routerPlan: RoutingPlan | null;
    routerLoading: boolean;
    isToolEnabled: (name: RoutingToolName) => boolean;
    isToolOverridden: (name: RoutingToolName) => boolean;
    onToggleTool: (name: RoutingToolName) => void;
    cfgValue: <K extends 'mute_tts_on_source_clips' | 'infographic_mode'>(
        key: K
    ) => K extends 'infographic_mode' ? 'overlay' | 'side' : boolean;
    isCfgOverridden: (key: 'mute_tts_on_source_clips' | 'infographic_mode') => boolean;
    onToggleMuteTtsCfg: () => void;
    onToggleOverlayCfg: () => void;
    routerExplanationOpen: boolean;
    onToggleRouterExplanation: () => void;

    /* Web capture (URL detection) */
    detectedUrls: string[];
    ignoredUrls: Set<string>;
    onSetUrlIgnored: (url: string, ignored: boolean) => void;
}

export function ContextTray(props: ContextTrayProps) {
    const { attachments, selectedInputVideoIds, routerPlan, routerLoading, detectedUrls } = props;

    // Hide entire tray when nothing is active
    const hasAny =
        attachments.length > 0 ||
        selectedInputVideoIds.length > 0 ||
        !!routerPlan ||
        routerLoading ||
        detectedUrls.length > 0;
    if (!hasAny) return null;

    return (
        <div className="space-y-1.5">
            <RefsRow attachments={attachments} onRemove={props.onRemoveAttachment} />
            <SourcesRow
                selectedIds={selectedInputVideoIds}
                indexedVideos={props.indexedVideos}
                onRemove={props.onRemoveInputVideo}
            />
            <AudioSourceRow
                hasSources={selectedInputVideoIds.length > 0}
                singleSource={selectedInputVideoIds.length === 1}
                inputVideoAudio={props.inputVideoAudio}
                onInputVideoAudioChange={props.onInputVideoAudioChange}
                muteTtsDuringSourceClips={props.muteTtsDuringSourceClips}
                onMuteTtsDuringSourceClipsChange={props.onMuteTtsDuringSourceClipsChange}
            />
            <SmartPlanRow {...props} />
            <WebCaptureRow
                detectedUrls={detectedUrls}
                ignoredUrls={props.ignoredUrls}
                onSetIgnored={props.onSetUrlIgnored}
            />
        </div>
    );
}

function AudioSourceRow({
    hasSources,
    singleSource,
    inputVideoAudio,
    onInputVideoAudioChange,
    muteTtsDuringSourceClips,
    onMuteTtsDuringSourceClipsChange,
}: {
    hasSources: boolean;
    singleSource: boolean;
    inputVideoAudio: 'original' | 'tts';
    onInputVideoAudioChange: (mode: 'original' | 'tts') => void;
    muteTtsDuringSourceClips: boolean;
    onMuteTtsDuringSourceClipsChange: (mute: boolean) => void;
}) {
    const { t } = useTranslation('videoApiStudioContextTray');
    if (!hasSources) return null;
    // Original-audio mode is only meaningful for a single source clip — with
    // multiple clips, the mix is ambiguous, so we force TTS narration.
    const originalAvailable = singleSource;
    return (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50/30 px-2 py-1.5 dark:border-indigo-800 dark:bg-indigo-950/20">
            <span className="shrink-0 text-2xs font-medium uppercase tracking-wider text-indigo-500">
                {t('audio.label')}
            </span>
            <div className="inline-flex shrink-0 rounded-md border bg-background p-0.5">
                <button
                    type="button"
                    disabled={!originalAvailable}
                    onClick={() => originalAvailable && onInputVideoAudioChange('original')}
                    title={
                        originalAvailable
                            ? t('audio.originalTitleAvailable')
                            : t('audio.originalTitleUnavailable')
                    }
                    className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors ${
                        inputVideoAudio === 'original'
                            ? 'bg-indigo-500 text-white shadow-sm'
                            : originalAvailable
                              ? 'text-muted-foreground hover:text-foreground'
                              : 'cursor-not-allowed text-muted-foreground/40'
                    }`}
                >
                    <Volume2 className="size-3" />
                    {t('audio.original')}
                </button>
                <button
                    type="button"
                    onClick={() => onInputVideoAudioChange('tts')}
                    className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors ${
                        inputVideoAudio === 'tts'
                            ? 'bg-indigo-500 text-white shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                    <Mic className="size-3" />
                    {t('audio.aiNarration')}
                </button>
            </div>
            {/* Secondary toggle — only meaningful when TTS is the primary track */}
            {inputVideoAudio === 'tts' && (
                <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-2xs text-muted-foreground">
                    <input
                        type="checkbox"
                        className="size-3 rounded border-border accent-indigo-500"
                        checked={muteTtsDuringSourceClips}
                        onChange={(e) => onMuteTtsDuringSourceClipsChange(e.target.checked)}
                    />
                    {t('audio.muteTtsDuringSourceClips')}
                </label>
            )}
        </div>
    );
}

/* ============================================================ */
/*  Sub-rows                                                    */
/* ============================================================ */

function RefsRow({
    attachments,
    onRemove,
}: {
    attachments: AttachmentItem[];
    onRemove: (fileId: string) => void;
}) {
    const { t } = useTranslation('videoApiStudioContextTray');
    if (attachments.length === 0) return null;
    return (
        <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-2 py-1.5">
            <span className="shrink-0 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('refs.label', { count: attachments.length })}
            </span>
            <div className="flex flex-1 items-center gap-1.5 overflow-x-auto">
                {attachments.map((a) => (
                    <div
                        key={a.fileId}
                        className="group flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs"
                        title={a.fileName}
                    >
                        {a.fileType === 'image' ? (
                            a.previewUrl ? (
                                <img
                                    src={a.previewUrl}
                                    alt={a.fileName}
                                    className="size-6 rounded object-cover"
                                />
                            ) : (
                                <ImageIcon className="size-4 text-blue-500" />
                            )
                        ) : (
                            <FileText className="size-4 text-red-500" />
                        )}
                        <span className="max-w-24 truncate">{a.fileName}</span>
                        <button
                            type="button"
                            onClick={() => onRemove(a.fileId)}
                            className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                            aria-label={t('refs.removeAria', { fileName: a.fileName })}
                        >
                            <X className="size-3.5" />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function SourcesRow({
    selectedIds,
    indexedVideos,
    onRemove,
}: {
    selectedIds: string[];
    indexedVideos: IndexedVideoItem[];
    onRemove: (id: string) => void;
}) {
    const { t } = useTranslation('videoApiStudioContextTray');
    if (selectedIds.length === 0) return null;
    return (
        <div className="flex items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50/30 px-2 py-1.5 dark:border-indigo-800 dark:bg-indigo-950/20">
            <span className="shrink-0 text-2xs font-medium uppercase tracking-wider text-indigo-500">
                {t('sources.label', { count: selectedIds.length })}
            </span>
            <div className="flex flex-1 items-center gap-1.5 overflow-x-auto">
                {selectedIds.map((id, idx) => {
                    const video = indexedVideos.find((v) => v.id === id);
                    const label = String.fromCharCode(65 + idx);
                    const videoName = video?.name || t('sources.unknown');
                    return (
                        <div
                            key={id}
                            className="group flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs"
                            title={video?.name || id}
                        >
                            <span className="flex size-4 items-center justify-center rounded-sm bg-indigo-500 text-2xs font-bold text-white">
                                {label}
                            </span>
                            {video?.kind === 'image' ? (
                                <ImageIcon className="size-3 shrink-0 text-muted-foreground" />
                            ) : (
                                <FilmSlate className="size-3 shrink-0 text-muted-foreground" />
                            )}
                            <span className="max-w-32 truncate font-medium">{videoName}</span>
                            <span className="text-muted-foreground">{video?.mode}</span>
                            <button
                                type="button"
                                onClick={() => onRemove(id)}
                                className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                                aria-label={t('sources.removeAria', { name: videoName })}
                            >
                                <X className="size-3.5" />
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function SmartPlanRow(props: ContextTrayProps) {
    const { t } = useTranslation('videoApiStudioContextTray');
    const {
        routerPlan,
        routerLoading,
        selectedInputVideoIds,
        isToolEnabled,
        isToolOverridden,
        onToggleTool,
        cfgValue,
        isCfgOverridden,
        onToggleMuteTtsCfg,
        onToggleOverlayCfg,
        routerExplanationOpen,
        onToggleRouterExplanation,
    } = props;

    if (!routerPlan && !routerLoading) return null;

    return (
        <div className="flex flex-col gap-1.5 rounded-md border border-violet-200 bg-violet-50/30 px-2 py-1.5 dark:border-violet-800 dark:bg-violet-950/20">
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="shrink-0 text-2xs font-medium uppercase tracking-wider text-violet-600">
                    {t('smartPlan.label')}
                </span>
                {routerLoading && !routerPlan && (
                    <span className="text-2xs text-muted-foreground">
                        {t('smartPlan.analyzing')}
                    </span>
                )}
                {routerPlan?.tools?.find((tool) => tool.name === 'scrape_url') && (
                    <button
                        type="button"
                        onClick={() => onToggleTool('scrape_url')}
                        className={`group flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition ${
                            isToolEnabled('scrape_url')
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40'
                                : 'border-dashed bg-muted/30 text-muted-foreground'
                        }`}
                        title={
                            routerPlan.tools.find((tool) => tool.name === 'scrape_url')?.reason ||
                            ''
                        }
                    >
                        <Globe className="size-3.5" />
                        <span>
                            {isToolEnabled('scrape_url')
                                ? t('smartPlan.captureWebsite')
                                : t('smartPlan.skipWebsite')}
                        </span>
                        <span
                            className={`ms-1 rounded px-1 text-2xs uppercase ${
                                isToolOverridden('scrape_url')
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                    : 'bg-muted text-muted-foreground'
                            }`}
                        >
                            {isToolOverridden('scrape_url')
                                ? t('smartPlan.manual')
                                : t('smartPlan.auto')}
                        </span>
                    </button>
                )}
                {routerPlan?.tools?.find((tool) => tool.name === 'web_search') && (
                    <button
                        type="button"
                        onClick={() => onToggleTool('web_search')}
                        className={`group flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition ${
                            isToolEnabled('web_search')
                                ? 'border-sky-300 bg-sky-50 text-sky-700 dark:bg-sky-950/40'
                                : 'border-dashed bg-muted/30 text-muted-foreground'
                        }`}
                        title={
                            routerPlan.tools.find((tool) => tool.name === 'web_search')?.reason ||
                            ''
                        }
                    >
                        <Sparkles className="size-3.5" />
                        <span>
                            {isToolEnabled('web_search')
                                ? t('smartPlan.webSearch')
                                : t('smartPlan.skipSearch')}
                        </span>
                        <span
                            className={`ms-1 rounded px-1 text-2xs uppercase ${
                                isToolOverridden('web_search')
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                    : 'bg-muted text-muted-foreground'
                            }`}
                        >
                            {isToolOverridden('web_search')
                                ? t('smartPlan.manual')
                                : t('smartPlan.auto')}
                        </span>
                    </button>
                )}
                {selectedInputVideoIds.length > 0 && routerPlan && (
                    <button
                        type="button"
                        onClick={onToggleMuteTtsCfg}
                        className={`group flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition ${
                            cfgValue('mute_tts_on_source_clips')
                                ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40'
                                : 'border-dashed bg-muted/30 text-muted-foreground'
                        }`}
                        title={t('smartPlan.muteTtsTitle')}
                    >
                        <Volume2 className="size-3.5" />
                        <span>
                            {cfgValue('mute_tts_on_source_clips')
                                ? t('smartPlan.muteTtsOnClips')
                                : t('smartPlan.ttsOverClips')}
                        </span>
                        <span
                            className={`ms-1 rounded px-1 text-2xs uppercase ${
                                isCfgOverridden('mute_tts_on_source_clips')
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                    : 'bg-muted text-muted-foreground'
                            }`}
                        >
                            {isCfgOverridden('mute_tts_on_source_clips')
                                ? t('smartPlan.manual')
                                : t('smartPlan.auto')}
                        </span>
                    </button>
                )}
                {selectedInputVideoIds.length > 0 && routerPlan && (
                    <button
                        type="button"
                        onClick={onToggleOverlayCfg}
                        className={`group flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition ${
                            cfgValue('infographic_mode') === 'overlay'
                                ? 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-950/40'
                                : 'border-dashed bg-muted/30 text-muted-foreground'
                        }`}
                        title={t('smartPlan.overlayTitle')}
                    >
                        <Layers className="size-3.5" />
                        <span>
                            {cfgValue('infographic_mode') === 'overlay'
                                ? t('smartPlan.overlayInfographics')
                                : t('smartPlan.sideInfographics')}
                        </span>
                        <span
                            className={`ms-1 rounded px-1 text-2xs uppercase ${
                                isCfgOverridden('infographic_mode')
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                    : 'bg-muted text-muted-foreground'
                            }`}
                        >
                            {isCfgOverridden('infographic_mode')
                                ? t('smartPlan.manual')
                                : t('smartPlan.auto')}
                        </span>
                    </button>
                )}
                {routerPlan?.explanation && (
                    <button
                        type="button"
                        onClick={onToggleRouterExplanation}
                        className="ml-auto shrink-0 text-2xs text-violet-600 hover:underline"
                    >
                        {routerExplanationOpen ? t('smartPlan.hideWhy') : t('smartPlan.why')}
                    </button>
                )}
            </div>
            {routerExplanationOpen && routerPlan?.explanation && (
                <div className="rounded bg-background/60 p-2 text-2xs leading-relaxed text-muted-foreground">
                    {routerPlan.explanation}
                </div>
            )}
        </div>
    );
}

function WebCaptureRow({
    detectedUrls,
    ignoredUrls,
    onSetIgnored,
}: {
    detectedUrls: string[];
    ignoredUrls: Set<string>;
    onSetIgnored: (url: string, ignored: boolean) => void;
}) {
    const { t } = useTranslation('videoApiStudioContextTray');
    if (detectedUrls.length === 0) return null;
    return (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/30 px-2 py-1.5 dark:border-emerald-800 dark:bg-emerald-950/20">
            <span className="shrink-0 text-2xs font-medium uppercase tracking-wider text-emerald-600">
                {t('webCapture.label')}
            </span>
            <div className="flex flex-1 items-center gap-1.5 overflow-x-auto">
                {detectedUrls.map((url) => {
                    let host = url;
                    try {
                        host = new URL(url).host.replace(/^www\./, '');
                    } catch {
                        /* noop */
                    }
                    const isIgnored = ignoredUrls.has(url);
                    return (
                        <div
                            key={url}
                            className={`group flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                                isIgnored
                                    ? 'border-dashed bg-muted/30 text-muted-foreground line-through'
                                    : 'bg-background'
                            }`}
                            title={
                                isIgnored
                                    ? t('webCapture.ignoredTitle', { url })
                                    : t('webCapture.activeTitle', { url })
                            }
                        >
                            <Globe className="size-3.5 text-emerald-600" />
                            <span className="max-w-40 truncate font-medium">{host}</span>
                            {isIgnored ? (
                                <button
                                    type="button"
                                    onClick={() => onSetIgnored(url, false)}
                                    className="ms-0.5 rounded-full px-1 text-2xs text-muted-foreground hover:text-emerald-600"
                                    aria-label={t('webCapture.reEnableAria', { host })}
                                >
                                    {t('webCapture.undo')}
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => onSetIgnored(url, true)}
                                    className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                                    aria-label={t('webCapture.skipAria', { host })}
                                >
                                    <X className="size-3.5" />
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
