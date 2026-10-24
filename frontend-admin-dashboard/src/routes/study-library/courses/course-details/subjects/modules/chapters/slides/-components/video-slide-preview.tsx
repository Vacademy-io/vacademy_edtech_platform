'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Slide } from '../-hooks/use-slides';
import { useMediaNavigationStore } from '../-stores/media-navigation-store';
import { getPublicUrl } from '@/services/upload_file';
import YouTubePlayer from './youtube-player';
import { toast } from 'sonner';
import { GET_VIDEO_URLS } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { AIContentPlayer } from '@/components/ai-video-player/AIContentPlayer';
import { SplitScreenSlide } from './split-screen-slide';
import { FileVideoPlayer } from './file-video-player';
import { FileVideoQuestionsEditor } from './file-video-questions-editor';
import { useSlideDownloadAccess } from '@/hooks/useSlideDownloadAccess';
import { resolveVideoSourceType, extractVimeoId } from '@/utils/video-source-type';
import { useLmsVideoStatus } from '../-hooks/use-lms-video-status';
import {
    AiVideoCheckingCard,
    AiVideoEndedCard,
    AiVideoProgressCard,
} from './ai-video-generation-status';
import { AiVideoRenderBar } from './ai-video-render-bar';

const VideoSlidePreview = ({ activeItem, embedUrl }: { activeItem: Slide; embedUrl?: string }) => {
    const { t } = useTranslation('studyLibraryVideoSlidePreview');
    const { videoSeekTime, clearVideoSeekTime } = useMediaNavigationStore();
    // Per-role enforcement: keep native video download off unless this role is allowed.
    const { canDownload } = useSlideDownloadAccess();
    const allowVideoDownload = canDownload('VIDEO');
    // Raw value: it still has to carry slide-level types such as HTML_VIDEO.
    // Player choice between Vimeo/YouTube goes through resolveVideoSourceType
    // below, because the `||` fallback turns a blank source_type into 'VIDEO'.
    const videoSourceType = activeItem.video_slide?.source_type || (activeItem as any).source_type;
    const videoStatus = activeItem.status;
    // const videoTitle = activeItem.video_slide?.title || 'Video';
    const videoRef = useRef<HTMLVideoElement>(null);

    const fileId =
        videoStatus === 'PUBLISHED'
            ? activeItem.video_slide?.published_url
            : activeItem.video_slide?.url;

    const [videoUrl, setVideoUrl] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isUrlExpired, setIsUrlExpired] = useState(false);
    const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
    const isMountedRef = useRef(true);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        };
    }, []);

    // HTML_VIDEO state
    const [htmlVideoData, setHtmlVideoData] = useState<{
        htmlUrl: string;
        audioUrl: string | null;
    } | null>(null);
    const [isLoadingHtmlVideo, setIsLoadingHtmlVideo] = useState(false);

    // AI videos made from "Add Slide → AI Video" report live progress through
    // /lms-video/v1/status. Anything that endpoint doesn't know (404 — e.g.
    // course-builder videos) keeps the /video/urls path below unchanged.
    const aiGenVideoId =
        videoSourceType === 'HTML_VIDEO'
            ? activeItem.html_video_slide?.ai_gen_video_id || undefined
            : undefined;
    const lmsVideo = useLmsVideoStatus(aiGenVideoId);
    const lmsReadyForPlayer = lmsVideo.phase === 'legacy' || lmsVideo.phase === 'completed';

    // Reset state when switching to a different video slide
    useEffect(() => {
        setVideoUrl('');
        setIsLoading(true);
        setError(null);
        setIsUrlExpired(false);
        setHtmlVideoData(null);
        setIsLoadingHtmlVideo(false);
    }, [activeItem.id]);

    // Fetch HTML_VIDEO URLs when source_type is HTML_VIDEO
    useEffect(() => {
        const fetchHtmlVideoUrls = async () => {
            if (videoSourceType !== 'HTML_VIDEO') return;
            // Wait until the LMS status says the video is done (or isn't an LMS one).
            if (!lmsReadyForPlayer) return;

            const htmlVideoSlide = (activeItem as any).html_video_slide;
            if (!htmlVideoSlide?.ai_gen_video_id) {
                console.warn('[VideoSlidePreview] HTML_VIDEO slide missing ai_gen_video_id');
                setIsLoadingHtmlVideo(false);
                return;
            }


            setIsLoadingHtmlVideo(true);
            setError(null);

            try {
                const videoUrlsEndpoint = GET_VIDEO_URLS(htmlVideoSlide.ai_gen_video_id);


                const response = await authenticatedAxiosInstance.get(videoUrlsEndpoint);

                if (response.data.status === 'IN_PROGRESS') {
                    setError('work in progress');
                    setIsLoadingHtmlVideo(false);
                    return;
                }

                if (!response.data.html_url) {
                    throw new Error('Invalid response: missing html_url');
                }

                setHtmlVideoData({
                    htmlUrl: response.data.html_url,
                    audioUrl: response.data.audio_url || null,
                });
            } catch (err: any) {
                console.error('[VideoSlidePreview] Error fetching HTML video URLs:', err);
                console.error('[VideoSlidePreview] Error details:', {
                    status: err.response?.status,
                    statusText: err.response?.statusText,
                    data: err.response?.data,
                });
                if (err.response?.status === 404) {
                    // Video might still be generating - don't set error, show "generating" message instead

                    setError(null);
                } else {
                    setError(t('errors.loadUrlsFailed'));
                }
            } finally {
                setIsLoadingHtmlVideo(false);
            }
        };

        fetchHtmlVideoUrls();
    }, [activeItem.id, videoSourceType, lmsReadyForPlayer]);

    const refreshS3Url = async () => {
        try {
            setIsLoading(true);
            const url = await getPublicUrl(fileId!);
            if (isMountedRef.current) {
                setVideoUrl(url);
                setIsUrlExpired(false);
            }
        } catch (err) {
            console.error('Error refreshing video URL:', err);
            if (isMountedRef.current) setError(t('errors.refreshFailed'));
        } finally {
            if (isMountedRef.current) setIsLoading(false);
        }
    };

    //   video seeking when videoSeekTime changes
    useEffect(() => {
        if (videoSeekTime !== null && videoRef.current) {
            const video = videoRef.current;

            const handleSeek = () => {
                video.currentTime = videoSeekTime;
                clearVideoSeekTime();
                toast.success(
                    t('toast.jumpedTo', {
                        time: `${Math.floor(videoSeekTime / 60)}:${Math.floor(videoSeekTime % 60)
                            .toString()
                            .padStart(2, '0')}`,
                    })
                );
            };

            if (video.readyState >= 2) {
                handleSeek();
                return undefined; // Explicit return, but not necessary in React
            } else {
                const onLoadedData = () => {
                    handleSeek();
                    video.removeEventListener('loadeddata', onLoadedData);
                };
                video.addEventListener('loadeddata', onLoadedData);
                return () => {
                    video.removeEventListener('loadeddata', onLoadedData);
                };
            }
        }
        // No return needed if the condition isn't met, but you can return undefined if you want
        return undefined;
    }, [videoSeekTime, clearVideoSeekTime]);

    useEffect(() => {
        const fetchVideoUrl = async () => {
            try {

                if (videoSourceType === 'FILE_ID') {
                    const url = await getPublicUrl(fileId!);
                    if (!isMountedRef.current) return;
                    setVideoUrl(url);

                    if (url.includes('X-Amz-Expires=')) {
                        const expiresParam = url.match(/X-Amz-Expires=(\d+)/)?.[1];
                        if (expiresParam) {
                            const expiresInSeconds = Number.parseInt(expiresParam, 10);
                            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
                            refreshTimerRef.current = setTimeout(
                                () => {
                                    if (isMountedRef.current) setIsUrlExpired(true);
                                },
                                (expiresInSeconds - 30) * 1000
                            );
                        }
                    }
                }
            } catch (err) {
                console.error('Error fetching video URL:', err);
                if (isMountedRef.current) setError(t('errors.loadFailed'));
            } finally {
                if (isMountedRef.current) setIsLoading(false);
            }
            return undefined; // Ensure all code paths return a value
        };

        if (videoSourceType === 'FILE_ID') {
            fetchVideoUrl();
        }
    }, [fileId, videoSourceType]);

    const handleVideoError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
        console.error('Video playback error:', e);
        const videoElement = e.currentTarget;
        if (
            videoElement.error?.code === MediaError.MEDIA_ERR_NETWORK ||
            videoElement.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ) {
            setIsUrlExpired(true);
            toast.error(t('errors.urlExpiredRefreshing'));
        } else {
            setError(
                t('errors.playbackError', {
                    message: videoElement.error?.message || t('errors.unknownError'),
                })
            );
        }
    };

    useEffect(() => {
        if (isUrlExpired) {
            refreshS3Url();
        }
    }, [isUrlExpired]);

    // HTML_VIDEO rendering
    if (videoSourceType === 'HTML_VIDEO') {
        if (lmsVideo.phase === 'checking') {
            return <AiVideoCheckingCard />;
        }
        if (lmsVideo.phase === 'running' && lmsVideo.status) {
            return <AiVideoProgressCard status={lmsVideo.status} onCancelled={lmsVideo.refresh} />;
        }
        if (lmsVideo.phase === 'ended' && lmsVideo.status) {
            return <AiVideoEndedCard status={lmsVideo.status} />;
        }

        // "Render MP4" for a finished LMS video; it hides itself for videos
        // the /lms-video API doesn't know (404).
        const renderBar =
            lmsVideo.phase === 'completed' && aiGenVideoId ? (
                <AiVideoRenderBar videoId={aiGenVideoId} />
            ) : null;

        // Check if code_editor_config is present
        const htmlVideoSlide = (activeItem as any).html_video_slide;
        let codeEditorConfig: any = null;

        if (htmlVideoSlide?.code_editor_config) {
            try {
                codeEditorConfig = typeof htmlVideoSlide.code_editor_config === 'string'
                    ? JSON.parse(htmlVideoSlide.code_editor_config)
                    : htmlVideoSlide.code_editor_config;
            } catch (e) {
                console.warn('Failed to parse code_editor_config:', e);
            }
        }

        // If code editor is enabled, show split screen view (even if video is not ready yet)
        if (codeEditorConfig?.enabled) {
            const layout = codeEditorConfig.layout || 'split-right';
            const codeLanguage = codeEditorConfig.language || 'python';
            const initialCode = codeEditorConfig.initial_code || '';
            const theme = codeEditorConfig.theme || 'dark';

            // Create split screen data structure
            // Always include htmlVideoData if available (will be undefined if not ready yet)
            const splitScreenData = {
                splitScreen: true,
                videoSlideId: activeItem.id,
                layout: layout,
                originalVideoData: {
                    id: activeItem.id,
                    title: activeItem.title || '',
                    description: '',
                    url: htmlVideoSlide?.ai_gen_video_id || htmlVideoSlide?.url || '',
                    source_type: 'HTML_VIDEO',
                    // Store ai_gen_video_id explicitly for use in split-screen-slide
                    ai_gen_video_id: htmlVideoSlide?.ai_gen_video_id || '',
                },
                language: codeLanguage,
                code: initialCode,
                theme: theme,
                viewMode: 'edit',
                allLanguagesData: {
                    python: { code: codeLanguage === 'python' ? initialCode : '', lastEdited: Date.now() },
                    javascript: { code: codeLanguage === 'javascript' ? initialCode : '', lastEdited: Date.now() },
                },
                timestamp: Date.now(),
                splitType: 'CODE',
                // Include htmlVideoData if available (will trigger re-render when fetched)
                ...(htmlVideoData?.htmlUrl ? {
                    htmlVideoData: {
                        htmlUrl: htmlVideoData.htmlUrl,
                        audioUrl: htmlVideoData.audioUrl,
                    }
                } : {
                    // Mark video as not ready if URLs are not available
                    videoNotReady: true,
                }),
            };

            return (
                <div
                    key={`html-video-split-${activeItem.id}-${htmlVideoData?.htmlUrl ? 'ready' : 'generating'}`}
                    className="flex size-full flex-col gap-2"
                >
                    {renderBar}
                    <div className="min-h-0 w-full flex-1">
                        <SplitScreenSlide
                            splitScreenData={splitScreenData as any}
                            slideType="SPLIT_CODE"
                            isEditable={true}
                            currentSlideId={activeItem.id}
                            onDataChange={(updatedSplitData) => {

                            }}
                        />
                    </div>
                </div>
            );
        }

        // Regular HTML_VIDEO rendering without code editor
        if (isLoadingHtmlVideo) {
            return (
                <div className="flex h-64 items-center justify-center rounded-lg bg-gray-100">
                    <div className="flex flex-col items-center gap-3">
                        <div className="size-12 animate-spin rounded-full border-y-2 border-primary-500"></div>
                        <p className="text-sm text-gray-600">{t('loadingVideo')}</p>
                    </div>
                </div>
            );
        }

        // Show error only if it's a real error (not 404 which means video is still generating)
        if (error && error !== 'Video ID not found' && error !== 'work in progress') {
            return (
                <div className="flex h-64 flex-col items-center justify-center rounded-lg bg-red-50 p-4">
                    <p className="mb-2 font-medium text-red-500">{error}</p>
                </div>
            );
        }

        // Show video if data is available
        if (htmlVideoData?.htmlUrl) {
            return (
                <div key={`html-video-${activeItem.id}`} className="flex w-full flex-col gap-2">
                    {renderBar}
                    <div
                        className="flex w-full flex-col overflow-hidden rounded-lg"
                        style={{ maxHeight: 'calc(100vh - 200px)' }}
                    >
                        <AIContentPlayer
                            timelineUrl={htmlVideoData.htmlUrl}
                            audioUrl={htmlVideoData.audioUrl ?? undefined}
                            className="w-full"
                        />
                    </div>
                </div>
            );
        }

        // Show "Video is being generated" message when video data is not available yet
        return (
            <div className="flex h-64 items-center justify-center rounded-lg bg-gray-100">
                <div className="flex flex-col items-center gap-3">
                    <div className="size-12 animate-spin rounded-full border-y-2 border-primary-500"></div>
                    <p className="text-sm text-gray-600">{error === 'work in progress' ? t('workInProgress') : t('videoBeingGenerated')}</p>
                    <p className="text-xs text-gray-500">{t('generatingHint')}</p>
                </div>
            </div>
        );
    }

    // Loading UI
    if (videoSourceType === 'FILE_ID' && isLoading) {
        return (
            <div className="flex h-64 items-center justify-center rounded-lg bg-gray-100">
                <div className="size-12 animate-spin rounded-full border-y-2 border-primary-500"></div>
            </div>
        );
    }

    // Error UI
    if (videoSourceType === 'FILE_ID' && error) {
        return (
            <div className="flex h-64 flex-col items-center justify-center rounded-lg bg-red-50 p-4">
                <p className="mb-2 font-medium text-red-500">{error}</p>
                <button
                    onClick={refreshS3Url}
                    className="rounded-md bg-primary-500 px-4 py-2 text-white transition-colors hover:bg-primary-600"
                >
                    {t('retry')}
                </button>
            </div>
        );
    }

    // FILE_ID video rendering
    if (videoSourceType === 'FILE_ID') {
        return (
            <div key={`video-${activeItem.id}`} className="w-full">
                {isUrlExpired ? (
                    <div className="flex h-64 flex-col items-center justify-center rounded-lg bg-yellow-50 p-4">
                        <p className="mb-4 text-yellow-700">{t('errors.urlExpiredRefreshing')}</p>
                        <div className="size-8 animate-spin rounded-full border-y-2 border-primary-500"></div>
                    </div>
                ) : (
                    <>
                        <FileVideoPlayer
                            src={videoUrl}
                            videoRef={videoRef}
                            allowDownload={allowVideoDownload}
                            onError={handleVideoError}
                        />
                        {/* In-video question authoring + Convert to Split Screen,
                            same as the YouTube editor — driven by the shared videoRef. */}
                        <FileVideoQuestionsEditor videoRef={videoRef} />
                    </>
                )}
            </div>
        );
    }

    // Vimeo embed. HTML_VIDEO and FILE_ID have already returned above, so
    // whatever reaches here is a linked video and the resolver picks the host
    // from the URL when source_type doesn't say.
    if (resolveVideoSourceType(activeItem.video_slide) === 'VIMEO') {
        const vimeoUrl =
            activeItem.video_slide?.published_url ||
            activeItem.video_slide?.url ||
            '';
        const vimeoId = extractVimeoId(vimeoUrl);
        return (
            <div key={`video-${activeItem.id}`} className="size-full">
                <iframe
                    src={`https://player.vimeo.com/video/${vimeoId}?badge=0&autopause=0&player_id=0`}
                    className="aspect-video w-full rounded-lg"
                    allow="autoplay; fullscreen; picture-in-picture"
                    allowFullScreen
                    title={t('vimeoPlayerTitle')}
                />
            </div>
        );
    }

    // YouTube embed fallback for 'VIDEO'
    return (
        <div key={`video-${activeItem.id}`} className="size-full">
            <YouTubePlayer
                videoUrl={
                    activeItem.video_slide?.published_url ||
                    activeItem.video_slide?.url ||
                    embedUrl ||
                    ''
                }
            />
        </div>
    );
};

export default VideoSlidePreview;

