'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    Play,
    Pause,
    SpeakerHigh,
    SpeakerX,
    CornersOut,
    CornersIn,
    ArrowClockwise,
    ArrowCounterClockwise,
    DotsThreeVertical,
    DownloadSimple,
    PictureInPicture,
    Gauge,
    Check,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

const SKIP_SECONDS = 10;
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function deriveFileName(url: string): string {
    try {
        const path = new URL(url).pathname;
        const last = path.split('/').filter(Boolean).pop();
        if (last && /\.\w{2,4}$/.test(last)) return decodeURIComponent(last);
    } catch {
        /* fall through */
    }
    return 'video.mp4';
}

function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const ss = s.toString().padStart(2, '0');
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${ss}`;
    return `${m}:${ss}`;
}

function ControlButton({
    label,
    onClick,
    children,
    className,
}: {
    label: string;
    onClick: () => void;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onClick}
            className={cn(
                'flex items-center justify-center gap-0.5 rounded-md p-1.5 text-white transition-colors hover:bg-white/20 focus-visible:bg-white/20 focus-visible:outline-none',
                className
            )}
        >
            {children}
        </button>
    );
}

interface FileVideoPlayerProps {
    src: string;
    /** Owned by the parent so its `videoSeekTime` seeking keeps working. */
    videoRef: React.RefObject<HTMLVideoElement>;
    allowDownload?: boolean;
    onError?: (e: React.SyntheticEvent<HTMLVideoElement, Event>) => void;
}

/**
 * FILE_ID (direct upload) video player with a custom control bar.
 *
 * Replaces the bare native `<video controls>` so authors get explicit
 * ±10s skip ("navigation") buttons both inline (minimised) and in full
 * screen. Full screen targets the wrapper element — not the <video> — so
 * the custom controls stay visible while full screen (native fullscreen
 * would hide any overlay).
 */
export function FileVideoPlayer({ src, videoRef, allowDownload = false, onError }: FileVideoPlayerProps) {
    const { t } = useTranslation('fileVideoPlayer');
    const containerRef = useRef<HTMLDivElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);
    const volumeRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [controlsVisible, setControlsVisible] = useState(true);
    const [scrubbing, setScrubbing] = useState(false);
    const [adjustingVolume, setAdjustingVolume] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [rate, setRate] = useState(1);
    const [isPip, setIsPip] = useState(false);
    const pipSupported = typeof document !== 'undefined' && !!document.pictureInPictureEnabled;

    const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
    const isSilent = muted || volume === 0;

    const togglePlay = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) void v.play();
        else v.pause();
    }, [videoRef]);

    const skip = useCallback(
        (delta: number) => {
            const v = videoRef.current;
            if (!v) return;
            const dur = Number.isFinite(v.duration) ? v.duration : duration;
            const target = Math.min(Math.max(v.currentTime + delta, 0), dur || Number.MAX_SAFE_INTEGER);
            v.currentTime = target;
            setCurrentTime(target);
        },
        [videoRef, duration]
    );

    const setVol = useCallback(
        (val: number) => {
            const v = videoRef.current;
            if (!v) return;
            const nv = Math.min(Math.max(val, 0), 1);
            v.volume = nv;
            v.muted = nv === 0;
            setVolume(nv);
            setMuted(nv === 0);
        },
        [videoRef]
    );

    const toggleMute = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        if (v.muted || v.volume === 0) {
            v.muted = false;
            if (v.volume === 0) {
                v.volume = 0.5;
                setVolume(0.5);
            }
            setMuted(false);
        } else {
            v.muted = true;
            setMuted(true);
        }
    }, [videoRef]);

    const toggleFullscreen = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        if (document.fullscreenElement) void document.exitFullscreen();
        else void el.requestFullscreen?.();
    }, []);

    useEffect(() => {
        const onFsChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
        document.addEventListener('fullscreenchange', onFsChange);
        return () => document.removeEventListener('fullscreenchange', onFsChange);
    }, []);

    const changeRate = useCallback(
        (r: number) => {
            const v = videoRef.current;
            if (v) v.playbackRate = r;
            setRate(r);
            setMenuOpen(false);
        },
        [videoRef]
    );

    const togglePip = useCallback(async () => {
        setMenuOpen(false);
        const v = videoRef.current;
        if (!v) return;
        try {
            if (document.pictureInPictureElement) await document.exitPictureInPicture();
            else if (document.pictureInPictureEnabled) await v.requestPictureInPicture();
        } catch {
            /* PiP unavailable — ignore */
        }
    }, [videoRef]);

    const handleDownload = useCallback(async () => {
        setMenuOpen(false);
        if (!src) return;
        try {
            const res = await fetch(src);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = deriveFileName(src);
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch {
            // Cross-origin fetch blocked — fall back to opening the file.
            window.open(src, '_blank', 'noopener');
        }
    }, [src]);

    // Keep PiP button state in sync with the actual PiP window.
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        const onEnter = () => setIsPip(true);
        const onLeave = () => setIsPip(false);
        v.addEventListener('enterpictureinpicture', onEnter);
        v.addEventListener('leavepictureinpicture', onLeave);
        return () => {
            v.removeEventListener('enterpictureinpicture', onEnter);
            v.removeEventListener('leavepictureinpicture', onLeave);
        };
    }, [videoRef]);

    // Close the overflow menu on outside click / Escape.
    useEffect(() => {
        if (!menuOpen) return undefined;
        const onPointerDown = (e: PointerEvent) => {
            if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setMenuOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKey);
        };
    }, [menuOpen]);

    // Auto-hide controls only while playing in full screen; always visible inline.
    const revealControls = useCallback(() => {
        setControlsVisible(true);
        if (hideTimer.current) clearTimeout(hideTimer.current);
        if (isPlaying && isFullscreen && !scrubbing && !adjustingVolume && !menuOpen) {
            hideTimer.current = setTimeout(() => setControlsVisible(false), 2500);
        }
    }, [isPlaying, isFullscreen, scrubbing, adjustingVolume, menuOpen]);

    useEffect(() => {
        revealControls();
        return () => {
            if (hideTimer.current) clearTimeout(hideTimer.current);
        };
    }, [revealControls]);

    const seekToClientX = useCallback(
        (clientX: number) => {
            const el = progressRef.current;
            const v = videoRef.current;
            if (!el || !v || !(duration > 0)) return;
            const rect = el.getBoundingClientRect();
            const pct = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
            const t = pct * duration;
            v.currentTime = t;
            setCurrentTime(t);
        },
        [duration, videoRef]
    );

    const volumeFromClientX = useCallback(
        (clientX: number) => {
            const el = volumeRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const pct = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
            setVol(pct);
        },
        [setVol]
    );

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        switch (e.code) {
            case 'Space':
            case 'KeyK':
                e.preventDefault();
                togglePlay();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                skip(-SKIP_SECONDS);
                break;
            case 'ArrowRight':
                e.preventDefault();
                skip(SKIP_SECONDS);
                break;
            case 'ArrowUp':
                e.preventDefault();
                setVol((muted ? 0 : volume) + 0.1);
                break;
            case 'ArrowDown':
                e.preventDefault();
                setVol((muted ? 0 : volume) - 0.1);
                break;
            case 'KeyM':
                toggleMute();
                break;
            case 'KeyF':
                toggleFullscreen();
                break;
            default:
                return;
        }
        revealControls();
    };

    return (
        <div
            ref={containerRef}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onMouseMove={revealControls}
            onMouseLeave={() => {
                if (isPlaying && isFullscreen) setControlsVisible(false);
            }}
            className={cn(
                'group relative w-full select-none bg-black outline-none',
                isFullscreen
                    ? 'flex h-screen items-center justify-center'
                    : 'overflow-hidden rounded-lg',
                !controlsVisible && 'cursor-none'
            )}
        >
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
                ref={videoRef}
                className={cn('block', isFullscreen ? 'max-h-screen w-auto max-w-full' : 'h-auto w-full')}
                playsInline
                preload="metadata"
                controlsList={allowDownload ? undefined : 'nodownload'}
                onClick={togglePlay}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                onDurationChange={(e) => setDuration(e.currentTarget.duration)}
                onVolumeChange={(e) => {
                    setVolume(e.currentTarget.volume);
                    setMuted(e.currentTarget.muted);
                }}
                onContextMenu={(e) => {
                    if (!allowDownload) e.preventDefault();
                }}
                onError={onError}
            >
                <source src={src} type="video/webm" />
                <source src={src} type="video/mp4" />
                <source src={src} type="video/ogg" />
                {t('unsupportedFormat')}
            </video>

            {/* Center play affordance while paused */}
            {!isPlaying && (
                <button
                    type="button"
                    aria-label={t('controls.play')}
                    onClick={togglePlay}
                    className="absolute inset-0 z-10 grid place-items-center bg-black/20 transition-colors hover:bg-black/30"
                >
                    <span className="grid size-16 place-items-center rounded-full bg-black/60 text-white">
                        <Play size={30} weight="fill" className="ml-1" />
                    </span>
                </button>
            )}

            {/* Control bar */}
            <div
                className={cn(
                    'absolute inset-x-0 bottom-0 z-20 flex flex-col gap-1.5 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8 transition-opacity duration-200',
                    controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
                )}
            >
                {/* Seek bar */}
                <div
                    ref={progressRef}
                    onPointerDown={(e) => {
                        e.preventDefault();
                        setScrubbing(true);
                        progressRef.current?.setPointerCapture(e.pointerId);
                        seekToClientX(e.clientX);
                    }}
                    onPointerMove={(e) => {
                        if (scrubbing) seekToClientX(e.clientX);
                    }}
                    onPointerUp={(e) => {
                        setScrubbing(false);
                        progressRef.current?.releasePointerCapture(e.pointerId);
                    }}
                    className="group/seek relative flex h-4 cursor-pointer items-center"
                >
                    <div className="h-1 w-full overflow-hidden rounded-full bg-white/30">
                        {/* dynamic fill — runtime playback progress */}
                        <div className="h-full rounded-full bg-primary-500" style={{ width: `${progressPct}%` }} />
                    </div>
                    <div
                        className={cn(
                            'absolute size-3 -translate-x-1/2 rounded-full bg-primary-500 transition-opacity',
                            scrubbing ? 'opacity-100' : 'opacity-0 group-hover/seek:opacity-100'
                        )}
                        // dynamic position — runtime playback progress
                        style={{ left: `${progressPct}%` }}
                    />
                </div>

                {/* Buttons row */}
                <div className="flex items-center gap-1 text-white">
                    <ControlButton label={isPlaying ? t('controls.pause') : t('controls.play')} onClick={togglePlay}>
                        {isPlaying ? <Pause size={20} weight="fill" /> : <Play size={20} weight="fill" />}
                    </ControlButton>

                    <ControlButton
                        label={t('controls.rewindSeconds', { count: SKIP_SECONDS })}
                        onClick={() => skip(-SKIP_SECONDS)}
                    >
                        <ArrowCounterClockwise size={20} weight="bold" />
                        <span className="text-xs font-semibold">{SKIP_SECONDS}</span>
                    </ControlButton>

                    <ControlButton
                        label={t('controls.forwardSeconds', { count: SKIP_SECONDS })}
                        onClick={() => skip(SKIP_SECONDS)}
                    >
                        <span className="text-xs font-semibold">{SKIP_SECONDS}</span>
                        <ArrowClockwise size={20} weight="bold" />
                    </ControlButton>

                    <div
                        className="flex items-center gap-1"
                        onMouseEnter={() => setAdjustingVolume(true)}
                        onMouseLeave={() => setAdjustingVolume(false)}
                    >
                        <ControlButton label={isSilent ? t('controls.unmute') : t('controls.mute')} onClick={toggleMute}>
                            {isSilent ? <SpeakerX size={20} /> : <SpeakerHigh size={20} />}
                        </ControlButton>
                        <div
                            ref={volumeRef}
                            onPointerDown={(e) => {
                                e.preventDefault();
                                setAdjustingVolume(true);
                                volumeRef.current?.setPointerCapture(e.pointerId);
                                volumeFromClientX(e.clientX);
                            }}
                            onPointerMove={(e) => {
                                if (adjustingVolume) volumeFromClientX(e.clientX);
                            }}
                            onPointerUp={(e) => {
                                setAdjustingVolume(false);
                                volumeRef.current?.releasePointerCapture(e.pointerId);
                            }}
                            className="hidden h-4 w-16 cursor-pointer items-center sm:flex"
                        >
                            <div className="h-1 w-full overflow-hidden rounded-full bg-white/30">
                                {/* dynamic fill — runtime volume level */}
                                <div
                                    className="h-full rounded-full bg-white"
                                    style={{ width: `${(isSilent ? 0 : volume) * 100}%` }}
                                />
                            </div>
                        </div>
                    </div>

                    <span className="ml-1 text-xs tabular-nums text-white/90">
                        {formatTime(currentTime)} / {formatTime(duration)}
                    </span>

                    <div className="ml-auto flex items-center gap-1">
                        <ControlButton
                            label={isFullscreen ? t('controls.exitFullScreen') : t('controls.fullScreen')}
                            onClick={toggleFullscreen}
                        >
                            {isFullscreen ? <CornersIn size={20} /> : <CornersOut size={20} />}
                        </ControlButton>

                        <div ref={menuRef} className="relative">
                            <ControlButton
                                label={t('controls.moreOptions')}
                                onClick={() => setMenuOpen((o) => !o)}
                                className={cn(menuOpen && 'bg-white/20')}
                            >
                                <DotsThreeVertical size={22} weight="bold" />
                            </ControlButton>

                            {menuOpen && (
                                <div className="absolute bottom-full end-0 mb-2 w-56 rounded-lg border border-white/10 bg-black/90 py-1.5 text-white shadow-lg">
                                    <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-white/70">
                                        <Gauge size={16} weight="bold" />
                                        {t('menu.playbackSpeed')}
                                    </div>
                                    <div className="flex flex-wrap gap-1 px-3 pb-2 pt-1">
                                        {PLAYBACK_RATES.map((r) => (
                                            <button
                                                key={r}
                                                type="button"
                                                onClick={() => changeRate(r)}
                                                className={cn(
                                                    'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                                                    r === rate
                                                        ? 'bg-primary-500 text-white'
                                                        : 'bg-white/10 text-white hover:bg-white/20'
                                                )}
                                            >
                                                {r === 1 ? t('menu.normalSpeed') : `${r}x`}
                                            </button>
                                        ))}
                                    </div>

                                    {pipSupported && (
                                        <>
                                            <div className="my-1 h-px bg-white/10" />
                                            <button
                                                type="button"
                                                onClick={togglePip}
                                                className="flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-white/10"
                                            >
                                                <PictureInPicture size={18} />
                                                <span className="flex-1 text-start">{t('menu.pictureInPicture')}</span>
                                                {isPip && <Check size={16} weight="bold" />}
                                            </button>
                                        </>
                                    )}

                                    {allowDownload && (
                                        <>
                                            <div className="my-1 h-px bg-white/10" />
                                            <button
                                                type="button"
                                                onClick={handleDownload}
                                                className="flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-white/10"
                                            >
                                                <DownloadSimple size={18} />
                                                <span className="flex-1 text-start">{t('menu.download')}</span>
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default FileVideoPlayer;
