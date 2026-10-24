/**
 * AI Content Player Component
 * Unified player supporting 12 content types with 3 navigation modes
 *
 * Content Types: VIDEO, QUIZ, STORYBOOK, INTERACTIVE_GAME, PUZZLE_BOOK,
 *                SIMULATION, FLASHCARDS, MAP_EXPLORATION, WORKSHEET,
 *                CODE_PLAYGROUND, TIMELINE, CONVERSATION
 *
 * Navigation Modes: time_driven, user_driven, self_contained
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
    Play,
    Pause,
    RotateCcw,
    Maximize2,
    Minimize2,
    ChevronLeft,
    ChevronRight,
    Printer,
    Volume2,
    Subtitles,
    Repeat,
    BookOpen,
    List,
    HelpCircle,
    CheckCircle2,
    XCircle,
    Download,
} from 'lucide-react';
import {
    Entry,
    TimelineMeta,
    AIContentPlayerProps,
    CONTENT_TYPE_LABELS,
    MCQQuestion,
    formatEntryLabel,
    getDefaultMeta,
} from './types';
import {
    processHtmlContent,
    generateTimelineHtml,
    generateFlashcardHtml,
    generateStorybookHtml,
    generateQuizHtml,
    generateConversationHtml,
    generateWorksheetHtml,
    generatePuzzleHtml,
    generateMapRegionHtml,
    generateGameHtml,
    generateSimulationHtml,
    generateCodePlaygroundHtml,
    generateSlidesHtml,
} from './html-processor';
import { initializeLibraries } from './library-loader';
import { useCaptions } from './hooks/useCaptions';
import { useWebAudioMixer } from './hooks/useWebAudioMixer';
import { useSoundScheduler, collectCuesFromEntries } from './hooks/useSoundScheduler';
import { CaptionDisplay, CaptionSettingsPopover } from './components';
import '@/components/ai-course-builder/components/styles/AIVideoComponents.css';
import { canvasBackground, entryBoxStyle, fillSceneGaps } from './entry-layout';

/**
 * ScaleCalculator - Calculates scale to fit video in container
 */
class ScaleCalculator {
    private targetWidth: number;
    private targetHeight: number;

    constructor(targetWidth: number = 1920, targetHeight: number = 1080) {
        this.targetWidth = targetWidth;
        this.targetHeight = targetHeight;
    }

    calculateScale(containerWidth: number, containerHeight: number): number {
        const targetRatio = this.targetWidth / this.targetHeight;
        const containerRatio = containerWidth / containerHeight;

        if (containerRatio > targetRatio) {
            return containerHeight / this.targetHeight;
        }
        return containerWidth / this.targetWidth;
    }
}

/**
 * Suppress AbortError from play() — harmless race when pause() interrupts a pending play.
 * Other errors are still logged.
 */
const swallowAbort = (err: unknown) => {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    console.error(err);
};

/**
 * Format time in seconds to MM:SS
 */
const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Main AIContentPlayer Component
 */
export const AIContentPlayer: React.FC<AIContentPlayerProps> = ({
    timelineUrl,
    audioUrl,
    wordsUrl,
    avatarUrl,
    className = '',
    width = 1920,
    height = 1080,
    onEntryChange,
    onComplete,
    onDownloadClick,
}) => {
    // Core state
    const [entries, setEntries] = useState<Entry[]>([]);
    const [meta, setMeta] = useState<TimelineMeta>(getDefaultMeta('VIDEO'));
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [scale, setScale] = useState(1);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [containerWidth, setContainerWidth] = useState(0);

    // Time-driven state (for VIDEO)
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);

    // Engagement & Focus state
    const [isPausedForEngagement, setIsPausedForEngagement] = useState(false);
    const [lastEngagedEntryId, setLastEngagedEntryId] = useState<string | null>(null);
    const [isFocusMode, setIsFocusMode] = useState(false);

    // Glossary panel state
    const [isGlossaryOpen, setIsGlossaryOpen] = useState(false);
    const [seenGlossaryTerms, setSeenGlossaryTerms] = useState<
        Array<{ term: string; time: number }>
    >([]);

    // Chapters panel state
    const [isChaptersOpen, setIsChaptersOpen] = useState(false);

    // MCQ quiz state
    const [questionsEnabled, setQuestionsEnabled] = useState(false);
    const [activeQuestion, setActiveQuestion] = useState<MCQQuestion | null>(null);
    const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
    const answeredQuestionsRef = useRef<Set<number>>(new Set());

    // User-driven state (for QUIZ, STORYBOOK, etc.)
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isAutoplay, setIsAutoplay] = useState(false);

    // Refs
    const audioRef = useRef<HTMLAudioElement>(null);
    const avatarRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<HTMLDivElement>(null);
    const audioStartedRef = useRef(false);
    const animationFrameRef = useRef<number | null>(null);
    const playStartTimeRef = useRef(0);
    const introStartTimeRef = useRef(0);
    const isPlayingRef = useRef(false); // Ref to avoid stale closure issues
    const contentIframeRef = useRef<HTMLIFrameElement>(null); // Ref to the primary content iframe (for print)
    const lastAutoplayedIndexRef = useRef<number>(-1); // Track which page was last auto-played to avoid re-triggering

    // Effective dimensions: prefer meta.dimensions from the loaded timeline, fall back to props
    const effectiveWidth = meta.dimensions?.width || width;
    const effectiveHeight = meta.dimensions?.height || height;

    const scaleCalculator = useMemo(
        () => new ScaleCalculator(effectiveWidth, effectiveHeight),
        [effectiveWidth, effectiveHeight]
    );

    // Computed values
    const contentType = meta.content_type;
    const navigationMode = meta.navigation;
    // Compact mode: hide text labels in controls when player is too narrow for them (tablet/mobile)
    // At ~700px wide, text labels on Focus/Chapters/Quiz buttons push fullscreen off-screen
    const isCompact = containerWidth > 0 && containerWidth < 700;
    // Extra compact for very small screens (phones in portrait)
    const isMini = containerWidth > 0 && containerWidth < 400;

    // Captions hook (only for time-driven content with audio)
    const {
        words: allWords, // Get all words for range calculation
        currentWords,
        currentPhrase,
        currentWordIndex,
        settings: captionSettings,
        updateSettings: updateCaptionSettings,
        toggleCaptions,
    } = useCaptions({
        // Fetch words for time-driven VIDEO or user-driven STORYBOOK/FLASHCARDS/TIMELINE
        wordsUrl:
            navigationMode === 'time_driven' ||
            contentType === 'STORYBOOK' ||
            contentType === 'FLASHCARDS' ||
            contentType === 'TIMELINE'
                ? wordsUrl
                : undefined,
        currentTime,
        audioStartAt: meta.audio_start_at,
        playbackRate,
    });

    // Web Audio mixer for extra tracks (background music, SFX, etc.)
    useWebAudioMixer({
        tracks: meta.audio_tracks,
        audioRef,
        isPlaying,
        currentTime,
    });

    // Sound Planner cues — per-shot transition/chime/impact sound effects.
    // `currentTime` is the master clock (shared with captions, engagement,
    // and mermaid video sync) so we feed it directly into the scheduler.
    const soundCues = useMemo(() => collectCuesFromEntries(entries), [entries]);
    const { resetPlayed: resetSoundCues } = useSoundScheduler({
        cues: soundCues,
        masterClockSec: currentTime,
        isPlaying,
        narrationAudioRef: audioRef,
    });

    // Map page index to audio time range {start, end}
    const pageAudioRanges = useMemo(() => {
        if (!allWords || allWords.length === 0 || entries.length === 0) return new Map();

        const ranges = new Map<number, { start: number; end: number }>();
        let currentWordIndex = 0;

        entries.forEach((entry, index) => {
            const text = (entry.entry_meta?.audio_text ||
                entry.entry_meta?.text ||
                (entry.entry_meta?.description as string) ||
                '') as string;
            // Simple tokenization: remove punctuation, lowercase
            const tokens = text
                .toLowerCase()
                .replace(/[^\w\s]/g, '')
                .split(/\s+/)
                .filter((t: string) => t.length > 0);

            if (tokens.length === 0) return;

            let startIndex = -1;
            let endIndex = -1;

            // Greedy sequential matching
            // We assume words in words.json appear in the same order as pages
            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                // Look ahead up to 20 words to find a match
                for (
                    let j = currentWordIndex;
                    j < Math.min(currentWordIndex + 20, allWords.length);
                    j++
                ) {
                    const word = allWords[j];
                    if (!word) continue;

                    const wToken = word.word.toLowerCase().replace(/[^\w\s]/g, '');

                    if (wToken === token) {
                        if (startIndex === -1) startIndex = j;
                        endIndex = j;
                        currentWordIndex = j + 1; // Advance main pointer
                        break;
                    }
                }
            }

            const startWord = startIndex !== -1 ? allWords[startIndex] : undefined;
            const endWord = endIndex !== -1 ? allWords[endIndex] : undefined;

            if (startWord && endWord) {
                ranges.set(index, {
                    start: startWord.start,
                    end: endWord.end,
                });
            }
        });

        return ranges;
    }, [allWords, entries]);

    // Handle "Read Page" for Storybook
    const handleReadPage = useCallback(() => {
        const range = pageAudioRanges.get(currentIndex);
        if (range && audioRef.current) {
            // Stop any ongoing playback or animation
            if (isPlaying) {
                // If already playing, just pause
                setIsPlaying(false);
                audioRef.current.pause();
                return;
            }

            // Seek and play
            // Add slight padding to start to ensure we don't clip the first syllable
            const seekTime = Math.max(0, range.start);
            audioRef.current.currentTime = seekTime;

            // NOTE: We need to handle stopping at range.end manually in onTimeUpdate

            audioRef.current.play().catch(swallowAbort);
            setIsPlaying(true);
            // We use the audioStartedRef to indicate we are in a valid playback state
            audioStartedRef.current = true;
        }
    }, [currentIndex, pageAudioRanges, isPlaying]);

    // =====================================================
    // USER-DRIVEN NAVIGATION (QUIZ, STORYBOOK, etc.)
    // =====================================================

    const handleNext = useCallback(() => {
        // Stop audio if playing
        if (isPlaying) {
            setIsPlaying(false);
            isPlayingRef.current = false;
            if (audioRef.current) audioRef.current.pause();
        }

        if (currentIndex < entries.length - 1) {
            const newIndex = currentIndex + 1;
            setCurrentIndex(newIndex);
            onEntryChange?.(newIndex, entries[newIndex]!);
        } else {
            onComplete?.();
        }
    }, [currentIndex, entries, onEntryChange, onComplete, isPlaying]);

    const handlePrev = useCallback(() => {
        if (currentIndex > 0) {
            // Stop audio if playing
            if (isPlaying) {
                setIsPlaying(false);
                if (audioRef.current) audioRef.current.pause();
            }
            const newIndex = currentIndex - 1;
            setCurrentIndex(newIndex);
            onEntryChange?.(newIndex, entries[newIndex]!);
        }
    }, [currentIndex, entries, onEntryChange, isPlaying]);

    // Load timeline data
    useEffect(() => {
        const loadTimeline = async () => {
            try {
                setIsLoading(true);
                setError(null);

                const response = await fetch(timelineUrl);
                if (!response.ok) {
                    throw new Error(`Failed to load timeline: ${response.status}`);
                }

                const rawData = await response.json();

                let loadedEntries: Entry[];
                let loadedMeta: TimelineMeta;

                // Parse structure
                if (Array.isArray(rawData)) {
                    // Old format: array of frames
                    loadedEntries = rawData;
                    loadedMeta = getDefaultMeta('VIDEO');
                } else if (rawData.entries && Array.isArray(rawData.entries)) {
                    // New format: { meta, entries }
                    loadedEntries = rawData.entries;
                    loadedMeta = {
                        ...getDefaultMeta(rawData.meta?.content_type || 'VIDEO'),
                        ...rawData.meta,
                    };
                } else {
                    throw new Error('Timeline data is in an unrecognized format');
                }

                if (loadedEntries.length === 0) {
                    throw new Error('Timeline data is empty');
                }

                // Initialize libraries for content type
                await initializeLibraries(loadedMeta.content_type);

                setMeta(loadedMeta);
                setEntries(
                    loadedMeta.navigation === 'time_driven'
                        ? fillSceneGaps(loadedEntries)
                        : loadedEntries
                );

                // Set duration
                if (loadedMeta.total_duration && loadedMeta.total_duration > 0) {
                    setDuration(loadedMeta.total_duration);
                }

                // Autoplay default for STORYBOOK and TIMELINE
                if (loadedMeta.content_type === 'STORYBOOK' || loadedMeta.content_type === 'TIMELINE') {
                    setIsAutoplay(true);
                }

                console.log(
                    `🎬 Loaded ${loadedMeta.content_type} with ${loadedEntries.length} entries`
                );
            } catch (err) {
                console.error('Error loading timeline:', err);
                setError(err instanceof Error ? err.message : 'Failed to load timeline');
            } finally {
                setIsLoading(false);
            }
        };

        if (timelineUrl) {
            loadTimeline();
        } else {
            setError('No timeline URL provided');
            setIsLoading(false);
        }
    }, [timelineUrl]);

    // Scale calculation
    useEffect(() => {
        const updateScale = () => {
            if (containerRef.current) {
                const { clientWidth, clientHeight } = containerRef.current;
                if (clientWidth > 0 && clientHeight > 0) {
                    const newScale = scaleCalculator.calculateScale(clientWidth, clientHeight);
                    setScale(newScale);
                    setContainerWidth(clientWidth);
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
    }, [scaleCalculator, entries.length, isFullscreen]);

    // Reset autoplay tracker when page index changes
    useEffect(() => {
        lastAutoplayedIndexRef.current = -1;
    }, [currentIndex]);

    // Autoplay effect for Storybook/Flashcards/Timeline — triggers on page change or when ranges load
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;

        if (
            isAutoplay &&
            (contentType === 'STORYBOOK' || contentType === 'FLASHCARDS' || contentType === 'TIMELINE') &&
            navigationMode === 'user_driven'
        ) {
            // Only play if we haven't already auto-played this page
            if (
                lastAutoplayedIndexRef.current !== currentIndex &&
                !isPlayingRef.current &&
                pageAudioRanges.has(currentIndex)
            ) {
                const range = pageAudioRanges.get(currentIndex);
                if (range && audioRef.current) {
                    lastAutoplayedIndexRef.current = currentIndex;
                    // Small delay to ensure state settles after handleNext pauses audio
                    timer = setTimeout(() => {
                        // Double check we are still not playing
                        if (!isPlayingRef.current) {
                            const seekTime = Math.max(0, range.start);
                            audioRef.current!.currentTime = seekTime;
                            audioRef.current!.play().catch(swallowAbort);
                            isPlayingRef.current = true;
                            setIsPlaying(true);
                            audioStartedRef.current = true;
                        }
                    }, 150);
                }
            }
        }

        return () => {
            if (timer) clearTimeout(timer);
        };
    }, [currentIndex, isAutoplay, contentType, navigationMode, pageAudioRanges]);

    // =====================================================
    // TIME-DRIVEN NAVIGATION (VIDEO)
    // =====================================================

    // Keep ref in sync with state
    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);

    // Accumulate glossary terms as video time passes their introduction point
    useEffect(() => {
        if (!meta.glossary || navigationMode !== 'time_driven') return;
        const newTerms = meta.glossary.filter(
            (g) => g.time <= currentTime && !seenGlossaryTerms.some((s) => s.term === g.term)
        );
        if (newTerms.length > 0) {
            setSeenGlossaryTerms((prev) => [...prev, ...newTerms]);
        }
    }, [currentTime, meta.glossary, navigationMode]);

    const animateIntro = useCallback(() => {
        // Use ref instead of state to avoid stale closure issues
        if (!isPlayingRef.current) return;

        const elapsed = (performance.now() - playStartTimeRef.current) / 1000;
        const newTime = introStartTimeRef.current + elapsed;

        if (newTime >= meta.audio_start_at && !audioStartedRef.current) {
            if (audioRef.current) {
                audioRef.current.currentTime = 0;
                audioRef.current.play().catch(swallowAbort);
                audioStartedRef.current = true;
            }
            setCurrentTime(newTime);
        } else if (!audioStartedRef.current) {
            setCurrentTime(newTime);
            animationFrameRef.current = requestAnimationFrame(animateIntro);
        }
    }, [meta.audio_start_at]);

    const handleTimeDrivenPlayPause = useCallback(() => {
        if (isPlaying || isPausedForEngagement) {
            isPlayingRef.current = false; // Update ref immediately
            if (audioStartedRef.current && audioRef.current) {
                audioRef.current.pause();
                if (avatarRef.current) avatarRef.current.pause();
            }
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
            setIsPlaying(false);

            // Resume from engagement pause if that was active
            if (isPausedForEngagement) {
                setIsPausedForEngagement(false);
                setIsPlaying(true);
                isPlayingRef.current = true;
                if (audioStartedRef.current && audioRef.current) {
                    audioRef.current.play().catch(swallowAbort);
                }
            }
        } else {
            isPlayingRef.current = true; // Update ref immediately before scheduling animation
            setIsPlaying(true);
            if (currentTime >= meta.audio_start_at) {
                if (audioRef.current) {
                    const audioTime = currentTime - meta.audio_start_at;
                    audioRef.current.currentTime = Math.max(0, audioTime);
                    audioRef.current.play().catch(swallowAbort);
                    if (avatarRef.current) avatarRef.current.play().catch(() => {});
                    audioStartedRef.current = true;
                }
            } else {
                audioStartedRef.current = false;
                playStartTimeRef.current = performance.now();
                introStartTimeRef.current = currentTime;
                animationFrameRef.current = requestAnimationFrame(animateIntro);
            }
        }
    }, [isPlaying, currentTime, meta.audio_start_at, animateIntro]);

    const handleTimeUpdate = useCallback(() => {
        if (audioRef.current && audioStartedRef.current) {
            const time = audioRef.current.currentTime + meta.audio_start_at;

            // For Storybook/Flashcards: Check if we reached the end of the current page's audio
            if (
                navigationMode === 'user_driven' &&
                (contentType === 'STORYBOOK' || contentType === 'FLASHCARDS' || contentType === 'TIMELINE') &&
                isPlaying
            ) {
                const range = pageAudioRanges.get(currentIndex);
                if (range && audioRef.current.currentTime >= range.end) {
                    if (isAutoplay) {
                        // Auto-advance
                        if (currentIndex < entries.length - 1) {
                            handleNext();
                        } else {
                            // End of content
                            audioRef.current.pause();
                            setIsPlaying(false);
                            onComplete?.();
                        }
                    } else {
                        audioRef.current.pause();
                        setIsPlaying(false);
                    }
                }
            }

            setCurrentTime(time);

            // Sync avatar video with audio
            if (avatarRef.current && avatarUrl) {
                const drift = Math.abs(
                    avatarRef.current.currentTime - audioRef.current.currentTime
                );
                if (drift > 0.3) {
                    avatarRef.current.currentTime = audioRef.current.currentTime;
                }
                if (avatarRef.current.playbackRate !== audioRef.current.playbackRate) {
                    avatarRef.current.playbackRate = audioRef.current.playbackRate;
                }
            }

            // Educational features for Time-Driven Video
            if (navigationMode === 'time_driven') {
                const active = entries.filter((entry) => {
                    const start = entry.inTime ?? entry.start ?? 0;
                    const end = entry.exitTime ?? entry.end ?? Infinity;
                    return time >= start && time < end;
                });

                if (active.length > 0) {
                    // 1. Interactive Pause Point: Detect Takeaways/Comparisons
                    // Stop exactly once when entering this segment to force attention
                    const topEntry = active[active.length - 1]; // highest z-index
                    const topEntryHtml = topEntry?.html || '';
                    const needsEngagement =
                        topEntryHtml.includes('key-takeaway') ||
                        topEntryHtml.includes('wrong-right-container');

                    if (
                        needsEngagement &&
                        topEntry?.id !== lastEngagedEntryId &&
                        isPlayingRef.current
                    ) {
                        setLastEngagedEntryId(topEntry?.id || null);
                        if (audioRef.current) {
                            audioRef.current.pause();
                        }
                        setIsPlaying(false);
                        isPlayingRef.current = false;
                        setIsPausedForEngagement(true);
                    }

                    // 2. Focus Mode: Dynamically adjust speed based on complexity
                    if (isFocusMode && audioRef.current) {
                        const hasComplexVisuals = active.some(
                            (e) =>
                                e.html.includes('animateSVG') ||
                                e.html.includes('mermaid') ||
                                e.html.includes('RoughNotation')
                        );
                        // Slow down to 0.75x if complex diagram is drawing, else normal speed
                        audioRef.current.playbackRate = hasComplexVisuals
                            ? playbackRate * 0.75
                            : playbackRate;
                    } else if (audioRef.current && audioRef.current.playbackRate !== playbackRate) {
                        // Reset back to normal if focus mode is off
                        audioRef.current.playbackRate = playbackRate;
                    }
                }
            }
        }
    }, [
        meta.audio_start_at,
        navigationMode,
        contentType,
        isPlaying,
        currentIndex,
        pageAudioRanges,
        isAutoplay,
        entries,
        lastEngagedEntryId,
        isFocusMode,
        playbackRate,
        handleNext,
        onComplete,
    ]);

    const handleLoadedMetadata = useCallback(() => {
        if (audioRef.current && (!meta.total_duration || meta.total_duration === 0)) {
            setDuration(audioRef.current.duration);
        }
    }, [meta.total_duration]);

    const handleAudioEnded = useCallback(() => {
        if (meta.total_duration && currentTime < meta.total_duration) {
            audioStartedRef.current = false;
            playStartTimeRef.current = performance.now();
            introStartTimeRef.current = currentTime;

            const animateOutro = () => {
                if (!isPlayingRef.current) return;

                const elapsed = (performance.now() - playStartTimeRef.current) / 1000;
                const newTime = introStartTimeRef.current + elapsed;

                if (newTime >= meta.total_duration!) {
                    setCurrentTime(meta.total_duration!);
                    isPlayingRef.current = false;
                    setIsPlaying(false);
                    onComplete?.();
                } else {
                    setCurrentTime(newTime);
                    requestAnimationFrame(animateOutro);
                }
            };
            requestAnimationFrame(animateOutro);
        } else {
            isPlayingRef.current = false;
            setIsPlaying(false);
            onComplete?.();
        }
    }, [meta.total_duration, currentTime, onComplete]);

    const handleProgressClick = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (duration === 0) return;

            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const newTime = (x / rect.width) * duration;

            setCurrentTime(newTime);

            if (newTime >= meta.audio_start_at) {
                const audioTime = newTime - meta.audio_start_at;
                if (audioRef.current) {
                    audioRef.current.currentTime = audioTime;
                    audioStartedRef.current = true;
                    if (isPlaying) {
                        audioRef.current.play().catch(swallowAbort);
                    }
                }
                if (animationFrameRef.current) {
                    cancelAnimationFrame(animationFrameRef.current);
                    animationFrameRef.current = null;
                }
            } else {
                audioStartedRef.current = false;
                if (audioRef.current) {
                    audioRef.current.pause();
                    audioRef.current.currentTime = 0;
                }
                if (isPlaying) {
                    playStartTimeRef.current = performance.now();
                    introStartTimeRef.current = newTime;
                    animationFrameRef.current = requestAnimationFrame(animateIntro);
                }
            }
        },
        [duration, meta.audio_start_at, isPlaying, animateIntro]
    );

    // =====================================================
    // COMMON HANDLERS
    // =====================================================

    const handleSpeedChange = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            const nextSpeeds: Record<number, number> = {
                1: 1.25,
                1.25: 1.5,
                1.5: 2,
                2: 0.5,
                0.5: 0.75,
                0.75: 1,
            };
            const nextSpeed = nextSpeeds[playbackRate] || 1;
            setPlaybackRate(nextSpeed);
            if (audioRef.current && !isFocusMode) {
                audioRef.current.playbackRate = nextSpeed;
            }
        },
        [playbackRate, isFocusMode]
    );

    const handleReset = useCallback(() => {
        if (navigationMode === 'time_driven') {
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
            setActiveQuestion(null);
            setSelectedAnswer(null);
            answeredQuestionsRef.current.clear();
            // Allow sound cues to fire again from the beginning
            resetSoundCues();
        } else {
            setCurrentIndex(0);
            if (entries[0]) {
                onEntryChange?.(0, entries[0]);
            }
        }
    }, [navigationMode, entries, onEntryChange, resetSoundCues]);

    const handleFullscreenToggle = useCallback(() => {
        if (!playerRef.current) return;

        const doc = document as any;
        const player = playerRef.current as any;

        if (!isFullscreen) {
            const requestFS =
                player.requestFullscreen ||
                player.webkitRequestFullscreen ||
                player.mozRequestFullScreen ||
                player.msRequestFullscreen;

            if (requestFS) {
                const promise = requestFS.call(player);
                if (promise && promise.then) {
                    const orientationLock =
                        effectiveHeight > effectiveWidth ? 'portrait' : 'landscape';
                    promise
                        .then(() => {
                            setIsFullscreen(true);
                            try {
                                (screen.orientation as any)
                                    ?.lock?.(orientationLock)
                                    .catch(() => {});
                            } catch {}
                        })
                        .catch(console.error);
                } else {
                    const orientationLock =
                        effectiveHeight > effectiveWidth ? 'portrait' : 'landscape';
                    setIsFullscreen(true);
                    try {
                        (screen.orientation as any)?.lock?.(orientationLock).catch(() => {});
                    } catch {}
                }
            } else {
                // Fallback for browsers that don't support fullscreen API on divs (like iOS Safari)
                setIsFullscreen(true);
            }
        } else {
            const exitFS =
                doc.exitFullscreen ||
                doc.webkitExitFullscreen ||
                doc.mozCancelFullScreen ||
                doc.msExitFullscreen;
            const isNativeFullscreen = !!(
                doc.fullscreenElement ||
                doc.webkitFullscreenElement ||
                doc.mozFullScreenElement ||
                doc.msFullscreenElement
            );

            if (exitFS && isNativeFullscreen) {
                const promise = exitFS.call(doc);
                if (promise && promise.then) {
                    promise
                        .then(() => {
                            setIsFullscreen(false);
                            try {
                                (screen.orientation as any)?.unlock?.();
                            } catch {}
                        })
                        .catch(console.error);
                } else {
                    setIsFullscreen(false);
                    try {
                        (screen.orientation as any)?.unlock?.();
                    } catch {}
                }
            } else {
                setIsFullscreen(false);
            }
        }
    }, [isFullscreen]);

    // Print handler for WORKSHEET — prints only the content iframe, not the whole page
    const handlePrint = useCallback(() => {
        const iframe = contentIframeRef.current;
        if (iframe?.contentWindow) {
            iframe.contentWindow.print();
        } else {
            window.print();
        }
    }, []);

    // Text-to-speech for CONVERSATION — language resolved from timeline meta
    const handleSpeak = useCallback(
        (text: string) => {
            const LANGUAGE_TO_BCP47: Record<string, string> = {
                english: 'en-US',
                'english (us)': 'en-US',
                'english (uk)': 'en-GB',
                'english (india)': 'en-IN',
                hindi: 'hi-IN',
                bengali: 'bn-IN',
                tamil: 'ta-IN',
                telugu: 'te-IN',
                marathi: 'mr-IN',
                kannada: 'kn-IN',
                gujarati: 'gu-IN',
                malayalam: 'ml-IN',
                french: 'fr-FR',
                spanish: 'es-ES',
                german: 'de-DE',
                japanese: 'ja-JP',
                chinese: 'zh-CN',
            };
            const langKey = (meta.language || 'English').toLowerCase().trim();
            const bcp47 = LANGUAGE_TO_BCP47[langKey] || 'en-US';
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = bcp47;
            speechSynthesis.speak(utterance);
        },
        [meta.language]
    );

    // Fullscreen change listener
    useEffect(() => {
        const handleFullscreenChange = () => {
            const doc = document as any;
            const isNativeFullscreen = !!(
                doc.fullscreenElement ||
                doc.webkitFullscreenElement ||
                doc.mozFullScreenElement ||
                doc.msFullscreenElement
            );
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

    // Cleanup
    useEffect(() => {
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, []);

    // =====================================================
    // ACTIVE ENTRIES COMPUTATION
    // =====================================================

    const activeEntries = useMemo(() => {
        if (entries.length === 0) return [];

        if (navigationMode === 'time_driven') {
            // For VIDEO: find all entries active at current time
            const active = entries.filter((entry) => {
                const start = entry.inTime ?? entry.start ?? 0;
                const end = entry.exitTime ?? entry.end ?? Infinity;
                return currentTime >= start && currentTime < end;
            });

            active.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

            // Separate branding entries (intro/outro/watermark) from content entries
            const brandingEntries = active.filter((e) => e.id?.startsWith('branding-'));
            const contentEntries = active.filter((e) => !e.id?.startsWith('branding-'));

            // Content entries go through full HTML processing
            const processedContent = contentEntries.map((entry, index) => ({
                ...entry,
                processedHtml: processHtmlContent(entry.html, contentType, index > 0, meta.palette),
            }));

            // Branding entries already contain complete HTML — skip processHtmlContent
            const processedBranding = brandingEntries.map((entry) => ({
                ...entry,
                processedHtml: entry.html,
            }));

            return [...processedContent, ...processedBranding];
        } else if (navigationMode === 'user_driven') {
            // For QUIZ, STORYBOOK, etc.: show current entry
            const entry = entries[currentIndex];
            if (!entry) return [];

            // Check if we need to generate HTML for TIMELINE
            let htmlContent = entry.html;
            if (contentType === 'TIMELINE' && entry.entry_meta) {
                // If html is basic placeholder or empty, generate from meta
                if (!htmlContent || htmlContent.includes('<div>Event') || htmlContent.length < 50) {
                    htmlContent = generateTimelineHtml(entry, currentIndex, entries);
                }
            } else if (contentType === 'FLASHCARDS') {
                // Fall back to client-side generator only when the HTML is clearly a placeholder
                // (empty, very short, or the stock backend fallback). Preserve real LLM HTML.
                const isPlaceholder =
                    !htmlContent || htmlContent.length < 80 || htmlContent.includes('<div>Card');
                if (isPlaceholder) {
                    htmlContent = generateFlashcardHtml(entry, currentIndex, entries);
                }
            } else if (contentType === 'STORYBOOK') {
                if (!htmlContent || htmlContent.length < 80 || htmlContent.includes('<div>Page')) {
                    htmlContent = generateStorybookHtml(entry, currentIndex, entries);
                }
            } else if (contentType === 'QUIZ') {
                if (
                    !htmlContent ||
                    htmlContent.length < 80 ||
                    htmlContent.includes('<div>Question')
                ) {
                    htmlContent = generateQuizHtml(entry, currentIndex, entries);
                }
            } else if (contentType === 'CONVERSATION') {
                if (
                    !htmlContent ||
                    htmlContent.length < 80 ||
                    htmlContent.includes('<div>Exchange')
                ) {
                    htmlContent = generateConversationHtml(entry, currentIndex, entries);
                }
            } else if (contentType === 'WORKSHEET') {
                if (
                    !htmlContent ||
                    htmlContent.length < 80 ||
                    htmlContent.includes('<div>Exercise')
                ) {
                    htmlContent = generateWorksheetHtml(entry, currentIndex, entries);
                }
            } else if (contentType === 'PUZZLE_BOOK') {
                if (
                    !htmlContent ||
                    htmlContent.length < 80 ||
                    htmlContent.includes('<div>Puzzle')
                ) {
                    htmlContent = generatePuzzleHtml(entry, currentIndex, entries);
                }
            } else if (contentType === 'MAP_EXPLORATION') {
                if (
                    !htmlContent ||
                    htmlContent.length < 80 ||
                    htmlContent.includes('<div>Region')
                ) {
                    htmlContent = generateMapRegionHtml(entry, currentIndex, entries);
                }
            } else if (contentType === 'SLIDES') {
                if (!htmlContent || htmlContent.length < 80 || htmlContent.includes('<div>Slide')) {
                    htmlContent = generateSlidesHtml(entry, currentIndex, entries);
                }
            }

            return [
                {
                    ...entry,
                    processedHtml: processHtmlContent(
                        htmlContent,
                        contentType,
                        false,
                        meta.palette
                    ),
                },
            ];
        } else {
            // SELF_CONTAINED: INTERACTIVE_GAME, SIMULATION, CODE_PLAYGROUND
            const entry = entries[0];
            if (!entry) return [];

            let htmlContent = entry.html;
            if (contentType === 'INTERACTIVE_GAME') {
                if (
                    !htmlContent ||
                    htmlContent.length < 80 ||
                    htmlContent.includes('<div>Game Container')
                ) {
                    htmlContent = generateGameHtml(entry);
                }
            } else if (contentType === 'SIMULATION') {
                if (
                    !htmlContent ||
                    htmlContent.length < 80 ||
                    htmlContent.includes('<div>Simulation')
                ) {
                    htmlContent = generateSimulationHtml(entry);
                }
            } else if (contentType === 'CODE_PLAYGROUND') {
                if (
                    !htmlContent ||
                    htmlContent.length < 80 ||
                    htmlContent.includes('<div>Code Playground')
                ) {
                    htmlContent = generateCodePlaygroundHtml(entry);
                }
            }

            return [
                {
                    ...entry,
                    processedHtml: processHtmlContent(
                        htmlContent,
                        contentType,
                        false,
                        meta.palette
                    ),
                },
            ];
        }
    }, [entries, currentTime, currentIndex, navigationMode, contentType, meta.palette]);

    // Current chapter index (highest chapter whose start time <= currentTime)
    // MUST be before early returns to satisfy Rules of Hooks
    const currentChapterIndex = useMemo(() => {
        if (!meta.chapters || meta.chapters.length === 0 || navigationMode !== 'time_driven')
            return -1;
        let idx = 0;
        for (let i = 0; i < meta.chapters.length; i++) {
            if (currentTime >= meta.chapters[i]!.time) idx = i;
        }
        return idx;
    }, [currentTime, meta.chapters, navigationMode]);

    // =====================================================
    // MCQ QUESTION TRIGGERING
    // =====================================================

    // Pause video and show MCQ overlay when currentTime crosses a question's timestamp
    useEffect(() => {
        if (
            navigationMode !== 'time_driven' ||
            !questionsEnabled ||
            !meta.questions?.length ||
            activeQuestion ||
            !isPlaying
        )
            return;

        for (const q of meta.questions) {
            if (currentTime >= q.time && !answeredQuestionsRef.current.has(q.time)) {
                // Mark immediately (synchronous ref write) so subsequent effect runs
                // from stale renders before state commits cannot re-trigger this question.
                answeredQuestionsRef.current.add(q.time);
                // Pause all playback
                if (audioRef.current) audioRef.current.pause();
                if (avatarRef.current) avatarRef.current.pause();
                if (animationFrameRef.current) {
                    cancelAnimationFrame(animationFrameRef.current);
                    animationFrameRef.current = null;
                }
                isPlayingRef.current = false;
                setIsPlaying(false);
                setActiveQuestion(q);
                break;
            }
        }
    }, [currentTime, navigationMode, questionsEnabled, meta.questions, activeQuestion, isPlaying]);

    // Dismiss active question (after answering or skipping) and resume playback
    const handleDismissQuestion = useCallback(() => {
        setActiveQuestion(null);
        setSelectedAnswer(null);
        // Resume audio from current position
        if (audioRef.current && audioStartedRef.current) {
            audioRef.current.play().catch(swallowAbort);
            if (avatarRef.current) avatarRef.current.play().catch(() => {});
        }
        isPlayingRef.current = true;
        setIsPlaying(true);
    }, [activeQuestion]);

    // =====================================================
    // MESSAGE HANDLING (Inter-iframe communication)
    // =====================================================
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            // Validate origin if needed, or check event.data structure
            if (!event.data || typeof event.data !== 'object') return;

            const { type, payload } = event.data;

            switch (type) {
                case 'QUIZ_ANSWER_SELECTED':
                    console.log('Quiz answer selected:', payload);
                    // Handle score tracking here if needed
                    break;
                case 'QUIZ_COMPLETED':
                    console.log('Quiz completed:', payload);
                    // Maybe auto-advance or show summary
                    break;
                case 'NAVIGATE_NEXT':
                    handleNext();
                    break;
                case 'NAVIGATE_PREV':
                    handlePrev();
                    break;
                case 'SPEAK':
                    // TTS request from within an iframe (e.g. per-bubble audio buttons in CONVERSATION)
                    if (payload?.text) handleSpeak(payload.text);
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, [handleNext, handlePrev]);

    // =====================================================

    // =====================================================
    // RENDER
    // =====================================================

    // Loading state
    if (isLoading) {
        return (
            <div className={`ai-video-player ${className}`}>
                <div className="video-container">
                    <div className="loading-overlay">
                        <div className="loading-spinner">
                            <div className="spinner"></div>
                            <p>Loading content...</p>
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
                        <p>Error Loading Content</p>
                        <p style={{ fontSize: '0.875rem', color: '#666' }}>{error}</p>
                    </div>
                </div>
            </div>
        );
    }

    // No entries
    if (entries.length === 0) {
        return (
            <div className={`ai-video-player ${className}`}>
                <div className="video-placeholder">
                    <div className="video-placeholder-content">
                        <p>No Content Available</p>
                    </div>
                </div>
            </div>
        );
    }

    const progressPercent =
        navigationMode === 'time_driven'
            ? duration > 0
                ? (currentTime / duration) * 100
                : 0
            : ((currentIndex + 1) / entries.length) * 100;

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
            {/* Video Container */}
            <div
                className="video-container"
                style={{
                    width: '100%',
                    height: isFullscreen ? '100%' : 'auto',
                    maxWidth: '100%',
                    aspectRatio: isFullscreen ? 'auto' : `${effectiveWidth}/${effectiveHeight}`,
                    maxHeight: '100%',
                    borderRadius: isFullscreen ? '0' : '8px',
                    overflow: 'hidden',
                    boxShadow: isFullscreen ? 'none' : '0 2px 8px rgba(0, 0, 0, 0.1)',
                    position: 'relative',
                }}
                onMouseEnter={(e) => {
                    // Only manage opacity for time_driven — user_driven/self_contained controls are always visible
                    if (navigationMode !== 'time_driven') return;
                    const controls = e.currentTarget.querySelector(
                        '.video-controls-overlay'
                    ) as HTMLElement;
                    if (controls) controls.style.opacity = '1';
                }}
                onMouseLeave={(e) => {
                    if (navigationMode !== 'time_driven') return;
                    const controls = e.currentTarget.querySelector(
                        '.video-controls-overlay'
                    ) as HTMLElement;
                    if (controls) controls.style.opacity = '0';
                }}
                onTouchStart={(e) => {
                    // On mobile touch: toggle controls visibility for time_driven
                    if (navigationMode !== 'time_driven') return;
                    const controls = e.currentTarget.querySelector(
                        '.video-controls-overlay'
                    ) as HTMLElement;
                    if (controls) {
                        const visible = controls.style.opacity === '1';
                        controls.style.opacity = visible ? '0' : '1';
                        // Auto-hide after 4 seconds
                        if (!visible) {
                            setTimeout(() => {
                                if (controls) controls.style.opacity = '0';
                            }, 4000);
                        }
                    }
                }}
                onClick={navigationMode === 'time_driven' ? handleTimeDrivenPlayPause : undefined}
            >
                {/* Content Frame */}
                <div
                    ref={containerRef}
                    className="video-frame-container"
                    style={{
                        width: '100%',
                        height: '100%',
                        minHeight: isFullscreen ? '0px' : isCompact ? '0px' : '300px',
                        aspectRatio: isFullscreen ? 'auto' : `${effectiveWidth}/${effectiveHeight}`,
                        background: '#ffffff',
                        position: 'relative',
                        overflow: 'hidden',
                    }}
                >
                    {activeEntries.length > 0 ? (
                        <div
                            style={{
                                width: `${effectiveWidth}px`,
                                height: `${effectiveHeight}px`,
                                transform: `scale(${scale})`,
                                transformOrigin: 'center center',
                                position: 'absolute',
                                top: '50%',
                                left: '50%',
                                marginTop: `-${effectiveHeight / 2}px`,
                                marginLeft: `-${effectiveWidth / 2}px`,
                                background: canvasBackground(meta.palette),
                            }}
                            className="frame-wrapper"
                        >
                            {activeEntries.map((entry, index) => (
                                <iframe
                                    key={`entry-${entry.id}-${index}`}
                                    ref={index === 0 ? contentIframeRef : undefined}
                                    srcDoc={entry.processedHtml}
                                    style={{
                                        border: 'none',
                                        background:
                                            index === 0 ? canvasBackground(meta.palette) : 'transparent',
                                        position: 'absolute',
                                        ...entryBoxStyle(entry, effectiveWidth, effectiveHeight),
                                        zIndex: entry.z ?? 0,
                                        pointerEvents:
                                            entry.id?.startsWith('branding-watermark') ||
                                            navigationMode === 'time_driven'
                                                ? 'none'
                                                : 'auto',
                                    }}
                                    title={`Content Layer ${entry.id}`}
                                    sandbox={
                                        // CODE_PLAYGROUND must NOT have allow-same-origin together with allow-scripts
                                        // (that combination defeats the sandbox). Scripts-only is sufficient for code execution.
                                        // All other types keep allow-same-origin so their CDN libraries and inline scripts work.
                                        contentType === 'CODE_PLAYGROUND'
                                            ? 'allow-scripts'
                                            : 'allow-scripts allow-same-origin'
                                    }
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
                            <p>No content available</p>
                        </div>
                    )}
                </div>

                {/* Avatar Video Overlay */}
                {avatarUrl && navigationMode === 'time_driven' && (
                    <video
                        ref={avatarRef}
                        src={avatarUrl}
                        muted
                        playsInline
                        crossOrigin="anonymous"
                        style={{
                            position: 'absolute',
                            bottom: '20px',
                            right: '20px',
                            width: '200px',
                            height: '200px',
                            borderRadius: '50%',
                            objectFit: 'cover',
                            zIndex: 50,
                            border: '3px solid rgba(255, 255, 255, 0.3)',
                            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
                            pointerEvents: 'none',
                        }}
                    />
                )}

                {/* Center Play Button (only for time_driven and when paused) */}
                {navigationMode === 'time_driven' && !isPlaying && (
                    <div
                        style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            background: 'rgba(0, 0, 0, 0.7)',
                            borderRadius: '50%',
                            width: isMini ? '56px' : '80px',
                            height: isMini ? '56px' : '80px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            zIndex: 5,
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            handleTimeDrivenPlayPause();
                        }}
                    >
                        <Play
                            className={`${isMini ? 'size-7' : 'size-10'} text-white`}
                            style={{ marginLeft: '4px' }}
                        />
                    </div>
                )}

                {/* Engagement Pause Overlay */}
                {isPausedForEngagement && (
                    <div
                        style={{
                            position: 'absolute',
                            inset: 0,
                            background: 'rgba(0, 0, 0, 0.4)',
                            backdropFilter: 'blur(4px)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 40,
                            cursor: 'pointer',
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            handleTimeDrivenPlayPause();
                        }}
                    >
                        <div
                            style={{
                                background: '#2563eb',
                                color: 'white',
                                padding: '16px 32px',
                                borderRadius: '50px',
                                fontSize: '20px',
                                fontWeight: 700,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                boxShadow: '0 8px 32px rgba(37, 99, 235, 0.4)',
                                transform: 'translateY(100px)',
                                animation:
                                    'slideUpBounce 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
                            }}
                        >
                            Got it? Click to continue <Play className="size-5" />
                        </div>
                    </div>
                )}

                {/* MCQ Question Overlay */}
                {activeQuestion && (
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            position: 'absolute',
                            inset: 0,
                            background: 'rgba(0, 0, 0, 0.72)',
                            backdropFilter: 'blur(6px)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 55,
                            padding: isCompact ? '12px' : '24px',
                            overflowY: 'auto',
                        }}
                    >
                        <div
                            style={{
                                background: '#0f172a',
                                border: '1px solid rgba(255,255,255,0.12)',
                                borderRadius: isCompact ? '12px' : '16px',
                                padding: isCompact ? '16px' : '28px 32px',
                                maxWidth: '640px',
                                width: '100%',
                                maxHeight: '100%',
                                overflowY: 'auto',
                                boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
                                animation:
                                    'slideUpBounce 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
                            }}
                        >
                            {/* Header */}
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    marginBottom: '16px',
                                }}
                            >
                                <HelpCircle style={{ color: '#60a5fa', flexShrink: 0 }} size={18} />
                                <span
                                    style={{
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        color: '#60a5fa',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.1em',
                                    }}
                                >
                                    Quick Check
                                </span>
                                <div style={{ flex: 1 }} />
                                <button
                                    onClick={handleDismissQuestion}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        color: 'rgba(255,255,255,0.35)',
                                        fontSize: '12px',
                                        padding: '2px 6px',
                                    }}
                                >
                                    Skip
                                </button>
                            </div>

                            {/* Question */}
                            <p
                                style={{
                                    color: '#f1f5f9',
                                    fontSize: isCompact ? '14px' : '16px',
                                    fontWeight: 600,
                                    lineHeight: 1.5,
                                    marginBottom: isCompact ? '12px' : '20px',
                                }}
                            >
                                {activeQuestion.question}
                            </p>

                            {/* Options */}
                            <div
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: isCompact ? '6px' : '10px',
                                    marginBottom: isCompact ? '12px' : '20px',
                                }}
                            >
                                {activeQuestion.options.map((option, i) => {
                                    const isSelected = selectedAnswer === i;
                                    const isCorrect = i === activeQuestion.correct;
                                    const hasAnswered = selectedAnswer !== null;

                                    let bg = 'rgba(255,255,255,0.05)';
                                    let border = 'rgba(255,255,255,0.1)';
                                    let color = '#e2e8f0';

                                    if (hasAnswered) {
                                        if (isCorrect) {
                                            bg = 'rgba(34, 197, 94, 0.15)';
                                            border = '#22c55e';
                                            color = '#bbf7d0';
                                        } else if (isSelected && !isCorrect) {
                                            bg = 'rgba(239, 68, 68, 0.15)';
                                            border = '#ef4444';
                                            color = '#fca5a5';
                                        }
                                    } else if (isSelected) {
                                        bg = 'rgba(96, 165, 250, 0.15)';
                                        border = '#60a5fa';
                                        color = '#bfdbfe';
                                    }

                                    return (
                                        <button
                                            key={i}
                                            onClick={() => !hasAnswered && setSelectedAnswer(i)}
                                            disabled={hasAnswered}
                                            style={{
                                                background: bg,
                                                border: `1px solid ${border}`,
                                                borderRadius: isCompact ? '8px' : '10px',
                                                padding: isCompact ? '8px 12px' : '12px 16px',
                                                cursor: hasAnswered ? 'default' : 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: isCompact ? '8px' : '12px',
                                                transition: 'all 0.15s ease',
                                                textAlign: 'left',
                                                width: '100%',
                                            }}
                                        >
                                            <span
                                                style={{
                                                    width: isCompact ? '22px' : '26px',
                                                    height: isCompact ? '22px' : '26px',
                                                    borderRadius: '50%',
                                                    background: 'rgba(255,255,255,0.08)',
                                                    border: `1px solid ${border}`,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    fontSize: isCompact ? '10px' : '12px',
                                                    fontWeight: 700,
                                                    color: color,
                                                    flexShrink: 0,
                                                }}
                                            >
                                                {String.fromCharCode(65 + i)}
                                            </span>
                                            <span
                                                style={{
                                                    color,
                                                    fontSize: isCompact ? '13px' : '14px',
                                                    fontWeight: 500,
                                                }}
                                            >
                                                {option}
                                            </span>
                                            {hasAnswered && isCorrect && (
                                                <CheckCircle2
                                                    size={16}
                                                    style={{
                                                        color: '#22c55e',
                                                        marginLeft: 'auto',
                                                        flexShrink: 0,
                                                    }}
                                                />
                                            )}
                                            {hasAnswered && isSelected && !isCorrect && (
                                                <XCircle
                                                    size={16}
                                                    style={{
                                                        color: '#ef4444',
                                                        marginLeft: 'auto',
                                                        flexShrink: 0,
                                                    }}
                                                />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Explanation (shown after answering) */}
                            {selectedAnswer !== null && activeQuestion.explanation && (
                                <div
                                    style={{
                                        background: 'rgba(96, 165, 250, 0.08)',
                                        border: '1px solid rgba(96, 165, 250, 0.2)',
                                        borderRadius: '8px',
                                        padding: '12px 14px',
                                        marginBottom: '16px',
                                        fontSize: '13px',
                                        color: '#94a3b8',
                                        lineHeight: 1.6,
                                    }}
                                >
                                    <span style={{ fontWeight: 700, color: '#60a5fa' }}>
                                        Explanation:{' '}
                                    </span>
                                    {activeQuestion.explanation}
                                </div>
                            )}

                            {/* Continue button (shown after answering) */}
                            {selectedAnswer !== null && (
                                <button
                                    onClick={handleDismissQuestion}
                                    style={{
                                        width: '100%',
                                        background: '#2563eb',
                                        border: 'none',
                                        borderRadius: '10px',
                                        padding: '12px',
                                        color: 'white',
                                        fontSize: '14px',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '8px',
                                    }}
                                >
                                    Continue <Play size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Captions / Subtitles Display */}
                {(navigationMode === 'time_driven' ||
                    contentType === 'STORYBOOK' ||
                    contentType === 'FLASHCARDS' ||
                    contentType === 'TIMELINE') &&
                    wordsUrl && (
                        <CaptionDisplay
                            words={currentWords}
                            currentTime={currentTime}
                            audioStartAt={meta.audio_start_at}
                            settings={captionSettings}
                            currentPhrase={currentPhrase}
                            currentWordIndex={currentWordIndex}
                        />
                    )}

                {/* Chapters Panel — slides in from left when open */}
                {isChaptersOpen && meta.chapters && meta.chapters.length > 0 && (
                    <>
                        {/* Backdrop to close on outside click */}
                        <div
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsChaptersOpen(false);
                            }}
                            style={{
                                position: 'absolute',
                                inset: 0,
                                zIndex: 34,
                            }}
                        />
                        <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                position: 'absolute',
                                top: '12px',
                                left: '12px',
                                width: 'min(280px, calc(100% - 24px))',
                                maxHeight: '65%',
                                background: 'rgba(10, 15, 25, 0.92)',
                                borderRadius: '12px',
                                padding: '16px',
                                zIndex: 35,
                                overflowY: 'auto',
                                backdropFilter: 'blur(10px)',
                                border: '1px solid rgba(255,255,255,0.12)',
                                boxSizing: 'border-box',
                            }}
                        >
                            <div
                                style={{
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    color: '#f87171',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.1em',
                                    marginBottom: '10px',
                                }}
                            >
                                Chapters ({meta.chapters.length})
                            </div>
                            {meta.chapters.map((chapter, i) => {
                                const isActive = i === currentChapterIndex;
                                return (
                                    <div
                                        key={i}
                                        onClick={() => {
                                            setCurrentTime(chapter.time);
                                            if (
                                                chapter.time >= meta.audio_start_at &&
                                                audioRef.current
                                            ) {
                                                audioRef.current.currentTime =
                                                    chapter.time - meta.audio_start_at;
                                                audioStartedRef.current = true;
                                                if (isPlaying)
                                                    audioRef.current.play().catch(swallowAbort);
                                            }
                                            setIsChaptersOpen(false);
                                        }}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: '8px 10px',
                                            marginBottom: '5px',
                                            borderRadius: '7px',
                                            background: isActive
                                                ? 'rgba(239, 68, 68, 0.18)'
                                                : 'rgba(255,255,255,0.05)',
                                            border: `1px solid ${isActive ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255,255,255,0.08)'}`,
                                            cursor: 'pointer',
                                            transition: 'background 0.15s ease',
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                overflow: 'hidden',
                                            }}
                                        >
                                            {isActive && (
                                                <div
                                                    style={{
                                                        width: '6px',
                                                        height: '6px',
                                                        borderRadius: '50%',
                                                        background: '#ef4444',
                                                        flexShrink: 0,
                                                    }}
                                                />
                                            )}
                                            {!isActive && (
                                                <span
                                                    style={{
                                                        color: 'rgba(255,255,255,0.25)',
                                                        fontSize: '11px',
                                                        fontFamily: 'monospace',
                                                        flexShrink: 0,
                                                        width: '14px',
                                                        textAlign: 'right',
                                                    }}
                                                >
                                                    {i + 1}
                                                </span>
                                            )}
                                            <span
                                                style={{
                                                    color: isActive ? '#fca5a5' : '#e2e8f0',
                                                    fontSize: '13px',
                                                    fontWeight: isActive ? 700 : 400,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {chapter.label}
                                            </span>
                                        </div>
                                        <span
                                            style={{
                                                color: 'rgba(255,255,255,0.35)',
                                                fontSize: '11px',
                                                fontFamily: 'monospace',
                                                marginLeft: '8px',
                                                flexShrink: 0,
                                            }}
                                        >
                                            {formatTime(chapter.time)}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}

                {/* Glossary Panel — slides in from right when open */}
                {isGlossaryOpen && seenGlossaryTerms.length > 0 && (
                    <>
                        {/* Backdrop to close on outside click */}
                        <div
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsGlossaryOpen(false);
                            }}
                            style={{
                                position: 'absolute',
                                inset: 0,
                                zIndex: 34,
                            }}
                        />
                        <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                position: 'absolute',
                                top: '12px',
                                right: '12px',
                                width: 'min(260px, calc(100% - 24px))',
                                maxHeight: '65%',
                                background: 'rgba(10, 15, 25, 0.92)',
                                borderRadius: '12px',
                                padding: '16px',
                                zIndex: 35,
                                overflowY: 'auto',
                                backdropFilter: 'blur(10px)',
                                border: '1px solid rgba(255,255,255,0.12)',
                                boxSizing: 'border-box',
                            }}
                        >
                            <div
                                style={{
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    color: '#60a5fa',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.1em',
                                    marginBottom: '10px',
                                }}
                            >
                                Key Terms
                            </div>
                            {seenGlossaryTerms.map((item, i) => (
                                <div
                                    key={i}
                                    title={`Jump to ${formatTime(item.time)}`}
                                    onClick={() => {
                                        setCurrentTime(item.time);
                                        if (item.time >= meta.audio_start_at && audioRef.current) {
                                            audioRef.current.currentTime =
                                                item.time - meta.audio_start_at;
                                            audioStartedRef.current = true;
                                            if (isPlaying)
                                                audioRef.current.play().catch(swallowAbort);
                                        }
                                    }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '7px 10px',
                                        marginBottom: '5px',
                                        borderRadius: '7px',
                                        background: 'rgba(59, 130, 246, 0.12)',
                                        border: '1px solid rgba(59, 130, 246, 0.25)',
                                        cursor: 'pointer',
                                    }}
                                >
                                    <span
                                        style={{
                                            color: '#e2e8f0',
                                            fontSize: '13px',
                                            fontWeight: 600,
                                        }}
                                    >
                                        {item.term}
                                    </span>
                                    <span
                                        style={{
                                            color: 'rgba(255,255,255,0.35)',
                                            fontSize: '11px',
                                            fontFamily: 'monospace',
                                            marginLeft: '8px',
                                            flexShrink: 0,
                                        }}
                                    >
                                        {formatTime(item.time)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {/* Controls Overlay */}
                <div
                    className="video-controls-overlay"
                    style={{
                        position: 'absolute',
                        top: isFullscreen ? 'auto' : 0,
                        bottom: isFullscreen ? 0 : 'auto',
                        left: 0,
                        right: 0,
                        background: isFullscreen
                            ? 'linear-gradient(transparent, rgba(0,0,0,0.8))'
                            : 'linear-gradient(rgba(0,0,0,0.8), transparent)',
                        padding: isFullscreen
                            ? isMini
                                ? '24px 8px 8px 8px'
                                : '40px 16px 16px 16px'
                            : isMini
                              ? '8px 8px 24px 8px'
                              : '16px 16px 40px 16px',
                        // For user_driven/self_contained, controls are always visible (no hover needed — navigation IS the UI)
                        // For time_driven, controls fade in on hover (standard video player behaviour)
                        opacity: isFullscreen || navigationMode !== 'time_driven' ? 1 : 0,
                        transition: 'opacity 0.3s ease',
                        zIndex: 10,
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Progress Bar — time scrubber for time_driven, step dots for user_driven */}
                    {navigationMode === 'user_driven' && entries.length > 1 && (
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                marginBottom: '12px',
                                padding: '4px 0',
                            }}
                        >
                            {entries.map((_, i) => (
                                <div
                                    key={i}
                                    onClick={() => {
                                        setCurrentIndex(i);
                                        onEntryChange?.(i, entries[i]!);
                                    }}
                                    title={`${meta.entry_label} ${i + 1}`}
                                    style={{
                                        flex: 1,
                                        height: '4px',
                                        borderRadius: '2px',
                                        background:
                                            i <= currentIndex
                                                ? '#ef4444'
                                                : 'rgba(255,255,255,0.25)',
                                        cursor: 'pointer',
                                        transition: 'background 0.2s ease',
                                    }}
                                />
                            ))}
                        </div>
                    )}
                    {/* Current chapter name — shown above progress bar for time_driven */}
                    {navigationMode === 'time_driven' &&
                        meta.chapters &&
                        meta.chapters.length > 0 &&
                        currentChapterIndex >= 0 && (
                            <div
                                style={{
                                    fontSize: '11px',
                                    color: 'rgba(255,255,255,0.65)',
                                    marginBottom: '4px',
                                    fontWeight: 600,
                                    letterSpacing: '0.04em',
                                    textTransform: 'uppercase',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                }}
                            >
                                <div
                                    style={{
                                        width: '5px',
                                        height: '5px',
                                        borderRadius: '50%',
                                        background: '#ef4444',
                                        flexShrink: 0,
                                    }}
                                />
                                {meta.chapters[currentChapterIndex]?.label}
                                <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}>
                                    {currentChapterIndex + 1} / {meta.chapters.length}
                                </span>
                            </div>
                        )}
                    {navigationMode === 'time_driven' && (
                        <div
                            className="video-progress"
                            onClick={handleProgressClick}
                            style={{
                                marginBottom: '12px',
                                cursor: 'pointer',
                                padding: '4px 0',
                                position: 'relative',
                            }}
                        >
                            <div
                                className="progress-bar-container"
                                style={{
                                    height: '6px',
                                    width: '100%',
                                    background: 'rgba(255, 255, 255, 0.2)',
                                    borderRadius: '3px',
                                    overflow: 'visible',
                                    position: 'relative',
                                }}
                            >
                                <div
                                    style={{
                                        position: 'absolute',
                                        left: 0,
                                        top: 0,
                                        bottom: 0,
                                        width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                                        background: '#ef4444',
                                        transition: 'width 0.1s linear',
                                        borderRadius: '3px',
                                    }}
                                />
                                {/* Chapter tick marks */}
                                {meta.chapters &&
                                    duration > 0 &&
                                    meta.chapters.map((chapter, i) => (
                                        <div
                                            key={i}
                                            title={chapter.label}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setCurrentTime(chapter.time);
                                                if (
                                                    chapter.time >= meta.audio_start_at &&
                                                    audioRef.current
                                                ) {
                                                    audioRef.current.currentTime =
                                                        chapter.time - meta.audio_start_at;
                                                    audioStartedRef.current = true;
                                                    if (isPlaying)
                                                        audioRef.current
                                                            .play()
                                                            .catch(console.error);
                                                }
                                            }}
                                            style={{
                                                position: 'absolute',
                                                left: `${(chapter.time / duration) * 100}%`,
                                                top: '-4px',
                                                bottom: '-4px',
                                                width: '2px',
                                                background: 'rgba(255, 255, 255, 0.7)',
                                                cursor: 'pointer',
                                                zIndex: 2,
                                                transform: 'translateX(-1px)',
                                            }}
                                        />
                                    ))}
                            </div>
                        </div>
                    )}

                    {/* Controls */}
                    <div
                        className="playback-controls"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: isMini ? '4px' : isCompact ? '6px' : '16px',
                            flexWrap: 'wrap',
                            minWidth: 0,
                        }}
                    >
                        {/* Time-driven controls */}
                        {navigationMode === 'time_driven' && (
                            <>
                                <button
                                    onClick={handleTimeDrivenPlayPause}
                                    style={btnStyle}
                                    aria-label={isPlaying ? 'Pause' : 'Play'}
                                >
                                    {isPlaying ? (
                                        <Pause className="size-6 text-white" />
                                    ) : (
                                        <Play className="size-6 text-white" />
                                    )}
                                </button>
                                <button onClick={handleReset} style={btnStyle} title="Restart">
                                    <RotateCcw className="size-5 text-white" />
                                </button>
                                <span
                                    style={{
                                        ...timeStyle,
                                        fontSize: isCompact ? '11px' : undefined,
                                    }}
                                >
                                    {isCompact
                                        ? formatTime(currentTime)
                                        : `${formatTime(currentTime)} / ${formatTime(duration)}`}
                                </span>
                                <button
                                    onClick={handleSpeedChange}
                                    style={{
                                        ...btnStyle,
                                        marginLeft: isCompact ? '0' : '4px',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        background: 'rgba(255, 255, 255, 0.15)',
                                        color: 'white',
                                        fontSize: '12px',
                                        fontWeight: 'bold',
                                        border: '1px solid rgba(255, 255, 255, 0.3)',
                                    }}
                                    title="Playback Speed"
                                >
                                    {playbackRate}x
                                </button>
                            </>
                        )}

                        {/* User-driven controls */}
                        {navigationMode === 'user_driven' && (
                            <>
                                <button
                                    onClick={handlePrev}
                                    disabled={currentIndex === 0}
                                    style={{
                                        ...btnStyle,
                                        opacity: currentIndex === 0 ? 0.5 : 1,
                                    }}
                                    aria-label="Previous"
                                >
                                    <ChevronLeft className="size-6 text-white" />
                                </button>
                                <span style={timeStyle}>
                                    {formatEntryLabel(
                                        meta.entry_label,
                                        currentIndex,
                                        entries.length
                                    )}
                                </span>

                                {/* STORYBOOK/TIMELINE: Read Page Button — always visible, disabled when audio not available */}
                                {(contentType === 'STORYBOOK' || contentType === 'TIMELINE') && (
                                    <button
                                        onClick={
                                            pageAudioRanges.has(currentIndex)
                                                ? handleReadPage
                                                : undefined
                                        }
                                        disabled={!pageAudioRanges.has(currentIndex)}
                                        style={{
                                            ...btnStyle,
                                            background: isPlaying
                                                ? 'rgba(255, 255, 255, 0.2)'
                                                : 'transparent',
                                            borderRadius: '4px',
                                            border: '1px solid rgba(255, 255, 255, 0.4)',
                                            padding: '4px 12px',
                                            margin: '0 8px',
                                            display: 'flex',
                                            gap: '6px',
                                            opacity: pageAudioRanges.has(currentIndex) ? 1 : 0.35,
                                            cursor: pageAudioRanges.has(currentIndex)
                                                ? 'pointer'
                                                : 'not-allowed',
                                        }}
                                        title={
                                            !wordsUrl
                                                ? 'Narration unavailable (no audio words provided)'
                                                : !pageAudioRanges.has(currentIndex)
                                                  ? 'No narration for this page'
                                                  : isPlaying
                                                    ? 'Pause Narration'
                                                    : 'Read Page Aloud'
                                        }
                                    >
                                        {isPlaying ? (
                                            <Pause className="size-4 text-white" />
                                        ) : (
                                            <Volume2 className="size-4 text-white" />
                                        )}
                                        <span
                                            style={{
                                                fontSize: '12px',
                                                fontWeight: 600,
                                                color: 'white',
                                            }}
                                        >
                                            {isPlaying ? 'PAUSE' : 'READ ME'}
                                        </span>
                                    </button>
                                )}

                                <button
                                    onClick={handleNext}
                                    disabled={currentIndex === entries.length - 1}
                                    style={{
                                        ...btnStyle,
                                        opacity: currentIndex === entries.length - 1 ? 0.5 : 1,
                                    }}
                                    aria-label="Next"
                                >
                                    <ChevronRight className="size-6 text-white" />
                                </button>
                            </>
                        )}

                        {/* Content type badge — hidden in compact mode to save space */}
                        {!isCompact && (
                            <span style={badgeStyle}>{CONTENT_TYPE_LABELS[contentType]}</span>
                        )}

                        {/* Focus Mode Toggle (Dynamic Playback Speed) — hidden on very small screens */}
                        {navigationMode === 'time_driven' && !isMini && (
                            <button
                                onClick={() => setIsFocusMode(!isFocusMode)}
                                style={{
                                    ...btnStyle,
                                    marginLeft: isCompact ? '0' : '12px',
                                    padding: isCompact ? '4px 6px' : '4px 10px',
                                    borderRadius: '16px',
                                    border: `1px solid ${isFocusMode ? '#3b82f6' : 'rgba(255,255,255,0.3)'}`,
                                    background: isFocusMode
                                        ? 'rgba(59, 130, 246, 0.2)'
                                        : 'transparent',
                                    color: isFocusMode ? '#60a5fa' : 'white',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    transition: 'all 0.2s ease',
                                    display: 'flex',
                                    alignItems: 'center',
                                }}
                                title="Focus Mode: Automatically slows down during complex diagrams"
                            >
                                <span
                                    style={{
                                        marginRight: isCompact ? '0' : '6px',
                                        fontSize: '14px',
                                    }}
                                >
                                    🧠
                                </span>
                                {!isCompact && `FOCUS ${isFocusMode ? 'ON' : 'OFF'}`}
                            </button>
                        )}

                        {/* Chapters Toggle (only when video has chapters) */}
                        {navigationMode === 'time_driven' &&
                            meta.chapters &&
                            meta.chapters.length > 0 && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setIsChaptersOpen(!isChaptersOpen);
                                        setIsGlossaryOpen(false);
                                    }}
                                    style={{
                                        ...btnStyle,
                                        marginLeft: isCompact ? '0' : '8px',
                                        padding: isCompact ? '4px 6px' : '4px 10px',
                                        borderRadius: '16px',
                                        border: `1px solid ${isChaptersOpen ? '#f87171' : 'rgba(255,255,255,0.3)'}`,
                                        background: isChaptersOpen
                                            ? 'rgba(248, 113, 113, 0.2)'
                                            : 'transparent',
                                        color: isChaptersOpen ? '#f87171' : 'white',
                                        fontSize: '12px',
                                        fontWeight: 600,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                        transition: 'all 0.2s ease',
                                    }}
                                    title={`Chapters (${meta.chapters.length})`}
                                >
                                    <List className="size-4" />
                                    {!isCompact && <span>Chapters</span>}
                                </button>
                            )}

                        {/* Quiz Toggle (only for time-driven VIDEO with questions) */}
                        {navigationMode === 'time_driven' &&
                            meta.questions &&
                            meta.questions.length > 0 && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setQuestionsEnabled(!questionsEnabled);
                                    }}
                                    style={{
                                        ...btnStyle,
                                        marginLeft: isCompact ? '0' : '8px',
                                        padding: isCompact ? '4px 6px' : '4px 10px',
                                        borderRadius: '16px',
                                        border: `1px solid ${questionsEnabled ? '#a78bfa' : 'rgba(255,255,255,0.3)'}`,
                                        background: questionsEnabled
                                            ? 'rgba(167, 139, 250, 0.2)'
                                            : 'transparent',
                                        color: questionsEnabled
                                            ? '#a78bfa'
                                            : 'rgba(255,255,255,0.6)',
                                        fontSize: '12px',
                                        fontWeight: 600,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                        transition: 'all 0.2s ease',
                                    }}
                                    title={
                                        questionsEnabled
                                            ? `Disable quiz questions (${meta.questions.length})`
                                            : `Enable quiz questions (${meta.questions.length})`
                                    }
                                >
                                    <HelpCircle size={14} />
                                    {!isCompact && (
                                        <span>Quiz {questionsEnabled ? 'ON' : 'OFF'}</span>
                                    )}
                                </button>
                            )}

                        {/* Glossary Toggle (only when video has glossary terms) */}
                        {navigationMode === 'time_driven' &&
                            meta.glossary &&
                            meta.glossary.length > 0 && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setIsGlossaryOpen(!isGlossaryOpen);
                                        setIsChaptersOpen(false);
                                    }}
                                    style={{
                                        ...btnStyle,
                                        marginLeft: isCompact ? '0' : '8px',
                                        padding: isCompact ? '4px 6px' : '4px 10px',
                                        borderRadius: '16px',
                                        border: `1px solid ${isGlossaryOpen ? '#60a5fa' : 'rgba(255,255,255,0.3)'}`,
                                        background: isGlossaryOpen
                                            ? 'rgba(96, 165, 250, 0.2)'
                                            : 'transparent',
                                        color: isGlossaryOpen ? '#60a5fa' : 'white',
                                        fontSize: '12px',
                                        fontWeight: 600,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                        transition: 'all 0.2s ease',
                                    }}
                                    title={`Key Terms Glossary (${seenGlossaryTerms.length}/${meta.glossary?.length ?? 0})`}
                                >
                                    <BookOpen className="size-4" />
                                    {seenGlossaryTerms.length > 0 && (
                                        <span
                                            style={{
                                                background: '#3b82f6',
                                                borderRadius: '50%',
                                                width: '16px',
                                                height: '16px',
                                                fontSize: '10px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                            }}
                                        >
                                            {seenGlossaryTerms.length}
                                        </span>
                                    )}
                                </button>
                            )}

                        {/* Spacer */}
                        <div style={{ flex: 1 }} />

                        {/* Storybook/Timeline: Autoplay Toggle (with Text) */}
                        {(contentType === 'STORYBOOK' || contentType === 'TIMELINE') && (
                            <button
                                onClick={() => setIsAutoplay(!isAutoplay)}
                                style={{
                                    ...btnStyle,
                                    opacity: isAutoplay ? 1 : 0.8,
                                    background: isAutoplay
                                        ? 'rgba(74, 222, 128, 0.2)'
                                        : 'transparent',
                                    color: isAutoplay ? '#4ade80' : 'white',
                                    padding: '4px 12px',
                                    borderRadius: '4px',
                                    gap: '6px',
                                    border: isAutoplay
                                        ? '1px solid rgba(74, 222, 128, 0.4)'
                                        : '1px solid transparent',
                                }}
                                title={isAutoplay ? 'Disable Autoplay' : 'Enable Autoplay'}
                            >
                                <Repeat className="size-4" />
                                {!isCompact && (
                                    <span style={{ fontSize: '12px', fontWeight: 600 }}>
                                        Autoplay
                                    </span>
                                )}
                            </button>
                        )}

                        {/* WORKSHEET: Print button */}
                        {contentType === 'WORKSHEET' && (
                            <button onClick={handlePrint} style={btnStyle} title="Print Worksheet">
                                <Printer className="size-5 text-white" />
                            </button>
                        )}

                        {/* CONVERSATION: TTS button */}
                        {contentType === 'CONVERSATION' && (
                            <button
                                onClick={() => {
                                    const entry = entries[currentIndex];
                                    if (entry) {
                                        // Extract text from HTML (simple approach)
                                        const div = document.createElement('div');
                                        div.innerHTML = entry.html;
                                        const text = div.textContent || '';
                                        handleSpeak(text);
                                    }
                                }}
                                style={btnStyle}
                                title="Read Aloud"
                            >
                                <Volume2 className="size-5 text-white" />
                            </button>
                        )}

                        {/* Captions toggle (CC button) - only for time-driven with words */}
                        {navigationMode === 'time_driven' && wordsUrl && (
                            <>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleCaptions();
                                    }}
                                    style={{
                                        ...btnStyle,
                                        opacity: captionSettings.enabled ? 1 : 0.6,
                                        background: captionSettings.enabled
                                            ? 'rgba(255, 255, 255, 0.2)'
                                            : 'transparent',
                                        borderRadius: '4px',
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

                        {/* Download button (only when callback provided) */}
                        {onDownloadClick && navigationMode === 'time_driven' && (
                            <button
                                onClick={onDownloadClick}
                                style={btnStyle}
                                title="Download as video"
                            >
                                <Download className="size-5 text-white" />
                            </button>
                        )}

                        {/* Fullscreen button */}
                        <button
                            onClick={handleFullscreenToggle}
                            style={btnStyle}
                            title="Fullscreen"
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

            {/* Audio Element (for time_driven AND storybook) */}
            {audioUrl && (
                <audio
                    ref={audioRef}
                    src={audioUrl}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onEnded={handleAudioEnded}
                    crossOrigin="anonymous"
                />
            )}
        </div>
    );
};

// Shared styles
const btnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
};

const timeStyle: React.CSSProperties = {
    fontFamily: 'monospace',
    fontSize: '0.875rem',
    color: '#ffffff',
    fontWeight: 500,
};

const badgeStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.8)',
    background: 'rgba(255, 255, 255, 0.2)',
    padding: '4px 10px',
    borderRadius: '4px',
};

// Legacy export for backward compatibility
export { AIContentPlayer as AIVideoPlayer };
export default AIContentPlayer;
