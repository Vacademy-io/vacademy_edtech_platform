import { useTranslation } from 'react-i18next';
import {
    ArrowClockwise,
    ArrowSquareOut,
    CheckCircle,
    CircleNotch,
    DownloadSimple,
    FilmStrip,
    WarningCircle,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useLmsVideoRender } from '../-hooks/use-lms-video-render';

const NS = 'studyLibraryVideoSlidePreview';

const LINK_BASE =
    'inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-caption font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300';

/**
 * "Render MP4" for a finished LMS AI video: starts a render on the render
 * worker, shows its progress, then offers the file. Renders nothing for videos
 * the /lms-video API doesn't know (404) and while the first read is in flight.
 */
export function AiVideoRenderBar({ videoId }: { videoId: string }) {
    const { t } = useTranslation(NS);
    const { mode, render, start } = useLmsVideoRender(videoId);

    if (mode === 'hidden') return null;

    const handleStart = async () => {
        const error = await start(t('aiVideo.render.startFailed'));
        if (!error) return;
        toast.error(error.code === 'NOT_READY' ? t('aiVideo.render.notReady') : error.detail);
    };

    const progress = render?.progress ?? 0;
    const active = mode === 'queued' || mode === 'running';

    let icon = <FilmStrip className="size-4" />;
    let label = t('aiVideo.render.idle');
    if (mode === 'starting') {
        icon = <CircleNotch className="size-4 animate-spin" />;
        label = t('aiVideo.render.starting');
    } else if (mode === 'queued') {
        icon = <CircleNotch className="size-4 animate-spin" />;
        label = t('aiVideo.render.queued');
    } else if (mode === 'running') {
        icon = <CircleNotch className="size-4 animate-spin" />;
        label = t('aiVideo.render.running', { value: progress });
    } else if (mode === 'ready') {
        icon = <CheckCircle className="size-4" weight="fill" />;
        label = t('aiVideo.render.ready');
    } else if (mode === 'failed') {
        icon = <WarningCircle className="size-4" weight="fill" />;
        label = render?.error
            ? t('aiVideo.render.failedReason', { message: render.error })
            : t('aiVideo.render.failed');
    }

    return (
        <div
            className="flex w-full shrink-0 flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2"
            aria-live="polite"
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p
                    className={cn(
                        'flex min-w-0 items-center gap-2 text-sm',
                        mode === 'failed' ? 'text-danger-700' : 'text-foreground'
                    )}
                >
                    <span
                        className={cn(
                            'shrink-0',
                            mode === 'failed' ? 'text-danger-600' : 'text-primary-500'
                        )}
                    >
                        {icon}
                    </span>
                    <span className="min-w-0 break-words">{label}</span>
                </p>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {(mode === 'idle' || mode === 'starting') && (
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="small"
                            onClick={() => void handleStart()}
                            disable={mode === 'starting'}
                            className="gap-1.5"
                        >
                            <FilmStrip className="size-3.5" />
                            {t('aiVideo.render.button')}
                        </MyButton>
                    )}
                    {mode === 'failed' && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => void handleStart()}
                            className="gap-1.5"
                        >
                            <ArrowClockwise className="size-3.5" />
                            {t('aiVideo.render.retry')}
                        </MyButton>
                    )}
                    {mode === 'ready' && render?.video_url && (
                        <>
                            <a
                                href={render.video_url}
                                download
                                target="_blank"
                                rel="noopener noreferrer"
                                className={cn(
                                    LINK_BASE,
                                    'bg-primary-500 text-neutral-50 hover:bg-primary-400'
                                )}
                            >
                                <DownloadSimple className="size-3.5" />
                                {t('aiVideo.render.download')}
                            </a>
                            <a
                                href={render.video_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={cn(
                                    LINK_BASE,
                                    'border border-border text-foreground hover:border-primary-500 hover:bg-primary-50'
                                )}
                            >
                                <ArrowSquareOut className="size-3.5" />
                                {t('aiVideo.render.openInNewTab')}
                            </a>
                        </>
                    )}
                </div>
            </div>

            {active && (
                <>
                    <Progress
                        value={progress}
                        className="h-1.5 border border-border"
                        aria-label={t('aiVideo.render.progressLabel')}
                    />
                    <p className="text-xs text-muted-foreground">{t('aiVideo.render.hint')}</p>
                </>
            )}
        </div>
    );
}
