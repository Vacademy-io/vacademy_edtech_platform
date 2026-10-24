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
import { useTranslation } from "react-i18next";
import { useTrackingStore } from "@/stores/study-library/youtube-video-tracking-store";
import { getEpochTimeInMillis } from "./utils";
import { formatVideoTime } from "@/utils/study-library/tracking/formatVideoTime";
import { calculateNetDuration } from "@/utils/study-library/tracking/calculateNetDuration";
import { useVideoSync } from "@/hooks/study-library/useVideoSync";
import Player from "@vimeo/player";
import {
  ArrowsOut,
  FastForward,
  Pause,
  Play,
  Rewind,
  Gauge,
  WarningCircle,
} from "@phosphor-icons/react";
import { Preferences } from "@capacitor/preferences";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import VideoQuestionOverlay from "./video-question-overlay";
import { useMediaRefsStore } from "@/stores/mediaRefsStore";
import { ConcentrationSettings } from "@/types/student-display-settings";
import { DEFAULT_STUDENT_DISPLAY_SETTINGS } from "@/constants/display-settings/student-defaults";

interface VimeoPlayerProps {
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
  allowPlayPause?: boolean;
  allowRewind?: boolean;
  enableConcentrationScore?: boolean;
  concentrationSettings?: ConcentrationSettings;
}

export const formatTime = (timeInSeconds: number) => {
  const minutes = Math.floor(timeInSeconds / 60);
  const seconds = Math.floor(timeInSeconds % 60);
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
};

export const VimeoPlayerComp: React.FC<VimeoPlayerProps> = ({
  videoId,
  onTimeUpdate,
  ms = 0,
  questions = [],
  allowPlayPause = true,
  allowRewind = true,
  enableConcentrationScore = true,
  concentrationSettings,
}) => {
  const { t } = useTranslation("libraryCommonB");
  const { activeItem } = useContentStore();
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

  const [isPlayed, setIsPlayed] = useState(false);
  const [player, setPlayer] = useState<Player | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [duration, setDuration] = useState(0);

  const [currentTime, setCurrentTime] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const vimeoContainerRef = useRef<HTMLDivElement>(null);
  const concentrationScoreId = useRef(uuidv4());
  const [showFullscreenControls, setShowFullscreenControls] = useState(false);
  const fullscreenControlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false);

  // Playback speed state
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showSpeedOptions, setShowSpeedOptions] = useState(false);
  const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const speedButtonRef = useRef<HTMLButtonElement>(null);

  // Volume control state
  const [volume, setVolume] = useState(100);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Question state
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [showQuestion, setShowQuestion] = useState(false);
  // High-water mark (ms) of the furthest position already scanned for questions,
  // so faster playback or a forward jump can't leap over a question.
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
  const [lastVerificationTime, setLastVerificationTime] = useState(0);
  const verificationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const nextVerificationTimeRef = useRef<number>(0);

  // Settings defaults
  const settings = {
    enabled:
      concentrationSettings?.enabled ??
      enableConcentrationScore ??
      DEFAULT_STUDENT_DISPLAY_SETTINGS.concentration.enabled,
    min_minutes:
      concentrationSettings?.frequency.min_minutes ??
      DEFAULT_STUDENT_DISPLAY_SETTINGS.concentration.frequency.min_minutes,
    max_minutes:
      concentrationSettings?.frequency.max_minutes ??
      DEFAULT_STUDENT_DISPLAY_SETTINGS.concentration.frequency.max_minutes,
  };

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
    [],
  );
  const [concentrationScore, setConcentrationScore] = useState(100);

  const [wasPausedByTabSwitch, setWasPausedByTabSwitch] = useState(false);

  // Memoize questions
  const memoizedQuestions = useMemo(
    () => questions,
    [JSON.stringify(questions)],
  );

  const timeToQuestionMap = useMemo(() => {
    if (memoizedQuestions && memoizedQuestions.length > 0) {
      return memoizedQuestions.map((q) => ({
        time: q.question_time_in_millis,
        question: q,
      }));
    }
    return [];
  }, [memoizedQuestions]);

  const setCurrentYoutubeTime = useMediaRefsStore(
    (state) => state.setCurrentYoutubeTime,
  );
  const setCurrentYoutubeVideoLength = useMediaRefsStore(
    (state) => state.setCurrentYoutubeVideoLength,
  );

  useEffect(() => {
    setCurrentYoutubeTime(currentTime);
  }, [currentTime, setCurrentYoutubeTime]);

  useEffect(() => {
    setAnsweredQuestions({});
    lastQuestionCheckTimeRef.current = 0;
  }, [memoizedQuestions, videoId]);

  // Initialize Vimeo Player
  useEffect(() => {
    if (!vimeoContainerRef.current || !videoId) return;

    // Reset any prior error so re-mounting on a new/valid video starts clean
    setLoadError(false);

    // Clear existing content
    vimeoContainerRef.current.innerHTML = "";
    const div = document.createElement("div");
    // Fill the container so the embed uses the full black area — both for a
    // playing video and for Vimeo's own "video unavailable" page.
    div.style.width = "100%";
    div.style.height = "100%";
    vimeoContainerRef.current.appendChild(div);

    const vimeoPlayer = new Player(div, {
      id: parseInt(videoId, 10),
      autopause: false,
      // responsive:false on purpose — responsive mode wraps the iframe in an
      // aspect-ratio padding box that collapses to a thin strip when oembed
      // dimensions are unavailable (e.g. a deleted/private video). The
      // iframe is sized to fill via the `.vimeo-fill` CSS rule instead.
      responsive: false,
    });

    vimeoPlayer
      .ready()
      .then(() => {
        setPlayer(vimeoPlayer);
        setPlayerReady(true);

        vimeoPlayer.getDuration().then((dur: number) => {
          setDuration(dur);
          setCurrentYoutubeVideoLength(dur);
        });

        // Seek to saved progress
        if (ms && ms > 0) {
          const seekTimeSeconds = ms / 1000;
          vimeoPlayer.setCurrentTime(seekTimeSeconds).catch(() => {});
        }

        vimeoPlayer.setVolume(volume / 100);
      })
      .catch((err: unknown) => {
        // Video could not be loaded (deleted/private/restricted on Vimeo, or a
        // network failure). Surface an inline message instead of letting the
        // rejection escape as an unhandled error.
        console.warn("[VimeoPlayer] Failed to load video", videoId, err);
        setPlayerReady(false);
        setLoadError(true);
      });

    vimeoPlayer.on("play", () => {
      setIsPlayed(true);
    });

    vimeoPlayer.on("pause", () => {
      setIsPlayed(false);
    });

    vimeoPlayer.on("ended", () => {
      setIsPlayed(false);
      stopTimer();
      stopProgressTracking();
      endCurrentTimestamp();
      syncTrackingData();
    });

    vimeoPlayer.on("timeupdate", (data: { seconds: number }) => {
      setCurrentTime(data.seconds);
      if (onTimeUpdate) {
        onTimeUpdate(data.seconds);
      }
    });

    return () => {
      vimeoPlayer.destroy();
      setPlayer(null);
      setPlayerReady(false);
    };
  }, [videoId]);

  // Question checking
  const checkForQuestions = useCallback(() => {
    if (!timeToQuestionMap || timeToQuestionMap.length === 0 || !player) return;
    if (showQuestion) return;

    player.getCurrentTime().then((time: number) => {
      const currentTimeMs = time * 1000;
      const prevTimeMs = lastQuestionCheckTimeRef.current;

      // Advance the high-water mark; on a backward seek the crossing window is
      // empty so nothing fires until playback moves forward past it again.
      lastQuestionCheckTimeRef.current = currentTimeMs;
      if (currentTimeMs <= prevTimeMs) return;

      // Fire for any unanswered question crossed since the last check
      // (prevTimeMs, currentTimeMs], earliest first. Range-based detection means
      // fast playback or a forward jump can't skip over a question.
      const questionToShow = timeToQuestionMap
        .filter(({ time, question }) => {
          if (answeredQuestions && answeredQuestions[question.id]?.answered)
            return false;
          return time > prevTimeMs && time <= currentTimeMs;
        })
        .sort((a, b) => a.time - b.time)[0];

      if (questionToShow) {
        // Re-arm from this question's time so further questions skipped by the
        // same jump surface one-by-one on resume.
        lastQuestionCheckTimeRef.current = questionToShow.time;
        player.pause();
        setIsPlayed(false);
        stopProgressTracking();
        stopTimer();
        setCurrentQuestion(questionToShow.question);
        setShowQuestion(true);
      }
    });
  }, [timeToQuestionMap, showQuestion, answeredQuestions, player]);

  const handleQuestionSubmit = async (selectedOption: string | string[]) => {
    if (!currentQuestion) return { success: false };

    const isCorrect = true;

    setAnsweredQuestions((prev) => ({
      ...prev,
      [currentQuestion.id]: {
        answered: true,
        selectedOptions: selectedOption,
        isCorrect,
        timestamp: Date.now(),
      },
    }));

    return {
      success: true,
      isCorrect,
      explanation: "Great job! You've answered correctly.",
    };
  };

  const handleQuestionClose = () => {
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

    if (player) {
      player.play();
      setIsPlayed(true);
    }
  };

  // Load saved concentration metrics
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

    const baseScore = 100;
    const tabSwitchPenalty = tabSwitchCount * 10;
    const wrongAnswerPenalty = wrongAnswerCount * 5;
    const pauseCountPenalty = pauseCount * 5;
    const missedAnswerPenalty = missedAnswerCount * 20;

    let newScore =
      baseScore -
      tabSwitchPenalty -
      wrongAnswerPenalty -
      missedAnswerPenalty -
      pauseCountPenalty;
    newScore = Math.max(0, newScore);

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

  // Verification system
  const generateVerificationNumbers = useCallback(() => {
    const correctNum = Math.floor(Math.random() * 100);
    let num1 = correctNum;
    let num2 = correctNum;

    while (num1 === correctNum) {
      num1 = Math.floor(Math.random() * 100);
    }
    while (num2 === correctNum || num2 === num1) {
      num2 = Math.floor(Math.random() * 100);
    }

    setVerificationNumbers([num1, correctNum, num2]);
  }, []);

  const startVerificationTimer = useCallback(() => {
    if (verificationTimerRef.current) {
      clearInterval(verificationTimerRef.current);
    }

    setVerificationCountdown(59);

    verificationTimerRef.current = setInterval(() => {
      setVerificationCountdown((prev) => {
        if (prev <= 1) {
          if (player) {
            player.pause();
            setIsPlayed(false);
          }
          setMissedAnswerCount((prev) => prev + 1);
          if (verificationTimerRef.current) {
            clearInterval(verificationTimerRef.current);
            verificationTimerRef.current = null;
          }
          setShowVerification(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [player]);

  const handleVerificationClick = (index: number) => {
    if (verificationTimerRef.current) {
      clearInterval(verificationTimerRef.current);
      verificationTimerRef.current = null;
    }

    const responseTime = 59 - verificationCountdown;
    const newAnswerTimes = [...answerTimesInSeconds, responseTime];
    setAnswerTimesInSeconds(newAnswerTimes);

    if (index === 1) {
      const currentTimeInSeconds = Math.floor(Date.now() / 1000);
      setLastVerificationTime(currentTimeInSeconds);
      saveVerificationTime(currentTimeInSeconds);
      setShowVerification(false);
      scheduleNextVerification();
    } else {
      setWrongAnswerCount((prev) => prev + 1);
      if (player) {
        player.pause();
        setIsPlayed(false);
      }
      setShowVerification(false);
      nextVerificationTimeRef.current = 0;
    }
  };

  const scheduleNextVerification = useCallback(() => {
    if (!settings.enabled) return;

    const minSeconds = settings.min_minutes * 60;
    const maxSeconds = settings.max_minutes * 60;
    const randomSeconds =
      Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;

    nextVerificationTimeRef.current = elapsedTime + randomSeconds;
  }, [
    settings.enabled,
    settings.min_minutes,
    settings.max_minutes,
    elapsedTime,
  ]);

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

  const startProgressTracking = useCallback(() => {
    if (progressIntervalRef.current) return;
    progressIntervalRef.current = setInterval(() => {
      if (player) {
        player
          .getCurrentTime()
          .then((time: number) => {
            setCurrentTime(time);
            checkForQuestions();
            if (onTimeUpdate) {
              onTimeUpdate(time);
            }
          })
          .catch(() => {});
      }
    }, 250);
  }, [player, onTimeUpdate, checkForQuestions]);

  const stopProgressTracking = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  // Tab switch detection
  useEffect(() => {
    if (!enableConcentrationScore) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        setTabSwitchCount((prev) => prev + 1);
        if (player && isPlayed) {
          player.pause();
          setIsPlayed(false);
          setWasPausedByTabSwitch(true);
        }

        if (showVerification) {
          setShowVerification(false);
          if (verificationTimerRef.current) {
            clearInterval(verificationTimerRef.current);
            verificationTimerRef.current = null;
          }
        }
      } else {
        if (player && wasPausedByTabSwitch && !allowPlayPause) {
          setTimeout(() => {
            player.play();
            setIsPlayed(true);
            setWasPausedByTabSwitch(false);
          }, 500);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    player,
    showVerification,
    isPlayed,
    wasPausedByTabSwitch,
    allowPlayPause,
    enableConcentrationScore,
  ]);

  // Timestamp tracking functions
  const startNewTimestamp = useCallback(() => {
    const now = formatVideoTime(currentTime);
    currentStartTimeRef.current = now;
    currentStartTimeInEpochRef.current = getEpochTimeInMillis();
    timestampDurationRef.current = 0;
  }, [currentTime]);

  const endCurrentTimestamp = useCallback(() => {
    if (currentStartTimeRef.current) {
      const endTime = formatVideoTime(currentTime);
      const startSeconds = currentStartTimeRef.current
        .split(":")
        .reduce(
          (acc: number, val: string, i: number) =>
            acc + parseInt(val) * Math.pow(60, 1 - i),
          0,
        );

      // Drop zero-duration (or negative) timestamps — can happen when play() is
      // aborted before the video advances (PlayInterrupted race). The backend
      // rejects these as "Invalid activity duration".
      if (currentTime > startSeconds) {
        currentTimestamps.current.push({
          id: uuidv4(),
          start_time: currentStartTimeRef.current,
          end_time: endTime,
          start: startSeconds * 1000,
          end: currentTime * 1000,
        });
      }

      currentStartTimeRef.current = "";
    }
  }, [currentTime]);

  // Sync tracking data. useVideoSync returns a fresh closure on every render,
  // so keep the latest one in a ref and give callers a stable identity — an
  // effect that depends on this must not be torn down and rebuilt each render.
  // (The YouTube player gets this for free by holding its interval in a ref.)
  const syncFnRef = useRef(syncVideoTrackingData);
  syncFnRef.current = syncVideoTrackingData;
  const syncTrackingData = useCallback(() => {
    syncFnRef.current();
  }, []);

  // Handle play state changes for tracking
  useEffect(() => {
    if (isPlayed) {
      if (isFirstPlay) {
        videoStartTime.current = getEpochTimeInMillis();
        setIsFirstPlay(false);
        syncTrackingData();
      }
      startNewTimestamp();
      startTimer();
      startProgressTracking();
    } else {
      stopTimer();
      stopProgressTracking();
      endCurrentTimestamp();
      videoEndTime.current = getEpochTimeInMillis();
    }
  }, [isPlayed]);

  // Periodic sync — cadence = min(video duration, 60s). Short videos sync at
  // their own length so the worst-case unsynced window is bounded by the
  // video length, not by a fixed 60s.
  //
  // Every dependency here must be stable while playing. This player re-renders
  // ~4x a second (setCurrentTime from the 250ms progress poll, setElapsedTime
  // every 1s); anything that changes identity per render tears the interval
  // down before it can ever fire, which is how the whole periodic sync went
  // silently dead and left one POST per viewing session.
  useEffect(() => {
    if (!isPlayed) return;
    const periodMs = Math.max(
      1000,
      Math.min(
        Number.isFinite(duration) && duration > 0
          ? Math.round(duration * 1000)
          : 60000,
        60000,
      ),
    );
    const interval = setInterval(() => {
      syncTrackingData();
    }, periodMs);
    return () => clearInterval(interval);
  }, [isPlayed, syncTrackingData, duration]);

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
    enableConcentrationScore,
  ]);

  // Prevent right-click
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      return false;
    };

    const container = playerContainerRef.current;
    if (container) {
      container.addEventListener("contextmenu", handleContextMenu);
    }
    return () => {
      if (container) {
        container.removeEventListener("contextmenu", handleContextMenu);
      }
    };
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      stopTimer();
      stopProgressTracking();
      if (updateIntervalRef.current) clearInterval(updateIntervalRef.current);
      if (verificationTimerRef.current)
        clearInterval(verificationTimerRef.current);
      if (fullscreenControlsTimeoutRef.current)
        clearTimeout(fullscreenControlsTimeoutRef.current);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, []);

  // Player controls
  const handlePlayPause = async () => {
    if (!player || !allowPlayPause) return;

    if (isPlayed) {
      await player.pause();
      setPauseCount((prev) => prev + 1);
    } else {
      await player.play();
    }
  };

  const handleSeek = async (seconds: number) => {
    if (!player) return;
    const time = await player.getCurrentTime();
    const newTime = Math.max(0, Math.min(time + seconds, duration));
    await player.setCurrentTime(newTime);
    setCurrentTime(newTime);
  };

  const handleProgressClick = async (
    e: React.MouseEvent<HTMLDivElement, MouseEvent>,
  ) => {
    if (!player || !duration) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickPosition = (e.clientX - rect.left) / rect.width;
    const newTime = clickPosition * duration;

    // Check if user can navigate to this time (unanswered questions check)
    const targetTimeMs = newTime * 1000;
    const previousQuestions = timeToQuestionMap.filter(
      ({ time }) => time <= targetTimeMs,
    );
    for (const { question } of previousQuestions) {
      if (!question.can_skip && !answeredQuestions[question.id]?.answered) {
        return; // Cannot navigate past unanswered required questions
      }
    }

    await player.setCurrentTime(newTime);
    setCurrentTime(newTime);
  };

  const handleSpeedChange = (speed: number) => {
    if (!player) return;
    player.setPlaybackRate(speed);
    setPlaybackSpeed(speed);
    setShowSpeedOptions(false);
  };

  const handleVolumeChange = (newVolume: number) => {
    if (!player) return;
    setVolume(newVolume);
    player.setVolume(newVolume / 100);
  };

  // Mirrors the YouTube player's fullscreen handling: iPhone Safari has no
  // Fullscreen API on generic elements (requestFullscreen is undefined, so
  // calling it throws a synchronous TypeError that no .catch() can see), and
  // requestFullscreen() also rejects when the browser refuses — blocked by
  // Permissions Policy in an embed, or without a qualifying user gesture.
  // Feature-detect first, and fall back to the CSS pseudo-fullscreen overlay.
  const toggleFullscreen = async () => {
    if (!playerContainerRef.current) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
        return;
      }

      if (isPseudoFullscreen) {
        setIsPseudoFullscreen(false);
        return;
      }

      const elem = playerContainerRef.current;
      const isIOS =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const canNativeFullscreen =
        !!document.fullscreenEnabled && typeof elem.requestFullscreen === "function";

      if (canNativeFullscreen && !isIOS) {
        await elem.requestFullscreen();
        setIsFullscreen(true);
      } else {
        setIsPseudoFullscreen(true);
      }
    } catch {
      // Last resort — keep the control usable even if the native API refused.
      setIsPseudoFullscreen((prev) => !prev);
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  // Question markers for progress bar
  const questionMarkers = useMemo(() => {
    if (!timeToQuestionMap.length || !duration) return [];
    return timeToQuestionMap.map(({ time, question }) => ({
      position: (time / 1000 / duration) * 100,
      answered: answeredQuestions[question.id]?.answered || false,
      question,
    }));
  }, [timeToQuestionMap, duration, answeredQuestions]);

  return (
    <div
      ref={playerContainerRef}
      // Match the YouTube/Custom players' sizing so the box always has a real
      // height (aspect-ratio + responsive min-heights, filling on large
      // screens). Without an intrinsic height the player collapses when the
      // video is unavailable, since there's no video to drive the height.
      className={`relative flex flex-col ${
        isPseudoFullscreen
          ? "fixed inset-0 z-50 bg-black"
          : "aspect-video w-full min-h-reg-200 sm:min-h-reg-250 md:min-h-reg-300 lg:h-full"
      }`}
      onMouseMove={() => {
        setShowControls(true);
        if (controlsTimeoutRef.current)
          clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = setTimeout(
          () => setShowControls(false),
          3000,
        );
      }}
    >
      {/* Vimeo Player Container */}
      <div
        ref={vimeoContainerRef}
        className="vimeo-fill relative flex-1 bg-black"
        style={{ minHeight: 0 }}
      />

      {/* Video Unavailable Overlay */}
      {loadError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black px-4">
          <div className="flex max-w-sm flex-col items-center gap-stack rounded-xl bg-white p-6 text-center shadow-2xl">
            <WarningCircle weight="fill" className="size-10 text-danger-500" />
            <p className="text-base font-semibold text-neutral-700">
              {t("vimeoPlayer.unavailable.title")}
            </p>
            <p className="text-sm text-neutral-500">
              {t("vimeoPlayer.unavailable.body")}
            </p>
          </div>
        </div>
      )}

      {/* Question Overlay */}
      {showQuestion && currentQuestion && (
        <VideoQuestionOverlay
          question={currentQuestion}
          onSubmit={handleQuestionSubmit}
          onClose={handleQuestionClose}
        />
      )}

      {/* Verification Overlay */}
      {showVerification && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="rounded-xl bg-white p-6 text-center shadow-2xl">
            <p className="mb-2 text-sm text-gray-500">
              {t("vimeoPlayer.verification.selectMiddleNumber")}
            </p>
            <p className="mb-4 text-xs text-gray-400">
              {t("vimeoPlayer.verification.timeRemaining", { seconds: verificationCountdown })}
            </p>
            <div className="flex gap-4">
              {verificationNumbers.map((num, index) => (
                <button
                  key={index}
                  onClick={() => handleVerificationClick(index)}
                  className="h-16 w-16 rounded-xl border-2 border-gray-200 text-xl font-bold transition-all hover:border-blue-500 hover:bg-blue-50"
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div
        className={`transition-opacity duration-300 ${
          showControls ? "opacity-100" : "opacity-0"
        }`}
      >
        {/* Progress Bar */}
        <div
          className="relative h-1 cursor-pointer bg-gray-600 transition-all hover:h-2"
          onClick={handleProgressClick}
        >
          <div
            className="absolute start-0 top-0 h-full bg-blue-500"
            style={{
              width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
            }}
          />
          {/* Question markers */}
          {questionMarkers.map((marker, i) => (
            <div
              key={i}
              className={`absolute top-0 h-full w-1 ${
                marker.answered ? "bg-green-400" : "bg-yellow-400"
              }`}
              style={{ left: `${marker.position}%` }}
            />
          ))}
        </div>

        {/* Control buttons */}
        <div className="flex items-center justify-between bg-gray-900/90 px-4 py-2 text-white">
          <div className="flex items-center gap-3">
            {allowPlayPause && (
              <button onClick={handlePlayPause} className="p-1">
                {isPlayed ? (
                  <Pause weight="fill" className="size-5" />
                ) : (
                  <Play weight="fill" className="size-5" />
                )}
              </button>
            )}

            {allowRewind && (
              <>
                <button
                  onClick={() => handleSeek(-10)}
                  className="p-1 text-gray-300 hover:text-white"
                >
                  <Rewind weight="fill" className="size-4" />
                </button>
                <button
                  onClick={() => handleSeek(10)}
                  className="p-1 text-gray-300 hover:text-white"
                >
                  <FastForward weight="fill" className="size-4" />
                </button>
              </>
            )}

            <span className="text-xs text-gray-300">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Volume */}
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
              className="h-1 w-16 cursor-pointer accent-white"
            />

            {/* Speed */}
            <div className="relative">
              <button
                ref={speedButtonRef}
                onClick={() => setShowSpeedOptions(!showSpeedOptions)}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-gray-700"
              >
                <Gauge className="size-3" />
                {playbackSpeed}x
              </button>
              {showSpeedOptions && (
                <div className="absolute bottom-full end-0 mb-1 rounded bg-gray-800 py-1 shadow-lg">
                  {speedOptions.map((speed) => (
                    <button
                      key={speed}
                      onClick={() => handleSpeedChange(speed)}
                      className={`block w-full px-4 py-1 text-start text-xs hover:bg-gray-700 ${
                        playbackSpeed === speed ? "text-blue-400" : ""
                      }`}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              className="p-1 text-gray-300 hover:text-white"
            >
              <ArrowsOut className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Wrapper with forwardRef (matching YouTubePlayerWrapper pattern)
interface VimeoPlayerWrapperProps {
  videoId: string;
  onTimeUpdate?: (currentTime: number) => void;
  questions?: Array<{
    id: string;
    question_time_in_millis: number;
    text_data: { content: string };
    parent_rich_text?: { content: string };
    options: Array<{ id: string; text: { content: string } }>;
    can_skip?: boolean;
    question_type?: string;
    auto_evaluation_json?: string;
  }>;
  ms?: number;
  allowPlayPause?: boolean;
  allowRewind?: boolean;
  enableConcentrationScore?: boolean;
  concentrationSettings?: ConcentrationSettings;
}

const VimeoPlayerWrapper = forwardRef<any, VimeoPlayerWrapperProps>(
  (
    {
      videoId,
      onTimeUpdate,
      questions,
      ms,
      allowPlayPause,
      allowRewind,
      enableConcentrationScore,
      concentrationSettings,
    },
    ref,
  ) => {
    const playerRef = useRef<any>(null);

    useImperativeHandle(ref, () => ({
      playVideo: () => {
        if (playerRef.current) {
          playerRef.current.play();
        }
      },
      pauseVideo: () => {
        if (playerRef.current) {
          playerRef.current.pause();
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
      seekTo: (seconds: number) => {
        if (playerRef.current) {
          playerRef.current.setCurrentTime(seconds);
        }
      },
    }));

    const handleTimeUpdate = (currentTime: number) => {
      if (onTimeUpdate) {
        onTimeUpdate(currentTime);
      }
    };

    return (
      <VimeoPlayerComp
        videoId={videoId}
        onTimeUpdate={handleTimeUpdate}
        questions={questions}
        ms={ms}
        allowPlayPause={allowPlayPause}
        allowRewind={allowRewind}
        enableConcentrationScore={enableConcentrationScore}
        concentrationSettings={concentrationSettings}
      />
    );
  },
);

VimeoPlayerWrapper.displayName = "VimeoPlayerWrapper";

export default VimeoPlayerWrapper;
