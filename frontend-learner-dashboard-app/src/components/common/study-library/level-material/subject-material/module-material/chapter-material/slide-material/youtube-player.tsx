/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import type React from "react";
import {
  useEffect,
  useRef,
  useCallback,
  useState,
  forwardRef,
  useImperativeHandle,
  useMemo,
} from "react";
import { v4 as uuidv4 } from "uuid";
import { Trans, useTranslation } from "react-i18next";
import { useTrackingStore } from "@/stores/study-library/youtube-video-tracking-store";
import { getEpochTimeInMillis } from "./utils";
import { convertTimeToSeconds } from "@/utils/study-library/tracking/convertTimeToSeconds";
import { formatVideoTime } from "@/utils/study-library/tracking/formatVideoTime";
import { calculateNetDuration } from "@/utils/study-library/tracking/calculateNetDuration";
import { useVideoSync } from "@/hooks/study-library/useVideoSync";
import { getYouTubeBridgeHost, getYouTubeEmbedOrigin } from "@/utils/youtube-embed";
import { useSlideContentProtection } from "@/hooks/useSlideContentProtection";
import YouTube, {
  type YouTubeEvent,
  type YouTubePlayer,
  type YouTubeProps,
} from "react-youtube";
import {
  ArrowsOut,
  FastForward,
  Pause,
  Play,
  Rewind,
  X,
  Gauge,
  CheckCircle,
  Clock,
} from "@phosphor-icons/react";
import { Preferences } from "@capacitor/preferences";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { App as CapacitorApp } from "@/utils/app-plugin";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import VideoQuestionOverlay from "./video-question-overlay";
import { useMediaRefsStore } from "@/stores/mediaRefsStore";

/**
 * Force subtitles off on a YouTube player.
 *
 * There is no playerVar for this: cc_load_policy only accepts 1 ("force captions
 * ON") and its default is to follow the VIEWER's own preference — a Google
 * account set to "always show captions", or an OS-level subtitle toggle. That is
 * why one learner sees subtitles on a class everyone else sees clean.
 *
 * Three calls because no single one is reliable across player builds:
 *   unloadModule("captions") — HTML5 player
 *   unloadModule("cc")       — legacy player, which names the module differently
 *   setOption("captions", "track", {}) — selects "no track"; this is the one that
 *                              sticks when the module has already been loaded
 *
 * Must be re-applied when playback starts: the captions module is frequently
 * loaded at PLAYING, after onReady has already run, which is why suppressing it
 * only once on ready was not enough.
 *
 * Entirely best-effort — every call is swallowed. A learner seeing subtitles is a
 * blemish; a thrown error here would break their class.
 */
const suppressCaptions = (target: unknown) => {
  const p = target as {
    unloadModule?: (m: string) => void;
    setOption?: (module: string, option: string, value: unknown) => void;
  };
  for (const moduleName of ["captions", "cc"]) {
    try {
      p?.unloadModule?.(moduleName);
    } catch {
      /* module absent on this build */
    }
    try {
      p?.setOption?.(moduleName, "track", {});
    } catch {
      /* option unsupported on this build */
    }
  }
};

/**
 * Drift (seconds) the live-class sync tolerates before it re-seeks.
 *
 * Small enough that nobody sits noticeably behind the class; large enough that
 * the buffering stall which follows a seek does not itself count as drift and
 * trigger a second seek (and a second stall) on a slow connection.
 */
const LIVE_SYNC_TOLERANCE_SECONDS = 8;

/** Where a live class stands relative to its scheduled slot. */
type LivePhase = "not-started" | "live" | "ended";
type LiveSyncResult = "skipped" | LivePhase | "in-sync" | "seeked";

// Add the YouTube PlayerState enum to avoid window.YT references
enum PlayerState {
  UNSTARTED = -1,
  ENDED = 0,
  PLAYING = 1,
  PAUSED = 2,
  BUFFERING = 3,
  CUED = 5,
}

import { ConcentrationSettings } from "@/types/student-display-settings";
import { DEFAULT_STUDENT_DISPLAY_SETTINGS } from "@/constants/display-settings/student-defaults";

interface YouTubePlayerProps {
  videoId: string;
  videoTitle?: string;
  onTimeUpdate?: (currentTime: number) => void;
  ms?: number;
  questions?: Array<{
    id: string;
    question_time_in_millis: number;
    text_data: {
      content: string;
    };
    parent_rich_text?: {
      content: string;
    };
    options: Array<{
      id: string;
      text: {
        content: string;
      };
    }>;
    can_skip?: boolean;
    question_type?: string;
    auto_evaluation_json?: string;
  }>;
  allowPlayPause?: boolean; // If false, play/pause controls are disabled
  allowRewind?: boolean; // If false, rewind controls are disabled
  isLiveStream?: boolean; // If true, indicates this is a live stream
  liveTimestamp?: number; // Current live timestamp in seconds (for live streams)
  liveClassStartTime?: string; // ISO timestamp when the live class started (for syncing video position)
  /**
   * Server clock minus device clock, in ms. The live position is derived from
   * "now − scheduled start", and a phone whose clock is a few minutes off would
   * otherwise put its owner a few minutes away from everyone else.
   */
  liveClockOffsetMs?: number;
  enableConcentrationScore?: boolean; // If false, concentration score features are disabled
  concentrationSettings?: ConcentrationSettings;
}

export const formatTime = (timeInSeconds: number) => {
  const minutes = Math.floor(timeInSeconds / 60);
  const seconds = Math.floor(timeInSeconds % 60);
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
};

export const YouTubePlayerComp: React.FC<YouTubePlayerProps> = ({
  videoId,
  onTimeUpdate,
  ms = 0,
  questions = [],
  allowPlayPause = true,
  allowRewind = true,
  isLiveStream = false,
  liveTimestamp = 0,
  liveClassStartTime,
  liveClockOffsetMs = 0,
  enableConcentrationScore = true,
  concentrationSettings,
}) => {
  const { t } = useTranslation("libraryCommonB");
  const { activeItem } = useContentStore();
  // When Slide Content Protection is on, block right-click on the player (the
  // iframe is pointer-events-none with custom controls, so the contextmenu fires
  // on our container — preventing it here also covers the YouTube embed area).
  const { protectionEnabled } = useSlideContentProtection();
  // Subscribe only to addActivity to avoid re-render on every trackingData update
  const addActivity = useTrackingStore((state) => state.addActivity);
  const activityId = useRef(uuidv4());
  const currentTimestamps = useRef<
    Array<{
      id: string;
      start_time: string;
      end_time: string;
      start: number;
      end: number;
    }>
  >([]);
  const videoStartTime = useRef<number>(0);
  const videoEndTime = useRef<number>(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const currentStartTimeRef = useRef("");
  const timestampDurationRef = useRef(0);
  const [isFirstPlay, setIsFirstPlay] = useState(true);
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const { syncVideoTrackingData } = useVideoSync();
  const currentStartTimeInEpochRef = useRef<number>(0);

  const [isPlayed, setIsPlayed] = useState(allowPlayPause ? false : true);
  const [player, setPlayer] = useState<YouTubePlayer | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [duration, setDuration] = useState(0);

  const [currentTime, setCurrentTime] = useState(0);
  const [minutesInput, setMinutesInput] = useState("");
  const [secondsInput, setSecondsInput] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const concentrationScoreId = useRef(uuidv4());
  const [showFullscreenControls, setShowFullscreenControls] = useState(false);
  const fullscreenControlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false);
  const hasAutoPlayAttempted = useRef(false);
  const [showManualPlayButton, setShowManualPlayButton] = useState(false);
  const isMountedRef = useRef(true);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const visibilityResumeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const seekRetryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoplayVerifyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      playerRef.current = null;
      if (visibilityResumeTimeoutRef.current) {
        clearTimeout(visibilityResumeTimeoutRef.current);
        visibilityResumeTimeoutRef.current = null;
      }
      if (seekRetryTimeoutRef.current) {
        clearTimeout(seekRetryTimeoutRef.current);
        seekRetryTimeoutRef.current = null;
      }
      if (autoplayVerifyTimeoutRef.current) {
        clearTimeout(autoplayVerifyTimeoutRef.current);
        autoplayVerifyTimeoutRef.current = null;
      }
      if (liveStartTimerRef.current) {
        clearTimeout(liveStartTimerRef.current);
        liveStartTimerRef.current = null;
      }
    };
  }, []);

  // Playback speed state
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showSpeedOptions, setShowSpeedOptions] = useState(false);
  const speedOptions = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const speedButtonRef = useRef<HTMLButtonElement>(null);

  // Volume control state
  const [volume, setVolume] = useState(100); // 0 - 100
  const shouldAutoPlayAfterSeekRef = useRef(false);
  /**
   * True once the video has played to its end.
   *
   * playVideo() on a finished video does not resume it — it starts it over. The
   * player has several paths that resume playback on their own (the isPlayed
   * sync, resume-after-seek, tab-focus resume, initial autoplay), and any of them
   * firing after the end restarts the class. That is the auto-restart: a 40-minute
   * video in a 50-minute slot reaching its end and beginning again.
   *
   * Automatic resumes check this flag. Deliberate ones — the learner pressing play,
   * or seeking somewhere — clear it, so replaying on purpose still works.
   */
  const hasEndedRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Live class wall-clock sync.
  //
  // A live class is a scheduled playback: the video's position must equal the
  // time elapsed since the scheduled start — for everyone, all the time. The
  // player cannot know that on its own; it resumes from wherever it was paused.
  // So the position is re-derived from the clock at every point where it could
  // have drifted:
  //   ready          a learner joining at 12:35 for a 12:30 class lands at 5:00
  //   foreground     the OS pauses the video while the app is in the background;
  //                  on return it jumps ahead instead of resuming
  //   PLAYING        after a pause nobody asked for (OS, tab, or a seek that iOS
  //                  quietly ignored before its first tap)
  //   play tap       the learner restarting it by hand after such a pause
  //   scheduled start  PRE_JOINING lets learners in early; hold, then begin on time
  // Before the scheduled start and once the video has run out, playback is HELD:
  // nothing plays early and nothing starts over — that is the loop the learner
  // saw when an 8-minute video sat in a 10-minute slot.
  //
  // Deliberate actions are left alone. A pause via the pause button resumes
  // where it was paused, and a rewind (where allowed) is not snapped forward.
  // Only interruptions are corrected.
  // ---------------------------------------------------------------------------
  const liveSyncEnabled = isLiveStream && !!liveClassStartTime;
  const [livePhase, setLivePhase] = useState<LivePhase | null>(null);
  /** Mirror of livePhase for async code; non-null while playback is held. */
  const liveHoldRef = useRef<"not-started" | "ended" | null>(null);
  /**
   * True until a sync has confirmed the player sits at the live position. Set
   * again by anything that may have moved it (background, clock correction),
   * and by a seek — iOS ignores seekTo before the first tap, so a seek only
   * counts once a PLAYING event shows it landed.
   */
  const liveSyncPendingRef = useRef(true);
  const liveSyncInFlightRef = useRef(false);
  const liveClockOffsetRef = useRef(liveClockOffsetMs);
  const liveStartTimerRef = useRef<NodeJS.Timeout | null>(null);
  /** Set by the pause button just before it pauses; consumed by the PAUSED event. */
  const deliberatePauseRef = useRef(false);
  /** The pause the player is currently in, if any; cleared on PLAYING. */
  const lastPauseRef = useRef<{ deliberate: boolean } | null>(null);
  const wasPlayingBeforeBackgroundRef = useRef(false);
  // Mirrors for listeners registered once (visibility, app state, timers).
  const isPlayedRef = useRef(isPlayed);
  isPlayedRef.current = isPlayed;
  const playerReadyRef = useRef(playerReady);
  playerReadyRef.current = playerReady;
  /** Latest sync function, for listeners registered once. */
  const liveSyncRef = useRef<
    | ((
        reason: string,
        opts: { resume: boolean; waitForDuration?: boolean }
      ) => Promise<LiveSyncResult>)
    | null
  >(null);
  const resumeFromInterruptionRef = useRef<((reason: string) => Promise<void>) | null>(null);
  // UI control states
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [showSeekAnimation, setShowSeekAnimation] = useState<{
    side: "left" | "right";
    show: boolean;
  }>({ side: "left", show: false });

  // Question state
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [showQuestion, setShowQuestion] = useState(false);
  // High-water mark (ms) of the furthest video position already scanned for
  // questions. Detection fires for any question crossed since this mark, so a
  // higher playback speed or a forward jump (e.g. +10s) can never skip over one.
  const lastQuestionCheckTimeRef = useRef(0);
  const [answeredQuestions, setAnsweredQuestions] = useState<
    Record<
      string,
      {
        answered: boolean;
        selectedOptions: string | string[];
        isCorrect?: boolean;
        timestamp: number;
      }
    >
  >({});

  // Verification state
  const [showVerification, setShowVerification] = useState(false);
  const [verificationCountdown, setVerificationCountdown] = useState(59);
  const [verificationNumbers, setVerificationNumbers] = useState<number[]>([]);
  // const [verificationInterval] = useState(180); // Removed fixed interval
  const [lastVerificationTime, setLastVerificationTime] = useState(0);
  const verificationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const nextVerificationTimeRef = useRef<number>(0);

  // Settings defaults
  const settings = {
    enabled: concentrationSettings?.enabled ?? (enableConcentrationScore ?? DEFAULT_STUDENT_DISPLAY_SETTINGS.concentration.enabled),
    min_minutes: concentrationSettings?.frequency.min_minutes ?? DEFAULT_STUDENT_DISPLAY_SETTINGS.concentration.frequency.min_minutes,
    max_minutes: concentrationSettings?.frequency.max_minutes ?? DEFAULT_STUDENT_DISPLAY_SETTINGS.concentration.frequency.max_minutes,
  };

  // Reset schedule if settings change to ensure we pick up new intervals immediately
  useEffect(() => {
    if (nextVerificationTimeRef.current !== 0) {
      nextVerificationTimeRef.current = 0;
    }
  }, [settings.min_minutes, settings.max_minutes, settings.enabled]);

  // Concentration metrics
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [pauseCount, setPauseCount] = useState(0);
  const [wrongAnswerCount, setWrongAnswerCount] = useState(0);
  const [missedAnswerCount, setMissedAnswerCount] = useState(0);
  const [answerTimesInSeconds, setAnswerTimesInSeconds] = useState<number[]>(
    []
  );
  const [concentrationScore, setConcentrationScore] = useState(100); // Start with perfect score

  // Live stream state
  const [isBehindLive, setIsBehindLive] = useState(false);
  const [wasPausedByTabSwitch, setWasPausedByTabSwitch] = useState(false);

  // Memoize questions to prevent unnecessary re-renders
  const memoizedQuestions = useMemo(
    () => questions,
    [JSON.stringify(questions)]
  );

  // Memoize timeToQuestionMap to prevent recreating it unnecessarily
  const timeToQuestionMap = useMemo(() => {
    if (memoizedQuestions && memoizedQuestions.length > 0) {
      return memoizedQuestions.map((q) => ({
        time: q.question_time_in_millis,
        question: q,
      }));
    }
    return [];
  }, [memoizedQuestions]);

  // Subscribe only to setter functions to avoid re-render on store updates
  const setCurrentYoutubeTime = useMediaRefsStore(
    (state) => state.setCurrentYoutubeTime
  );
  const setCurrentYoutubeVideoLength = useMediaRefsStore(
    (state) => state.setCurrentYoutubeVideoLength
  );

  useEffect(() => {
    setCurrentYoutubeTime(currentTime);
  }, [currentTime, setCurrentYoutubeTime]);

  // Reset answered questions when questions or videoId changes
  useEffect(() => {
    setAnsweredQuestions({});
    lastQuestionCheckTimeRef.current = 0;
  }, [memoizedQuestions, videoId]);

  // Helper function to safely get a number from potentially a Promise<number>
  const safeGetNumber = async (value: any): Promise<number> => {
    if (value === undefined || value === null) return 0;
    if (typeof value === "number") return value;
    if (value instanceof Promise) {
      try {
        const resolved = await value;
        return typeof resolved === "number" ? resolved : 0;
      } catch {
        return 0;
      }
    }
    return 0;
  };

  // Helper function to verify player iframe is ready before operations
  const isPlayerIframeReady = async (
    playerInstance: YouTubePlayer | null
  ): Promise<boolean> => {
    if (!playerInstance) return false;
    try {
      const iframe = await playerInstance.getIframe();
      return !!(iframe && iframe.src);
    } catch (err) {
      console.warn("Unable to verify iframe state:", err);
      return false;
    }
  };

  // Safe wrapper for player operations.
  // Awaits the operation so both sync throws and rejected promises (e.g. from
  // a destroyed YouTube iframe whose internal `f` is null) are caught here
  // and never escape as unhandled rejections.
  const safePlayerOperation = async (
    operation: () => void | Promise<unknown>,
    operationName: string = "player operation"
  ): Promise<boolean> => {
    if (!isMountedRef.current) return false;
    const activePlayer = playerRef.current;
    if (!activePlayer || !playerReady) {
      console.warn(`${operationName}: Player not ready`);
      return false;
    }

    try {
      const iframeReady = await isPlayerIframeReady(activePlayer);
      if (!isMountedRef.current || playerRef.current !== activePlayer) {
        return false;
      }
      if (!iframeReady) {
        console.warn(`${operationName}: Iframe not ready, skipping operation`);
        return false;
      }

      await operation();
      return true;
    } catch (error) {
      console.error(`Error during ${operationName}:`, error);
      return false;
    }
  };

  const checkForQuestions = useCallback(async () => {
    if (!timeToQuestionMap || timeToQuestionMap.length === 0 || !player) return;
    if (showQuestion) return;

    try {
      const currentTime = await player.getCurrentTime();
      if (typeof currentTime !== "number" || isNaN(currentTime)) return;
      const currentTimeMs = currentTime * 1000;
      const prevTimeMs = lastQuestionCheckTimeRef.current;

      // Advance the high-water mark. On a backward seek currentTime drops below
      // the mark, so the crossing window below is empty and nothing fires —
      // re-watching naturally re-arms questions as playback moves forward again.
      lastQuestionCheckTimeRef.current = currentTimeMs;
      if (currentTimeMs <= prevTimeMs) return;

      // Fire for any unanswered question whose timestamp we crossed since the
      // last check (prevTimeMs, currentTimeMs]. Range-based detection (instead
      // of a narrow ±500ms window) means fast playback or a forward jump that
      // leaps over a question still triggers it. Earliest crossed question first.
      const questionToShow = timeToQuestionMap
        .filter(({ time, question }) => {
          if (answeredQuestions && answeredQuestions[question.id]?.answered)
            return false;
          return time > prevTimeMs && time <= currentTimeMs;
        })
        .sort((a, b) => a.time - b.time)[0];

      if (questionToShow) {
        // Re-arm from this question's time so that if a single jump skipped over
        // several questions, the remaining ones surface one-by-one on resume.
        lastQuestionCheckTimeRef.current = questionToShow.time;
        // Use the force pause function for immediate pause
        try {
          await player.pauseVideo();
        } catch (e) {
          console.warn("pauseVideo failed during question check", e);
        }
        setIsPlayed(false);
        stopProgressTracking();
        stopTimer();
        setCurrentQuestion(questionToShow.question);
        setShowQuestion(true);
      }
    } catch (error) {
      console.error("Error checking for questions:", error);
    }
  }, [timeToQuestionMap, showQuestion, answeredQuestions, player]);

  // Handle question submission
  const handleQuestionSubmit = async (selectedOption: string | string[]) => {
    if (!currentQuestion) return { success: false };

    // Evaluate the answer (you can enhance this logic)
    const isCorrect = true; // This should be based on actual evaluation logic

    // Mark question as answered with detailed info
    setAnsweredQuestions((prev) => ({
      ...prev,
      [currentQuestion.id]: {
        answered: true,
        selectedOptions: selectedOption,
        isCorrect,
        timestamp: Date.now(),
      },
    }));

    // Return mock response (in a real app, this would come from the server)
    return {
      success: true,
      isCorrect: isCorrect,
      explanation: "Great job! You've answered correctly.",
    };
  };

  // Handle closing the question overlay (skip/close)
  const handleQuestionClose = async () => {
    // Mark question as skipped only if it's skippable
    if (currentQuestion && currentQuestion.can_skip) {
      setAnsweredQuestions((prev) => ({
        ...prev,
        [currentQuestion.id]: {
          answered: true,
          selectedOptions: [],
          isCorrect: false,
          timestamp: Date.now(),
        },
      }));
    }

    setShowQuestion(false);
    setCurrentQuestion(null);

    // Resume video playback
    const success = await safePlayerOperation(
      () => player?.playVideo(),
      "resumeAfterQuestion"
    );
    if (success) {
      setIsPlayed(true);
    }
  };

  // Load saved verification time from Capacitor preferences
  useEffect(() => {
    if (!enableConcentrationScore) return;

    const loadSavedData = async () => {
      try {
        const { value } = await Preferences.get({
          key: `video_concentration_metrics_${activeItem?.id ?? "global"}`,
        });
        if (value) {
          const savedMetrics = JSON.parse(value);
          setTabSwitchCount(savedMetrics.tabSwitchCount || 0);
          setWrongAnswerCount(savedMetrics.wrongAnswerCount || 0);
          setMissedAnswerCount(savedMetrics.missedAnswerCount || 0);
          setPauseCount(savedMetrics.pauseCount || 0);
          setAnswerTimesInSeconds(savedMetrics.answerTimesInSeconds || []);
          setConcentrationScore(savedMetrics.concentrationScore || 100);
        }

        // Load last verification time
        const { value: verificationTimeValue } = await Preferences.get({
          key: "verification_time",
        });
        if (verificationTimeValue) {
          const savedTime = Number.parseInt(verificationTimeValue, 10);
          setLastVerificationTime(savedTime);
        }
      } catch (error) {
        console.error("Error loading saved concentration metrics:", error);
      }
    };

    loadSavedData();
  }, [enableConcentrationScore]);

  // Save concentration metrics to Capacitor preferences
  const saveConcentrationMetrics = useCallback(async () => {
    try {
      const metrics = {
        tabSwitchCount,
        wrongAnswerCount,
        missedAnswerCount,
        pauseCount,
        answerTimesInSeconds,
        concentrationScore,
      };

      await Preferences.set({
        key: `video_concentration_metrics_${activeItem?.id ?? "global"}`,
        value: JSON.stringify(metrics),
      });
    } catch (error) {
      console.error("Error saving concentration metrics:", error);
    }
  }, [
    tabSwitchCount,
    wrongAnswerCount,
    missedAnswerCount,
    pauseCount,
    answerTimesInSeconds,
    concentrationScore,
  ]);

  // Save verification time to Capacitor preferences
  const saveVerificationTime = async (time: number) => {
    try {
      await Preferences.set({
        key: "verification_time",
        value: time.toString(),
      });
    } catch (error) {
      console.error("Error saving verification time:", error);
    }
  };

  // Update concentration score based on metrics
  useEffect(() => {
    if (!enableConcentrationScore) return;

    // Simple algorithm to calculate concentration score
    // This can be adjusted based on specific requirements
    const baseScore = 100;
    const tabSwitchPenalty = tabSwitchCount * 10;
    const wrongAnswerPenalty = wrongAnswerCount * 5;
    const pouseCountPenalty = pauseCount * 5;
    const missedAnswerPenalty = missedAnswerCount * 20;

    let newScore =
      baseScore -
      tabSwitchPenalty -
      wrongAnswerPenalty -
      missedAnswerPenalty -
      pouseCountPenalty;
    newScore = Math.max(0, newScore); // Ensure score doesn't go below 0

    setConcentrationScore(newScore);
    saveConcentrationMetrics();
  }, [
    tabSwitchCount,
    wrongAnswerCount,
    missedAnswerCount,
    pauseCount,
    saveConcentrationMetrics,
    enableConcentrationScore,
  ]);

  // Generate verification numbers
  const generateVerificationNumbers = useCallback(() => {
    const correctNum = Math.floor(Math.random() * 100);
    let num1 = correctNum;
    let num2 = correctNum;

    // Ensure numbers are different from the correct one
    while (num1 === correctNum) {
      num1 = Math.floor(Math.random() * 100);
    }

    while (num2 === correctNum || num2 === num1) {
      num2 = Math.floor(Math.random() * 100);
    }

    // Set in a fixed order - correct number is always in the middle
    setVerificationNumbers([num1, correctNum, num2]);
  }, []);

  // Start the verification countdown timer
  const startVerificationTimer = useCallback(() => {
    if (verificationTimerRef.current) {
      clearInterval(verificationTimerRef.current);
    }

    setVerificationCountdown(59);

    verificationTimerRef.current = setInterval(() => {
      setVerificationCountdown((prev) => {
        if (prev <= 1) {
          // Time's up, pause the video
          void safePlayerOperation(
            () => playerRef.current?.pauseVideo(),
            "verificationTimeout.pause"
          );
          setIsPlayed(false);
          // Increment missed answer count
          setMissedAnswerCount((prev) => prev + 1);
          // Clear the timer
          if (verificationTimerRef.current) {
            clearInterval(verificationTimerRef.current);
            verificationTimerRef.current = null;
          }
          // Close the verification dialog
          setShowVerification(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [player]);

  // Handle verification number click
  const handleVerificationClick = async (index: number) => {
    // Clear the verification timer
    if (verificationTimerRef.current) {
      clearInterval(verificationTimerRef.current);
      verificationTimerRef.current = null;
    }

    const responseTime = 59 - verificationCountdown;
    // Add response time to array
    const newAnswerTimes = [...answerTimesInSeconds, responseTime];
    setAnswerTimesInSeconds(newAnswerTimes);
    // Check if correct number was clicked (middle position, index 1)
    if (index === 1) {
      // Record verification time
      const currentTimeInSeconds = Math.floor(Date.now() / 1000);
      setLastVerificationTime(currentTimeInSeconds);
      saveVerificationTime(currentTimeInSeconds);

      // Hide verification
      setShowVerification(false);

      // Schedule next
      scheduleNextVerification();
    } else {
      // Wrong number clicked, increment wrong answer count
      setWrongAnswerCount((prev) => prev + 1);

      // Pause the video
      await safePlayerOperation(
        () => playerRef.current?.pauseVideo(),
        "wrongAnswer.pause"
      );
      setIsPlayed(false);

      // Close the verification dialog
      setShowVerification(false);
      // Reschedule on resume
      nextVerificationTimeRef.current = 0;
    }
  };

  const scheduleNextVerification = useCallback(() => {
    if (!settings.enabled) return;

    const minSeconds = settings.min_minutes * 60;
    const maxSeconds = settings.max_minutes * 60;
    const randomSeconds = Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;

    // Set target time based on CURRENT elapsed time + random future duration
    nextVerificationTimeRef.current = elapsedTime + randomSeconds;
  }, [settings.enabled, settings.min_minutes, settings.max_minutes, elapsedTime]);


  // Check if verification is needed based on elapsed time
  useEffect(() => {
    if (!settings.enabled) return;

    if (isPlayed && nextVerificationTimeRef.current === 0) {
      scheduleNextVerification();
    }

    if (
      isPlayed &&
      elapsedTime > 0 &&
      nextVerificationTimeRef.current > 0 &&
      elapsedTime >= nextVerificationTimeRef.current
    ) {
      // Show verification without pausing the video
      setShowVerification(true);
      generateVerificationNumbers();
      startVerificationTimer();
      nextVerificationTimeRef.current = 0;
    }
  }, [
    elapsedTime,
    isPlayed,
    settings.enabled,
    scheduleNextVerification,
    generateVerificationNumbers,
    startVerificationTimer,
  ]);

  const calculatePercentageWatched = (totalDuration: number) => {
    const netDuration = calculateNetDuration(currentTimestamps.current);
    return ((netDuration / totalDuration) * 100).toFixed(2);
  };

  const clearUpdateInterval = useCallback(() => {
    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current);
      updateIntervalRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
      timestampDurationRef.current += 1;
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Start progress tracking interval when player is playing
  const startProgressTracking = useCallback(() => {
    if (progressIntervalRef.current) return;
    progressIntervalRef.current = setInterval(async () => {
      if (player) {
        try {
          const time = await safeGetNumber(player.getCurrentTime());
          setCurrentTime(time);

          // Check for questions at current timestamp
          checkForQuestions();

          if (onTimeUpdate) {
            onTimeUpdate(time);
          }
        } catch (error) {
          console.error("Error getting current time for progress bar:", error);
        }
      }
    }, 250); // Update 4 times per second for smoother progress
  }, [player, onTimeUpdate, checkForQuestions]);

  // Stop progress tracking interval
  const stopProgressTracking = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  // Function to check if user can navigate to a specific time
  const canNavigateToTime = useCallback(
    (targetTimeSeconds: number) => {
      const targetTimeMs = targetTimeSeconds * 1000;

      // Find all questions that come before or at the target time
      const previousQuestions = timeToQuestionMap.filter(
        ({ time }) => time <= targetTimeMs
      );

      // Check if all previous questions that cannot be skipped are answered
      for (const { question } of previousQuestions) {
        if (!question.can_skip && !answeredQuestions[question.id]?.answered) {
          return false; // Cannot navigate forward past unanswered required questions
        }
      }

      return true;
    },
    [timeToQuestionMap, answeredQuestions]
  );

  // Function to handle question marker click
  const handleQuestionMarkerClick = useCallback(
    (questionData: any) => {
      // Check if we can navigate to this question's time
      const questionTimeSeconds = questionData.question_time_in_millis / 1000;

      if (!canNavigateToTime(questionTimeSeconds)) {
        // Show a message that they need to answer previous questions first
        return;
      }

      // Set the current question and show overlay
      setCurrentQuestion(questionData);
      setShowQuestion(true);

      // Pause the video
      void safePlayerOperation(
        () => playerRef.current?.pauseVideo(),
        "questionMarker.pause"
      );
      setIsPlayed(false);
      stopProgressTracking();
      stopTimer();
    },
    [canNavigateToTime, stopProgressTracking, stopTimer]
  );

  // Pause video when tab is switched
  useEffect(() => {
    if (!enableConcentrationScore) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab switched away
        setTabSwitchCount((prev) => prev + 1);

        if (player && isPlayed) {
          void safePlayerOperation(
            () => playerRef.current?.pauseVideo(),
            "tabHidden.pause"
          );
          setIsPlayed(false);
          setWasPausedByTabSwitch(true); // Mark that video was paused by tab switch
        }

        // Close the verification dialog if it's open
        if (showVerification) {
          setShowVerification(false);

          // Clear the verification timer
          if (verificationTimerRef.current) {
            clearInterval(verificationTimerRef.current);
            verificationTimerRef.current = null;
          }
        }
      } else {
        // Tab is back in focus
        // Auto-play if allowPlayPause is false and video was paused by tab switch
        if (player && wasPausedByTabSwitch && !allowPlayPause) {
          if (visibilityResumeTimeoutRef.current) {
            clearTimeout(visibilityResumeTimeoutRef.current);
          }
          visibilityResumeTimeoutRef.current = setTimeout(async () => {
            visibilityResumeTimeoutRef.current = null;
            if (!isMountedRef.current) return;
            if (hasEndedRef.current || liveHoldRef.current) return;
            const ok = await safePlayerOperation(
              () => player?.playVideo(),
              "visibilityResume"
            );
            if (!isMountedRef.current) return;
            if (ok) {
              setIsPlayed(true);
              setWasPausedByTabSwitch(false);
            }
          }, 500); // Small delay to ensure tab is fully focused
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (visibilityResumeTimeoutRef.current) {
        clearTimeout(visibilityResumeTimeoutRef.current);
        visibilityResumeTimeoutRef.current = null;
      }
    };
  }, [
    player,
    showVerification,
    isPlayed,
    wasPausedByTabSwitch,
    allowPlayPause,
    enableConcentrationScore,
  ]);

  // Get duration when player is ready
  useEffect(() => {
    if (!player) return;

    const getDuration = async () => {
      try {
        const dur = await safeGetNumber(player.getDuration());
        setDuration(dur);
        // Set the YouTube video length in the store
        setCurrentYoutubeVideoLength(dur);
      } catch (error) {
        console.error("Error getting duration:", error);
      }
    };

    getDuration();
  }, [player, setCurrentYoutubeVideoLength]);

  // Update current time periodically
  useEffect(() => {
    if (!player || !isPlayed) return;

    const updateTimeInterval = setInterval(async () => {
      try {
        const time = await safeGetNumber(player.getCurrentTime());
        setCurrentTime(time);

        // Check if user is behind live for live streams
        if (isLiveStream && liveTimestamp > 0) {
          const timeDifference = liveTimestamp - time;
          setIsBehindLive(timeDifference > 30); // Consider behind if more than 30 seconds
        }
      } catch (error) {
        console.error("Error getting current time:", error);
      }
    }, 1000);

    return () => clearInterval(updateTimeInterval);
  }, [player, isPlayed, isLiveStream, liveTimestamp]);

  // Activity tracking effect
  useEffect(() => {
    const endTime = videoEndTime.current || getEpochTimeInMillis();

    const newActivity = {
      id: activeItem?.id || "",
      activity_id: activityId.current,
      source: "VIDEO" as const,
      source_id: videoId,
      start_time: videoStartTime.current,
      end_time: endTime,
      duration: elapsedTime.toString(),
      timestamps: currentTimestamps.current,
      percentage_watched: calculatePercentageWatched(duration),
      sync_status: "STALE" as const,
      current_start_time: currentStartTimeRef.current,
      current_start_time_in_epoch: currentStartTimeInEpochRef.current,
      // answered_time: answeredTimeArray,
      ...(enableConcentrationScore && {
        concentration_score: {
          id: concentrationScoreId.current,
          concentration_score: concentrationScore,
          tab_switch_count: tabSwitchCount,
          pause_count: pauseCount,
          wrong_answer_count: wrongAnswerCount,
          missed_answer_count: missedAnswerCount,
          answer_times_in_seconds: answerTimesInSeconds,
        },
      }),
      new_activity: true,
    };
    addActivity(newActivity, true);
  }, [
    elapsedTime,
    duration,
    videoId,
    tabSwitchCount,
    wrongAnswerCount,
    missedAnswerCount,
    answerTimesInSeconds,
    pauseCount,
    concentrationScore,
    addActivity,
    activeItem?.id,
    calculatePercentageWatched,
    enableConcentrationScore,
  ]);

  // Prevent right-click on the video
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      return false;
    };

    const playerContainer = playerContainerRef.current;
    if (playerContainer) {
      playerContainer.addEventListener("contextmenu", handleContextMenu);
    }

    return () => {
      if (playerContainer) {
        playerContainer.removeEventListener("contextmenu", handleContextMenu);
      }
    };
  }, []);

  // Add CSS to hide YouTube elements when the video ends
  useEffect(() => {
    const handleVideoEnd = () => {
      // Add a style element to hide YouTube end screen elements
      const styleEl = document.createElement("style");
      styleEl.innerHTML = `
            .ytp-endscreen-content,
            .ytp-ce-element,
            .ytp-ce-covering-overlay,
            .ytp-ce-element-shadow,
            .ytp-ce-covering-image,
            .ytp-ce-expanding-image,
            .ytp-ce-element.ytp-ce-channel.ytp-ce-channel-this,
            .ytp-ce-element.ytp-ce-video.ytp-ce-element-show,
            .ytp-pause-overlay,
            .ytp-related-on-pause-container,
            .ytp-more-videos-overlay {
            display: none !important;
            }
        `;
      document.head.appendChild(styleEl);

      return () => {
        document.head.removeChild(styleEl);
      };
    };

    if (player) {
      handleVideoEnd();
    }

    return () => {
      const styleElements = document.querySelectorAll("style");
      styleElements.forEach((el) => {
        if (el.innerHTML.includes("ytp-endscreen-content")) {
          document.head.removeChild(el);
        }
      });
    };
  }, [player]);



  // Note: CSS injection into YouTube iframe removed due to cross-origin restrictions
  // YouTube UI elements are controlled via playerVars (controls, modestbranding, etc.)

  // Determine a valid http(s) origin for Electron / iOS WebView vs Web.
  // iOS exposes `capacitor://localhost` which YouTube rejects → Error 153.
  const getPlayerOrigin = () => getYouTubeEmbedOrigin();

  // Native iOS loads the player through the https embed bridge (Error 153).
  const bridgeHost = getYouTubeBridgeHost();
  const opts: YouTubeProps["opts"] = {
    height: "100%",
    width: "100%",
    ...(bridgeHost ? { host: bridgeHost } : {}),
    playerVars: {
      controls: 0, // Disable YouTube controls
      disablekb: 1, // Disable keyboard controls
      fs: 0, // Disable fullscreen button
      iv_load_policy: 3, // Disable annotations
      modestbranding: 1, // Hide YouTube logo
      rel: 0, // Don't show related videos
      // showinfo: 0, // Hide video title and uploader
      autoplay: allowPlayPause ? 0 : 1, // Autoplay when pause control is disabled
      // NOTE: there is deliberately no cc_load_policy here. The API only accepts
      // cc_load_policy=1, which FORCES captions on; there is no value that turns
      // them off, because the default is "whatever the viewer prefers". Captions
      // are suppressed in onPlayerReady via unloadModule instead.
      origin: getPlayerOrigin(), // Use localhost for Electron, actual origin for web
      enablejsapi: 1, // Enable JavaScript API
      playsinline: 1, // Play inline on iOS
      loop: 0, // Don't loop the video
      color: "white", // Use white progress bar
      hl: "en", // Set language to English
      start: 0, // Start from the beginning
      end: 0, // End at the natural end of the video
      // autohide: 1, // Hide controls after play begins
      // Web/Android keep their existing full-href referrer (unchanged behaviour); only
      // iOS/Electron — where href is a rejected capacitor://…/file:// value — fall back to
      // the sanitized origin. Fix for error 153.
      widget_referrer: /^https?:/.test(window.location.origin)
        ? window.location.href
        : getPlayerOrigin(),
    },
  };

  const togglePause = async () => {
    if (!allowPlayPause) return;
    // The learner chose this pause: resuming later continues from here rather
    // than jumping to the live position.
    deliberatePauseRef.current = true;
    setIsPlayed(false);

    await safePlayerOperation(
      () => playerRef.current?.pauseVideo(),
      "togglePause"
    );
  };

  /**
   * Live classes only: bring the player to the live position before a
   * deliberate play, and refuse to play while the class is held. Returns
   * true when playback may go ahead.
   */
  const liveSyncBeforePlay = async (reason: string): Promise<boolean> => {
    if (!liveSyncEnabled) return true;
    const needsSync =
      liveSyncPendingRef.current ||
      !!liveHoldRef.current ||
      !!(lastPauseRef.current && !lastPauseRef.current.deliberate);
    if (!needsSync) return true;
    // No waiting for the duration here: the play must follow the tap closely
    // (mobile Safari drops a play that arrives seconds after the gesture).
    const result = await liveSyncRef.current?.(reason, {
      resume: false,
      waitForDuration: false,
    });
    // Nothing plays before the scheduled start, and nothing starts over once
    // the video has run out. Any other outcome — including "skipped" when the
    // duration is still unknown — lets the play through; the PLAYING event
    // that follows finishes the sync.
    return result !== "not-started" && result !== "ended";
  };

  // Direct pause function for question overlay - bypasses state management issues
  const forcePause = async () => {
    const success = await safePlayerOperation(async () => {
      await playerRef.current?.pauseVideo();
      setIsPlayed(false);
      stopProgressTracking();
      stopTimer();
    }, "forcePause");

    if (success) {
      console.log("VideoQuestionOverlay: Video force paused successfully");
    } else {
      console.warn("VideoQuestionOverlay: Player not ready for force pause");
    }
  };

  const togglePlay = async () => {
    if (!(await liveSyncBeforePlay("play"))) return;
    // A deliberate press is a request to watch again; let it through.
    hasEndedRef.current = false;
    setIsPlayed(true);

    await safePlayerOperation(async () => {
      const p = playerRef.current;
      if (!p) return;
      try {
        await p.unMute();
      } catch (e) {
        console.warn("unMute failed (non-fatal)", e);
      }
      await p.playVideo();
    }, "togglePlay");
  };

  const onPlayerReady: YouTubeProps["onReady"] = async (
    event: YouTubeEvent
  ) => {
    if (!isMountedRef.current) return;
    playerRef.current = event.target;
    setPlayer(event.target);
    setPlayerReady(true);

    suppressCaptions(event.target);

    try {
      const vol = await event.target.getVolume();
      setVolume(typeof vol === "number" ? vol : 100);
    } catch (err) {
      console.error("Error getting initial volume", err);
    }

    // Get the iframe element
    // Get the iframe element
    try {
      const iframe = await event.target.getIframe();


      // Set iframe attributes for Error 153 fix
      if (iframe) {
        try {
          iframe.setAttribute(
            "allow",
            "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
          );
          iframe.setAttribute("allowfullscreen", "true");
          // Fix for YouTube error 153 on Windows Electron
          iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
        } catch (e) {
          console.error("Error setting iframe attributes:", e);
        }

      }
    } catch (error) {
      console.error("Error getting iframe:", error);
    }
  };

  // Handler for manual play button (for iOS/browsers that block autoplay)
  const handleManualPlay = async () => {
    if (!player || !playerReady) return;
    if (!(await liveSyncBeforePlay("manualPlay"))) return;
    // Deliberate, like togglePlay — replaying a finished class on purpose is fine.
    hasEndedRef.current = false;

    const success = await safePlayerOperation(async () => {
      const p = playerRef.current;
      if (!p) return;
      try {
        await p.unMute();
      } catch (e) {
        console.warn("unMute failed during manual play", e);
      }
      await p.playVideo();
    }, "manualPlay");

    if (success) {
      setIsPlayed(true);
      setShowManualPlayButton(false); // Hide the button permanently
    }
  };

  // Clean up fullscreen controls timeout
  useEffect(() => {
    return () => {
      if (fullscreenControlsTimeoutRef.current) {
        clearTimeout(fullscreenControlsTimeoutRef.current);
      }
    };
  }, []);

  // Auto-play when player is ready and allowPlayPause is false
  useEffect(() => {
    if (
      !allowPlayPause &&
      player &&
      playerReady &&
      !hasAutoPlayAttempted.current
    ) {
      hasAutoPlayAttempted.current = true; // Mark that we've attempted autoplay

      // Small delay to ensure iframe is ready
      const autoplayTimeout = setTimeout(async () => {
        const success = await safePlayerOperation(async () => {
          const p = playerRef.current;
          if (!p) return;
          // A live class held before its start (or after its end) must not
          // be autoplayed either — the sync resumes it on time.
          if (hasEndedRef.current || liveHoldRef.current) return;
          try {
            await p.unMute(); // Unmute for autoplay
          } catch (e) {
            console.warn("unMute failed during autoplay", e);
          }
          await p.playVideo();
        }, "autoplay");

        if (success) {
          // Verify that video actually started playing after a short delay
          autoplayVerifyTimeoutRef.current = setTimeout(async () => {
            autoplayVerifyTimeoutRef.current = null;
            if (!isMountedRef.current) return;
            try {
              const playerState = await player.getPlayerState();
              if (!isMountedRef.current) return;
              // PlayerState.PLAYING = 1, if not playing, show manual button
              if (playerState !== 1) {
                setShowManualPlayButton(true);
              } else {
                setIsPlayed(true);
                setShowManualPlayButton(false);
              }
            } catch (error) {
              console.warn("Error checking player state after autoplay", error);
              if (isMountedRef.current) setShowManualPlayButton(true);
            }
          }, 1000);
        } else {
          console.warn("Autoplay failed, showing manual play button");
          if (isMountedRef.current) setShowManualPlayButton(true);
        }
      }, 500);

      return () => {
        clearTimeout(autoplayTimeout);
        if (autoplayVerifyTimeoutRef.current) {
          clearTimeout(autoplayVerifyTimeoutRef.current);
          autoplayVerifyTimeoutRef.current = null;
        }
      };
    }
  }, [allowPlayPause, player, playerReady]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNowFullscreen = !!document.fullscreenElement;
      setIsFullscreen(isNowFullscreen);

      // Show controls briefly when entering/exiting fullscreen
      if (isNowFullscreen) {
        // Entering fullscreen - show fullscreen controls
        setShowFullscreenControls(true);

        // Hide controls after 3 seconds
        if (fullscreenControlsTimeoutRef.current) {
          clearTimeout(fullscreenControlsTimeoutRef.current);
        }

        fullscreenControlsTimeoutRef.current = setTimeout(() => {
          setShowFullscreenControls(false);
        }, 3000);
      } else {
        // Exiting fullscreen - show regular controls
        setShowFullscreenControls(false);
        setShowControls(true);

        // Hide regular controls after 3 seconds
        if (controlsTimeoutRef.current) {
          clearTimeout(controlsTimeoutRef.current);
        }

        controlsTimeoutRef.current = setTimeout(() => {
          setShowControls(false);
        }, 3000);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  // Control video playback based on isPlayed state
  useEffect(() => {
    if (!player || !playerReady) return;

    const controlPlayback = async () => {
      // Don't interfere if we're still performing the initial seek
      if (!hasPerformedInitialSeekRef.current && ms > 0) {
        console.log("Skipping controlPlayback during initial seek");
        return;
      }

      await safePlayerOperation(async () => {
        const p = playerRef.current;
        if (!p) return;
        if (isPlayed) {
          // Re-runs whenever its deps change, so without this it restarts a
          // finished class every time it fires.
          if (hasEndedRef.current || liveHoldRef.current) return;
          await p.playVideo();
          startProgressTracking();
        } else {
          await p.pauseVideo();
          setPauseCount((prev) => prev + 1);
          stopProgressTracking();
        }
      }, "controlPlayback");
    };

    controlPlayback();
  }, [
    isPlayed,
    player,
    playerReady,
    ms,
    startProgressTracking,
    stopProgressTracking,
  ]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      clearUpdateInterval();
      stopProgressTracking();
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (verificationTimerRef.current) {
        clearInterval(verificationTimerRef.current);
      }
      if (fullscreenControlsTimeoutRef.current) {
        clearTimeout(fullscreenControlsTimeoutRef.current);
      }
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [clearUpdateInterval, stopProgressTracking]);

  const onStateChange = async (event: YouTubeEvent) => {
    if (!isMountedRef.current) return;
    if (!player || !playerRef.current) return;

    // Re-assert "no subtitles" the moment playback starts. YouTube commonly loads
    // the captions module at PLAYING rather than at ready, so suppressing it only
    // in onPlayerReady leaves captions to reappear for viewers whose account
    // forces them on — which is exactly what was reported.
    if (event.data === PlayerState.PLAYING) suppressCaptions(event.target);

    // Hold the last frame once the class finishes rather than letting the embed
    // roll back to the start. A learner who leaves the tab open through the tail
    // of the slot should see a finished class, not one that quietly began again.
    if (event.data === PlayerState.ENDED) {
      safePlayerOperation(async () => {
        await playerRef.current?.pauseVideo();
      }, "holdAtEnd");
    }

    // Auto-play after seek completes (event-driven approach)
    if (shouldAutoPlayAfterSeekRef.current) {
      const state = event.data;
      // YouTube goes: BUFFERING (3) → PAUSED (2) or CUED (5) after seek
      if (state === PlayerState.PAUSED || state === 5) { // PAUSED or CUED
        console.log(`Player ready after seek (state: ${state}), starting playback...`);
        shouldAutoPlayAfterSeekRef.current = false;

        await safePlayerOperation(async () => {
          const p = playerRef.current;
          if (!p) return;
          if (hasEndedRef.current || liveHoldRef.current) return;
          await p.playVideo();
          if (isMountedRef.current) setIsPlayed(true);
        }, "autoPlayAfterSeek");
        return; // Let the next state change handle the rest
      }
    }

    const now = getEpochTimeInMillis();

    // Handle different state events without directly referencing YT.PlayerState
    const PLAYING_STATE = PlayerState.PLAYING;
    const PAUSED_STATE = PlayerState.PAUSED;
    const ENDED_STATE = PlayerState.ENDED;

    // Safely get the current time
    let currentTime = 0;
    try {
      currentTime = await safeGetNumber(player.getCurrentTime());
      setCurrentTime(currentTime); // Update state with current time
    } catch (error) {
      console.error("Error getting current time:", error);
    }

    if (event.data === PLAYING_STATE) {
      // Playing now, so the "tap to start" fallback has nothing left to offer —
      // a class that the live sync started on time must not sit under it.
      setShowManualPlayButton(false);

      // Live class: a pause nobody asked for (OS, tab switch) resumes from the
      // paused position, which is now behind the class. Any play that follows
      // one — or that arrives while a sync is still unconfirmed — is corrected
      // here. A pause the learner chose is left where they left it.
      const followsInterruption =
        !!lastPauseRef.current && !lastPauseRef.current.deliberate;
      lastPauseRef.current = null;
      deliberatePauseRef.current = false;
      if (
        liveSyncEnabled &&
        (liveSyncPendingRef.current || followsInterruption) &&
        !liveSyncInFlightRef.current
      ) {
        void liveSyncRef.current?.("playing", { resume: false });
      }

      startTimer();
      startProgressTracking();

      if (!videoStartTime.current) {
        videoStartTime.current = now;
      }

      if (isFirstPlay) {
        syncVideoTrackingData();
        setIsFirstPlay(false);

        if (!updateIntervalRef.current) {
          // Periodic sync cadence = min(video duration, 60s). For short
          // videos the cadence shrinks so the worst-case unsynced window
          // is bounded by the video length.
          const durSec = await safeGetNumber(player.getDuration());
          const periodMs = Math.max(
            1000,
            Math.min(
              Number.isFinite(durSec) && durSec > 0
                ? Math.round(durSec * 1000)
                : 60000,
              60000
            )
          );
          updateIntervalRef.current = setInterval(() => {
            syncVideoTrackingData();
          }, periodMs);
        }
      }

      currentStartTimeRef.current = formatVideoTime(currentTime);
      currentStartTimeInEpochRef.current =
        convertTimeToSeconds(currentStartTimeRef.current) * 1000;
      // Actually playing again, so it is no longer "finished".
      hasEndedRef.current = false;
      setIsPlayed(true);
    } else if (event.data === PAUSED_STATE || event.data === ENDED_STATE) {
      if (event.data === ENDED_STATE) hasEndedRef.current = true;
      // Remember whose pause this is; the next PLAYING decides from it
      // whether the live position must be restored.
      lastPauseRef.current = { deliberate: deliberatePauseRef.current };
      deliberatePauseRef.current = false;
      stopTimer();
      stopProgressTracking();
      videoEndTime.current = now;

      // Use the player's actual playback position rather than a wall-clock
      // tick estimate. The 1-Hz timer rounds down to the last whole second,
      // and the natural-end event fires before the next tick lands —
      // together they undercount each watch by up to ~1 s. On natural ENDED,
      // snap to getDuration() because YouTube's getCurrentTime() at end
      // can also be slightly short.
      const startTimeInMillis =
        convertTimeToSeconds(currentStartTimeRef.current) * 1000;
      let endTimeInMillis: number;
      if (event.data === ENDED_STATE) {
        const dur = await safeGetNumber(player.getDuration());
        endTimeInMillis = Math.round(dur * 1000);
      } else {
        const cur = await safeGetNumber(player.getCurrentTime());
        endTimeInMillis = Math.round(cur * 1000);
      }
      const endTimeStamp = formatVideoTime(endTimeInMillis / 1000);

      if (
        currentStartTimeRef.current !== "" &&
        !isNaN(startTimeInMillis) &&
        !isNaN(endTimeInMillis) &&
        endTimeInMillis > startTimeInMillis
      ) {
        currentTimestamps.current.push({
          id: uuidv4(),
          start_time: currentStartTimeRef.current,
          end_time: endTimeStamp,
          start: startTimeInMillis,
          end: endTimeInMillis,
        });
      } else {
        console.warn('⚠️ [YouTubePlayer] Skipped creating invalid timestamp:', {
          startTime: currentStartTimeRef.current,
          endTime: endTimeStamp,
          startTimeInMillis,
          endTimeInMillis,
        });
      }

      currentStartTimeRef.current = formatVideoTime(currentTime);
      timestampDurationRef.current = 0;
      setIsPlayed(false);

      // Sync immediately on natural end so the learner sees 100% within the
      // cascade-refresh window (~700 ms) instead of waiting for the periodic
      // tick or for tab close. PAUSED still relies on the periodic tick to
      // avoid a per-pause POST storm during scrubbing.
      if (event.data === ENDED_STATE) {
        syncVideoTrackingData();
        // Live class: the video ran out. Almost always that means the slot
        // outlived the video and the class is over — hold it there, so the
        // Play button cannot start it over. The clock decides rather than the
        // event, because a learner who was ahead of the class (rewind allowed)
        // should be put back at the live position instead.
        if (liveSyncEnabled) {
          void liveSyncRef.current?.("ended", { resume: true });
        }
      }
    }
  };

  // Note: numeric input handler removed as this component does not expose manual time jump UI

  const seekToTimestamp = async (
    targetTimeInSeconds?: number,
    forceSeek = false
  ) => {
    if (!player || !playerReady) return false;

    // Block manual seeking if rewind is not allowed (unless it's a forced seek like initial ms prop)
    if (!forceSeek && !allowRewind) {
      return false;
    }

    // Verify iframe is ready
    const iframeReady = await isPlayerIframeReady(player);
    if (!iframeReady) {
      console.warn("Player iframe not ready yet, skipping seek");
      return false;
    }

    let totalSecondsToSeek: number;

    if (typeof targetTimeInSeconds === "number") {
      totalSecondsToSeek = targetTimeInSeconds;
    } else {
      const minutes = minutesInput === "" ? 0 : Number.parseInt(minutesInput);
      const seconds = secondsInput === "" ? 0 : Number.parseInt(secondsInput);
      totalSecondsToSeek = minutes * 60 + seconds;
    }

    // Check navigation restrictions unless forced (e.g., for initial seek with ms prop)
    if (!forceSeek && !canNavigateToTime(totalSecondsToSeek)) {
      // You could show a toast notification here
      return false;
    }

    try {
      // A player that has not finished loading metadata reports a duration of 0,
      // and briefly does so right after onReady. Clamping against that turned
      // EVERY seek into a seek to 0 — which is how a live class that had already
      // run its course appeared to start itself over. Wait for a real duration
      // instead of trusting the first answer.
      let videoDuration = await safeGetNumber(player.getDuration());
      for (let i = 0; i < 10 && !(videoDuration > 0); i++) {
        await new Promise((r) => setTimeout(r, 300));
        if (!isMountedRef.current) return false;
        videoDuration = await safeGetNumber(player.getDuration());
      }
      if (!(videoDuration > 0)) {
        // Still unknown. There is nothing safe to clamp against, and seeking to 0
        // would restart the class, so leave the player where it is.
        console.warn("Seek skipped: video duration unavailable");
        return false;
      }

      let finalSeekTime = totalSecondsToSeek;
      // Ensure timestamp is within valid range
      if (finalSeekTime <= 0) {
        finalSeekTime = 0;
      } else if (finalSeekTime >= videoDuration) {
        // Land just short of the end rather than exactly on it: seeking to the
        // duration itself fires ENDED, and the replay that follows is the same
        // restart under a different name.
        finalSeekTime = Math.max(0, videoDuration - 1);
      }

      const success = await safePlayerOperation(
        () => player.seekTo(finalSeekTime, true),
        "seekToTimestamp"
      );

      if (success) {
        // Update currentTime state to reflect new position
        setCurrentTime(finalSeekTime);
        // Programmatic jumps (initial resume seek, live-class sync) should not
        // replay questions that sit before the landing point, so move the
        // high-water mark with them. User-initiated forward seeks deliberately
        // leave the mark behind so crossed questions still fire.
        if (forceSeek) {
          lastQuestionCheckTimeRef.current = finalSeekTime * 1000;
        }
      }

      return success;
    } catch (error) {
      console.error("Error seeking to timestamp:", error);
      return false;
    }
  };

  const hasPerformedInitialSeekRef = useRef(false);
  const lastVideoIdForSeekRef = useRef<string>("");

  // Reset seek flag when video changes
  useEffect(() => {
    if (videoId !== lastVideoIdForSeekRef.current) {
      hasPerformedInitialSeekRef.current = false;
      // A different video is a different class — whatever ended, this has not,
      // so it must not inherit the previous one's finished state and refuse to
      // start. Matters where the player is reused rather than remounted.
      hasEndedRef.current = false;
      lastVideoIdForSeekRef.current = videoId;
    }
  }, [videoId]);

  useEffect(() => {
    // Only seek if ms is greater than 0 and player is ready AND we haven't performed initial seek yet
    if (ms > 0 && player && playerReady && !hasPerformedInitialSeekRef.current) {
      const totalSeconds = ms / 1000;
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = Math.floor(totalSeconds % 60); // Use Math.floor for whole seconds

      // Update input fields for display consistency
      setMinutesInput(minutes.toString());
      setSecondsInput(seconds.toString());

      let retryCount = 0;
      const maxRetries = 5;

      // Wait for player to be fully ready before seeking
      const performSeek = async () => {
        if (!isMountedRef.current) return;
        try {
          // Ensure iframe is ready with retry logic
          const isReady = await isPlayerIframeReady(player);
          if (!isMountedRef.current) return;
          if (!isReady) {
            if (retryCount < maxRetries) {
              retryCount++;
              console.warn(`Player iframe not ready for initial seek, retry ${retryCount}/${maxRetries}...`);
              seekRetryTimeoutRef.current = setTimeout(performSeek, 300); // Retry after 300ms
              return;
            } else {
              console.error("Player iframe failed to be ready after max retries");
              return;
            }
          }

          // Double-check player state
          const playerState = await player.getPlayerState();
          if (!isMountedRef.current) return;
          console.log(`Player state before seek: ${playerState}`);

          // Perform the seek
          const seekSuccess = await seekToTimestamp(totalSeconds, true);
          if (!isMountedRef.current) return;

          if (seekSuccess) {
            hasPerformedInitialSeekRef.current = true;
            console.log(`Successfully seeked to ${totalSeconds}s`);

            // Set flag for event-driven auto-play (onStateChange will handle it)
            shouldAutoPlayAfterSeekRef.current = true;
            console.log("Waiting for player state change to auto-play...");
          }
        } catch (error) {
          console.error("Error during initial seek:", error);
        }
      };

      // Start the seek process after initial delay
      seekRetryTimeoutRef.current = setTimeout(performSeek, 1000); // Increased to 1 second

      return () => {
        if (seekRetryTimeoutRef.current) {
          clearTimeout(seekRetryTimeoutRef.current);
          seekRetryTimeoutRef.current = null;
        }
      };
    }
  }, [ms, player, playerReady, isPlayed]);

  // ----- Live class wall-clock sync (see the note by liveHoldRef) -----

  /** Seconds since the scheduled start on the server's clock; negative before it. */
  const getLiveExpectedSeconds = (): number | null => {
    if (!liveClassStartTime) return null;
    const start = new Date(liveClassStartTime).getTime();
    if (Number.isNaN(start)) return null;
    return (Date.now() + liveClockOffsetRef.current - start) / 1000;
  };

  const setLiveHold = (hold: "not-started" | "ended" | null) => {
    liveHoldRef.current = hold;
    if (isMountedRef.current) setLivePhase(hold ?? "live");
  };

  /**
   * Bring the player to where the class is right now.
   *
   * With `resume`, playback is (re)started once the player is in position —
   * used when an interruption is what paused it. Without it the caller decides:
   * a PLAYING event is already playing, a play tap plays afterwards.
   *
   * `waitForDuration` (default on) polls up to ~3 s for the video length. A
   * play tap passes false: mobile Safari only honours a play that follows the
   * tap closely, so the tap must not sit behind that wait — it plays, and the
   * PLAYING event finishes the sync once the length is known.
   */
  const syncToLiveClass = async (
    reason: string,
    { resume, waitForDuration = true }: { resume: boolean; waitForDuration?: boolean }
  ): Promise<LiveSyncResult> => {
    if (!liveSyncEnabled) return "skipped";
    const p = playerRef.current;
    if (!p || !playerReadyRef.current || !isMountedRef.current) return "skipped";
    // One at a time — overlapping seeks fight each other. A trigger that lands
    // during a sync is not lost: the seek's own PLAYING event re-checks.
    if (liveSyncInFlightRef.current) return "skipped";
    liveSyncInFlightRef.current = true;
    try {
      const expected = getLiveExpectedSeconds();
      if (expected === null) return "skipped";

      if (liveStartTimerRef.current) {
        clearTimeout(liveStartTimerRef.current);
        liveStartTimerRef.current = null;
      }

      if (expected < 0) {
        // Scheduled start is still ahead (PRE_JOINING admits learners during
        // the waiting-room window). Hold the first frame and begin on time —
        // starting now would put this learner minutes ahead of the class.
        // Set the hold before the first await so the autoplay that fires
        // shortly after ready sees it.
        setLiveHold("not-started");
        liveSyncPendingRef.current = true;
        await safePlayerOperation(() => p.pauseVideo(), `liveSync(${reason}).holdBeforeStart`);
        if (isMountedRef.current) setIsPlayed(false);
        liveStartTimerRef.current = setTimeout(() => {
          liveStartTimerRef.current = null;
          void liveSyncRef.current?.("scheduled-start", { resume: true });
        }, Math.ceil(-expected * 1000) + 250);
        return "not-started";
      }

      // A duration of 0 means "not loaded yet", not "zero-length" — and on a
      // phone it stays 0 until the first play. Clamping against it is how a
      // late joiner used to be sent to the beginning, so wait for a real value
      // and otherwise leave the player alone; the next PLAYING retries.
      let duration = await safeGetNumber(p.getDuration());
      for (let i = 0; waitForDuration && i < 10 && !(duration > 0); i++) {
        await new Promise((r) => setTimeout(r, 300));
        if (!isMountedRef.current || playerRef.current !== p) return "skipped";
        duration = await safeGetNumber(p.getDuration());
      }
      if (!(duration > 0)) {
        console.warn(`liveSync(${reason}): duration unavailable, not seeking`);
        return "skipped";
      }

      // The slot outlives the video (an 8-minute video in a 10-minute class).
      // There is nothing left to play: hold the last frame and let nothing —
      // autoplay, a resume, or the Play button — start it over.
      const holdAtEnd = async (): Promise<LiveSyncResult> => {
        setLiveHold("ended");
        hasEndedRef.current = true;
        liveSyncPendingRef.current = false;
        await safePlayerOperation(() => p.pauseVideo(), `liveSync(${reason}).holdAtEnd`);
        if (isMountedRef.current) setIsPlayed(false);
        return "ended";
      };
      if (expected >= duration - 1) return holdAtEnd();

      const current = await safeGetNumber(p.getCurrentTime());
      let result: LiveSyncResult;
      if (Math.abs(current - expected) <= LIVE_SYNC_TOLERANCE_SECONDS) {
        // The player sits at its end and the clock agrees to within the
        // tolerance: that is the class ending, not drift to correct. A
        // playVideo() on an ended player starts it over — the loop.
        if (hasEndedRef.current) return holdAtEnd();
        setLiveHold(null);
        liveSyncPendingRef.current = false;
        result = "in-sync";
      } else {
        setLiveHold(null);
        // Re-read the clock: waiting for the duration may have taken seconds.
        const target = getLiveExpectedSeconds() ?? expected;
        console.log(
          `liveSync(${reason}): player at ${Math.round(current)}s, class at ${Math.round(target)}s — seeking`
        );
        const seeked = await seekToTimestamp(target, true);
        if (!seeked) return "skipped";
        // Stays pending until a PLAYING event confirms the seek landed.
        result = "seeked";
      }

      if (resume) {
        // The clock says the class is mid-video, so whatever ended earlier
        // (a learner who was ahead reaching the end) is not the class ending.
        hasEndedRef.current = false;
        await safePlayerOperation(() => p.playVideo(), `liveSync(${reason}).resume`);
        // isPlayed follows the PLAYING event: if the browser refuses to play
        // without a tap, the Play button stays for the learner to press.
      }
      return result;
    } catch (error) {
      console.error(`liveSync(${reason}) failed:`, error);
      return "skipped";
    } finally {
      liveSyncInFlightRef.current = false;
    }
  };
  liveSyncRef.current = syncToLiveClass;

  /**
   * The app or tab came back to the foreground. The OS pauses the video
   * while the app is away and the player would resume where it stopped —
   * behind the class. Put it at the live position and, if the interruption
   * is what paused it, play on.
   */
  const resumeFromInterruption = async (reason: string) => {
    if (!liveSyncEnabled) return;
    const wasPlaying = wasPlayingBeforeBackgroundRef.current;
    wasPlayingBeforeBackgroundRef.current = false;
    // Let the player report the state it was left in: the PAUSED the OS
    // caused arrives a beat after the foreground event, and acting before it
    // lands means the pause handler's pauseVideo() would undo the resume.
    await new Promise((r) => setTimeout(r, 400));
    if (!isMountedRef.current) return;
    const pausedOnPurpose = !!lastPauseRef.current?.deliberate;
    const pausedByInterruption = !!lastPauseRef.current && !pausedOnPurpose;
    // A learner who paused on purpose before leaving gets their paused
    // position back — this is the pause button working as designed.
    if (!wasPlaying && pausedOnPurpose && allowPlayPause) return;
    liveSyncPendingRef.current = true;
    await syncToLiveClass(reason, {
      // Play on when the class must be playing, or when it was and the
      // interruption is what stopped it. A video the learner never started
      // (pause control on, no tap yet) stays waiting for their tap.
      resume: !allowPlayPause || wasPlaying || pausedByInterruption,
    });
  };
  resumeFromInterruptionRef.current = resumeFromInterruption;

  // Initial sync once the player is ready: a late joiner lands mid-video, an
  // early one (PRE_JOINING) is held until the scheduled start.
  useEffect(() => {
    if (!liveSyncEnabled || !player || !playerReady) return;
    liveSyncPendingRef.current = true;
    // Autoplay (allowPlayPause=false) and YouTube's own play-on-seek from a
    // cued player start playback; the sync only positions it.
    void liveSyncRef.current?.("ready", { resume: false });
    return () => {
      if (liveStartTimerRef.current) {
        clearTimeout(liveStartTimerRef.current);
        liveStartTimerRef.current = null;
      }
    };
  }, [liveSyncEnabled, liveClassStartTime, player, playerReady]);

  // Background / foreground. Both the document event and the Capacitor app
  // state are listened to: in a WebView either can be the one that fires.
  // Handlers are idempotent, so hearing the same transition twice is harmless.
  useEffect(() => {
    if (!liveSyncEnabled) return;

    const onBackground = () => {
      wasPlayingBeforeBackgroundRef.current =
        wasPlayingBeforeBackgroundRef.current || isPlayedRef.current;
      liveSyncPendingRef.current = true;
    };
    const onForeground = () => {
      void resumeFromInterruptionRef.current?.("foreground");
    };
    const handleVisibilityChange = () => {
      if (document.hidden) onBackground();
      else onForeground();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    let appStateHandle: PluginListenerHandle | null = null;
    let removed = false;
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.addListener("appStateChange", ({ isActive }: { isActive: boolean }) => {
        if (isActive) onForeground();
        else onBackground();
      })
        .then((handle) => {
          if (removed) void handle.remove();
          else appStateHandle = handle;
        })
        .catch(() => {
          /* the visibility listener above still covers this */
        });
    }

    return () => {
      removed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void appStateHandle?.remove();
    };
  }, [liveSyncEnabled]);

  // Server time arrives after the player is often already ready. When it
  // shows the device clock to be off by more than the tolerance, the position
  // derived from that clock is off by the same amount — re-derive it.
  useEffect(() => {
    const previous = liveClockOffsetRef.current;
    liveClockOffsetRef.current = liveClockOffsetMs;
    if (!liveSyncEnabled) return;
    if (Math.abs(liveClockOffsetMs - previous) / 1000 <= LIVE_SYNC_TOLERANCE_SECONDS) return;
    liveSyncPendingRef.current = true;
    void liveSyncRef.current?.("clock", {
      resume: !allowPlayPause || isPlayedRef.current,
    });
  }, [liveClockOffsetMs, liveSyncEnabled]);

  const toggleFullscreen = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation();

    if (!playerContainerRef.current) {
      console.error("Player container not available");
      return;
    }

    try {
      const elem = playerContainerRef.current as any;
      const canNativeFullscreen =
        typeof document.fullscreenEnabled !== "undefined" &&
        document.fullscreenEnabled &&
        elem &&
        typeof elem.requestFullscreen === "function";

      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
        setShowFullscreenControls(false);
        return;
      }

      if (isPseudoFullscreen) {
        // Exit pseudo fullscreen
        setIsPseudoFullscreen(false);
        setShowFullscreenControls(false);
        return;
      }

      // Check for iOS
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      if (canNativeFullscreen && !isIOS) {
        await elem.requestFullscreen();
        setIsFullscreen(true);
        setShowFullscreenControls(true);
      } else {
        // Fallback to pseudo fullscreen for iOS Chrome/WebView/Safari
        setIsPseudoFullscreen(true);
        setShowFullscreenControls(true);
      }

      // Hide controls after 3 seconds
      if (fullscreenControlsTimeoutRef.current) {
        clearTimeout(fullscreenControlsTimeoutRef.current);
      }

      fullscreenControlsTimeoutRef.current = setTimeout(() => {
        setShowFullscreenControls(false);
      }, 3000);
    } catch (error) {
      console.error("Error toggling fullscreen:", error);
      // As a last resort, toggle pseudo-fullscreen
      setIsPseudoFullscreen((prev) => !prev);
      setShowFullscreenControls(true);
    }
  }, [isPseudoFullscreen]);

  // Function to change playback speed
  const changePlaybackSpeed = useCallback(
    (speed: number) => {
      // Block speed changes if rewind is not allowed
      if (!allowRewind) {
        return;
      }

      if (player && playerReady) {
        try {
          player.setPlaybackRate(speed);
          setPlaybackSpeed(speed);
          setShowSpeedOptions(false);
        } catch (error) {
          console.error("Error changing playback speed:", error);
        }
      }
    },
    [player, playerReady, allowRewind]
  );

  // Handle volume change
  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVolume = parseInt(e.target.value, 10);
      setVolume(newVolume);
      if (player) {
        try {
          player.setVolume(newVolume);
        } catch (err) {
          console.error("Error setting volume", err);
        }
      }
    },
    [player]
  );

  // Toggle speed options dropdown
  const toggleSpeedOptions = useCallback(() => {
    // Only allow toggling if rewind is allowed
    if (!allowRewind) {
      return;
    }
    setShowSpeedOptions((prev) => !prev);
  }, [allowRewind]);

  // Go to live timestamp (for live streams)
  const goToLive = useCallback(async () => {
    if (!player || !playerReady || !isLiveStream || liveTimestamp <= 0) return;

    const success = await safePlayerOperation(
      () => player.seekTo(liveTimestamp, true),
      "goToLive"
    );

    if (success) {
      setCurrentTime(liveTimestamp);
      setIsBehindLive(false);
    }
  }, [player, playerReady, isLiveStream, liveTimestamp]);

  // Close speed options when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showSpeedOptions && !target.closest(".speed-control-container") && !target.closest(".speed-dropdown")) {
        setShowSpeedOptions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showSpeedOptions]);

  // Handle double-click to seek
  const handleDoubleClick = useCallback(
    async (event: React.MouseEvent<HTMLDivElement>) => {
      if (!player || !playerReady) return;

      // Block double-click seeking if rewind is not allowed
      if (!allowRewind) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const isRightSide = clickX > rect.width / 2;

      try {
        const currentTime = await safeGetNumber(player.getCurrentTime());
        const duration = await safeGetNumber(player.getDuration());

        let newTime: number;
        if (isRightSide) {
          // Forward 10 seconds
          newTime = Math.min(currentTime + 10, duration);
          setShowSeekAnimation({ side: "right", show: true });
        } else {
          // Backward 10 seconds
          newTime = Math.max(currentTime - 10, 0);
          setShowSeekAnimation({ side: "left", show: true });
        }

        // Check if navigation is allowed (only for forward seeks)
        if (isRightSide && !canNavigateToTime(newTime)) {
          setShowSeekAnimation({ side: "right", show: false });
          return;
        }

        const success = await safePlayerOperation(
          () => player.seekTo(newTime, true),
          "handleDoubleClick"
        );

        if (success) {
          setCurrentTime(newTime);
        }

        // Hide animation after 1 second
        setTimeout(() => {
          setShowSeekAnimation({
            side: isRightSide ? "right" : "left",
            show: false,
          });
        }, 1000);
      } catch (error) {
        console.error("Error seeking on double click:", error);
      }
    },
    [player, playerReady, canNavigateToTime, allowRewind]
  );

  // Toggle play / pause on SINGLE click anywhere on the video (but ignore clicks on inner controls)
  const handleSingleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Prevent toggle if the click originated from a descendant element (e.g.
      // the control buttons). We only want pure clicks on the video surface.
      if (event.target !== event.currentTarget) return;

      if (!player || !playerReady) return;

      // When pause control is disabled, allow only Play via single click
      if (!allowPlayPause) {
        if (!isPlayed) {
          togglePlay();
        }
        return; // Ignore pause when already playing
      }

      if (isPlayed) {
        togglePause();
      } else {
        togglePlay();
      }
    },
    [player, playerReady, isPlayed, togglePause, togglePlay, allowPlayPause]
  );

  // Handle mouse movement to show/hide controls
  const handleMouseMoveOnVideo = useCallback(() => {
    if (isFullscreen || isPseudoFullscreen) {
      // Handle fullscreen controls

      setShowFullscreenControls(true);

      // Clear existing fullscreen timeout
      if (fullscreenControlsTimeoutRef.current) {
        clearTimeout(fullscreenControlsTimeoutRef.current);
      }

      // Set timeout to hide fullscreen controls after 3 seconds of inactivity
      fullscreenControlsTimeoutRef.current = setTimeout(() => {
        if (!showSpeedOptions) {
          // Don't hide if speed menu is open
          setShowFullscreenControls(false);
        }
      }, 3000);
    } else {
      // Handle regular controls
      setShowControls(true);

      // Clear existing timeout
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }

      // Set timeout to hide controls after 3 seconds of inactivity
      controlsTimeoutRef.current = setTimeout(() => {
        if (!showSpeedOptions) {
          // Don't hide if speed menu is open
          setShowControls(false);
        }
      }, 3000);
    }
  }, [isFullscreen, isPseudoFullscreen, showSpeedOptions]);

  // Show controls when speed menu opens
  useEffect(() => {
    if (showSpeedOptions) {
      setShowControls(true);
      setShowFullscreenControls(true);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      if (fullscreenControlsTimeoutRef.current) {
        clearTimeout(fullscreenControlsTimeoutRef.current);
      }
    }
  }, [showSpeedOptions]);

  // Handle progress bar click for seeking
  const handleProgressBarClick = async (
    e: React.MouseEvent<HTMLDivElement>
  ) => {
    if (!player || !playerReady || duration <= 0) return;

    // Block seeking if rewind is not allowed
    if (!allowRewind) {
      return;
    }

    const progressBar = e.currentTarget;
    const rect = progressBar.getBoundingClientRect();
    const clickPosition = (e.clientX - rect.left) / rect.width;
    const seekTime = clickPosition * duration;

    // Check if navigation is allowed
    if (!canNavigateToTime(seekTime)) {
      return;
    }

    const success = await safePlayerOperation(
      () => player.seekTo(seekTime, true),
      "handleProgressBarClick"
    );

    if (success) {
      setCurrentTime(seekTime);
    }
  };

  // While a live class is held there is nothing a Play button could honestly
  // do. The player says so across its whole surface rather than in a badge
  // tucked into the control bar: on a phone the bar only appears on a tap, so
  // a frozen last frame — or the thumbnail, for a learner arriving after the
  // end — read as a hung video. The overlay is informative only
  // (pointer-events-none): taps still reach the surface below, and the control
  // bar (fullscreen, exit) sits above it.
  const liveHold =
    livePhase === "ended"
      ? {
          Icon: CheckCircle,
          title: t("youtubePlayer.live.ended"),
          hint: t("youtubePlayer.live.endedHint"),
        }
      : livePhase === "not-started"
        ? {
            Icon: Clock,
            title: t("youtubePlayer.live.notStarted"),
            hint: t("youtubePlayer.live.notStartedHint"),
          }
        : null;
  const liveHoldOverlay = liveHold ? (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center gap-stack bg-black/90 p-6 text-center text-white"
    >
      <liveHold.Icon size={48} weight="fill" className="text-white/80" />
      <span className="text-lg font-semibold">{liveHold.title}</span>
      <span className="text-sm text-white/70">{liveHold.hint}</span>
    </div>
  ) : null;

  return (
    <div className="w-full max-w-vw-100 overflow-x-hidden flex flex-col items-center gap-4">
      {/* Non-fullscreen verification overlay - shown outside the player */}
      {showFullscreenControls && isFullscreen && (
        <>
          {/* Moved UI logic to non-fullscreen check or handling in full screen, 
                for now applying the same overlay style to the non-fullscreen block 
                or just replacing the existing one 
            */}
        </>
      )}

      {showVerification && !isFullscreen && (
        <div className="absolute inset-0 z-50 flex items-end justify-center pb-8 pointer-events-none">
          {/* Focus Mode Backdrop - localized to player area if possible, but here it's page-level or container-level. 
               Since this is outside the player container, "absolute inset-0" refers to the parent div which is the page wrapper.
               We want a fixed overlay for focus.
           */}
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-in fade-in duration-500 pointer-events-auto" />

          <div className="relative z-50 animate-in slide-in-from-bottom-10 fade-in duration-500 w-full max-w-lg px-6 pointer-events-auto">
            <div className="bg-zinc-950 border border-zinc-800 text-white rounded-2xl shadow-2xl overflow-hidden relative">
              {/* Progress Bar Background */}
              <div className="absolute bottom-0 start-0 h-1 bg-zinc-800 w-full">
                <div
                  className="h-full bg-emerald-500 transition-all duration-1000 ease-linear"
                  style={{ width: `${(verificationCountdown / 59) * 100}%` }}
                />
              </div>

              <div className="p-5 flex flex-col sm:flex-row items-center gap-section">
                <div className="flex-1 text-center sm:text-start space-y-2">
                  <div className="flex items-center justify-center sm:justify-start gap-2.5">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                    </span>
                    <h4 className="text-base font-bold text-white tracking-tight">{t("youtubePlayer.verification.title")}</h4>
                  </div>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    <Trans
                      i18nKey="youtubePlayer.verification.prompt"
                      t={t}
                      values={{ number: verificationNumbers[1] }}
                      components={{
                        num: (
                          <span className="inline-block px-2 py-0.5 mx-1 bg-zinc-900 border border-zinc-700 rounded text-emerald-400 font-mono font-bold text-base shadow-inner md:align-middle" />
                        ),
                      }}
                    />
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {verificationNumbers.map((number, index) => (
                    <button
                      key={index}
                      onClick={() => handleVerificationClick(index)}
                      className="w-12 h-12 flex items-center justify-center rounded-xl text-base font-bold bg-zinc-900 text-zinc-300 border border-zinc-800 hover:bg-emerald-500/10 hover:text-emerald-400 hover:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all duration-200 active:scale-95 shadow-lg group relative overflow-hidden"
                    >
                      <span className="relative z-10">{number}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="text-center mt-3">
              <span className="text-xs font-medium text-zinc-500 bg-black/40 px-3 py-1 rounded-full border border-white/5 backdrop-blur-md">
                {t("youtubePlayer.verification.closingIn", { seconds: verificationCountdown })}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Video player container with verification overlay */}
      <div
        ref={playerContainerRef}
        className={`aspect-video w-full max-w-vw-100 relative min-h-reg-200 sm:min-h-reg-250 md:min-h-reg-300 lg:h-full items-center flex justify-center overflow-hidden bg-black rounded-lg group ${isPseudoFullscreen
            ? "!fixed !inset-0 !top-0 !start-0 !end-0 !bottom-0 !z-50 !rounded-none !overflow-hidden !w-vw-100 !h-screen !max-w-none !max-h-none !bg-black"
            : ""
          }`}
        onMouseMove={handleMouseMoveOnVideo}
        onMouseEnter={handleMouseMoveOnVideo}
        onDoubleClick={handleDoubleClick}
        onClick={handleSingleClick}
        onContextMenu={(e) => {
          if (protectionEnabled) e.preventDefault();
        }}
      >
        {/* Verification overlay - only shown in fullscreen */}
        {/* Verification overlay - Fullscreen */}
        {showVerification && (isFullscreen || isPseudoFullscreen) && enableConcentrationScore && (
          <div className="absolute inset-0 z-50 flex items-end justify-center pb-24 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="relative animate-in slide-in-from-bottom-10 fade-in duration-500 w-full max-w-lg px-6">
              <div className="bg-zinc-950 border border-zinc-800 text-white rounded-2xl shadow-2xl overflow-hidden relative">
                {/* Progress Bar Background */}
                <div className="absolute bottom-0 start-0 h-1 bg-zinc-800 w-full">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-1000 ease-linear"
                    style={{ width: `${(verificationCountdown / 59) * 100}%` }}
                  />
                </div>

                <div className="p-5 flex flex-col sm:flex-row items-center gap-section">
                  <div className="flex-1 text-center sm:text-start space-y-2">
                    <div className="flex items-center justify-center sm:justify-start gap-2.5">
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                      </span>
                      <h4 className="text-base font-bold text-white tracking-tight">{t("youtubePlayer.verification.title")}</h4>
                    </div>
                    <p className="text-sm text-zinc-400 leading-relaxed">
                      <Trans
                        i18nKey="youtubePlayer.verification.prompt"
                        t={t}
                        values={{ number: verificationNumbers[1] }}
                        components={{
                          num: (
                            <span className="inline-block px-2 py-0.5 mx-1 bg-zinc-900 border border-zinc-700 rounded text-emerald-400 font-mono font-bold text-base shadow-inner md:align-middle" />
                          ),
                        }}
                      />
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {verificationNumbers.map((number, index) => (
                      <button
                        key={index}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleVerificationClick(index);
                        }}
                        className="w-12 h-12 flex items-center justify-center rounded-xl text-base font-bold bg-zinc-900 text-zinc-300 border border-zinc-800 hover:bg-emerald-500/10 hover:text-emerald-400 hover:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all duration-200 active:scale-95 shadow-lg group relative overflow-hidden"
                      >
                        <span className="relative z-10">{number}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="text-center mt-3">
                <span className="text-xs font-medium text-zinc-500 bg-black/40 px-3 py-1 rounded-full border border-white/5 backdrop-blur-md">
                  {t("youtubePlayer.verification.closingIn", { seconds: verificationCountdown })}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Invisible fullscreen mouse capture overlay */}
        {(isFullscreen || isPseudoFullscreen) && (
          <div
            className="absolute inset-0 z-40 pointer-events-auto"
            onMouseMove={handleMouseMoveOnVideo}
            onMouseEnter={handleMouseMoveOnVideo}
          />
        )}

        {/* Fullscreen controls overlay */}
        {(isFullscreen || isPseudoFullscreen) && showFullscreenControls && (
          <div className="absolute inset-0 z-50 flex flex-col justify-between animate-in fade-in duration-200 pointer-events-none">
            {/* Top controls - Exit fullscreen */}
            <div className="flex justify-end p-4 pointer-events-auto z-60">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleFullscreen(e);
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleFullscreen(e as any);
                }}
                className="p-3 rounded-full bg-black/60 text-white hover:bg-black/80 transition-all active:scale-95 shadow-lg backdrop-blur-sm border border-white/10"
                aria-label={t("youtubePlayer.controls.exitFullscreen")}
              >
                <X size={24} weight="bold" />
              </button>
            </div>

            {/* Bottom controls - Complete controls like non-fullscreen */}
            <div className="p-4 pointer-events-auto">
              {/* Professional Video Controls Overlay */}
              <div className="flex items-center justify-between mb-4">
                {/* Left Controls */}
                <div className="flex items-center gap-3">
                  {/* Play/Pause */}
                  {isPlayed ? (
                    allowPlayPause ? (
                      <button
                        onClick={togglePause}
                        className="p-2 rounded-full text-white transition-all backdrop-blur-sm bg-white/20 hover:bg-white/30"
                      >
                        <Pause size={20} weight="fill" />
                      </button>
                    ) : null
                  ) : liveHold ? null : (
                    <button
                      onClick={togglePlay}
                      className="p-2 rounded-full text-white transition-all backdrop-blur-sm bg-white/20 hover:bg-white/30"
                    >
                      <Play size={20} weight="fill" />
                    </button>
                  )}

                  {/* Rewind */}
                  <button
                    onClick={async () => {
                      if (!allowRewind) return;
                      if (player) {
                        const currentTime = await safeGetNumber(
                          player.getCurrentTime()
                        );
                        const newTime = Math.max(currentTime - 10, 0);
                        const success = await safePlayerOperation(
                          () => player.seekTo(newTime, true),
                          "fullscreenRewind"
                        );
                        if (success) {
                          setCurrentTime(newTime);
                        }
                      }
                    }}
                    disabled={!allowRewind}
                    className={`p-2 rounded-full text-white backdrop-blur-sm ${allowRewind
                        ? "bg-white/20 hover:bg-white/30 transition-all hover:scale-105"
                        : "bg-white/10 opacity-50 cursor-not-allowed"
                      }`}
                  >
                    <Rewind size={18} weight="fill" />
                  </button>
                </div>

                {/* Right Controls */}
                <div className="flex items-center gap-3">
                  {/* Go Live Button - Only show for live streams when behind */}
                  {isLiveStream && isBehindLive && (
                    <button
                      onClick={goToLive}
                      className="flex items-center gap-1 px-3 py-1 rounded-full bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-all hover:scale-105 backdrop-blur-sm animate-pulse"
                      title={t("youtubePlayer.controls.goToLive")}
                    >
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                      {t("youtubePlayer.controls.live")}
                    </button>
                  )}

                  {/* Volume Slider */}
                  <div className="flex items-center gap-1">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={volume}
                      onChange={handleVolumeChange}
                      className="h-1 w-24 cursor-pointer accent-primary-500"
                    />
                  </div>

                  {/* Playback Speed Control */}
                  <div className="relative speed-control-container">
                    <button
                      onClick={toggleSpeedOptions}
                      className={`relative p-2 rounded-full text-white transition-all backdrop-blur-sm ${allowRewind && playerReady
                          ? "bg-white/20 hover:bg-white/30 hover:scale-105"
                          : "bg-white/10 opacity-50 cursor-not-allowed"
                        }`}
                      disabled={!playerReady || !allowRewind}
                    >
                      <Gauge size={18} weight="fill" />
                      {playbackSpeed !== 1 && (
                        <span className="absolute -top-1 -end-1 bg-primary-500 text-white text-xs rounded-full min-w-5 h-5 flex items-center justify-center font-bold px-1 shadow-md border-2 border-white">
                          {playbackSpeed}x
                        </span>
                      )}
                    </button>

                    {/* Speed Options Dropdown - Inline in fullscreen controls */}
                    {showSpeedOptions && allowRewind && (
                      <div className="speed-dropdown absolute bottom-full end-0 mb-2 bg-black/90 backdrop-blur-sm rounded-lg shadow-lg border border-white/20 z-20 min-w-20 max-h-reg-250 overflow-y-auto">
                        <div className="px-3 py-1 text-xs font-medium text-white/70 border-b border-white/20 sticky top-0 bg-black/90">
                          {t("youtubePlayer.controls.speed")}
                        </div>
                        <div className="py-2">
                          {speedOptions.map((speed) => (
                            <button
                              key={speed}
                              onClick={() => changePlaybackSpeed(speed)}
                              className={`w-full px-3 py-2 text-sm text-start hover:bg-white/20 transition-colors ${playbackSpeed === speed
                                  ? "text-primary-400 bg-white/10 font-medium"
                                  : "text-white"
                                }`}
                            >
                              {speed}x
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Exit Fullscreen (alternative position) */}
                  <button
                    onClick={toggleFullscreen}
                    className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition-all hover:scale-105 backdrop-blur-sm relative z-60"
                  >
                    <X size={18} weight="fill" />
                  </button>
                </div>
              </div>

              {/* Progress Bar */}
              {allowPlayPause && (
                <div className="relative w-full">
                  <div
                    className={`w-full h-1 bg-white/30 rounded-full group ${allowRewind ? "cursor-pointer" : "cursor-not-allowed"
                      }`}
                    onClick={handleProgressBarClick}
                  >
                    <div
                      className="h-full bg-white rounded-full transition-all duration-150 group-hover:h-1.5"
                      style={{
                        width: `${duration > 0 ? (currentTime / duration) * 100 : 0
                          }%`,
                      }}
                    ></div>
                  </div>

                  {/* Question Markers */}
                  {timeToQuestionMap.map(({ time, question }, index) => {
                    const position =
                      duration > 0 ? (time / 1000 / duration) * 100 : 0;
                    const isAnswered = answeredQuestions[question.id]?.answered;
                    const canSkip = question.can_skip;

                    return (
                      <button
                        key={question.id}
                        className={`absolute w-3 h-3 rounded-full transform -translate-x-1/2 -translate-y-1 top-0 border-2 border-white shadow-lg transition-all z-10 ${isAnswered
                            ? "bg-green-500"
                            : canSkip
                              ? "bg-yellow-500"
                              : "bg-red-500"
                          } ${allowRewind
                            ? "hover:scale-125 cursor-pointer hover:bg-green-600"
                            : "cursor-not-allowed opacity-75"
                          }`}
                        style={{
                          left: `${Math.max(1.5, Math.min(98.5, position))}%`,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (allowRewind) {
                            handleQuestionMarkerClick(question);
                          }
                        }}
                        disabled={!allowRewind}
                        title={`${t("youtubePlayer.questionMarker.title", { index: index + 1 })}${isAnswered
                            ? t("youtubePlayer.questionMarker.answered")
                            : canSkip
                              ? t("youtubePlayer.questionMarker.skippable")
                              : t("youtubePlayer.questionMarker.required")
                          }${!allowRewind ? t("youtubePlayer.questionMarker.navigationDisabled") : ""}`}
                      >
                        {isAnswered ? (
                          <span className="text-white text-xs font-bold flex items-center justify-center w-full h-full">
                            ✓
                          </span>
                        ) : (
                          <span className="text-white text-xs font-bold flex items-center justify-center w-full h-full">
                            ?
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Time Display */}
              {allowPlayPause && (
                <div className="flex justify-between text-white text-xs mt-2 font-medium">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Seek animation overlays */}
        {showSeekAnimation.show && (
          <div
            className={`absolute inset-0 flex items-center justify-center pointer-events-none z-50`}
          >
            <div
              className={`flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded-lg px-4 py-2 text-white animate-in fade-in zoom-in duration-300 ${showSeekAnimation.side === "right"
                  ? "flex-row"
                  : "flex-row-reverse"
                }`}
            >
              <div className="flex gap-1">
                {[...Array(showSeekAnimation.side === "right" ? 2 : 2)].map(
                  (_, i) => (
                    <FastForward
                      key={i}
                      size={20}
                      weight="fill"
                      className={
                        showSeekAnimation.side === "right" ? "" : "rotate-180"
                      }
                    />
                  )
                )}
              </div>
              <span className="text-sm font-medium">10s</span>
            </div>
          </div>
        )}

        {/* A held live class: before its scheduled start, or once its video has
            run out. Covers the frame so nothing looks frozen. */}
        {liveHoldOverlay}

        {/* Manual Play Button for iOS/browsers that block autoplay. Not while a
            live class is deliberately held — that is not a blocked autoplay. */}
        {showManualPlayButton && !allowPlayPause && !liveHold && (
          <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/30 backdrop-blur-sm animate-in fade-in duration-500">
            <button
              onClick={handleManualPlay}
              className="flex flex-col items-center gap-stack p-6 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 text-white shadow-2xl hover:scale-105 transition-all duration-300 hover:shadow-primary-500/50 active:scale-95"
              aria-label={t("youtubePlayer.manualPlay.ariaLabel")}
            >
              <div className="p-4 rounded-full bg-white/20 backdrop-blur-sm">
                <Play size={48} weight="fill" />
              </div>
              <span className="text-lg font-semibold">{t("youtubePlayer.manualPlay.tapToStart")}</span>
              <span className="text-sm text-white/80">
                {t("youtubePlayer.manualPlay.autoplayHint")}
              </span>
            </button>
          </div>
        )}

        {/* Bottom Controls Overlay (always visible when not fullscreen) */}
        {!(isFullscreen || isPseudoFullscreen) && (
          <div
            className={`absolute bottom-0 start-0 end-0 z-50 transition-all duration-300 ${showControls
                ? "opacity-100 translate-y-0"
                : "opacity-0 translate-y-2"
              }`}
          >
            <div className="bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pt-8">
              {/* Professional Video Controls Overlay */}
              <div className="flex items-center justify-between mb-4">
                {/* Left Controls */}
                <div className="flex items-center gap-3">
                  {/* Play/Pause */}
                  {isPlayed ? (
                    allowPlayPause ? (
                      <button
                        onClick={togglePause}
                        className="p-2 rounded-full text-white transition-all backdrop-blur-sm bg-white/20 hover:bg-white/30"
                      >
                        <Pause size={20} weight="fill" />
                      </button>
                    ) : null
                  ) : liveHold ? null : (
                    <button
                      onClick={togglePlay}
                      className="p-2 rounded-full text-white transition-all backdrop-blur-sm bg-white/20 hover:bg-white/30"
                    >
                      <Play size={20} weight="fill" />
                    </button>
                  )}

                  {/* Rewind */}
                  <button
                    onClick={async () => {
                      if (!allowRewind) return;
                      if (player) {
                        const currentTime = await safeGetNumber(
                          player.getCurrentTime()
                        );
                        const newTime = Math.max(currentTime - 10, 0);
                        const success = await safePlayerOperation(
                          () => player.seekTo(newTime, true),
                          "controlsRewind"
                        );
                        if (success) {
                          setCurrentTime(newTime);
                        }
                      }
                    }}
                    disabled={!allowRewind}
                    className={`p-2 rounded-full text-white backdrop-blur-sm ${allowRewind
                        ? "bg-white/20 hover:bg-white/30 transition-all hover:scale-105"
                        : "bg-white/10 opacity-50 cursor-not-allowed"
                      }`}
                  >
                    <Rewind size={18} weight="fill" />
                  </button>
                </div>

                {/* Right Controls */}
                <div className="flex items-center gap-3">
                  {/* Go Live Button - Only show for live streams when behind */}
                  {isLiveStream && isBehindLive && (
                    <button
                      onClick={goToLive}
                      className="flex items-center gap-1 px-3 py-1 rounded-full bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-all hover:scale-105 backdrop-blur-sm animate-pulse"
                      title={t("youtubePlayer.controls.goToLive")}
                    >
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                      {t("youtubePlayer.controls.live")}
                    </button>
                  )}

                  {/* Volume Slider */}
                  <div className="flex items-center gap-1">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={volume}
                      onChange={handleVolumeChange}
                      className="h-1 w-24 cursor-pointer accent-primary-500"
                    />
                  </div>

                  {/* Playback Speed Control */}
                  <div className="relative speed-control-container">
                    <button
                      ref={speedButtonRef}
                      onClick={toggleSpeedOptions}
                      className={`relative p-2 rounded-full text-white transition-all backdrop-blur-sm ${allowRewind && playerReady
                          ? "bg-white/20 hover:bg-white/30 hover:scale-105"
                          : "bg-white/10 opacity-50 cursor-not-allowed"
                        }`}
                      disabled={!playerReady || !allowRewind}
                    >
                      <Gauge size={18} weight="fill" />
                      {playbackSpeed !== 1 && (
                        <span className="absolute -top-1 -end-1 bg-primary-500 text-white text-xs rounded-full min-w-5 h-5 flex items-center justify-center font-bold px-1 shadow-md border-2 border-white">
                          {playbackSpeed}x
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Fullscreen */}
                  <button
                    onClick={toggleFullscreen}
                    className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition-all hover:scale-105 backdrop-blur-sm"
                    disabled={!playerContainerRef.current}
                  >
                    <ArrowsOut size={18} weight="fill" />
                  </button>
                </div>
              </div>

              {/* Progress Bar */}
              {allowPlayPause && (
                <div className="relative w-full">
                  <div
                    className={`w-full h-1 bg-white/30 rounded-full group ${allowRewind ? "cursor-pointer" : "cursor-not-allowed"
                      }`}
                    onClick={handleProgressBarClick}
                  >
                    <div
                      className="h-full bg-white rounded-full transition-all duration-150 group-hover:h-1.5"
                      style={{
                        width: `${duration > 0 ? (currentTime / duration) * 100 : 0
                          }%`,
                      }}
                    ></div>
                  </div>

                  {/* Question Markers */}
                  {timeToQuestionMap.map(({ time, question }, index) => {
                    const position =
                      duration > 0 ? (time / 1000 / duration) * 100 : 0;
                    const isAnswered = answeredQuestions[question.id]?.answered;
                    const canSkip = question.can_skip;

                    return (
                      <button
                        key={question.id}
                        className={`absolute w-3 h-3 rounded-full transform -translate-x-1/2 -translate-y-1 top-0 border-2 border-white shadow-lg transition-all z-10 ${isAnswered
                            ? "bg-green-500"
                            : canSkip
                              ? "bg-yellow-500"
                              : "bg-red-500"
                          } ${allowRewind
                            ? "hover:scale-125 cursor-pointer hover:bg-green-600"
                            : "cursor-not-allowed opacity-75"
                          }`}
                        style={{
                          left: `${Math.max(1.5, Math.min(98.5, position))}%`,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (allowRewind) {
                            handleQuestionMarkerClick(question);
                          }
                        }}
                        disabled={!allowRewind}
                        title={`${t("youtubePlayer.questionMarker.title", { index: index + 1 })}${isAnswered
                            ? t("youtubePlayer.questionMarker.answered")
                            : canSkip
                              ? t("youtubePlayer.questionMarker.skippable")
                              : t("youtubePlayer.questionMarker.required")
                          }${!allowRewind ? t("youtubePlayer.questionMarker.navigationDisabled") : ""}`}
                      >
                        {isAnswered ? (
                          <span className="text-white text-xs font-bold flex items-center justify-center w-full h-full">
                            ✓
                          </span>
                        ) : (
                          <span className="text-white text-xs font-bold flex items-center justify-center w-full h-full">
                            ?
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Time Display */}
              {allowPlayPause && (
                <div className="flex justify-between text-white text-xs mt-2 font-medium">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* YouTube player */}
        <div className="w-full h-full max-w-vw-100 overflow-hidden pointer-events-none">
          <YouTube
            videoId={videoId}
            opts={opts}
            onReady={onPlayerReady}
            className="h-full w-full"
            onStateChange={onStateChange}
          />
        </div>

        {/* Question Overlay */}
        {showQuestion && (
          <VideoQuestionOverlay
            question={currentQuestion}
            onSubmit={handleQuestionSubmit}
            onClose={handleQuestionClose}
            onPause={forcePause}
            previousAnswer={
              currentQuestion
                ? answeredQuestions[currentQuestion.id]?.selectedOptions
                : undefined
            }
          />
        )}
        {/* Bottom gradient overlay in fullscreen */}
        {(isFullscreen || isPseudoFullscreen) && (
          <div className="absolute bottom-0 start-0 end-0 h-32 bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none rounded-b-lg z-40" />
        )}
      </div>

      {/* Speed Options Dropdown - Non-fullscreen - Rendered outside video container with fixed positioning */}
      {showSpeedOptions && allowRewind && !isFullscreen && !isPseudoFullscreen && speedButtonRef.current && (
        <div
          className="speed-dropdown fixed bg-black/90 backdrop-blur-sm rounded-lg shadow-lg border border-white/20 z-50 min-w-20 max-h-reg-250 overflow-y-auto"
          style={{
            bottom: `${window.innerHeight - speedButtonRef.current.getBoundingClientRect().top + 8}px`,
            right: `${window.innerWidth - speedButtonRef.current.getBoundingClientRect().right}px`,
          }}
        >
          <div className="px-3 py-1 text-xs font-medium text-white/70 border-b border-white/20 sticky top-0 bg-black/90">
            {t("youtubePlayer.controls.speed")}
          </div>
          <div className="py-2">
            {speedOptions.map((speed) => (
              <button
                key={speed}
                onClick={() => changePlaybackSpeed(speed)}
                className={`w-full px-3 py-2 text-sm text-start hover:bg-white/20 transition-colors ${playbackSpeed === speed
                    ? "text-primary-400 bg-white/10 font-medium"
                    : "text-white"
                  }`}
              >
                {speed}x
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

interface YouTubePlayerWrapperProps {
  videoId: string;
  onTimeUpdate?: (currentTime: number) => void;
  questions?: Array<{
    id: string;
    question_time_in_millis: number;
    text_data: {
      content: string;
    };
    parent_rich_text?: {
      content: string;
    };
    options: Array<{
      id: string;
      text: {
        content: string;
      };
    }>;
    can_skip?: boolean;
    question_type?: string;
    auto_evaluation_json?: string;
  }>;
  ms?: number;
  allowPlayPause?: boolean;
  allowRewind?: boolean;
  isLiveStream?: boolean;
  liveTimestamp?: number;
  liveClassStartTime?: string;
  liveClockOffsetMs?: number;
  enableConcentrationScore?: boolean;
  concentrationSettings?: ConcentrationSettings;
}

// This is a wrapper component that exposes the YouTube player methods
const YouTubePlayerWrapper = forwardRef<any, YouTubePlayerWrapperProps>(
  (
    {
      videoId,
      onTimeUpdate,
      questions,
      ms,
      allowPlayPause,
      allowRewind,
      isLiveStream,
      liveTimestamp,
      liveClassStartTime,
      liveClockOffsetMs,
      enableConcentrationScore,
      concentrationSettings,
    },
    ref
  ) => {
    const playerRef = useRef<any>(null);
    // Expose methods to parent component
    useImperativeHandle(ref, () => ({
      playVideo: () => {
        if (playerRef.current) {
          playerRef.current.playVideo();
        }
      },
      pauseVideo: () => {
        if (playerRef.current) {
          playerRef.current.pauseVideo();
        }
      },
      getCurrentTime: () => {
        if (playerRef.current) {
          return playerRef.current.getCurrentTime();
        }
        return 0;
      },
      getDuration: () => {
        if (playerRef.current) {
          return playerRef.current.getDuration();
        }
        return 0;
      },
      seekTo: (seconds: number, allowSeekAhead: boolean) => {
        if (playerRef.current) {
          playerRef.current.seekTo(seconds, allowSeekAhead);
        }
      },
    }));

    // Handle time updates to check for questions
    const handleTimeUpdate = (currentTime: number) => {
      if (onTimeUpdate) {
        onTimeUpdate(currentTime);
      }
    };
    return (
      <YouTubePlayerComp
        videoId={videoId}
        onTimeUpdate={handleTimeUpdate}
        questions={questions}
        ms={ms}
        allowPlayPause={allowPlayPause}
        allowRewind={allowRewind}
        isLiveStream={isLiveStream}
        liveTimestamp={liveTimestamp}
        liveClassStartTime={liveClassStartTime}
        liveClockOffsetMs={liveClockOffsetMs}
        enableConcentrationScore={enableConcentrationScore}
        concentrationSettings={concentrationSettings}
      />
    );
  }
);

YouTubePlayerWrapper.displayName = "YouTubePlayerWrapper";

export default YouTubePlayerWrapper;
