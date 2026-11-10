/**
 * Lesson player: one slide of a chapter on the full stage, with Previous /
 * Next through the chapter in the top bar (history REPLACE, so Back returns
 * to the lesson list in one step).
 *
 * Switch (slideSource.ts):
 *   PPT_ANIM      → reused deck-player.tsx (namespace studyLibraryDeckPlayer)
 *   PDF           → PanelPdfViewer (pdfjs 3.11 legacy + local classic worker)
 *   PRESENTATION  → ContentSceneView (static Excalidraw export)
 *   FILE_ID video → PanelVideo → reused file-video-player.tsx (fileVideoPlayer)
 *   HTML_VIDEO    → MP4 from /lms-video/v1/render when rendered, else a card
 *   YouTube/Vimeo → EmbedPlayer
 *   anything else → "Open this on a computer"
 * Signed URLs are resolved on every open (seams/fileSource, by default
 * useSignedUrl: staleTime/gcTime 0).
 * Every heavy player is its own lazy chunk.
 *
 * Phone remote (seams/remoteTarget): this component drives scene, file-video
 * and ai-video slides. PanelPdfViewer registers for PDF pages itself, and deck,
 * YouTube, Vimeo, missing and unsupported slides have no target.
 */
import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isAxiosError } from 'axios';
import { CaretLeft, CaretRight, Desktop, FilmStrip, Folder } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { PanelTopBar } from '../components/PanelTopBar';
import { PanelStage } from '../components/PanelStage';
import { PanelEmpty, PanelError, PanelLoading } from '../components/PanelScreenState';
import { PanelScreenErrorBoundary } from '../components/PanelErrorBoundary';
import { ensureNamespaces } from '../i18n';
import { goBack, navigate } from '../router';
import { useLessonFileUrl, type LessonFileKind } from '../seams/fileSource';
import { useRemoteTarget } from '../seams/remoteTarget';
import { useActivityLog } from '../device/activityLog';
import { useAiVideoRender, useSlides } from './lessonApi';
import { lessonPathFrom, slideScopeOf, toParams } from './lessonPath';
import { EmbedPlayer } from './EmbedPlayer';
import { SLIDE_TYPE_ICONS } from './slideIcons';
import { resolveSlideSource, type PlayableSource } from './slideSource';

const DeckPlayer = lazy(
    () =>
        import(
            '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/deck-player'
        )
);
const PanelVideo = lazy(() => import('./PanelVideo'));
const PanelPdfViewer = lazy(() => import('./PanelPdfViewer'));
const ContentSceneView = lazy(() => import('./ContentSceneView'));

/** Stage colour per player: video-like players sit on black. */
const DARK_KINDS: PlayableSource['kind'][] = ['deck', 'youtube', 'vimeo'];

/** Slide kinds where a remote press moves to the previous / next slide. */
const REMOTE_SLIDE_KINDS: PlayableSource['kind'][] = ['scene', 'file-video', 'ai-video'];

function Centered({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <div className={cn('flex size-full items-center justify-center overflow-auto', className)}>
            {children}
        </div>
    );
}

/** Loads the reused admin players' i18n namespaces before they mount. */
function NamespaceGate({ namespaces, children }: { namespaces: string[]; children: ReactNode }) {
    const key = namespaces.join(',');
    const [ready, setReady] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setReady(false);
        void ensureNamespaces(key.split(',')).then(() => {
            if (!cancelled) setReady(true);
        });
        return () => {
            cancelled = true;
        };
    }, [key]);
    // bg-background: deck players sit on the dark stage, where PanelLoading's
    // neutral text is unreadable.
    return ready ? <>{children}</> : <PanelLoading className="size-full bg-background" />;
}

interface SignedControls {
    /** Changes whenever a fresh URL arrives: use as the player's key. */
    version: number;
    retry: () => void;
    /** One automatic refresh for an expired link; undefined once used. */
    expired?: () => void;
}

/** Resolves a media file id to a fresh signed URL, with loading / error states. */
function SignedUrlGate({
    fileId,
    kind,
    render,
}: {
    fileId: string;
    kind: LessonFileKind;
    render: (url: string, controls: SignedControls) => ReactNode;
}) {
    const { t } = useTranslation('content');
    const signed = useLessonFileUrl(fileId, kind);
    const [autoRefreshUsed, setAutoRefreshUsed] = useState(false);
    const { refetch } = signed;

    if (signed.isLoading) return <PanelLoading className="size-full" label={t('player.opening')} />;
    if (signed.isError || !signed.data) {
        return (
            <Centered>
                <PanelError
                    title={t('player.fileErrorTitle')}
                    description={t('player.fileErrorBody')}
                    detail={signed.error instanceof Error ? signed.error.message : undefined}
                    onRetry={() => void refetch()}
                />
            </Centered>
        );
    }
    return (
        <>
            {render(signed.data, {
                version: signed.dataUpdatedAt,
                retry: () => {
                    setAutoRefreshUsed(false);
                    void refetch();
                },
                expired: autoRefreshUsed
                    ? undefined
                    : () => {
                          setAutoRefreshUsed(true);
                          void refetch();
                      },
            })}
        </>
    );
}

function AiVideo({ videoId }: { videoId: string }) {
    const { t } = useTranslation('content');
    const render = useAiVideoRender(videoId);
    const { refetch } = render;

    if (render.isLoading) return <PanelLoading className="size-full" label={t('player.opening')} />;

    const notReady = (description: string) => (
        <Centered>
            <PanelEmpty
                icon={FilmStrip}
                title={t('player.aiNotReadyTitle')}
                description={description}
                action={
                    <MyButton
                        buttonType="secondary"
                        scale="large"
                        className="h-16 px-8"
                        onClick={() => void refetch()}
                    >
                        {t('common.retry', { ns: 'panel' })}
                    </MyButton>
                }
            />
        </Centered>
    );

    if (render.isError) {
        // 404 = this video was never rendered through /lms-video.
        if (isAxiosError(render.error) && render.error.response?.status === 404) {
            return notReady(t('player.aiNotReadyBody'));
        }
        return (
            <Centered>
                <PanelError
                    detail={render.error instanceof Error ? render.error.message : undefined}
                    onRetry={() => void refetch()}
                />
            </Centered>
        );
    }
    const state = render.data;
    if (state && state.status === 'completed' && state.video_url) {
        const url = state.video_url;
        return (
            <NamespaceGate namespaces={['fileVideoPlayer']}>
                <PanelVideo key={render.dataUpdatedAt} src={url} onRetry={() => void refetch()} />
            </NamespaceGate>
        );
    }
    if (state && (state.status === 'queued' || state.status === 'running')) {
        return notReady(t('player.aiRendering', { progress: state.progress }));
    }
    return notReady(t('player.aiNotReadyBody'));
}

function SourceView({
    source,
    typeLabel,
    title,
}: {
    source: PlayableSource;
    typeLabel: string;
    title: string;
}) {
    const { t } = useTranslation('content');
    switch (source.kind) {
        case 'deck':
            return (
                <NamespaceGate namespaces={['studyLibraryDeckPlayer']}>
                    <div className="size-full p-4">
                        <DeckPlayer baseUrl={source.baseUrl} />
                    </div>
                </NamespaceGate>
            );
        case 'pdf':
            return (
                <SignedUrlGate
                    fileId={source.fileId}
                    kind="pdf"
                    render={(url, controls) => (
                        <PanelPdfViewer
                            key={controls.version}
                            url={url}
                            title={title}
                            onRetry={controls.retry}
                        />
                    )}
                />
            );
        case 'scene':
            return (
                <SignedUrlGate
                    fileId={source.fileId}
                    kind="scene"
                    render={(url, controls) => (
                        <ContentSceneView
                            key={controls.version}
                            url={url}
                            cacheKey={source.fileId}
                            onRetry={controls.retry}
                        />
                    )}
                />
            );
        case 'file-video':
            return (
                <NamespaceGate namespaces={['fileVideoPlayer']}>
                    <SignedUrlGate
                        fileId={source.fileId}
                        kind="file-video"
                        render={(url, controls) => (
                            <PanelVideo
                                key={controls.version}
                                src={url}
                                onExpired={controls.expired}
                                onRetry={controls.retry}
                            />
                        )}
                    />
                </NamespaceGate>
            );
        case 'ai-video':
            return <AiVideo videoId={source.videoId} />;
        case 'youtube':
            return <EmbedPlayer provider="youtube" videoId={source.videoId} />;
        case 'vimeo':
            return <EmbedPlayer provider="vimeo" videoId={source.videoId} />;
        case 'missing':
            return (
                <Centered>
                    <PanelEmpty
                        icon={source.type === 'aiVideo' ? FilmStrip : SLIDE_TYPE_ICONS[source.type]}
                        title={
                            source.type === 'aiVideo'
                                ? t('player.aiNotReadyTitle')
                                : t('player.missingTitle')
                        }
                        description={
                            source.type === 'aiVideo'
                                ? t('player.aiNotReadyBody')
                                : t('player.missingBody')
                        }
                    />
                </Centered>
            );
        default:
            return (
                <Centered>
                    <PanelEmpty
                        icon={Desktop}
                        title={t('player.unsupportedTitle')}
                        description={t('player.unsupportedBody', { type: typeLabel })}
                    />
                </Centered>
            );
    }
}

export function PanelPlayer({ params }: { params: Record<string, string> }) {
    const { t } = useTranslation('content');
    const path = lessonPathFrom(params);
    const slideId = params.slideId;
    const slidesQuery = useSlides(slideScopeOf(path));
    const slides = slidesQuery.data || [];
    const index = slideId ? slides.findIndex((slide) => slide.id === slideId) : -1;
    const slide = index >= 0 ? slides[index] : undefined;
    const previous = index > 0 ? slides[index - 1] : undefined;
    const next = index >= 0 ? slides[index + 1] : undefined;

    const open = (target: { id: string } | undefined) => {
        if (!target) return;
        navigate('lessons', toParams(path, { view: 'player', slideId: target.id }), {
            replace: true,
        });
    };
    const backToList = () => navigate('lessons', toParams(path), { replace: true });

    const source = slide ? resolveSlideSource(slide) : null;
    const typeLabel = source ? t(`types.${source.type}`) : '';
    const slideTitle = slide?.title || typeLabel;
    useActivityLog(
        slide
            ? {
                  kind: 'LESSON',
                  ref_id: slide.id,
                  parent_id: path.chapterId || path.psId,
                  title: slideTitle,
              }
            : null
    );

    useRemoteTarget(
        slide && source && REMOTE_SLIDE_KINDS.indexOf(source.kind) >= 0
            ? {
                  next: () => open(next),
                  prev: () => open(previous),
                  state: { index, total: slides.length, title: slideTitle },
              }
            : null
    );

    let body: ReactNode;
    if (slidesQuery.isLoading) {
        body = <PanelLoading className="size-full" label={t('player.opening')} />;
    } else if (slidesQuery.isError) {
        body = (
            <Centered>
                <PanelError
                    title={t('errors.load')}
                    description={t('errors.loadHint')}
                    onRetry={() => void slidesQuery.refetch()}
                />
            </Centered>
        );
    } else if (!slide || !source) {
        body = (
            <Centered>
                <PanelEmpty
                    icon={Folder}
                    title={t('errors.notFound')}
                    description={t('errors.notFoundHint')}
                    action={
                        <MyButton
                            buttonType="secondary"
                            scale="large"
                            className="h-16 px-8"
                            onClick={backToList}
                        >
                            {t('errors.backToList')}
                        </MyButton>
                    }
                />
            </Centered>
        );
    } else {
        body = (
            <PanelScreenErrorBoundary
                key={slide.id}
                fallback={(error, reset) => (
                    // Light surface: on the dark (deck/YouTube/Vimeo) stage PanelError's
                    // neutral text was ~1.7:1.
                    <Centered className="bg-background">
                        <PanelError
                            title={t('errors.screenTitle', { ns: 'panel' })}
                            description={t('errors.screenBody', { ns: 'panel' })}
                            detail={error}
                            onRetry={reset}
                        />
                    </Centered>
                )}
            >
                <Suspense
                    fallback={
                        <PanelLoading
                            className="size-full bg-background"
                            label={t('player.opening')}
                        />
                    }
                >
                    <SourceView source={source} typeLabel={typeLabel} title={slideTitle} />
                </Suspense>
            </PanelScreenErrorBoundary>
        );
    }

    const actions =
        slides.length > 1 && slide ? (
            <div className="flex items-center space-x-3">
                <MyButton
                    buttonType="secondary"
                    layoutVariant="icon"
                    scale="large"
                    className="size-16 shrink-0"
                    aria-label={t('player.previous')}
                    title={t('player.previous')}
                    disable={!previous}
                    onClick={() => open(previous)}
                >
                    <CaretLeft size={32} />
                </MyButton>
                <span className="hidden whitespace-nowrap text-h3 tabular-nums text-neutral-600 lg:inline">
                    {t('player.position', { current: index + 1, total: slides.length })}
                </span>
                <MyButton
                    buttonType="secondary"
                    layoutVariant="icon"
                    scale="large"
                    className="size-16 shrink-0"
                    aria-label={t('player.next')}
                    title={t('player.next')}
                    disable={!next}
                    onClick={() => open(next)}
                >
                    <CaretRight size={32} />
                </MyButton>
            </div>
        ) : undefined;

    const dark = !!source && DARK_KINDS.indexOf(source.kind) >= 0;

    return (
        <PanelStage>
            <PanelTopBar
                title={slide?.title || typeLabel || t('title')}
                onBack={goBack}
                actions={actions}
            />
            <div
                className={cn(
                    'relative min-h-0 flex-1',
                    dark ? 'bg-neutral-900' : 'bg-neutral-100'
                )}
            >
                {body}
            </div>
        </PanelStage>
    );
}
