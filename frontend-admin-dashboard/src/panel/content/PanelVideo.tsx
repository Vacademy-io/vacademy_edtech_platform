/**
 * MP4 playback (FILE_ID uploads and rendered AI videos) through the reused
 * admin FileVideoPlayer (slides/-components/file-video-player.tsx, imported
 * as-is; its 'fileVideoPlayer' namespace is loaded by PanelPlayer first).
 *
 * The player sizes the <video> by width, so this wrapper contain-fits it into
 * the stage from the video's own aspect (no CSS aspect-ratio: Chrome 88).
 * A network / unsupported-source error usually means the signed URL expired:
 * the parent gets one automatic fresh URL, after that the error card shows.
 *
 * WebView note: the player's fullscreen and picture-in-picture buttons do
 * nothing inside the Capacitor app (BridgeWebChromeClient cancels custom views);
 * the stage already fills the screen.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileVideoPlayer } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/file-video-player';
import { PanelError } from '../components/PanelScreenState';

/** 16x9 transparent GIF: keeps a 16:9 box until the video's own size is known. */
const TRANSPARENT_POSTER =
    'data:image/gif;base64,R0lGODlhEAAJAIEAAAAAAAAAAAAAAAAAACH5BAEAAAAALAAAAAAQAAkAAAgWAAEIHEiwoMGDCBMqXMiwocOHEBEGBAA7';

export interface PanelVideoProps {
    src: string;
    /**
     * Called when the source fails in a way an expired signed URL would (the
     * parent re-resolves the URL and remounts this player; it passes undefined
     * once its automatic refresh is used up, so this can never loop).
     */
    onExpired?: () => void;
    /** "Try again" on the error card. */
    onRetry: () => void;
}

export default function PanelVideo({ src, onExpired, onRetry }: PanelVideoProps) {
    const { t } = useTranslation('content');
    const videoRef = useRef<HTMLVideoElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const [aspect, setAspect] = useState(16 / 9);
    const [box, setBox] = useState<{ width: number; height: number } | null>(null);
    const [failed, setFailed] = useState<string | null>(null);

    useEffect(() => {
        setFailed(null);
    }, [src]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return undefined;
        // Android WebView paints a big grey "play" poster on any <video> without a
        // poster (seen on panel_api28); a transparent 16x9 GIF keeps the frame black.
        if (!video.getAttribute('poster')) video.setAttribute('poster', TRANSPARENT_POSTER);
        const onMeta = () => {
            if (video.videoWidth && video.videoHeight) {
                setAspect(video.videoWidth / video.videoHeight);
            }
        };
        video.addEventListener('loadedmetadata', onMeta);
        return () => video.removeEventListener('loadedmetadata', onMeta);
    }, [src, failed]);

    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return undefined;
        const measure = () => {
            const width = stage.clientWidth;
            const height = stage.clientHeight;
            if (!width || !height) return;
            const fitWidth = Math.min(width, height * aspect);
            setBox({ width: Math.floor(fitWidth), height: Math.floor(fitWidth / aspect) });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(stage);
        return () => observer.disconnect();
    }, [aspect, failed]);

    if (failed) {
        return (
            <div className="flex size-full items-center justify-center bg-background">
                <PanelError
                    title={t('player.videoErrorTitle')}
                    description={t('player.videoErrorBody')}
                    detail={failed}
                    onRetry={onRetry}
                />
            </div>
        );
    }

    return (
        <div className="size-full p-4">
            {/* Measured box = the content area inside the padding. */}
            <div ref={stageRef} className="flex size-full items-center justify-center">
                {/* Contain-fit box computed from the stage size and the video's aspect;
                    clipped so a video of another aspect never overflows the stage. */}
                <div
                    style={box ? { width: box.width, height: box.height } : undefined}
                    className="max-w-full overflow-hidden"
                >
                    <FileVideoPlayer
                        src={src}
                        videoRef={videoRef}
                        onError={(event) => {
                            const code = event.currentTarget.error?.code;
                            const expiredLike =
                                code === MediaError.MEDIA_ERR_NETWORK ||
                                code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED;
                            if (expiredLike && onExpired) {
                                onExpired();
                                return;
                            }
                            setFailed(
                                event.currentTarget.error?.message || `MediaError ${code ?? ''}`
                            );
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
