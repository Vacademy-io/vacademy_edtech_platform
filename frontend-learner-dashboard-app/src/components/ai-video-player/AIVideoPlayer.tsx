"use client";
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Play,
  Pause,
  ArrowCounterClockwise,
  Rewind,
  FastForward,
  SpeakerHigh,
  SpeakerSlash,
  Gear,
  CaretLeft,
  CaretRight,
  Printer,
  ArrowsOut,
  ArrowsIn,
  Question,
  CheckCircle,
  XCircle,
} from "@phosphor-icons/react";
import type {
  ContentType,
  NavigationType,
  TimelineMeta,
  TimelineData,
  Frame,
  MCQQuestion,
} from "./types";
import { CONTENT_TYPE_LABELS, CONTENT_TYPE_ENTRY_LABELS } from "./types";
import { getLibraryScriptTags } from "./library-loader";
import {
  createNavigationController,
  type NavigationController,
} from "./navigation-controller";
import { processHtmlContent, fixHtmlContent } from "./html-processor";
import { useWebAudioMixer } from "./hooks/useWebAudioMixer";
import { useSoundScheduler, collectCuesFromEntries } from "./hooks/useSoundScheduler";
import { canvasBackground, entryBoxStyle, fillSceneGaps } from './entry-layout';

// Re-export types for backward compatibility
export type { Frame, TimelineMeta, TimelineData, ContentType, NavigationType };

/**
 * Format time in seconds to MM:SS format
 */
const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export interface AIVideoPlayerProps {
  timelineUrl: string;
  audioUrl?: string;  // Optional: not required for user_driven and self_contained content
  className?: string;
  width?: number;
  height?: number;
  onEntryChange?: (entry: Frame, index: number) => void;
  onContentComplete?: () => void;
  /** Playback position in seconds (time-driven videos), reported as it moves and on seeks. */
  onTimeUpdate?: (seconds: number) => void;
}

// Default meta for backward compatibility
const DEFAULT_META: TimelineMeta = {
  content_type: "VIDEO",
  navigation: "time_driven",
  entry_label: "segment",
  audio_start_at: 0,
  total_duration: null,
  dimensions: { width: 1920, height: 1080 },
};




export const AIVideoPlayer: React.FC<AIVideoPlayerProps> = ({
  timelineUrl,
  audioUrl,
  className = "",
  width: propWidth,
  height: propHeight,
  onEntryChange,
  onContentComplete,
  onTimeUpdate, }) => {
  const { t } = useTranslation("courseComponentsExtra");
  // Core state
  const [frames, setFrames] = useState<Frame[]>([]);
  const [meta, setMeta] = useState<TimelineMeta>(DEFAULT_META);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Use dimensions from meta or props
  const width = propWidth || meta.dimensions?.width || 1920;
  const height = propHeight || meta.dimensions?.height || 1080;

  // Time-driven state (for VIDEO content)
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioStarted, setAudioStarted] = useState(false);

  // User-driven state (for QUIZ, STORYBOOK, etc.)
  const [currentEntryIndex, setCurrentEntryIndex] = useState(0);

  // Display state
  const [activeFrames, setActiveFrames] = useState<Frame[]>([]);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showPlaybackSpeedMenu, setShowPlaybackSpeedMenu] = useState(false);
  const [scale, setScale] = useState(0.8);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // MCQ quiz state
  const [questionsEnabled, setQuestionsEnabled] = useState(true);
  const [activeQuestion, setActiveQuestion] = useState<MCQQuestion | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const answeredQuestionsRef = useRef<Set<number>>(new Set());

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const navigationRef = useRef<NavigationController | null>(null);
  const onEntryChangeRef = useRef(onEntryChange);
  const handlingNavChangeRef = useRef(false);

  const onTimeUpdateRef = useRef(onTimeUpdate);
  const lastReportedTimeRef = useRef<number | null>(null);

  // Keep callback ref up to date without causing effect re-runs
  useEffect(() => {
    onEntryChangeRef.current = onEntryChange;
  }, [onEntryChange]);
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  // Web Audio API mixer for extra tracks (background music, SFX, etc.)
  useWebAudioMixer({
    tracks: meta.audio_tracks,
    audioRef: audioRef as React.RefObject<HTMLAudioElement>,
    isPlaying,
    currentTime,
  });

  // Sound Planner cues — per-shot transition/chime/impact sound effects.
  // `currentTime` is the master clock (same value that drives engagement,
  // MCQ triggers, and active-frame selection).
  const soundCues = useMemo(() => collectCuesFromEntries(frames), [frames]);
  const { resetPlayed: resetSoundCues } = useSoundScheduler({
    cues: soundCues,
    masterClockSec: currentTime,
    isPlaying,
    narrationAudioRef: audioRef,
  });

  // Stable navigation callback with re-entrancy guard
  const handleNavChange = useCallback((entry: Frame, index: number) => {
    if (handlingNavChangeRef.current) return;
    handlingNavChangeRef.current = true;
    try {
      setCurrentEntryIndex((prev) => {
        if (prev === index) return prev;
        return index;
      });
      // Use ref to avoid re-triggering effects if parent's callback changes
      if (onEntryChangeRef.current) {
        onEntryChangeRef.current(entry, index);
      }
    } finally {
      handlingNavChangeRef.current = false;
    }
  }, []);

  // Derived values
  const contentType = meta.content_type || "VIDEO";
  const navigationMode = meta.navigation || "time_driven";
  const entryLabel =
    meta.entry_label ||
    t(`entryLabel.${contentType}`, CONTENT_TYPE_ENTRY_LABELS[contentType] || "segment");
  const isTimeDriven = navigationMode === "time_driven";

  // Report the master clock to the parent (e.g. the "stuck at this part?" detector).
  // It ticks every animation frame; half a second of change is enough.
  useEffect(() => {
    if (!isTimeDriven || !onTimeUpdateRef.current) return;
    const last = lastReportedTimeRef.current;
    if (last !== null && Math.abs(currentTime - last) < 0.5) return;
    lastReportedTimeRef.current = currentTime;
    onTimeUpdateRef.current(currentTime);
  }, [currentTime, isTimeDriven]);
  const isUserDriven = navigationMode === "user_driven";
  const isSelfContained = navigationMode === "self_contained";

  // Content type badge
  const contentTypeBadge = useMemo(() => {
    const config = CONTENT_TYPE_LABELS[contentType];
    const label = t(`contentType.${contentType}`, config?.label ?? "Video");
    return config ? `${config.emoji} ${label}` : `🎬 ${label}`;
  }, [contentType, t]);

  // Load timeline data
  useEffect(() => {
    const loadTimeline = async () => {
      try {
        setIsLoading(true);
        setError(null);

        console.log("[AIVideoPlayer] Loading timeline from:", timelineUrl);
        const response = await fetch(timelineUrl);
        if (!response.ok) {
          throw new Error(`Failed to load timeline: ${response.statusText} `);
        }

        const timelineData: TimelineData | Frame[] = await response.json();
        console.log("[AIVideoPlayer] Timeline data received:", {
          isArray: Array.isArray(timelineData),
          hasMeta: !Array.isArray(timelineData) && !!timelineData.meta,
          hasEntries: !Array.isArray(timelineData) && !!timelineData.entries,
          dataKeys: Array.isArray(timelineData) ? [] : Object.keys(timelineData),
        });

        // Parse new structure with backward compatibility
        let framesArray: Frame[];
        let timelineMeta: TimelineMeta;

        if (Array.isArray(timelineData)) {
          // Old format: just an array of frames (backward compatibility)
          framesArray = timelineData;
          timelineMeta = {
            ...DEFAULT_META,
            audio_start_at: 0,
            total_duration: framesArray.length > 0 ? framesArray[framesArray.length - 1].exitTime : 0
          };
        } else {
          // New format: { meta, entries}
          framesArray = (timelineData.entries as Frame[]) || [];
          timelineMeta = {
            ...DEFAULT_META,
            ...timelineData.meta,
          };

          // Ensure total_duration is set
          if (!timelineMeta.total_duration && framesArray.length > 0) {
            timelineMeta.total_duration = framesArray[framesArray.length - 1].exitTime;
          }
        }

        console.log("[AIVideoPlayer] Parsed timeline:", {
          framesCount: framesArray.length,
          meta: timelineMeta,
          contentType: timelineMeta.content_type,
          navigation: timelineMeta.navigation,
          firstFrame: framesArray[0],
          lastFrame: framesArray[framesArray.length - 1],
        });

        setFrames(
          timelineMeta.navigation === 'user_driven' ? framesArray : fillSceneGaps(framesArray)
        );
        setMeta(timelineMeta);

        // Use meta.total_duration if available, otherwise calculate from last frame
        const videoDuration = timelineMeta.total_duration ||
          (framesArray.length > 0 ? framesArray[framesArray.length - 1].exitTime : 0);
        setDuration(videoDuration);

        // Initialize navigation controller with stable callback
        const nav = createNavigationController(
          timelineMeta,
          framesArray,
          handleNavChange,
        );
        navigationRef.current = nav;

        console.log("[AIVideoPlayer] Duration set to:", videoDuration);
      } catch (err) {
        console.error("[AIVideoPlayer] Error loading timeline:", err);
        setError(err instanceof Error ? err.message : t("errors.failedToLoadTimeline"));
      } finally {
        setIsLoading(false);
      }
    };

    if (timelineUrl) {
      loadTimeline();
    }

    return () => {
      if (navigationRef.current) {
        navigationRef.current.dispose();
        navigationRef.current = null;
      }
    };
  }, [timelineUrl, handleNavChange]);

  // Initialize audio (only for time-driven content or content with audio)
  useEffect(() => {
    // Skip audio initialization if no audio URL or not time-driven
    if (!audioUrl) {
      if (isTimeDriven) {
        console.log("[AIVideoPlayer] No audio URL provided for time-driven content");
      }
      return;
    }

    const audio = new Audio();
    audioRef.current = audio;

    // Set crossOrigin for S3 URLs to handle CORS
    audio.crossOrigin = "anonymous";

    // Set preload to allow metadata loading
    audio.preload = "auto";

    audio.addEventListener("loadedmetadata", () => {
      console.log("[AIVideoPlayer] Audio metadata loaded:", {
        duration: audio.duration,
        readyState: audio.readyState,
      });
    });

    audio.addEventListener("canplay", () => {
      console.log("[AIVideoPlayer] Audio can play");
      setError(null);
    });

    audio.addEventListener("canplaythrough", () => {
      console.log("[AIVideoPlayer] Audio can play through");
    });

    // Set initial playback rate and volume
    audio.playbackRate = playbackRate;
    audio.volume = volume;
    audio.muted = isMuted;

    audio.addEventListener("ended", () => {
      console.log("[AIVideoPlayer] Audio ended, continuing to outro if present");
    });

    audio.addEventListener("error", (e) => {
      console.error("[AIVideoPlayer] Audio error:", {
        error: e,
        errorCode: audio.error?.code,
        errorMessage: audio.error?.message,
        networkState: audio.networkState,
        readyState: audio.readyState,
        src: audio.src,
        audioUrl: audioUrl,
      });

      let errorMessage = t("errors.failedToLoadAudio");
      if (audio.error) {
        const MEDIA_ERR_ABORTED = 1;
        const MEDIA_ERR_NETWORK = 2;
        const MEDIA_ERR_DECODE = 3;
        const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

        switch (audio.error.code) {
          case MEDIA_ERR_ABORTED:
            errorMessage = t("errors.audioLoadingAborted");
            break;
          case MEDIA_ERR_NETWORK:
            errorMessage = t("errors.audioNetworkError");
            break;
          case MEDIA_ERR_DECODE:
            errorMessage = t("errors.audioDecodeError");
            break;
          case MEDIA_ERR_SRC_NOT_SUPPORTED:
            errorMessage = t("errors.audioFormatNotSupported");
            break;
        }
      }
      setError(errorMessage);
    });

    audio.src = audioUrl;

    try {
      audio.load();
    } catch (err) {
      console.error("[AIVideoPlayer] Error calling audio.load():", err);
    }

    return () => {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
      setAudioStarted(false);
    };
  }, [audioUrl, isTimeDriven]);

  // Update active frames based on navigation mode
  useEffect(() => {
    if (frames.length === 0) {
      setActiveFrames([]);
      return;
    }

    if (isTimeDriven) {
      // Time-driven: show frames active at current time. Active range is
      // expanded by CROSSFADE_DURATION on both sides so two adjacent shots
      // can blend during the overlap (matches the renderer's behavior at
      // generate_video.py:2065-2102).
      const CROSSFADE_DURATION = 0.35;
      const active = frames.filter(
        (frame) =>
          currentTime >= frame.inTime - CROSSFADE_DURATION &&
          currentTime <= frame.exitTime + CROSSFADE_DURATION
      );

      let framesToShow = active;
      if (framesToShow.length === 0) {
        const framesAtOrBefore = frames.filter((frame) => frame.inTime <= currentTime);
        if (framesAtOrBefore.length > 0) {
          framesToShow = [framesAtOrBefore[framesAtOrBefore.length - 1]];
        } else {
          framesToShow = [frames[0]];
        }
      }

      // OPTIMIZATION: Only update state if the frame *membership* has changed.
      // Per-frame opacity is computed at render time based on currentTime so we
      // don't need to push it through state.
      setActiveFrames(prev => {
        if (prev.length === framesToShow.length && prev.every((f, i) => f.id === framesToShow[i].id)) {
          return prev;
        }
        return framesToShow;
      });
    } else if (isUserDriven) {
      // User-driven: show current entry
      const currentEntry = frames[currentEntryIndex];
      const newFrames = currentEntry ? [currentEntry] : [frames[0]];

      setActiveFrames(prev => {
        if (prev.length === newFrames.length && prev[0]?.id === newFrames[0]?.id) {
          return prev;
        }
        return newFrames;
      });
    } else if (isSelfContained) {
      // Self-contained: show first (and only) entry
      const newFrames = [frames[0]];
      setActiveFrames(prev => {
        if (prev.length === newFrames.length && prev[0]?.id === newFrames[0]?.id) {
          return prev;
        }
        return newFrames;
      });
    }
  }, [frames, currentTime, currentEntryIndex, isTimeDriven, isUserDriven, isSelfContained]);

  // Calculate scale to fit iframe content in container
  useEffect(() => {
    const calculateScale = () => {
      if (!containerRef.current) return;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const containerWidth = rect.width;
      const containerHeight = rect.height;

      if (containerWidth <= 0 || containerHeight <= 0) {
        console.warn("[AIVideoPlayer] Invalid container dimensions:", { containerWidth, containerHeight });
        console.warn("[AIVideoPlayer] Invalid container dimensions:", {
          containerWidth,
          containerHeight
        });
        return;
      }

      const scaleX = containerWidth / width;
      const scaleY = containerHeight / height;
      const newScale = Math.min(scaleX, scaleY);
      // Add a small buffer (0.98 multiplier) to ensure it doesn't hit edges in default view
      const finalScale = isFullscreen ? Math.min(newScale, 1) : Math.min(newScale * 0.98, 1);

      // Prevent infinite loops by only updating if change is significant (> 0.001)
      setScale(prev => Math.abs(prev - finalScale) > 0.001 ? finalScale : prev);
    };

    // Use a throttled observer to prevent ResizeObserver loop limit errors
    let frameId: number;
    let lastWidth = 0;
    let lastHeight = 0;

    const observerCallback = (entries: ResizeObserverEntry[]) => {
      const entry = entries[0];
      if (!entry) return;

      const { width: newWidth, height: newHeight } = entry.contentRect;

      // Only trigger if change is significant (> 1px) to avoid sub-pixel layout loops on iOS
      if (Math.abs(newWidth - lastWidth) < 1 && Math.abs(newHeight - lastHeight) < 1) {
        return;
      }

      lastWidth = newWidth;
      lastHeight = newHeight;

      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => calculateScale());
    };

    const resizeObserver = new ResizeObserver(observerCallback);

    // Initial calculation
    calculateScale();

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener('resize', calculateScale);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener('resize', calculateScale);
    };
  }, [width, height]);



  // Animation loop for time-driven content
  useEffect(() => {
    if (!isTimeDriven) return;

    let lastTimestamp: number | null = null;

    const updateTime = (timestamp: number) => {
      if (!isPlaying) return;

      const deltaTime = lastTimestamp ? (timestamp - lastTimestamp) / 1000 * playbackRate : 0;
      lastTimestamp = timestamp;

      setCurrentTime(prevTime => {
        let newTime = prevTime;
        const audioStartAt = meta.audio_start_at || 0;
        const totalDuration = meta.total_duration || duration;

        // INTRO PHASE
        if (prevTime < audioStartAt) {
          newTime = prevTime + deltaTime;

          if (newTime >= audioStartAt && audioRef.current && !audioStarted) {
            console.log("[AIVideoPlayer] Intro complete, starting audio");
            audioRef.current.currentTime = 0;
            audioRef.current.play().catch(err => {
              console.error("[AIVideoPlayer] Error starting audio after intro:", err);
            });
            setAudioStarted(true);
            newTime = audioStartAt;
          }
        }
        // CONTENT PHASE
        else if (audioRef.current && !audioRef.current.ended) {
          newTime = audioRef.current.currentTime + audioStartAt;
        }
        // OUTRO PHASE
        else if (audioRef.current && audioRef.current.ended) {
          newTime = prevTime + deltaTime;

          if (newTime >= totalDuration) {
            console.log("[AIVideoPlayer] Video complete (including outro)");
            setIsPlaying(false);
            setAudioStarted(false);
            onContentComplete?.();
            return totalDuration;
          }
        }

        return Math.min(newTime, totalDuration);
      });

      animationFrameRef.current = requestAnimationFrame(updateTime);
    };

    if (isPlaying) {
      lastTimestamp = null;
      animationFrameRef.current = requestAnimationFrame(updateTime);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, meta, duration, audioStarted, playbackRate, isTimeDriven, onContentComplete]);

  // Playback controls for time-driven content
  const handlePlayPause = useCallback(() => {
    if (!isTimeDriven) return;
    if (!audioRef.current && audioUrl) return;

    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      const audioStartAt = meta.audio_start_at || 0;

      if (currentTime >= audioStartAt && audioRef.current) {
        const audioTime = currentTime - audioStartAt;
        audioRef.current.currentTime = Math.max(0, audioTime);
        audioRef.current.play().catch((err) => {
          console.error("Error playing audio:", err);
          setError(t("errors.failedToPlayAudio"));
        });
        if (!audioStarted) {
          setAudioStarted(true);
        }
      }

      setIsPlaying(true);
    }
  }, [isPlaying, meta, currentTime, audioStarted, isTimeDriven, audioUrl]);

  // MCQ question trigger: pause and show overlay when currentTime crosses a question's timestamp
  useEffect(() => {
    if (!isTimeDriven || !questionsEnabled || !meta.questions?.length || activeQuestion || !isPlaying) return;

    for (const q of meta.questions) {
      if (currentTime >= q.time && !answeredQuestionsRef.current.has(q.time)) {
        // Mark immediately (synchronous) to prevent double-trigger from stale renders
        answeredQuestionsRef.current.add(q.time);
        if (audioRef.current) audioRef.current.pause();
        setIsPlaying(false);
        setActiveQuestion(q);
        break;
      }
    }
  }, [currentTime, isTimeDriven, questionsEnabled, meta.questions, activeQuestion, isPlaying]);

  const handleDismissQuestion = useCallback(() => {
    setActiveQuestion(null);
    setSelectedAnswer(null);
    // Resume audio from current position
    const audioStartAt = meta.audio_start_at || 0;
    if (currentTime >= audioStartAt && audioRef.current) {
      audioRef.current.play().catch(console.error);
      if (!audioStarted) setAudioStarted(true);
    }
    setIsPlaying(true);
  }, [meta.audio_start_at, currentTime, audioStarted]);

  const handleReset = useCallback(() => {
    if (isTimeDriven) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.pause();
      }
      setCurrentTime(0);
      setIsPlaying(false);
      setAudioStarted(false);
      setActiveQuestion(null);
      setSelectedAnswer(null);
      answeredQuestionsRef.current.clear();
      // Allow sound cues to fire again from the beginning
      resetSoundCues();
    } else {
      setCurrentEntryIndex(0);
      navigationRef.current?.goTo(0);
    }
  }, [isTimeDriven, resetSoundCues]);

  const handleSeek = useCallback((value: number[]) => {
    if (!isTimeDriven) return;

    const newTimelineTime = value[0];
    const audioStartAt = meta.audio_start_at || 0;

    setCurrentTime(newTimelineTime);

    if (audioRef.current) {
      if (newTimelineTime < audioStartAt) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        setAudioStarted(false);
      } else {
        const audioTime = newTimelineTime - audioStartAt;
        audioRef.current.currentTime = Math.max(0, audioTime);

        if (isPlaying && newTimelineTime < (meta.content_ends_at || duration)) {
          if (!audioStarted) {
            setAudioStarted(true);
          }
          audioRef.current.play().catch(err => {
            console.error("[AIVideoPlayer] Error playing audio after seek:", err);
          });
        }
      }
    }
  }, [meta, isPlaying, audioStarted, duration, isTimeDriven]);

  const handleBackward = useCallback(() => {
    const newTimelineTime = Math.max(0, currentTime - 10);
    handleSeek([newTimelineTime]);
  }, [currentTime, handleSeek]);

  const handleForward = useCallback(() => {
    const totalDuration = meta.total_duration || duration;
    const newTimelineTime = Math.min(totalDuration, currentTime + 10);
    handleSeek([newTimelineTime]);
  }, [currentTime, meta, duration, handleSeek]);

  // Navigation controls for user-driven content
  const handlePrevEntry = useCallback(() => {
    if (!isUserDriven || !navigationRef.current) return;

    const entry = navigationRef.current.prev();
    if (entry) {
      setCurrentEntryIndex(navigationRef.current.currentIndex);
    }
  }, [isUserDriven]);

  const handleNextEntry = useCallback(() => {
    if (!isUserDriven || !navigationRef.current) return;

    const entry = navigationRef.current.next();
    if (entry) {
      setCurrentEntryIndex(navigationRef.current.currentIndex);
    } else if (navigationRef.current.currentIndex === frames.length - 1) {
      // Last entry reached
      onContentComplete?.();
    }
  }, [isUserDriven, frames.length, onContentComplete]);

  // Playback rate and volume controls
  const handlePlaybackRateChange = useCallback((rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
    setShowPlaybackSpeedMenu(false);
  }, []);

  const handleVolumeChange = useCallback((vol: number) => {
    setVolume(vol);
    if (audioRef.current) {
      audioRef.current.volume = vol;
      setIsMuted(vol === 0);
    }
  }, []);

  const handleToggleMute = useCallback(() => {
    if (audioRef.current) {
      const newMuted = !isMuted;
      setIsMuted(newMuted);
      audioRef.current.muted = newMuted;
      if (newMuted) {
        setVolume(0);
      } else {
        setVolume(1);
        audioRef.current.volume = 1;
      }
    }
  }, [isMuted]);

  // Print handler for WORKSHEET content
  const handlePrint = useCallback(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.print();
    }
  }, []);

  const rootRef = useRef<HTMLDivElement>(null);

  const handleToggleFullscreen = useCallback(() => {
    if (!rootRef.current) return;

    const doc = document as any;
    const player = rootRef.current as any;

    if (!isFullscreen) {
        const requestFS = player.requestFullscreen || player.webkitRequestFullscreen || player.mozRequestFullScreen || player.msRequestFullscreen;
        
        if (requestFS) {
            const promise = requestFS.call(player);
            if (promise && promise.then) {
                promise.then(() => {
                    setIsFullscreen(true);
                    try { (screen.orientation as any)?.lock?.('landscape').catch(() => {}); } catch (e) { /* ignore */ }
                }).catch((err: any) => console.error(`Error attempting to enable fullscreen: ${err.message}`));
            } else {
                setIsFullscreen(true);
                try { (screen.orientation as any)?.lock?.('landscape').catch(() => {}); } catch (e) { /* ignore */ }
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
                    try { (screen.orientation as any)?.unlock?.(); } catch (e) { /* ignore */ }
                }).catch((err: any) => console.error('Error exiting fullscreen:', err));
            } else {
                setIsFullscreen(false);
                try { (screen.orientation as any)?.unlock?.(); } catch (e) { /* ignore */ }
            }
        } else {
            setIsFullscreen(false);
        }
    }
  }, [isFullscreen]);

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

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  const playbackSpeeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  // Close playback speed menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showPlaybackSpeedMenu) {
        const target = event.target as HTMLElement;
        if (!target.closest('.playback-speed-menu')) {
          setShowPlaybackSpeedMenu(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showPlaybackSpeedMenu]);

  // Get progress display
  const progressDisplay = useMemo(() => {
    if (isUserDriven || isSelfContained) {
      const label = entryLabel.charAt(0).toUpperCase() + entryLabel.slice(1);
      const current = currentEntryIndex + 1;
      const total = frames.length;
      return t("progressOfTotal", { label, current, total });
    }
    return null;
  }, [isUserDriven, isSelfContained, entryLabel, currentEntryIndex, frames.length, t]);

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 rounded-lg ${className}`} style={{ aspectRatio: "16/9" }}>
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-gray-600">{t("loading", { type: contentTypeBadge })}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-red-50 rounded-lg border border-red-200 ${className}`} style={{ aspectRatio: "16/9" }}>
        <div className="text-center p-4 space-y-2">
          <p className="text-red-600 font-semibold">{t("errorTitle")}</p>
          <p className="text-red-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`bg-black rounded-lg overflow-hidden flex flex-col ${className} ${isFullscreen ? 'fixed inset-0 z-50 rounded-none w-screen h-screen' : ''} `}
      style={isFullscreen ? { maxHeight: '100vh' } : { maxHeight: "calc(100vh - 150px)" }}
    >
      {/* Content Type Badge */}
      <div className="bg-gray-900 px-4 py-2 flex items-center justify-between border-b border-gray-800">
        <span className="text-white text-sm font-medium">{contentTypeBadge}</span>
        {progressDisplay && (
          <span className="text-gray-400 text-sm">{progressDisplay}</span>
        )}
        {/* Print button for WORKSHEET */}
        {contentType === "WORKSHEET" && (
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="bg-gray-800 text-white border-gray-700 hover:bg-gray-700 h-8 px-3"
            title={t("controls.printWorksheetTitle")}
          >
            <Printer className="h-3 w-3 me-1" />
            {t("controls.print")}
          </Button>
        )}
      </div>

      {/* Video Frame */}
      <div
        ref={containerRef}
        className="relative w-full flex-1 bg-black overflow-hidden"
        style={{ minHeight: 0, position: 'relative', aspectRatio: isFullscreen ? 'auto' : '16/9' }}
      >
        <div
          style={{
            width: `${width}px`,
            height: `${height}px`,
            transform: `scale(${scale})`,
            transformOrigin: "center center",
            position: 'absolute',
            top: '50%',
            left: '50%',
            marginTop: `-${height / 2}px`,
            marginLeft: `-${width / 2}px`,
          }}
        >
          {activeFrames.length > 0 ? (
            [...activeFrames].sort((a, b) => (a.z || 0) - (b.z || 0)).map((frame, index) => {
              const htmlDoc = contentType === 'VIDEO' ? processHtmlContent(
                frame.html,
                contentType,
                index > 0,
                meta.palette
              ) : frame.html;

              // Crossfade opacity — mirror of generate_video.py:2094-2099. Computed
              // at render time using the current playhead so adjacent shots blend
              // smoothly. Same constant as the active-set filter above.
              const CROSSFADE_DURATION = 0.35;
              let frameOpacity = 1;
              if (currentTime < frame.inTime) {
                const t = currentTime - (frame.inTime - CROSSFADE_DURATION);
                frameOpacity = Math.max(0, Math.min(1, t / CROSSFADE_DURATION));
              } else if (currentTime > frame.exitTime) {
                const t = frame.exitTime + CROSSFADE_DURATION - currentTime;
                frameOpacity = Math.max(0, Math.min(1, t / CROSSFADE_DURATION));
              }

              const frameStyle = {
                ...entryBoxStyle(frame, width, height),
                zIndex: frame.z || 0,
                opacity: frameOpacity,
              };

              return (
                <iframe
                  ref={index === 0 ? iframeRef : null}
                  key={`frame-${frame.id}-${index}`}
                  srcDoc={htmlDoc}
                  className="border-0 bg-transparent absolute"
                  sandbox="allow-scripts allow-same-origin allow-modals"
                  allow="autoplay"
                  title={t("frameLayerTitle", { id: frame.id })}
                  style={{
                    backgroundColor: index === 0 ? canvasBackground(meta.palette) : "transparent",
                    pointerEvents: frame.id?.startsWith('branding-watermark') ? 'none' : 'auto',
                    ...frameStyle
                  }}
                />
              );
            })
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500">
              {t("noFrameContent")}
            </div>
          )}
        {/* MCQ Question Overlay */}
        {activeQuestion && (
          <div
            className="absolute inset-0 flex items-center justify-center p-4 z-20"
            style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
              {/* Header */}
              <div className="flex items-center gap-2 mb-4">
                <Question className="h-4 w-4 text-blue-400 shrink-0" />
                <span className="text-blue-400 text-xs font-bold uppercase tracking-widest">{t("mcq.quickCheck")}</span>
                <div className="flex-1" />
                <button
                  onClick={handleDismissQuestion}
                  className="text-gray-500 hover:text-gray-300 text-xs px-2 py-1 transition-colors"
                >
                  {t("mcq.skip")}
                </button>
              </div>

              {/* Question */}
              <p className="text-white text-base font-semibold leading-relaxed mb-5">
                {activeQuestion.question}
              </p>

              {/* Options */}
              <div className="space-y-2.5 mb-5">
                {activeQuestion.options.map((option, i) => {
                  const isSelected = selectedAnswer === i;
                  const isCorrect = i === activeQuestion.correct;
                  const hasAnswered = selectedAnswer !== null;

                  let cls = 'border-gray-600 bg-gray-800 text-gray-200 hover:bg-gray-700 hover:border-gray-500';
                  if (hasAnswered) {
                    if (isCorrect) cls = 'border-green-500 bg-green-900/30 text-green-200';
                    else if (isSelected) cls = 'border-red-500 bg-red-900/30 text-red-200';
                    else cls = 'border-gray-700 bg-gray-800/50 text-gray-500';
                  } else if (isSelected) {
                    cls = 'border-blue-500 bg-blue-900/30 text-blue-200';
                  }

                  return (
                    <button
                      key={i}
                      onClick={() => !hasAnswered && setSelectedAnswer(i)}
                      disabled={hasAnswered}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-start text-sm font-medium transition-all ${cls} disabled:cursor-default`}
                    >
                      <span className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs font-bold shrink-0 ${
                        hasAnswered && isCorrect ? 'border-green-400 text-green-400' :
                        hasAnswered && isSelected ? 'border-red-400 text-red-400' :
                        'border-current'
                      }`}>
                        {String.fromCharCode(65 + i)}
                      </span>
                      <span className="flex-1">{option}</span>
                      {hasAnswered && isCorrect && <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />}
                      {hasAnswered && isSelected && !isCorrect && <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {/* Explanation */}
              {selectedAnswer !== null && activeQuestion.explanation && (
                <div className="bg-blue-950/40 border border-blue-800/40 rounded-lg px-4 py-3 mb-4 text-sm text-gray-300 leading-relaxed">
                  <span className="font-bold text-blue-400">{t("mcq.explanationLabel")}</span>
                  {activeQuestion.explanation}
                </div>
              )}

              {/* Continue button */}
              {selectedAnswer !== null && (
                <Button
                  onClick={handleDismissQuestion}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold"
                >
                  {t("mcq.continue")} <Play className="h-3.5 w-3.5 ms-2" />
                </Button>
              )}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Controls -Different layout based on navigation mode */}
      <div className="bg-gray-900 p-4 space-y-3 flex-shrink-0">
        {/* Time-Driven Controls (VIDEO) */}
        {isTimeDriven && (
          <>
            {/* Progress Slider */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                {/* SOURCE_CLIP segment indicators */}
                {duration > 0 && frames.filter(f => f.shot_type === 'SOURCE_CLIP').map((f, i) => {
                  const inT = f.inTime ?? 0;
                  const exitT = f.exitTime ?? 0;
                  return (
                    <div
                      key={`src-seg-${i}`}
                      className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded bg-indigo-500/40 pointer-events-none"
                      style={{
                        left: `${(inT / duration) * 100}%`,
                        width: `${((exitT - inT) / duration) * 100}%`,
                        zIndex: 0,
                      }}
                      title={t("controls.sourceVideoAudio")}
                    />
                  );
                })}
                <Slider
                  value={[currentTime]}
                  max={duration || 100}
                  step={0.1}
                  onValueChange={handleSeek}
                  className="relative z-1"
                />
              </div>
              <span className="text-white text-sm font-mono min-w-16 text-end">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            {/* Control Buttons */}
            <div className="flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
              {/* Left Side: Playback Controls */}
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleBackward}
                  className="bg-gray-800 text-white border-gray-700 hover:bg-gray-700"
                  disabled={!audioRef.current && !!audioUrl}
                  title={t("controls.rewind10")}
                >
                  <Rewind className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handlePlayPause}
                  className="bg-gray-800 text-white border-gray-700 hover:bg-gray-700"
                  disabled={!audioRef.current && !!audioUrl}
                  title={isPlaying ? t("controls.pause") : t("controls.play")}
                >
                  {isPlaying ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleForward}
                  className="bg-gray-800 text-white border-gray-700 hover:bg-gray-700"
                  disabled={!audioRef.current && !!audioUrl}
                  title={t("controls.forward10")}
                >
                  <FastForward className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleReset}
                  className="bg-gray-800 text-white border-gray-700 hover:bg-gray-700"
                  disabled={!audioRef.current && !!audioUrl}
                  title={t("controls.resetToBeginning")}
                >
                  <ArrowCounterClockwise className="h-4 w-4" />
                </Button>
              </div>

              {/* Right Side: Volume and Speed Controls */}
              <div className="flex items-center gap-2">
                {/* Volume Control */}
                <div className="flex items-center gap-3 min-w-20 max-w-32">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleToggleMute}
                    className="bg-gray-800 text-white border-gray-700 hover:bg-gray-700 h-8 w-8"
                    title={isMuted ? t("controls.unmute") : t("controls.mute")}
                  >
                    {isMuted || volume === 0 ? (
                      <SpeakerSlash className="h-4 w-4" />
                    ) : (
                      <SpeakerHigh className="h-4 w-4" />
                    )}
                  </Button>
                  <Slider
                    value={[isMuted ? 0 : volume]}
                    max={1}
                    step={0.01}
                    onValueChange={(value) => handleVolumeChange(value[0])}
                    className="flex-1"
                  />
                </div>

                {/* Playback Speed Control */}
                <div className="relative playback-speed-menu">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowPlaybackSpeedMenu(!showPlaybackSpeedMenu)}
                    className="bg-gray-800 text-white border-gray-700 hover:bg-gray-700 h-8px-3"
                    title={t("controls.playbackSpeed")}
                  >
                    <Gear className="h-3 w-3 me-1" />
                    {playbackRate}x
                  </Button>
                  {showPlaybackSpeedMenu && (
                    <div className="absolute bottom-full end-0 mb-2 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-10 min-w-24">
                      {playbackSpeeds.map((speed) => (
                        <button
                          key={speed}
                          onClick={() => handlePlaybackRateChange(speed)}
                          className={`w-fullpx-4 py-2 text-start text-sm hover: bg-gray -700 first: rounded-t -lg last: rounded-b -lg ${playbackRate === speed ? "bg-gray-700 text-primary" : "text-white"} `}
                        >
                          {speed}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quiz Toggle (only when video has questions) */}
                {meta.questions && meta.questions.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setQuestionsEnabled(!questionsEnabled)}
                    className={`h-8 px-3 border-gray-700 text-xs font-semibold transition-colors ${
                      questionsEnabled
                        ? 'bg-purple-900/40 text-purple-300 border-purple-700 hover:bg-purple-900/60'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                    title={questionsEnabled ? t("controls.disableQuiz") : t("controls.enableQuiz")}
                  >
                    <Question className="h-3.5 w-3.5 me-1" />
                    {questionsEnabled ? t("controls.quizOn") : t("controls.quizOff")}
                  </Button>
                )}

                {/* Fullscreen Toggle */}
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleToggleFullscreen}
                  className="bg-gray-800 text-white border-gray-700 hover:bg-gray-700 h-8 w-8"
                  title={isFullscreen ? t("controls.exitFullscreen") : t("controls.enterFullscreen")}
                >
                  {isFullscreen ? (
                    <ArrowsIn className="h-4 w-4" />
                  ) : (
                    <ArrowsOut className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </>
        )}

        {/* User-Driven Controls (QUIZ, STORYBOOK, WORKSHEET, etc.) */}
        {isUserDriven && (
          <div className="flex items-center justify-between gap-4">
            {/* Left Side: Navigation */}
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrevEntry}
                disabled={currentEntryIndex === 0}
                className="bg-gray-800 text-white border-gray-700 hover:bg-gray-700 disabled:opacity-50"
                title={t("controls.previous")}
              >
                <CaretLeft className="h-4 w-4 me-1" />
                {t("controls.previous")}
              </Button>

              <span className="text-white text-smpx-3">
                {progressDisplay}
              </span>

              <Button
                variant="outline"
                size="sm"
                onClick={handleNextEntry}
                disabled={currentEntryIndex === frames.length - 1}
                className="bg-gray-800 text-white border-gray-700 hover:bg-gray-700 disabled:opacity-50"
                title={t("controls.next")}
              >
                {t("controls.next")}
                <CaretRight className="h-4 w-4 ms-1" />
              </Button>
            </div>

            {/* Right Side: Reset */}
            <Button
              variant="outline"
              size="icon"
              onClick={handleReset}
              className="bg-gray-800 text-white border-gray-700 hover:bg-gray-700"
              title={t("controls.resetToBeginning")}
            >
              <ArrowCounterClockwise className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Self-Contained Controls (INTERACTIVE_GAME, SIMULATION, CODE_PLAYGROUND) */}
        {isSelfContained && (
          <div className="flex items-center justify-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              className="bg-gray-800 text-white border-gray-700 hover:bg-gray-700"
              title={t("controls.reset")}
            >
              <ArrowCounterClockwise className="h-4 w-4 me-1" />
              {t("controls.reset")}
            </Button>
            <span className="text-gray-400 text-sm">
              {t("interactHint")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
