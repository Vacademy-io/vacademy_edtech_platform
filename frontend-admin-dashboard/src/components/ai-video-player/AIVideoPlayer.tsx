import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Play, Pause, RotateCcw, Maximize2, Minimize2, Subtitles } from 'lucide-react';
import '@/components/ai-course-builder/components/styles/AIVideoComponents.css';
import { useCaptions } from './hooks/useCaptions';
import { useSoundScheduler, collectCuesFromEntries } from './hooks/useSoundScheduler';
import { CaptionDisplay, CaptionSettingsPopover } from './components';
import { processHtmlContent } from './html-processor';
import type { SoundCue } from './types';
import { canvasBackground, entryBoxStyle, fillSceneGaps } from './entry-layout';

/**
 * Frame interface matching the time_based_frame.json structure
 */
export interface Frame {
    inTime: number;
    exitTime: number;
    html: string;
    id: string;
    z: number;
    htmlStartX?: number;
    htmlStartY?: number;
    htmlEndX?: number;
    htmlEndY?: number;
    /** Sound Planner cues — scheduled live via useSoundScheduler. */
    sound_cues?: SoundCue[];
    /** Shot type from Director (e.g. "SOURCE_CLIP" for source video segments). */
    shot_type?: string;
    /** Source video fields for SOURCE_CLIP shots */
    source_start?: number;
    source_end?: number;
    source_video_index?: number;
}

/**
 * Timeline metadata for video branding integration
 */
export interface TimelineMeta {
    audio_start_at: number;
    total_duration: number;
    intro_duration?: number;
    outro_duration?: number;
    content_starts_at?: number;
    content_ends_at?: number;
    content_type?: string;
    palette?: {
        background?: string;
        text?: string;
        text_secondary?: string;
        primary?: string;
        accent?: string;
    };
}

/**
 * New timeline data structure supporting branding
 */
export interface TimelineData {
    meta: TimelineMeta;
    entries: Frame[];
}

/**
 * Props for AIVideoPlayer component
 */
export interface AIVideoPlayerProps {
    timelineUrl: string;
    audioUrl: string;
    wordsUrl?: string; // Optional - for captions/subtitles
    className?: string;
    width?: number;
    height?: number;
}

/**
 * Scale Calculator
 * Responsible for calculating scale to fit video in container
 * Single Responsibility: Scale calculation only
 */
class ScaleCalculator {
    private targetWidth: number;
    private targetHeight: number;

    constructor(targetWidth: number = 1920, targetHeight: number = 1080) {
        this.targetWidth = targetWidth;
        this.targetHeight = targetHeight;
    }

    /**
     * Calculate scale to fit target dimensions into container
     * @param containerWidth - Width of the container
     * @param containerHeight - Height of the container
     * @param mode - 'contain' (fit within container) or 'cover' (fill container, may clip)
     */
    calculateScale(
        containerWidth: number,
        containerHeight: number,
        mode: 'contain' | 'cover' = 'contain'
    ): number {
        const targetRatio = this.targetWidth / this.targetHeight;
        const containerRatio = containerWidth / containerHeight;

        let newScale: number;

        if (mode === 'cover') {
            // Cover mode: fill container, content may be clipped
            if (containerRatio > targetRatio) {
                // Container is wider than target; scale by width (clip height)
                newScale = containerWidth / this.targetWidth;
            } else {
                // Container is taller than target; scale by height (clip width)
                newScale = containerHeight / this.targetHeight;
            }
        } else {
            // Contain mode: fit entirely within container
            if (containerRatio > targetRatio) {
                // Container is wider than target; constrain by height
                newScale = containerHeight / this.targetHeight;
            } else {
                // Container is taller than target; constrain by width
                newScale = containerWidth / this.targetWidth;
            }
        }

        return newScale;
    }
}

/**
 * Format time in seconds to MM:SS format
 */
const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Main AIVideoPlayer Component
 * Orchestrates all the pieces together
 * Similar experience to YouTube player with white background
 */
export const AIVideoPlayer: React.FC<AIVideoPlayerProps> = ({
    timelineUrl,
    audioUrl,
    wordsUrl,
    className = '',
    width = 1920,
    height = 1080,
}) => {
    const [frames, setFrames] = useState<Frame[]>([]);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0); // Timeline time (includes intro)
    const [duration, setDuration] = useState(0); // Total video duration (from meta or audio)
    const [scale, setScale] = useState(1);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [timelineMeta, setTimelineMeta] = useState<TimelineMeta>({
        audio_start_at: 0,
        total_duration: 0,
    });

    const audioRef = useRef<HTMLAudioElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<HTMLDivElement>(null);
    const audioStartedRef = useRef<boolean>(false); // Track if audio has started after intro

    // Initialize scale calculator
    const scaleCalculator = useMemo(() => new ScaleCalculator(width, height), [width, height]);

    // Captions hook
    const {
        currentWords,
        currentPhrase,
        currentWordIndex,
        settings: captionSettings,
        updateSettings: updateCaptionSettings,
        toggleCaptions,
    } = useCaptions({
        wordsUrl,
        currentTime,
        audioStartAt: timelineMeta.audio_start_at,
    });

    // Sound Planner cues — per-shot transition/chime/impact sound effects.
    // `currentTime` is already in timeline-global seconds (includes intro
    // offset), so it's the right clock for the scheduler.
    const soundCues = useMemo(() => collectCuesFromEntries(frames), [frames]);
    const { resetPlayed: resetSoundCues } = useSoundScheduler({
        cues: soundCues,
        masterClockSec: currentTime,
        isPlaying,
        narrationAudioRef: audioRef,
    });

    // Load timeline data
    useEffect(() => {
        const loadTimeline = async () => {
            try {
                setIsLoading(true);
                setError(null);
                console.log('🎬 AIVideoPlayer: Loading timeline from URL:', timelineUrl);

                const response = await fetch(timelineUrl);
                console.log(
                    '🎬 AIVideoPlayer: Timeline response status:',
                    response.status,
                    response.statusText
                );

                if (!response.ok) {
                    throw new Error(
                        `Failed to load timeline: ${response.status} ${response.statusText}`
                    );
                }

                const rawData = await response.json();

                // Parse new structure vs old array format
                let entries: Frame[];
                let meta: TimelineMeta;

                if (Array.isArray(rawData)) {
                    // Old format: array of frames
                    entries = rawData;
                    meta = { audio_start_at: 0, total_duration: 0 };
                    console.log('🎬 AIVideoPlayer: Using old timeline format (array)');
                } else if (rawData.entries && Array.isArray(rawData.entries)) {
                    // New format: { meta, entries }
                    entries = rawData.entries;
                    meta = rawData.meta || { audio_start_at: 0, total_duration: 0 };
                    console.log('🎬 AIVideoPlayer: Using new timeline format with meta:', meta);
                } else {
                    throw new Error('Timeline data is in an unrecognized format');
                }

                console.log('🎬 AIVideoPlayer: Timeline data loaded:', {
                    frameCount: entries.length,
                    meta: meta,
                    firstFrame: entries[0]
                        ? {
                              id: entries[0].id,
                              inTime: entries[0].inTime,
                              exitTime: entries[0].exitTime,
                              z: entries[0].z,
                              hasHtml: !!entries[0].html,
                          }
                        : null,
                    sampleHtml: entries[0]?.html?.substring(0, 100) || 'No HTML',
                });

                if (entries.length === 0) {
                    throw new Error('Timeline data is empty');
                }

                // Set timeline meta (for audio sync and duration)
                setTimelineMeta(meta);

                // Set duration from meta if available
                if (meta.total_duration && meta.total_duration > 0) {
                    setDuration(meta.total_duration);
                }

                // Reset audio started state
                audioStartedRef.current = false;

                setFrames(fillSceneGaps(entries));
            } catch (err) {
                console.error('❌ AIVideoPlayer: Error loading timeline:', err);
                console.error('❌ AIVideoPlayer: Timeline URL was:', timelineUrl);
                setError(err instanceof Error ? err.message : 'Failed to load timeline');
            } finally {
                setIsLoading(false);
            }
        };

        if (timelineUrl) {
            loadTimeline();
        } else {
            console.warn('⚠️ AIVideoPlayer: No timelineUrl provided');
            setError('No timeline URL provided');
            setIsLoading(false);
        }
    }, [timelineUrl]);

    // Calculate scale to fit video into container
    useEffect(() => {
        const updateScale = () => {
            if (containerRef.current) {
                const { clientWidth, clientHeight } = containerRef.current;
                if (clientWidth > 0 && clientHeight > 0) {
                    // Always use 'contain' mode to ensure full video is visible
                    const newScale = scaleCalculator.calculateScale(
                        clientWidth,
                        clientHeight,
                        'contain'
                    );
                    setScale(newScale);
                }
            }
        };

        const rafId = requestAnimationFrame(() => {
            updateScale();
            setTimeout(updateScale, 100);
        });

        const observer = new ResizeObserver(updateScale);
        if (containerRef.current) {
            observer.observe(containerRef.current);
        }

        return () => {
            cancelAnimationFrame(rafId);
            observer.disconnect();
        };
    }, [scaleCalculator, frames.length, isFullscreen]);

    // Audio event handlers with intro silence support
    const handleTimeUpdate = () => {
        if (audioRef.current && audioStartedRef.current) {
            // Timeline time = audio time + audio_start_at offset
            const timelineTime = audioRef.current.currentTime + timelineMeta.audio_start_at;
            setCurrentTime(timelineTime);
        }
    };

    const handleLoadedMetadata = () => {
        if (audioRef.current) {
            // Only set duration from audio if meta.total_duration is not set
            if (!timelineMeta.total_duration || timelineMeta.total_duration === 0) {
                // For old format, use audio duration
                setDuration(audioRef.current.duration);
            }
        }
    };

    // Timeline animation for intro period (before audio starts)
    const animationFrameRef = useRef<number | null>(null);
    const playStartTimeRef = useRef<number>(0);
    const introStartTimeRef = useRef<number>(0);
    const isPlayingRef = useRef<boolean>(false); // Ref to avoid stale closure issues

    // Keep ref in sync with state
    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);

    const animateIntro = useCallback(() => {
        // Use ref instead of state to avoid stale closure issues
        if (!isPlayingRef.current) return;

        const elapsed = (performance.now() - playStartTimeRef.current) / 1000;
        const newTimelineTime = introStartTimeRef.current + elapsed;

        // Check if we've reached the point where audio should start
        if (newTimelineTime >= timelineMeta.audio_start_at && !audioStartedRef.current) {
            // Start audio from beginning
            if (audioRef.current) {
                audioRef.current.currentTime = 0;
                audioRef.current.play().catch((err) => {
                    console.error('❌ AIVideoPlayer: Error starting audio:', err);
                });
                audioStartedRef.current = true;
            }
            setCurrentTime(newTimelineTime);
        } else if (!audioStartedRef.current) {
            // Still in intro, continue animation
            setCurrentTime(newTimelineTime);
            animationFrameRef.current = requestAnimationFrame(animateIntro);
        }
    }, [timelineMeta.audio_start_at]);

    const handlePlayPause = () => {
        if (isPlaying) {
            // Pause
            isPlayingRef.current = false; // Update ref immediately
            if (audioStartedRef.current && audioRef.current) {
                audioRef.current.pause();
            }
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
            setIsPlaying(false);
        } else {
            // Play
            isPlayingRef.current = true; // Update ref immediately before scheduling animation
            setIsPlaying(true);

            if (currentTime >= timelineMeta.audio_start_at) {
                // Already past intro, start/resume audio
                if (audioRef.current) {
                    // Calculate audio time from timeline time
                    const audioTime = currentTime - timelineMeta.audio_start_at;
                    audioRef.current.currentTime = Math.max(0, audioTime);
                    audioRef.current.play().catch((err) => {
                        console.error('❌ AIVideoPlayer: Error playing audio:', err);
                    });
                    audioStartedRef.current = true;
                }
            } else {
                // In intro period, start animation
                audioStartedRef.current = false;
                playStartTimeRef.current = performance.now();
                introStartTimeRef.current = currentTime;
                // Schedule the animation loop
                animationFrameRef.current = requestAnimationFrame(animateIntro);
            }
        }
    };

    // Cleanup animation frame on unmount
    useEffect(() => {
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, []);

    const handleReset = () => {
        // Reset to beginning of timeline (including intro)
        isPlayingRef.current = false;
        if (audioRef.current) {
            audioRef.current.currentTime = 0;
            audioRef.current.pause();
        }
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        audioStartedRef.current = false;
        setCurrentTime(0);
        setIsPlaying(false);
        // Allow sound cues to fire again from the beginning
        resetSoundCues();
    };

    const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (duration === 0) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const progressWidth = rect.width;
        const newTimelineTime = (x / progressWidth) * duration;

        // Update timeline time
        setCurrentTime(newTimelineTime);

        // Determine audio state based on where user clicked
        if (newTimelineTime >= timelineMeta.audio_start_at) {
            // User clicked past intro - sync audio
            const audioTime = newTimelineTime - timelineMeta.audio_start_at;
            if (audioRef.current) {
                audioRef.current.currentTime = audioTime;
                audioStartedRef.current = true;

                // If currently playing, ensure audio is playing too
                if (isPlaying) {
                    audioRef.current.play().catch((err) => {
                        console.error('❌ AIVideoPlayer: Error resuming audio:', err);
                    });
                }
            }
            // Stop intro animation if running
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        } else {
            // User clicked in intro region
            audioStartedRef.current = false;
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
            }

            // If playing, start intro animation from new position
            if (isPlaying) {
                playStartTimeRef.current = performance.now();
                introStartTimeRef.current = newTimelineTime;
                if (animationFrameRef.current) {
                    cancelAnimationFrame(animationFrameRef.current);
                }
                animationFrameRef.current = requestAnimationFrame(animateIntro);
            }
        }
    };

    // Fullscreen toggle function
    const handleFullscreenToggle = useCallback(() => {
        if (!playerRef.current) return;

        const doc = document as any;
        const player = playerRef.current as any;

        if (!isFullscreen) {
            const requestFS = player.requestFullscreen || player.webkitRequestFullscreen || player.mozRequestFullScreen || player.msRequestFullscreen;

            if (requestFS) {
                const promise = requestFS.call(player);
                if (promise && promise.then) {
                    promise.then(() => {
                        setIsFullscreen(true);
                        try { (screen.orientation as any)?.lock?.('landscape').catch(() => {}); } catch {}
                    }).catch(console.error);
                } else {
                    setIsFullscreen(true);
                    try { (screen.orientation as any)?.lock?.('landscape').catch(() => {}); } catch {}
                }
            } else {
                setIsFullscreen(true);
            }
        } else {
            const exitFS = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;
            const isNativeFullscreen = !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);

            if (exitFS && isNativeFullscreen) {
                const promise = exitFS.call(doc);
                if (promise && promise.then) {
                    promise.then(() => {
                        setIsFullscreen(false);
                        try { (screen.orientation as any)?.unlock?.(); } catch {}
                    }).catch((err: any) => console.error('Error exiting fullscreen:', err));
                } else {
                    setIsFullscreen(false);
                    try { (screen.orientation as any)?.unlock?.(); } catch {}
                }
            } else {
                setIsFullscreen(false);
            }
        }
    }, [isFullscreen]);

    // Listen for fullscreen changes (e.g., user presses Escape)
    useEffect(() => {
        const handleFullscreenChange = () => {
            const doc = document as any;
            const isNativeFullscreen = !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);
            if (!isNativeFullscreen) {
                setIsFullscreen(false);
            } else {
                setIsFullscreen(true);
            }
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.addEventListener('mozfullscreenchange', handleFullscreenChange);
        document.addEventListener('MSFullscreenChange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
            document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
            document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
        };
    }, []);

    // Source video preload: extract URL from SOURCE_CLIP frames, manage playback
    const sourceVideoRef = useRef<HTMLVideoElement | null>(null);
    const sourceVideoUrls = useMemo(() => {
        const urls = new Map<number, string>();
        for (const f of frames) {
            if (f.shot_type !== 'SOURCE_CLIP' || !f.html) continue;
            const m = f.html.match(/src="([^"]+)"/);
            if (m) {
                const idx = f.source_video_index ?? 0;
                if (!urls.has(idx) && m[1]) urls.set(idx, m[1].split('#')[0] ?? '');
            }
        }
        return urls;
    }, [frames]);

    // Find the currently active SOURCE_CLIP frame (if any)
    const activeSourceClip = useMemo(() => {
        return frames.find(
            (f) => f.shot_type === 'SOURCE_CLIP' && currentTime >= f.inTime && currentTime < f.exitTime
        ) ?? null;
    }, [frames, currentTime]);

    // Seek source video when active clip changes
    useEffect(() => {
        const vid = sourceVideoRef.current;
        if (!vid) return;
        if (activeSourceClip) {
            // Calculate source timestamp from output time
            const srcStart = activeSourceClip.source_start ?? 0;
            const srcEnd = activeSourceClip.source_end ?? srcStart;
            const shotProgress = (currentTime - activeSourceClip.inTime) / Math.max(activeSourceClip.exitTime - activeSourceClip.inTime, 0.001);
            const sourceT = srcStart + shotProgress * (srcEnd - srcStart);
            // Only seek if diff > 0.5s (avoid constant seeking during playback)
            if (Math.abs(vid.currentTime - sourceT) > 0.5) {
                vid.currentTime = sourceT;
            }
            if (vid.paused && isPlaying) vid.play().catch(() => {});
        } else {
            if (!vid.paused) vid.pause();
        }
    }, [activeSourceClip, currentTime, isPlaying]);

    // Get ALL active frames at current time, sorted by z-index (lowest first for stacking).
    // Also computes per-frame opacity for the crossfade window so two adjacent shots
    // can blend smoothly — matching the renderer's _active_entries_at logic at
    // generate_video.py:2065-2102 (browser-player ↔ MP4 parity).
    const activeFrames = useMemo(() => {
        if (frames.length === 0) {
            console.log('⚠️ AIVideoPlayer: No frames available for rendering');
            return [];
        }

        // Crossfade duration — matches the pipeline's premium+ `crossfade_duration`
        // tier flag default (0.35s).
        const CROSSFADE_DURATION = 0.35;

        // Include frames whose extended (±crossfade) window covers the current time.
        const active = frames.filter(
            (frame) =>
                currentTime >= frame.inTime - CROSSFADE_DURATION &&
                currentTime < frame.exitTime + CROSSFADE_DURATION
        );

        // Sort by z-index (lowest first, so highest z renders on top when stacked)
        active.sort((a, b) => (a.z || 0) - (b.z || 0));

        // Process HTML for each active frame, plus compute crossfade opacity.
        const processedFrames = active.map((frame, index) => {
            // Mirror of generate_video.py:2094-2099: opacity is 1 inside [inTime,
            // exitTime); ramps in/out over CROSSFADE_DURATION before/after.
            let opacity = 1;
            if (currentTime < frame.inTime) {
                const t = currentTime - (frame.inTime - CROSSFADE_DURATION);
                opacity = Math.max(0, Math.min(1, t / CROSSFADE_DURATION));
            } else if (currentTime >= frame.exitTime) {
                const t = frame.exitTime + CROSSFADE_DURATION - currentTime;
                opacity = Math.max(0, Math.min(1, t / CROSSFADE_DURATION));
            }
            return {
                ...frame,
                opacity,
                processedHtml: frame.html
                    ? processHtmlContent(
                          frame.html,
                          (timelineMeta.content_type as any) || 'VIDEO',
                          index > 0,
                          timelineMeta.palette
                      )
                    : '',
            };
        });

        console.log(`🎬 AIVideoPlayer: Active frames at ${currentTime.toFixed(2)}s:`, {
            count: processedFrames.length,
            frameIds: processedFrames.map((f) => ({ id: f.id, z: f.z })),
            scale,
            containerDimensions: containerRef.current
                ? {
                      width: containerRef.current.clientWidth,
                      height: containerRef.current.clientHeight,
                  }
                : null,
            sampleHtml: processedFrames[0]?.processedHtml?.substring(0, 200),
        });

        return processedFrames;
    }, [frames, currentTime, timelineMeta.content_type]);

    // Loading state - matching YouTube player pattern
    if (isLoading) {
        return (
            <div className={`ai-video-player ${className}`}>
                <div className="video-container">
                    <div className="loading-overlay">
                        <div className="loading-spinner">
                            <div className="spinner"></div>
                            <p>Loading AI video...</p>
                            <p style={{ fontSize: '0.75rem', marginTop: '0.5rem', color: '#666' }}>
                                Fetching timeline data
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className={`ai-video-player ${className}`}>
                <div className="video-placeholder">
                    <div className="video-placeholder-content">
                        <p>Error Loading AI Video</p>
                        <p style={{ fontSize: '0.875rem', color: '#666' }}>{error}</p>
                    </div>
                </div>
            </div>
        );
    }

    // No frames state
    if (frames.length === 0) {
        return (
            <div className={`ai-video-player ${className}`}>
                <div className="video-placeholder">
                    <div className="video-placeholder-content">
                        <p>No Video Frames Available</p>
                        <p style={{ fontSize: '0.875rem', color: '#666' }}>
                            Timeline data is empty
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div
            ref={playerRef}
            className={`ai-video-player ${className} ${isFullscreen ? 'fullscreen' : ''}`}
            style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isFullscreen ? '#000' : 'transparent',
            }}
        >
            {/* Video Container - Fills screen in fullscreen, constrained otherwise */}
            <div
                className="video-container"
                style={{
                    width: '100%',
                    height: isFullscreen ? '100%' : 'auto',
                    maxWidth: '100%',
                    aspectRatio: isFullscreen ? 'auto' : '16/9',
                    maxHeight: '100%',
                    borderRadius: isFullscreen ? '0' : '8px',
                    overflow: 'hidden',
                    boxShadow: isFullscreen ? 'none' : '0 2px 8px rgba(0, 0, 0, 0.1)',
                    position: 'relative',
                }}
                onMouseEnter={(e) => {
                    const controls = e.currentTarget.querySelector(
                        '.video-controls-overlay'
                    ) as HTMLElement;
                    if (controls) controls.style.opacity = '1';
                }}
                onMouseLeave={(e) => {
                    const controls = e.currentTarget.querySelector(
                        '.video-controls-overlay'
                    ) as HTMLElement;
                    if (controls) controls.style.opacity = '0';
                }}
                onClick={handlePlayPause}
            >
                {/* Video Frame - Full size */}
                <div
                    ref={containerRef}
                    className="video-frame-container"
                    style={{
                        width: '100%',
                        height: '100%',
                        background: '#ffffff',
                        position: 'relative',
                        overflow: 'hidden',
                    }}
                >
                    {activeFrames.length > 0 ? (
                        <div
                            style={{
                                width: `${width}px`,
                                height: `${height}px`,
                                transform: `scale(${scale})`,
                                transformOrigin: 'center center',
                                position: 'absolute',
                                top: '50%',
                                left: '50%',
                                marginTop: `-${height / 2}px`,
                                marginLeft: `-${width / 2}px`,
                            }}
                            className="frame-wrapper"
                        >
                            {/* Source video element — preloaded, shown behind iframes during SOURCE_CLIP shots */}
                            {sourceVideoUrls.size > 0 && (
                                <video
                                    ref={sourceVideoRef}
                                    src={sourceVideoUrls.values().next().value}
                                    muted
                                    playsInline
                                    preload="auto"
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                        zIndex: 0,
                                        opacity: activeSourceClip ? 1 : 0,
                                        transition: 'opacity 0.3s ease',
                                        pointerEvents: 'none',
                                    }}
                                />
                            )}
                            {/* Render all active frames with proper z-index layering */}
                            {activeFrames.map((frame, index) => (
                                <iframe
                                    key={`frame-${frame.id}-${index}`}
                                    srcDoc={frame.processedHtml}
                                    style={{
                                        border: 'none',
                                        background: frame.shot_type === 'SOURCE_CLIP' ? 'transparent' : (index === 0 ? canvasBackground(timelineMeta?.palette) : 'transparent'),
                                        position: 'absolute',
                                        ...entryBoxStyle(frame, width, height),
                                        zIndex: frame.z || 0,
                                        opacity: frame.opacity ?? 1,
                                        pointerEvents: frame.id?.startsWith('branding-watermark')
                                            ? 'none'
                                            : 'auto',
                                    }}
                                    title={`AI Video Layer ${frame.id}`}
                                    sandbox="allow-scripts allow-same-origin"
                                    allow="autoplay"
                                    onLoad={() => {
                                        console.log(
                                            '🎬 AIVideoPlayer: iframe loaded successfully',
                                            {
                                                frameId: frame.id,
                                                zIndex: frame.z,
                                            }
                                        );
                                    }}
                                    onError={(e) => {
                                        console.error('❌ AIVideoPlayer: iframe error:', e);
                                    }}
                                />
                            ))}
                        </div>
                    ) : (
                        <div
                            style={{
                                position: 'absolute',
                                inset: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#666',
                            }}
                        >
                            <p>No frame content available</p>
                        </div>
                    )}
                </div>

                {/* Center Play Button - Shows when paused */}
                {!isPlaying && (
                    <div
                        style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            background: 'rgba(0, 0, 0, 0.7)',
                            borderRadius: '50%',
                            width: 'clamp(48px, 8vw, 80px)',
                            height: 'clamp(48px, 8vw, 80px)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            transition: 'transform 0.2s, background 0.2s',
                            zIndex: 5,
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            handlePlayPause();
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1.1)';
                            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.85)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translate(-50%, -50%)';
                            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.7)';
                        }}
                    >
                        <Play className="size-10 text-white" style={{ marginLeft: '4px' }} />
                    </div>
                )}

                {/* Captions / Subtitles Display */}
                {wordsUrl && (
                    <CaptionDisplay
                        words={currentWords}
                        currentTime={currentTime}
                        audioStartAt={timelineMeta.audio_start_at}
                        settings={captionSettings}
                        currentPhrase={currentPhrase}
                        currentWordIndex={currentWordIndex}
                    />
                )}

                {/* Video Controls Overlay - Top in normal mode, bottom in fullscreen */}
                <div
                    className="video-controls-overlay"
                    style={{
                        position: 'absolute',
                        // Top in normal mode, bottom in fullscreen
                        top: isFullscreen ? 'auto' : 0,
                        bottom: isFullscreen ? 0 : 'auto',
                        left: 0,
                        right: 0,
                        // Gradient direction based on position
                        background: isFullscreen
                            ? 'linear-gradient(transparent, rgba(0,0,0,0.8))'
                            : 'linear-gradient(rgba(0,0,0,0.8), transparent)',
                        // Padding: more on the side away from edge
                        padding: isFullscreen ? '40px 16px 16px 16px' : '16px 16px 40px 16px',
                        opacity: isFullscreen ? 1 : 0,
                        transition: 'opacity 0.3s ease',
                        zIndex: 10,
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Progress Bar */}
                    <div
                        className="video-progress"
                        onClick={handleProgressClick}
                        style={{
                            marginBottom: '12px',
                            cursor: 'pointer',
                            padding: '4px 0',
                        }}
                    >
                        <div
                            className="progress-bar"
                            style={{
                                height: '5px',
                                background: 'rgba(255, 255, 255, 0.3)',
                                borderRadius: '3px',
                                overflow: 'hidden',
                                position: 'relative',
                                transition: 'height 0.1s',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.height = '8px';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.height = '5px';
                            }}
                        >
                            {/* SOURCE_CLIP segment indicators */}
                            {duration > 0 && frames.filter(f => f.shot_type === 'SOURCE_CLIP').map((f, i) => (
                                <div
                                    key={`src-seg-${i}`}
                                    style={{
                                        position: 'absolute',
                                        left: `${(f.inTime / duration) * 100}%`,
                                        width: `${((f.exitTime - f.inTime) / duration) * 100}%`,
                                        height: '100%',
                                        background: 'rgba(99, 102, 241, 0.45)',
                                        borderRadius: '3px',
                                        zIndex: 0,
                                    }}
                                    title="Source video audio"
                                />
                            ))}
                            <div
                                className="progress-fill"
                                style={{
                                    width: `${progressPercent}%`,
                                    height: '100%',
                                    background: '#ef4444',
                                    borderRadius: '3px',
                                    transition: 'width 0.1s ease',
                                    position: 'relative',
                                    zIndex: 1,
                                }}
                            />
                        </div>
                    </div>

                    {/* Playback Controls */}
                    <div
                        className="playback-controls"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '16px',
                        }}
                    >
                        <button
                            onClick={handlePlayPause}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            {isPlaying ? (
                                <Pause className="size-6 text-white" />
                            ) : (
                                <Play className="size-6 text-white" style={{ marginLeft: '2px' }} />
                            )}
                        </button>
                        <button
                            onClick={handleReset}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                            title="Restart"
                        >
                            <RotateCcw className="size-5 text-white" />
                        </button>
                        <span
                            className="current-time"
                            style={{
                                fontFamily: 'monospace',
                                fontSize: '0.875rem',
                                color: '#ffffff',
                                fontWeight: 500,
                            }}
                        >
                            {formatTime(currentTime)} / {formatTime(duration)}
                        </span>
                        <span
                            className="frame-indicator"
                            style={{
                                marginLeft: 'auto',
                                fontSize: '0.75rem',
                                color: 'rgba(255, 255, 255, 0.8)',
                                background: 'rgba(255, 255, 255, 0.2)',
                                padding: '4px 10px',
                                borderRadius: '4px',
                            }}
                        >
                            {activeFrames.length} layer{activeFrames.length !== 1 ? 's' : ''} active
                        </span>

                        {/* Captions toggle (CC button) - only when words are available */}
                        {wordsUrl && (
                            <>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleCaptions();
                                    }}
                                    style={{
                                        background: captionSettings.enabled
                                            ? 'rgba(255, 255, 255, 0.2)'
                                            : 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        padding: '4px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        marginLeft: '8px',
                                        borderRadius: '4px',
                                        opacity: captionSettings.enabled ? 1 : 0.6,
                                    }}
                                    title={
                                        captionSettings.enabled
                                            ? 'Turn off captions'
                                            : 'Turn on captions'
                                    }
                                >
                                    <Subtitles className="size-5 text-white" />
                                </button>
                                {captionSettings.enabled && (
                                    <CaptionSettingsPopover
                                        settings={captionSettings}
                                        onUpdate={updateCaptionSettings}
                                    />
                                )}
                            </>
                        )}

                        <button
                            onClick={handleFullscreenToggle}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                marginLeft: '8px',
                            }}
                            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                        >
                            {isFullscreen ? (
                                <Minimize2 className="size-5 text-white" />
                            ) : (
                                <Maximize2 className="size-5 text-white" />
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Hidden Audio Element */}
            <audio
                ref={audioRef}
                src={audioUrl}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => {
                    // Audio ended - check if we need to continue for outro
                    if (timelineMeta.total_duration && currentTime < timelineMeta.total_duration) {
                        // Continue timeline for outro
                        console.log('🎬 AIVideoPlayer: Audio ended, continuing for outro');
                        audioStartedRef.current = false;
                        playStartTimeRef.current = performance.now();
                        introStartTimeRef.current = currentTime;

                        // Animate through outro until total_duration
                        const animateOutro = () => {
                            if (!isPlayingRef.current) return;

                            const elapsed = (performance.now() - playStartTimeRef.current) / 1000;
                            const newTime = introStartTimeRef.current + elapsed;

                            if (newTime >= timelineMeta.total_duration) {
                                setCurrentTime(timelineMeta.total_duration);
                                isPlayingRef.current = false;
                                setIsPlaying(false);
                            } else {
                                setCurrentTime(newTime);
                                requestAnimationFrame(animateOutro);
                            }
                        };
                        requestAnimationFrame(animateOutro);
                    } else {
                        setIsPlaying(false);
                    }
                }}
                crossOrigin="anonymous"
            />
        </div>
    );
};
