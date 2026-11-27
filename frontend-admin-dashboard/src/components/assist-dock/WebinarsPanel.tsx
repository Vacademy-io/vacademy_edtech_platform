import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowSquareOut,
    CalendarBlank,
    Clock,
    PlayCircle,
    VideoCamera,
    WarningCircle,
    X,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { joinLiveClass, safeLink, webinarPhase, type WebinarDto } from '@/services/webinars';

/** Same pulsing dot as the live-class dashboard's "Live now" panel. `onRed` = white, for a red button. */
export function LiveDot({ className, onRed = false }: { className?: string; onRed?: boolean }) {
    return (
        <span className={cn('relative flex size-2.5', className)}>
            <span
                className={cn(
                    'absolute inline-flex size-full animate-ping rounded-full opacity-75 motion-reduce:animate-none',
                    onRed ? 'bg-white' : 'bg-danger-400'
                )}
            />
            <span
                className={cn(
                    'relative inline-flex size-2.5 rounded-full',
                    onRed ? 'bg-white' : 'bg-danger-500'
                )}
            />
        </span>
    );
}

/** Within this window before the start, an upcoming card says "Starts in N min". */
const SOON_MS = 60 * 60 * 1000;

/** Recordings that are plain video files play inside the app; any other link opens in a new tab. */
const VIDEO_FILE = /\.(mp4|webm|m4v|mov)(\?|#|$)/i;

function openLink(url: string | null) {
    const href = safeLink(url);
    if (href) window.open(href, '_blank', 'noopener,noreferrer');
}

/**
 * Assist Dock "Webinars" side panel: the webinar running now (red, Join now), the upcoming ones
 * with a Join button, and past ones with their recording. Super admins publish them from the
 * health-check dashboard (Help → Webinars).
 */
export function WebinarsPanel({
    open,
    onClose,
    webinars,
    loading,
    error,
    onRetry,
    now,
}: {
    open: boolean;
    onClose: () => void;
    webinars: WebinarDto[] | undefined;
    loading: boolean;
    error: boolean;
    onRetry: () => void;
    /** From useWebinarClock, shared with the rail so both flip to LIVE together. */
    now: number;
}) {
    const { t, i18n } = useTranslation('webinarsPanel');
    const [playing, setPlaying] = useState<WebinarDto | null>(null);

    const locale = i18n.language;
    const day = (iso: string) =>
        new Date(iso).toLocaleDateString(locale, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
        });
    const time = (iso: string) =>
        new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });

    const rows = webinars ?? [];
    const live = rows.filter((w) => webinarPhase(w, now) === 'live');
    const upcoming = rows
        .filter((w) => webinarPhase(w, now) === 'upcoming')
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const past = rows
        .filter((w) => webinarPhase(w, now) === 'past')
        .sort((a, b) => b.startsAt.localeCompare(a.startsAt));

    /** Admins of PROD institutes get the live class itself; everyone else the public link. */
    const canJoin = (w: WebinarDto) => !!w.liveScheduleId || !!safeLink(w.joinUrl);
    const join = async (w: WebinarDto) => {
        if (!w.liveScheduleId) {
            openLink(w.joinUrl);
            return;
        }
        const outcome = await joinLiveClass(w.liveScheduleId);
        if (outcome === 'notStarted') toast.info(t('notStarted'));
        else if (outcome === 'ended') toast.info(t('ended'));
        else if (outcome === 'failed') toast.error(t('joinFailed'));
    };

    const watch = (w: WebinarDto) => {
        if (w.recordingUrl && VIDEO_FILE.test(w.recordingUrl) && safeLink(w.recordingUrl)) {
            setPlaying(w);
        } else {
            openLink(w.recordingUrl);
        }
    };

    if (!open) return null;

    return (
        <>
            {/* Slides out left of the rail, like the other dock panels. z-50 so sticky page
                toolbars don't cover its header. */}
            <div className="fixed bottom-4 right-16 top-20 z-50 flex w-80 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl">
                <div className="flex shrink-0 items-start justify-between gap-2 border-b border-neutral-200 px-4 py-3">
                    <div className="flex min-w-0 items-start gap-2">
                        <VideoCamera
                            size={18}
                            weight="duotone"
                            className="mt-0.5 shrink-0 text-primary-500"
                        />
                        <div className="min-w-0">
                            <p className="text-body font-semibold text-neutral-800">{t('title')}</p>
                            <p className="text-caption text-neutral-500">{t('subtitle')}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        aria-label={t('close')}
                        onClick={onClose}
                        className="flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-3">
                    {loading && !webinars ? (
                        <div className="flex flex-col gap-3">
                            <Skeleton className="h-28 w-full rounded-lg" />
                            <Skeleton className="h-20 w-full rounded-lg" />
                            <Skeleton className="h-12 w-full rounded-lg" />
                        </div>
                    ) : error && !webinars ? (
                        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                            <WarningCircle size={26} className="text-danger-500" />
                            <p className="text-caption text-neutral-600">{t('loadError')}</p>
                            <MyButton buttonType="secondary" scale="small" onClick={onRetry}>
                                {t('retry')}
                            </MyButton>
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                            <VideoCamera size={26} className="text-neutral-300" />
                            <p className="text-caption font-medium text-neutral-600">
                                {t('empty')}
                            </p>
                            <p className="text-caption text-neutral-500">{t('emptyHint')}</p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4">
                            {live.map((w) => (
                                <section
                                    key={w.id}
                                    className="flex flex-col gap-2 rounded-lg border border-danger-200 bg-gradient-to-br from-danger-50 via-white to-white p-3"
                                >
                                    <span className="flex items-center gap-2 text-caption font-semibold uppercase tracking-wide text-danger-600">
                                        <LiveDot />
                                        {t('liveNow')}
                                    </span>
                                    <p className="text-body font-semibold text-neutral-800">
                                        {w.title}
                                    </p>
                                    {w.description ? (
                                        <p className="line-clamp-2 text-caption text-neutral-600">
                                            {w.description}
                                        </p>
                                    ) : null}
                                    <p className="flex items-center gap-1 text-caption text-neutral-500">
                                        <Clock size={13} />
                                        {t('liveUntil', {
                                            start: time(w.startsAt),
                                            end: time(w.endsAt),
                                        })}
                                    </p>
                                    {canJoin(w) ? (
                                        <MyButton
                                            scale="medium"
                                            className="w-full bg-danger-500 hover:bg-danger-600 active:bg-danger-600"
                                            onAsyncClick={() => join(w)}
                                        >
                                            <span className="flex items-center gap-2">
                                                <LiveDot onRed />
                                                {t('joinNow')}
                                            </span>
                                        </MyButton>
                                    ) : (
                                        <p className="text-caption text-neutral-500">
                                            {t('linkSoon')}
                                        </p>
                                    )}
                                </section>
                            ))}

                            {upcoming.length ? (
                                <section className="flex flex-col gap-2">
                                    <p className="text-caption font-semibold uppercase tracking-wide text-neutral-500">
                                        {t('upcoming')}
                                    </p>
                                    {upcoming.map((w) => {
                                        const startsInMs = Date.parse(w.startsAt) - now;
                                        const soon = startsInMs <= SOON_MS;
                                        return (
                                            <div
                                                key={w.id}
                                                className={cn(
                                                    'flex flex-col gap-2 rounded-lg border p-3',
                                                    soon
                                                        ? 'border-primary-200 bg-primary-50'
                                                        : 'border-neutral-200 bg-white'
                                                )}
                                            >
                                                <p className="flex items-center gap-1 text-caption font-medium text-primary-600">
                                                    <CalendarBlank size={13} />
                                                    {soon
                                                        ? t('startsIn', {
                                                              minutes: Math.max(
                                                                  1,
                                                                  Math.ceil(startsInMs / 60000)
                                                              ),
                                                          })
                                                        : t('when', {
                                                              day: day(w.startsAt),
                                                              time: time(w.startsAt),
                                                          })}
                                                </p>
                                                <p className="text-body font-semibold text-neutral-800">
                                                    {w.title}
                                                </p>
                                                {w.description ? (
                                                    <p className="line-clamp-2 text-caption text-neutral-600">
                                                        {w.description}
                                                    </p>
                                                ) : null}
                                                {canJoin(w) ? (
                                                    <MyButton
                                                        buttonType={soon ? 'primary' : 'secondary'}
                                                        scale="small"
                                                        className="w-full"
                                                        onAsyncClick={() => join(w)}
                                                    >
                                                        <span className="flex items-center gap-1">
                                                            {t('join')}
                                                            <ArrowSquareOut size={13} />
                                                        </span>
                                                    </MyButton>
                                                ) : (
                                                    <p className="text-caption text-neutral-500">
                                                        {t('linkSoon')}
                                                    </p>
                                                )}
                                            </div>
                                        );
                                    })}
                                </section>
                            ) : null}

                            {past.length ? (
                                <section className="flex flex-col gap-1">
                                    <p className="text-caption font-semibold uppercase tracking-wide text-neutral-500">
                                        {t('past')}
                                    </p>
                                    <ul className="flex flex-col">
                                        {past.map((w) => {
                                            const hasRecording = !!safeLink(w.recordingUrl);
                                            return (
                                                <li key={w.id}>
                                                    <button
                                                        type="button"
                                                        disabled={!hasRecording}
                                                        onClick={() => watch(w)}
                                                        className="group flex w-full items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-primary-50 disabled:cursor-default disabled:hover:bg-transparent"
                                                    >
                                                        <span
                                                            className={cn(
                                                                'flex size-8 shrink-0 items-center justify-center rounded-md',
                                                                hasRecording
                                                                    ? 'bg-primary-50 text-primary-500 group-hover:bg-primary-100'
                                                                    : 'bg-neutral-100 text-neutral-400'
                                                            )}
                                                        >
                                                            <PlayCircle
                                                                size={17}
                                                                weight="duotone"
                                                            />
                                                        </span>
                                                        <span className="min-w-0 flex-1">
                                                            <span className="block truncate text-caption font-medium text-neutral-700">
                                                                {w.title}
                                                            </span>
                                                            <span className="block text-caption text-neutral-500">
                                                                {day(w.startsAt)} ·{' '}
                                                                {hasRecording
                                                                    ? t('watch')
                                                                    : t('noRecording')}
                                                            </span>
                                                        </span>
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </section>
                            ) : null}
                        </div>
                    )}
                </div>
            </div>

            <MyDialog
                heading={playing?.title ?? t('recording')}
                open={!!playing}
                onOpenChange={(v) => !v && setPlaying(null)}
                dialogWidth="max-w-4xl"
            >
                {playing ? (
                    <video
                        key={playing.id}
                        src={safeLink(playing.recordingUrl) ?? undefined}
                        controls
                        autoPlay
                        playsInline
                        className="aspect-video w-full rounded-md bg-neutral-900"
                    />
                ) : null}
            </MyDialog>
        </>
    );
}
